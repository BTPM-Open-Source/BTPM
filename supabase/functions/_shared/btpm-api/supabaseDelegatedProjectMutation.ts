// API-N.5 — Caller-scoped delegated execution adapter for the single external
// Project mutation (`projects:create`).
//
// Binds the current request bearer token to a fresh anon-key Supabase client
// and invokes the accepted API-N.5 base adapter. The service-role key is never
// used for Project mutation.
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
  ApiV1CreateProjectBody,
  ApiV1TransitionProjectBody,
  ApiV1UpdateProjectBody,
} from "../btpm-api/routes/projects.ts";
import {
  createApiV1Project,
  updateApiV1Project,
  type ApiV1CreateProjectResult,
  type ApiV1ProjectMutationRpcClient,
  type ApiV1UpdateProjectResult,
  transitionApiV1Project,
  type ApiV1TransitionProjectResult,
} from "./supabaseProjectMutation.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedProjectMutationClientOptions {
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
export type DelegatedProjectMutationClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedProjectMutationClientOptions,
) => unknown;

/** Caller-scoped external blank-Project create executor. */
export type DelegatedApiV1CreateProjectExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  body: ApiV1CreateProjectBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1CreateProjectResult>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internal(): never {
  throw new ApiHttpError("internal_error");
}

function isRpcClient(value: unknown): value is ApiV1ProjectMutationRpcClient {
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
  createClient: DelegatedProjectMutationClientFactory,
  token: string,
): ApiV1ProjectMutationRpcClient {
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
 * Create a caller-scoped executor for the accepted `api_v1_create_project`
 * wrapper. A fresh anon-key client is constructed per invocation.
 */
export function createDelegatedApiV1CreateProjectExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedProjectMutationClientFactory,
): DelegatedApiV1CreateProjectExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1CreateProject(
    request: Request,
    context: AuthenticatedApiContext,
    body: ApiV1CreateProjectBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1CreateProjectResult> {
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

    return await createApiV1Project(client, {
      expectedOauthClientId: oauthClientId,
      workspaceId: body.workspaceId,
      name: body.name,
      programId: body.programId,
      deliveryModel: body.deliveryModel,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

// =============================================================================
// API-N.6 — Caller-scoped delegated execution adapter for the external Project
// metadata update command (`projects:update`).
//
// This reuses the accepted API-N.5 security pattern exactly: a fresh anon-key
// client per invocation, the caller bearer token bound through the
// Authorization header, and no service-role Project business execution.
// =============================================================================

/** Caller-scoped external Project metadata update executor. */
export type DelegatedApiV1UpdateProjectExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  projectId: string,
  body: ApiV1UpdateProjectBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1UpdateProjectResult>;

export function createDelegatedApiV1UpdateProjectExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedProjectMutationClientFactory,
): DelegatedApiV1UpdateProjectExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1UpdateProject(
    request: Request,
    context: AuthenticatedApiContext,
    projectId: string,
    body: ApiV1UpdateProjectBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1UpdateProjectResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(projectId)) internal();
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

    return await updateApiV1Project(client, {
      expectedOauthClientId: oauthClientId,
      projectId,
      expectedUpdatedAt: body.expectedUpdatedAt,
      name: body.name,
      setName: body.setName,
      priority: body.priority,
      setPriority: body.setPriority,
      description: body.description,
      setDescription: body.setDescription,
      charter: body.charter,
      setCharter: body.setCharter,
      goals: body.goals,
      setGoals: body.setGoals,
      scopeIn: body.scopeIn,
      setScopeIn: body.setScopeIn,
      scopeOut: body.scopeOut,
      setScopeOut: body.setScopeOut,
      businessCase: body.businessCase,
      setBusinessCase: body.setBusinessCase,
      successCriteria: body.successCriteria,
      setSuccessCriteria: body.setSuccessCriteria,
      completionCriteria: body.completionCriteria,
      setCompletionCriteria: body.setCompletionCriteria,
      budgetNarrative: body.budgetNarrative,
      setBudgetNarrative: body.setBudgetNarrative,
      assumptions: body.assumptions,
      setAssumptions: body.setAssumptions,
      constraints: body.constraints,
      setConstraints: body.setConstraints,
      programId: body.programId,
      setProgramId: body.setProgramId,
      deliveryModel: body.deliveryModel,
      setDeliveryModel: body.setDeliveryModel,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

// =============================================================================
// API-N.7 — Caller-scoped delegated execution adapter for the external Project
// status-transition command (`projects:transition`).
//
// Reuses the accepted API-N.5 / API-N.6 security pattern exactly: a fresh
// anon-key client per invocation, the caller bearer token bound through the
// Authorization header, and no service-role Project business execution.
// =============================================================================

/** Caller-scoped external Project status-transition executor. */
export type DelegatedApiV1TransitionProjectExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  projectId: string,
  body: ApiV1TransitionProjectBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1TransitionProjectResult>;

export function createDelegatedApiV1TransitionProjectExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedProjectMutationClientFactory,
): DelegatedApiV1TransitionProjectExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1TransitionProject(
    request: Request,
    context: AuthenticatedApiContext,
    projectId: string,
    body: ApiV1TransitionProjectBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1TransitionProjectResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(projectId)) internal();
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

    return await transitionApiV1Project(client, {
      expectedOauthClientId: oauthClientId,
      projectId,
      expectedUpdatedAt: body.expectedUpdatedAt,
      targetStatus: body.targetStatus,
      confirmWarnings: body.confirmWarnings,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}
