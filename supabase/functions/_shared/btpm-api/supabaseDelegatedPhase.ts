// API-M.8A — Caller-scoped delegated execution adapters for the two external
// Phase mutations (`phases:create`, `phases:update`).
//
// Binds the current request bearer token to a fresh anon-key Supabase client
// and invokes the accepted API-M.8A base adapters. The service-role key is
// never used for Phase mutation.
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
  ApiV1CreatePhaseBody,
  ApiV1PlanPhaseBody,
  ApiV1ReorderPhasesBody,
  ApiV1UpdatePhaseBody,
} from "../btpm-api/routes/phases.ts";
import {
  createApiV1Phase,
  updateApiV1Phase,
  type ApiV1CreatePhaseResult,
  type ApiV1PhaseRpcClient,
  type ApiV1UpdatePhaseResult,
  planApiV1Phase,
  reorderApiV1Phases,
  type ApiV1PlanPhaseResult,
  type ApiV1ReorderPhasesResult,
} from "./supabasePhase.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedPhaseClientOptions {
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
export type DelegatedPhaseClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedPhaseClientOptions,
) => unknown;

/** Caller-scoped external Phase create executor. */
export type DelegatedApiV1CreatePhaseExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  body: ApiV1CreatePhaseBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1CreatePhaseResult>;

/** Caller-scoped external Phase update executor. */
export type DelegatedApiV1UpdatePhaseExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  phaseId: string,
  body: ApiV1UpdatePhaseBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1UpdatePhaseResult>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internal(): never {
  throw new ApiHttpError("internal_error");
}

function isRpcClient(value: unknown): value is ApiV1PhaseRpcClient {
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
  createClient: DelegatedPhaseClientFactory,
  token: string,
): ApiV1PhaseRpcClient {
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
 * Create a caller-scoped executor for the accepted `api_v1_create_phase`
 * wrapper. A fresh anon-key client is constructed per invocation.
 */
export function createDelegatedApiV1CreatePhaseExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedPhaseClientFactory,
): DelegatedApiV1CreatePhaseExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1CreatePhase(
    request: Request,
    context: AuthenticatedApiContext,
    body: ApiV1CreatePhaseBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1CreatePhaseResult> {
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

    return await createApiV1Phase(client, {
      expectedOauthClientId: oauthClientId,
      projectId: body.projectId,
      name: body.name,
      description: body.description,
      status: body.status,
      phaseType: body.phaseType,
      startDate: body.startDate,
      targetEndDate: body.targetEndDate,
      sortOrder: body.sortOrder,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

/**
 * Create a caller-scoped executor for the accepted `api_v1_update_phase`
 * wrapper. The Phase identity originates from the validated path only.
 */
export function createDelegatedApiV1UpdatePhaseExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedPhaseClientFactory,
): DelegatedApiV1UpdatePhaseExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1UpdatePhase(
    request: Request,
    context: AuthenticatedApiContext,
    phaseId: string,
    body: ApiV1UpdatePhaseBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1UpdatePhaseResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(phaseId)) internal();
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

    return await updateApiV1Phase(client, {
      expectedOauthClientId: oauthClientId,
      phaseId,
      expectedUpdatedAt: body.expectedUpdatedAt,
      name: body.name,
      description: body.description,
      status: body.status,
      phaseType: body.phaseType,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

// =============================================================================
// API-M.8B — Caller-scoped delegated execution adapters for the two remaining
// external Phase mutations (`phases:reorder`, `phases:plan`).
//
// Same accepted M.8A pattern: current request bearer, fresh anon-key client per
// invocation, fail-closed identity consistency, no service-role key, no business
// table read, no Phase decryption.
// =============================================================================

/** Caller-scoped external Phase reorder executor. */
export type DelegatedApiV1ReorderPhasesExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  projectId: string,
  body: ApiV1ReorderPhasesBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1ReorderPhasesResult>;

/** Caller-scoped external Phase planning executor. */
export type DelegatedApiV1PlanPhaseExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  phaseId: string,
  body: ApiV1PlanPhaseBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1PlanPhaseResult>;

/**
 * Create a caller-scoped executor for the accepted `api_v1_reorder_phases`
 * wrapper. A fresh anon-key client is constructed per invocation.
 */
export function createDelegatedApiV1ReorderPhasesExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedPhaseClientFactory,
): DelegatedApiV1ReorderPhasesExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1ReorderPhases(
    request: Request,
    context: AuthenticatedApiContext,
    projectId: string,
    body: ApiV1ReorderPhasesBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1ReorderPhasesResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(projectId)) internal();
    if (!isPlainObject(body) || !Array.isArray(body.rows)) internal();

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

    return await reorderApiV1Phases(client, {
      expectedOauthClientId: oauthClientId,
      projectId,
      rows: body.rows,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

/**
 * Create a caller-scoped executor for the accepted `api_v1_plan_phase`
 * wrapper. The Phase identity originates from the validated path only.
 */
export function createDelegatedApiV1PlanPhaseExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedPhaseClientFactory,
): DelegatedApiV1PlanPhaseExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1PlanPhase(
    request: Request,
    context: AuthenticatedApiContext,
    phaseId: string,
    body: ApiV1PlanPhaseBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1PlanPhaseResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(phaseId)) internal();
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

    return await planApiV1Phase(client, {
      expectedOauthClientId: oauthClientId,
      phaseId,
      expectedUpdatedAt: body.expectedUpdatedAt,
      startDate: body.startDate,
      targetEndDate: body.targetEndDate,
      confirmParentExtension: body.confirmParentExtension,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}
