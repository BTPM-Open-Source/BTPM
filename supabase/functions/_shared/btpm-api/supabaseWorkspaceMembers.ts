// API-Q WML-1B — Explicit Workspace-member delegated RPC adapter.
//
// This module calls exactly one accepted database wrapper,
// `public.api_v1_list_workspace_members`, through a caller-supplied Supabase
// RPC client. The caller-supplied client is the trust boundary: the runtime
// must supply a client bound to the current bearer token.
//
// This module constructs no Supabase client, reads no environment variable,
// extracts no token, uses no service-role key, calls no `fetch`, opens no
// network connection except through the injected `client.rpc` call, performs
// no logging, holds no mutable global state, and exposes no generic read
// executor. Membership / Tenant / Organization / Connected App /
// capability-grant / encryption / privacy authority stays in the database.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";

/** Exact database wrapper invoked by this adapter. */
const API_V1_LIST_WORKSPACE_MEMBERS_FUNCTION_NAME =
  "api_v1_list_workspace_members";

/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";
/** SQLSTATE invalid_parameter_value. */
const SQLSTATE_INVALID_PARAMETER_VALUE = "22023";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;

const LIMIT_MIN = 1;
const LIMIT_MAX = 100;
const OFFSET_MIN = 0;
const OFFSET_MAX = 10000;
const SEARCH_MAX_LENGTH = 100;

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** Minimal structural RPC client contract. */
export interface ApiV1WorkspaceMembersRpcClient {
  rpc(
    functionName: string,
    args: {
      _expected_oauth_client_id: string;
      _workspace_id: string;
      _limit: number;
      _offset: number;
      _search: string | null;
    },
  ): Promise<unknown>;
}

/** Caller-supplied request shape. */
export interface ApiV1WorkspaceMembersRequest {
  readonly workspaceId: string;
  readonly limit: number;
  readonly offset: number;
  readonly search: string | null;
}

/** Exact safe Workspace-member item shape. */
export interface ApiV1WorkspaceMemberItem {
  readonly userId: string;
  readonly displayName: string | null;
  readonly email: string | null;
}

/** Exact safe pagination shape. */
export interface ApiV1WorkspaceMembersPagination {
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
  readonly total: number;
}

/** Exact safe Workspace-member response payload. */
export interface ApiV1WorkspaceMembersPayload {
  readonly items: ReadonlyArray<ApiV1WorkspaceMemberItem>;
  readonly pagination: ApiV1WorkspaceMembersPagination;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertValidExpectedOauthClientId(
  value: unknown,
): asserts value is string {
  if (typeof value !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (value.length < 1 || value.length > 255) {
    throw new ApiHttpError("internal_error");
  }
  if (!EXPECTED_OAUTH_CLIENT_ID_PATTERN.test(value)) {
    throw new ApiHttpError("internal_error");
  }
}

function isSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value)
  );
}

function isValidUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return apiUuidSchema.safeParse(value).success;
}

function validateRequest(
  request: unknown,
): ApiV1WorkspaceMembersRequest {
  if (!isPlainObject(request)) {
    throw new ApiHttpError("invalid_request");
  }
  const keys = Object.keys(request);
  if (keys.length !== 4) {
    throw new ApiHttpError("invalid_request");
  }
  for (const k of keys) {
    if (
      k !== "workspaceId" &&
      k !== "limit" &&
      k !== "offset" &&
      k !== "search"
    ) {
      throw new ApiHttpError("invalid_request");
    }
  }
  const { workspaceId, limit, offset, search } = request as {
    workspaceId: unknown;
    limit: unknown;
    offset: unknown;
    search: unknown;
  };
  if (typeof workspaceId !== "string") {
    throw new ApiHttpError("invalid_request");
  }
  if (workspaceId === NIL_UUID || !isValidUuid(workspaceId)) {
    throw new ApiHttpError("invalid_request");
  }
  if (!isSafeInteger(limit) || limit < LIMIT_MIN || limit > LIMIT_MAX) {
    throw new ApiHttpError("invalid_request");
  }
  if (!isSafeInteger(offset) || offset < OFFSET_MIN || offset > OFFSET_MAX) {
    throw new ApiHttpError("invalid_request");
  }
  let normalizedSearch: string | null;
  if (search === null) {
    normalizedSearch = null;
  } else if (typeof search === "string") {
    if (search.trim().length > SEARCH_MAX_LENGTH) {
      throw new ApiHttpError("invalid_request");
    }
    normalizedSearch = search;
  } else {
    throw new ApiHttpError("invalid_request");
  }
  return Object.freeze({
    workspaceId,
    limit,
    offset,
    search: normalizedSearch,
  }) as ApiV1WorkspaceMembersRequest;
}

