// API-Q Program Create Step 3 — Program-create MCP mutation tool control layer.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `programs.create`. It composes only already accepted
// components:
//
//   - literal confirmation control        : `requireMcpMutationConfirmation`
//   - canonical business validation       : `parseApiV1CreateProgramBody`
//   - canonical idempotency + payload hash: `buildMcpMutationExecutionContext`
//   - canonical rate limiting             : `enforceApiRateLimit`
//   - caller-bound writer                 : `McpV1CreateProgramExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, no Tenant/Organization/Workspace derivation, no
// encryption, persists nothing, logs nothing and registers no MCP tool. No
// generic operation dispatcher exists here.
//
// Program Create special rule: there is no existing target Program, therefore
// this layer contains NO Connected-App enablement lookup, no Program-level
// enablement model, no Program auto-enablement, no Program table lookup and no
// PM-authority check. Program Update is out of scope for this module.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  parseApiV1CreateProgramBody,
  PROGRAM_CREATE_ROUTE,
} from "../../_shared/btpm-api/routes/programs.ts";
import type { ApiV1CreateProgramSuccessResult } from "../../_shared/btpm-api/supabaseProgramMutation.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1CreateProgramExecutor } from "./programCreateMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `programs.create`. */
export const MCP_PROGRAM_CREATE_TOOL_NAME = "btpm_create_program";

/**
 * Strict MCP transport guard. It is presentation only: canonical validation
 * remains authoritative for every business rule (UUID form, name
 * canonicalization and length, optional-field defaults).
 */
export const MCP_PROGRAM_CREATE_TOOL_INPUT_SCHEMA = z.strictObject({
  workspaceId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact five approved MCP argument names. */
export const MCP_PROGRAM_CREATE_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "workspaceId",
    "name",
    "description",
    "confirmation",
    "idempotencyKey",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpProgramCreateToolArguments {
  readonly workspaceId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpProgramCreateToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_PROGRAM_CREATE_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpProgramCreateToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to create this Program.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  unavailable: "BTPM Program creation is temporarily unavailable.",
});

/** Bounded successful tool payload. No Program name or other data is returned. */
export interface McpProgramCreateToolPayload {
  readonly outcome: "applied" | "replayed";
  readonly programId: string;
}

/** Bounded tool result union. */
export type McpProgramCreateToolResult =
  | { readonly ok: true; readonly payload: McpProgramCreateToolPayload }
  | {
    readonly ok: false;
    readonly category: McpProgramCreateToolErrorCategory;
  };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpProgramCreateToolExecutor = (
  args: McpProgramCreateToolArguments,
) => Promise<McpProgramCreateToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpProgramCreateToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1CreateProgramExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpProgramCreateToolErrorCategory {
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
): McpProgramCreateToolErrorCategory {
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
  result: ApiV1CreateProgramSuccessResult,
): McpProgramCreateToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    programId: result.programId,
  });
}

/**
 * Creates the per-request `programs.create` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. literal confirmation is required;
 *   3. a business-only object is built (no confirmation, no idempotency key,
 *      no identity, scope or provenance field);
 *   4. it is validated through `parseApiV1CreateProgramBody`, which alone owns
 *      canonical validation and defaults;
 *   5. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash over the canonical
 *      body only);
 *   6. the canonical rate-limit profile is resolved for `programs.create`;
 *   7. the canonical atomic rate limit is consumed;
 *   8. the accepted caller-bound writer is invoked exactly once, with no retry.
 */
export function createMcpProgramCreateToolExecutor(
  dependencies: McpProgramCreateToolDependencies,
): McpProgramCreateToolExecutor {
  return async function executeProgramCreate(
    args: McpProgramCreateToolArguments,
  ): Promise<McpProgramCreateToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_PROGRAM_CREATE_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before any rate-limit consumption or writer.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Business-only object.
      const businessInput: Record<string, unknown> = {
        workspaceId: parsedArgs.workspaceId,
        name: parsedArgs.name,
      };
      if (parsedArgs.description !== undefined) {
        businessInput.description = parsedArgs.description;
      }

      // 4. Canonical business validation and defaulting.
      const canonicalBody = parseApiV1CreateProgramBody(businessInput);

      // 5. Canonical mutation execution context (idempotency + payload hash).
      const mutationContext = await buildMcpMutationExecutionContext(
        dependencies.execution,
        parsedArgs.idempotencyKey,
        canonicalBody,
      );

      // 6. Canonical rate-limit profile.
      const profile = await dependencies.rateLimitProfileResolver.resolve(
        dependencies.execution.apiClientId,
        PROGRAM_CREATE_ROUTE.id,
      );

      // 7. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PROGRAM_CREATE_ROUTE.id,
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
