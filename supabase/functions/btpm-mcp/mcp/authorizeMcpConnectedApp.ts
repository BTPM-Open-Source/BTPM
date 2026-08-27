// API-Q.5 — MCP Connected App binding (thin composition only).
//
// This module contains NO Connected App governance rule. Every rule about
// active `api_clients` resolution, active policy version resolution and
// delegated-user policy acknowledgement lives in the accepted canonical
// implementation `_shared/btpm-api/authorizeClient.ts` and is reused verbatim.
//
// This module MUST NOT: query PostgreSQL, construct a Supabase client, read
// `Deno.env`, evaluate capability grants, derive tenant/organization/workspace/
// project authority, set provenance, or execute any BTPM operation.

import {
  authorizeClient,
  type ClientAuthorizationStore,
} from "../../_shared/btpm-api/authorizeClient.ts";
import {
  ApiAuthenticationError,
  type ApiAuthenticationErrorCode,
} from "../../_shared/btpm-api/apiErrors.ts";
import type { McpAuthenticationContext } from "./authenticateMcpRequest.ts";

/**
 * UX-GAP.2C — the exact recoverable application-policy acknowledgement states.
 * Only these require the external MCP client to re-enter OAuth authorization.
 */
const REAUTHENTICATION_REQUIRED_CODES: ReadonlySet<
  ApiAuthenticationErrorCode
> = new Set<ApiAuthenticationErrorCode>([
  "policy_acknowledgement_missing",
  "policy_acknowledgement_stale",
  "policy_acknowledgement_revoked",
]);

/**
 * Bounded MCP Connected App authorization failure. Deliberately carries no
 * governance reason, no provider error and no database detail: the transport
 * maps it to one generic 403.
 *
 * UX-GAP.2C adds exactly one bounded public signal — `reauthenticationRequired`
 * — which is true only for the three recoverable policy-acknowledgement states.
 * The underlying error code, message and cause remain unexposed.
 */
export class McpConnectedAppAuthorizationError extends Error {
  public readonly reauthenticationRequired: boolean;

  constructor(cause?: unknown) {
    super("mcp_connected_app_forbidden");
    this.name = "McpConnectedAppAuthorizationError";
    this.reauthenticationRequired = cause instanceof ApiAuthenticationError &&
      REAUTHENTICATION_REQUIRED_CODES.has(cause.code);
    if (cause !== undefined) this.cause = cause;
  }
}


/**
 * The smallest authorized MCP execution context required by later API-Q steps.
 *
 * Intentionally excludes tenantId, organizationId, workspaceId, projectId,
 * capability decisions, source_channel / source system-component provenance,
 * idempotency and business authorization results.
 */
export interface McpAuthorizedContext {
  readonly userId: string;
  /** Internal `public.api_clients.id` resolved by `authorizeClient`. */
  readonly apiClientId: string;
  /** Authoritative `api_clients.oauth_client_id` returned by `authorizeClient`. */
  readonly oauthClientId: string;
  /** Exact active `public.api_client_policy_versions.id`. */
  readonly policyVersionId: string;
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly expiresAt: number;
  readonly resourceUri: string;
  readonly requestId: string;
}

/**
 * Authorizes an already-authenticated MCP request against canonical BTPM
 * Connected App governance.
 *
 * The only client identity input is `authenticated.clientId`, which originates
 * from the signed JWT `client_id` claim. Headers, query parameters, bodies,
 * MCP `_meta` and tool arguments are never consulted here.
 */
export async function authorizeMcpConnectedApp(
  authenticated: McpAuthenticationContext,
  store: ClientAuthorizationStore,
): Promise<McpAuthorizedContext> {
  let authorized: {
    userId: string;
    apiClientId: string;
    oauthClientId: string;
    policyVersionId: string;
  };
  try {
    authorized = await authorizeClient(
      authenticated.userId,
      authenticated.clientId,
      store,
    );
  } catch (cause) {
    // Every canonical governance failure collapses to one bounded error.
    throw new McpConnectedAppAuthorizationError(cause);
  }

  return Object.freeze({
    userId: authorized.userId,
    apiClientId: authorized.apiClientId,
    // Authoritative value is the one returned by `authorizeClient`.
    oauthClientId: authorized.oauthClientId,
    policyVersionId: authorized.policyVersionId,
    issuer: authenticated.issuer,
    audiences: authenticated.audiences,
    expiresAt: authenticated.expiresAt,
    resourceUri: authenticated.resourceUri,
    requestId: authenticated.requestId,
  });
}
