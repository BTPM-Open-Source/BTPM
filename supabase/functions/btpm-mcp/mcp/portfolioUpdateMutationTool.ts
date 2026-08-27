// API-Q Portfolio-10C — Portfolio-update MCP mutation tool control layer.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `portfolios.update`. It composes only already
// accepted components:
//
//   - literal confirmation control          : `requireMcpMutationConfirmation`
//   - canonical Portfolio identity parsing  : `parseApiV1PortfolioUpdatePath`
//   - canonical business validation         : `parseApiV1UpdatePortfolioBody`
//   - canonical idempotency + payload hash  : `buildMcpMutationExecutionContext`
//     over `buildApiV1UpdatePortfolioIdempotencyPayload(portfolioId, body)`
//   - canonical rate limiting               : `enforceApiRateLimit`
//   - caller-bound writer (Portfolio-10B)   : `McpV1UpdatePortfolioExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, no Connected-App enablement lookup, no
// Tenant/Organization/Workspace derivation, no Portfolio lookup, no owner
// lookup, no encryption, persists nothing, logs nothing, starts no timer,
// performs no retry, performs no read-before-write and registers no MCP tool.
// No generic mutation dispatcher exists here.
//
// Optimistic concurrency: the caller's `expectedUpdatedAt` is a precondition. It
// is never refreshed, reformatted, replaced or retried here, and no current
// stored timestamp is ever disclosed.
//
// Presence semantics: the canonical Portfolio update parser is the sole
// authority for the six `set*` flags. This layer therefore forwards only the
// properties the MCP caller actually supplied, and never manufactures a `set*`
// flag itself.
//
// Authorization, `portfolios:update` capability enforcement, Organization Admin
// rules, Tenant/Organization/owner containment, PMG provenance, encryption and
// persistence all remain downstream in the accepted Portfolio-10A protected
// execution path.

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
  buildApiV1UpdatePortfolioIdempotencyPayload,
  parseApiV1PortfolioUpdatePath,
  parseApiV1UpdatePortfolioBody,
  PORTFOLIO_UPDATE_ROUTE,
} from "../../_shared/btpm-api/routes/portfolios.ts";
import { buildClosedVocabularySchema } from "./closedVocabularySchema.ts";
import type { ApiV1UpdatePortfolioSuccessResult } from "../../_shared/btpm-api/supabasePortfolioMutation.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1UpdatePortfolioExecutor } from "./portfolioUpdateMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `portfolios.update`. */
export const MCP_PORTFOLIO_UPDATE_TOOL_NAME = "btpm_update_portfolio";

/** Canonical Portfolio identity path prefix; the accepted parser owns validation. */
const PORTFOLIO_PATH_PREFIX = "/v1/portfolios/";

/**
 * Closed transport vocabularies, derived from the canonical Portfolio API
 * authorities. These add discoverability only: no value literal, no default and
 * no business rule is redeclared here.
 */
export const MCP_PORTFOLIO_UPDATE_LIFECYCLE_STATE_SCHEMA =
  buildClosedVocabularySchema<ApiV1PortfolioLifecycleState>(
    API_V1_PORTFOLIO_LIFECYCLE_STATES,
  );
export const MCP_PORTFOLIO_UPDATE_STRATEGIC_PRIORITY_SCHEMA =
  buildClosedVocabularySchema<ApiV1PortfolioStrategicPriority>(
    API_V1_PORTFOLIO_STRATEGIC_PRIORITIES,
  );

/**
 * Strict MCP transport guard. It is presentation only: canonical validation
 * remains authoritative for UUID form, `expectedUpdatedAt` timestamp form, name
 * canonicalization/length, code/description limits, lifecycle vocabulary,
 * strategic-priority vocabulary, owner UUID form and all `set*` derivation.
 *
 * `name`, `lifecycleState` and `strategicPriority` are optional but NOT nullable
 * (none is clearable); `lifecycleState` and `strategicPriority` additionally
 * advertise the canonical closed vocabularies. `code`, `description` and
 * `ownerId` are optional AND nullable, where an explicit `null` means "clear".
 * No `set*` argument and no
 * Tenant/Organization/Workspace/client/provenance/archive/assignment field
 * exists here.
 */
