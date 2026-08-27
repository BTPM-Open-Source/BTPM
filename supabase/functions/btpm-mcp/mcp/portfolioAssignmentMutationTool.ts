// API-Q Portfolio-11C — Project↔Portfolio assignment MCP mutation-control
// composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `portfolios.assign_project`. It composes only
// already accepted components:
//
//   - ordinary MCP confirmation control     : `requireMcpMutationConfirmation`
//   - canonical Project identity validation : `parseApiV1PortfolioAssignProjectPath`
//   - canonical business validation         : `parseApiV1AssignProjectPortfolioBody`
//   - canonical idempotency + payload hash  : `buildMcpMutationExecutionContext`
//     over `buildApiV1AssignProjectPortfolioIdempotencyPayload(projectId, body)`
//   - canonical rate limiting               : `enforceApiRateLimit`
//   - caller-bound writer (Portfolio-11B)   : `McpV1AssignProjectPortfolioExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no
// database function, calls no PMG function, touches no table, uses no
// service-role credential, performs no authorization, no Connected App
// enablement check, no Tenant/Organization/Workspace scope derivation, no
// Portfolio eligibility or archive validation, no encryption, persists
// nothing, logs nothing, starts no timer, performs no retry, performs no
// read-before-write and registers no MCP tool. All of that authority remains
// owned by the Portfolio-11A trusted database bridge.
//
// `confirmation` is pure control metadata: it never enters the canonical
// business body and never participates in the canonical hashed payload.
//
// Project↔Portfolio assignment has NO optimistic-concurrency token: there is
// intentionally no `expectedUpdatedAt` argument and no stale/conflict outcome
// or category.
//
// `portfolioId: null` is canonical business input meaning "clear the Portfolio
// assignment". It is forwarded exactly as supplied and never substituted.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  buildApiV1AssignProjectPortfolioIdempotencyPayload,
  parseApiV1AssignProjectPortfolioBody,
  parseApiV1PortfolioAssignProjectPath,
  PORTFOLIO_ASSIGN_PROJECT_ROUTE,
} from "../../_shared/btpm-api/routes/portfolios.ts";
import type { ApiV1AssignProjectPortfolioSuccessResult } from "../../_shared/btpm-api/supabasePortfolioMutation.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1AssignProjectPortfolioExecutor } from "./portfolioAssignmentMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `portfolios.assign_project`. */
export const MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_NAME =
  "btpm_assign_project_portfolio";

/** Canonical assignment path prefix/suffix; the accepted parser validates. */
const ASSIGN_PATH_PREFIX = "/v1/projects/";
const ASSIGN_PATH_SUFFIX = "/portfolio";

/**
 * Strict MCP transport guard. It is presentation only. No Tenant,
 * Organization, Workspace, actor, role, source channel, API-client, OAuth
 * client, provenance, request ID, correlation ID, payload hash, concurrency
 * token, rate-limit profile, operation name or function name is accepted from
 * the caller. `portfolioId` is REQUIRED and nullable.
 */
export const MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_INPUT_SCHEMA = z.strictObject({
  projectId: z.string(),
  portfolioId: z.string().nullable(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact four approved MCP argument names, in canonical order. */
export const MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ARGUMENT_NAMES: ReadonlyArray<
  string
> = Object.freeze([
  "projectId",
  "portfolioId",
  "confirmation",
  "idempotencyKey",
]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpPortfolioAssignProjectToolArguments {
  readonly projectId: string;
  /** `null` explicitly clears the Project's Portfolio assignment. */
  readonly portfolioId: string | null;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/**
 * Bounded failure categories this tool may disclose. There is deliberately NO
 * stale/conflict/concurrency category: this operation has no concurrency token.
 */
export type McpPortfolioAssignProjectToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpPortfolioAssignProjectToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized:
    "Not authorized to change this Project's Portfolio assignment.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  unavailable:
    "BTPM Project Portfolio assignment is temporarily unavailable.",
});

/** Bounded successful tool payload. No Portfolio or Project narrative. */
export interface McpPortfolioAssignProjectToolPayload {
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly projectId: string;
  readonly oldPortfolioId: string | null;
  readonly newPortfolioId: string | null;
}

/** Bounded tool result union. */
export type McpPortfolioAssignProjectToolResult =
  | {
    readonly ok: true;
    readonly payload: McpPortfolioAssignProjectToolPayload;
  }
  | {
    readonly ok: false;
    readonly category: McpPortfolioAssignProjectToolErrorCategory;
  };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpPortfolioAssignProjectToolExecutor = (
  args: McpPortfolioAssignProjectToolArguments,
) => Promise<McpPortfolioAssignProjectToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpPortfolioAssignProjectToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1AssignProjectPortfolioExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(
  error: unknown,
): McpPortfolioAssignProjectToolErrorCategory {
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
): McpPortfolioAssignProjectToolErrorCategory {
  switch (outcome) {
    case "invalid":
      return "invalid_arguments";
    case "not_authorized":
      return "not_authorized";
    case "idempotency_conflict":
      return "idempotency_conflict";
    case "idempotency_pending":
      return "idempotency_pending";
    default:
      return "unavailable";
  }
}

function toBoundedPayload(
  result: ApiV1AssignProjectPortfolioSuccessResult,
): McpPortfolioAssignProjectToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    projectId: result.projectId,
    // Nullable Portfolio identities are preserved exactly.
    oldPortfolioId: result.oldPortfolioId,
    newPortfolioId: result.newPortfolioId,
  });
}

