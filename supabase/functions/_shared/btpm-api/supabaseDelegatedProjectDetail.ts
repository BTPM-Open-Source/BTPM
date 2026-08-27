// API-H.4D — Caller-scoped `/v1/projects/:projectid` read client factory.
//
// Binds the current request bearer token to a fresh anon-key Supabase
// client and invokes the accepted `readApiV1ProjectDetail` adapter with
// the authenticated OAuth client ID and the requested Project ID.
//
// This module constructs no HTTP route, imports no Supabase SDK, reads
// no environment variable, uses no service-role key, calls no `fetch`,
// logs nothing, caches nothing, schedules no timers, holds no mutable
// global state, and reuses no client.

import { ApiHttpError } from "./http.ts";
import { extractBearerToken } from "./resolveTokenContext.ts";
import type { AuthenticatedApiContext } from "./authenticateApiRequest.ts";
import {
  readApiV1ProjectDetail,
  type ApiV1ProjectDetailPayload,
  type ApiV1ProjectDetailRpcClient,
} from "./supabaseProjectDetail.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedProjectDetailClientOptions {
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
export type DelegatedProjectDetailClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedProjectDetailClientOptions,
) => unknown;

/** Caller-scoped `/v1/projects/:projectid` reader. */
export type DelegatedApiV1ProjectDetailReader = (
  request: Request,
  context: AuthenticatedApiContext,
  projectId: string,
) => Promise<ApiV1ProjectDetailPayload>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRpcClient(value: unknown): value is ApiV1ProjectDetailRpcClient {
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
 * Create a caller-scoped `/v1/projects/:projectid` reader bound to the
 * given Supabase URL and anon key. A fresh client is constructed per
 * invocation.
 */
export function createDelegatedApiV1ProjectDetailReader(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedProjectDetailClientFactory,
): DelegatedApiV1ProjectDetailReader {
  if (!isNonEmptyString(supabaseUrl)) {
    throw new ApiHttpError("internal_error");
  }
  if (!isNonEmptyString(supabaseAnonKey)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof createClient !== "function") {
    throw new ApiHttpError("internal_error");
  }

  return async function readDelegatedApiV1ProjectDetail(
    request: Request,
    context: AuthenticatedApiContext,
    projectId: string,
  ): Promise<ApiV1ProjectDetailPayload> {
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

    return await readApiV1ProjectDetail(
      client,
      oauthClientId,
      projectId,
    );
  };
}
