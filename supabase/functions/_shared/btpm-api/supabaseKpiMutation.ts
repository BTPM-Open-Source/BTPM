// KPI-4B — Explicit RPC adapter for the single external Project KPI definition
// create command (`kpis:create`).
//
// This module calls exactly one accepted KPI-4A database wrapper,
// `public.api_v1_create_kpi`, through a caller-supplied Supabase RPC client.
// The caller-supplied client is the trust boundary: the runtime must supply a
// client bound to the current bearer token.
//
// This module constructs no Supabase client, reads no environment variable,
// extracts no token, uses no service-role key, calls no `fetch`, performs no
// route matching, performs no direct table access, executes no
// SQL, performs no encryption or decryption, duplicates no authorization logic,
// performs no logging, schedules no timer, caches nothing, holds no mutable
// global state, and exposes no generic/dynamic RPC executor.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";

/** The single accepted REST-source database wrapper invoked by this module. */
const API_V1_CREATE_KPI_FUNCTION_NAME = "api_v1_create_kpi";

/** The single accepted MCP-source database wrapper invoked by this module. */
const MCP_V1_CREATE_KPI_FUNCTION_NAME = "mcp_v1_create_kpi";

/**
 * The only two wrapper names this module may ever invoke. The union is closed
 * at compile time and neither literal is ever derived from caller input.
 */
type CreateKpiFunctionName =
  | typeof API_V1_CREATE_KPI_FUNCTION_NAME
  | typeof MCP_V1_CREATE_KPI_FUNCTION_NAME;

/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;
const SAFE_METADATA_PATTERN = /^[A-Za-z0-9._~:@/-]{1,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:@/+!=-]{1,255}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const PG_INT32_MIN = -2147483648;
const PG_INT32_MAX = 2147483647;

const TARGET_DIRECTIONS: ReadonlySet<string> = new Set([
  "increase",
  "decrease",
  "maintain",
  "target_exact",
]);
const SOURCE_MODES: ReadonlySet<string> = new Set(["manual", "automatic"]);
const VALUE_TYPES: ReadonlySet<string> = new Set([
  "percent",
  "number",
  "currency",
  "text",
]);
const CADENCES: ReadonlySet<string> = new Set([
  "manual_only",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);
const COMPLETION_METHODS: ReadonlySet<string> = new Set([
  "task_count",
  "duration_weighted",
]);

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export interface ApiV1CreateKpiInput {
  readonly expectedOauthClientId: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string | null;
  readonly unit: string | null;
  readonly targetValue: number | null;
  readonly targetDirection: string;
  readonly sourceMode: string;
  readonly valueType: string;
  readonly cadence: string;
  readonly calculationKey: string | null;
  readonly formulaVersion: number | null;
  readonly completionMethod: string | null;
  readonly commentRequired: boolean;
  readonly actionPlanRequired: boolean;
  readonly autoSnapshotEnabled: boolean;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

/** The exact accepted twenty-argument KPI-4A wrapper signature. */
export interface ApiV1CreateKpiRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _project_id: string;
  readonly _name: string;
  readonly _description: string | null;
  readonly _unit: string | null;
  readonly _target_value: number | null;
  readonly _target_direction: string;
  readonly _source_mode: string;
  readonly _value_type: string;
  readonly _cadence: string;
  readonly _calculation_key: string | null;
  readonly _formula_version: number | null;
  readonly _completion_method: string | null;
  readonly _comment_required: boolean;
  readonly _action_plan_required: boolean;
  readonly _auto_snapshot_enabled: boolean;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

/** Minimal structural RPC client contract for the KPI create wrapper. */
export interface ApiV1KpiMutationRpcClient {
  rpc(
    functionName: string,
    args: ApiV1CreateKpiRpcArgs,
  ): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------

export interface ApiV1CreateKpiSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "replayed";
  readonly kpiId: string;
  readonly projectId: string;
}

export interface ApiV1CreateKpiNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1CreateKpiResult =
  | ApiV1CreateKpiSuccessResult
  | ApiV1CreateKpiNegativeResult;

const SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "kpiId",
  "projectId",
]);

const NEGATIVE_KEYS: ReadonlyArray<string> = Object.freeze(["ok", "outcome"]);

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

function assertCanonicalName(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) internal();
  return value;
}

function assertNullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") internal();
  return value;
}

function assertNullableFiniteNumber(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) internal();
  return value;
}

function assertNullableInteger(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) internal();
  if (value < PG_INT32_MIN || value > PG_INT32_MAX) internal();
  return value;
}

function assertMember(value: unknown, allowed: ReadonlySet<string>): string {
  if (typeof value !== "string" || !allowed.has(value)) internal();
  return value;
}

function assertNullableMember(
  value: unknown,
  allowed: ReadonlySet<string>,
): string | null {
  if (value === null) return null;
  return assertMember(value, allowed);
}

function assertBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") internal();
  return value;
}

function assertRpcClient(
  client: unknown,
): asserts client is ApiV1KpiMutationRpcClient {
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
// Result mapper — strict, bounded, Project-correlated
// -----------------------------------------------------------------------------

function toCreateKpiResult(
  data: unknown,
  requestedProjectId: string,
): ApiV1CreateKpiResult {
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
      outcome: outcome as ApiV1CreateKpiNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, SUCCESS_KEYS);
  const outcome = data.outcome;
  if (outcome !== "applied" && outcome !== "replayed") internal();

  const projectId = requireUuid(data.projectId);
  if (projectId !== requestedProjectId) internal();

  return Object.freeze({
    ok: true,
    outcome,
    kpiId: requireUuid(data.kpiId),
    projectId,
  });
}

// -----------------------------------------------------------------------------
// Adapters — exactly two fixed wrappers, twenty fixed arguments each
// -----------------------------------------------------------------------------

/**
 * Private shared invocation helper. `functionName` is restricted at compile
 * time to the two module-internal literal wrapper constants and can never come
 * from caller input. The database remains the sole authority for
 * Project-derived scope, Connected App enablement, capability grants,
 * delegated authority, idempotency, provenance, encryption and every canonical
 * KPI business rule.
 */
async function invokeCreateKpi(
  functionName: CreateKpiFunctionName,
  client: ApiV1KpiMutationRpcClient,
  input: ApiV1CreateKpiInput,
): Promise<ApiV1CreateKpiResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const projectId = requireUuid(input.projectId);

  const args: ApiV1CreateKpiRpcArgs = {
    _expected_oauth_client_id: assertValidExpectedOauthClientId(
      input.expectedOauthClientId,
    ),
    _project_id: projectId,
    _name: assertCanonicalName(input.name),
    _description: assertNullableString(input.description),
    _unit: assertNullableString(input.unit),
    _target_value: assertNullableFiniteNumber(input.targetValue),
    _target_direction: assertMember(input.targetDirection, TARGET_DIRECTIONS),
    _source_mode: assertMember(input.sourceMode, SOURCE_MODES),
    _value_type: assertMember(input.valueType, VALUE_TYPES),
    _cadence: assertMember(input.cadence, CADENCES),
    _calculation_key: assertNullableString(input.calculationKey),
    _formula_version: assertNullableInteger(input.formulaVersion),
    _completion_method: assertNullableMember(
      input.completionMethod,
      COMPLETION_METHODS,
    ),
    _comment_required: assertBoolean(input.commentRequired),
    _action_plan_required: assertBoolean(input.actionPlanRequired),
    _auto_snapshot_enabled: assertBoolean(input.autoSnapshotEnabled),
    _request_id: assertSafeMetadata(input.requestId),
    _correlation_id: assertSafeMetadata(input.correlationId),
    _idempotency_key: assertIdempotencyKey(input.idempotencyKey),
    _payload_hash: assertPayloadHash(input.payloadHash),
  };

  let result: unknown;
  try {
    result = await client.rpc(functionName, args);
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toCreateKpiResult(unwrapRpcEnvelope(result), projectId);
}

/**
 * Invoke the accepted REST-source `public.api_v1_create_kpi` wrapper. Behaviour
 * is unchanged from KPI-4B.
 */
export function createApiV1Kpi(
  client: ApiV1KpiMutationRpcClient,
  input: ApiV1CreateKpiInput,
): Promise<ApiV1CreateKpiResult> {
  return invokeCreateKpi(API_V1_CREATE_KPI_FUNCTION_NAME, client, input);
}

