// API-Q Project Transition Step 3 — Project-transition MCP mutation-control
// composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `projects.transition`. It composes only already
// accepted components:
//
//   - literal transport confirmation control : `requireMcpMutationConfirmation`
//   - canonical Project identity parsing     : `parseApiV1ProjectTransitionPath`
//   - canonical business validation          : `parseApiV1TransitionProjectBody`
//   - canonical idempotency + payload hash   : `buildMcpMutationExecutionContext`
//     over `buildApiV1TransitionProjectIdempotencyPayload(projectId, body)`
//   - canonical rate limiting                : `enforceApiRateLimit`
//   - caller-bound Step-2 writer             : `McpV1TransitionProjectExecutor`
//
// It creates no Supabase client, reads no environment variable, invokes no RPC
// directly, calls no PMG function, touches no table, uses no service-role
// credential, performs no authorization, no Tenant/Organization/Workspace scope
// derivation, no Project or Program lookup, no Project Connected-App enablement
// check, no Project auto-enablement, no supported-transition matrix, no
// completion validation, no blocker/risk/task/phase evaluation, no reopen rule,
// no encryption, persists nothing, logs nothing, starts no timer, performs no
// retry and no read-before-write, and registers no MCP tool. No generic
// operation dispatcher exists here.
//
// Two confirmation concepts stay strictly separate:
//   - `confirmation`     — MCP TRANSPORT control metadata. It never enters the
//     canonical business body, the canonical idempotency payload, the payload
//     hash, the writer body or the database.
//   - `confirmWarnings`  — canonical Project lifecycle BUSINESS input. It enters
//     the canonical parser, the canonical idempotency payload, the payload hash
//     and the writer body.
//
// Optimistic concurrency: the caller's `expectedUpdatedAt` is the sole
// precondition. It is never refreshed, reformatted, replaced or retried here,
// and no current database timestamp is ever disclosed.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  buildApiV1TransitionProjectIdempotencyPayload,
  parseApiV1ProjectTransitionPath,
  parseApiV1TransitionProjectBody,
  PROJECT_TRANSITION_ROUTE,
} from "../../_shared/btpm-api/routes/projects.ts";
import type {
  ApiV1ProjectCompletionItem,
  ApiV1TransitionProjectBlockedResult,
  ApiV1TransitionProjectConfirmationResult,
  ApiV1TransitionProjectSuccessResult,
} from "../../_shared/btpm-api/supabaseProjectMutation.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1TransitionProjectExecutor } from "./projectTransitionMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `projects.transition`. */
export const MCP_PROJECT_TRANSITION_TOOL_NAME = "btpm_transition_project";

/** Canonical Project transition path prefix; the accepted parser validates. */
const PROJECT_PATH_PREFIX = "/v1/projects/";

/** Canonical Project transition path suffix; the accepted parser validates. */
const PROJECT_TRANSITION_PATH_SUFFIX = "/transition";

/**
 * Strict MCP transport guard. It is presentation only: canonical validation
 * remains authoritative for timestamp form and target-status vocabulary.
 *
 * `confirmWarnings` is intentionally REQUIRED for the MCP contract and is never
 * defaulted here. No identity, scope, provenance, hash, rate-limit, timestamp
 * refresh, completion or RPC field is exposed.
 */
