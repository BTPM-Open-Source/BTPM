// API-Q Program Update Step 3 — Program-update MCP mutation-control composition.
//
// This module is the per-request MCP tool CONTROL/COMPOSITION layer for exactly
// one canonical operation: `programs.update`. It composes only already accepted
// components:
//
//   - literal confirmation control         : `requireMcpMutationConfirmation`
//   - canonical Program identity parsing   : `parseApiV1ProgramUpdatePath`
//   - canonical business validation        : `parseApiV1UpdateProgramBody`
//   - canonical idempotency + payload hash : `buildMcpMutationExecutionContext`
//     over `buildApiV1UpdateProgramIdempotencyPayload(programId, body)`
//   - canonical rate limiting              : `enforceApiRateLimit`
//   - caller-bound Step-2 writer           : `McpV1UpdateProgramExecutor`
//
// It creates no Supabase client, reads no environment variable, calls no RPC,
// calls no PMG function, touches no table, uses no service-role credential,
// performs no authorization, no Tenant/Organization/Workspace scope derivation,
// no Program lookup, no Program Connected-App enablement check, no encryption,
// persists nothing, logs nothing, starts no timer, performs no retry, performs
// no read-before-write and registers no MCP tool. No generic operation
// dispatcher exists here.
//
// There is no Program-level Connected-App enablement model. Organization /
// Workspace Connected-App authorization and `programs:update` capability
// enforcement remain owned by API-E and the accepted Step-1 database bridge.
//
// Optimistic concurrency: the caller's `expectedUpdatedAt` is a precondition.
// It is never refreshed, reformatted, replaced or retried here.
//
// Presence semantics: the canonical Program update parser derives
// `setDescription` from raw own-property PRESENCE. This layer therefore
// forwards only the properties the MCP caller actually supplied, and never
// manufactures `setDescription` itself.

import { z } from "npm:zod@4.4.3";
import { MCP_IDEMPOTENCY_KEY_SCHEMA } from "./idempotencyKeySchema.ts";

import { ApiHttpError } from "../../_shared/btpm-api/http.ts";
import {
  type ApiRateLimitStore,
  enforceApiRateLimit,
} from "../../_shared/btpm-api/rateLimit.ts";
import type { ApiRateLimitProfileResolver } from "../../_shared/btpm-api/supabaseRateLimit.ts";
import {
  type ApiV1ProgramStatus,
  buildApiV1UpdateProgramIdempotencyPayload,
  PROGRAM_UPDATE_ROUTE,
  parseApiV1ProgramUpdatePath,
  parseApiV1UpdateProgramBody,
} from "../../_shared/btpm-api/routes/programs.ts";
import type { ApiV1UpdateProgramSuccessResult } from "../../_shared/btpm-api/supabaseProgramMutation.ts";
import type { McpTrustedExecutionContext } from "./buildMcpExecutionContext.ts";
import {
  buildMcpMutationExecutionContext,
  IdempotencyValidationError,
  McpMutationControlError,
  requireMcpMutationConfirmation,
} from "./mutationControl.ts";
import type { McpV1UpdateProgramExecutor } from "./programUpdateMutationExecutor.ts";

/** Advertised MCP tool name for the canonical `programs.update`. */
export const MCP_PROGRAM_UPDATE_TOOL_NAME = "btpm_update_program";

/** Canonical Program identity path prefix; the accepted parser owns validation. */
const PROGRAM_PATH_PREFIX = "/v1/programs/";

/**
 * Strict MCP transport guard. It is presentation only: canonical validation
 * remains authoritative for timestamp form, name canonicalization/length,
 * status vocabulary, description normalization and `setDescription` derivation.
 *
 * `name` and `status` are optional but NOT nullable (neither is clearable).
 * `description` is optional AND nullable, where an explicit `null` means
 * "clear". No `setDescription` argument is exposed to MCP, and no
 * Workspace/Organization/Tenant/client/provenance, archive, Project or
 * transition field exists here.
 */
export const MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA = z.strictObject({
  programId: z.string(),
  expectedUpdatedAt: z.string(),
  name: z.string().optional(),
  status: z
    .enum(["planned", "active", "completed", "on_hold", "cancelled"])
    .optional(),
  description: z.string().nullable().optional(),
  confirmation: z.boolean(),
  idempotencyKey: MCP_IDEMPOTENCY_KEY_SCHEMA,
});

