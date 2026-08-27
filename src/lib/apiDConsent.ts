/**
 * API-D.4 — Shared browser-side validators and helpers for the
 * membership-aware consent UX. Mirrors the exact `_client_key` and
 * `_correlation_id` shapes accepted by the API-D.2 read function and the
 * API-D.3 acknowledge/revoke commands. All values are re-validated at
 * every read/write boundary and never persisted anywhere in the browser
 * (no localStorage, sessionStorage, cookies, IndexedDB, logs, analytics,
 * or global persistent context).
 */
import { sanitizeReturnTo } from "@/lib/authReturnTo";

// Exact character/length contract as accepted by API-D.3.
// Total length: 3..64. Must start and end with [a-z0-9]. Middle chars
// may include `_`, `.`, `-`.
const CLIENT_KEY_RE = /^[a-z0-9][a-z0-9_.-]{1,62}[a-z0-9]$/;

// Exact API-D.3 correlation-ID contract: 1..64 chars of [A-Za-z0-9_-].
const CORRELATION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Return the input if it is a safe non-secret client key exactly matching
 * the API-D.3 accepted shape, otherwise `null`. Never throws.
 */
export function sanitizeApiDClientKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Reject any control character (including CR/LF/TAB/NUL) — never trust
  // strings that carry hidden framing even if the regex would clip them.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  if (value.length < 3 || value.length > 64) return null;
  return CLIENT_KEY_RE.test(value) ? value : null;
}

/**
 * Sanitize the internal BTPM `return_to` context.
 *
 * Reuses the accepted `sanitizeReturnTo` posture, then additionally
 * rejects:
 *  - anything containing an ASCII control character;
 *  - loops into the auth surface (`/auth`, `/auth/callback`,
 *    `/auth/ms-callback`, `/consent/api-d`, `/reset-password`,
 *    `/accept-invite`);
 *  - encoded absolute/protocol-relative payloads
 *    (`%2F%2F…`, `%68%74%74%70…`, `%2Fauth`).
 */
export function sanitizeApiDReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return "/";
  const base = sanitizeReturnTo(value);
  if (base === "/") return "/";
  const lower = base.toLowerCase();
  // Encoded protocol-relative or absolute URL smuggling.
  if (
    lower.includes("%2f%2f") ||
    lower.startsWith("/%2f") ||
    lower.includes("%5c") ||
    lower.startsWith("/%5c")
  ) {
    return "/";
  }
  // Deny nested schemes even when URL-encoded (e.g. `/redirect?u=http%3A//`).
  if (/%3a|%3c|%3e|%00/i.test(lower)) return "/";
  // Prevent authentication-callback and consent-loop redirects.
  const forbiddenPrefixes = [
    "/auth",
    "/consent/api-d",
    "/reset-password",
    "/accept-invite",
  ];
  for (const prefix of forbiddenPrefixes) {
    if (lower === prefix || lower.startsWith(`${prefix}/`) || lower.startsWith(`${prefix}?`)) {
      return "/";
    }
  }
  return base;
}

/**
 * Build the internal login-return path back to the consent route,
 * preserving only a validated client key and a validated nested
 * `return_to`. Returns a plain internal path suitable for `returnTo=`
 * on `/auth`. Callers must NOT persist the result anywhere.
 */
export function buildApiDConsentReturnPath(input: {
  clientKey: unknown;
  returnTo?: unknown;
}): string | null {
  const key = sanitizeApiDClientKey(input.clientKey);
  if (!key) return null;
  const params = new URLSearchParams();
  params.set("client_key", key);
  const nested = sanitizeApiDReturnTo(input.returnTo);
  if (nested !== "/") {
    params.set("return_to", nested);
  }
  return `/consent/api-d?${params.toString()}`;
}

/**
 * Only permit an absolute HTTPS URL for a policy link. Anything else
 * (missing, blank, http, javascript:, data:, relative path, control
 * characters, malformed) resolves to `null`. Callers must render the
 * policy version as plain text when this returns `null`.
 */
export function sanitizePolicyUri(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  return parsed.toString();
}

/**
 * Generate an opaque bounded correlation ID that matches the exact
 * API-D.3 accepted contract. Uses Web Crypto when available; falls back
 * to a bounded pseudo-random string with the same character set and
 * length constraints. Never persisted anywhere.
 */
export function generateApiDCorrelationId(): string {
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined;
  let candidate: string;
  if (cryptoObj?.randomUUID) {
    candidate = cryptoObj.randomUUID().replace(/-/g, "");
  } else if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    candidate = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } else {
    candidate = `apidfallback${Date.now()}${Math.floor(Math.random() * 1e12)}`;
  }
  const normalized = `apid_${candidate}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  // Defensive guard: if for any reason normalization produced an
  // out-of-contract value, replace with a safe bounded literal.
  return CORRELATION_ID_RE.test(normalized) ? normalized : "apid_correlation";
}

export const __API_D_TESTING = {
  CLIENT_KEY_RE,
  CORRELATION_ID_RE,
};
