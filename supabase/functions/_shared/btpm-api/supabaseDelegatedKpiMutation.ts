// KPI-4B — Caller-scoped delegated execution adapter for the single external
// Project KPI definition create command (`kpis:create`).
//
// Binds the current request bearer token to a fresh anon-key Supabase client
// and invokes the accepted KPI create adapter. The service-role key is never
// used for KPI business execution.
//
// This module constructs no HTTP route, imports no Supabase SDK, reads no
// environment variable, uses no service-role key, calls no `fetch`, reads no
// request body, builds no execution context, hashes nothing, queries no
// business table, pre-reads no Project or KPI data, logs nothing, caches
// nothing, schedules no timers, holds no mutable global state, and reuses no
// client.

import { ApiHttpError } from "./http.ts";
import { extractBearerToken } from "./resolveTokenContext.ts";
import type { AuthenticatedApiContext } from "./authenticateApiRequest.ts";
import type { ExternalMutationExecutionContext } from "./buildExecutionContext.ts";
import type {
  ApiV1AppendKpiUpdateBody,
  ApiV1CreateKpiBody,
  ApiV1UpdateKpiBody,
} from "./routes/kpis.ts";
import {
  appendApiV1KpiUpdate,
  createApiV1Kpi,
  updateApiV1Kpi,
  type ApiV1AppendKpiUpdateResult,
  type ApiV1CreateKpiResult,
  type ApiV1KpiAppendUpdateRpcClient,
  type ApiV1KpiMutationRpcClient,
  type ApiV1KpiUpdateRpcClient,
  type ApiV1UpdateKpiResult,
} from "./supabaseKpiMutation.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedKpiMutationClientOptions {
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
export type DelegatedKpiMutationClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedKpiMutationClientOptions,
) => unknown;

/** Caller-scoped external KPI create executor. */
export type DelegatedApiV1CreateKpiExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  projectId: string,
  body: ApiV1CreateKpiBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1CreateKpiResult>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internal(): never {
  throw new ApiHttpError("internal_error");
}

/**
 * KPI-5B — structural narrowing for the KPI update wrapper client. The update
 * wrapper takes its own fixed argument shape, so it has its own narrow guard;
 * no generic/dynamic RPC executor is introduced.
 */
function isUpdateRpcClient(value: unknown): value is ApiV1KpiUpdateRpcClient {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { rpc?: unknown }).rpc === "function"
  );
}

function isRpcClient(value: unknown): value is ApiV1KpiMutationRpcClient {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { rpc?: unknown }).rpc === "function"
  );
}

/**
 * Fail-closed identity consistency check between the authenticated API context
 * and the immutable external mutation execution context. Authority is never
 * derived from caller body data, and the execution source must be
 * `external_api` with delegated-user semantics.
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

function buildCallerRawClient(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedKpiMutationClientFactory,
  token: string,
): unknown {
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
  return client;
}

function buildCallerClient(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedKpiMutationClientFactory,
  token: string,
): ApiV1KpiMutationRpcClient {
  const client = buildCallerRawClient(
    supabaseUrl,
    supabaseAnonKey,
    createClient,
    token,
  );
  if (!isRpcClient(client)) internal();
  return client;
}

function buildCallerUpdateClient(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedKpiMutationClientFactory,
  token: string,
): ApiV1KpiUpdateRpcClient {
  const client = buildCallerRawClient(
    supabaseUrl,
    supabaseAnonKey,
    createClient,
    token,
  );
  if (!isUpdateRpcClient(client)) internal();
  return client;
}

/**
 * Create a caller-scoped executor for the accepted `api_v1_create_kpi` wrapper.
 * A fresh anon-key client is constructed per invocation, bound to the current
 * caller bearer token. The Project ID comes only from the validated route path,
 * the OAuth client ID only from the authenticated context, and the execution
 * metadata only from the canonical execution context.
 */
