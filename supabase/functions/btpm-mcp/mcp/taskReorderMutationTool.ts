// API-Q Task Reorder Step 3 — Task-reorder MCP mutation-control composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `tasks.reorder`. It composes only already accepted
// components:
//
//   - literal confirmation control          : `requireMcpMutationConfirmation`
//   - canonical Phase identity validation   : `parseApiV1TaskReorderPath`
//   - canonical business validation         : `parseApiV1ReorderTasksBody`
//   - canonical idempotency + payload hash  : `buildMcpMutationExecutionContext`
//     over `buildApiV1ReorderTasksIdempotencyPayload(phaseId, body)`
//   - canonical rate limiting               : `enforceApiRateLimit`
//   - caller-bound writer                   : `McpV1ReorderTasksExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, no Tenant/Organization/Workspace/Project scope
// derivation, no Connected App check, no encryption, persists nothing, logs
// nothing, starts no timer, performs no retry, performs no read-before-write
// and registers no MCP tool. No generic operation dispatcher exists here.
//
// Sibling-set completeness, duplicate Task identity, duplicate/contiguous sort
// positions, Phase membership and stale-row semantics remain exclusively
// canonical database responsibilities.
//
// Optimistic concurrency: every caller `expectedUpdatedAt` is a precondition.
// It is never refreshed, reformatted, replaced or retried here.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  buildApiV1ReorderTasksIdempotencyPayload,
  parseApiV1ReorderTasksBody,
  parseApiV1TaskReorderPath,
  TASK_REORDER_ROUTE,
} from "../../_shared/btpm-api/routes/tasks.ts";
import type { ApiV1ReorderTasksSuccessResult } from "../../_shared/btpm-api/supabaseTask.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1ReorderTasksExecutor } from "./taskReorderMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `tasks.reorder`. */
export const MCP_TASK_REORDER_TOOL_NAME = "btpm_reorder_tasks";

/** Canonical Task reorder path prefix/suffix; the accepted parser validates. */
const REORDER_PATH_PREFIX = "/v1/phases/";
const REORDER_PATH_SUFFIX = "/tasks/reorder";

/**
 * Strict MCP row envelope guard. Transport shape only: UUID form, timestamp
 * form, sort-order bounds, uniqueness, contiguity, sibling completeness and
 * membership remain canonical.
 */
export const MCP_TASK_REORDER_TOOL_ROW_SCHEMA = z.strictObject({
  taskId: z.string(),
  expectedUpdatedAt: z.string(),
  sortOrder: z.number(),
});

/**
 * Strict MCP transport guard. It is presentation only. No Tenant,
 * Organization, Workspace, actor, source channel, API-client, provenance,
 * request ID, correlation ID or payload hash is accepted from the caller.
 */
export const MCP_TASK_REORDER_TOOL_INPUT_SCHEMA = z.strictObject({
  phaseId: z.string(),
  rows: z.array(MCP_TASK_REORDER_TOOL_ROW_SCHEMA),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact four approved MCP argument names, in canonical order. */
export const MCP_TASK_REORDER_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "phaseId",
    "rows",
    "confirmation",
    "idempotencyKey",
  ]);

/** The exact three approved MCP row field names, in canonical order. */
export const MCP_TASK_REORDER_TOOL_ROW_FIELD_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "taskId",
    "expectedUpdatedAt",
    "sortOrder",
  ]);

/** Already schema-validated (untrusted) MCP row argument. */
export interface McpTaskReorderToolRowArgument {
  readonly taskId: string;
  readonly expectedUpdatedAt: string;
  readonly sortOrder: number;
}

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpTaskReorderToolArguments {
  readonly phaseId: string;
  readonly rows: readonly McpTaskReorderToolRowArgument[];
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpTaskReorderToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "stale_task_order"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_TASK_REORDER_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpTaskReorderToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to reorder Tasks for this Phase.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  stale_task_order:
    "One or more Tasks changed since the supplied expectedUpdatedAt values. Read the current Phase planning and retry intentionally with current updatedAt values and a new idempotency key.",
  unavailable: "BTPM Task reorder is temporarily unavailable.",
});

