// KPI-5C — Caller-bound MCP KPI-definition-update adapter.
//
// This module provides exactly one factory that returns a caller-bound
// executor for MCP Project KPI definition update.
//
// It invokes ONLY the fixed MCP-source database wrapper accepted in KPI-5A,
// `public.mcp_v1_update_kpi`, via the accepted `updateMcpV1Kpi(...)` adapter,
// using a FRESH anon-key Supabase client bound to the CURRENT caller's bearer
// token.
//
// This module:
//   - reads no environment variable (URL/anon key/factory are injected);
//   - constructs and accepts no service-role client or key;
//   - performs no authorization, PMG, capability, containment, enablement,
//     persistence, provenance, encryption or audit logic (the database is
//     authoritative);
//   - computes no payload hash and no idempotency decision;
//   - processes no confirmation (owned by the MCP mutation-control layer);
//   - registers no MCP tool and touches no MCP registry;
//   - performs no logging, caching, timers, retries or mutable global state;
//   - performs no read-before-write, no KPI/Project/table lookup and never
//     refreshes or replaces the caller's `expectedUpdatedAt`;
//   - accepts no operation name, source channel, wrapper name, actor, client
//     or provenance argument from any caller.
//
// The body handed to this executor is ALREADY canonical: it carries
// `expectedUpdatedAt`, the fourteen normalized values and the fourteen derived
// set flags produced by `parseApiV1UpdateKpiBody`. It is therefore NOT reparsed
// here (the canonical parser intentionally rejects derived set flags): every
// canonical value and set flag is preserved exactly, and the shared fixed update
// adapter remains the RPC mapping/validation boundary.

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import { extractBearerToken } from "../../_shared/btpm-api/resolveTokenContext.ts";
import type { ApiV1UpdateKpiBody } from "../../_shared/btpm-api/routes/kpis.ts";
import { parseApiV1KpiDetailPath } from "../../_shared/btpm-api/routes/kpis.ts";
import {
  type ApiV1KpiUpdateRpcClient,
  type ApiV1UpdateKpiResult,
  updateMcpV1Kpi,
} from "../../_shared/btpm-api/supabaseKpiMutation.ts";
import type { McpMutationExecutionContext } from "./mutationControl.ts";

/** Required MCP source channel. No fallback to `external_api` is permitted. */
const REQUIRED_SOURCE_CHANNEL = "mcp" as const;

/** Required MCP delegation mode. */
const REQUIRED_DELEGATION_MODE = "delegated_user" as const;

/** Accepted canonical payload-hash format (64-char lowercase SHA-256 hex). */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Exact client options passed to the injected client factory. */
export interface McpUpdateKpiClientOptions {
  readonly auth: {
    readonly persistSession: false;
    readonly autoRefreshToken: false;
    readonly detectSessionInUrl: false;
  };
  readonly global: {
    readonly headers: {
      readonly Authorization: string;
    };
  };
}

/** Minimal structural client factory contract (anon key only). */
export type McpUpdateKpiClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: McpUpdateKpiClientOptions,
) => unknown;

/** Caller-bound MCP KPI-update executor. */
export type McpV1UpdateKpiExecutor = (
  request: Request,
  kpiId: string,
  body: ApiV1UpdateKpiBody,
  executionContext: McpMutationExecutionContext,
) => Promise<ApiV1UpdateKpiResult>;

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Bounded internal failure. Discloses no identity, token or database detail. */
function internal(): never {
  throw new ApiHttpError("internal_error");
}

function isRpcClient(value: unknown): value is ApiV1KpiUpdateRpcClient {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { rpc?: unknown }).rpc === "function"
  );
}

/**
 * Fail-closed internal-consistency gate over the trusted MCP mutation
 * execution context. No missing identity value is ever derived, defaulted or
 * replaced here: a malformed or internally inconsistent context fails before
 * any Supabase client is constructed and before any RPC executes.
 */