const SUCCESS_OUTCOMES: ReadonlySet<string> = new Set([
  "applied",
  "no_change",
  "replayed",
]);

/**
 * Creates the per-request `portfolios.assign_project` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. ordinary MCP confirmation is required (before hashing, rate limiting
 *      and the writer);
 *   3. the Project identity is validated through the canonical path parser;
 *   4. the canonical business-only assignment object is built;
 *   5. the canonical assignment body parser owns every business rule;
 *   6. the canonical assignment idempotency payload is built;
 *   7. the canonical MCP mutation execution context (key + hash) is built;
 *   8. the canonical database-controlled rate profile is resolved;
 *   9. the canonical rate limit is consumed atomically;
 *  10. the accepted Portfolio-11B caller-bound writer runs exactly once;
 *  11. only a bounded result is returned.
 */
export function createMcpPortfolioAssignProjectToolExecutor(
  dependencies: McpPortfolioAssignProjectToolDependencies,
): McpPortfolioAssignProjectToolExecutor {
  return async function executeMcpPortfolioAssignProjectTool(
    args: McpPortfolioAssignProjectToolArguments,
  ): Promise<McpPortfolioAssignProjectToolResult> {
    try {
      // 1. Strict MCP transport envelope.
      const parsedArgs = MCP_PORTFOLIO_ASSIGN_PROJECT_TOOL_INPUT_SCHEMA.parse(
        args,
      );

      // 2. Ordinary MCP mutation confirmation, before any hashing, rate-limit
      // resolution or writer execution.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical Project identity.
      const { projectId: canonicalProjectId } =
        parseApiV1PortfolioAssignProjectPath(
          `${ASSIGN_PATH_PREFIX}${parsedArgs.projectId}${ASSIGN_PATH_SUFFIX}`,
        );

      // 4. Business-only object. The confirmation control is excluded.
      // `portfolioId: null` means "clear the assignment" and is never replaced.
      const businessInput: Record<string, unknown> = {
        portfolioId: parsedArgs.portfolioId,
      };

      // 5. Canonical business validation.
      const canonicalBody = parseApiV1AssignProjectPortfolioBody(businessInput);

      // 6. Canonical assignment idempotency payload (Project identity +
      // canonical business body). No concurrency token exists.
      const canonicalIdempotencyPayload =
        buildApiV1AssignProjectPortfolioIdempotencyPayload(
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
        PORTFOLIO_ASSIGN_PROJECT_ROUTE.id,
      );

      // 9. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PORTFOLIO_ASSIGN_PROJECT_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 10. Accepted caller-bound writer, invoked exactly once. No retry.
      const result = await dependencies.writer(
        dependencies.request,
        canonicalProjectId,
        canonicalBody,
        mutationContext,
      );

      if (result.ok) {
        if (!SUCCESS_OUTCOMES.has(result.outcome)) {
          return Object.freeze({
            ok: false as const,
            category: "unavailable" as const,
          });
        }
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
      // policy reason, token, identity, narrative or internal function name.
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
