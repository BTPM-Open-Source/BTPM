// API-N.9A — Caller-scoped delegated execution adapter for the single external
// Program mutation (`programs:create`).
//
// Binds the current request bearer token to a fresh anon-key Supabase client
// and invokes the accepted API-N.9A base adapter. The service-role key is never
// used for Program mutation.
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
  ApiV1CreateProgramBody,
  ApiV1UpdateProgramBody,
} from "../btpm-api/routes/programs.ts";
import {
  createApiV1Program,
  updateApiV1Program,
  type ApiV1CreateProgramResult,
  type ApiV1ProgramMutationRpcClient,
  type ApiV1ProgramUpdateMutationRpcClient,
  type ApiV1UpdateProgramResult,
} from "./supabaseProgramMutation.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedProgramMutationClientOptions {
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
export type DelegatedProgramMutationClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedProgramMutationClientOptions,
) => unknown;

/** Caller-scoped external Program create executor. */
export type DelegatedApiV1CreateProgramExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  body: ApiV1CreateProgramBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1CreateProgramResult>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internal(): never {
  throw new ApiHttpError("internal_error");
}

function isRpcClient(value: unknown): value is ApiV1ProgramMutationRpcClient {
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
  createClient: DelegatedProgramMutationClientFactory,
  token: string,
): ApiV1ProgramMutationRpcClient {
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
 * Create a caller-scoped executor for the accepted `api_v1_create_program`
 * wrapper. A fresh anon-key client is constructed per invocation.
 */
export function createDelegatedApiV1CreateProgramExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedProgramMutationClientFactory,
): DelegatedApiV1CreateProgramExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1CreateProgram(
    request: Request,
    context: AuthenticatedApiContext,
    body: ApiV1CreateProgramBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1CreateProgramResult> {
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

    return await createApiV1Program(client, {
      expectedOauthClientId: oauthClientId,
      workspaceId: body.workspaceId,
      name: body.name,
      description: body.description,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}

// -----------------------------------------------------------------------------
// API-N.9B — Caller-scoped delegated execution adapter for the external Program
// update command (`programs:update`).
//
// Identical security model to API-N.9A: a fresh anon-key client per invocation,
// bound to the current caller bearer token. The service-role key is never used
// for Program business execution, nothing is cached, and no Program read is
// performed here.
// -----------------------------------------------------------------------------

/** Caller-scoped external Program update executor. */
export type DelegatedApiV1UpdateProgramExecutor = (
  request: Request,
  context: AuthenticatedApiContext,
  programId: string,
  body: ApiV1UpdateProgramBody,
  executionContext: ExternalMutationExecutionContext,
) => Promise<ApiV1UpdateProgramResult>;

/**
 * Create a caller-scoped executor for the accepted `api_v1_update_program`
 * wrapper. A fresh anon-key client is constructed per invocation.
 */
export function createDelegatedApiV1UpdateProgramExecutor(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedProgramMutationClientFactory,
): DelegatedApiV1UpdateProgramExecutor {
  if (!isNonEmptyString(supabaseUrl)) internal();
  if (!isNonEmptyString(supabaseAnonKey)) internal();
  if (typeof createClient !== "function") internal();

  return async function executeDelegatedApiV1UpdateProgram(
    request: Request,
    context: AuthenticatedApiContext,
    programId: string,
    body: ApiV1UpdateProgramBody,
    executionContext: ExternalMutationExecutionContext,
  ): Promise<ApiV1UpdateProgramResult> {
    if (!(request instanceof Request)) internal();
    if (!isNonEmptyString(programId)) internal();
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

    return await updateApiV1Program(
      client as unknown as ApiV1ProgramUpdateMutationRpcClient,
      {
      expectedOauthClientId: oauthClientId,
      programId,
      expectedUpdatedAt: body.expectedUpdatedAt,
      name: body.name,
      status: body.status,
      description: body.description,
      setDescription: body.setDescription,
      requestId: executionContext.requestId,
      correlationId: executionContext.correlationId,
      idempotencyKey: executionContext.idempotencyKey,
      payloadHash: executionContext.payloadHash,
    });
  };
}
