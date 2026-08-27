// KPI-1B — Explicit Project KPI collection read RPC adapter.
//
// This module calls exactly one accepted KPI-1A/KPI-1A-C1 database wrapper,
// `public.api_v1_list_project_kpis`, through a caller-supplied Supabase RPC
// client. The caller-supplied client is the trust boundary: the runtime must
// supply a client bound to the current bearer token. The SQL wrapper remains
// the sole authorization and protected-data boundary; no Project/KPI
// containment, membership, enablement or decryption logic is duplicated here.
//
// This module constructs no Supabase client, reads no environment variable,
// extracts no token, uses no service-role key, calls no `fetch`, reads no
// table, decrypts nothing, performs no route matching, performs no logging,
// schedules no timer, caches nothing, holds no mutable global state, and
// exposes no generic RPC executor.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";
import {
  API_V1_KPI_UPDATES_LIMIT_MAX,
  API_V1_KPI_UPDATES_LIMIT_MIN,
  encodeApiV1KpiUpdateCursor,
  isApiV1KpiUpdateDate,
} from "./routes/kpis.ts";
import type {
  ApiV1KpiUpdateCursor,
  ApiV1KpiUpdatesRouteQuery,
  ApiV1ProjectKpisRouteQuery,
} from "./routes/kpis.ts";

/** Exact database wrapper invoked by this adapter. */
const API_V1_LIST_PROJECT_KPIS_FUNCTION_NAME = "api_v1_list_project_kpis";

/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";
/** SQLSTATE invalid_parameter_value. */
const SQLSTATE_INVALID_PARAMETER_VALUE = "22023";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const LIMIT_MIN = 1;
const LIMIT_MAX = 100;
const OFFSET_MIN = 0;
const OFFSET_MAX = 10000;

/** Minimal structural RPC client contract. */
export interface ApiV1KpiReadRpcClient {
  rpc(functionName: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Exact external Project KPI representation (the accepted 20 fields). */
export interface ApiV1ProjectKpiItem {
  readonly kpiId: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string | null;
  readonly unit: string | null;
  readonly targetValue: number | null;
  readonly currentValue: number | null;
  readonly targetDirection: string;
  readonly sourceMode: string;
  readonly valueType: string;
  readonly cadence: string;
  readonly calculationKey: string | null;
  readonly formulaVersion: number | null;
  readonly completionMethod: string | null;
  readonly commentRequired: boolean;
  readonly actionPlanRequired: boolean;
  readonly autoSnapshotEnabled: boolean;
  readonly isArchived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiV1KpiPagination {
  readonly limit: number;
  readonly offset: number;
  readonly returned: number;
  readonly total: number;
}

export interface ApiV1ProjectKpisPayload {
  readonly items: ReadonlyArray<ApiV1ProjectKpiItem>;
  readonly pagination: ApiV1KpiPagination;
}

/** The exact accepted KPI-1A item projection. */
export const API_V1_PROJECT_KPI_ITEM_KEYS: ReadonlyArray<string> = Object
  .freeze([
    "kpiId",
    "projectId",
    "name",
    "description",
    "unit",
    "targetValue",
    "currentValue",
    "targetDirection",
    "sourceMode",
    "valueType",
    "cadence",
    "calculationKey",
    "formulaVersion",
    "completionMethod",
    "commentRequired",
    "actionPlanRequired",
    "autoSnapshotEnabled",
    "isArchived",
    "createdAt",
    "updatedAt",
  ]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlyArray<string>,
): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length) {
    throw new ApiHttpError("internal_error");
  }
  const allowed = new Set(expected);
  for (const k of keys) {
    if (!allowed.has(k)) throw new ApiHttpError("internal_error");
  }
  for (const k of expected) {
    if (!(k in value)) throw new ApiHttpError("internal_error");
  }
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

function isValidUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === NIL_UUID) return false;
  return apiUuidSchema.safeParse(value).success;
}

function requireExternalUuid(value: unknown): string {
  if (!isValidUuid(value)) throw new ApiHttpError("invalid_request");
  return value;
}

