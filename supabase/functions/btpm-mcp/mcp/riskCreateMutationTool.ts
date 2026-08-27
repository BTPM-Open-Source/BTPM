// API-Q.10A4 — Risk create MCP mutation tool control composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `risks.create`. It composes only already accepted
// components:
//
//   - literal confirmation control        : `requireMcpMutationConfirmation`
//   - canonical business validation       : `parseApiV1CreateRiskBody`
//   - canonical idempotency + payload hash: `buildMcpMutationExecutionContext`
//   - canonical rate limiting             : `enforceApiRateLimit`
//   - caller-bound writer                 : `McpV1CreateRiskExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, persists nothing, logs nothing and registers no
// MCP tool. No generic operation dispatcher exists here. Risk update is out of
// scope for this module.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  type ApiV1RiskImpact,
  type ApiV1RiskLikelihood,
  type ApiV1RiskStatus,
  type ApiV1RiskTargetType,
  parseApiV1CreateRiskBody,
  RISK_CREATE_ROUTE,
} from "../../_shared/btpm-api/routes/risks.ts";
import type { ApiV1CreateRiskSuccessResult } from "../../_shared/btpm-api/supabaseRisk.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1CreateRiskExecutor } from "./riskCreateMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `risks.create`. */
export const MCP_RISK_CREATE_TOOL_NAME = "btpm_create_risk";

/**
 * Strict MCP transport guard. It is presentation only: canonical validation
 * remains authoritative for business fields (UUID form, blank/length handling
 * and optional-field defaulting), confirmation and idempotency.
 */
export const MCP_RISK_CREATE_TOOL_INPUT_SCHEMA = z.strictObject({
  targetType: z.enum(["project", "phase", "task"]),
  targetId: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  mitigationPlan: z.string().nullable().optional(),
  likelihood: z.enum(["low", "medium", "high"]).optional(),
  impact: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z
    .enum(["open", "under_mitigation", "monitoring", "realized", "closed"])
    .optional(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact ten approved MCP argument names. */
export const MCP_RISK_CREATE_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> = Object
  .freeze([
    "targetType",
    "targetId",
    "title",
    "description",
    "mitigationPlan",
    "likelihood",
    "impact",
    "status",
    "confirmation",
    "idempotencyKey",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpRiskCreateToolArguments {
  readonly targetType: ApiV1RiskTargetType;
  readonly targetId: string;
  readonly title: string;
  readonly description?: string | null;
  readonly mitigationPlan?: string | null;
  readonly likelihood?: ApiV1RiskLikelihood;
  readonly impact?: ApiV1RiskImpact;
  readonly status?: ApiV1RiskStatus;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpRiskCreateToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_RISK_CREATE_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpRiskCreateToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to create this Risk.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  unavailable: "BTPM Risk creation is temporarily unavailable.",
});

/** Bounded successful tool payload. No Risk narrative is returned. */
export interface McpRiskCreateToolPayload {
  readonly outcome: "applied" | "replayed";
  readonly riskId: string;
  readonly targetType: ApiV1RiskTargetType;
  readonly targetId: string;
  readonly likelihood: ApiV1RiskLikelihood;
  readonly impact: ApiV1RiskImpact;
  readonly status: ApiV1RiskStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Bounded tool result union. */
export type McpRiskCreateToolResult =
  | { readonly ok: true; readonly payload: McpRiskCreateToolPayload }
  | { readonly ok: false; readonly category: McpRiskCreateToolErrorCategory };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpRiskCreateToolExecutor = (
  args: McpRiskCreateToolArguments,
) => Promise<McpRiskCreateToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpRiskCreateToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1CreateRiskExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpRiskCreateToolErrorCategory {
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
): McpRiskCreateToolErrorCategory {
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
  result: ApiV1CreateRiskSuccessResult,
): McpRiskCreateToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    riskId: result.riskId,
    targetType: result.targetType,
    targetId: result.targetId,
    likelihood: result.likelihood,
    impact: result.impact,
    status: result.status,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
  });
}

/**
 * Creates the per-request `risks.create` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. literal confirmation is required;
 *   3. a business-only object is built (no confirmation, no idempotency key,
 *      no identity, scope or provenance field);
 *   4. it is validated through `parseApiV1CreateRiskBody`, which alone owns
 *      canonical defaults (description=null, mitigationPlan=null,
 *      likelihood=medium, impact=medium, status=open);
 *   5. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash over the canonical
 *      body only);
 *   6. the canonical rate-limit profile is resolved;
 *   7. the canonical atomic rate limit is consumed;
 *   8. the accepted caller-bound writer is invoked.
 */
export function createMcpRiskCreateToolExecutor(
  dependencies: McpRiskCreateToolDependencies,
): McpRiskCreateToolExecutor {
  return async function executeRiskCreate(
    args: McpRiskCreateToolArguments,
  ): Promise<McpRiskCreateToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_RISK_CREATE_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before any rate-limit consumption or writer.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Business-only object.
      const businessInput: Record<string, unknown> = {
        targetType: parsedArgs.targetType,
        targetId: parsedArgs.targetId,
        title: parsedArgs.title,
      };
      if (parsedArgs.description !== undefined) {
        businessInput.description = parsedArgs.description;
      }
      if (parsedArgs.mitigationPlan !== undefined) {
        businessInput.mitigationPlan = parsedArgs.mitigationPlan;
      }
      if (parsedArgs.likelihood !== undefined) {
        businessInput.likelihood = parsedArgs.likelihood;
      }
      if (parsedArgs.impact !== undefined) {
        businessInput.impact = parsedArgs.impact;
      }
      if (parsedArgs.status !== undefined) {
        businessInput.status = parsedArgs.status;
      }

      // 4. Canonical business validation and defaulting.
      const canonicalBody = parseApiV1CreateRiskBody(businessInput);

      // 5. Canonical mutation execution context (idempotency + payload hash).
      const mutationContext = await buildMcpMutationExecutionContext(
        dependencies.execution,
        parsedArgs.idempotencyKey,
        canonicalBody,
      );

      // 6. Canonical rate-limit profile.
      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        RISK_CREATE_ROUTE.id,
      );

      // 7. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: RISK_CREATE_ROUTE.id,
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
