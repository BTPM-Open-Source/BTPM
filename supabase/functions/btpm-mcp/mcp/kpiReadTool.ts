// KPI-1C — MCP read exposure for the accepted canonical `kpis.get` operation:
//
//   GET /v1/projects/:projectid/kpis   → kpis.get   (capability kpis:read)
//
// This module is a THIN ADAPTER, following the accepted API-Q.7A–7E and ME-3
// read-tool precedent exactly. It contains NO KPI business logic, NO
// authorization/containment logic, NO capability evaluation, NO RLS logic, NO
// encryption/decryption, NO pagination logic, NO SQL and NO RPC contract. It
// does not implement `api_v1_list_project_kpis`, does not call `.from()` on any
// business table, never constructs a Supabase client, never uses a service-role
// key, never reads the environment and never performs an HTTP call to
// `btpm-api-v1`.
//
// Everything authoritative is reused verbatim from the accepted KPI-1A/1B
// slices:
//   - path validation             : `parseApiV1ProjectKpisPath`
//   - query validation/defaulting : `parseApiV1ProjectKpisQuery`
//   - route identity              : `KPI_PROJECT_COLLECTION_ROUTE.id`
//   - rate-limit enforcement      : `enforceApiRateLimit` + Supabase adapters
//   - business read               : the accepted caller-scoped delegated
//                                   Project KPI reader
//   - trusted identity bridge     : `buildAuthenticatedApiContextFromMcp`
//
// The caller's raw bearer token flows ONLY through the accepted delegated
// reader, which extracts it from the original `Request`. It never enters the
// trusted execution context, tool arguments, registry metadata, tool output or
// any log.

import { z } from "npm:zod@4.4.3";

import {
  KPI_DETAIL_ROUTE,
  KPI_PROJECT_COLLECTION_ROUTE,
  KPI_UPDATES_ROUTE,
  parseApiV1KpiDetailPath,
  parseApiV1KpiUpdatesPath,
  parseApiV1KpiUpdatesQuery,
  parseApiV1ProjectKpisPath,
  parseApiV1ProjectKpisQuery,
} from "../../_shared/btpm-api/routes/kpis.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import type {
  ApiV1KpiUpdatesPayload,
  ApiV1ProjectKpiItem,
  ApiV1ProjectKpisPayload,
} from "../../_shared/btpm-api/supabaseKpiRead.ts";
import type {
  DelegatedApiV1KpiReader,
  DelegatedApiV1KpiUpdatesReader,
  DelegatedApiV1ProjectKpisReader,
} from "../../_shared/btpm-api/supabaseDelegatedKpiRead.ts";
import type { McpAuthorizedContext } from "./authorizeMcpConnectedApp.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import { buildAuthenticatedApiContextFromMcp } from "./mcpApiContext.ts";
import type { McpToolErrorCategory } from "./organizationsReadTool.ts";

/** Advertised MCP tool name for the canonical `kpis.get` operation. */
export const MCP_PROJECT_KPIS_TOOL_NAME = "btpm_list_project_kpis";

/**
 * MCP tool input schema (MCP SDK v2 Standard Schema mechanism, zod v4).
 *
 * Structural types only. This schema is NOT the canonical validator: Project ID
 * shape, limit/offset ranges and `include_archived` semantics remain owned by
 * the accepted KPI-1B parsers.
 */
