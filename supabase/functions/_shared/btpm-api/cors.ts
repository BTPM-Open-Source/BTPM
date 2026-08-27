// API-G.1C — Exact-origin CORS utility for the future btpm-api-v1 runtime.
//
// This module is a pure utility. It performs no environment reads, holds no
// mutable global state, and does not construct routes, runtimes, or preflight
// handlers. The caller supplies the parsed allowlist and the incoming Request.
//
// The rejected origin and configured allowlist MUST NEVER appear in the public
// error surface — only the stable `cors_origin_denied` code and public message
// are ever serialized.

import { ApiHttpError } from "./http.ts";

// API-I.9B — exactly one mutation method is added. The single POST route is
// enforced by the HTTP handler; CORS advertises the transport methods only.
// API-K.7 — PATCH is advertised for the external Risk update route. The exact
// route/method pairing (and the validated Risk path) remains enforced by the
// HTTP handler; the allowed-origin architecture and headers are unchanged.
// API-M.11C — PUT is advertised for the single external Task assignment route.
// The exact route/method pairing remains enforced by the HTTP handler.
const ALLOWED_METHODS = "GET, POST, PATCH, PUT, OPTIONS";
const ALLOWED_HEADERS =
  "Authorization, Content-Type, X-Request-ID, X-Correlation-ID, Idempotency-Key";
const EXPOSED_HEADERS = "X-Request-ID";
const MAX_AGE = "600";

/**
 * Validate a single allowlist entry and return its normalized `URL.origin`.
 * Returns null when the entry is unusable (malformed URL / wrong protocol /
 * credentials / non-root path / query / fragment).
 */
function normalizeAllowedEntry(entry: string): string | null {
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.pathname !== "" && url.pathname !== "/") return null;
  if (url.search !== "") return null;
  if (url.hash !== "") return null;
  return url.origin;
}

/**
 * Validate an incoming request `Origin` header and return its normalized
 * `URL.origin`. Returns null when the value is unusable.
 */
function normalizeRequestOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.indexOf(",") !== -1) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.pathname !== "" && url.pathname !== "/") return null;
  if (url.search !== "") return null;
  if (url.hash !== "") return null;
  return url.origin;
}

export function parseAllowedOrigins(
  raw: string | undefined,
): ReadonlySet<string> {
  if (raw === undefined) return new Set<string>();
  const trimmedWhole = raw.trim();
  if (trimmedWhole.length === 0) return new Set<string>();

  const result = new Set<string>();
  const parts = raw.split(",");
  for (const part of parts) {
    const entry = part.trim();
    if (entry.length === 0) continue;
    if (entry.indexOf("*") !== -1) {
      // Wildcards are never acceptable in an exact-origin allowlist.
      throw new ApiHttpError("internal_error");
    }
    const normalized = normalizeAllowedEntry(entry);
    if (normalized === null) {
      throw new ApiHttpError("internal_error");
    }
    result.add(normalized);
  }
  return result;
}

export function buildCorsHeaders(
  request: Request,
  allowedOrigins: ReadonlySet<string>,
): Headers {
  const headers = new Headers();
  const rawOrigin = request.headers.get("Origin");

  if (rawOrigin === null) {
    headers.set("Vary", "Origin");
    return headers;
  }

  const normalized = normalizeRequestOrigin(rawOrigin);
  if (normalized === null) {
    throw new ApiHttpError("cors_origin_denied");
  }
  if (!allowedOrigins.has(normalized)) {
    throw new ApiHttpError("cors_origin_denied");
  }

  headers.set("Access-Control-Allow-Origin", normalized);
  headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  headers.set("Access-Control-Expose-Headers", EXPOSED_HEADERS);
  headers.set("Access-Control-Max-Age", MAX_AGE);
  headers.set("Vary", "Origin");
  return headers;
}
