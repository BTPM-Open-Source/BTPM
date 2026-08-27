// API-Q WML-1C — MCP read exposure for the canonical `workspace_members.get`
// operation.
//
// This module is a THIN ADAPTER, following the accepted API-Q.7A/7B
// `organizationsReadTool.ts` / `workspacesReadTool.ts` precedent exactly. It
// contains NO membership logic, NO Tenant/Organization containment rule, NO
// RLS logic, NO pagination logic, NO SQL and NO RPC contract. It does not
// implement `api_v1_list_workspace_members`, never calls it directly, never
// calls `.from()` on business tables, never uses a service-role client, and
// never performs an HTTP call to `btpm-api-v1`.
//
// Everything authoritative is reused verbatim from the accepted WML-1B slice:
//   - Workspace-id validation      : `parseApiV1WorkspaceMembersPath`
//   - query validation/defaulting  : `parseApiV1WorkspaceMembersQuery`
//   - route identity               : `WORKSPACE_MEMBERS_ROUTE.id`
//   - rate-limit enforcement       : `enforceApiRateLimit` + Supabase adapters
//   - caller-scoped business read  : delegated Workspace-member reader
//   - trusted identity bridge      : `buildAuthenticatedApiContextFromMcp`
//
// The caller's raw bearer token flows ONLY through the accepted delegated
// reader, which extracts it from the original `Request`. It is never copied
// into the trusted execution context, tool arguments, registry metadata, tool
// output or any log.
//
// This is an explicit single-operation adapter by design: no generic read-tool
// executor, no parameterized route/parser/reader/RPC indirection.

import { z } from "npm:zod@4.4.3";

import {
  WORKSPACE_MEMBERS_ROUTE,
  parseApiV1WorkspaceMembersPath,
  parseApiV1WorkspaceMembersQuery,
} from "../../_shared/btpm-api/routes/workspaceMembers.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  enforceApiRateLimit,
  type ApiRateLimitStore,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import type { ApiV1WorkspaceMembersPayload } from "../../_shared/btpm-api/supabaseWorkspaceMembers.ts";
import type { DelegatedApiV1WorkspaceMembersReader } from "../../_shared/btpm-api/supabaseDelegatedWorkspaceMembers.ts";
import type { McpAuthorizedContext } from "./authorizeMcpConnectedApp.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import { buildAuthenticatedApiContextFromMcp } from "./mcpApiContext.ts";
import type { McpToolErrorCategory } from "./organizationsReadTool.ts";

/** Advertised MCP tool name for canonical `workspace_members.get`. */
export const MCP_WORKSPACE_MEMBERS_TOOL_NAME = "btpm_list_workspace_members";

/**
 * MCP tool input schema (MCP SDK v2 Standard Schema mechanism, zod v4).
 *
 * Structural types only. This schema is NOT the authority: canonical
 * Workspace-id validation, pagination bounds, search length and defaulting
 * remain owned by the accepted WML-1B parsers.
 */
export const MCP_WORKSPACE_MEMBERS_TOOL_INPUT_SCHEMA = z.object({
  workspaceId: z.string(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
  search: z.string().optional(),
});

/** Untrusted, already schema-validated MCP tool arguments. */
export interface McpWorkspaceMembersToolArguments {
  readonly workspaceId: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly search?: string;
}

/** The only external messages a Workspace-member tool failure may disclose. */
export const MCP_WORKSPACE_MEMBERS_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpToolErrorCategory, string>
> = Object.freeze({
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to access Workspace members.",
  rate_limited: "Rate limit exceeded. Try again later.",
  unavailable: "BTPM Workspace member read is temporarily unavailable.",
});

export type McpWorkspaceMembersToolResult =
  | { readonly ok: true; readonly payload: ApiV1WorkspaceMembersPayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

/** The single bounded executor the MCP server factory is allowed to know. */
export type McpWorkspaceMembersToolExecutor = (
  args: McpWorkspaceMembersToolArguments,
) => Promise<McpWorkspaceMembersToolResult>;

/** Per-request execution dependencies. No Supabase client, no service role. */
export interface McpWorkspaceMembersToolDependencies {
  /** The original authenticated MCP request; the delegated reader owns it. */
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1WorkspaceMembersReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

/**
 * Converts the typed MCP `workspaceId` argument into the equivalent canonical
 * API pathname. No normalization, repair or validation happens here: the value
 * reaches `parseApiV1WorkspaceMembersPath` unchanged so the canonical parser
 * remains the only Workspace-id authority.
 */
export function buildCanonicalWorkspaceMembersPathname(
  args: McpWorkspaceMembersToolArguments,
): string {
  return `/v1/workspaces/${String(args.workspaceId)}/members`;
}

/**
 * Converts typed MCP arguments into the equivalent canonical API query string.
 * Omitted optional fields stay omitted so the canonical parser applies the
 * canonical defaults (limit 50, offset 0, search null); invalid/out-of-range
 * values reach the canonical parser unchanged so it can fail closed.
 */
export function buildCanonicalWorkspaceMembersQueryString(
  args: McpWorkspaceMembersToolArguments,
): string {
  const parts: string[] = [];
  if (args.limit !== undefined) {
    parts.push(`limit=${encodeURIComponent(String(args.limit))}`);
  }
  if (args.offset !== undefined) {
    parts.push(`offset=${encodeURIComponent(String(args.offset))}`);
  }
  if (args.search !== undefined) {
    parts.push(`search=${encodeURIComponent(args.search)}`);
  }
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

function categorize(error: unknown): McpToolErrorCategory {
  if (error instanceof ApiHttpError) {
    if (error.code === "rate_limit_exceeded") return "rate_limited";
    if (error.code === "not_authorized") return "not_authorized";
    if (error.code === "invalid_request") return "invalid_arguments";
  }
  return "unavailable";
}

/**
 * Creates the per-request `workspace_members.get` MCP executor.
 *
 * Execution order (identical authority ordering to the REST runtime and to the
 * accepted API-Q.7A/7B read slices):
 *   1. derive the canonical API context from the authorized MCP context;
 *   2. resolve the database-controlled rate-limit profile;
 *   3. consume the atomic rate limit for client + user + route;
 *   4. validate the Workspace id through the canonical path parser;
 *   5. validate/default options through the canonical query parser;
 *   6. read through the accepted caller-scoped delegated reader.
 */
export function createMcpWorkspaceMembersToolExecutor(
  dependencies: McpWorkspaceMembersToolDependencies,
): McpWorkspaceMembersToolExecutor {
  return async function executeWorkspaceMembersRead(
    args: McpWorkspaceMembersToolArguments,
  ): Promise<McpWorkspaceMembersToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        WORKSPACE_MEMBERS_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: WORKSPACE_MEMBERS_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const path = parseApiV1WorkspaceMembersPath(
        buildCanonicalWorkspaceMembersPathname(args),
      );

      const query = parseApiV1WorkspaceMembersQuery(
        buildCanonicalWorkspaceMembersQueryString(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        path.workspaceId,
        query.limit,
        query.offset,
        query.search,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      // Only a bounded category escapes: no SQLSTATE, database message, stack,
      // provider error, policy/version ID or internal authorization reason.
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
