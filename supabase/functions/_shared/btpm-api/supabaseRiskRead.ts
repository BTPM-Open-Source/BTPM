// API-M.CP.2B1 — Explicit Risk read RPC adapter.
//
// This module calls exactly two accepted CP.2A/C1 database wrappers,
// `public.api_v1_list_project_risks` and `public.api_v1_get_risk`, through a
// caller-supplied Supabase RPC client. The caller-supplied client is the trust
// boundary: the runtime must supply a client bound to the current bearer token.
// The SQL wrappers remain the sole authorization and protected-data boundary;
// no containment logic is duplicated here.
//
// This module constructs no Supabase client, reads no environment variable,
// extracts no token, uses no service-role key, calls no `fetch`, performs no
// route matching, performs no logging, schedules no timer, caches nothing,
// holds no mutable global state, and exposes no generic read executor.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";
import {
  encodeApiV1RiskCursor,
  type ApiV1RiskCursor,
} from "../btpm-api/routes/risks.ts";

/** Exact database wrappers invoked by this adapter. */
const API_V1_LIST_PROJECT_RISKS_FUNCTION_NAME = "api_v1_list_project_risks";
const API_V1_GET_RISK_FUNCTION_NAME = "api_v1_get_risk";

/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";
/** SQLSTATE invalid_parameter_value. */
const SQLSTATE_INVALID_PARAMETER_VALUE = "22023";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const LIMIT_MIN = 1;
const LIMIT_MAX = 500;

/** Minimal structural RPC client contract. */
export interface ApiV1RiskReadRpcClient {
  rpc(functionName: string, args: Record<string, unknown>): Promise<unknown>;
}

/** Exact external Risk representation (collection item and detail). */
export interface ApiV1RiskReadItem {
  readonly riskId: string;
  readonly projectId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly mitigationPlan: string | null;
  readonly likelihood: string;
  readonly impact: string;
  readonly status: string;
  readonly updatedAt: string;
}

/** Exact external Risk collection payload. */
export interface ApiV1ProjectRisksPayload {
  readonly items: readonly ApiV1RiskReadItem[];
  readonly nextCursor: string | null;
}

const EXPECTED_ITEM_KEYS: ReadonlyArray<string> = Object.freeze([
  "riskId",
  "projectId",
  "targetType",
  "targetId",
  "title",
  "description",
  "mitigationPlan",
  "likelihood",
  "impact",
  "status",
  "updatedAt",
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

function requireNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
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

function toRiskItem(value: unknown): ApiV1RiskReadItem {
  if (!isPlainObject(value)) throw new ApiHttpError("internal_error");
  assertExactKeys(value, EXPECTED_ITEM_KEYS);
  return Object.freeze({
    riskId: requireServerUuid(value.riskId),
    projectId: requireServerUuid(value.projectId),
    targetType: requireNonEmptyString(value.targetType),
    targetId: requireServerUuid(value.targetId),
    title: requireNullableString(value.title),
    description: requireNullableString(value.description),
    mitigationPlan: requireNullableString(value.mitigationPlan),
    likelihood: requireNonEmptyString(value.likelihood),
    impact: requireNonEmptyString(value.impact),
    status: requireNonEmptyString(value.status),
    updatedAt: requireTimestamp(value.updatedAt),
  }) as ApiV1RiskReadItem;
}

/**
 * Map a wrapper error to the accepted external error taxonomy.
 * There is deliberately no distinct Risk `not_found` result: the wrapper keeps
 * inaccessible, inconsistent and missing Risks non-enumerable.
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

function requireRpcClient(client: unknown): ApiV1RiskReadRpcClient {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    throw new ApiHttpError("internal_error");
  }
  return client as ApiV1RiskReadRpcClient;
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
 * Read one page of Project Risks through the accepted CP.2A/C1 wrapper.
 * Access is decided exclusively by the database.
 */
export async function readApiV1ProjectRisks(
  client: ApiV1RiskReadRpcClient,
  expectedOauthClientId: string,
  projectId: string,
  limit: number,
  cursor: ApiV1RiskCursor | null,
): Promise<ApiV1ProjectRisksPayload> {
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
    result = await rpcClient.rpc(API_V1_LIST_PROJECT_RISKS_FUNCTION_NAME, {
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
  const items = Object.freeze(data.items.map(toRiskItem));

  const rawCreatedAt = data.nextCursorCreatedAt;
  const rawId = data.nextCursorId;

  let nextCursor: string | null;
  if (rawCreatedAt === null && rawId === null) {
    nextCursor = null;
  } else {
    // A partial or malformed server keyset pair is a server defect.
    nextCursor = encodeApiV1RiskCursor({
      createdAt: requireTimestamp(rawCreatedAt),
      id: requireServerUuid(rawId),
    });
  }

  return Object.freeze({ items, nextCursor }) as ApiV1ProjectRisksPayload;
}

/**
 * Read a single Risk through the accepted CP.2A/C1 wrapper.
 * Access is decided exclusively by the database.
 */
export async function readApiV1Risk(
  client: ApiV1RiskReadRpcClient,
  expectedOauthClientId: string,
  riskId: string,
): Promise<ApiV1RiskReadItem> {
  const rpcClient = requireRpcClient(client);
  assertValidExpectedOauthClientId(expectedOauthClientId);

  const validRiskId = requireExternalUuid(riskId);

  let result: unknown;
  try {
    result = await rpcClient.rpc(API_V1_GET_RISK_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _risk_id: validRiskId,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  return toRiskItem(unwrapRpcResult(result));
}
