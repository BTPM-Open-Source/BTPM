// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/azure-openai-readiness-4d14a8a1_static_test.ts', import.meta.url).href;
// Phase 4D.14A.8A.1 — Static contract tests for Azure OpenAI readiness,
// authority, endpoint visibility, and test-persistence corrections.
//
// These tests do not exercise live networks, live Supabase, or live UI.
// They pin the on-disk contracts so future refactors cannot silently
// regress the 8A.1 corrections.

import { assert, assertEquals, assertMatch, assertStringIncludes } from
  "https://deno.land/std@0.208.0/assert/mod.ts";

const REPO_ROOT = new URL("../../../", __BTPM_SRC_BASE__);

async function read(path: string): Promise<string> {
  const url = new URL(path, REPO_ROOT);
  return await Deno.readTextFile(url);
}

Deno.test("Azure OpenAI required secret catalog exposes only api_key in the frontend catalog", async () => {
  const src = await read("src/lib/admin/integrationSecretCatalog.ts");
  // Isolate the azure_openai catalog block.
  const idx = src.indexOf("azure_openai: {");
  assert(idx >= 0, "expected azure_openai catalog entry");
  const block = src.slice(idx, src.indexOf("},", idx));
  assertStringIncludes(block, 'PWD("api_key"');
  assert(!/PWD\("endpoint"/.test(block), "endpoint must not be a secret");
  assert(!/PWD\("deployment"/.test(block), "deployment must not be a secret");
});

Deno.test(
  "latest Azure OpenAI required-secret migration returns ARRAY['api_key'] only for azure_openai",
  async () => {
    // The 8A.1 correction migration must be present and set azure_openai to
    // ARRAY['api_key']. We do not assume file name; scan migrations dir.
    const dir = new URL("supabase/migrations/", REPO_ROOT);
    let found = false;
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !e.name.endsWith(".sql")) continue;
      const body = await Deno.readTextFile(new URL(e.name, dir));
      if (
        body.includes(
          "CREATE OR REPLACE FUNCTION public._required_tenant_integration_secret_names",
        ) &&
        /WHEN\s+'azure_openai'\s+THEN\s+ARRAY\['api_key'\]/.test(body)
      ) {
        found = true;
      }
      if (
        body.includes(
          "CREATE OR REPLACE FUNCTION public._required_tenant_integration_secret_names",
        ) &&
        /WHEN\s+'azure_openai'\s+THEN\s+ARRAY\['api_key','endpoint','deployment'\]/
          .test(body)
      ) {
        // Older migration is allowed to exist; assertion is on the presence
        // of the correction, not the removal of history.
      }
    }
    assert(
      found,
      "expected a migration setting azure_openai required secrets to ['api_key']",
    );
  },
);

Deno.test(
  "required non-secret configuration function requires endpoint for azure_openai",
  async () => {
    const dir = new URL("supabase/migrations/", REPO_ROOT);
    let found = false;
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !e.name.endsWith(".sql")) continue;
      const body = await Deno.readTextFile(new URL(e.name, dir));
      if (
        body.includes(
          "CREATE OR REPLACE FUNCTION public._required_tenant_integration_config_names",
        ) &&
        /WHEN\s+'azure_openai'\s+THEN\s+ARRAY\['endpoint'\]/.test(body)
      ) {
        found = true;
      }
    }
    assert(found, "expected _required_tenant_integration_config_names to require endpoint for azure_openai");
  },
);

Deno.test(
  "enable-integration RPC now validates required non-secret configuration keys",
  async () => {
    const dir = new URL("supabase/migrations/", REPO_ROOT);
    let matched = false;
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !e.name.endsWith(".sql")) continue;
      const body = await Deno.readTextFile(new URL(e.name, dir));
      if (
        body.includes(
          "CREATE OR REPLACE FUNCTION public.tenant_admin_set_integration_enabled",
        ) &&
        body.includes("_required_tenant_integration_config_names") &&
        body.includes("missing required configuration")
      ) {
        matched = true;
      }
    }
    assert(matched, "tenant_admin_set_integration_enabled must validate required configuration");
  },
);

Deno.test(
  "Azure endpoint update RPC clears stale test-result columns when the endpoint changes",
  async () => {
    const dir = new URL("supabase/migrations/", REPO_ROOT);
    let matched = false;
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !e.name.endsWith(".sql")) continue;
      const body = await Deno.readTextFile(new URL(e.name, dir));
      if (
        body.includes(
          "CREATE OR REPLACE FUNCTION public.tenant_admin_update_azure_openai_endpoint",
        ) &&
        /last_tested_at\s*=\s*CASE WHEN _endpoint_changed/.test(body) &&
        /last_success_at\s*=\s*CASE WHEN _endpoint_changed/.test(body) &&
        /last_error_at\s*=\s*CASE WHEN _endpoint_changed/.test(body) &&
        /last_error_message\s*=\s*CASE WHEN _endpoint_changed/.test(body)
      ) {
        matched = true;
      }
    }
    assert(matched, "endpoint update must reset stale test-result columns on change");
  },
);

