// API-N.2B — Explicit Program read RPC adapters.
//
// This module calls exactly two accepted API-N.2A database wrappers,
// `public.api_v1_list_programs` and `public.api_v1_get_program`, through a
// caller-supplied Supabase RPC client. The caller-supplied client is the
// trust boundary: the runtime must supply a client bound to the current
// bearer token.
//
// This module constructs no Supabase client, reads no environment
// variable, extracts no token, uses no service-role key, calls no
// `fetch`, performs no route matching, performs no logging, schedules no
// timer, caches nothing, holds no mutable global state, uses no dynamic
// function name and exposes no generic read executor.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";

/** Exact database wrappers invoked by this module. */
const API_V1_LIST_PROGRAMS_FUNCTION_NAME = "api_v1_list_programs";
const API_V1_GET_PROGRAM_FUNCTION_NAME = "api_v1_get_program";

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

// -----------------------------------------------------------------------------
// Structural client contracts
// -----------------------------------------------------------------------------

export interface ApiV1ProgramsRpcClient {
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

export interface ApiV1ProgramDetailRpcClient {
  rpc(
    functionName: string,
    args: {
      _expected_oauth_client_id: string;
      _program_id: string;
    },
  ): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// Payload contracts
// -----------------------------------------------------------------------------

export interface ApiV1ProgramsQuery {
  readonly workspaceId: string;
  readonly limit: number;
  readonly offset: number;
  readonly search: string | null;
}

export interface ApiV1ProgramItem {
  readonly programId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiV1ProgramsPagination {
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
  readonly total: number;
}

export interface ApiV1ProgramsPayload {
  readonly items: ReadonlyArray<ApiV1ProgramItem>;
  readonly pagination: ApiV1ProgramsPagination;
}

export interface ApiV1ProgramDetailPayload {
  readonly programId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const EXPECTED_ITEM_KEYS: ReadonlyArray<string> = Object.freeze([
  "programId",
  "organizationId",
  "workspaceId",
  "name",
  "status",
  "createdAt",
  "updatedAt",
]);

const EXPECTED_DETAIL_KEYS: ReadonlyArray<string> = Object.freeze([
  "programId",
  "organizationId",
  "workspaceId",
  "name",
  "description",
  "status",
  "createdAt",
  "updatedAt",
]);

// -----------------------------------------------------------------------------
// Shared validation helpers
// -----------------------------------------------------------------------------

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
  if (value === NIL_UUID) return false;
  return apiUuidSchema.safeParse(value).success;
}

function requireUuid(value: unknown): string {
  if (!isValidUuid(value)) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireNullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (value.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function assertExactKeys(
  raw: Record<string, unknown>,
  expected: ReadonlyArray<string>,
): void {
  const keys = Object.keys(raw);
  if (keys.length !== expected.length) {
    throw new ApiHttpError("internal_error");
  }
  const allowed = new Set(expected);
  for (const k of keys) {
    if (!allowed.has(k)) {
      throw new ApiHttpError("internal_error");
    }
  }
  for (const k of expected) {
    if (!(k in raw)) {
      throw new ApiHttpError("internal_error");
    }
  }
}

function assertRpcClient(client: unknown): void {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    throw new ApiHttpError("internal_error");
  }
}

function unwrapRpcResult(result: unknown): unknown {
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
  return result.data;
}

// -----------------------------------------------------------------------------
// Collection adapter
// -----------------------------------------------------------------------------

function validateQuery(query: unknown): ApiV1ProgramsQuery {
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
  }) as ApiV1ProgramsQuery;
}

function toItem(raw: unknown, query: ApiV1ProgramsQuery): ApiV1ProgramItem {
  if (!isPlainObject(raw)) {
    throw new ApiHttpError("internal_error");
  }
  assertExactKeys(raw, EXPECTED_ITEM_KEYS);
  const workspaceId = requireUuid(raw.workspaceId);
  if (workspaceId !== query.workspaceId) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    programId: requireUuid(raw.programId),
    organizationId: requireUuid(raw.organizationId),
    workspaceId,
    name: requireNonEmptyString(raw.name),
    status: requireNonEmptyString(raw.status),
    createdAt: requireTimestamp(raw.createdAt),
    updatedAt: requireTimestamp(raw.updatedAt),
  }) as ApiV1ProgramItem;
}

