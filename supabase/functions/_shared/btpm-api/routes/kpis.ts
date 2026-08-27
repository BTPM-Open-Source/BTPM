// KPI-1B — Pure route contract and strict parsers for the single accepted
// external Project KPI collection read:
//
//   GET /v1/projects/:projectid/kpis   → kpis.get   (capability kpis:read)
//
// This module MUST NOT read the environment, open network connections,
// construct Supabase clients, call RPCs, touch the database, register routes,
// handle HTTP requests, log, schedule timers, or hold any mutable global state.
// It follows the accepted nested Project/Portfolio read posture exactly; no
// generic Project-subresource matcher is introduced.

import { ApiHttpError } from "../http.ts";
import { apiUuidSchema } from "../schemas.ts";

export const KPI_PROJECT_COLLECTION_ROUTE = Object.freeze({
  id: "kpis.get",
  method: "GET",
  path: "/v1/projects/:projectid/kpis",
  operation: "read",
} as const);

const LIMIT_DEFAULT = 50;
const LIMIT_MIN = 1;
const LIMIT_MAX = 100;
const OFFSET_DEFAULT = 0;
const OFFSET_MIN = 0;
const OFFSET_MAX = 10000;

const DECIMAL_DIGITS_ONLY = /^[0-9]+$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// Reject separators, percent encoding, matrix parameters and any whitespace.
const FORBIDDEN_SEGMENT_CHARS = /[/\\?#%;]|\s/;

const PROJECT_PREFIX = "/v1/projects/";
const KPI_SUFFIX = "/kpis";

function invalid(): never {
  throw new ApiHttpError("invalid_request");
}

function isSafeInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isSafeInteger(value);
}

// -----------------------------------------------------------------------------
// Strict nested path parser — /v1/projects/{projectId}/kpis
// -----------------------------------------------------------------------------

export interface ApiV1ProjectKpisPath {
  readonly projectId: string;
}

/**
 * Exactly `/v1/projects/<non-nil UUID>/kpis`: exact lowercase structure, no
 * trailing slash, no extra segment, no whitespace, no matrix parameter, no
 * percent encoding, no normalization and no permissive decoding.
 */
export function parseApiV1ProjectKpisPath(
  pathname: string,
): ApiV1ProjectKpisPath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }

  if (!pathname.startsWith(PROJECT_PREFIX)) invalid();
  if (!pathname.endsWith(KPI_SUFFIX)) invalid();

  const remainder = pathname.slice(
    PROJECT_PREFIX.length,
    pathname.length - KPI_SUFFIX.length,
  );

  if (remainder.length === 0) invalid();
  if (FORBIDDEN_SEGMENT_CHARS.test(remainder)) invalid();
  if (remainder === NIL_UUID) invalid();
  if (remainder !== remainder.toLowerCase()) invalid();
  if (!apiUuidSchema.safeParse(remainder).success) invalid();

  return Object.freeze({ projectId: remainder }) as ApiV1ProjectKpisPath;
}

// -----------------------------------------------------------------------------
// Strict query parser
// -----------------------------------------------------------------------------

export interface ApiV1ProjectKpisRouteQuery {
  readonly limit: number;
  readonly offset: number;
  readonly includeArchived: boolean;
}

const KPI_ALLOWED_PARAM_NAMES: ReadonlySet<string> = new Set([
  "limit",
  "offset",
  "include_archived",
]);

function assertValidPercentEncoding(raw: string): void {
  try {
    decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    invalid();
  }
}

function assertNoDuplicateOrUnknownParams(params: URLSearchParams): void {
  for (const name of params.keys()) {
    if (!KPI_ALLOWED_PARAM_NAMES.has(name)) invalid();
    if (params.getAll(name).length > 1) invalid();
  }
}

/**
 * Decimal, non-negative, integral literals only: no sign, no decimal point, no
 * exponent notation, no whitespace and no empty value.
 */
function parseDecimalParam(
  raw: string | null,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (raw === null) return defaultValue;
  if (!DECIMAL_DIGITS_ONLY.test(raw)) invalid();
  const n = Number(raw);
  if (!isSafeInteger(n) || n < min || n > max) invalid();
  return n;
}

/**
 * `include_archived` accepts only the literal strings "true" and "false"; an
 * absent parameter means `false`. No other spelling is coerced.
 */
function parseIncludeArchivedParam(raw: string | null): boolean {
  if (raw === null) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  invalid();
}

/**
 * Strict query parser. An empty query string is valid and yields the canonical
 * defaults 50 / 0 / false. Returns a fully materialized immutable object.
 */
