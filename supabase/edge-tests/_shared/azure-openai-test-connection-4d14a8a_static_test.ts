// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/azure-openai-test-connection-4d14a8a_static_test.ts', import.meta.url).href;
// Phase 4D.14A.8A — Static-contract test suite.
// Verifies that Azure OpenAI Tenant configuration + test-connection surface
// meet the security and separation guarantees:
//   - transport client is transport-only, no Supabase/Vault/Global reads
//   - transport calls only `/models` under baseUrl, uses `api-key` header,
//     never sends `Authorization: Bearer`, never targets a generation endpoint
//   - Edge Function reuses shared authority + canonical recorder
//   - Edge Function never trusts caller-supplied tenant/integration/endpoint
//   - Frontend service never propagates raw client-library error text
//   - Dialog shows an Azure OpenAI Test Connection card + endpoint editor,
//     never shows deployment/api_version fields as required secrets,
//     never shows model names/IDs/response data, and never introduces an
//     active-provider selector
//   - Runtime resolver never reads AZURE_OPENAI_*, AI_PROVIDER, or
//     AI_EMBEDDING_PROVIDER, and never falls back to OpenAI
//   - Migration exists (endpoint normalizer, endpoint RPC, provisioning,
//     backfill)

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";

async function read(rel: string): Promise<string> {
  return await Deno.readTextFile(new URL(rel, __BTPM_SRC_BASE__));
}

async function readAllMigrations(): Promise<string> {
  const dir = new URL("../../migrations/", __BTPM_SRC_BASE__);
  const entries: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && e.name.endsWith(".sql")) entries.push(e.name);
  }
  let combined = "";
  for (const f of entries) combined += await Deno.readTextFile(new URL(f, dir));
  return combined;
}

Deno.test("transport: no Supabase/Vault/Global reads", async () => {
  const src = await read("./azureOpenAiConnectionTestClient.ts");
  for (
    const tok of [
      "createClient(",
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_ANON_KEY",
      "resolveTenantIntegrationSecretValue",
      "resolveTenantAzureOpenAiRuntimeConfig",
      "tenant_integrations",
      "organizations",
      'Deno.env.get("AZURE_OPENAI_API_KEY")',
      "AZURE_OPENAI_ENDPOINT",
      "AZURE_OPENAI_DEPLOYMENT",
      "AZURE_OPENAI_API_VERSION",
      "AI_PROVIDER",
      "AI_EMBEDDING_PROVIDER",
    ]
  ) {
    assertEquals(src.includes(tok), false, `transport must not include ${tok}`);
  }
});

Deno.test("transport: only /models, api-key header, no generation URLs", async () => {
  const src = await read("./azureOpenAiConnectionTestClient.ts");
  assert(src.includes("/models"));
  assert(src.includes('"api-key"'));
  // Azure connection test never uses OpenAI-style bearer auth.
  assertEquals(src.includes("Bearer "), false);
  for (
    const url of [
      "/chat/completions",
      "/responses",
      "/completions",
      "/embeddings",
      "/images",
      "/audio",
      "/assistants",
    ]
  ) {
    assertEquals(src.includes(url), false, `must not call ${url}`);
  }
});

Deno.test("transport: bounded timeout + no body logging", async () => {
  const src = await read("./azureOpenAiConnectionTestClient.ts");
  assert(src.includes("AZURE_OPENAI_TEST_TIMEOUT_MS = 20_000"));
  assert(src.includes("AbortController"));
  assertEquals(/console\.log\([^)]*body/i.test(src), false);
});

Deno.test("resolver: never reads Global Azure/routing env or falls back to OpenAI", async () => {
  const src = await read("./tenantAzureOpenAi.ts");
  // Strip line comments to avoid matching prose that mentions forbidden names.
  const code = src
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  for (
    const tok of [
      'Deno.env.get("AZURE_OPENAI_API_KEY")',
      'Deno.env.get("AZURE_OPENAI_ENDPOINT")',
      'Deno.env.get("AZURE_OPENAI_DEPLOYMENT")',
      'Deno.env.get("AZURE_OPENAI_API_VERSION")',
      'Deno.env.get("AI_PROVIDER")',
      'Deno.env.get("AI_EMBEDDING_PROVIDER")',
      "resolveTenantOpenAiRuntimeConfig",
      "OPENAI_API_KEY",
    ]
  ) {
    assertEquals(code.includes(tok), false, `resolver must not include ${tok}`);
  }
  assertEquals(/profiles/i.test(code), false);
  // Must resolve tenant via organizations table.
  assert(code.includes('.from("organizations")'));
  assert(code.includes('.eq("kind", "azure_openai")'));
  assert(code.includes('.eq("name", "default")'));
});

Deno.test("edge function: authority reuse and fixed messages", async () => {
  const src = await read("../azure-openai-test-connection/index.ts");
  assert(src.includes("evaluateAuthority"));
  assert(src.includes("is_org_admin"));
  assert(src.includes("is_tenant_admin"));
  assert(
    src.includes("Tenant Admin or Organization Admin authority is required."),
  );
  assert(src.includes("Azure OpenAI authority could not be verified."));
  // Never trusts caller-supplied tenant/integration/endpoint/api_key.
  for (
    const tok of [
      "body?.tenant_id",
      "body?.integration_id",
      "body?.endpoint",
      "body?.base_url",
      "body?.api_key",
      "body?.deployment",
      "body?.model",
    ]
  ) {
    assertEquals(src.includes(tok), false, `must not trust ${tok}`);
  }
});

