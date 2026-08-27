// API-Q Phase Create Step 3 — Phase-create MCP mutation tool control layer.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `phases.create`. It composes only already accepted
// components:
//
//   - literal confirmation control        : `requireMcpMutationConfirmation`
//   - canonical business validation       : `parseApiV1CreatePhaseBody`
//   - canonical idempotency + payload hash: `buildMcpMutationExecutionContext`
//   - canonical rate limiting             : `enforceApiRateLimit`
//   - caller-bound writer                 : `McpV1CreatePhaseExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, no Tenant/Organization/Workspace derivation, no
// encryption, persists nothing, logs nothing and registers no MCP tool. No
// generic operation dispatcher exists here. Phase update, reorder and planning
// are out of scope for this module, and the Project planning window is never
// mutated here.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  type ApiV1PhaseStatus,
  type ApiV1PhaseType,
  parseApiV1CreatePhaseBody,
  PHASE_CREATE_ROUTE,
} from "../../_shared/btpm-api/routes/phases.ts";
import type { ApiV1CreatePhaseSuccessResult } from "../../_shared/btpm-api/supabasePhase.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1CreatePhaseExecutor } from "./phaseCreateMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `phases.create`. */
export const MCP_PHASE_CREATE_TOOL_NAME = "btpm_create_phase";

/**
 * Strict MCP transport guard. It is presentation only: canonical validation
 * remains authoritative for every business rule (UUID form, text
 * canonicalization, date validity and ranges, sort-order bounds and all
 * optional-field defaults).
 */
export const MCP_PHASE_CREATE_TOOL_INPUT_SCHEMA = z.strictObject({
  projectId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  status: z
    .enum(["planned", "active", "completed", "on_hold", "cancelled"])
    .optional(),
  phaseType: z
    .enum(["work_item", "milestone", "deliverable", "decision", "review"])
    .optional(),
  startDate: z.string().nullable().optional().describe(
    "Planned Phase start date as ISO YYYY-MM-DD. Optional for a non-baselined Project; required together with targetEndDate when the Project is baselined.",
  ),
  targetEndDate: z.string().nullable().optional().describe(
    "Planned Phase target end date as ISO YYYY-MM-DD. Optional for a non-baselined Project; required together with startDate when the Project is baselined.",
  ),
  sortOrder: z.number().nullable().optional(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact ten approved MCP argument names. */
export const MCP_PHASE_CREATE_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "projectId",
    "name",
    "description",
    "status",
    "phaseType",
    "startDate",
    "targetEndDate",
    "sortOrder",
    "confirmation",
    "idempotencyKey",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpPhaseCreateToolArguments {
  readonly projectId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly status?: ApiV1PhaseStatus;
  readonly phaseType?: ApiV1PhaseType;
  readonly startDate?: string | null;
  readonly targetEndDate?: string | null;
  readonly sortOrder?: number | null;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/**
 * Bounded failure categories this tool may disclose.
 *
 * `project_window_extension_required` is deliberately distinct from
 * `confirmation_required`: the MCP literal confirmation gate and the canonical
 * Project planning-window constraint are different controls.
 */
export type McpPhaseCreateToolErrorCategory =
  | "confirmation_required"
  | "project_window_extension_required"
  | "phase_dates_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_PHASE_CREATE_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpPhaseCreateToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  project_window_extension_required:
    "Phase dates fall outside the Project planning window. Extend the Project planning window, then retry with a new idempotency key.",
  phase_dates_required:
    "Start Date and Target End Date are required when creating a Phase in a baselined Project. Read the parent Project planning window, determine valid Phase dates from the user's instruction or context, and retry with a new idempotency key.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to create this Phase.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  unavailable: "BTPM Phase creation is temporarily unavailable.",
});

/** Bounded successful tool payload. No Phase narrative is returned. */
export interface McpPhaseCreateToolPayload {
  readonly outcome: "applied" | "replayed";
  readonly phaseId: string;
  readonly projectId: string;
  readonly status: ApiV1PhaseStatus;
  readonly phaseType: ApiV1PhaseType;
  readonly startDate: string | null;
  readonly targetEndDate: string | null;
  readonly sortOrder: number;
  readonly isArchived: boolean | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly shiftedSiblingCount: number | null;
}

/** Bounded tool result union. */
export type McpPhaseCreateToolResult =
  | { readonly ok: true; readonly payload: McpPhaseCreateToolPayload }
  | {
    readonly ok: false;
    readonly category: McpPhaseCreateToolErrorCategory;
  };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpPhaseCreateToolExecutor = (
  args: McpPhaseCreateToolArguments,
) => Promise<McpPhaseCreateToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpPhaseCreateToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1CreatePhaseExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpPhaseCreateToolErrorCategory {
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
): McpPhaseCreateToolErrorCategory {
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
  result: ApiV1CreatePhaseSuccessResult,
): McpPhaseCreateToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    phaseId: result.phaseId,
    projectId: result.projectId,
    status: result.status,
    phaseType: result.phaseType,
    startDate: result.startDate,
    targetEndDate: result.targetEndDate,
    sortOrder: result.sortOrder,
    isArchived: result.isArchived,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
    shiftedSiblingCount: result.shiftedSiblingCount,
  });
}

