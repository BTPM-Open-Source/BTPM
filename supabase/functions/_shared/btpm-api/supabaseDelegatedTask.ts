// API-M.11A — Caller-scoped delegated execution adapters for the first two
// external Task mutations (`tasks:create`, `tasks:update`).
//
// Binds the current request bearer token to a fresh anon-key Supabase client
// and invokes the accepted API-M.11A base adapters. The service-role key is
// never used for Task mutation.
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
  ApiV1AssignTaskBody,
  ApiV1CreateTaskBody,
  ApiV1PlanTaskBody,
  ApiV1ReorderTasksBody,
  ApiV1TransitionTaskBody,
  ApiV1UpdateTaskBody,
} from "../btpm-api/routes/tasks.ts";
import {
  assignApiV1Task,
  createApiV1Task,
  planApiV1Task,
  reorderApiV1Tasks,
  transitionApiV1Task,
  updateApiV1Task,
  type ApiV1AssignTaskResult,
  type ApiV1CreateTaskResult,
  type ApiV1PlanTaskResult,
  type ApiV1ReorderTasksResult,
  type ApiV1TaskRpcClient,
  type ApiV1TransitionTaskResult,
  type ApiV1UpdateTaskResult,
} from "./supabaseTask.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedTaskClientOptions {
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
export type DelegatedTaskClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedTaskClientOptions,
) => unknown;

/** Caller-scoped external Task create executor. */
export type DelegatedApiV1CreateTaskExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  body: ApiV1CreateTaskBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1CreateTaskResult>;

/** Caller-scoped external Task update executor. */
export type DelegatedApiV1UpdateTaskExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  taskId: string,
  body: ApiV1UpdateTaskBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1UpdateTaskResult>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internal(): never {
  throw new ApiHttpError("internal_error");
}

function isRpcClient(value: unknown): value is ApiV1TaskRpcClient {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { rpc?: unknown }).rpc === "function"
  );
}

/**
 * Fail-closed identity consistency check between the authenticated API context
 * and the immutable execution context. Authority is never derived from caller
 * body, path or header metadata supplied as a business field.
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
  createClient: DelegatedTaskClientFactory,
  token: string,
): ApiV1TaskRpcClient {
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
 * Create a caller-scoped executor for the accepted `api_v1_create_task`
 * wrapper. A fresh anon-key client is constructed per invocation.
 */