/**
 * KPI-4C — invoke the accepted MCP-source `public.mcp_v1_create_kpi` wrapper.
 * Identical twenty-argument validation, Project correlation, response schema
 * validation, bounded outcome mapping and error handling as the REST variant;
 * the fixed wrapper name is the only difference.
 */
export function createMcpV1Kpi(
  client: ApiV1KpiMutationRpcClient,
  input: ApiV1CreateKpiInput,
): Promise<ApiV1CreateKpiResult> {
  return invokeCreateKpi(MCP_V1_CREATE_KPI_FUNCTION_NAME, client, input);
}

// =============================================================================
// KPI-5B / KPI-5C — Explicit RPC adapters for the single external KPI definition
// update command (`kpis:update`).
//
// They call exactly one accepted KPI-5A database wrapper each:
// `public.api_v1_update_kpi` (REST source) and `public.mcp_v1_update_kpi`
// (MCP source). Neither caller may supply a wrapper/RPC name.
// =============================================================================

/** The single accepted REST-source KPI update wrapper invoked by this module. */
const API_V1_UPDATE_KPI_FUNCTION_NAME = "api_v1_update_kpi";

/** The single accepted MCP-source KPI update wrapper invoked by this module. */
export const MCP_V1_UPDATE_KPI_FUNCTION_NAME = "mcp_v1_update_kpi";

/**
 * The only two KPI-update wrapper names this module may ever invoke. The union
 * is closed at compile time and neither literal is ever derived from caller
 * input.
 */
type UpdateKpiFunctionName =
  | typeof API_V1_UPDATE_KPI_FUNCTION_NAME
  | typeof MCP_V1_UPDATE_KPI_FUNCTION_NAME;


export interface ApiV1UpdateKpiInput {
  readonly expectedOauthClientId: string;
  readonly kpiId: string;
  readonly expectedUpdatedAt: string;

  readonly name: string | null;
  readonly description: string | null;
  readonly unit: string | null;
  readonly targetValue: number | null;
  readonly targetDirection: string | null;
  readonly sourceMode: string | null;
  readonly valueType: string | null;
  readonly cadence: string | null;
  readonly calculationKey: string | null;
  readonly formulaVersion: number | null;
  readonly completionMethod: string | null;
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

  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

/** The exact accepted thirty-five-argument KPI-5A wrapper signature. */
export interface ApiV1UpdateKpiRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _kpi_definition_id: string;
  readonly _expected_updated_at: string;
  readonly _name: string | null;
  readonly _description: string | null;
  readonly _unit: string | null;
  readonly _target_value: number | null;
  readonly _target_direction: string | null;
  readonly _source_mode: string | null;
  readonly _value_type: string | null;
  readonly _cadence: string | null;
  readonly _calculation_key: string | null;
  readonly _formula_version: number | null;
  readonly _completion_method: string | null;
  readonly _comment_required: boolean | null;
  readonly _action_plan_required: boolean | null;
  readonly _auto_snapshot_enabled: boolean | null;
  readonly _set_name: boolean;
  readonly _set_description: boolean;
  readonly _set_unit: boolean;
  readonly _set_target_value: boolean;
  readonly _set_target_direction: boolean;
  readonly _set_source_mode: boolean;
  readonly _set_value_type: boolean;
  readonly _set_cadence: boolean;
  readonly _set_calculation_key: boolean;
  readonly _set_formula_version: boolean;
  readonly _set_completion_method: boolean;
  readonly _set_comment_required: boolean;
  readonly _set_action_plan_required: boolean;
  readonly _set_auto_snapshot_enabled: boolean;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

/** Minimal structural RPC client contract for the KPI update wrapper. */
export interface ApiV1KpiUpdateRpcClient {
  rpc(
    functionName: string,
    args: ApiV1UpdateKpiRpcArgs,
  ): Promise<unknown>;
}

export interface ApiV1UpdateKpiSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly kpiId: string;
  readonly projectId: string;
  readonly updatedAt: string;
}

export interface ApiV1UpdateKpiConflictResult {
  readonly ok: false;
  readonly outcome: "conflict";
  readonly code: "stale_kpi_definition";
}

export interface ApiV1UpdateKpiNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1UpdateKpiResult =
  | ApiV1UpdateKpiSuccessResult
  | ApiV1UpdateKpiConflictResult
  | ApiV1UpdateKpiNegativeResult;

