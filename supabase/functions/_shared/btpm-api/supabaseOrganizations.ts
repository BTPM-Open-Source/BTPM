// API-G.2E — Explicit `/v1/organizations` delegated RPC adapter.
//
// This module calls exactly one accepted database wrapper,
// `public.api_v1_list_organizations`, through a caller-supplied Supabase
// RPC client. The caller-supplied client is the trust boundary: the
// runtime must supply a client bound to the current bearer token.
//
// This module constructs no Supabase client, reads no environment
// variable, extracts no token, uses no service-role key, calls no
// `fetch`, opens no network connection except through the injected
// `client.rpc` call, and exposes no generic read executor.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";

/** Exact database wrapper invoked by this adapter. */
const API_V1_LIST_ORGANIZATIONS_FUNCTION_NAME = "api_v1_list_organizations";

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

const ALLOWED_ROLES: ReadonlySet<string> = new Set(["org_admin", "org_member"]);

/** Minimal structural RPC client contract. */
export interface ApiV1OrganizationsRpcClient {
  rpc(
    functionName: string,
    args: {
      _expected_oauth_client_id: string;
      _limit: number;
      _offset: number;
      _search: string | null;
    },
  ): Promise<unknown>;
}

/** Caller-supplied query. */
export interface ApiV1OrganizationsQuery {
  readonly limit: number;
  readonly offset: number;
  readonly search: string | null;
}

/** Exact safe organization item shape. */
export interface ApiV1OrganizationItem {
  readonly organizationId: string;
  readonly name: string;
  readonly role: "org_admin" | "org_member";
}

/** Exact safe pagination shape. */
export interface ApiV1OrganizationsPagination {
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
  readonly total: number;
}

/** Exact safe `/v1/organizations` response payload. */
export interface ApiV1OrganizationsPayload {
  readonly items: ReadonlyArray<ApiV1OrganizationItem>;
  readonly pagination: ApiV1OrganizationsPagination;
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

function validateQuery(query: unknown): ApiV1OrganizationsQuery {
  if (!isPlainObject(query)) {
    throw new ApiHttpError("invalid_request");
  }
  const keys = Object.keys(query);
  if (keys.length !== 3) {
    throw new ApiHttpError("invalid_request");
  }
  for (const k of keys) {
    if (k !== "limit" && k !== "offset" && k !== "search") {
      throw new ApiHttpError("invalid_request");
    }
  }
  const { limit, offset, search } = query as {
    limit: unknown;
    offset: unknown;
    search: unknown;
  };
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
    const trimmed = search.trim();
    if (trimmed.length > SEARCH_MAX_LENGTH) {
      throw new ApiHttpError("invalid_request");
    }
    normalizedSearch = search;
  } else {
    throw new ApiHttpError("invalid_request");
  }
  return Object.freeze({
    limit,
    offset,
    search: normalizedSearch,
  }) as ApiV1OrganizationsQuery;
}

function toItem(raw: unknown): ApiV1OrganizationItem {
  if (!isPlainObject(raw)) {
    throw new ApiHttpError("internal_error");
  }
  const keys = Object.keys(raw);
  if (keys.length !== 3) {
    throw new ApiHttpError("internal_error");
  }
  const expected = new Set(["organizationId", "name", "role"]);
  for (const k of keys) {
    if (!expected.has(k)) {
      throw new ApiHttpError("internal_error");
    }
  }
  const { organizationId, name, role } = raw;
  if (typeof organizationId !== "string") {
    throw new ApiHttpError("internal_error");
  }
  const parsed = apiUuidSchema.safeParse(organizationId);
  if (!parsed.success) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof name !== "string" || name.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof role !== "string" || !ALLOWED_ROLES.has(role)) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    organizationId,
    name,
    role: role as "org_admin" | "org_member",
  }) as ApiV1OrganizationItem;
}

function toPayload(
  data: unknown,
  query: ApiV1OrganizationsQuery,
): ApiV1OrganizationsPayload {
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
  const items: ApiV1OrganizationItem[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const item = toItem(raw);
    if (seen.has(item.organizationId)) {
      throw new ApiHttpError("internal_error");
    }
    seen.add(item.organizationId);
    items.push(item);
  }
  const pagination = Object.freeze({
    limit,
    offset,
    returned,
    total,
  }) as ApiV1OrganizationsPagination;
  return Object.freeze({
    items: Object.freeze(items) as ReadonlyArray<ApiV1OrganizationItem>,
    pagination,
  }) as ApiV1OrganizationsPayload;
}

/**
 * Read the delegated `/v1/organizations` payload through the accepted
 * database wrapper. Access is decided exclusively by the database.
 */
export async function readApiV1Organizations(
  client: ApiV1OrganizationsRpcClient,
  expectedOauthClientId: string,
  query: ApiV1OrganizationsQuery,
): Promise<ApiV1OrganizationsPayload> {
  if (
    client === null ||
    typeof client !== "object" ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    throw new ApiHttpError("internal_error");
  }

  assertValidExpectedOauthClientId(expectedOauthClientId);

  const validated = validateQuery(query);

  let result: unknown;
  try {
    result = await client.rpc(API_V1_LIST_ORGANIZATIONS_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
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
