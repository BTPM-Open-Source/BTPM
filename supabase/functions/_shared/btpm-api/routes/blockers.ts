// API-K.8 — Pure route contracts, dynamic-path parser and strict
// closed-schema body parsers for the two external Blocker mutations:
//
//   POST  /v1/blockers
//   PATCH /v1/blockers/:blockerid
//
// This module mirrors the accepted API-K.7 Risk contract module exactly. It is
// deliberately a SEPARATE, explicit Blocker surface: no generic mutation,
// CRUD or dispatch abstraction is introduced.
//
// This module MUST NOT read the environment, read headers, read request
// bodies, open network connections, construct Supabase clients, call RPCs,
// touch the database, hash payloads, register routes, handle HTTP requests,
// log, schedule timers, or hold any mutable global state.

import { ApiHttpError } from "../http.ts";
import { apiUuidSchema } from "../schemas.ts";

export const BLOCKER_CREATE_ROUTE = Object.freeze({
  id: "blockers.create",
  method: "POST",
  path: "/v1/blockers",
  operation: "mutation",
} as const);

export const BLOCKER_UPDATE_ROUTE = Object.freeze({
  id: "blockers.update",
  method: "PATCH",
  path: "/v1/blockers/:blockerid",
  operation: "mutation",
} as const);

// -----------------------------------------------------------------------------
// Shared vocabulary
// -----------------------------------------------------------------------------

export type ApiV1BlockerTargetType = "project" | "phase" | "task";
export type ApiV1BlockerSeverity = "low" | "medium" | "high" | "critical";
export type ApiV1BlockerStatus = "open" | "in_progress" | "resolved";

export const API_V1_BLOCKER_TARGET_TYPES: readonly ApiV1BlockerTargetType[] =
  Object.freeze(["project", "phase", "task"] as const);

export const API_V1_BLOCKER_SEVERITIES: readonly ApiV1BlockerSeverity[] =
  Object.freeze(["low", "medium", "high", "critical"] as const);

/** Canonical Blocker lifecycle exposed externally. */
export const API_V1_BLOCKER_STATUSES: readonly ApiV1BlockerStatus[] = Object
  .freeze(["open", "in_progress", "resolved"] as const);

const TITLE_MAX_LENGTH = 500;
const DESCRIPTION_MAX_LENGTH = 4000;

function invalid(): never {
  throw new ApiHttpError("invalid_request");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// -----------------------------------------------------------------------------
// Dynamic path parser — PATCH /v1/blockers/:blockerid
// -----------------------------------------------------------------------------

export interface ApiV1BlockerUpdatePath {
  readonly blockerId: string;
}

const BLOCKER_UPDATE_PREFIX = "/v1/blockers/";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// Reject separators, percent encoding, matrix parameters and any whitespace.
const FORBIDDEN_SEGMENT_CHARS = /[/\\?#%;]|\s/;

export function parseApiV1BlockerUpdatePath(
  pathname: string,
): ApiV1BlockerUpdatePath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (!pathname.startsWith(BLOCKER_UPDATE_PREFIX)) invalid();

  const remainder = pathname.slice(BLOCKER_UPDATE_PREFIX.length);
  if (remainder.length === 0) invalid();
  if (FORBIDDEN_SEGMENT_CHARS.test(remainder)) invalid();
  if (remainder === NIL_UUID) invalid();
  if (!apiUuidSchema.safeParse(remainder).success) invalid();

  return Object.freeze({ blockerId: remainder }) as ApiV1BlockerUpdatePath;
}

// -----------------------------------------------------------------------------
// Shared field validators
// -----------------------------------------------------------------------------

function parseTargetType(raw: unknown): ApiV1BlockerTargetType {
  if (raw !== "project" && raw !== "phase" && raw !== "task") invalid();
  return raw;
}

function parseUuid(raw: unknown): string {
  if (typeof raw !== "string") invalid();
  if (raw === NIL_UUID) invalid();
  if (!apiUuidSchema.safeParse(raw).success) invalid();
  return raw;
}

function parseTitle(raw: unknown): string {
  if (typeof raw !== "string") invalid();
  if (raw.length > TITLE_MAX_LENGTH) invalid();
  if (raw.trim().length === 0) invalid();
  // The supplied business narrative is preserved exactly.
  return raw;
}

function parseNullableText(
  raw: unknown,
  present: boolean,
  maxLength: number,
): string | null {
  if (!present || raw === null) return null;
  if (typeof raw !== "string") invalid();
  if (raw.length > maxLength) invalid();
  return raw;
}

function parseRequiredNullableText(
  raw: unknown,
  maxLength: number,
): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string") invalid();
  if (raw.length > maxLength) invalid();
  return raw;
}

