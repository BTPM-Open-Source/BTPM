// Tests for Phase 4D.14A.3C — active Organization + Guide provider runtime.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyActiveOrganizationRpc,
  toSafeActiveOrganizationPublicError,
  ActiveOrganizationContextError,
} from "../../functions/_shared/activeOrganizationContext.ts";
import {
  classifyBtpmGuideFeatureRow,
  GuideModelResolveError,
  toSafeGuideModelPublicError,
} from "../../functions/_shared/ai-guide-v2/feature-model-resolver.ts";
import { toSafeGuideProviderPublicError } from "../../functions/_shared/guideTextProviderRuntime.ts";
import { TenantOpenAiError } from "../../functions/_shared/tenantOpenAi.ts";

// ----- activeOrganizationContext -----

Deno.test("classifyActiveOrganizationRpc — RPC error is resolution_failed", () => {
  const c = classifyActiveOrganizationRpc({ code: "PGRST100" }, null);
  assertEquals(c.ok, false);
  if (!c.ok) assertEquals(c.code, "organization_context_resolution_failed");
});

Deno.test("classifyActiveOrganizationRpc — null org is context_unavailable", () => {
  const c = classifyActiveOrganizationRpc(null, { organization_id: null });
  assertEquals(c.ok, false);
  if (!c.ok) assertEquals(c.code, "organization_context_unavailable");
});

Deno.test("classifyActiveOrganizationRpc — valid org succeeds", () => {
  const c = classifyActiveOrganizationRpc(null, { organization_id: "org-1" });
  assertEquals(c.ok, true);
  if (c.ok) assertEquals(c.organizationId, "org-1");
});

Deno.test("toSafeActiveOrganizationPublicError — never leaks identifiers", () => {
  const safe = toSafeActiveOrganizationPublicError(
    new ActiveOrganizationContextError(
      "organization_context_unavailable",
      "Select an active Organization before using BTPM Guide.",
    ),
  );
  assertEquals(safe.error, "organization_context_unavailable");
  assertEquals(
    safe.note,
    "Select an active Organization before using BTPM Guide.",
  );
});

Deno.test("toSafeActiveOrganizationPublicError — unknown error maps to resolution_failed", () => {
  const safe = toSafeActiveOrganizationPublicError(new Error("boom"));
  assertEquals(safe.error, "organization_context_resolution_failed");
});

// ----- feature-model-resolver -----

Deno.test("classifyBtpmGuideFeatureRow — query error is configuration_unavailable", () => {
  const c = classifyBtpmGuideFeatureRow({ code: "PGRST103" }, null);
  assertEquals(c.ok, false);
  if (!c.ok) assertEquals(c.code, "btpm_guide_configuration_unavailable");
});

Deno.test("classifyBtpmGuideFeatureRow — missing row is not_configured", () => {
  const c = classifyBtpmGuideFeatureRow(null, null);
  assertEquals(c.ok, false);
  if (!c.ok) assertEquals(c.code, "btpm_guide_not_configured");
});

Deno.test("classifyBtpmGuideFeatureRow — disabled is not_configured", () => {
  const c = classifyBtpmGuideFeatureRow(null, {
    enabled: false,
    provider: "openai",
    ai_model_registry: { model_id: "gpt-4o-mini", provider: "openai", active: true },
  });
  assertEquals(c.ok, false);
  if (!c.ok) assertEquals(c.code, "btpm_guide_not_configured");
});

Deno.test("classifyBtpmGuideFeatureRow — non-openai provider is not_configured", () => {
  const c = classifyBtpmGuideFeatureRow(null, {
    enabled: true,
    provider: "azure_openai",
    ai_model_registry: { model_id: "gpt-4o-mini", provider: "openai", active: true },
  });
  assertEquals(c.ok, false);
});

Deno.test("classifyBtpmGuideFeatureRow — inactive registry is not_configured", () => {
  const c = classifyBtpmGuideFeatureRow(null, {
    enabled: true,
    provider: "openai",
    ai_model_registry: { model_id: "gpt-4o-mini", provider: "openai", active: false },
  });
  assertEquals(c.ok, false);
});

Deno.test("classifyBtpmGuideFeatureRow — valid row returns model", () => {
  const c = classifyBtpmGuideFeatureRow(null, {
    enabled: true,
    provider: "openai",
    ai_model_registry: { model_id: "gpt-4o-mini", provider: "openai", active: true },
  });
  assertEquals(c.ok, true);
  if (c.ok) {
    assertEquals(c.provider, "openai");
    assertEquals(c.model, "gpt-4o-mini");
  }
});

Deno.test("toSafeGuideModelPublicError — safe messages only", () => {
  const s1 = toSafeGuideModelPublicError(
    new GuideModelResolveError("btpm_guide_not_configured", "x"),
  );
  assertEquals(s1.error, "btpm_guide_not_configured");
  const s2 = toSafeGuideModelPublicError(new Error("boom"));
  assertEquals(s2.error, "btpm_guide_configuration_unavailable");
});

// ----- guideTextProviderRuntime public error mapper -----

Deno.test("toSafeGuideProviderPublicError — OpenAI tenant errors map safely", () => {
  const secretBlocked = toSafeGuideProviderPublicError(
    new TenantOpenAiError("secret_blocked", "x"),
  );
  assertEquals(secretBlocked.error, "openai_access_blocked");

  const notConfigured = toSafeGuideProviderPublicError(
    new TenantOpenAiError("integration_not_configured", "x"),
  );
  assertEquals(notConfigured.error, "openai_not_configured");

  const unavailable = toSafeGuideProviderPublicError(
    new TenantOpenAiError("configuration_unavailable", "x"),
  );
  assertEquals(unavailable.error, "openai_configuration_unavailable");
});

Deno.test("toSafeGuideProviderPublicError — guide model errors preserved", () => {
  const s = toSafeGuideProviderPublicError(
    new GuideModelResolveError("btpm_guide_not_configured", "x"),
  );
  assertEquals(s.error, "btpm_guide_not_configured");
});

Deno.test("toSafeGuideProviderPublicError — unknown error delegates to tenant AI safe mapper", () => {
  const s = toSafeGuideProviderPublicError(new Error("random"));
  // Phase 4D.14A.8C.2B — unknown errors now flow through the Tenant AI
  // safe mapper, which returns `ai_provider_configuration_unavailable`.
  assertEquals(s.error, "ai_provider_configuration_unavailable");
  // Never contains raw error text.
  assertEquals(s.note.includes("random"), false);
});
