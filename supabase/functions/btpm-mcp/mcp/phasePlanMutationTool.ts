// API-Q Phase Plan Step 3 — Phase-planning MCP mutation-control composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `phases.plan`. It composes only already accepted
// components:
//
//   - ordinary MCP confirmation control     : `requireMcpMutationConfirmation`
//   - canonical Phase identity validation   : `parseApiV1PhasePlanningPath`
//   - canonical business validation         : `parseApiV1PlanPhaseBody`
//   - canonical idempotency + payload hash  : `buildMcpMutationExecutionContext`
//     over `buildApiV1PlanPhaseIdempotencyPayload(phaseId, body)`
//   - canonical rate limiting               : `enforceApiRateLimit`
//   - caller-bound writer                   : `McpV1PlanPhaseExecutor`
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
//   - `confirmParentExtension` — canonical Phase Plan BUSINESS input, meaning
//     the user explicitly authorizes extending the parent Project planning
//     window. It is forwarded exactly as supplied and participates in the
//     canonical hashed payload.
//
// `confirmation === true` NEVER implies `confirmParentExtension === true`.
// Neither field is ever derived from, promoted by or defaulted from the other.
// A retry after explicit Project-window approval changes the canonical business
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
  buildApiV1PlanPhaseIdempotencyPayload,
  parseApiV1PhasePlanningPath,
  parseApiV1PlanPhaseBody,
  PHASE_PLANNING_ROUTE,
} from "../../_shared/btpm-api/routes/phases.ts";
import type {
  ApiV1PlanPhaseConfirmationRequiredResult,
  ApiV1PlanPhaseSuccessResult,
} from "../../_shared/btpm-api/supabasePhase.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1PlanPhaseExecutor } from "./phasePlanMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `phases.plan`. */
export const MCP_PHASE_PLAN_TOOL_NAME = "btpm_plan_phase";

/** Canonical Phase planning path prefix/suffix; the accepted parser validates. */
const PLANNING_PATH_PREFIX = "/v1/phases/";
const PLANNING_PATH_SUFFIX = "/planning";

/**
 * Strict MCP transport guard. It is presentation only. No Tenant,
 * Organization, Workspace, Project, actor, source channel, API-client, OAuth
 * client, provenance, request ID, correlation ID, payload hash, rate-limit
 * profile, operation name or function name is accepted from the caller.
 */
export const MCP_PHASE_PLAN_TOOL_INPUT_SCHEMA = z.strictObject({
  phaseId: z.string(),
  expectedUpdatedAt: z.string(),
  startDate: z.string().nullable(),
  targetEndDate: z.string().nullable(),
  confirmParentExtension: z.boolean(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact seven approved MCP argument names, in canonical order. */
export const MCP_PHASE_PLAN_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "phaseId",
    "expectedUpdatedAt",
    "startDate",
    "targetEndDate",
    "confirmParentExtension",
    "confirmation",
    "idempotencyKey",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpPhasePlanToolArguments {
  readonly phaseId: string;
  readonly expectedUpdatedAt: string;
  readonly startDate: string | null;
  readonly targetEndDate: string | null;
  readonly confirmParentExtension: boolean;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpPhasePlanToolErrorCategory =
  | "confirmation_required"
  | "project_window_extension_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "stale_phase_planning"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_PHASE_PLAN_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpPhasePlanToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  project_window_extension_required:
    "The requested Phase dates require extending the parent Project planning window. Explicitly confirm that Project-window extension before retrying with confirmParentExtension=true and a new idempotency key.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to plan this Phase.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  stale_phase_planning:
    "The Phase changed since the supplied expectedUpdatedAt value. Read the current Phase or Project planning and retry intentionally with the current updatedAt and a new idempotency key.",
  unavailable: "BTPM Phase planning is temporarily unavailable.",
});

/** Bounded successful tool payload. No Phase narrative is returned. */
export interface McpPhasePlanToolPayload {
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly phaseId: string;
  readonly projectId: string;
  readonly startDate: string | null;
  readonly targetEndDate: string | null;
  readonly updatedAt: string;
  readonly projectExtended: boolean;
  readonly projectStartDate: string | null;
  readonly projectTargetEndDate: string | null;
}

/**
 * Bounded Project-window impact detail. Exactly the seven approved fields from
 * the already accepted canonical writer result. No other database information
 * is exposed.
 */
export interface McpPhasePlanToolProjectWindowDetails {
  readonly projectId: string;
  readonly projectCurrentStart: string | null;
  readonly projectCurrentTargetEnd: string | null;
  readonly projectProposedStart: string | null;
  readonly projectProposedTargetEnd: string | null;
  readonly requestedPhaseStart: string | null;
  readonly requestedPhaseEnd: string | null;
}

/** Bounded tool result union. */
export type McpPhasePlanToolResult =
  | { readonly ok: true; readonly payload: McpPhasePlanToolPayload }
  | {
    readonly ok: false;
    readonly category: "project_window_extension_required";
    readonly details: McpPhasePlanToolProjectWindowDetails;
  }
  | { readonly ok: false; readonly category: McpPhasePlanToolErrorCategory };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpPhasePlanToolExecutor = (
  args: McpPhasePlanToolArguments,
) => Promise<McpPhasePlanToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpPhasePlanToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1PlanPhaseExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpPhasePlanToolErrorCategory {
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
): McpPhasePlanToolErrorCategory {
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
  result: ApiV1PlanPhaseSuccessResult,
): McpPhasePlanToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    phaseId: result.phaseId,
    projectId: result.projectId,
    startDate: result.startDate,
    targetEndDate: result.targetEndDate,
    updatedAt: result.updatedAt,
    projectExtended: result.projectExtended,
    projectStartDate: result.projectStartDate,
    projectTargetEndDate: result.projectTargetEndDate,
  });
}

