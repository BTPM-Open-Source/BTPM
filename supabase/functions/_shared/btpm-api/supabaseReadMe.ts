// API-G.2B / ME-2 — Explicit `/v1/me` delegated RPC adapter.
//
// This module calls exactly one accepted database wrapper,
// `public.api_v1_get_me_context`, through a caller-supplied Supabase RPC
// client. The caller-supplied client is the trust boundary: the runtime
// must supply a client bound to the current bearer token.
//
// This module constructs no Supabase client, reads no environment
// variable, extracts no token, uses no service-role key, calls no
// `fetch`, and opens no network connection except through the injected
// `client.rpc` call. It exposes no generic read executor and never
// decrypts anything: ME-1 owns protected identity handling.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";
import type { ApiV1MeContextType, ApiV1MeQuery } from "./routes/me.ts";

/** Exact database wrapper invoked by this adapter. */
const API_V1_GET_ME_CONTEXT_FUNCTION_NAME = "api_v1_get_me_context";

/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";

/** SQLSTATE invalid_parameter_value. */
const SQLSTATE_INVALID_PARAMETER_VALUE = "22023";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;

const ACCEPTED_CONTEXT_TYPES: ReadonlySet<string> = new Set([
  "organization",
  "workspace",
  "project",
]);

const PAYLOAD_KEYS = [
  "userId",
  "displayName",
  "email",
  "isActive",
  "platformSuperAdmin",
  "context",
] as const;

const CONTEXT_KEYS = [
  "type",
  "contextId",
  "tenantId",
  "organizationId",
  "workspaceId",
  "projectId",
  "tenantRole",
  "organizationRole",
  "workspaceRole",
  "projectRole",
  "effectiveRole",
] as const;

/** Exact arguments passed to the accepted database wrapper. */
export interface ApiV1MeRpcArgs {
  _expected_oauth_client_id: string;
  _context_type: string | null;
  _context_id: string | null;
}

/** Minimal structural RPC client contract. */
export interface ApiV1MeRpcClient {
  rpc(functionName: string, args: ApiV1MeRpcArgs): Promise<unknown>;
}

/** Exact accepted ME-1 context object. */
export interface ApiV1MeContext {
  readonly type: ApiV1MeContextType;
  readonly contextId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly workspaceId: string | null;
  readonly projectId: string | null;
  readonly tenantRole: string | null;
  readonly organizationRole: string | null;
  readonly workspaceRole: string | null;
  readonly projectRole: string | null;
  readonly effectiveRole: string | null;
}

/** Exact safe `/v1/me` response payload. */
export interface ApiV1MePayload {
  readonly userId: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly isActive: true;
  readonly platformSuperAdmin: boolean;
  readonly context: ApiV1MeContext | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function fail(): never {
  throw new ApiHttpError("internal_error");
}

function assertExactKeys(
  data: Record<string, unknown>,
  expected: readonly string[],
): void {
  const keys = Object.keys(data);
  if (keys.length !== expected.length) fail();
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) fail();
  }
}

function requireUuid(value: unknown): string {
  if (typeof value !== "string") fail();
  if (!apiUuidSchema.safeParse(value).success) fail();
  return value;
}

function requireNullableUuid(value: unknown): string | null {
  if (value === null) return null;
  return requireUuid(value);
}

function requireNullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") fail();
  return value;
}

function assertValidExpectedOauthClientId(value: unknown): asserts value is string {
  if (typeof value !== "string") fail();
  if (value.length < 1 || value.length > 255) fail();
  if (!EXPECTED_OAUTH_CLIENT_ID_PATTERN.test(value)) fail();
}

function toRpcArgs(
  expectedOauthClientId: string,
  query: ApiV1MeQuery,
): ApiV1MeRpcArgs {
  if (!isPlainObject(query)) fail();
  const { contextType, contextId } = query as {
    contextType: unknown;
    contextId: unknown;
  };
  if (contextType === null && contextId === null) {
    return {
      _expected_oauth_client_id: expectedOauthClientId,
      _context_type: null,
      _context_id: null,
    };
  }
  if (typeof contextType !== "string" || !ACCEPTED_CONTEXT_TYPES.has(contextType)) {
    fail();
  }
  if (typeof contextId !== "string") fail();
  if (!apiUuidSchema.safeParse(contextId).success) fail();
  return {
    _expected_oauth_client_id: expectedOauthClientId,
    _context_type: contextType,
    _context_id: contextId,
  };
}