const UPDATE_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "kpiId",
  "projectId",
  "updatedAt",
]);

const UPDATE_CONFLICT_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "code",
]);

const UPDATE_SUCCESS_OUTCOMES: ReadonlySet<string> = new Set([
  "applied",
  "no_change",
  "replayed",
]);

function assertNullableMemberOrNull(
  value: unknown,
  allowed: ReadonlySet<string>,
): string | null {
  if (value === null) return null;
  return assertMember(value, allowed);
}

function assertNullableBoolean(value: unknown): boolean | null {
  if (value === null) return null;
  return assertBoolean(value);
}

function assertNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) internal();
  return value;
}

function assertUpdateRpcClient(
  client: unknown,
): asserts client is ApiV1KpiUpdateRpcClient {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    internal();
  }
}

function toUpdateKpiResult(
  data: unknown,
  requestedKpiId: string,
): ApiV1UpdateKpiResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === false) {
    const outcome = data.outcome;
    if (outcome === "conflict") {
      assertExactKeys(data, UPDATE_CONFLICT_KEYS);
      if (data.code !== "stale_kpi_definition") internal();
      return Object.freeze({
        ok: false,
        outcome: "conflict",
        code: "stale_kpi_definition",
      }) as ApiV1UpdateKpiConflictResult;
    }
    assertExactKeys(data, NEGATIVE_KEYS);
    if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
      internal();
    }
    return Object.freeze({
      ok: false,
      outcome: outcome as ApiV1UpdateKpiNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, UPDATE_SUCCESS_KEYS);
  const outcome = data.outcome;
  if (typeof outcome !== "string" || !UPDATE_SUCCESS_OUTCOMES.has(outcome)) {
    internal();
  }

  const kpiId = requireUuid(data.kpiId);
  if (kpiId !== requestedKpiId) internal();

  return Object.freeze({
    ok: true,
    outcome: outcome as ApiV1UpdateKpiSuccessResult["outcome"],
    kpiId,
    projectId: requireUuid(data.projectId),
    updatedAt: assertNonEmptyString(data.updatedAt),
  });
}

/**
 * Private shared invocation helper. `functionName` is restricted at compile
 * time to the two module-internal literal KPI-update wrapper constants and can
 * never come from caller input. Exactly the thirty-five accepted arguments are
 * forwarded. The database remains the sole authority for KPI-derived scope,
 * Connected App enablement, capability grants, delegated authority,
 * idempotency, provenance, encryption and every canonical KPI business rule.
 */
