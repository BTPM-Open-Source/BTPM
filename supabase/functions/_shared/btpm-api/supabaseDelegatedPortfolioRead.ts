// API-Q Portfolio-3 — Caller-scoped Portfolio read client factories.
//
// Binds the current request bearer token to a fresh anon-key Supabase client
// and invokes the accepted Portfolio RPC adapters with the authenticated OAuth
// client ID and validated input.
//
// This module constructs no HTTP route, imports no Supabase SDK, reads no
// environment variable, uses no service-role key, calls no `fetch`, logs
// nothing (and never logs the token), caches nothing, schedules no timers,
// holds no mutable global state, and reuses no client.

import { ApiHttpError } from "./http.ts";
import { extractBearerToken } from "./resolveTokenContext.ts";
import type { AuthenticatedApiContext } from "./authenticateApiRequest.ts";
import {
  readApiV1PortfolioDetail,
  readApiV1PortfolioProjects,
  readApiV1Portfolios,
  type ApiV1PortfolioDetailPayload,
  type ApiV1PortfolioDetailRpcClient,
  type ApiV1PortfolioProjectsPayload,
  type ApiV1PortfolioProjectsQuery,
  type ApiV1PortfolioProjectsRpcClient,
  type ApiV1PortfoliosPayload,
  type ApiV1PortfoliosQuery,
  type ApiV1PortfoliosRpcClient,
} from "./supabasePortfolioRead.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedPortfolioClientOptions {
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
export type DelegatedPortfolioClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedPortfolioClientOptions,
) => unknown;

/** Caller-scoped `/v1/portfolios` reader. */
export type DelegatedApiV1PortfoliosReader = (
  request: Request,
  context: AuthenticatedApiContext,
  query: ApiV1PortfoliosQuery,
) => Promise<ApiV1PortfoliosPayload>;

/** Caller-scoped `/v1/portfolios/:portfolioid` reader. */
export type DelegatedApiV1PortfolioReader = (
  request: Request,
  context: AuthenticatedApiContext,
  portfolioId: string,
) => Promise<ApiV1PortfolioDetailPayload>;

/** Caller-scoped `/v1/portfolios/:portfolioid/projects` reader. */
export type DelegatedApiV1PortfolioProjectsReader = (
  request: Request,
  context: AuthenticatedApiContext,
  portfolioId: string,
  query: ApiV1PortfolioProjectsQuery,
) => Promise<ApiV1PortfolioProjectsPayload>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRpcClient(value: unknown): boolean {
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

function createCallerBoundClient(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedPortfolioClientFactory,
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
  if (!isRpcClient(client)) {
    throw new ApiHttpError("internal_error");
  }
  return client;
}

function assertRuntimeConfiguration(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedPortfolioClientFactory,
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

/**
 * Create a caller-scoped `/v1/portfolios` reader bound to the given Supabase
 * URL and anon key. A fresh client is constructed per invocation.
 */
export function createDelegatedApiV1PortfoliosReader(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedPortfolioClientFactory,
): DelegatedApiV1PortfoliosReader {
  assertRuntimeConfiguration(supabaseUrl, supabaseAnonKey, createClient);

  return async function readDelegatedApiV1Portfolios(
    request: Request,
    context: AuthenticatedApiContext,
    query: ApiV1PortfoliosQuery,
  ): Promise<ApiV1PortfoliosPayload> {
    if (!(request instanceof Request)) {
      throw new ApiHttpError("internal_error");
    }
    const oauthClientId = resolveOauthClientId(context);
    const token = extractBearerToken(request);
    const client = createCallerBoundClient(
      supabaseUrl,
      supabaseAnonKey,
      createClient,
      token,
    );
    return await readApiV1Portfolios(
      client as ApiV1PortfoliosRpcClient,
      oauthClientId,
      query,
    );
  };
}

/**
 * Create a caller-scoped Portfolio detail reader bound to the given Supabase
 * URL and anon key. A fresh client is constructed per invocation.
 */
export function createDelegatedApiV1PortfolioReader(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedPortfolioClientFactory,
): DelegatedApiV1PortfolioReader {
  assertRuntimeConfiguration(supabaseUrl, supabaseAnonKey, createClient);

  return async function readDelegatedApiV1Portfolio(
    request: Request,
    context: AuthenticatedApiContext,
    portfolioId: string,
  ): Promise<ApiV1PortfolioDetailPayload> {
    if (!(request instanceof Request)) {
      throw new ApiHttpError("internal_error");
    }
    const oauthClientId = resolveOauthClientId(context);
    const token = extractBearerToken(request);
    const client = createCallerBoundClient(
      supabaseUrl,
      supabaseAnonKey,
      createClient,
      token,
    );
    return await readApiV1PortfolioDetail(
      client as ApiV1PortfolioDetailRpcClient,
      oauthClientId,
      portfolioId,
    );
  };
}

/**
 * Create a caller-scoped Portfolio Projects reader bound to the given Supabase
 * URL and anon key. A fresh client is constructed per invocation.
 */
export function createDelegatedApiV1PortfolioProjectsReader(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedPortfolioClientFactory,
): DelegatedApiV1PortfolioProjectsReader {
  assertRuntimeConfiguration(supabaseUrl, supabaseAnonKey, createClient);

  return async function readDelegatedApiV1PortfolioProjects(
    request: Request,
    context: AuthenticatedApiContext,
    portfolioId: string,
    query: ApiV1PortfolioProjectsQuery,
  ): Promise<ApiV1PortfolioProjectsPayload> {
    if (!(request instanceof Request)) {
      throw new ApiHttpError("internal_error");
    }
    const oauthClientId = resolveOauthClientId(context);
    const token = extractBearerToken(request);
    const client = createCallerBoundClient(
      supabaseUrl,
      supabaseAnonKey,
      createClient,
      token,
    );
    return await readApiV1PortfolioProjects(
      client as ApiV1PortfolioProjectsRpcClient,
      oauthClientId,
      portfolioId,
      query,
    );
  };
}
