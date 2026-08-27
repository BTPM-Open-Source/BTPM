// KPI-4C — Project KPI definition create MCP mutation tool control composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `kpis.create`. It composes only already accepted
// components:
//
//   - literal confirmation control        : `requireMcpMutationConfirmation`
//   - canonical path authority            : `parseApiV1ProjectKpisPath`
//   - canonical business validation       : `parseApiV1CreateKpiBody`
//   - canonical idempotency payload       : `buildApiV1CreateKpiIdempotencyPayload`
//   - canonical idempotency + payload hash: `buildMcpMutationExecutionContext`
//   - canonical rate limiting             : `enforceApiRateLimit`
//   - caller-bound writer                 : `McpV1CreateKpiExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, persists nothing, logs nothing and registers no
// MCP tool. No generic operation dispatcher exists here. No second KPI business
// contract is introduced: KPI update, KPI history and KPI reads are out of
// scope for this module.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  API_V1_KPI_CADENCES,
  API_V1_KPI_COMPLETION_METHODS,
  API_V1_KPI_SOURCE_MODES,
  API_V1_KPI_TARGET_DIRECTIONS,
  API_V1_KPI_VALUE_TYPES,
  type ApiV1KpiCadence,
  type ApiV1KpiCompletionMethod,
  type ApiV1KpiSourceMode,
  type ApiV1KpiTargetDirection,
  type ApiV1KpiValueType,
  buildApiV1CreateKpiIdempotencyPayload,
  KPI_CREATE_ROUTE,
  parseApiV1CreateKpiBody,
  parseApiV1ProjectKpisPath,
} from "../../_shared/btpm-api/routes/kpis.ts";
import { buildClosedVocabularySchema } from "./closedVocabularySchema.ts";
import type { ApiV1CreateKpiSuccessResult } from "../../_shared/btpm-api/supabaseKpiMutation.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1CreateKpiExecutor } from "./kpiCreateMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `kpis.create`. */
export const MCP_KPI_CREATE_TOOL_NAME = "btpm_create_kpi";

/**
 * MCP-HARDENING-C6 — presentation-only canonical blank sentinel.
 *
 * The canonical create parser treats an omitted property, explicit `null`, an
 * empty string and an ordinary-U+0020-space-only string identically as "use the
 * canonical default" for the four defaulted enum fields. This schema advertises
 * exactly that sentinel branch (ordinary spaces only — never arbitrary Unicode
 * whitespace, matching PostgreSQL `btrim(text)` semantics). It contains no
 * vocabulary and no default.
 */
const KPI_CREATE_ORDINARY_BLANK_SENTINEL_SCHEMA = z.string().regex(/^ *$/);

/** Closed canonical enum branches, derived from the canonical API authorities. */
export const MCP_KPI_CREATE_TARGET_DIRECTION_SCHEMA = buildClosedVocabularySchema<
  ApiV1KpiTargetDirection
>(API_V1_KPI_TARGET_DIRECTIONS);
export const MCP_KPI_CREATE_SOURCE_MODE_SCHEMA = buildClosedVocabularySchema<
  ApiV1KpiSourceMode
>(API_V1_KPI_SOURCE_MODES);
export const MCP_KPI_CREATE_VALUE_TYPE_SCHEMA = buildClosedVocabularySchema<
  ApiV1KpiValueType
>(API_V1_KPI_VALUE_TYPES);
export const MCP_KPI_CREATE_CADENCE_SCHEMA = buildClosedVocabularySchema<
  ApiV1KpiCadence
>(API_V1_KPI_CADENCES);
export const MCP_KPI_CREATE_COMPLETION_METHOD_SCHEMA =
  buildClosedVocabularySchema<ApiV1KpiCompletionMethod>(
    API_V1_KPI_COMPLETION_METHODS,
  );

/**
 * Strict MCP transport guard. It establishes primitive shapes, the exact
 * seventeen-key envelope and — for the five canonical KPI vocabularies — the
 * closed enum branch each field accepts. All KPI business semantics (canonical
 * defaulting, blank handling, integer semantics and canonical text handling)
 * remain owned exclusively by `parseApiV1CreateKpiBody`.
 */
