// API-Q.10D3 — Blocker update MCP mutation-control composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `blockers.update`. It composes only already accepted
// components:
//
//   - literal confirmation control          : `requireMcpMutationConfirmation`
//   - canonical Blocker identity validation : `parseApiV1BlockerUpdatePath`
//   - canonical business validation         : `parseApiV1UpdateBlockerBody`
//   - canonical idempotency + payload hash  : `buildMcpMutationExecutionContext`
//     over `buildApiV1UpdateBlockerIdempotencyPayload(blockerId, body)`
//   - canonical rate limiting               : `enforceApiRateLimit`
//   - caller-bound writer                   : `McpV1UpdateBlockerExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, no encryption, persists nothing, logs nothing,
// starts no timer, performs no retry, performs no read-before-write and
// registers no MCP tool. No generic operation dispatcher exists here.
//
// Optimistic concurrency: the caller's `expectedUpdatedAt` is a precondition.
// It is never refreshed, reformatted, replaced or retried here.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  type ApiV1BlockerSeverity,
  type ApiV1BlockerStatus,
  type ApiV1BlockerTargetType,
  BLOCKER_UPDATE_ROUTE,
  buildApiV1UpdateBlockerIdempotencyPayload,
  parseApiV1BlockerUpdatePath,
  parseApiV1UpdateBlockerBody,
} from "../../_shared/btpm-api/routes/blockers.ts";
import type { ApiV1UpdateBlockerSuccessResult } from "../../_shared/btpm-api/supabaseBlocker.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import type { McpV1UpdateBlockerExecutor } from "./blockerUpdateMutationExecutor.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";

/** Advertised MCP tool name for the canonical `blockers.update`. */
export const MCP_BLOCKER_UPDATE_TOOL_NAME = "btpm_update_blocker";

/** Canonical Blocker identity path prefix; the accepted parser owns validation. */
const BLOCKER_PATH_PREFIX = "/v1/blockers/";

/**
 * Strict MCP transport guard. It is presentation only: canonical validation
 * remains authoritative for business fields (UUID form, timestamp form,
 * blank/length handling) and for idempotency.
 */
export const MCP_BLOCKER_UPDATE_TOOL_INPUT_SCHEMA = z.strictObject({
  blockerId: z.string(),
  expectedUpdatedAt: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["open", "in_progress", "resolved"]),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact eight approved MCP argument names. */
export const MCP_BLOCKER_UPDATE_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "blockerId",
    "expectedUpdatedAt",
    "title",
    "description",
    "severity",
    "status",
    "confirmation",
    "idempotencyKey",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpBlockerUpdateToolArguments {
  readonly blockerId: string;
  readonly expectedUpdatedAt: string;
  readonly title: string;
  readonly description: string | null;
  readonly severity: ApiV1BlockerSeverity;
  readonly status: ApiV1BlockerStatus;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpBlockerUpdateToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "stale_blocker"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_BLOCKER_UPDATE_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpBlockerUpdateToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to update this Blocker.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  stale_blocker:
    "This Blocker has changed since the supplied expectedUpdatedAt. Read the current Blocker and retry intentionally with a new updatedAt and a new idempotency key.",
  unavailable: "BTPM Blocker update is temporarily unavailable.",
});

/** Bounded successful tool payload. No Blocker narrative is returned. */
export interface McpBlockerUpdateToolPayload {
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly blockerId: string;
  readonly targetType: ApiV1BlockerTargetType;
  readonly targetId: string;
  readonly severity: ApiV1BlockerSeverity;
  readonly status: ApiV1BlockerStatus;
  readonly isResolved: boolean;
  readonly resolvedAt: string | null;
  readonly updatedAt: string;
}

