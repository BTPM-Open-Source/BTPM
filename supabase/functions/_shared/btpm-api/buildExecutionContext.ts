// API-F.4 — Edge external-mutation execution context builder.
//
// Combines an already-authorized API request context (from API-E.R3) with
// a validated idempotency key and deterministic payload hash to produce
// the immutable context every future external command wrapper will use.
//
// This module does NOT construct HTTP routes, Supabase clients, database
// wrappers, or business mutations.

import type { AuthenticatedApiContext } from "./authenticateApiRequest.ts";
import { hashCanonicalPayload, readIdempotencyKey } from "./idempotency.ts";

// -----------------------------------------------------------------------------
// Stable execution-context error
// -----------------------------------------------------------------------------

export type ExecutionContextErrorCode =
  | "invalid_authenticated_context"
  | "invalid_request_id"
  | "invalid_correlation_id";

export class ExecutionContextError extends Error {
  public readonly code: ExecutionContextErrorCode;
  constructor(code: ExecutionContextErrorCode) {
    super(code);
    this.name = "ExecutionContextError";
    this.code = code;
  }
  toJSON(): { error: { code: ExecutionContextErrorCode } } {
    return { error: { code: this.code } };
  }
}

// -----------------------------------------------------------------------------
// Execution-context type
// -----------------------------------------------------------------------------

export interface ExternalMutationExecutionContext {
  readonly requestedUserId: string;
  readonly executingUserId: string;
  readonly apiClientId: string;
  readonly oauthClientId: string;
  readonly policyVersionId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly sourceChannel: "external_api";
  readonly sourceClientId: string;
  readonly delegationMode: "delegated_user";
}

// -----------------------------------------------------------------------------
// Dependencies
// -----------------------------------------------------------------------------

export interface ExecutionContextDependencies {
  randomUUID(): string;
}

const DEFAULT_DEPENDENCIES: ExecutionContextDependencies = {
  randomUUID(): string {
    return crypto.randomUUID();
  },
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const SAFE_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,128}$/;

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateAuthenticatedContext(ctx: AuthenticatedApiContext): void {
  if (
    !ctx ||
    typeof ctx !== "object" ||
    !ctx.token ||
    !ctx.client
  ) {
    throw new ExecutionContextError("invalid_authenticated_context");
  }
  const tUser = ctx.token.userId;
  const cUser = ctx.client.userId;
  const tClient = ctx.token.clientId;
  const cOauth = ctx.client.oauthClientId;
  const apiClientId = ctx.client.apiClientId;
  const policyVersionId = ctx.client.policyVersionId;
  if (
    !isNonBlank(tUser) ||
    !isNonBlank(cUser) ||
    tUser !== cUser ||
    !isNonBlank(tClient) ||
    !isNonBlank(cOauth) ||
    tClient !== cOauth ||
    !isNonBlank(apiClientId) ||
    !isNonBlank(policyVersionId)
  ) {
    throw new ExecutionContextError("invalid_authenticated_context");
  }
}

function validateRequestId(value: string): string {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    throw new ExecutionContextError("invalid_request_id");
  }
  return value;
}

function validateCorrelationId(value: string): string {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    throw new ExecutionContextError("invalid_correlation_id");
  }
  return value;
}

// -----------------------------------------------------------------------------
// Builder
// -----------------------------------------------------------------------------

export async function buildExecutionContext(
  request: Request,
  authenticatedContext: AuthenticatedApiContext,
  payload: unknown,
  dependencies: ExecutionContextDependencies = DEFAULT_DEPENDENCIES,
): Promise<ExternalMutationExecutionContext> {
  validateAuthenticatedContext(authenticatedContext);

  // Request-ID: supplied header or deterministic dependency.
  const rawRequestId = request.headers.get("X-Request-ID");
  let requestId: string;
  if (rawRequestId === null) {
    const generated = dependencies.randomUUID();
    requestId = validateRequestId(generated);
  } else {
    const trimmed = rawRequestId.trim();
    if (trimmed.length === 0) {
      throw new ExecutionContextError("invalid_request_id");
    }
    requestId = validateRequestId(trimmed);
  }

  // Correlation-ID: supplied header or defaults to request-ID.
  const rawCorrelationId = request.headers.get("X-Correlation-ID");
  let correlationId: string;
  if (rawCorrelationId === null) {
    correlationId = requestId;
  } else {
    const trimmed = rawCorrelationId.trim();
    if (trimmed.length === 0) {
      throw new ExecutionContextError("invalid_correlation_id");
    }
    correlationId = validateCorrelationId(trimmed);
  }

  const idempotencyKey = readIdempotencyKey(request);
  const payloadHash = await hashCanonicalPayload(payload);

  const userId = authenticatedContext.token.userId;
  const apiClientId = authenticatedContext.client.apiClientId;

  return Object.freeze({
    requestedUserId: userId,
    executingUserId: userId,
    apiClientId,
    oauthClientId: authenticatedContext.client.oauthClientId,
    policyVersionId: authenticatedContext.client.policyVersionId,
    requestId,
    correlationId,
    idempotencyKey,
    payloadHash,
    sourceChannel: "external_api" as const,
    sourceClientId: apiClientId,
    delegationMode: "delegated_user" as const,
  });
}
