// API-N.2B — Pure route contracts, query parser and strict detail path parser
// for the two Program reads:
//
//   GET /v1/programs             → programs.get
//   GET /v1/programs/:programid  → programs.get_by_id
//
// This module MUST NOT read the environment, open network connections,
// construct Supabase clients, touch the database, register routes,
// handle HTTP requests, log, schedule timers, or hold any mutable
// global state. It follows the accepted `/v1/projects` collection posture
// and the accepted Project-detail strict-path posture exactly; no generic
// cross-domain resource-ID parser is introduced.

import { ApiHttpError } from "../http.ts";
import { apiUuidSchema } from "../schemas.ts";

export const PROGRAMS_ROUTE = Object.freeze({
  id: "programs.get",
  method: "GET",
  path: "/v1/programs",
  operation: "read",
} as const);

export const PROGRAM_DETAIL_ROUTE = Object.freeze({
  id: "programs.get_by_id",
  method: "GET",
  path: "/v1/programs/:programid",
  operation: "read",
} as const);

// -----------------------------------------------------------------------------
// Collection query
// -----------------------------------------------------------------------------

export interface ApiV1ProgramsQuery {
  readonly workspaceId: string;
  readonly limit: number;
  readonly offset: number;
  readonly search: string | null;
}

const LIMIT_DEFAULT = 50;
const LIMIT_MIN = 1;
const LIMIT_MAX = 100;
const OFFSET_DEFAULT = 0;
const OFFSET_MIN = 0;
const OFFSET_MAX = 10000;
const SEARCH_MAX_LENGTH = 100;

/**
 * `workspace_id` is the ONLY external Workspace key. The camelCase
 * `workspaceId` alias is deliberately absent and therefore rejected as an
 * unknown parameter.
 */
const ALLOWED_PARAM_NAMES: ReadonlySet<string> = new Set([
  "workspace_id",
  "limit",
  "offset",
  "search",
]);

const DECIMAL_DIGITS_ONLY = /^[0-9]+$/;

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function isSafeInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isSafeInteger(value);
}

function parseDecimalParam(
  raw: string | null,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (raw === null) {
    return defaultValue;
  }
  if (!DECIMAL_DIGITS_ONLY.test(raw)) {
    throw new ApiHttpError("invalid_request");
  }
  const n = Number(raw);
  if (!isSafeInteger(n) || n < min || n > max) {
    throw new ApiHttpError("invalid_request");
  }
  return n;
}

function parseSearchParam(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > SEARCH_MAX_LENGTH) {
    throw new ApiHttpError("invalid_request");
  }
  return trimmed;
}

function parseWorkspaceIdParam(raw: string | null): string {
  if (raw === null) {
    throw new ApiHttpError("invalid_request");
  }
  if (raw.length === 0) {
    throw new ApiHttpError("invalid_request");
  }
  if (raw === NIL_UUID) {
    throw new ApiHttpError("invalid_request");
  }
  if (!apiUuidSchema.safeParse(raw).success) {
    throw new ApiHttpError("invalid_request");
  }
  return raw;
}

function assertValidPercentEncoding(raw: string): void {
  try {
    decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    throw new ApiHttpError("invalid_request");
  }
}

export function parseApiV1ProgramsQuery(
  rawSearch: string,
): ApiV1ProgramsQuery {
  if (typeof rawSearch !== "string") {
    throw new ApiHttpError("internal_error");
  }

  // workspace_id is required, so an absent/empty raw query is never valid.
  if (rawSearch === "" || !rawSearch.startsWith("?")) {
    throw new ApiHttpError("invalid_request");
  }

  if (rawSearch.includes("#")) {
    throw new ApiHttpError("invalid_request");
  }

  assertValidPercentEncoding(rawSearch.slice(1));

  const params = new URLSearchParams(rawSearch);

  for (const name of params.keys()) {
    if (!ALLOWED_PARAM_NAMES.has(name)) {
      throw new ApiHttpError("invalid_request");
    }
    if (params.getAll(name).length > 1) {
      throw new ApiHttpError("invalid_request");
    }
  }

  const workspaceId = parseWorkspaceIdParam(params.get("workspace_id"));
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
  const search = parseSearchParam(params.get("search"));

  return Object.freeze({
    workspaceId,
    limit,
    offset,
    search,
  }) as ApiV1ProgramsQuery;
}

// -----------------------------------------------------------------------------
// Detail path
// -----------------------------------------------------------------------------

export interface ApiV1ProgramDetailPath {
  readonly programId: string;
}

const PROGRAM_DETAIL_PREFIX = "/v1/programs/";