function toBoundedProjectWindowDetails(
  result: ApiV1PlanPhaseConfirmationRequiredResult,
): McpPhasePlanToolProjectWindowDetails {
  return Object.freeze({
    projectId: result.projectId,
    projectCurrentStart: result.projectCurrentStart,
    projectCurrentTargetEnd: result.projectCurrentTargetEnd,
    projectProposedStart: result.projectProposedStart,
    projectProposedTargetEnd: result.projectProposedTargetEnd,
    requestedPhaseStart: result.requestedPhaseStart,
    requestedPhaseEnd: result.requestedPhaseEnd,
  });
}

/**
 * Creates the per-request `phases.plan` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. ordinary MCP confirmation is required (before rate limiting and writer);
 *   3. the Phase identity is validated through the canonical path parser;
 *   4. the canonical business-only planning object is built;
 *   5. it is validated through `parseApiV1PlanPhaseBody`;
 *   6. the canonical planning idempotency payload is built;
 *   7. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash);
 *   8. the canonical rate-limit profile is resolved;
 *   9. the canonical atomic rate limit is consumed;
 *  10. the accepted caller-bound writer is invoked exactly once.
 */
export function createMcpPhasePlanToolExecutor(
  dependencies: McpPhasePlanToolDependencies,
): McpPhasePlanToolExecutor {
  return async function executePhasePlan(
    args: McpPhasePlanToolArguments,
  ): Promise<McpPhasePlanToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_PHASE_PLAN_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Ordinary MCP mutation confirmation, before any rate-limit
      // resolution, hashing or writer execution. This control NEVER implies
      // Project-window extension approval.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical Phase identity.
      const { phaseId: canonicalPhaseId } = parseApiV1PhasePlanningPath(
        `${PLANNING_PATH_PREFIX}${parsedArgs.phaseId}${PLANNING_PATH_SUFFIX}`,
      );

      // 4. Business-only object. The ordinary confirmation control is excluded;
      // `confirmParentExtension` is canonical business input forwarded exactly
      // as supplied and is never promoted, defaulted or derived.
      const businessInput: Record<string, unknown> = {
        // Caller concurrency precondition, forwarded unchanged.
        expectedUpdatedAt: parsedArgs.expectedUpdatedAt,
        startDate: parsedArgs.startDate,
        targetEndDate: parsedArgs.targetEndDate,
        confirmParentExtension: parsedArgs.confirmParentExtension,
      };

      // 5. Canonical business validation.
      const canonicalBody = parseApiV1PlanPhaseBody(businessInput);

      // 6. Canonical planning idempotency payload (Phase identity + canonical
      // business body, including `confirmParentExtension`).
      const canonicalIdempotencyPayload = buildApiV1PlanPhaseIdempotencyPayload(
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
        PHASE_PLANNING_ROUTE.id,
      );

      // 9. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PHASE_PLANNING_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 10. Accepted caller-bound writer, invoked exactly once. No retry.
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

      if (result.outcome === "confirmation_required") {
        // Distinct from the ordinary MCP confirmation control: no mutation and
        // no Project extension has occurred. Only the approved bounded impact
        // detail is disclosed so a later intentional call can obtain explicit
        // Project-window approval with a NEW idempotency key.
        return Object.freeze({
          ok: false as const,
          category: "project_window_extension_required" as const,
          details: toBoundedProjectWindowDetails(result),
        });
      }

      if (result.outcome === "conflict") {
        // Bounded stale-planning conflict: never retried, never refreshed, and
        // no current database timestamp is disclosed.
        return Object.freeze({
          ok: false as const,
          category: "stale_phase_planning",
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