/**
 * Creates the per-request `phases.create` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. literal confirmation is required;
 *   3. a business-only object is built (no confirmation, no idempotency key,
 *      no identity, scope or provenance field);
 *   4. it is validated through `parseApiV1CreatePhaseBody`, which alone owns
 *      canonical validation and defaults;
 *   5. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash over the canonical
 *      body only);
 *   6. the canonical rate-limit profile is resolved for `phases.create`;
 *   7. the canonical atomic rate limit is consumed;
 *   8. the accepted caller-bound writer is invoked exactly once, with no retry.
 *
 * The canonical `confirmation_required` / `extend_project_window_required`
 * writer result is NOT a successful mutation and is NOT the ordinary MCP
 * confirmation category: it maps to `project_window_extension_required`. No
 * Project planning mutation, no date rewrite and no retry happens here; the
 * database persists that safe result under idempotency, so an intentional
 * retry requires a new idempotency key.
 */
export function createMcpPhaseCreateToolExecutor(
  dependencies: McpPhaseCreateToolDependencies,
): McpPhaseCreateToolExecutor {
  return async function executePhaseCreate(
    args: McpPhaseCreateToolArguments,
  ): Promise<McpPhaseCreateToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_PHASE_CREATE_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before any rate-limit consumption or writer.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Business-only object.
      const businessInput: Record<string, unknown> = {
        projectId: parsedArgs.projectId,
        name: parsedArgs.name,
      };
      if (parsedArgs.description !== undefined) {
        businessInput.description = parsedArgs.description;
      }
      if (parsedArgs.status !== undefined) {
        businessInput.status = parsedArgs.status;
      }
      if (parsedArgs.phaseType !== undefined) {
        businessInput.phaseType = parsedArgs.phaseType;
      }
      if (parsedArgs.startDate !== undefined) {
        businessInput.startDate = parsedArgs.startDate;
      }
      if (parsedArgs.targetEndDate !== undefined) {
        businessInput.targetEndDate = parsedArgs.targetEndDate;
      }
      if (parsedArgs.sortOrder !== undefined) {
        businessInput.sortOrder = parsedArgs.sortOrder;
      }

      // 4. Canonical business validation and defaulting.
      const canonicalBody = parseApiV1CreatePhaseBody(businessInput);

      // 5. Canonical mutation execution context (idempotency + payload hash).
      const mutationContext = await buildMcpMutationExecutionContext(
        dependencies.execution,
        parsedArgs.idempotencyKey,
        canonicalBody,
      );

      // 6. Canonical rate-limit profile.
      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        PHASE_CREATE_ROUTE.id,
      );

      // 7. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PHASE_CREATE_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 8. Accepted caller-bound writer, exactly once.
      const result = await dependencies.writer(
        dependencies.request,
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
        return Object.freeze({
          ok: false as const,
          category: "project_window_extension_required" as const,
        });
      }

      // PCC-1 — the bounded baselined-Project Phase-date precondition is
      // mapped before generic invalid mapping.
      if (
        result.outcome === "invalid" &&
        "code" in result &&
        result.code === "phase_dates_required"
      ) {
        return Object.freeze({
          ok: false as const,
          category: "phase_dates_required" as const,
        });
      }

      return Object.freeze({
        ok: false as const,
        category: mapNegativeOutcome(result.outcome),
      });
    } catch (error) {
      // Only a bounded category escapes: no SQLSTATE, database message, stack,
      // policy reason, token, identity or internal function name.
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
