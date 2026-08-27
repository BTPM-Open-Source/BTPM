// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/decision-case-evidence-diagnostic-tenant-ai-cutover-4d14a8d4_static_test.ts', import.meta.url).href;
// Phase 4D.14A.8D.4 — Static contract tests confirming the Decision Case
// evidence-reading diagnostic is migrated to the Tenant AI runtime and
// the synchronous Responses transport.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";

const REPO_ROOT = new URL("../../../", __BTPM_SRC_BASE__);
const DIAG = "supabase/functions/test-openai-decision-evidence-summary/index.ts";

async function read(rel: string): Promise<string> {
  return await Deno.readTextFile(new URL(rel, REPO_ROOT));
}

Deno.test("diagnostic uses active-provider Tenant AI runtime + synchronous transport", async () => {
  const src = await read(DIAG);
  assertStringIncludes(src, 'from "../_shared/tenantAiTextRuntime.ts"');
  assertStringIncludes(src, "resolveTenantAiTextRuntime(");
  assertStringIncludes(src, 'from "../_shared/tenantAiResponsesClient.ts"');
  assertStringIncludes(src, "executeTenantAiResponse(");
  // Uses the shared pure response-text extractor.
  assertStringIncludes(src, 'from "../_shared/openai-responses.ts"');
  assertStringIncludes(src, "extractResponseText(");
  // Legacy OpenAI-only path is gone.
  assert(!src.includes("resolveTenantOpenAiRuntimeConfig"));
  assert(!src.includes('from "../_shared/tenantOpenAi.ts"'));
  assert(!src.includes("https://api.openai.com/v1/responses"));
});

Deno.test("diagnostic removes the OpenAI-only feature/provider gate", async () => {
  const src = await read(DIAG);
  assert(!/provider !== "openai"/.test(src));
  assert(!/reg\.provider !== "openai"/.test(src));
});

Deno.test("diagnostic response returns runtime provider + canonical model", async () => {
  const src = await read(DIAG);
  assertStringIncludes(src, "model: runtime.canonicalModel");
  assertStringIncludes(src, "provider: runtime.provider");
});

Deno.test("diagnostic omits model/background/store from execute payload", async () => {
  const src = await read(DIAG);
  const start = src.indexOf("executeTenantAiResponse({");
  assert(start > 0, "execute call must exist");
  const block = src.slice(start, start + 500);
  assert(!/\bmodel:\s*(modelId|runtime\.providerModel)/.test(block));
  assert(!/background:\s*(true|false)/.test(block));
  assert(!/store:\s*(true|false)/.test(block));
});

Deno.test("diagnostic never leaks Azure deployment names or raw provider messages", async () => {
  const src = await read(DIAG);
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert(
    !codeOnly.includes("providerModel"),
    "diagnostic must not surface runtime.providerModel in executable code",
  );
  assert(
    !codeOnly.includes("azure_deployments"),
    "diagnostic must not read azure_deployments directly",
  );
  // Raw provider error messages must not be echoed to the client.
  assert(
    !/aiBody\?\.error\?\.message/.test(codeOnly),
    "diagnostic must not surface provider error messages",
  );
});

Deno.test("diagnostic surfaces only safe fixed failure categories", async () => {
  const src = await read(DIAG);
  // The synchronous transport's safe categories are the only allowed
  // shapes reflected back on failure.
  assertStringIncludes(src, "exec.category");
  assert(!/error:\s*"openai_request_failed"/.test(src));
});

Deno.test("diagnostic does not persist anything for the AI call", async () => {
  const src = await read(DIAG);
  // No insertions into governance/decision_case AI run tables in this path.
  assert(!/\.from\("decision_case_ai_runs"\)\.insert/.test(src));
});
