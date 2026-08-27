// API-Q Portfolio-4B — Caller-scoped delegated execution adapter for the single
// external Portfolio mutation (`portfolios:create`).
//
// Binds the current request bearer token to a fresh anon-key Supabase client and
// invokes the accepted Portfolio Create adapter. The service-role key is never
// used for Portfolio business execution.
//
// This module constructs no HTTP route, imports no Supabase SDK, reads no
// environment variable, uses no service-role key, calls no `fetch`, reads no
// request body, builds no execution context, hashes nothing, queries no
// business table, pre-reads no Organization/owner/Portfolio data, logs nothing,
// caches nothing, schedules no timers, holds no mutable global state, and
// reuses no client.

import { ApiHttpError } from "./http.ts";
import { extractBearerToken } from "./resolveTokenContext.ts";
import type { AuthenticatedApiContext } from "./authenticateApiRequest.ts";
import type { ExternalMutationExecutionContext } from "./buildExecutionContext.ts";
import type {
  ApiV1AssignProjectPortfolioBody,
  ApiV1CreatePortfolioBody,
  ApiV1UpdatePortfolioBody,
} from "./routes/portfolios.ts";
import {
  assignApiV1ProjectPortfolio,
  createApiV1Portfolio,
  updateApiV1Portfolio,
  type ApiV1AssignProjectPortfolioResult,
  type ApiV1CreatePortfolioResult,
  type ApiV1PortfolioAssignmentMutationRpcClient,
  type ApiV1PortfolioMutationRpcClient,
  type ApiV1PortfolioUpdateMutationRpcClient,
  type ApiV1UpdatePortfolioResult,
} from "./supabasePortfolioMutation.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedPortfolioMutationClientOptions {
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
export type DelegatedPortfolioMutationClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedPortfolioMutationClientOptions,
) => unknown;

/** Caller-scoped external Portfolio create executor. */
export type DelegatedApiV1CreatePortfolioExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  body: ApiV1CreatePortfolioBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1CreatePortfolioResult>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internal(): never {
  throw new ApiHttpError("internal_error");
}

function isRpcClient(value: unknown): value is ApiV1PortfolioMutationRpcClient {
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
 * body data.
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
  createClient: DelegatedPortfolioMutationClientFactory,
  token: string,
): ApiV1PortfolioMutationRpcClient {
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
 * Create a caller-scoped executor for the accepted `api_v1_create_portfolio`
 * wrapper. A fresh anon-key client is constructed per invocation.
 */
export function createDelegatedApiV1CreatePortfolioExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedPortfolioMutationClientFactory,
): DelegatedApiV1CreatePortfolioExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1CreatePortfolio(
    request: Request,
    context: AuthenticatedApiContext,
    body: ApiV1CreatePortfolioBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1CreatePortfolioResult> {
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

    return await createApiV1Portfolio(client, {
      expectedOauthClientId: oauthClientId,
      organizationId: body.organizationId,
      name: body.name,
      code: body.code,
      description: body.description,
      lifecycleState: body.lifecycleState,
      strategicPriority: body.strategicPriority,
      ownerId: body.ownerId,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

// -----------------------------------------------------------------------------
// API-Q Portfolio-5B — Caller-scoped delegated execution adapter for the
// external Portfolio update command (`portfolios:update`).
//
// Identical security model to Portfolio-4B / Program Update: a fresh anon-key
// client per invocation, bound to the current caller bearer token. The
// service-role key is never used for Portfolio business execution, nothing is
// cached, no read-before-write is performed, and no business authorization is
// duplicated here.
// -----------------------------------------------------------------------------

/** Caller-scoped external Portfolio update executor. */
export type DelegatedApiV1UpdatePortfolioExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  portfolioId: string,
  body: ApiV1UpdatePortfolioBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1UpdatePortfolioResult>;

/**
 * Create a caller-scoped executor for the accepted `api_v1_update_portfolio`
 * wrapper. A fresh anon-key client is constructed per invocation.
 */
export function createDelegatedApiV1UpdatePortfolioExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedPortfolioMutationClientFactory,
): DelegatedApiV1UpdatePortfolioExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1UpdatePortfolio(
    request: Request,
    context: AuthenticatedApiContext,
    portfolioId: string,
    body: ApiV1UpdatePortfolioBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1UpdatePortfolioResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(portfolioId)) internal();
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

    return await updateApiV1Portfolio(
      client as unknown as ApiV1PortfolioUpdateMutationRpcClient,
      {
        expectedOauthClientId: oauthClientId,
        portfolioId,
        expectedUpdatedAt: body.expectedUpdatedAt,
        name: body.name,
        setName: body.setName,
        code: body.code,
        setCode: body.setCode,
        description: body.description,
        setDescription: body.setDescription,
        lifecycleState: body.lifecycleState,
        setLifecycleState: body.setLifecycleState,
        strategicPriority: body.strategicPriority,
        setStrategicPriority: body.setStrategicPriority,
        ownerId: body.ownerId,
        setOwnerId: body.setOwnerId,
        requestId: executionContext.requestId,
        correlationId: executionContext.correlationId,
        idempotencyKey: executionContext.idempotencyKey,
        payloadHash: executionContext.payloadHash,
      },
    );
  };
}

// -----------------------------------------------------------------------------
// API-Q Portfolio-6B — Caller-scoped delegated execution adapter for the
// external Project↔Portfolio assignment command
// (`portfolios:assign_project`).
//
// Identical security model to Portfolio-4B / Portfolio-5B: a fresh anon-key
// client per invocation, bound to the current caller bearer token. The
// service-role key is never used for Portfolio business execution, nothing is
// cached, no Project/Portfolio pre-read is performed, and no business
// authorization is duplicated here.
// -----------------------------------------------------------------------------

/** Caller-scoped external Project↔Portfolio assignment executor. */
export type DelegatedApiV1AssignProjectPortfolioExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  projectId: string,
  body: ApiV1AssignProjectPortfolioBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1AssignProjectPortfolioResult>;

/**
 * Create a caller-scoped executor for the accepted
 * `api_v1_assign_project_portfolio` wrapper. A fresh anon-key client is
 * constructed per invocation.
 */
export function createDelegatedApiV1AssignProjectPortfolioExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedPortfolioMutationClientFactory,
): DelegatedApiV1AssignProjectPortfolioExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1AssignProjectPortfolio(
    request: Request,
    context: AuthenticatedApiContext,
    projectId: string,
    body: ApiV1AssignProjectPortfolioBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1AssignProjectPortfolioResult> {
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

    return await assignApiV1ProjectPortfolio(
      client as unknown as ApiV1PortfolioAssignmentMutationRpcClient,
      {
        expectedOauthClientId: oauthClientId,
        projectId,
        portfolioId: body.portfolioId,
        requestId: executionContext.requestId,
        correlationId: executionContext.correlationId,
        idempotencyKey: executionContext.idempotencyKey,
        payloadHash: executionContext.payloadHash,
      },
    );
  };
}
