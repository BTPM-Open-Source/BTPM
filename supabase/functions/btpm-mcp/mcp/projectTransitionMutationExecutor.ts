// API-Q Project Transition Step 2 — Caller-bound MCP Project-transition adapter.
//
// This module provides exactly one factory that returns a caller-bound
// executor for MCP Project status transition.
//
// It invokes ONLY the fixed MCP-source database wrapper accepted in Project
// Transition Step 1, via the accepted `transitionMcpV1Project(...)` shared
// adapter (which owns the fixed wrapper name), using a FRESH anon-key Supabase
// client bound to the CURRENT caller's bearer token.
//
// This module:
//   - reads no environment variable (URL/anon key/factory are injected);
//   - constructs and accepts no service-role client or key;
//   - performs no authorization, mutation-gateway, capability, containment,
//     Project Connected-App enablement, lifecycle-transition, completion,
//     blocker/warning, persistence, provenance, encryption or audit logic (the
//     database is authoritative);
//   - queries no Project/Program/business table;
//   - computes no payload hash and no idempotency decision;
//   - processes no MCP transport confirmation (owned by the MCP
//     mutation-control layer). `confirmWarnings` is canonical Project
//     lifecycle business input and is forwarded unchanged;
//   - registers no MCP tool and touches no MCP registry;
//   - performs no logging, caching, timers, retries or mutable global state;
//   - performs no read-before-write and never refreshes `expectedUpdatedAt`;
//   - accepts no operation name, source channel, wrapper name, actor, client
//     or provenance argument from any caller.

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import { extractBearerToken } from "../../_shared/btpm-api/resolveTokenContext.ts";
import type { ApiV1TransitionProjectBody } from "../../_shared/btpm-api/routes/projects.ts";
import {
  parseApiV1ProjectTransitionPath,
  parseApiV1TransitionProjectBody,
} from "../../_shared/btpm-api/routes/projects.ts";
import {
  type ApiV1ProjectMutationRpcClient,
  type ApiV1TransitionProjectResult,
  transitionMcpV1Project,
} from "../../_shared/btpm-api/supabaseProjectMutation.ts";
import type { McpMutationExecutionContext } from "./mutationControl.ts";

/** Required MCP source channel. No fallback to `external_api` is permitted. */
const REQUIRED_SOURCE_CHANNEL = "mcp" as const;

/** Required MCP delegation mode. */
const REQUIRED_DELEGATION_MODE = "delegated_user" as const;

/** Accepted canonical payload-hash format (64-char lowercase SHA-256 hex). */
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Canonical Project transition path prefix used for reuse of the parser. */
const PROJECT_PATH_PREFIX = "/v1/projects/";

/** Canonical Project transition path suffix used for reuse of the parser. */
const PROJECT_TRANSITION_PATH_SUFFIX = "/transition";

/** Exact client options passed to the injected client factory. */
export interface McpTransitionProjectClientOptions {
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
export type McpTransitionProjectClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: McpTransitionProjectClientOptions,
) => unknown;

/** Caller-bound MCP Project-transition executor. */
export type McpV1TransitionProjectExecutor = (
  request: Request,
  projectId: string,
  body: ApiV1TransitionProjectBody,
  executionContext: McpMutationExecutionContext,
) => Promise<ApiV1TransitionProjectResult>;

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

function isRpcClient(value: unknown): value is ApiV1ProjectMutationRpcClient {
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
 * Create the caller-bound MCP executor for the accepted MCP-source Project
 * transition wrapper, bound to the given Supabase URL and anon key. A fresh
 * client is constructed per invocation and never reused.
 */
export function createMcpV1TransitionProjectExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: McpTransitionProjectClientFactory,
): McpV1TransitionProjectExecutor {
  if (!isNonBlank(supabaseUrl)) internal();
  if (!isNonBlank(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeMcpV1TransitionProject(
    request: Request,
    projectId: string,
    body: ApiV1TransitionProjectBody,
    executionContext: McpMutationExecutionContext,
  ): Promise<ApiV1TransitionProjectResult> {
    if (!(request instanceof Request)) internal();

    // Reuse the single canonical Project transition identity contract
    // (`/v1/projects/{projectId}/transition`). No Project row is read here.
    if (typeof projectId !== "string") {
      throw new ApiHttpError("invalid_request");
    }
    const { projectId: canonicalProjectId } = parseApiV1ProjectTransitionPath(
      `${PROJECT_PATH_PREFIX}${projectId}${PROJECT_TRANSITION_PATH_SUFFIX}`,
    );

    // The Project transition body has no derived `set*` fields, so the single
    // canonical body parser is re-applied exactly once as the closed-schema
    // authority. The shared MCP adapter remains the RPC-mapping boundary.
    const canonicalBody = parseApiV1TransitionProjectBody(body);

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

    return await transitionMcpV1Project(client, {
      expectedOauthClientId: oauthClientId,
      projectId: canonicalProjectId,
      // Caller-provided concurrency token, passed through unchanged.
      expectedUpdatedAt: canonicalBody.expectedUpdatedAt,
      targetStatus: canonicalBody.targetStatus,
      // Canonical Project lifecycle business input, not MCP transport
      // confirmation.
      confirmWarnings: canonicalBody.confirmWarnings,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}