export function parseApiV1ProjectKpisQuery(
  rawSearch: string,
): ApiV1ProjectKpisRouteQuery {
  if (typeof rawSearch !== "string") {
    throw new ApiHttpError("internal_error");
  }

  if (rawSearch.includes("#")) invalid();

  if (rawSearch === "") {
    return Object.freeze({
      limit: LIMIT_DEFAULT,
      offset: OFFSET_DEFAULT,
      includeArchived: false,
    }) as ApiV1ProjectKpisRouteQuery;
  }

  if (!rawSearch.startsWith("?")) invalid();

  assertValidPercentEncoding(rawSearch.slice(1));

  const params = new URLSearchParams(rawSearch);
  assertNoDuplicateOrUnknownParams(params);

  const limit = parseDecimalParam(
    params.get("limit"),
    LIMIT_DEFAULT,
    LIMIT_MIN,
    LIMIT_MAX,
  );
  const offset = parseDecimalParam(
    params.get("offset"),
    OFFSET_DEFAULT,
    OFFSET_MIN,
    OFFSET_MAX,
  );
  const includeArchived = parseIncludeArchivedParam(
    params.get("include_archived"),
  );

  return Object.freeze({
    limit,
    offset,
    includeArchived,
  }) as ApiV1ProjectKpisRouteQuery;
}

// -----------------------------------------------------------------------------
// KPI-2B — Single-KPI detail read contract
//
//   GET /v1/kpis/:kpiid   → kpis.get_by_id   (capability kpis:read)
//
// The detail route accepts no query parameters; the router rejects any
// non-empty query string as `invalid_request` before authentication. No generic
// KPI route dispatcher is introduced.
// -----------------------------------------------------------------------------

export const KPI_DETAIL_ROUTE = Object.freeze({
  id: "kpis.get_by_id",
  method: "GET",
  path: "/v1/kpis/:kpiid",
  operation: "read",
} as const);

const KPI_DETAIL_PREFIX = "/v1/kpis/";

export interface ApiV1KpiDetailPath {
  readonly kpiId: string;
}

/**
 * Exactly `/v1/kpis/<non-nil UUID>`: no missing ID, no nil UUID, no trailing
 * slash, no additional segment, no whitespace, no matrix parameter, no percent
 * encoding, no slash/backslash/query/hash character, and the same lowercase
 * UUID casing semantics already accepted for the KPI collection path.
 */
export function parseApiV1KpiDetailPath(
  pathname: string,
): ApiV1KpiDetailPath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }

  if (!pathname.startsWith(KPI_DETAIL_PREFIX)) invalid();

  const remainder = pathname.slice(KPI_DETAIL_PREFIX.length);

  if (remainder.length === 0) invalid();
  if (FORBIDDEN_SEGMENT_CHARS.test(remainder)) invalid();
  if (remainder === NIL_UUID) invalid();
  if (remainder !== remainder.toLowerCase()) invalid();
  if (!apiUuidSchema.safeParse(remainder).success) invalid();

  return Object.freeze({ kpiId: remainder }) as ApiV1KpiDetailPath;
}

// -----------------------------------------------------------------------------
// KPI-3B — Protected KPI update-history read contract
//
//   GET /v1/kpis/:kpiid/updates   → kpis.updates.get   (capability kpis:read)
//
// The three internal keyset fields accepted by the KPI-3A wrapper are never
// exposed as HTTP parameters: clients see exactly one opaque `cursor`. No
// generic KPI subresource dispatcher is introduced.
// -----------------------------------------------------------------------------

export const KPI_UPDATES_ROUTE = Object.freeze({
  id: "kpis.updates.get",
  method: "GET",
  path: "/v1/kpis/:kpiid/updates",
  operation: "read",
} as const);

const KPI_UPDATES_SUFFIX = "/updates";

export interface ApiV1KpiUpdatesPath {
  readonly kpiId: string;
}

/**
 * Exactly `/v1/kpis/<non-nil UUID>/updates` with the same strict KPI UUID/path
 * posture already accepted for `parseApiV1KpiDetailPath`: no nil UUID, no
 * uppercase, no whitespace, no percent encoding, no matrix parameter, no
 * backslash, no query/hash material, no trailing slash and no extra segment.
 */
export function parseApiV1KpiUpdatesPath(
  pathname: string,
): ApiV1KpiUpdatesPath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }

  if (!pathname.startsWith(KPI_DETAIL_PREFIX)) invalid();
  if (!pathname.endsWith(KPI_UPDATES_SUFFIX)) invalid();

  const remainder = pathname.slice(
    KPI_DETAIL_PREFIX.length,
    pathname.length - KPI_UPDATES_SUFFIX.length,
  );

  if (remainder.length === 0) invalid();
  if (FORBIDDEN_SEGMENT_CHARS.test(remainder)) invalid();
  if (remainder === NIL_UUID) invalid();
  if (remainder !== remainder.toLowerCase()) invalid();
  if (!apiUuidSchema.safeParse(remainder).success) invalid();

  return Object.freeze({ kpiId: remainder }) as ApiV1KpiUpdatesPath;
}

// -----------------------------------------------------------------------------
// Dedicated opaque KPI update-history cursor (v1)
//
// The cursor carries ONLY the three keyset values accepted by the KPI-3A
// wrapper. It carries no Tenant, Organization, Workspace, Project, KPI, user,
// client, capability or authorization data, and is neither signed nor stored.
// -----------------------------------------------------------------------------

export interface ApiV1KpiUpdateCursor {
  readonly updateDate: string;
  readonly createdAt: string;
  readonly id: string;
}