function toItem(raw: unknown): ApiV1WorkspaceMemberItem {
  if (!isPlainObject(raw)) {
    throw new ApiHttpError("internal_error");
  }
  const keys = Object.keys(raw);
  if (keys.length !== 3) {
    throw new ApiHttpError("internal_error");
  }
  const expected = new Set(["userId", "displayName", "email"]);
  for (const k of keys) {
    if (!expected.has(k)) {
      throw new ApiHttpError("internal_error");
    }
  }
  const { userId, displayName, email } = raw;
  if (!isValidUuid(userId)) {
    throw new ApiHttpError("internal_error");
  }
  if (displayName !== null && typeof displayName !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (email !== null && typeof email !== "string") {
    throw new ApiHttpError("internal_error");
  }
  // Null is preserved verbatim: no placeholder substitution.
  return Object.freeze({
    userId,
    displayName: displayName === null ? null : displayName,
    email: email === null ? null : email,
  }) as ApiV1WorkspaceMemberItem;
}

function toPayload(
  data: unknown,
  request: ApiV1WorkspaceMembersRequest,
): ApiV1WorkspaceMembersPayload {
  if (!isPlainObject(data)) {
    throw new ApiHttpError("internal_error");
  }
  const keys = Object.keys(data);
  if (keys.length !== 2) {
    throw new ApiHttpError("internal_error");
  }
  const expected = new Set(["items", "pagination"]);
  for (const k of keys) {
    if (!expected.has(k)) {
      throw new ApiHttpError("internal_error");
    }
  }
  const { items: rawItems, pagination: rawPagination } = data;
  if (!Array.isArray(rawItems)) {
    throw new ApiHttpError("internal_error");
  }
  if (!isPlainObject(rawPagination)) {
    throw new ApiHttpError("internal_error");
  }
  const pKeys = Object.keys(rawPagination);
  if (pKeys.length !== 4) {
    throw new ApiHttpError("internal_error");
  }
  const pExpected = new Set(["limit", "offset", "returned", "total"]);
  for (const k of pKeys) {
    if (!pExpected.has(k)) {
      throw new ApiHttpError("internal_error");
    }
  }
  const { limit, offset, returned, total } = rawPagination;
  if (!isSafeInteger(limit) || limit !== request.limit) {
    throw new ApiHttpError("internal_error");
  }
  if (!isSafeInteger(offset) || offset !== request.offset) {
    throw new ApiHttpError("internal_error");
  }
  if (!isSafeInteger(returned) || returned < 0 || returned > request.limit) {
    throw new ApiHttpError("internal_error");
  }
  if (!isSafeInteger(total) || total < 0 || total < returned) {
    throw new ApiHttpError("internal_error");
  }
  if (rawItems.length !== returned) {
    throw new ApiHttpError("internal_error");
  }
  const items: ApiV1WorkspaceMemberItem[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const item = toItem(raw);
    if (seen.has(item.userId)) {
      throw new ApiHttpError("internal_error");
    }
    seen.add(item.userId);
    items.push(item);
  }
  const pagination = Object.freeze({
    limit,
    offset,
    returned,
    total,
  }) as ApiV1WorkspaceMembersPagination;
  return Object.freeze({
    items: Object.freeze(items) as ReadonlyArray<ApiV1WorkspaceMemberItem>,
    pagination,
  }) as ApiV1WorkspaceMembersPayload;
}

/**
 * Read the delegated Workspace-member payload through the accepted database
 * wrapper. Access is decided exclusively by the database.
 */
export async function readApiV1WorkspaceMembers(
  client: ApiV1WorkspaceMembersRpcClient,
  expectedOauthClientId: string,
  request: ApiV1WorkspaceMembersRequest,
): Promise<ApiV1WorkspaceMembersPayload> {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    throw new ApiHttpError("internal_error");
  }

  assertValidExpectedOauthClientId(expectedOauthClientId);

  const validated = validateRequest(request);

  let result: unknown;
  try {
    result = await client.rpc(API_V1_LIST_WORKSPACE_MEMBERS_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _workspace_id: validated.workspaceId,
      _limit: validated.limit,
      _offset: validated.offset,
      _search: validated.search,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  if (!isPlainObject(result)) {
    throw new ApiHttpError("internal_error");
  }
  if (!("data" in result) || !("error" in result)) {
    throw new ApiHttpError("internal_error");
  }

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
  if (error === undefined) {
    throw new ApiHttpError("internal_error");
  }

  return toPayload(result.data, validated);
}
