// API-M.8A — Explicit RPC adapters for the two external Phase mutations.
//
// This module calls exactly two accepted API-M.7A database wrappers,
// `public.api_v1_create_phase` and `public.api_v1_update_phase`, through a
// caller-supplied Supabase RPC client. The caller-supplied client is the trust
// boundary: the runtime must supply a client bound to the current bearer token.
//
// This module constructs no Supabase client, reads no environment variable,
// extracts no token, uses no service-role key, calls no `fetch`, performs no
// route matching, performs no logging, schedules no timer, caches nothing,
// holds no mutable global state, exposes no generic RPC executor, and performs
// no dynamic dispatch.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";
import type {
  ApiV1PhaseStatus,
  ApiV1PhaseType,
} from "../btpm-api/routes/phases.ts";

/** Exact database wrappers invoked by this module. */
const API_V1_CREATE_PHASE_FUNCTION_NAME = "api_v1_create_phase";
const API_V1_UPDATE_PHASE_FUNCTION_NAME = "api_v1_update_phase";

/**
 * API-Q Phase Create Step 2 — fixed MCP-source wrapper
 * (`public.mcp_v1_create_phase`, accepted in Phase Create Step 1).
 */
const MCP_V1_CREATE_PHASE_FUNCTION_NAME = "mcp_v1_create_phase";

/**
 * The only two Phase-create wrapper names this module may ever invoke. The
 * wrapper name is never caller-provided: each exported adapter binds exactly
 * one member of this closed type.
 */
type CreatePhaseFunctionName =
  | typeof API_V1_CREATE_PHASE_FUNCTION_NAME
  | typeof MCP_V1_CREATE_PHASE_FUNCTION_NAME;

/**
 * API-Q Phase Update Step 2 — fixed MCP-source wrapper
 * (`public.mcp_v1_update_phase`, accepted in Phase Update Step 1).
 */
const MCP_V1_UPDATE_PHASE_FUNCTION_NAME = "mcp_v1_update_phase";

/**
 * The only two Phase-update wrapper names this module may ever invoke. The
 * wrapper name is never caller-provided: each exported adapter binds exactly
 * one member of this closed type.
 */
type UpdatePhaseFunctionName =
  | typeof API_V1_UPDATE_PHASE_FUNCTION_NAME
  | typeof MCP_V1_UPDATE_PHASE_FUNCTION_NAME;

/**
 * API-Q Phase Reorder Step 2 — fixed MCP-source wrapper
 * (`public.mcp_v1_reorder_phases`, accepted in Phase Reorder Step 1).
 */
const MCP_V1_REORDER_PHASES_FUNCTION_NAME = "mcp_v1_reorder_phases";

/**
 * API-Q Phase Plan Step 2 — fixed MCP-source wrapper
 * (`public.mcp_v1_plan_phase`, accepted in Phase Plan Step 1).
 */
const MCP_V1_PLAN_PHASE_FUNCTION_NAME = "mcp_v1_plan_phase";






/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;
const SAFE_METADATA_PATTERN = /^[A-Za-z0-9._~:@/-]{1,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:@/+!=-]{1,255}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

// Bounded timestamp shape accepted from the wrapper (RFC3339 or PostgreSQL
// rendering, always timezone-aware).
const RESULT_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|z|[+-]\d{2}(?::?\d{2})?)$/;

/** Bounded calendar-date shape accepted from the wrapper. */
const RESULT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const STATUSES: ReadonlySet<string> = new Set([
  "planned",
  "active",
  "completed",
  "on_hold",
  "cancelled",
]);

