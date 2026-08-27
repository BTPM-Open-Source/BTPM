// API-M.11A — Pure route contracts, dynamic-path parser and strict
// closed-schema body parsers for the first two external Task mutations:
//
//   POST  /v1/tasks
//   PATCH /v1/tasks/:taskid
//
// Follows the accepted API-M.8A Phase precedent exactly. This module MUST NOT
// read the environment, read headers, read request bodies, open network
// connections, construct Supabase clients, call RPCs, touch the database, hash
// payloads, register routes, handle HTTP requests, log, schedule timers, or
// hold any mutable global state.
//
// Task reorder, planning, assignment and execution transition are deliberately
// NOT part of this surface: they remain separate canonical commands.

import { ApiHttpError } from "../http.ts";
import { apiUuidSchema } from "../schemas.ts";

export const TASK_CREATE_ROUTE = Object.freeze({
  id: "tasks.create",
  method: "POST",
  path: "/v1/tasks",
  operation: "mutation",
} as const);

export const TASK_UPDATE_ROUTE = Object.freeze({
  id: "tasks.update",
  method: "PATCH",
  path: "/v1/tasks/:taskid",
  operation: "mutation",
} as const);

// -----------------------------------------------------------------------------
// Shared vocabulary — canonical BTPM enums only. No synonyms, aliases, display
// labels or case normalization exist here.
// -----------------------------------------------------------------------------

export type ApiV1TaskStatus =
  | "planned"
  | "active"
  | "completed"
  | "on_hold"
  | "cancelled";

export type ApiV1TaskPriority = "low" | "medium" | "high" | "critical";

export type ApiV1TaskType =
  | "milestone"
  | "deliverable"
  | "work_item"
  | "decision"
  | "review";

export const API_V1_TASK_STATUSES: readonly ApiV1TaskStatus[] = Object.freeze([
  "planned",
  "active",
  "completed",
  "on_hold",
  "cancelled",
] as const);

export const API_V1_TASK_PRIORITIES: readonly ApiV1TaskPriority[] = Object
  .freeze([
    "low",
    "medium",
    "high",
    "critical",
  ] as const);

export const API_V1_TASK_TYPES: readonly ApiV1TaskType[] = Object.freeze([
  "milestone",
  "deliverable",
  "work_item",
  "decision",
  "review",
] as const);

const NAME_MAX_LENGTH = 500;
const DESCRIPTION_MAX_LENGTH = 4000;
const SORT_ORDER_MAX = 100_000;
const ESTIMATED_HOURS_MAX = 999_999.99;

