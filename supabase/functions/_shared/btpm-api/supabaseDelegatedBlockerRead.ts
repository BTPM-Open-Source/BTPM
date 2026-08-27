// API-M.CP.2C2 — Caller-scoped Blocker read client factories.
//
// Binds the current request bearer token to a fresh anon-key Supabase client
// and invokes the accepted CP.2C2 Blocker read adapters with the authenticated
// OAuth client ID and the requested identifiers.
//
// This module constructs no HTTP route, imports no Supabase SDK, reads no
// environment variable, uses no service-role key, calls no `fetch`, performs
// no direct table read, logs nothing, caches nothing, schedules no timers,
// holds no mutable global state, reuses no client, and exposes no generic
// read executor.

import { ApiHttpError } from "./http.ts";
import { extractBearerToken } from "./resolveTokenContext.ts";
import type { AuthenticatedApiContext } from "./authenticateApiRequest.ts";
import type { ApiV1BlockerCursor } from "../btpm-api/routes/blockers.ts";
import {
  readApiV1Blocker,
  readApiV1ProjectBlockers,
  type ApiV1BlockerReadItem,
  type ApiV1BlockerReadRpcClient,
  type ApiV1ProjectBlockersPayload,
} from "./supabaseBlockerRead.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedBlockerReadClientOptions {
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
export type DelegatedBlockerReadClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedBlockerReadClientOptions,
) => unknown;

/** Caller-scoped Project Blocker collection reader. */
export type DelegatedApiV1ProjectBlockersReader = (
  request: Request,
  context: AuthenticatedApiContext,
  projectId: string,
  limit: number,
  cursor: ApiV1BlockerCursor | null,
) => Promise<ApiV1ProjectBlockersPayload>;

/** Caller-scoped Blocker detail reader. */
export type DelegatedApiV1BlockerReader = (
  request: Request,
  context: AuthenticatedApiContext,
  blockerId: string,
) => Promise<ApiV1BlockerReadItem>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRpcClient(value: unknown): value is ApiV1BlockerReadRpcClient {
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
  createClient: DelegatedBlockerReadClientFactory,
  request: Request,
): ApiV1BlockerReadRpcClient {
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
 * Create a caller-scoped Project Blocker collection reader. A fresh anon-key
 * client bound to the current bearer token is constructed per invocation.
 */
export function createDelegatedApiV1ProjectBlockersReader(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedBlockerReadClientFactory,
): DelegatedApiV1ProjectBlockersReader {
  assertFactoryInputs(supabaseUrl, supabaseAnonKey, createClient);

  return async function readDelegatedApiV1ProjectBlockers(
    request: Request,
    context: AuthenticatedApiContext,
    projectId: string,
    limit: number,
    cursor: ApiV1BlockerCursor | null,
  ): Promise<ApiV1ProjectBlockersPayload> {
    const oauthClientId = resolveOauthClientId(context);
    const client = buildCallerScopedClient(
      supabaseUrl,
      supabaseAnonKey,
      createClient,
      request,
    );
    return await readApiV1ProjectBlockers(
      client,
      oauthClientId,
      projectId,
      limit,
      cursor,
    );
  };
}

/**
 * Create a caller-scoped Blocker detail reader. A fresh anon-key client bound
 * to the current bearer token is constructed per invocation.
 */
export function createDelegatedApiV1BlockerReader(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedBlockerReadClientFactory,
): DelegatedApiV1BlockerReader {
  assertFactoryInputs(supabaseUrl, supabaseAnonKey, createClient);

  return async function readDelegatedApiV1Blocker(
    request: Request,
    context: AuthenticatedApiContext,
    blockerId: string,
  ): Promise<ApiV1BlockerReadItem> {
    const oauthClientId = resolveOauthClientId(context);
    const client = buildCallerScopedClient(
      supabaseUrl,
      supabaseAnonKey,
      createClient,
      request,
    );
    return await readApiV1Blocker(client, oauthClientId, blockerId);
  };
}
