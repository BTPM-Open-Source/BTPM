// API-H.4C — Explicit `/v1/projects/:projectid` delegated RPC adapter.
//
// This module calls exactly one accepted database wrapper,
// `public.api_v1_get_project`, through a caller-supplied Supabase RPC
// client. The caller-supplied client is the trust boundary: the runtime
// must supply a client bound to the current bearer token.
//
// This module constructs no Supabase client, reads no environment
// variable, extracts no token, uses no service-role key, calls no
// `fetch`, performs no route matching, performs no logging, schedules no
// timer, caches nothing, holds no mutable global state, and exposes no
// generic read executor.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";

/** Exact database wrapper invoked by this adapter. */
const API_V1_GET_PROJECT_FUNCTION_NAME = "api_v1_get_project";

/** SQLSTATE insufficient_privilege. */
const SQLSTATE_INSUFFICIENT_PRIVILEGE = "42501";
/** SQLSTATE invalid_parameter_value. */
const SQLSTATE_INVALID_PARAMETER_VALUE = "22023";

const EXPECTED_OAUTH_CLIENT_ID_PATTERN = /^[A-Za-z0-9._~:@/-]{1,255}$/;

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Minimal structural RPC client contract. */
export interface ApiV1ProjectDetailRpcClient {
  rpc(
    functionName: string,
    args: {
      _expected_oauth_client_id: string;
      _project_id: string;
    },
  ): Promise<unknown>;
}

/** Exact safe `/v1/projects/:projectid` response payload (API-N.3 — 27 fields). */
export interface ApiV1ProjectDetailPayload {
  readonly projectId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly programId: string | null;
  readonly portfolioItemId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly priority: string;
  readonly projectStage: string | null;
  readonly deliveryModel: string | null;
  readonly startDate: string | null;
  readonly targetEndDate: string | null;
  readonly actualStartDate: string | null;
  readonly actualEndDate: string | null;
  readonly agileEnabled: boolean;
  readonly updatedAt: string;
  readonly charter: string | null;
  readonly goals: string | null;
  readonly scopeIn: string | null;
  readonly scopeOut: string | null;
  readonly businessCase: string | null;
  readonly successCriteria: string | null;
  readonly completionCriteria: string | null;
  readonly budgetNarrative: string | null;
  readonly assumptions: string | null;
  readonly constraints: string | null;
}

const EXPECTED_PAYLOAD_KEYS: ReadonlyArray<string> = Object.freeze([
  "projectId",
  "organizationId",
  "workspaceId",
  "programId",
  "portfolioItemId",
  "name",
  "description",
  "status",
  "priority",
  "projectStage",
  "deliveryModel",
  "startDate",
  "targetEndDate",
  "actualStartDate",
  "actualEndDate",
  "agileEnabled",
  "updatedAt",
  "charter",
  "goals",
  "scopeIn",
  "scopeOut",
  "businessCase",
  "successCriteria",
  "completionCriteria",
  "budgetNarrative",
  "assumptions",
  "constraints",
]);


function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function assertValidExpectedOauthClientId(
  value: unknown,
): asserts value is string {
  if (typeof value !== "string") {
    throw new ApiHttpError("internal_error");
  }
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

function requireUuid(value: unknown): string {
  if (!isValidUuid(value)) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireNullableUuid(value: unknown): string | null {
  if (value === null) return null;
  return requireUuid(value);
}

function requireNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireNullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireNullableNonEmptyString(value: unknown): string | null {
  if (value === null) return null;
  return requireNonEmptyString(value);
}

function requireNullableCalendarDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    throw new ApiHttpError("internal_error");
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new ApiHttpError("internal_error");
  }
  const asDate = new Date(Date.UTC(year, month - 1, day));
  if (
    asDate.getUTCFullYear() !== year ||
    asDate.getUTCMonth() !== month - 1 ||
    asDate.getUTCDate() !== day
  ) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiHttpError("internal_error");
  }
  if (value.trim().length === 0) {
    throw new ApiHttpError("internal_error");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiHttpError("internal_error");
  }
  return value;
}

