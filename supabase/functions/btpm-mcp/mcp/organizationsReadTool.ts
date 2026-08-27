// API-Q.7A — First real MCP business-read vertical slice: `organizations.get`.
//
// This module is a THIN ADAPTER. It contains NO Organizations business logic,
// NO authorization rule, NO RLS logic, NO pagination logic, NO SQL and NO RPC
// contract. It does not implement `api_v1_list_organizations`, does not call
// `.from()` on business tables, never uses a service-role client, and never
// performs an HTTP call to `btpm-api-v1`.
//
// Everything authoritative is reused verbatim:
//   - query validation/defaulting  : `parseApiV1OrganizationsQuery`
//   - route identity               : `ORGANIZATIONS_ROUTE.id`
//   - rate-limit enforcement       : `enforceApiRateLimit` + Supabase adapters
//   - caller-scoped business read  : `createDelegatedApiV1OrganizationsReader`
//
// The caller's raw bearer token flows ONLY through the accepted delegated
// reader, which extracts it from the original `Request`. It is never copied
// into the trusted execution context, tool arguments, registry metadata, tool
// output or any log.

import { z } from "npm:zod@4.4.3";

import {
  ORGANIZATIONS_ROUTE,
  parseApiV1OrganizationsQuery,
} from "../../_shared/btpm-api/routes/organizations.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  enforceApiRateLimit,
  type ApiRateLimitStore,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import type { ApiV1OrganizationsPayload } from "../../_shared/btpm-api/supabaseOrganizations.ts";
import type { DelegatedApiV1OrganizationsReader } from "../../_shared/btpm-api/supabaseDelegatedOrganizations.ts";
import type { McpAuthorizedContext } from "./authorizeMcpConnectedApp.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import { buildAuthenticatedApiContextFromMcp } from "./mcpApiContext.ts";

/** Advertised MCP tool name for the canonical `organizations.get` operation. */
export const MCP_ORGANIZATIONS_TOOL_NAME = "btpm_list_organizations";

/**
 * MCP tool input schema (MCP SDK v2 Standard Schema mechanism, zod v4).
 *
 * These bounds exist only so the MCP client receives a usable schema. They are
 * NOT the authority: canonical validation, defaulting and limits remain owned
 * by `parseApiV1OrganizationsQuery`.
 */
export const MCP_ORGANIZATIONS_TOOL_INPUT_SCHEMA = z.object({
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
  search: z.string().optional(),
});

/** Untrusted, already schema-validated MCP tool arguments. */
export interface McpOrganizationsToolArguments {
  readonly limit?: number;
  readonly offset?: number;
  readonly search?: string;
}

/** Bounded, non-leaking MCP tool error categories. */
export type McpToolErrorCategory =
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "unavailable";

/** The only external messages an MCP tool failure may disclose. */
export const MCP_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpToolErrorCategory, string>
> = Object.freeze({
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to access Organizations.",
  rate_limited: "Rate limit exceeded. Try again later.",
  unavailable: "BTPM Organizations read is temporarily unavailable.",
});

export type McpOrganizationsToolResult =
  | { readonly ok: true; readonly payload: ApiV1OrganizationsPayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

/** The single bounded executor the MCP server factory is allowed to know. */
export type McpOrganizationsToolExecutor = (
  args: McpOrganizationsToolArguments,
) => Promise<McpOrganizationsToolResult>;

/** Per-request execution dependencies. No Supabase client, no service role. */
export interface McpOrganizationsToolDependencies {
  /** The original authenticated MCP request; the delegated reader owns it. */
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1OrganizationsReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

/**
 * Converts typed MCP arguments into the equivalent canonical API query string.
 * No defaulting and no clamping happens here: omitted fields stay omitted so
 * the canonical parser applies the canonical defaults (limit 50, offset 0,
 * search null), and out-of-range values reach the canonical parser unchanged.
 */
export function buildCanonicalOrganizationsQueryString(
  args: McpOrganizationsToolArguments,
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
 * Creates the per-request `organizations.get` MCP executor.
 *
 * Execution order (identical authority ordering to the REST runtime):
 *   1. derive the canonical API context from the authorized MCP context;
 *   2. resolve the database-controlled rate-limit profile;
 *   3. consume the atomic rate limit for client + user + route;
 *   4. validate/default arguments through the canonical query parser;
 *   5. read through the accepted caller-scoped delegated Organizations reader.
 */
export function createMcpOrganizationsToolExecutor(
  dependencies: McpOrganizationsToolDependencies,
): McpOrganizationsToolExecutor {
  return async function executeOrganizationsRead(
    args: McpOrganizationsToolArguments,
  ): Promise<McpOrganizationsToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        ORGANIZATIONS_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: ORGANIZATIONS_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const query = parseApiV1OrganizationsQuery(
        buildCanonicalOrganizationsQueryString(args),
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
