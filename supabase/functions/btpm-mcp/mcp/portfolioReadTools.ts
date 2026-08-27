// API-Q Portfolio-8 — Explicit MCP business-read adapters for the three accepted
// canonical Portfolio reads: `portfolios.get`, `portfolios.get_by_id` and
// `portfolios.projects.get`.
//
// These are THIN ADAPTERS, following the accepted API-Q.7A/7B/7C/7D precedents
// (`organizationsReadTool.ts`, `workspacesReadTool.ts`, `projectsReadTool.ts`,
// `programsReadTools.ts`) exactly. They contain NO Portfolio business logic, NO
// authorization/containment rule, NO RLS logic, NO pagination logic, NO archive
// rule, NO encryption/decryption, NO SQL and NO RPC contract. They never call
// `.from()` on `portfolio_items` or any business table, never use a service-role
// client, and never perform an HTTP call to `btpm-api-v1`.
//
// Everything authoritative is reused verbatim:
//   - collection query validation/defaulting : `parseApiV1PortfoliosQuery`
//   - detail path validation                 : `parseApiV1PortfolioDetailPath`
//   - nested path/query validation           : `parseApiV1PortfolioProjectsPath`,
//                                              `parseApiV1PortfolioProjectsQuery`
//   - route identity                         : `PORTFOLIOS_ROUTE.id`,
//                                              `PORTFOLIO_DETAIL_ROUTE.id`,
//                                              `PORTFOLIO_PROJECTS_ROUTE.id`
//   - rate-limit enforcement                 : `enforceApiRateLimit`
//   - caller-scoped business read            : the three accepted delegated
//                                              Portfolio readers
//   - trusted identity bridge                : `buildAuthenticatedApiContextFromMcp`
//
// The caller's raw bearer token flows ONLY through the accepted delegated
// readers, which extract it from the original `Request`. It is never copied into
// the trusted execution context, tool arguments, registry metadata, tool output
// or any log.
//
// These are explicit per-operation adapters by design: no generic read-tool
// executor, no operationId → executor map, no parameterized
// route/parser/reader/RPC indirection.

import { z } from "npm:zod@4.4.3";

import {
  PORTFOLIO_DETAIL_ROUTE,
  PORTFOLIO_PROJECTS_ROUTE,
  PORTFOLIOS_ROUTE,
  parseApiV1PortfolioDetailPath,
  parseApiV1PortfolioProjectsPath,
  parseApiV1PortfolioProjectsQuery,
  parseApiV1PortfoliosQuery,
} from "../../_shared/btpm-api/routes/portfolios.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import type {
  ApiV1PortfolioDetailPayload,
  ApiV1PortfolioProjectsPayload,
  ApiV1PortfoliosPayload,
} from "../../_shared/btpm-api/supabasePortfolioRead.ts";
import type {
  DelegatedApiV1PortfolioProjectsReader,
  DelegatedApiV1PortfolioReader,
  DelegatedApiV1PortfoliosReader,
} from "../../_shared/btpm-api/supabaseDelegatedPortfolioRead.ts";
import type { McpAuthorizedContext } from "./authorizeMcpConnectedApp.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import { buildAuthenticatedApiContextFromMcp } from "./mcpApiContext.ts";
import type { McpToolErrorCategory } from "./organizationsReadTool.ts";

/** Advertised MCP tool name for the canonical `portfolios.get` operation. */
export const MCP_PORTFOLIOS_TOOL_NAME = "btpm_list_portfolios";

/** Advertised MCP tool name for the canonical `portfolios.get_by_id` operation. */
export const MCP_PORTFOLIO_DETAIL_TOOL_NAME = "btpm_get_portfolio";

/**
 * Advertised MCP tool name for the canonical `portfolios.projects.get`
 * operation.
 */
export const MCP_PORTFOLIO_PROJECTS_TOOL_NAME = "btpm_list_portfolio_projects";

/**
 * MCP tool input schemas (MCP SDK v2 Standard Schema mechanism, zod v4).
 *
 * These bounds exist only so the MCP client receives a usable schema. They are
 * NOT the authority: canonical validation, defaulting, limits, search rules and
 * archive semantics remain owned by the canonical Portfolio route parsers.
 */
