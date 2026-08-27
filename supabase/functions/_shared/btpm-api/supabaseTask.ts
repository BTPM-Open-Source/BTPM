// API-M.11A — Explicit RPC adapters for the first two external Task mutations.
//
// This module calls exactly two accepted API-M.10A database wrappers,
// `public.api_v1_create_task` and `public.api_v1_update_task`, through a
// caller-supplied Supabase RPC client. The caller-supplied client is the trust
// boundary: the runtime must supply a client bound to the current bearer token.
//
// This module constructs no Supabase client, reads no environment variable,
// extracts no token, uses no service-role key, calls no `fetch`, performs no
// route matching, performs no logging, schedules no timer, caches nothing,
// holds no mutable global state, exposes no generic RPC executor, performs no
// dynamic dispatch and reads no business table.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";
import type {
  ApiV1TaskPriority,
  ApiV1TaskStatus,
  ApiV1TaskType,
} from "../btpm-api/routes/tasks.ts";

/** Exact database wrappers invoked by this module. */
const API_V1_CREATE_TASK_FUNCTION_NAME = "api_v1_create_task";
const API_V1_UPDATE_TASK_FUNCTION_NAME = "api_v1_update_task";

/**
 * API-Q Task Create Step 2 — fixed MCP-source wrapper
 * (`public.mcp_v1_create_task`, accepted in Task Create Step 1).
 */
const MCP_V1_CREATE_TASK_FUNCTION_NAME = "mcp_v1_create_task";

/**
 * API-Q Task Update Step 2 — fixed MCP-source wrapper
 * (`public.mcp_v1_update_task`, accepted in Task Update Step 1).
 */
const MCP_V1_UPDATE_TASK_FUNCTION_NAME = "mcp_v1_update_task";

/**
 * API-Q Task Reorder Step 2 — fixed MCP-source wrapper
 * (`public.mcp_v1_reorder_tasks`, accepted in Task Reorder Step 1).
 */
const MCP_V1_REORDER_TASKS_FUNCTION_NAME = "mcp_v1_reorder_tasks";

/**
 * API-Q Task Plan Step 2 — fixed MCP-source wrapper
 * (`public.mcp_v1_plan_task`, accepted in Task Plan Step 1).
 */
const MCP_V1_PLAN_TASK_FUNCTION_NAME = "mcp_v1_plan_task";



/**
 * The only two Task-create wrapper names this module may ever invoke. The
 * wrapper name is never caller-provided: each exported adapter binds exactly
 * one member of this closed type.
 */
type CreateTaskFunctionName =
  | typeof API_V1_CREATE_TASK_FUNCTION_NAME
  | typeof MCP_V1_CREATE_TASK_FUNCTION_NAME;

/**
 * The only two Task-update wrapper names this module may ever invoke. The
 * wrapper name is never caller-provided: each exported adapter binds exactly
 * one member of this closed type.
 */
type UpdateTaskFunctionName =
  | typeof API_V1_UPDATE_TASK_FUNCTION_NAME
  | typeof MCP_V1_UPDATE_TASK_FUNCTION_NAME;

/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;
const SAFE_METADATA_PATTERN = /^[A-Za-z0-9._~:@/-]{1,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:@/+!=-]{1,255}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const RESULT_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|z|[+-]\d{2}(?::?\d{2})?)$/;

const RESULT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const STATUSES: ReadonlySet<string> = new Set([
  "planned",
  "active",
  "completed",
  "on_hold",
  "cancelled",
]);

const PRIORITIES: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
  "critical",
]);

const TASK_TYPES: ReadonlySet<string> = new Set([
  "milestone",
  "deliverable",
  "work_item",
  "decision",
  "review",
]);

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export interface ApiV1CreateTaskInput {
  readonly expectedOauthClientId: string;
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
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1UpdateTaskInput {
  readonly expectedOauthClientId: string;
  readonly taskId: string;
  readonly expectedUpdatedAt: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: ApiV1TaskStatus | null;
  readonly priority: ApiV1TaskPriority | null;
  readonly taskType: ApiV1TaskType | null;
  readonly estimatedHours: number | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1CreateTaskRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _phase_id: string;
  readonly _name: string;
  readonly _description: string | null;
  readonly _status: string;
  readonly _priority: string;
  readonly _task_type: string;
  readonly _start_date: string | null;
  readonly _due_date: string | null;
  readonly _estimated_hours: number | null;
  readonly _sort_order: number | null;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

export interface ApiV1UpdateTaskRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _task_id: string;
  readonly _expected_updated_at: string;
  readonly _name: string;
  readonly _description: string | null;
  readonly _status: string | null;
  readonly _priority: string | null;
  readonly _task_type: string | null;
  readonly _estimated_hours: number | null;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

/** Minimal structural RPC client contract. */
export interface ApiV1TaskRpcClient {
  rpc(
    functionName: string,
    args:
      | ApiV1CreateTaskRpcArgs
      | ApiV1UpdateTaskRpcArgs
      | ApiV1ReorderTasksRpcArgs
      | ApiV1PlanTaskRpcArgs
      // API-M.11C — the final two accepted Task wrapper argument shapes.
      | ApiV1AssignTaskRpcArgs
      | ApiV1TransitionTaskRpcArgs,
  ): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------

export interface ApiV1CreateTaskSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "replayed";
  readonly taskId: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly status: ApiV1TaskStatus;
  readonly priority: ApiV1TaskPriority;
  readonly taskType: ApiV1TaskType;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly estimatedHours: number | null;
  readonly sortOrder: number;
  readonly isArchived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly shiftedSiblingCount: number | null;
}

/**
 * Canonical parent-Phase planning-window constraint surfaced verbatim from the
 * accepted wrapper. It is NOT a success: no Task was created.
 */
export interface ApiV1CreateTaskConfirmationRequiredResult {
  readonly ok: false;
  readonly outcome: "confirmation_required";
  readonly code: "extend_phase_window_required";
  readonly projectId: string;
  readonly phaseId: string;
  readonly phaseStartDate: string | null;
  readonly phaseTargetEndDate: string | null;
  readonly requestedTaskStartDate: string | null;
  readonly requestedTaskDueDate: string | null;
  readonly requiredPhaseStartDate: string | null;
  readonly requiredPhaseTargetEndDate: string | null;
}

export interface ApiV1CreateTaskNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

/**
 * API-Q Task Create Contract Parity Correction TCC-1 — the canonical
 * baselined-Project Task date requirement, surfaced verbatim from the accepted
 * wrapper as a bounded, actionable invalid code. No Task was created.
 */
export interface ApiV1CreateTaskDatesRequiredResult {
  readonly ok: false;
  readonly outcome: "invalid";
  readonly code: "task_dates_required";
}

export type ApiV1CreateTaskResult =
  | ApiV1CreateTaskSuccessResult
  | ApiV1CreateTaskConfirmationRequiredResult
  | ApiV1CreateTaskDatesRequiredResult
  | ApiV1CreateTaskNegativeResult;


export interface ApiV1UpdateTaskSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly taskId: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly status: ApiV1TaskStatus;
  readonly priority: ApiV1TaskPriority;
  readonly taskType: ApiV1TaskType;
  readonly estimatedHours: number | null;
  readonly updatedAt: string;
}

export interface ApiV1UpdateTaskNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export interface ApiV1UpdateTaskConflictResult {
  readonly ok: false;
  readonly outcome: "conflict";
  readonly code: "stale_task";
}

export type ApiV1UpdateTaskResult =
  | ApiV1UpdateTaskSuccessResult
  | ApiV1UpdateTaskNegativeResult
  | ApiV1UpdateTaskConflictResult;

const CREATE_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "taskId",
  "projectId",
  "phaseId",
  "status",
  "priority",
  "taskType",
  "startDate",
  "dueDate",
  "estimatedHours",
  "sortOrder",
  "isArchived",
  "createdAt",
  "updatedAt",
  "shiftedSiblingCount",
]);

