// KPI-6C — KPI update-history append MCP mutation tool control composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `kpis.updates.append`. It composes only already
// accepted components:
//
//   - literal confirmation control        : `requireMcpMutationConfirmation`
//   - canonical KPI identity authority    : `parseApiV1KpiUpdatesPath`
//   - canonical business validation       : `parseApiV1AppendKpiUpdateBody`
//   - canonical idempotency payload       : `buildApiV1AppendKpiUpdateIdempotencyPayload`
//   - canonical idempotency + payload hash: `buildMcpMutationExecutionContext`
//   - canonical rate limiting             : `enforceApiRateLimit`
//   - caller-bound writer                 : `McpV1AppendKpiUpdateExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, persists nothing, logs nothing, starts no timer,
// performs no retry, performs no read-before-write and registers no MCP tool.
// No generic operation dispatcher exists here. No second KPI update-history
// business contract is introduced.
//
// This command is append-only: there is no `no_change`, no concurrency token
// and no stale-token semantics.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  buildApiV1AppendKpiUpdateIdempotencyPayload,
  KPI_UPDATE_APPEND_ROUTE,
  parseApiV1AppendKpiUpdateBody,
  parseApiV1KpiUpdatesPath,
} from "../../_shared/btpm-api/routes/kpis.ts";
import type { ApiV1AppendKpiUpdateSuccessResult } from "../../_shared/btpm-api/supabaseKpiMutation.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1AppendKpiUpdateExecutor } from "./kpiUpdateAppendMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `kpis.updates.append`. */
export const MCP_KPI_UPDATE_APPEND_TOOL_NAME = "btpm_append_kpi_update";

/**
 * Strict MCP transport guard. It is STRUCTURAL only: it establishes primitive
 * shapes and the exact six-key envelope. All KPI update-history business
 * semantics — finite-value rules, canonical `YYYY-MM-DD` update-date grammar and
 * the accepted C1 note canonicalization — remain owned exclusively by
 * `parseApiV1AppendKpiUpdateBody`.
 *
 * Deliberately no `z.enum(...)`, no date refinement and no note normalization at
 * this layer.
 */
export const MCP_KPI_UPDATE_APPEND_TOOL_INPUT_SCHEMA = z.strictObject({
  kpiId: z.string(),
  value: z.number(),
  updateDate: z.string(),
  note: z.string().nullable().optional(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact six approved MCP argument names. */
export const MCP_KPI_UPDATE_APPEND_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "kpiId",
    "value",
    "updateDate",
    "note",
    "confirmation",
    "idempotencyKey",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpKpiUpdateAppendToolArguments {
  readonly kpiId: string;
  readonly value: number;
  readonly updateDate: string;
  readonly note?: string | null;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpKpiUpdateAppendToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_KPI_UPDATE_APPEND_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpKpiUpdateAppendToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to append an update to this KPI.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  unavailable: "BTPM KPI update append is temporarily unavailable.",
});

/** Bounded successful tool payload. No KPI narrative or note is returned. */
export interface McpKpiUpdateAppendToolPayload {
  readonly outcome: "applied" | "replayed";
  readonly kpiUpdateId: string;
  readonly kpiId: string;
  readonly projectId: string;
}

/** Bounded tool result union. */
export type McpKpiUpdateAppendToolResult =
  | { readonly ok: true; readonly payload: McpKpiUpdateAppendToolPayload }
  | {
    readonly ok: false;
    readonly category: McpKpiUpdateAppendToolErrorCategory;
  };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpKpiUpdateAppendToolExecutor = (
  args: McpKpiUpdateAppendToolArguments,
) => Promise<McpKpiUpdateAppendToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpKpiUpdateAppendToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1AppendKpiUpdateExecutor;
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

function categorize(error: unknown): McpKpiUpdateAppendToolErrorCategory {
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
  outcome: NegativeOutcome,
): McpKpiUpdateAppendToolErrorCategory {
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
  result: ApiV1AppendKpiUpdateSuccessResult,
): McpKpiUpdateAppendToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    kpiUpdateId: result.kpiUpdateId,
    kpiId: result.kpiId,
    projectId: result.projectId,
  });
}

// ---------------------------------------------------------------------------
// Fail-closed runtime writer-result shape guards (KPI-5C-C1 posture).
//
// These are deliberately local, exact-key-set structural checks. They perform
// no retry and no read-before-write. Anything that is not exactly an accepted
// shape becomes `unavailable`.
// ---------------------------------------------------------------------------

const SUCCESS_OUTCOMES: ReadonlyArray<string> = Object.freeze([
  "applied",
  "replayed",
]);

