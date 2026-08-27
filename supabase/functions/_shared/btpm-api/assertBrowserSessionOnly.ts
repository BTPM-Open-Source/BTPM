// API-E.R4A — Browser-Only OAuth Denial Guard.
//
// Shared Edge guard used by BTPM browser-only Edge Functions (currently the
// OpenAI and Azure OpenAI read-only connection-test endpoints) to reject any
// cryptographically verified token that carries a signed `client_id` claim
// BEFORE any request-body parsing, service-role client construction,
// authority evaluation, integration-secret resolution, or external provider
// access.
//
// Ordinary BTPM browser sessions never carry a signed `client_id` claim and
// pass through unchanged. Verified OAuth-client tokens are denied via
// `client_disabled` (403). Forged headers, query parameters, or body fields
// are never inspected here — only the cryptographically verified claim
// object is authoritative.
//
// This guard MUST NOT:
//   - inspect X-BTPM-Client-ID, x-client-id, x-client-info, query params, or body
//   - call authenticateApiRequest or authorize an external client
//   - query a database, construct a Supabase client, or read Deno.env
//   - log tokens/claims or return raw claim material
//   - establish api_e_private trusted context

import { ApiAuthenticationError } from "./apiErrors.ts";
import {
  extractBearerToken,
  type TokenVerifier,
} from "./resolveTokenContext.ts";

/**
 * Reject verified OAuth-client tokens before any privileged processing.
 *
 * Returns successfully when — and only when — the verified claim object
 * does not own a `client_id` property at all. Any presence of `client_id`
 * on the verified claim object (including empty string, null, an owned
 * undefined, number, array, or object) is rejected with `client_disabled`.
 *
 * Verifier failures and non-object claim results are mapped to
 * `invalid_token`. Missing/malformed bearer tokens surface the accepted
 * bearer-error codes from `extractBearerToken`.
 */
export async function assertBrowserSessionOnly(
  request: Request,
  tokenVerifier: TokenVerifier,
): Promise<void> {
  const token = extractBearerToken(request);

  let claims: unknown;
  try {
    claims = await tokenVerifier.verify(token);
  } catch (cause) {
    throw new ApiAuthenticationError("invalid_token", cause);
  }
  if (
    claims === null ||
    typeof claims !== "object" ||
    Array.isArray(claims)
  ) {
    throw new ApiAuthenticationError("invalid_token");
  }

  // Only complete absence of the signed `client_id` property is allowed.
  // Use `hasOwnProperty` semantics via `Object.prototype.hasOwnProperty` so
  // inherited properties never accidentally pass the check.
  if (
    Object.prototype.hasOwnProperty.call(
      claims as Record<string, unknown>,
      "client_id",
    )
  ) {
    throw new ApiAuthenticationError("client_disabled");
  }
}
