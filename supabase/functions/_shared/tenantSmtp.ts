// Phase 4D.11 — Tenant SMTP runtime resolver (Edge Function-only).
//
// Resolves the effective SMTP configuration for a given Organization:
//   1. Look up tenant from organization.
//   2. Assert outbound_email is allowed for the Organization environment.
//   3. Require SMTP integration is `active` and `is_enabled=true`.
//   4. Resolve each required SMTP secret via the service-only Vault helper
//      `resolve_effective_integration_secret_value`.
//
// This helper NEVER logs secret values, Vault IDs, or fingerprints.
// It is service-role-only and must not be imported from browser code.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

export type SmtpResolveErrorCode =
  | "organization_context_missing"
  | "organization_not_found"
  | "outbound_email_blocked"
  | "smtp_integration_disabled"
  | "smtp_not_configured"
  | "smtp_secret_missing";

export class TenantSmtpError extends Error {
  code: SmtpResolveErrorCode;
  constructor(code: SmtpResolveErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "TenantSmtpError";
  }
}

export interface TenantSmtpRuntimeConfig {
  tenantId: string;
  organizationId: string;
  integrationId: string;
  integrationName: string;
  host: string;
  port: number;
  username: string | null;
  password: string;
  fromEmail: string;
  fromName: string | null;
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

interface ResolveArgs {
  organizationId: string;
  reason?: string;
  functionName?: string;
  requestId?: string;
}

/**
 * Resolve SMTP runtime configuration for an Organization.
 * Fail-closed on any missing/blocked condition.
 */
export async function resolveTenantSmtpRuntimeConfig(
  args: ResolveArgs,
): Promise<TenantSmtpRuntimeConfig> {
  if (!args?.organizationId) {
    throw new TenantSmtpError(
      "organization_context_missing",
      "Organization context is required to send email.",
    );
  }

  const supabase = serviceClient();

  // 1. Resolve tenant + integration_id + status.
  const { data: orgRow, error: orgErr } = await supabase
    .from("organizations")
    .select("id, tenant_id")
    .eq("id", args.organizationId)
    .maybeSingle();
  if (orgErr || !orgRow?.tenant_id) {
    throw new TenantSmtpError(
      "organization_not_found",
      "Organization not found or missing tenant.",
    );
  }
  const tenantId = orgRow.tenant_id as string;

  // 2. Environment gate — outbound_email.
  const { error: gateErr } = await supabase.rpc(
    "assert_environment_action_allowed",
    {
      _organization_id: args.organizationId,
      _action: "outbound_email",
      _reason: args.reason ?? "tenant-smtp-runtime",
    },
  );
  if (gateErr) {
    throw new TenantSmtpError(
      "outbound_email_blocked",
      "Outbound email is disabled in non-production environments.",
    );
  }

  // 3. Integration readiness — must be active+enabled.
  const { data: integ, error: integErr } = await supabase
    .from("tenant_integrations")
    .select("id, name, is_enabled, status")
    .eq("tenant_id", tenantId)
    .eq("kind", "smtp")
    .eq("name", "default")
    .maybeSingle();
  if (integErr || !integ?.id) {
    throw new TenantSmtpError(
      "smtp_not_configured",
      "SMTP integration is not configured for this tenant.",
    );
  }
  if (!integ.is_enabled || integ.status !== "active") {
    throw new TenantSmtpError(
      "smtp_integration_disabled",
      "SMTP integration is disabled for this tenant.",
    );
  }
  const integrationId = integ.id as string;
  const integrationName = (integ.name as string) ?? "default";

  // 4. Resolve each required secret via Vault (service-only).
  async function readSecret(name: string, required: boolean): Promise<string | null> {
    const { data, error } = await supabase.rpc(
      "resolve_effective_integration_secret_value",
      {
        _tenant_id: tenantId,
        _organization_id: args.organizationId,
        _integration_kind: "smtp",
        _secret_name: name,
        _integration_name: integrationName,
        _reason: args.reason ?? null,
        _function_name: args.functionName ?? null,
        _request_id: args.requestId ?? null,
      },
    );
    if (error) {
      if (required) {
        throw new TenantSmtpError(
          "smtp_secret_missing",
          `Failed to resolve SMTP secret '${name}'.`,
        );
      }
      return null;
    }
    const raw = (data ?? {}) as Record<string, any>;
    if (raw.status !== "ok" || typeof raw.value !== "string") {
      if (required) {
        throw new TenantSmtpError(
          "smtp_secret_missing",
          `SMTP secret '${name}' is not configured.`,
        );
      }
      return null;
    }
    return raw.value as string;
  }

  const host = await readSecret("host", true);
  const portStr = await readSecret("port", true);
  const password = await readSecret("password", true);
  const fromEmail = await readSecret("from_email", true);
  const username = await readSecret("username", false);
  const fromName = await readSecret("from_name", false);

  const portNum = Number.parseInt(String(portStr ?? "").trim(), 10);
  if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) {
    throw new TenantSmtpError(
      "smtp_secret_missing",
      "SMTP port secret is invalid.",
    );
  }

  return {
    tenantId,
    organizationId: args.organizationId,
    integrationId,
    integrationName,
    host: String(host).trim(),
    port: portNum,
    username: username && username.trim() ? username.trim() : null,
    password: String(password),
    fromEmail: String(fromEmail).trim(),
    fromName: fromName && fromName.trim() ? fromName.trim() : null,
  };
}
