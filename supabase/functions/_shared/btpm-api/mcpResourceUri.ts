// UX-MCP-ADMIN.1-C1 — Shared canonical MCP resource-URI validation/normalization.
//
// Relocated verbatim from `btpm-mcp/mcp/oauthProtectedResource.ts` (which now
// re-exports from here) so that other deployed Edge Functions can reuse the
// SAME validation rules without duplicating them and without importing across
// function deployment packages.
//
// PURE module: no environment reads, no network, no Supabase client, no SQL.

/** Bounded, non-leaking configuration failure. */
export class McpResourceConfigurationError extends Error {
  public readonly code: "invalid_mcp_resource_uri" | "invalid_supabase_url";

  constructor(code: "invalid_mcp_resource_uri" | "invalid_supabase_url") {
    super(code);
    this.name = "McpResourceConfigurationError";
    this.code = code;
  }
}

export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return value.slice(0, end);
}

/**
 * Validates and normalizes the canonical MCP resource URI. Fails closed on any
 * malformed or unsafe value.
 *
 * Never derive this from request headers, query parameters, bodies, tool
 * arguments, or MCP client metadata.
 */
export function normalizeMcpResourceUri(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new McpResourceConfigurationError("invalid_mcp_resource_uri");
  }
  const candidate = raw.trim();
  if (candidate.length === 0) {
    throw new McpResourceConfigurationError("invalid_mcp_resource_uri");
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new McpResourceConfigurationError("invalid_mcp_resource_uri");
  }
  if (url.protocol !== "https:") {
    throw new McpResourceConfigurationError("invalid_mcp_resource_uri");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new McpResourceConfigurationError("invalid_mcp_resource_uri");
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new McpResourceConfigurationError("invalid_mcp_resource_uri");
  }
  if (url.hostname.length === 0) {
    throw new McpResourceConfigurationError("invalid_mcp_resource_uri");
  }
  return url.origin + stripTrailingSlashes(url.pathname);
}