function invalid(): never {
  throw new ApiHttpError("invalid_request");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// -----------------------------------------------------------------------------
// Dynamic path parser — PATCH /v1/tasks/:taskid
// -----------------------------------------------------------------------------

export interface ApiV1TaskUpdatePath {
  readonly taskId: string;
}

const TASK_UPDATE_PREFIX = "/v1/tasks/";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// Reject separators, percent encoding, matrix parameters and any whitespace.
// This is why nested future shapes such as `/v1/tasks/<id>/planning`,
// `/v1/tasks/<id>/assignee` and `/v1/tasks/<id>/transition` can never match.
const FORBIDDEN_SEGMENT_CHARS = /[/\\?#%;]|\s/;

export function parseApiV1TaskUpdatePath(
  pathname: string,
): ApiV1TaskUpdatePath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (!pathname.startsWith(TASK_UPDATE_PREFIX)) invalid();

  const remainder = pathname.slice(TASK_UPDATE_PREFIX.length);
  if (remainder.length === 0) invalid();
  if (FORBIDDEN_SEGMENT_CHARS.test(remainder)) invalid();
  if (remainder === NIL_UUID) invalid();
  if (!apiUuidSchema.safeParse(remainder).success) invalid();

  return Object.freeze({ taskId: remainder }) as ApiV1TaskUpdatePath;
}

// -----------------------------------------------------------------------------
// API-M.CP.4B — Task detail route contract and path parser.
//
// GET /v1/tasks/:taskid reuses the accepted Task identifier grammar verbatim.
// `parseApiV1TaskUpdatePath` behaviour is unchanged.
// -----------------------------------------------------------------------------

export const TASK_DETAIL_ROUTE = Object.freeze({
  id: "tasks.get_by_id",
  method: "GET",
  path: "/v1/tasks/:taskid",
  operation: "read",
} as const);

export interface ApiV1TaskDetailPath {
  readonly taskId: string;
}

export function parseApiV1TaskDetailPath(
  pathname: string,
): ApiV1TaskDetailPath {
  const { taskId } = parseApiV1TaskUpdatePath(pathname);
  return Object.freeze({ taskId }) as ApiV1TaskDetailPath;
}


// -----------------------------------------------------------------------------
// Canonical normalization
// -----------------------------------------------------------------------------

/**
 * Exact behavioural equivalent of PostgreSQL `btrim(text)` with the default
 * character set: ordinary U+0020 space characters are removed from BOTH ends
 * and nothing else. Interior characters — including interior spaces and any
 * other Unicode whitespace — are preserved byte-for-byte. This deliberately
 * does NOT trim tabs, newlines or exotic Unicode whitespace, because the
 * canonical Task database commands do not either. JavaScript `.trim()` is
 * never used.
 */
export function canonicalizeTaskText(raw: string): string {
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
  const canonical = canonicalizeTaskText(raw);
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
  const canonical = canonicalizeTaskText(raw);
  return canonical.length === 0 ? null : canonical;
}

function parseRequiredNullableText(
  raw: unknown,
  maxLength: number,
): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string") invalid();
  if (raw.length > maxLength) invalid();
  const canonical = canonicalizeTaskText(raw);
  return canonical.length === 0 ? null : canonical;
}

function requireStatus(raw: unknown): ApiV1TaskStatus {
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

function requirePriority(raw: unknown): ApiV1TaskPriority {
  if (
    raw !== "low" && raw !== "medium" && raw !== "high" && raw !== "critical"
  ) {
    invalid();
  }
  return raw;
}

function requireTaskType(raw: unknown): ApiV1TaskType {
  if (
    raw !== "milestone" &&
    raw !== "deliverable" &&
    raw !== "work_item" &&
    raw !== "decision" &&
    raw !== "review"
  ) {
    invalid();
  }
  return raw;
}

/** Update semantics: exact canonical value, or `null` meaning "retain". */
function requireNullableStatus(raw: unknown): ApiV1TaskStatus | null {
  if (raw === null) return null;
  return requireStatus(raw);
}

function requireNullablePriority(raw: unknown): ApiV1TaskPriority | null {
  if (raw === null) return null;
  return requirePriority(raw);
}

function requireNullableTaskType(raw: unknown): ApiV1TaskType | null {
  if (raw === null) return null;
  return requireTaskType(raw);
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
  return raw;
}

function parseNullableSortOrder(raw: unknown, present: boolean): number | null {
  if (!present || raw === null) return null;
  if (typeof raw !== "number") invalid();
  if (!Number.isFinite(raw) || !Number.isSafeInteger(raw)) invalid();
  if (raw < 0 || raw > SORT_ORDER_MAX) invalid();
  return raw;
}

function parseNullableEstimatedHours(
  raw: unknown,
  present: boolean,
): number | null {
  if (!present || raw === null) return null;
  return requireNullableEstimatedHours(raw);
}

function requireNullableEstimatedHours(raw: unknown): number | null {
  if (raw === null) return null;
  if (typeof raw !== "number") invalid();
  if (!Number.isFinite(raw)) invalid();
  if (raw < 0 || raw > ESTIMATED_HOURS_MAX) invalid();
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

  return raw;
}

// -----------------------------------------------------------------------------
// CREATE body — POST /v1/tasks
// -----------------------------------------------------------------------------

export interface ApiV1CreateTaskBody {
  readonly phaseId: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: ApiV1TaskStatus;
  readonly priority: ApiV1TaskPriority;
  readonly taskType: ApiV1TaskType;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly estimatedHours: number | null;
  readonly sortOrder: number | null;
}

const CREATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "phaseId",
  "name",
  "description",
  "status",
  "priority",
  "taskType",
  "startDate",
  "dueDate",
  "estimatedHours",
  "sortOrder",
]);

