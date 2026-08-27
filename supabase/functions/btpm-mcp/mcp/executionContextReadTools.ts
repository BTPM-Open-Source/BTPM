// API-Q.7E — Explicit MCP business-read adapters for the canonical execution
// context reads: `execution_updates.get`, `phases.get_by_id` and
// `tasks.get_by_id`.
//
// These are THIN ADAPTERS, following the accepted API-Q.7A–7D precedents
// exactly. They contain NO Execution Update / Phase / Task business logic, NO
// authorization or containment rule, NO RLS logic, NO encryption/decryption, NO
// narrative reconstruction, NO cursor or pagination logic, NO SQL and NO RPC
// contract. They do not implement `api_v1_list_execution_updates`,
// `api_v1_get_phase` or `api_v1_get_task`, do not call `.from()` on business
// tables, never use a service-role client, and never perform an HTTP call to
// `btpm-api-v1`.
//
// Everything authoritative is reused verbatim:
//   - query validation/defaulting  : `parseApiV1ExecutionUpdatesReadQuery`
//   - path validation              : `parseApiV1PhaseDetailPath`,
//                                    `parseApiV1TaskDetailPath`
//   - route identity               : `EXECUTION_UPDATES_READ_ROUTE.id`,
//                                    `PHASE_DETAIL_ROUTE.id`,
//                                    `TASK_DETAIL_ROUTE.id`
//   - rate-limit enforcement       : `enforceApiRateLimit` + Supabase adapters
//   - caller-scoped business read  : the accepted delegated readers
//   - trusted identity bridge      : `buildAuthenticatedApiContextFromMcp`
//
// The caller's raw bearer token flows ONLY through the accepted delegated
// readers. It never enters the trusted execution context, tool arguments,
// registry metadata, tool output or any log.
//
// Explicit per-operation adapters by design: no generic read-tool executor, no
// operationId → executor map, no dynamic parser/reader/RPC dispatch.

import { z } from "npm:zod@4.4.3";

import {
  EXECUTION_UPDATES_READ_ROUTE,
  parseApiV1ExecutionUpdatesReadQuery,
} from "../../_shared/btpm-api/routes/executionUpdates.ts";
import {
  PHASE_DETAIL_ROUTE,
  parseApiV1PhaseDetailPath,
} from "../../_shared/btpm-api/routes/phases.ts";
import {
  TASK_DETAIL_ROUTE,
  parseApiV1TaskDetailPath,
} from "../../_shared/btpm-api/routes/tasks.ts";
import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import type { ApiV1ExecutionUpdatesPayload } from "../../_shared/btpm-api/supabaseExecutionUpdateRead.ts";
import type { ApiV1PhaseReadItem } from "../../_shared/btpm-api/supabasePhaseRead.ts";
import type { ApiV1TaskReadItem } from "../../_shared/btpm-api/supabaseTaskRead.ts";
import type { DelegatedApiV1ExecutionUpdatesReader } from "../../_shared/btpm-api/supabaseDelegatedExecutionUpdateRead.ts";
import type { DelegatedApiV1PhaseReader } from "../../_shared/btpm-api/supabaseDelegatedPhaseRead.ts";
import type { DelegatedApiV1TaskReader } from "../../_shared/btpm-api/supabaseDelegatedTaskRead.ts";
import type { McpAuthorizedContext } from "./authorizeMcpConnectedApp.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import { buildAuthenticatedApiContextFromMcp } from "./mcpApiContext.ts";
import type { McpToolErrorCategory } from "./organizationsReadTool.ts";

/** Advertised MCP tool names for the canonical execution context reads. */
export const MCP_EXECUTION_UPDATES_TOOL_NAME = "btpm_list_execution_updates";
export const MCP_PHASE_DETAIL_TOOL_NAME = "btpm_get_phase";
export const MCP_TASK_DETAIL_TOOL_NAME = "btpm_get_task";

/**
 * MCP tool input schemas. Presentation only: the canonical parsers remain the
 * sole authority for target-type, UUID, limit and cursor validation.
 */
export const MCP_EXECUTION_UPDATES_TOOL_INPUT_SCHEMA = z.object({
  targetType: z.string(),
  targetId: z.string(),
  limit: z.number().int().optional(),
  cursor: z.string().optional(),
});

export const MCP_PHASE_DETAIL_TOOL_INPUT_SCHEMA = z.object({
  phaseId: z.string(),
});

export const MCP_TASK_DETAIL_TOOL_INPUT_SCHEMA = z.object({
  taskId: z.string(),
});

