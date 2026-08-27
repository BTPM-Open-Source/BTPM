// API-M.CP.4B — Caller-scoped Task detail read client factory.
//
// Binds the current request bearer token to a fresh anon-key Supabase client
// and invokes the accepted Task detail read adapter with the authenticated
// OAuth client ID and the requested identifier.
//
// This module constructs no HTTP route, imports no Supabase SDK, reads no
// environment variable, uses no service-role key, calls no `fetch`, performs
// no direct table read, logs nothing, caches nothing, schedules no timers,
// holds no mutable global state, reuses no client, and exposes no generic
// read executor.

import { ApiHttpError } from "./http.ts";
import { extractBearerToken } from "./resolveTokenContext.ts";
import type { AuthenticatedApiContext } from "./authenticateApiRequest.ts";
import {
  readApiV1Task,
  type ApiV1TaskReadItem,
  type ApiV1TaskReadRpcClient,
} from "./supabaseTaskRead.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedTaskReadClientOptions {
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
export type DelegatedTaskReadClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedTaskReadClientOptions,
) => unknown;

/** Caller-scoped Task detail reader. */
export type DelegatedApiV1TaskReader = (
  request: Request,
  context: AuthenticatedApiContext,
  taskId: string,
) => Promise<ApiV1TaskReadItem>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRpcClient(value: unknown): value is ApiV1TaskReadRpcClient {
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
  createClient: DelegatedTaskReadClientFactory,
  request: Request,
): ApiV1TaskReadRpcClient {
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
 * Create a caller-scoped Task detail reader. A fresh anon-key client bound to
 * the current bearer token is constructed per invocation.
 */
export function createDelegatedApiV1TaskReader(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedTaskReadClientFactory,
): DelegatedApiV1TaskReader {
  assertFactoryInputs(supabaseUrl, supabaseAnonKey, createClient);

  return async function readDelegatedApiV1Task(
    request: Request,
    context: AuthenticatedApiContext,
    taskId: string,
  ): Promise<ApiV1TaskReadItem> {
    const oauthClientId = resolveOauthClientId(context);
    const client = buildCallerScopedClient(
      supabaseUrl,
      supabaseAnonKey,
      createClient,
      request,
    );
    return await readApiV1Task(client, oauthClientId, taskId);
  };
}
