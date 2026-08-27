/**
 * Tenant Integration Secrets resolver (shared, Edge-Function-only).
 *
 * Two capabilities:
 *   1. Metadata resolution via `public.resolve_effective_integration_secret_ref`
 *      — returns integration metadata (kind, name, config_metadata) plus the
 *      Vault secret UUID for the effective secret ref. This path remains
 *      available and unchanged.
 *   2. Decrypted-value resolution via
 *      `public.resolve_effective_integration_secret_value` — now ACTIVE for
 *      Tenant-migrated runtime integrations. MuleSoft KPI is the first
 *      runtime family using it (Phase 4D.14A.2). Additional runtime
 *      families will opt in through the same helper.
 *
 * Fail-closed rules:
 *   - `tenantId` is required.
 *   - `organizationId` is passed to the resolver so it honors organization
 *     overrides (including disabled overrides).
 *   - Never log the secret value, Vault UUID, or fingerprint.
 *   - Service-role only — this module reads the service role key and MUST
 *     NOT be imported from browser code.
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

export type TenantIntegrationKind =
  | "openai"
  | "azure_openai"
  | "microsoft_graph"
  | "sharepoint"
  | "sap"
  | "salesforce"
  | "mulesoft_kpi"
  | "smtp"
  | "webhook"
  | "storage_export"
  | "other";

export interface ResolveArgs {
  tenantId: string;
  organizationId?: string | null;
  integrationKind: TenantIntegrationKind;
  secretName: string;
  integrationName?: string; // defaults to 'default'
  reason?: string | null;
  functionName?: string | null;
  requestId?: string | null;
}

export interface ResolvedSecretRefMetadata {
  status: "ok" | "blocked" | "not_found";
  reason?: string;
  integrationId?: string;
  integrationKind?: TenantIntegrationKind;
  integrationName?: string;
  secretRefId?: string;
  secretName?: string;
  secretKind?: string;
  secretScope?: "tenant" | "organization_override";
  organizationId?: string | null;
  vaultSecretId?: string;
  fingerprint?: string | null;
  configMetadata?: Record<string, unknown>;
}

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

/**
 * Resolve the effective secret reference metadata for a tenant integration.
 * Fails closed when tenant context is missing. Returns metadata only.
 */
export async function resolveTenantIntegrationSecretRef(
  args: ResolveArgs,
): Promise<ResolvedSecretRefMetadata> {
  if (!args?.tenantId) {
    throw new Error("resolveTenantIntegrationSecretRef: tenantId is required");
  }
  if (!args.integrationKind) {
    throw new Error("resolveTenantIntegrationSecretRef: integrationKind is required");
  }
  if (!args.secretName) {
    throw new Error("resolveTenantIntegrationSecretRef: secretName is required");
  }

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc(
    "resolve_effective_integration_secret_ref",
    {
      _tenant_id: args.tenantId,
      _organization_id: args.organizationId ?? null,
      _integration_kind: args.integrationKind,
      _secret_name: args.secretName,
      _integration_name: args.integrationName ?? "default",
      _reason: args.reason ?? null,
      _function_name: args.functionName ?? null,
      _request_id: args.requestId ?? null,
    },
  );

  if (error) {
    // Never include secret material. `error.message` is safe (comes from the
    // resolver's own text and never contains a secret value).
    throw new Error(`Tenant secret resolver failed: ${error.message}`);
  }

  const raw = (data ?? {}) as Record<string, any>;
  return {
    status: (raw.status ?? "not_found") as ResolvedSecretRefMetadata["status"],
    reason: raw.reason,
    integrationId: raw.integration_id,
    integrationKind: raw.integration_kind,
    integrationName: raw.integration_name,
    secretRefId: raw.secret_ref_id,
    secretName: raw.secret_name,
    secretKind: raw.secret_kind,
    secretScope: raw.secret_scope,
    organizationId: raw.organization_id ?? null,
    vaultSecretId: raw.vault_secret_id,
    fingerprint: raw.fingerprint,
    configMetadata: raw.config_metadata,
  };
}