export const MCP_KPI_CREATE_TOOL_INPUT_SCHEMA = z.strictObject({
  projectId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  targetValue: z.number().nullable().optional(),
  targetDirection: z.union([
    MCP_KPI_CREATE_TARGET_DIRECTION_SCHEMA,
    KPI_CREATE_ORDINARY_BLANK_SENTINEL_SCHEMA,
  ]).nullable().optional(),
  sourceMode: z.union([
    MCP_KPI_CREATE_SOURCE_MODE_SCHEMA,
    KPI_CREATE_ORDINARY_BLANK_SENTINEL_SCHEMA,
  ]).nullable().optional(),
  valueType: z.union([
    MCP_KPI_CREATE_VALUE_TYPE_SCHEMA,
    KPI_CREATE_ORDINARY_BLANK_SENTINEL_SCHEMA,
  ]).nullable().optional(),
  cadence: z.union([
    MCP_KPI_CREATE_CADENCE_SCHEMA,
    KPI_CREATE_ORDINARY_BLANK_SENTINEL_SCHEMA,
  ]).nullable().optional(),
  calculationKey: z.string().nullable().optional(),
  formulaVersion: z.number().nullable().optional(),
  completionMethod: MCP_KPI_CREATE_COMPLETION_METHOD_SCHEMA.nullable()
    .optional(),
  commentRequired: z.boolean().nullable().optional(),
  actionPlanRequired: z.boolean().nullable().optional(),
  autoSnapshotEnabled: z.boolean().nullable().optional(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact seventeen approved MCP argument names. */
export const MCP_KPI_CREATE_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> = Object
  .freeze([
    "projectId",
    "name",
    "description",
    "unit",
    "targetValue",
    "targetDirection",
    "sourceMode",
    "valueType",
    "cadence",
    "calculationKey",
    "formulaVersion",
    "completionMethod",
    "commentRequired",
    "actionPlanRequired",
    "autoSnapshotEnabled",
    "confirmation",
    "idempotencyKey",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpKpiCreateToolArguments {
  readonly projectId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly unit?: string | null;
  readonly targetValue?: number | null;
  readonly targetDirection?: string | null;
  readonly sourceMode?: string | null;
  readonly valueType?: string | null;
  readonly cadence?: string | null;
  readonly calculationKey?: string | null;
  readonly formulaVersion?: number | null;
  readonly completionMethod?: ApiV1KpiCompletionMethod | null;
  readonly commentRequired?: boolean | null;
  readonly actionPlanRequired?: boolean | null;
  readonly autoSnapshotEnabled?: boolean | null;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpKpiCreateToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_KPI_CREATE_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpKpiCreateToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to create this KPI.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  unavailable: "BTPM KPI creation is temporarily unavailable.",
});

/** Bounded successful tool payload. No KPI narrative is returned. */
export interface McpKpiCreateToolPayload {
  readonly outcome: "applied" | "replayed";
  readonly kpiId: string;
  readonly projectId: string;
}

/** Bounded tool result union. */
export type McpKpiCreateToolResult =
  | { readonly ok: true; readonly payload: McpKpiCreateToolPayload }
  | { readonly ok: false; readonly category: McpKpiCreateToolErrorCategory };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpKpiCreateToolExecutor = (
  args: McpKpiCreateToolArguments,
) => Promise<McpKpiCreateToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpKpiCreateToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1CreateKpiExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpKpiCreateToolErrorCategory {
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
): McpKpiCreateToolErrorCategory {
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
  result: ApiV1CreateKpiSuccessResult,
): McpKpiCreateToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    kpiId: result.kpiId,
    projectId: result.projectId,
  });
}

/**
 * Creates the per-request `kpis.create` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. literal confirmation is required;
 *   3. the Project identity is validated through the single canonical
 *      Project-KPI path authority;
 *   4. a business-only object is built (no confirmation, no idempotency key,
 *      no identity, scope or provenance field) and validated through
 *      `parseApiV1CreateKpiBody`, which alone owns canonical defaults;
 *   5. the canonical mutation execution context is built over the canonical
 *      REST idempotency payload (Project identity + canonical body only);
 *   6. the canonical rate-limit profile is resolved;
 *   7. the canonical atomic rate limit is consumed;
 *   8. the accepted caller-bound writer is invoked.
 */
export function createMcpKpiCreateToolExecutor(
  dependencies: McpKpiCreateToolDependencies,
): McpKpiCreateToolExecutor {
  return async function executeKpiCreate(
    args: McpKpiCreateToolArguments,
  ): Promise<McpKpiCreateToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_KPI_CREATE_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before any rate-limit consumption or writer.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical Project identity (single accepted path authority).
      const { projectId } = parseApiV1ProjectKpisPath(
        `/v1/projects/${parsedArgs.projectId}/kpis`,
      );

      // 4. Business-only object + canonical validation and defaulting.
      const businessInput: Record<string, unknown> = {
        name: parsedArgs.name,
      };
      if (parsedArgs.description !== undefined) {
        businessInput.description = parsedArgs.description;
      }
      if (parsedArgs.unit !== undefined) {
        businessInput.unit = parsedArgs.unit;
      }
      if (parsedArgs.targetValue !== undefined) {
        businessInput.targetValue = parsedArgs.targetValue;
      }
      if (parsedArgs.targetDirection !== undefined) {
        businessInput.targetDirection = parsedArgs.targetDirection;
      }
      if (parsedArgs.sourceMode !== undefined) {
        businessInput.sourceMode = parsedArgs.sourceMode;
      }
      if (parsedArgs.valueType !== undefined) {
        businessInput.valueType = parsedArgs.valueType;
      }
      if (parsedArgs.cadence !== undefined) {
        businessInput.cadence = parsedArgs.cadence;
      }
      if (parsedArgs.calculationKey !== undefined) {
        businessInput.calculationKey = parsedArgs.calculationKey;
      }
      if (parsedArgs.formulaVersion !== undefined) {
        businessInput.formulaVersion = parsedArgs.formulaVersion;
      }
      if (parsedArgs.completionMethod !== undefined) {
        businessInput.completionMethod = parsedArgs.completionMethod;
      }
      if (parsedArgs.commentRequired !== undefined) {
        businessInput.commentRequired = parsedArgs.commentRequired;
      }
      if (parsedArgs.actionPlanRequired !== undefined) {
        businessInput.actionPlanRequired = parsedArgs.actionPlanRequired;
      }
      if (parsedArgs.autoSnapshotEnabled !== undefined) {
        businessInput.autoSnapshotEnabled = parsedArgs.autoSnapshotEnabled;
      }

      const canonicalBody = parseApiV1CreateKpiBody(businessInput);

      // 5. Canonical mutation execution context (idempotency + payload hash)
      //    over the canonical REST idempotency payload.
      const mutationContext = await buildMcpMutationExecutionContext(
        dependencies.execution,
        parsedArgs.idempotencyKey,
        buildApiV1CreateKpiIdempotencyPayload(projectId, canonicalBody),
      );

      // 6. Canonical rate-limit profile.
      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        KPI_CREATE_ROUTE.id,
      );

      // 7. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: KPI_CREATE_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 8. Accepted caller-bound writer.
      const result = await dependencies.writer(
        dependencies.request,
        projectId,
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
      // policy reason, token, identity or internal function name.
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
