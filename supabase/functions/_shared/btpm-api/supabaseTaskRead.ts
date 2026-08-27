// API-M.CP.4B — Explicit Task detail read RPC adapter.
//
// This module calls exactly one accepted CP.4A database wrapper,
// `public.api_v1_get_task`, through a caller-supplied Supabase RPC client.
// The caller-supplied client is the trust boundary: the runtime must supply a
// client bound to the current bearer token. The SQL wrapper remains the sole
// authorization and protected-data boundary; no containment logic is
// duplicated here.
//
// This module constructs no Supabase client, reads no environment variable,
// extracts no token, uses no service-role key, calls no `fetch`, performs no
// route matching, performs no logging, schedules no timer, caches nothing,
// holds no mutable global state, and exposes no generic read executor.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";
import {
  API_V1_TASK_PRIORITIES,
  API_V1_TASK_STATUSES,
  API_V1_TASK_TYPES,
  type ApiV1TaskPriority,
  type ApiV1TaskStatus,
  type ApiV1TaskType,
} from "../btpm-api/routes/tasks.ts";

/** Exact database wrapper invoked by this adapter. */
const API_V1_GET_TASK_FUNCTION_NAME = "api_v1_get_task";

/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";
/** SQLSTATE invalid_parameter_value. */
const SQLSTATE_INVALID_PARAMETER_VALUE = "22023";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SORT_ORDER_MAX = 100_000;

const TASK_STATUSES: ReadonlySet<string> = new Set(API_V1_TASK_STATUSES);
const TASK_PRIORITIES: ReadonlySet<string> = new Set(API_V1_TASK_PRIORITIES);
const TASK_TYPES: ReadonlySet<string> = new Set(API_V1_TASK_TYPES);

/** Minimal structural RPC client contract. */
export interface ApiV1TaskReadRpcClient {
  rpc(functionName: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Exact external Task detail representation — exactly 19 fields. */
export interface ApiV1TaskReadItem {
  readonly taskId: string;
  readonly projectId: string;
  readonly phaseId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly status: ApiV1TaskStatus;
  readonly priority: ApiV1TaskPriority;
  readonly taskType: ApiV1TaskType;
  readonly sortOrder: number;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly baselineStartDate: string | null;
  readonly baselineEndDate: string | null;
  readonly addedAfterBaseline: boolean;
  readonly actualStartDate: string | null;
  readonly actualEndDate: string | null;
  readonly estimatedHours: number | null;
  readonly assigneeId: string | null;
  readonly updatedAt: string;
}

const EXPECTED_TASK_KEYS: ReadonlyArray<string> = Object.freeze([
  "taskId",
  "projectId",
  "phaseId",
  "name",
  "description",
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
  "estimatedHours",
  "assigneeId",
  "updatedAt",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function internal(): never {
  throw new ApiHttpError("internal_error");
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlyArray<string>,
): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length) internal();
  const allowed = new Set(expected);
  for (const k of keys) {
    if (!allowed.has(k)) internal();
  }
  for (const k of expected) {
    if (!(k in value)) internal();
  }
}

function assertValidExpectedOauthClientId(
  value: unknown,
): asserts value is string {
  if (typeof value !== "string") internal();
  if (value.length < 1 || value.length > 255) internal();
  if (!EXPECTED_OAUTH_CLIENT_ID_PATTERN.test(value)) internal();
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
  if (!isValidUuid(value)) internal();
  return value;
}

/** Optional structural identifiers are exposed as a stored UUID or null. */
function requireNullableServerUuid(value: unknown): string | null {
  if (value === null) return null;
  return requireServerUuid(value);
}

function requireNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) internal();
  return value;
}

function requireNullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") internal();
  return value;
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
): T {
  if (typeof value !== "string" || !allowed.has(value)) internal();
  return value as T;
}

function requireSortOrder(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > SORT_ORDER_MAX
  ) {
    internal();
  }
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") internal();
  return value;
}

/** `estimated_hours` is exposed as a finite non-negative number or null. */
function requireNullableEstimatedHours(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    internal();
  }
  return value;
}

/** Strict calendar-date validation: `YYYY-MM-DD` with a real calendar day. */
function requireNullableDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") internal();
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) internal();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) internal();
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    internal();
  }
  return value;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) internal();
  if (!Number.isFinite(Date.parse(value))) internal();
  return value;
}

function toTaskItem(value: unknown): ApiV1TaskReadItem {
  if (!isPlainObject(value)) internal();
  assertExactKeys(value, EXPECTED_TASK_KEYS);
  return Object.freeze({
    taskId: requireServerUuid(value.taskId),
    projectId: requireServerUuid(value.projectId),
    phaseId: requireNullableServerUuid(value.phaseId),
    name: requireNonEmptyString(value.name),
    description: requireNullableString(value.description),
    status: requireEnum<ApiV1TaskStatus>(value.status, TASK_STATUSES),
    priority: requireEnum<ApiV1TaskPriority>(value.priority, TASK_PRIORITIES),
    taskType: requireEnum<ApiV1TaskType>(value.taskType, TASK_TYPES),
    sortOrder: requireSortOrder(value.sortOrder),
    startDate: requireNullableDate(value.startDate),
    dueDate: requireNullableDate(value.dueDate),
    baselineStartDate: requireNullableDate(value.baselineStartDate),
    baselineEndDate: requireNullableDate(value.baselineEndDate),
    addedAfterBaseline: requireBoolean(value.addedAfterBaseline),
    actualStartDate: requireNullableDate(value.actualStartDate),
    actualEndDate: requireNullableDate(value.actualEndDate),
    estimatedHours: requireNullableEstimatedHours(value.estimatedHours),
    assigneeId: requireNullableServerUuid(value.assigneeId),
    updatedAt: requireTimestamp(value.updatedAt),
  }) as ApiV1TaskReadItem;
}

/**
 * Map a wrapper error to the accepted external error taxonomy.
 * There is deliberately no Task `not_found` result: the wrapper keeps
 * inaccessible, structurally inconsistent and missing Tasks non-enumerable.
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

function requireRpcClient(client: unknown): ApiV1TaskReadRpcClient {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    internal();
  }
  return client as ApiV1TaskReadRpcClient;
}

function unwrapRpcResult(result: unknown): unknown {
  if (!isPlainObject(result)) internal();
  if (!("data" in result) || !("error" in result)) internal();
  const error = result.error;
  if (error !== null && error !== undefined) mapWrapperError(error);
  if (error === undefined) internal();
  return result.data;
}

/**
 * Read a single Task through the accepted CP.4A wrapper.
 * Access is decided exclusively by the database.
 */
export async function readApiV1Task(
  client: ApiV1TaskReadRpcClient,
  expectedOauthClientId: string,
  taskId: string,
): Promise<ApiV1TaskReadItem> {
  const rpcClient = requireRpcClient(client);
  assertValidExpectedOauthClientId(expectedOauthClientId);

  const validTaskId = requireExternalUuid(taskId);

  let result: unknown;
  try {
    result = await rpcClient.rpc(API_V1_GET_TASK_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _task_id: validTaskId,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toTaskItem(unwrapRpcResult(result));
}
