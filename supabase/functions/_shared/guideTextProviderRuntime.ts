// Phase 4D.14A.8C.2B — BTPM Guide V2 text-provider runtime resolver.
//
// Guide V2 no longer reads any Global AI env routing switches or provider
// credential env vars. Instead:
//
//   1. Resolve the canonical BTPM Guide model per Organization via
//      `resolveBtpmGuideFeatureConfigForOrg`.
//   2. Resolve the request-scoped Tenant AI text runtime for that canonical
//      model via `resolveTenantAiTextRuntime` using
//      action = "external_api_write".
//
// The resolver never falls back between providers, never reads Global env
// AI routing switches or credentials, and never logs or returns secrets,
// endpoints, deployment names, Tenant IDs, or Organization IDs.
//
// The exported `GuideTextProviderRuntimeConfig` is now an alias for the
// canonical `TenantAiTextRuntime` shape. Both Guide V1 (`ai-help-chat`)
// and Guide V2 resolve through this module; there is no legacy Global
// runtime path remaining.

import {
  resolveBtpmGuideFeatureConfigForOrg,
  GuideModelResolveError,
  type GuideModelResolveErrorCode,
} from "./ai-guide-v2/feature-model-resolver.ts";
import {
  resolveTenantAiTextRuntime,
  toSafeTenantAiTextRuntimePublicError,
  type TenantAiTextRuntime,
} from "./tenantAiTextRuntime.ts";

export type GuideTextProviderRuntimeConfig = TenantAiTextRuntime;

export type GuideProviderRuntimeErrorCode =
  | GuideModelResolveErrorCode
  | "guide_provider_not_configured";

export interface ResolveGuideRuntimeArgs {
  organizationId: string;
  functionName: string;
  reason: string;
  requestId?: string;
}

/**
 * Public-safe classification. Guide model errors are preserved (they are
 * user-facing "BTPM Guide is not configured" signals). Tenant AI provider
 * errors are delegated to the canonical Tenant AI safe mapper so browser
 * clients get a single stable contract.
 */
export function toSafeGuideProviderPublicError(err: unknown): {
  error: string;
  note: string;
} {
  if (err instanceof GuideModelResolveError) {
    return {
      error: err.code,
      note:
        err.code === "btpm_guide_not_configured"
          ? "BTPM Guide is disabled or is not configured in AI Settings."
          : "BTPM Guide configuration is temporarily unavailable.",
    };
  }
  return toSafeTenantAiTextRuntimePublicError(err);
}

/**
 * Resolve the request-scoped Guide V2 text runtime. Throws either a
 * `GuideModelResolveError` (BTPM Guide feature misconfigured) or a
 * `TenantAiTextRuntimeError` / underlying tenant resolver error (Tenant AI
 * provider misconfigured). Callers should convert failures via
 * `toSafeGuideProviderPublicError` before returning to browsers.
 */
export async function resolveGuideTextProviderRuntime(
  args: ResolveGuideRuntimeArgs,
): Promise<GuideTextProviderRuntimeConfig> {
  const feature = await resolveBtpmGuideFeatureConfigForOrg({
    organizationId: args.organizationId,
  });
  return await resolveTenantAiTextRuntime({
    organizationId: args.organizationId,
    canonicalModel: feature.model,
    action: "external_api_write",
    functionName: args.functionName,
    reason: args.reason,
    requestId: args.requestId,
  });
}
