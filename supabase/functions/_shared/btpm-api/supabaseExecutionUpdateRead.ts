// API-M.CP.3B — Explicit Execution Update read RPC adapter.
//
// This module calls exactly one accepted CP.3A database wrapper,
// `public.api_v1_list_execution_updates`, through a caller-supplied Supabase
// RPC client. The caller-supplied client is the trust boundary: the runtime
// must supply a client bound to the current bearer token. The SQL wrapper
// remains the sole authorization and protected-data boundary; no containment
// logic is duplicated here.
//
// This module constructs no Supabase client, reads no environment variable,
// extracts no token, uses no service-role key, calls no `fetch`, performs no
// route matching, performs no direct table read, performs no logging, schedules
// no timer, caches nothing, holds no mutable global state, and exposes no
// generic read executor.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";
import {
  encodeApiV1ExecutionUpdateCursor,
  type ApiV1ExecutionUpdateCursor,
} from "../btpm-api/routes/executionUpdates.ts";

/** Exact database wrapper invoked by this adapter. */
const API_V1_LIST_EXECUTION_UPDATES_FUNCTION_NAME =
  "api_v1_list_execution_updates";

/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";
/** SQLSTATE invalid_parameter_value. */
const SQLSTATE_INVALID_PARAMETER_VALUE = "22023";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const LIMIT_MIN = 1;
const LIMIT_MAX = 500;

