// API-Q Task Plan Step 3 — Task-planning MCP mutation-control composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `tasks.plan`. It composes only already accepted
// components:
//
//   - ordinary MCP confirmation control     : `requireMcpMutationConfirmation`
//   - canonical Task identity validation    : `parseApiV1TaskPlanningPath`
//   - canonical business validation         : `parseApiV1PlanTaskBody`
//   - canonical idempotency + payload hash  : `buildMcpMutationExecutionContext`
//     over `buildApiV1PlanTaskIdempotencyPayload(taskId, body)`
//   - canonical rate limiting               : `enforceApiRateLimit`
//   - caller-bound writer                   : `McpV1PlanTaskExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, no Tenant/Organization/Workspace/Project scope
// derivation, no Connected App check, persists nothing, logs nothing, starts no
// timer, performs no retry, performs no read-before-write and registers no MCP
// tool.
//
// TWO INDEPENDENT CONFIRMATION CONTROLS:
//   - `confirmation`           — ordinary MCP mutation confirmation. It is pure
//     control metadata: it never enters the canonical business body and never
//     participates in the canonical hashed payload.
//   - `confirmParentExtension` — canonical Task Plan BUSINESS input, meaning
//     the user explicitly authorizes extending the parent Phase planning
//     window. It is forwarded exactly as supplied and participates in the
//     canonical hashed payload.
//
// `confirmation === true` NEVER implies `confirmParentExtension === true`.
// Neither field is ever derived from, promoted by or defaulted from the other.
// A retry after explicit Phase-window approval changes the canonical business
// payload and therefore REQUIRES a new idempotency key; no key is reused or
// mutated here.
//
// Optimistic concurrency: the caller `expectedUpdatedAt` is a precondition. It
// is never refreshed, reformatted, replaced or retried here, and the current
// database timestamp is never disclosed.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  buildApiV1PlanTaskIdempotencyPayload,
  parseApiV1PlanTaskBody,
  parseApiV1TaskPlanningPath,
  TASK_PLANNING_ROUTE,
} from "../../_shared/btpm-api/routes/tasks.ts";
import type {
  ApiV1PlanTaskConfirmationRequiredResult,
  ApiV1PlanTaskSuccessResult,
} from "../../_shared/btpm-api/supabaseTask.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1PlanTaskExecutor } from "./taskPlanMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `tasks.plan`. */
export const MCP_TASK_PLAN_TOOL_NAME = "btpm_plan_task";

/** Canonical Task planning path prefix/suffix; the accepted parser validates. */
const PLANNING_PATH_PREFIX = "/v1/tasks/";
const PLANNING_PATH_SUFFIX = "/planning";

/**
 * Strict MCP transport guard. It is presentation only. No Tenant,
 * Organization, Workspace, Project, Phase, actor, source channel, API-client,
 * OAuth client, provenance, request ID, correlation ID, payload hash,
 * rate-limit profile, operation name or function name is accepted from the
 * caller.
 */
export const MCP_TASK_PLAN_TOOL_INPUT_SCHEMA = z.strictObject({
  taskId: z.string(),
  expectedUpdatedAt: z.string(),
  startDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  confirmParentExtension: z.boolean(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact seven approved MCP argument names, in canonical order. */
export const MCP_TASK_PLAN_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "taskId",
    "expectedUpdatedAt",
    "startDate",
    "dueDate",
    "confirmParentExtension",
    "confirmation",
    "idempotencyKey",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpTaskPlanToolArguments {
  readonly taskId: string;
  readonly expectedUpdatedAt: string;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly confirmParentExtension: boolean;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpTaskPlanToolErrorCategory =
  | "confirmation_required"
  | "phase_window_extension_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "stale_task_planning"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_TASK_PLAN_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpTaskPlanToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  phase_window_extension_required:
    "The requested Task dates require extending the parent Phase planning window. Explicitly confirm that Phase-window extension before retrying with confirmParentExtension=true and a new idempotency key.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to plan this Task.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  stale_task_planning:
    "The Task changed since the supplied expectedUpdatedAt value. Read the current Task or Phase planning and retry intentionally with the current updatedAt and a new idempotency key.",
  unavailable: "BTPM Task planning is temporarily unavailable.",
});

/** Bounded successful tool payload. No Task narrative is returned. */
export interface McpTaskPlanToolPayload {
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly taskId: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly updatedAt: string;
  readonly phaseExtended: boolean;
  readonly phaseStartDate: string | null;
  readonly phaseTargetEndDate: string | null;
}

/**
 * Bounded Phase-window impact detail. Exactly the nine approved fields from the
 * already accepted canonical writer result. No other database information is
 * exposed.
 */
export interface McpTaskPlanToolPhaseWindowDetails {
  readonly taskId: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly phaseCurrentStart: string | null;
  readonly phaseCurrentTargetEnd: string | null;
  readonly phaseProposedStart: string | null;
  readonly phaseProposedTargetEnd: string | null;
  readonly requestedTaskStart: string | null;
  readonly requestedTaskDue: string | null;
}

/** Bounded tool result union. */
export type McpTaskPlanToolResult =
  | { readonly ok: true; readonly payload: McpTaskPlanToolPayload }
  | {
    readonly ok: false;
    readonly category: "phase_window_extension_required";
    readonly details: McpTaskPlanToolPhaseWindowDetails;
  }
  | { readonly ok: false; readonly category: McpTaskPlanToolErrorCategory };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpTaskPlanToolExecutor = (
  args: McpTaskPlanToolArguments,
) => Promise<McpTaskPlanToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpTaskPlanToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1PlanTaskExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpTaskPlanToolErrorCategory {
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
): McpTaskPlanToolErrorCategory {
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
  result: ApiV1PlanTaskSuccessResult,
): McpTaskPlanToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    taskId: result.taskId,
    projectId: result.projectId,
    phaseId: result.phaseId,
    startDate: result.startDate,
    dueDate: result.dueDate,
    updatedAt: result.updatedAt,
    phaseExtended: result.phaseExtended,
    phaseStartDate: result.phaseStartDate,
    phaseTargetEndDate: result.phaseTargetEndDate,
  });
}

