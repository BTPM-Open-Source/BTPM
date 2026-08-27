// API-H.3A — Pure route contract and query parser for GET /v1/projects.
//
// This module MUST NOT read the environment, open network connections,
// construct Supabase clients, touch the database, register routes,
// handle HTTP requests, log, schedule timers, or hold any mutable
// global state.

import { ApiHttpError } from "../http.ts";
import { apiUuidSchema } from "../schemas.ts";

export const PROJECTS_ROUTE = Object.freeze({
  id: "projects.get",
  method: "GET",
  path: "/v1/projects",
  operation: "read",
} as const);

export interface ApiV1ProjectsQuery {
  readonly workspaceId: string;
  readonly limit: number;
  readonly offset: number;
  readonly search: string | null;
}

const LIMIT_MIN = 1;
const LIMIT_MAX = 100;
const OFFSET_MIN = 0;
const OFFSET_MAX = 10000;
const SEARCH_MAX_LENGTH = 100;

const ALLOWED_PARAM_NAMES: ReadonlySet<string> = new Set([
  "workspace_id",
  "limit",
  "offset",
  "search",
]);

const DECIMAL_DIGITS_ONLY = /^[0-9]+$/;

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
  const result = apiUuidSchema.safeParse(raw);
  if (!result.success) {
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

export function parseApiV1ProjectsQuery(
  rawSearch: string,
): ApiV1ProjectsQuery {
  if (typeof rawSearch !== "string") {
    throw new ApiHttpError("internal_error");
  }

  // workspace_id is required, so an empty raw query is never valid.
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
  const limit = parseDecimalParam(params.get("limit"), 50, LIMIT_MIN, LIMIT_MAX);
  const offset = parseDecimalParam(
    params.get("offset"),
    0,
    OFFSET_MIN,
    OFFSET_MAX,
  );
  const search = parseSearchParam(params.get("search"));

  return Object.freeze({
    limit,
    offset,
    search,
    workspaceId,
  }) as ApiV1ProjectsQuery;
}

// =============================================================================
// API-N.5 — POST /v1/projects (projects:create)
//
// Exactly one new external command surface. Strict closed-schema body, fully
// normalized BEFORE execution-context hashing so the API-F canonical payload is
// deterministic. No Project narrative, schedule, status or protected field is
// accepted here: blank Project creation only.
// =============================================================================

export const PROJECT_CREATE_ROUTE = Object.freeze({
  id: "projects.create",
  method: "POST",
  path: "/v1/projects",
  operation: "mutation",
} as const);

/** Canonical BTPM delivery-model vocabulary. */
export type ApiV1ProjectDeliveryModel =
  | "internal_delivery"
  | "vendor_delivery"
  | "co_delivery";

const PROJECT_NAME_MAX_LENGTH = 200;
const PROJECT_NIL_UUID = "00000000-0000-0000-0000-000000000000";

export interface ApiV1CreateProjectBody {
  readonly workspaceId: string;
  readonly name: string;
  readonly programId: string | null;
  readonly deliveryModel: ApiV1ProjectDeliveryModel | null;
}

const PROJECT_CREATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "workspaceId",
  "name",
  "programId",
  "deliveryModel",
]);

function projectInvalid(): never {
  throw new ApiHttpError("invalid_request");
}

function isProjectPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Exact behavioural equivalent of PostgreSQL `btrim(text)` with the default
 * character set: ordinary U+0020 space characters are removed from BOTH ends
 * and nothing else, matching the canonical Project creation command.
 */
export function canonicalizeProjectText(raw: string): string {
  let start = 0;
  let end = raw.length;
  while (start < end && raw.charCodeAt(start) === 0x20) start += 1;
  while (end > start && raw.charCodeAt(end - 1) === 0x20) end -= 1;
  return raw.slice(start, end);
}

function parseProjectUuid(raw: unknown): string {
  if (typeof raw !== "string") projectInvalid();
  if (raw === PROJECT_NIL_UUID) projectInvalid();
  if (!apiUuidSchema.safeParse(raw).success) projectInvalid();
  return raw;
}

function parseProjectName(raw: unknown): string {
  if (typeof raw !== "string") projectInvalid();
  if (raw.length > PROJECT_NAME_MAX_LENGTH) projectInvalid();
  const canonical = canonicalizeProjectText(raw);
  if (canonical.length === 0) projectInvalid();
  if (canonical.length > PROJECT_NAME_MAX_LENGTH) projectInvalid();
  return canonical;
}

