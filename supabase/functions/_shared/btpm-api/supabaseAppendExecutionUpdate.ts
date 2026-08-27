// API-I.7 / API-Q.9A5 — Explicit RPC adapter for the canonical Execution
// Update mutation.
//
// This module calls exactly two accepted, module-internal fixed database
// wrappers — `public.api_v1_append_execution_update` (REST source) and
// `public.mcp_v1_append_execution_update` (MCP source) — through a
// caller-supplied Supabase RPC client. The caller-supplied client is the trust
// boundary: the runtime must supply a client bound to the current bearer token.
// No wrapper name may come from a caller; there is no generic RPC executor and
// no operation identifier.
//
// This module constructs no Supabase client, reads no environment
// variable, extracts no token, uses no service-role key, calls no
// `fetch`, performs no route matching, performs no logging, schedules no
// timer, caches nothing, holds no mutable global state, exposes no
// generic RPC executor, and performs no dynamic dispatch.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";

/** Exact database wrappers invoked by this adapter. Nothing else. */
const API_V1_APPEND_EXECUTION_UPDATE_FUNCTION_NAME =
  "api_v1_append_execution_update";

/** API-Q.9A5 — fixed MCP-source wrapper (`public.mcp_v1_append_execution_update`). */
const MCP_V1_APPEND_EXECUTION_UPDATE_FUNCTION_NAME =
  "mcp_v1_append_execution_update";

/** The only two wrapper names this module may ever invoke. */
type AppendExecutionUpdateFunctionName =
  | typeof API_V1_APPEND_EXECUTION_UPDATE_FUNCTION_NAME
  | typeof MCP_V1_APPEND_EXECUTION_UPDATE_FUNCTION_NAME;

/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const SAFE_METADATA_PATTERN = /^[A-Za-z0-9._~:@/-]{1,128}$/;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:@/+!=-]{1,255}$/;

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** Fixed typed adapter input. Nothing else may be supplied. */
export interface ApiV1AppendExecutionUpdateInput {
  readonly expectedOauthClientId: string;
  readonly targetType: "phase" | "task";
  readonly targetId: string;
  readonly summary: string;
  readonly updateDate: string;
  readonly statusLabel: string | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

/** Exact RPC argument object sent to the accepted wrapper. */
export interface ApiV1AppendExecutionUpdateRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _target_type: string;
  readonly _target_id: string;
  readonly _summary: string;
  readonly _update_date: string;
  readonly _status_label: string | null;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

/** Minimal structural RPC client contract. */
export interface ApiV1AppendExecutionUpdateRpcClient {
  rpc(
    functionName: string,
    args: ApiV1AppendExecutionUpdateRpcArgs,
  ): Promise<unknown>;
}

/** Successful (applied or replayed) wrapper outcome. */
export interface ApiV1AppendExecutionUpdateSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "replayed";
  readonly executionUpdateId: string;
  readonly targetType: "phase" | "task";
  readonly targetId: string;
  readonly updateDate: string;
  readonly hasStatusLabel: boolean;
}

/** Safe negative wrapper outcome. */
export interface ApiV1AppendExecutionUpdateNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

/** Exact bounded wrapper result union. */
export type ApiV1AppendExecutionUpdateResult =
  | ApiV1AppendExecutionUpdateSuccessResult
  | ApiV1AppendExecutionUpdateNegativeResult;

const SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "executionUpdateId",
  "targetType",
  "targetId",
  "updateDate",
  "hasStatusLabel",
]);

const NEGATIVE_KEYS: ReadonlyArray<string> = Object.freeze(["ok", "outcome"]);

const NEGATIVE_OUTCOMES: ReadonlySet<string> = new Set([
  "invalid",
  "not_authorized",
  "idempotency_conflict",
  "idempotency_pending",
]);

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

function requireTargetType(value: unknown): "phase" | "task" {
  if (value !== "phase" && value !== "task") internal();
  return value;
}

function requireCalendarDate(value: unknown): string {
  if (typeof value !== "string") internal();
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) internal();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) internal();
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    internal();
  }
  return value;
}

