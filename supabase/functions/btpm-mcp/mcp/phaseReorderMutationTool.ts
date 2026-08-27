// API-Q Phase Reorder Step 3 — Phase-reorder MCP mutation-control composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `phases.reorder`. It composes only already accepted
// components:
//
//   - literal confirmation control          : `requireMcpMutationConfirmation`
//   - canonical Project identity validation : `parseApiV1PhaseReorderPath`
//   - canonical business validation         : `parseApiV1ReorderPhasesBody`
//   - canonical idempotency + payload hash  : `buildMcpMutationExecutionContext`
//     over `buildApiV1ReorderPhasesIdempotencyPayload(projectId, body)`
//   - canonical rate limiting               : `enforceApiRateLimit`
//   - caller-bound writer                   : `McpV1ReorderPhasesExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, no Tenant/Organization/Workspace/Project scope
// derivation, no Connected App check, no encryption, persists nothing, logs
// nothing, starts no timer, performs no retry, performs no read-before-write
// and registers no MCP tool. No generic operation dispatcher exists here.
//
// Sibling-set completeness, duplicate Phase identity, duplicate/contiguous sort
// positions, Project membership and stale-row semantics remain exclusively
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
  buildApiV1ReorderPhasesIdempotencyPayload,
  parseApiV1PhaseReorderPath,
  parseApiV1ReorderPhasesBody,
  PHASE_REORDER_ROUTE,
} from "../../_shared/btpm-api/routes/phases.ts";
import type { ApiV1ReorderPhasesSuccessResult } from "../../_shared/btpm-api/supabasePhase.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1ReorderPhasesExecutor } from "./phaseReorderMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `phases.reorder`. */
export const MCP_PHASE_REORDER_TOOL_NAME = "btpm_reorder_phases";

/** Canonical Phase reorder path prefix/suffix; the accepted parser validates. */
const REORDER_PATH_PREFIX = "/v1/projects/";
const REORDER_PATH_SUFFIX = "/phases/reorder";

/**
 * Strict MCP row envelope guard. Transport shape only: UUID form, timestamp
 * form, sort-order bounds, uniqueness, contiguity, sibling completeness and
 * membership remain canonical.
 */
export const MCP_PHASE_REORDER_TOOL_ROW_SCHEMA = z.strictObject({
  phaseId: z.string(),
  expectedUpdatedAt: z.string(),
  sortOrder: z.number(),
});

/**
 * Strict MCP transport guard. It is presentation only. No Tenant,
 * Organization, Workspace, actor, source channel, API-client, provenance,
 * request ID, correlation ID or payload hash is accepted from the caller.
 */
export const MCP_PHASE_REORDER_TOOL_INPUT_SCHEMA = z.strictObject({
  projectId: z.string(),
  rows: z.array(MCP_PHASE_REORDER_TOOL_ROW_SCHEMA),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact four approved MCP argument names, in canonical order. */
export const MCP_PHASE_REORDER_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "projectId",
    "rows",
    "confirmation",
    "idempotencyKey",
  ]);

/** The exact three approved MCP row field names, in canonical order. */
export const MCP_PHASE_REORDER_TOOL_ROW_FIELD_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "phaseId",
    "expectedUpdatedAt",
    "sortOrder",
  ]);

/** Already schema-validated (untrusted) MCP row argument. */
export interface McpPhaseReorderToolRowArgument {
  readonly phaseId: string;
  readonly expectedUpdatedAt: string;
  readonly sortOrder: number;
}

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpPhaseReorderToolArguments {
  readonly projectId: string;
  readonly rows: readonly McpPhaseReorderToolRowArgument[];
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpPhaseReorderToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "stale_phase_order"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_PHASE_REORDER_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpPhaseReorderToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to reorder Phases for this Project.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  stale_phase_order:
    "One or more Phases changed since the supplied expectedUpdatedAt values. Read the current Project planning and retry intentionally with current updatedAt values and a new idempotency key.",
  unavailable: "BTPM Phase reorder is temporarily unavailable.",
});

