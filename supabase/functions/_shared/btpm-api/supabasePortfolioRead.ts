// API-Q Portfolio-3 — Explicit Portfolio read RPC adapters.
//
// This module calls exactly three accepted database wrappers,
// `public.api_v1_list_portfolios`, `public.api_v1_get_portfolio` and
// `public.api_v1_list_portfolio_projects`, through a caller-supplied Supabase
// RPC client. The caller-supplied client is the trust boundary: the runtime
// must supply a client bound to the current bearer token.
//
// This module constructs no Supabase client, reads no environment variable,
// extracts no token, uses no service-role key, calls no `fetch`, performs no
// route matching, performs no logging, schedules no timer, caches nothing,
// holds no mutable global state, uses no dynamic function name and exposes no
// generic read executor.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";

/** Exact database wrappers invoked by this module. */
const API_V1_LIST_PORTFOLIOS_FUNCTION_NAME = "api_v1_list_portfolios";
const API_V1_GET_PORTFOLIO_FUNCTION_NAME = "api_v1_get_portfolio";
const API_V1_LIST_PORTFOLIO_PROJECTS_FUNCTION_NAME =
  "api_v1_list_portfolio_projects";

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

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// -----------------------------------------------------------------------------
// Structural client contracts
// -----------------------------------------------------------------------------

export interface ApiV1PortfoliosRpcClient {
  rpc(
    functionName: string,
    args: {
      _expected_oauth_client_id: string;
      _organization_id: string;
      _limit: number;
      _offset: number;
      _search: string | null;
      _include_archived: boolean;
    },
  ): Promise<unknown>;
}

export interface ApiV1PortfolioDetailRpcClient {
  rpc(
    functionName: string,
    args: {
      _expected_oauth_client_id: string;
      _portfolio_item_id: string;
    },
  ): Promise<unknown>;
}

export interface ApiV1PortfolioProjectsRpcClient {
  rpc(
    functionName: string,
    args: {
      _expected_oauth_client_id: string;
      _portfolio_item_id: string;
      _limit: number;
      _offset: number;
      _search: string | null;
    },
  ): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// Payload contracts
// -----------------------------------------------------------------------------

export interface ApiV1PortfoliosQuery {
  readonly organizationId: string;
  readonly limit: number;
  readonly offset: number;
  readonly search: string | null;
  readonly includeArchived: boolean;
}

export interface ApiV1PortfolioProjectsQuery {
  readonly limit: number;
  readonly offset: number;
  readonly search: string | null;
}

export interface ApiV1PortfolioItem {
  readonly portfolioId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly code: string | null;
  readonly lifecycleState: string;
  readonly strategicPriority: string;
  readonly ownerId: string | null;
  readonly isArchived: boolean;
  readonly updatedAt: string;
}

export interface ApiV1PortfolioPagination {
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
  readonly total: number;
}

export interface ApiV1PortfoliosPayload {
  readonly items: ReadonlyArray<ApiV1PortfolioItem>;
  readonly pagination: ApiV1PortfolioPagination;
}

export interface ApiV1PortfolioDetailPayload {
  readonly portfolioId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly lifecycleState: string;
  readonly strategicPriority: string;
  readonly ownerId: string | null;
  readonly isArchived: boolean;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiV1PortfolioProjectItem {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly programId: string | null;
  readonly name: string;
  readonly status: string;
  readonly priority: string;
  readonly projectStage: string | null;
  readonly deliveryModel: string | null;
  readonly startDate: string | null;
  readonly targetEndDate: string | null;
  readonly updatedAt: string;
}

export interface ApiV1PortfolioProjectsPayload {
  readonly items: ReadonlyArray<ApiV1PortfolioProjectItem>;
  readonly pagination: ApiV1PortfolioPagination;
}

const EXPECTED_PORTFOLIO_ITEM_KEYS: ReadonlyArray<string> = Object.freeze([
  "portfolioId",
  "organizationId",
  "name",
  "code",
  "lifecycleState",
  "strategicPriority",
  "ownerId",
  "isArchived",
  "updatedAt",
]);

const EXPECTED_PORTFOLIO_DETAIL_KEYS: ReadonlyArray<string> = Object.freeze([
  "portfolioId",
  "organizationId",
  "name",
  "code",
  "description",
  "lifecycleState",
  "strategicPriority",
  "ownerId",
  "isArchived",
  "archivedAt",
  "createdAt",
  "updatedAt",
]);

const EXPECTED_PORTFOLIO_PROJECT_ITEM_KEYS: ReadonlyArray<string> = Object
  .freeze([
    "projectId",
    "workspaceId",
    "programId",
    "name",
    "status",
    "priority",
    "projectStage",
    "deliveryModel",
    "startDate",
    "targetEndDate",
    "updatedAt",
  ]);

// -----------------------------------------------------------------------------
// Shared validation helpers
// -----------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertValidExpectedOauthClientId(
  value: unknown,
): asserts value is string {
  if (typeof value !== "string") throw new ApiHttpError("internal_error");
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
  if (!isValidUuid(value)) throw new ApiHttpError("internal_error");
  return value;
}

function requireNullableUuid(value: unknown): string | null {
  if (value === null) return null;
  return requireUuid(value);
}

function requireNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireNullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new ApiHttpError("internal_error");
  return value;
}

