// API-E.R3 — Shared Edge Authentication Middleware Foundation.
//
// Bearer extraction, verified-claim validation, and current-user/session
// confirmation. Fully dependency-injected: no live Supabase, database,
// OAuth client, environment secret, or network call is required.

import { ApiAuthenticationError } from "./apiErrors.ts";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface VerifiedTokenClaims {
  iss: string;
  aud: string | string[];
  exp: number;
  sub: string;
  // The signed OAuth client identifier. Only this signed claim is
  // authoritative for client identity — never headers, body or query.
  client_id: string;
  // Additional claims may exist; they must never be used for authorization
  // in this middleware.
  [key: string]: unknown;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedTokenClaims>;
}

export interface CurrentUserResolver {
  /** Returns the current authenticated user's ID for the presented token. */
  resolveCurrentUserId(token: string): Promise<string | null>;
}

export interface ClockSource {
  nowSeconds(): number;
}

export interface TokenContextConfig {
  expectedIssuer: string;
  expectedAudience: string;
}

export interface TokenContextDependencies {
  tokenVerifier: TokenVerifier;
  currentUserResolver: CurrentUserResolver;
  clock: ClockSource;
}

export interface TokenContext {
  readonly userId: string;
  readonly clientId: string;
  readonly issuer: string;
  readonly audiences: readonly string[];
  readonly expiresAt: number;
}

// -----------------------------------------------------------------------------
// Bearer extraction
// -----------------------------------------------------------------------------

const BEARER_SCHEME = /^bearer$/i;
// Conservative signed client_id validation:
//   - 3..128 characters
//   - ASCII letters, digits, and the URL-safe set `-`, `_`, `.`, `:`, `/`.
const CLIENT_ID_PATTERN = /^[A-Za-z0-9\-_.:/]{3,128}$/;

