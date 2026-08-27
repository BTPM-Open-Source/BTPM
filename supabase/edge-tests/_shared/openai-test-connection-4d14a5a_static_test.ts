// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/openai-test-connection-4d14a5a_static_test.ts', import.meta.url).href;
// Phase 4D.14A.5A — Static-contract test for the OpenAI Test Connection
// surface. Verifies:
//   - the transport client never touches Supabase / Vault / Global secrets
//   - the transport client never calls a generation endpoint
//   - the Edge Function reuses the shared admin authority helper and rejects
//     denied/infra outcomes as 403 with fixed messages
//   - the frontend service never propagates raw client-library error text
//   - the dialog shows an OpenAI Test Connection card, gates on Tenant Admin
//     + production Org, resets on secret mutation, and never renders model
//     names, model IDs, response data, or raw errors
//   - the SQL recorder migration exists and matches the canonical contract

import { assert, assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";

async function read(rel: string): Promise<string> {
  return await Deno.readTextFile(new URL(rel, __BTPM_SRC_BASE__));
}

Deno.test("openAiConnectionTestClient: transport-only, no Supabase/Vault/Global reads", async () => {
  const src = await read("./openAiConnectionTestClient.ts");
  const forbidden = [
    "createClient(",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "resolveTenantIntegrationSecretValue",
    "resolveTenantOpenAiRuntimeConfig",
    "tenant_integrations",
    "organizations",
    'Deno.env.get("OPENAI_API_KEY")',
    'Deno.env.get(\'OPENAI_API_KEY\')',
  ];
  for (const tok of forbidden) {
    assertEquals(src.includes(tok), false, `openAiConnectionTestClient must not contain ${tok}`);
  }
});

Deno.test("openAiConnectionTestClient: only calls GET /v1/models", async () => {
  const src = await read("./openAiConnectionTestClient.ts");
  assert(src.includes("/v1/models"));
  // No generation surfaces.
  for (const url of [
    "/v1/chat/completions",
    "/v1/responses",
    "/v1/completions",
    "/v1/images",
    "/v1/audio",
    "/v1/embeddings",
    "/v1/moderations",
    "/v1/assistants",
  ]) {
    assertEquals(src.includes(url), false, `must not call ${url}`);
  }
});

Deno.test("openAiConnectionTestClient: bounded timeout + safe log fields", async () => {
  const src = await read("./openAiConnectionTestClient.ts");
  assert(src.includes("OPENAI_TEST_TIMEOUT_MS = 20_000"));
  assert(src.includes("AbortController"));
  assert(src.includes('"list_models"'));
  // Never logs response body / models / model list.
  assertEquals(/console\.log\([^)]*body/i.test(src), false);
});

Deno.test("openai-test-connection Edge Function: authority reuse and fixed messages", async () => {
  const src = await read("../openai-test-connection/index.ts");
  assert(src.includes("evaluateAuthority"));
  assert(src.includes("is_org_admin"));
  assert(src.includes("is_tenant_admin"));
  assert(src.includes("Tenant Admin or Organization Admin authority is required."));
  assert(src.includes("OpenAI authority could not be verified."));
  // No trust of caller-supplied tenant/integration id.
  assertEquals(src.includes("body?.tenant_id"), false);
  assertEquals(src.includes("body?.integration_id"), false);
  assertEquals(src.includes("body?.api_key"), false);
  assertEquals(src.includes("body?.model"), false);
});

Deno.test("openai-test-connection Edge Function: uses canonical recorder", async () => {
  const src = await read("../openai-test-connection/index.ts");
  assert(src.includes("recordTenantIntegrationTestResult"));
  assert(src.includes("resolveTenantOpenAiRuntimeConfig"));
  assert(src.includes('"real_integration"'));
  assert(src.includes('"openai-read-only-connection-test"'));
  // Never returns model IDs / integration IDs / vault metadata.
  assertEquals(src.includes("model_id"), false);
  assertEquals(src.includes("integration_id:"), false);
  assertEquals(src.includes("vault"), false);
});

Deno.test("openAiConnectionTestService: fixed public message, no raw error propagation", async () => {
  const src = await read("../../../src/lib/openAiConnectionTestService.ts");
  assert(src.includes("OPENAI_CONNECTION_TEST_UNAVAILABLE_MESSAGE"));
  assert(src.includes('"openai-test-connection"'));
  // No `throw new Error(error.message)` remains.
  assertEquals(/throw\s+new\s+Error\(\s*error\.message\s*\)/.test(src), false);
  // No leak of FunctionsHttpError text.
  assertEquals(src.includes("FunctionsHttpError"), false);
});

Deno.test("dialog: shows OpenAI Test Connection card and reuses runOpenAiConnectionTest", async () => {
  const src = await read(
    "../../../src/components/admin/TenantIntegrationSecretSetupDialog.tsx",
  );
  assert(src.includes("OpenAiTestConnectionCard"));
  assert(src.includes("runOpenAiConnectionTest"));
  assert(src.includes('integ.kind === "openai"'));
  // OpenAI explanatory text is present.
  assert(src.includes("read-only test"));
  assert(src.includes("generate content"));
  // Success message.
  assert(src.includes(
    "Connection successful. OpenAI accepted the Tenant credential.",
  ));
  // Result reset via resetKey and secretMutationRevision.
  assert(src.includes("secretMutationRevision"));
  // No model names / IDs / raw response fields are surfaced.
  for (const forbidden of [
    "result.model",
    "result.models",
    "result.data",
    "model_id",
    "model_name",
    "response_body",
  ]) {
    assertEquals(src.includes(forbidden), false, `dialog must not render ${forbidden}`);
  }
  // Non-Power-BI, non-OpenAI still shows the "later" affordance.
  assert(src.includes("Test connection — later"));
});

Deno.test("dialog: OpenAI card raw client-library error not rendered", async () => {
  const src = await read(
    "../../../src/components/admin/TenantIntegrationSecretSetupDialog.tsx",
  );
  assert(src.includes("OPENAI_CONNECTION_TEST_UNAVAILABLE_MESSAGE"));
  assertEquals(
    /setErrorMessage\([^)]*e[^)]*message/.test(src),
    false,
    "dialog must never surface raw client-library error text for OpenAI",
  );
});

