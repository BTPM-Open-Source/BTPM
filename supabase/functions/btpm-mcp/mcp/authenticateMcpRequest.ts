// API-Q.4 — MCP bearer-token authentication (authentication only).
//
// This module reuses the accepted shared token-verification architecture
// (`_shared/btpm-api/resolveTokenContext.ts`). It creates NO competing JWT
// verifier and duplicates no authentication business logic.
//
// It authenticates the OAuth access token against the canonical MCP protected
// resource. It MUST NOT: look up `api_clients`, evaluate Connected App status,
// capability grants, policy acknowledgement, revocation, Organization /
// Workspace authority, or Project enablement. Those remain API-Q.5 / canonical
// API responsibilities.
//
// Only the signed JWT `client_id` claim is authoritative for client identity.
// Headers, query parameters, bodies and MCP tool arguments are never consulted.

import {
  resolveTokenContext,
  type TokenContextDependencies,
} from "../../_shared/btpm-api/resolveTokenContext.ts";

/**
 * The smallest authenticated MCP context required by later API-Q steps.
 * Deliberately carries no tenant/organization/workspace/project ID, no roles,
 * no capability decision, and no provenance channel.
 */
export interface McpAuthenticationContext {
  readonly userId: string;
  readonly clientId: string;
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly expiresAt: number;
  readonly resourceUri: string;
  readonly requestId: string;
}

export interface McpAuthenticationConfig {
  /** Normalized `SUPABASE_URL` + "/auth/v1". */
  readonly expectedIssuer: string;
  /** Canonical `BTPM_MCP_RESOURCE_URI`; the required token audience. */
  readonly resourceUri: string;
}

/**
 * Authenticates one MCP protocol request. The expected audience is the
 * canonical MCP resource URI only — a token whose audience is merely
 * `authenticated` does not authenticate to MCP.
 */
export async function authenticateMcpRequest(
  request: Request,
  config: McpAuthenticationConfig,
  deps: TokenContextDependencies,
  requestId: string,
): Promise<McpAuthenticationContext> {
  const token = await resolveTokenContext(
    request,
    {
      expectedIssuer: config.expectedIssuer,
      expectedAudience: config.resourceUri,
    },
    deps,
  );

  return Object.freeze({
    userId: token.userId,
    clientId: token.clientId,
    issuer: token.issuer,
    audiences: token.audiences,
    expiresAt: token.expiresAt,
    resourceUri: config.resourceUri,
    requestId,
  });
}
