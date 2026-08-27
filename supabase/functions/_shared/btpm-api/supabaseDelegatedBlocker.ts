// API-K.8 — Caller-scoped delegated execution adapters for the two external
// Blocker mutations (`blockers:create`, `blockers:update`).
//
// Binds the current request bearer token to a fresh anon-key Supabase client
// and invokes the accepted API-K.8 base adapters. The service-role key is
// never used for Blocker mutation.
//
// This module constructs no HTTP route, imports no Supabase SDK, reads no
// environment variable, uses no service-role key, calls no `fetch`, reads no
// request body, builds no execution context, hashes nothing, queries no
// business table, logs nothing, caches nothing, schedules no timers, holds no
// mutable global state, and reuses no client.

import { ApiHttpError } from "./http.ts";
import { extractBearerToken } from "./resolveTokenContext.ts";
import type { AuthenticatedApiContext } from "./authenticateApiRequest.ts";
import type { ExternalMutationExecutionContext } from "./buildExecutionContext.ts";
import type {
  ApiV1CreateBlockerBody,
  ApiV1UpdateBlockerBody,
} from "../btpm-api/routes/blockers.ts";
import {
  createApiV1Blocker,
  updateApiV1Blocker,
  type ApiV1BlockerRpcClient,
  type ApiV1CreateBlockerResult,
  type ApiV1UpdateBlockerResult,
} from "./supabaseBlocker.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedBlockerClientOptions {
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
export type DelegatedBlockerClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedBlockerClientOptions,
) => unknown;

/** Caller-scoped external Blocker create executor. */
export type DelegatedApiV1CreateBlockerExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  body: ApiV1CreateBlockerBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1CreateBlockerResult>;

/** Caller-scoped external Blocker update executor. */
export type DelegatedApiV1UpdateBlockerExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  blockerId: string,
  body: ApiV1UpdateBlockerBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1UpdateBlockerResult>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internal(): never {
  throw new ApiHttpError("internal_error");
}

function isRpcClient(value: unknown): value is ApiV1BlockerRpcClient {
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

function buildCallerClient(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedBlockerClientFactory,
  token: string,
): ApiV1BlockerRpcClient {
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
  return client;
}

/**
 * Create a caller-scoped executor for the accepted `api_v1_create_blocker`
 * wrapper. A fresh anon-key client is constructed per invocation.
 */
export function createDelegatedApiV1CreateBlockerExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedBlockerClientFactory,
): DelegatedApiV1CreateBlockerExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1CreateBlocker(
    request: Request,
    context: AuthenticatedApiContext,
    body: ApiV1CreateBlockerBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1CreateBlockerResult> {
    if (!(request instanceof Request)) internal();
    if (!isPlainObject(body)) internal();

    const { oauthClientId } = resolveConsistentIdentity(
      context,
      executionContext,
    );

    const token = extractBearerToken(request);
    const client = buildCallerClient(
      supabaseUrl,
      supabaseAnonKey,
      createClient,
      token,
    );

    return await createApiV1Blocker(client, {
      expectedOauthClientId: oauthClientId,
      targetType: body.targetType,
      targetId: body.targetId,
      title: body.title,
      description: body.description,
      severity: body.severity,
      status: body.status,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

/**
 * Create a caller-scoped executor for the accepted `api_v1_update_blocker`
 * wrapper. The Blocker identity originates from the validated path only.
 */
export function createDelegatedApiV1UpdateBlockerExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedBlockerClientFactory,
): DelegatedApiV1UpdateBlockerExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1UpdateBlocker(
    request: Request,
    context: AuthenticatedApiContext,
    blockerId: string,
    body: ApiV1UpdateBlockerBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1UpdateBlockerResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(blockerId)) internal();
    if (!isPlainObject(body)) internal();

    const { oauthClientId } = resolveConsistentIdentity(
      context,
      executionContext,
    );

    const token = extractBearerToken(request);
    const client = buildCallerClient(
      supabaseUrl,
      supabaseAnonKey,
      createClient,
      token,
    );

    return await updateApiV1Blocker(client, {
      expectedOauthClientId: oauthClientId,
      blockerId,
      expectedUpdatedAt: body.expectedUpdatedAt,
      title: body.title,
      description: body.description,
      severity: body.severity,
      status: body.status,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}