function requireNullableNonEmptyString(value: unknown): string | null {
  if (value === null) return null;
  return requireNonEmptyString(value);
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new ApiHttpError("internal_error");
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

function requireNullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  return requireTimestamp(value);
}

function requireNullableDateOnly(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new ApiHttpError("internal_error");
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new ApiHttpError("internal_error");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
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
    if (!allowed.has(k)) throw new ApiHttpError("internal_error");
  }
  for (const k of expected) {
    if (!(k in raw)) throw new ApiHttpError("internal_error");
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
  if (!isPlainObject(result)) throw new ApiHttpError("internal_error");
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
  if (error === undefined) throw new ApiHttpError("internal_error");
  return result.data;
}

function validatePagination(
  data: unknown,
  limit: number,
  offset: number,
): { readonly items: ReadonlyArray<unknown>; readonly pagination: ApiV1PortfolioPagination } {
  if (!isPlainObject(data)) throw new ApiHttpError("internal_error");
  assertExactKeys(data, ["items", "pagination"]);
  const rawItems = data.items;
  const rawPagination = data.pagination;
  if (!Array.isArray(rawItems)) throw new ApiHttpError("internal_error");
  if (!isPlainObject(rawPagination)) throw new ApiHttpError("internal_error");
  assertExactKeys(rawPagination, ["limit", "offset", "returned", "total"]);
  const {
    limit: rLimit,
    offset: rOffset,
    returned,
    total,
  } = rawPagination;
  if (!isSafeInteger(rLimit) || rLimit !== limit) {
    throw new ApiHttpError("internal_error");
  }
  if (!isSafeInteger(rOffset) || rOffset !== offset) {
    throw new ApiHttpError("internal_error");
  }
  if (!isSafeInteger(returned) || returned < 0 || returned > limit) {
    throw new ApiHttpError("internal_error");
  }
  if (!isSafeInteger(total) || total < 0 || total < returned) {
    throw new ApiHttpError("internal_error");
  }
  if (rawItems.length !== returned) throw new ApiHttpError("internal_error");
  return {
    items: rawItems as ReadonlyArray<unknown>,
    pagination: Object.freeze({
      limit: rLimit,
      offset: rOffset,
      returned,
      total,
    }) as ApiV1PortfolioPagination,
  };
}

// -----------------------------------------------------------------------------
// Portfolio collection adapter
// -----------------------------------------------------------------------------

function validatePortfoliosQuery(query: unknown): ApiV1PortfoliosQuery {
  if (!isPlainObject(query)) throw new ApiHttpError("invalid_request");
  const keys = Object.keys(query);
  if (keys.length !== 5) throw new ApiHttpError("invalid_request");
  for (const k of keys) {
    if (
      k !== "organizationId" &&
      k !== "limit" &&
      k !== "offset" &&
      k !== "search" &&
      k !== "includeArchived"
    ) {
      throw new ApiHttpError("invalid_request");
    }
  }
  const { organizationId, limit, offset, search, includeArchived } = query as {
    organizationId: unknown;
    limit: unknown;
    offset: unknown;
    search: unknown;
    includeArchived: unknown;
  };
  if (typeof organizationId !== "string" || !isValidUuid(organizationId)) {
    throw new ApiHttpError("invalid_request");
  }
  if (!isSafeInteger(limit) || limit < LIMIT_MIN || limit > LIMIT_MAX) {
    throw new ApiHttpError("invalid_request");
  }
  if (!isSafeInteger(offset) || offset < OFFSET_MIN || offset > OFFSET_MAX) {
    throw new ApiHttpError("invalid_request");
  }
  if (typeof includeArchived !== "boolean") {
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
    organizationId,
    limit,
    offset,
    search: preservedSearch,
    includeArchived,
  }) as ApiV1PortfoliosQuery;
}

