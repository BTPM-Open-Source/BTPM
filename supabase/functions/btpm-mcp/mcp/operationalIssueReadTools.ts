// API-Q.7E — Explicit MCP business-read adapters for the canonical operational
// issue reads: `risks.get`, `risks.get_by_id`, `blockers.get` and
// `blockers.get_by_id`.
//
// These are THIN ADAPTERS, following the accepted API-Q.7A–7D precedents
// exactly. They contain NO Risk/Blocker business logic, NO authorization or
// containment rule, NO RLS logic, NO encryption/decryption, NO cursor or
// pagination logic, NO SQL and NO RPC contract. They do not implement
// `api_v1_list_project_risks`, `api_v1_get_risk`,
// `api_v1_list_project_blockers` or `api_v1_get_blocker`, do not call `.from()`
// on business tables, never use a service-role client, and never perform an
// HTTP call to `btpm-api-v1`.
//
// Everything authoritative is reused verbatim:
//   - path validation              : `parseApiV1ProjectRisksPath`,
//                                    `parseApiV1RiskDetailPath`,
//                                    `parseApiV1ProjectBlockersPath`,
//                                    `parseApiV1BlockerDetailPath`
//   - query validation/defaulting  : `parseApiV1ProjectRisksQuery`,
//                                    `parseApiV1ProjectBlockersQuery`
//   - route identity               : `RISK_PROJECT_COLLECTION_ROUTE.id`,
//                                    `RISK_DETAIL_ROUTE.id`,
//                                    `BLOCKER_PROJECT_COLLECTION_ROUTE.id`,
//                                    `BLOCKER_DETAIL_ROUTE.id`
//   - rate-limit enforcement       : `enforceApiRateLimit` + Supabase adapters
//   - caller-scoped business read  : the accepted delegated Risk/Blocker readers
//   - trusted identity bridge      : `buildAuthenticatedApiContextFromMcp`
//
// The caller's raw bearer token flows ONLY through the accepted delegated
// readers, which extract it from the original `Request`. It never enters the
// trusted execution context, tool arguments, registry metadata, tool output or
// any log.
//
// These are explicit per-operation adapters by design: no generic read-tool
// executor, no operationId → executor map, no dynamic parser/reader/RPC
// dispatch.

import { z } from "npm:zod@4.4.3";

import {
  RISK_DETAIL_ROUTE,
  RISK_PROJECT_COLLECTION_ROUTE,
  parseApiV1ProjectRisksPath,
  parseApiV1ProjectRisksQuery,
  parseApiV1RiskDetailPath,
} from "../../_shared/btpm-api/routes/risks.ts";
import {
  BLOCKER_DETAIL_ROUTE,
  BLOCKER_PROJECT_COLLECTION_ROUTE,
  parseApiV1BlockerDetailPath,
  parseApiV1ProjectBlockersPath,
  parseApiV1ProjectBlockersQuery,
} from "../../_shared/btpm-api/routes/blockers.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import type {
  ApiV1ProjectRisksPayload,
  ApiV1RiskReadItem,
} from "../../_shared/btpm-api/supabaseRiskRead.ts";
import type {
  ApiV1BlockerReadItem,
  ApiV1ProjectBlockersPayload,
} from "../../_shared/btpm-api/supabaseBlockerRead.ts";
import type {
  DelegatedApiV1ProjectRisksReader,
  DelegatedApiV1RiskReader,
} from "../../_shared/btpm-api/supabaseDelegatedRiskRead.ts";
import type {
  DelegatedApiV1BlockerReader,
  DelegatedApiV1ProjectBlockersReader,
} from "../../_shared/btpm-api/supabaseDelegatedBlockerRead.ts";
import type { McpAuthorizedContext } from "./authorizeMcpConnectedApp.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import { buildAuthenticatedApiContextFromMcp } from "./mcpApiContext.ts";
import type { McpToolErrorCategory } from "./organizationsReadTool.ts";

/** Advertised MCP tool names for the canonical operational issue reads. */
export const MCP_PROJECT_RISKS_TOOL_NAME = "btpm_list_project_risks";
export const MCP_RISK_DETAIL_TOOL_NAME = "btpm_get_risk";
export const MCP_PROJECT_BLOCKERS_TOOL_NAME = "btpm_list_project_blockers";
export const MCP_BLOCKER_DETAIL_TOOL_NAME = "btpm_get_blocker";