export function createDelegatedApiV1CreateKpiExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedKpiMutationClientFactory,
): DelegatedApiV1CreateKpiExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1CreateKpi(
    request: Request,
    context: AuthenticatedApiContext,
    projectId: string,
    body: ApiV1CreateKpiBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1CreateKpiResult> {
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

    return await createApiV1Kpi(client, {
      expectedOauthClientId: oauthClientId,
      projectId,
      name: body.name,
      description: body.description,
      unit: body.unit,
      targetValue: body.targetValue,
      targetDirection: body.targetDirection,
      sourceMode: body.sourceMode,
      valueType: body.valueType,
      cadence: body.cadence,
      calculationKey: body.calculationKey,
      formulaVersion: body.formulaVersion,
      completionMethod: body.completionMethod,
      commentRequired: body.commentRequired,
      actionPlanRequired: body.actionPlanRequired,
      autoSnapshotEnabled: body.autoSnapshotEnabled,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

// =============================================================================
// KPI-5B — Caller-scoped delegated execution adapter for the single external
// KPI definition update command (`kpis:update`).
//
// Identical caller-bound posture as the accepted KPI create executor: original
// bearer token, a fresh anon-key Supabase client per invocation, no
// service-role key, no caching and no retry.
// =============================================================================

/** Caller-scoped external KPI update executor. */
export type DelegatedApiV1UpdateKpiExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  kpiId: string,
  body: ApiV1UpdateKpiBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1UpdateKpiResult>;

/**
 * Create a caller-scoped executor for the accepted `api_v1_update_kpi` wrapper.
 * The KPI ID comes only from the validated route path, the OAuth client ID only
 * from the authenticated context, and the execution metadata only from the
 * canonical execution context.
 */
export function createDelegatedApiV1UpdateKpiExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedKpiMutationClientFactory,
): DelegatedApiV1UpdateKpiExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1UpdateKpi(
    request: Request,
    context: AuthenticatedApiContext,
    kpiId: string,
    body: ApiV1UpdateKpiBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1UpdateKpiResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(kpiId)) internal();
    if (!isPlainObject(body)) internal();

    const { oauthClientId } = resolveConsistentIdentity(
      context,
      executionContext,
    );

    const token = extractBearerToken(request);
    const client = buildCallerUpdateClient(
      supabaseUrl,
      supabaseAnonKey,
      createClient,
      token,
    );

    return await updateApiV1Kpi(client, {
      expectedOauthClientId: oauthClientId,
      kpiId,
      expectedUpdatedAt: body.expectedUpdatedAt,
      name: body.name,
      description: body.description,
      unit: body.unit,
      targetValue: body.targetValue,
      targetDirection: body.targetDirection,
      sourceMode: body.sourceMode,
      valueType: body.valueType,
      cadence: body.cadence,
      calculationKey: body.calculationKey,
      formulaVersion: body.formulaVersion,
      completionMethod: body.completionMethod,
      commentRequired: body.commentRequired,
      actionPlanRequired: body.actionPlanRequired,
      autoSnapshotEnabled: body.autoSnapshotEnabled,
      setName: body.setName,
      setDescription: body.setDescription,
      setUnit: body.setUnit,
      setTargetValue: body.setTargetValue,
      setTargetDirection: body.setTargetDirection,
      setSourceMode: body.setSourceMode,
      setValueType: body.setValueType,
      setCadence: body.setCadence,
      setCalculationKey: body.setCalculationKey,
      setFormulaVersion: body.setFormulaVersion,
      setCompletionMethod: body.setCompletionMethod,
      setCommentRequired: body.setCommentRequired,
      setActionPlanRequired: body.setActionPlanRequired,
      setAutoSnapshotEnabled: body.setAutoSnapshotEnabled,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

// =============================================================================
// KPI-6B — Caller-scoped delegated execution adapter for the single external KPI
// update-history append command (`kpis:append_update`).
//
// Identical caller-bound posture as the accepted KPI create/update executors:
// original bearer token, a fresh anon-key Supabase client per invocation, no
// service-role key, no caching and no retry.
// =============================================================================

/** Caller-scoped external KPI update-history append executor. */
export type DelegatedApiV1AppendKpiUpdateExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  kpiId: string,
  body: ApiV1AppendKpiUpdateBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1AppendKpiUpdateResult>;

/**
 * KPI-6B — structural narrowing for the KPI append wrapper client. The append
 * wrapper takes its own fixed argument shape, so it has its own narrow guard; no
 * generic/dynamic RPC executor is introduced.
 */
function isAppendRpcClient(
  value: unknown,
): value is ApiV1KpiAppendUpdateRpcClient {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { rpc?: unknown }).rpc === "function"
  );
}

function buildCallerAppendClient(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedKpiMutationClientFactory,
  token: string,
): ApiV1KpiAppendUpdateRpcClient {
  const client = buildCallerRawClient(
    supabaseUrl,
    supabaseAnonKey,
    createClient,
    token,
  );
  if (!isAppendRpcClient(client)) internal();
  return client;
}

/**
 * Create a caller-scoped executor for the accepted `api_v1_append_kpi_update`
 * wrapper. The KPI ID comes only from the validated route path, the OAuth client
 * ID only from the authenticated context, and the execution metadata only from
 * the canonical execution context.
 */
export function createDelegatedApiV1AppendKpiUpdateExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedKpiMutationClientFactory,
): DelegatedApiV1AppendKpiUpdateExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1AppendKpiUpdate(
    request: Request,
    context: AuthenticatedApiContext,
    kpiId: string,
    body: ApiV1AppendKpiUpdateBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1AppendKpiUpdateResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(kpiId)) internal();
    if (!isPlainObject(body)) internal();

    const { oauthClientId } = resolveConsistentIdentity(
      context,
      executionContext,
    );

    const token = extractBearerToken(request);
    const client = buildCallerAppendClient(
      supabaseUrl,
      supabaseAnonKey,
      createClient,
      token,
    );

    return await appendApiV1KpiUpdate(client, {
      expectedOauthClientId: oauthClientId,
      kpiId,
      value: body.value,
      updateDate: body.updateDate,
      note: body.note,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}