const PHASE_TYPES: ReadonlySet<string> = new Set([
  "work_item",
  "milestone",
  "deliverable",
  "decision",
  "review",
]);

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export interface ApiV1CreatePhaseInput {
  readonly expectedOauthClientId: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: ApiV1PhaseStatus;
  readonly phaseType: ApiV1PhaseType;
  readonly startDate: string | null;
  readonly targetEndDate: string | null;
  readonly sortOrder: number | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1UpdatePhaseInput {
  readonly expectedOauthClientId: string;
  readonly phaseId: string;
  readonly expectedUpdatedAt: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: ApiV1PhaseStatus;
  readonly phaseType: ApiV1PhaseType;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1CreatePhaseRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _project_id: string;
  readonly _name: string;
  readonly _description: string | null;
  readonly _status: string;
  readonly _phase_type: string;
  readonly _start_date: string | null;
  readonly _target_end_date: string | null;
  readonly _sort_order: number | null;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

export interface ApiV1UpdatePhaseRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _phase_id: string;
  readonly _expected_updated_at: string;
  readonly _name: string;
  readonly _description: string | null;
  readonly _status: string;
  readonly _phase_type: string;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

/** Minimal structural RPC client contract. */
export interface ApiV1PhaseRpcClient {
  rpc(
    functionName: string,
    args:
      | ApiV1CreatePhaseRpcArgs
      | ApiV1UpdatePhaseRpcArgs
      | ApiV1ReorderPhasesRpcArgs
      | ApiV1PlanPhaseRpcArgs,
  ): Promise<unknown>;
}


// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------

export interface ApiV1CreatePhaseSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "replayed";
  readonly phaseId: string;
  readonly projectId: string;
  readonly status: ApiV1PhaseStatus;
  readonly phaseType: ApiV1PhaseType;
  readonly startDate: string | null;
  readonly targetEndDate: string | null;
  readonly sortOrder: number;
  readonly isArchived: boolean | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly shiftedSiblingCount: number | null;
}

/**
 * Canonical Project planning-window constraint surfaced verbatim from the
 * accepted wrapper. It is NOT a success: no Phase was created.
 */
export interface ApiV1CreatePhaseConfirmationRequiredResult {
  readonly ok: false;
  readonly outcome: "confirmation_required";
  readonly code: "extend_project_window_required";
  readonly projectId: string;
  readonly projectStartDate: string | null;
  readonly projectTargetEndDate: string | null;
  readonly requestedPhaseStartDate: string | null;
  readonly requestedPhaseTargetEndDate: string | null;
  readonly requiredProjectStartDate: string | null;
  readonly requiredProjectTargetEndDate: string | null;
}

/**
 * API-Q Phase Create Contract Parity Correction PCC-1 — a baselined Project
 * requires BOTH planned Phase dates. This is the existing invalid-request
 * class, narrowed by one bounded code. No Phase was created.
 */
export interface ApiV1CreatePhaseDatesRequiredResult {
  readonly ok: false;
  readonly outcome: "invalid";
  readonly code: "phase_dates_required";
}

export interface ApiV1CreatePhaseNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1CreatePhaseResult =
  | ApiV1CreatePhaseSuccessResult
  | ApiV1CreatePhaseConfirmationRequiredResult
  | ApiV1CreatePhaseDatesRequiredResult
  | ApiV1CreatePhaseNegativeResult;

export interface ApiV1UpdatePhaseSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly phaseId: string;
  readonly projectId: string;
  readonly status: ApiV1PhaseStatus;
  readonly phaseType: ApiV1PhaseType;
  readonly updatedAt: string;
}

export interface ApiV1UpdatePhaseNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export interface ApiV1UpdatePhaseConflictResult {
  readonly ok: false;
  readonly outcome: "conflict";
  readonly code: "stale_phase";
}

export type ApiV1UpdatePhaseResult =
  | ApiV1UpdatePhaseSuccessResult
  | ApiV1UpdatePhaseNegativeResult
  | ApiV1UpdatePhaseConflictResult;

const CREATE_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "phaseId",
  "projectId",
  "status",
  "phaseType",
  "startDate",
  "targetEndDate",
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
  "projectStartDate",
  "projectTargetEndDate",
  "requestedPhaseStartDate",
  "requestedPhaseTargetEndDate",
  "requiredProjectStartDate",
  "requiredProjectTargetEndDate",
]);

// PCC-1 — exactly these three keys are accepted for the bounded
// `phase_dates_required` invalid result.
const CREATE_DATES_REQUIRED_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "code",
]);



const UPDATE_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "phaseId",
  "projectId",
  "status",
  "phaseType",
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

function requireInteger(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value)
  ) {
    internal();
  }
  return value;
}

function requireNullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return requireInteger(value);
}

function requireNullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") internal();
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

function assertPhaseScalars(input: {
  name: unknown;
  description: unknown;
  status: unknown;
  phaseType: unknown;
}): void {
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    internal();
  }
  if (input.description !== null && typeof input.description !== "string") {
    internal();
  }
  requireEnum(input.status, STATUSES);
  requireEnum(input.phaseType, PHASE_TYPES);
}

function assertInputNullableDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !RESULT_DATE_PATTERN.test(value)) internal();
  return value;
}