const KPI_UPDATE_CURSOR_VERSION = 1;
const KPI_UPDATE_CURSOR_MAX_ENCODED_LENGTH = 512;
const KPI_UPDATE_BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const KPI_UPDATE_CURSOR_KEYS: ReadonlyArray<string> = Object.freeze([
  "v",
  "updateDate",
  "createdAt",
  "id",
]);
const KPI_UPDATE_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function isKpiPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strict proleptic Gregorian YYYY-MM-DD calendar validation. */
export function isApiV1KpiUpdateDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!KPI_UPDATE_DATE_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const asDate = new Date(Date.UTC(year, month - 1, day));
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  );
}

function kpiUpdateToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function kpiUpdateFromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encode an internal keyset position produced by the KPI-3A wrapper into the
 * external opaque cursor. Malformed internal data is a server defect.
 */
export function encodeApiV1KpiUpdateCursor(
  cursor: ApiV1KpiUpdateCursor,
): string {
  if (!isKpiPlainObject(cursor)) {
    throw new ApiHttpError("internal_error");
  }
  const updateDate = cursor.updateDate;
  const createdAt = cursor.createdAt;
  const id = cursor.id;

  if (!isApiV1KpiUpdateDate(updateDate)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof createdAt !== "string" || createdAt.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new ApiHttpError("internal_error");
  }
  if (
    typeof id !== "string" ||
    id === NIL_UUID ||
    !apiUuidSchema.safeParse(id).success
  ) {
    throw new ApiHttpError("internal_error");
  }

  const json = JSON.stringify({
    v: KPI_UPDATE_CURSOR_VERSION,
    updateDate,
    createdAt,
    id,
  });
  const encoded = kpiUpdateToBase64Url(new TextEncoder().encode(json));
  if (encoded.length > KPI_UPDATE_CURSOR_MAX_ENCODED_LENGTH) {
    throw new ApiHttpError("internal_error");
  }
  return encoded;
}

/** Decode an externally supplied opaque KPI update-history cursor. */
export function decodeApiV1KpiUpdateCursor(
  raw: string,
): ApiV1KpiUpdateCursor {
  if (typeof raw !== "string") invalid();
  if (raw.length === 0 || raw.length > KPI_UPDATE_CURSOR_MAX_ENCODED_LENGTH) {
    invalid();
  }
  if (!KPI_UPDATE_BASE64URL_PATTERN.test(raw)) invalid();

  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder().decode(kpiUpdateFromBase64Url(raw)),
    );
  } catch {
    invalid();
  }

  if (!isKpiPlainObject(decoded)) invalid();
  const keys = Object.keys(decoded);
  if (keys.length !== KPI_UPDATE_CURSOR_KEYS.length) invalid();
  for (const key of keys) {
    if (!KPI_UPDATE_CURSOR_KEYS.includes(key)) invalid();
  }
  if (decoded.v !== KPI_UPDATE_CURSOR_VERSION) invalid();

  const updateDate = decoded.updateDate;
  const createdAt = decoded.createdAt;
  const id = decoded.id;

  if (!isApiV1KpiUpdateDate(updateDate)) invalid();
  if (typeof createdAt !== "string" || createdAt.trim().length === 0) invalid();
  if (!Number.isFinite(Date.parse(createdAt))) invalid();
  if (typeof id !== "string") invalid();
  if (id === NIL_UUID) invalid();
  if (!apiUuidSchema.safeParse(id).success) invalid();

  return Object.freeze({
    updateDate,
    createdAt,
    id,
  }) as ApiV1KpiUpdateCursor;
}

// -----------------------------------------------------------------------------
// Strict KPI update-history query parser — only `limit` and `cursor`
// -----------------------------------------------------------------------------

export interface ApiV1KpiUpdatesRouteQuery {
  readonly limit: number;
  readonly cursor: ApiV1KpiUpdateCursor | null;
}

export const API_V1_KPI_UPDATES_LIMIT_DEFAULT = 50;
export const API_V1_KPI_UPDATES_LIMIT_MIN = 1;
export const API_V1_KPI_UPDATES_LIMIT_MAX = 100;

const KPI_UPDATES_ALLOWED_PARAM_NAMES: ReadonlySet<string> = new Set([
  "limit",
  "cursor",
]);

/**
 * Strict, closed query parser. An empty query string yields the canonical
 * default limit and a null cursor. No normalization, trimming or repair.
 */
