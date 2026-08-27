// API-G.5.10A-2 — Service-Role Durable Activity Adapter.
//
// Calls `public.api_g_5_10_record_api_activity` through a caller-supplied
// service-role Supabase client. This module intentionally does NOT construct
// a Supabase client, read environment variables, handle HTTP, retry, cache,
// log, or fall back to direct table insertion. Canonical scope containment
// remains authoritative in the database trigger.

import { ApiHttpError } from "./http.ts";
import { apiUuidSchema } from "./schemas.ts";

// -----------------------------------------------------------------------------
// Public contracts
// -----------------------------------------------------------------------------

export type ApiActivityMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD";

export interface ApiActivityRecordInput {
  apiClientId: string;
  apiVersion: string;
  routeId: string;
  method: ApiActivityMethod;
  status: number;
  durationMs: number;

  actorUserId: string | null;
  tenantId: string | null;
  organizationId: string | null;
  workspaceId: string | null;
  projectId: string | null;

  correlationId: string | null;
}

export interface ApiActivityRecorder {
  record(input: ApiActivityRecordInput): Promise<boolean>;
}

export interface SupabaseActivityClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<unknown>;
}

// -----------------------------------------------------------------------------
// Internal validation helpers
// -----------------------------------------------------------------------------

const API_VERSION_PATTERN = /^v[1-9][0-9]*$/;
const ROUTE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const ALLOWED_METHODS: readonly string[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isUuid(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try {
    return apiUuidSchema.safeParse(v).success;
  } catch {
    return false;
  }
}

function isNullableUuid(v: unknown): v is string | null {
  return v === null || isUuid(v);
}

function isIntegerInRange(v: unknown, min: number, max: number): v is number {
  return (
    typeof v === "number" &&
    Number.isFinite(v) &&
    Number.isSafeInteger(v) &&
    v >= min &&
    v <= max
  );
}

function isValidScopeShape(
  tenantId: string | null,
  organizationId: string | null,
  workspaceId: string | null,
  projectId: string | null,
): boolean {
  if (tenantId === null) {
    return (
      organizationId === null && workspaceId === null && projectId === null
    );
  }
  if (organizationId === null) {
    return workspaceId === null && projectId === null;
  }
  if (workspaceId === null) {
    return projectId === null;
  }
  return true;
}

function isValidInput(input: unknown): input is ApiActivityRecordInput {
  if (!isPlainObject(input)) return false;

  const {
    apiClientId,
    apiVersion,
    routeId,
    method,
    status,
    durationMs,
    actorUserId,
    tenantId,
    organizationId,
    workspaceId,
    projectId,
    correlationId,
  } = input as Record<string, unknown>;

  if (!isUuid(apiClientId)) return false;
  if (typeof apiVersion !== "string" || !API_VERSION_PATTERN.test(apiVersion)) {
    return false;
  }
  if (typeof routeId !== "string" || !ROUTE_ID_PATTERN.test(routeId)) {
    return false;
  }
  if (typeof method !== "string" || !ALLOWED_METHODS.includes(method)) {
    return false;
  }
  if (!isIntegerInRange(status, 100, 599)) return false;
  if (!isIntegerInRange(durationMs, 0, 3_600_000)) return false;

  if (!isNullableUuid(actorUserId)) return false;
  if (!isNullableUuid(tenantId)) return false;
  if (!isNullableUuid(organizationId)) return false;
  if (!isNullableUuid(workspaceId)) return false;
  if (!isNullableUuid(projectId)) return false;

  if (
    correlationId !== null &&
    (typeof correlationId !== "string" ||
      !CORRELATION_ID_PATTERN.test(correlationId))
  ) {
    return false;
  }

  return isValidScopeShape(
    tenantId as string | null,
    organizationId as string | null,
    workspaceId as string | null,
    projectId as string | null,
  );
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

export function createSupabaseActivityRecorder(
  client: SupabaseActivityClient,
): ApiActivityRecorder {
  if (!isPlainObject(client)) {
    throw new ApiHttpError("internal_error");
  }
  if (typeof (client as { rpc?: unknown }).rpc !== "function") {
    throw new ApiHttpError("internal_error");
  }

  return Object.freeze({
    async record(input: ApiActivityRecordInput): Promise<boolean> {
      if (!isValidInput(input)) return false;

      let raw: unknown;
      try {
        raw = await client.rpc("api_g_5_10_record_api_activity", {
          _api_client_id: input.apiClientId,
          _api_version: input.apiVersion,
          _route_id: input.routeId,
          _http_method: input.method,
          _http_status: input.status,
          _duration_ms: input.durationMs,
          _actor_user_id: input.actorUserId,
          _tenant_id: input.tenantId,
          _organization_id: input.organizationId,
          _workspace_id: input.workspaceId,
          _project_id: input.projectId,
          _correlation_id: input.correlationId,
        });
      } catch {
        return false;
      }

      if (!isPlainObject(raw)) return false;
      if (!("data" in raw) || !("error" in raw)) return false;
      if (raw.error !== null) return false;

      return isUuid(raw.data);
    },
  });
}
