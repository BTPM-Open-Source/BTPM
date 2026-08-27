// KPI-5C — Project KPI definition update MCP mutation tool control composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `kpis.update`. It composes only already accepted
// components:
//
//   - literal confirmation control        : `requireMcpMutationConfirmation`
//   - canonical KPI identity authority    : `parseApiV1KpiDetailPath`
//   - canonical business validation       : `parseApiV1UpdateKpiBody`
//   - canonical idempotency payload       : `buildApiV1UpdateKpiIdempotencyPayload`
//   - canonical idempotency + payload hash: `buildMcpMutationExecutionContext`
//   - canonical rate limiting             : `enforceApiRateLimit`
//   - caller-bound writer                 : `McpV1UpdateKpiExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, persists nothing, logs nothing, starts no timer,
// performs no retry, performs no read-before-write and registers no MCP tool.
// No generic operation dispatcher exists here. No second KPI update business
// contract is introduced.
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
  buildApiV1UpdateKpiIdempotencyPayload,
  KPI_UPDATE_ROUTE,
  parseApiV1KpiDetailPath,
  parseApiV1UpdateKpiBody,
} from "../../_shared/btpm-api/routes/kpis.ts";
import type { ApiV1UpdateKpiSuccessResult } from "../../_shared/btpm-api/supabaseKpiMutation.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1UpdateKpiExecutor } from "./kpiUpdateMutationExecutor.ts";
import { buildClosedVocabularySchema } from "./closedVocabularySchema.ts";

/** Advertised MCP tool name for the canonical `kpis.update`. */
export const MCP_KPI_UPDATE_TOOL_NAME = "btpm_update_kpi";

/**
 * MCP-HARDENING-C6 — presentation-only canonical clear sentinel for the single
 * clearable KPI enum. The canonical update parser clears `completionMethod`
 * when the present value is `null`, an empty string or an ordinary-U+0020-space
 * -only string (PostgreSQL `btrim(text)` semantics; never arbitrary Unicode
 * whitespace). This schema owns no vocabulary and no business rule.
 */
const KPI_UPDATE_ORDINARY_BLANK_SENTINEL_SCHEMA = z.string().regex(/^ *$/);

/** Closed canonical enum branches, derived from the canonical API authorities. */
export const MCP_KPI_UPDATE_TARGET_DIRECTION_SCHEMA = buildClosedVocabularySchema<
  ApiV1KpiTargetDirection
>(API_V1_KPI_TARGET_DIRECTIONS);
export const MCP_KPI_UPDATE_SOURCE_MODE_SCHEMA = buildClosedVocabularySchema<
  ApiV1KpiSourceMode
>(API_V1_KPI_SOURCE_MODES);
export const MCP_KPI_UPDATE_VALUE_TYPE_SCHEMA = buildClosedVocabularySchema<
  ApiV1KpiValueType
>(API_V1_KPI_VALUE_TYPES);
export const MCP_KPI_UPDATE_CADENCE_SCHEMA = buildClosedVocabularySchema<
  ApiV1KpiCadence
>(API_V1_KPI_CADENCES);
export const MCP_KPI_UPDATE_COMPLETION_METHOD_SCHEMA =
  buildClosedVocabularySchema<ApiV1KpiCompletionMethod>(
    API_V1_KPI_COMPLETION_METHODS,
  );

/**
 * Strict MCP transport guard. It establishes primitive shapes, the exact
 * eighteen-key envelope, the closed canonical enum branch of each KPI
 * vocabulary field, and the exact present-field nullability the canonical
 * parser accepts. All KPI business semantics — canonical blank handling,
 * clearable-versus-required field rules, integer semantics, canonical text
 * handling and the derivation of every `set*` presence flag — remain owned
 * exclusively by `parseApiV1UpdateKpiBody`.
 */