/**
 * Strict, closed-schema parser for the external Task create body. The result is
 * fully normalized (defaults resolved, mirroring the canonical command
 * defaults) BEFORE execution-context hashing so the canonical idempotency
 * payload is deterministic for the same business request.
 *
 * The parent Phase planning window is deliberately NOT checked here: the
 * canonical Task create command owns the Phase-window confirmation rule.
 */
export function parseApiV1CreateTaskBody(input: unknown): ApiV1CreateTaskBody {
  if (!isPlainObject(input)) invalid();

  for (const key of Object.keys(input)) {
    if (!CREATE_ALLOWED_KEYS.has(key)) invalid();
  }

  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);

  const phaseId = parseUuid(input.phaseId);
  const name = parseName(input.name);
  const description = parseNullableText(
    input.description,
    has("description"),
    DESCRIPTION_MAX_LENGTH,
  );
  const status = has("status") ? requireStatus(input.status) : "planned";
  const priority = has("priority") ? requirePriority(input.priority) : "medium";
  const taskType = has("taskType")
    ? requireTaskType(input.taskType)
    : "work_item";
  const startDate = parseNullableDate(input.startDate, has("startDate"));
  const dueDate = parseNullableDate(input.dueDate, has("dueDate"));
  const estimatedHours = parseNullableEstimatedHours(
    input.estimatedHours,
    has("estimatedHours"),
  );
  const sortOrder = parseNullableSortOrder(input.sortOrder, has("sortOrder"));

  // Reject an inverted Task window at the HTTP contract boundary, before
  // authentication, rate limiting, execution-context construction, payload
  // hashing or any RPC invocation. Both values are exact validated
  // `YYYY-MM-DD` strings, so lexical comparison is total and safe.
  if (startDate !== null && dueDate !== null && dueDate < startDate) {
    invalid();
  }

  return Object.freeze({
    phaseId,
    name,
    description,
    status,
    priority,
    taskType,
    startDate,
    dueDate,
    estimatedHours,
    sortOrder,
  }) as ApiV1CreateTaskBody;
}

// -----------------------------------------------------------------------------
// UPDATE body — PATCH /v1/tasks/:taskid
// -----------------------------------------------------------------------------

export interface ApiV1UpdateTaskBody {
  readonly expectedUpdatedAt: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: ApiV1TaskStatus | null;
  readonly priority: ApiV1TaskPriority | null;
  readonly taskType: ApiV1TaskType | null;
  readonly estimatedHours: number | null;
}

const UPDATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "expectedUpdatedAt",
  "name",
  "description",
  "status",
  "priority",
  "taskType",
  "estimatedHours",
]);

/**
 * Strict, closed-schema parser for the external Task metadata update body. All
 * seven keys are required, which removes omission ambiguity from PATCH hashing.
 *
 * Canonical null meanings:
 *   description    = null -> clear description
 *   estimatedHours = null -> clear estimated hours
 *   status         = null -> retain stored status
 *   priority       = null -> retain stored priority
 *   taskType       = null -> retain stored task type
 *
 * Task movement between Phases, planning, ordering, assignment and execution
 * transition are separate commands and are rejected by the closed schema.
 */
export function parseApiV1UpdateTaskBody(input: unknown): ApiV1UpdateTaskBody {
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
  const status = requireNullableStatus(input.status);
  const priority = requireNullablePriority(input.priority);
  const taskType = requireNullableTaskType(input.taskType);
  const estimatedHours = requireNullableEstimatedHours(input.estimatedHours);

  return Object.freeze({
    expectedUpdatedAt,
    name,
    description,
    status,
    priority,
    taskType,
    estimatedHours,
  }) as ApiV1UpdateTaskBody;
}

