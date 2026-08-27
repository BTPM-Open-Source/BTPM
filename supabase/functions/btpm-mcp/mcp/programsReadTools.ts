// API-Q.7D — Explicit MCP business-read adapters for the canonical Program
// context reads: `programs.get` and `programs.get_by_id`.
//
// These are THIN ADAPTERS, following the accepted API-Q.7A/7B/7C precedents
// (`organizationsReadTool.ts`, `workspacesReadTool.ts`, `projectsReadTool.ts`)
// exactly. They contain NO Program business logic, NO authorization/containment
// rule, NO RLS logic, NO pagination logic, NO SQL and NO RPC contract. They do
// not implement `api_v1_list_programs` or `api_v1_get_program`, do not call
// `.from()` on business tables, never use a service-role client, and never
// perform an HTTP call to `btpm-api-v1`.
//
// Everything authoritative is reused verbatim:
//   - query validation/defaulting  : `parseApiV1ProgramsQuery`
//   - path validation              : `parseApiV1ProgramDetailPath`
//   - route identity               : `PROGRAMS_ROUTE.id`, `PROGRAM_DETAIL_ROUTE.id`
//   - rate-limit enforcement       : `enforceApiRateLimit` + Supabase adapters
//   - caller-scoped business read  : `createDelegatedApiV1ProgramsReader`,
//                                    `createDelegatedApiV1ProgramReader`
//   - trusted identity bridge      : `buildAuthenticatedApiContextFromMcp`
//
// The caller's raw bearer token flows ONLY through the accepted delegated
// readers, which extract it from the original `Request`. It is never copied
// into the trusted execution context, tool arguments, registry metadata, tool
// output or any log.
//
// These are explicit per-operation adapters by design: no generic read-tool
// executor, no operationId → executor map, no parameterized
// route/parser/reader/RPC indirection.

import { z } from "npm:zod@4.4.3";

import {
  PROGRAM_DETAIL_ROUTE,
  PROGRAMS_ROUTE,
  parseApiV1ProgramDetailPath,
  parseApiV1ProgramsQuery,
} from "../../_shared/btpm-api/routes/programs.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import type {
  ApiV1ProgramDetailPayload,
  ApiV1ProgramsPayload,
} from "../../_shared/btpm-api/supabaseProgramRead.ts";
import type {
  DelegatedApiV1ProgramReader,
  DelegatedApiV1ProgramsReader,
} from "../../_shared/btpm-api/supabaseDelegatedProgramRead.ts";
import type { McpAuthorizedContext } from "./authorizeMcpConnectedApp.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import { buildAuthenticatedApiContextFromMcp } from "./mcpApiContext.ts";
import type { McpToolErrorCategory } from "./organizationsReadTool.ts";

/** Advertised MCP tool name for the canonical `programs.get` operation. */
export const MCP_PROGRAMS_TOOL_NAME = "btpm_list_programs";

/** Advertised MCP tool name for the canonical `programs.get_by_id` operation. */
export const MCP_PROGRAM_DETAIL_TOOL_NAME = "btpm_get_program";

/**
 * MCP tool input schemas (MCP SDK v2 Standard Schema mechanism, zod v4).
 *
 * These bounds exist only so the MCP client receives a usable schema. They are
 * NOT the authority: canonical validation, defaulting and limits remain owned
 * by the canonical Program parsers.
 */
export const MCP_PROGRAMS_TOOL_INPUT_SCHEMA = z.object({
  workspaceId: z.string(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
  search: z.string().optional(),
});

export const MCP_PROGRAM_DETAIL_TOOL_INPUT_SCHEMA = z.object({
  programId: z.string(),
});

/** Untrusted, already schema-validated MCP tool arguments. */
export interface McpProgramsToolArguments {
  readonly workspaceId: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly search?: string;
}

export interface McpProgramDetailToolArguments {
  readonly programId: string;
}

/** The only external messages a Programs MCP tool failure may disclose. */
export const MCP_PROGRAMS_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpToolErrorCategory, string>
> = Object.freeze({
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to access Programs.",
  rate_limited: "Rate limit exceeded. Try again later.",
  unavailable: "BTPM Programs read is temporarily unavailable.",
});

export type McpProgramsToolResult =
  | { readonly ok: true; readonly payload: ApiV1ProgramsPayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

export type McpProgramDetailToolResult =
  | { readonly ok: true; readonly payload: ApiV1ProgramDetailPayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

/** The bounded executors the MCP server factory is allowed to know. */
export type McpProgramsToolExecutor = (
  args: McpProgramsToolArguments,
) => Promise<McpProgramsToolResult>;

export type McpProgramDetailToolExecutor = (
  args: McpProgramDetailToolArguments,
) => Promise<McpProgramDetailToolResult>;

/** Per-request execution dependencies. No Supabase client, no service role. */
export interface McpProgramsToolDependencies {
  /** The original authenticated MCP request; the delegated reader owns it. */
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1ProgramsReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

export interface McpProgramDetailToolDependencies {
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1ProgramReader;
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
export function buildCanonicalProgramsQueryString(
  args: McpProgramsToolArguments,
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

/**
 * Builds the canonical Program detail pathname. The value is NOT encoded: the
 * canonical path parser is the sole authority and must see the caller value
 * verbatim so it can fail closed on separators, encoding and whitespace.
 */
export function buildCanonicalProgramDetailPath(
  args: McpProgramDetailToolArguments,
): string {
  return `/v1/programs/${String(args.programId)}`;
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
 * Creates the per-request `programs.get` MCP executor.
 *
 * Execution order (identical authority ordering to the REST runtime and to the
 * accepted API-Q.7A/7B/7C slices):
 *   1. derive the canonical API context from the authorized MCP context;
 *   2. resolve the database-controlled rate-limit profile;
 *   3. consume the atomic rate limit for client + user + route;
 *   4. validate/default arguments through the canonical query parser;
 *   5. read through the accepted caller-scoped delegated Programs reader.
 */
export function createMcpProgramsToolExecutor(
  dependencies: McpProgramsToolDependencies,
): McpProgramsToolExecutor {
  return async function executeProgramsRead(
    args: McpProgramsToolArguments,
  ): Promise<McpProgramsToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        PROGRAMS_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PROGRAMS_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const query = parseApiV1ProgramsQuery(
        buildCanonicalProgramsQueryString(args),
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

/**
 * Creates the per-request `programs.get_by_id` MCP executor. Same authority
 * ordering; canonical path validation replaces canonical query parsing.
 */
export function createMcpProgramDetailToolExecutor(
  dependencies: McpProgramDetailToolDependencies,
): McpProgramDetailToolExecutor {
  return async function executeProgramDetailRead(
    args: McpProgramDetailToolArguments,
  ): Promise<McpProgramDetailToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        PROGRAM_DETAIL_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PROGRAM_DETAIL_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const path = parseApiV1ProgramDetailPath(
        buildCanonicalProgramDetailPath(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        path.programId,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
