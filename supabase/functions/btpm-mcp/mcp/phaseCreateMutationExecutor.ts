// API-Q Phase Create Step 2 — Caller-bound MCP Phase-create adapter.
//
// This module provides exactly one factory that returns a caller-bound
// executor for MCP Phase creation.
//
// It invokes ONLY the fixed MCP-source database wrapper accepted in Phase
// Create Step 1, `public.mcp_v1_create_phase`, via the accepted
// `createMcpV1Phase(...)` adapter, using a FRESH anon-key Supabase client bound
// to the CURRENT caller's bearer token.
//
// This module:
//   - reads no environment variable (URL/anon key/factory are injected);
//   - constructs and accepts no service-role client or key;
//   - performs no authorization, PMG, capability, containment, enablement,
//     persistence, provenance, encryption or audit logic (the database is
//     authoritative);
//   - queries no Project/Phase/business table;
//   - derives no Tenant/Organization/Workspace scope and no PM authority;
//   - computes no payload hash and no idempotency decision;
//   - never widens Project dates;
//   - processes no confirmation (owned by the MCP mutation-control layer);
//   - registers no MCP tool and touches no MCP registry;
//   - performs no logging, caching, timers, retries or mutable global state;
//   - accepts no operation name, source channel, wrapper name, actor, client
//     or provenance argument from any caller.

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import { extractBearerToken } from "../../_shared/btpm-api/resolveTokenContext.ts";
import type { ApiV1CreatePhaseBody } from "../../_shared/btpm-api/routes/phases.ts";
import { parseApiV1CreatePhaseBody } from "../../_shared/btpm-api/routes/phases.ts";
import {
  type ApiV1CreatePhaseResult,
  type ApiV1PhaseRpcClient,
  createMcpV1Phase,
} from "../../_shared/btpm-api/supabasePhase.ts";
import type { McpMutationExecutionContext } from "./mutationControl.ts";

/** Required MCP source channel. No fallback to `external_api` is permitted. */
const REQUIRED_SOURCE_CHANNEL = "mcp" as const;

/** Required MCP delegation mode. */
const REQUIRED_DELEGATION_MODE = "delegated_user" as const;

/** Accepted canonical payload-hash format (64-char lowercase SHA-256 hex). */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Exact client options passed to the injected client factory. */
export interface McpCreatePhaseClientOptions {
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
export type McpCreatePhaseClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: McpCreatePhaseClientOptions,
) => unknown;

/** Caller-bound MCP Phase-create executor. */
export type McpV1CreatePhaseExecutor = (
  request: Request,
  body: ApiV1CreatePhaseBody,
  executionContext: McpMutationExecutionContext,
) => Promise<ApiV1CreatePhaseResult>;

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

function isRpcClient(value: unknown): value is ApiV1PhaseRpcClient {
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
  if (typeof payloadHash !== "string" || !SHA256_HEX_PATTERN.test(payloadHash)) {
    internal();
  }

  return { oauthClientId };
}

/**
 * Create the caller-bound MCP executor for `public.mcp_v1_create_phase`, bound
 * to the given Supabase URL and anon key. A fresh client is constructed per
 * invocation and never reused.
 */
export function createMcpV1CreatePhaseExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: McpCreatePhaseClientFactory,
): McpV1CreatePhaseExecutor {
  if (!isNonBlank(supabaseUrl)) internal();
  if (!isNonBlank(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeMcpV1CreatePhase(
    request: Request,
    body: ApiV1CreatePhaseBody,
    executionContext: McpMutationExecutionContext,
  ): Promise<ApiV1CreatePhaseResult> {
    if (!(request instanceof Request)) internal();

    // Revalidate the canonical business body with the single canonical parser.
    const canonicalBody = parseApiV1CreatePhaseBody(body);

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

    return await createMcpV1Phase(client, {
      expectedOauthClientId: oauthClientId,
      projectId: canonicalBody.projectId,
      name: canonicalBody.name,
      description: canonicalBody.description,
      status: canonicalBody.status,
      phaseType: canonicalBody.phaseType,
      startDate: canonicalBody.startDate,
      targetEndDate: canonicalBody.targetEndDate,
      sortOrder: canonicalBody.sortOrder,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}