/** The exact seven approved MCP argument names, in canonical order. */
export const MCP_PROGRAM_UPDATE_TOOL_ARGUMENT_NAMES: ReadonlyArray<string> =
  Object.freeze([
    "programId",
    "expectedUpdatedAt",
    "name",
    "status",
    "description",
    "confirmation",
    "idempotencyKey",
  ]);

/**
 * The exact optional mutable business argument names, in canonical order. Only
 * these may be forwarded into the raw business object, and only when present.
 * The derived `setDescription` is deliberately absent.
 */
export const MCP_PROGRAM_UPDATE_OPTIONAL_BUSINESS_FIELDS: ReadonlyArray<
  string
> = Object.freeze([
  "name",
  "status",
  "description",
]);

/** Already schema-validated (untrusted) MCP tool arguments. */
export interface McpProgramUpdateToolArguments {
  readonly programId: string;
  readonly expectedUpdatedAt: string;
  readonly name?: string;
  readonly status?: ApiV1ProgramStatus;
  readonly description?: string | null;
  readonly confirmation: boolean;
  readonly idempotencyKey: string;
}

/** Bounded failure categories this tool may disclose. */
export type McpProgramUpdateToolErrorCategory =
  | "confirmation_required"
  | "invalid_arguments"
  | "not_authorized"
  | "rate_limited"
  | "idempotency_conflict"
  | "idempotency_pending"
  | "stale_program"
  | "unavailable";

/** The only external messages a failure may disclose. */
export const MCP_PROGRAM_UPDATE_TOOL_ERROR_MESSAGES: Readonly<
  Record<McpProgramUpdateToolErrorCategory, string>
> = Object.freeze({
  confirmation_required: "Explicit confirmation is required for this mutation.",
  invalid_arguments: "Invalid arguments.",
  not_authorized: "Not authorized to update this Program.",
  rate_limited: "Rate limit exceeded. Try again later.",
  idempotency_conflict:
    "This idempotency key was already used with a different request.",
  idempotency_pending:
    "An identical request is still in progress. Retry shortly.",
  stale_program:
    "This Program has changed since the supplied expectedUpdatedAt. Read the current Program and retry intentionally with a fresh updatedAt and a new idempotency key.",
  unavailable: "BTPM Program update is temporarily unavailable.",
});

/** Bounded successful tool payload. No Program narrative is returned. */
export interface McpProgramUpdateToolPayload {
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly programId: string;
  readonly updatedAt: string;
}

/** Bounded tool result union. */
export type McpProgramUpdateToolResult =
  | { readonly ok: true; readonly payload: McpProgramUpdateToolPayload }
  | { readonly ok: false; readonly category: McpProgramUpdateToolErrorCategory };

/** The bounded executor the MCP server factory would be allowed to know. */
export type McpProgramUpdateToolExecutor = (
  args: McpProgramUpdateToolArguments,
) => Promise<McpProgramUpdateToolResult>;

/** Per-request dependencies. No Supabase client, no service role, no env. */
export interface McpProgramUpdateToolDependencies {
  /** The original authenticated MCP request; the writer owns it. */
  readonly request: Request;
  readonly execution: McpTrustedExecutionContext;
  readonly writer: McpV1UpdateProgramExecutor;
  readonly rateLimitProfileResolver: ApiRateLimitProfileResolver;
  readonly rateLimitStore: ApiRateLimitStore;
  now(): number;
}

function categorize(error: unknown): McpProgramUpdateToolErrorCategory {
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
): McpProgramUpdateToolErrorCategory {
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
  result: ApiV1UpdateProgramSuccessResult,
): McpProgramUpdateToolPayload {
  return Object.freeze({
    outcome: result.outcome,
    programId: result.programId,
    updatedAt: result.updatedAt,
  });
}

/**
 * Builds the RAW business object for the canonical Program update parser.
 *
 * Presence is decided by own-property presence on the parsed arguments, never
 * by value inspection (`!== null`, truthiness or undefined-coalescing). An
 * omitted `description` stays absent, so the canonical parser derives
 * `setDescription = false`; an explicit `null` stays present, so the canonical
 * parser derives `setDescription = true` with an explicit clear. No
 * `setDescription` key is written here.
 */