const TARGET_TYPES: ReadonlySet<string> = new Set(["phase", "task"]);

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Minimal structural RPC client contract. */
export interface ApiV1ExecutionUpdateReadRpcClient {
  rpc(functionName: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Exact external Execution Update representation. */
export interface ApiV1ExecutionUpdateReadItem {
  readonly executionUpdateId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly authorId: string;
  readonly summary: string;
  readonly statusLabel: string | null;
  readonly updateDate: string;
  readonly createdAt: string;
}

/** Exact external Execution Update collection payload. */
export interface ApiV1ExecutionUpdatesPayload {
  readonly items: readonly ApiV1ExecutionUpdateReadItem[];
  readonly nextCursor: string | null;
}

const EXPECTED_ITEM_KEYS: ReadonlyArray<string> = Object.freeze([
  "executionUpdateId",
  "targetType",
  "targetId",
  "authorId",
  "summary",
  "statusLabel",
  "updateDate",
  "createdAt",
]);

const EXPECTED_COLLECTION_KEYS: ReadonlyArray<string> = Object.freeze([
  "items",
  "nextCursorCreatedAt",
  "nextCursorId",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    if (!allowed.has(k)) throw new ApiHttpError("internal_error");
  }
  for (const k of expected) {
    if (!(k in value)) throw new ApiHttpError("internal_error");
  }
}

function assertValidExpectedOauthClientId(
  value: unknown,
): asserts value is string {
  if (typeof value !== "string") throw new ApiHttpError("internal_error");
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

function requireExternalUuid(value: unknown): string {
  if (!isValidUuid(value)) throw new ApiHttpError("invalid_request");
  return value;
}

function requireServerUuid(value: unknown): string {
  if (!isValidUuid(value)) throw new ApiHttpError("internal_error");
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== "string") throw new ApiHttpError("internal_error");
  return value;
}

function requireNullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new ApiHttpError("internal_error");
  return value;
}

function requireEnum(value: unknown, allowed: ReadonlySet<string>): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireDateOnly(value: unknown): string {
  if (typeof value !== "string") throw new ApiHttpError("internal_error");
  const match = DATE_ONLY.exec(value);
  if (!match) throw new ApiHttpError("internal_error");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new ApiHttpError("internal_error");
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (!Number.isFinite(Date.parse(value))) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

/**
 * Validate one wrapper row into the exact external shape. `authorId` is exposed
 * as the canonical stored UUID only — no name, email or profile enrichment is
 * performed anywhere on this path.
 */
function toExecutionUpdateItem(value: unknown): ApiV1ExecutionUpdateReadItem {
  if (!isPlainObject(value)) throw new ApiHttpError("internal_error");
  assertExactKeys(value, EXPECTED_ITEM_KEYS);
  return Object.freeze({
    executionUpdateId: requireServerUuid(value.executionUpdateId),
    targetType: requireEnum(value.targetType, TARGET_TYPES),
    targetId: requireServerUuid(value.targetId),
    authorId: requireServerUuid(value.authorId),
    summary: requireString(value.summary),
    statusLabel: requireNullableString(value.statusLabel),
    updateDate: requireDateOnly(value.updateDate),
    createdAt: requireTimestamp(value.createdAt),
  }) as ApiV1ExecutionUpdateReadItem;
}

/**
 * Map a wrapper error to the accepted external error taxonomy. There is
 * deliberately no `not_found` result: the wrapper keeps inaccessible,
 * inconsistent and missing targets non-enumerable.
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

function requireRpcClient(client: unknown): ApiV1ExecutionUpdateReadRpcClient {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    throw new ApiHttpError("internal_error");
  }
  return client as ApiV1ExecutionUpdateReadRpcClient;
}

function unwrapRpcResult(result: unknown): unknown {
  if (!isPlainObject(result)) throw new ApiHttpError("internal_error");
  if (!("data" in result) || !("error" in result)) {
    throw new ApiHttpError("internal_error");
  }
  const error = result.error;
  if (error !== null && error !== undefined) mapWrapperError(error);
  if (error === undefined) throw new ApiHttpError("internal_error");
  return result.data;
}

/**
 * Read one page of Execution Update history for a Phase or Task target through
 * the accepted CP.3A wrapper. Access is decided exclusively by the database.
 */
export async function readApiV1ExecutionUpdates(
  client: ApiV1ExecutionUpdateReadRpcClient,
  expectedOauthClientId: string,
  targetType: string,
  targetId: string,
  limit: number,
  cursor: ApiV1ExecutionUpdateCursor | null,
): Promise<ApiV1ExecutionUpdatesPayload> {
  const rpcClient = requireRpcClient(client);
  assertValidExpectedOauthClientId(expectedOauthClientId);

  if (typeof targetType !== "string" || !TARGET_TYPES.has(targetType)) {
    throw new ApiHttpError("invalid_request");
  }
  const validTargetId = requireExternalUuid(targetId);

  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < LIMIT_MIN ||
    limit > LIMIT_MAX
  ) {
    throw new ApiHttpError("invalid_request");
  }

  if (cursor !== null) {
    if (!isPlainObject(cursor)) throw new ApiHttpError("invalid_request");
    if (
      typeof cursor.createdAt !== "string" ||
      !Number.isFinite(Date.parse(cursor.createdAt))
    ) {
      throw new ApiHttpError("invalid_request");
    }
    requireExternalUuid(cursor.id);
  }

  let result: unknown;
  try {
    result = await rpcClient.rpc(API_V1_LIST_EXECUTION_UPDATES_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _target_type: targetType,
      _target_id: validTargetId,
      _limit: limit,
      _after_created_at: cursor === null ? null : cursor.createdAt,
      _after_id: cursor === null ? null : cursor.id,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  const data = unwrapRpcResult(result);
  if (!isPlainObject(data)) throw new ApiHttpError("internal_error");
  assertExactKeys(data, EXPECTED_COLLECTION_KEYS);

  if (!Array.isArray(data.items)) throw new ApiHttpError("internal_error");
  const items = Object.freeze(data.items.map(toExecutionUpdateItem));

  const rawCreatedAt = data.nextCursorCreatedAt;
  const rawId = data.nextCursorId;

  let nextCursor: string | null;
  if (rawCreatedAt === null && rawId === null) {
    nextCursor = null;
  } else {
    // A partial or malformed server keyset pair is a server defect. Internal
    // keyset fields never escape externally.
    nextCursor = encodeApiV1ExecutionUpdateCursor({
      createdAt: requireTimestamp(rawCreatedAt),
      id: requireServerUuid(rawId),
    });
  }

  return Object.freeze({ items, nextCursor }) as ApiV1ExecutionUpdatesPayload;
}
