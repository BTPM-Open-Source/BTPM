// API-H.2D — Caller-scoped `/v1/workspaces` read client factory.
//
// Binds the current request bearer token to a fresh anon-key Supabase
// client and invokes the accepted `readApiV1Workspaces` adapter with the
// authenticated OAuth client ID and validated query.
//
// This module constructs no HTTP route, imports no Supabase SDK, reads
// no environment variable, uses no service-role key, calls no `fetch`,
// logs nothing, caches nothing, schedules no timers, holds no mutable
// global state, and reuses no client.

import { ApiHttpError } from "./http.ts";
import { extractBearerToken } from "./resolveTokenContext.ts";
import type { AuthenticatedApiContext } from "./authenticateApiRequest.ts";
import {
  readApiV1Workspaces,
  type ApiV1WorkspacesPayload,
  type ApiV1WorkspacesQuery,
  type ApiV1WorkspacesRpcClient,
} from "./supabaseWorkspaces.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedWorkspacesClientOptions {
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
export type DelegatedWorkspacesClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedWorkspacesClientOptions,
) => unknown;

/** Caller-scoped `/v1/workspaces` reader. */
export type DelegatedApiV1WorkspacesReader = (
  request: Request,
  context: AuthenticatedApiContext,
  query: ApiV1WorkspacesQuery,
) => Promise<ApiV1WorkspacesPayload>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRpcClient(value: unknown): value is ApiV1WorkspacesRpcClient {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { rpc?: unknown }).rpc === "function"
  );
}

function resolveOauthClientId(context: unknown): string {
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
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

/**
 * Create a caller-scoped `/v1/workspaces` reader bound to the given
 * Supabase URL and anon key. A fresh client is constructed per
 * invocation.
 */
export function createDelegatedApiV1WorkspacesReader(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedWorkspacesClientFactory,
): DelegatedApiV1WorkspacesReader {
  if (!isNonEmptyString(supabaseUrl)) {
    throw new ApiHttpError("internal_error");
  }
  if (!isNonEmptyString(supabaseAnonKey)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof createClient !== "function") {
    throw new ApiHttpError("internal_error");
  }

  return async function readDelegatedApiV1Workspaces(
    request: Request,
    context: AuthenticatedApiContext,
    query: ApiV1WorkspacesQuery,
  ): Promise<ApiV1WorkspacesPayload> {
    if (!(request instanceof Request)) {
      throw new ApiHttpError("internal_error");
    }
    const oauthClientId = resolveOauthClientId(context);

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

    return await readApiV1Workspaces(client, oauthClientId, query);
  };
}
