// API-Q.8 — MCP mutation-control foundation (pure, no I/O).
//
// This module establishes the reusable, fail-closed MCP-only control substrate
// that later explicit mutation tools MUST use:
//
//   - `confirmation`   — literal boolean `true` only;
//   - `idempotencyKey` — validated through the CANONICAL API-F validator;
//   - `payloadHash`    — the canonical hash of the VALIDATED business payload.
//
// It deliberately contains NO mutation executor, NO PMG call, NO Supabase
// client, NO RPC, NO network access, NO environment access, NO persistence and
// NO generic operation dispatcher. No business mutation is exposed or executed
// anywhere in this step.
//
// Source-channel boundary: this module never changes the database mutation
// source-channel path. It only carries the already-trusted, server-hardcoded
// MCP provenance forward.

import {
  hashCanonicalPayload,
  IdempotencyValidationError,
  validateIdempotencyKey,
} from "../../_shared/btpm-api/idempotency.ts";
import {
  MCP_DELEGATION_MODE,
  MCP_SOURCE_CHANNEL,
  type McpTrustedExecutionContext,
} from "./buildMcpExecutionContext.ts";

// -----------------------------------------------------------------------------
// Bounded control-plane failure
// -----------------------------------------------------------------------------

/** Stable, non-disclosing MCP mutation-control error codes. */
export type McpMutationControlErrorCode =
  | "mcp_mutation_confirmation_required"
  | "mcp_mutation_context_invalid";

/**
 * Bounded MCP mutation-control failure. It carries no caller payload, no
 * governance reason and no identity value.
 */
export class McpMutationControlError extends Error {
  public readonly code: McpMutationControlErrorCode;
  constructor(code: McpMutationControlErrorCode) {
    super(code);
    this.name = "McpMutationControlError";
    this.code = code;
  }
}

// -----------------------------------------------------------------------------
// Confirmation contract
// -----------------------------------------------------------------------------

/**
 * The exact MCP confirmation argument name. No alias (`confirmed`, `approve`,
 * `approved`, `yes`, `force`, `execute`, ...) is accepted, ever.
 */
export const MCP_CONFIRMATION_FIELD = "confirmation" as const;

/**
 * The exact MCP idempotency argument name. MCP `tools/call` does not use the
 * REST `Idempotency-Key` header contract as its per-operation input.
 */
export const MCP_IDEMPOTENCY_KEY_FIELD = "idempotencyKey" as const;

/**
 * Fail-closed confirmation gate. Accepts ONLY literal boolean `true`.
 *
 * Rejected: missing/undefined, `null`, `false`, `"true"`, `"TRUE"`, `1`, `0`,
 * objects, arrays and every alias field name.
 *
 * This helper executes no PM operation and persists nothing. Confirmation is
 * control metadata: it never enters the canonical API body, the payload hash,
 * idempotency metadata, PMG audit payloads, activity events, trusted identity
 * or the business response.
 */
export function requireMcpMutationConfirmation(value: unknown): void {
  if (value !== true) {
    throw new McpMutationControlError("mcp_mutation_confirmation_required");
  }
}

/**
 * Canonical MCP idempotency-key validation. It delegates entirely to the
 * canonical API-F validator so MCP can never drift from REST on pattern,
 * length, trimming or the missing/invalid distinction.
 */
export function validateMcpIdempotencyKey(raw: unknown): string {
  return validateIdempotencyKey(raw);
}

// -----------------------------------------------------------------------------
// Mutation execution context
// -----------------------------------------------------------------------------

/**
 * The immutable trusted MCP MUTATION execution context: exactly the accepted
 * trusted MCP identity/provenance fields plus the two mutation-only fields.
 *
 * Mutation-only state is deliberately NOT added to
 * `McpTrustedExecutionContext`, so reads stay free of it.
 */
export interface McpMutationExecutionContext
  extends McpTrustedExecutionContext {
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Builds the trusted MCP mutation execution context.
 *
 * Side-effect free: no database, RPC, network, environment or persistence
 * access. It fails closed when the trusted context is malformed, when the
 * source channel is not `mcp`, when the delegation mode is not
 * `delegated_user`, or when the idempotency key is not canonically valid.
 *
 * `payloadHash` is computed over the VALIDATED CANONICAL BUSINESS PAYLOAD only.
 * The confirmation flag, the idempotency key, the bearer token, request
 * metadata, registry metadata and raw unvalidated MCP arguments are never
 * hashed.
 *
 * No tool argument can influence any identity or provenance field: they are
 * copied from the trusted context alone.
 */
export async function buildMcpMutationExecutionContext(
  trustedExecutionContext: McpTrustedExecutionContext,
  idempotencyKey: unknown,
  validatedCanonicalBusinessPayload: unknown,
): Promise<McpMutationExecutionContext> {
  const trusted: unknown = trustedExecutionContext;
  if (trusted === null || typeof trusted !== "object") {
    throw new McpMutationControlError("mcp_mutation_context_invalid");
  }

  const {
    requestedUserId,
    executingUserId,
    apiClientId,
    oauthClientId,
    policyVersionId,
    requestId,
    correlationId,
    sourceChannel,
    sourceClientId,
    delegationMode,
  } = trustedExecutionContext;

  if (
    !isNonBlank(requestedUserId) ||
    !isNonBlank(executingUserId) ||
    !isNonBlank(apiClientId) ||
    !isNonBlank(oauthClientId) ||
    !isNonBlank(policyVersionId) ||
    !isNonBlank(requestId) ||
    !isNonBlank(correlationId) ||
    !isNonBlank(sourceClientId)
  ) {
    throw new McpMutationControlError("mcp_mutation_context_invalid");
  }
  if (sourceChannel !== MCP_SOURCE_CHANNEL) {
    throw new McpMutationControlError("mcp_mutation_context_invalid");
  }
  if (delegationMode !== MCP_DELEGATION_MODE) {
    throw new McpMutationControlError("mcp_mutation_context_invalid");
  }

  // Internal identity/provenance consistency invariants guaranteed by the
  // canonical `buildMcpExecutionContext(...)` producer. The mutation trust
  // boundary fails closed when the trusted context supplied to it is internally
  // inconsistent, rather than propagating a malformed actor, client provenance
  // or correlation identity. These are defense at the mutation trust boundary,
  // not a second authorization system.
  if (requestedUserId !== executingUserId) {
    throw new McpMutationControlError("mcp_mutation_context_invalid");
  }
  if (sourceClientId !== apiClientId) {
    throw new McpMutationControlError("mcp_mutation_context_invalid");
  }
  if (correlationId !== requestId) {
    throw new McpMutationControlError("mcp_mutation_context_invalid");
  }

  // Canonical API-F validation. The canonical error is intentionally
  // propagated unchanged so MCP and REST cannot diverge in semantics.
  const validatedKey = validateMcpIdempotencyKey(idempotencyKey);

  // Canonical payload hashing over the validated business payload only.
  const payloadHash = await hashCanonicalPayload(
    validatedCanonicalBusinessPayload,
  );

  return Object.freeze({
    requestedUserId,
    executingUserId,
    apiClientId,
    oauthClientId,
    policyVersionId,
    requestId,
    correlationId,
    sourceChannel: MCP_SOURCE_CHANNEL,
    sourceClientId,
    delegationMode: MCP_DELEGATION_MODE,
    idempotencyKey: validatedKey,
    payloadHash,
  }) as McpMutationExecutionContext;
}

export { IdempotencyValidationError };
