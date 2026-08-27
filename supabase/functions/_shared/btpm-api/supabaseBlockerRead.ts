// API-M.CP.2C2 — Explicit Blocker read RPC adapter.
//
// This module calls exactly two accepted CP.2C1 database wrappers,
// `public.api_v1_list_project_blockers` and `public.api_v1_get_blocker`,
// through a caller-supplied Supabase RPC client. The caller-supplied client is
// the trust boundary: the runtime must supply a client bound to the current
// bearer token. The SQL wrappers remain the sole authorization and
// protected-data boundary; no containment logic is duplicated here.
//
// This module constructs no Supabase client, reads no environment variable,
// extracts no token, uses no service-role key, calls no `fetch`, performs no
// route matching, performs no logging, schedules no timer, caches nothing,
// holds no mutable global state, and exposes no generic read executor.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";
import {
  encodeApiV1BlockerCursor,
  type ApiV1BlockerCursor,
} from "../btpm-api/routes/blockers.ts";

/** Exact database wrappers invoked by this adapter. */
const API_V1_LIST_PROJECT_BLOCKERS_FUNCTION_NAME =
  "api_v1_list_project_blockers";
const API_V1_GET_BLOCKER_FUNCTION_NAME = "api_v1_get_blocker";

/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";
/** SQLSTATE invalid_parameter_value. */
const SQLSTATE_INVALID_PARAMETER_VALUE = "22023";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const LIMIT_MIN = 1;
const LIMIT_MAX = 500;

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

/** Minimal structural RPC client contract. */
export interface ApiV1BlockerReadRpcClient {
  rpc(functionName: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Exact external Blocker representation (collection item and detail). */
export interface ApiV1BlockerReadItem {
  readonly blockerId: string;
  readonly projectId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly title: string;
  readonly description: string | null;
  readonly severity: string;
  readonly status: string;
  readonly resolvedAt: string | null;
  readonly updatedAt: string;
  readonly resolvedBy: string | null;
}

/** Exact external Blocker collection payload. */
export interface ApiV1ProjectBlockersPayload {
  readonly items: readonly ApiV1BlockerReadItem[];
  readonly nextCursor: string | null;
}

const EXPECTED_ITEM_KEYS: ReadonlyArray<string> = Object.freeze([
  "blockerId",
  "projectId",
  "targetType",
  "targetId",
  "title",
  "description",
  "severity",
  "status",
  "resolvedAt",
  "updatedAt",
  "resolvedBy",
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

/** `resolved_by` is exposed as the canonical stored UUID or null only. */
function requireNullableServerUuid(value: unknown): string | null {
  if (value === null) return null;
  return requireServerUuid(value);
}

function requireNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireEnum(value: unknown, allowed: ReadonlySet<string>): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireNullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new ApiHttpError("internal_error");
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

function requireNullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  return requireTimestamp(value);
}

function toBlockerItem(value: unknown): ApiV1BlockerReadItem {
  if (!isPlainObject(value)) throw new ApiHttpError("internal_error");
  assertExactKeys(value, EXPECTED_ITEM_KEYS);
  return Object.freeze({
    blockerId: requireServerUuid(value.blockerId),
    projectId: requireServerUuid(value.projectId),
    targetType: requireEnum(value.targetType, TARGET_TYPES),
    targetId: requireServerUuid(value.targetId),
    title: requireNonEmptyString(value.title),
    description: requireNullableString(value.description),
    severity: requireEnum(value.severity, SEVERITIES),
    status: requireEnum(value.status, STATUSES),
    resolvedAt: requireNullableTimestamp(value.resolvedAt),
    updatedAt: requireTimestamp(value.updatedAt),
    resolvedBy: requireNullableServerUuid(value.resolvedBy),
  }) as ApiV1BlockerReadItem;
}

/**
 * Map a wrapper error to the accepted external error taxonomy.
 * There is deliberately no distinct Blocker `not_found` result: the wrapper
 * keeps inaccessible, inconsistent and missing Blockers non-enumerable.
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

function requireRpcClient(client: unknown): ApiV1BlockerReadRpcClient {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    throw new ApiHttpError("internal_error");
  }
  return client as ApiV1BlockerReadRpcClient;
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
 * Read one page of Project Blockers through the accepted CP.2C1 wrapper.
 * Access is decided exclusively by the database.
 */
export async function readApiV1ProjectBlockers(
  client: ApiV1BlockerReadRpcClient,
  expectedOauthClientId: string,
  projectId: string,
  limit: number,
  cursor: ApiV1BlockerCursor | null,
): Promise<ApiV1ProjectBlockersPayload> {
  const rpcClient = requireRpcClient(client);
  assertValidExpectedOauthClientId(expectedOauthClientId);

  const validProjectId = requireExternalUuid(projectId);

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
    result = await rpcClient.rpc(API_V1_LIST_PROJECT_BLOCKERS_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _project_id: validProjectId,
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
  const items = Object.freeze(data.items.map(toBlockerItem));

  const rawCreatedAt = data.nextCursorCreatedAt;
  const rawId = data.nextCursorId;

  let nextCursor: string | null;
  if (rawCreatedAt === null && rawId === null) {
    nextCursor = null;
  } else {
    // A partial or malformed server keyset pair is a server defect.
    nextCursor = encodeApiV1BlockerCursor({
      createdAt: requireTimestamp(rawCreatedAt),
      id: requireServerUuid(rawId),
    });
  }

  return Object.freeze({ items, nextCursor }) as ApiV1ProjectBlockersPayload;
}

/**
 * Read a single Blocker through the accepted CP.2C1 wrapper.
 * Access is decided exclusively by the database.
 */
export async function readApiV1Blocker(
  client: ApiV1BlockerReadRpcClient,
  expectedOauthClientId: string,
  blockerId: string,
): Promise<ApiV1BlockerReadItem> {
  const rpcClient = requireRpcClient(client);
  assertValidExpectedOauthClientId(expectedOauthClientId);

  const validBlockerId = requireExternalUuid(blockerId);

  let result: unknown;
  try {
    result = await rpcClient.rpc(API_V1_GET_BLOCKER_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _blocker_id: validBlockerId,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toBlockerItem(unwrapRpcResult(result));
}