export const MCP_PROJECT_TRANSITION_TOOL_INPUT_SCHEMA = z.strictObject({
  projectId: z.string(),
  expectedUpdatedAt: z.string(),
  targetStatus: z.enum([
    "planned",
    "active",
    "completed",
    "on_hold",
    "cancelled",
  ]),
  confirmWarnings: z.boolean(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact six approved MCP argument names, in canonical order. */
export const MCP_PROJECT_TRANSITION_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "projectId",
    "expectedUpdatedAt",
    "targetStatus",
    "confirmWarnings",
    "confirmation",
    "idempotencyKey",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpProjectTransitionToolArguments {
  readonly projectId: string;
  readonly expectedUpdatedAt: string;
  readonly targetStatus:
    | "planned"
    | "active"
    | "completed"
    | "on_hold"
    | "cancelled";
  readonly confirmWarnings: boolean;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/**
 * Bounded transport/control failure categories this tool may disclose.
 *
 * `confirmation_required` here means ONLY that the MCP TRANSPORT mutation
 * confirmation was not provided. It is NOT the canonical Project lifecycle
 * business result `outcome = confirmation_required` /
 * `code = completion_soft_warnings`, which is returned as a successful
 * structured business payload instead.
 */
export type McpProjectTransitionToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "stale_project"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_PROJECT_TRANSITION_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpProjectTransitionToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to transition this Project.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  stale_project:
    "This Project has changed since the supplied expectedUpdatedAt. Read the current Project and retry intentionally with the current updatedAt and a new idempotency key.",
  unavailable: "BTPM Project transition is temporarily unavailable.",
});

/** Bounded applied / no-change / replayed business payload. */
export interface McpProjectTransitionSuccessPayload {
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly projectId: string;
  readonly status: string;
  readonly previousStatus: string;
  readonly updatedAt: string;
}

/** Bounded canonical hard-block business payload. */
export interface McpProjectTransitionBlockedPayload {
  readonly outcome: "blocked";
  readonly code: "completion_hard_blocked";
  readonly projectId: string;
  readonly hardBlocks: readonly ApiV1ProjectCompletionItem[];
  readonly warnings: readonly ApiV1ProjectCompletionItem[];
  readonly counts: Readonly<Record<string, number>>;
}

/** Bounded canonical soft-warning business payload. */
export interface McpProjectTransitionWarningPayload {
  readonly outcome: "confirmation_required";
  readonly code: "completion_soft_warnings";
  readonly projectId: string;
  readonly warnings: readonly ApiV1ProjectCompletionItem[];
  readonly counts: Readonly<Record<string, number>>;
}

export type McpProjectTransitionToolPayload =
  | McpProjectTransitionSuccessPayload
  | McpProjectTransitionBlockedPayload
  | McpProjectTransitionWarningPayload;

/**
 * Bounded tool result union. Outer `ok: true` means a canonical business result
 * was produced; it does NOT mean the Project status necessarily changed.
 */
export type McpProjectTransitionToolResult =
  | {
    readonly ok: true;
    readonly payload: McpProjectTransitionToolPayload;
  }
  | {
    readonly ok: false;
    readonly category: McpProjectTransitionToolErrorCategory;
  };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpProjectTransitionToolExecutor = (
  args: McpProjectTransitionToolArguments,
) => Promise<McpProjectTransitionToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpProjectTransitionToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1TransitionProjectExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpProjectTransitionToolErrorCategory {
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
): McpProjectTransitionToolErrorCategory {
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

function toSuccessPayload(
  result: ApiV1TransitionProjectSuccessResult,
): McpProjectTransitionSuccessPayload {
  return Object.freeze({
    outcome: result.outcome,
    projectId: result.projectId,
    status: result.status,
    previousStatus: result.previousStatus,
    updatedAt: result.updatedAt,
  });
}

function toBlockedPayload(
  result: ApiV1TransitionProjectBlockedResult,
): McpProjectTransitionBlockedPayload {
  return Object.freeze({
    outcome: "blocked" as const,
    code: "completion_hard_blocked" as const,
    projectId: result.projectId,
    hardBlocks: result.hardBlocks,
    warnings: result.warnings,
    counts: result.counts,
  });
}

function toWarningPayload(
  result: ApiV1TransitionProjectConfirmationResult,
): McpProjectTransitionWarningPayload {
  return Object.freeze({
    outcome: "confirmation_required" as const,
    code: "completion_soft_warnings" as const,
    projectId: result.projectId,
    warnings: result.warnings,
    counts: result.counts,
  });
}

/**
 * Creates the per-request `projects.transition` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. MCP transport confirmation is required (before idempotency/hash, rate
 *      limiting and writer);
 *   3. the Project identity is validated through the canonical path parser;
 *   4. a BUSINESS-ONLY raw object is built (expectedUpdatedAt, targetStatus,
 *      confirmWarnings only);
 *   5. it is validated exactly once through `parseApiV1TransitionProjectBody`;
 *   6. the canonical Project-transition idempotency payload is built;
 *   7. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash);
 *   8. the canonical rate-limit profile is resolved;
 *   9. the canonical atomic rate limit is consumed;
 *  10. the accepted caller-bound Step-2 writer is invoked exactly once.
 */
export function createMcpProjectTransitionToolExecutor(
  dependencies: McpProjectTransitionToolDependencies,
): McpProjectTransitionToolExecutor {
  return async function executeProjectTransition(
    args: McpProjectTransitionToolArguments,
  ): Promise<McpProjectTransitionToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_PROJECT_TRANSITION_TOOL_INPUT_SCHEMA.parse(args);

      // 2. MCP TRANSPORT confirmation only. `confirmWarnings` is never passed
      // here, and `confirmation` never travels any further than this gate.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical Project identity.
      const { projectId: canonicalProjectId } = parseApiV1ProjectTransitionPath(
        `${PROJECT_PATH_PREFIX}${parsedArgs.projectId}${PROJECT_TRANSITION_PATH_SUFFIX}`,
      );

      // 4. Business-only raw object: no transport confirmation, no idempotency
      // key, no Project identifier.
      const rawBusinessInput = {
        expectedUpdatedAt: parsedArgs.expectedUpdatedAt,
        targetStatus: parsedArgs.targetStatus,
        confirmWarnings: parsedArgs.confirmWarnings,
      };

      // 5. Canonical business validation, exactly once.
      const canonicalBody = parseApiV1TransitionProjectBody(rawBusinessInput);

      // 6. Canonical Project-transition idempotency payload.
      const canonicalIdempotencyPayload =
        buildApiV1TransitionProjectIdempotencyPayload(
          canonicalProjectId,
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
        PROJECT_TRANSITION_ROUTE.id,
      );

      // 9. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PROJECT_TRANSITION_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 10. Accepted caller-bound Step-2 writer, invoked exactly once. The
      // caller's concurrency precondition is forwarded unchanged.
      const result = await dependencies.writer(
        dependencies.request,
        canonicalProjectId,
        canonicalBody,
        mutationContext,
      );

      if (result.ok) {
        return Object.freeze({
          ok: true as const,
          payload: toSuccessPayload(result),
        });
      }

      if (result.outcome === "blocked") {
        // Deterministic canonical BUSINESS result, preserved as structured
        // successful output rather than an error category.
        return Object.freeze({
          ok: true as const,
          payload: toBlockedPayload(result),
        });
      }

      if (result.outcome === "confirmation_required") {
        // Canonical Project lifecycle soft-warning BUSINESS result. This is not
        // the MCP transport `confirmation_required` error category.
        return Object.freeze({
          ok: true as const,
          payload: toWarningPayload(result),
        });
      }

      if (result.outcome === "conflict") {
        // Bounded stale conflict: never retried, never refreshed, and no
        // current database timestamp is disclosed.
        return Object.freeze({ ok: false as const, category: "stale_project" });
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