Deno.test(
  "Azure endpoint readback RPC exists, is Tenant-Admin gated, and returns only the endpoint",
  async () => {
    const dir = new URL("supabase/migrations/", REPO_ROOT);
    let matched = false;
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !e.name.endsWith(".sql")) continue;
      const body = await Deno.readTextFile(new URL(e.name, dir));
      const marker =
        "CREATE OR REPLACE FUNCTION public.tenant_admin_get_azure_openai_endpoint";
      const idx = body.indexOf(marker);
      if (idx < 0) continue;
      // Slice just the readback function body (up to next CREATE/GRANT/COMMENT).
      const rest = body.slice(idx);
      const end = Math.min(
        ...[
          rest.indexOf("\nCREATE ", 1),
          rest.indexOf("\nREVOKE "),
          rest.indexOf("\nGRANT "),
          rest.indexOf("\nCOMMENT ON FUNCTION public.tenant_admin_update"),
        ].filter((n) => n > 0),
      );
      const fnBody = end > 0 ? rest.slice(0, end) : rest;
      assertStringIncludes(fnBody, "_assert_tenant_admin_caller(_ti.tenant_id)");
      assertStringIncludes(fnBody, "'endpoint', _endpoint");
      assert(
        !/'api_key'/.test(fnBody),
        "readback function body must not reference api_key",
      );
      matched = true;
    }
    assert(matched, "expected tenant_admin_get_azure_openai_endpoint RPC");
  },
);

Deno.test(
  "azure-openai-test-connection Edge Function requires Tenant Admin authority (Org Admin alone is not sufficient)",
  async () => {
    const src = await read(
      "supabase/functions/azure-openai-test-connection/index.ts",
    );
    assertStringIncludes(
      src,
      'authority.outcome !== "allowed_tenant_admin"',
    );
    // No path may accept `allowed_org_admin` as sufficient authority.
    assert(
      !/authority\.outcome === "allowed_org_admin"/.test(src),
      "Org Admin alone must not satisfy Azure test authority",
    );
  },
);

Deno.test(
  "azure-openai-test-connection persists a test result on resolver failure",
  async () => {
    const src = await read(
      "supabase/functions/azure-openai-test-connection/index.ts",
    );
    // Pre-resolves the integration id before running the resolver.
    assertStringIncludes(src, "preresolvedIntegrationId");
    assertStringIncludes(src, ".eq(\"kind\", \"azure_openai\")");
    // Records the failure classification via the canonical recorder.
    assertMatch(
      src,
      /if \(preresolvedIntegrationId\)[\s\S]*recordTenantIntegrationTestResult/,
    );
  },
);

Deno.test(
  "Configure Secrets dialog reads the Azure endpoint through the dedicated RPC and only edits it on the Tenant tab",
  async () => {
    const src = await read(
      "src/components/admin/TenantIntegrationSecretSetupDialog.tsx",
    );
    assertStringIncludes(src, "tenant_admin_get_azure_openai_endpoint");
    // Endpoint editor is only rendered when the current scope is Tenant.
    assertStringIncludes(src, "activeOrgId === null ? (");
    // Endpoint value is no longer read from the generic detail RPC's
    // config_metadata (which never returns it).
    assert(
      !/integ\.config_metadata as Record<string, unknown>[\s\S]*?\["endpoint"\]/
        .test(src),
      "endpoint must not be read from integ.config_metadata (RPC never returns it)",
    );
  },
);

Deno.test("Azure endpoint change invalidates the endpoint query and increments the test-reset revision", async () => {
  const src = await read(
    "src/components/admin/TenantIntegrationSecretSetupDialog.tsx",
  );
  assertMatch(
    src,
    /onSaved=\{\(\) => \{[\s\S]*queryKey: \["tenant-admin-azure-openai-endpoint"[\s\S]*setSecretMutationRevision/,
  );
});

Deno.test("Azure test-connection reset key includes the current endpoint", async () => {
  const src = await read(
    "src/components/admin/TenantIntegrationSecretSetupDialog.tsx",
  );
  assertStringIncludes(
    src,
    "endpoint=${azureEndpointQuery.data ?? \"\"}",
  );
});

Deno.test("frontend integration catalog description confirms endpoint is non-secret configuration", async () => {
  const src = await read("src/lib/admin/integrationSecretCatalog.ts");
  const azureBlock = src.slice(src.indexOf("azure_openai: {"));
  assertStringIncludes(azureBlock, "endpoint is non-secret configuration");
});

Deno.test("baseline default-provisioning migration still includes azure_openai", async () => {
  // Sanity: verify the earlier baseline provisioning is not disturbed by
  // this correction step.
  const body = await read(
    "supabase/migrations/20260716112539_52d77df1-ec6c-4aaa-bf26-c6213613cfdf.sql",
  );
  assertStringIncludes(body, "('azure_openai'),");
});

Deno.test("Azure test-connection Edge Function safeLog scrubber still drops sensitive fields", async () => {
  const src = await read(
    "supabase/functions/azure-openai-test-connection/index.ts",
  );
  for (const key of ["secret", "token", "authorization", "api_key", "endpoint", "tenant_id", "organization_id", "integration_id"]) {
    assertStringIncludes(src, key);
  }
});
