/**
 * Phase 4D.5 — Tenant Context & Storage Substrate helper.
 *
 * Shared, service-role-only utilities for future Edge Functions to:
 *   - validate tenant/organization/workspace boundaries
 *   - build tenant-aware storage paths
 *   - register tenant-aware storage objects
 *   - enqueue tenant-aware background jobs
 *   - read the non-production environment safety profile
 *
 * NOT wired into any existing Edge Function in 4D.5. Per-integration
 * migration steps will opt in.
 *
 * Fail-closed rules:
 *   - tenantId is always required; missing tenant context throws.
 *   - never log secret material.
 *   - never call this helper from browser code — it imports the service role.
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function serviceClient() {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export interface TenantScope {
  tenantId: string;
  organizationId?: string | null;
  workspaceId?: string | null;
}

export function assertTenantScope(scope: Partial<TenantScope>): asserts scope is TenantScope {
  if (!scope?.tenantId) {
    throw new Error("Tenant context required: tenantId is missing");
  }
}

export interface BuildPathArgs extends TenantScope {
  surface: string;
  objectType: string;
  objectId?: string | null;
  fileName: string;
}

export async function buildTenantStoragePath(args: BuildPathArgs): Promise<string> {
  assertTenantScope(args);
  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("build_tenant_storage_path", {
    _tenant_id: args.tenantId,
    _organization_id: args.organizationId,
    _workspace_id: args.workspaceId ?? null,
    _surface: args.surface,
    _object_type: args.objectType,
    _object_id: args.objectId ?? null,
    _file_name: args.fileName,
  });
  if (error) throw new Error(`build_tenant_storage_path failed: ${error.message}`);
  return data as string;
}

export interface RegisterStorageObjectArgs extends BuildPathArgs {
  bucket: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  checksum?: string | null;
  metadata?: Record<string, unknown>;
  legacyObjectPath?: string | null;
  createdBy?: string | null;
}

export async function registerTenantStorageObject(args: RegisterStorageObjectArgs) {
  assertTenantScope(args);
  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("service_register_tenant_storage_object", {
    _tenant_id: args.tenantId,
    _organization_id: args.organizationId,
    _workspace_id: args.workspaceId ?? null,
    _bucket: args.bucket,
    _surface: args.surface,
    _object_type: args.objectType,
    _object_id: args.objectId ?? null,
    _file_name: args.fileName,
    _content_type: args.contentType ?? null,
    _size_bytes: args.sizeBytes ?? null,
    _checksum: args.checksum ?? null,
    _metadata: args.metadata ?? {},
    _legacy_object_path: args.legacyObjectPath ?? null,
    _created_by: args.createdBy ?? null,
  });
  if (error) throw new Error(`service_register_tenant_storage_object failed: ${error.message}`);
  return data;
}

export interface EnqueueJobArgs extends TenantScope {
  jobType: string;
  payload?: Record<string, unknown>;
  priority?: number;
  idempotencyKey?: string | null;
  maxAttempts?: number;
  notBefore?: string | null;
  requestedBy?: string | null;
  runAsUserId?: string | null;
}

export async function enqueueTenantBackgroundJob(args: EnqueueJobArgs) {
  assertTenantScope(args);
  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("service_enqueue_tenant_background_job", {
    _tenant_id: args.tenantId,
    _job_type: args.jobType,
    _payload: args.payload ?? {},
    _organization_id: args.organizationId ?? null,
    _workspace_id: args.workspaceId ?? null,
    _priority: args.priority ?? 100,
    _idempotency_key: args.idempotencyKey ?? null,
    _max_attempts: args.maxAttempts ?? 3,
    _not_before: args.notBefore ?? null,
    _requested_by: args.requestedBy ?? null,
    _run_as_user_id: args.runAsUserId ?? null,
  });
  if (error) throw new Error(`service_enqueue_tenant_background_job failed: ${error.message}`);
  return data;
}

export interface EnvironmentSafetyProfile {
  tenant_id: string;
  organization_id: string;
  organization_kind: string;
  environment_role: "production" | "non_production";
  allow_outbound_email: boolean;
  allow_external_api_writes: boolean;
  allow_real_integrations: boolean;
  allow_exports: boolean;
  export_watermark_required: boolean;
  is_production: boolean;
}

export async function getEnvironmentSafetyProfile(organizationId: string): Promise<EnvironmentSafetyProfile> {
  if (!organizationId) throw new Error("organizationId is required");
  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("get_environment_safety_profile", {
    _organization_id: organizationId,
  });
  if (error) throw new Error(`get_environment_safety_profile failed: ${error.message}`);
  return data as EnvironmentSafetyProfile;
}

/**
 * Service-role-only protected download context.
 * Returns safe metadata (bucket, object_path, file_name, size, status).
 * Never fetches signed URLs here — Edge Function should mint the signed URL
 * from bucket + object_path using its own service-role client.
 *
 * If `requestedBy` is provided, the RPC re-validates that the user still has
 * active tenant/org/workspace membership on the object. Omit to allow
 * system/service-created download contexts.
 */
export interface TenantProtectedDownloadContext {
  storage_object_id: string;
  tenant_id: string;
  organization_id: string;
  workspace_id: string | null;
  bucket: string;
  object_path: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  storage_status: string;
}

export async function getTenantProtectedDownloadContext(args: {
  storageObjectId: string;
  requestedBy?: string | null;
}): Promise<TenantProtectedDownloadContext> {
  if (!args?.storageObjectId) throw new Error("storageObjectId is required");
  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("service_get_tenant_protected_download_context", {
    _storage_object_id: args.storageObjectId,
    _requested_by: args.requestedBy ?? null,
  });
  if (error) throw new Error(`service_get_tenant_protected_download_context failed: ${error.message}`);
  return data as TenantProtectedDownloadContext;
}

/**
 * Phase 4D.7 — Environment safety gate.
 *
 * Service-role-safe wrapper for `public.assert_environment_action_allowed`.
 * Fails closed when organizationId is missing. Never wire into every Edge
 * Function yet — this is the standard gate future flows must call before
 * performing outbound email, real external API writes, real integrations, or
 * exports without a non-production watermark.
 */
export type EnvironmentAction =
  | "outbound_email"
  | "external_api_write"
  | "real_integration"
  | "export"
  | "export_without_watermark"
  | "storage_write"
  | "background_job_enqueue";

export interface EnvironmentActionDecision {
  allowed: true;
  organization_id: string;
  tenant_id: string;
  environment_role: "production" | "non_production";
  action: EnvironmentAction;
  reason: string | null;
}

export async function assertEnvironmentActionAllowed(args: {
  organizationId: string;
  action: EnvironmentAction;
  reason?: string | null;
}): Promise<EnvironmentActionDecision> {
  if (!args?.organizationId) {
    throw new Error("environment_action_blocked: organizationId is required");
  }
  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("assert_environment_action_allowed", {
    _organization_id: args.organizationId,
    _action: args.action,
    _reason: args.reason ?? null,
  });
  if (error) {
    // Re-raise with a stable prefix so callers can pattern-match.
    throw new Error(`environment_action_blocked: ${error.message}`);
  }
  return data as EnvironmentActionDecision;
}

