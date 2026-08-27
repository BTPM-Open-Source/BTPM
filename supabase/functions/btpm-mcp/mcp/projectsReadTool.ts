// API-Q.7C — Third real MCP business-read vertical slice: `projects.get`.
//
// This module is a THIN ADAPTER, following the accepted API-Q.7A
// `organizationsReadTool.ts` and API-Q.7B `workspacesReadTool.ts` precedents
// exactly. It contains NO Project business logic, NO authorization/containment
// rule, NO RLS logic, NO pagination logic, NO SQL and NO RPC contract. It does
// not implement `api_v1_list_projects`, does not call `.from()` on business
// tables, never uses a service-role client, and never performs an HTTP call to
// `btpm-api-v1`.
//
// Everything authoritative is reused verbatim:
//   - query validation/defaulting  : `parseApiV1ProjectsQuery`
//   - route identity               : `PROJECTS_ROUTE.id`
//   - rate-limit enforcement       : `enforceApiRateLimit` + Supabase adapters
//   - caller-scoped business read  : `createDelegatedApiV1ProjectsReader`
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
  parseApiV1ProjectsQuery,
  PROJECTS_ROUTE,
} from "../../_shared/btpm-api/routes/projects.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import type { ApiV1ProjectsPayload } from "../../_shared/btpm-api/supabaseProjects.ts";
import type { DelegatedApiV1ProjectsReader } from "../../_shared/btpm-api/supabaseDelegatedProjects.ts";
import type { McpAuthorizedContext } from "./authorizeMcpConnectedApp.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import { buildAuthenticatedApiContextFromMcp } from "./mcpApiContext.ts";
import type { McpToolErrorCategory } from "./organizationsReadTool.ts";

/** Advertised MCP tool name for the canonical `projects.get` operation. */
export const MCP_PROJECTS_TOOL_NAME = "btpm_list_projects";

/**
 * MCP tool input schema (MCP SDK v2 Standard Schema mechanism, zod v4).
 *
 * These bounds exist only so the MCP client receives a usable schema. They are
 * NOT the authority: canonical validation, defaulting and limits remain owned
 * by `parseApiV1ProjectsQuery`. `workspaceId` is required.
 */
export const MCP_PROJECTS_TOOL_INPUT_SCHEMA = z.object({
  workspaceId: z.string(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
  search: z.string().optional(),
});

/** Untrusted, already schema-validated MCP tool arguments. */
export interface McpProjectsToolArguments {
  readonly workspaceId: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly search?: string;
}

/** The only external messages a Projects MCP tool failure may disclose. */
export const MCP_PROJECTS_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpToolErrorCategory, string>
> = Object.freeze({
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to access Projects.",
  rate_limited: "Rate limit exceeded. Try again later.",
  unavailable: "BTPM Projects read is temporarily unavailable.",
});

export type McpProjectsToolResult =
  | { readonly ok: true; readonly payload: ApiV1ProjectsPayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

/** The single bounded executor the MCP server factory is allowed to know. */
export type McpProjectsToolExecutor = (
  args: McpProjectsToolArguments,
) => Promise<McpProjectsToolResult>;

/** Per-request execution dependencies. No Supabase client, no service role. */
export interface McpProjectsToolDependencies {
  /** The original authenticated MCP request; the delegated reader owns it. */
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1ProjectsReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

/**
 * Converts typed MCP arguments into the equivalent canonical API query string.
 * No defaulting and no clamping happens here: omitted optional fields stay
 * omitted so the canonical parser applies the canonical defaults (limit 50,
 * offset 0, search null), and invalid/out-of-range values reach the canonical
 * parser unchanged so it can fail closed.
 */
export function buildCanonicalProjectsQueryString(
  args: McpProjectsToolArguments,
): string {
  const parts: string[] = [
    `workspace_id=${encodeURIComponent(String(args.workspaceId))}`,
  ];
  if (args.limit !== undefined) {
    parts.push(`limit=${encodeURIComponent(String(args.limit))}`);
  }
  if (args.offset !== undefined) {
    parts.push(`offset=${encodeURIComponent(String(args.offset))}`);
  }
  if (args.search !== undefined) {
    parts.push(`search=${encodeURIComponent(args.search)}`);
  }
  return `?${parts.join("&")}`;
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
 * Creates the per-request `projects.get` MCP executor.
 *
 * Execution order (identical authority ordering to the REST runtime and to the
 * accepted API-Q.7A/API-Q.7B slices):
 *   1. derive the canonical API context from the authorized MCP context;
 *   2. resolve the database-controlled rate-limit profile;
 *   3. consume the atomic rate limit for client + user + route;
 *   4. validate/default arguments through the canonical query parser;
 *   5. read through the accepted caller-scoped delegated Projects reader.
 */
export function createMcpProjectsToolExecutor(
  dependencies: McpProjectsToolDependencies,
): McpProjectsToolExecutor {
  return async function executeProjectsRead(
    args: McpProjectsToolArguments,
  ): Promise<McpProjectsToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        PROJECTS_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PROJECTS_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const query = parseApiV1ProjectsQuery(
        buildCanonicalProjectsQueryString(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        query,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      // Only a bounded category escapes: no SQLSTATE, database message, stack,
      // provider error, policy/version ID or internal authorization reason.
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
