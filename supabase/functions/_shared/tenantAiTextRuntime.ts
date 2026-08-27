// Phase 4D.14A.8C.1 — Canonical Tenant AI text-runtime resolver (Edge-only).
//
// Converts a Tenant's active AI provider selection plus a BTPM canonical
// model into a request-scoped provider runtime:
//   - openai       -> OpenAI Chat Completions API (bearer)
//   - azure_openai -> Azure OpenAI deployment (api-key), where the
//                     deployment name is resolved from the Tenant's
//                     `config_metadata.azure_deployments` mapping keyed by
//                     the canonical model.
//
// The resolver:
//   - never falls back between providers
//   - never falls back to Global env routing switches or provider secrets
//   - never reads the profiles table for tenant/organization derivation
//   - never trusts caller-supplied Tenant IDs
//   - never logs or returns secrets, endpoints, deployment names, Tenant
//     IDs, Organization IDs, or raw database errors
//
// It is service-role-only and MUST NOT be imported from browser code or
// production AI generation callers yet — 4D.14A.8C.1 only establishes the
// resolution contract.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  resolveTenantOpenAiRuntimeConfig,
  TenantOpenAiError,
  toSafeOpenAiPublicError,
  type OpenAiAction,
  type OpenAiResolveErrorCode,
} from "./tenantOpenAi.ts";
import {
  resolveTenantAzureOpenAiRuntimeConfig,
  TenantAzureOpenAiError,
  toSafeAzureOpenAiPublicError,
  type AzureOpenAiAction,
  type AzureOpenAiResolveErrorCode,
} from "./tenantAzureOpenAi.ts";

export type TenantAiTextProvider = "openai" | "azure_openai";
export type TenantAiTextAction = OpenAiAction & AzureOpenAiAction;
export type TenantAiTextAuthMode = "bearer" | "api_key";

export type TenantAiTextRuntimeErrorCode =
  | "ai_provider_not_selected"
  | "ai_provider_configuration_unavailable"
  | "ai_model_mapping_missing"
  | OpenAiResolveErrorCode
  | AzureOpenAiResolveErrorCode;

export class TenantAiTextRuntimeError extends Error {
  code: TenantAiTextRuntimeErrorCode;
  constructor(code: TenantAiTextRuntimeErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "TenantAiTextRuntimeError";
  }
}

const INTERNAL_MESSAGES: Record<
  "ai_provider_not_selected"
  | "ai_provider_configuration_unavailable"
  | "ai_model_mapping_missing",
  string
> = {
  ai_provider_not_selected:
    "No AI provider is selected for this Tenant.",
  ai_provider_configuration_unavailable:
    "AI provider configuration is temporarily unavailable.",
  ai_model_mapping_missing:
    "The selected AI model is not mapped for the active provider.",
};

/** Pure classifier for the `tenant_ai_provider_settings` lookup. */
export function classifyActiveProviderLookup(
  err: unknown,
  row: { active_provider?: string | null } | null | undefined,
):
  | { ok: true; provider: TenantAiTextProvider }
  | {
    ok: false;
    code:
      | "ai_provider_not_selected"
      | "ai_provider_configuration_unavailable";
  } {
  if (err) return { ok: false, code: "ai_provider_configuration_unavailable" };
  const p = row?.active_provider ?? null;
  if (p !== "openai" && p !== "azure_openai") {
    return { ok: false, code: "ai_provider_not_selected" };
  }
  return { ok: true, provider: p };
}

/**
 * Pure classifier for extracting an Azure deployment name for a canonical
 * model out of `tenant_integrations.config_metadata.azure_deployments`.
 * Never mutates input; returns a safe classification only.
 */
