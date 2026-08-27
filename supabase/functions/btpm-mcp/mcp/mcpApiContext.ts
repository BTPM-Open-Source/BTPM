// API-Q.7A — Minimal, pure MCP → canonical API context bridge.
//
// The canonical delegated Organizations reader expects the accepted
// `AuthenticatedApiContext`. This module derives that context EXCLUSIVELY from
// the already accepted `McpAuthorizedContext` produced by
// `authorizeMcpConnectedApp`.
//
// This module MUST NOT: read headers, query parameters, bodies, MCP `_meta` or
// tool arguments; re-run Connected App authorization; construct a Supabase
// client; read `Deno.env`; call the database; log; cache; or hold mutable
// global state. It performs no I/O whatsoever.
//
// The caller's raw bearer token deliberately never appears here.

import type { AuthenticatedApiContext } from "../../_shared/btpm-api/authenticateApiRequest.ts";
import type { McpAuthorizedContext } from "./authorizeMcpConnectedApp.ts";

/**
 * Bounded internal bridge failure. It carries no caller data, no governance
 * reason and no provider detail.
 */
export class McpApiContextError extends Error {
  constructor() {
    super("mcp_api_context_invalid");
    this.name = "McpApiContextError";
  }
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => isNonBlank(entry));
}

/**
 * Builds the canonical authenticated API context from an authorized MCP
 * context. Fails closed when internal identity is missing or inconsistent.
 * No value is ever substituted, defaulted or manufactured.
 */
export function buildAuthenticatedApiContextFromMcp(
  authorized: McpAuthorizedContext,
): AuthenticatedApiContext {
  if (authorized === null || typeof authorized !== "object") {
    throw new McpApiContextError();
  }

  const userId: unknown = authorized.userId;
  const apiClientId: unknown = authorized.apiClientId;
  const oauthClientId: unknown = authorized.oauthClientId;
  const policyVersionId: unknown = authorized.policyVersionId;
  const issuer: unknown = authorized.issuer;
  const audiences: unknown = authorized.audiences;
  const expiresAt: unknown = authorized.expiresAt;

  if (
    !isNonBlank(userId) ||
    !isNonBlank(apiClientId) ||
    !isNonBlank(oauthClientId) ||
    !isNonBlank(policyVersionId) ||
    !isNonBlank(issuer) ||
    !isStringArray(audiences) ||
    audiences.length === 0 ||
    !isPositiveSafeInteger(expiresAt)
  ) {
    throw new McpApiContextError();
  }

  return Object.freeze({
    token: Object.freeze({
      userId,
      // The canonical API token context client identity is the OAuth client ID.
      clientId: oauthClientId,
      issuer,
      audiences: Object.freeze([...audiences]),
      expiresAt,
    }),
    client: Object.freeze({
      userId,
      apiClientId,
      oauthClientId,
      policyVersionId,
    }),
  });
}
