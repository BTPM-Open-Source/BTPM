// API-M.8A — Pure route contracts, dynamic-path parser and strict
// closed-schema body parsers for the two external Phase mutations:
//
//   POST  /v1/phases
//   PATCH /v1/phases/:phaseid
//
// Follows the accepted API-K.7 Risk precedent exactly. This module MUST NOT
// read the environment, read headers, read request bodies, open network
// connections, construct Supabase clients, call RPCs, touch the database, hash
// payloads, register routes, handle HTTP requests, log, schedule timers, or
// hold any mutable global state.

import { ApiHttpError } from "../http.ts";
import { apiUuidSchema } from "../schemas.ts";

export const PHASE_CREATE_ROUTE = Object.freeze({
  id: "phases.create",
  method: "POST",
  path: "/v1/phases",
  operation: "mutation",
} as const);

export const PHASE_UPDATE_ROUTE = Object.freeze({
  id: "phases.update",
  method: "PATCH",
  path: "/v1/phases/:phaseid",
  operation: "mutation",
} as const);

// -----------------------------------------------------------------------------
// Shared vocabulary — canonical BTPM enums only.
// -----------------------------------------------------------------------------

export type ApiV1PhaseStatus =
  | "planned"
  | "active"
  | "completed"
  | "on_hold"
  | "cancelled";

export type ApiV1PhaseType =
  | "work_item"
  | "milestone"
  | "deliverable"
  | "decision"
  | "review";

export const API_V1_PHASE_STATUSES: readonly ApiV1PhaseStatus[] = Object.freeze([
  "planned",
  "active",
  "completed",
  "on_hold",
  "cancelled",
] as const);

export const API_V1_PHASE_TYPES: readonly ApiV1PhaseType[] = Object.freeze([
  "work_item",
  "milestone",
  "deliverable",
  "decision",
  "review",
] as const);

const NAME_MAX_LENGTH = 500;
const DESCRIPTION_MAX_LENGTH = 4000;
const SORT_ORDER_MAX = 100_000;

function invalid(): never {
  throw new ApiHttpError("invalid_request");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// -----------------------------------------------------------------------------
// Dynamic path parser — PATCH /v1/phases/:phaseid
// -----------------------------------------------------------------------------

export interface ApiV1PhaseUpdatePath {
  readonly phaseId: string;
}

const PHASE_UPDATE_PREFIX = "/v1/phases/";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// Reject separators, percent encoding, matrix parameters and any whitespace.
const FORBIDDEN_SEGMENT_CHARS = /[/\\?#%;]|\s/;

export function parseApiV1PhaseUpdatePath(
  pathname: string,
): ApiV1PhaseUpdatePath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (!pathname.startsWith(PHASE_UPDATE_PREFIX)) invalid();

  const remainder = pathname.slice(PHASE_UPDATE_PREFIX.length);
  if (remainder.length === 0) invalid();
  if (FORBIDDEN_SEGMENT_CHARS.test(remainder)) invalid();
  if (remainder === NIL_UUID) invalid();
  if (!apiUuidSchema.safeParse(remainder).success) invalid();

  return Object.freeze({ phaseId: remainder }) as ApiV1PhaseUpdatePath;
}

// -----------------------------------------------------------------------------
// API-M.CP.4B — Phase detail route contract and path parser.
//
// GET /v1/phases/:phaseid has exactly the same identifier grammar as the
// accepted PATCH path, so the accepted parser is reused verbatim rather than
// duplicating a second UUID grammar. `parseApiV1PhaseUpdatePath` behaviour is
// unchanged.
// -----------------------------------------------------------------------------

export const PHASE_DETAIL_ROUTE = Object.freeze({
  id: "phases.get_by_id",
  method: "GET",
  path: "/v1/phases/:phaseid",
  operation: "read",
} as const);

export interface ApiV1PhaseDetailPath {
  readonly phaseId: string;
}

export function parseApiV1PhaseDetailPath(
  pathname: string,
): ApiV1PhaseDetailPath {
  const { phaseId } = parseApiV1PhaseUpdatePath(pathname);
  return Object.freeze({ phaseId }) as ApiV1PhaseDetailPath;
}



// -----------------------------------------------------------------------------
// Canonical normalization — API-M.8A-C1 Correction A
// -----------------------------------------------------------------------------

/**
 * Exact behavioural equivalent of PostgreSQL `btrim(text)` with the default
 * character set: ordinary U+0020 space characters are removed from BOTH ends
 * and nothing else. Interior characters — including interior spaces and any
 * other Unicode whitespace — are preserved byte-for-byte. This deliberately
 * does NOT trim tabs, newlines or exotic Unicode whitespace, because the
 * canonical Phase database commands do not either.
 */
export function canonicalizePhaseText(raw: string): string {
  let start = 0;
  let end = raw.length;
  while (start < end && raw.charCodeAt(start) === 0x20) start += 1;
  while (end > start && raw.charCodeAt(end - 1) === 0x20) end -= 1;
  return raw.slice(start, end);
}

// -----------------------------------------------------------------------------
// Shared field validators
// -----------------------------------------------------------------------------

function parseUuid(raw: unknown): string {
  if (typeof raw !== "string") invalid();
  if (raw === NIL_UUID) invalid();
  if (!apiUuidSchema.safeParse(raw).success) invalid();
  return raw;
}

function parseName(raw: unknown): string {
  if (typeof raw !== "string") invalid();
  if (raw.length > NAME_MAX_LENGTH) invalid();
  // Canonical btrim-equivalent normalization BEFORE emptiness rejection, so
  // the normalized body — and therefore the API-F payload hash — carries the
  // exact canonical business value the database command would store.
  const canonical = canonicalizePhaseText(raw);
  if (canonical.length === 0) invalid();
  return canonical;
}

function parseNullableText(
  raw: unknown,
  present: boolean,
  maxLength: number,
): string | null {
  if (!present || raw === null) return null;
  if (typeof raw !== "string") invalid();
  if (raw.length > maxLength) invalid();
  const canonical = canonicalizePhaseText(raw);
  return canonical.length === 0 ? null : canonical;
}

function parseRequiredNullableText(
  raw: unknown,
  maxLength: number,
): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string") invalid();
  if (raw.length > maxLength) invalid();
  const canonical = canonicalizePhaseText(raw);
  return canonical.length === 0 ? null : canonical;
}