function toCollectionPayload(
  data: unknown,
  query: ApiV1ProgramsQuery,
): ApiV1ProgramsPayload {
  if (!isPlainObject(data)) {
    throw new ApiHttpError("internal_error");
  }
  assertExactKeys(data, ["items", "pagination"]);
  const { items: rawItems, pagination: rawPagination } = data;
  if (!Array.isArray(rawItems)) {
    throw new ApiHttpError("internal_error");
  }
  if (!isPlainObject(rawPagination)) {
    throw new ApiHttpError("internal_error");
  }
  assertExactKeys(rawPagination, ["limit", "offset", "returned", "total"]);
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
  const items: ApiV1ProgramItem[] = [];
  const seen = new Set<string>();
  let sharedOrganizationId: string | null = null;
  for (const raw of rawItems) {
    const item = toItem(raw, query);
    if (seen.has(item.programId)) {
      throw new ApiHttpError("internal_error");
    }
    seen.add(item.programId);
    if (sharedOrganizationId === null) {
      sharedOrganizationId = item.organizationId;
    } else if (item.organizationId !== sharedOrganizationId) {
      throw new ApiHttpError("internal_error");
    }
    items.push(item);
  }
  return Object.freeze({
    items: Object.freeze(items) as ReadonlyArray<ApiV1ProgramItem>,
    pagination: Object.freeze({
      limit,
      offset,
      returned,
      total,
    }) as ApiV1ProgramsPagination,
  }) as ApiV1ProgramsPayload;
}

/**
 * Read the delegated `/v1/programs` payload through the accepted API-N.2A
 * database wrapper. Access is decided exclusively by the database.
 */
export async function readApiV1Programs(
  client: ApiV1ProgramsRpcClient,
  expectedOauthClientId: string,
  query: ApiV1ProgramsQuery,
): Promise<ApiV1ProgramsPayload> {
  assertRpcClient(client);
  assertValidExpectedOauthClientId(expectedOauthClientId);

  const validated = validateQuery(query);

  let result: unknown;
  try {
    result = await client.rpc(API_V1_LIST_PROGRAMS_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _workspace_id: validated.workspaceId,
      _limit: validated.limit,
      _offset: validated.offset,
      _search: validated.search,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toCollectionPayload(unwrapRpcResult(result), validated);
}

// -----------------------------------------------------------------------------
// Detail adapter
// -----------------------------------------------------------------------------

function toDetailPayload(
  data: unknown,
  programId: string,
): ApiV1ProgramDetailPayload {
  if (!isPlainObject(data)) {
    throw new ApiHttpError("internal_error");
  }
  assertExactKeys(data, EXPECTED_DETAIL_KEYS);
  const payloadProgramId = requireUuid(data.programId);
  if (payloadProgramId !== programId) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    programId: payloadProgramId,
    organizationId: requireUuid(data.organizationId),
    workspaceId: requireUuid(data.workspaceId),
    name: requireNonEmptyString(data.name),
    description: requireNullableString(data.description),
    status: requireNonEmptyString(data.status),
    createdAt: requireTimestamp(data.createdAt),
    updatedAt: requireTimestamp(data.updatedAt),
  }) as ApiV1ProgramDetailPayload;
}

/**
 * Read the delegated `/v1/programs/:programid` payload through the accepted
 * API-N.2A database wrapper. Access is decided exclusively by the database.
 */
export async function readApiV1ProgramDetail(
  client: ApiV1ProgramDetailRpcClient,
  expectedOauthClientId: string,
  programId: string,
): Promise<ApiV1ProgramDetailPayload> {
  assertRpcClient(client);
  assertValidExpectedOauthClientId(expectedOauthClientId);

  if (typeof programId !== "string") {
    throw new ApiHttpError("invalid_request");
  }
  if (programId === NIL_UUID) {
    throw new ApiHttpError("invalid_request");
  }
  if (!apiUuidSchema.safeParse(programId).success) {
    throw new ApiHttpError("invalid_request");
  }

  let result: unknown;
  try {
    result = await client.rpc(API_V1_GET_PROGRAM_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _program_id: programId,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toDetailPayload(unwrapRpcResult(result), programId);
}
