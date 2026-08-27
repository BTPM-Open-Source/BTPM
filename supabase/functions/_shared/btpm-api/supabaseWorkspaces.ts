// API-H.2C — Explicit `/v1/workspaces` delegated RPC adapter.
//
// This module calls exactly one accepted database wrapper,
// `public.api_v1_list_workspaces`, through a caller-supplied Supabase RPC
// client. The caller-supplied client is the trust boundary: the runtime
// must supply a client bound to the current bearer token.
//
// This module constructs no Supabase client, reads no environment
// variable, extracts no token, uses no service-role key, calls no
// `fetch`, opens no network connection except through the injected
// `client.rpc` call, performs no logging, holds no mutable global state,
// and exposes no generic read executor.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";

/** Exact database wrapper invoked by this adapter. */
const API_V1_LIST_WORKSPACES_FUNCTION_NAME = "api_v1_list_workspaces";

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
export interface ApiV1WorkspacesRpcClient {
  rpc(
    functionName: string,
    args: {
      _expected_oauth_client_id: string;
      _organization_id: string;
      _limit: number;
      _offset: number;
      _search: string | null;
    },
  ): Promise<unknown>;
}

/** Caller-supplied query. */
export interface ApiV1WorkspacesQuery {
  readonly organizationId: string;
  readonly limit: number;
  readonly offset: number;
  readonly search: string | null;
}

/** Exact safe workspace item shape. */
export interface ApiV1WorkspaceItem {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly name: string;
}

/** Exact safe pagination shape. */
export interface ApiV1WorkspacesPagination {
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
  readonly total: number;
}

/** Exact safe `/v1/workspaces` response payload. */
export interface ApiV1WorkspacesPayload {
  readonly items: ReadonlyArray<ApiV1WorkspaceItem>;
  readonly pagination: ApiV1WorkspacesPagination;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
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

function validateQuery(query: unknown): ApiV1WorkspacesQuery {
  if (!isPlainObject(query)) {
    throw new ApiHttpError("invalid_request");
  }
  const keys = Object.keys(query);
  if (keys.length !== 4) {
    throw new ApiHttpError("invalid_request");
  }
  for (const k of keys) {
    if (
      k !== "organizationId" &&
      k !== "limit" &&
      k !== "offset" &&
      k !== "search"
    ) {
      throw new ApiHttpError("invalid_request");
    }
  }
  const { organizationId, limit, offset, search } = query as {
    organizationId: unknown;
    limit: unknown;
    offset: unknown;
    search: unknown;
  };
  if (typeof organizationId !== "string") {
    throw new ApiHttpError("invalid_request");
  }
  if (organizationId === NIL_UUID || !isValidUuid(organizationId)) {
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
    organizationId,
    limit,
    offset,
    search: normalizedSearch,
  }) as ApiV1WorkspacesQuery;
}

function toItem(
  raw: unknown,
  query: ApiV1WorkspacesQuery,
): ApiV1WorkspaceItem {
  if (!isPlainObject(raw)) {
    throw new ApiHttpError("internal_error");
  }
  const keys = Object.keys(raw);
  if (keys.length !== 3) {
    throw new ApiHttpError("internal_error");
  }
  const expected = new Set(["workspaceId", "organizationId", "name"]);
  for (const k of keys) {
    if (!expected.has(k)) {
      throw new ApiHttpError("internal_error");
    }
  }
  const { workspaceId, organizationId, name } = raw;
  if (!isValidUuid(workspaceId)) {
    throw new ApiHttpError("internal_error");
  }
  if (!isValidUuid(organizationId)) {
    throw new ApiHttpError("internal_error");
  }
  if (organizationId !== query.organizationId) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof name !== "string" || name.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    workspaceId,
    organizationId,
    name,
  }) as ApiV1WorkspaceItem;
}

function toPayload(
  data: unknown,
  query: ApiV1WorkspacesQuery,
): ApiV1WorkspacesPayload {
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
  if (!isSafeInteger(limit) || limit !== query.limit) {
    throw new ApiHttpError("internal_error");
  }
  if (!isSafeInteger(offset) || offset !== query.offset) {
    throw new ApiHttpError("internal_error");
  }
  if (!isSafeInteger(returned) || returned < 0 || returned > query.limit) {
    throw new ApiHttpError("internal_error");
  }
  if (!isSafeInteger(total) || total < 0 || total < returned) {
    throw new ApiHttpError("internal_error");
  }
  if (rawItems.length !== returned) {
    throw new ApiHttpError("internal_error");
  }
  const items: ApiV1WorkspaceItem[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const item = toItem(raw, query);
    if (seen.has(item.workspaceId)) {
      throw new ApiHttpError("internal_error");
    }
    seen.add(item.workspaceId);
    items.push(item);
  }
  const pagination = Object.freeze({
    limit,
    offset,
    returned,
    total,
  }) as ApiV1WorkspacesPagination;
  return Object.freeze({
    items: Object.freeze(items) as ReadonlyArray<ApiV1WorkspaceItem>,
    pagination,
  }) as ApiV1WorkspacesPayload;
}

/**
 * Read the delegated `/v1/workspaces` payload through the accepted
 * database wrapper. Access is decided exclusively by the database.
 */
export async function readApiV1Workspaces(
  client: ApiV1WorkspacesRpcClient,
  expectedOauthClientId: string,
  query: ApiV1WorkspacesQuery,
): Promise<ApiV1WorkspacesPayload> {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    throw new ApiHttpError("internal_error");
  }

  assertValidExpectedOauthClientId(expectedOauthClientId);

  const validated = validateQuery(query);

  let result: unknown;
  try {
    result = await client.rpc(API_V1_LIST_WORKSPACES_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _organization_id: validated.organizationId,
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