export function extractBearerToken(request: Request): string {
  // Headers.get is case-insensitive per Fetch spec.
  const raw = request.headers.get("Authorization");
  if (raw === null) {
    throw new ApiAuthenticationError("missing_bearer_token");
  }
  const value = raw.trim();
  if (value.length === 0) {
    throw new ApiAuthenticationError("missing_bearer_token");
  }
  // Reject combined/multiple credentials (comma-combined per RFC 7235).
  if (value.includes(",")) {
    throw new ApiAuthenticationError("malformed_bearer_token");
  }
  const parts = value.split(/\s+/);
  if (parts.length === 1 && BEARER_SCHEME.test(parts[0])) {
    throw new ApiAuthenticationError("missing_bearer_token");
  }
  if (parts.length !== 2) {
    throw new ApiAuthenticationError("malformed_bearer_token");
  }
  const [scheme, token] = parts;
  if (!BEARER_SCHEME.test(scheme)) {
    throw new ApiAuthenticationError("malformed_bearer_token");
  }
  if (!token || token.length === 0) {
    throw new ApiAuthenticationError("missing_bearer_token");
  }
  // Bearer tokens must be a single opaque credential; whitespace/quotes are
  // not permitted.
  if (/["\s]/.test(token)) {
    throw new ApiAuthenticationError("malformed_bearer_token");
  }
  return token;
}

// -----------------------------------------------------------------------------
// Verified claim validation
// -----------------------------------------------------------------------------

function normalizeAudience(aud: unknown): string[] {
  if (typeof aud === "string") return [aud];
  if (Array.isArray(aud) && aud.every((v) => typeof v === "string")) {
    return aud as string[];
  }
  throw new ApiAuthenticationError("invalid_audience");
}

function validateClaims(
  claims: VerifiedTokenClaims,
  config: TokenContextConfig,
  nowSeconds: number,
): { audiences: string[] } {
  if (typeof claims.iss !== "string" || claims.iss !== config.expectedIssuer) {
    throw new ApiAuthenticationError("invalid_issuer");
  }
  const audiences = normalizeAudience(claims.aud);
  if (!audiences.includes(config.expectedAudience)) {
    throw new ApiAuthenticationError("invalid_audience");
  }
  if (
    typeof claims.exp !== "number" ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= nowSeconds
  ) {
    throw new ApiAuthenticationError("token_expired");
  }
  if (typeof claims.sub !== "string" || claims.sub.trim().length === 0) {
    throw new ApiAuthenticationError("missing_subject");
  }
  if (typeof claims.client_id !== "string" || claims.client_id.length === 0) {
    throw new ApiAuthenticationError("missing_client_id");
  }
  if (!CLIENT_ID_PATTERN.test(claims.client_id)) {
    throw new ApiAuthenticationError("invalid_client_id");
  }
  return { audiences };
}

// -----------------------------------------------------------------------------
// Public entry point
// -----------------------------------------------------------------------------

export async function resolveTokenContext(
  request: Request,
  config: TokenContextConfig,
  deps: TokenContextDependencies,
): Promise<TokenContext> {
  const token = extractBearerToken(request);

  let claims: VerifiedTokenClaims;
  try {
    claims = await deps.tokenVerifier.verify(token);
  } catch (cause) {
    throw new ApiAuthenticationError("invalid_token", cause);
  }
  if (!claims || typeof claims !== "object") {
    throw new ApiAuthenticationError("invalid_token");
  }

  const { audiences } = validateClaims(claims, config, deps.clock.nowSeconds());

  let currentUserId: string | null;
  try {
    currentUserId = await deps.currentUserResolver.resolveCurrentUserId(token);
  } catch (cause) {
    throw new ApiAuthenticationError("invalid_session", cause);
  }
  if (typeof currentUserId !== "string" || currentUserId.length === 0) {
    throw new ApiAuthenticationError("invalid_session");
  }
  if (currentUserId !== claims.sub) {
    throw new ApiAuthenticationError("subject_mismatch");
  }

  return Object.freeze({
    userId: claims.sub,
    clientId: claims.client_id,
    issuer: claims.iss,
    audiences: Object.freeze([...audiences]),
    expiresAt: claims.exp,
  });
}

// -----------------------------------------------------------------------------
// Supabase Auth adapters (production factories)
// -----------------------------------------------------------------------------
//
// Structural typing only — this file never imports or constructs a Supabase
// client, never reads `Deno.env`, and never references a service-role
// credential. Callers supply an already-created Supabase Auth client
// (typically the anon client) and these factories return the injectable
// interfaces above. Tokens and claims are never logged or returned raw.

interface SupabaseGetClaimsResult {
  data: { claims?: Record<string, unknown> | null } | null;
  error: unknown;
}

interface SupabaseGetUserResult {
  data: { user?: { id?: string | null } | null } | null;
  error: unknown;
}

/** Minimal structural surface required from the caller-supplied Auth client. */
export interface SupabaseAuthAdapterClient {
  auth: {
    getClaims(token: string): Promise<SupabaseGetClaimsResult>;
    getUser(token: string): Promise<SupabaseGetUserResult>;
  };
}

/**
 * Wrap a Supabase Auth client as a `TokenVerifier`. Uses the repository's
 * standard `auth.getClaims(token)` verified-claims pattern.
 */
export function createSupabaseTokenVerifier(
  authClient: SupabaseAuthAdapterClient,
): TokenVerifier {
  return {
    async verify(token: string): Promise<VerifiedTokenClaims> {
      const { data, error } = await authClient.auth.getClaims(token);
      if (error) throw new Error("token_verification_failed");
      const claims = data && (data as { claims?: unknown }).claims;
      if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
        throw new Error("token_verification_missing_claims");
      }
      return claims as VerifiedTokenClaims;
    },
  };
}

/**
 * Wrap a Supabase Auth client as a `CurrentUserResolver`. Uses
 * `auth.getUser(token)` and never trusts the JWT `sub` as a substitute for
 * the current-user lookup.
 */
export function createSupabaseCurrentUserResolver(
  authClient: SupabaseAuthAdapterClient,
): CurrentUserResolver {
  return {
    async resolveCurrentUserId(token: string): Promise<string | null> {
      const { data, error } = await authClient.auth.getUser(token);
      if (error) throw new Error("current_user_resolution_failed");
      const user = data && (data as { user?: { id?: unknown } | null }).user;
      if (!user) return null;
      const id = (user as { id?: unknown }).id;
      if (typeof id !== "string" || id.length === 0) return null;
      return id;
    },
  };
}
