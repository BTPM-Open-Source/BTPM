// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/guideEmbeddingProviderRuntime_test.ts', import.meta.url).href;
// Phase 4D.14A.8C.3 — Guide V2 embedding runtime resolver tests.
// The resolver now delegates to the canonical Tenant AI text runtime,
// so these tests focus on the delegation contract and safe error mapping.

import { assertEquals, assertStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  GUIDE_EMBEDDING_CANONICAL_MODEL,
  GUIDE_EMBEDDING_DIMENSIONS,
  toSafeGuideEmbeddingPublicError,
} from "../../functions/_shared/guideEmbeddingProviderRuntime.ts";
import {
  TenantAiTextRuntimeError,
  toSafeTenantAiTextRuntimePublicError,
} from "../../functions/_shared/tenantAiTextRuntime.ts";
import { TenantOpenAiError } from "../../functions/_shared/tenantOpenAi.ts";

// ---------- Frozen embedding identity ----------

Deno.test("frozen — canonical embedding model is text-embedding-3-small", () => {
  assertStrictEquals(GUIDE_EMBEDDING_CANONICAL_MODEL, "text-embedding-3-small");
});
Deno.test("frozen — canonical embedding dimensions are 1536", () => {
  assertStrictEquals(GUIDE_EMBEDDING_DIMENSIONS, 1536);
});

// ---------- Safe public-error mapper delegation ----------

Deno.test("public-error mapper — delegates to Tenant AI text-runtime mapper", () => {
  const err = new TenantAiTextRuntimeError(
    "ai_provider_not_selected",
    "internal",
  );
  const viaGuide = toSafeGuideEmbeddingPublicError(err);
  const viaCanonical = toSafeTenantAiTextRuntimePublicError(err);
  assertEquals(viaGuide, viaCanonical);
  assertEquals(viaGuide.error, "ai_provider_not_selected");
});

Deno.test("public-error mapper — Tenant AI mapping_missing propagates", () => {
  const s = toSafeGuideEmbeddingPublicError(
    new TenantAiTextRuntimeError("ai_model_mapping_missing", "internal"),
  );
  assertEquals(s.error, "ai_model_mapping_missing");
});

Deno.test("public-error mapper — TenantOpenAiError propagates through delegate", () => {
  const s = toSafeGuideEmbeddingPublicError(
    new TenantOpenAiError("integration_not_configured", "internal"),
  );
  // Whatever canonical code the shared mapper emits must match delegate.
  const c = toSafeTenantAiTextRuntimePublicError(
    new TenantOpenAiError("integration_not_configured", "internal"),
  );
  assertEquals(s, c);
});

Deno.test("public-error mapper — unknown error → configuration_unavailable and no secrets echoed", () => {
  const s = toSafeGuideEmbeddingPublicError(new Error("boom OPENAI_API_KEY leaked sk-abc"));
  assertEquals(s.error, "ai_provider_configuration_unavailable");
  const blob = `${s.note}\n${s.error}`.toLowerCase();
  assertEquals(blob.includes("openai_api_key"), false);
  assertEquals(blob.includes("sk-"), false);
});

// ---------- Static contract: legacy Global env readers removed ----------

Deno.test("static — resolver source has no Global embedding env readers", async () => {
  const src = await Deno.readTextFile(
    new URL("./guideEmbeddingProviderRuntime.ts", __BTPM_SRC_BASE__).pathname,
  );
  for (const banned of [
    "AI_EMBEDDING_PROVIDER",
    "AI_EMBEDDING_DIMENSIONS",
    "OPENAI_EMBEDDING_MODEL",
    "AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT",
    "AZURE_OPENAI_EMBEDDING_API_VERSION",
    "AZURE_OPENAI_API_KEY",
    "Deno.env.get",
  ]) {
    assertEquals(
      src.includes(banned),
      false,
      `guideEmbeddingProviderRuntime.ts must not reference: ${banned}`,
    );
  }
});

Deno.test("static — resolver delegates to canonical Tenant AI text runtime", async () => {
  const src = await Deno.readTextFile(
    new URL("./guideEmbeddingProviderRuntime.ts", __BTPM_SRC_BASE__).pathname,
  );
  assertEquals(src.includes("resolveTenantAiTextRuntime"), true);
  assertEquals(src.includes("canonicalModel: GUIDE_EMBEDDING_CANONICAL_MODEL"), true);
  assertEquals(src.includes("external_api_write"), true);
});