export function parseApiV1KpiUpdatesQuery(
  rawSearch: string,
): ApiV1KpiUpdatesRouteQuery {
  if (typeof rawSearch !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (rawSearch.includes("#")) invalid();

  if (rawSearch === "") {
    return Object.freeze({
      limit: API_V1_KPI_UPDATES_LIMIT_DEFAULT,
      cursor: null,
    }) as ApiV1KpiUpdatesRouteQuery;
  }

  if (rawSearch === "?") invalid();
  if (!rawSearch.startsWith("?")) invalid();

  assertValidPercentEncoding(rawSearch.slice(1));

  const params = new URLSearchParams(rawSearch);
  for (const name of params.keys()) {
    if (!KPI_UPDATES_ALLOWED_PARAM_NAMES.has(name)) invalid();
    if (params.getAll(name).length > 1) invalid();
  }

  const rawLimit = params.get("limit");
  let limit = API_V1_KPI_UPDATES_LIMIT_DEFAULT;
  if (rawLimit !== null) {
    if (!DECIMAL_DIGITS_ONLY.test(rawLimit)) invalid();
    const parsed = Number(rawLimit);
    if (
      !isSafeInteger(parsed) ||
      parsed < API_V1_KPI_UPDATES_LIMIT_MIN ||
      parsed > API_V1_KPI_UPDATES_LIMIT_MAX
    ) {
      invalid();
    }
    limit = parsed;
  }

  const rawCursor = params.get("cursor");
  const cursor = rawCursor === null
    ? null
    : decodeApiV1KpiUpdateCursor(rawCursor);

  return Object.freeze({ limit, cursor }) as ApiV1KpiUpdatesRouteQuery;
}

// =============================================================================
// KPI-4B — POST /v1/projects/:projectid/kpis  (kpis.create)
//
// Exactly one new external Project KPI definition create surface. The POST and
// the accepted KPI-1B GET deliberately share the same pathname and are
// distinguished only by HTTP method; the accepted strict Project-KPI path
// parser (`parseApiV1ProjectKpisPath`) remains the sole path authority and no
// generic Project-subresource dispatcher is introduced.
//
// The create route accepts NO query parameters: the router rejects any
// non-empty query string as `invalid_request` before authentication.
//
// Cross-field KPI business rules (for example sourceMode/calculationKey
// compatibility) are deliberately NOT duplicated here: they remain canonical
// database/PMG constraints owned by `public.apply_kpi_definition_create`.
// =============================================================================

export const KPI_CREATE_ROUTE = Object.freeze({
  id: "kpis.create",
  method: "POST",
  path: "/v1/projects/:projectid/kpis",
  operation: "mutation",
} as const);

export type ApiV1KpiTargetDirection =
  | "increase"
  | "decrease"
  | "maintain"
  | "target_exact";

export type ApiV1KpiSourceMode = "manual" | "automatic";

export type ApiV1KpiValueType = "percent" | "number" | "currency" | "text";

export type ApiV1KpiCadence =
  | "manual_only"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly";

export type ApiV1KpiCompletionMethod = "task_count" | "duration_weighted";

export const API_V1_KPI_TARGET_DIRECTIONS: readonly ApiV1KpiTargetDirection[] =
  Object.freeze(["increase", "decrease", "maintain", "target_exact"] as const);

export const API_V1_KPI_SOURCE_MODES: readonly ApiV1KpiSourceMode[] = Object
  .freeze(["manual", "automatic"] as const);

export const API_V1_KPI_VALUE_TYPES: readonly ApiV1KpiValueType[] = Object
  .freeze(["percent", "number", "currency", "text"] as const);

export const API_V1_KPI_CADENCES: readonly ApiV1KpiCadence[] = Object.freeze([
  "manual_only",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const);

export const API_V1_KPI_COMPLETION_METHODS:
  readonly ApiV1KpiCompletionMethod[] = Object.freeze([
    "task_count",
    "duration_weighted",
  ] as const);

export interface ApiV1CreateKpiBody {
  readonly name: string;
  readonly description: string | null;
  readonly unit: string | null;
  readonly targetValue: number | null;
  readonly targetDirection: ApiV1KpiTargetDirection;
  readonly sourceMode: ApiV1KpiSourceMode;
  readonly valueType: ApiV1KpiValueType;
  readonly cadence: ApiV1KpiCadence;
  readonly calculationKey: string | null;
  readonly formulaVersion: number | null;
  readonly completionMethod: ApiV1KpiCompletionMethod | null;
  readonly commentRequired: boolean;
  readonly actionPlanRequired: boolean;
  readonly autoSnapshotEnabled: boolean;
}

/**
 * The exact closed external body vocabulary. Scope identity (`projectId`,
 * `workspaceId`, `organizationId`, `tenantId`), derived/system state
 * (`currentValue`, `isArchived`, `createdBy`), snake_case aliases and any
 * unknown key are all rejected. `projectId` comes only from the validated
 * route path.
 */
const KPI_CREATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "name",
  "description",
  "unit",
  "targetValue",
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
]);

const PG_INT32_MIN = -2147483648;
const PG_INT32_MAX = 2147483647;

/** PostgreSQL `btrim(text)` equivalent: ordinary spaces only. */
function btrimSpaces(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charAt(start) === " ") start += 1;
  while (end > start && value.charAt(end - 1) === " ") end -= 1;
  return value.slice(start, end);
}

function kpiRawValue(
  input: Record<string, unknown>,
  key: string,
): unknown {
  return Object.prototype.hasOwnProperty.call(input, key)
    ? input[key]
    : undefined;
}

function parseKpiRequiredCanonicalName(raw: unknown): string {
  if (typeof raw !== "string") invalid();
  const canonical = btrimSpaces(raw);
  if (canonical.length === 0) invalid();
  return canonical;
}

