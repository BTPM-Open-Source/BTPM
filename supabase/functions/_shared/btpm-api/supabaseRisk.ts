// API-K.7 — Explicit RPC adapters for the two external Risk mutations.
//
// This module calls exactly two accepted API-K.5 database wrappers,
// `public.api_v1_create_risk` and `public.api_v1_update_risk`, through a
// caller-supplied Supabase RPC client. The caller-supplied client is the
// trust boundary: the runtime must supply a client bound to the current
// bearer token.
//
// This module constructs no Supabase client, reads no environment variable,
// extracts no token, uses no service-role key, calls no `fetch`, performs no
// route matching, performs no logging, schedules no timer, caches nothing,
// holds no mutable global state, exposes no generic RPC executor, and
// performs no dynamic dispatch.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";
import type {
  ApiV1RiskImpact,
  ApiV1RiskLikelihood,
  ApiV1RiskStatus,
  ApiV1RiskTargetType,
} from "../btpm-api/routes/risks.ts";

/** Exact database wrappers invoked by this module. */
const API_V1_CREATE_RISK_FUNCTION_NAME = "api_v1_create_risk";
const API_V1_UPDATE_RISK_FUNCTION_NAME = "api_v1_update_risk";

/** API-Q.10A3 — fixed MCP-source wrapper (`public.mcp_v1_create_risk`). */
const MCP_V1_CREATE_RISK_FUNCTION_NAME = "mcp_v1_create_risk";

/** API-Q.10B2 — fixed MCP-source wrapper (`public.mcp_v1_update_risk`). */
const MCP_V1_UPDATE_RISK_FUNCTION_NAME = "mcp_v1_update_risk";

/** The only two Risk-create wrapper names this module may ever invoke. */
type CreateRiskFunctionName =
  | typeof API_V1_CREATE_RISK_FUNCTION_NAME
  | typeof MCP_V1_CREATE_RISK_FUNCTION_NAME;

/** The only two Risk-update wrapper names this module may ever invoke. */
type UpdateRiskFunctionName =
  | typeof API_V1_UPDATE_RISK_FUNCTION_NAME
  | typeof MCP_V1_UPDATE_RISK_FUNCTION_NAME;

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

const TARGET_TYPES: ReadonlySet<string> = new Set([
  "project",
  "phase",
  "task",
]);
const LIKELIHOODS: ReadonlySet<string> = new Set(["low", "medium", "high"]);
const IMPACTS: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
  "critical",
]);
const STATUSES: ReadonlySet<string> = new Set([
  "open",
  "under_mitigation",
  "monitoring",
  "realized",
  "closed",
]);

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export interface ApiV1CreateRiskInput {
  readonly expectedOauthClientId: string;
  readonly targetType: ApiV1RiskTargetType;
  readonly targetId: string;
  readonly title: string;
  readonly description: string | null;
  readonly mitigationPlan: string | null;
  readonly likelihood: ApiV1RiskLikelihood;
  readonly impact: ApiV1RiskImpact;
  readonly status: ApiV1RiskStatus;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1UpdateRiskInput {
  readonly expectedOauthClientId: string;
  readonly riskId: string;
  readonly expectedUpdatedAt: string;
  readonly title: string;
  readonly description: string | null;
  readonly mitigationPlan: string | null;
  readonly likelihood: ApiV1RiskLikelihood;
  readonly impact: ApiV1RiskImpact;
  readonly status: ApiV1RiskStatus;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1CreateRiskRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _target_type: string;
  readonly _target_id: string;
  readonly _title: string;
  readonly _description: string | null;
  readonly _mitigation_plan: string | null;
  readonly _likelihood: string;
  readonly _impact: string;
  readonly _status: string;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

export interface ApiV1UpdateRiskRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _risk_id: string;
  readonly _expected_updated_at: string;
  readonly _title: string;
  readonly _description: string | null;
  readonly _mitigation_plan: string | null;
  readonly _likelihood: string;
  readonly _impact: string;
  readonly _status: string;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

/** Minimal structural RPC client contract. */
export interface ApiV1RiskRpcClient {
  rpc(
    functionName: string,
    args: ApiV1CreateRiskRpcArgs | ApiV1UpdateRiskRpcArgs,
  ): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------

export interface ApiV1CreateRiskSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "replayed";
  readonly riskId: string;
  readonly targetType: ApiV1RiskTargetType;
  readonly targetId: string;
  readonly likelihood: ApiV1RiskLikelihood;
  readonly impact: ApiV1RiskImpact;
  readonly status: ApiV1RiskStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiV1CreateRiskNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1CreateRiskResult =
  | ApiV1CreateRiskSuccessResult
  | ApiV1CreateRiskNegativeResult;

export interface ApiV1UpdateRiskSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly riskId: string;
  readonly targetType: ApiV1RiskTargetType;
  readonly targetId: string;
  readonly likelihood: ApiV1RiskLikelihood;
  readonly impact: ApiV1RiskImpact;
  readonly status: ApiV1RiskStatus;
  readonly updatedAt: string;
}

export interface ApiV1UpdateRiskNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export interface ApiV1UpdateRiskConflictResult {
  readonly ok: false;
  readonly outcome: "conflict";
  readonly code: "stale_risk";
}

export type ApiV1UpdateRiskResult =
  | ApiV1UpdateRiskSuccessResult
  | ApiV1UpdateRiskNegativeResult
  | ApiV1UpdateRiskConflictResult;

const CREATE_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "riskId",
  "targetType",
  "targetId",
  "likelihood",
  "impact",
  "status",
  "createdAt",
  "updatedAt",
]);