/**
 * Canonical idempotency payload for a Task update. The Task identity lives in
 * the URL, not the body, so it MUST be folded into the hashed payload. The raw
 * URL, raw body, bearer token and caller headers are never hashed.
 */
export function buildApiV1UpdateTaskIdempotencyPayload(
  taskId: string,
  body: ApiV1UpdateTaskBody,
): Readonly<{ taskId: string } & ApiV1UpdateTaskBody> {
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (!isPlainObject(body)) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    taskId,
    expectedUpdatedAt: body.expectedUpdatedAt,
    name: body.name,
    description: body.description,
    status: body.status,
    priority: body.priority,
    taskType: body.taskType,
    estimatedHours: body.estimatedHours,
  });
}

// =============================================================================
// API-M.11B — Task reorder + planning HTTP contracts.
//
// Two additional explicit, fixed-purpose Task mutation contracts, mirroring the
// accepted API-M.8B Phase precedent exactly. No generic Task action endpoint and
// no command dispatcher exists here: `public.api_v1_reorder_tasks` and
// `public.api_v1_plan_task` (over the canonical Task commands) remain the sole
// owners of sibling-set completeness, ordering uniqueness/contiguity, stale-row
// semantics, Phase membership and the Phase planning-window rule.
// =============================================================================

export const TASK_REORDER_ROUTE = Object.freeze({
  id: "tasks.reorder",
  method: "POST",
  path: "/v1/phases/:phaseid/tasks/reorder",
  operation: "mutation",
} as const);

export const TASK_PLANNING_ROUTE = Object.freeze({
  id: "tasks.plan",
  method: "PATCH",
  path: "/v1/tasks/:taskid/planning",
  operation: "mutation",
} as const);

const TASK_REORDER_PREFIX = "/v1/phases/";
const TASK_REORDER_SUFFIX = "/tasks/reorder";
const TASK_PLANNING_PREFIX = "/v1/tasks/";
const TASK_PLANNING_SUFFIX = "/planning";

/** Bounded reorder batch size. Not a business rule — a transport bound only. */
const REORDER_MAX_ROWS = 1000;

export interface ApiV1TaskReorderPath {
  readonly phaseId: string;
}

export interface ApiV1TaskPlanningPath {
  readonly taskId: string;
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

/** POST /v1/phases/<non-nil UUID>/tasks/reorder — exact shape only. */
export function parseApiV1TaskReorderPath(
  pathname: string,
): ApiV1TaskReorderPath {
  const phaseId = parseFixedSegmentUuidPath(
    pathname,
    TASK_REORDER_PREFIX,
    TASK_REORDER_SUFFIX,
  );
  return Object.freeze({ phaseId }) as ApiV1TaskReorderPath;
}

/** PATCH /v1/tasks/<non-nil UUID>/planning — exact shape only. */
export function parseApiV1TaskPlanningPath(
  pathname: string,
): ApiV1TaskPlanningPath {
  const taskId = parseFixedSegmentUuidPath(
    pathname,
    TASK_PLANNING_PREFIX,
    TASK_PLANNING_SUFFIX,
  );
  return Object.freeze({ taskId }) as ApiV1TaskPlanningPath;
}

// -----------------------------------------------------------------------------
// REORDER body — POST /v1/phases/:phaseid/tasks/reorder
// -----------------------------------------------------------------------------

export interface ApiV1ReorderTaskRow {
  readonly taskId: string;
  readonly expectedUpdatedAt: string;
  readonly sortOrder: number;
}

export interface ApiV1ReorderTasksBody {
  readonly rows: readonly ApiV1ReorderTaskRow[];
}

const REORDER_ROW_KEYS: readonly string[] = Object.freeze([
  "taskId",
  "expectedUpdatedAt",
  "sortOrder",
]);

function parseRequiredSortOrder(raw: unknown): number {
  if (typeof raw !== "number") invalid();
  if (!Number.isFinite(raw) || !Number.isSafeInteger(raw)) invalid();
  if (raw < 0 || raw > SORT_ORDER_MAX) invalid();
  return raw;
}

function parseReorderRow(raw: unknown): ApiV1ReorderTaskRow {
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
    taskId: parseUuid(raw.taskId),
    expectedUpdatedAt: parseExpectedUpdatedAt(raw.expectedUpdatedAt),
    sortOrder: parseRequiredSortOrder(raw.sortOrder),
  }) as ApiV1ReorderTaskRow;
}