function toBoundedPhaseWindowDetails(
  result: ApiV1PlanTaskConfirmationRequiredResult,
): McpTaskPlanToolPhaseWindowDetails {
  return Object.freeze({
    taskId: result.taskId,
    projectId: result.projectId,
    phaseId: result.phaseId,
    phaseCurrentStart: result.phaseCurrentStart,
    phaseCurrentTargetEnd: result.phaseCurrentTargetEnd,
    phaseProposedStart: result.phaseProposedStart,
    phaseProposedTargetEnd: result.phaseProposedTargetEnd,
    requestedTaskStart: result.requestedTaskStart,
    requestedTaskDue: result.requestedTaskDue,
  });
}

/**
 * Creates the per-request `tasks.plan` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. ordinary MCP confirmation is required (before rate limiting and writer);
 *   3. the Task identity is validated through the canonical path parser;
 *   4. the canonical business-only planning object is built;
 *   5. it is validated through `parseApiV1PlanTaskBody`;
 *   6. the canonical planning idempotency payload is built;
 *   7. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash);
 *   8. the canonical rate-limit profile is resolved;
 *   9. the canonical atomic rate limit is consumed;
 *  10. the accepted caller-bound writer is invoked exactly once.
 */
export function createMcpTaskPlanToolExecutor(
  dependencies: McpTaskPlanToolDependencies,
): McpTaskPlanToolExecutor {
  return async function executeTaskPlan(
    args: McpTaskPlanToolArguments,
  ): Promise<McpTaskPlanToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_TASK_PLAN_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Ordinary MCP mutation confirmation, before any rate-limit
      // resolution, hashing or writer execution. This control NEVER implies
      // Phase-window extension approval.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical Task identity.
      const { taskId: canonicalTaskId } = parseApiV1TaskPlanningPath(
        `${PLANNING_PATH_PREFIX}${parsedArgs.taskId}${PLANNING_PATH_SUFFIX}`,
      );

      // 4. Business-only object. The ordinary confirmation control is excluded;
      // `confirmParentExtension` is canonical business input forwarded exactly
      // as supplied and is never promoted, defaulted or derived.
      const businessInput: Record<string, unknown> = {
        // Caller concurrency precondition, forwarded unchanged.
        expectedUpdatedAt: parsedArgs.expectedUpdatedAt,
        startDate: parsedArgs.startDate,
        dueDate: parsedArgs.dueDate,
        confirmParentExtension: parsedArgs.confirmParentExtension,
      };

      // 5. Canonical business validation.
      const canonicalBody = parseApiV1PlanTaskBody(businessInput);

      // 6. Canonical planning idempotency payload (Task identity + canonical
      // business body, including `confirmParentExtension`).
      const canonicalIdempotencyPayload = buildApiV1PlanTaskIdempotencyPayload(
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
        TASK_PLANNING_ROUTE.id,
      );

      // 9. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: TASK_PLANNING_ROUTE.id,
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

      if (result.outcome === "confirmation_required") {
        // Distinct from the ordinary MCP confirmation control: no mutation and
        // no Phase extension has occurred. Only the approved bounded impact
        // detail is disclosed so a later intentional call can obtain explicit
        // Phase-window approval with a NEW idempotency key.
        return Object.freeze({
          ok: false as const,
          category: "phase_window_extension_required" as const,
          details: toBoundedPhaseWindowDetails(result),
        });
      }

      if (result.outcome === "conflict") {
        // Bounded stale-planning conflict: never retried, never refreshed, and
        // no current database timestamp is disclosed.
        return Object.freeze({
          ok: false as const,
          category: "stale_task_planning",
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