/**
 * Phase 4D.14A.2 — Generic Edge-only decrypted-value resolver.
 *
 * Wraps `public.resolve_effective_integration_secret_value` and returns the
 * decrypted secret value ONLY when the resolver status is `ok`. All other
 * outcomes (blocked / not_found / malformed / empty) fail closed by
 * throwing a `TenantIntegrationSecretError`.
 *
 * This helper NEVER logs or returns:
 *   - the secret value
 *   - Vault UUIDs
 *   - fingerprints
 *   - ciphertext
 *
 * Do not import from browser code. Do not fall back to Global env secrets.
 */
export type TenantIntegrationSecretResolveCode =
  | "blocked"
  | "not_found"
  | "malformed"
  | "empty"
  | "resolver_unavailable";


export class TenantIntegrationSecretError extends Error {
  code: TenantIntegrationSecretResolveCode;
  integrationKind: TenantIntegrationKind;
  secretName: string;
  constructor(
    code: TenantIntegrationSecretResolveCode,
    message: string,
    integrationKind: TenantIntegrationKind,
    secretName: string,
  ) {
    super(message);
    this.name = "TenantIntegrationSecretError";
    this.code = code;
    this.integrationKind = integrationKind;
    this.secretName = secretName;
  }
}

export interface ResolvedSecretValue {
  value: string;
  integrationId: string;
  integrationName: string;
  secretName: string;
  secretScope?: "tenant" | "organization_override";
  organizationId?: string | null;
  configMetadata?: Record<string, unknown>;
}

export async function resolveTenantIntegrationSecretValue(
  args: ResolveArgs,
): Promise<ResolvedSecretValue> {
  if (!args?.tenantId) {
    throw new Error("resolveTenantIntegrationSecretValue: tenantId is required");
  }
  if (!args.integrationKind) {
    throw new Error("resolveTenantIntegrationSecretValue: integrationKind is required");
  }
  if (!args.secretName) {
    throw new Error("resolveTenantIntegrationSecretValue: secretName is required");
  }

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc(
    "resolve_effective_integration_secret_value",
    {
      _tenant_id: args.tenantId,
      _organization_id: args.organizationId ?? null,
      _integration_kind: args.integrationKind,
      _secret_name: args.secretName,
      _integration_name: args.integrationName ?? "default",
      _reason: args.reason ?? null,
      _function_name: args.functionName ?? null,
      _request_id: args.requestId ?? null,
    },
  );

  if (error) {
    // Never propagate raw RPC/PostgREST text — it may reference SQL objects,
    // function names, or IDs. Classify as resolver_unavailable so callers
    // can distinguish infrastructure failure from missing configuration.
    throw new TenantIntegrationSecretError(
      "resolver_unavailable",
      "Tenant secret value resolver is unavailable.",
      args.integrationKind,
      args.secretName,
    );
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TenantIntegrationSecretError(
      "malformed",
      "Tenant integration secret resolver returned a malformed response.",
      args.integrationKind,
      args.secretName,
    );
  }
  const raw = data as Record<string, any>;
  const status = raw.status;
  if (status === "blocked") {
    throw new TenantIntegrationSecretError(
      "blocked",
      `Tenant integration secret '${args.secretName}' is blocked by an organization override.`,
      args.integrationKind,
      args.secretName,
    );
  }
  if (status === "not_found") {
    throw new TenantIntegrationSecretError(
      "not_found",
      `Tenant integration secret '${args.secretName}' is not configured.`,
      args.integrationKind,
      args.secretName,
    );
  }
  if (status !== "ok") {
    throw new TenantIntegrationSecretError(
      "malformed",
      "Tenant integration secret resolver returned an unrecognized status.",
      args.integrationKind,
      args.secretName,
    );
  }
  if (typeof raw.value !== "string" || !raw.integration_id) {
    throw new TenantIntegrationSecretError(
      "malformed",
      `Tenant integration secret '${args.secretName}' returned a malformed value.`,
      args.integrationKind,
      args.secretName,
    );
  }
  if (raw.value.length === 0) {
    throw new TenantIntegrationSecretError(
      "empty",
      `Tenant integration secret '${args.secretName}' is empty.`,
      args.integrationKind,
      args.secretName,
    );
  }


  return {
    value: raw.value as string,
    integrationId: String(raw.integration_id ?? ""),
    integrationName: String(raw.integration_name ?? args.integrationName ?? "default"),
    secretName: String(raw.secret_name ?? args.secretName),
    secretScope: raw.secret_scope,
    organizationId: raw.organization_id ?? null,
    configMetadata: raw.config_metadata,
  };
}