export const MCP_KPI_UPDATE_TOOL_INPUT_SCHEMA = z.strictObject({
  kpiId: z.string(),
  expectedUpdatedAt: z.string(),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  targetValue: z.number().nullable().optional(),
  targetDirection: MCP_KPI_UPDATE_TARGET_DIRECTION_SCHEMA.optional(),
  sourceMode: MCP_KPI_UPDATE_SOURCE_MODE_SCHEMA.optional(),
  valueType: MCP_KPI_UPDATE_VALUE_TYPE_SCHEMA.optional(),
  cadence: MCP_KPI_UPDATE_CADENCE_SCHEMA.optional(),
  calculationKey: z.string().nullable().optional(),
  formulaVersion: z.number().nullable().optional(),
  completionMethod: z.union([
    MCP_KPI_UPDATE_COMPLETION_METHOD_SCHEMA,
    KPI_UPDATE_ORDINARY_BLANK_SENTINEL_SCHEMA,
  ]).nullable().optional(),
  commentRequired: z.boolean().optional(),
  actionPlanRequired: z.boolean().optional(),
  autoSnapshotEnabled: z.boolean().optional(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact eighteen approved MCP argument names. */
export const MCP_KPI_UPDATE_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> = Object
  .freeze([
    "kpiId",
    "expectedUpdatedAt",
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

/** The fourteen optional mutable business fields, in canonical order. */
const MCP_KPI_UPDATE_MUTABLE_FIELD_NAMES: ReadonlyArray<string> = Object.freeze([
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
]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpKpiUpdateToolArguments {
  readonly kpiId: string;
  readonly expectedUpdatedAt: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly unit?: string | null;
  readonly targetValue?: number | null;
  readonly targetDirection?: ApiV1KpiTargetDirection;
  readonly sourceMode?: ApiV1KpiSourceMode;
  readonly valueType?: ApiV1KpiValueType;
  readonly cadence?: ApiV1KpiCadence;
  readonly calculationKey?: string | null;
  readonly formulaVersion?: number | null;
  /** Canonical value, or a `null`/ordinary-blank clear sentinel. */
  readonly completionMethod?: string | null;
  readonly commentRequired?: boolean;
  readonly actionPlanRequired?: boolean;
  readonly autoSnapshotEnabled?: boolean;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpKpiUpdateToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "stale_kpi_definition"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_KPI_UPDATE_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpKpiUpdateToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to update this KPI.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  stale_kpi_definition:
    "This KPI has changed since the supplied expectedUpdatedAt. Read the current KPI and retry intentionally with a fresh updatedAt and a new idempotency key.",
  unavailable: "BTPM KPI update is temporarily unavailable.",
});

/** Bounded successful tool payload. No KPI narrative is returned. */
export interface McpKpiUpdateToolPayload {
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly kpiId: string;
  readonly projectId: string;
  readonly updatedAt: string;
}

/** Bounded tool result union. */
export type McpKpiUpdateToolResult =
  | { readonly ok: true; readonly payload: McpKpiUpdateToolPayload }
  | { readonly ok: false; readonly category: McpKpiUpdateToolErrorCategory };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpKpiUpdateToolExecutor = (
  args: McpKpiUpdateToolArguments,
) => Promise<McpKpiUpdateToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpKpiUpdateToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1UpdateKpiExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

/** The only negative writer outcomes this control layer may translate. */
const NEGATIVE_OUTCOMES = Object.freeze([
  "invalid",
  "not_authorized",
  "idempotency_conflict",
  "idempotency_pending",
] as const);

type NegativeOutcome = typeof NEGATIVE_OUTCOMES[number];

function isNegativeOutcome(value: unknown): value is NegativeOutcome {
  return typeof value === "string" &&
    (NEGATIVE_OUTCOMES as readonly string[]).includes(value);
}

function categorize(error: unknown): McpKpiUpdateToolErrorCategory {
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
): McpKpiUpdateToolErrorCategory {
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
  result: ApiV1UpdateKpiSuccessResult,
): McpKpiUpdateToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    kpiId: result.kpiId,
    projectId: result.projectId,
    updatedAt: result.updatedAt,
  });
}

// ---------------------------------------------------------------------------
// KPI-5C-C1 — local fail-closed runtime writer-result shape guards.
//
// These are deliberately local, exact-key-set structural checks. They perform
// no retry, no read-before-write, no timestamp refresh, no database lookup and
// introduce no generic result mapper and no second KPI business contract.
// ---------------------------------------------------------------------------

/** The only permitted success outcomes. */
const SUCCESS_OUTCOMES: ReadonlyArray<string> = Object.freeze([
  "applied",
  "no_change",
  "replayed",
]);

const SUCCESS_RESULT_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "kpiId",
  "projectId",
  "updatedAt",
]);

const STALE_CONFLICT_RESULT_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "code",
]);

const NEGATIVE_RESULT_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  record: Record<string, unknown>,
  expected: ReadonlyArray<string>,
): boolean {
  const actual = Object.keys(record);
  if (actual.length !== expected.length) return false;
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return false;
  }
  return true;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isExactSuccessResult(
  value: unknown,
): value is ApiV1UpdateKpiSuccessResult {
  if (!isPlainRecord(value)) return false;
  if (!hasExactKeys(value, SUCCESS_RESULT_KEYS)) return false;
  if (value.ok !== true) return false;
  if (
    typeof value.outcome !== "string" ||
    !SUCCESS_OUTCOMES.includes(value.outcome)
  ) {
    return false;
  }
  return isNonEmptyString(value.kpiId) &&
    isNonEmptyString(value.projectId) &&
    isNonEmptyString(value.updatedAt);
}

function isExactStaleConflictResult(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  if (!hasExactKeys(value, STALE_CONFLICT_RESULT_KEYS)) return false;
  return value.ok === false && value.outcome === "conflict" &&
    value.code === "stale_kpi_definition";
}

