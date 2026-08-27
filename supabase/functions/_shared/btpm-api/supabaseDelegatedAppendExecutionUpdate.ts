// API-I.7 — Caller-scoped delegated execution adapter for the single
// API-I external mutation (`execution_updates:append`).
//
// Binds the current request bearer token to a fresh anon-key Supabase
// client and invokes the accepted `appendApiV1ExecutionUpdate` adapter.
//
// This module constructs no HTTP route, imports no Supabase SDK, reads
// no environment variable, uses no service-role key, calls no `fetch`,
// reads no request body, builds no execution context, hashes nothing,
// queries no business table, logs nothing, caches nothing, schedules no
// timers, holds no mutable global state, and reuses no client.

import { ApiHttpError } from "./http.ts";
import { extractBearerToken } from "./resolveTokenContext.ts";
import type { AuthenticatedApiContext } from "./authenticateApiRequest.ts";
import type { ExternalMutationExecutionContext } from "./buildExecutionContext.ts";
import type { ApiV1AppendExecutionUpdateBody } from "../btpm-api/routes/executionUpdates.ts";
import {
  appendApiV1ExecutionUpdate,
  type ApiV1AppendExecutionUpdateResult,
  type ApiV1AppendExecutionUpdateRpcClient,
} from "./supabaseAppendExecutionUpdate.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedAppendExecutionUpdateClientOptions {
  readonly auth: {
    readonly persistSession: false;
    readonly autoRefreshToken: false;
    readonly detectSessionInUrl: false;
  };
  readonly global: {
    readonly headers: {
      readonly Authorization: string;
    };
  };
}

/** Minimal structural client factory contract. */
export type DelegatedAppendExecutionUpdateClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedAppendExecutionUpdateClientOptions,
) => unknown;

/** Caller-scoped external execution-update executor. */
export type DelegatedApiV1AppendExecutionUpdateExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  body: ApiV1AppendExecutionUpdateBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1AppendExecutionUpdateResult>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internal(): never {
  throw new ApiHttpError("internal_error");
}

function isRpcClient(
  value: unknown,
): value is ApiV1AppendExecutionUpdateRpcClient {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { rpc?: unknown }).rpc === "function"
  );
}

/**
 * Fail-closed identity consistency check between the authenticated API
 * context and the immutable execution context. Authority is never derived
 * from caller body data.
 */
function resolveConsistentIdentity(
  context: unknown,
  executionContext: unknown,
): { readonly oauthClientId: string } {
  if (!isPlainObject(context) || !isPlainObject(executionContext)) internal();

  const token = context.token;
  const client = context.client;
  if (!isPlainObject(token) || !isPlainObject(client)) internal();

  const tokenUserId = token.userId;
  const clientUserId = client.userId;
  const apiClientId = client.apiClientId;
  const oauthClientId = client.oauthClientId;
  const policyVersionId = client.policyVersionId;

  if (
    !isNonEmptyString(tokenUserId) ||
    !isNonEmptyString(clientUserId) ||
    !isNonEmptyString(apiClientId) ||
    !isNonEmptyString(oauthClientId) ||
    !isNonEmptyString(policyVersionId)
  ) {
    internal();
  }
  if (tokenUserId !== clientUserId) internal();

  if (executionContext.requestedUserId !== tokenUserId) internal();
  if (executionContext.executingUserId !== tokenUserId) internal();
  if (executionContext.apiClientId !== apiClientId) internal();
  if (executionContext.oauthClientId !== oauthClientId) internal();
  if (executionContext.policyVersionId !== policyVersionId) internal();
  if (executionContext.sourceChannel !== "external_api") internal();
  if (executionContext.delegationMode !== "delegated_user") internal();

  return { oauthClientId };
}

/**
 * Create a caller-scoped executor for the accepted
 * `api_v1_append_execution_update` wrapper, bound to the given Supabase
 * URL and anon key. A fresh client is constructed per invocation.
 */
export function createDelegatedApiV1AppendExecutionUpdateExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedAppendExecutionUpdateClientFactory,
): DelegatedApiV1AppendExecutionUpdateExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1AppendExecutionUpdate(
    request: Request,
    context: AuthenticatedApiContext,
    body: ApiV1AppendExecutionUpdateBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1AppendExecutionUpdateResult> {
    if (!(request instanceof Request)) internal();
    if (!isPlainObject(body)) internal();

    const { oauthClientId } = resolveConsistentIdentity(
      context,
      executionContext,
    );

    // Preserves ApiAuthenticationError for missing/malformed credentials,
    // and fails before any client construction.
    const token = extractBearerToken(request);

    let client: unknown;
    try {
      client = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      });
    } catch (cause) {
      throw new ApiHttpError("internal_error", cause);
    }

    if (!isRpcClient(client)) internal();

    return await appendApiV1ExecutionUpdate(client, {
      expectedOauthClientId: oauthClientId,
      targetType: body.targetType,
      targetId: body.targetId,
      summary: body.summary,
      updateDate: body.updateDate,
      statusLabel: body.statusLabel,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}
