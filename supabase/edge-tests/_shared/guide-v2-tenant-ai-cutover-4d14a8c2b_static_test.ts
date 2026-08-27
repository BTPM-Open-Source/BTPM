// Phase 4D.14A.8C.2B — Guide V2 Tenant AI Text Runtime Cutover contract test.
//
// This is a STATIC contract test. It only reads the source files on disk
// and asserts wiring/anti-wiring rules. It never spawns provider requests,
// never touches Supabase, and never reads secrets.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

async function read(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

// ---------------------------------------------------------------------------
// 1. Guide V2 runtime resolver uses the Tenant AI resolver + canonical model.
// ---------------------------------------------------------------------------

Deno.test("guideTextProviderRuntime resolves via Tenant AI text runtime", async () => {
  const src = await read(
    "supabase/functions/_shared/guideTextProviderRuntime.ts",
  );
  assertStringIncludes(src, "resolveBtpmGuideFeatureConfigForOrg");
  assertStringIncludes(src, "resolveTenantAiTextRuntime");
  assertStringIncludes(src, 'action: "external_api_write"');
  // Alias to canonical Tenant AI runtime shape.
  assertStringIncludes(
    src,
    "export type GuideTextProviderRuntimeConfig = TenantAiTextRuntime;",
  );
  // No Global AI env reads remain in the V2 resolver.
  assert(!src.includes("AI_PROVIDER"), "V2 resolver must not read AI_PROVIDER");
  assert(
    !src.includes("AZURE_OPENAI_"),
    "V2 resolver must not read AZURE_OPENAI_* env vars",
  );
  assert(
    !src.includes("OPENAI_API_KEY"),
    "V2 resolver must not read OPENAI_API_KEY env var",
  );
  assert(
    !src.includes("Deno.env.get"),
    "V2 resolver must not read any Deno env vars directly",
  );
});

// ---------------------------------------------------------------------------
// 2. Structured provider uses canonical transport, not direct fetch/URLs.
// ---------------------------------------------------------------------------

Deno.test("Guide V2 structured provider uses canonical Tenant AI chat transport", async () => {
  const src = await read("supabase/functions/_shared/ai-guide-v2/provider.ts");
  assertStringIncludes(src, "postTenantAiChatCompletion");
  assertStringIncludes(src, "runtime.canonicalModel");
  // Provider-specific URLs, header construction, and direct fetch calls
  // must not appear in the V2 provider anymore.
  assert(
    !src.includes("https://api.openai.com"),
    "V2 provider must not contain OpenAI URL literals",
  );
  assert(
    !src.includes("api-version="),
    "V2 provider must not compose Azure OpenAI URL query strings",
  );
  assert(
    !/Authorization:\s*`Bearer/.test(src),
    "V2 provider must not build Authorization headers directly",
  );
  assert(
    !src.includes('"api-key"'),
    "V2 provider must not build Azure api-key headers directly",
  );
  assert(
    !/\bawait\s+fetch\(/.test(src),
    "V2 provider must not call fetch() directly",
  );
});

// ---------------------------------------------------------------------------
// 3. Plain-text renderer uses canonical transport, not direct fetch/URLs.
// ---------------------------------------------------------------------------

Deno.test("Guide V2 renderer uses canonical Tenant AI chat transport", async () => {
  const src = await read("supabase/functions/_shared/ai-guide-v2/renderer.ts");
  assertStringIncludes(src, "postTenantAiChatCompletion");
  assertStringIncludes(src, "runtime.canonicalModel");
  assert(
    !src.includes("https://api.openai.com"),
    "V2 renderer must not contain OpenAI URL literals",
  );
  assert(
    !src.includes("api-version="),
    "V2 renderer must not compose Azure OpenAI URL query strings",
  );
  assert(
    !/Authorization:\s*`Bearer/.test(src),
    "V2 renderer must not build Authorization headers directly",
  );
  assert(
    !src.includes('"api-key"'),
    "V2 renderer must not build Azure api-key headers directly",
  );
  assert(
    !/\bawait\s+fetch\(/.test(src),
    "V2 renderer must not call fetch() directly",
  );
});

// ---------------------------------------------------------------------------
// 3b. Both V2 call paths derive body traits from the canonical model
//     WITHOUT branching on the provider (no Azure-specific `max_tokens`
//     branch). Phase 4D.14A.8C.2B.1 — Azure GPT-5 body compatibility.
// ---------------------------------------------------------------------------

Deno.test("Guide V2 provider applies canonical-model traits without provider branching", async () => {
  const src = await read("supabase/functions/_shared/ai-guide-v2/provider.ts");
  assertStringIncludes(src, "getOpenAiChatBodyTraits(runtime.canonicalModel)");
  assert(
    !/runtime\.provider\s*===\s*"openai"/.test(src),
    "V2 provider must not branch body construction on runtime.provider",
  );
  assert(
    !/\bmax_tokens:\s*maxTokens\b/.test(src),
    "V2 provider must not hardcode an Azure `max_tokens` branch",
  );
});

Deno.test("Guide V2 renderer applies canonical-model traits without provider branching", async () => {
  const src = await read("supabase/functions/_shared/ai-guide-v2/renderer.ts");
  assertStringIncludes(src, "getOpenAiChatBodyTraits(runtime.canonicalModel)");
  assert(
    !/\bmax_tokens:\s*800\b/.test(src),
    "V2 renderer must not hardcode an Azure `max_tokens: 800` branch",
  );
  assert(
    !/runtime\.provider\s*===\s*"openai"\s*\?[\s\S]{0,400}max_tokens/.test(src),
    "V2 renderer must not branch body construction on runtime.provider",
  );
});

// ---------------------------------------------------------------------------
// 4. V1 emergency chat is preserved through the legacy runtime.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 4. V1 ai-help-chat cut over to canonical Tenant AI runtime + transport
//    (Phase 4D.14A.8E.1). The legacy Global runtime module remains on disk
//    but must no longer be imported by ai-help-chat.
// ---------------------------------------------------------------------------

Deno.test("V1 ai-help-chat imports canonical Tenant AI runtime and transport", async () => {
  const src = await read("supabase/functions/ai-help-chat/index.ts");
  assertStringIncludes(src, "../_shared/guideTextProviderRuntime.ts");
  assertStringIncludes(src, "postTenantAiChatCompletion");
  assertStringIncludes(src, "../_shared/tenantAiChatCompletionsClient.ts");
  assertStringIncludes(src, "getOpenAiChatBodyTraits(guideRuntime.canonicalModel)");
  assert(
    !src.includes("../_shared/legacyGuideTextProviderRuntime.ts"),
    "V1 must no longer import the legacy Global Guide runtime",
  );
  assert(
    !src.includes("https://api.openai.com"),
    "V1 must not contain OpenAI URL literals",
  );
  assert(
    !src.includes("api-version="),
    "V1 must not compose Azure OpenAI URL query strings",
  );
  assert(
    !/Authorization:\s*`Bearer/.test(src),
    "V1 must not build Authorization headers directly",
  );
  assert(
    !src.includes('"api-key"'),
    "V1 must not build Azure api-key headers directly",
  );
  assert(
    !src.includes("AI_PROVIDER"),
    "V1 must not read the AI_PROVIDER env switch",
  );
  // Debug provider label must use the resolved runtime provider, not env.
  assert(
    !/Deno\.env\.get\(["']AI_PROVIDER["']\)/.test(src),
    "V1 must not read AI_PROVIDER from env for debug output",
  );
  // Legacy Global runtime file must no longer exist on disk.
  let legacyExists = true;
  try {
    await Deno.stat(
      "supabase/functions/_shared/legacyGuideTextProviderRuntime.ts",
    );
  } catch {
    legacyExists = false;
  }
  assert(
    !legacyExists,
    "legacyGuideTextProviderRuntime.ts must be removed after 4D.14A.8E.2",
  );
});

Deno.test("V1 ai-help-chat omits temperature and top_p for reasoning-tier models", async () => {
  const src = await read("supabase/functions/ai-help-chat/index.ts");
  const start = src.indexOf("getOpenAiChatBodyTraits(guideRuntime.canonicalModel)");
  const end = src.indexOf("postTenantAiChatCompletion", start);
  const block = src.slice(start, end);
  assert(
    block.includes("if (!traits.omitTemperature)"),
    "V1 must gate sampling parameters on traits.omitTemperature",
  );
  assert(
    block.includes("payload.temperature = 0.2"),
    "temperature must be assigned inside the non-reasoning gate",
  );
  assert(
    block.includes("payload.top_p = 1"),
    "top_p must be assigned inside the non-reasoning gate",
  );
  assert(
    !block.includes("top_p: 1"),
    "top_p must not be set unconditionally in the request body",
  );
});

// ---------------------------------------------------------------------------
// 4b. No unrelated production Edge Function has picked up the chat transport
//     as a side-effect of the V1 cutover.
// ---------------------------------------------------------------------------

Deno.test("only ai-help-chat imports the chat transport in production functions", async () => {
  const APPROVED_FUNCTIONS = new Set<string>(["ai-help-chat"]);
  const funcsDir = "supabase/functions";
  const offenders: string[] = [];
  async function walk(dir: string, topName: string | null) {
    for await (const e of Deno.readDir(dir)) {
      const path = `${dir}/${e.name}`;
      if (e.isDirectory) {
        if (topName === null && e.name === "_shared") continue;
        await walk(path, topName ?? e.name);
        continue;
      }
      if (!e.name.endsWith(".ts")) continue;
      const body = await Deno.readTextFile(path);
      if (body.includes("tenantAiChatCompletionsClient")) {
        if (!topName || !APPROVED_FUNCTIONS.has(topName)) {
          offenders.push(path);
        }
      }
    }
  }
  await walk(funcsDir, null);
  assertEquals(offenders, []);
});

// ---------------------------------------------------------------------------
// 5. Provider-label discipline: canonical model is returned; deployment
//    names never appear in provider.ts return values or renderer output.
// ---------------------------------------------------------------------------

Deno.test("V2 provider returns canonical model and openai|azure labels", async () => {
  const src = await read("supabase/functions/_shared/ai-guide-v2/provider.ts");
  assertStringIncludes(src, "model: runtime.canonicalModel");
  assertStringIncludes(src, "providerLabel");
  // Sanity: no reference to providerModel is returned to callers.
  assert(
    !/return[\s\S]*runtime\.providerModel/.test(src),
    "V2 provider must not return providerModel (Azure deployment name)",
  );
});

Deno.test("V2 renderer returns canonical model in its result", async () => {
  const src = await read("supabase/functions/_shared/ai-guide-v2/renderer.ts");
  assertStringIncludes(src, "model: runtime.canonicalModel");
  assert(
    !/model:\s*runtime\.providerModel/.test(src),
    "V2 renderer must not return providerModel (Azure deployment name)",
  );
});

// ---------------------------------------------------------------------------
// 6. Public error mapper still delegates to the canonical Tenant AI mapper.
// ---------------------------------------------------------------------------

Deno.test("toSafeGuideProviderPublicError delegates unknown errors to Tenant AI", async () => {
  const { toSafeGuideProviderPublicError } = await import(
    "../../functions/_shared/guideTextProviderRuntime.ts"
  );
  const safe = toSafeGuideProviderPublicError(new Error("boom"));
  assertEquals(safe.error, "ai_provider_configuration_unavailable");
  assertEquals(safe.note.includes("boom"), false);
});
