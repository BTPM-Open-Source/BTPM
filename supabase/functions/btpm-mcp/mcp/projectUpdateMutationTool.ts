// API-Q Project Update Step 3 — Project-update MCP mutation-control composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `projects.update`. It composes only already accepted
// components:
//
//   - literal confirmation control        : `requireMcpMutationConfirmation`
//   - canonical Project identity parsing  : `parseApiV1ProjectUpdatePath`
//   - canonical business validation        : `parseApiV1UpdateProjectBody`
//   - canonical idempotency + payload hash : `buildMcpMutationExecutionContext`
//     over `buildApiV1UpdateProjectIdempotencyPayload(projectId, body)`
//   - canonical rate limiting              : `enforceApiRateLimit`
//   - caller-bound writer                  : `McpV1UpdateProjectExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, no Tenant/Organization/Workspace scope derivation,
// no Project lookup, no Project Connected-App enablement check, no Project
// auto-enablement, no encryption, persists nothing, logs nothing, starts no
// timer, performs no retry, performs no read-before-write and registers no MCP
// tool. No generic operation dispatcher exists here.
//
// Project Connected-App enablement remains MANDATORY, and is owned solely by
// the accepted Step-1 database bridge. Protected Project narrative encryption
// remains owned by the canonical encrypted PMG path.
//
// Optimistic concurrency: the caller's `expectedUpdatedAt` is a precondition.
// It is never refreshed, reformatted, replaced or retried here.
//
// Presence semantics: the canonical Project update parser derives every `set*`
// flag from raw own-property PRESENCE. This layer therefore forwards only the
// properties the MCP caller actually supplied, and never manufactures a `set*`
// flag itself.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  type ApiV1ProjectDeliveryModel,
  type ApiV1ProjectPriority,
  buildApiV1UpdateProjectIdempotencyPayload,
  parseApiV1ProjectUpdatePath,
  parseApiV1UpdateProjectBody,
  PROJECT_UPDATE_ROUTE,
} from "../../_shared/btpm-api/routes/projects.ts";
import type { ApiV1UpdateProjectSuccessResult } from "../../_shared/btpm-api/supabaseProjectMutation.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1UpdateProjectExecutor } from "./projectUpdateMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `projects.update`. */
export const MCP_PROJECT_UPDATE_TOOL_NAME = "btpm_update_project";

/** Canonical Project identity path prefix; the accepted parser owns validation. */
const PROJECT_PATH_PREFIX = "/v1/projects/";

/**
 * Strict MCP transport guard. It is presentation only: canonical validation
 * remains authoritative for timestamp form, name canonicalization/length,
 * priority vocabulary, narrative trimming/clear behaviour, Program UUID form,
 * delivery-model vocabulary and every `set*` derivation.
 *
 * `name` and `priority` are optional but NOT nullable (neither is clearable).
 * Narratives, `programId` and `deliveryModel` are optional AND nullable, where
 * an explicit `null` means "clear". No `set*` argument is exposed to MCP, and
 * no Workspace/Organization/Tenant/client/provenance, status, date, planning,
 * archive, Agile or transition field exists here.
 */
