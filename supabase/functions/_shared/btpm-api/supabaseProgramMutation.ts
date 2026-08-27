// API-N.9A — Explicit RPC adapter for the single external Program mutation.
//
// This module calls exactly one accepted API-N.9A database wrapper,
// `public.api_v1_create_program`, through a caller-supplied Supabase RPC
// client. The caller-supplied client is the trust boundary: the runtime must
// supply a client bound to the current bearer token.
//
// This module constructs no Supabase client, reads no environment variable,
// extracts no token, uses no service-role key, calls no `fetch`, performs no
// route matching, performs no logging, schedules no timer, caches nothing,
// holds no mutable global state, exposes no generic RPC executor, performs no
// dynamic dispatch, and never touches Connected App enablement.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";

/** Exact REST-source database wrapper invoked by this module. */
const API_V1_CREATE_PROGRAM_FUNCTION_NAME = "api_v1_create_program";

/** Exact MCP-source database wrapper invoked by this module. */
const MCP_V1_CREATE_PROGRAM_FUNCTION_NAME = "mcp_v1_create_program";

/** Closed set of Program Create wrappers. No dynamic wrapper name exists. */
type CreateProgramFunctionName =
  | typeof API_V1_CREATE_PROGRAM_FUNCTION_NAME
  | typeof MCP_V1_CREATE_PROGRAM_FUNCTION_NAME;

/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;
const SAFE_METADATA_PATTERN = /^[A-Za-z0-9._~:@/-]{1,128}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:@/+!=-]{1,255}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const NAME_MAX_LENGTH = 200;

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export interface ApiV1CreateProgramInput {
  readonly expectedOauthClientId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly description: string | null;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1CreateProgramRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _workspace_id: string;
  readonly _name: string;
  readonly _description: string | null;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

/** Minimal structural RPC client contract. */
export interface ApiV1ProgramMutationRpcClient {
  rpc(
    functionName: string,
    args: ApiV1CreateProgramRpcArgs,
  ): Promise<unknown>;
}

// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------

export interface ApiV1CreateProgramSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "replayed";
  readonly programId: string;
}

export interface ApiV1CreateProgramNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1CreateProgramResult =
  | ApiV1CreateProgramSuccessResult
  | ApiV1CreateProgramNegativeResult;

const SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "programId",
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

function assertName(value: unknown): string {
  if (typeof value !== "string") internal();
  if (value.length === 0 || value.length > NAME_MAX_LENGTH) internal();
  return value;
}

function assertNullableDescription(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0) internal();
  return value;
}

function assertRpcClient(
  client: unknown,
): asserts client is ApiV1ProgramMutationRpcClient {
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
// Result mapper
// -----------------------------------------------------------------------------

function toCreateProgramResult(data: unknown): ApiV1CreateProgramResult {
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
      outcome: outcome as ApiV1CreateProgramNegativeResult["outcome"],
    });
  }

  assertExactKeys(data, SUCCESS_KEYS);
  const outcome = data.outcome;
  if (outcome !== "applied" && outcome !== "replayed") internal();

  return Object.freeze({
    ok: true,
    outcome,
    programId: requireUuid(data.programId),
  });
}

// -----------------------------------------------------------------------------
// Adapter — one closed shared invocation path, two fixed wrappers
// -----------------------------------------------------------------------------

/**
 * The single Program Create RPC invocation. The wrapper `functionName` is
 * constrained by the closed `CreateProgramFunctionName` type and is supplied
 * only by the two thin exported adapters below; it is never caller-controlled.
 */
