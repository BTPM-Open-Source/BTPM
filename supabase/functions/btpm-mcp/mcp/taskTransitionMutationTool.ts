// API-Q Task Transition Step 3 — Task-transition MCP mutation-control
// composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `tasks.transition`. It composes only already
// accepted components:
//
//   - ordinary MCP confirmation control     : `requireMcpMutationConfirmation`
//   - canonical Task identity validation    : `parseApiV1TaskTransitionPath`
//   - canonical business validation         : `parseApiV1TransitionTaskBody`
//   - canonical idempotency + payload hash  : `buildMcpMutationExecutionContext`
//     over `buildApiV1TransitionTaskIdempotencyPayload(taskId, body)`
//   - canonical rate limiting               : `enforceApiRateLimit`
//   - caller-bound writer                   : `McpV1TransitionTaskExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, no actual-date rule evaluation, no completed-task
// locking, no reopen evaluation, no rollup, no Tenant/Organization/Workspace/
// Project/Phase scope derivation, no Connected App check, persists nothing,
// logs nothing, starts no timer, performs no retry, performs no
// read-before-write and registers no MCP tool.
//
// `confirmation` is pure control metadata: it never enters the canonical
// business body and never participates in the canonical hashed payload.
//
// Optimistic concurrency: the caller `expectedUpdatedAt` is a precondition. It
// is never refreshed, reformatted, replaced or retried here, and the current
// database timestamp is never disclosed. A stale result is reduced to the
// bounded `stale_task` category only.
//
// Successful `status` is NOT narrowed to active/completed: the accepted writer
// already validates the full canonical Task result vocabulary (planned, active,
// completed, on_hold, cancelled) and it is passed through unchanged.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  buildApiV1TransitionTaskIdempotencyPayload,
  parseApiV1TaskTransitionPath,
  parseApiV1TransitionTaskBody,
  TASK_TRANSITION_ROUTE,
} from "../../_shared/btpm-api/routes/tasks.ts";
import type { ApiV1TransitionTaskSuccessResult } from "../../_shared/btpm-api/supabaseTask.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1TransitionTaskExecutor } from "./taskTransitionMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `tasks.transition`. */
export const MCP_TASK_TRANSITION_TOOL_NAME = "btpm_transition_task";

/** Canonical Task transition path prefix/suffix; the accepted parser validates. */
const TRANSITION_PATH_PREFIX = "/v1/tasks/";
const TRANSITION_PATH_SUFFIX = "/transition";

/**
 * Strict MCP transport guard. It is presentation only. No Tenant,
 * Organization, Workspace, Project, Phase, actor, source channel, API-client,
 * OAuth client, provenance, request ID, correlation ID, payload hash,
 * capability, rate-limit profile, operation name or function name is accepted
 * from the caller.
 */
export const MCP_TASK_TRANSITION_TOOL_INPUT_SCHEMA = z.strictObject({
  taskId: z.string(),
  expectedUpdatedAt: z.string(),
  setActualStart: z.boolean(),
  actualStartDate: z.string().nullable(),
  setActualEnd: z.boolean(),
  actualEndDate: z.string().nullable(),
  status: z.union([z.literal("active"), z.literal("completed")]).nullable()
    .describe(
      "Allowed values: 'active', 'completed' or null. null means do not change the status. Setting 'active' does NOT reopen an already completed Task: completed Tasks are locked and require BTPM's dedicated reopen flow before their execution dates or status can be changed.",
    ),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact nine approved MCP argument names, in canonical order. */
export const MCP_TASK_TRANSITION_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "taskId",
    "expectedUpdatedAt",
    "setActualStart",
    "actualStartDate",
    "setActualEnd",
    "actualEndDate",
    "status",
    "confirmation",
    "idempotencyKey",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpTaskTransitionToolArguments {
  readonly taskId: string;
  /** Sole caller concurrency precondition; never refreshed or replaced. */
  readonly expectedUpdatedAt: string;
  readonly setActualStart: boolean;
  readonly actualStartDate: string | null;
  readonly setActualEnd: boolean;
  readonly actualEndDate: string | null;
  /** `null` means "do not change status". */
  readonly status: "active" | "completed" | null;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpTaskTransitionToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "stale_task"
  // MCP-HARDENING-C4 — bounded completed-Task lifecycle boundary. This tool
  // never reopens a Task and never retries.
  | "task_reopen_required"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_TASK_TRANSITION_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpTaskTransitionToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to transition this Task.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  stale_task:
    "This Task has changed since the supplied expectedUpdatedAt. Read the current Task and retry intentionally with the current updatedAt and a new idempotency key.",
  task_reopen_required:
    "This Task is completed and must be reopened before its execution dates or status can be changed. Reopen the Task in BTPM, then read the Task again and retry intentionally with the current updatedAt and a new idempotency key.",
  unavailable: "BTPM Task transition is temporarily unavailable.",
});

/**
 * Bounded successful tool payload. No Task narrative is returned. `status` is
 * the full canonical Task status vocabulary validated by the accepted writer
 * and is never narrowed here.
 */
export interface McpTaskTransitionToolPayload {
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly taskId: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly status: string;
  readonly actualStartDate: string | null;
  readonly actualEndDate: string | null;
  readonly updatedAt: string;
}

/** Bounded tool result union. */
export type McpTaskTransitionToolResult =
  | { readonly ok: true; readonly payload: McpTaskTransitionToolPayload }
  | {
    readonly ok: false;
    readonly category: McpTaskTransitionToolErrorCategory;
  };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpTaskTransitionToolExecutor = (
  args: McpTaskTransitionToolArguments,
) => Promise<McpTaskTransitionToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpTaskTransitionToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1TransitionTaskExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpTaskTransitionToolErrorCategory {
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
): McpTaskTransitionToolErrorCategory {
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
  result: ApiV1TransitionTaskSuccessResult,
): McpTaskTransitionToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    taskId: result.taskId,
    projectId: result.projectId,
    phaseId: result.phaseId,
    // Full canonical Task status vocabulary, passed through unchanged.
    status: result.status,
    actualStartDate: result.actualStartDate,
    actualEndDate: result.actualEndDate,
    updatedAt: result.updatedAt,
  });
}

