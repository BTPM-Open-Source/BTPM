// API-H.3C — Explicit `/v1/projects` delegated RPC adapter.
//
// This module calls exactly one accepted database wrapper,
// `public.api_v1_list_projects`, through a caller-supplied Supabase RPC
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
const API_V1_LIST_PROJECTS_FUNCTION_NAME = "api_v1_list_projects";

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
export interface ApiV1ProjectsRpcClient {
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

/** Caller-supplied query. */
export interface ApiV1ProjectsQuery {
  readonly workspaceId: string;
  readonly limit: number;
  readonly offset: number;
  readonly search: string | null;
}

/** Exact safe project item shape (API-N.3 — 13 frozen fields). */
export interface ApiV1ProjectItem {
  readonly projectId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly programId: string | null;
  readonly name: string;
  readonly status: string;
  readonly priority: string;
  readonly projectStage: string | null;
  readonly deliveryModel: string | null;
  readonly startDate: string | null;
  readonly targetEndDate: string | null;
  readonly agileEnabled: boolean;
  readonly updatedAt: string;
}

/** Exact collection item keys. */
const EXPECTED_ITEM_KEYS: ReadonlyArray<string> = Object.freeze([
  "projectId",
  "organizationId",
  "workspaceId",
  "programId",
  "name",
  "status",
  "priority",
  "projectStage",
  "deliveryModel",
  "startDate",
  "targetEndDate",
  "agileEnabled",
  "updatedAt",
]);

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;


/** Exact safe pagination shape. */
export interface ApiV1ProjectsPagination {
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
  readonly total: number;
}

/** Exact safe `/v1/projects` response payload. */
export interface ApiV1ProjectsPayload {
  readonly items: ReadonlyArray<ApiV1ProjectItem>;
  readonly pagination: ApiV1ProjectsPagination;
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

function validateQuery(query: unknown): ApiV1ProjectsQuery {
  if (!isPlainObject(query)) {
    throw new ApiHttpError("invalid_request");
  }
  const keys = Object.keys(query);
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
  const { workspaceId, limit, offset, search } = query as {
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
  let preservedSearch: string | null;
  if (search === null) {
    preservedSearch = null;
  } else if (typeof search === "string") {
    if (search.trim().length > SEARCH_MAX_LENGTH) {
      throw new ApiHttpError("invalid_request");
    }
    preservedSearch = search;
  } else {
    throw new ApiHttpError("invalid_request");
  }
  return Object.freeze({
    workspaceId,
    limit,
    offset,
    search: preservedSearch,
  }) as ApiV1ProjectsQuery;
}

function requireNonNilUuid(value: unknown): string {
  if (!isValidUuid(value) || value === NIL_UUID) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireNullableNonNilUuid(value: unknown): string | null {
  if (value === null) return null;
  return requireNonNilUuid(value);
}

function requireNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireNullableNonEmptyString(value: unknown): string | null {
  if (value === null) return null;
  return requireNonEmptyString(value);
}

function requireNullableCalendarDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    throw new ApiHttpError("internal_error");
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new ApiHttpError("internal_error");
  }
  const asDate = new Date(Date.UTC(year, month - 1, day));
  if (
    asDate.getUTCFullYear() !== year ||
    asDate.getUTCMonth() !== month - 1 ||
    asDate.getUTCDate() !== day
  ) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function toItem(
  raw: unknown,
  query: ApiV1ProjectsQuery,
): ApiV1ProjectItem {
  if (!isPlainObject(raw)) {
    throw new ApiHttpError("internal_error");
  }
  const keys = Object.keys(raw);
  if (keys.length !== EXPECTED_ITEM_KEYS.length) {
    throw new ApiHttpError("internal_error");
  }
  const expected = new Set(EXPECTED_ITEM_KEYS);
  for (const k of keys) {
    if (!expected.has(k)) {
      throw new ApiHttpError("internal_error");
    }
  }
  for (const k of EXPECTED_ITEM_KEYS) {
    if (!(k in raw)) {
      throw new ApiHttpError("internal_error");
    }
  }

  const workspaceId = requireNonNilUuid(raw.workspaceId);
  if (workspaceId !== query.workspaceId) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof raw.agileEnabled !== "boolean") {
    throw new ApiHttpError("internal_error");
  }

  return Object.freeze({
    projectId: requireNonNilUuid(raw.projectId),
    organizationId: requireNonNilUuid(raw.organizationId),
    workspaceId,
    programId: requireNullableNonNilUuid(raw.programId),
    name: requireNonEmptyString(raw.name),
    status: requireNonEmptyString(raw.status),
    priority: requireNonEmptyString(raw.priority),
    projectStage: requireNullableNonEmptyString(raw.projectStage),
    deliveryModel: requireNullableNonEmptyString(raw.deliveryModel),
    startDate: requireNullableCalendarDate(raw.startDate),
    targetEndDate: requireNullableCalendarDate(raw.targetEndDate),
    agileEnabled: raw.agileEnabled,
    updatedAt: requireTimestamp(raw.updatedAt),
  }) as ApiV1ProjectItem;
}


function toPayload(
  data: unknown,
  query: ApiV1ProjectsQuery,
): ApiV1ProjectsPayload {
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
  const items: ApiV1ProjectItem[] = [];
  const seen = new Set<string>();
  let sharedOrganizationId: string | null = null;
  for (const raw of rawItems) {
    const item = toItem(raw, query);
    if (seen.has(item.projectId)) {
      throw new ApiHttpError("internal_error");
    }
    seen.add(item.projectId);
    if (sharedOrganizationId === null) {
      sharedOrganizationId = item.organizationId;
    } else if (item.organizationId !== sharedOrganizationId) {
      throw new ApiHttpError("internal_error");
    }
    items.push(item);
  }
  const pagination = Object.freeze({
    limit,
    offset,
    returned,
    total,
  }) as ApiV1ProjectsPagination;
  return Object.freeze({
    items: Object.freeze(items) as ReadonlyArray<ApiV1ProjectItem>,
    pagination,
  }) as ApiV1ProjectsPayload;
}

/**
 * Read the delegated `/v1/projects` payload through the accepted
 * database wrapper. Access is decided exclusively by the database.
 */
export async function readApiV1Projects(
  client: ApiV1ProjectsRpcClient,
  expectedOauthClientId: string,
  query: ApiV1ProjectsQuery,
): Promise<ApiV1ProjectsPayload> {
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
    result = await client.rpc(API_V1_LIST_PROJECTS_FUNCTION_NAME, {
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