function parseKpiOptionalCanonicalText(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") invalid();
  const canonical = btrimSpaces(raw);
  return canonical.length === 0 ? null : canonical;
}

function parseKpiOptionalFiniteNumber(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) invalid();
  return raw;
}

function parseKpiDefaultedEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== "string") invalid();
  if (btrimSpaces(raw).length === 0) return fallback;
  if (!(allowed as readonly string[]).includes(raw)) invalid();
  return raw as T;
}

function parseKpiOptionalPreservedString(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") invalid();
  return raw;
}

function parseKpiOptionalInteger(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "number") invalid();
  if (!Number.isInteger(raw)) invalid();
  if (raw < PG_INT32_MIN || raw > PG_INT32_MAX) invalid();
  return raw;
}

function parseKpiOptionalExactEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
): T | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") invalid();
  if (!(allowed as readonly string[]).includes(raw)) invalid();
  return raw as T;
}

function parseKpiDefaultedBoolean(raw: unknown): boolean {
  if (raw === undefined || raw === null) return false;
  if (typeof raw !== "boolean") invalid();
  return raw;
}

function isKpiCreatePlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strict closed-schema parser for the external Project KPI create body. It
 * returns a fully materialized immutable body so canonical idempotency hashing
 * is deterministic across omitted-versus-defaulted requests.
 */
export function parseApiV1CreateKpiBody(input: unknown): ApiV1CreateKpiBody {
  if (!isKpiCreatePlainObject(input)) invalid();

  for (const key of Object.keys(input)) {
    if (!KPI_CREATE_ALLOWED_KEYS.has(key)) invalid();
  }

  return Object.freeze({
    name: parseKpiRequiredCanonicalName(kpiRawValue(input, "name")),
    description: parseKpiOptionalCanonicalText(
      kpiRawValue(input, "description"),
    ),
    unit: parseKpiOptionalCanonicalText(kpiRawValue(input, "unit")),
    targetValue: parseKpiOptionalFiniteNumber(kpiRawValue(input, "targetValue")),
    targetDirection: parseKpiDefaultedEnum(
      kpiRawValue(input, "targetDirection"),
      API_V1_KPI_TARGET_DIRECTIONS,
      "target_exact",
    ),
    sourceMode: parseKpiDefaultedEnum(
      kpiRawValue(input, "sourceMode"),
      API_V1_KPI_SOURCE_MODES,
      "manual",
    ),
    valueType: parseKpiDefaultedEnum(
      kpiRawValue(input, "valueType"),
      API_V1_KPI_VALUE_TYPES,
      "number",
    ),
    cadence: parseKpiDefaultedEnum(
      kpiRawValue(input, "cadence"),
      API_V1_KPI_CADENCES,
      "manual_only",
    ),
    calculationKey: parseKpiOptionalPreservedString(
      kpiRawValue(input, "calculationKey"),
    ),
    formulaVersion: parseKpiOptionalInteger(
      kpiRawValue(input, "formulaVersion"),
    ),
    completionMethod: parseKpiOptionalExactEnum(
      kpiRawValue(input, "completionMethod"),
      API_V1_KPI_COMPLETION_METHODS,
    ),
    commentRequired: parseKpiDefaultedBoolean(
      kpiRawValue(input, "commentRequired"),
    ),
    actionPlanRequired: parseKpiDefaultedBoolean(
      kpiRawValue(input, "actionPlanRequired"),
    ),
    autoSnapshotEnabled: parseKpiDefaultedBoolean(
      kpiRawValue(input, "autoSnapshotEnabled"),
    ),
  }) as ApiV1CreateKpiBody;
}

/**
 * Deterministic canonical API-F idempotency payload for the KPI create command.
 * The Project identity lives in the URL, so it is folded in explicitly together
 * with the entire fully materialized canonical body. No user ID, Tenant,
 * Organization, Workspace, OAuth identity, request ID, correlation ID or bearer
 * token is ever included.
 */
export function buildApiV1CreateKpiIdempotencyPayload(
  projectId: string,
  body: ApiV1CreateKpiBody,
): Record<string, unknown> {
  return Object.freeze({
    projectId,
    name: body.name,
    description: body.description,
    unit: body.unit,
    targetValue: body.targetValue,
    targetDirection: body.targetDirection,
    sourceMode: body.sourceMode,
    valueType: body.valueType,
    cadence: body.cadence,
    calculationKey: body.calculationKey,
    formulaVersion: body.formulaVersion,
    completionMethod: body.completionMethod,
    commentRequired: body.commentRequired,
    actionPlanRequired: body.actionPlanRequired,
    autoSnapshotEnabled: body.autoSnapshotEnabled,
  });
}

// =============================================================================
// KPI-5B — PATCH /v1/kpis/:kpiid  (kpis.update)
//
// Exactly one new external KPI definition update surface. The PATCH and the
// accepted KPI-2B GET deliberately share the same pathname and are
// distinguished only by HTTP method; `parseApiV1KpiDetailPath` remains the sole
// KPI-ID path authority and no second KPI UUID grammar is introduced.
//
// The update route accepts NO query parameters: the router rejects any
// non-empty query string as `invalid_request` before authentication.
//
// Cross-field KPI business rules (for example sourceMode/calculationKey
// compatibility) are deliberately NOT duplicated here: they remain canonical
// database/PMG constraints owned by `public.apply_kpi_definition_update`.
// =============================================================================