function requireSeverity(raw: unknown): ApiV1BlockerSeverity {
  if (
    raw !== "low" && raw !== "medium" && raw !== "high" && raw !== "critical"
  ) {
    invalid();
  }
  return raw;
}

function parseSeverity(raw: unknown, present: boolean): ApiV1BlockerSeverity {
  if (!present) return "medium";
  return requireSeverity(raw);
}

function requireStatus(raw: unknown): ApiV1BlockerStatus {
  if (raw !== "open" && raw !== "in_progress" && raw !== "resolved") invalid();
  return raw;
}

function parseStatus(raw: unknown, present: boolean): ApiV1BlockerStatus {
  if (!present) return "open";
  return requireStatus(raw);
}

// -----------------------------------------------------------------------------
// Timezone-aware timestamp validation (RFC3339 + PostgreSQL compatible)
// -----------------------------------------------------------------------------

const TIMESTAMPTZ_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}(?::?\d{2})?)$/;

function parseExpectedUpdatedAt(raw: unknown): string {
  if (typeof raw !== "string") invalid();
  const match = TIMESTAMPTZ_PATTERN.exec(raw);
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
    const sign = offset.slice(0, 1);
    const rest = offset.slice(1).replace(":", "");
    const offHour = Number(rest.slice(0, 2));
    const offMinute = rest.length > 2 ? Number(rest.slice(2, 4)) : 0;
    if (sign !== "+" && sign !== "-") invalid();
    if (!Number.isFinite(offHour) || offHour > 23) invalid();
    if (!Number.isFinite(offMinute) || offMinute > 59) invalid();
  }

  // The validated timestamp string is preserved verbatim for the wrapper.
  return raw;
}

// -----------------------------------------------------------------------------
// CREATE body — POST /v1/blockers
// -----------------------------------------------------------------------------

export interface ApiV1CreateBlockerBody {
  readonly targetType: ApiV1BlockerTargetType;
  readonly targetId: string;
  readonly title: string;
  readonly description: string | null;
  readonly severity: ApiV1BlockerSeverity;
  readonly status: ApiV1BlockerStatus;
}

const CREATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "targetType",
  "targetId",
  "title",
  "description",
  "severity",
  "status",
]);

/**
 * Strict, closed-schema parser for the external Blocker create body. The
 * result is fully normalized (defaults resolved) BEFORE execution-context
 * hashing so the canonical idempotency payload is deterministic.
 */
export function parseApiV1CreateBlockerBody(
  input: unknown,
): ApiV1CreateBlockerBody {
  if (!isPlainObject(input)) invalid();

  for (const key of Object.keys(input)) {
    if (!CREATE_ALLOWED_KEYS.has(key)) invalid();
  }

  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);

  const targetType = parseTargetType(input.targetType);
  const targetId = parseUuid(input.targetId);
  const title = parseTitle(input.title);
  const description = parseNullableText(
    input.description,
    has("description"),
    DESCRIPTION_MAX_LENGTH,
  );
  const severity = parseSeverity(input.severity, has("severity"));
  const status = parseStatus(input.status, has("status"));

  return Object.freeze({
    targetType,
    targetId,
    title,
    description,
    severity,
    status,
  }) as ApiV1CreateBlockerBody;
}

// -----------------------------------------------------------------------------
// UPDATE body — PATCH /v1/blockers/:blockerid
// -----------------------------------------------------------------------------

export interface ApiV1UpdateBlockerBody {
  readonly expectedUpdatedAt: string;
  readonly title: string;
  readonly description: string | null;
  readonly severity: ApiV1BlockerSeverity;
  readonly status: ApiV1BlockerStatus;
}

const UPDATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "expectedUpdatedAt",
  "title",
  "description",
  "severity",
  "status",
]);

/**
 * Strict, closed-schema parser for the external Blocker update body. All five
 * keys are required: for API-K.8 the body is the COMPLETE scalar desired
 * state. No partial-field filling from the database is performed here — the
 * canonical command remains the sole read/decrypt/update mechanism, and the
 * Blocker identity comes only from the validated path.
 */