export const MCP_PROJECT_KPIS_TOOL_INPUT_SCHEMA = z.object({
  projectId: z.string(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  includeArchived: z.boolean().optional(),
});

/** Untrusted, already schema-validated MCP tool arguments. */
export interface McpProjectKpisToolArguments {
  readonly projectId: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly includeArchived?: boolean;
}

/** The only external messages a Project KPI tool failure may disclose. */
export const MCP_PROJECT_KPIS_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpToolErrorCategory, string>
> = Object.freeze({
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to access Project KPIs.",
  rate_limited: "Rate limit exceeded. Try again later.",
  unavailable: "BTPM KPI read is temporarily unavailable.",
});

export type McpProjectKpisToolResult =
  | { readonly ok: true; readonly payload: ApiV1ProjectKpisPayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

/** The single bounded executor the MCP server factory is allowed to know. */
export type McpProjectKpisToolExecutor = (
  args: McpProjectKpisToolArguments,
) => Promise<McpProjectKpisToolResult>;

/** Per-request execution dependencies. No Supabase client, no service role. */
export interface McpProjectKpisToolDependencies {
  /** The original authenticated MCP request; the delegated reader owns it. */
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1ProjectKpisReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

/**
 * Builds the canonical Project KPI collection pathname. The caller value is NOT
 * encoded: the canonical parser is the sole authority and must see it verbatim
 * so it can fail closed on separators, encoding, casing and whitespace.
 */
export function buildCanonicalProjectKpisPath(
  args: McpProjectKpisToolArguments,
): string {
  return `/v1/projects/${String(args.projectId)}/kpis`;
}

/**
 * Builds the equivalent canonical query string. No defaulting, clamping,
 * normalization or repair happens here: omitted optional fields stay omitted so
 * the canonical parser applies the canonical defaults (limit 50, offset 0,
 * include_archived false), and invalid/out-of-range values reach the canonical
 * parser unchanged so it can fail closed.
 */
export function buildCanonicalProjectKpisQueryString(
  args: McpProjectKpisToolArguments,
): string {
  const parts: string[] = [];
  if (args.limit !== undefined) {
    parts.push(`limit=${encodeURIComponent(String(args.limit))}`);
  }
  if (args.offset !== undefined) {
    parts.push(`offset=${encodeURIComponent(String(args.offset))}`);
  }
  if (args.includeArchived !== undefined) {
    parts.push(
      `include_archived=${encodeURIComponent(String(args.includeArchived))}`,
    );
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
 * Creates the per-request `kpis.get` MCP executor.
 *
 * Execution order (identical authority ordering to the REST runtime and to the
 * accepted read-tool slices):
 *   1. derive the canonical API context from the authorized MCP context;
 *   2. resolve the database-controlled rate-limit profile;
 *   3. consume the atomic rate limit for client + user + route;
 *   4. validate arguments through the canonical path and query parsers;
 *   5. read through the accepted caller-scoped delegated Project KPI reader.
 */
export function createMcpProjectKpisToolExecutor(
  dependencies: McpProjectKpisToolDependencies,
): McpProjectKpisToolExecutor {
  return async function executeProjectKpisRead(
    args: McpProjectKpisToolArguments,
  ): Promise<McpProjectKpisToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        KPI_PROJECT_COLLECTION_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: KPI_PROJECT_COLLECTION_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const path = parseApiV1ProjectKpisPath(
        buildCanonicalProjectKpisPath(args),
      );
      const query = parseApiV1ProjectKpisQuery(
        buildCanonicalProjectKpisQueryString(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        path.projectId,
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

// -----------------------------------------------------------------------------
// KPI-2C — MCP read exposure for the accepted canonical `kpis.get_by_id`
// operation:
//
//   GET /v1/kpis/:kpiid   → kpis.get_by_id   (capability kpis:read)
//
// Same thin-adapter posture as the collection read above: no Supabase client,
// no service-role key, no `.from()`, no `.rpc()`, no `fetch()`, no SQL, no
// decryption, no Project/KPI authorization logic, no Connected App capability
// logic, no generic dispatcher and no HTTP call to `btpm-api-v1`. Canonical KPI
// ID validation stays owned by `parseApiV1KpiDetailPath`.
// -----------------------------------------------------------------------------

/** Advertised MCP tool name for the canonical `kpis.get_by_id` operation. */
export const MCP_KPI_DETAIL_TOOL_NAME = "btpm_get_kpi";

/** Structural/presentation schema only; canonical validation stays canonical. */
export const MCP_KPI_DETAIL_TOOL_INPUT_SCHEMA = z.object({
  kpiId: z.string(),
});

/** Untrusted, already schema-validated MCP tool arguments. */
export interface McpKpiDetailToolArguments {
  readonly kpiId: string;
}

/** The only external messages a KPI detail tool failure may disclose. */
export const MCP_KPI_DETAIL_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpToolErrorCategory, string>
> = Object.freeze({
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to access KPI.",
  rate_limited: "Rate limit exceeded. Try again later.",
  unavailable: "BTPM KPI read is temporarily unavailable.",
});

export type McpKpiDetailToolResult =
  | { readonly ok: true; readonly payload: ApiV1ProjectKpiItem }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

/** The single bounded executor the MCP server factory is allowed to know. */
export type McpKpiDetailToolExecutor = (
  args: McpKpiDetailToolArguments,
) => Promise<McpKpiDetailToolResult>;

/** Per-request execution dependencies. No Supabase client, no service role. */
export interface McpKpiDetailToolDependencies {
  /** The original authenticated MCP request; the delegated reader owns it. */
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1KpiReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

/**
 * Builds the canonical single-KPI detail pathname. The caller value is NOT
 * encoded, trimmed, lowercased, normalized or repaired: the canonical parser is
 * the sole authority and must see it verbatim so it can fail closed.
 */
export function buildCanonicalKpiDetailPath(
  args: McpKpiDetailToolArguments,
): string {
  return `/v1/kpis/${String(args.kpiId)}`;
}

/**
 * Creates the per-request `kpis.get_by_id` MCP executor.
 *
 * Execution order:
 *   1. derive the canonical API context from the authorized MCP context;
 *   2. resolve the database-controlled rate-limit profile for the route;
 *   3. consume the atomic rate limit for client + user + route;
 *   4. validate arguments through the canonical KPI detail path parser;
 *   5. read through the accepted caller-scoped delegated KPI detail reader.
 */
export function createMcpKpiDetailToolExecutor(
  dependencies: McpKpiDetailToolDependencies,
): McpKpiDetailToolExecutor {
  return async function executeKpiDetailRead(
    args: McpKpiDetailToolArguments,
  ): Promise<McpKpiDetailToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        KPI_DETAIL_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: KPI_DETAIL_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const path = parseApiV1KpiDetailPath(buildCanonicalKpiDetailPath(args));

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        path.kpiId,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}

// -----------------------------------------------------------------------------
// KPI-3C — MCP read exposure for the accepted canonical `kpis.updates.get`
// operation:
//
//   GET /v1/kpis/:kpiid/updates   → kpis.updates.get   (capability kpis:read)
//
// Same thin-adapter posture as the two KPI reads above: no Supabase client, no
// service-role key, no `.from()`, no `.rpc()`, no `fetch()`, no SQL, no
// decryption, no KPI authority logic, no Connected App capability logic, no
// generic dispatcher and no HTTP call to `btpm-api-v1`. The opaque cursor stays
// opaque here: it is only forwarded to `parseApiV1KpiUpdatesQuery`, never
// decoded, inspected or reconstructed. The three internal keyset fields
// (`updateDate`, `createdAt`, `id`) are never exposed as MCP parameters.
// -----------------------------------------------------------------------------

/** Advertised MCP tool name for the canonical `kpis.updates.get` operation. */
export const MCP_KPI_UPDATES_TOOL_NAME = "btpm_list_kpi_updates";

/**
 * Structural/presentation schema only. KPI ID shape, limit range and cursor
 * semantics remain owned exclusively by the accepted KPI-3B parsers.
 */
export const MCP_KPI_UPDATES_TOOL_INPUT_SCHEMA = z.object({
  kpiId: z.string(),
  limit: z.number().optional(),
  cursor: z.string().optional(),
});

/** Untrusted, already schema-validated MCP tool arguments. */
export interface McpKpiUpdatesToolArguments {
  readonly kpiId: string;
  readonly limit?: number;
  readonly cursor?: string;
}

/** The only external messages a KPI update-history failure may disclose. */
export const MCP_KPI_UPDATES_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpToolErrorCategory, string>
> = Object.freeze({
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to access KPI updates.",
  rate_limited: "Rate limit exceeded. Try again later.",
  unavailable: "BTPM KPI read is temporarily unavailable.",
});

export type McpKpiUpdatesToolResult =
  | { readonly ok: true; readonly payload: ApiV1KpiUpdatesPayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

/** The single bounded executor the MCP server factory is allowed to know. */
export type McpKpiUpdatesToolExecutor = (
  args: McpKpiUpdatesToolArguments,
) => Promise<McpKpiUpdatesToolResult>;

/** Per-request execution dependencies. No Supabase client, no service role. */
export interface McpKpiUpdatesToolDependencies {
  /** The original authenticated MCP request; the delegated reader owns it. */
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1KpiUpdatesReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

/**
 * Builds the canonical KPI update-history pathname. The caller value is NOT
 * encoded, trimmed, lowercased, normalized or repaired: the canonical parser is
 * the sole authority and must see it verbatim so it can fail closed.
 */
export function buildCanonicalKpiUpdatesPath(
  args: McpKpiUpdatesToolArguments,
): string {
  return `/v1/kpis/${String(args.kpiId)}/updates`;
}

/**
 * Builds the equivalent canonical query string exposing only `limit` and the
 * opaque `cursor`. No defaulting, clamping, normalization, repair or cursor
 * decoding happens here: omitted optional fields stay omitted so the canonical
 * parser applies the canonical defaults, and invalid values reach the canonical
 * parser unchanged so it can fail closed.
 */
export function buildCanonicalKpiUpdatesQueryString(
  args: McpKpiUpdatesToolArguments,
): string {
  const parts: string[] = [];
  if (args.limit !== undefined) {
    parts.push(`limit=${encodeURIComponent(String(args.limit))}`);
  }
  if (args.cursor !== undefined) {
    parts.push(`cursor=${encodeURIComponent(String(args.cursor))}`);
  }
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

/**
 * Creates the per-request `kpis.updates.get` MCP executor.
 *
 * Execution order:
 *   1. derive the canonical API context from the authorized MCP context;
 *   2. resolve the database-controlled rate-limit profile for the route;
 *   3. consume the atomic rate limit for client + user + route;
 *   4. validate arguments through the canonical path and query parsers;
 *   5. read through the accepted caller-scoped delegated KPI-history reader.
 */
export function createMcpKpiUpdatesToolExecutor(
  dependencies: McpKpiUpdatesToolDependencies,
): McpKpiUpdatesToolExecutor {
  return async function executeKpiUpdatesRead(
    args: McpKpiUpdatesToolArguments,
  ): Promise<McpKpiUpdatesToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        KPI_UPDATES_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: KPI_UPDATES_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const path = parseApiV1KpiUpdatesPath(buildCanonicalKpiUpdatesPath(args));
      const query = parseApiV1KpiUpdatesQuery(
        buildCanonicalKpiUpdatesQueryString(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        path.kpiId,
        query,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