Deno.test("edge function: uses canonical recorder + resolver", async () => {
  const src = await read("../azure-openai-test-connection/index.ts");
  const code = src
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
  assert(code.includes("recordTenantIntegrationTestResult"));
  assert(code.includes("resolveTenantAzureOpenAiRuntimeConfig"));
  assert(code.includes('"real_integration"'));
  assert(code.includes('"azure-openai-read-only-connection-test"'));
  // Never returns identifiers/metadata in the response body.
  for (
    const tok of [
      "model_id",
      "model_name",
      "integration_id:",
      "deployment_name",
      '"endpoint":',
      "vault_secret_id",
    ]
  ) {
    assertEquals(code.includes(tok), false, `must not surface ${tok}`);
  }
});

Deno.test("frontend service: fixed public message, no raw error propagation", async () => {
  const src = await read("../../../src/lib/azureOpenAiConnectionTestService.ts");
  assert(src.includes("AZURE_OPENAI_CONNECTION_TEST_UNAVAILABLE_MESSAGE"));
  assert(src.includes('"azure-openai-test-connection"'));
  assertEquals(/throw\s+new\s+Error\(\s*error\.message\s*\)/.test(src), false);
  assertEquals(src.includes("FunctionsHttpError"), false);
});

Deno.test("catalog: Azure OpenAI exposes only api_key as secret", async () => {
  const src = await read(
    "../../../src/lib/admin/integrationSecretCatalog.ts",
  );
  const azureBlock = src.split("azure_openai:")[1] ?? "";
  const end = azureBlock.indexOf("microsoft_graph:");
  const block = end === -1 ? azureBlock : azureBlock.slice(0, end);
  assert(block.includes('PWD("api_key"'));
  // deployment / api_version / endpoint are no longer required secrets
  // in the Azure OpenAI catalog entry.
  for (const tok of ['"deployment"', '"api_version"', '"endpoint"']) {
    assertEquals(
      block.includes(tok),
      false,
      `Azure catalog must not require ${tok} as a secret`,
    );
  }
});

Deno.test("dialog: Azure OpenAI card + endpoint editor + no forbidden fields", async () => {
  const src = await read(
    "../../../src/components/admin/TenantIntegrationSecretSetupDialog.tsx",
  );
  assert(src.includes("AzureOpenAiTestConnectionCard"));
  assert(src.includes("AzureOpenAiEndpointCard"));
  assert(src.includes("runAzureOpenAiConnectionTest"));
  assert(src.includes('integ.kind === "azure_openai"'));
  assert(src.includes(
    "BTPM will continue using the current OpenAI runtime until the Tenant AI provider migration is completed.",
  ));
  assert(src.includes("tenant_admin_update_azure_openai_endpoint"));
  // No model/deployment/response leak.
  for (
    const forbidden of [
      "result.model",
      "result.models",
      "result.data",
      "model_id",
      "model_name",
      "response_body",
      "deploymentName",
    ]
  ) {
    assertEquals(
      src.includes(forbidden),
      false,
      `dialog must not render ${forbidden}`,
    );
  }
  // Runtime-activation warning is present.
  assert(src.includes("BTPM will continue using the current OpenAI runtime"));
  // No active-provider selector is introduced.
  for (
    const forbidden of [
      "active_provider",
      "AI_PROVIDER",
      "activeAiProvider",
    ]
  ) {
    assertEquals(
      src.includes(forbidden),
      false,
      `dialog must not include ${forbidden}`,
    );
  }
});

Deno.test("dialog: Azure card raw client-library error is not rendered", async () => {
  const src = await read(
    "../../../src/components/admin/TenantIntegrationSecretSetupDialog.tsx",
  );
  assert(src.includes("AZURE_OPENAI_CONNECTION_TEST_UNAVAILABLE_MESSAGE"));
});

Deno.test("migration: normalizer, RPC, provisioning, backfill exist", async () => {
  const combined = await readAllMigrations();
  assert(
    combined.includes(
      "CREATE OR REPLACE FUNCTION public._normalize_azure_openai_endpoint",
    ),
  );
  assert(
    combined.includes(
      "CREATE OR REPLACE FUNCTION public.tenant_admin_update_azure_openai_endpoint",
    ),
  );
  assert(
    combined.includes(
      "CREATE OR REPLACE FUNCTION public._provision_default_tenant_integrations",
    ),
  );
  assert(combined.includes("trg_tenants_provision_integrations"));
  // Backfill statement present.
  assert(combined.includes("'azure_openai'::public.tenant_integration_kind"));
  // RPC grants: authenticated may execute the endpoint updater.
  assert(
    combined.includes(
      "GRANT EXECUTE ON FUNCTION public.tenant_admin_update_azure_openai_endpoint(uuid, text, text) TO authenticated",
    ),
  );
});