function parseNullableProjectUuid(
  raw: unknown,
  present: boolean,
): string | null {
  if (!present || raw === null) return null;
  return parseProjectUuid(raw);
}

function parseNullableDeliveryModel(
  raw: unknown,
  present: boolean,
): ApiV1ProjectDeliveryModel | null {
  if (!present || raw === null) return null;
  if (
    raw !== "internal_delivery" &&
    raw !== "vendor_delivery" &&
    raw !== "co_delivery"
  ) {
    projectInvalid();
  }
  return raw;
}

/**
 * Strict, closed-schema parser for the external blank-Project create body.
 * `workspaceId` and `name` are required; `programId` and `deliveryModel` are
 * optional and normalize to `null` when absent. Any other key is rejected.
 */
export function parseApiV1CreateProjectBody(
  input: unknown,
): ApiV1CreateProjectBody {
  if (!isProjectPlainObject(input)) projectInvalid();

  for (const key of Object.keys(input)) {
    if (!PROJECT_CREATE_ALLOWED_KEYS.has(key)) projectInvalid();
  }

  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);

  if (!has("workspaceId") || !has("name")) projectInvalid();

  const workspaceId = parseProjectUuid(input.workspaceId);
  const name = parseProjectName(input.name);
  const programId = parseNullableProjectUuid(input.programId, has("programId"));
  const deliveryModel = parseNullableDeliveryModel(
    input.deliveryModel,
    has("deliveryModel"),
  );

  return Object.freeze({
    workspaceId,
    name,
    programId,
    deliveryModel,
  }) as ApiV1CreateProjectBody;
}

// =============================================================================
// API-N.6 — PATCH /v1/projects/{projectId} (projects:update)
//
// Exactly one new external Project metadata command. No planning date, status,
// stage, archive or Agile surface is reachable here. The contract distinguishes
// "field absent" from "field present with null", because the canonical PMG uses
// explicit `_set_*` flags.
// =============================================================================

export const PROJECT_UPDATE_ROUTE = Object.freeze({
  id: "projects.update",
  method: "PATCH",
  path: "/v1/projects/:projectid",
  operation: "mutation",
} as const);

const PROJECT_UPDATE_PATH_PREFIX = "/v1/projects/";
const PROJECT_FORBIDDEN_SEGMENT_CHARS = /[/\\?#%;]|\s/;

export interface ApiV1ProjectUpdatePath {
  readonly projectId: string;
}

/** PATCH /v1/projects/<non-nil UUID> — exact shape only. */
export function parseApiV1ProjectUpdatePath(
  pathname: string,
): ApiV1ProjectUpdatePath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (!pathname.startsWith(PROJECT_UPDATE_PATH_PREFIX)) projectInvalid();
  const middle = pathname.slice(PROJECT_UPDATE_PATH_PREFIX.length);
  if (middle.length === 0) projectInvalid();
  if (PROJECT_FORBIDDEN_SEGMENT_CHARS.test(middle)) projectInvalid();
  if (middle === PROJECT_NIL_UUID) projectInvalid();
  if (!apiUuidSchema.safeParse(middle).success) projectInvalid();
  return Object.freeze({ projectId: middle }) as ApiV1ProjectUpdatePath;
}

/** Canonical Project priority vocabulary. */
export type ApiV1ProjectPriority = "low" | "medium" | "high" | "critical";

const PROJECT_PRIORITIES: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
  "critical",
]);

/** Every narrative field reachable through this command, in canonical order. */
export const PROJECT_UPDATE_NARRATIVE_FIELDS = Object.freeze([
  "description",
  "charter",
  "goals",
  "scopeIn",
  "scopeOut",
  "businessCase",
  "successCriteria",
  "completionCriteria",
  "budgetNarrative",
  "assumptions",
  "constraints",
] as const);

export type ApiV1ProjectUpdateNarrativeField =
  (typeof PROJECT_UPDATE_NARRATIVE_FIELDS)[number];

export interface ApiV1UpdateProjectBody {
  readonly expectedUpdatedAt: string;

  readonly name: string | null;
  readonly setName: boolean;