function toPortfolioItem(
  raw: unknown,
  organizationId: string,
): ApiV1PortfolioItem {
  if (!isPlainObject(raw)) throw new ApiHttpError("internal_error");
  assertExactKeys(raw, EXPECTED_PORTFOLIO_ITEM_KEYS);
  const itemOrganizationId = requireUuid(raw.organizationId);
  if (itemOrganizationId !== organizationId) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    portfolioId: requireUuid(raw.portfolioId),
    organizationId: itemOrganizationId,
    name: requireNonEmptyString(raw.name),
    code: requireNullableString(raw.code),
    lifecycleState: requireNonEmptyString(raw.lifecycleState),
    strategicPriority: requireNonEmptyString(raw.strategicPriority),
    ownerId: requireNullableUuid(raw.ownerId),
    isArchived: requireBoolean(raw.isArchived),
    updatedAt: requireTimestamp(raw.updatedAt),
  }) as ApiV1PortfolioItem;
}

/**
 * Read the delegated `/v1/portfolios` payload through the accepted
 * Portfolio-1 database wrapper. Access is decided exclusively by the database.
 */
export async function readApiV1Portfolios(
  client: ApiV1PortfoliosRpcClient,
  expectedOauthClientId: string,
  query: ApiV1PortfoliosQuery,
): Promise<ApiV1PortfoliosPayload> {
  assertRpcClient(client);
  assertValidExpectedOauthClientId(expectedOauthClientId);

  const validated = validatePortfoliosQuery(query);

  let result: unknown;
  try {
    result = await client.rpc(API_V1_LIST_PORTFOLIOS_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _organization_id: validated.organizationId,
      _limit: validated.limit,
      _offset: validated.offset,
      _search: validated.search,
      _include_archived: validated.includeArchived,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  const { items: rawItems, pagination } = validatePagination(
    unwrapRpcResult(result),
    validated.limit,
    validated.offset,
  );

  const items: ApiV1PortfolioItem[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const item = toPortfolioItem(raw, validated.organizationId);
    if (seen.has(item.portfolioId)) throw new ApiHttpError("internal_error");
    seen.add(item.portfolioId);
    items.push(item);
  }

  return Object.freeze({
    items: Object.freeze(items) as ReadonlyArray<ApiV1PortfolioItem>,
    pagination,
  }) as ApiV1PortfoliosPayload;
}

// -----------------------------------------------------------------------------
// Portfolio detail adapter
// -----------------------------------------------------------------------------

function toPortfolioDetailPayload(
  data: unknown,
  portfolioId: string,
): ApiV1PortfolioDetailPayload {
  if (!isPlainObject(data)) throw new ApiHttpError("internal_error");
  assertExactKeys(data, EXPECTED_PORTFOLIO_DETAIL_KEYS);
  const payloadPortfolioId = requireUuid(data.portfolioId);
  if (payloadPortfolioId !== portfolioId) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    portfolioId: payloadPortfolioId,
    organizationId: requireUuid(data.organizationId),
    name: requireNonEmptyString(data.name),
    code: requireNullableString(data.code),
    description: requireNullableString(data.description),
    lifecycleState: requireNonEmptyString(data.lifecycleState),
    strategicPriority: requireNonEmptyString(data.strategicPriority),
    ownerId: requireNullableUuid(data.ownerId),
    isArchived: requireBoolean(data.isArchived),
    archivedAt: requireNullableTimestamp(data.archivedAt),
    createdAt: requireTimestamp(data.createdAt),
    updatedAt: requireTimestamp(data.updatedAt),
  }) as ApiV1PortfolioDetailPayload;
}

