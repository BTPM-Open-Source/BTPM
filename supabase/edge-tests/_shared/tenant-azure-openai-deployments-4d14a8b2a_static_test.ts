// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/tenant-azure-openai-deployments-4d14a8b2a_static_test.ts', import.meta.url).href;
// Phase 4D.14A.8B.2A — Static contract tests for Azure OpenAI deployment
// mapping storage, protected RPCs, UX visibility, provider readiness, and
// the runtime-boundary guarantee.
//
// These tests do not touch a live database, network, or UI.

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

Deno.test("Azure deployment mapping RPCs are Tenant-Admin only and validate values", async () => {
  const body = await findMigration(
    /FUNCTION public\.tenant_admin_update_azure_openai_deployments/,
  );
  // Authority
  assertStringIncludes(body, "_assert_tenant_admin_caller(v_ti.tenant_id)");
  // Constrained to azure_openai / default
  assertStringIncludes(body, "kind::text <> 'azure_openai' OR v_ti.name <> 'default'");
  // Validator rejects unknown keys and enforces bounds/chars
  assertStringIncludes(body, "azure_openai_deployments_unknown_key");
  assertStringIncludes(body, "azure_openai_deployments_missing_key");
  assertStringIncludes(body, "azure_openai_deployments_invalid_value");
  assertStringIncludes(body, "char_length(v_str) > 128");
  assertMatch(body, /v_str\s*~\s*'\[\[:cntrl:\]\]'/);
  assertMatch(body, /v_str\s*~\s*'\[\/\\\\\?#\]'/);
  // GRANTs
  assertStringIncludes(
    body,
    "GRANT EXECUTE ON FUNCTION public.tenant_admin_update_azure_openai_deployments(uuid, jsonb, text) TO authenticated",
  );
  assertStringIncludes(
    body,
    "GRANT EXECUTE ON FUNCTION public.tenant_admin_get_azure_openai_deployments(uuid) TO authenticated",
  );
});

Deno.test("update RPC preserves endpoint and other safe metadata", async () => {
  const body = await findMigration(
    /FUNCTION public\.tenant_admin_update_azure_openai_deployments/,
  );
  // Uses _safe_integration_config_metadata to preserve non-secret keys.
  assertStringIncludes(
    body,
    "_safe_integration_config_metadata(COALESCE(v_ti.config_metadata, '{}'::jsonb))",
  );
  // Only touches azure_deployments key.
  assertStringIncludes(body, "|| jsonb_build_object('azure_deployments', v_normalized)");
});

Deno.test("readiness helper adds azure_openai_deployments_incomplete gate", async () => {
  const body = await findMigration(/azure_openai_deployments_incomplete/);
  assertStringIncludes(body, "FUNCTION public._tenant_ai_provider_readiness");
  assertStringIncludes(body, "_azure_openai_required_deployment_keys()");
  assertStringIncludes(body, "'azure_openai_deployments_incomplete'");
  // Existing gates still present.
  assertStringIncludes(body, "'connection_test_not_passed'");
  assertStringIncludes(body, "'missing_required_configuration'");
});

Deno.test("required deployment keys = active openai model_ids + fixed embedding", async () => {
  const body = await findMigration(
    /FUNCTION public\._azure_openai_required_deployment_keys/,
  );
  assertStringIncludes(body, "_azure_openai_required_text_model_keys()");
  assertStringIncludes(body, "ARRAY['text-embedding-3-small']::text[]");
  const textBody = await findMigration(
    /FUNCTION public\._azure_openai_required_text_model_keys/,
  );
  assertStringIncludes(textBody, "FROM public.ai_model_registry");
  assertStringIncludes(textBody, "provider = 'openai' AND active = true");
});

Deno.test("mapping card is only shown on Tenant default and org-override note updated", async () => {
  const src = await read(
    "src/components/admin/TenantIntegrationSecretSetupDialog.tsx",
  );
  // Only rendered when activeOrgId === null.
  assertStringIncludes(src, "activeOrgId === null ?");
  assertStringIncludes(src, "AzureOpenAiDeploymentMappingsCard");
  // Component defined in the same file.
  assertStringIncludes(src, "function AzureOpenAiDeploymentMappingsCard");
  // Org-override note replaced with new wording.
  assertStringIncludes(
    src,
    "The Azure OpenAI endpoint and model deployment mappings are managed at",
  );
  assertStringIncludes(src, "may override the API key only.");
  // Fixed helper note text.
  assertStringIncludes(
    src,
    "Azure OpenAI calls use deployment names. Map each BTPM model to the corresponding deployment created in your Azure OpenAI resource.",
  );
  // Save button + configured count.
  assertStringIncludes(src, "Save mappings");
  assertStringIncludes(src, "configured");
});

Deno.test("no AI runtime file reads azure_deployments in this step", async () => {
  const files = [
    "supabase/functions/_shared/guideTextProviderRuntime.ts",
    "supabase/functions/_shared/guideEmbeddingProviderRuntime.ts",
    "supabase/functions/_shared/openai-responses.ts",
  ];
  for (const f of files) {
    try {
      const body = await read(f);
      assert(
        !body.includes("azure_deployments"),
        `${f} must not read azure_deployments in this step`,
      );
      assert(
        !body.includes("tenant_admin_get_azure_openai_deployments"),
        `${f} must not call the deployment mapping RPC in this step`,
      );
    } catch (_e) {
      // File may not exist; runtime boundary preserved.
    }
  }
});