function assertInputNullableSortOrder(value: unknown): number | null {
  if (value === null) return null;
  const n = requireInteger(value);
  if (n < 0) internal();
  return n;
}

function assertRpcClient(
  client: unknown,
): asserts client is ApiV1PhaseRpcClient {
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

function toCreateResult(data: unknown): ApiV1CreatePhaseResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === false) {
    // API-M.8A-C1 Correction C — the accepted M.7A wrapper persists a safe
    // `confirmation_required` create result as a COMPLETED idempotency result
    // and, on replay, returns it relabelled `outcome: "replayed"`. That is a
    // legitimate confirmation, not an internal error. Exactly these two
    // labels are accepted, and only with the complete confirmation keyset;
    // everything else still fails closed.
    if (
      data.outcome === "confirmation_required" || data.outcome === "replayed"
    ) {
      assertExactKeys(data, CREATE_CONFIRMATION_KEYS);
      if (data.code !== "extend_project_window_required") internal();
      return Object.freeze({
        ok: false,
        // Normalized: the HTTP consumer never observes `ok:false` + `replayed`.
        outcome: "confirmation_required" as const,
        code: "extend_project_window_required" as const,
        projectId: requireUuid(data.projectId),
        projectStartDate: requireNullableDate(data.projectStartDate),
        projectTargetEndDate: requireNullableDate(data.projectTargetEndDate),
        requestedPhaseStartDate: requireNullableDate(
          data.requestedPhaseStartDate,
        ),
        requestedPhaseTargetEndDate: requireNullableDate(
          data.requestedPhaseTargetEndDate,
        ),
        requiredProjectStartDate: requireNullableDate(
          data.requiredProjectStartDate,
        ),
        requiredProjectTargetEndDate: requireNullableDate(
          data.requiredProjectTargetEndDate,
        ),
      });
    }

    // PCC-1 — bounded baselined-Project Phase-date precondition. Exactly
    // `ok` + `outcome` + `code` with the single accepted code value; any other
    // code string, extra field or PMG reason text still fails closed.
    if (data.outcome === "invalid" && data.code !== undefined) {
      assertExactKeys(data, CREATE_DATES_REQUIRED_KEYS);
      if (data.code !== "phase_dates_required") internal();
      return Object.freeze({
        ok: false,
        outcome: "invalid" as const,
        code: "phase_dates_required" as const,
      });
    }


    assertExactKeys(data, NEGATIVE_KEYS);
    const outcome = data.outcome;
    if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
      internal();
    }
    return Object.freeze({
      ok: false,
      outcome: outcome as ApiV1CreatePhaseNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, CREATE_SUCCESS_KEYS);
  const outcome = data.outcome;
  if (outcome !== "applied" && outcome !== "replayed") internal();

  return Object.freeze({
    ok: true,
    outcome,
    phaseId: requireUuid(data.phaseId),
    projectId: requireUuid(data.projectId),
    status: requireEnum<ApiV1PhaseStatus>(data.status, STATUSES),
    phaseType: requireEnum<ApiV1PhaseType>(data.phaseType, PHASE_TYPES),
    startDate: requireNullableDate(data.startDate),
    targetEndDate: requireNullableDate(data.targetEndDate),
    sortOrder: requireInteger(data.sortOrder),
    isArchived: requireNullableBoolean(data.isArchived),
    createdAt: requireTimestamp(data.createdAt),
    updatedAt: requireTimestamp(data.updatedAt),
    shiftedSiblingCount: requireNullableInteger(data.shiftedSiblingCount),
  });
}

function toUpdateResult(data: unknown): ApiV1UpdatePhaseResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === false) {
    if (data.outcome === "conflict") {
      assertExactKeys(data, CONFLICT_KEYS);
      if (data.code !== "stale_phase") internal();
      return Object.freeze({
        ok: false,
        outcome: "conflict" as const,
        code: "stale_phase" as const,
      });
    }
    assertExactKeys(data, NEGATIVE_KEYS);
    const outcome = data.outcome;
    if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
      internal();
    }
    return Object.freeze({
      ok: false,
      outcome: outcome as ApiV1UpdatePhaseNegativeResult["outcome"],
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
    phaseId: requireUuid(data.phaseId),
    projectId: requireUuid(data.projectId),
    status: requireEnum<ApiV1PhaseStatus>(data.status, STATUSES),
    phaseType: requireEnum<ApiV1PhaseType>(data.phaseType, PHASE_TYPES),
    updatedAt: requireTimestamp(data.updatedAt),
  });
}