function requireStatus(raw: unknown): ApiV1PhaseStatus {
  if (
    raw !== "planned" &&
    raw !== "active" &&
    raw !== "completed" &&
    raw !== "on_hold" &&
    raw !== "cancelled"
  ) {
    invalid();
  }
  return raw;
}

function parseStatus(raw: unknown, present: boolean): ApiV1PhaseStatus {
  if (!present) return "planned";
  return requireStatus(raw);
}

function requirePhaseType(raw: unknown): ApiV1PhaseType {
  if (
    raw !== "work_item" &&
    raw !== "milestone" &&
    raw !== "deliverable" &&
    raw !== "decision" &&
    raw !== "review"
  ) {
    invalid();
  }
  return raw;
}

function parsePhaseType(raw: unknown, present: boolean): ApiV1PhaseType {
  if (!present) return "work_item";
  return requirePhaseType(raw);
}

// -----------------------------------------------------------------------------
// Calendar-date validation (ISO `YYYY-MM-DD`, no time, no zone)
// -----------------------------------------------------------------------------

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseNullableDate(raw: unknown, present: boolean): string | null {
  if (!present || raw === null) return null;
  if (typeof raw !== "string") invalid();
  const match = DATE_PATTERN.exec(raw);
  if (!match) invalid();

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) invalid();
  if (day < 1 || day > 31) invalid();

  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    invalid();
  }
  // The validated date string is preserved verbatim for the wrapper.
  return raw;
}

function parseNullableSortOrder(raw: unknown, present: boolean): number | null {
  if (!present || raw === null) return null;
  if (typeof raw !== "number") invalid();
  if (!Number.isFinite(raw) || !Number.isSafeInteger(raw)) invalid();
  if (raw < 0 || raw > SORT_ORDER_MAX) invalid();
  return raw;
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
// CREATE body — POST /v1/phases
// -----------------------------------------------------------------------------

export interface ApiV1CreatePhaseBody {
  readonly projectId: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: ApiV1PhaseStatus;
  readonly phaseType: ApiV1PhaseType;
  readonly startDate: string | null;
  readonly targetEndDate: string | null;
  readonly sortOrder: number | null;
}

const CREATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "projectId",
  "name",
  "description",
  "status",
  "phaseType",
  "startDate",
  "targetEndDate",
  "sortOrder",
]);

