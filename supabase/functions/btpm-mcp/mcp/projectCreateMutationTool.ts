// API-Q Project Create Step 3 — Project-create MCP mutation tool control layer.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `projects.create`. It composes only already accepted
// components:
//
//   - literal confirmation control        : `requireMcpMutationConfirmation`
//   - canonical business validation       : `parseApiV1CreateProjectBody`
//   - canonical idempotency + payload hash: `buildMcpMutationExecutionContext`
//   - canonical rate limiting             : `enforceApiRateLimit`
//   - caller-bound writer                 : `McpV1CreateProjectExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, no Tenant/Organization/Workspace derivation, no
// encryption, persists nothing, logs nothing and registers no MCP tool. No
// generic operation dispatcher exists here.
//
// Project Create special rule: there is no existing target Project, therefore
// this layer contains NO api_project_client_enablements lookup, no Project
// Connected-App enablement requirement, no Project auto-enablement, no Project
// table lookup and no Project PM-authority check. Project Update and Project
// Transition are out of scope for this module.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  parseApiV1CreateProjectBody,
  PROJECT_CREATE_ROUTE,
} from "../../_shared/btpm-api/routes/projects.ts";
import type { ApiV1CreateProjectSuccessResult } from "../../_shared/btpm-api/supabaseProjectMutation.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1CreateProjectExecutor } from "./projectCreateMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `projects.create`. */
export const MCP_PROJECT_CREATE_TOOL_NAME = "btpm_create_project";

/**
 * Strict MCP transport guard. It is presentation only: canonical validation
 * remains authoritative for every business rule (UUID form, name
 * canonicalization and length, optional-field defaults).
 */
export const MCP_PROJECT_CREATE_TOOL_INPUT_SCHEMA = z.strictObject({
  workspaceId: z.string(),
  name: z.string(),
  programId: z.string().nullable().optional(),
  deliveryModel: z
    .enum(["internal_delivery", "vendor_delivery", "co_delivery"])
    .nullable()
    .optional(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact six approved MCP argument names. */
export const MCP_PROJECT_CREATE_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "workspaceId",
    "name",
    "programId",
    "deliveryModel",
    "confirmation",
    "idempotencyKey",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpProjectCreateToolArguments {
  readonly workspaceId: string;
  readonly name: string;
  readonly programId?: string | null;
  readonly deliveryModel?:
    | "internal_delivery"
    | "vendor_delivery"
    | "co_delivery"
    | null;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpProjectCreateToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_PROJECT_CREATE_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpProjectCreateToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to create this Project.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  unavailable: "BTPM Project creation is temporarily unavailable.",
});

/** Bounded successful tool payload. No Project name or other data is returned. */
export interface McpProjectCreateToolPayload {
  readonly outcome: "applied" | "replayed";
  readonly projectId: string;
}

/** Bounded tool result union. */
export type McpProjectCreateToolResult =
  | { readonly ok: true; readonly payload: McpProjectCreateToolPayload }
  | {
    readonly ok: false;
    readonly category: McpProjectCreateToolErrorCategory;
  };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpProjectCreateToolExecutor = (
  args: McpProjectCreateToolArguments,
) => Promise<McpProjectCreateToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpProjectCreateToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1CreateProjectExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpProjectCreateToolErrorCategory {
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
): McpProjectCreateToolErrorCategory {
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
  result: ApiV1CreateProjectSuccessResult,
): McpProjectCreateToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    projectId: result.projectId,
  });
}

/**
 * Creates the per-request `projects.create` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. literal confirmation is required;
 *   3. a business-only object is built (no confirmation, no idempotency key,
 *      no identity, scope or provenance field);
 *   4. it is validated through `parseApiV1CreateProjectBody`, which alone owns
 *      canonical validation and defaults;
 *   5. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash over the canonical
 *      body only);
 *   6. the canonical rate-limit profile is resolved for `projects.create`;
 *   7. the canonical atomic rate limit is consumed;
 *   8. the accepted caller-bound writer is invoked exactly once, with no retry.
 */
export function createMcpProjectCreateToolExecutor(
  dependencies: McpProjectCreateToolDependencies,
): McpProjectCreateToolExecutor {
  return async function executeProjectCreate(
    args: McpProjectCreateToolArguments,
  ): Promise<McpProjectCreateToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_PROJECT_CREATE_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before any rate-limit consumption or writer.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Business-only object.
      const businessInput: Record<string, unknown> = {
        workspaceId: parsedArgs.workspaceId,
        name: parsedArgs.name,
      };
      if (parsedArgs.programId !== undefined) {
        businessInput.programId = parsedArgs.programId;
      }
      if (parsedArgs.deliveryModel !== undefined) {
        businessInput.deliveryModel = parsedArgs.deliveryModel;
      }

      // 4. Canonical business validation and defaulting.
      const canonicalBody = parseApiV1CreateProjectBody(businessInput);

      // 5. Canonical mutation execution context (idempotency + payload hash).
      const mutationContext = await buildMcpMutationExecutionContext(
        dependencies.execution,
        parsedArgs.idempotencyKey,
        canonicalBody,
      );

      // 6. Canonical rate-limit profile.
      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        PROJECT_CREATE_ROUTE.id,
      );

      // 7. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PROJECT_CREATE_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 8. Accepted caller-bound writer, exactly once.
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
