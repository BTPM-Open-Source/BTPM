// API-Q Task Assign Step 3 — Task-assignment MCP mutation-control composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `tasks.assign`. It composes only already accepted
// components:
//
//   - ordinary MCP confirmation control     : `requireMcpMutationConfirmation`
//   - canonical Task identity validation    : `parseApiV1TaskAssignPath`
//   - canonical business validation         : `parseApiV1AssignTaskBody`
//   - canonical idempotency + payload hash  : `buildMcpMutationExecutionContext`
//     over `buildApiV1AssignTaskIdempotencyPayload(taskId, body)`
//   - canonical rate limiting               : `enforceApiRateLimit`
//   - caller-bound writer                   : `McpV1AssignTaskExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, no assignee-eligibility evaluation, no
// Tenant/Organization/Workspace/Project/Phase scope derivation, no Connected
// App check, persists nothing, logs nothing, starts no timer, performs no
// retry, performs no read-before-write and registers no MCP tool.
//
// `confirmation` is pure control metadata: it never enters the canonical
// business body and never participates in the canonical hashed payload.
//
// Task Assign has NO optimistic-concurrency token: there is intentionally no
// `expectedUpdatedAt` argument and no stale/conflict outcome or category.
//
// `assigneeId: null` is canonical business input meaning "clear the
// assignment". It is forwarded exactly as supplied and never substituted.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  buildApiV1AssignTaskIdempotencyPayload,
  parseApiV1AssignTaskBody,
  parseApiV1TaskAssignPath,
  TASK_ASSIGN_ROUTE,
} from "../../_shared/btpm-api/routes/tasks.ts";
import type { ApiV1AssignTaskSuccessResult } from "../../_shared/btpm-api/supabaseTask.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1AssignTaskExecutor } from "./taskAssignMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `tasks.assign`. */
export const MCP_TASK_ASSIGN_TOOL_NAME = "btpm_assign_task";

/** Canonical Task assignment path prefix/suffix; the accepted parser validates. */
const ASSIGN_PATH_PREFIX = "/v1/tasks/";
const ASSIGN_PATH_SUFFIX = "/assignee";

/**
 * Strict MCP transport guard. It is presentation only. No Tenant,
 * Organization, Workspace, Project, Phase, actor, role, assignment type,
 * source channel, API-client, OAuth client, provenance, request ID,
 * correlation ID, payload hash, concurrency token, rate-limit profile,
 * operation name or function name is accepted from the caller.
 */
export const MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA = z.strictObject({
  taskId: z.string(),
  assigneeId: z.string().nullable(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact four approved MCP argument names, in canonical order. */
export const MCP_TASK_ASSIGN_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "taskId",
    "assigneeId",
    "confirmation",
    "idempotencyKey",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpTaskAssignToolArguments {
  readonly taskId: string;
  /** `null` explicitly clears the Task assignment. */
  readonly assigneeId: string | null;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/**
 * Bounded failure categories this tool may disclose. There is deliberately NO
 * stale/concurrency category: Task assignment has no concurrency token.
 */
export type McpTaskAssignToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_TASK_ASSIGN_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpTaskAssignToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to assign this Task.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  unavailable: "BTPM Task assignment is temporarily unavailable.",
});

/** Bounded successful tool payload. No Task narrative or profile is returned. */
export interface McpTaskAssignToolPayload {
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly taskId: string;
  readonly projectId: string;
  readonly oldAssigneeId: string | null;
  readonly newAssigneeId: string | null;
}

/** Bounded tool result union. */
export type McpTaskAssignToolResult =
  | { readonly ok: true; readonly payload: McpTaskAssignToolPayload }
  | { readonly ok: false; readonly category: McpTaskAssignToolErrorCategory };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpTaskAssignToolExecutor = (
  args: McpTaskAssignToolArguments,
) => Promise<McpTaskAssignToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpTaskAssignToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1AssignTaskExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpTaskAssignToolErrorCategory {
  if (error instanceof McpMutationControlError) {
    if (error.code === "mcp_mutation_confirmation_required") {
      return "confirmation_required";
    }
    // A malformed trusted context is internal: never disclose which invariant.
    return "unavailable";
  }
  if (error instanceof z.ZodError) {
    return "invalid_arguments";
  }
  if (error instanceof IdempotencyValidationError) {
    return "invalid_arguments";
  }
  if (error instanceof ApiHttpError) {
    if (error.code === "rate_limit_exceeded") return "rate_limited";
    if (error.code === "not_authorized") return "not_authorized";
    if (error.code === "invalid_request") return "invalid_arguments";
  }
  return "unavailable";
}

function mapNegativeOutcome(
  outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending",
): McpTaskAssignToolErrorCategory {
  switch (outcome) {
    case "invalid":
      return "invalid_arguments";
    case "not_authorized":
      return "not_authorized";
    case "idempotency_conflict":
      return "idempotency_conflict";
    case "idempotency_pending":
      return "idempotency_pending";
  }
}

function toBoundedPayload(
  result: ApiV1AssignTaskSuccessResult,
): McpTaskAssignToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    taskId: result.taskId,
    projectId: result.projectId,
    // Nullable assignee identities are preserved exactly.
    oldAssigneeId: result.oldAssigneeId,
    newAssigneeId: result.newAssigneeId,
  });
}