function buildRawBusinessInput(
  parsedArgs: Record<string, unknown>,
): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    expectedUpdatedAt: parsedArgs.expectedUpdatedAt,
  };
  for (const field of MCP_PROGRAM_UPDATE_OPTIONAL_BUSINESS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(parsedArgs, field)) continue;
    // A transport-level explicit `undefined` is treated as absence: the
    // canonical contract has no `undefined` value, only absent vs null.
    if (parsedArgs[field] === undefined) continue;
    raw[field] = parsedArgs[field];
  }
  return raw;
}

/**
 * Creates the per-request `programs.update` MCP tool executor.
 *
 * Execution order:
 *   1. the strict MCP argument envelope is validated;
 *   2. literal confirmation is required (before idempotency/hash, rate limiting
 *      and writer);
 *   3. the Program identity is validated through the canonical path parser;
 *   4. the raw business object is built, preserving optional-field presence;
 *   5. it is validated exactly once through `parseApiV1UpdateProgramBody`;
 *   6. the canonical Program-update idempotency payload (programId + every
 *      value and `setDescription`) is built;
 *   7. the canonical mutation execution context is built (canonical
 *      idempotency validation + canonical payload hash);
 *   8. the canonical rate-limit profile is resolved;
 *   9. the canonical atomic rate limit is consumed;
 *  10. the accepted caller-bound Step-2 writer is invoked exactly once.
 */
export function createMcpProgramUpdateToolExecutor(
  dependencies: McpProgramUpdateToolDependencies,
): McpProgramUpdateToolExecutor {
  return async function executeProgramUpdate(
    args: McpProgramUpdateToolArguments,
  ): Promise<McpProgramUpdateToolResult> {
    try {
      // 1. Strict MCP argument envelope.
      const parsedArgs = MCP_PROGRAM_UPDATE_TOOL_INPUT_SCHEMA.parse(args);

      // 2. Literal confirmation, before idempotency, rate limiting and writer.
      // `confirmation` is control-only: it never enters the business body, the
      // idempotency payload or the writer body.
      requireMcpMutationConfirmation(parsedArgs.confirmation);

      // 3. Canonical Program identity.
      const { programId: canonicalProgramId } = parseApiV1ProgramUpdatePath(
        `${PROGRAM_PATH_PREFIX}${parsedArgs.programId}`,
      );

      // 4. Raw business object preserving optional-field presence.
      const rawBusinessInput = buildRawBusinessInput(
        parsedArgs as unknown as Record<string, unknown>,
      );

      // 5. Canonical business validation (sole `setDescription` authority).
      const canonicalBody = parseApiV1UpdateProgramBody(rawBusinessInput);

      // 6. Canonical Program-update idempotency payload (identity + every value
      // and the presence flag), so absent and explicit-clear never collide.
      const canonicalIdempotencyPayload =
        buildApiV1UpdateProgramIdempotencyPayload(
          canonicalProgramId,
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
        PROGRAM_UPDATE_ROUTE.id,
      );

      // 9. Canonical atomic rate-limit consumption.
      await enforceApiRateLimit(
        {
          apiClientId: dependencies.execution.apiClientId,
          userId: dependencies.execution.executingUserId,
          routeId: PROGRAM_UPDATE_ROUTE.id,
        },
        profile,
        { store: dependencies.rateLimitStore, now: () => dependencies.now() },
      );

      // 10. Accepted caller-bound Step-2 writer, invoked exactly once. The
      // caller's concurrency precondition is forwarded unchanged.
      const result = await dependencies.writer(
        dependencies.request,
        canonicalProgramId,
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
        return Object.freeze({ ok: false as const, category: "stale_program" });
      }

      return Object.freeze({
        ok: false as const,
        category: mapNegativeOutcome(result.outcome),
      });
    } catch (error) {
      // Only a bounded category escapes: no SQLSTATE, database message, stack,
      // policy reason, token, identity, description or internal function name.
      return Object.freeze({ ok: false as const, category: categorize(error) });
    }
  };
}