function requireConsistentMutationContext(
  executionContext: unknown,
): { readonly oauthClientId: string } {
  if (!isPlainObject(executionContext)) internal();

  const {
    requestedUserId,
    executingUserId,
    apiClientId,
    oauthClientId,
    policyVersionId,
    requestId,
    correlationId,
    sourceChannel,
    sourceClientId,
    delegationMode,
    idempotencyKey,
    payloadHash,
  } = executionContext;

  if (
    !isNonBlank(requestedUserId) ||
    !isNonBlank(executingUserId) ||
    !isNonBlank(apiClientId) ||
    !isNonBlank(oauthClientId) ||
    !isNonBlank(policyVersionId) ||
    !isNonBlank(requestId) ||
    !isNonBlank(correlationId) ||
    !isNonBlank(sourceClientId) ||
    !isNonBlank(idempotencyKey)
  ) {
    internal();
  }

  if (requestedUserId !== executingUserId) internal();
  if (sourceClientId !== apiClientId) internal();
  if (correlationId !== requestId) internal();
  if (sourceChannel !== REQUIRED_SOURCE_CHANNEL) internal();
  if (delegationMode !== REQUIRED_DELEGATION_MODE) internal();
  if (
    typeof payloadHash !== "string" || !SHA256_HEX_PATTERN.test(payloadHash)
  ) {
    internal();
  }

  return { oauthClientId };
}

/**
 * Revalidate the KPI identity through the SINGLE accepted canonical KPI detail
 * path authority (`parseApiV1KpiDetailPath`). No second UUID grammar is
 * introduced here.
 */
function requireCanonicalKpiId(kpiId: unknown): string {
  if (typeof kpiId !== "string") internal();
  return parseApiV1KpiDetailPath(`/v1/kpis/${kpiId}`).kpiId;
}

/**
 * Create the caller-bound MCP executor for `public.mcp_v1_update_kpi`, bound
 * to the given Supabase URL and anon key. A fresh client is constructed per
 * invocation and never reused.
 */
export function createMcpV1UpdateKpiExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: McpUpdateKpiClientFactory,
): McpV1UpdateKpiExecutor {
  if (!isNonBlank(supabaseUrl)) internal();
  if (!isNonBlank(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeMcpV1UpdateKpi(
    request: Request,
    kpiId: string,
    body: ApiV1UpdateKpiBody,
    executionContext: McpMutationExecutionContext,
  ): Promise<ApiV1UpdateKpiResult> {
    if (!(request instanceof Request)) internal();

    // The canonical KPI identity is revalidated through the single accepted
    // path authority. The canonical body is preserved exactly as produced by
    // `parseApiV1UpdateKpiBody`.
    const canonicalKpiId = requireCanonicalKpiId(kpiId);
    if (!isPlainObject(body)) internal();
    const canonicalBody = body;

    const { oauthClientId } = requireConsistentMutationContext(
      executionContext,
    );

    // Preserves ApiAuthenticationError for missing/malformed credentials, and
    // fails before any client construction. The token is used only as the
    // Authorization header value.
    const token = extractBearerToken(request);

    let client: unknown;
    try {
      client = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      });
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }

    if (!isRpcClient(client)) internal();

    return await updateMcpV1Kpi(client, {
      expectedOauthClientId: oauthClientId,
      kpiId: canonicalKpiId,
      expectedUpdatedAt: canonicalBody.expectedUpdatedAt,
      name: canonicalBody.name,
      description: canonicalBody.description,
      unit: canonicalBody.unit,
      targetValue: canonicalBody.targetValue,
      targetDirection: canonicalBody.targetDirection,
      sourceMode: canonicalBody.sourceMode,
      valueType: canonicalBody.valueType,
      cadence: canonicalBody.cadence,
      calculationKey: canonicalBody.calculationKey,
      formulaVersion: canonicalBody.formulaVersion,
      completionMethod: canonicalBody.completionMethod,
      commentRequired: canonicalBody.commentRequired,
      actionPlanRequired: canonicalBody.actionPlanRequired,
      autoSnapshotEnabled: canonicalBody.autoSnapshotEnabled,
      setName: canonicalBody.setName,
      setDescription: canonicalBody.setDescription,
      setUnit: canonicalBody.setUnit,
      setTargetValue: canonicalBody.setTargetValue,
      setTargetDirection: canonicalBody.setTargetDirection,
      setSourceMode: canonicalBody.setSourceMode,
      setValueType: canonicalBody.setValueType,
      setCadence: canonicalBody.setCadence,
      setCalculationKey: canonicalBody.setCalculationKey,
      setFormulaVersion: canonicalBody.setFormulaVersion,
      setCompletionMethod: canonicalBody.setCompletionMethod,
      setCommentRequired: canonicalBody.setCommentRequired,
      setActionPlanRequired: canonicalBody.setActionPlanRequired,
      setAutoSnapshotEnabled: canonicalBody.setAutoSnapshotEnabled,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}