function readExactNegativeOutcome(value: unknown): NegativeOutcome | null {
  if (!isPlainRecord(value)) return null;
  if (!hasExactKeys(value, NEGATIVE_RESULT_KEYS)) return null;
  if (value.ok !== false) return null;
  return isNegativeOutcome(value.outcome) ? value.outcome : null;
}



/**
 * Creates the per-request `kpis.update` MCP tool executor.
 *
 * Execution order (never reordered):
 *   1. strict structural MCP envelope;
 *   2. literal explicit confirmation;
 *   3. canonical KPI ID parsing through `parseApiV1KpiDetailPath`;
 *   4. raw business object preserving supplied field presence exactly
 *      (omitted versus explicit `null`), with no manufactured `set*` flag;
 *   5. canonical `parseApiV1UpdateKpiBody`, the sole business authority;
 *   6. canonical KPI-update idempotency payload;
 *   7. MCP mutation execution context (idempotency + payload hash);
 *   8. `kpis.update` rate-limit profile;
 *   9. canonical atomic rate-limit consumption;
 *  10. the accepted caller-bound writer, exactly once.
 */
export function createMcpKpiUpdateToolExecutor(
  dependencies: McpKpiUpdateToolDependencies,
): McpKpiUpdateToolExecutor {
  return async function executeKpiUpdate(
    args: McpKpiUpdateToolArguments,
  ): Promise<McpKpiUpdateToolResult> {
    try {
      // 1. Strict structural MCP argument envelope.
      const parsedArgs = MCP_KPI_UPDATE_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before any canonical parsing, idempotency
      //    context, rate-limit consumption or writer execution.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical KPI identity (single accepted path authority).
      const { kpiId } = parseApiV1KpiDetailPath(
        `/v1/kpis/${parsedArgs.kpiId}`,
      );

      // 4. Raw business object preserving supplied field presence exactly. No
      //    `set*` flag is manufactured here; `confirmation`, `idempotencyKey`,
      //    identity, scope and provenance never enter the business body.
      const rawBusinessInput: Record<string, unknown> = {
        expectedUpdatedAt: parsedArgs.expectedUpdatedAt,
      };
      const suppliedArgs = parsedArgs as Record<string, unknown>;
      for (const field of MCP_KPI_UPDATE_MUTABLE_FIELD_NAMES) {
        if (!Object.prototype.hasOwnProperty.call(suppliedArgs, field)) {
          continue;
        }
        const value = suppliedArgs[field];
        if (value === undefined) continue;
        rawBusinessInput[field] = value;
      }

      // 5. Canonical business parsing: the sole KPI-update semantic authority.
      const canonicalBody = parseApiV1UpdateKpiBody(rawBusinessInput);

      // 6. Canonical REST idempotency payload (KPI identity + canonical body).
      const canonicalIdempotencyPayload = buildApiV1UpdateKpiIdempotencyPayload(
        kpiId,
        canonicalBody,
      );

      // 7. Canonical mutation execution context (idempotency + payload hash).
      const mutationContext = await buildMcpMutationExecutionContext(
        dependencies.execution,
        parsedArgs.idempotencyKey,
        canonicalIdempotencyPayload,
      );

      // 8. Canonical rate-limit profile for exactly `kpis.update`.
      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        KPI_UPDATE_ROUTE.id,
      );

      // 9. Canonical atomic rate-limit consumption, before the writer.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: KPI_UPDATE_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 10. Accepted caller-bound writer, exactly once.
      const result = await dependencies.writer(
        dependencies.request,
        kpiId,
        canonicalBody,
        mutationContext,
      );

      // 11. Fail-closed bounded result mapping. The writer's static type is
      //     compile-time evidence only: every accepted shape is re-checked at
      //     runtime here, with an exact key set. Anything else is `unavailable`.
      const raw: unknown = result;

      if (isExactSuccessResult(raw)) {
        return Object.freeze({
          ok: true as const,
          payload: toBoundedPayload(raw),
        });
      }

      if (isExactStaleConflictResult(raw)) {
        // Bounded stale conflict: never retried, never refreshed, and no
        // current database timestamp, internal code or reason is disclosed.
        return Object.freeze({
          ok: false as const,
          category: "stale_kpi_definition" as const,
        });
      }

      const negativeOutcome = readExactNegativeOutcome(raw);
      if (negativeOutcome !== null) {
        return Object.freeze({
          ok: false as const,
          category: mapNegativeOutcome(negativeOutcome),
        });
      }

      // Any malformed or unrecognised writer result is bounded as unavailable;
      // no unmapped outcome ever escapes to the MCP caller.
      return Object.freeze({
        ok: false as const,
        category: "unavailable" as const,
      });


    } catch (error) {
      // Only a bounded category escapes: no SQLSTATE, database message, stack,
      // policy reason, token, identity or internal function name.
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