  readonly priority: ApiV1ProjectPriority | null;
  readonly setPriority: boolean;

  readonly description: string | null;
  readonly setDescription: boolean;
  readonly charter: string | null;
  readonly setCharter: boolean;
  readonly goals: string | null;
  readonly setGoals: boolean;
  readonly scopeIn: string | null;
  readonly setScopeIn: boolean;
  readonly scopeOut: string | null;
  readonly setScopeOut: boolean;
  readonly businessCase: string | null;
  readonly setBusinessCase: boolean;
  readonly successCriteria: string | null;
  readonly setSuccessCriteria: boolean;
  readonly completionCriteria: string | null;
  readonly setCompletionCriteria: boolean;
  readonly budgetNarrative: string | null;
  readonly setBudgetNarrative: boolean;
  readonly assumptions: string | null;
  readonly setAssumptions: boolean;
  readonly constraints: string | null;
  readonly setConstraints: boolean;

  readonly programId: string | null;
  readonly setProgramId: boolean;

  readonly deliveryModel: ApiV1ProjectDeliveryModel | null;
  readonly setDeliveryModel: boolean;
}

const PROJECT_UPDATE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "expectedUpdatedAt",
  "name",
  "priority",
  ...PROJECT_UPDATE_NARRATIVE_FIELDS,
  "programId",
  "deliveryModel",
]);

const PROJECT_UPDATE_TIMESTAMPTZ_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}(?::?\d{2})?)$/;

/** Required timezone-aware PostgreSQL-compatible timestamp, preserved verbatim. */
export function parseProjectExpectedUpdatedAt(raw: unknown): string {
  if (typeof raw !== "string") projectInvalid();
  const match = PROJECT_UPDATE_TIMESTAMPTZ_PATTERN.exec(raw);
  if (!match) projectInvalid();

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (month < 1 || month > 12) projectInvalid();
  if (day < 1 || day > 31) projectInvalid();
  if (hour > 23 || minute > 59 || second > 59) projectInvalid();

  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    projectInvalid();
  }

  const offset = match[8];
  if (offset !== "Z" && offset !== "z") {
    const sign = offset.slice(0, 1);
    const rest = offset.slice(1).replace(":", "");
    const offHour = Number(rest.slice(0, 2));
    const offMinute = rest.length > 2 ? Number(rest.slice(2, 4)) : 0;
    if (sign !== "+" && sign !== "-") projectInvalid();
    if (!Number.isFinite(offHour) || offHour > 23) projectInvalid();
    if (!Number.isFinite(offMinute) || offMinute > 59) projectInvalid();
  }

  return raw;
}

function parseUpdateProjectName(raw: unknown): string {
  // Explicit null is invalid: `name` is not clearable.
  return parseProjectName(raw);
}

function parseUpdateProjectPriority(raw: unknown): ApiV1ProjectPriority {
  if (typeof raw !== "string" || !PROJECT_PRIORITIES.has(raw)) {
    projectInvalid();
  }
  return raw as ApiV1ProjectPriority;
}

/**
 * Narrative normalization. A supplied string is canonicalized with the same
 * ordinary U+0020-space `btrim` semantics as the canonical PMG; a string that
 * becomes empty normalizes to an explicit clear (null).
 */
function parseUpdateProjectNarrative(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string") projectInvalid();
  const canonical = canonicalizeProjectText(raw);
  return canonical.length === 0 ? null : canonical;
}

/**
 * Strict, closed-schema parser for the external Project update body.
 * `expectedUpdatedAt` is required; every other key is optional and carries an
 * explicit presence flag so "absent" and "explicit null" never collapse.
 */
