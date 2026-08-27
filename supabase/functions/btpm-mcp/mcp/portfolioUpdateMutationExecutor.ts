// API-Q Portfolio-10B — Caller-bound MCP Portfolio-update adapter.
//
// This module provides exactly one factory that returns a caller-bound
// executor for MCP Portfolio updates.
//
// It invokes ONLY the fixed MCP-source database wrapper accepted in
// Portfolio-10A, `public.mcp_v1_update_portfolio`, via the accepted
// `updateMcpV1Portfolio(...)` adapter, using a FRESH anon-key Supabase client
// bound to the CURRENT caller's bearer token.
//
// This module:
//   - reads no environment variable (URL/anon key/factory are injected);
//   - constructs and accepts no service-role client or key;
//   - performs no authorization, PMG, capability, containment, enablement,
//     persistence, provenance, encryption or audit logic (the database is
//     authoritative);
//   - queries no Portfolio/Organization/owner/business table;
//   - derives no Tenant/Organization/Workspace scope and no domain authority;
//   - computes no payload hash and no idempotency decision;
//   - performs no read-before-write and never refreshes, substitutes or
//     retries the caller's optimistic-concurrency token;
//   - processes no confirmation (owned by the MCP mutation-control layer);
//   - registers no MCP tool and touches no MCP registry;
//   - performs no logging, caching, timers, retries or mutable global state;
//   - accepts no operation name, source channel, wrapper name, actor, client
//     or provenance argument from any caller.

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import { extractBearerToken } from "../../_shared/btpm-api/resolveTokenContext.ts";
import type { ApiV1UpdatePortfolioBody } from "../../_shared/btpm-api/routes/portfolios.ts";
import { parseApiV1PortfolioUpdatePath } from "../../_shared/btpm-api/routes/portfolios.ts";
import {
  type ApiV1PortfolioUpdateMutationRpcClient,
  type ApiV1UpdatePortfolioResult,
  updateMcpV1Portfolio,
} from "../../_shared/btpm-api/supabasePortfolioMutation.ts";
import type { McpMutationExecutionContext } from "./mutationControl.ts";

/** Required MCP source channel. No fallback to `external_api` is permitted. */
const REQUIRED_SOURCE_CHANNEL = "mcp" as const;

/** Required MCP delegation mode. */
const REQUIRED_DELEGATION_MODE = "delegated_user" as const;

/** Accepted canonical payload-hash format (64-char lowercase SHA-256 hex). */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Canonical Portfolio identity path prefix used for reuse of the parser. */
const PORTFOLIO_PATH_PREFIX = "/v1/portfolios/";

/** Exact client options passed to the injected client factory. */
export interface McpUpdatePortfolioClientOptions {
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
export type McpUpdatePortfolioClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: McpUpdatePortfolioClientOptions,
) => unknown;

/** Caller-bound MCP Portfolio-update executor. */
export type McpV1UpdatePortfolioExecutor = (
  request: Request,
  portfolioId: string,
  body: ApiV1UpdatePortfolioBody,
  executionContext: McpMutationExecutionContext,
) => Promise<ApiV1UpdatePortfolioResult>;

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

function isRpcClient(
  value: unknown,
): value is ApiV1PortfolioUpdateMutationRpcClient {
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
 * Create the caller-bound MCP executor for `public.mcp_v1_update_portfolio`,
 * bound to the given Supabase URL and anon key. A fresh client is constructed
 * per invocation and never reused.
 */
export function createMcpV1UpdatePortfolioExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: McpUpdatePortfolioClientFactory,
): McpV1UpdatePortfolioExecutor {
  if (!isNonBlank(supabaseUrl)) internal();
  if (!isNonBlank(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeMcpV1UpdatePortfolio(
    request: Request,
    portfolioId: string,
    body: ApiV1UpdatePortfolioBody,
    executionContext: McpMutationExecutionContext,
  ): Promise<ApiV1UpdatePortfolioResult> {
    if (!(request instanceof Request)) internal();

    // Reuse the single canonical Portfolio identity contract
    // (`/v1/portfolios/{portfolioId}`). No Portfolio row is read here.
    if (typeof portfolioId !== "string") {
      throw new ApiHttpError("invalid_request");
    }
    const { portfolioId: canonicalPortfolioId } =
      parseApiV1PortfolioUpdatePath(
        `${PORTFOLIO_PATH_PREFIX}${portfolioId}`,
      );

    // `body` is ALREADY the canonical parsed Portfolio update desired state
    // (values plus the derived `set*` presence flags). It must not be
    // re-parsed through the raw HTTP-body parser, which derives the flags from
    // the external PATCH shape. The shared update adapter remains the
    // validation / RPC-mapping boundary.
    if (!isPlainObject(body)) internal();

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

    return await updateMcpV1Portfolio(client, {
      expectedOauthClientId: oauthClientId,
      portfolioId: canonicalPortfolioId,
      // Caller-provided concurrency token, passed through unchanged.
      expectedUpdatedAt: body.expectedUpdatedAt,
      name: body.name,
      setName: body.setName,
      code: body.code,
      setCode: body.setCode,
      description: body.description,
      setDescription: body.setDescription,
      lifecycleState: body.lifecycleState,
      setLifecycleState: body.setLifecycleState,
      strategicPriority: body.strategicPriority,
      setStrategicPriority: body.setStrategicPriority,
      ownerId: body.ownerId,
      setOwnerId: body.setOwnerId,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}
