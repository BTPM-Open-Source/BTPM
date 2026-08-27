// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/roadmap-story-presentation-tenant-ai-cutover-4d14a8d2c_static_test.ts', import.meta.url).href;
// Phase 4D.14A.8D.2C — Static contract tests confirming Roadmap Story
// PRESENTATION generation and polling are migrated to the Tenant AI
// runtime and Responses transport, that provider/model pin correctly
// across the pair, that the status RPC exposes provider and model, and
// that legacy OpenAI-only helpers are gone from both functions.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";

const REPO_ROOT = new URL("../../../", __BTPM_SRC_BASE__);

async function read(rel: string): Promise<string> {
  return await Deno.readTextFile(new URL(rel, REPO_ROOT));
}

Deno.test("presentation generate uses active-provider Tenant AI resolver + Tenant Responses transport", async () => {
  const src = await read("supabase/functions/generate-roadmap-story-presentation/index.ts");
  assertStringIncludes(src, 'from "../_shared/tenantAiTextRuntime.ts"');
  assertStringIncludes(src, "resolveTenantAiTextRuntime(");
  assertStringIncludes(src, 'from "../_shared/tenantAiResponsesClient.ts"');
  assertStringIncludes(src, "enqueueTenantAiResponse(");
  // Legacy OpenAI-only enqueue helper is no longer imported or called.
  assert(!src.includes("enqueueOpenAIResponse"));
  assert(!src.includes('from "../_shared/openai-responses.ts"'));
  // Legacy OpenAI-only runtime resolver is no longer imported.
  assert(!src.includes("resolveTenantOpenAiRuntimeConfig"));
  // The feature-setting `provider = openai` gate is removed.
  assert(!src.includes('provider !== "openai"'));
});

Deno.test("presentation generate persists runtime provider and canonical model on the run", async () => {
  const src = await read("supabase/functions/generate-roadmap-story-presentation/index.ts");
  assertStringIncludes(src, "_provider: runtime.provider");
  assertStringIncludes(src, "_model: runtime.canonicalModel");
  // Input manifest carries runtime values.
  assertStringIncludes(src, "provider: runtime.provider");
  assertStringIncludes(src, "model: runtime.canonicalModel");
});

Deno.test("presentation generate omits `model` from enqueue payload and preserves reasoning fallback", async () => {
  const src = await read("supabase/functions/generate-roadmap-story-presentation/index.ts");
  const enqueueBlockStart = src.indexOf("const enqueuePayload");
  assert(enqueueBlockStart > 0, "enqueue payload must exist");
  const enqueueBlock = src.slice(enqueueBlockStart, enqueueBlockStart + 800);
  assert(
    !/model:\s*modelId/.test(enqueueBlock),
    "enqueue payload must not carry model",
  );
  assertStringIncludes(src, 'category === "request_rejected"');
  assertStringIncludes(src, "delete enqueuePayload.reasoning");
});

Deno.test("presentation poll uses pinned-provider resolver + Tenant Responses status", async () => {
  const src = await read("supabase/functions/poll-roadmap-story-presentation/index.ts");
  assertStringIncludes(src, "resolveTenantAiTextRuntimeForProvider");
  assertStringIncludes(src, "getTenantAiResponseStatus");
  // Reads pinned provider + model from the run status RPC result.
  assertStringIncludes(src, "run.provider");
  assertStringIncludes(src, "run.model");
  assertStringIncludes(src, "provider: pinnedProvider");
  assertStringIncludes(src, "canonicalModel: run.model");
  // Never uses the active-provider resolver in the poll path.
  assert(!src.includes("resolveTenantAiTextRuntime("));
  // Legacy OpenAI-only helpers gone.
  assert(!src.includes("getOpenAIResponseStatus"));
  assert(!src.includes("resolveTenantOpenAiRuntimeConfig"));
});

Deno.test("presentation poll persists runtime provider + canonical model in model metadata", async () => {
  const src = await read("supabase/functions/poll-roadmap-story-presentation/index.ts");
  const metaStart = src.indexOf("const modelMetadata");
  assert(metaStart > 0);
  const metaBlock = src.slice(metaStart, metaStart + 500);
  assertStringIncludes(metaBlock, "provider: runtime.provider");
  assertStringIncludes(metaBlock, "model: runtime.canonicalModel");
  // Metadata must not persist the provider `model` value from the response body.
  assert(
    !/model:\s*\(poll\.body[^)]*\)/.test(metaBlock),
    "metadata must not persist provider model from response body",
  );
});

Deno.test("neither presentation function leaks the Azure deployment name", async () => {
  for (
    const rel of [
      "supabase/functions/generate-roadmap-story-presentation/index.ts",
      "supabase/functions/poll-roadmap-story-presentation/index.ts",
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

Deno.test("get_roadmap_story_presentation_run_status returns provider and model", async () => {
  const dir = new URL("supabase/migrations/", REPO_ROOT);
  const matches: { name: string; body: string }[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !e.name.endsWith(".sql")) continue;
    const body = await Deno.readTextFile(new URL(e.name, dir));
    if (/FUNCTION public\.get_roadmap_story_presentation_run_status/.test(body)) {
      matches.push({ name: e.name, body });
    }
  }
  assert(matches.length > 0, "expected at least one status RPC migration");
  matches.sort((a, b) => (a.name < b.name ? -1 : 1));
  const latest = matches[matches.length - 1];
  const idx = latest.body.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.get_roadmap_story_presentation_run_status",
  );
  const tail = latest.body.slice(idx);
  assertStringIncludes(tail, "'provider', _run.provider");
  assertStringIncludes(tail, "'model', _run.model");
  // Grants preserved.
  assertStringIncludes(
    tail,
    "GRANT EXECUTE ON FUNCTION public.get_roadmap_story_presentation_run_status(uuid) TO authenticated",
  );
});