export function parseApiV1UpdateProjectBody(
  input: unknown,
): ApiV1UpdateProjectBody {
  if (!isProjectPlainObject(input)) projectInvalid();

  for (const key of Object.keys(input)) {
    if (!PROJECT_UPDATE_ALLOWED_KEYS.has(key)) projectInvalid();
  }

  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  if (!has("expectedUpdatedAt")) projectInvalid();

  const expectedUpdatedAt = parseProjectExpectedUpdatedAt(
    input.expectedUpdatedAt,
  );

  const setName = has("name");
  const name = setName ? parseUpdateProjectName(input.name) : null;

  const setPriority = has("priority");
  const priority = setPriority
    ? parseUpdateProjectPriority(input.priority)
    : null;

  const narratives: Record<string, string | null> = {};
  const narrativeFlags: Record<string, boolean> = {};
  for (const field of PROJECT_UPDATE_NARRATIVE_FIELDS) {
    const present = has(field);
    narrativeFlags[field] = present;
    narratives[field] = present
      ? parseUpdateProjectNarrative((input as Record<string, unknown>)[field])
      : null;
  }

  const setProgramId = has("programId");
  const programId = setProgramId
    ? (input.programId === null ? null : parseProjectUuid(input.programId))
    : null;

  const setDeliveryModel = has("deliveryModel");
  const deliveryModel = setDeliveryModel
    ? parseNullableDeliveryModel(input.deliveryModel, true)
    : null;

  return Object.freeze({
    expectedUpdatedAt,
    name,
    setName,
    priority,
    setPriority,
    description: narratives.description,
    setDescription: narrativeFlags.description,
    charter: narratives.charter,
    setCharter: narrativeFlags.charter,
    goals: narratives.goals,
    setGoals: narrativeFlags.goals,
    scopeIn: narratives.scopeIn,
    setScopeIn: narrativeFlags.scopeIn,
    scopeOut: narratives.scopeOut,
    setScopeOut: narrativeFlags.scopeOut,
    businessCase: narratives.businessCase,
    setBusinessCase: narrativeFlags.businessCase,
    successCriteria: narratives.successCriteria,
    setSuccessCriteria: narrativeFlags.successCriteria,
    completionCriteria: narratives.completionCriteria,
    setCompletionCriteria: narrativeFlags.completionCriteria,
    budgetNarrative: narratives.budgetNarrative,
    setBudgetNarrative: narrativeFlags.budgetNarrative,
    assumptions: narratives.assumptions,
    setAssumptions: narrativeFlags.assumptions,
    constraints: narratives.constraints,
    setConstraints: narrativeFlags.constraints,
    programId,
    setProgramId,
    deliveryModel,
    setDeliveryModel,
  }) as ApiV1UpdateProjectBody;
}

/**
 * Deterministic canonical API-F idempotency payload for the Project update
 * command. Every mutable field contributes BOTH its presence flag and its
 * normalized value, so an absent field can never hash identically to an
 * explicit clear. No execution metadata is included.
 */
export function buildApiV1UpdateProjectIdempotencyPayload(
  projectId: string,
  body: ApiV1UpdateProjectBody,
): Record<string, unknown> {
  return Object.freeze({
    projectId,
    expectedUpdatedAt: body.expectedUpdatedAt,
    setName: body.setName,
    name: body.name,
    setPriority: body.setPriority,
    priority: body.priority,
    setDescription: body.setDescription,
    description: body.description,
    setCharter: body.setCharter,
    charter: body.charter,
    setGoals: body.setGoals,
    goals: body.goals,
    setScopeIn: body.setScopeIn,
    scopeIn: body.scopeIn,
    setScopeOut: body.setScopeOut,
    scopeOut: body.scopeOut,
    setBusinessCase: body.setBusinessCase,
    businessCase: body.businessCase,
    setSuccessCriteria: body.setSuccessCriteria,
    successCriteria: body.successCriteria,
    setCompletionCriteria: body.setCompletionCriteria,
    completionCriteria: body.completionCriteria,
    setBudgetNarrative: body.setBudgetNarrative,
    budgetNarrative: body.budgetNarrative,
    setAssumptions: body.setAssumptions,
    assumptions: body.assumptions,
    setConstraints: body.setConstraints,
    constraints: body.constraints,
    setProgramId: body.setProgramId,
    programId: body.programId,
    setDeliveryModel: body.setDeliveryModel,
    deliveryModel: body.deliveryModel,
  });
}

// =============================================================================
// API-N.7 — POST /v1/projects/{projectId}/transition (projects:transition)
//
// Exactly one new external Project status-transition command. No transition
// business rule is reproduced here: supported transitions, completion
// validation, hard blockers, soft warnings, explicit confirmation and reopen
// semantics remain owned solely by `public.apply_project_status_transition`.
// =============================================================================