/**
 * Strict, closed-schema parser for the external Task reorder body. Exactly one
 * top-level key (`rows`) is accepted, and each row carries exactly the three
 * transport fields. Sibling completeness, ordering uniqueness, contiguity,
 * stale-row semantics and Phase membership are deliberately NOT validated here
 * — the canonical Task reorder command remains their sole owner.
 */
export function parseApiV1ReorderTasksBody(
  input: unknown,
): ApiV1ReorderTasksBody {
  if (!isPlainObject(input)) invalid();
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "rows") invalid();

  const rawRows = input.rows;
  if (!Array.isArray(rawRows)) invalid();
  if (rawRows.length === 0 || rawRows.length > REORDER_MAX_ROWS) invalid();

  const rows: ApiV1ReorderTaskRow[] = [];
  for (const rawRow of rawRows) {
    rows.push(parseReorderRow(rawRow));
  }

  return Object.freeze({ rows: Object.freeze(rows) }) as ApiV1ReorderTasksBody;
}

/**
 * Canonical idempotency payload for a Task reorder. The target Phase identity
 * lives in the URL, so it MUST be folded into the hashed payload. Raw JSON is
 * never hashed.
 */
export function buildApiV1ReorderTasksIdempotencyPayload(
  phaseId: string,
  body: ApiV1ReorderTasksBody,
): Readonly<{
  phaseId: string;
  rows: readonly ApiV1ReorderTaskRow[];
}> {
  if (typeof phaseId !== "string" || phaseId.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (!isPlainObject(body) || !Array.isArray(body.rows)) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    phaseId,
    rows: Object.freeze(
      body.rows.map((row) =>
        Object.freeze({
          taskId: row.taskId,
          expectedUpdatedAt: row.expectedUpdatedAt,
          sortOrder: row.sortOrder,
        })
      ),
    ),
  });
}

// -----------------------------------------------------------------------------
// PLANNING body — PATCH /v1/tasks/:taskid/planning
// -----------------------------------------------------------------------------

export interface ApiV1PlanTaskBody {
  readonly expectedUpdatedAt: string;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly confirmParentExtension: boolean;
}

const PLANNING_REQUIRED_KEYS: readonly string[] = Object.freeze([
  "expectedUpdatedAt",
  "startDate",
  "dueDate",
  "confirmParentExtension",
]);

/**
 * Strict, closed-schema parser for the external Task planning body. This route
 * changes planning dates only: no scope identity, no metadata, no status, no
 * task type, no ordering and no preview flag is accepted.
 */
export function parseApiV1PlanTaskBody(input: unknown): ApiV1PlanTaskBody {
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
  const dueDate = parseNullableDate(input.dueDate, true);
  if (typeof input.confirmParentExtension !== "boolean") invalid();

  if (startDate !== null && dueDate !== null && startDate > dueDate) {
    invalid();
  }

  return Object.freeze({
    expectedUpdatedAt,
    startDate,
    dueDate,
    confirmParentExtension: input.confirmParentExtension,
  }) as ApiV1PlanTaskBody;
}

/**
 * Canonical idempotency payload for a Task planning change. The validated Task
 * identity from the path is part of the hashed payload; no second concurrency
 * or version mechanism is introduced.
 */
export function buildApiV1PlanTaskIdempotencyPayload(
  taskId: string,
  body: ApiV1PlanTaskBody,
): Readonly<{ taskId: string } & ApiV1PlanTaskBody> {
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (!isPlainObject(body)) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    taskId,
    expectedUpdatedAt: body.expectedUpdatedAt,
    startDate: body.startDate,
    dueDate: body.dueDate,
    confirmParentExtension: body.confirmParentExtension,
  });
}