function requireBoolean(value: unknown): boolean {
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
  if (typeof value !== "string" || !SHA256_HEX_PATTERN.test(value)) {
    internal();
  }
  return value;
}

function assertBusinessPayload(input: ApiV1AppendExecutionUpdateInput): void {
  if (input.targetType !== "phase" && input.targetType !== "task") internal();
  if (
    typeof input.targetId !== "string" ||
    input.targetId === NIL_UUID ||
    !apiUuidSchema.safeParse(input.targetId).success
  ) {
    internal();
  }
  if (typeof input.summary !== "string" || input.summary.length === 0) {
    internal();
  }
  if (typeof input.updateDate !== "string") internal();
  requireCalendarDate(input.updateDate);
  if (input.statusLabel !== null && typeof input.statusLabel !== "string") {
    internal();
  }
}

function toResult(data: unknown): ApiV1AppendExecutionUpdateResult {
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
      outcome: outcome as ApiV1AppendExecutionUpdateNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, SUCCESS_KEYS);
  const outcome = data.outcome;
  if (outcome !== "applied" && outcome !== "replayed") internal();

  return Object.freeze({
    ok: true,
    outcome,
    executionUpdateId: requireUuid(data.executionUpdateId),
    targetType: requireTargetType(data.targetType),
    targetId: requireUuid(data.targetId),
    updateDate: requireCalendarDate(data.updateDate),
    hasStatusLabel: requireBoolean(data.hasStatusLabel),
  });
}

// -----------------------------------------------------------------------------
// Shared unexported invocation
// -----------------------------------------------------------------------------

/**
 * Single internal invocation path shared by both exported functions.
 *
 * `functionName` is NOT caller-supplied: it is one of the two module-internal
 * literal constants above. This helper is not exported, accepts no operation
 * identifier and performs no dynamic dispatch.
 */
async function invokeAppendExecutionUpdate(
  functionName: AppendExecutionUpdateFunctionName,
  client: ApiV1AppendExecutionUpdateRpcClient,
  input: ApiV1AppendExecutionUpdateInput,
): Promise<ApiV1AppendExecutionUpdateResult> {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    internal();
  }
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  assertBusinessPayload(input);
  const requestId = assertSafeMetadata(input.requestId);
  const correlationId = assertSafeMetadata(input.correlationId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = assertPayloadHash(input.payloadHash);

  let result: unknown;
  try {
    result = await client.rpc(functionName, {
      _expected_oauth_client_id: expectedOauthClientId,
      _target_type: input.targetType,
      _target_id: input.targetId,
      _summary: input.summary,
      _update_date: input.updateDate,
      _status_label: input.statusLabel,
      _request_id: requestId,
      _correlation_id: correlationId,
      _idempotency_key: idempotencyKey,
      _payload_hash: payloadHash,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

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

  return toResult(result.data);
}

/**
 * Invoke the accepted `public.api_v1_append_execution_update` wrapper
 * (REST / `external_api` source channel).
 *
 * The database remains the sole authority for scope derivation, Project
 * Connected App enablement, PMG authorization, persistence and idempotency.
 */
export function appendApiV1ExecutionUpdate(
  client: ApiV1AppendExecutionUpdateRpcClient,
  input: ApiV1AppendExecutionUpdateInput,
): Promise<ApiV1AppendExecutionUpdateResult> {
  return invokeAppendExecutionUpdate(
    API_V1_APPEND_EXECUTION_UPDATE_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * API-Q.9A5 — invoke the accepted `public.mcp_v1_append_execution_update`
 * wrapper (MCP / `mcp` source channel).
 *
 * Identical validation, RPC argument construction, error handling and bounded
 * result contract as the REST function. The ONLY difference is the fixed
 * wrapper name, which the database uses to derive the trusted source channel.
 */
export function appendMcpV1ExecutionUpdate(
  client: ApiV1AppendExecutionUpdateRpcClient,
  input: ApiV1AppendExecutionUpdateInput,
): Promise<ApiV1AppendExecutionUpdateResult> {
  return invokeAppendExecutionUpdate(
    MCP_V1_APPEND_EXECUTION_UPDATE_FUNCTION_NAME,
    client,
    input,
  );
}