const SUCCESS_RESULT_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "kpiUpdateId",
  "kpiId",
  "projectId",
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
  requestedKpiId: string,
): value is ApiV1AppendKpiUpdateSuccessResult {
  if (!isPlainRecord(value)) return false;
  if (!hasExactKeys(value, SUCCESS_RESULT_KEYS)) return false;
  if (value.ok !== true) return false;
  if (
    typeof value.outcome !== "string" ||
    !SUCCESS_OUTCOMES.includes(value.outcome)
  ) {
    return false;
  }
  if (
    !isNonEmptyString(value.kpiUpdateId) ||
    !isNonEmptyString(value.kpiId) ||
    !isNonEmptyString(value.projectId)
  ) {
    return false;
  }
  return value.kpiId === requestedKpiId;
}

function readExactNegativeOutcome(value: unknown): NegativeOutcome | null {
  if (!isPlainRecord(value)) return null;
  if (!hasExactKeys(value, NEGATIVE_RESULT_KEYS)) return null;
  if (value.ok !== false) return null;
  return isNegativeOutcome(value.outcome) ? value.outcome : null;
}

/**
 * Creates the per-request `kpis.updates.append` MCP tool executor.
 *
 * Execution order (never reordered):
 *   1. strict structural MCP envelope;
 *   2. literal explicit confirmation;
 *   3. canonical KPI ID parsing through `parseApiV1KpiUpdatesPath`;
 *   4. business-only object (`value`, `updateDate`, and `note` only if
 *      supplied);
 *   5. canonical `parseApiV1AppendKpiUpdateBody`, executed exactly once and the
 *      sole business authority;
 *   6. canonical four-field KPI-append idempotency payload;
 *   7. MCP mutation execution context (idempotency + payload hash);
 *   8. `kpis.updates.append` rate-limit profile;
 *   9. canonical atomic rate-limit consumption;
 *  10. the accepted caller-bound writer, exactly once;
 *  11. fail-closed bounded writer-result mapping.
 */
export function createMcpKpiUpdateAppendToolExecutor(
  dependencies: McpKpiUpdateAppendToolDependencies,
): McpKpiUpdateAppendToolExecutor {
  return async function executeKpiUpdateAppend(
    args: McpKpiUpdateAppendToolArguments,
  ): Promise<McpKpiUpdateAppendToolResult> {
    try {
      // 1. Strict structural MCP argument envelope.
      const parsedArgs = MCP_KPI_UPDATE_APPEND_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before any canonical parsing, idempotency
      //    context, rate-limit consumption or writer execution.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical KPI identity (single accepted path authority).
      const { kpiId } = parseApiV1KpiUpdatesPath(
        `/v1/kpis/${parsedArgs.kpiId}/updates`,
      );

      // 4. Business-only object. `kpiId`, `confirmation`, `idempotencyKey`,
      //    identity, scope, provenance and transport metadata never enter the
      //    canonical body parser. `note` is forwarded only when supplied.
      const rawBusinessInput: Record<string, unknown> = {
        value: parsedArgs.value,
        updateDate: parsedArgs.updateDate,
      };
      const suppliedArgs = parsedArgs as Record<string, unknown>;
      if (
        Object.prototype.hasOwnProperty.call(suppliedArgs, "note") &&
        suppliedArgs.note !== undefined
      ) {
        rawBusinessInput.note = suppliedArgs.note;
      }

      // 5. Canonical business parsing: the sole KPI-append semantic authority,
      //    executed exactly once (accepted C1 note canonicalization inherited).
      const canonicalBody = parseApiV1AppendKpiUpdateBody(rawBusinessInput);

      // 6. Canonical four-field idempotency payload.
      const canonicalIdempotencyPayload =
        buildApiV1AppendKpiUpdateIdempotencyPayload(kpiId, canonicalBody);

      // 7. Canonical mutation execution context (idempotency + payload hash).
      const mutationContext = await buildMcpMutationExecutionContext(
        dependencies.execution,
        parsedArgs.idempotencyKey,
        canonicalIdempotencyPayload,
      );

      // 8. Canonical rate-limit profile for exactly `kpis.updates.append`.
      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        KPI_UPDATE_APPEND_ROUTE.id,
      );

      // 9. Canonical atomic rate-limit consumption, before the writer.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: KPI_UPDATE_APPEND_ROUTE.id,
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

      if (isExactSuccessResult(raw, kpiId)) {
        return Object.freeze({
          ok: true as const,
          payload: toBoundedPayload(raw),
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
      // policy reason, token, identity, note or internal function name.
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