export const PROJECT_TRANSITION_ROUTE = Object.freeze({
  id: "projects.transition",
  method: "POST",
  path: "/v1/projects/:projectid/transition",
  operation: "mutation",
} as const);

const PROJECT_TRANSITION_PATH_PREFIX = "/v1/projects/";
const PROJECT_TRANSITION_PATH_SUFFIX = "/transition";

export interface ApiV1ProjectTransitionPath {
  readonly projectId: string;
}

/** POST /v1/projects/<non-nil UUID>/transition — exact shape only. */
export function parseApiV1ProjectTransitionPath(
  pathname: string,
): ApiV1ProjectTransitionPath {
  if (typeof pathname !== "string") {
    throw new ApiHttpError("internal_error");
  }
  if (!pathname.startsWith(PROJECT_TRANSITION_PATH_PREFIX)) projectInvalid();
  if (!pathname.endsWith(PROJECT_TRANSITION_PATH_SUFFIX)) projectInvalid();
  const middle = pathname.slice(
    PROJECT_TRANSITION_PATH_PREFIX.length,
    pathname.length - PROJECT_TRANSITION_PATH_SUFFIX.length,
  );
  if (middle.length === 0) projectInvalid();
  if (PROJECT_FORBIDDEN_SEGMENT_CHARS.test(middle)) projectInvalid();
  if (middle === PROJECT_NIL_UUID) projectInvalid();
  if (!apiUuidSchema.safeParse(middle).success) projectInvalid();
  return Object.freeze({ projectId: middle }) as ApiV1ProjectTransitionPath;
}

/** Exact current `public.pm_status` vocabulary. */
export const PROJECT_TRANSITION_TARGET_STATUSES = Object.freeze([
  "planned",
  "active",
  "completed",
  "on_hold",
  "cancelled",
] as const);

export type ApiV1ProjectTargetStatus =
  (typeof PROJECT_TRANSITION_TARGET_STATUSES)[number];

const PROJECT_TARGET_STATUS_SET: ReadonlySet<string> = new Set(
  PROJECT_TRANSITION_TARGET_STATUSES,
);

export interface ApiV1TransitionProjectBody {
  readonly expectedUpdatedAt: string;
  readonly targetStatus: ApiV1ProjectTargetStatus;
  readonly confirmWarnings: boolean;
}

const PROJECT_TRANSITION_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "expectedUpdatedAt",
  "targetStatus",
  "confirmWarnings",
]);

/**
 * Strict, closed-schema parser for the external Project status-transition body.
 * `expectedUpdatedAt` and `targetStatus` are required; `confirmWarnings` is
 * optional, boolean only, and defaults to `false`.
 */
export function parseApiV1TransitionProjectBody(
  input: unknown,
): ApiV1TransitionProjectBody {
  if (!isProjectPlainObject(input)) projectInvalid();

  for (const key of Object.keys(input)) {
    if (!PROJECT_TRANSITION_ALLOWED_KEYS.has(key)) projectInvalid();
  }

  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  if (!has("expectedUpdatedAt") || !has("targetStatus")) projectInvalid();

  const expectedUpdatedAt = parseProjectExpectedUpdatedAt(
    input.expectedUpdatedAt,
  );

  const rawStatus = input.targetStatus;
  if (typeof rawStatus !== "string" || !PROJECT_TARGET_STATUS_SET.has(rawStatus)) {
    projectInvalid();
  }

  let confirmWarnings = false;
  if (has("confirmWarnings")) {
    if (typeof input.confirmWarnings !== "boolean") projectInvalid();
    confirmWarnings = input.confirmWarnings;
  }

  return Object.freeze({
    expectedUpdatedAt,
    targetStatus: rawStatus as ApiV1ProjectTargetStatus,
    confirmWarnings,
  }) as ApiV1TransitionProjectBody;
}

/**
 * Deterministic canonical API-F idempotency payload for the Project transition
 * command. The target Project identifier lives in the URL, so it is folded in
 * explicitly. No execution metadata is included.
 */
export function buildApiV1TransitionProjectIdempotencyPayload(
  projectId: string,
  body: ApiV1TransitionProjectBody,
): Record<string, unknown> {
  return Object.freeze({
    projectId,
    expectedUpdatedAt: body.expectedUpdatedAt,
    targetStatus: body.targetStatus,
    confirmWarnings: body.confirmWarnings,
  });
}