export const MCP_PORTFOLIOS_TOOL_INPUT_SCHEMA = z.object({
  organizationId: z.string(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
  search: z.string().optional(),
  includeArchived: z.boolean().optional(),
});

export const MCP_PORTFOLIO_DETAIL_TOOL_INPUT_SCHEMA = z.object({
  portfolioId: z.string(),
});

export const MCP_PORTFOLIO_PROJECTS_TOOL_INPUT_SCHEMA = z.object({
  portfolioId: z.string(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
  search: z.string().optional(),
});

/** Untrusted, already schema-validated MCP tool arguments. */
export interface McpPortfoliosToolArguments {
  readonly organizationId: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly search?: string;
  readonly includeArchived?: boolean;
}

export interface McpPortfolioDetailToolArguments {
  readonly portfolioId: string;
}

export interface McpPortfolioProjectsToolArguments {
  readonly portfolioId: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly search?: string;
}

/** The only external messages a Portfolio MCP read failure may disclose. */
export const MCP_PORTFOLIO_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpToolErrorCategory, string>
> = Object.freeze({
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to access Portfolios.",
  rate_limited: "Rate limit exceeded. Try again later.",
  unavailable: "BTPM Portfolios read is temporarily unavailable.",
});

export type McpPortfoliosToolResult =
  | { readonly ok: true; readonly payload: ApiV1PortfoliosPayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

export type McpPortfolioDetailToolResult =
  | { readonly ok: true; readonly payload: ApiV1PortfolioDetailPayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

export type McpPortfolioProjectsToolResult =
  | { readonly ok: true; readonly payload: ApiV1PortfolioProjectsPayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

/** The bounded executors the MCP server factory is allowed to know. */
export type McpPortfoliosToolExecutor = (
  args: McpPortfoliosToolArguments,
) => Promise<McpPortfoliosToolResult>;

export type McpPortfolioDetailToolExecutor = (
  args: McpPortfolioDetailToolArguments,
) => Promise<McpPortfolioDetailToolResult>;

export type McpPortfolioProjectsToolExecutor = (
  args: McpPortfolioProjectsToolArguments,
) => Promise<McpPortfolioProjectsToolResult>;

/** Per-request execution dependencies. No Supabase client, no service role. */
export interface McpPortfoliosToolDependencies {
  /** The original authenticated MCP request; the delegated reader owns it. */
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1PortfoliosReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

export interface McpPortfolioDetailToolDependencies {
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1PortfolioReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

export interface McpPortfolioProjectsToolDependencies {
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1PortfolioProjectsReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

/**
 * Converts typed MCP arguments into the equivalent canonical API query string.
 * No defaulting and no clamping happens here: omitted optional fields stay
 * omitted so the canonical parser applies the canonical defaults (limit 50,
 * offset 0, search null, include_archived false), and invalid/out-of-range
 * values reach the canonical parser unchanged so it can fail closed.
 */
export function buildCanonicalPortfoliosQueryString(
  args: McpPortfoliosToolArguments,
): string {
  const parts: string[] = [
    `organization_id=${encodeURIComponent(String(args.organizationId))}`,
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
  if (args.includeArchived !== undefined) {
    parts.push(
      `include_archived=${encodeURIComponent(String(args.includeArchived))}`,
    );
  }
  return `?${parts.join("&")}`;
}

/**
 * Builds the canonical Portfolio detail pathname. The value is NOT encoded: the
 * canonical path parser is the sole authority and must see the caller value
 * verbatim so it can fail closed on separators, encoding and whitespace.
 */
export function buildCanonicalPortfolioDetailPath(
  args: McpPortfolioDetailToolArguments,
): string {
  return `/v1/portfolios/${String(args.portfolioId)}`;
}

/**
 * Builds the canonical nested Portfolio Projects pathname. Same posture: the
 * Portfolio identifier is passed verbatim to the canonical parser.
 */
export function buildCanonicalPortfolioProjectsPath(
  args: McpPortfolioProjectsToolArguments,
): string {
  return `/v1/portfolios/${String(args.portfolioId)}/projects`;
}

/**
 * Converts typed MCP arguments into the canonical nested Portfolio Projects
 * query string. When every optional field is omitted the canonical empty query
 * string is produced so the canonical parser yields the canonical defaults.
 */
export function buildCanonicalPortfolioProjectsQueryString(
  args: McpPortfolioProjectsToolArguments,
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
  if (parts.length === 0) {
    return "";
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
 * Creates the per-request `portfolios.get` MCP executor.
 *
 * Execution order (identical authority ordering to the REST runtime and to the
 * accepted API-Q.7A/7B/7C/7D slices):
 *   1. derive the canonical API context from the authorized MCP context;
 *   2. resolve the database-controlled rate-limit profile;
 *   3. consume the atomic rate limit for client + user + route;
 *   4. validate/default arguments through the canonical query parser;
 *   5. read through the accepted caller-scoped delegated Portfolios reader.
 */
export function createMcpPortfoliosToolExecutor(
  dependencies: McpPortfoliosToolDependencies,
): McpPortfoliosToolExecutor {
  return async function executePortfoliosRead(
    args: McpPortfoliosToolArguments,
  ): Promise<McpPortfoliosToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        PORTFOLIOS_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PORTFOLIOS_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const query = parseApiV1PortfoliosQuery(
        buildCanonicalPortfoliosQueryString(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        query,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      // Only a bounded category escapes: no SQLSTATE, database message, stack,
      // provider error, policy/version ID, Tenant ID or internal authorization
      // reason.
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}

/**
 * Creates the per-request `portfolios.get_by_id` MCP executor. Same authority
 * ordering; canonical path validation replaces canonical query parsing.
 */
export function createMcpPortfolioDetailToolExecutor(
  dependencies: McpPortfolioDetailToolDependencies,
): McpPortfolioDetailToolExecutor {
  return async function executePortfolioDetailRead(
    args: McpPortfolioDetailToolArguments,
  ): Promise<McpPortfolioDetailToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        PORTFOLIO_DETAIL_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PORTFOLIO_DETAIL_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const path = parseApiV1PortfolioDetailPath(
        buildCanonicalPortfolioDetailPath(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        path.portfolioId,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}

/**
 * Creates the per-request `portfolios.projects.get` MCP executor. Same
 * authority ordering; both the canonical nested path parser and the canonical
 * nested query parser are reused verbatim.
 */
export function createMcpPortfolioProjectsToolExecutor(
  dependencies: McpPortfolioProjectsToolDependencies,
): McpPortfolioProjectsToolExecutor {
  return async function executePortfolioProjectsRead(
    args: McpPortfolioProjectsToolArguments,
  ): Promise<McpPortfolioProjectsToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        PORTFOLIO_PROJECTS_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PORTFOLIO_PROJECTS_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const path = parseApiV1PortfolioProjectsPath(
        buildCanonicalPortfolioProjectsPath(args),
      );
      const query = parseApiV1PortfolioProjectsQuery(
        buildCanonicalPortfolioProjectsQueryString(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        path.portfolioId,
        query,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