// -----------------------------------------------------------------------------
// Adapters
// -----------------------------------------------------------------------------

/**
 * Single shared Phase-create RPC invocation. Not exported: the wrapper name is
 * constrained by the closed `CreatePhaseFunctionName` type and is supplied only
 * by the two exported adapters below, never by any caller.
 *
 * The database remains the sole authority for scope derivation, Project
 * Connected App enablement, PMG authorization, persistence and idempotency.
 */
async function invokeCreatePhase(
  functionName: CreatePhaseFunctionName,
  client: ApiV1PhaseRpcClient,
  input: ApiV1CreatePhaseInput,
): Promise<ApiV1CreatePhaseResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const projectId = requireUuid(input.projectId);
  assertPhaseScalars(input);
  const startDate = assertInputNullableDate(input.startDate);
  const targetEndDate = assertInputNullableDate(input.targetEndDate);
  const sortOrder = assertInputNullableSortOrder(input.sortOrder);
  const requestId = assertSafeMetadata(input.requestId);
  const correlationId = assertSafeMetadata(input.correlationId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = assertPayloadHash(input.payloadHash);

  let result: unknown;
  try {
    result = await client.rpc(functionName, {
      _expected_oauth_client_id: expectedOauthClientId,
      _project_id: projectId,
      _name: input.name,
      _description: input.description,
      _status: input.status,
      _phase_type: input.phaseType,
      _start_date: startDate,
      _target_end_date: targetEndDate,
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
 * Invoke the accepted `public.api_v1_create_phase` wrapper (REST /
 * `external_api` source channel). The database remains the sole authority for
 * scope derivation, Project Connected App enablement, PMG authorization,
 * persistence and idempotency.
 */
export function createApiV1Phase(
  client: ApiV1PhaseRpcClient,
  input: ApiV1CreatePhaseInput,
): Promise<ApiV1CreatePhaseResult> {
  return invokeCreatePhase(
    API_V1_CREATE_PHASE_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * API-Q Phase Create Step 2 — invoke the accepted
 * `public.mcp_v1_create_phase` wrapper (MCP / `mcp` source channel).
 *
 * Identical validation, RPC argument construction, envelope handling and
 * bounded result mapping as the REST function — including the canonical
 * `confirmation_required` / `extend_project_window_required` treatment and the
 * replayed-confirmation normalization. The ONLY difference is the fixed
 * wrapper name, which the database uses to derive the trusted source channel.
 */
export function createMcpV1Phase(
  client: ApiV1PhaseRpcClient,
  input: ApiV1CreatePhaseInput,
): Promise<ApiV1CreatePhaseResult> {
  return invokeCreatePhase(
    MCP_V1_CREATE_PHASE_FUNCTION_NAME,
    client,
    input,
  );
}


/**
 * Single shared Phase-update RPC invocation. Not exported: the wrapper name is
 * constrained by the closed `UpdatePhaseFunctionName` type and is supplied only
 * by the two exported adapters below, never by any caller.
 *
 * Only Phase metadata is updated; schedule and ordering remain outside this
 * adapter. The database remains the sole authority for containment, Project
 * Connected App enablement, PMG authorization, persistence, idempotency and
 * optimistic concurrency (`stale_phase`).
 */
async function invokeUpdatePhase(
  functionName: UpdatePhaseFunctionName,
  client: ApiV1PhaseRpcClient,
  input: ApiV1UpdatePhaseInput,
): Promise<ApiV1UpdatePhaseResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const phaseId = requireUuid(input.phaseId);
  const expectedUpdatedAt = requireTimestamp(input.expectedUpdatedAt);
  assertPhaseScalars(input);
  const requestId = assertSafeMetadata(input.requestId);
  const correlationId = assertSafeMetadata(input.correlationId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = assertPayloadHash(input.payloadHash);

  let result: unknown;
  try {
    result = await client.rpc(functionName, {
      _expected_oauth_client_id: expectedOauthClientId,
      _phase_id: phaseId,
      _expected_updated_at: expectedUpdatedAt,
      _name: input.name,
      _description: input.description,
      _status: input.status,
      _phase_type: input.phaseType,
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
 * Invoke the accepted `public.api_v1_update_phase` wrapper (REST /
 * `external_api` source channel). Only Phase metadata is updated; schedule and
 * ordering remain outside this adapter.
 */
export function updateApiV1Phase(
  client: ApiV1PhaseRpcClient,
  input: ApiV1UpdatePhaseInput,
): Promise<ApiV1UpdatePhaseResult> {
  return invokeUpdatePhase(
    API_V1_UPDATE_PHASE_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * API-Q Phase Update Step 2 — invoke the accepted
 * `public.mcp_v1_update_phase` wrapper (MCP / `mcp` source channel).
 *
 * Identical validation, RPC argument construction, envelope handling and
 * bounded result mapping as the REST function — including the canonical
 * `stale_phase` treatment and applied / no_change / replayed handling. The ONLY
 * difference is the fixed wrapper name, which the database uses to derive the
 * trusted source channel.
 */
export function updateMcpV1Phase(
  client: ApiV1PhaseRpcClient,
  input: ApiV1UpdatePhaseInput,
): Promise<ApiV1UpdatePhaseResult> {
  return invokeUpdatePhase(
    MCP_V1_UPDATE_PHASE_FUNCTION_NAME,
    client,
    input,
  );
}


// =============================================================================
// API-M.8B — Explicit RPC adapters for the two remaining external Phase
// mutations: reorder and planning.
//
// Exactly two additional accepted API-M.7B database wrappers are invoked:
// `public.api_v1_reorder_phases` and `public.api_v1_plan_phase`. The canonical
// commands `public.reorder_phases`, `public.apply_phase_planning_change` and
// `public.preview_phase_planning_change` are NEVER called from the Edge
// Function. No generic RPC executor and no dynamic function name exists.
// =============================================================================

/** Exact database wrappers invoked by the API-M.8B adapters. */
const API_V1_REORDER_PHASES_FUNCTION_NAME = "api_v1_reorder_phases";
const API_V1_PLAN_PHASE_FUNCTION_NAME = "api_v1_plan_phase";

/**
 * The only two Phase-reorder wrapper names this module may ever invoke. The
 * wrapper name is never caller-provided: each exported adapter binds exactly
 * one member of this closed type.
 */
type ReorderPhasesFunctionName =
  | typeof API_V1_REORDER_PHASES_FUNCTION_NAME
  | typeof MCP_V1_REORDER_PHASES_FUNCTION_NAME;

/**
 * The only two Phase-planning wrapper names this module may ever invoke. The
 * wrapper name is never caller-provided: each exported adapter binds exactly
 * one member of this closed type.
 */
type PlanPhaseFunctionName =
  | typeof API_V1_PLAN_PHASE_FUNCTION_NAME
  | typeof MCP_V1_PLAN_PHASE_FUNCTION_NAME;



// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export interface ApiV1ReorderPhaseRowInput {
  readonly phaseId: string;
  readonly expectedUpdatedAt: string;
  readonly sortOrder: number;
}

export interface ApiV1ReorderPhasesInput {
  readonly expectedOauthClientId: string;
  readonly projectId: string;
  readonly rows: readonly ApiV1ReorderPhaseRowInput[];
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

/** Exact canonical reorder row representation expected by `reorder_phases`. */
export interface ApiV1ReorderPhaseRpcRow {
  readonly id: string;
  readonly expected_updated_at: string;
  readonly new_sort_order: number;
}

export interface ApiV1ReorderPhasesRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _project_id: string;
  readonly _rows: readonly ApiV1ReorderPhaseRpcRow[];
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

export interface ApiV1PlanPhaseInput {
  readonly expectedOauthClientId: string;
  readonly phaseId: string;
  readonly expectedUpdatedAt: string;
  readonly startDate: string | null;
  readonly targetEndDate: string | null;
  readonly confirmParentExtension: boolean;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1PlanPhaseRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _phase_id: string;
  readonly _expected_updated_at: string;
  readonly _new_start: string | null;
  readonly _new_end: string | null;
  readonly _confirm_parent_extension: boolean;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------

export interface ApiV1ReorderedPhase {
  readonly phaseId: string;
  readonly sortOrder: number;
  readonly updatedAt: string;
}

export interface ApiV1ReorderPhasesSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly projectId: string;
  readonly submittedCount: number;
  readonly changedCount: number;
  readonly orderedPhases: readonly ApiV1ReorderedPhase[];
}

/**
 * Normalized stale-order conflict. The accepted wrapper returns either the
 * direct conflict (with the stale identities) or, on failed-idempotency replay,
 * only the stable failure code. Both are normalized to this single semantic;
 * `stalePhaseIds` is empty when the replay variant carried no identities.
 */
export interface ApiV1ReorderPhasesConflictResult {
  readonly ok: false;
  readonly outcome: "conflict";
  readonly code: "stale_phase_order";
  readonly projectId: string | null;
  readonly stalePhaseIds: readonly string[];
}

export interface ApiV1ReorderPhasesNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1ReorderPhasesResult =
  | ApiV1ReorderPhasesSuccessResult
  | ApiV1ReorderPhasesConflictResult
  | ApiV1ReorderPhasesNegativeResult;

export interface ApiV1PlanPhaseSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly phaseId: string;
  readonly projectId: string;
  readonly startDate: string | null;
  readonly targetEndDate: string | null;
  readonly updatedAt: string;
  readonly projectExtended: boolean;
  readonly projectStartDate: string | null;
  readonly projectTargetEndDate: string | null;
}

export interface ApiV1PlanPhaseConfirmationRequiredResult {
  readonly ok: false;
  readonly outcome: "confirmation_required";
  readonly code: "extend_project_window_required";
  readonly projectId: string;
  readonly projectCurrentStart: string | null;
  readonly projectCurrentTargetEnd: string | null;
  readonly projectProposedStart: string | null;
  readonly projectProposedTargetEnd: string | null;
  readonly requestedPhaseStart: string | null;
  readonly requestedPhaseEnd: string | null;
}

export interface ApiV1PlanPhaseConflictResult {
  readonly ok: false;
  readonly outcome: "conflict";
  readonly code: "stale_phase_planning";
  readonly currentUpdatedAt: string | null;
}

export interface ApiV1PlanPhaseNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1PlanPhaseResult =
  | ApiV1PlanPhaseSuccessResult
  | ApiV1PlanPhaseConfirmationRequiredResult
  | ApiV1PlanPhaseConflictResult
  | ApiV1PlanPhaseNegativeResult;

const REORDER_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "projectId",
  "submittedCount",
  "changedCount",
  "orderedPhases",
]);

const REORDER_ORDERED_PHASE_KEYS: ReadonlyArray<string> = Object.freeze([
  "phaseId",
  "sortOrder",
  "updatedAt",
]);

const REORDER_DIRECT_CONFLICT_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "code",
  "projectId",
  "stalePhaseIds",
]);

const PLAN_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "phaseId",
  "projectId",
  "startDate",
  "targetEndDate",
  "updatedAt",
  "projectExtended",
  "projectStartDate",
  "projectTargetEndDate",
]);

const PLAN_CONFIRMATION_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "code",
  "projectId",
  "projectCurrentStart",
  "projectCurrentTargetEnd",
  "projectProposedStart",
  "projectProposedTargetEnd",
  "requestedPhaseStart",
  "requestedPhaseEnd",
]);

const PLAN_DIRECT_CONFLICT_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "code",
  "currentUpdatedAt",
]);

// -----------------------------------------------------------------------------
// Validation helpers
// -----------------------------------------------------------------------------

function requireNonNegativeInteger(value: unknown): number {
  const n = requireInteger(value);
  if (n < 0) internal();
  return n;
}

function requireNullableTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requireTimestamp(value);
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") internal();
  return value;
}

