// KPI-1B — Caller-scoped Project KPI collection read client factory.
//
// Binds the current request bearer token to a fresh anon-key Supabase client
// and invokes the accepted KPI read adapter with the authenticated OAuth client
// ID and the requested Project ID.
//
// This module constructs no HTTP route, imports no Supabase SDK, reads no
// environment variable, uses no service-role key, calls no `fetch`, performs no
// direct table read, logs nothing, caches nothing, schedules no timers, holds
// no mutable global state, reuses no client, duplicates no Project/KPI
// authority, and exposes no generic read executor.

import { ApiHttpError } from "./http.ts";
import { extractBearerToken } from "./resolveTokenContext.ts";
import type { AuthenticatedApiContext } from "./authenticateApiRequest.ts";
import type {
  ApiV1KpiUpdatesRouteQuery,
  ApiV1ProjectKpisRouteQuery,
} from "./routes/kpis.ts";
import {
  readApiV1Kpi,
  readApiV1KpiUpdates,
  readApiV1ProjectKpis,
  type ApiV1KpiReadRpcClient,
  type ApiV1KpiUpdatesPayload,
  type ApiV1ProjectKpiItem,
  type ApiV1ProjectKpisPayload,
} from "./supabaseKpiRead.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedKpiReadClientOptions {
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
export type DelegatedKpiReadClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedKpiReadClientOptions,
) => unknown;

/** Caller-scoped Project KPI collection reader. */
export type DelegatedApiV1ProjectKpisReader = (
  request: Request,
  context: AuthenticatedApiContext,
  projectId: string,
  query: ApiV1ProjectKpisRouteQuery,
) => Promise<ApiV1ProjectKpisPayload>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRpcClient(value: unknown): value is ApiV1KpiReadRpcClient {
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
  createClient: DelegatedKpiReadClientFactory,
  request: Request,
): ApiV1KpiReadRpcClient {
  if (!(request instanceof Request)) {
    throw new ApiHttpError("internal_error");
  }

  // Preserves ApiAuthenticationError for missing/malformed credentials, and
  // fails before any client construction.
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
 * Create a caller-scoped Project KPI collection reader. A fresh anon-key client
 * bound to the current bearer token is constructed per invocation.
 */
export function createDelegatedApiV1ProjectKpisReader(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedKpiReadClientFactory,
): DelegatedApiV1ProjectKpisReader {
  assertFactoryInputs(supabaseUrl, supabaseAnonKey, createClient);

  return async function readDelegatedApiV1ProjectKpis(
    request: Request,
    context: AuthenticatedApiContext,
    projectId: string,
    query: ApiV1ProjectKpisRouteQuery,
  ): Promise<ApiV1ProjectKpisPayload> {
    const oauthClientId = resolveOauthClientId(context);
    const client = buildCallerScopedClient(
      supabaseUrl,
      supabaseAnonKey,
      createClient,
      request,
    );
    return await readApiV1ProjectKpis(
      client,
      oauthClientId,
      projectId,
      query,
    );
  };
}

// -----------------------------------------------------------------------------
// KPI-2B — Caller-scoped single-KPI detail read client factory. Follows the
// accepted collection reader exactly: current request bearer, fresh anon-key
// client per invocation, no service-role read, no cache, no direct table read,
// no HTTP call to btpm-api-v1 and no generic RPC dispatcher.
// -----------------------------------------------------------------------------

/** Caller-scoped single-KPI reader. */
export type DelegatedApiV1KpiReader = (
  request: Request,
  context: AuthenticatedApiContext,
  kpiId: string,
) => Promise<ApiV1ProjectKpiItem>;

export function createDelegatedApiV1KpiReader(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedKpiReadClientFactory,
): DelegatedApiV1KpiReader {
  assertFactoryInputs(supabaseUrl, supabaseAnonKey, createClient);

  return async function readDelegatedApiV1Kpi(
    request: Request,
    context: AuthenticatedApiContext,
    kpiId: string,
  ): Promise<ApiV1ProjectKpiItem> {
    const oauthClientId = resolveOauthClientId(context);
    const client = buildCallerScopedClient(
      supabaseUrl,
      supabaseAnonKey,
      createClient,
      request,
    );
    return await readApiV1Kpi(client, oauthClientId, kpiId);
  };
}

// -----------------------------------------------------------------------------
// KPI-3B — Caller-scoped KPI update-history read client factory. Reuses the
// accepted `buildCallerScopedClient` exactly: current request bearer, fresh
// anon-key client per invocation, no service-role read, no cache, no direct
// table read, no HTTP call to btpm-api-v1 and no generic RPC dispatcher.
// -----------------------------------------------------------------------------

/** Caller-scoped KPI update-history reader. */
export type DelegatedApiV1KpiUpdatesReader = (
  request: Request,
  context: AuthenticatedApiContext,
  kpiId: string,
  query: ApiV1KpiUpdatesRouteQuery,
) => Promise<ApiV1KpiUpdatesPayload>;

export function createDelegatedApiV1KpiUpdatesReader(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedKpiReadClientFactory,
): DelegatedApiV1KpiUpdatesReader {
  assertFactoryInputs(supabaseUrl, supabaseAnonKey, createClient);

  return async function readDelegatedApiV1KpiUpdates(
    request: Request,
    context: AuthenticatedApiContext,
    kpiId: string,
    query: ApiV1KpiUpdatesRouteQuery,
  ): Promise<ApiV1KpiUpdatesPayload> {
    const oauthClientId = resolveOauthClientId(context);
    const client = buildCallerScopedClient(
      supabaseUrl,
      supabaseAnonKey,
      createClient,
      request,
    );
    return await readApiV1KpiUpdates(client, oauthClientId, kpiId, query);
  };
}