Deno.test("tenantIntegrationTestResult wrapper: RPC-only, no direct table writes", async () => {
  const src = await read("./tenantIntegrationTestResult.ts");
  assert(src.includes('"record_tenant_integration_test_result"'));
  // Wrapper must not perform table-level writes/queries directly.
  assertEquals(/\.from\(\s*["']tenant_integrations["']/.test(src), false);
  assertEquals(/\.from\(\s*["']tenant_secret_access_audit["']/.test(src), false);
  assertEquals(/\bUPDATE\s+public\.tenant_integrations\b/i.test(src), false);
  assertEquals(/\bINSERT\s+INTO\s+public\.tenant_secret_access_audit\b/i.test(src), false);
});

Deno.test("SQL recorder migration exists and matches contract", async () => {
  const migrationsDir = new URL("../../migrations/", __BTPM_SRC_BASE__);
  const entries: string[] = [];
  for await (const e of Deno.readDir(migrationsDir)) {
    if (e.isFile && e.name.endsWith(".sql")) entries.push(e.name);
  }
  let combined = "";
  for (const f of entries) {
    combined += await Deno.readTextFile(new URL(f, migrationsDir));
    combined += "\n";
  }
  assert(combined.includes(
    "CREATE OR REPLACE FUNCTION public.record_tenant_integration_test_result",
  ), "recorder function missing from migrations");
  // Contract: service_role only.
  assert(combined.includes(
    "GRANT EXECUTE ON FUNCTION public.record_tenant_integration_test_result(uuid, uuid, uuid, text, text, text, text) TO service_role",
  ));
  assert(combined.includes(
    "REVOKE ALL ON FUNCTION public.record_tenant_integration_test_result(uuid, uuid, uuid, text, text, text, text) FROM authenticated",
  ));
  // Contract: never touches status / is_enabled / config_metadata.
  const fnStart = combined.indexOf(
    "CREATE OR REPLACE FUNCTION public.record_tenant_integration_test_result",
  );
  const fnBody = combined.slice(fnStart, fnStart + 6000);
  // Contract: SET clauses must not touch status / is_enabled / config_metadata.
  assertEquals(/SET\s+status\s*=/i.test(fnBody), false);
  assertEquals(/SET\s+is_enabled\s*=/i.test(fnBody), false);
  assertEquals(/SET\s+config_metadata\s*=/i.test(fnBody), false);
  assertEquals(/,\s*status\s*=/i.test(fnBody), false);
  assertEquals(/,\s*is_enabled\s*=/i.test(fnBody), false);
  assertEquals(/,\s*config_metadata\s*=/i.test(fnBody), false);
  // Contract: audit action is 'tested'.
  assert(fnBody.includes("'tested'::public.tenant_secret_audit_action"));
  // Contract: cross-tenant organization is rejected.
  assert(fnBody.includes("organization_tenant_mismatch"));
});