/**
 * Strict, closed-schema parser for the external Phase create body. The result
 * is fully normalized (defaults resolved, mirroring the canonical command
 * defaults) BEFORE execution-context hashing so the canonical idempotency
 * payload is deterministic.
 */
export function parseApiV1CreatePhaseBody(
  input: unknown,
): ApiV1CreatePhaseBody {
  if (!isPlainObject(input)) invalid();

  for (const key of Object.keys(input)) {
    if (!CREATE_ALLOWED_KEYS.has(key)) invalid();
  }

  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);

  const projectId = parseUuid(input.projectId);
  const name = parseName(input.name);
  const description = parseNullableText(
    input.description,
    has("description"),
    DESCRIPTION_MAX_LENGTH,
  );
  const status = parseStatus(input.status, has("status"));
  const phaseType = parsePhaseType(input.phaseType, has("phaseType"));
  const startDate = parseNullableDate(input.startDate, has("startDate"));
  const targetEndDate = parseNullableDate(
    input.targetEndDate,
    has("targetEndDate"),
  );
  const sortOrder = parseNullableSortOrder(input.sortOrder, has("sortOrder"));

  // API-M.8A-C1 Correction B — reject an inverted planning window at the HTTP
  // contract boundary, before authentication, rate limiting, execution-context
  // construction, payload hashing or any RPC invocation. Both values are exact
  // validated `YYYY-MM-DD` strings, so lexical comparison is total and safe.
  if (
    startDate !== null && targetEndDate !== null && startDate > targetEndDate
  ) {
    invalid();
  }



  return Object.freeze({
    projectId,
    name,
    description,
    status,
    phaseType,
    startDate,
    targetEndDate,
    sortOrder,
  }) as ApiV1CreatePhaseBody;
}

// -----------------------------------------------------------------------------
// UPDATE body — PATCH /v1/phases/:phaseid
// -----------------------------------------------------------------------------

export interface ApiV1UpdatePhaseBody {
  readonly expectedUpdatedAt: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: ApiV1PhaseStatus;
  readonly phaseType: ApiV1PhaseType;
}

const UPDATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "expectedUpdatedAt",
  "name",
  "description",
  "status",
  "phaseType",
]);

/**
 * Strict, closed-schema parser for the external Phase metadata update body.
 * All five keys are required: the body is the COMPLETE metadata desired state.
 * Schedule fields (start / target end / ordering) are deliberately NOT part of
 * this surface — Phase planning stays with the API-M.7B planning wrapper.
 */
export function parseApiV1UpdatePhaseBody(
  input: unknown,
): ApiV1UpdatePhaseBody {
  if (!isPlainObject(input)) invalid();

  for (const key of Object.keys(input)) {
    if (!UPDATE_ALLOWED_KEYS.has(key)) invalid();
  }
  for (const key of UPDATE_ALLOWED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) invalid();
  }

  const expectedUpdatedAt = parseExpectedUpdatedAt(input.expectedUpdatedAt);
  const name = parseName(input.name);
  const description = parseRequiredNullableText(
    input.description,
    DESCRIPTION_MAX_LENGTH,
  );
  const status = requireStatus(input.status);
  const phaseType = requirePhaseType(input.phaseType);

  return Object.freeze({
    expectedUpdatedAt,
    name,
    description,
    status,
    phaseType,
  }) as ApiV1UpdatePhaseBody;
}

/**
 * Canonical idempotency payload for a Phase update. The Phase identity lives
 * in the URL, not the body, so it MUST be folded into the hashed payload.
 */
export function buildApiV1UpdatePhaseIdempotencyPayload(
  phaseId: string,
  body: ApiV1UpdatePhaseBody,
): Readonly<{ phaseId: string } & ApiV1UpdatePhaseBody> {
  if (typeof phaseId !== "string" || phaseId.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (!isPlainObject(body)) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    phaseId,
    expectedUpdatedAt: body.expectedUpdatedAt,
    name: body.name,
    description: body.description,
    status: body.status,
    phaseType: body.phaseType,
  });
}

// =============================================================================
// API-M.8B — Phase reorder + planning HTTP contracts.
//
// Two additional explicit, fixed-purpose Phase mutation contracts. No generic
// Phase action endpoint, no command dispatcher and no reproduction of canonical
// business algorithms exists here: `public.reorder_phases` and
// `public.apply_phase_planning_change` remain the sole owners of sibling-set
// completeness, ordering uniqueness/contiguity, stale-row semantics, Project
// membership and the Project planning-window constraint.
// =============================================================================