export function parseApiV1UpdateBlockerBody(
  input: unknown,
): ApiV1UpdateBlockerBody {
  if (!isPlainObject(input)) invalid();

  for (const key of Object.keys(input)) {
    if (!UPDATE_ALLOWED_KEYS.has(key)) invalid();
  }
  for (const key of UPDATE_ALLOWED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) invalid();
  }

  const expectedUpdatedAt = parseExpectedUpdatedAt(input.expectedUpdatedAt);
  const title = parseTitle(input.title);
  const description = parseRequiredNullableText(
    input.description,
    DESCRIPTION_MAX_LENGTH,
  );
  const severity = requireSeverity(input.severity);
  const status = requireStatus(input.status);

  return Object.freeze({
    expectedUpdatedAt,
    title,
    description,
    severity,
    status,
  }) as ApiV1UpdateBlockerBody;
}

/**
 * Canonical idempotency payload for a Blocker update. The Blocker identity
 * lives in the URL, not the body, so it MUST be folded into the hashed
 * payload.
 */
export function buildApiV1UpdateBlockerIdempotencyPayload(
  blockerId: string,
  body: ApiV1UpdateBlockerBody,
): Readonly<{ blockerId: string } & ApiV1UpdateBlockerBody> {
  if (typeof blockerId !== "string" || blockerId.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (!isPlainObject(body)) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    blockerId,
    expectedUpdatedAt: body.expectedUpdatedAt,
    title: body.title,
    description: body.description,
    severity: body.severity,
    status: body.status,
  });
}

// =============================================================================
// API-M.CP.2C2 — Blocker HTTP read foundation (NOT yet live)
//
// Pure route contracts, strict path/query parsers and one narrow opaque
// collection cursor codec for the two frozen Blocker reads:
//
//   GET /v1/projects/{projectId}/blockers   (blockers.get)
//   GET /v1/blockers/{blockerId}            (blockers.get_by_id)
//
// These definitions are deliberately NOT registered in the live router and are
// NOT advertised through /v1/capabilities in this step.
// =============================================================================

export const BLOCKER_PROJECT_COLLECTION_ROUTE = Object.freeze({
  id: "blockers.get",
  method: "GET",
  path: "/v1/projects/:projectid/blockers",
  operation: "read",
} as const);

export const BLOCKER_DETAIL_ROUTE = Object.freeze({
  id: "blockers.get_by_id",
  method: "GET",
  path: "/v1/blockers/:blockerid",
  operation: "read",
} as const);

// -----------------------------------------------------------------------------
// Path parsers
// -----------------------------------------------------------------------------

export interface ApiV1ProjectBlockersPath {
  readonly projectId: string;
}

export interface ApiV1BlockerDetailPath {
  readonly blockerId: string;
}

const BLOCKER_COLLECTION_PREFIX = "/v1/projects/";
const BLOCKER_COLLECTION_SUFFIX = "/blockers";

function parseStrictUuidSegment(segment: string): string {
  if (segment.length === 0) invalid();
  if (FORBIDDEN_SEGMENT_CHARS.test(segment)) invalid();
  if (segment === NIL_UUID) invalid();
  if (!apiUuidSchema.safeParse(segment).success) invalid();
  return segment;
}

/** Strict parser for `GET /v1/projects/:projectid/blockers`. */
export function parseApiV1ProjectBlockersPath(
  pathname: string,
): ApiV1ProjectBlockersPath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (!pathname.startsWith(BLOCKER_COLLECTION_PREFIX)) invalid();
  if (!pathname.endsWith(BLOCKER_COLLECTION_SUFFIX)) invalid();

  const middle = pathname.slice(
    BLOCKER_COLLECTION_PREFIX.length,
    pathname.length - BLOCKER_COLLECTION_SUFFIX.length,
  );

  return Object.freeze({
    projectId: parseStrictUuidSegment(middle),
  }) as ApiV1ProjectBlockersPath;
}

/** Strict parser for `GET /v1/blockers/:blockerid`. */
export function parseApiV1BlockerDetailPath(
  pathname: string,
): ApiV1BlockerDetailPath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (!pathname.startsWith(BLOCKER_UPDATE_PREFIX)) invalid();

  const remainder = pathname.slice(BLOCKER_UPDATE_PREFIX.length);
  return Object.freeze({
    blockerId: parseStrictUuidSegment(remainder),
  }) as ApiV1BlockerDetailPath;
}

// -----------------------------------------------------------------------------
// Opaque collection cursor (v1)
//
// The cursor carries ONLY the keyset position accepted by the CP.2C1 SQL
// wrapper. It carries no Tenant, Organization, Workspace, Project, capability
// or authorization data and is neither signed nor stored.
// -----------------------------------------------------------------------------

export interface ApiV1BlockerCursor {
  readonly createdAt: string;
  readonly id: string;
}

const BLOCKER_CURSOR_VERSION = 1;
const BLOCKER_CURSOR_MAX_ENCODED_LENGTH = 512;
const BLOCKER_BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const BLOCKER_CURSOR_KEYS: ReadonlyArray<string> = Object.freeze([
  "v",
  "createdAt",
  "id",
]);

function blockerToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function blockerFromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encode an internal keyset position produced by the SQL wrapper into the
 * external opaque cursor. A malformed internal pair is a server defect.
 */
export function encodeApiV1BlockerCursor(cursor: ApiV1BlockerCursor): string {
  if (!isPlainObject(cursor)) {
    throw new ApiHttpError("internal_error");
  }
  const createdAt = cursor.createdAt;
  const id = cursor.id;
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

  const json = JSON.stringify({ v: BLOCKER_CURSOR_VERSION, createdAt, id });
  return blockerToBase64Url(new TextEncoder().encode(json));
}

/** Decode an externally supplied opaque cursor. */
export function decodeApiV1BlockerCursor(raw: string): ApiV1BlockerCursor {
  if (typeof raw !== "string") invalid();
  if (raw.length === 0 || raw.length > BLOCKER_CURSOR_MAX_ENCODED_LENGTH) {
    invalid();
  }
  if (!BLOCKER_BASE64URL_PATTERN.test(raw)) invalid();

  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder().decode(blockerFromBase64Url(raw)),
    );
  } catch {
    invalid();
  }

  if (!isPlainObject(decoded)) invalid();
  const keys = Object.keys(decoded);
  if (keys.length !== BLOCKER_CURSOR_KEYS.length) invalid();
  for (const key of keys) {
    if (!BLOCKER_CURSOR_KEYS.includes(key)) invalid();
  }
  if (decoded.v !== BLOCKER_CURSOR_VERSION) invalid();

  const createdAt = decoded.createdAt;
  const id = decoded.id;
  if (typeof createdAt !== "string" || createdAt.trim().length === 0) invalid();
  if (!Number.isFinite(Date.parse(createdAt))) invalid();
  if (typeof id !== "string") invalid();
  if (id === NIL_UUID) invalid();
  if (!apiUuidSchema.safeParse(id).success) invalid();

  return Object.freeze({ createdAt, id }) as ApiV1BlockerCursor;
}

// -----------------------------------------------------------------------------
// Collection query parser
// -----------------------------------------------------------------------------

export interface ApiV1ProjectBlockersQuery {
  readonly limit: number;
  readonly cursor: ApiV1BlockerCursor | null;
}

export const API_V1_BLOCKER_LIMIT_DEFAULT = 100;
export const API_V1_BLOCKER_LIMIT_MIN = 1;
export const API_V1_BLOCKER_LIMIT_MAX = 500;

const BLOCKER_QUERY_ALLOWED_PARAMS: ReadonlySet<string> = new Set([
  "limit",
  "cursor",
]);

const BLOCKER_DECIMAL_DIGITS_ONLY = /^[0-9]+$/;

export function parseApiV1ProjectBlockersQuery(
  rawSearch: string,
): ApiV1ProjectBlockersQuery {
  if (typeof rawSearch !== "string") {
    throw new ApiHttpError("internal_error");
  }

  // No query string at all is valid and means default limit, no cursor.
  if (rawSearch === "" || rawSearch === "?") {
    return Object.freeze({
      limit: API_V1_BLOCKER_LIMIT_DEFAULT,
      cursor: null,
    }) as ApiV1ProjectBlockersQuery;
  }

  if (!rawSearch.startsWith("?")) invalid();
  if (rawSearch.includes("#")) invalid();
  try {
    decodeURIComponent(rawSearch.slice(1).replace(/\+/g, " "));
  } catch {
    invalid();
  }

  const params = new URLSearchParams(rawSearch);
  for (const name of params.keys()) {
    if (!BLOCKER_QUERY_ALLOWED_PARAMS.has(name)) invalid();
    if (params.getAll(name).length > 1) invalid();
  }

  const rawLimit = params.get("limit");
  let limit = API_V1_BLOCKER_LIMIT_DEFAULT;
  if (rawLimit !== null) {
    if (!BLOCKER_DECIMAL_DIGITS_ONLY.test(rawLimit)) invalid();
    const parsed = Number(rawLimit);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < API_V1_BLOCKER_LIMIT_MIN ||
      parsed > API_V1_BLOCKER_LIMIT_MAX
    ) {
      invalid();
    }
    limit = parsed;
  }

  const rawCursor = params.get("cursor");
  const cursor = rawCursor === null
    ? null
    : decodeApiV1BlockerCursor(rawCursor);

  return Object.freeze({ limit, cursor }) as ApiV1ProjectBlockersQuery;
}
