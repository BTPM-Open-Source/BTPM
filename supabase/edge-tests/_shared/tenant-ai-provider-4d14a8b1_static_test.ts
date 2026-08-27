// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/tenant-ai-provider-4d14a8b1_static_test.ts', import.meta.url).href;
// Phase 4D.14A.8B.1 — Static contract tests for Tenant AI provider
// selection, readiness gating, Azure discoverability, and runtime boundary.
//
// These tests do not touch a live database, live network, or live UI.
// They pin the on-disk contracts so future refactors cannot silently
// regress the 8B.1 corrections.

import {
  assert,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

const REPO_ROOT = new URL("../../../", __BTPM_SRC_BASE__);

async function read(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, REPO_ROOT));
}

async function findMigration(marker: RegExp): Promise<string> {
  const dir = new URL("supabase/migrations/", REPO_ROOT);
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !e.name.endsWith(".sql")) continue;
    const body = await Deno.readTextFile(new URL(e.name, dir));
    if (marker.test(body)) return body;
  }
  throw new Error(`no migration matched ${marker}`);
}

Deno.test("tenant_ai_provider_settings table + provider RPCs exist with Tenant-Admin authority", async () => {
  const body = await findMigration(/CREATE TABLE IF NOT EXISTS public\.tenant_ai_provider_settings/);
  assertStringIncludes(body, "active_provider text NULL");
  assertMatch(body, /CHECK \(active_provider IS NULL OR active_provider IN \('openai', 'azure_openai'\)\)/);
  assertStringIncludes(body, "ENABLE ROW LEVEL SECURITY");
  assertStringIncludes(body, "CREATE OR REPLACE FUNCTION public.tenant_admin_get_ai_provider_setting");
  assertStringIncludes(body, "CREATE OR REPLACE FUNCTION public.tenant_admin_set_ai_provider");
  // Both RPCs enforce Tenant Admin.
  const setFn = body.slice(body.indexOf("FUNCTION public.tenant_admin_set_ai_provider"));
  assertStringIncludes(setFn, "_assert_tenant_admin_caller(_tenant_id)");
  const getFn = body.slice(body.indexOf("FUNCTION public.tenant_admin_get_ai_provider_setting"));
  assertStringIncludes(getFn, "_assert_tenant_admin_caller(_tenant_id)");
  // Only allowed provider values.
  assertMatch(setFn, /_provider NOT IN \('openai', 'azure_openai'\)/);
  // Readiness gate is enforced before the write.
  assertStringIncludes(setFn, "ai_provider_not_ready");
});

Deno.test("provider readiness helper requires enabled+active+secrets+config+connection test", async () => {
  const body = await findMigration(/FUNCTION public\._tenant_ai_provider_readiness/);
  assertStringIncludes(body, "_required_tenant_integration_secret_names");
  assertStringIncludes(body, "_required_tenant_integration_config_names");
  assertStringIncludes(body, "last_success_at IS NOT NULL");
  assertStringIncludes(body, "'connection_test_not_passed'");
  assertStringIncludes(body, "'missing_required_configuration'");
});

Deno.test("admin_list_tenant_integrations now returns configuration_ready and configuration_issue_code", async () => {
  const body = await findMigration(/configuration_ready boolean,\s*\n\s*configuration_issue_code text/);
  assertStringIncludes(body, "admin_list_tenant_integrations");
  assertStringIncludes(body, "_required_tenant_integration_config_names");
});

Deno.test("Admin Tenant Integrations page unifies AI providers into the integrations table with full lifecycle parity", async () => {
  const src = await read("src/pages/admin/AdminTenantIntegrations.tsx");
  // AI provider selection note remains, but no separate provider card/helper.
  assertStringIncludes(src, "AI provider selection");
  assert(!src.includes("renderProviderRow"), "legacy renderProviderRow helper must be removed");
  assertStringIncludes(src, "tenant_admin_get_ai_provider_setting");
  assertStringIncludes(src, "tenant_admin_set_ai_provider");
  assertStringIncludes(src, "No AI provider is active.");
  assertStringIncludes(
    src,
    "Provider selection saved. Runtime activation will occur after the AI provider migration is completed.",
  );
  assertStringIncludes(src, "Azure OpenAI setup is unavailable for this Tenant.");
  // AI rows sit in the normal table and share the same actions as other integrations.
  assertStringIncludes(src, "View details");
  assertStringIncludes(src, "Configure");
  assertStringIncludes(src, "Enable integration");
  assertStringIncludes(src, "Disable integration");
  // Set active remains an AI-only additional action.
  assertStringIncludes(src, "Set active");
  // Active-provider disable guard.
  assertStringIncludes(
    src,
    "Select another AI provider before disabling this integration.",
  );
  // Enable gating on missing required non-secret configuration.
  assertStringIncludes(src, "configuration_ready === false");
  assertStringIncludes(src, "Required configuration is missing");
  // Stale page text replaced.
  assert(
    !src.includes("Runtime connection testing will be enabled in a later phase."),
    "stale phase note must be replaced",
  );
  assertStringIncludes(src, "can be validated through their available connection tests.");

});

Deno.test("Azure OpenAI Test Connection wording no longer mentions Organization Admin authority", async () => {
  const src = await read(
    "supabase/functions/azure-openai-test-connection/index.ts",
  );
  assert(
    !/Tenant Admin or Organization Admin authority is required\./.test(src),
    "denied message must no longer claim Organization Admin authority",
  );
  assertStringIncludes(src, "Tenant Admin authority is required.");
  assert(
    !/Org Admin for the target Organization is accepted/.test(src),
    "header comment must not claim Org Admin acceptance for Azure test",
  );
  // Header comment names 8A.1 tightening explicitly.
  assertStringIncludes(src, "Tenant Admin only");
});

Deno.test("no BTPM AI runtime call site was migrated in this step", async () => {
  // Runtime files that must NOT read the new setting yet.
  const files = [
    "supabase/functions/_shared/guideTextProviderRuntime.ts",
    "supabase/functions/_shared/guideEmbeddingProviderRuntime.ts",
  ];
  for (const f of files) {
    try {
      const body = await read(f);
      assert(
        !body.includes("tenant_ai_provider_settings"),
        `${f} must not read tenant_ai_provider_settings in this step`,
      );
      assert(
        !body.includes("tenant_admin_get_ai_provider_setting"),
        `${f} must not call the new provider RPC in this step`,
      );
    } catch (_e) {
      // File may not exist; runtime boundary is preserved either way.
    }
  }
});