export function createDelegatedApiV1CreateTaskExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedTaskClientFactory,
): DelegatedApiV1CreateTaskExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1CreateTask(
    request: Request,
    context: AuthenticatedApiContext,
    body: ApiV1CreateTaskBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1CreateTaskResult> {
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

    return await createApiV1Task(client, {
      expectedOauthClientId: oauthClientId,
      phaseId: body.phaseId,
      name: body.name,
      description: body.description,
      status: body.status,
      priority: body.priority,
      taskType: body.taskType,
      startDate: body.startDate,
      dueDate: body.dueDate,
      estimatedHours: body.estimatedHours,
      sortOrder: body.sortOrder,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

/**
 * Create a caller-scoped executor for the accepted `api_v1_update_task`
 * wrapper. The Task identity originates from the validated path only.
 */
export function createDelegatedApiV1UpdateTaskExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedTaskClientFactory,
): DelegatedApiV1UpdateTaskExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1UpdateTask(
    request: Request,
    context: AuthenticatedApiContext,
    taskId: string,
    body: ApiV1UpdateTaskBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1UpdateTaskResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(taskId)) internal();
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

    return await updateApiV1Task(client, {
      expectedOauthClientId: oauthClientId,
      taskId,
      expectedUpdatedAt: body.expectedUpdatedAt,
      name: body.name,
      description: body.description,
      status: body.status,
      priority: body.priority,
      taskType: body.taskType,
      estimatedHours: body.estimatedHours,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

// =============================================================================
// API-M.11B — Caller-scoped delegated execution adapters for the two remaining
// external Task planning-surface mutations (`tasks:reorder`, `tasks:plan`).
//
// Same accepted M.11A pattern: current request bearer, fresh anon-key client per
// invocation, fail-closed identity consistency, no service-role key, no business
// table read, no Task decryption.
// =============================================================================

/** Caller-scoped external Task reorder executor. */
export type DelegatedApiV1ReorderTasksExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  phaseId: string,
  body: ApiV1ReorderTasksBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1ReorderTasksResult>;

/** Caller-scoped external Task planning executor. */
export type DelegatedApiV1PlanTaskExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  taskId: string,
  body: ApiV1PlanTaskBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1PlanTaskResult>;

/**
 * Create a caller-scoped executor for the accepted `api_v1_reorder_tasks`
 * wrapper. A fresh anon-key client is constructed per invocation.
 */
export function createDelegatedApiV1ReorderTasksExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedTaskClientFactory,
): DelegatedApiV1ReorderTasksExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1ReorderTasks(
    request: Request,
    context: AuthenticatedApiContext,
    phaseId: string,
    body: ApiV1ReorderTasksBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1ReorderTasksResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(phaseId)) internal();
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

    return await reorderApiV1Tasks(client, {
      expectedOauthClientId: oauthClientId,
      phaseId,
      rows: body.rows,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

/**
 * Create a caller-scoped executor for the accepted `api_v1_plan_task` wrapper.
 * The Task identity originates from the validated path only.
 */
export function createDelegatedApiV1PlanTaskExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedTaskClientFactory,
): DelegatedApiV1PlanTaskExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1PlanTask(
    request: Request,
    context: AuthenticatedApiContext,
    taskId: string,
    body: ApiV1PlanTaskBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1PlanTaskResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(taskId)) internal();
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

    return await planApiV1Task(client, {
      expectedOauthClientId: oauthClientId,
      taskId,
      expectedUpdatedAt: body.expectedUpdatedAt,
      startDate: body.startDate,
      dueDate: body.dueDate,
      confirmParentExtension: body.confirmParentExtension,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

// =============================================================================
// API-M.11C — Caller-scoped delegated execution adapters for the final two
// external Task mutations (`tasks:assign`, `tasks:transition`).
//
// Same accepted pattern: current request bearer, fresh anon-key client per
// invocation, fail-closed identity consistency, no service-role key, no business
// table read, no Task decryption, no assignment-eligibility evaluation here.
// =============================================================================

/** Caller-scoped external Task assignment executor. */
export type DelegatedApiV1AssignTaskExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  taskId: string,
  body: ApiV1AssignTaskBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1AssignTaskResult>;

/** Caller-scoped external Task execution-transition executor. */
export type DelegatedApiV1TransitionTaskExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  taskId: string,
  body: ApiV1TransitionTaskBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1TransitionTaskResult>;

/**
 * Create a caller-scoped executor for the accepted `api_v1_assign_task`
 * wrapper. The Task identity originates from the validated path only, and the
 * assignee identity from the validated closed body only.
 */
export function createDelegatedApiV1AssignTaskExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedTaskClientFactory,
): DelegatedApiV1AssignTaskExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1AssignTask(
    request: Request,
    context: AuthenticatedApiContext,
    taskId: string,
    body: ApiV1AssignTaskBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1AssignTaskResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(taskId)) internal();
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

    return await assignApiV1Task(client, {
      expectedOauthClientId: oauthClientId,
      taskId,
      assigneeId: body.assigneeId,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

/**
 * Create a caller-scoped executor for the accepted `api_v1_transition_task`
 * wrapper. Execution-state business rules remain owned by the canonical command.
 */
export function createDelegatedApiV1TransitionTaskExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedTaskClientFactory,
): DelegatedApiV1TransitionTaskExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1TransitionTask(
    request: Request,
    context: AuthenticatedApiContext,
    taskId: string,
    body: ApiV1TransitionTaskBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1TransitionTaskResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(taskId)) internal();
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

    return await transitionApiV1Task(client, {
      expectedOauthClientId: oauthClientId,
      taskId,
      expectedUpdatedAt: body.expectedUpdatedAt,
      setActualStart: body.setActualStart,
      actualStartDate: body.actualStartDate,
      setActualEnd: body.setActualEnd,
      actualEndDate: body.actualEndDate,
      status: body.status,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}