const CREATE_CONFIRMATION_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "code",
  "projectId",
  "phaseId",
  "phaseStartDate",
  "phaseTargetEndDate",
  "requestedTaskStartDate",
  "requestedTaskDueDate",
  "requiredPhaseStartDate",
  "requiredPhaseTargetEndDate",
]);

const UPDATE_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "taskId",
  "projectId",
  "phaseId",
  "status",
  "priority",
  "taskType",
  "estimatedHours",
  "updatedAt",
]);

const NEGATIVE_KEYS: ReadonlyArray<string> = Object.freeze(["ok", "outcome"]);
const CONFLICT_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "code",
]);

const NEGATIVE_OUTCOMES: ReadonlySet<string> = new Set([
  "invalid",
  "not_authorized",
  "idempotency_conflict",
  "idempotency_pending",
]);

// -----------------------------------------------------------------------------
// Validation helpers
// -----------------------------------------------------------------------------

function internal(cause?: unknown): never {
  throw new ApiHttpError("internal_error", cause);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function requireUuid(value: unknown): string {
  if (typeof value !== "string") internal();
  if (value === NIL_UUID) internal();
  if (!apiUuidSchema.safeParse(value).success) internal();
  return value;
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
): T {
  if (typeof value !== "string" || !allowed.has(value)) internal();
  return value as T;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== "string" || !RESULT_TIMESTAMP_PATTERN.test(value)) {
    internal();
  }
  return value;
}

function requireNullableDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !RESULT_DATE_PATTERN.test(value)) internal();
  return value;
}

function requireNonNegativeInteger(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    internal();
  }
  return value;
}

function requireNullableNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return requireNonNegativeInteger(value);
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") internal();
  return value;
}

function requireNullableEstimatedHours(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    internal();
  }
  return value;
}

function assertValidExpectedOauthClientId(value: unknown): string {
  if (typeof value !== "string") internal();
  if (value.length < 1 || value.length > 255) internal();
  if (!EXPECTED_OAUTH_CLIENT_ID_PATTERN.test(value)) internal();
  return value;
}

function assertSafeMetadata(value: unknown): string {
  if (typeof value !== "string" || !SAFE_METADATA_PATTERN.test(value)) {
    internal();
  }
  return value;
}

function assertIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    internal();
  }
  return value;
}

function assertPayloadHash(value: unknown): string {
  if (typeof value !== "string" || !SHA256_HEX_PATTERN.test(value)) internal();
  return value;
}

function assertName(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) internal();
  return value;
}

function assertNullableDescription(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") internal();
  return value;
}

function assertInputNullableDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !RESULT_DATE_PATTERN.test(value)) internal();
  return value;
}

function assertInputNullableSortOrder(value: unknown): number | null {
  if (value === null) return null;
  return requireNonNegativeInteger(value);
}

function assertInputNullableEstimatedHours(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    internal();
  }
  return value;
}

function assertInputNullableEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
): string | null {
  if (value === null) return null;
  return requireEnum(value, allowed);
}

function assertRpcClient(
  client: unknown,
): asserts client is ApiV1TaskRpcClient {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    internal();
  }
}

function unwrapRpcEnvelope(result: unknown): unknown {
  if (!isPlainObject(result)) internal();
  if (!("data" in result) || !("error" in result)) internal();
  const error = result.error;
  if (error !== null && error !== undefined) {
    if (isPlainObject(error) && error.code === SQLSTATE_INSUFFICIENT_PRIVILEGE) {
      throw new ApiHttpError("not_authorized", error);
    }
    throw new ApiHttpError("internal_error", error);
  }
  if (error === undefined) internal();
  return result.data;
}

// -----------------------------------------------------------------------------
// Result mappers
// -----------------------------------------------------------------------------

function toCreateResult(data: unknown): ApiV1CreateTaskResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === false) {
    // The accepted M.10A wrapper persists a safe `confirmation_required`
    // create result as a COMPLETED idempotency result and, on replay, returns
    // it relabelled `outcome: "replayed"`. That is a legitimate confirmation,
    // not an internal error. Exactly these two labels are accepted, and only
    // with the complete confirmation keyset and exact code; everything else
    // still fails closed. The HTTP layer never observes `ok:false` +
    // `replayed`.
    if (
      data.outcome === "confirmation_required" || data.outcome === "replayed"
    ) {
      assertExactKeys(data, CREATE_CONFIRMATION_KEYS);
      if (data.code !== "extend_phase_window_required") internal();
      return Object.freeze({
        ok: false,
        outcome: "confirmation_required" as const,
        code: "extend_phase_window_required" as const,
        projectId: requireUuid(data.projectId),
        phaseId: requireUuid(data.phaseId),
        phaseStartDate: requireNullableDate(data.phaseStartDate),
        phaseTargetEndDate: requireNullableDate(data.phaseTargetEndDate),
        requestedTaskStartDate: requireNullableDate(
          data.requestedTaskStartDate,
        ),
        requestedTaskDueDate: requireNullableDate(data.requestedTaskDueDate),
        requiredPhaseStartDate: requireNullableDate(
          data.requiredPhaseStartDate,
        ),
        requiredPhaseTargetEndDate: requireNullableDate(
          data.requiredPhaseTargetEndDate,
        ),
      });
    }

    // API-Q Task Create Contract Parity Correction TCC-1 — the bounded
    // baselined-Project Task date requirement. Exactly this code is accepted,
    // with exactly this keyset; everything else still fails closed.
    if (data.outcome === "invalid" && "code" in data) {
      assertExactKeys(data, CONFLICT_KEYS);
      if (data.code !== "task_dates_required") internal();
      return Object.freeze({
        ok: false,
        outcome: "invalid" as const,
        code: "task_dates_required" as const,
      });
    }

    assertExactKeys(data, NEGATIVE_KEYS);

    const outcome = data.outcome;
    if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
      internal();
    }
    return Object.freeze({
      ok: false,
      outcome: outcome as ApiV1CreateTaskNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, CREATE_SUCCESS_KEYS);
  const outcome = data.outcome;
  if (outcome !== "applied" && outcome !== "replayed") internal();

  return Object.freeze({
    ok: true,
    outcome,
    taskId: requireUuid(data.taskId),
    projectId: requireUuid(data.projectId),
    phaseId: requireUuid(data.phaseId),
    status: requireEnum<ApiV1TaskStatus>(data.status, STATUSES),
    priority: requireEnum<ApiV1TaskPriority>(data.priority, PRIORITIES),
    taskType: requireEnum<ApiV1TaskType>(data.taskType, TASK_TYPES),
    startDate: requireNullableDate(data.startDate),
    dueDate: requireNullableDate(data.dueDate),
    estimatedHours: requireNullableEstimatedHours(data.estimatedHours),
    sortOrder: requireNonNegativeInteger(data.sortOrder),
    isArchived: requireBoolean(data.isArchived),
    createdAt: requireTimestamp(data.createdAt),
    updatedAt: requireTimestamp(data.updatedAt),
    shiftedSiblingCount: requireNullableNonNegativeInteger(
      data.shiftedSiblingCount,
    ),
  });
}