export const MCP_PROJECT_UPDATE_TOOL_INPUT_SCHEMA = z.strictObject({
  projectId: z.string(),
  expectedUpdatedAt: z.string(),
  name: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  description: z.string().nullable().optional(),
  charter: z.string().nullable().optional(),
  goals: z.string().nullable().optional(),
  scopeIn: z.string().nullable().optional(),
  scopeOut: z.string().nullable().optional(),
  businessCase: z.string().nullable().optional(),
  successCriteria: z.string().nullable().optional(),
  completionCriteria: z.string().nullable().optional(),
  budgetNarrative: z.string().nullable().optional(),
  assumptions: z.string().nullable().optional(),
  constraints: z.string().nullable().optional(),
  programId: z.string().nullable().optional(),
  deliveryModel: z
    .enum(["internal_delivery", "vendor_delivery", "co_delivery"])
    .nullable()
    .optional(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact nineteen approved MCP argument names, in canonical order. */
export const MCP_PROJECT_UPDATE_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "projectId",
    "expectedUpdatedAt",
    "name",
    "priority",
    "description",
    "charter",
    "goals",
    "scopeIn",
    "scopeOut",
    "businessCase",
    "successCriteria",
    "completionCriteria",
    "budgetNarrative",
    "assumptions",
    "constraints",
    "programId",
    "deliveryModel",
    "confirmation",
    "idempotencyKey",
  ]);

/**
 * The exact optional mutable business argument names, in canonical order. Only
 * these may be forwarded into the raw business object, and only when present.
 */
export const MCP_PROJECT_UPDATE_OPTIONAL_BUSINESS_FIELDS: ReadonlyArray<string> =
  Object.freeze([
    "name",
    "priority",
    "description",
    "charter",
    "goals",
    "scopeIn",
    "scopeOut",
    "businessCase",
    "successCriteria",
    "completionCriteria",
    "budgetNarrative",
    "assumptions",
    "constraints",
    "programId",
    "deliveryModel",
  ]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpProjectUpdateToolArguments {
  readonly projectId: string;
  readonly expectedUpdatedAt: string;
  readonly name?: string;
  readonly priority?: ApiV1ProjectPriority;
  readonly description?: string | null;
  readonly charter?: string | null;
  readonly goals?: string | null;
  readonly scopeIn?: string | null;
  readonly scopeOut?: string | null;
  readonly businessCase?: string | null;
  readonly successCriteria?: string | null;
  readonly completionCriteria?: string | null;
  readonly budgetNarrative?: string | null;
  readonly assumptions?: string | null;
  readonly constraints?: string | null;
  readonly programId?: string | null;
  readonly deliveryModel?: ApiV1ProjectDeliveryModel | null;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpProjectUpdateToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "stale_project"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_PROJECT_UPDATE_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpProjectUpdateToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to update this Project.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  stale_project:
    "This Project has changed since the supplied expectedUpdatedAt. Read the current Project and retry intentionally with a fresh updatedAt and a new idempotency key.",
  unavailable: "BTPM Project update is temporarily unavailable.",
});

/** Bounded successful tool payload. No Project narrative or scope is returned. */
export interface McpProjectUpdateToolPayload {
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly projectId: string;
  readonly updatedAt: string;
}

/** Bounded tool result union. */
export type McpProjectUpdateToolResult =
  | { readonly ok: true; readonly payload: McpProjectUpdateToolPayload }
  | { readonly ok: false; readonly category: McpProjectUpdateToolErrorCategory };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpProjectUpdateToolExecutor = (
  args: McpProjectUpdateToolArguments,
) => Promise<McpProjectUpdateToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpProjectUpdateToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1UpdateProjectExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpProjectUpdateToolErrorCategory {
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
): McpProjectUpdateToolErrorCategory {
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
  result: ApiV1UpdateProjectSuccessResult,
): McpProjectUpdateToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    projectId: result.projectId,
    updatedAt: result.updatedAt,
  });
}

/**
 * Builds the RAW business object for the canonical Project update parser.
 *
 * Presence is decided by own-property presence on the parsed arguments, never
 * by value inspection (`!== null`, truthiness or undefined-coalescing). An
 * omitted argument stays absent, so the canonical parser derives `set* = false`;
 * an explicit `null` stays present, so the canonical parser derives
 * `set* = true` with an explicit clear. No `set*` key is written here.
 */
function buildRawBusinessInput(
  parsedArgs: Record<string, unknown>,
): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    expectedUpdatedAt: parsedArgs.expectedUpdatedAt,
  };
  for (const field of MCP_PROJECT_UPDATE_OPTIONAL_BUSINESS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(parsedArgs, field)) continue;
    // A transport-level explicit `undefined` is treated as absence: the
    // canonical contract has no `undefined` value, only absent vs null.
    if (parsedArgs[field] === undefined) continue;
    raw[field] = parsedArgs[field];
  }
  return raw;
}

/**
 * Creates the per-request `projects.update` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. literal confirmation is required (before idempotency/hash, rate limiting
 *      and writer);
 *   3. the Project identity is validated through the canonical path parser;
 *   4. the raw business object is built, preserving optional-field presence;
 *   5. it is validated exactly once through `parseApiV1UpdateProjectBody`;
 *   6. the canonical Project-update idempotency payload (projectId + every
 *      value and `set*` flag) is built;
 *   7. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash);
 *   8. the canonical rate-limit profile is resolved;
 *   9. the canonical atomic rate limit is consumed;
 *  10. the accepted caller-bound Step-2 writer is invoked exactly once.
 */
export function createMcpProjectUpdateToolExecutor(
  dependencies: McpProjectUpdateToolDependencies,
): McpProjectUpdateToolExecutor {
  return async function executeProjectUpdate(
    args: McpProjectUpdateToolArguments,
  ): Promise<McpProjectUpdateToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_PROJECT_UPDATE_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before idempotency, rate limiting and writer.
      // `confirmation` is control-only: it never enters the business body, the
      // idempotency payload or the writer body.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical Project identity.
      const { projectId: canonicalProjectId } = parseApiV1ProjectUpdatePath(
        `${PROJECT_PATH_PREFIX}${parsedArgs.projectId}`,
      );

      // 4. Raw business object preserving optional-field presence.
      const rawBusinessInput = buildRawBusinessInput(
        parsedArgs as unknown as Record<string, unknown>,
      );

      // 5. Canonical business validation (sole `set*` authority).
      const canonicalBody = parseApiV1UpdateProjectBody(rawBusinessInput);

      // 6. Canonical Project-update idempotency payload (identity + every
      // value and presence flag), so absent and explicit-clear never collide.
      const canonicalIdempotencyPayload =
        buildApiV1UpdateProjectIdempotencyPayload(
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
        PROJECT_UPDATE_ROUTE.id,
      );

      // 9. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PROJECT_UPDATE_ROUTE.id,
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
          payload: toBoundedPayload(result),
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