// =============================================================================
// API-M.11C — Task assignment + execution transition HTTP contracts.
//
// The final two frozen external Task commands. Each is a dedicated, fixed-purpose
// contract: there is no generic Task action endpoint, no command dispatcher and
// no caller-selected RPC. `public.api_v1_assign_task` and
// `public.api_v1_transition_task` (over the canonical PMG commands) remain the
// sole owners of Workspace-membership eligibility, actual-date business rules,
// completed-task locking, reopen requirements, Phase/Project rollups, execution
// history and lifecycle protections.
// =============================================================================

export const TASK_ASSIGN_ROUTE = Object.freeze({
  id: "tasks.assign",
  method: "PUT",
  path: "/v1/tasks/:taskid/assignee",
  operation: "mutation",
} as const);

export const TASK_TRANSITION_ROUTE = Object.freeze({
  id: "tasks.transition",
  method: "POST",
  path: "/v1/tasks/:taskid/transition",
  operation: "mutation",
} as const);

const TASK_ASSIGN_PREFIX = "/v1/tasks/";
const TASK_ASSIGN_SUFFIX = "/assignee";
const TASK_TRANSITION_PREFIX = "/v1/tasks/";
const TASK_TRANSITION_SUFFIX = "/transition";

export interface ApiV1TaskAssignPath {
  readonly taskId: string;
}

export interface ApiV1TaskTransitionPath {
  readonly taskId: string;
}

/** PUT /v1/tasks/<non-nil UUID>/assignee — exact shape only. */
export function parseApiV1TaskAssignPath(
  pathname: string,
): ApiV1TaskAssignPath {
  const taskId = parseFixedSegmentUuidPath(
    pathname,
    TASK_ASSIGN_PREFIX,
    TASK_ASSIGN_SUFFIX,
  );
  return Object.freeze({ taskId }) as ApiV1TaskAssignPath;
}

/** POST /v1/tasks/<non-nil UUID>/transition — exact shape only. */
export function parseApiV1TaskTransitionPath(
  pathname: string,
): ApiV1TaskTransitionPath {
  const taskId = parseFixedSegmentUuidPath(
    pathname,
    TASK_TRANSITION_PREFIX,
    TASK_TRANSITION_SUFFIX,
  );
  return Object.freeze({ taskId }) as ApiV1TaskTransitionPath;
}

// -----------------------------------------------------------------------------
// ASSIGNMENT body — PUT /v1/tasks/:taskid/assignee
// -----------------------------------------------------------------------------

export interface ApiV1AssignTaskBody {
  /** Valid non-nil UUID, or `null` meaning "clear the assignment". */
  readonly assigneeId: string | null;
}

const ASSIGN_REQUIRED_KEYS: readonly string[] = Object.freeze(["assigneeId"]);

/**
 * Strict, closed-schema parser for the external Task assignment body. Exactly
 * one key is accepted. There is intentionally NO optimistic-concurrency token
 * for assignment, and no identity, role, assignment type, scope or metadata
 * field is accepted. Workspace-membership eligibility remains owned by the
 * canonical assignment command.
 */
export function parseApiV1AssignTaskBody(input: unknown): ApiV1AssignTaskBody {
  if (!isPlainObject(input)) invalid();

  const keys = Object.keys(input);
  if (keys.length !== ASSIGN_REQUIRED_KEYS.length) invalid();
  for (const key of keys) {
    if (!ASSIGN_REQUIRED_KEYS.includes(key)) invalid();
  }
  if (!Object.prototype.hasOwnProperty.call(input, "assigneeId")) invalid();

  const raw = input.assigneeId;
  const assigneeId = raw === null ? null : parseUuid(raw);

  return Object.freeze({ assigneeId }) as ApiV1AssignTaskBody;
}

/**
 * Canonical idempotency payload for a Task assignment. The validated Task
 * identity from the path is folded in; the raw URL, raw JSON, bearer token,
 * request ID, headers and the idempotency key itself are never hashed.
 */
export function buildApiV1AssignTaskIdempotencyPayload(
  taskId: string,
  body: ApiV1AssignTaskBody,
): Readonly<{ taskId: string } & ApiV1AssignTaskBody> {
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (!isPlainObject(body)) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    taskId,
    assigneeId: body.assigneeId,
  });
}

