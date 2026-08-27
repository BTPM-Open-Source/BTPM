// API-Q.7D — Explicit MCP business-read adapters for the canonical Project
// context reads: `projects.get_by_id` and `projects.planning.get`.
//
// These are THIN ADAPTERS, following the accepted API-Q.7A/7B/7C precedents
// exactly. They contain NO Project business logic, NO authorization/containment
// rule, NO RLS logic, NO encryption/decryption, NO safe-field selection, NO
// planning reconstruction, NO SQL and NO RPC contract. They do not implement
// `api_v1_get_project` or `api_v1_get_project_planning`, do not call `.from()`
// on business tables, never use a service-role client, and never perform an
// HTTP call to `btpm-api-v1`.
//
// Everything authoritative is reused verbatim:
//   - path validation              : `parseApiV1ProjectDetailPath`,
//                                    `parseApiV1ProjectPlanningPath`
//   - route identity               : `PROJECT_DETAIL_ROUTE.id`,
//                                    `PROJECT_PLANNING_ROUTE.id`
//   - rate-limit enforcement       : `enforceApiRateLimit` + Supabase adapters
//   - caller-scoped business read  : `createDelegatedApiV1ProjectDetailReader`,
//                                    `createDelegatedApiV1ProjectPlanningReader`
//   - trusted identity bridge      : `buildAuthenticatedApiContextFromMcp`
//
// The caller's raw bearer token flows ONLY through the accepted delegated
// readers. It never enters the trusted execution context, tool arguments,
// registry metadata, tool output or any log.
//
// These are explicit per-operation adapters by design: no generic read-tool
// executor, no operationId → executor map, no dynamic parser/RPC dispatch.

import { z } from "npm:zod@4.4.3";

import {
  PROJECT_DETAIL_ROUTE,
  parseApiV1ProjectDetailPath,
} from "../../_shared/btpm-api/routes/projectDetail.ts";
import {
  PROJECT_PLANNING_ROUTE,
  parseApiV1ProjectPlanningPath,
} from "../../_shared/btpm-api/routes/projectPlanning.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import type { ApiV1ProjectDetailPayload } from "../../_shared/btpm-api/supabaseProjectDetail.ts";
import type { ApiV1ProjectPlanningPayload } from "../../_shared/btpm-api/supabaseProjectPlanning.ts";
import type { DelegatedApiV1ProjectDetailReader } from "../../_shared/btpm-api/supabaseDelegatedProjectDetail.ts";
import type { DelegatedApiV1ProjectPlanningReader } from "../../_shared/btpm-api/supabaseDelegatedProjectPlanning.ts";
import type { McpAuthorizedContext } from "./authorizeMcpConnectedApp.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import { buildAuthenticatedApiContextFromMcp } from "./mcpApiContext.ts";
import type { McpToolErrorCategory } from "./organizationsReadTool.ts";

/** Advertised MCP tool name for the canonical `projects.get_by_id` operation. */
export const MCP_PROJECT_DETAIL_TOOL_NAME = "btpm_get_project";

/** Advertised MCP tool name for `projects.planning.get`. */
export const MCP_PROJECT_PLANNING_TOOL_NAME = "btpm_get_project_planning";

/**
 * MCP tool input schemas. Presentation only: the canonical path parsers remain
 * the sole authority for Project UUID validation.
 */
export const MCP_PROJECT_DETAIL_TOOL_INPUT_SCHEMA = z.object({
  projectId: z.string(),
});

export const MCP_PROJECT_PLANNING_TOOL_INPUT_SCHEMA = z.object({
  projectId: z.string(),
});

/** Untrusted, already schema-validated MCP tool arguments. */
export interface McpProjectDetailToolArguments {
  readonly projectId: string;
}

export interface McpProjectPlanningToolArguments {
  readonly projectId: string;
}

/** The only external messages a Project context read failure may disclose. */
export const MCP_PROJECT_CONTEXT_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpToolErrorCategory, string>
> = Object.freeze({
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to access Project data.",
  rate_limited: "Rate limit exceeded. Try again later.",
  unavailable: "BTPM Project read is temporarily unavailable.",
});

export type McpProjectDetailToolResult =
  | { readonly ok: true; readonly payload: ApiV1ProjectDetailPayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

export type McpProjectPlanningToolResult =
  | { readonly ok: true; readonly payload: ApiV1ProjectPlanningPayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

/** The bounded executors the MCP server factory is allowed to know. */
export type McpProjectDetailToolExecutor = (
  args: McpProjectDetailToolArguments,
) => Promise<McpProjectDetailToolResult>;

export type McpProjectPlanningToolExecutor = (
  args: McpProjectPlanningToolArguments,
) => Promise<McpProjectPlanningToolResult>;

/** Per-request execution dependencies. No Supabase client, no service role. */
export interface McpProjectDetailToolDependencies {
  /** The original authenticated MCP request; the delegated reader owns it. */
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1ProjectDetailReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

export interface McpProjectPlanningToolDependencies {
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1ProjectPlanningReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

/**
 * Builds the canonical Project detail pathname. The caller value is NOT
 * encoded: the canonical parser must see it verbatim so it can fail closed.
 */
export function buildCanonicalProjectDetailPath(
  args: McpProjectDetailToolArguments,
): string {
  return `/v1/projects/${String(args.projectId)}`;
}

/** Builds the canonical Project planning pathname, unencoded for the parser. */
export function buildCanonicalProjectPlanningPath(
  args: McpProjectPlanningToolArguments,
): string {
  return `/v1/projects/${String(args.projectId)}/planning`;
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
 * Creates the per-request `projects.get_by_id` MCP executor.
 *
 * Execution order:
 *   1. derive the canonical API context from the authorized MCP context;
 *   2. resolve the database-controlled rate-limit profile;
 *   3. consume the atomic rate limit for client + user + route;
 *   4. validate the Project ID through the canonical path parser;
 *   5. read through the accepted caller-scoped delegated Project detail reader.
 */
export function createMcpProjectDetailToolExecutor(
  dependencies: McpProjectDetailToolDependencies,
): McpProjectDetailToolExecutor {
  return async function executeProjectDetailRead(
    args: McpProjectDetailToolArguments,
  ): Promise<McpProjectDetailToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        PROJECT_DETAIL_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PROJECT_DETAIL_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const path = parseApiV1ProjectDetailPath(
        buildCanonicalProjectDetailPath(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        path.projectId,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}

/**
 * Creates the per-request `projects.planning.get` MCP executor. Same authority
 * ordering; the canonical planning path parser and the accepted delegated
 * planning reader own all validation and data shaping.
 */
export function createMcpProjectPlanningToolExecutor(
  dependencies: McpProjectPlanningToolDependencies,
): McpProjectPlanningToolExecutor {
  return async function executeProjectPlanningRead(
    args: McpProjectPlanningToolArguments,
  ): Promise<McpProjectPlanningToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        PROJECT_PLANNING_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PROJECT_PLANNING_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const path = parseApiV1ProjectPlanningPath(
        buildCanonicalProjectPlanningPath(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        path.projectId,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
