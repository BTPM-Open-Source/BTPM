/**
 * OAuth 2.1 public-client Authorization Code + PKCE S256 proof harness.
 *
 * This module is intentionally isolated: it contains only pure, stateless helpers
 * and performs no network I/O, storage, token exchange, or runtime wiring. It is
 * meant to demonstrate that BTPM can construct a standards-aligned PKCE request
 * without enabling any OAuth provider or changing application behavior.
 */

export class OAuthProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthProofError";
  }
}

const BASE64URL_ALPHABET = /^[A-Za-z0-9_-]+$/;

// RFC 7636 code verifier: 43-128 characters from unreserved URL characters.
const VERIFIER_ALPHABET = /^[A-Za-z0-9-._~]+$/;
const MIN_VERIFIER_LEN = 43;
const MAX_VERIFIER_LEN = 128;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function base64UrlEncode(bytes: Uint8Array): string {
  const binary = Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join("");
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function generateHighEntropyValue(bytes = 32): string {
  const random = new Uint8Array(bytes);
  crypto.getRandomValues(random);
  return base64UrlEncode(random);
}

/**
 * Generate a high-entropy PKCE code verifier (32 bytes / 43 base64url chars).
 */
export function generateCodeVerifier(): string {
  return generateHighEntropyValue(32);
}

/**
 * Generate a high-entropy OAuth state value (32 bytes / 43 base64url chars).
 */
export function generateState(): string {
  return generateHighEntropyValue(32);
}

/**
 * Derive an RFC 7636 S256 code challenge from a compliant verifier.
 */
export async function deriveCodeChallenge(verifier: string): Promise<string> {
  if (!verifier || typeof verifier !== "string") {
    throw new OAuthProofError("Verifier must be a non-empty string");
  }
  if (
    verifier.length < MIN_VERIFIER_LEN ||
    verifier.length > MAX_VERIFIER_LEN ||
    !VERIFIER_ALPHABET.test(verifier)
  ) {
    throw new OAuthProofError(
      "Verifier must be 43-128 characters using ALPHA / DIGIT / '-' / '.' / '_' / '~'"
    );
  }
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

function isProtocolRelative(value: string): boolean {
  return value.startsWith("//");
}

function isAllowedHttpUrl(value: string): boolean {
  if (typeof value !== "string" || value.trim() === "") return false;
  if (isProtocolRelative(value)) return false;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return false;
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return false;
  }

  if (parsed.hash !== "") {
    return false;
  }

  if (parsed.protocol === "http:" && !LOOPBACK_HOSTS.has(parsed.hostname)) {
    return false;
  }

  return true;
}

function requireAllowedEndpoint(value: string): void {
  if (!isAllowedHttpUrl(value)) {
    throw new OAuthProofError(`Invalid authorizationEndpoint: ${value}`);
  }
  const parsed = new URL(value);
  // Reject any pre-existing query component. The raw-string check is needed
  // because some URL implementations normalize a trailing "?" to an empty
  // search string, which would otherwise allow a malformed endpoint through.
  if (value.includes("?") || parsed.search !== "") {
    throw new OAuthProofError(
      "authorizationEndpoint must not contain pre-existing query parameters"
    );
  }
}

function requireAllowedRedirectUri(value: string): void {
  if (!isAllowedHttpUrl(value)) {
    throw new OAuthProofError(`Invalid redirectUri: ${value}`);
  }
}

function requireNonEmptyString(value: string, label: string): void {
  if (!value || typeof value !== "string") {
    throw new OAuthProofError(`${label} must be a non-empty string`);
  }
}

export type BuildAuthorizationUrlInputs = {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scopes?: string[];
};

/**
 * Build an OAuth 2.1 Authorization Request URL with PKCE S256.
 *
 * Mandatory parameters are serialized exactly once. The authorization endpoint
 * must not carry any pre-existing query parameters, so no secret, token, or
 * duplicate OAuth fields can be injected via the endpoint URL.
 */
export function buildAuthorizationUrl({
  authorizationEndpoint,
  clientId,
  redirectUri,
  codeChallenge,
  state,
  scopes,
}: BuildAuthorizationUrlInputs): string {
  requireNonEmptyString(authorizationEndpoint, "authorizationEndpoint");
  requireNonEmptyString(clientId, "clientId");
  requireNonEmptyString(redirectUri, "redirectUri");
  requireNonEmptyString(codeChallenge, "codeChallenge");
  requireNonEmptyString(state, "state");

  requireAllowedEndpoint(authorizationEndpoint);
  requireAllowedRedirectUri(redirectUri);

  if (!BASE64URL_ALPHABET.test(codeChallenge)) {
    throw new OAuthProofError("codeChallenge must be base64url-safe");
  }

  if (!BASE64URL_ALPHABET.test(state)) {
    throw new OAuthProofError("state must be a non-empty base64url-safe string");
  }

  const url = new URL(authorizationEndpoint);
  const params = url.searchParams;

  params.set("response_type", "code");
  params.set("client_id", clientId);
  params.set("redirect_uri", redirectUri);
  params.set("code_challenge", codeChallenge);
  params.set("code_challenge_method", "S256");
  params.set("state", state);

  if (scopes && scopes.length > 0) {
    params.set("scope", scopes.join(" "));
  }

  return url.toString();
}