// -----------------------------------------------------------------------------
// TRANSITION body — POST /v1/tasks/:taskid/transition
// -----------------------------------------------------------------------------

/** Bounded external transition status vocabulary. */
export type ApiV1TaskTransitionStatus = "active" | "completed";

export const API_V1_TASK_TRANSITION_STATUSES:
  readonly ApiV1TaskTransitionStatus[] = Object.freeze([
    "active",
    "completed",
  ] as const);

export interface ApiV1TransitionTaskBody {
  readonly expectedUpdatedAt: string;
  readonly setActualStart: boolean;
  readonly actualStartDate: string | null;
  readonly setActualEnd: boolean;
  readonly actualEndDate: string | null;
  readonly status: ApiV1TaskTransitionStatus | null;
}

const TRANSITION_REQUIRED_KEYS: readonly string[] = Object.freeze([
  "expectedUpdatedAt",
  "setActualStart",
  "actualStartDate",
  "setActualEnd",
  "actualEndDate",
  "status",
]);

function requireNullableTransitionStatus(
  raw: unknown,
): ApiV1TaskTransitionStatus | null {
  if (raw === null) return null;
  if (raw !== "active" && raw !== "completed") invalid();
  return raw;
}

/**
 * Strict, closed-schema parser for the external Task execution-transition body.
 * All six keys are required, so no omission ambiguity exists in the canonical
 * idempotency payload.
 *
 * `expectedUpdatedAt` is the sole concurrency token. A `false` set-flag means
 * "do not modify", so it requires the matching date to be `null`; `true` with a
 * date is an explicit set and `true` with `null` is an explicit clear.
 *
 * Actual-date range validation, completed-task locking, reopen requirements,
 * Phase/Project rollups, execution history, derived parent actual dates and
 * lifecycle protections all remain owned by the canonical execution command.
 */
export function parseApiV1TransitionTaskBody(
  input: unknown,
): ApiV1TransitionTaskBody {
  if (!isPlainObject(input)) invalid();

  const keys = Object.keys(input);
  if (keys.length !== TRANSITION_REQUIRED_KEYS.length) invalid();
  for (const key of keys) {
    if (!TRANSITION_REQUIRED_KEYS.includes(key)) invalid();
  }
  for (const key of TRANSITION_REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) invalid();
  }

  const expectedUpdatedAt = parseExpectedUpdatedAt(input.expectedUpdatedAt);
  if (typeof input.setActualStart !== "boolean") invalid();
  if (typeof input.setActualEnd !== "boolean") invalid();

  const actualStartDate = parseNullableDate(input.actualStartDate, true);
  const actualEndDate = parseNullableDate(input.actualEndDate, true);

  // A supplied date with a `false` set-flag is contradictory transport input.
  if (input.setActualStart === false && actualStartDate !== null) invalid();
  if (input.setActualEnd === false && actualEndDate !== null) invalid();

  const status = requireNullableTransitionStatus(input.status);

  return Object.freeze({
    expectedUpdatedAt,
    setActualStart: input.setActualStart,
    actualStartDate,
    setActualEnd: input.setActualEnd,
    actualEndDate,
    status,
  }) as ApiV1TransitionTaskBody;
}

/**
 * Canonical idempotency payload for a Task execution transition. The validated
 * Task identity plus all six normalized business-intent fields participate; no
 * raw request material is ever hashed.
 */
export function buildApiV1TransitionTaskIdempotencyPayload(
  taskId: string,
  body: ApiV1TransitionTaskBody,
): Readonly<{ taskId: string } & ApiV1TransitionTaskBody> {
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (!isPlainObject(body)) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    taskId,
    expectedUpdatedAt: body.expectedUpdatedAt,
    setActualStart: body.setActualStart,
    actualStartDate: body.actualStartDate,
    setActualEnd: body.setActualEnd,
    actualEndDate: body.actualEndDate,
    status: body.status,
  });
}