// Reject separators, encoding, matrix parameters and any whitespace.
const FORBIDDEN_SEGMENT_CHARS = /[/\\?#%;]|\s/;

export function parseApiV1ProgramDetailPath(
  pathname: string,
): ApiV1ProgramDetailPath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }

  if (!pathname.startsWith(PROGRAM_DETAIL_PREFIX)) {
    throw new ApiHttpError("invalid_request");
  }

  const remainder = pathname.slice(PROGRAM_DETAIL_PREFIX.length);

  if (remainder.length === 0) {
    throw new ApiHttpError("invalid_request");
  }

  if (FORBIDDEN_SEGMENT_CHARS.test(remainder)) {
    throw new ApiHttpError("invalid_request");
  }

  if (remainder === NIL_UUID) {
    throw new ApiHttpError("invalid_request");
  }

  if (!apiUuidSchema.safeParse(remainder).success) {
    throw new ApiHttpError("invalid_request");
  }

  return Object.freeze({
    programId: remainder,
  }) as ApiV1ProgramDetailPath;
}

// =============================================================================
// API-N.9A — POST /v1/programs (programs.create)
//
// Exactly one new external Program command surface. Strict closed-schema body,
// fully normalized BEFORE execution-context hashing so the API-F canonical
// payload is deterministic. No status, archive, Organization, Tenant or
// protected Program field is reachable here.
// =============================================================================

export const PROGRAM_CREATE_ROUTE = Object.freeze({
  id: "programs.create",
  method: "POST",
  path: "/v1/programs",
  operation: "mutation",
} as const);

const PROGRAM_NAME_MAX_LENGTH = 200;

export interface ApiV1CreateProgramBody {
  readonly workspaceId: string;
  readonly name: string;
  readonly description: string | null;
}

const PROGRAM_CREATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "workspaceId",
  "name",
  "description",
]);

function programInvalid(): never {
  throw new ApiHttpError("invalid_request");
}

function isProgramPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Exact behavioural equivalent of PostgreSQL `btrim(text)` with the default
 * character set: ordinary U+0020 space characters are removed from BOTH ends
 * and nothing else, matching the canonical `public.apply_program_create`
 * normalization.
 */
export function canonicalizeProgramText(raw: string): string {
  let start = 0;
  let end = raw.length;
  while (start < end && raw.charCodeAt(start) === 0x20) start += 1;
  while (end > start && raw.charCodeAt(end - 1) === 0x20) end -= 1;
  return raw.slice(start, end);
}

function parseProgramWorkspaceId(raw: unknown): string {
  if (typeof raw !== "string") programInvalid();
  if (raw === NIL_UUID) programInvalid();
  if (!apiUuidSchema.safeParse(raw).success) programInvalid();
  return raw;
}

function parseProgramName(raw: unknown): string {
  if (typeof raw !== "string") programInvalid();
  if (raw.length > PROGRAM_NAME_MAX_LENGTH) programInvalid();
  const canonical = canonicalizeProgramText(raw);
  if (canonical.length === 0) programInvalid();
  if (canonical.length > PROGRAM_NAME_MAX_LENGTH) programInvalid();
  return canonical;
}

/**
 * Canonical Program description normalization: absent or explicit null becomes
 * null, and a supplied string that normalizes to empty also becomes null.
 */
function parseProgramDescription(
  raw: unknown,
  present: boolean,
): string | null {
  if (!present || raw === null) return null;
  if (typeof raw !== "string") programInvalid();
  const canonical = canonicalizeProgramText(raw);
  return canonical.length === 0 ? null : canonical;
}

/**
 * Strict, closed-schema parser for the external Program create body.
 * `workspaceId` and `name` are required; `description` is optional and
 * normalizes to `null`. Any other key is rejected.
 */
export function parseApiV1CreateProgramBody(
  input: unknown,
): ApiV1CreateProgramBody {
  if (!isProgramPlainObject(input)) programInvalid();

  for (const key of Object.keys(input)) {
    if (!PROGRAM_CREATE_ALLOWED_KEYS.has(key)) programInvalid();
  }

  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);

  if (!has("workspaceId") || !has("name")) programInvalid();

  const workspaceId = parseProgramWorkspaceId(input.workspaceId);
  const name = parseProgramName(input.name);
  const description = parseProgramDescription(
    input.description,
    has("description"),
  );

  return Object.freeze({
    workspaceId,
    name,
    description,
  }) as ApiV1CreateProgramBody;
}

// =============================================================================
// API-N.9B — PATCH /v1/programs/{programId} (programs.update)
//
// Exactly one new external Program update surface. Strict closed-schema body,
// fully normalized BEFORE execution-context hashing so the API-F canonical
// payload is deterministic. No archive, Organization, Tenant, Workspace-move or
// protected Program field beyond the canonical name/status/description trio is
// reachable here, and no separate Program transition semantics are introduced.
// =============================================================================

export const PROGRAM_UPDATE_ROUTE = Object.freeze({
  id: "programs.update",
  method: "PATCH",
  path: "/v1/programs/:programid",
  operation: "mutation",
} as const);

export interface ApiV1ProgramUpdatePath {
  readonly programId: string;
}

