// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/decision-case-tenant-ai-cutover-4d14a8d3_static_test.ts', import.meta.url).href;
// Phase 4D.14A.8D.3 — Static contract tests confirming Decision Case AI
// Brief generation and polling are migrated to the Tenant AI runtime and
// Responses transport, that provider/model pin correctly across the
// pair, and that the constraint permits both providers.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";

const REPO_ROOT = new URL("../../../", __BTPM_SRC_BASE__);

async function read(rel: string): Promise<string> {
  return await Deno.readTextFile(new URL(rel, REPO_ROOT));
}

Deno.test("generate uses active-provider Tenant AI resolver + Tenant Responses transport", async () => {
  const src = await read("supabase/functions/generate-decision-case-ai-brief/index.ts");
  assertStringIncludes(src, 'from "../_shared/tenantAiTextRuntime.ts"');
  assertStringIncludes(src, "resolveTenantAiTextRuntime(");
  assertStringIncludes(src, 'from "../_shared/tenantAiResponsesClient.ts"');
  assertStringIncludes(src, "enqueueTenantAiResponse(");
  // Legacy OpenAI-only helpers gone.
  assert(!src.includes("resolveTenantOpenAiRuntimeConfig"));
  assert(!src.includes('from "../_shared/tenantOpenAi.ts"'));
  assert(!src.includes("https://api.openai.com/v1/responses"));
  // The `provider = openai` feature-setting gate is gone.
  assert(!/provider !== "openai"/.test(src));
});

Deno.test("generate persists runtime provider + canonical model on the AI run row", async () => {
  const src = await read("supabase/functions/generate-decision-case-ai-brief/index.ts");
  assertStringIncludes(src, "model_provider: runtime.provider");
  assertStringIncludes(src, "model_id: runtime.canonicalModel");
});

Deno.test("generate omits model/background/store from enqueue payload; keeps reasoning fallback", async () => {
  const src = await read("supabase/functions/generate-decision-case-ai-brief/index.ts");
  const start = src.indexOf("const enqueuePayload");
  assert(start > 0, "enqueue payload must exist");
  const block = src.slice(start, start + 600);
  assert(!/\bmodel:\s*(modelId|runtime\.providerModel)/.test(block));
  assert(!/background:\s*true/.test(block));
  assert(!/store:\s*true/.test(block));
  assertStringIncludes(src, 'category === "request_rejected"');
  assertStringIncludes(src, "delete enqueuePayload.reasoning");
});

Deno.test("poll uses pinned-provider resolver + Tenant Responses status", async () => {
  const src = await read("supabase/functions/poll-decision-case-ai-brief/index.ts");
  assertStringIncludes(src, "resolveTenantAiTextRuntimeForProvider");
  assertStringIncludes(src, "getTenantAiResponseStatus");
  // model_provider read from the run row.
  assertStringIncludes(src, "model_provider");
  assertStringIncludes(src, "provider: pinnedProvider");
  assertStringIncludes(src, "canonicalModel: pinnedModel");
  // Active-provider resolver + legacy helpers must be gone.
  assert(!src.includes("resolveTenantAiTextRuntime("));
  assert(!src.includes("resolveTenantOpenAiRuntimeConfig"));
  assert(!src.includes("https://api.openai.com/v1/responses"));
});

Deno.test("poll returns runtime canonical model, never provider-returned model", async () => {
  const src = await read("supabase/functions/poll-decision-case-ai-brief/index.ts");
  assertStringIncludes(src, "model: runtime.canonicalModel");
  assertStringIncludes(src, "provider: runtime.provider");
  // Must never persist or echo aiBody.model / poll.body.model.
  assert(!/model:\s*aiBody\?\.model/.test(src));
  assert(!/model:\s*\(poll\.body[^)]*\)/.test(src));
});

Deno.test("neither Decision Case function leaks Azure deployment names", async () => {
  for (
    const rel of [
      "supabase/functions/generate-decision-case-ai-brief/index.ts",
      "supabase/functions/poll-decision-case-ai-brief/index.ts",
    ]
  ) {
    const src = await read(rel);
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert(
      !codeOnly.includes("providerModel"),
      `${rel} must not surface runtime.providerModel in executable code`,
    );
    assert(
      !codeOnly.includes("azure_deployments"),
      `${rel} must not read azure_deployments directly`,
    );
  }
});

Deno.test("dcar_provider_valid constraint permits openai + azure_openai", async () => {
  const dir = new URL("supabase/migrations/", REPO_ROOT);
  const matches: { name: string; body: string }[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !e.name.endsWith(".sql")) continue;
    const body = await Deno.readTextFile(new URL(e.name, dir));
    if (/dcar_provider_valid/.test(body)) matches.push({ name: e.name, body });
  }
  assert(matches.length >= 2, "expected the original + the widening migration");
  matches.sort((a, b) => (a.name < b.name ? -1 : 1));
  const latest = matches[matches.length - 1];
  assertStringIncludes(latest.body, "openai");
  assertStringIncludes(latest.body, "azure_openai");
});