export const PHASE_REORDER_ROUTE = Object.freeze({
  id: "phases.reorder",
  method: "POST",
  path: "/v1/projects/:projectid/phases/reorder",
  operation: "mutation",
} as const);

export const PHASE_PLANNING_ROUTE = Object.freeze({
  id: "phases.plan",
  method: "PATCH",
  path: "/v1/phases/:phaseid/planning",
  operation: "mutation",
} as const);

const PHASE_REORDER_PREFIX = "/v1/projects/";
const PHASE_REORDER_SUFFIX = "/phases/reorder";
const PHASE_PLANNING_PREFIX = "/v1/phases/";
const PHASE_PLANNING_SUFFIX = "/planning";

/** Bounded reorder batch size. Not a business rule — a transport bound only. */
const REORDER_MAX_ROWS = 1000;

export interface ApiV1PhaseReorderPath {
  readonly projectId: string;
}

export interface ApiV1PhasePlanningPath {
  readonly phaseId: string;
}

function parseFixedSegmentUuidPath(
  pathname: string,
  prefix: string,
  suffix: string,
): string {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (!pathname.startsWith(prefix)) invalid();
  if (!pathname.endsWith(suffix)) invalid();

  const middle = pathname.slice(
    prefix.length,
    pathname.length - suffix.length,
  );
  if (middle.length === 0) invalid();
  // Rejects separators, percent encoding, backslash, matrix parameters,
  // query/hash characters, whitespace and any additional segment.
  if (FORBIDDEN_SEGMENT_CHARS.test(middle)) invalid();
  if (middle === NIL_UUID) invalid();
  if (!apiUuidSchema.safeParse(middle).success) invalid();
  return middle;
}

/** POST /v1/projects/<non-nil UUID>/phases/reorder — exact shape only. */
export function parseApiV1PhaseReorderPath(
  pathname: string,
): ApiV1PhaseReorderPath {
  const projectId = parseFixedSegmentUuidPath(
    pathname,
    PHASE_REORDER_PREFIX,
    PHASE_REORDER_SUFFIX,
  );
  return Object.freeze({ projectId }) as ApiV1PhaseReorderPath;
}

/** PATCH /v1/phases/<non-nil UUID>/planning — exact shape only. */
export function parseApiV1PhasePlanningPath(
  pathname: string,
): ApiV1PhasePlanningPath {
  const phaseId = parseFixedSegmentUuidPath(
    pathname,
    PHASE_PLANNING_PREFIX,
    PHASE_PLANNING_SUFFIX,
  );
  return Object.freeze({ phaseId }) as ApiV1PhasePlanningPath;
}

// -----------------------------------------------------------------------------
// REORDER body — POST /v1/projects/:projectid/phases/reorder
// -----------------------------------------------------------------------------

export interface ApiV1ReorderPhaseRow {
  readonly phaseId: string;
  readonly expectedUpdatedAt: string;
  readonly sortOrder: number;
}

export interface ApiV1ReorderPhasesBody {
  readonly rows: readonly ApiV1ReorderPhaseRow[];
}

const REORDER_ROW_KEYS: readonly string[] = Object.freeze([
  "phaseId",
  "expectedUpdatedAt",
  "sortOrder",
]);

function parseRequiredSortOrder(raw: unknown): number {
  if (typeof raw !== "number") invalid();
  if (!Number.isFinite(raw) || !Number.isSafeInteger(raw)) invalid();
  if (raw < 0 || raw > SORT_ORDER_MAX) invalid();
  return raw;
}

function parseReorderRow(raw: unknown): ApiV1ReorderPhaseRow {
  if (!isPlainObject(raw)) invalid();
  const keys = Object.keys(raw);
  if (keys.length !== REORDER_ROW_KEYS.length) invalid();
  for (const key of keys) {
    if (!REORDER_ROW_KEYS.includes(key)) invalid();
  }
  for (const key of REORDER_ROW_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) invalid();
  }
  return Object.freeze({
    phaseId: parseUuid(raw.phaseId),
    expectedUpdatedAt: parseExpectedUpdatedAt(raw.expectedUpdatedAt),
    sortOrder: parseRequiredSortOrder(raw.sortOrder),
  }) as ApiV1ReorderPhaseRow;
}

