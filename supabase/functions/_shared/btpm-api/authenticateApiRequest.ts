// API-E.R3 — Shared Edge Authentication Middleware Foundation.
//
// Composes bearer-token verification (`resolveTokenContext`) and
// client/consent authorization (`authorizeClient`) into a single
// fail-closed entry point.
//
// This function MUST NOT:
//   - establish api_e_private trusted context,
//   - invoke PMG,
//   - access business tables,
//   - authorize Organization/Workspace access or capability grants,
//   - modify the request,
//   - create an HTTP route,
//   - log tokens or claims.
//
// It is a pure, testable composition layer only. Route- and
// wrapper-specific authorization concerns remain separate.

import { ApiAuthenticationError } from "./apiErrors.ts";
import {
  resolveTokenContext,
  type TokenContext,
  type TokenContextConfig,
  type TokenContextDependencies,
} from "./resolveTokenContext.ts";
import {
  authorizeClient,
  type AuthorizedClientContext,
  type ClientAuthorizationStore,
} from "./authorizeClient.ts";

export interface AuthenticateApiRequestConfig extends TokenContextConfig {}

export interface AuthenticateApiRequestDependencies
  extends TokenContextDependencies {
  clientAuthorizationStore: ClientAuthorizationStore;
}

export interface AuthenticatedApiContext {
  readonly token: TokenContext;
  readonly client: AuthorizedClientContext;
}

export async function authenticateApiRequest(
  request: Request,
  config: AuthenticateApiRequestConfig,
  deps: AuthenticateApiRequestDependencies,
): Promise<AuthenticatedApiContext> {
  const token = await resolveTokenContext(request, config, deps);
  let client: AuthorizedClientContext;
  try {
    client = await authorizeClient(
      token.userId,
      token.clientId,
      deps.clientAuthorizationStore,
    );
  } catch (error) {
    if (error instanceof ApiAuthenticationError) throw error;
    throw new ApiAuthenticationError("authentication_internal_error", error);
  }
  return Object.freeze({ token, client });
}