/** Bounded tool result union. */
export type McpBlockerUpdateToolResult =
  | { readonly ok: true; readonly payload: McpBlockerUpdateToolPayload }
  | {
    readonly ok: false;
    readonly category: McpBlockerUpdateToolErrorCategory;
  };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpBlockerUpdateToolExecutor = (
  args: McpBlockerUpdateToolArguments,
) => Promise<McpBlockerUpdateToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpBlockerUpdateToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1UpdateBlockerExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpBlockerUpdateToolErrorCategory {
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
  outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending",
): McpBlockerUpdateToolErrorCategory {
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
  result: ApiV1UpdateBlockerSuccessResult,
): McpBlockerUpdateToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    blockerId: result.blockerId,
    targetType: result.targetType,
    targetId: result.targetId,
    severity: result.severity,
    status: result.status,
    isResolved: result.isResolved,
    resolvedAt: result.resolvedAt,
    updatedAt: result.updatedAt,
  });
}

/**
 * Creates the per-request `blockers.update` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. literal confirmation is required (before rate limiting and writer);
 *   3. the Blocker identity is validated through the canonical path parser;
 *   4. the COMPLETE five-field desired-state business body is built;
 *   5. it is validated through `parseApiV1UpdateBlockerBody`;
 *   6. the canonical Blocker-update idempotency payload (blockerId + full
 *      desired state) is built;
 *   7. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash);
 *   8. the canonical rate-limit profile is resolved;
 *   9. the canonical atomic rate limit is consumed;
 *  10. the accepted caller-bound writer is invoked exactly once.
 */
export function createMcpBlockerUpdateToolExecutor(
  dependencies: McpBlockerUpdateToolDependencies,
): McpBlockerUpdateToolExecutor {
  return async function executeBlockerUpdate(
    args: McpBlockerUpdateToolArguments,
  ): Promise<McpBlockerUpdateToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_BLOCKER_UPDATE_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before any rate-limit consumption or writer.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical Blocker identity.
      const { blockerId: canonicalBlockerId } = parseApiV1BlockerUpdatePath(
        `${BLOCKER_PATH_PREFIX}${parsedArgs.blockerId}`,
      );

      // 4. COMPLETE desired-state business object (no control field).
      const businessInput: Record<string, unknown> = {
        expectedUpdatedAt: parsedArgs.expectedUpdatedAt,
        title: parsedArgs.title,
        description: parsedArgs.description,
        severity: parsedArgs.severity,
        status: parsedArgs.status,
      };

      // 5. Canonical business validation.
      const canonicalBody = parseApiV1UpdateBlockerBody(businessInput);

      // 6. Canonical Blocker-update idempotency payload (identity + state).
      const canonicalIdempotencyPayload =
        buildApiV1UpdateBlockerIdempotencyPayload(
          canonicalBlockerId,
          canonicalBody,
        );

      // 7. Canonical mutation execution context (idempotency + payload hash).
      const mutationContext = await buildMcpMutationExecutionContext(
        dependencies.execution,
        parsedArgs.idempotencyKey,
        canonicalIdempotencyPayload,
      );

      // 8. Canonical rate-limit profile.
      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        BLOCKER_UPDATE_ROUTE.id,
      );

      // 9. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: BLOCKER_UPDATE_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 10. Accepted caller-bound writer, invoked exactly once. The caller's
      // concurrency precondition is forwarded unchanged.
      const result = await dependencies.writer(
        dependencies.request,
        canonicalBlockerId,
        canonicalBody,
        mutationContext,
      );

      if (result.ok) {
        return Object.freeze({
          ok: true as const,
          payload: toBoundedPayload(result),
        });
      }

      if (result.outcome === "conflict") {
        // Bounded stale conflict: never retried, never refreshed, and no
        // current database timestamp is disclosed.
        return Object.freeze({ ok: false as const, category: "stale_blocker" });
      }

      return Object.freeze({
        ok: false as const,
        category: mapNegativeOutcome(result.outcome),
      });
    } catch (error) {
      // Only a bounded category escapes: no SQLSTATE, database message, stack,
      // policy reason, token, identity, narrative or internal function name.
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
