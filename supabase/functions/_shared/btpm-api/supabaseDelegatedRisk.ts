// API-K.7 — Caller-scoped delegated execution adapters for the two external
// Risk mutations (`risks:create`, `risks:update`).
//
// Binds the current request bearer token to a fresh anon-key Supabase client
// and invokes the accepted API-K.7 base adapters. The service-role key is
// never used for Risk mutation.
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
  ApiV1CreateRiskBody,
  ApiV1UpdateRiskBody,
} from "../btpm-api/routes/risks.ts";
import {
  createApiV1Risk,
  updateApiV1Risk,
  type ApiV1CreateRiskResult,
  type ApiV1RiskRpcClient,
  type ApiV1UpdateRiskResult,
} from "./supabaseRisk.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedRiskClientOptions {
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
export type DelegatedRiskClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedRiskClientOptions,
) => unknown;

/** Caller-scoped external Risk create executor. */
export type DelegatedApiV1CreateRiskExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  body: ApiV1CreateRiskBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1CreateRiskResult>;

/** Caller-scoped external Risk update executor. */
export type DelegatedApiV1UpdateRiskExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  riskId: string,
  body: ApiV1UpdateRiskBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1UpdateRiskResult>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internal(): never {
  throw new ApiHttpError("internal_error");
}

function isRpcClient(value: unknown): value is ApiV1RiskRpcClient {
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
  createClient: DelegatedRiskClientFactory,
  token: string,
): ApiV1RiskRpcClient {
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
 * Create a caller-scoped executor for the accepted `api_v1_create_risk`
 * wrapper. A fresh anon-key client is constructed per invocation.
 */
export function createDelegatedApiV1CreateRiskExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedRiskClientFactory,
): DelegatedApiV1CreateRiskExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1CreateRisk(
    request: Request,
    context: AuthenticatedApiContext,
    body: ApiV1CreateRiskBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1CreateRiskResult> {
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

    return await createApiV1Risk(client, {
      expectedOauthClientId: oauthClientId,
      targetType: body.targetType,
      targetId: body.targetId,
      title: body.title,
      description: body.description,
      mitigationPlan: body.mitigationPlan,
      likelihood: body.likelihood,
      impact: body.impact,
      status: body.status,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

/**
 * Create a caller-scoped executor for the accepted `api_v1_update_risk`
 * wrapper. The Risk identity originates from the validated path only.
 */
export function createDelegatedApiV1UpdateRiskExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedRiskClientFactory,
): DelegatedApiV1UpdateRiskExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1UpdateRisk(
    request: Request,
    context: AuthenticatedApiContext,
    riskId: string,
    body: ApiV1UpdateRiskBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1UpdateRiskResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(riskId)) internal();
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

    return await updateApiV1Risk(client, {
      expectedOauthClientId: oauthClientId,
      riskId,
      expectedUpdatedAt: body.expectedUpdatedAt,
      title: body.title,
      description: body.description,
      mitigationPlan: body.mitigationPlan,
      likelihood: body.likelihood,
      impact: body.impact,
      status: body.status,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}
