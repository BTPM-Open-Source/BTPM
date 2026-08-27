// API-M.4 — Explicit Project-planning delegated RPC adapter.
//
// This module calls exactly one accepted database wrapper,
// `public.api_v1_get_project_planning`, through a caller-supplied Supabase
// RPC client. The caller-supplied client is the trust boundary: the runtime
// must supply a client bound to the current bearer token.
//
// This module constructs no Supabase client, reads no environment
// variable, extracts no token, uses no service-role key, calls no
// `fetch`, performs no route matching, performs no logging, schedules no
// timer, caches nothing, holds no mutable global state, and exposes no
// generic read executor.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";

/** Exact database wrapper invoked by this adapter. */
const API_V1_GET_PROJECT_PLANNING_FUNCTION_NAME = "api_v1_get_project_planning";

/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";
/** SQLSTATE invalid_parameter_value. */
const SQLSTATE_INVALID_PARAMETER_VALUE = "22023";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Minimal structural RPC client contract. */
export interface ApiV1ProjectPlanningRpcClient {
  rpc(
    functionName: string,
    args: {
      _expected_oauth_client_id: string;
      _project_id: string;
    },
  ): Promise<unknown>;
}

export interface ApiV1ProjectPlanningProject {
  readonly projectId: string;
  readonly name: string;
  readonly startDate: string | null;
  readonly targetEndDate: string | null;
  readonly actualStartDate: string | null;
  readonly actualEndDate: string | null;
  readonly isBaselined: boolean;
}

export interface ApiV1ProjectPlanningPhase {
  readonly phaseId: string;
  readonly projectId: string;
  readonly name: string;
  readonly status: string;
  readonly phaseType: string;
  readonly sortOrder: number;
  readonly startDate: string | null;
  readonly targetEndDate: string | null;
  readonly baselineStartDate: string | null;
  readonly baselineEndDate: string | null;
  readonly addedAfterBaseline: boolean;
  readonly actualStartDate: string | null;
  readonly actualEndDate: string | null;
  readonly updatedAt: string;
}

export interface ApiV1ProjectPlanningTask {
  readonly taskId: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly name: string;
  readonly status: string;
  readonly priority: string;
  readonly taskType: string;
  readonly sortOrder: number;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly baselineStartDate: string | null;
  readonly baselineEndDate: string | null;
  readonly addedAfterBaseline: boolean;
  readonly actualStartDate: string | null;
  readonly actualEndDate: string | null;
  readonly updatedAt: string;
}

export type ApiV1ProjectPlanningEndpointType = "phase" | "task";

export interface ApiV1ProjectPlanningDependency {
  readonly dependencyId: string;
  readonly sourceType: ApiV1ProjectPlanningEndpointType;
  readonly sourceId: string;
  readonly targetType: ApiV1ProjectPlanningEndpointType;
  readonly targetId: string;
  readonly dependencyType: string;
}

/** Exact safe Project-planning response payload. */
export interface ApiV1ProjectPlanningPayload {
  readonly project: ApiV1ProjectPlanningProject;
  readonly phases: readonly ApiV1ProjectPlanningPhase[];
  readonly tasks: readonly ApiV1ProjectPlanningTask[];
  readonly dependencies: readonly ApiV1ProjectPlanningDependency[];
}

const EXPECTED_TOP_LEVEL_KEYS: ReadonlyArray<string> = Object.freeze([
  "project",
  "phases",
  "tasks",
  "dependencies",
]);

const EXPECTED_PROJECT_KEYS: ReadonlyArray<string> = Object.freeze([
  "projectId",
  "name",
  "startDate",
  "targetEndDate",
  "actualStartDate",
  "actualEndDate",
  "isBaselined",
]);

const EXPECTED_PHASE_KEYS: ReadonlyArray<string> = Object.freeze([
  "phaseId",
  "projectId",
  "name",
  "status",
  "phaseType",
  "sortOrder",
  "startDate",
  "targetEndDate",
  "baselineStartDate",
  "baselineEndDate",
  "addedAfterBaseline",
  "actualStartDate",
  "actualEndDate",
  "updatedAt",
]);

const EXPECTED_TASK_KEYS: ReadonlyArray<string> = Object.freeze([
  "taskId",
  "projectId",
  "phaseId",
  "name",
  "status",
  "priority",
  "taskType",
  "sortOrder",
  "startDate",
  "dueDate",
  "baselineStartDate",
  "baselineEndDate",
  "addedAfterBaseline",
  "actualStartDate",
  "actualEndDate",
  "updatedAt",
]);