// -----------------------------------------------------------------------------
// Result mappers
// -----------------------------------------------------------------------------

function toReorderResult(data: unknown): ApiV1ReorderPhasesResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === false) {
    if (data.outcome === "conflict") {
      // Exactly two bounded variants: the direct stale conflict and the
      // failed-idempotency replay carrying only the stable failure code.
      if (data.code !== "stale_phase_order") internal();
      const keys = Object.keys(data);
      if (keys.length === CONFLICT_KEYS.length) {
        assertExactKeys(data, CONFLICT_KEYS);
        return Object.freeze({
          ok: false,
          outcome: "conflict" as const,
          code: "stale_phase_order" as const,
          projectId: null,
          stalePhaseIds: Object.freeze([]) as readonly string[],
        });
      }
      assertExactKeys(data, REORDER_DIRECT_CONFLICT_KEYS);
      const rawStale = data.stalePhaseIds;
      if (!Array.isArray(rawStale)) internal();
      const stalePhaseIds = Object.freeze(
        rawStale.map((entry) => requireUuid(entry)),
      );
      return Object.freeze({
        ok: false,
        outcome: "conflict" as const,
        code: "stale_phase_order" as const,
        projectId: requireUuid(data.projectId),
        stalePhaseIds,
      });
    }

    assertExactKeys(data, NEGATIVE_KEYS);
    const outcome = data.outcome;
    if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
      internal();
    }
    return Object.freeze({
      ok: false,
      outcome: outcome as ApiV1ReorderPhasesNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, REORDER_SUCCESS_KEYS);
  const outcome = data.outcome;
  if (
    outcome !== "applied" && outcome !== "no_change" && outcome !== "replayed"
  ) {
    internal();
  }

  const rawOrdered = data.orderedPhases;
  if (!Array.isArray(rawOrdered)) internal();
  const orderedPhases = Object.freeze(
    rawOrdered.map((entry) => {
      if (!isPlainObject(entry)) internal();
      assertExactKeys(entry, REORDER_ORDERED_PHASE_KEYS);
      return Object.freeze({
        phaseId: requireUuid(entry.phaseId),
        sortOrder: requireNonNegativeInteger(entry.sortOrder),
        updatedAt: requireTimestamp(entry.updatedAt),
      });
    }),
  );

  return Object.freeze({
    ok: true,
    outcome,
    projectId: requireUuid(data.projectId),
    submittedCount: requireNonNegativeInteger(data.submittedCount),
    changedCount: requireNonNegativeInteger(data.changedCount),
    orderedPhases,
  });
}