function toContext(value: unknown): ApiV1MeContext | null {
  if (value === null) return null;
  if (!isPlainObject(value)) fail();
  assertExactKeys(value, CONTEXT_KEYS);

  const type = value.type;
  if (typeof type !== "string" || !ACCEPTED_CONTEXT_TYPES.has(type)) fail();

  const contextId = requireUuid(value.contextId);
  const tenantId = requireUuid(value.tenantId);
  const organizationId = requireUuid(value.organizationId);
  const workspaceId = requireNullableUuid(value.workspaceId);
  const projectId = requireNullableUuid(value.projectId);

  if (type === "organization") {
    if (contextId !== organizationId) fail();
    if (workspaceId !== null || projectId !== null) fail();
  } else if (type === "workspace") {
    if (workspaceId === null || contextId !== workspaceId) fail();
    if (projectId !== null) fail();
  } else {
    if (projectId === null || contextId !== projectId) fail();
    if (workspaceId === null) fail();
  }

  return Object.freeze({
    type: type as ApiV1MeContextType,
    contextId,
    tenantId,
    organizationId,
    workspaceId,
    projectId,
    tenantRole: requireNullableString(value.tenantRole),
    organizationRole: requireNullableString(value.organizationRole),
    workspaceRole: requireNullableString(value.workspaceRole),
    projectRole: requireNullableString(value.projectRole),
    effectiveRole: requireNullableString(value.effectiveRole),
  }) as ApiV1MeContext;
}

function assertContextMatchesRequest(
  context: ApiV1MeContext | null,
  args: ApiV1MeRpcArgs,
): void {
  // ME-2 Correction 1 — the validated backend response must correspond
  // exactly to the context requested by the caller. Any other shape is
  // malformed backend behavior and fails closed.
  if (args._context_type === null || args._context_id === null) {
    if (context !== null) fail();
    return;
  }
  if (context === null) fail();
  if (context.type !== args._context_type) fail();
  if (context.contextId !== args._context_id) fail();
}

function toPayload(data: unknown, args: ApiV1MeRpcArgs): ApiV1MePayload {
  if (!isPlainObject(data)) fail();
  assertExactKeys(data, PAYLOAD_KEYS);

  const userId = requireUuid(data.userId);
  const displayName = requireNullableString(data.displayName);
  const email = requireNullableString(data.email);
  if (data.isActive !== true) fail();
  if (typeof data.platformSuperAdmin !== "boolean") fail();

  const context = toContext(data.context);
  assertContextMatchesRequest(context, args);

  return Object.freeze({
    userId,
    displayName,
    email,
    isActive: true,
    platformSuperAdmin: data.platformSuperAdmin,
    context: context,
  }) as ApiV1MePayload;
}

/**
 * Read the delegated `/v1/me` payload through the accepted database
 * wrapper. Access is decided exclusively by the database.
 */
export async function readApiV1Me(
  client: ApiV1MeRpcClient,
  expectedOauthClientId: string,
  query: ApiV1MeQuery,
): Promise<ApiV1MePayload> {
  if (
    client === null ||
    typeof client !== "object" ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    fail();
  }

  assertValidExpectedOauthClientId(expectedOauthClientId);

  const args = toRpcArgs(expectedOauthClientId, query);

  let result: unknown;
  try {
    result = await client.rpc(API_V1_GET_ME_CONTEXT_FUNCTION_NAME, args);
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  if (!isPlainObject(result)) fail();
  if (!("data" in result) || !("error" in result)) fail();

  const error = result.error;
  if (error !== null && error !== undefined) {
    if (isPlainObject(error)) {
      if (error.code === SQLSTATE_INSUFFICIENT_PRIVILEGE) {
        throw new ApiHttpError("not_authorized", error);
      }
      if (error.code === SQLSTATE_INVALID_PARAMETER_VALUE) {
        throw new ApiHttpError("invalid_request", error);
      }
    }
    throw new ApiHttpError("internal_error", error);
  }
  if (error === undefined) fail();

  return toPayload(result.data, args);
}