/**
 * Strict, closed-schema parser for the external Phase reorder body. Exactly one
 * top-level key (`rows`) is accepted, and each row carries exactly the three
 * transport fields. Sibling completeness, ordering uniqueness, contiguity,
 * stale-row semantics and Project membership are deliberately NOT validated
 * here — `public.reorder_phases` remains their canonical owner.
 */
export function parseApiV1ReorderPhasesBody(
  input: unknown,
): ApiV1ReorderPhasesBody {
  if (!isPlainObject(input)) invalid();
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "rows") invalid();

  const rawRows = input.rows;
  if (!Array.isArray(rawRows)) invalid();
  if (rawRows.length === 0 || rawRows.length > REORDER_MAX_ROWS) invalid();

  const rows: ApiV1ReorderPhaseRow[] = [];
  for (const rawRow of rawRows) {
    rows.push(parseReorderRow(rawRow));
  }

  return Object.freeze({ rows: Object.freeze(rows) }) as ApiV1ReorderPhasesBody;
}

/**
 * Canonical idempotency payload for a Phase reorder. The target Project
 * identity lives in the URL, so it MUST be folded into the hashed payload.
 * Raw JSON is never hashed.
 */
export function buildApiV1ReorderPhasesIdempotencyPayload(
  projectId: string,
  body: ApiV1ReorderPhasesBody,
): Readonly<{
  projectId: string;
  rows: readonly ApiV1ReorderPhaseRow[];
}> {
  if (typeof projectId !== "string" || projectId.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (!isPlainObject(body) || !Array.isArray(body.rows)) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    projectId,
    rows: Object.freeze(
      body.rows.map((row) =>
        Object.freeze({
          phaseId: row.phaseId,
          expectedUpdatedAt: row.expectedUpdatedAt,
          sortOrder: row.sortOrder,
        })
      ),
    ),
  });
}

// -----------------------------------------------------------------------------
// PLANNING body — PATCH /v1/phases/:phaseid/planning
// -----------------------------------------------------------------------------

export interface ApiV1PlanPhaseBody {
  readonly expectedUpdatedAt: string;
  readonly startDate: string | null;
  readonly targetEndDate: string | null;
  readonly confirmParentExtension: boolean;
}

const PLANNING_REQUIRED_KEYS: readonly string[] = Object.freeze([
  "expectedUpdatedAt",
  "startDate",
  "targetEndDate",
  "confirmParentExtension",
]);

/**
 * Strict, closed-schema parser for the external Phase planning body. This route
 * changes planning dates only: no scope identity, no metadata, no status, no
 * phase type and no preview flag is accepted.
 */
export function parseApiV1PlanPhaseBody(input: unknown): ApiV1PlanPhaseBody {
  if (!isPlainObject(input)) invalid();

  const keys = Object.keys(input);
  if (keys.length !== PLANNING_REQUIRED_KEYS.length) invalid();
  for (const key of keys) {
    if (!PLANNING_REQUIRED_KEYS.includes(key)) invalid();
  }
  for (const key of PLANNING_REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) invalid();
  }

  const expectedUpdatedAt = parseExpectedUpdatedAt(input.expectedUpdatedAt);
  const startDate = parseNullableDate(input.startDate, true);
  const targetEndDate = parseNullableDate(input.targetEndDate, true);
  if (typeof input.confirmParentExtension !== "boolean") invalid();

  if (
    startDate !== null && targetEndDate !== null && startDate > targetEndDate
  ) {
    invalid();
  }

  return Object.freeze({
    expectedUpdatedAt,
    startDate,
    targetEndDate,
    confirmParentExtension: input.confirmParentExtension,
  }) as ApiV1PlanPhaseBody;
}

/**
 * Canonical idempotency payload for a Phase planning change. The validated
 * Phase identity from the path is part of the hashed payload; no second
 * concurrency or version mechanism is introduced.
 */
export function buildApiV1PlanPhaseIdempotencyPayload(
  phaseId: string,
  body: ApiV1PlanPhaseBody,
): Readonly<{ phaseId: string } & ApiV1PlanPhaseBody> {
  if (typeof phaseId !== "string" || phaseId.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (!isPlainObject(body)) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    phaseId,
    expectedUpdatedAt: body.expectedUpdatedAt,
    startDate: body.startDate,
    targetEndDate: body.targetEndDate,
    confirmParentExtension: body.confirmParentExtension,
  });
}