const UPDATE_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "riskId",
  "targetType",
  "targetId",
  "likelihood",
  "impact",
  "status",
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

function assertRiskScalars(input: {
  title: unknown;
  description: unknown;
  mitigationPlan: unknown;
  likelihood: unknown;
  impact: unknown;
  status: unknown;
}): void {
  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    internal();
  }
  if (input.description !== null && typeof input.description !== "string") {
    internal();
  }
  if (
    input.mitigationPlan !== null && typeof input.mitigationPlan !== "string"
  ) {
    internal();
  }
  requireEnum(input.likelihood, LIKELIHOODS);
  requireEnum(input.impact, IMPACTS);
  requireEnum(input.status, STATUSES);
}

function assertRpcClient(client: unknown): asserts client is ApiV1RiskRpcClient {
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

function toCreateResult(data: unknown): ApiV1CreateRiskResult {
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
      outcome: outcome as ApiV1CreateRiskNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, CREATE_SUCCESS_KEYS);
  const outcome = data.outcome;
  if (outcome !== "applied" && outcome !== "replayed") internal();

  return Object.freeze({
    ok: true,
    outcome,
    riskId: requireUuid(data.riskId),
    targetType: requireEnum<ApiV1RiskTargetType>(data.targetType, TARGET_TYPES),
    targetId: requireUuid(data.targetId),
    likelihood: requireEnum<ApiV1RiskLikelihood>(data.likelihood, LIKELIHOODS),
    impact: requireEnum<ApiV1RiskImpact>(data.impact, IMPACTS),
    status: requireEnum<ApiV1RiskStatus>(data.status, STATUSES),
    createdAt: requireTimestamp(data.createdAt),
    updatedAt: requireTimestamp(data.updatedAt),
  });
}

function toUpdateResult(data: unknown): ApiV1UpdateRiskResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === false) {
    if (data.outcome === "conflict") {
      assertExactKeys(data, CONFLICT_KEYS);
      if (data.code !== "stale_risk") internal();
      return Object.freeze({
        ok: false,
        outcome: "conflict" as const,
        code: "stale_risk" as const,
      });
    }
    assertExactKeys(data, NEGATIVE_KEYS);
    const outcome = data.outcome;
    if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
      internal();
    }
    return Object.freeze({
      ok: false,
      outcome: outcome as ApiV1UpdateRiskNegativeResult["outcome"],
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
    riskId: requireUuid(data.riskId),
    targetType: requireEnum<ApiV1RiskTargetType>(data.targetType, TARGET_TYPES),
    targetId: requireUuid(data.targetId),
    likelihood: requireEnum<ApiV1RiskLikelihood>(data.likelihood, LIKELIHOODS),
    impact: requireEnum<ApiV1RiskImpact>(data.impact, IMPACTS),
    status: requireEnum<ApiV1RiskStatus>(data.status, STATUSES),
    updatedAt: requireTimestamp(data.updatedAt),
  });
}

// -----------------------------------------------------------------------------
// Adapters
// -----------------------------------------------------------------------------

/**
 * Single internal Risk-create invocation path shared by both exported create
 * functions.
 *
 * `functionName` is NOT caller-supplied: it is one of the two module-internal
 * literal constants above. This helper is not exported, accepts no operation
 * identifier and performs no dynamic dispatch.
 */