function toUpdateResult(data: unknown): ApiV1UpdateTaskResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === false) {
    if (data.outcome === "conflict") {
      assertExactKeys(data, CONFLICT_KEYS);
      if (data.code !== "stale_task") internal();
      return Object.freeze({
        ok: false,
        outcome: "conflict" as const,
        code: "stale_task" as const,
      });
    }
    assertExactKeys(data, NEGATIVE_KEYS);
    const outcome = data.outcome;
    if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
      internal();
    }
    return Object.freeze({
      ok: false,
      outcome: outcome as ApiV1UpdateTaskNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, UPDATE_SUCCESS_KEYS);
  const outcome = data.outcome;
  if (
    outcome !== "applied" && outcome !== "no_change" && outcome !== "replayed"
  ) {
    internal();
  }

  return Object.freeze({
    ok: true,
    outcome,
    taskId: requireUuid(data.taskId),
    projectId: requireUuid(data.projectId),
    phaseId: requireUuid(data.phaseId),
    status: requireEnum<ApiV1TaskStatus>(data.status, STATUSES),
    priority: requireEnum<ApiV1TaskPriority>(data.priority, PRIORITIES),
    taskType: requireEnum<ApiV1TaskType>(data.taskType, TASK_TYPES),
    estimatedHours: requireNullableEstimatedHours(data.estimatedHours),
    updatedAt: requireTimestamp(data.updatedAt),
  });
}

// -----------------------------------------------------------------------------
// Adapters
// -----------------------------------------------------------------------------

/**
 * Single shared Task-create RPC invocation. Not exported: the wrapper name is
 * constrained by the closed `CreateTaskFunctionName` type and is supplied only
 * by the two exported adapters below, never by any caller.
 *
 * The database remains the sole authority for scope derivation, Project
 * Connected App enablement, PMG authorization, persistence, idempotency and the
 * canonical parent-Phase planning-window rule.
 */