async function invokeCreateProgram(
  functionName: CreateProgramFunctionName,
  client: ApiV1ProgramMutationRpcClient,
  input: ApiV1CreateProgramInput,
): Promise<ApiV1CreateProgramResult> {
  assertRpcClient(client);
  if (!isPlainObject(input)) internal();

  const expectedOauthClientId = assertValidExpectedOauthClientId(
    input.expectedOauthClientId,
  );
  const workspaceId = requireUuid(input.workspaceId);
  const name = assertName(input.name);
  const description = assertNullableDescription(input.description);
  const requestId = assertSafeMetadata(input.requestId);
  const correlationId = assertSafeMetadata(input.correlationId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const payloadHash = assertPayloadHash(input.payloadHash);

  let result: unknown;
  try {
    result = await client.rpc(functionName, {
      _expected_oauth_client_id: expectedOauthClientId,
      _workspace_id: workspaceId,
      _name: name,
      _description: description,
      _request_id: requestId,
      _correlation_id: correlationId,
      _idempotency_key: idempotencyKey,
      _payload_hash: payloadHash,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toCreateProgramResult(unwrapRpcEnvelope(result));
}

/**
 * Invoke the accepted `public.api_v1_create_program` wrapper. The database
 * remains the sole authority for Organization derivation, Connected App
 * authorization, capability grant enforcement, idempotency, and the canonical
 * Program creation command itself.
 */
export function createApiV1Program(
  client: ApiV1ProgramMutationRpcClient,
  input: ApiV1CreateProgramInput,
): Promise<ApiV1CreateProgramResult> {
  return invokeCreateProgram(
    API_V1_CREATE_PROGRAM_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * Invoke the accepted MCP-source `public.mcp_v1_create_program` wrapper. The
 * only difference from the REST adapter is the fixed wrapper selected here.
 */
export function createMcpV1Program(
  client: ApiV1ProgramMutationRpcClient,
  input: ApiV1CreateProgramInput,
): Promise<ApiV1CreateProgramResult> {
  return invokeCreateProgram(
    MCP_V1_CREATE_PROGRAM_FUNCTION_NAME,
    client,
    input,
  );
}

// -----------------------------------------------------------------------------
// API-N.9B — `public.api_v1_update_program`
//
// The second and only other accepted Program wrapper. Both function names remain
// hardcoded constants; no dynamic function name and no generic dispatcher is
// introduced.
// -----------------------------------------------------------------------------

/** Exact database wrapper invoked by the update adapter. */
const API_V1_UPDATE_PROGRAM_FUNCTION_NAME = "api_v1_update_program";

/** Exact MCP-source database wrapper invoked by the update adapter. */
const MCP_V1_UPDATE_PROGRAM_FUNCTION_NAME = "mcp_v1_update_program";

/** Closed set of Program Update wrappers. No dynamic wrapper name exists. */
type UpdateProgramFunctionName =
  | typeof API_V1_UPDATE_PROGRAM_FUNCTION_NAME
  | typeof MCP_V1_UPDATE_PROGRAM_FUNCTION_NAME;

const PROGRAM_STATUS_VALUES: ReadonlySet<string> = new Set([
  "planned",
  "active",
  "completed",
  "on_hold",
  "cancelled",
]);

const TIMESTAMPTZ_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}(?::?\d{2})?)$/;

export interface ApiV1UpdateProgramInput {
  readonly expectedOauthClientId: string;
  readonly programId: string;
  readonly expectedUpdatedAt: string;
  readonly name: string | null;
  readonly status: string | null;
  readonly description: string | null;
  readonly setDescription: boolean;
  readonly requestId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
}

export interface ApiV1UpdateProgramRpcArgs {
  readonly _expected_oauth_client_id: string;
  readonly _program_id: string;
  readonly _expected_updated_at: string;
  readonly _name: string | null;
  readonly _status: string | null;
  readonly _description: string | null;
  readonly _set_description: boolean;
  readonly _request_id: string;
  readonly _correlation_id: string;
  readonly _idempotency_key: string;
  readonly _payload_hash: string;
}

/**
 * The RPC client contract is extended ONLY for the two explicit accepted
 * Program wrappers. Overloads keep both call shapes statically bound.
 */
export interface ApiV1ProgramUpdateMutationRpcClient {
  rpc(
    functionName: string,
    args: ApiV1UpdateProgramRpcArgs,
  ): Promise<unknown>;
}

export interface ApiV1UpdateProgramSuccessResult {
  readonly ok: true;
  readonly outcome: "applied" | "no_change" | "replayed";
  readonly programId: string;
  readonly updatedAt: string;
}

export interface ApiV1UpdateProgramConflictResult {
  readonly ok: false;
  readonly outcome: "conflict";
  readonly code: "stale_program";
}

export interface ApiV1UpdateProgramNegativeResult {
  readonly ok: false;
  readonly outcome:
    | "invalid"
    | "not_authorized"
    | "idempotency_conflict"
    | "idempotency_pending";
}

export type ApiV1UpdateProgramResult =
  | ApiV1UpdateProgramSuccessResult
  | ApiV1UpdateProgramConflictResult
  | ApiV1UpdateProgramNegativeResult;

const UPDATE_SUCCESS_KEYS: ReadonlyArray<string> = Object.freeze([
  "ok",
  "outcome",
  "programId",
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

function assertBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") internal();
  return value;
}

function assertTimestamptz(value: unknown): string {
  if (typeof value !== "string" || !TIMESTAMPTZ_PATTERN.test(value)) internal();
  return value;
}

function assertUpdateDescription(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) internal();
  return value;
}

function assertNullableUpdateName(value: unknown): string | null {
  if (value === null) return null;
  return assertName(value);
}

function assertNullableStatus(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !PROGRAM_STATUS_VALUES.has(value)) {
    internal();
  }
  return value;
}

function toUpdateProgramResult(data: unknown): ApiV1UpdateProgramResult {
  if (!isPlainObject(data)) internal();
  const ok = data.ok;
  if (typeof ok !== "boolean") internal();

  if (ok === true) {
    assertExactKeys(data, UPDATE_SUCCESS_KEYS);
    const outcome = data.outcome;
    if (typeof outcome !== "string" || !UPDATE_SUCCESS_OUTCOMES.has(outcome)) {
      internal();
    }
    return Object.freeze({
      ok: true,
      outcome: outcome as ApiV1UpdateProgramSuccessResult["outcome"],
      programId: requireUuid(data.programId),
      updatedAt: assertTimestamptz(data.updatedAt),
    });
  }

  if (data.outcome === "conflict") {
    assertExactKeys(data, UPDATE_CONFLICT_KEYS);
    if (data.code !== "stale_program") internal();
    return Object.freeze({
      ok: false,
      outcome: "conflict",
      code: "stale_program",
    });
  }

  assertExactKeys(data, NEGATIVE_KEYS);
  const outcome = data.outcome;
  if (typeof outcome !== "string" || !NEGATIVE_OUTCOMES.has(outcome)) {
    internal();
  }
  return Object.freeze({
    ok: false,
    outcome: outcome as ApiV1UpdateProgramNegativeResult["outcome"],
  });
}

/**
 * The single Program Update RPC invocation. The wrapper `functionName` is
 * constrained by the closed `UpdateProgramFunctionName` type and is supplied
 * only by the two thin exported adapters below; it is never caller-controlled.
 */
async function invokeUpdateProgram(
  functionName: UpdateProgramFunctionName,
  client: ApiV1ProgramUpdateMutationRpcClient,
  input: ApiV1UpdateProgramInput,
): Promise<ApiV1UpdateProgramResult> {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    internal();
  }
  if (!isPlainObject(input)) internal();

  const setDescription = assertBoolean(input.setDescription);
  const description = setDescription
    ? (input.description === null
      ? null
      : assertUpdateDescription(input.description))
    : (input.description === null ? null : internal());

  const args: ApiV1UpdateProgramRpcArgs = {
    _expected_oauth_client_id: assertValidExpectedOauthClientId(
      input.expectedOauthClientId,
    ),
    _program_id: requireUuid(input.programId),
    _expected_updated_at: assertTimestamptz(input.expectedUpdatedAt),
    _name: assertNullableUpdateName(input.name),
    _status: assertNullableStatus(input.status),
    _description: description,
    _set_description: setDescription,
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

  return toUpdateProgramResult(unwrapRpcEnvelope(result));
}

/**
 * Invoke the accepted `public.api_v1_update_program` wrapper. The database
 * remains the sole authority for Organization/Workspace derivation, Connected
 * App authorization, capability grant enforcement, idempotency, optimistic
 * concurrency and the canonical Program update command itself.
 */
export function updateApiV1Program(
  client: ApiV1ProgramUpdateMutationRpcClient,
  input: ApiV1UpdateProgramInput,
): Promise<ApiV1UpdateProgramResult> {
  return invokeUpdateProgram(
    API_V1_UPDATE_PROGRAM_FUNCTION_NAME,
    client,
    input,
  );
}

/**
 * Invoke the accepted MCP-source `public.mcp_v1_update_program` wrapper. The
 * only difference from the REST adapter is the fixed wrapper selected here.
 */
export function updateMcpV1Program(
  client: ApiV1ProgramUpdateMutationRpcClient,
  input: ApiV1UpdateProgramInput,
): Promise<ApiV1UpdateProgramResult> {
  return invokeUpdateProgram(
    MCP_V1_UPDATE_PROGRAM_FUNCTION_NAME,
    client,
    input,
  );
}
