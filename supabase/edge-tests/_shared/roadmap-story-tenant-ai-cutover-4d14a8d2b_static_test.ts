// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/roadmap-story-tenant-ai-cutover-4d14a8d2b_static_test.ts', import.meta.url).href;
// Phase 4D.14A.8D.2B — Static contract tests confirming Roadmap Story
// generation and polling are migrated to the Tenant AI runtime and
// Responses transport, that provider/model pin correctly across the
// pair, and that legacy OpenAI-only enqueue/poll helpers are gone.

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
  const src = await read("supabase/functions/generate-roadmap-story/index.ts");
  assertStringIncludes(src, 'from "../_shared/tenantAiTextRuntime.ts"');
  assertStringIncludes(src, "resolveTenantAiTextRuntime(");
  assertStringIncludes(src, 'from "../_shared/tenantAiResponsesClient.ts"');
  assertStringIncludes(src, "enqueueTenantAiResponse(");
  // Legacy OpenAI-only enqueue helper is no longer imported or called.
  assert(!src.includes("enqueueOpenAIResponse"));
  assert(!src.includes('from "../_shared/openai-responses.ts"'));
  // Legacy OpenAI-only runtime resolver is no longer imported.
  assert(!src.includes("resolveTenantOpenAiRuntimeConfig"));
});

Deno.test("generate persists runtime provider and canonical model on the run", async () => {
  const src = await read("supabase/functions/generate-roadmap-story/index.ts");
  assertStringIncludes(src, "_provider: runtime.provider");
  assertStringIncludes(src, "_model: runtime.canonicalModel");
  // Input manifest must carry the runtime values, not a hard-coded "openai".
  assertStringIncludes(src, "provider: runtime.provider");
  assertStringIncludes(src, "model: runtime.canonicalModel");
  // Response echoes the canonical model + provider, never a raw Azure
  // deployment name.
  assertStringIncludes(src, "model: runtime.canonicalModel");
});

Deno.test("generate omits `model` from the enqueue payload and preserves reasoning fallback", async () => {
  const src = await read("supabase/functions/generate-roadmap-story/index.ts");
  // Payload built for enqueue must not carry `model: modelId` — the
  // transport forces runtime.providerModel.
  const enqueueBlockStart = src.indexOf("const enqueuePayload");
  assert(enqueueBlockStart > 0, "enqueue payload must exist");
  const enqueueBlock = src.slice(enqueueBlockStart, enqueueBlockStart + 500);
  assert(
    !/model:\s*modelId/.test(enqueueBlock),
    "enqueue payload must not carry model",
  );
  // Reasoning fallback: retries once when the transport reports a
  // request_rejected category and the payload had `reasoning`.
  assertStringIncludes(src, 'category === "request_rejected"');
  assertStringIncludes(src, "delete enqueuePayload.reasoning");
});

Deno.test("poll uses pinned-provider resolver + Tenant Responses status", async () => {
  const src = await read("supabase/functions/poll-roadmap-story/index.ts");
  assertStringIncludes(src, "resolveTenantAiTextRuntimeForProvider");
  assertStringIncludes(src, "getTenantAiResponseStatus");
  // Reads pinned provider + model from the run status RPC result.
  assertStringIncludes(src, "run.provider");
  assertStringIncludes(src, "run.model");
  assertStringIncludes(src, "provider: pinnedProvider");
  assertStringIncludes(src, "canonicalModel: run.model");
  // Never reads the active-provider resolver in the poll path.
  assert(!src.includes("resolveTenantAiTextRuntime("));
  // Legacy OpenAI-only helpers gone.
  assert(!src.includes("getOpenAIResponseStatus"));
  assert(!src.includes("resolveTenantOpenAiRuntimeConfig"));
});

Deno.test("poll persists runtime provider + canonical model in model metadata", async () => {
  const src = await read("supabase/functions/poll-roadmap-story/index.ts");
  const metaStart = src.indexOf("const modelMetadata");
  assert(metaStart > 0);
  const metaBlock = src.slice(metaStart, metaStart + 500);
  assertStringIncludes(metaBlock, "provider: runtime.provider");
  assertStringIncludes(metaBlock, "model: runtime.canonicalModel");
  // Metadata must not persist the provider `model` value from the
  // completed response body (which would expose Azure deployment names).
  assert(
    !/model:\s*\(poll\.body[^)]*\)/.test(metaBlock),
    "metadata must not persist provider model from response body",
  );
});

Deno.test("neither roadmap story function leaks the Azure deployment name", async () => {
  for (
    const rel of [
      "supabase/functions/generate-roadmap-story/index.ts",
      "supabase/functions/poll-roadmap-story/index.ts",
    ]
  ) {
    const src = await read(rel);
    // Strip comments so an explanatory reference to providerModel in a
    // comment does not count as a leak — only executable code matters.
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