async function invokeCreateTask(
  functionName: CreateTaskFunctionName,
  client: ApiV1TaskRpcClient,
  input: ApiV1CreateTaskInput,
): Promise<ApiV1CreateTaskResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const phaseId = requireUuid(input.phaseId);
  const name = assertName(input.name);
  const description = assertNullableDescription(input.description);
  const status = requireEnum<ApiV1TaskStatus>(input.status, STATUSES);
  const priority = requireEnum<ApiV1TaskPriority>(input.priority, PRIORITIES);
  const taskType = requireEnum<ApiV1TaskType>(input.taskType, TASK_TYPES);
  const startDate = assertInputNullableDate(input.startDate);
  const dueDate = assertInputNullableDate(input.dueDate);
  const estimatedHours = assertInputNullableEstimatedHours(
    input.estimatedHours,
  );
  const sortOrder = assertInputNullableSortOrder(input.sortOrder);
  const requestId = assertSafeMetadata(input.requestId);
  const correlationId = assertSafeMetadata(input.correlationId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = assertPayloadHash(input.payloadHash);

  let result: unknown;
  try {
    result = await client.rpc(functionName, {
      _expected_oauth_client_id: expectedOauthClientId,
      _phase_id: phaseId,
      _name: name,
      _description: description,
      _status: status,
      _priority: priority,
      _task_type: taskType,
      _start_date: startDate,
      _due_date: dueDate,
      _estimated_hours: estimatedHours,
      _sort_order: sortOrder,
      _request_id: requestId,
      _correlation_id: correlationId,
      _idempotency_key: idempotencyKey,
      _payload_hash: payloadHash,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toCreateResult(unwrapRpcEnvelope(result));
}

/**
 * Invoke the accepted `public.api_v1_create_task` wrapper (REST /
 * `external_api` source channel). The database remains the sole authority for
 * scope derivation, Project Connected App enablement, PMG authorization,
 * persistence, idempotency and the canonical parent-Phase planning-window rule.
 */
export function createApiV1Task(
  client: ApiV1TaskRpcClient,
  input: ApiV1CreateTaskInput,
): Promise<ApiV1CreateTaskResult> {
  return invokeCreateTask(
    API_V1_CREATE_TASK_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * API-Q Task Create Step 2 — invoke the accepted `public.mcp_v1_create_task`
 * wrapper (MCP / `mcp` source channel).
 *
 * Identical validation, RPC argument construction, envelope handling and
 * bounded result mapping as the REST function — including the canonical
 * `confirmation_required` / `extend_phase_window_required` treatment and the
 * replayed-confirmation normalization. The ONLY difference is the fixed
 * wrapper name, which the database uses to derive the trusted source channel.
 */
export function createMcpV1Task(
  client: ApiV1TaskRpcClient,
  input: ApiV1CreateTaskInput,
): Promise<ApiV1CreateTaskResult> {
  return invokeCreateTask(
    MCP_V1_CREATE_TASK_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * Single shared Task-update RPC invocation. Not exported: the wrapper name is
 * constrained by the closed `UpdateTaskFunctionName` type and is supplied only
 * by the two exported adapters below, never by any caller.
 *
 * The database remains the sole authority for scope containment, Project
 * Connected App enablement, PMG authorization, optimistic concurrency,
 * persistence, provenance, audit and idempotency.
 */
async function invokeUpdateTask(
  functionName: UpdateTaskFunctionName,
  client: ApiV1TaskRpcClient,
  input: ApiV1UpdateTaskInput,
): Promise<ApiV1UpdateTaskResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const taskId = requireUuid(input.taskId);
  const expectedUpdatedAt = requireTimestamp(input.expectedUpdatedAt);
  const name = assertName(input.name);
  const description = assertNullableDescription(input.description);
  const status = assertInputNullableEnum(input.status, STATUSES);
  const priority = assertInputNullableEnum(input.priority, PRIORITIES);
  const taskType = assertInputNullableEnum(input.taskType, TASK_TYPES);
  const estimatedHours = assertInputNullableEstimatedHours(
    input.estimatedHours,
  );
  const requestId = assertSafeMetadata(input.requestId);
  const correlationId = assertSafeMetadata(input.correlationId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = assertPayloadHash(input.payloadHash);

  let result: unknown;
  try {
    result = await client.rpc(functionName, {
      _expected_oauth_client_id: expectedOauthClientId,
      _task_id: taskId,
      _expected_updated_at: expectedUpdatedAt,
      _name: name,
      _description: description,
      _status: status,
      _priority: priority,
      _task_type: taskType,
      _estimated_hours: estimatedHours,
      _request_id: requestId,
      _correlation_id: correlationId,
      _idempotency_key: idempotencyKey,
      _payload_hash: payloadHash,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toUpdateResult(unwrapRpcEnvelope(result));
}

/**
 * Invoke the accepted `public.api_v1_update_task` wrapper (REST /
 * `external_api` source channel). Only Task metadata is updated; Phase
 * movement, planning, ordering, assignment and execution transition remain
 * outside this adapter.
 */
export function updateApiV1Task(
  client: ApiV1TaskRpcClient,
  input: ApiV1UpdateTaskInput,
): Promise<ApiV1UpdateTaskResult> {
  return invokeUpdateTask(
    API_V1_UPDATE_TASK_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * API-Q Task Update Step 2 — invoke the accepted `public.mcp_v1_update_task`
 * wrapper (MCP / `mcp` source channel).
 *
 * Identical validation, 13-key RPC argument construction, envelope handling and
 * bounded result mapping as the REST function — including unchanged
 * `stale_task` optimistic-concurrency treatment. The ONLY difference is the
 * fixed wrapper name, which the database uses to derive the trusted source
 * channel.
 */
export function updateMcpV1Task(
  client: ApiV1TaskRpcClient,
  input: ApiV1UpdateTaskInput,
): Promise<ApiV1UpdateTaskResult> {
  return invokeUpdateTask(
    MCP_V1_UPDATE_TASK_FUNCTION_NAME,
    client,
    input,
  );
}

// =============================================================================
// API-M.11B — Explicit RPC adapters for the two remaining external Task
// planning-surface mutations: reorder and planning.
//
// Exactly two additional accepted API-M.10B database wrappers are invoked:
// `public.api_v1_reorder_tasks` and `public.api_v1_plan_task`. The canonical
// commands `public.reorder_tasks`, `public.apply_task_planning_change` and any
// preview helper are NEVER called from the Edge Function. No generic RPC
// executor and no dynamic function name exists.
// =============================================================================

/** Exact database wrappers invoked by the API-M.11B adapters. */
const API_V1_REORDER_TASKS_FUNCTION_NAME = "api_v1_reorder_tasks";
const API_V1_PLAN_TASK_FUNCTION_NAME = "api_v1_plan_task";

/**
 * The only two Task-reorder wrapper names this module may ever invoke. The
 * wrapper name is never caller-provided: each exported adapter binds exactly
 * one member of this closed type.
 */
type ReorderTasksFunctionName =
  | typeof API_V1_REORDER_TASKS_FUNCTION_NAME
  | typeof MCP_V1_REORDER_TASKS_FUNCTION_NAME;

/**
 * The only two Task-planning wrapper names this module may ever invoke. The
 * wrapper name is never caller-provided: each exported adapter binds exactly
 * one member of this closed type.
 */
type PlanTaskFunctionName =
  | typeof API_V1_PLAN_TASK_FUNCTION_NAME
  | typeof MCP_V1_PLAN_TASK_FUNCTION_NAME;




// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export interface ApiV1ReorderTaskRowInput {
  readonly taskId: string;
  readonly expectedUpdatedAt: string;
  readonly sortOrder: number;
}

export interface ApiV1ReorderTasksInput {
  readonly expectedOauthClientId: string;
  readonly phaseId: string;
  readonly rows: readonly ApiV1ReorderTaskRowInput[];
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

/** Exact canonical reorder row representation expected by `reorder_tasks`. */
export interface ApiV1ReorderTaskRpcRow {
  readonly id: string;
  readonly expected_updated_at: string;
  readonly new_sort_order: number;
}

export interface ApiV1ReorderTasksRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _phase_id: string;
  readonly _rows: readonly ApiV1ReorderTaskRpcRow[];
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

export interface ApiV1PlanTaskInput {
  readonly expectedOauthClientId: string;
  readonly taskId: string;
  readonly expectedUpdatedAt: string;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly confirmParentExtension: boolean;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1PlanTaskRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _task_id: string;
  readonly _expected_updated_at: string;
  readonly _new_start: string | null;
  readonly _new_due: string | null;
  readonly _confirm_parent_extension: boolean;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------

export interface ApiV1ReorderedTask {
  readonly taskId: string;
  readonly sortOrder: number;
  readonly updatedAt: string;
}

export interface ApiV1ReorderTasksSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly projectId: string;
  readonly phaseId: string;
  readonly submittedCount: number;
  readonly changedCount: number;
  readonly orderedTasks: readonly ApiV1ReorderedTask[];
}

/**
 * Normalized stale-order conflict. The accepted wrapper returns either the
 * direct conflict (with the stale identities) or, on failed-idempotency replay,
 * only the stable failure code. Both are normalized to this single semantic;
 * `staleTaskIds` is empty when the replay variant carried no identities.
 */
export interface ApiV1ReorderTasksConflictResult {
  readonly ok: false;
  readonly outcome: "conflict";
  readonly code: "stale_task_order";
  readonly projectId: string | null;
  readonly phaseId: string | null;
  readonly staleTaskIds: readonly string[];
}

export interface ApiV1ReorderTasksNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1ReorderTasksResult =
  | ApiV1ReorderTasksSuccessResult
  | ApiV1ReorderTasksConflictResult
  | ApiV1ReorderTasksNegativeResult;

export interface ApiV1PlanTaskSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly taskId: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly updatedAt: string;
  readonly phaseExtended: boolean;
  readonly phaseStartDate: string | null;
  readonly phaseTargetEndDate: string | null;
}

export interface ApiV1PlanTaskConfirmationRequiredResult {
  readonly ok: false;
  readonly outcome: "confirmation_required";
  readonly code: "extend_phase_window_required";
  readonly taskId: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly phaseCurrentStart: string | null;
  readonly phaseCurrentTargetEnd: string | null;
  readonly phaseProposedStart: string | null;
  readonly phaseProposedTargetEnd: string | null;
  readonly requestedTaskStart: string | null;
  readonly requestedTaskDue: string | null;
}

export interface ApiV1PlanTaskConflictResult {
  readonly ok: false;
  readonly outcome: "conflict";
  readonly code: "stale_task_planning";
  readonly currentUpdatedAt: string | null;
}

export interface ApiV1PlanTaskNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1PlanTaskResult =
  | ApiV1PlanTaskSuccessResult
  | ApiV1PlanTaskConfirmationRequiredResult
  | ApiV1PlanTaskConflictResult
  | ApiV1PlanTaskNegativeResult;

const REORDER_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "projectId",
  "phaseId",
  "submittedCount",
  "changedCount",
  "orderedTasks",
]);

const REORDER_ORDERED_TASK_KEYS: ReadonlyArray<string> = Object.freeze([
  "taskId",
  "sortOrder",
  "updatedAt",
]);

const REORDER_DIRECT_CONFLICT_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "code",
  "projectId",
  "phaseId",
  "staleTaskIds",
]);

const PLAN_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "taskId",
  "projectId",
  "phaseId",
  "startDate",
  "dueDate",
  "updatedAt",
  "phaseExtended",
  "phaseStartDate",
  "phaseTargetEndDate",
]);

const PLAN_CONFIRMATION_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "code",
  "taskId",
  "projectId",
  "phaseId",
  "phaseCurrentStart",
  "phaseCurrentTargetEnd",
  "phaseProposedStart",
  "phaseProposedTargetEnd",
  "requestedTaskStart",
  "requestedTaskDue",
]);

const PLAN_DIRECT_CONFLICT_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "code",
  "currentUpdatedAt",
]);

function requireNullableTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requireTimestamp(value);
}

