// API-K.8 — Explicit RPC adapters for the two external Blocker mutations.
//
// This module calls exactly two accepted API-K.6 database wrappers,
// `public.api_v1_create_blocker` and `public.api_v1_update_blocker`, through a
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
  ApiV1BlockerSeverity,
  ApiV1BlockerStatus,
  ApiV1BlockerTargetType,
} from "../btpm-api/routes/blockers.ts";

/** Exact database wrappers invoked by this module. */
const API_V1_CREATE_BLOCKER_FUNCTION_NAME = "api_v1_create_blocker";
const API_V1_UPDATE_BLOCKER_FUNCTION_NAME = "api_v1_update_blocker";

/** API-Q.10C2 — fixed MCP-source wrapper (`public.mcp_v1_create_blocker`). */
const MCP_V1_CREATE_BLOCKER_FUNCTION_NAME = "mcp_v1_create_blocker";

/** API-Q.10D2 — fixed MCP-source wrapper (`public.mcp_v1_update_blocker`). */
const MCP_V1_UPDATE_BLOCKER_FUNCTION_NAME = "mcp_v1_update_blocker";

/** The only two Blocker-create wrapper names this module may ever invoke. */
type CreateBlockerFunctionName =
  | typeof API_V1_CREATE_BLOCKER_FUNCTION_NAME
  | typeof MCP_V1_CREATE_BLOCKER_FUNCTION_NAME;

/** The only two Blocker-update wrapper names this module may ever invoke. */
type UpdateBlockerFunctionName =
  | typeof API_V1_UPDATE_BLOCKER_FUNCTION_NAME
  | typeof MCP_V1_UPDATE_BLOCKER_FUNCTION_NAME;

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
const SEVERITIES: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
  "critical",
]);
const STATUSES: ReadonlySet<string> = new Set([
  "open",
  "in_progress",
  "resolved",
]);

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export interface ApiV1CreateBlockerInput {
  readonly expectedOauthClientId: string;
  readonly targetType: ApiV1BlockerTargetType;
  readonly targetId: string;
  readonly title: string;
  readonly description: string | null;
  readonly severity: ApiV1BlockerSeverity;
  readonly status: ApiV1BlockerStatus;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1UpdateBlockerInput {
  readonly expectedOauthClientId: string;
  readonly blockerId: string;
  readonly expectedUpdatedAt: string;
  readonly title: string;
  readonly description: string | null;
  readonly severity: ApiV1BlockerSeverity;
  readonly status: ApiV1BlockerStatus;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1CreateBlockerRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _target_type: string;
  readonly _target_id: string;
  readonly _title: string;
  readonly _description: string | null;
  readonly _severity: string;
  readonly _status: string;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

export interface ApiV1UpdateBlockerRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _blocker_id: string;
  readonly _expected_updated_at: string;
  readonly _title: string;
  readonly _description: string | null;
  readonly _severity: string;
  readonly _status: string;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

/** Minimal structural RPC client contract. */
export interface ApiV1BlockerRpcClient {
  rpc(
    functionName: string,
    args: ApiV1CreateBlockerRpcArgs | ApiV1UpdateBlockerRpcArgs,
  ): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------

export interface ApiV1CreateBlockerSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "replayed";
  readonly blockerId: string;
  readonly targetType: ApiV1BlockerTargetType;
  readonly targetId: string;
  readonly severity: ApiV1BlockerSeverity;
  readonly status: ApiV1BlockerStatus;
  readonly isResolved: boolean;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiV1CreateBlockerNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1CreateBlockerResult =
  | ApiV1CreateBlockerSuccessResult
  | ApiV1CreateBlockerNegativeResult;

export interface ApiV1UpdateBlockerSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly blockerId: string;
  readonly targetType: ApiV1BlockerTargetType;
  readonly targetId: string;
  readonly severity: ApiV1BlockerSeverity;
  readonly status: ApiV1BlockerStatus;
  readonly isResolved: boolean;
  readonly resolvedAt: string | null;
  readonly updatedAt: string;
}

export interface ApiV1UpdateBlockerNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export interface ApiV1UpdateBlockerConflictResult {
  readonly ok: false;
  readonly outcome: "conflict";
  readonly code: "stale_blocker";
}

export type ApiV1UpdateBlockerResult =
  | ApiV1UpdateBlockerSuccessResult
  | ApiV1UpdateBlockerNegativeResult
  | ApiV1UpdateBlockerConflictResult;

const CREATE_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "blockerId",
  "targetType",
  "targetId",
  "severity",
  "status",
  "isResolved",
  "resolvedAt",
  "createdAt",
  "updatedAt",
]);

