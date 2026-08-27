// API-Q Portfolio-9C — Portfolio-create MCP mutation tool control layer.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `portfolios.create`. It composes only already
// accepted components:
//
//   - literal confirmation control        : `requireMcpMutationConfirmation`
//   - canonical business validation       : `parseApiV1CreatePortfolioBody`
//   - canonical idempotency + payload hash: `buildMcpMutationExecutionContext`
//   - canonical rate limiting             : `enforceApiRateLimit`
//   - caller-bound writer (Portfolio-9B)  : `McpV1CreatePortfolioExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, no Connected-App enablement lookup, no
// Tenant/Organization derivation, no owner containment, no encryption,
// persists nothing, logs nothing and registers no MCP tool. No generic
// mutation dispatcher exists here.
//
// Portfolio Create special rule: there is no existing target Portfolio,
// therefore this layer contains no Portfolio table lookup, no Organization
// lookup and no owner lookup. Portfolio Update and Project <-> Portfolio
// assignment are out of scope for this module.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  API_V1_PORTFOLIO_LIFECYCLE_STATES,
  API_V1_PORTFOLIO_STRATEGIC_PRIORITIES,
  type ApiV1PortfolioLifecycleState,
  type ApiV1PortfolioStrategicPriority,
  parseApiV1CreatePortfolioBody,
  PORTFOLIO_CREATE_ROUTE,
} from "../../_shared/btpm-api/routes/portfolios.ts";
import { buildClosedVocabularySchema } from "./closedVocabularySchema.ts";
import type { ApiV1CreatePortfolioSuccessResult } from "../../_shared/btpm-api/supabasePortfolioMutation.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1CreatePortfolioExecutor } from "./portfolioCreateMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `portfolios.create`. */
export const MCP_PORTFOLIO_CREATE_TOOL_NAME = "btpm_create_portfolio";

/**
 * Closed transport vocabularies, derived from the canonical Portfolio API
 * authorities. These add discoverability only: no value literal, no default and
 * no business rule is redeclared here.
 */
export const MCP_PORTFOLIO_CREATE_LIFECYCLE_STATE_SCHEMA =
  buildClosedVocabularySchema<ApiV1PortfolioLifecycleState>(
    API_V1_PORTFOLIO_LIFECYCLE_STATES,
  );
export const MCP_PORTFOLIO_CREATE_STRATEGIC_PRIORITY_SCHEMA =
  buildClosedVocabularySchema<ApiV1PortfolioStrategicPriority>(
    API_V1_PORTFOLIO_STRATEGIC_PRIORITIES,
  );

/**
 * Strict MCP transport guard. It is presentation only: canonical validation
 * remains authoritative for every business rule (UUID form, name
 * canonicalization and length, code/description limits, lifecycle and
 * strategic-priority vocabularies, and optional-field defaults).
 *
 * `lifecycleState` and `strategicPriority` are optional but NOT nullable, and
 * now advertise the canonical closed vocabularies so an MCP client can discover
 * the legal values. Omission remains valid and continues to let the canonical
 * API parser apply its own existing default.
 */
export const MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA = z.strictObject({
  organizationId: z.string(),
  name: z.string(),
  code: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  lifecycleState: MCP_PORTFOLIO_CREATE_LIFECYCLE_STATE_SCHEMA.optional(),
  strategicPriority: MCP_PORTFOLIO_CREATE_STRATEGIC_PRIORITY_SCHEMA.optional(),
  ownerId: z.string().nullable().optional(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact nine approved MCP argument names. */
export const MCP_PORTFOLIO_CREATE_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "organizationId",
    "name",
    "code",
    "description",
    "lifecycleState",
    "strategicPriority",
    "ownerId",
    "confirmation",
    "idempotencyKey",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpPortfolioCreateToolArguments {
  readonly organizationId: string;
  readonly name: string;
  readonly code?: string | null;
  readonly description?: string | null;
  readonly lifecycleState?: ApiV1PortfolioLifecycleState;
  readonly strategicPriority?: ApiV1PortfolioStrategicPriority;
  readonly ownerId?: string | null;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpPortfolioCreateToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_PORTFOLIO_CREATE_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpPortfolioCreateToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to create this Portfolio.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  unavailable: "BTPM Portfolio creation is temporarily unavailable.",
});

/** Bounded successful tool payload. No Portfolio business data is returned. */
export interface McpPortfolioCreateToolPayload {
  readonly outcome: "applied" | "replayed";
  readonly portfolioId: string;
}

/** Bounded tool result union. */
export type McpPortfolioCreateToolResult =
  | { readonly ok: true; readonly payload: McpPortfolioCreateToolPayload }
  | {
    readonly ok: false;
    readonly category: McpPortfolioCreateToolErrorCategory;
  };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpPortfolioCreateToolExecutor = (
  args: McpPortfolioCreateToolArguments,
) => Promise<McpPortfolioCreateToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpPortfolioCreateToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1CreatePortfolioExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpPortfolioCreateToolErrorCategory {
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
): McpPortfolioCreateToolErrorCategory {
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
  result: ApiV1CreatePortfolioSuccessResult,
): McpPortfolioCreateToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    portfolioId: result.portfolioId,
  });
}

/**
 * Creates the per-request `portfolios.create` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. literal confirmation is required;
 *   3. a business-only object is built (no confirmation, no idempotency key,
 *      no identity, scope or provenance field);
 *   4. it is validated through `parseApiV1CreatePortfolioBody`, which alone
 *      owns canonical validation and defaults;
 *   5. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash over the canonical
 *      body only);
 *   6. the canonical rate-limit profile is resolved for `portfolios.create`;
 *   7. the canonical atomic rate limit is consumed;
 *   8. the accepted Portfolio-9B caller-bound writer is invoked exactly once,
 *      with no retry.
 */
export function createMcpPortfolioCreateToolExecutor(
  dependencies: McpPortfolioCreateToolDependencies,
): McpPortfolioCreateToolExecutor {
  return async function executePortfolioCreate(
    args: McpPortfolioCreateToolArguments,
  ): Promise<McpPortfolioCreateToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_PORTFOLIO_CREATE_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before any rate-limit consumption or writer.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Business-only object.
      const businessInput: Record<string, unknown> = {
        organizationId: parsedArgs.organizationId,
        name: parsedArgs.name,
      };
      if (parsedArgs.code !== undefined) {
        businessInput.code = parsedArgs.code;
      }
      if (parsedArgs.description !== undefined) {
        businessInput.description = parsedArgs.description;
      }
      if (parsedArgs.lifecycleState !== undefined) {
        businessInput.lifecycleState = parsedArgs.lifecycleState;
      }
      if (parsedArgs.strategicPriority !== undefined) {
        businessInput.strategicPriority = parsedArgs.strategicPriority;
      }
      if (parsedArgs.ownerId !== undefined) {
        businessInput.ownerId = parsedArgs.ownerId;
      }

      // 4. Canonical business validation and defaulting.
      const canonicalBody = parseApiV1CreatePortfolioBody(businessInput);

      // 5. Canonical mutation execution context (idempotency + payload hash).
      const mutationContext = await buildMcpMutationExecutionContext(
        dependencies.execution,
        parsedArgs.idempotencyKey,
        canonicalBody,
      );

      // 6. Canonical rate-limit profile.
      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        PORTFOLIO_CREATE_ROUTE.id,
      );

      // 7. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PORTFOLIO_CREATE_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 8. Accepted Portfolio-9B caller-bound writer, exactly once.
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
