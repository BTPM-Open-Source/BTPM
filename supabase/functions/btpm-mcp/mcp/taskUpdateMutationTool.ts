// API-Q Task Update Step 3 — Task-update MCP mutation-control composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `tasks.update`. It composes only already accepted
// components:
//
//   - literal confirmation control       : `requireMcpMutationConfirmation`
//   - canonical Task identity validation : `parseApiV1TaskUpdatePath`
//   - canonical business validation      : `parseApiV1UpdateTaskBody`
//   - canonical idempotency + payload hash: `buildMcpMutationExecutionContext`
//     over `buildApiV1UpdateTaskIdempotencyPayload(taskId, body)`
//   - canonical rate limiting            : `enforceApiRateLimit`
//   - caller-bound writer                : `McpV1UpdateTaskExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, no Tenant/Organization/Workspace/Project scope
// derivation, no Connected App check, no encryption, persists nothing, logs
// nothing, starts no timer, performs no retry, performs no read-before-write
// and registers no MCP tool. No generic operation dispatcher exists here.
//
// Optimistic concurrency: the caller's `expectedUpdatedAt` is a precondition.
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
  type ApiV1TaskPriority,
  type ApiV1TaskStatus,
  type ApiV1TaskType,
  buildApiV1UpdateTaskIdempotencyPayload,
  parseApiV1TaskUpdatePath,
  parseApiV1UpdateTaskBody,
  TASK_UPDATE_ROUTE,
} from "../../_shared/btpm-api/routes/tasks.ts";
import type { ApiV1UpdateTaskSuccessResult } from "../../_shared/btpm-api/supabaseTask.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1UpdateTaskExecutor } from "./taskUpdateMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `tasks.update`. */
export const MCP_TASK_UPDATE_TOOL_NAME = "btpm_update_task";

/** Canonical Task identity path prefix; the accepted parser owns validation. */
const TASK_PATH_PREFIX = "/v1/tasks/";

/**
 * Strict MCP transport guard. It is presentation only: canonical validation
 * remains authoritative for business fields (UUID form, timestamp form,
 * blank/length handling, estimated-hours range) and for idempotency. Phase
 * movement, schedule, ordering, assignment and transition fields are
 * deliberately absent: Task metadata update never re-plans, moves, reorders,
 * assigns or transitions.
 */
export const MCP_TASK_UPDATE_TOOL_INPUT_SCHEMA = z.strictObject({
  taskId: z.string(),
  expectedUpdatedAt: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum([
    "planned",
    "active",
    "completed",
    "on_hold",
    "cancelled",
  ]).nullable(),
  priority: z.enum([
    "low",
    "medium",
    "high",
    "critical",
  ]).nullable(),
  taskType: z.enum([
    "milestone",
    "deliverable",
    "work_item",
    "decision",
    "review",
  ]).nullable(),
  estimatedHours: z.number().nullable(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact ten approved MCP argument names, in canonical order. */
export const MCP_TASK_UPDATE_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "taskId",
    "expectedUpdatedAt",
    "name",
    "description",
    "status",
    "priority",
    "taskType",
    "estimatedHours",
    "confirmation",
    "idempotencyKey",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpTaskUpdateToolArguments {
  readonly taskId: string;
  readonly expectedUpdatedAt: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: ApiV1TaskStatus | null;
  readonly priority: ApiV1TaskPriority | null;
  readonly taskType: ApiV1TaskType | null;
  readonly estimatedHours: number | null;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpTaskUpdateToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "stale_task"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_TASK_UPDATE_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpTaskUpdateToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to update this Task.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  stale_task:
    "This Task has changed since the supplied expectedUpdatedAt. Read the current Task and retry intentionally with a new updatedAt and a new idempotency key.",
  unavailable: "BTPM Task update is temporarily unavailable.",
});

/** Bounded successful tool payload. No Task narrative is returned. */
export interface McpTaskUpdateToolPayload {
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly taskId: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly status: ApiV1TaskStatus;
  readonly priority: ApiV1TaskPriority;
  readonly taskType: ApiV1TaskType;
  readonly estimatedHours: number | null;
  readonly updatedAt: string;
}

/** Bounded tool result union. */
export type McpTaskUpdateToolResult =
  | { readonly ok: true; readonly payload: McpTaskUpdateToolPayload }
  | { readonly ok: false; readonly category: McpTaskUpdateToolErrorCategory };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpTaskUpdateToolExecutor = (
  args: McpTaskUpdateToolArguments,
) => Promise<McpTaskUpdateToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpTaskUpdateToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1UpdateTaskExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpTaskUpdateToolErrorCategory {
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
): McpTaskUpdateToolErrorCategory {
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
  result: ApiV1UpdateTaskSuccessResult,
): McpTaskUpdateToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    taskId: result.taskId,
    projectId: result.projectId,
    phaseId: result.phaseId,
    status: result.status,
    priority: result.priority,
    taskType: result.taskType,
    estimatedHours: result.estimatedHours,
    updatedAt: result.updatedAt,
  });
}

/**
 * Creates the per-request `tasks.update` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. literal confirmation is required (before rate limiting and writer);
 *   3. the Task identity is validated through the canonical path parser;
 *   4. the COMPLETE seven-field desired-state business body is built;
 *   5. it is validated through `parseApiV1UpdateTaskBody`;
 *   6. the canonical Task-update idempotency payload (taskId + full desired
 *      state) is built;
 *   7. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash);
 *   8. the canonical rate-limit profile is resolved;
 *   9. the canonical atomic rate limit is consumed;
 *  10. the accepted caller-bound writer is invoked exactly once.
 */
export function createMcpTaskUpdateToolExecutor(
  dependencies: McpTaskUpdateToolDependencies,
): McpTaskUpdateToolExecutor {
  return async function executeTaskUpdate(
    args: McpTaskUpdateToolArguments,
  ): Promise<McpTaskUpdateToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_TASK_UPDATE_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before any rate-limit consumption or writer.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical Task identity.
      const { taskId: canonicalTaskId } = parseApiV1TaskUpdatePath(
        `${TASK_PATH_PREFIX}${parsedArgs.taskId}`,
      );

      // 4. COMPLETE desired-state business object (no control field).
      const businessInput: Record<string, unknown> = {
        expectedUpdatedAt: parsedArgs.expectedUpdatedAt,
        name: parsedArgs.name,
        description: parsedArgs.description,
        status: parsedArgs.status,
        priority: parsedArgs.priority,
        taskType: parsedArgs.taskType,
        estimatedHours: parsedArgs.estimatedHours,
      };

      // 5. Canonical business validation.
      const canonicalBody = parseApiV1UpdateTaskBody(businessInput);

      // 6. Canonical Task-update idempotency payload (identity + desired
      // state), so the payload hash always includes the Task identity.
      const canonicalIdempotencyPayload =
        buildApiV1UpdateTaskIdempotencyPayload(
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
        TASK_UPDATE_ROUTE.id,
      );

      // 9. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: TASK_UPDATE_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 10. Accepted caller-bound writer, invoked exactly once. The caller's
      // concurrency precondition is forwarded unchanged.
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
        return Object.freeze({ ok: false as const, category: "stale_task" });
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