function toPayload(
  data: unknown,
  projectId: string,
): ApiV1ProjectDetailPayload {
  if (!isPlainObject(data)) {
    throw new ApiHttpError("internal_error");
  }
  const keys = Object.keys(data);
  if (keys.length !== EXPECTED_PAYLOAD_KEYS.length) {
    throw new ApiHttpError("internal_error");
  }
  const expected = new Set(EXPECTED_PAYLOAD_KEYS);
  for (const k of keys) {
    if (!expected.has(k)) {
      throw new ApiHttpError("internal_error");
    }
  }
  for (const k of EXPECTED_PAYLOAD_KEYS) {
    if (!(k in data)) {
      throw new ApiHttpError("internal_error");
    }
  }

  const payloadProjectId = requireUuid(data.projectId);
  if (payloadProjectId !== projectId) {
    throw new ApiHttpError("internal_error");
  }

  return Object.freeze({
    projectId: payloadProjectId,
    organizationId: requireUuid(data.organizationId),
    workspaceId: requireUuid(data.workspaceId),
    programId: requireNullableUuid(data.programId),
    portfolioItemId: requireNullableUuid(data.portfolioItemId),
    name: requireNonEmptyString(data.name),
    description: requireNullableString(data.description),
    status: requireNonEmptyString(data.status),
    priority: requireNonEmptyString(data.priority),
    projectStage: requireNullableNonEmptyString(data.projectStage),
    deliveryModel: requireNullableNonEmptyString(data.deliveryModel),
    startDate: requireNullableCalendarDate(data.startDate),
    targetEndDate: requireNullableCalendarDate(data.targetEndDate),
    actualStartDate: requireNullableCalendarDate(data.actualStartDate),
    actualEndDate: requireNullableCalendarDate(data.actualEndDate),
    agileEnabled: typeof data.agileEnabled === "boolean"
      ? data.agileEnabled
      : (() => {
        throw new ApiHttpError("internal_error");
      })(),
    updatedAt: requireTimestamp(data.updatedAt),
    charter: requireNullableString(data.charter),
    goals: requireNullableString(data.goals),
    scopeIn: requireNullableString(data.scopeIn),
    scopeOut: requireNullableString(data.scopeOut),
    businessCase: requireNullableString(data.businessCase),
    successCriteria: requireNullableString(data.successCriteria),
    completionCriteria: requireNullableString(data.completionCriteria),
    budgetNarrative: requireNullableString(data.budgetNarrative),
    assumptions: requireNullableString(data.assumptions),
    constraints: requireNullableString(data.constraints),
  }) as ApiV1ProjectDetailPayload;
}

/**
 * Read the delegated `/v1/projects/:projectid` payload through the
 * accepted database wrapper. Access is decided exclusively by the
 * database.
 */
export async function readApiV1ProjectDetail(
  client: ApiV1ProjectDetailRpcClient,
  expectedOauthClientId: string,
  projectId: string,
): Promise<ApiV1ProjectDetailPayload> {
  if (
    client === null ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof (client as { rpc?: unknown }).rpc !== "function"
  ) {
    throw new ApiHttpError("internal_error");
  }

  assertValidExpectedOauthClientId(expectedOauthClientId);

  if (typeof projectId !== "string") {
    throw new ApiHttpError("invalid_request");
  }
  if (projectId === NIL_UUID) {
    throw new ApiHttpError("invalid_request");
  }
  if (!apiUuidSchema.safeParse(projectId).success) {
    throw new ApiHttpError("invalid_request");
  }

  let result: unknown;
  try {
    result = await client.rpc(API_V1_GET_PROJECT_FUNCTION_NAME, {
      _expected_oauth_client_id: expectedOauthClientId,
      _project_id: projectId,
    });
  } catch (cause) {
    throw new ApiHttpError("internal_error", cause);
  }

  if (!isPlainObject(result)) {
    throw new ApiHttpError("internal_error");
  }
  if (!("data" in result) || !("error" in result)) {
    throw new ApiHttpError("internal_error");
  }

  const error = result.error;
  if (error !== null && error !== undefined) {
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
  if (error === undefined) {
    throw new ApiHttpError("internal_error");
  }

  return toPayload(result.data, projectId);
}