const EXPECTED_DEPENDENCY_KEYS: ReadonlyArray<string> = Object.freeze([
  "dependencyId",
  "sourceType",
  "sourceId",
  "targetType",
  "targetId",
  "dependencyType",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
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
    if (!allowed.has(k)) {
      throw new ApiHttpError("internal_error");
    }
  }
  for (const k of expected) {
    if (!(k in value)) {
      throw new ApiHttpError("internal_error");
    }
  }
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

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireFiniteInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ApiHttpError("internal_error");
  }
  return value;
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
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireEndpointType(
  value: unknown,
): ApiV1ProjectPlanningEndpointType {
  if (value !== "phase" && value !== "task") {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function toProject(
  value: unknown,
  projectId: string,
): ApiV1ProjectPlanningProject {
  if (!isPlainObject(value)) {
    throw new ApiHttpError("internal_error");
  }
  assertExactKeys(value, EXPECTED_PROJECT_KEYS);
  const payloadProjectId = requireUuid(value.projectId);
  if (payloadProjectId !== projectId) {
    throw new ApiHttpError("internal_error");
  }
  return Object.freeze({
    projectId: payloadProjectId,
    name: requireNonEmptyString(value.name),
    startDate: requireNullableCalendarDate(value.startDate),
    targetEndDate: requireNullableCalendarDate(value.targetEndDate),
    actualStartDate: requireNullableCalendarDate(value.actualStartDate),
    actualEndDate: requireNullableCalendarDate(value.actualEndDate),
    isBaselined: requireBoolean(value.isBaselined),
  }) as ApiV1ProjectPlanningProject;
}

function toPhases(
  value: unknown,
  projectId: string,
): readonly ApiV1ProjectPlanningPhase[] {
  if (!Array.isArray(value)) {
    throw new ApiHttpError("internal_error");
  }
  const seen = new Set<string>();
  const phases: ApiV1ProjectPlanningPhase[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      throw new ApiHttpError("internal_error");
    }
    assertExactKeys(entry, EXPECTED_PHASE_KEYS);
    const phaseId = requireUuid(entry.phaseId);
    if (seen.has(phaseId)) {
      throw new ApiHttpError("internal_error");
    }
    seen.add(phaseId);
    const entryProjectId = requireUuid(entry.projectId);
    if (entryProjectId !== projectId) {
      throw new ApiHttpError("internal_error");
    }
    phases.push(Object.freeze({
      phaseId,
      projectId: entryProjectId,
      name: requireNonEmptyString(entry.name),
      status: requireNonEmptyString(entry.status),
      phaseType: requireNonEmptyString(entry.phaseType),
      sortOrder: requireFiniteInteger(entry.sortOrder),
      startDate: requireNullableCalendarDate(entry.startDate),
      targetEndDate: requireNullableCalendarDate(entry.targetEndDate),
      baselineStartDate: requireNullableCalendarDate(entry.baselineStartDate),
      baselineEndDate: requireNullableCalendarDate(entry.baselineEndDate),
      addedAfterBaseline: requireBoolean(entry.addedAfterBaseline),
      actualStartDate: requireNullableCalendarDate(entry.actualStartDate),
      actualEndDate: requireNullableCalendarDate(entry.actualEndDate),
      updatedAt: requireTimestamp(entry.updatedAt),
    }) as ApiV1ProjectPlanningPhase);
  }
  return Object.freeze(phases);
}

function toTasks(
  value: unknown,
  projectId: string,
  phaseIds: ReadonlySet<string>,
): readonly ApiV1ProjectPlanningTask[] {
  if (!Array.isArray(value)) {
    throw new ApiHttpError("internal_error");
  }
  const seen = new Set<string>();
  const tasks: ApiV1ProjectPlanningTask[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      throw new ApiHttpError("internal_error");
    }
    assertExactKeys(entry, EXPECTED_TASK_KEYS);
    const taskId = requireUuid(entry.taskId);
    if (seen.has(taskId)) {
      throw new ApiHttpError("internal_error");
    }
    seen.add(taskId);
    const entryProjectId = requireUuid(entry.projectId);
    if (entryProjectId !== projectId) {
      throw new ApiHttpError("internal_error");
    }
    const phaseId = requireUuid(entry.phaseId);
    if (!phaseIds.has(phaseId)) {
      throw new ApiHttpError("internal_error");
    }
    tasks.push(Object.freeze({
      taskId,
      projectId: entryProjectId,
      phaseId,
      name: requireNonEmptyString(entry.name),
      status: requireNonEmptyString(entry.status),
      priority: requireNonEmptyString(entry.priority),
      taskType: requireNonEmptyString(entry.taskType),
      sortOrder: requireFiniteInteger(entry.sortOrder),
      startDate: requireNullableCalendarDate(entry.startDate),
      dueDate: requireNullableCalendarDate(entry.dueDate),
      baselineStartDate: requireNullableCalendarDate(entry.baselineStartDate),
      baselineEndDate: requireNullableCalendarDate(entry.baselineEndDate),
      addedAfterBaseline: requireBoolean(entry.addedAfterBaseline),
      actualStartDate: requireNullableCalendarDate(entry.actualStartDate),
      actualEndDate: requireNullableCalendarDate(entry.actualEndDate),
      updatedAt: requireTimestamp(entry.updatedAt),
    }) as ApiV1ProjectPlanningTask);
  }
  return Object.freeze(tasks);
}

