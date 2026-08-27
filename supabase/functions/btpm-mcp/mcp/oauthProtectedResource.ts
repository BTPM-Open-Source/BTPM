// API-Q.4 — MCP OAuth protected-resource boundary helpers (pure).
//
// This module is PURE configuration + document construction. It MUST NOT read
// the environment, open network connections, construct Supabase clients, touch
// the database, execute SQL/RPC, register routes, authenticate, or implement
// any BTPM PM-domain behavior.
//
// It owns exactly three concerns:
//   1. validation/normalization of the server-controlled canonical MCP
//      resource URI (`BTPM_MCP_RESOURCE_URI`);
//   2. derivation of the Supabase Auth authorization-server issuer from
//      `SUPABASE_URL`, using the same rule as the canonical BTPM REST API;
//   3. construction of the MCP Protected Resource Metadata document, its
//      absolute URL, and the standards-compatible `WWW-Authenticate` challenge.
//
// No OAuth scopes are invented and Dynamic Client Registration is neither
// advertised nor implemented. BTPM business authorization continues to come
// from Connected App capability governance, not OAuth scope names.

/** Deterministic metadata path suffix owned by the `btpm-mcp` function. */
export const MCP_PROTECTED_RESOURCE_METADATA_PATH_SUFFIX =
  "/.well-known/oauth-protected-resource";

// UX-MCP-ADMIN.1-C1: the bounded configuration error and the canonical resource
// URI normalization now live in `_shared/btpm-api/mcpResourceUri.ts` so other
// deployed functions reuse the exact same rules. Re-exported unchanged here.
import {
  McpResourceConfigurationError,
  normalizeMcpResourceUri,
  stripTrailingSlashes,
} from "../../_shared/btpm-api/mcpResourceUri.ts";

export { McpResourceConfigurationError, normalizeMcpResourceUri };


/**
 * Derives the Supabase Auth authorization-server issuer exactly as the
 * canonical BTPM REST API does: normalized `SUPABASE_URL` + `/auth/v1`.
 * No second OAuth server is created and no Supabase endpoint is proxied.
 */
export function deriveSupabaseAuthorizationServer(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new McpResourceConfigurationError("invalid_supabase_url");
  }
  const candidate = stripTrailingSlashes(raw.trim());
  if (candidate.length === 0) {
    throw new McpResourceConfigurationError("invalid_supabase_url");
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new McpResourceConfigurationError("invalid_supabase_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new McpResourceConfigurationError("invalid_supabase_url");
  }
  return candidate + "/auth/v1";
}

/** Absolute URL of the metadata document served by this function. */
export function mcpProtectedResourceMetadataUrl(resourceUri: string): string {
  return resourceUri + MCP_PROTECTED_RESOURCE_METADATA_PATH_SUFFIX;
}

/** True when the request path targets this function's metadata document. */
export function isMcpProtectedResourceMetadataPath(pathname: string): boolean {
  return pathname === MCP_PROTECTED_RESOURCE_METADATA_PATH_SUFFIX ||
    pathname.endsWith(MCP_PROTECTED_RESOURCE_METADATA_PATH_SUFFIX);
}

/** The MCP Protected Resource Metadata document. Contains no secrets. */
export interface McpProtectedResourceMetadata {
  readonly resource: string;
  readonly authorization_servers: readonly string[];
  readonly bearer_methods_supported: readonly string[];
}

export function buildMcpProtectedResourceMetadata(
  resourceUri: string,
  authorizationServer: string,
): McpProtectedResourceMetadata {
  return Object.freeze({
    resource: resourceUri,
    authorization_servers: Object.freeze([authorizationServer]),
    bearer_methods_supported: Object.freeze(["header"]),
  });
}

/**
 * Standards-compatible Bearer challenge. Carries only the protected resource
 * identifier and the discovery URL — never an internal failure reason.
 */
export function buildMcpWwwAuthenticate(resourceUri: string): string {
  const metadataUrl = mcpProtectedResourceMetadataUrl(resourceUri);
  return `Bearer resource="${resourceUri}", ` +
    `resource_metadata="${metadataUrl}"`;
}

/**
 * UX-GAP.2C — reauthentication challenge. Identical to the canonical challenge
 * plus the standard `error="invalid_token"` signal so an external MCP client
 * knows the existing authorization must be renewed. Carries no
 * `error_description`, no policy wording and no identifier.
 */
export function buildMcpInvalidTokenWwwAuthenticate(
  resourceUri: string,
): string {
  return `${buildMcpWwwAuthenticate(resourceUri)}, error="invalid_token"`;
}

