// API-Q Portfolio-11B — Caller-bound MCP Project↔Portfolio assignment adapter.
//
// This module provides exactly one factory that returns a caller-bound
// executor for MCP Project↔Portfolio assignment.
//
// It invokes ONLY the fixed MCP-source database wrapper accepted in
// Portfolio-11A, `public.mcp_v1_assign_project_portfolio`, via the accepted
// `assignMcpV1ProjectPortfolio(...)` adapter, using a FRESH anon-key Supabase
// client bound to the CURRENT caller's bearer token.
//
// This module:
//   - reads no environment variable (URL/anon key/factory are injected);
//   - constructs and accepts no service-role client or key;
//   - performs no authorization, PMG, capability, containment, enablement,
//     eligibility, persistence, provenance, encryption or audit logic (the
//     database is authoritative);
//   - queries no Project/Portfolio/Workspace/Organization table;
//   - derives no Tenant/Organization/Workspace scope and no domain authority;
//   - computes no payload hash and no idempotency decision;
//   - processes no confirmation (owned by the MCP mutation-control layer);
//   - registers no MCP tool and touches no MCP registry;
//   - performs no logging, caching, timers, retries or mutable global state;
//   - performs no read-before-write and introduces no concurrency token;
//   - never transforms `portfolioId: null` into any other value;
//   - accepts no operation name, source channel, wrapper name, actor, client
//     or provenance argument from any caller.

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import { extractBearerToken } from "../../_shared/btpm-api/resolveTokenContext.ts";
import type { ApiV1AssignProjectPortfolioBody } from "../../_shared/btpm-api/routes/portfolios.ts";
import {
  parseApiV1AssignProjectPortfolioBody,
  parseApiV1PortfolioAssignProjectPath,
} from "../../_shared/btpm-api/routes/portfolios.ts";
import {
  type ApiV1AssignProjectPortfolioResult,
  type ApiV1PortfolioAssignmentMutationRpcClient,
  assignMcpV1ProjectPortfolio,
} from "../../_shared/btpm-api/supabasePortfolioMutation.ts";
import type { McpMutationExecutionContext } from "./mutationControl.ts";

/** Required MCP source channel. No fallback to `external_api` is permitted. */
const REQUIRED_SOURCE_CHANNEL = "mcp" as const;

/** Required MCP delegation mode. */
const REQUIRED_DELEGATION_MODE = "delegated_user" as const;

/** Accepted canonical payload-hash format (64-char lowercase SHA-256 hex). */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Canonical assignment path prefix and suffix (parser reuse only). */
const ASSIGN_PATH_PREFIX = "/v1/projects/";
const ASSIGN_PATH_SUFFIX = "/portfolio";

/** Exact client options passed to the injected client factory. */
export interface McpAssignProjectPortfolioClientOptions {
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
export type McpAssignProjectPortfolioClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: McpAssignProjectPortfolioClientOptions,
) => unknown;

/** Caller-bound MCP Project↔Portfolio assignment executor. */
export type McpV1AssignProjectPortfolioExecutor = (
  request: Request,
  projectId: string,
  body: ApiV1AssignProjectPortfolioBody,
  executionContext: McpMutationExecutionContext,
) => Promise<ApiV1AssignProjectPortfolioResult>;

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
): value is ApiV1PortfolioAssignmentMutationRpcClient {
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
 * Create the caller-bound MCP executor for
 * `public.mcp_v1_assign_project_portfolio`, bound to the given Supabase URL and
 * anon key. A fresh client is constructed per invocation and never reused.
 */
export function createMcpV1AssignProjectPortfolioExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: McpAssignProjectPortfolioClientFactory,
): McpV1AssignProjectPortfolioExecutor {
  if (!isNonBlank(supabaseUrl)) internal();
  if (!isNonBlank(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeMcpV1AssignProjectPortfolio(
    request: Request,
    projectId: string,
    body: ApiV1AssignProjectPortfolioBody,
    executionContext: McpMutationExecutionContext,
  ): Promise<ApiV1AssignProjectPortfolioResult> {
    if (!(request instanceof Request)) internal();

    // Reuse the single canonical assignment identity contract
    // (`/v1/projects/{projectId}/portfolio`). No Project row is read here.
    if (typeof projectId !== "string") {
      throw new ApiHttpError("invalid_request");
    }
    const { projectId: canonicalProjectId } =
      parseApiV1PortfolioAssignProjectPath(
        `${ASSIGN_PATH_PREFIX}${projectId}${ASSIGN_PATH_SUFFIX}`,
      );

    // Revalidate the closed single-key assignment body with the canonical
    // parser. `portfolioId` remains either a valid UUID or `null` (clear).
    const canonicalBody = parseApiV1AssignProjectPortfolioBody(body);

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

    return await assignMcpV1ProjectPortfolio(client, {
      expectedOauthClientId: oauthClientId,
      projectId: canonicalProjectId,
      // `null` means "clear the assignment"; forwarded unchanged.
      portfolioId: canonicalBody.portfolioId,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}