function toDependencies(
  value: unknown,
  phaseIds: ReadonlySet<string>,
  taskIds: ReadonlySet<string>,
): readonly ApiV1ProjectPlanningDependency[] {
  if (!Array.isArray(value)) {
    throw new ApiHttpError("internal_error");
  }
  const seen = new Set<string>();
  const dependencies: ApiV1ProjectPlanningDependency[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      throw new ApiHttpError("internal_error");
    }
    assertExactKeys(entry, EXPECTED_DEPENDENCY_KEYS);
    const dependencyId = requireUuid(entry.dependencyId);
    if (seen.has(dependencyId)) {
      throw new ApiHttpError("internal_error");
    }
    seen.add(dependencyId);

    const sourceType = requireEndpointType(entry.sourceType);
    const targetType = requireEndpointType(entry.targetType);
    if (sourceType !== targetType) {
      throw new ApiHttpError("internal_error");
    }

    const sourceId = requireUuid(entry.sourceId);
    const targetId = requireUuid(entry.targetId);
    if (sourceId === targetId) {
      throw new ApiHttpError("internal_error");
    }

    const allowed = sourceType === "phase" ? phaseIds : taskIds;
    if (!allowed.has(sourceId) || !allowed.has(targetId)) {
      throw new ApiHttpError("internal_error");
    }

    dependencies.push(Object.freeze({
      dependencyId,
      sourceType,
      sourceId,
      targetType,
      targetId,
      dependencyType: requireNonEmptyString(entry.dependencyType),
    }) as ApiV1ProjectPlanningDependency);
  }
  return Object.freeze(dependencies);
}

function toPayload(
  data: unknown,
  projectId: string,
): ApiV1ProjectPlanningPayload {
  if (!isPlainObject(data)) {
    throw new ApiHttpError("internal_error");
  }
  assertExactKeys(data, EXPECTED_TOP_LEVEL_KEYS);

  const project = toProject(data.project, projectId);
  const phases = toPhases(data.phases, projectId);
  const phaseIds = new Set(phases.map((p) => p.phaseId));
  const tasks = toTasks(data.tasks, projectId, phaseIds);
  const taskIds = new Set(tasks.map((t) => t.taskId));
  const dependencies = toDependencies(data.dependencies, phaseIds, taskIds);

  return Object.freeze({
    project,
    phases,
    tasks,
    dependencies,
  }) as ApiV1ProjectPlanningPayload;
}

/**
 * Read the delegated Project-planning payload through the accepted
 * database wrapper. Access is decided exclusively by the database.
 */
export async function readApiV1ProjectPlanning(
  client: ApiV1ProjectPlanningRpcClient,
  expectedOauthClientId: string,
  projectId: string,
): Promise<ApiV1ProjectPlanningPayload> {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    throw new ApiHttpError("internal_error");
  }

  assertValidExpectedOauthClientId(expectedOauthClientId);

  if (typeof projectId !== "string") {
    throw new ApiHttpError("invalid_request");
  }
  if (projectId === NIL_UUID) {
    throw new ApiHttpError("invalid_request");
  }
  if (!apiUuidSchema.safeParse(projectId).success) {
    throw new ApiHttpError("invalid_request");
  }

  let result: unknown;
  try {
    result = await client.rpc(API_V1_GET_PROJECT_PLANNING_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _project_id: projectId,
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

  return toPayload(result.data, projectId);
}