function toPlanResult(data: unknown): ApiV1PlanPhaseResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === false) {
    // The accepted M.7B wrapper persists a safe `confirmation_required`
    // planning result as a COMPLETED idempotency result and, on replay,
    // returns it relabelled `outcome: "replayed"`. Exactly these two labels
    // are accepted, and only with the complete confirmation keyset.
    if (
      data.code === "extend_project_window_required" &&
      (data.outcome === "confirmation_required" || data.outcome === "replayed")
    ) {
      assertExactKeys(data, PLAN_CONFIRMATION_KEYS);
      return Object.freeze({
        ok: false,
        // Normalized: the HTTP consumer never observes `ok:false` + `replayed`.
        outcome: "confirmation_required" as const,
        code: "extend_project_window_required" as const,
        projectId: requireUuid(data.projectId),
        projectCurrentStart: requireNullableDate(data.projectCurrentStart),
        projectCurrentTargetEnd: requireNullableDate(
          data.projectCurrentTargetEnd,
        ),
        projectProposedStart: requireNullableDate(data.projectProposedStart),
        projectProposedTargetEnd: requireNullableDate(
          data.projectProposedTargetEnd,
        ),
        requestedPhaseStart: requireNullableDate(data.requestedPhaseStart),
        requestedPhaseEnd: requireNullableDate(data.requestedPhaseEnd),
      });
    }

    if (data.outcome === "conflict") {
      if (data.code !== "stale_phase_planning") internal();
      const keys = Object.keys(data);
      if (keys.length === CONFLICT_KEYS.length) {
        assertExactKeys(data, CONFLICT_KEYS);
        return Object.freeze({
          ok: false,
          outcome: "conflict" as const,
          code: "stale_phase_planning" as const,
          currentUpdatedAt: null,
        });
      }
      assertExactKeys(data, PLAN_DIRECT_CONFLICT_KEYS);
      return Object.freeze({
        ok: false,
        outcome: "conflict" as const,
        code: "stale_phase_planning" as const,
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
      outcome: outcome as ApiV1PlanPhaseNegativeResult["outcome"],
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
    phaseId: requireUuid(data.phaseId),
    projectId: requireUuid(data.projectId),
    startDate: requireNullableDate(data.startDate),
    targetEndDate: requireNullableDate(data.targetEndDate),
    updatedAt: requireTimestamp(data.updatedAt),
    projectExtended: requireBoolean(data.projectExtended),
    projectStartDate: requireNullableDate(data.projectStartDate),
    projectTargetEndDate: requireNullableDate(data.projectTargetEndDate),
  });
}

// -----------------------------------------------------------------------------
// Adapters
// -----------------------------------------------------------------------------

/**
 * Single shared Phase-reorder RPC invocation. Not exported: the wrapper name is
 * constrained by the closed `ReorderPhasesFunctionName` type and is supplied
 * only by the two exported adapters below, never by any caller.
 *
 * The canonical command `public.reorder_phases` remains the sole owner of the
 * reorder algorithm, sibling-set completeness, ordering uniqueness and stale-row
 * semantics; this adapter only converts validated transport rows to their exact
 * canonical representation.
 */
async function invokeReorderPhases(
  functionName: ReorderPhasesFunctionName,
  client: ApiV1PhaseRpcClient,
  input: ApiV1ReorderPhasesInput,
): Promise<ApiV1ReorderPhasesResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const projectId = requireUuid(input.projectId);
  if (!Array.isArray(input.rows) || input.rows.length === 0) internal();

  const rows: ApiV1ReorderPhaseRpcRow[] = input.rows.map((row) => {
    if (!isPlainObject(row)) internal();
    return Object.freeze({
      id: requireUuid(row.phaseId),
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
      _project_id: projectId,
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
 * Invoke the accepted `public.api_v1_reorder_phases` wrapper (REST /
 * `external_api` source channel).
 */
export function reorderApiV1Phases(
  client: ApiV1PhaseRpcClient,
  input: ApiV1ReorderPhasesInput,
): Promise<ApiV1ReorderPhasesResult> {
  return invokeReorderPhases(
    API_V1_REORDER_PHASES_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * API-Q Phase Reorder Step 2 — invoke the accepted
 * `public.mcp_v1_reorder_phases` wrapper (MCP / `mcp` source channel).
 *
 * Identical validation, RPC argument construction, envelope handling and
 * bounded result mapping as the REST function — including the canonical
 * `stale_phase_order` treatment and applied / no_change / replayed handling.
 * The ONLY difference is the fixed wrapper name, which the database uses to
 * derive the trusted source channel.
 */
export function reorderMcpV1Phases(
  client: ApiV1PhaseRpcClient,
  input: ApiV1ReorderPhasesInput,
): Promise<ApiV1ReorderPhasesResult> {
  return invokeReorderPhases(
    MCP_V1_REORDER_PHASES_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * Single shared Phase-planning RPC invocation. Not exported: the wrapper name is
 * constrained by the closed `PlanPhaseFunctionName` type and is supplied only by
 * the two exported adapters below, never by any caller.
 *
 * This adapter changes planning dates only and never calls
 * `apply_phase_planning_change` or `preview_phase_planning_change` directly. The
 * canonical command remains the sole owner of authority, concurrency and
 * Project-window semantics; `_expected_updated_at` and
 * `_confirm_parent_extension` are forwarded unchanged.
 */
async function invokePlanPhase(
  functionName: PlanPhaseFunctionName,
  client: ApiV1PhaseRpcClient,
  input: ApiV1PlanPhaseInput,
): Promise<ApiV1PlanPhaseResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const phaseId = requireUuid(input.phaseId);
  const expectedUpdatedAt = requireTimestamp(input.expectedUpdatedAt);
  const startDate = assertInputNullableDate(input.startDate);
  const targetEndDate = assertInputNullableDate(input.targetEndDate);
  const confirmParentExtension = requireBoolean(input.confirmParentExtension);
  const requestId = assertSafeMetadata(input.requestId);
  const correlationId = assertSafeMetadata(input.correlationId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = assertPayloadHash(input.payloadHash);

  let result: unknown;
  try {
    result = await client.rpc(functionName, {
      _expected_oauth_client_id: expectedOauthClientId,
      _phase_id: phaseId,
      _expected_updated_at: expectedUpdatedAt,
      _new_start: startDate,
      _new_end: targetEndDate,
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
 * Invoke the accepted `public.api_v1_plan_phase` wrapper (REST /
 * `external_api` source channel).
 */
export function planApiV1Phase(
  client: ApiV1PhaseRpcClient,
  input: ApiV1PlanPhaseInput,
): Promise<ApiV1PlanPhaseResult> {
  return invokePlanPhase(API_V1_PLAN_PHASE_FUNCTION_NAME, client, input);
}

/**
 * API-Q Phase Plan Step 2 — invoke the accepted `public.mcp_v1_plan_phase`
 * wrapper (MCP / `mcp` source channel).
 *
 * Identical validation, RPC argument construction, envelope handling and
 * bounded result mapping as the REST function — including the canonical
 * `stale_phase_planning` conflict and the `extend_project_window_required`
 * confirmation. The ONLY difference is the fixed wrapper name, which the
 * database uses to derive the trusted source channel.
 */
export function planMcpV1Phase(
  client: ApiV1PhaseRpcClient,
  input: ApiV1PlanPhaseInput,
): Promise<ApiV1PlanPhaseResult> {
  return invokePlanPhase(MCP_V1_PLAN_PHASE_FUNCTION_NAME, client, input);
}