const UPDATE_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "blockerId",
  "targetType",
  "targetId",
  "severity",
  "status",
  "isResolved",
  "resolvedAt",
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

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") internal();
  return value;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== "string" || !RESULT_TIMESTAMP_PATTERN.test(value)) {
    internal();
  }
  return value;
}

function requireNullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  return requireTimestamp(value);
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

function assertBlockerScalars(input: {
  title: unknown;
  description: unknown;
  severity: unknown;
  status: unknown;
}): void {
  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    internal();
  }
  if (input.description !== null && typeof input.description !== "string") {
    internal();
  }
  requireEnum(input.severity, SEVERITIES);
  requireEnum(input.status, STATUSES);
}

function assertRpcClient(
  client: unknown,
): asserts client is ApiV1BlockerRpcClient {
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

function toCreateResult(data: unknown): ApiV1CreateBlockerResult {
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
      outcome: outcome as ApiV1CreateBlockerNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, CREATE_SUCCESS_KEYS);
  const outcome = data.outcome;
  if (outcome !== "applied" && outcome !== "replayed") internal();

  return Object.freeze({
    ok: true,
    outcome,
    blockerId: requireUuid(data.blockerId),
    targetType: requireEnum<ApiV1BlockerTargetType>(
      data.targetType,
      TARGET_TYPES,
    ),
    targetId: requireUuid(data.targetId),
    severity: requireEnum<ApiV1BlockerSeverity>(data.severity, SEVERITIES),
    status: requireEnum<ApiV1BlockerStatus>(data.status, STATUSES),
    isResolved: requireBoolean(data.isResolved),
    resolvedAt: requireNullableTimestamp(data.resolvedAt),
    createdAt: requireTimestamp(data.createdAt),
    updatedAt: requireTimestamp(data.updatedAt),
  });
}

function toUpdateResult(data: unknown): ApiV1UpdateBlockerResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === false) {
    if (data.outcome === "conflict") {
      assertExactKeys(data, CONFLICT_KEYS);
      if (data.code !== "stale_blocker") internal();
      return Object.freeze({
        ok: false,
        outcome: "conflict" as const,
        code: "stale_blocker" as const,
      });
    }
    assertExactKeys(data, NEGATIVE_KEYS);
    const outcome = data.outcome;
    if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
      internal();
    }
    return Object.freeze({
      ok: false,
      outcome: outcome as ApiV1UpdateBlockerNegativeResult["outcome"],
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
    blockerId: requireUuid(data.blockerId),
    targetType: requireEnum<ApiV1BlockerTargetType>(
      data.targetType,
      TARGET_TYPES,
    ),
    targetId: requireUuid(data.targetId),
    severity: requireEnum<ApiV1BlockerSeverity>(data.severity, SEVERITIES),
    status: requireEnum<ApiV1BlockerStatus>(data.status, STATUSES),
    isResolved: requireBoolean(data.isResolved),
    resolvedAt: requireNullableTimestamp(data.resolvedAt),
    updatedAt: requireTimestamp(data.updatedAt),
  });
}

// -----------------------------------------------------------------------------
// Adapters
// -----------------------------------------------------------------------------

/**
 * Single internal Blocker-create invocation path shared by both exported create
 * functions.
 *
 * `functionName` is NOT caller-supplied: it is one of the two module-internal
 * literal constants above. This helper is not exported, accepts no operation
 * identifier and performs no dynamic dispatch.
 */
