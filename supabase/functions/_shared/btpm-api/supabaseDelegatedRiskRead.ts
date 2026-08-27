// API-M.CP.2B1 — Caller-scoped Risk read client factories.
//
// Binds the current request bearer token to a fresh anon-key Supabase client
// and invokes the accepted Risk read adapters with the authenticated OAuth
// client ID and the requested identifiers.
//
// This module constructs no HTTP route, imports no Supabase SDK, reads no
// environment variable, uses no service-role key, calls no `fetch`, performs
// no direct table read, logs nothing, caches nothing, schedules no timers,
// holds no mutable global state, reuses no client, and exposes no generic
// read executor.

import { ApiHttpError } from "./http.ts";
import { extractBearerToken } from "./resolveTokenContext.ts";
import type { AuthenticatedApiContext } from "./authenticateApiRequest.ts";
import type { ApiV1RiskCursor } from "../btpm-api/routes/risks.ts";
import {
  readApiV1ProjectRisks,
  readApiV1Risk,
  type ApiV1ProjectRisksPayload,
  type ApiV1RiskReadItem,
  type ApiV1RiskReadRpcClient,
} from "./supabaseRiskRead.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedRiskReadClientOptions {
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
export type DelegatedRiskReadClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedRiskReadClientOptions,
) => unknown;

/** Caller-scoped Project Risk collection reader. */
export type DelegatedApiV1ProjectRisksReader = (
  request: Request,
  context: AuthenticatedApiContext,
  projectId: string,
  limit: number,
  cursor: ApiV1RiskCursor | null,
) => Promise<ApiV1ProjectRisksPayload>;

/** Caller-scoped Risk detail reader. */
export type DelegatedApiV1RiskReader = (
  request: Request,
  context: AuthenticatedApiContext,
  riskId: string,
) => Promise<ApiV1RiskReadItem>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRpcClient(value: unknown): value is ApiV1RiskReadRpcClient {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { rpc?: unknown }).rpc === "function"
  );
}

function resolveOauthClientId(context: unknown): string {
  if (
    typeof context !== "object" || context === null || Array.isArray(context)
  ) {
    throw new ApiHttpError("internal_error");
  }
  const client = (context as { client?: unknown }).client;
  if (typeof client !== "object" || client === null || Array.isArray(client)) {
    throw new ApiHttpError("internal_error");
  }
  const oauthClientId = (client as { oauthClientId?: unknown }).oauthClientId;
  if (!isNonEmptyString(oauthClientId)) {
    throw new ApiHttpError("internal_error");
  }
  return oauthClientId;
}

function assertFactoryInputs(
  supabaseUrl: unknown,
  supabaseAnonKey: unknown,
  createClient: unknown,
): void {
  if (!isNonEmptyString(supabaseUrl)) {
    throw new ApiHttpError("internal_error");
  }
  if (!isNonEmptyString(supabaseAnonKey)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof createClient !== "function") {
    throw new ApiHttpError("internal_error");
  }
}

function buildCallerScopedClient(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedRiskReadClientFactory,
  request: Request,
): ApiV1RiskReadRpcClient {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }

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

  if (!isRpcClient(client)) {
    throw new ApiHttpError("internal_error");
  }
  return client;
}

/**
 * Create a caller-scoped Project Risk collection reader. A fresh anon-key
 * client bound to the current bearer token is constructed per invocation.
 */
export function createDelegatedApiV1ProjectRisksReader(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedRiskReadClientFactory,
): DelegatedApiV1ProjectRisksReader {
  assertFactoryInputs(supabaseUrl, supabaseAnonKey, createClient);

  return async function readDelegatedApiV1ProjectRisks(
    request: Request,
    context: AuthenticatedApiContext,
    projectId: string,
    limit: number,
    cursor: ApiV1RiskCursor | null,
  ): Promise<ApiV1ProjectRisksPayload> {
    const oauthClientId = resolveOauthClientId(context);
    const client = buildCallerScopedClient(
      supabaseUrl,
      supabaseAnonKey,
      createClient,
      request,
    );
    return await readApiV1ProjectRisks(
      client,
      oauthClientId,
      projectId,
      limit,
      cursor,
    );
  };
}

/**
 * Create a caller-scoped Risk detail reader. A fresh anon-key client bound to
 * the current bearer token is constructed per invocation.
 */
export function createDelegatedApiV1RiskReader(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedRiskReadClientFactory,
): DelegatedApiV1RiskReader {
  assertFactoryInputs(supabaseUrl, supabaseAnonKey, createClient);

  return async function readDelegatedApiV1Risk(
    request: Request,
    context: AuthenticatedApiContext,
    riskId: string,
  ): Promise<ApiV1RiskReadItem> {
    const oauthClientId = resolveOauthClientId(context);
    const client = buildCallerScopedClient(
      supabaseUrl,
      supabaseAnonKey,
      createClient,
      request,
    );
    return await readApiV1Risk(client, oauthClientId, riskId);
  };
}
