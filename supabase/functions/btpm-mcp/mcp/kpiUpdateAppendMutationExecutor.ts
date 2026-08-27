// KPI-6C — Caller-bound MCP KPI update-history append adapter.
//
// This module provides exactly one factory that returns a caller-bound
// executor for the canonical MCP KPI update-history append operation.
//
// It invokes ONLY the fixed MCP-source database wrapper accepted in KPI-6A,
// `public.mcp_v1_append_kpi_update`, via the fixed
// `appendMcpV1KpiUpdate(...)` adapter, using a FRESH anon-key Supabase client
// bound to the CURRENT caller's bearer token.
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
//   - performs no read-before-write, no KPI/Project/history lookup;
//   - encrypts and decrypts nothing;
//   - accepts no operation name, source channel, wrapper name, actor, client,
//     scope or provenance argument from any caller.
//
// The body handed to this executor is ALREADY canonical: it was produced once by
// `parseApiV1AppendKpiUpdateBody` in the MCP control layer and is therefore NOT
// reparsed here. No second business-parsing pass exists.

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import { extractBearerToken } from "../../_shared/btpm-api/resolveTokenContext.ts";
import type { ApiV1AppendKpiUpdateBody } from "../../_shared/btpm-api/routes/kpis.ts";
import { parseApiV1KpiUpdatesPath } from "../../_shared/btpm-api/routes/kpis.ts";
import {
  appendMcpV1KpiUpdate,
  type ApiV1AppendKpiUpdateResult,
  type ApiV1KpiAppendUpdateRpcClient,
} from "../../_shared/btpm-api/supabaseKpiMutation.ts";
import type { McpMutationExecutionContext } from "./mutationControl.ts";

/** Required MCP source channel. No fallback to `external_api` is permitted. */
const REQUIRED_SOURCE_CHANNEL = "mcp" as const;

/** Required MCP delegation mode. */
const REQUIRED_DELEGATION_MODE = "delegated_user" as const;

/** Accepted canonical payload-hash format (64-char lowercase SHA-256 hex). */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Exact client options passed to the injected client factory. */
export interface McpAppendKpiUpdateClientOptions {
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
export type McpAppendKpiUpdateClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: McpAppendKpiUpdateClientOptions,
) => unknown;

/** Caller-bound MCP KPI update-history append executor. */
export type McpV1AppendKpiUpdateExecutor = (
  request: Request,
  kpiId: string,
  body: ApiV1AppendKpiUpdateBody,
  executionContext: McpMutationExecutionContext,
) => Promise<ApiV1AppendKpiUpdateResult>;

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

function isRpcClient(value: unknown): value is ApiV1KpiAppendUpdateRpcClient {
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
 * Revalidate the KPI identity through the SINGLE accepted canonical KPI
 * update-history path authority (`parseApiV1KpiUpdatesPath`). No second UUID
 * grammar is introduced here.
 */
function requireCanonicalKpiId(kpiId: unknown): string {
  if (typeof kpiId !== "string") internal();
  return parseApiV1KpiUpdatesPath(`/v1/kpis/${kpiId}/updates`).kpiId;
}

/**
 * Create the caller-bound MCP executor for `public.mcp_v1_append_kpi_update`,
 * bound to the given Supabase URL and anon key. A fresh client is constructed
 * per invocation and never reused.
 */
export function createMcpV1AppendKpiUpdateExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: McpAppendKpiUpdateClientFactory,
): McpV1AppendKpiUpdateExecutor {
  if (!isNonBlank(supabaseUrl)) internal();
  if (!isNonBlank(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeMcpV1AppendKpiUpdate(
    request: Request,
    kpiId: string,
    body: ApiV1AppendKpiUpdateBody,
    executionContext: McpMutationExecutionContext,
  ): Promise<ApiV1AppendKpiUpdateResult> {
    if (!(request instanceof Request)) internal();

    // The canonical KPI identity is revalidated through the single accepted
    // path authority. The canonical body is preserved exactly as produced by
    // `parseApiV1AppendKpiUpdateBody`.
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

    return await appendMcpV1KpiUpdate(client, {
      expectedOauthClientId: oauthClientId,
      kpiId: canonicalKpiId,
      value: canonicalBody.value,
      updateDate: canonicalBody.updateDate,
      note: canonicalBody.note,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}