async function invokeCreateBlocker(
  functionName: CreateBlockerFunctionName,
  client: ApiV1BlockerRpcClient,
  input: ApiV1CreateBlockerInput,
): Promise<ApiV1CreateBlockerResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const targetType = requireEnum<ApiV1BlockerTargetType>(
    input.targetType,
    TARGET_TYPES,
  );
  const targetId = requireUuid(input.targetId);
  assertBlockerScalars(input);
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
      _severity: input.severity,
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
 * Invoke the accepted `public.api_v1_create_blocker` wrapper (REST /
 * `external_api` source channel). The database remains the sole authority for
 * scope derivation, Project Connected App enablement, PMG authorization,
 * persistence and idempotency.
 */
export function createApiV1Blocker(
  client: ApiV1BlockerRpcClient,
  input: ApiV1CreateBlockerInput,
): Promise<ApiV1CreateBlockerResult> {
  return invokeCreateBlocker(
    API_V1_CREATE_BLOCKER_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * API-Q.10C2 — invoke the accepted `public.mcp_v1_create_blocker` wrapper
 * (MCP / `mcp` source channel).
 *
 * Identical validation, RPC argument construction, error handling and bounded
 * result contract as the REST function. The ONLY difference is the fixed
 * wrapper name, which the database uses to derive the trusted source channel.
 */
export function createMcpV1Blocker(
  client: ApiV1BlockerRpcClient,
  input: ApiV1CreateBlockerInput,
): Promise<ApiV1CreateBlockerResult> {
  return invokeCreateBlocker(
    MCP_V1_CREATE_BLOCKER_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * Single internal Blocker-update invocation path shared by both exported update
 * functions.
 *
 * `functionName` is NOT caller-supplied: it is one of the two module-internal
 * literal constants above. This helper is not exported, accepts no operation
 * identifier and performs no dynamic dispatch.
 *
 * Existing Blocker links are preserved inside the wrapper; the Edge surface
 * exposes none.
 */
async function invokeUpdateBlocker(
  functionName: UpdateBlockerFunctionName,
  client: ApiV1BlockerRpcClient,
  input: ApiV1UpdateBlockerInput,
): Promise<ApiV1UpdateBlockerResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const blockerId = requireUuid(input.blockerId);
  const expectedUpdatedAt = requireTimestamp(input.expectedUpdatedAt);
  assertBlockerScalars(input);
  const requestId = assertSafeMetadata(input.requestId);
  const correlationId = assertSafeMetadata(input.correlationId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = assertPayloadHash(input.payloadHash);

  let result: unknown;
  try {
    result = await client.rpc(functionName, {
      _expected_oauth_client_id: expectedOauthClientId,
      _blocker_id: blockerId,
      _expected_updated_at: expectedUpdatedAt,
      _title: input.title,
      _description: input.description,
      _severity: input.severity,
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
 * Invoke the accepted `public.api_v1_update_blocker` wrapper (REST /
 * `external_api` source channel).
 */
export function updateApiV1Blocker(
  client: ApiV1BlockerRpcClient,
  input: ApiV1UpdateBlockerInput,
): Promise<ApiV1UpdateBlockerResult> {
  return invokeUpdateBlocker(
    API_V1_UPDATE_BLOCKER_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * API-Q.10D2 — invoke the accepted `public.mcp_v1_update_blocker` wrapper
 * (MCP / `mcp` source channel).
 *
 * Identical validation, RPC argument construction, error handling and bounded
 * result contract as the REST function. The ONLY difference is the fixed
 * wrapper name, which the database uses to derive the trusted source channel.
 */
export function updateMcpV1Blocker(
  client: ApiV1BlockerRpcClient,
  input: ApiV1UpdateBlockerInput,
): Promise<ApiV1UpdateBlockerResult> {
  return invokeUpdateBlocker(
    MCP_V1_UPDATE_BLOCKER_FUNCTION_NAME,
    client,
    input,
  );
}