/**
 * Creates the per-request `tasks.assign` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. ordinary MCP confirmation is required (before rate limiting and writer);
 *   3. the Task identity is validated through the canonical path parser;
 *   4. the canonical business-only assignment object is built;
 *   5. it is validated through `parseApiV1AssignTaskBody`;
 *   6. the canonical assignment idempotency payload is built;
 *   7. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash);
 *   8. the canonical rate-limit profile is resolved;
 *   9. the canonical atomic rate limit is consumed;
 *  10. the accepted caller-bound writer is invoked exactly once.
 */
export function createMcpTaskAssignToolExecutor(
  dependencies: McpTaskAssignToolDependencies,
): McpTaskAssignToolExecutor {
  return async function executeTaskAssign(
    args: McpTaskAssignToolArguments,
  ): Promise<McpTaskAssignToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_TASK_ASSIGN_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Ordinary MCP mutation confirmation, before any rate-limit
      // resolution, hashing or writer execution.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical Task identity.
      const { taskId: canonicalTaskId } = parseApiV1TaskAssignPath(
        `${ASSIGN_PATH_PREFIX}${parsedArgs.taskId}${ASSIGN_PATH_SUFFIX}`,
      );

      // 4. Business-only object. The confirmation control is excluded.
      // `assigneeId: null` means "clear the assignment" and is never replaced.
      const businessInput: Record<string, unknown> = {
        assigneeId: parsedArgs.assigneeId,
      };

      // 5. Canonical business validation.
      const canonicalBody = parseApiV1AssignTaskBody(businessInput);

      // 6. Canonical assignment idempotency payload (Task identity + canonical
      // business body).
      const canonicalIdempotencyPayload =
        buildApiV1AssignTaskIdempotencyPayload(canonicalTaskId, canonicalBody);

      // 7. Canonical mutation execution context (idempotency + payload hash).
      const mutationContext = await buildMcpMutationExecutionContext(
        dependencies.execution,
        parsedArgs.idempotencyKey,
        canonicalIdempotencyPayload,
      );

      // 8. Canonical rate-limit profile.
      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        TASK_ASSIGN_ROUTE.id,
      );

      // 9. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: TASK_ASSIGN_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 10. Accepted caller-bound writer, invoked exactly once. No retry.
      const result = await dependencies.writer(
        dependencies.request,
        canonicalTaskId,
        canonicalBody,
        mutationContext,
      );

      if (result.ok) {
        return Object.freeze({
          ok: true as const,
          payload: toBoundedPayload(result),
        });
      }

      return Object.freeze({
        ok: false as const,
        category: mapNegativeOutcome(result.outcome),
      });
    } catch (error) {
      // Only a bounded category escapes: no SQLSTATE, database message, stack,
      // policy reason, token, identity, narrative or internal function name.
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