/** Bounded ordered-Phase element. No Phase narrative is returned. */
export interface McpPhaseReorderToolOrderedPhase {
  readonly phaseId: string;
  readonly sortOrder: number;
  readonly updatedAt: string;
}

/** Bounded successful tool payload. */
export interface McpPhaseReorderToolPayload {
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly projectId: string;
  readonly submittedCount: number;
  readonly changedCount: number;
  readonly orderedPhases: readonly McpPhaseReorderToolOrderedPhase[];
}

/** Bounded tool result union. */
export type McpPhaseReorderToolResult =
  | { readonly ok: true; readonly payload: McpPhaseReorderToolPayload }
  | { readonly ok: false; readonly category: McpPhaseReorderToolErrorCategory };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpPhaseReorderToolExecutor = (
  args: McpPhaseReorderToolArguments,
) => Promise<McpPhaseReorderToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpPhaseReorderToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1ReorderPhasesExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpPhaseReorderToolErrorCategory {
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
): McpPhaseReorderToolErrorCategory {
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
  result: ApiV1ReorderPhasesSuccessResult,
): McpPhaseReorderToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    projectId: result.projectId,
    submittedCount: result.submittedCount,
    changedCount: result.changedCount,
    orderedPhases: Object.freeze(
      result.orderedPhases.map((phase) =>
        Object.freeze({
          phaseId: phase.phaseId,
          sortOrder: phase.sortOrder,
          updatedAt: phase.updatedAt,
        })
      ),
    ),
  });
}

/**
 * Creates the per-request `phases.reorder` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. literal confirmation is required (before rate limiting and writer);
 *   3. the Project identity is validated through the canonical path parser;
 *   4. the canonical reorder business body is built from `rows` only;
 *   5. it is validated through `parseApiV1ReorderPhasesBody`;
 *   6. the canonical reorder idempotency payload (projectId + complete rows)
 *      is built;
 *   7. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash);
 *   8. the canonical rate-limit profile is resolved;
 *   9. the canonical atomic rate limit is consumed;
 *  10. the accepted caller-bound writer is invoked exactly once.
 */
export function createMcpPhaseReorderToolExecutor(
  dependencies: McpPhaseReorderToolDependencies,
): McpPhaseReorderToolExecutor {
  return async function executePhaseReorder(
    args: McpPhaseReorderToolArguments,
  ): Promise<McpPhaseReorderToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_PHASE_REORDER_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before any rate-limit resolution or writer.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical Project identity.
      const { projectId: canonicalProjectId } = parseApiV1PhaseReorderPath(
        `${REORDER_PATH_PREFIX}${parsedArgs.projectId}${REORDER_PATH_SUFFIX}`,
      );

      // 4. Business object from `rows` only (no control field).
      const businessInput: Record<string, unknown> = {
        rows: parsedArgs.rows.map((row) => ({
          phaseId: row.phaseId,
          // Caller concurrency precondition, forwarded unchanged.
          expectedUpdatedAt: row.expectedUpdatedAt,
          sortOrder: row.sortOrder,
        })),
      };

      // 5. Canonical business validation.
      const canonicalBody = parseApiV1ReorderPhasesBody(businessInput);

      // 6. Canonical reorder idempotency payload (Project identity + the
      // complete canonical rows collection).
      const canonicalIdempotencyPayload =
        buildApiV1ReorderPhasesIdempotencyPayload(
          canonicalProjectId,
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
        PHASE_REORDER_ROUTE.id,
      );

      // 9. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PHASE_REORDER_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 10. Accepted caller-bound writer, invoked exactly once. The caller's
      // concurrency preconditions are forwarded unchanged.
      const result = await dependencies.writer(
        dependencies.request,
        canonicalProjectId,
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
          category: "stale_phase_order",
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
