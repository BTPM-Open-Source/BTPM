// API-Q.6 — Trusted MCP provenance boundary (pure builder, no I/O).
//
// This module converts an ALREADY-AUTHORIZED MCP context (OAuth authentication
// followed by canonical Connected App authorization) into one immutable trusted
// execution context that identifies the request as MCP-originated.
//
// It deliberately accepts NO `Request`, headers, query parameters, body, MCP
// `_meta`, tool arguments, caller metadata, caller source channel or caller
// actor identifiers. The only identity source is the accepted authorized MCP
// context, so the MCP client can never choose, override or spoof provenance.
//
// It performs no database access, no RPC, no PMG call, no audit insert, no
// persistence and no capability evaluation.
//
// Idempotency boundary (API-Q.8): when MCP mutation execution is later
// introduced, idempotency MUST extend this trusted context (adding an
// idempotency key and payload hash through the canonical API idempotency
// behavior). It MUST NOT alter `sourceChannel`, and MUST NOT alter actor or
// client identity. No idempotency field exists in API-Q.6.

import type { McpAuthorizedContext } from "./authorizeMcpConnectedApp.ts";

/** Server-hardcoded MCP source channel. Mirrors the existing PMG enum value. */
export const MCP_SOURCE_CHANNEL = "mcp" as const;

/** Server-hardcoded MCP delegation mode. Callers can never claim another mode. */
export const MCP_DELEGATION_MODE = "delegated_user" as const;

/**
 * The immutable trusted MCP execution context. It carries identity and
 * provenance only: no tenant, Organization, Workspace, Project, role,
 * capability or other business authority field exists.
 */
export interface McpTrustedExecutionContext {
  readonly requestedUserId: string;
  readonly executingUserId: string;
  readonly apiClientId: string;
  readonly oauthClientId: string;
  readonly policyVersionId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly sourceChannel: typeof MCP_SOURCE_CHANNEL;
  readonly sourceClientId: string;
  readonly delegationMode: typeof MCP_DELEGATION_MODE;
}

/**
 * Bounded internal provenance failure. It carries no caller data and no
 * governance reason; the transport never discloses it.
 */
export class McpExecutionContextError extends Error {
  constructor() {
    super("mcp_execution_context_invalid");
    this.name = "McpExecutionContextError";
  }
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Builds the trusted MCP execution context from an authorized MCP context.
 *
 * Fails closed when the internal authorized context is malformed or
 * incomplete. No identity value is ever substituted, defaulted or
 * manufactured.
 */
export function buildMcpExecutionContext(
  authorized: McpAuthorizedContext,
): McpTrustedExecutionContext {
  if (authorized === null || typeof authorized !== "object") {
    throw new McpExecutionContextError();
  }

  const userId: unknown = authorized.userId;
  const apiClientId: unknown = authorized.apiClientId;
  const oauthClientId: unknown = authorized.oauthClientId;
  const policyVersionId: unknown = authorized.policyVersionId;
  const requestId: unknown = authorized.requestId;

  if (
    !isNonBlank(userId) ||
    !isNonBlank(apiClientId) ||
    !isNonBlank(oauthClientId) ||
    !isNonBlank(policyVersionId) ||
    !isNonBlank(requestId)
  ) {
    throw new McpExecutionContextError();
  }

  return Object.freeze({
    // Delegated-user MCP execution: requester and executor are the same
    // authenticated Supabase user resolved upstream.
    requestedUserId: userId,
    executingUserId: userId,
    apiClientId,
    oauthClientId,
    policyVersionId,
    requestId,
    // API-Q.6: correlation is server-derived and deterministic.
    correlationId: requestId,
    sourceChannel: MCP_SOURCE_CHANNEL,
    sourceClientId: apiClientId,
    delegationMode: MCP_DELEGATION_MODE,
  });
}
