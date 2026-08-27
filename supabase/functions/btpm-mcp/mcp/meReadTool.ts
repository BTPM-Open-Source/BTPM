// ME-3 — MCP read exposure for the canonical `me.get` operation.
//
// This module is a THIN ADAPTER, following the accepted API-Q.7A/7B and
// WML-1C read-tool precedent exactly. It contains NO identity logic, NO
// membership/role resolution, NO Connected App evaluation, NO encryption,
// NO SQL and NO RPC contract. It never queries tables, never constructs a
// Supabase client, never uses a service-role key, never reads the
// environment and never performs an HTTP call to `btpm-api-v1`.
//
// Everything authoritative is reused verbatim from the accepted ME-1/ME-2
// slices:
//   - query validation  : `parseApiV1MeQuery`
//   - route identity    : `ME_ROUTE.id`
//   - rate limiting     : `enforceApiRateLimit` + canonical adapters
//   - business read     : accepted caller-scoped delegated Me reader
//   - identity bridge   : `buildAuthenticatedApiContextFromMcp`
//
// The caller's raw bearer token flows ONLY through the accepted delegated
// reader, which extracts it from the original `Request`. It is never copied
// into the trusted execution context, tool arguments, registry metadata,
// tool output or any log.

import { z } from "npm:zod@4.4.3";

import { ME_ROUTE, parseApiV1MeQuery } from "../../_shared/btpm-api/routes/me.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  enforceApiRateLimit,
  type ApiRateLimitStore,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import type { ApiV1MePayload } from "../../_shared/btpm-api/supabaseReadMe.ts";
import type { DelegatedApiV1MeReader } from "../../_shared/btpm-api/supabaseDelegatedReadMe.ts";
import type { McpAuthorizedContext } from "./authorizeMcpConnectedApp.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import { buildAuthenticatedApiContextFromMcp } from "./mcpApiContext.ts";
import type { McpToolErrorCategory } from "./organizationsReadTool.ts";

/** Advertised MCP tool name for canonical `me.get`. */
export const MCP_ME_TOOL_NAME = "btpm_get_me";

/**
 * MCP tool input schema (MCP SDK v2 Standard Schema mechanism, zod v4).
 *
 * Structural types only. This schema is NOT the authority: context-type and
 * context-id semantics remain owned by `parseApiV1MeQuery`.
 */
export const MCP_ME_TOOL_INPUT_SCHEMA = z.object({
  contextType: z.string().optional(),
  contextId: z.string().optional(),
});

/** Untrusted, already schema-validated MCP tool arguments. */
export interface McpMeToolArguments {
  readonly contextType?: string;
  readonly contextId?: string;
}

/** The only external messages a Me tool failure may disclose. */
export const MCP_ME_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpToolErrorCategory, string>
> = Object.freeze({
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to access this BTPM identity context.",
  rate_limited: "Rate limit exceeded. Try again later.",
  unavailable: "BTPM caller identity read is temporarily unavailable.",
});

export type McpMeToolResult =
  | { readonly ok: true; readonly payload: ApiV1MePayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

/** The single bounded executor the MCP server factory is allowed to know. */
export type McpMeToolExecutor = (
  args: McpMeToolArguments,
) => Promise<McpMeToolResult>;

/** Per-request execution dependencies. No Supabase client, no service role. */
export interface McpMeToolDependencies {
  /** The original authenticated MCP request; the delegated reader owns it. */
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1MeReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

/**
 * Converts typed MCP arguments into the equivalent canonical `/v1/me` query
 * string. Omitted fields stay omitted, supplied values are only URL-encoded:
 * no aliasing, normalization or repair. Partial or malformed combinations
 * reach `parseApiV1MeQuery` unchanged so it can fail closed.
 */
export function buildCanonicalMeQueryString(args: McpMeToolArguments): string {
  const parts: string[] = [];
  if (args.contextType !== undefined) {
    parts.push(`contextType=${encodeURIComponent(String(args.contextType))}`);
  }
  if (args.contextId !== undefined) {
    parts.push(`contextId=${encodeURIComponent(String(args.contextId))}`);
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
 * Creates the per-request `me.get` MCP executor.
 *
 * Execution order (identical authority ordering to the REST runtime):
 *   1. derive the canonical API context from the authorized MCP context;
 *   2. resolve the database-controlled rate-limit profile;
 *   3. consume the atomic rate limit for client + user + route;
 *   4. validate arguments through the canonical `/v1/me` query parser;
 *   5. read through the accepted caller-scoped delegated Me reader.
 */
export function createMcpMeToolExecutor(
  dependencies: McpMeToolDependencies,
): McpMeToolExecutor {
  return async function executeMeRead(
    args: McpMeToolArguments,
  ): Promise<McpMeToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        ME_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: ME_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const query = parseApiV1MeQuery(buildCanonicalMeQueryString(args));

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