export function classifyAzureDeploymentMapping(
  configMetadata: Record<string, unknown> | null | undefined,
  canonicalModel: string,
):
  | { ok: true; deployment: string }
  | { ok: false; code: "ai_model_mapping_missing" } {
  if (!canonicalModel) return { ok: false, code: "ai_model_mapping_missing" };
  const deps = (configMetadata ?? {})["azure_deployments"];
  if (!deps || typeof deps !== "object") {
    return { ok: false, code: "ai_model_mapping_missing" };
  }
  const raw = (deps as Record<string, unknown>)[canonicalModel];
  if (typeof raw !== "string") {
    return { ok: false, code: "ai_model_mapping_missing" };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 128) {
    return { ok: false, code: "ai_model_mapping_missing" };
  }
  if (/[\x00-\x1f]/.test(trimmed) || /[\/\\?#]/.test(trimmed)) {
    return { ok: false, code: "ai_model_mapping_missing" };
  }
  return { ok: true, deployment: trimmed };
}

/**
 * Public-safe mapper. Collapses every internal code (including nested
 * OpenAI / Azure resolver codes) to a stable browser contract. Never
 * contains secret material, IDs, endpoints, deployments, RPC text or raw
 * resolver output.
 */
export function toSafeTenantAiTextRuntimePublicError(err: unknown): {
  error: string;
  note: string;
} {
  if (err instanceof TenantOpenAiError) return toSafeOpenAiPublicError(err);
  if (err instanceof TenantAzureOpenAiError) {
    return toSafeAzureOpenAiPublicError(err);
  }
  if (err instanceof TenantAiTextRuntimeError) {
    switch (err.code) {
      case "ai_provider_not_selected":
        return {
          error: "ai_provider_not_selected",
          note: "No AI provider is selected for this Tenant.",
        };
      case "ai_model_mapping_missing":
        return {
          error: "ai_model_mapping_missing",
          note:
            "The selected AI model is not mapped for the active provider.",
        };
      case "ai_provider_configuration_unavailable":
      default:
        return {
          error: "ai_provider_configuration_unavailable",
          note: "AI provider configuration is temporarily unavailable.",
        };
    }
  }
  return {
    error: "ai_provider_configuration_unavailable",
    note: "AI provider configuration is temporarily unavailable.",
  };
}

export interface TenantAiTextRuntime {
  provider: TenantAiTextProvider;
  canonicalModel: string;
  providerModel: string;
  baseUrl: string;
  apiKey: string;
  authMode: TenantAiTextAuthMode;
}

export interface ResolveTenantAiTextRuntimeArgs {
  organizationId: string;
  canonicalModel: string;
  action: TenantAiTextAction;
  functionName?: string;
  reason?: string;
  requestId?: string;
}

const OPENAI_BASE_URL = "https://api.openai.com/v1";

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
 * Resolve the request-scoped Tenant AI text runtime.
 *
 * Never falls back between providers. Never reads Global env. Never
 * returns partial credentials. Never caches state outside the returned
 * object.
 */
export async function resolveTenantAiTextRuntime(
  args: ResolveTenantAiTextRuntimeArgs,
): Promise<TenantAiTextRuntime> {
  const { supabase, tenantId } = await resolveTenantForArgs(args);

  // Read the Tenant's active provider selection.
  const { data: providerRow, error: providerErr } = await supabase
    .from("tenant_ai_provider_settings")
    .select("active_provider")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const providerClass = classifyActiveProviderLookup(providerErr, providerRow);
  if (!providerClass.ok) {
    throw new TenantAiTextRuntimeError(
      providerClass.code,
      INTERNAL_MESSAGES[providerClass.code],
    );
  }

  return await resolveForProvider({
    supabase,
    tenantId,
    provider: providerClass.provider,
    args,
  });
}

export interface ResolveTenantAiTextRuntimeForProviderArgs
  extends ResolveTenantAiTextRuntimeArgs {
  provider: TenantAiTextProvider;
}

/**
 * Resolve the request-scoped Tenant AI text runtime for an explicitly
 * pinned provider. Used by background pollers that must resolve the
 * provider recorded at run creation, even if the Tenant has since
 * changed its active AI provider. Never reads
 * `tenant_ai_provider_settings`. Never falls back to another provider.
 */
export async function resolveTenantAiTextRuntimeForProvider(
  args: ResolveTenantAiTextRuntimeForProviderArgs,
): Promise<TenantAiTextRuntime> {
  if (args?.provider !== "openai" && args?.provider !== "azure_openai") {
    throw new TenantAiTextRuntimeError(
      "ai_provider_configuration_unavailable",
      INTERNAL_MESSAGES.ai_provider_configuration_unavailable,
    );
  }
  const { supabase, tenantId } = await resolveTenantForArgs(args);
  return await resolveForProvider({
    supabase,
    tenantId,
    provider: args.provider,
    args,
  });
}

async function resolveTenantForArgs(
  args: ResolveTenantAiTextRuntimeArgs,
): Promise<{ supabase: ReturnType<typeof serviceClient>; tenantId: string }> {
  if (!args?.organizationId) {
    throw new TenantAiTextRuntimeError(
      "ai_provider_configuration_unavailable",
      INTERNAL_MESSAGES.ai_provider_configuration_unavailable,
    );
  }
  if (!args?.canonicalModel || typeof args.canonicalModel !== "string") {
    throw new TenantAiTextRuntimeError(
      "ai_model_mapping_missing",
      INTERNAL_MESSAGES.ai_model_mapping_missing,
    );
  }
  if (!args?.action) {
    throw new TenantAiTextRuntimeError(
      "ai_provider_configuration_unavailable",
      INTERNAL_MESSAGES.ai_provider_configuration_unavailable,
    );
  }
  const supabase = serviceClient();
  // Resolve tenant from the canonical `organizations` row. Never trust
  // the caller's tenant id.
  const { data: orgRow, error: orgErr } = await supabase
    .from("organizations")
    .select("id, tenant_id")
    .eq("id", args.organizationId)
    .maybeSingle();
  if (orgErr || !orgRow?.tenant_id) {
    throw new TenantAiTextRuntimeError(
      "ai_provider_configuration_unavailable",
      INTERNAL_MESSAGES.ai_provider_configuration_unavailable,
    );
  }
  return { supabase, tenantId: orgRow.tenant_id as string };
}

async function resolveForProvider(input: {
  supabase: ReturnType<typeof serviceClient>;
  tenantId: string;
  provider: TenantAiTextProvider;
  args: ResolveTenantAiTextRuntimeArgs;
}): Promise<TenantAiTextRuntime> {
  const { supabase, tenantId, provider, args } = input;

  if (provider === "openai") {
    const openai = await resolveTenantOpenAiRuntimeConfig({
      organizationId: args.organizationId,
      action: args.action,
      reason: args.reason,
      functionName: args.functionName,
      requestId: args.requestId,
    });
    return {
      provider: "openai",
      canonicalModel: args.canonicalModel,
      providerModel: args.canonicalModel,
      baseUrl: OPENAI_BASE_URL,
      apiKey: openai.apiKey,
      authMode: "bearer",
    };
  }

  // provider === "azure_openai"
  // Re-read the Tenant integration's config_metadata for the deployments
  // mapping. Deployments are per-Tenant (not per-Organization). The
  // canonical Azure resolver validates the endpoint and secret.
  const { data: integRow, error: integErr } = await supabase
    .from("tenant_integrations")
    .select("config_metadata")
    .eq("tenant_id", tenantId)
    .eq("kind", "azure_openai")
    .eq("name", "default")
    .maybeSingle();
  if (integErr) {
    throw new TenantAiTextRuntimeError(
      "ai_provider_configuration_unavailable",
      INTERNAL_MESSAGES.ai_provider_configuration_unavailable,
    );
  }
  const mapping = classifyAzureDeploymentMapping(
    (integRow?.config_metadata as Record<string, unknown> | null) ?? null,
    args.canonicalModel,
  );
  if (!mapping.ok) {
    throw new TenantAiTextRuntimeError(
      "ai_model_mapping_missing",
      INTERNAL_MESSAGES.ai_model_mapping_missing,
    );
  }

  const azure = await resolveTenantAzureOpenAiRuntimeConfig({
    organizationId: args.organizationId,
    action: args.action,
    reason: args.reason,
    functionName: args.functionName,
    requestId: args.requestId,
  });

  return {
    provider: "azure_openai",
    canonicalModel: args.canonicalModel,
    providerModel: mapping.deployment,
    baseUrl: azure.baseUrl,
    apiKey: azure.apiKey,
    authMode: "api_key",
  };
}

