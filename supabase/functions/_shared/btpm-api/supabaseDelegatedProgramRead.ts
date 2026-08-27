// API-N.2B — Caller-scoped Program read client factories.
//
// Binds the current request bearer token to a fresh anon-key Supabase
// client and invokes the accepted Program RPC adapters with the
// authenticated OAuth client ID and validated input.
//
// This module constructs no HTTP route, imports no Supabase SDK, reads
// no environment variable, uses no service-role key, calls no `fetch`,
// logs nothing (and never logs the token), caches nothing, schedules no
// timers, holds no mutable global state, and reuses no client.

import { ApiHttpError } from "./http.ts";
import { extractBearerToken } from "./resolveTokenContext.ts";
import type { AuthenticatedApiContext } from "./authenticateApiRequest.ts";
import {
  readApiV1Programs,
  readApiV1ProgramDetail,
  type ApiV1ProgramDetailPayload,
  type ApiV1ProgramDetailRpcClient,
  type ApiV1ProgramsPayload,
  type ApiV1ProgramsQuery,
  type ApiV1ProgramsRpcClient,
} from "./supabaseProgramRead.ts";

/** Exact client options passed to the injected client factory. */
export interface DelegatedProgramClientOptions {
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
export type DelegatedProgramClientFactory = (
  supabaseUrl: string,
  supabaseAnonKey: string,
  options: DelegatedProgramClientOptions,
) => unknown;

/** Caller-scoped `/v1/programs` reader. */
export type DelegatedApiV1ProgramsReader = (
  request: Request,
  context: AuthenticatedApiContext,
  query: ApiV1ProgramsQuery,
) => Promise<ApiV1ProgramsPayload>;

/** Caller-scoped `/v1/programs/:programid` reader. */
export type DelegatedApiV1ProgramReader = (
  request: Request,
  context: AuthenticatedApiContext,
  programId: string,
) => Promise<ApiV1ProgramDetailPayload>;

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
  createClient: DelegatedProgramClientFactory,
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
  createClient: DelegatedProgramClientFactory,
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
 * Create a caller-scoped `/v1/programs` reader bound to the given Supabase
 * URL and anon key. A fresh client is constructed per invocation.
 */
export function createDelegatedApiV1ProgramsReader(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedProgramClientFactory,
): DelegatedApiV1ProgramsReader {
  assertRuntimeConfiguration(supabaseUrl, supabaseAnonKey, createClient);

  return async function readDelegatedApiV1Programs(
    request: Request,
    context: AuthenticatedApiContext,
    query: ApiV1ProgramsQuery,
  ): Promise<ApiV1ProgramsPayload> {
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
    return await readApiV1Programs(
      client as ApiV1ProgramsRpcClient,
      oauthClientId,
      query,
    );
  };
}

/**
 * Create a caller-scoped Program detail reader bound to the given Supabase
 * URL and anon key. A fresh client is constructed per invocation.
 */
export function createDelegatedApiV1ProgramReader(
  supabaseUrl: string,
  supabaseAnonKey: string,
  createClient: DelegatedProgramClientFactory,
): DelegatedApiV1ProgramReader {
  assertRuntimeConfiguration(supabaseUrl, supabaseAnonKey, createClient);

  return async function readDelegatedApiV1Program(
    request: Request,
    context: AuthenticatedApiContext,
    programId: string,
  ): Promise<ApiV1ProgramDetailPayload> {
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
    return await readApiV1ProgramDetail(
      client as ApiV1ProgramDetailRpcClient,
      oauthClientId,
      programId,
    );
  };
}