function requireServerUuid(value: unknown): string {
  if (!isValidUuid(value)) throw new ApiHttpError("internal_error");
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== "string") throw new ApiHttpError("internal_error");
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
  if (typeof value !== "string") throw new ApiHttpError("internal_error");
  return value;
}

function requireNullableNumber(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireNullableInteger(value: unknown): number | null {
  if (value === null) return null;
  if (!isSafeInteger(value)) throw new ApiHttpError("internal_error");
  return value;
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

/**
 * Map a wrapper error to the accepted external error taxonomy. Missing and
 * unauthorized Projects share one bounded `42501` failure in the wrapper.
 */
function mapWrapperError(error: unknown): never {
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

function requireRpcClient(client: unknown): ApiV1KpiReadRpcClient {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    throw new ApiHttpError("internal_error");
  }
  return client as ApiV1KpiReadRpcClient;
}

function unwrapRpcResult(result: unknown): unknown {
  if (!isPlainObject(result)) throw new ApiHttpError("internal_error");
  if (!("data" in result) || !("error" in result)) {
    throw new ApiHttpError("internal_error");
  }
  const error = result.error;
  if (error !== null && error !== undefined) mapWrapperError(error);
  if (error === undefined) throw new ApiHttpError("internal_error");
  return result.data;
}

function validateQuery(query: unknown): ApiV1ProjectKpisRouteQuery {
  if (!isPlainObject(query)) throw new ApiHttpError("invalid_request");
  const keys = Object.keys(query);
  if (keys.length !== 3) throw new ApiHttpError("invalid_request");
  for (const k of keys) {
    if (k !== "limit" && k !== "offset" && k !== "includeArchived") {
      throw new ApiHttpError("invalid_request");
    }
  }
  const { limit, offset, includeArchived } = query;
  if (!isSafeInteger(limit) || limit < LIMIT_MIN || limit > LIMIT_MAX) {
    throw new ApiHttpError("invalid_request");
  }
  if (!isSafeInteger(offset) || offset < OFFSET_MIN || offset > OFFSET_MAX) {
    throw new ApiHttpError("invalid_request");
  }
  if (typeof includeArchived !== "boolean") {
    throw new ApiHttpError("invalid_request");
  }
  return Object.freeze({
    limit,
    offset,
    includeArchived,
  }) as ApiV1ProjectKpisRouteQuery;
}

function toKpiItem(value: unknown, projectId: string): ApiV1ProjectKpiItem {
  if (!isPlainObject(value)) throw new ApiHttpError("internal_error");
  assertExactKeys(value, API_V1_PROJECT_KPI_ITEM_KEYS);

  const returnedProjectId = requireServerUuid(value.projectId);
  // The wrapper is Project-contained; any other Project is a server defect.
  if (returnedProjectId !== projectId) {
    throw new ApiHttpError("internal_error");
  }

  return Object.freeze({
    kpiId: requireServerUuid(value.kpiId),
    projectId: returnedProjectId,
    name: requireString(value.name),
    description: requireNullableString(value.description),
    unit: requireNullableString(value.unit),
    targetValue: requireNullableNumber(value.targetValue),
    currentValue: requireNullableNumber(value.currentValue),
    targetDirection: requireNonEmptyString(value.targetDirection),
    sourceMode: requireNonEmptyString(value.sourceMode),
    valueType: requireNonEmptyString(value.valueType),
    cadence: requireNonEmptyString(value.cadence),
    calculationKey: requireNullableString(value.calculationKey),
    formulaVersion: requireNullableInteger(value.formulaVersion),
    completionMethod: requireNullableString(value.completionMethod),
    commentRequired: requireBoolean(value.commentRequired),
    actionPlanRequired: requireBoolean(value.actionPlanRequired),
    autoSnapshotEnabled: requireBoolean(value.autoSnapshotEnabled),
    isArchived: requireBoolean(value.isArchived),
    createdAt: requireTimestamp(value.createdAt),
    updatedAt: requireTimestamp(value.updatedAt),
  }) as ApiV1ProjectKpiItem;
}

function validatePagination(
  data: unknown,
  limit: number,
  offset: number,
): {
  readonly items: ReadonlyArray<unknown>;
  readonly pagination: ApiV1KpiPagination;
} {
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
    }) as ApiV1KpiPagination,
  };
}

