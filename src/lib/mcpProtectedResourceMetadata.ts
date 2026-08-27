/**
 * UX-GAP.1A — Typed frontend reader for the BTPM MCP Protected Resource
 * Metadata document.
 *
 * The btpm-mcp Edge Function's `/.well-known/oauth-protected-resource`
 * document is the ONLY source of truth for the MCP audience / protected
 * resource identifier and its authorization server. This module:
 *   - constructs the metadata document URL from the existing frontend Supabase
 *     base URL (trailing-slash normalized);
 *   - fetches it with GET and no Authorization header (public by design);
 *   - strictly validates the document and fails closed.
 *
 * It never derives, fabricates, stores, or falls back to any audience value,
 * and never surfaces raw network/provider errors.
 */

export const MCP_PROTECTED_RESOURCE_METADATA_PATH =
  "/functions/v1/btpm-mcp/.well-known/oauth-protected-resource";

export interface McpProtectedResourceMetadata {
  readonly resource: string;
  readonly authorizationServer: string;
  readonly bearerMethodsSupported: readonly string[];
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return value.slice(0, end);
}

/** Builds the absolute metadata-document URL from the Supabase base URL. */
export function buildMcpProtectedResourceMetadataUrl(supabaseUrl: string): string | null {
  if (typeof supabaseUrl !== "string") return null;
  const base = stripTrailingSlashes(supabaseUrl.trim());
  if (base.length === 0) return null;
  try {
    const parsed = new URL(base);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  } catch {
    return null;
  }
  return base + MCP_PROTECTED_RESOURCE_METADATA_PATH;
}

function isValidResourceUri(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username.length > 0 || url.password.length > 0) return false;
  if (url.hash.length > 0) return false;
  return true;
}

function isValidAuthorizationServer(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Strictly validates a candidate metadata document. Returns `null` when the
 * document is malformed — the caller must treat that as unavailable.
 */
export function parseMcpProtectedResourceMetadata(
  candidate: unknown,
): McpProtectedResourceMetadata | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const record = candidate as Record<string, unknown>;

  if (!isValidResourceUri(record.resource)) return null;

  const servers = record.authorization_servers;
  if (!Array.isArray(servers) || servers.length === 0) return null;
  const authorizationServer = servers.find(isValidAuthorizationServer);
  if (typeof authorizationServer !== "string") return null;

  const methods = record.bearer_methods_supported;
  if (!Array.isArray(methods)) return null;
  const bearerMethods = methods.filter(
    (m): m is string => typeof m === "string" && m.trim().length > 0,
  );
  if (!bearerMethods.includes("header")) return null;

  return Object.freeze({
    resource: (record.resource as string).trim(),
    authorizationServer: authorizationServer.trim(),
    bearerMethodsSupported: Object.freeze(bearerMethods),
  });
}

/**
 * Fetches and validates the metadata document. Resolves to `null` on any
 * transport, status, parse, or validation failure. Never throws and never
 * exposes provider error text.
 */
export async function fetchMcpProtectedResourceMetadata(
  supabaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<McpProtectedResourceMetadata | null> {
  const url = buildMcpProtectedResourceMetadataUrl(supabaseUrl);
  if (!url) return null;
  try {
    const response = await fetchImpl(url, { method: "GET" });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return parseMcpProtectedResourceMetadata(body);
  } catch {
    return null;
  }
}