/**
 * Creates the per-request `tasks.transition` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. ordinary MCP confirmation is required (before hashing, rate limiting and
 *      the writer);
 *   3. the Task identity is validated through the canonical path parser;
 *   4. the canonical business-only transition object is built;
 *   5. it is validated through `parseApiV1TransitionTaskBody`;
 *   6. the canonical transition idempotency payload is built;
 *   7. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash);
 *   8. the canonical rate-limit profile is resolved;
 *   9. the canonical atomic rate limit is consumed;
 *  10. the accepted caller-bound writer is invoked exactly once.
 */
export function createMcpTaskTransitionToolExecutor(
  dependencies: McpTaskTransitionToolDependencies,
): McpTaskTransitionToolExecutor {
  return async function executeTaskTransition(
    args: McpTaskTransitionToolArguments,
  ): Promise<McpTaskTransitionToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_TASK_TRANSITION_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Ordinary MCP mutation confirmation, before any hashing, rate-limit
      // resolution or writer execution.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical Task identity.
      const { taskId: canonicalTaskId } = parseApiV1TaskTransitionPath(
        `${TRANSITION_PATH_PREFIX}${parsedArgs.taskId}${TRANSITION_PATH_SUFFIX}`,
      );

      // 4. Business-only object. The confirmation control is excluded.
      const businessInput: Record<string, unknown> = {
        // Caller concurrency precondition, forwarded unchanged.
        expectedUpdatedAt: parsedArgs.expectedUpdatedAt,
        setActualStart: parsedArgs.setActualStart,
        // `true` with `null` remains an explicit clear.
        actualStartDate: parsedArgs.actualStartDate,
        setActualEnd: parsedArgs.setActualEnd,
        actualEndDate: parsedArgs.actualEndDate,
        // `null` means "do not change status".
        status: parsedArgs.status,
      };

      // 5. Canonical business validation.
      const canonicalBody = parseApiV1TransitionTaskBody(businessInput);

      // 6. Canonical transition idempotency payload (Task identity + all six
      // canonical business fields).
      const canonicalIdempotencyPayload =
        buildApiV1TransitionTaskIdempotencyPayload(
          canonicalTaskId,
          canonicalBody,
        );

      // 7. Canonical mutation execution context (idempotency + payload hash).
      const mutationContext = await buildMcpMutationExecutionContext(
        dependencies.execution,
        parsedArgs.idempotencyKey,
        canonicalIdempotencyPayload,
      );

      // 8. Canonical rate-limit profile.
      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        TASK_TRANSITION_ROUTE.id,
      );

      // 9. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: TASK_TRANSITION_ROUTE.id,
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

      if (result.outcome === "conflict") {
        // Bounded stale conflict: never retried, never refreshed, and no
        // current database timestamp is disclosed.
        return Object.freeze({
          ok: false as const,
          category: "stale_task" as const,
        });
      }

      // MCP-HARDENING-C4 — the bounded completed-Task lifecycle boundary is
      // recognised BEFORE generic invalid mapping. No reopen is attempted, no
      // read-before-write and no retry is performed here.
      if (result.outcome === "invalid" && "code" in result) {
        return Object.freeze({
          ok: false as const,
          category: "task_reopen_required" as const,
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