async function invokeUpdateKpi(
  functionName: UpdateKpiFunctionName,
  client: ApiV1KpiUpdateRpcClient,
  input: ApiV1UpdateKpiInput,
): Promise<ApiV1UpdateKpiResult> {
  assertUpdateRpcClient(client);
  if (!isPlainObject(input)) internal();


  const kpiId = requireUuid(input.kpiId);

  const args: ApiV1UpdateKpiRpcArgs = {
    _expected_oauth_client_id: assertValidExpectedOauthClientId(
      input.expectedOauthClientId,
    ),
    _kpi_definition_id: kpiId,
    _expected_updated_at: assertNonEmptyString(input.expectedUpdatedAt),
    _name: assertNullableString(input.name),
    _description: assertNullableString(input.description),
    _unit: assertNullableString(input.unit),
    _target_value: assertNullableFiniteNumber(input.targetValue),
    _target_direction: assertNullableMemberOrNull(
      input.targetDirection,
      TARGET_DIRECTIONS,
    ),
    _source_mode: assertNullableMemberOrNull(input.sourceMode, SOURCE_MODES),
    _value_type: assertNullableMemberOrNull(input.valueType, VALUE_TYPES),
    _cadence: assertNullableMemberOrNull(input.cadence, CADENCES),
    _calculation_key: assertNullableString(input.calculationKey),
    _formula_version: assertNullableInteger(input.formulaVersion),
    _completion_method: assertNullableMemberOrNull(
      input.completionMethod,
      COMPLETION_METHODS,
    ),
    _comment_required: assertNullableBoolean(input.commentRequired),
    _action_plan_required: assertNullableBoolean(input.actionPlanRequired),
    _auto_snapshot_enabled: assertNullableBoolean(input.autoSnapshotEnabled),
    _set_name: assertBoolean(input.setName),
    _set_description: assertBoolean(input.setDescription),
    _set_unit: assertBoolean(input.setUnit),
    _set_target_value: assertBoolean(input.setTargetValue),
    _set_target_direction: assertBoolean(input.setTargetDirection),
    _set_source_mode: assertBoolean(input.setSourceMode),
    _set_value_type: assertBoolean(input.setValueType),
    _set_cadence: assertBoolean(input.setCadence),
    _set_calculation_key: assertBoolean(input.setCalculationKey),
    _set_formula_version: assertBoolean(input.setFormulaVersion),
    _set_completion_method: assertBoolean(input.setCompletionMethod),
    _set_comment_required: assertBoolean(input.setCommentRequired),
    _set_action_plan_required: assertBoolean(input.setActionPlanRequired),
    _set_auto_snapshot_enabled: assertBoolean(input.setAutoSnapshotEnabled),
    _request_id: assertSafeMetadata(input.requestId),
    _correlation_id: assertSafeMetadata(input.correlationId),
    _idempotency_key: assertIdempotencyKey(input.idempotencyKey),
    _payload_hash: assertPayloadHash(input.payloadHash),
  };

  let result: unknown;
  try {
    result = await client.rpc(functionName, args);
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toUpdateKpiResult(unwrapRpcEnvelope(result), kpiId);
}

/**
 * KPI-5B — invoke the accepted REST-source `public.api_v1_update_kpi` wrapper.
 * Behaviour is unchanged from KPI-5B; the fixed wrapper name is not caller
 * supplied.
 */
export function updateApiV1Kpi(
  client: ApiV1KpiUpdateRpcClient,
  input: ApiV1UpdateKpiInput,
): Promise<ApiV1UpdateKpiResult> {
  return invokeUpdateKpi(API_V1_UPDATE_KPI_FUNCTION_NAME, client, input);
}

/**
 * KPI-5C — invoke the accepted MCP-source `public.mcp_v1_update_kpi` wrapper.
 * Identical thirty-five-argument validation, KPI-ID correlation, response
 * schema validation, bounded outcome mapping and error handling as the REST
 * variant; the fixed wrapper name is the only difference.
 */
export function updateMcpV1Kpi(
  client: ApiV1KpiUpdateRpcClient,
  input: ApiV1UpdateKpiInput,
): Promise<ApiV1UpdateKpiResult> {
  return invokeUpdateKpi(MCP_V1_UPDATE_KPI_FUNCTION_NAME, client, input);
}


// =============================================================================
// KPI-6B — Explicit RPC adapter for the single external KPI update-history
// append command (`kpis:append_update`).
//
// It calls exactly one accepted KPI-6A database wrapper,
// `public.api_v1_append_kpi_update`. The caller may never supply a wrapper name.
// =============================================================================

/** The single accepted REST-source KPI append wrapper invoked by this module. */
const API_V1_APPEND_KPI_UPDATE_FUNCTION_NAME = "api_v1_append_kpi_update";

/** KPI-6C — the single accepted MCP-source KPI append wrapper. */
const MCP_V1_APPEND_KPI_UPDATE_FUNCTION_NAME = "mcp_v1_append_kpi_update";

/**
 * The only KPI update-history append wrapper names this module may ever invoke.
 * The union is closed at compile time and never derived from caller input.
 */
type AppendKpiUpdateFunctionName =
  | typeof API_V1_APPEND_KPI_UPDATE_FUNCTION_NAME
  | typeof MCP_V1_APPEND_KPI_UPDATE_FUNCTION_NAME;

const KPI_UPDATE_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export interface ApiV1AppendKpiUpdateInput {
  readonly expectedOauthClientId: string;
  readonly kpiId: string;
  readonly value: number;
  readonly updateDate: string;
  readonly note: string | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

/** The exact accepted nine-argument KPI-6A wrapper signature. */
export interface ApiV1AppendKpiUpdateRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _kpi_definition_id: string;
  readonly _value: number;
  readonly _update_date: string;
  readonly _note: string | null;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

/** Minimal structural RPC client contract for the KPI append wrapper. */
export interface ApiV1KpiAppendUpdateRpcClient {
  rpc(
    functionName: string,
    args: ApiV1AppendKpiUpdateRpcArgs,
  ): Promise<unknown>;
}

export interface ApiV1AppendKpiUpdateSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "replayed";
  readonly kpiUpdateId: string;
  readonly kpiId: string;
  readonly projectId: string;
}

export interface ApiV1AppendKpiUpdateNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1AppendKpiUpdateResult =
  | ApiV1AppendKpiUpdateSuccessResult
  | ApiV1AppendKpiUpdateNegativeResult;

const APPEND_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "kpiUpdateId",
  "kpiId",
  "projectId",
]);

function assertFiniteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) internal();
  return value;
}

function assertKpiUpdateDate(value: unknown): string {
  if (typeof value !== "string" || !KPI_UPDATE_DATE_PATTERN.test(value)) {
    internal();
  }
  return value;
}

function assertAppendRpcClient(
  client: unknown,
): asserts client is ApiV1KpiAppendUpdateRpcClient {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    internal();
  }
}

function toAppendKpiUpdateResult(
  data: unknown,
  requestedKpiId: string,
): ApiV1AppendKpiUpdateResult {
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
      outcome: outcome as ApiV1AppendKpiUpdateNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, APPEND_SUCCESS_KEYS);
  const outcome = data.outcome;
  if (outcome !== "applied" && outcome !== "replayed") internal();

  const kpiId = requireUuid(data.kpiId);
  if (kpiId !== requestedKpiId) internal();

  return Object.freeze({
    ok: true,
    outcome,
    kpiUpdateId: requireUuid(data.kpiUpdateId),
    kpiId,
    projectId: requireUuid(data.projectId),
  });
}

/**
 * Private shared invocation helper. `functionName` is restricted at compile time
 * to the single module-internal literal wrapper constant. The database remains
 * the sole authority for KPI-derived scope, Connected App enablement, capability
 * grants, delegated authority, idempotency, provenance, note encryption and
 * every canonical KPI operational business rule.
 */
async function invokeAppendKpiUpdate(
  functionName: AppendKpiUpdateFunctionName,
  client: ApiV1KpiAppendUpdateRpcClient,
  input: ApiV1AppendKpiUpdateInput,
): Promise<ApiV1AppendKpiUpdateResult> {
  assertAppendRpcClient(client);
  if (!isPlainObject(input)) internal();

  const kpiId = requireUuid(input.kpiId);

  const args: ApiV1AppendKpiUpdateRpcArgs = {
    _expected_oauth_client_id: assertValidExpectedOauthClientId(
      input.expectedOauthClientId,
    ),
    _kpi_definition_id: kpiId,
    _value: assertFiniteNumber(input.value),
    _update_date: assertKpiUpdateDate(input.updateDate),
    _note: assertNullableString(input.note),
    _request_id: assertSafeMetadata(input.requestId),
    _correlation_id: assertSafeMetadata(input.correlationId),
    _idempotency_key: assertIdempotencyKey(input.idempotencyKey),
    _payload_hash: assertPayloadHash(input.payloadHash),
  };

  let result: unknown;
  try {
    result = await client.rpc(functionName, args);
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toAppendKpiUpdateResult(unwrapRpcEnvelope(result), kpiId);
}

/**
 * KPI-6B — invoke the accepted REST-source `public.api_v1_append_kpi_update`
 * wrapper. The fixed wrapper name is not caller supplied.
 */
export function appendApiV1KpiUpdate(
  client: ApiV1KpiAppendUpdateRpcClient,
  input: ApiV1AppendKpiUpdateInput,
): Promise<ApiV1AppendKpiUpdateResult> {
  return invokeAppendKpiUpdate(
    API_V1_APPEND_KPI_UPDATE_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * KPI-6C — invoke the accepted MCP-source `public.mcp_v1_append_kpi_update`
 * wrapper. The fixed wrapper name is not caller supplied; the nine database
 * arguments are exactly those of the REST variant.
 */
export function appendMcpV1KpiUpdate(
  client: ApiV1KpiAppendUpdateRpcClient,
  input: ApiV1AppendKpiUpdateInput,
): Promise<ApiV1AppendKpiUpdateResult> {
  return invokeAppendKpiUpdate(
    MCP_V1_APPEND_KPI_UPDATE_FUNCTION_NAME,
    client,
    input,
  );
}