export const KPI_UPDATE_ROUTE = Object.freeze({
  id: "kpis.update",
  method: "PATCH",
  path: "/v1/kpis/:kpiid",
  operation: "mutation",
} as const);

export interface ApiV1UpdateKpiBody {
  readonly expectedUpdatedAt: string;

  readonly name: string | null;
  readonly description: string | null;
  readonly unit: string | null;
  readonly targetValue: number | null;
  readonly targetDirection: ApiV1KpiTargetDirection | null;
  readonly sourceMode: ApiV1KpiSourceMode | null;
  readonly valueType: ApiV1KpiValueType | null;
  readonly cadence: ApiV1KpiCadence | null;
  readonly calculationKey: string | null;
  readonly formulaVersion: number | null;
  readonly completionMethod: ApiV1KpiCompletionMethod | null;
  readonly commentRequired: boolean | null;
  readonly actionPlanRequired: boolean | null;
  readonly autoSnapshotEnabled: boolean | null;

  readonly setName: boolean;
  readonly setDescription: boolean;
  readonly setUnit: boolean;
  readonly setTargetValue: boolean;
  readonly setTargetDirection: boolean;
  readonly setSourceMode: boolean;
  readonly setValueType: boolean;
  readonly setCadence: boolean;
  readonly setCalculationKey: boolean;
  readonly setFormulaVersion: boolean;
  readonly setCompletionMethod: boolean;
  readonly setCommentRequired: boolean;
  readonly setActionPlanRequired: boolean;
  readonly setAutoSnapshotEnabled: boolean;
}

/**
 * The exact closed external update vocabulary. Scope identity (`kpiId`,
 * `projectId`, `workspaceId`, `organizationId`, `tenantId`), derived/system
 * state (`currentValue`, `isArchived`, `createdBy`), every internal `_set_*`
 * flag, provenance/idempotency metadata, snake_case aliases and any unknown key
 * are all rejected. The KPI ID comes only from the validated route path.
 */
const KPI_UPDATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "expectedUpdatedAt",
  "name",
  "description",
  "unit",
  "targetValue",
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
]);

const KPI_TIMESTAMPTZ_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * Required timezone-aware PostgreSQL-compatible timestamptz. The supplied value
 * is preserved verbatim: there is no normalization and no automatic refresh.
 */
function parseKpiExpectedUpdatedAt(raw: unknown): string {
  if (typeof raw !== "string") invalid();
  const match = KPI_TIMESTAMPTZ_PATTERN.exec(raw);
  if (!match) invalid();

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (month < 1 || month > 12) invalid();
  if (day < 1 || day > 31) invalid();
  if (hour > 23 || minute > 59 || second > 59) invalid();

  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    invalid();
  }

  const offset = match[8];
  if (offset !== "Z" && offset !== "z") {
    const sign = offset.charAt(0);
    if (sign !== "+" && sign !== "-") invalid();
    const digits = offset.slice(1).replace(":", "");
    const offsetHours = Number(digits.slice(0, 2));
    const offsetMinutes = digits.length > 2 ? Number(digits.slice(2)) : 0;
    if (!Number.isInteger(offsetHours) || offsetHours > 15) invalid();
    if (!Number.isInteger(offsetMinutes) || offsetMinutes > 59) invalid();
  }

  return raw;
}

function isKpiFieldPresent(
  input: Record<string, unknown>,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

/** Present-only required text: string, ordinary-space btrim, never blank. */
function parseKpiPresentRequiredText(raw: unknown): string {
  if (typeof raw !== "string") invalid();
  const canonical = btrimSpaces(raw);
  if (canonical.length === 0) invalid();
  return canonical;
}

/** Present-only clearable text: explicit null or blank clears the field. */
function parseKpiPresentClearableText(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string") invalid();
  const canonical = btrimSpaces(raw);
  return canonical.length === 0 ? null : canonical;
}

function parseKpiPresentNullableFiniteNumber(raw: unknown): number | null {
  if (raw === null) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) invalid();
  return raw;
}

function parseKpiPresentNullableInteger(raw: unknown): number | null {
  if (raw === null) return null;
  if (typeof raw !== "number") invalid();
  if (!Number.isInteger(raw)) invalid();
  if (raw < PG_INT32_MIN || raw > PG_INT32_MAX) invalid();
  return raw;
}

/** Present-only strict enum: null, blank and unknown values are invalid. */
function parseKpiPresentRequiredEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
): T {
  if (typeof raw !== "string") invalid();
  if (!(allowed as readonly string[]).includes(raw)) invalid();
  return raw as T;
}

/** Present-only clearable enum: null/blank clears; otherwise exact vocabulary. */
function parseKpiPresentClearableEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
): T | null {
  if (raw === null) return null;
  if (typeof raw !== "string") invalid();
  if (btrimSpaces(raw).length === 0) return null;
  if (!(allowed as readonly string[]).includes(raw)) invalid();
  return raw as T;
}

