// Phase 4D.14A.8C.3 — Guide V2 Tenant AI Embedding Runtime Resolver.
//
// Resolves the request-scoped runtime used for a single BTPM Guide V2
// embedding call through the Tenant's active AI provider (OpenAI or
// Azure OpenAI), using the canonical Tenant AI text-runtime resolver.
// The embedding model and dimensions are frozen at the BTPM canonical
// values; there is no Global env routing switch and no provider
// fallback.
//
// This module NEVER logs or returns keys, headers, Vault IDs, ciphertext,
// fingerprints, Tenant/Organization IDs, provider model IDs, deployment
// names, endpoints, or raw provider response bodies. All safe public
// errors are delegated to the canonical Tenant AI text-runtime mapper.
//
// Service-role-only. Must not be imported into browser code.

import {
  resolveTenantAiTextRuntime,
  toSafeTenantAiTextRuntimePublicError,
  type TenantAiTextRuntime,
} from "./tenantAiTextRuntime.ts";

/** Frozen canonical embedding identity for BTPM Guide V2. */
export const GUIDE_EMBEDDING_CANONICAL_MODEL = "text-embedding-3-small";
export const GUIDE_EMBEDDING_DIMENSIONS = 1536 as const;

/**
 * Resolved Guide V2 embedding runtime: the canonical Tenant AI runtime
 * (bearer for OpenAI, api-key for Azure OpenAI) plus the frozen embedding
 * dimensions. Consumers must use `baseUrl`, `providerModel`, `apiKey`,
 * `authMode`, and `canonicalModel` from the Tenant AI runtime.
 */
export type GuideEmbeddingProviderRuntimeConfig = TenantAiTextRuntime & {
  dimensions: typeof GUIDE_EMBEDDING_DIMENSIONS;
};

export interface ResolveGuideEmbeddingRuntimeArgs {
  organizationId: string;
  functionName: string;
  reason: string;
  requestId: string;
}

/**
 * Resolve the request-scoped Guide V2 embedding runtime through the
 * Tenant's active AI provider. Never falls back between providers.
 * Never reads Global embedding env switches. Never caches credentials
 * outside the returned object.
 */
export async function resolveGuideEmbeddingProviderRuntime(
  args: ResolveGuideEmbeddingRuntimeArgs,
): Promise<GuideEmbeddingProviderRuntimeConfig> {
  const runtime = await resolveTenantAiTextRuntime({
    organizationId: args.organizationId,
    canonicalModel: GUIDE_EMBEDDING_CANONICAL_MODEL,
    action: "external_api_write",
    functionName: args.functionName,
    reason: args.reason,
    requestId: args.requestId,
  });
  return { ...runtime, dimensions: GUIDE_EMBEDDING_DIMENSIONS };
}

/**
 * Public-safe error mapper for the Guide V2 embedding runtime resolver.
 * Delegates to the canonical Tenant AI text-runtime mapper so error
 * classification is consistent across text and embedding paths.
 */
export function toSafeGuideEmbeddingPublicError(err: unknown): {
  error: string;
  note: string;
} {
  return toSafeTenantAiTextRuntimePublicError(err);
}