/** PATCH /v1/programs/<non-nil UUID> — exact shape only. */
export function parseApiV1ProgramUpdatePath(
  pathname: string,
): ApiV1ProgramUpdatePath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (!pathname.startsWith(PROGRAM_DETAIL_PREFIX)) programInvalid();
  const remainder = pathname.slice(PROGRAM_DETAIL_PREFIX.length);
  if (remainder.length === 0) programInvalid();
  if (FORBIDDEN_SEGMENT_CHARS.test(remainder)) programInvalid();
  if (remainder === NIL_UUID) programInvalid();
  if (!apiUuidSchema.safeParse(remainder).success) programInvalid();
  return Object.freeze({ programId: remainder }) as ApiV1ProgramUpdatePath;
}

/** Canonical current `public.pm_status` vocabulary. */
export type ApiV1ProgramStatus =
  | "planned"
  | "active"
  | "completed"
  | "on_hold"
  | "cancelled";

const PROGRAM_STATUSES: ReadonlySet<string> = new Set([
  "planned",
  "active",
  "completed",
  "on_hold",
  "cancelled",
]);

export interface ApiV1UpdateProgramBody {
  readonly expectedUpdatedAt: string;
  readonly name: string | null;
  readonly status: ApiV1ProgramStatus | null;
  readonly description: string | null;
  readonly setDescription: boolean;
}

const PROGRAM_UPDATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "expectedUpdatedAt",
  "name",
  "status",
  "description",
]);

const PROGRAM_UPDATE_TIMESTAMPTZ_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}(?::?\d{2})?)$/;

/** Required timezone-aware PostgreSQL-compatible timestamp, preserved verbatim. */
export function parseProgramExpectedUpdatedAt(raw: unknown): string {
  if (typeof raw !== "string") programInvalid();
  const match = PROGRAM_UPDATE_TIMESTAMPTZ_PATTERN.exec(raw);
  if (!match) programInvalid();

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (month < 1 || month > 12) programInvalid();
  if (day < 1 || day > 31) programInvalid();
  if (hour > 23 || minute > 59 || second > 59) programInvalid();

  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    programInvalid();
  }

  const offset = match[8];
  if (offset !== "Z" && offset !== "z") {
    const sign = offset.slice(0, 1);
    const rest = offset.slice(1).replace(":", "");
    const offHour = Number(rest.slice(0, 2));
    const offMinute = rest.length > 2 ? Number(rest.slice(2, 4)) : 0;
    if (sign !== "+" && sign !== "-") programInvalid();
    if (!Number.isFinite(offHour) || offHour > 23) programInvalid();
    if (!Number.isFinite(offMinute) || offMinute > 59) programInvalid();
  }

  return raw;
}

function parseUpdateProgramStatus(raw: unknown): ApiV1ProgramStatus {
  if (typeof raw !== "string" || !PROGRAM_STATUSES.has(raw)) programInvalid();
  return raw as ApiV1ProgramStatus;
}

/**
 * Strict, closed-schema parser for the external Program update body.
 * `expectedUpdatedAt` is required; `name`, `status` and `description` are
 * optional. `name` and `status` are non-clearable, while `description`
 * preserves absent-versus-explicit-clear presence semantics.
 */
export function parseApiV1UpdateProgramBody(
  input: unknown,
): ApiV1UpdateProgramBody {
  if (!isProgramPlainObject(input)) programInvalid();

  for (const key of Object.keys(input)) {
    if (!PROGRAM_UPDATE_ALLOWED_KEYS.has(key)) programInvalid();
  }

  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  if (!has("expectedUpdatedAt")) programInvalid();

  const expectedUpdatedAt = parseProgramExpectedUpdatedAt(
    input.expectedUpdatedAt,
  );

  // `name` is optional and NEVER clearable: explicit null is invalid.
  const name = has("name") ? parseProgramName(input.name) : null;
  const status = has("status") ? parseUpdateProgramStatus(input.status) : null;

  const setDescription = has("description");
  const description = setDescription
    ? parseProgramDescription(input.description, true)
    : null;

  return Object.freeze({
    expectedUpdatedAt,
    name,
    status,
    description,
    setDescription,
  }) as ApiV1UpdateProgramBody;
}

/**
 * Deterministic canonical API-F idempotency payload for the Program update
 * command. The Program identity lives in the URL, so it is folded in
 * explicitly. `setDescription` contributes independently so an absent
 * description can never hash identically to an explicit clear. No execution
 * metadata, OAuth/user identity or Tenant/Organization/Workspace metadata is
 * included.
 */
export function buildApiV1UpdateProgramIdempotencyPayload(
  programId: string,
  body: ApiV1UpdateProgramBody,
): Record<string, unknown> {
  return Object.freeze({
    programId,
    expectedUpdatedAt: body.expectedUpdatedAt,
    name: body.name,
    status: body.status,
    setDescription: body.setDescription,
    description: body.description,
  });
}