/** Present-only strict boolean: explicit null is invalid. */
function parseKpiPresentRequiredBoolean(raw: unknown): boolean {
  if (typeof raw !== "boolean") invalid();
  return raw;
}

/**
 * Strict closed-schema parser for the external KPI definition update body.
 * Presence of an editable key derives its internal `_set_*` flag; clients never
 * send `_set_*` flags. The returned body is fully materialized so canonical
 * idempotency hashing distinguishes "field absent" from "field cleared".
 */
export function parseApiV1UpdateKpiBody(input: unknown): ApiV1UpdateKpiBody {
  if (!isKpiCreatePlainObject(input)) invalid();

  for (const key of Object.keys(input)) {
    if (!KPI_UPDATE_ALLOWED_KEYS.has(key)) invalid();
  }

  if (!isKpiFieldPresent(input, "expectedUpdatedAt")) invalid();
  const expectedUpdatedAt = parseKpiExpectedUpdatedAt(input.expectedUpdatedAt);

  const setName = isKpiFieldPresent(input, "name");
  const setDescription = isKpiFieldPresent(input, "description");
  const setUnit = isKpiFieldPresent(input, "unit");
  const setTargetValue = isKpiFieldPresent(input, "targetValue");
  const setTargetDirection = isKpiFieldPresent(input, "targetDirection");
  const setSourceMode = isKpiFieldPresent(input, "sourceMode");
  const setValueType = isKpiFieldPresent(input, "valueType");
  const setCadence = isKpiFieldPresent(input, "cadence");
  const setCalculationKey = isKpiFieldPresent(input, "calculationKey");
  const setFormulaVersion = isKpiFieldPresent(input, "formulaVersion");
  const setCompletionMethod = isKpiFieldPresent(input, "completionMethod");
  const setCommentRequired = isKpiFieldPresent(input, "commentRequired");
  const setActionPlanRequired = isKpiFieldPresent(input, "actionPlanRequired");
  const setAutoSnapshotEnabled = isKpiFieldPresent(
    input,
    "autoSnapshotEnabled",
  );

  return Object.freeze({
    expectedUpdatedAt,

    name: setName ? parseKpiPresentRequiredText(input.name) : null,
    description: setDescription
      ? parseKpiPresentClearableText(input.description)
      : null,
    unit: setUnit ? parseKpiPresentClearableText(input.unit) : null,
    targetValue: setTargetValue
      ? parseKpiPresentNullableFiniteNumber(input.targetValue)
      : null,
    targetDirection: setTargetDirection
      ? parseKpiPresentRequiredEnum(
        input.targetDirection,
        API_V1_KPI_TARGET_DIRECTIONS,
      )
      : null,
    sourceMode: setSourceMode
      ? parseKpiPresentRequiredEnum(input.sourceMode, API_V1_KPI_SOURCE_MODES)
      : null,
    valueType: setValueType
      ? parseKpiPresentRequiredEnum(input.valueType, API_V1_KPI_VALUE_TYPES)
      : null,
    cadence: setCadence
      ? parseKpiPresentRequiredEnum(input.cadence, API_V1_KPI_CADENCES)
      : null,
    calculationKey: setCalculationKey
      ? parseKpiPresentClearableText(input.calculationKey)
      : null,
    formulaVersion: setFormulaVersion
      ? parseKpiPresentNullableInteger(input.formulaVersion)
      : null,
    completionMethod: setCompletionMethod
      ? parseKpiPresentClearableEnum(
        input.completionMethod,
        API_V1_KPI_COMPLETION_METHODS,
      )
      : null,
    commentRequired: setCommentRequired
      ? parseKpiPresentRequiredBoolean(input.commentRequired)
      : null,
    actionPlanRequired: setActionPlanRequired
      ? parseKpiPresentRequiredBoolean(input.actionPlanRequired)
      : null,
    autoSnapshotEnabled: setAutoSnapshotEnabled
      ? parseKpiPresentRequiredBoolean(input.autoSnapshotEnabled)
      : null,

    setName,
    setDescription,
    setUnit,
    setTargetValue,
    setTargetDirection,
    setSourceMode,
    setValueType,
    setCadence,
    setCalculationKey,
    setFormulaVersion,
    setCompletionMethod,
    setCommentRequired,
    setActionPlanRequired,
    setAutoSnapshotEnabled,
  }) as ApiV1UpdateKpiBody;
}

/**
 * Deterministic canonical API-F idempotency payload for the KPI update command.
 * The KPI identity lives in the URL, so it is folded in explicitly together
 * with the concurrency token, all fourteen normalized values and all fourteen
 * presence flags — so "absent" and "explicitly cleared to null" hash
 * differently. No user ID, Tenant, Organization, Workspace, OAuth identity,
 * request ID, correlation ID, idempotency key, payload hash, source channel or
 * bearer token is ever included.
 */