/**
 * MCP tool input schemas (MCP SDK v2 Standard Schema mechanism, zod v4).
 * Presentation only: the canonical parsers remain the sole authority for UUID,
 * limit and cursor validation, defaulting and bounds.
 */
export const MCP_PROJECT_RISKS_TOOL_INPUT_SCHEMA = z.object({
  projectId: z.string(),
  limit: z.number().int().optional(),
  cursor: z.string().optional(),
});

export const MCP_RISK_DETAIL_TOOL_INPUT_SCHEMA = z.object({
  riskId: z.string(),
});

export const MCP_PROJECT_BLOCKERS_TOOL_INPUT_SCHEMA = z.object({
  projectId: z.string(),
  limit: z.number().int().optional(),
  cursor: z.string().optional(),
});

export const MCP_BLOCKER_DETAIL_TOOL_INPUT_SCHEMA = z.object({
  blockerId: z.string(),
});

/** Untrusted, already schema-validated MCP tool arguments. */
export interface McpProjectRisksToolArguments {
  readonly projectId: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface McpRiskDetailToolArguments {
  readonly riskId: string;
}

export interface McpProjectBlockersToolArguments {
  readonly projectId: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface McpBlockerDetailToolArguments {
  readonly blockerId: string;
}

/** The only external messages a Risk MCP tool failure may disclose. */
export const MCP_RISK_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpToolErrorCategory, string>
> = Object.freeze({
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to access Risks.",
  rate_limited: "Rate limit exceeded. Try again later.",
  unavailable: "BTPM Risk read is temporarily unavailable.",
});

/** The only external messages a Blocker MCP tool failure may disclose. */
export const MCP_BLOCKER_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpToolErrorCategory, string>
> = Object.freeze({
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to access Blockers.",
  rate_limited: "Rate limit exceeded. Try again later.",
  unavailable: "BTPM Blocker read is temporarily unavailable.",
});

export type McpProjectRisksToolResult =
  | { readonly ok: true; readonly payload: ApiV1ProjectRisksPayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

export type McpRiskDetailToolResult =
  | { readonly ok: true; readonly payload: ApiV1RiskReadItem }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

export type McpProjectBlockersToolResult =
  | { readonly ok: true; readonly payload: ApiV1ProjectBlockersPayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

export type McpBlockerDetailToolResult =
  | { readonly ok: true; readonly payload: ApiV1BlockerReadItem }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

/** The bounded executors the MCP server factory is allowed to know. */
export type McpProjectRisksToolExecutor = (
  args: McpProjectRisksToolArguments,
) => Promise<McpProjectRisksToolResult>;

export type McpRiskDetailToolExecutor = (
  args: McpRiskDetailToolArguments,
) => Promise<McpRiskDetailToolResult>;

export type McpProjectBlockersToolExecutor = (
  args: McpProjectBlockersToolArguments,
) => Promise<McpProjectBlockersToolResult>;

export type McpBlockerDetailToolExecutor = (
  args: McpBlockerDetailToolArguments,
) => Promise<McpBlockerDetailToolResult>;

/** Per-request execution dependencies. No Supabase client, no service role. */
export interface McpProjectRisksToolDependencies {
  /** The original authenticated MCP request; the delegated reader owns it. */
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1ProjectRisksReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

export interface McpRiskDetailToolDependencies {
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1RiskReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

export interface McpProjectBlockersToolDependencies {
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1ProjectBlockersReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

export interface McpBlockerDetailToolDependencies {
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1BlockerReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

/**
 * Builds the canonical Project Risk collection pathname. The caller value is
 * NOT encoded: the canonical parser is the sole authority and must see it
 * verbatim so it can fail closed on separators, encoding and whitespace.
 */
export function buildCanonicalProjectRisksPath(
  args: McpProjectRisksToolArguments,
): string {
  return `/v1/projects/${String(args.projectId)}/risks`;
}

/**
 * Builds the equivalent canonical collection query string. No defaulting and no
 * clamping happens here: omitted optional fields stay omitted so the canonical
 * parser applies the canonical defaults (limit 100, cursor null), and
 * invalid/out-of-range values reach the canonical parser unchanged.
 */
export function buildCanonicalBoundedCollectionQueryString(
  args: { readonly limit?: number; readonly cursor?: string },
): string {
  const parts: string[] = [];
  if (args.limit !== undefined) {
    parts.push(`limit=${encodeURIComponent(String(args.limit))}`);
  }
  if (args.cursor !== undefined) {
    parts.push(`cursor=${encodeURIComponent(args.cursor)}`);
  }
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

/** Builds the canonical Risk detail pathname, unencoded for the parser. */
export function buildCanonicalRiskDetailPath(
  args: McpRiskDetailToolArguments,
): string {
  return `/v1/risks/${String(args.riskId)}`;
}

/** Builds the canonical Project Blocker collection pathname, unencoded. */
export function buildCanonicalProjectBlockersPath(
  args: McpProjectBlockersToolArguments,
): string {
  return `/v1/projects/${String(args.projectId)}/blockers`;
}

/** Builds the canonical Blocker detail pathname, unencoded for the parser. */
export function buildCanonicalBlockerDetailPath(
  args: McpBlockerDetailToolArguments,
): string {
  return `/v1/blockers/${String(args.blockerId)}`;
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
 * Creates the per-request `risks.get` MCP executor.
 *
 * Execution order (identical authority ordering to the REST runtime and to the
 * accepted API-Q.7A–7D slices):
 *   1. derive the canonical API context from the authorized MCP context;
 *   2. resolve the database-controlled rate-limit profile;
 *   3. consume the atomic rate limit for client + user + route;
 *   4. validate arguments through the canonical path and query parsers;
 *   5. read through the accepted caller-scoped delegated Risk reader.
 */
export function createMcpProjectRisksToolExecutor(
  dependencies: McpProjectRisksToolDependencies,
): McpProjectRisksToolExecutor {
  return async function executeProjectRisksRead(
    args: McpProjectRisksToolArguments,
  ): Promise<McpProjectRisksToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        RISK_PROJECT_COLLECTION_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: RISK_PROJECT_COLLECTION_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const path = parseApiV1ProjectRisksPath(
        buildCanonicalProjectRisksPath(args),
      );
      const query = parseApiV1ProjectRisksQuery(
        buildCanonicalBoundedCollectionQueryString(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        path.projectId,
        query.limit,
        query.cursor,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      // Only a bounded category escapes: no SQLSTATE, database message, stack,
      // provider error, policy/version ID or internal authorization reason.
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}

/** Creates the per-request `risks.get_by_id` MCP executor. */
export function createMcpRiskDetailToolExecutor(
  dependencies: McpRiskDetailToolDependencies,
): McpRiskDetailToolExecutor {
  return async function executeRiskDetailRead(
    args: McpRiskDetailToolArguments,
  ): Promise<McpRiskDetailToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        RISK_DETAIL_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: RISK_DETAIL_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const path = parseApiV1RiskDetailPath(
        buildCanonicalRiskDetailPath(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        path.riskId,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}

/** Creates the per-request `blockers.get` MCP executor. */
export function createMcpProjectBlockersToolExecutor(
  dependencies: McpProjectBlockersToolDependencies,
): McpProjectBlockersToolExecutor {
  return async function executeProjectBlockersRead(
    args: McpProjectBlockersToolArguments,
  ): Promise<McpProjectBlockersToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        BLOCKER_PROJECT_COLLECTION_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: BLOCKER_PROJECT_COLLECTION_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const path = parseApiV1ProjectBlockersPath(
        buildCanonicalProjectBlockersPath(args),
      );
      const query = parseApiV1ProjectBlockersQuery(
        buildCanonicalBoundedCollectionQueryString(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        path.projectId,
        query.limit,
        query.cursor,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}

/** Creates the per-request `blockers.get_by_id` MCP executor. */
export function createMcpBlockerDetailToolExecutor(
  dependencies: McpBlockerDetailToolDependencies,
): McpBlockerDetailToolExecutor {
  return async function executeBlockerDetailRead(
    args: McpBlockerDetailToolArguments,
  ): Promise<McpBlockerDetailToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        BLOCKER_DETAIL_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: BLOCKER_DETAIL_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const path = parseApiV1BlockerDetailPath(
        buildCanonicalBlockerDetailPath(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        path.blockerId,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
