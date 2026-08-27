// API-ADM.1 — Service-Role Activity Scope Resolver Adapter.
//
// Sole responsibility: resolve the canonical BTPM hierarchy
// (tenant / organization / workspace / project) for an ALREADY-SUCCESSFUL
// external API mutation target, through exactly one accepted database
// function: `public.api_g_5_10_resolve_target_activity_scope`.
//
// This module constructs no Supabase client, reads no environment variable,
// handles no HTTP, logs nothing, retries nothing, caches nothing, handles no
// token or claims, exposes no generic RPC executor, and performs no dynamic
// dispatch. It is used only for durable activity attribution and is NOT an
// authorization surface.

import { apiUuidSchema } from "./schemas.ts";

/** Exact database function invoked by this adapter. */
const API_ACTIVITY_SCOPE_FUNCTION_NAME =
  "api_g_5_10_resolve_target_activity_scope";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** Exactly the three supported canonical activity target types. */
export type ApiActivityScopeTargetType = "project" | "phase" | "task";

const SUPPORTED_TARGET_TYPES: ReadonlySet<string> = new Set([
  "project",
  "phase",
  "task",
]);

/** Strict four-UUID canonical hierarchy. */
export interface ApiActivityScope {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

/** Minimal structural service-role RPC client contract. */
export interface ApiActivityScopeRpcClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<unknown>;
}

export interface ApiActivityScopeResolver {
  resolve(
    targetType: string,
    targetId: string,
  ): Promise<ApiActivityScope | null>;
}

const EXPECTED_ROW_KEYS: ReadonlyArray<string> = Object.freeze([
  "tenant_id",
  "organization_id",
  "workspace_id",
  "project_id",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === NIL_UUID) return false;
  try {
    return apiUuidSchema.safeParse(value).success;
  } catch {
    return false;
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlyArray<string>,
): boolean {
  const keys = Object.keys(value);
  if (keys.length !== expected.length) return false;
  for (const key of expected) {
    if (!(key in value)) return false;
  }
  return true;
}

function toScope(data: unknown): ApiActivityScope | null {
  // `RETURNS TABLE` yields a row array; exactly one row is accepted.
  if (!Array.isArray(data)) return null;
  if (data.length !== 1) return null;
  const row = data[0];
  if (!isPlainObject(row)) return null;
  if (!hasExactKeys(row, EXPECTED_ROW_KEYS)) return null;
  if (
    !isUuid(row.tenant_id) ||
    !isUuid(row.organization_id) ||
    !isUuid(row.workspace_id) ||
    !isUuid(row.project_id)
  ) {
    return null;
  }
  return Object.freeze({
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
  });
}

/**
 * Creates the single narrow activity-scope resolver. The caller must supply a
 * service-role-bound client; the delegated-user client must never be used.
 */
export function createSupabaseActivityScopeResolver(
  client: ApiActivityScopeRpcClient,
): ApiActivityScopeResolver {
  if (!isPlainObject(client)) {
    throw new TypeError("invalid activity scope client");
  }
  if (typeof (client as { rpc?: unknown }).rpc !== "function") {
    throw new TypeError("invalid activity scope client");
  }

  return Object.freeze({
    async resolve(
      targetType: string,
      targetId: string,
    ): Promise<ApiActivityScope | null> {
      // Fail closed locally on unsupported target type or invalid identity.
      if (typeof targetType !== "string") return null;
      if (!SUPPORTED_TARGET_TYPES.has(targetType)) return null;
      if (!isUuid(targetId)) return null;

      let raw: unknown;
      try {
        raw = await client.rpc(API_ACTIVITY_SCOPE_FUNCTION_NAME, {
          _target_type: targetType,
          _target_id: targetId,
        });
      } catch {
        return null;
      }

      if (!isPlainObject(raw)) return null;
      if (!("data" in raw) || !("error" in raw)) return null;
      if (raw.error !== null) return null;

      return toScope(raw.data);
    },
  });
}