export function buildApiV1UpdateKpiIdempotencyPayload(
  kpiId: string,
  body: ApiV1UpdateKpiBody,
): Record<string, unknown> {
  return Object.freeze({
    kpiId,
    expectedUpdatedAt: body.expectedUpdatedAt,

    setName: body.setName,
    name: body.name,
    setDescription: body.setDescription,
    description: body.description,
    setUnit: body.setUnit,
    unit: body.unit,
    setTargetValue: body.setTargetValue,
    targetValue: body.targetValue,
    setTargetDirection: body.setTargetDirection,
    targetDirection: body.targetDirection,
    setSourceMode: body.setSourceMode,
    sourceMode: body.sourceMode,
    setValueType: body.setValueType,
    valueType: body.valueType,
    setCadence: body.setCadence,
    cadence: body.cadence,
    setCalculationKey: body.setCalculationKey,
    calculationKey: body.calculationKey,
    setFormulaVersion: body.setFormulaVersion,
    formulaVersion: body.formulaVersion,
    setCompletionMethod: body.setCompletionMethod,
    completionMethod: body.completionMethod,
    setCommentRequired: body.setCommentRequired,
    commentRequired: body.commentRequired,
    setActionPlanRequired: body.setActionPlanRequired,
    actionPlanRequired: body.actionPlanRequired,
    setAutoSnapshotEnabled: body.setAutoSnapshotEnabled,
    autoSnapshotEnabled: body.autoSnapshotEnabled,
  });
}

// =============================================================================
// KPI-6B — POST /v1/kpis/:kpiid/updates  (kpis.updates.append)
//
// Exactly one new external KPI update-history append surface. The POST and the
// accepted KPI-3B GET deliberately share the same pathname and are distinguished
// only by HTTP method; `parseApiV1KpiUpdatesPath` remains the sole path
// authority and no generic KPI subresource dispatcher is introduced.
//
// The append route accepts NO query parameters: the router rejects any
// non-empty query string as `invalid_request` before authentication.
//
// Canonical KPI operational business rules (comment/action-plan requirements,
// cadence windows, duplicate-date handling, snapshot semantics) are deliberately
// NOT duplicated here: they remain owned by `public.append_kpi_update`.
// =============================================================================

export const KPI_UPDATE_APPEND_ROUTE = Object.freeze({
  id: "kpis.updates.append",
  method: "POST",
  path: "/v1/kpis/:kpiid/updates",
  operation: "mutation",
} as const);

export interface ApiV1AppendKpiUpdateBody {
  readonly value: number;
  readonly updateDate: string;
  readonly note: string | null;
}

const KPI_UPDATE_APPEND_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "value",
  "updateDate",
  "note",
]);

/** Required finite JSON number. Strings, booleans and null are rejected. */
function parseKpiRequiredFiniteNumber(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) invalid();
  return raw;
}

/**
 * Required calendar day in strict `YYYY-MM-DD` form. No timestamp, no timezone
 * offset, no relative keyword and no locale form is accepted. The database
 * remains the authority for calendar validity and cadence rules.
 */
function parseKpiRequiredUpdateDate(raw: unknown): string {
  if (!isApiV1KpiUpdateDate(raw)) invalid();
  return raw;
}

/**
 * Optional protected note, canonicalized to match the accepted PMG behavior
 * `nullif(btrim(coalesce(_note, '')), '')`: `undefined`, `null`, empty and
 * ordinary-space-only strings all normalize to `null`, and outer ordinary
 * spaces are removed. Interior spaces, tabs and newlines are preserved so the
 * canonical API-F payload matches the database note exactly.
 */
function parseKpiOptionalNote(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") invalid();
  const canonical = btrimSpaces(raw);
  return canonical.length === 0 ? null : canonical;
}


/**
 * Strict closed-schema parser for the external KPI update-history append body.
 * It returns a fully materialized immutable body so canonical idempotency
 * hashing is deterministic across omitted-versus-explicitly-null notes.
 */
export function parseApiV1AppendKpiUpdateBody(
  input: unknown,
): ApiV1AppendKpiUpdateBody {
  if (!isKpiCreatePlainObject(input)) invalid();

  for (const key of Object.keys(input)) {
    if (!KPI_UPDATE_APPEND_ALLOWED_KEYS.has(key)) invalid();
  }

  return Object.freeze({
    value: parseKpiRequiredFiniteNumber(kpiRawValue(input, "value")),
    updateDate: parseKpiRequiredUpdateDate(kpiRawValue(input, "updateDate")),
    note: parseKpiOptionalNote(kpiRawValue(input, "note")),
  }) as ApiV1AppendKpiUpdateBody;
}

/**
 * Deterministic canonical API-F idempotency payload for the KPI update-history
 * append command. The KPI identity lives in the URL, so it is folded in
 * explicitly together with the entire fully materialized canonical body. No user
 * ID, Tenant, Organization, Workspace, Project, OAuth identity, request ID,
 * correlation ID, idempotency key or bearer token is ever included.
 */
export function buildApiV1AppendKpiUpdateIdempotencyPayload(
  kpiId: string,
  body: ApiV1AppendKpiUpdateBody,
): Record<string, unknown> {
  return Object.freeze({
    kpiId,
    value: body.value,
    updateDate: body.updateDate,
    note: body.note,
  });
}