export const MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA = z.strictObject({
  portfolioId: z.string(),
  expectedUpdatedAt: z.string(),
  name: z.string().optional(),
  code: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  lifecycleState: MCP_PORTFOLIO_UPDATE_LIFECYCLE_STATE_SCHEMA.optional(),
  strategicPriority: MCP_PORTFOLIO_UPDATE_STRATEGIC_PRIORITY_SCHEMA.optional(),
  ownerId: z.string().nullable().optional(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact ten approved MCP argument names, in canonical order. */
export const MCP_PORTFOLIO_UPDATE_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "portfolioId",
    "expectedUpdatedAt",
    "name",
    "code",
    "description",
    "lifecycleState",
    "strategicPriority",
    "ownerId",
    "confirmation",
    "idempotencyKey",
  ]);

/**
 * The exact optional mutable business argument names, in canonical order. Only
 * these may be forwarded into the raw business object, and only when present.
 * The six derived `set*` flags are deliberately absent.
 */
export const MCP_PORTFOLIO_UPDATE_OPTIONAL_BUSINESS_FIELDS: ReadonlyArray<
  string
> = Object.freeze([
  "name",
  "code",
  "description",
  "lifecycleState",
  "strategicPriority",
  "ownerId",
]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpPortfolioUpdateToolArguments {
  readonly portfolioId: string;
  readonly expectedUpdatedAt: string;
  readonly name?: string;
  readonly code?: string | null;
  readonly description?: string | null;
  readonly lifecycleState?: ApiV1PortfolioLifecycleState;
  readonly strategicPriority?: ApiV1PortfolioStrategicPriority;
  readonly ownerId?: string | null;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpPortfolioUpdateToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "stale_portfolio"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_PORTFOLIO_UPDATE_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpPortfolioUpdateToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to update this Portfolio.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  stale_portfolio:
    "This Portfolio has changed since the supplied expectedUpdatedAt. Read the current Portfolio and retry intentionally with a fresh updatedAt and a new idempotency key.",
  unavailable: "BTPM Portfolio update is temporarily unavailable.",
});

/** Bounded successful tool payload. No Portfolio narrative is returned. */
export interface McpPortfolioUpdateToolPayload {
  readonly outcome: "applied" | "replayed";
  readonly portfolioId: string;
  readonly updatedAt: string;
}

/** Bounded tool result union. */
export type McpPortfolioUpdateToolResult =
  | { readonly ok: true; readonly payload: McpPortfolioUpdateToolPayload }
  | {
    readonly ok: false;
    readonly category: McpPortfolioUpdateToolErrorCategory;
  };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpPortfolioUpdateToolExecutor = (
  args: McpPortfolioUpdateToolArguments,
) => Promise<McpPortfolioUpdateToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpPortfolioUpdateToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1UpdatePortfolioExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpPortfolioUpdateToolErrorCategory {
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
  outcome: string,
): McpPortfolioUpdateToolErrorCategory {
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
      // Unknown negative outcome: fail closed and disclose nothing.
      return "unavailable";
  }
}

function toBoundedPayload(
  result: ApiV1UpdatePortfolioSuccessResult,
): McpPortfolioUpdateToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    portfolioId: result.portfolioId,
    updatedAt: result.updatedAt,
  });
}

/**
 * Builds the RAW business object for the canonical Portfolio update parser.
 *
 * Presence is decided by own-property presence on the parsed arguments, never by
 * value inspection (`!== null`, truthiness or undefined-coalescing). An omitted
 * clearable field stays absent, so the canonical parser derives its `set*` flag
 * as `false`; an explicit `null` stays present, so the canonical parser derives
 * the flag as `true` with an explicit clear. No `set*` key is written here.
 */
