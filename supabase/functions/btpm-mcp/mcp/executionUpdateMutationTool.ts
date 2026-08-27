// API-Q.9B1 — Execution Update MCP mutation tool control composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `execution_updates.append`. It composes only already
// accepted components:
//
//   - literal confirmation control        : `requireMcpMutationConfirmation`
//   - canonical business validation       : `parseApiV1AppendExecutionUpdateBody`
//   - canonical idempotency + payload hash: `buildMcpMutationExecutionContext`
//   - canonical rate limiting             : `enforceApiRateLimit`
//   - caller-bound writer                 : `McpV1AppendExecutionUpdateExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, persists nothing, logs nothing and registers no
// MCP tool. No generic operation dispatcher exists here.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  EXECUTION_UPDATES_APPEND_ROUTE,
  parseApiV1AppendExecutionUpdateBody,
} from "../../_shared/btpm-api/routes/executionUpdates.ts";
import type { ApiV1AppendExecutionUpdateSuccessResult } from "../../_shared/btpm-api/supabaseAppendExecutionUpdate.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1AppendExecutionUpdateExecutor } from "./executionUpdateMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `execution_updates.append`. */
export const MCP_EXECUTION_UPDATE_APPEND_TOOL_NAME =
  "btpm_append_execution_update";

/**
 * Strict MCP transport guard. It is presentation only: canonical validation
 * remains authoritative for business fields, confirmation and idempotency.
 */
export const MCP_EXECUTION_UPDATE_APPEND_TOOL_INPUT_SCHEMA = z.strictObject({
  targetType: z.enum(["phase", "task"]),
  targetId: z.string(),
  summary: z.string(),
  updateDate: z.string(),
  statusLabel: z.string().nullable().optional(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact seven approved MCP argument names. */
export const MCP_EXECUTION_UPDATE_APPEND_TOOL_ARGUMENT_NAMES: ReadonlyArray<
  string
> = Object.freeze([
  "targetType",
  "targetId",
  "summary",
  "updateDate",
  "statusLabel",
  "confirmation",
  "idempotencyKey",
]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpExecutionUpdateAppendToolArguments {
  readonly targetType: "phase" | "task";
  readonly targetId: string;
  readonly summary: string;
  readonly updateDate: string;
  readonly statusLabel?: string | null;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpExecutionUpdateAppendToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_EXECUTION_UPDATE_APPEND_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpExecutionUpdateAppendToolErrorCategory, string>
> = Object.freeze({
  confirmation_required:
    "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to append this Execution Update.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  unavailable:
    "BTPM Execution Update append is temporarily unavailable.",
});

/** Bounded successful tool payload. No narrative summary is returned. */
export interface McpExecutionUpdateAppendToolPayload {
  readonly outcome: "applied" | "replayed";
  readonly executionUpdateId: string;
  readonly targetType: "phase" | "task";
  readonly targetId: string;
  readonly updateDate: string;
  readonly hasStatusLabel: boolean;
}

/** Bounded tool result union. */
export type McpExecutionUpdateAppendToolResult =
  | {
    readonly ok: true;
    readonly payload: McpExecutionUpdateAppendToolPayload;
  }
  | {
    readonly ok: false;
    readonly category: McpExecutionUpdateAppendToolErrorCategory;
  };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpExecutionUpdateAppendToolExecutor = (
  args: McpExecutionUpdateAppendToolArguments,
) => Promise<McpExecutionUpdateAppendToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpExecutionUpdateAppendToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1AppendExecutionUpdateExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpExecutionUpdateAppendToolErrorCategory {
  if (error instanceof McpMutationControlError) {
    if (error.code === "mcp_mutation_confirmation_required") {
      return "confirmation_required";
    }
    // A malformed trusted context is internal: never disclose which invariant.
    return "unavailable";
  }
  if (error instanceof z.ZodError) {
    return "invalid_arguments";
  }
  if (error instanceof IdempotencyValidationError) {
    return "invalid_arguments";
  }
  if (error instanceof ApiHttpError) {
    if (error.code === "rate_limit_exceeded") return "rate_limited";
    if (error.code === "not_authorized") return "not_authorized";
    if (error.code === "invalid_request") return "invalid_arguments";
  }
  return "unavailable";
}

function mapNegativeOutcome(
  outcome: "invalid" | "not_authorized" | "idempotency_conflict" |
    "idempotency_pending",
): McpExecutionUpdateAppendToolErrorCategory {
  switch (outcome) {
    case "invalid":
      return "invalid_arguments";
    case "not_authorized":
      return "not_authorized";
    case "idempotency_conflict":
      return "idempotency_conflict";
    case "idempotency_pending":
      return "idempotency_pending";
  }
}

function toBoundedPayload(
  result: ApiV1AppendExecutionUpdateSuccessResult,
): McpExecutionUpdateAppendToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    executionUpdateId: result.executionUpdateId,
    targetType: result.targetType,
    targetId: result.targetId,
    updateDate: result.updateDate,
    hasStatusLabel: result.hasStatusLabel,
  });
}

/**
 * Creates the per-request `execution_updates.append` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated by the caller/schema and
 *      re-guarded structurally here;
 *   2. literal confirmation is required;
 *   3. a business-only object is built (no confirmation, no idempotency key,
 *      no identity, scope or provenance field);
 *   4. it is validated through `parseApiV1AppendExecutionUpdateBody`;
 *   5. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash over the canonical body);
 *   6. the canonical rate-limit profile is resolved;
 *   7. the canonical atomic rate limit is consumed;
 *   8. the accepted caller-bound writer is invoked.
 */
export function createMcpExecutionUpdateAppendToolExecutor(
  dependencies: McpExecutionUpdateAppendToolDependencies,
): McpExecutionUpdateAppendToolExecutor {
  return async function executeExecutionUpdateAppend(
    args: McpExecutionUpdateAppendToolArguments,
  ): Promise<McpExecutionUpdateAppendToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_EXECUTION_UPDATE_APPEND_TOOL_INPUT_SCHEMA.parse(
        args,
      );

      // 2. Literal confirmation, before any rate-limit consumption or writer.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Business-only object.
      const businessInput: Record<string, unknown> = {
        targetType: parsedArgs.targetType,
        targetId: parsedArgs.targetId,
        summary: parsedArgs.summary,
        updateDate: parsedArgs.updateDate,
      };
      if (parsedArgs.statusLabel !== undefined) {
        businessInput.statusLabel = parsedArgs.statusLabel;
      }

      // 4. Canonical business validation.
      const canonicalBody = parseApiV1AppendExecutionUpdateBody(businessInput);

      // 5. Canonical mutation execution context (idempotency + payload hash).
      const mutationContext = await buildMcpMutationExecutionContext(
        dependencies.execution,
        parsedArgs.idempotencyKey,
        canonicalBody,
      );

      // 6. Canonical rate-limit profile.
      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        EXECUTION_UPDATES_APPEND_ROUTE.id,
      );

      // 7. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: EXECUTION_UPDATES_APPEND_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 8. Accepted caller-bound writer.
      const result = await dependencies.writer(
        dependencies.request,
        canonicalBody,
        mutationContext,
      );

      if (result.ok) {
        return Object.freeze({
          ok: true as const,
          payload: toBoundedPayload(result),
        });
      }

      return Object.freeze({
        ok: false as const,
        category: mapNegativeOutcome(result.outcome),
      });
    } catch (error) {
      // Only a bounded category escapes: no SQLSTATE, database message, stack,
      // policy reason, token, identity or internal function name.
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