async function invokeCreateRisk(
  functionName: CreateRiskFunctionName,
  client: ApiV1RiskRpcClient,
  input: ApiV1CreateRiskInput,
): Promise<ApiV1CreateRiskResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const targetType = requireEnum<ApiV1RiskTargetType>(
    input.targetType,
    TARGET_TYPES,
  );
  const targetId = requireUuid(input.targetId);
  assertRiskScalars(input);
  const requestId = assertSafeMetadata(input.requestId);
  const correlationId = assertSafeMetadata(input.correlationId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = assertPayloadHash(input.payloadHash);

  let result: unknown;
  try {
    result = await client.rpc(functionName, {
      _expected_oauth_client_id: expectedOauthClientId,
      _target_type: targetType,
      _target_id: targetId,
      _title: input.title,
      _description: input.description,
      _mitigation_plan: input.mitigationPlan,
      _likelihood: input.likelihood,
      _impact: input.impact,
      _status: input.status,
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
 * Invoke the accepted `public.api_v1_create_risk` wrapper (REST /
 * `external_api` source channel). The database remains the sole authority for
 * scope derivation, Project Connected App enablement, PMG authorization,
 * persistence and idempotency.
 */
export function createApiV1Risk(
  client: ApiV1RiskRpcClient,
  input: ApiV1CreateRiskInput,
): Promise<ApiV1CreateRiskResult> {
  return invokeCreateRisk(API_V1_CREATE_RISK_FUNCTION_NAME, client, input);
}

/**
 * API-Q.10A3 — invoke the accepted `public.mcp_v1_create_risk` wrapper (MCP /
 * `mcp` source channel).
 *
 * Identical validation, RPC argument construction, error handling and bounded
 * result contract as the REST function. The ONLY difference is the fixed
 * wrapper name, which the database uses to derive the trusted source channel.
 */
export function createMcpV1Risk(
  client: ApiV1RiskRpcClient,
  input: ApiV1CreateRiskInput,
): Promise<ApiV1CreateRiskResult> {
  return invokeCreateRisk(MCP_V1_CREATE_RISK_FUNCTION_NAME, client, input);
}

/**
 * Single internal Risk-update invocation path shared by both exported update
 * functions.
 *
 * `functionName` is NOT caller-supplied: it is one of the two module-internal
 * literal constants above. This helper is not exported, accepts no operation
 * identifier and performs no dynamic dispatch.
 *
 * `expectedUpdatedAt` is format-validated only and passed through byte-for-byte
 * unchanged: no parsing, re-serialization, refresh or read-before-write.
 */
async function invokeUpdateRisk(
  functionName: UpdateRiskFunctionName,
  client: ApiV1RiskRpcClient,
  input: ApiV1UpdateRiskInput,
): Promise<ApiV1UpdateRiskResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const riskId = requireUuid(input.riskId);
  const expectedUpdatedAt = requireTimestamp(input.expectedUpdatedAt);
  assertRiskScalars(input);
  const requestId = assertSafeMetadata(input.requestId);
  const correlationId = assertSafeMetadata(input.correlationId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = assertPayloadHash(input.payloadHash);

  let result: unknown;
  try {
    result = await client.rpc(functionName, {
      _expected_oauth_client_id: expectedOauthClientId,
      _risk_id: riskId,
      _expected_updated_at: expectedUpdatedAt,
      _title: input.title,
      _description: input.description,
      _mitigation_plan: input.mitigationPlan,
      _likelihood: input.likelihood,
      _impact: input.impact,
      _status: input.status,
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
 * Invoke the accepted `public.api_v1_update_risk` wrapper. Existing Risk links
 * are preserved inside the wrapper; the Edge surface exposes none.
 */
export function updateApiV1Risk(
  client: ApiV1RiskRpcClient,
  input: ApiV1UpdateRiskInput,
): Promise<ApiV1UpdateRiskResult> {
  return invokeUpdateRisk(API_V1_UPDATE_RISK_FUNCTION_NAME, client, input);
}

/**
 * API-Q.10B2 — invoke the accepted `public.mcp_v1_update_risk` wrapper (MCP /
 * `mcp` source channel).
 *
 * Identical validation, RPC argument construction, error handling and bounded
 * result contract as the REST function. The ONLY difference is the fixed
 * wrapper name, which the database uses to derive the trusted source channel.
 */
export function updateMcpV1Risk(
  client: ApiV1RiskRpcClient,
  input: ApiV1UpdateRiskInput,
): Promise<ApiV1UpdateRiskResult> {
  return invokeUpdateRisk(MCP_V1_UPDATE_RISK_FUNCTION_NAME, client, input);
}