// -----------------------------------------------------------------------------
// Result mappers
// -----------------------------------------------------------------------------

function toReorderResult(data: unknown): ApiV1ReorderTasksResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === false) {
    if (data.outcome === "conflict") {
      // Exactly two bounded variants: the direct stale conflict and the
      // failed-idempotency replay carrying only the stable failure code.
      if (data.code !== "stale_task_order") internal();
      const keys = Object.keys(data);
      if (keys.length === CONFLICT_KEYS.length) {
        assertExactKeys(data, CONFLICT_KEYS);
        return Object.freeze({
          ok: false,
          outcome: "conflict" as const,
          code: "stale_task_order" as const,
          projectId: null,
          phaseId: null,
          staleTaskIds: Object.freeze([]) as readonly string[],
        });
      }
      assertExactKeys(data, REORDER_DIRECT_CONFLICT_KEYS);
      const rawStale = data.staleTaskIds;
      if (!Array.isArray(rawStale)) internal();
      const staleTaskIds = Object.freeze(
        rawStale.map((entry) => requireUuid(entry)),
      );
      return Object.freeze({
        ok: false,
        outcome: "conflict" as const,
        code: "stale_task_order" as const,
        projectId: requireUuid(data.projectId),
        phaseId: requireUuid(data.phaseId),
        staleTaskIds,
      });
    }

    assertExactKeys(data, NEGATIVE_KEYS);
    const outcome = data.outcome;
    if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
      internal();
    }
    return Object.freeze({
      ok: false,
      outcome: outcome as ApiV1ReorderTasksNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, REORDER_SUCCESS_KEYS);
  const outcome = data.outcome;
  if (
    outcome !== "applied" && outcome !== "no_change" && outcome !== "replayed"
  ) {
    internal();
  }

  const rawOrdered = data.orderedTasks;
  if (!Array.isArray(rawOrdered)) internal();
  const orderedTasks = Object.freeze(
    rawOrdered.map((entry) => {
      if (!isPlainObject(entry)) internal();
      assertExactKeys(entry, REORDER_ORDERED_TASK_KEYS);
      return Object.freeze({
        taskId: requireUuid(entry.taskId),
        sortOrder: requireNonNegativeInteger(entry.sortOrder),
        updatedAt: requireTimestamp(entry.updatedAt),
      });
    }),
  );

  return Object.freeze({
    ok: true,
    outcome,
    projectId: requireUuid(data.projectId),
    phaseId: requireUuid(data.phaseId),
    submittedCount: requireNonNegativeInteger(data.submittedCount),
    changedCount: requireNonNegativeInteger(data.changedCount),
    orderedTasks,
  });
}

function toPlanResult(data: unknown): ApiV1PlanTaskResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === false) {
    // The accepted M.10B wrapper persists a safe `confirmation_required`
    // planning result as a COMPLETED idempotency result and, on replay,
    // returns it relabelled `outcome: "replayed"`. Exactly these two labels
    // are accepted, and only with the complete confirmation keyset.
    if (
      data.code === "extend_phase_window_required" &&
      (data.outcome === "confirmation_required" || data.outcome === "replayed")
    ) {
      assertExactKeys(data, PLAN_CONFIRMATION_KEYS);
      return Object.freeze({
        ok: false,
        // Normalized: the HTTP consumer never observes `ok:false` + `replayed`.
        outcome: "confirmation_required" as const,
        code: "extend_phase_window_required" as const,
        taskId: requireUuid(data.taskId),
        projectId: requireUuid(data.projectId),
        phaseId: requireUuid(data.phaseId),
        phaseCurrentStart: requireNullableDate(data.phaseCurrentStart),
        phaseCurrentTargetEnd: requireNullableDate(data.phaseCurrentTargetEnd),
        phaseProposedStart: requireNullableDate(data.phaseProposedStart),
        phaseProposedTargetEnd: requireNullableDate(
          data.phaseProposedTargetEnd,
        ),
        requestedTaskStart: requireNullableDate(data.requestedTaskStart),
        requestedTaskDue: requireNullableDate(data.requestedTaskDue),
      });
    }

    if (data.outcome === "conflict") {
      if (data.code !== "stale_task_planning") internal();
      const keys = Object.keys(data);
      if (keys.length === CONFLICT_KEYS.length) {
        assertExactKeys(data, CONFLICT_KEYS);
        return Object.freeze({
          ok: false,
          outcome: "conflict" as const,
          code: "stale_task_planning" as const,
          currentUpdatedAt: null,
        });
      }
      assertExactKeys(data, PLAN_DIRECT_CONFLICT_KEYS);
      return Object.freeze({
        ok: false,
        outcome: "conflict" as const,
        code: "stale_task_planning" as const,
        currentUpdatedAt: requireNullableTimestamp(data.currentUpdatedAt),
      });
    }

    assertExactKeys(data, NEGATIVE_KEYS);
    const outcome = data.outcome;
    if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
      internal();
    }
    return Object.freeze({
      ok: false,
      outcome: outcome as ApiV1PlanTaskNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, PLAN_SUCCESS_KEYS);
  const outcome = data.outcome;
  if (
    outcome !== "applied" && outcome !== "no_change" && outcome !== "replayed"
  ) {
    internal();
  }

  return Object.freeze({
    ok: true,
    outcome,
    taskId: requireUuid(data.taskId),
    projectId: requireUuid(data.projectId),
    phaseId: requireUuid(data.phaseId),
    startDate: requireNullableDate(data.startDate),
    dueDate: requireNullableDate(data.dueDate),
    updatedAt: requireTimestamp(data.updatedAt),
    phaseExtended: requireBoolean(data.phaseExtended),
    phaseStartDate: requireNullableDate(data.phaseStartDate),
    phaseTargetEndDate: requireNullableDate(data.phaseTargetEndDate),
  });
}