function buildRawBusinessInput(
  parsedArgs: Record<string, unknown>,
): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    expectedUpdatedAt: parsedArgs.expectedUpdatedAt,
  };
  for (const field of MCP_PORTFOLIO_UPDATE_OPTIONAL_BUSINESS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(parsedArgs, field)) continue;
    // A transport-level explicit `undefined` is treated as absence: the
    // canonical contract has no `undefined` value, only absent vs null.
    if (parsedArgs[field] === undefined) continue;
    raw[field] = parsedArgs[field];
  }
  return raw;
}

/**
 * Creates the per-request `portfolios.update` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. literal confirmation is required (before idempotency/hash, rate-limit
 *      profile resolution, rate-limit consumption and writer);
 *   3. the Portfolio identity is validated through the canonical path parser;
 *   4. the raw business object is built, preserving optional-field presence;
 *   5. it is validated exactly once through `parseApiV1UpdatePortfolioBody`;
 *   6. the canonical Portfolio-update idempotency payload (portfolioId,
 *      expectedUpdatedAt, all six values and all six `set*` flags) is built;
 *   7. the canonical mutation execution context is built (canonical idempotency
 *      validation + canonical payload hash);
 *   8. the canonical rate-limit profile is resolved for `portfolios.update`;
 *   9. the canonical atomic rate limit is consumed;
 *  10. the accepted caller-bound Portfolio-10B writer is invoked exactly once.
 */
export function createMcpPortfolioUpdateToolExecutor(
  dependencies: McpPortfolioUpdateToolDependencies,
): McpPortfolioUpdateToolExecutor {
  return async function executePortfolioUpdate(
    args: McpPortfolioUpdateToolArguments,
  ): Promise<McpPortfolioUpdateToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_PORTFOLIO_UPDATE_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before idempotency, rate limiting and writer.
      // `confirmation` is control-only: it never enters the business body, the
      // idempotency payload, the payload hash or the writer body.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical Portfolio identity.
      const { portfolioId: canonicalPortfolioId } =
        parseApiV1PortfolioUpdatePath(
          `${PORTFOLIO_PATH_PREFIX}${parsedArgs.portfolioId}`,
        );

      // 4. Raw business object preserving optional-field presence.
      const rawBusinessInput = buildRawBusinessInput(
        parsedArgs as unknown as Record<string, unknown>,
      );

      // 5. Canonical business validation (sole `set*` authority).
      const canonicalBody = parseApiV1UpdatePortfolioBody(rawBusinessInput);

      // 6. Canonical Portfolio-update idempotency payload (identity, the
      // concurrency precondition, every value and every presence flag), so
      // absent and explicit-clear never collide.
      const canonicalIdempotencyPayload =
        buildApiV1UpdatePortfolioIdempotencyPayload(
          canonicalPortfolioId,
          canonicalBody,
        );

      // 7. Canonical mutation execution context (idempotency + payload hash).
      const mutationContext = await buildMcpMutationExecutionContext(
        dependencies.execution,
        parsedArgs.idempotencyKey,
        canonicalIdempotencyPayload,
      );

      // 8. Canonical database-controlled rate-limit profile.
      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        PORTFOLIO_UPDATE_ROUTE.id,
      );

      // 9. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PORTFOLIO_UPDATE_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 10. Accepted caller-bound Portfolio-10B writer, invoked exactly once.
      // The caller's concurrency precondition is forwarded unchanged.
      const result = await dependencies.writer(
        dependencies.request,
        canonicalPortfolioId,
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
        return Object.freeze({
          ok: false as const,
          category: "stale_portfolio",
        });
      }

      return Object.freeze({
        ok: false as const,
        category: mapNegativeOutcome(result.outcome),
      });
    } catch (error) {
      // Only a bounded category escapes: no SQLSTATE, database message, stack,
      // policy reason, token, identity, current timestamp or internal function
      // name.
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