function assertBusinessUuidArgument(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new ApiHttpError("invalid_request");
  if (value === NIL_UUID) throw new ApiHttpError("invalid_request");
  if (!apiUuidSchema.safeParse(value).success) {
    throw new ApiHttpError("invalid_request");
  }
}

/**
 * Read the delegated `/v1/portfolios/:portfolioid` payload through the accepted
 * Portfolio-1 database wrapper. Access is decided exclusively by the database.
 */
export async function readApiV1PortfolioDetail(
  client: ApiV1PortfolioDetailRpcClient,
  expectedOauthClientId: string,
  portfolioId: string,
): Promise<ApiV1PortfolioDetailPayload> {
  assertRpcClient(client);
  assertValidExpectedOauthClientId(expectedOauthClientId);
  assertBusinessUuidArgument(portfolioId);

  let result: unknown;
  try {
    result = await client.rpc(API_V1_GET_PORTFOLIO_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _portfolio_item_id: portfolioId,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toPortfolioDetailPayload(unwrapRpcResult(result), portfolioId);
}

// -----------------------------------------------------------------------------
// Portfolio Projects adapter
// -----------------------------------------------------------------------------

function validatePortfolioProjectsQuery(
  query: unknown,
): ApiV1PortfolioProjectsQuery {
  if (!isPlainObject(query)) throw new ApiHttpError("invalid_request");
  const keys = Object.keys(query);
  if (keys.length !== 3) throw new ApiHttpError("invalid_request");
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
    limit,
    offset,
    search: preservedSearch,
  }) as ApiV1PortfolioProjectsQuery;
}

function toPortfolioProjectItem(raw: unknown): ApiV1PortfolioProjectItem {
  if (!isPlainObject(raw)) throw new ApiHttpError("internal_error");
  assertExactKeys(raw, EXPECTED_PORTFOLIO_PROJECT_ITEM_KEYS);
  return Object.freeze({
    projectId: requireUuid(raw.projectId),
    workspaceId: requireUuid(raw.workspaceId),
    programId: requireNullableUuid(raw.programId),
    name: requireNonEmptyString(raw.name),
    status: requireNonEmptyString(raw.status),
    priority: requireNonEmptyString(raw.priority),
    projectStage: requireNullableNonEmptyString(raw.projectStage),
    deliveryModel: requireNullableNonEmptyString(raw.deliveryModel),
    startDate: requireNullableDateOnly(raw.startDate),
    targetEndDate: requireNullableDateOnly(raw.targetEndDate),
    updatedAt: requireTimestamp(raw.updatedAt),
  }) as ApiV1PortfolioProjectItem;
}

/**
 * Read the delegated `/v1/portfolios/:portfolioid/projects` payload through the
 * accepted Portfolio-2 database wrapper. Access is decided exclusively by the
 * database, and `projects.portfolio_item_id` remains the sole membership truth.
 */
export async function readApiV1PortfolioProjects(
  client: ApiV1PortfolioProjectsRpcClient,
  expectedOauthClientId: string,
  portfolioId: string,
  query: ApiV1PortfolioProjectsQuery,
): Promise<ApiV1PortfolioProjectsPayload> {
  assertRpcClient(client);
  assertValidExpectedOauthClientId(expectedOauthClientId);
  assertBusinessUuidArgument(portfolioId);

  const validated = validatePortfolioProjectsQuery(query);

  let result: unknown;
  try {
    result = await client.rpc(API_V1_LIST_PORTFOLIO_PROJECTS_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _portfolio_item_id: portfolioId,
      _limit: validated.limit,
      _offset: validated.offset,
      _search: validated.search,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  const { items: rawItems, pagination } = validatePagination(
    unwrapRpcResult(result),
    validated.limit,
    validated.offset,
  );

  const items: ApiV1PortfolioProjectItem[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const item = toPortfolioProjectItem(raw);
    if (seen.has(item.projectId)) throw new ApiHttpError("internal_error");
    seen.add(item.projectId);
    items.push(item);
  }

  return Object.freeze({
    items: Object.freeze(items) as ReadonlyArray<ApiV1PortfolioProjectItem>,
    pagination,
  }) as ApiV1PortfolioProjectsPayload;
}