/** Untrusted, already schema-validated MCP tool arguments. */
export interface McpExecutionUpdatesToolArguments {
  readonly targetType: string;
  readonly targetId: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface McpPhaseDetailToolArguments {
  readonly phaseId: string;
}

export interface McpTaskDetailToolArguments {
  readonly taskId: string;
}

/** The only external messages an Execution Update tool failure may disclose. */
export const MCP_EXECUTION_UPDATE_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpToolErrorCategory, string>
> = Object.freeze({
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to access Execution Updates.",
  rate_limited: "Rate limit exceeded. Try again later.",
  unavailable: "BTPM Execution Update read is temporarily unavailable.",
});

/** The only external messages a Phase MCP tool failure may disclose. */
export const MCP_PHASE_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpToolErrorCategory, string>
> = Object.freeze({
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to access Phase data.",
  rate_limited: "Rate limit exceeded. Try again later.",
  unavailable: "BTPM Phase read is temporarily unavailable.",
});

/** The only external messages a Task MCP tool failure may disclose. */
export const MCP_TASK_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpToolErrorCategory, string>
> = Object.freeze({
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to access Task data.",
  rate_limited: "Rate limit exceeded. Try again later.",
  unavailable: "BTPM Task read is temporarily unavailable.",
});

export type McpExecutionUpdatesToolResult =
  | { readonly ok: true; readonly payload: ApiV1ExecutionUpdatesPayload }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

export type McpPhaseDetailToolResult =
  | { readonly ok: true; readonly payload: ApiV1PhaseReadItem }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

export type McpTaskDetailToolResult =
  | { readonly ok: true; readonly payload: ApiV1TaskReadItem }
  | { readonly ok: false; readonly category: McpToolErrorCategory };

/** The bounded executors the MCP server factory is allowed to know. */
export type McpExecutionUpdatesToolExecutor = (
  args: McpExecutionUpdatesToolArguments,
) => Promise<McpExecutionUpdatesToolResult>;

export type McpPhaseDetailToolExecutor = (
  args: McpPhaseDetailToolArguments,
) => Promise<McpPhaseDetailToolResult>;

export type McpTaskDetailToolExecutor = (
  args: McpTaskDetailToolArguments,
) => Promise<McpTaskDetailToolResult>;

/** Per-request execution dependencies. No Supabase client, no service role. */
export interface McpExecutionUpdatesToolDependencies {
  /** The original authenticated MCP request; the delegated reader owns it. */
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1ExecutionUpdatesReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

export interface McpPhaseDetailToolDependencies {
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1PhaseReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

export interface McpTaskDetailToolDependencies {
  readonly request: Request;
  readonly authorized: McpAuthorizedContext;
  readonly execution: McpTrustedExecutionContext;
  readonly reader: DelegatedApiV1TaskReader;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

/**
 * Builds the equivalent canonical Execution Update query string. `targetType`
 * and `targetId` are forwarded verbatim (percent-encoded for transport only);
 * omitted optional fields stay omitted so the canonical parser applies the
 * canonical defaults (limit 100, cursor null) and fails closed on anything it
 * does not accept.
 */
export function buildCanonicalExecutionUpdatesQueryString(
  args: McpExecutionUpdatesToolArguments,
): string {
  const parts: string[] = [
    `targetType=${encodeURIComponent(String(args.targetType))}`,
    `targetId=${encodeURIComponent(String(args.targetId))}`,
  ];
  if (args.limit !== undefined) {
    parts.push(`limit=${encodeURIComponent(String(args.limit))}`);
  }
  if (args.cursor !== undefined) {
    parts.push(`cursor=${encodeURIComponent(args.cursor)}`);
  }
  return `?${parts.join("&")}`;
}

/** Builds the canonical Phase detail pathname, unencoded for the parser. */
export function buildCanonicalPhaseDetailPath(
  args: McpPhaseDetailToolArguments,
): string {
  return `/v1/phases/${String(args.phaseId)}`;
}

/** Builds the canonical Task detail pathname, unencoded for the parser. */
export function buildCanonicalTaskDetailPath(
  args: McpTaskDetailToolArguments,
): string {
  return `/v1/tasks/${String(args.taskId)}`;
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
 * Creates the per-request `execution_updates.get` MCP executor.
 *
 * Execution order:
 *   1. derive the canonical API context from the authorized MCP context;
 *   2. resolve the database-controlled rate-limit profile;
 *   3. consume the atomic rate limit for client + user + route;
 *   4. validate/default arguments through the canonical query parser;
 *   5. read through the accepted caller-scoped delegated reader.
 */
export function createMcpExecutionUpdatesToolExecutor(
  dependencies: McpExecutionUpdatesToolDependencies,
): McpExecutionUpdatesToolExecutor {
  return async function executeExecutionUpdatesRead(
    args: McpExecutionUpdatesToolArguments,
  ): Promise<McpExecutionUpdatesToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        EXECUTION_UPDATES_READ_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: EXECUTION_UPDATES_READ_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const query = parseApiV1ExecutionUpdatesReadQuery(
        buildCanonicalExecutionUpdatesQueryString(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        query.targetType,
        query.targetId,
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

/** Creates the per-request `phases.get_by_id` MCP executor. */
export function createMcpPhaseDetailToolExecutor(
  dependencies: McpPhaseDetailToolDependencies,
): McpPhaseDetailToolExecutor {
  return async function executePhaseDetailRead(
    args: McpPhaseDetailToolArguments,
  ): Promise<McpPhaseDetailToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        PHASE_DETAIL_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PHASE_DETAIL_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const path = parseApiV1PhaseDetailPath(
        buildCanonicalPhaseDetailPath(args),
      );

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        path.phaseId,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}

/** Creates the per-request `tasks.get_by_id` MCP executor. */
export function createMcpTaskDetailToolExecutor(
  dependencies: McpTaskDetailToolDependencies,
): McpTaskDetailToolExecutor {
  return async function executeTaskDetailRead(
    args: McpTaskDetailToolArguments,
  ): Promise<McpTaskDetailToolResult> {
    try {
      const apiContext = buildAuthenticatedApiContextFromMcp(
        dependencies.authorized,
      );

      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        TASK_DETAIL_ROUTE.id,
      );

      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: TASK_DETAIL_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      const path = parseApiV1TaskDetailPath(buildCanonicalTaskDetailPath(args));

      const payload = await dependencies.reader(
        dependencies.request,
        apiContext,
        path.taskId,
      );

      return Object.freeze({ ok: true as const, payload });
    } catch (error) {
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