/**
 * Read one page of Project KPIs through the accepted KPI-1A wrapper. Access is
 * decided exclusively by the database.
 */
export async function readApiV1ProjectKpis(
  client: ApiV1KpiReadRpcClient,
  expectedOauthClientId: string,
  projectId: string,
  query: ApiV1ProjectKpisRouteQuery,
): Promise<ApiV1ProjectKpisPayload> {
  const rpcClient = requireRpcClient(client);
  assertValidExpectedOauthClientId(expectedOauthClientId);

  const validProjectId = requireExternalUuid(projectId);
  const validated = validateQuery(query);

  let result: unknown;
  try {
    result = await rpcClient.rpc(API_V1_LIST_PROJECT_KPIS_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _project_id: validProjectId,
      _limit: validated.limit,
      _offset: validated.offset,
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

  const items: ApiV1ProjectKpiItem[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const item = toKpiItem(raw, validProjectId);
    if (seen.has(item.kpiId)) throw new ApiHttpError("internal_error");
    seen.add(item.kpiId);
    items.push(item);
  }

  return Object.freeze({
    items: Object.freeze(items) as ReadonlyArray<ApiV1ProjectKpiItem>,
    pagination,
  }) as ApiV1ProjectKpisPayload;
}

// -----------------------------------------------------------------------------
// KPI-2B — Single-KPI detail read adapter.
//
// Calls exactly the accepted KPI-2A wrapper `public.api_v1_get_kpi` through the
// caller-supplied Supabase RPC client and reuses the accepted 20-field KPI
// representation and field validators declared above. No second KPI field
// schema, no Project authority inference, and no external `not_found`.
// -----------------------------------------------------------------------------

/** Exact database wrapper invoked by the detail adapter. */
const API_V1_GET_KPI_FUNCTION_NAME = "api_v1_get_kpi";

function toKpiDetail(
  value: unknown,
  requestedKpiId: string,
): ApiV1ProjectKpiItem {
  if (!isPlainObject(value)) throw new ApiHttpError("internal_error");
  assertExactKeys(value, API_V1_PROJECT_KPI_ITEM_KEYS);

  const returnedKpiId = requireServerUuid(value.kpiId);
  // The wrapper is asked for exactly one KPI; any other identity is a defect.
  if (returnedKpiId !== requestedKpiId) {
    throw new ApiHttpError("internal_error");
  }

  return Object.freeze({
    kpiId: returnedKpiId,
    projectId: requireServerUuid(value.projectId),
    name: requireString(value.name),
    description: requireNullableString(value.description),
    unit: requireNullableString(value.unit),
    targetValue: requireNullableNumber(value.targetValue),
    currentValue: requireNullableNumber(value.currentValue),
    targetDirection: requireNonEmptyString(value.targetDirection),
    sourceMode: requireNonEmptyString(value.sourceMode),
    valueType: requireNonEmptyString(value.valueType),
    cadence: requireNonEmptyString(value.cadence),
    calculationKey: requireNullableString(value.calculationKey),
    formulaVersion: requireNullableInteger(value.formulaVersion),
    completionMethod: requireNullableString(value.completionMethod),
    commentRequired: requireBoolean(value.commentRequired),
    actionPlanRequired: requireBoolean(value.actionPlanRequired),
    autoSnapshotEnabled: requireBoolean(value.autoSnapshotEnabled),
    isArchived: requireBoolean(value.isArchived),
    createdAt: requireTimestamp(value.createdAt),
    updatedAt: requireTimestamp(value.updatedAt),
  }) as ApiV1ProjectKpiItem;
}

/**
 * Read one KPI through the accepted KPI-2A wrapper. Access, containment and
 * decryption are decided exclusively by the database.
 */
export async function readApiV1Kpi(
  client: ApiV1KpiReadRpcClient,
  expectedOauthClientId: string,
  kpiId: string,
): Promise<ApiV1ProjectKpiItem> {
  const rpcClient = requireRpcClient(client);
  assertValidExpectedOauthClientId(expectedOauthClientId);

  const validKpiId = requireExternalUuid(kpiId);

  let result: unknown;
  try {
    result = await rpcClient.rpc(API_V1_GET_KPI_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _kpi_id: validKpiId,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toKpiDetail(unwrapRpcResult(result), validKpiId);
}

// -----------------------------------------------------------------------------
// KPI-3B — Protected KPI update-history read adapter.
//
// Calls exactly the accepted KPI-3A wrapper `public.api_v1_list_kpi_updates`
// through the caller-supplied Supabase RPC client. The three internal keyset
// fields returned by the wrapper are converted into one opaque external cursor
// and are never returned raw. No authorization, containment or decryption logic
// is duplicated here; there is no external `not_found`.
// -----------------------------------------------------------------------------

/** Exact database wrapper invoked by the KPI update-history adapter. */
const API_V1_LIST_KPI_UPDATES_FUNCTION_NAME = "api_v1_list_kpi_updates";

/** Exact external KPI update representation (the accepted seven fields). */
export interface ApiV1KpiUpdateItem {
  readonly kpiUpdateId: string;
  readonly kpiId: string;
  readonly value: number;
  readonly updateDate: string;
  readonly note: string | null;
  readonly authorId: string;
  readonly createdAt: string;
}

export interface ApiV1KpiUpdatesPayload {
  readonly items: ReadonlyArray<ApiV1KpiUpdateItem>;
  readonly nextCursor: string | null;
}

/** The exact accepted KPI-3A item projection. */
export const API_V1_KPI_UPDATE_ITEM_KEYS: ReadonlyArray<string> = Object.freeze([
  "kpiUpdateId",
  "kpiId",
  "value",
  "updateDate",
  "note",
  "authorId",
  "createdAt",
]);

/** The exact accepted KPI-3A envelope keys. */
export const API_V1_KPI_UPDATES_ENVELOPE_KEYS: ReadonlyArray<string> = Object
  .freeze([
    "items",
    "nextCursorUpdateDate",
    "nextCursorCreatedAt",
    "nextCursorId",
  ]);

function requireNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireServerUpdateDate(value: unknown): string {
  if (!isApiV1KpiUpdateDate(value)) throw new ApiHttpError("internal_error");
  return value;
}

function validateKpiUpdatesQuery(query: unknown): ApiV1KpiUpdatesRouteQuery {
  if (!isPlainObject(query)) throw new ApiHttpError("invalid_request");
  const keys = Object.keys(query);
  if (keys.length !== 2) throw new ApiHttpError("invalid_request");
  for (const k of keys) {
    if (k !== "limit" && k !== "cursor") {
      throw new ApiHttpError("invalid_request");
    }
  }
  const { limit, cursor } = query;
  if (
    !isSafeInteger(limit) ||
    limit < API_V1_KPI_UPDATES_LIMIT_MIN ||
    limit > API_V1_KPI_UPDATES_LIMIT_MAX
  ) {
    throw new ApiHttpError("invalid_request");
  }
  if (cursor === null) {
    return Object.freeze({ limit, cursor: null }) as ApiV1KpiUpdatesRouteQuery;
  }
  if (!isPlainObject(cursor)) throw new ApiHttpError("invalid_request");
  const cursorKeys = Object.keys(cursor);
  if (cursorKeys.length !== 3) throw new ApiHttpError("invalid_request");
  for (const k of cursorKeys) {
    if (k !== "updateDate" && k !== "createdAt" && k !== "id") {
      throw new ApiHttpError("invalid_request");
    }
  }
  if (!isApiV1KpiUpdateDate(cursor.updateDate)) {
    throw new ApiHttpError("invalid_request");
  }
  if (
    typeof cursor.createdAt !== "string" ||
    cursor.createdAt.trim().length === 0 ||
    !Number.isFinite(Date.parse(cursor.createdAt))
  ) {
    throw new ApiHttpError("invalid_request");
  }
  if (!isValidUuid(cursor.id)) throw new ApiHttpError("invalid_request");

  return Object.freeze({
    limit,
    cursor: Object.freeze({
      updateDate: cursor.updateDate,
      createdAt: cursor.createdAt,
      id: cursor.id,
    }) as ApiV1KpiUpdateCursor,
  }) as ApiV1KpiUpdatesRouteQuery;
}

function toKpiUpdateItem(
  value: unknown,
  requestedKpiId: string,
): ApiV1KpiUpdateItem {
  if (!isPlainObject(value)) throw new ApiHttpError("internal_error");
  assertExactKeys(value, API_V1_KPI_UPDATE_ITEM_KEYS);

  const returnedKpiId = requireServerUuid(value.kpiId);
  // The wrapper is KPI-contained; any other KPI identity is a server defect.
  if (returnedKpiId !== requestedKpiId) {
    throw new ApiHttpError("internal_error");
  }

  return Object.freeze({
    kpiUpdateId: requireServerUuid(value.kpiUpdateId),
    kpiId: returnedKpiId,
    value: requireNumber(value.value),
    updateDate: requireServerUpdateDate(value.updateDate),
    note: requireNullableString(value.note),
    authorId: requireServerUuid(value.authorId),
    createdAt: requireTimestamp(value.createdAt),
  }) as ApiV1KpiUpdateItem;
}

/**
 * Read one bounded page of KPI update history through the accepted KPI-3A
 * wrapper. Access, containment and decryption are decided exclusively by the
 * database.
 */
export async function readApiV1KpiUpdates(
  client: ApiV1KpiReadRpcClient,
  expectedOauthClientId: string,
  kpiId: string,
  query: ApiV1KpiUpdatesRouteQuery,
): Promise<ApiV1KpiUpdatesPayload> {
  const rpcClient = requireRpcClient(client);
  assertValidExpectedOauthClientId(expectedOauthClientId);

  const validKpiId = requireExternalUuid(kpiId);
  const validated = validateKpiUpdatesQuery(query);

  let result: unknown;
  try {
    result = await rpcClient.rpc(API_V1_LIST_KPI_UPDATES_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _kpi_id: validKpiId,
      _limit: validated.limit,
      _after_update_date: validated.cursor === null
        ? null
        : validated.cursor.updateDate,
      _after_created_at: validated.cursor === null
        ? null
        : validated.cursor.createdAt,
      _after_id: validated.cursor === null ? null : validated.cursor.id,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  const data = unwrapRpcResult(result);
  if (!isPlainObject(data)) throw new ApiHttpError("internal_error");
  assertExactKeys(data, API_V1_KPI_UPDATES_ENVELOPE_KEYS);

  const rawItems = data.items;
  if (!Array.isArray(rawItems)) throw new ApiHttpError("internal_error");

  const items: ApiV1KpiUpdateItem[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    const item = toKpiUpdateItem(raw, validKpiId);
    if (seen.has(item.kpiUpdateId)) throw new ApiHttpError("internal_error");
    seen.add(item.kpiUpdateId);
    items.push(item);
  }

  const rawUpdateDate = data.nextCursorUpdateDate;
  const rawCreatedAt = data.nextCursorCreatedAt;
  const rawId = data.nextCursorId;

  const nullCount = [rawUpdateDate, rawCreatedAt, rawId]
    .filter((v) => v === null).length;

  let nextCursor: string | null;
  if (nullCount === 3) {
    nextCursor = null;
  } else if (nullCount === 0) {
    nextCursor = encodeApiV1KpiUpdateCursor(
      Object.freeze({
        updateDate: requireServerUpdateDate(rawUpdateDate),
        createdAt: requireTimestamp(rawCreatedAt),
        id: requireServerUuid(rawId),
      }) as ApiV1KpiUpdateCursor,
    );
  } else {
    // A partial keyset triple is a server defect.
    throw new ApiHttpError("internal_error");
  }

  return Object.freeze({
    items: Object.freeze(items) as ReadonlyArray<ApiV1KpiUpdateItem>,
    nextCursor,
  }) as ApiV1KpiUpdatesPayload;
}