/** Bounded ordered-Task element. No Task narrative is returned. */
export interface McpTaskReorderToolOrderedTask {
  readonly taskId: string;
  readonly sortOrder: number;
  readonly updatedAt: string;
}

/** Bounded successful tool payload. */
export interface McpTaskReorderToolPayload {
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly projectId: string;
  readonly phaseId: string;
  readonly submittedCount: number;
  readonly changedCount: number;
  readonly orderedTasks: readonly McpTaskReorderToolOrderedTask[];
}

/** Bounded tool result union. */
export type McpTaskReorderToolResult =
  | { readonly ok: true; readonly payload: McpTaskReorderToolPayload }
  | { readonly ok: false; readonly category: McpTaskReorderToolErrorCategory };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpTaskReorderToolExecutor = (
  args: McpTaskReorderToolArguments,
) => Promise<McpTaskReorderToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpTaskReorderToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1ReorderTasksExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpTaskReorderToolErrorCategory {
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
): McpTaskReorderToolErrorCategory {
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
  result: ApiV1ReorderTasksSuccessResult,
): McpTaskReorderToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    projectId: result.projectId,
    phaseId: result.phaseId,
    submittedCount: result.submittedCount,
    changedCount: result.changedCount,
    orderedTasks: Object.freeze(
      result.orderedTasks.map((task) =>
        Object.freeze({
          taskId: task.taskId,
          sortOrder: task.sortOrder,
          updatedAt: task.updatedAt,
        })
      ),
    ),
  });
}

/**
 * Creates the per-request `tasks.reorder` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. literal confirmation is required (before rate limiting and writer);
 *   3. the Phase identity is validated through the canonical path parser;
 *   4. the canonical reorder business body is built from `rows` only;
 *   5. it is validated through `parseApiV1ReorderTasksBody`;
 *   6. the canonical reorder idempotency payload (phaseId + complete rows)
 *      is built;
 *   7. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash);
 *   8. the canonical rate-limit profile is resolved;
 *   9. the canonical atomic rate limit is consumed;
 *  10. the accepted caller-bound writer is invoked exactly once.
 */
export function createMcpTaskReorderToolExecutor(
  dependencies: McpTaskReorderToolDependencies,
): McpTaskReorderToolExecutor {
  return async function executeTaskReorder(
    args: McpTaskReorderToolArguments,
  ): Promise<McpTaskReorderToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_TASK_REORDER_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before any rate-limit resolution or writer.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical Phase identity.
      const { phaseId: canonicalPhaseId } = parseApiV1TaskReorderPath(
        `${REORDER_PATH_PREFIX}${parsedArgs.phaseId}${REORDER_PATH_SUFFIX}`,
      );

      // 4. Business object from `rows` only (no control field).
      const businessInput: Record<string, unknown> = {
        rows: parsedArgs.rows.map((row) => ({
          taskId: row.taskId,
          // Caller concurrency precondition, forwarded unchanged.
          expectedUpdatedAt: row.expectedUpdatedAt,
          sortOrder: row.sortOrder,
        })),
      };

      // 5. Canonical business validation.
      const canonicalBody = parseApiV1ReorderTasksBody(businessInput);

      // 6. Canonical reorder idempotency payload (Phase identity + the
      // complete canonical rows collection).
      const canonicalIdempotencyPayload =
        buildApiV1ReorderTasksIdempotencyPayload(
          canonicalPhaseId,
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
        TASK_REORDER_ROUTE.id,
      );

      // 9. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: TASK_REORDER_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 10. Accepted caller-bound writer, invoked exactly once. The caller's
      // concurrency preconditions are forwarded unchanged.
      const result = await dependencies.writer(
        dependencies.request,
        canonicalPhaseId,
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
        // Bounded stale-order conflict: never retried, never refreshed, and no
        // current database timestamp or stale identity is disclosed.
        return Object.freeze({
          ok: false as const,
          category: "stale_task_order",
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