// -----------------------------------------------------------------------------
// Adapters
// -----------------------------------------------------------------------------

/**
 * Single shared Task-reorder RPC invocation. Not exported: the wrapper name is
 * constrained by the closed `ReorderTasksFunctionName` type and is supplied
 * only by the two exported adapters below, never by any caller.
 *
 * The canonical command `public.reorder_tasks` remains the sole owner of the
 * reorder algorithm, sibling-set completeness, ordering uniqueness and stale-row
 * semantics; this adapter only converts validated transport rows to their exact
 * canonical representation.
 */
async function invokeReorderTasks(
  functionName: ReorderTasksFunctionName,
  client: ApiV1TaskRpcClient,
  input: ApiV1ReorderTasksInput,
): Promise<ApiV1ReorderTasksResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const phaseId = requireUuid(input.phaseId);
  if (!Array.isArray(input.rows) || input.rows.length === 0) internal();

  const rows: ApiV1ReorderTaskRpcRow[] = input.rows.map((row) => {
    if (!isPlainObject(row)) internal();
    return Object.freeze({
      id: requireUuid(row.taskId),
      expected_updated_at: requireTimestamp(row.expectedUpdatedAt),
      new_sort_order: requireNonNegativeInteger(row.sortOrder),
    });
  });

  const requestId = assertSafeMetadata(input.requestId);
  const correlationId = assertSafeMetadata(input.correlationId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = assertPayloadHash(input.payloadHash);

  let result: unknown;
  try {
    result = await client.rpc(functionName, {
      _expected_oauth_client_id: expectedOauthClientId,
      _phase_id: phaseId,
      _rows: Object.freeze(rows),
      _request_id: requestId,
      _correlation_id: correlationId,
      _idempotency_key: idempotencyKey,
      _payload_hash: payloadHash,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toReorderResult(unwrapRpcEnvelope(result));
}

/**
 * Invoke the accepted `public.api_v1_reorder_tasks` wrapper (REST /
 * `external_api` source channel).
 */
export function reorderApiV1Tasks(
  client: ApiV1TaskRpcClient,
  input: ApiV1ReorderTasksInput,
): Promise<ApiV1ReorderTasksResult> {
  return invokeReorderTasks(
    API_V1_REORDER_TASKS_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * API-Q Task Reorder Step 2 — invoke the accepted
 * `public.mcp_v1_reorder_tasks` wrapper (MCP / `mcp` source channel).
 *
 * Identical validation, RPC argument construction, envelope handling and
 * bounded result mapping as the REST function — including the canonical
 * `stale_task_order` treatment and applied / no_change / replayed handling.
 * The ONLY difference is the fixed wrapper name, which the database uses to
 * derive the trusted source channel.
 */
export function reorderMcpV1Tasks(
  client: ApiV1TaskRpcClient,
  input: ApiV1ReorderTasksInput,
): Promise<ApiV1ReorderTasksResult> {
  return invokeReorderTasks(
    MCP_V1_REORDER_TASKS_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * Single shared Task-planning RPC invocation. Not exported: the wrapper name is
 * constrained by the closed `PlanTaskFunctionName` type and is supplied only by
 * the two exported adapters below, never by any caller.
 *
 * This adapter changes planning dates only and never calls
 * `apply_task_planning_change` or `preview_task_planning_change` directly. The
 * canonical command remains the sole owner of authority, concurrency and
 * Phase-window semantics; `_expected_updated_at` and
 * `_confirm_parent_extension` are forwarded unchanged.
 */
async function invokePlanTask(
  functionName: PlanTaskFunctionName,
  client: ApiV1TaskRpcClient,
  input: ApiV1PlanTaskInput,
): Promise<ApiV1PlanTaskResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const taskId = requireUuid(input.taskId);
  const expectedUpdatedAt = requireTimestamp(input.expectedUpdatedAt);
  const startDate = assertInputNullableDate(input.startDate);
  const dueDate = assertInputNullableDate(input.dueDate);
  const confirmParentExtension = requireBoolean(input.confirmParentExtension);
  const requestId = assertSafeMetadata(input.requestId);
  const correlationId = assertSafeMetadata(input.correlationId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = assertPayloadHash(input.payloadHash);

  let result: unknown;
  try {
    result = await client.rpc(functionName, {
      _expected_oauth_client_id: expectedOauthClientId,
      _task_id: taskId,
      _expected_updated_at: expectedUpdatedAt,
      _new_start: startDate,
      _new_due: dueDate,
      _confirm_parent_extension: confirmParentExtension,
      _request_id: requestId,
      _correlation_id: correlationId,
      _idempotency_key: idempotencyKey,
      _payload_hash: payloadHash,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toPlanResult(unwrapRpcEnvelope(result));
}

/**
 * Invoke the accepted `public.api_v1_plan_task` wrapper (REST /
 * `external_api` source channel). This adapter changes planning dates only and
 * never calls `apply_task_planning_change` or any preview helper directly.
 */
export function planApiV1Task(
  client: ApiV1TaskRpcClient,
  input: ApiV1PlanTaskInput,
): Promise<ApiV1PlanTaskResult> {
  return invokePlanTask(API_V1_PLAN_TASK_FUNCTION_NAME, client, input);
}

/**
 * API-Q Task Plan Step 2 — invoke the accepted `public.mcp_v1_plan_task`
 * wrapper (MCP / `mcp` source channel).
 *
 * Identical validation, RPC argument construction, envelope handling and
 * bounded result mapping as the REST function — including the canonical
 * `stale_task_planning` conflict and the `extend_phase_window_required`
 * confirmation. The ONLY difference is the fixed wrapper name, which the
 * database uses to derive the trusted source channel.
 */
export function planMcpV1Task(
  client: ApiV1TaskRpcClient,
  input: ApiV1PlanTaskInput,
): Promise<ApiV1PlanTaskResult> {
  return invokePlanTask(MCP_V1_PLAN_TASK_FUNCTION_NAME, client, input);
}


// =============================================================================
// API-M.11C — Task assignment + execution transition adapters.
//
// Both adapters call ONLY their accepted API-F wrapper. They never call
// `apply_task_assignment_change`, `apply_task_execution_change`, any TAE
// stakeholder command or any table directly, and they never widen the canonical
// result. Workspace-membership eligibility, actual-date rules, completed-task
// locking, reopen requirements, rollups and execution history remain owned by
// the canonical commands.
// =============================================================================

const API_V1_ASSIGN_TASK_FUNCTION_NAME = "api_v1_assign_task";
// API-Q Task Assign Step 1 — fixed MCP-source wrapper.
const MCP_V1_ASSIGN_TASK_FUNCTION_NAME = "mcp_v1_assign_task";
const API_V1_TRANSITION_TASK_FUNCTION_NAME = "api_v1_transition_task";
// API-Q Task Transition Step 1 — fixed MCP-source wrapper.
const MCP_V1_TRANSITION_TASK_FUNCTION_NAME = "mcp_v1_transition_task";

/**
 * Closed internal union of the only two accepted Task Assign wrappers. It is
 * never exported and never caller-selectable.
 */
type AssignTaskFunctionName =
  | typeof API_V1_ASSIGN_TASK_FUNCTION_NAME
  | typeof MCP_V1_ASSIGN_TASK_FUNCTION_NAME;

/**
 * Closed internal union of the only two accepted Task Transition wrappers. It
 * is never exported and never caller-selectable.
 */
type TransitionTaskFunctionName =
  | typeof API_V1_TRANSITION_TASK_FUNCTION_NAME
  | typeof MCP_V1_TRANSITION_TASK_FUNCTION_NAME;

/**
 * External transition INPUT vocabulary. `null` means "do not change status".
 * Deliberately narrower than the canonical Task status set.
 */
const TRANSITION_INPUT_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "completed",
]);

/**
 * Canonical BTPM Task status vocabulary echoed back by the wrapper on success.
 * `apply_task_execution_change` returns `COALESCE(_status, task.status)`, so any
 * canonical status may be returned even when the request kept `status: null`.
 */
const TRANSITION_RESULT_STATUSES: ReadonlySet<string> = STATUSES;

export interface ApiV1AssignTaskInput {
  readonly expectedOauthClientId: string;
  readonly taskId: string;
  /** `null` clears the assignment. */
  readonly assigneeId: string | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1AssignTaskRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _task_id: string;
  readonly _assignee_id: string | null;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

export interface ApiV1TransitionTaskInput {
  readonly expectedOauthClientId: string;
  readonly taskId: string;
  readonly expectedUpdatedAt: string;
  readonly setActualStart: boolean;
  readonly actualStartDate: string | null;
  readonly setActualEnd: boolean;
  readonly actualEndDate: string | null;
  readonly status: string | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1TransitionTaskRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _task_id: string;
  readonly _expected_updated_at: string;
  readonly _set_actual_start: boolean;
  readonly _actual_start_date: string | null;
  readonly _set_actual_end: boolean;
  readonly _actual_end_date: string | null;
  readonly _status: string | null;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

export interface ApiV1AssignTaskSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly taskId: string;
  readonly projectId: string;
  readonly oldAssigneeId: string | null;
  readonly newAssigneeId: string | null;
}

export interface ApiV1AssignTaskNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1AssignTaskResult =
  | ApiV1AssignTaskSuccessResult
  | ApiV1AssignTaskNegativeResult;

export interface ApiV1TransitionTaskSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly taskId: string;
  readonly projectId: string;
  readonly phaseId: string;
  readonly status: string;
  readonly actualStartDate: string | null;
  readonly actualEndDate: string | null;
  readonly updatedAt: string;
}

export interface ApiV1TransitionTaskConflictResult {
  readonly ok: false;
  readonly outcome: "conflict";
  readonly code: "stale_task";
}

export interface ApiV1TransitionTaskNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

/**
 * MCP-HARDENING-C4 — the single bounded Task Transition invalid result that
 * carries a machine-readable lifecycle reason. The canonical completed-Task
 * lock rejected the attempted execution/status change because the Task must be
 * reopened through BTPM's dedicated reopen flow first. The semantic class stays
 * `invalid` so REST compatibility is preserved, and no raw database text,
 * SQLSTATE or Task narrative is ever carried.
 */
export interface ApiV1TransitionTaskReopenRequiredResult {
  readonly ok: false;
  readonly outcome: "invalid";
  readonly code: "task_reopen_required";
}

export type ApiV1TransitionTaskResult =
  | ApiV1TransitionTaskSuccessResult
  | ApiV1TransitionTaskConflictResult
  | ApiV1TransitionTaskReopenRequiredResult
  | ApiV1TransitionTaskNegativeResult;

const ASSIGN_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "taskId",
  "projectId",
  "oldAssigneeId",
  "newAssigneeId",
]);

const TRANSITION_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "taskId",
  "projectId",
  "phaseId",
  "status",
  "actualStartDate",
  "actualEndDate",
  "updatedAt",
]);

function requireNullableUuid(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requireUuid(value);
}

function toAssignResult(data: unknown): ApiV1AssignTaskResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === false) {
    assertExactKeys(data, NEGATIVE_KEYS);
    const outcome = data.outcome;
    if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
      internal();
    }
    return Object.freeze({
      ok: false,
      outcome: outcome as ApiV1AssignTaskNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, ASSIGN_SUCCESS_KEYS);
  const outcome = data.outcome;
  if (
    outcome !== "applied" && outcome !== "no_change" && outcome !== "replayed"
  ) {
    internal();
  }
  return Object.freeze({
    ok: true,
    outcome,
    taskId: requireUuid(data.taskId),
    projectId: requireUuid(data.projectId),
    oldAssigneeId: requireNullableUuid(data.oldAssigneeId),
    newAssigneeId: requireNullableUuid(data.newAssigneeId),
  });
}

function toTransitionResult(data: unknown): ApiV1TransitionTaskResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === false) {
    if (data.outcome === "conflict") {
      if (data.code !== "stale_task") internal();
      assertExactKeys(data, CONFLICT_KEYS);
      return Object.freeze({
        ok: false,
        outcome: "conflict" as const,
        code: "stale_task" as const,
      });
    }

    // MCP-HARDENING-C4 — the single bounded invalid result that carries a
    // machine-readable lifecycle code. It must be recognised BEFORE generic
    // invalid handling, accepts exactly ok/outcome/code, and rejects any other
    // code value, extra field or raw database text.
    if (data.outcome === "invalid" && "code" in data) {
      if (data.code !== "task_reopen_required") internal();
      assertExactKeys(data, CONFLICT_KEYS);
      return Object.freeze({
        ok: false,
        outcome: "invalid" as const,
        code: "task_reopen_required" as const,
      });
    }



    assertExactKeys(data, NEGATIVE_KEYS);
    const outcome = data.outcome;
    if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
      internal();
    }
    return Object.freeze({
      ok: false,
      outcome: outcome as ApiV1TransitionTaskNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, TRANSITION_SUCCESS_KEYS);
  const outcome = data.outcome;
  if (
    outcome !== "applied" && outcome !== "no_change" && outcome !== "replayed"
  ) {
    internal();
  }
  const status = data.status;
  if (typeof status !== "string" || !TRANSITION_RESULT_STATUSES.has(status)) {
    internal();
  }
  return Object.freeze({
    ok: true,
    outcome,
    taskId: requireUuid(data.taskId),
    projectId: requireUuid(data.projectId),
    phaseId: requireUuid(data.phaseId),
    status,
    actualStartDate: requireNullableDate(data.actualStartDate),
    actualEndDate: requireNullableDate(data.actualEndDate),
    updatedAt: requireTimestamp(data.updatedAt),
  });
}

/**
 * Single shared Task Assign invocation. The wrapper name is one of exactly two
 * fixed internal constants; the database derives the trusted source channel
 * from it. There is no optimistic-concurrency token for assignment by
 * canonical design, and `assigneeId: null` clears the assignment.
 */
async function invokeAssignTask(
  functionName: AssignTaskFunctionName,
  client: ApiV1TaskRpcClient,
  input: ApiV1AssignTaskInput,
): Promise<ApiV1AssignTaskResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const taskId = requireUuid(input.taskId);
  const assigneeId = input.assigneeId === null
    ? null
    : requireUuid(input.assigneeId);
  const requestId = assertSafeMetadata(input.requestId);
  const correlationId = assertSafeMetadata(input.correlationId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = assertPayloadHash(input.payloadHash);

  let result: unknown;
  try {
    result = await client.rpc(functionName, {
      _expected_oauth_client_id: expectedOauthClientId,
      _task_id: taskId,
      _assignee_id: assigneeId,
      _request_id: requestId,
      _correlation_id: correlationId,
      _idempotency_key: idempotencyKey,
      _payload_hash: payloadHash,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toAssignResult(unwrapRpcEnvelope(result));
}

/**
 * Invoke the accepted `public.api_v1_assign_task` wrapper (REST /
 * `external_api` source channel).
 */
export function assignApiV1Task(
  client: ApiV1TaskRpcClient,
  input: ApiV1AssignTaskInput,
): Promise<ApiV1AssignTaskResult> {
  return invokeAssignTask(API_V1_ASSIGN_TASK_FUNCTION_NAME, client, input);
}

/**
 * API-Q Task Assign Step 2 — invoke the accepted `public.mcp_v1_assign_task`
 * wrapper (MCP / `mcp` source channel).
 *
 * Identical validation, RPC argument construction, envelope handling and
 * bounded result mapping as the REST function. The ONLY difference is the
 * fixed wrapper name.
 */
export function assignMcpV1Task(
  client: ApiV1TaskRpcClient,
  input: ApiV1AssignTaskInput,
): Promise<ApiV1AssignTaskResult> {
  return invokeAssignTask(MCP_V1_ASSIGN_TASK_FUNCTION_NAME, client, input);
}

/**
 * Single shared Task Transition invocation. The wrapper name is one of exactly
 * two fixed internal constants; the database derives the trusted source channel
 * from it. `expectedUpdatedAt` is the mandatory concurrency token and is never
 * read, refreshed or repaired here; a `false` set-flag always carries `null`.
 */
async function invokeTransitionTask(
  functionName: TransitionTaskFunctionName,
  client: ApiV1TaskRpcClient,
  input: ApiV1TransitionTaskInput,
): Promise<ApiV1TransitionTaskResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const taskId = requireUuid(input.taskId);
  const expectedUpdatedAt = requireTimestamp(input.expectedUpdatedAt);
  const setActualStart = requireBoolean(input.setActualStart);
  const setActualEnd = requireBoolean(input.setActualEnd);
  const actualStartDate = assertInputNullableDate(input.actualStartDate);
  const actualEndDate = assertInputNullableDate(input.actualEndDate);
  if (setActualStart === false && actualStartDate !== null) internal();
  if (setActualEnd === false && actualEndDate !== null) internal();
  const status = input.status === null || input.status === undefined
    ? null
    : requireEnum(input.status, TRANSITION_INPUT_STATUSES);
  const requestId = assertSafeMetadata(input.requestId);
  const correlationId = assertSafeMetadata(input.correlationId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = assertPayloadHash(input.payloadHash);

  let result: unknown;
  try {
    result = await client.rpc(functionName, {
      _expected_oauth_client_id: expectedOauthClientId,
      _task_id: taskId,
      _expected_updated_at: expectedUpdatedAt,
      _set_actual_start: setActualStart,
      _actual_start_date: actualStartDate,
      _set_actual_end: setActualEnd,
      _actual_end_date: actualEndDate,
      _status: status,
      _request_id: requestId,
      _correlation_id: correlationId,
      _idempotency_key: idempotencyKey,
      _payload_hash: payloadHash,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toTransitionResult(unwrapRpcEnvelope(result));
}

/**
 * Invoke the accepted `public.api_v1_transition_task` wrapper (REST /
 * `external_api` source channel).
 */
export function transitionApiV1Task(
  client: ApiV1TaskRpcClient,
  input: ApiV1TransitionTaskInput,
): Promise<ApiV1TransitionTaskResult> {
  return invokeTransitionTask(
    API_V1_TRANSITION_TASK_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * API-Q Task Transition Step 2 — invoke the accepted
 * `public.mcp_v1_transition_task` wrapper (MCP / `mcp` source channel).
 *
 * Identical validation, RPC argument construction, envelope handling and
 * bounded result mapping as the REST function. The ONLY difference is the
 * fixed wrapper name.
 */
export function transitionMcpV1Task(
  client: ApiV1TaskRpcClient,
  input: ApiV1TransitionTaskInput,
): Promise<ApiV1TransitionTaskResult> {
  return invokeTransitionTask(
    MCP_V1_TRANSITION_TASK_FUNCTION_NAME,
    client,
    input,
  );
}
