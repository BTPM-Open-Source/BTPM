// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/embedding-cutover-4d14a3d_static_test.ts', import.meta.url).href;
// Phase 4D.14A.3D.1 — Static-contract assertions for the embedding cutover.
//
// These are pure source-text tests. They run without network, Supabase, or
// Vault access. They enforce that:
//
//   1. embedding-provider.ts remains transport-only (no env / Supabase /
//      Vault / Tenant / Organization reads).
//   2. No active Edge Function reads the Global `OPENAI_API_KEY`.
//   3. Smoke uses one request-ID variable for its whole invocation.
//   4. Reindex uses `resolveActiveOrganizationId` and enforces job
//      Organization containment.
//   5. Chat/Trace/Smoke helpers accept `embeddingRuntime` and forward it
//      to Knowledge Pack builds.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../", __BTPM_SRC_BASE__); // supabase/functions/

async function read(rel: string): Promise<string> {
  return await Deno.readTextFile(new URL(rel, ROOT).pathname);
}

// ---------------------------------------------------------------------------
// 1. embedding-provider.ts is transport-only
// ---------------------------------------------------------------------------

Deno.test("static — embedding-provider.ts contains no Deno.env / Supabase / Vault / Tenant / Organization reads", async () => {
  const src = await read("_shared/ai-guide-v2/embedding-provider.ts");
  const banned = [
    "Deno.env.get",
    "@supabase/supabase-js",
    "createClient",
    "vault_",
    "tenant_integrations",
    "resolveTenantIntegrationSecretValue",
    "resolveActiveOrganizationId",
    "OPENAI_API_KEY",
    ".from(\"organizations",
    ".from('organizations",
  ];
  for (const b of banned) {
    assertEquals(src.includes(b), false, `embedding-provider.ts must not include: ${b}`);
  }
});

// ---------------------------------------------------------------------------
// 2. No active runtime read of Global OPENAI_API_KEY
// ---------------------------------------------------------------------------

async function walk(dir: URL, out: string[] = []): Promise<string[]> {
  for await (const entry of Deno.readDir(dir)) {
    const child = new URL(`${dir.pathname.endsWith("/") ? dir.pathname : dir.pathname + "/"}${entry.name}`, "file://");
    if (entry.isDirectory) {
      await walk(new URL(`${child.pathname}/`, "file://"), out);
    } else if (entry.isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      out.push(child.pathname);
    }
  }
  return out;
}

Deno.test("static — no active edge function reads Deno.env.get(\"OPENAI_API_KEY\")", async () => {
  const files = await walk(new URL(".", ROOT));
  const offenders: string[] = [];
  for (const f of files) {
    if (f.endsWith("_test.ts") || f.endsWith(".test.ts")) continue;
    const src = await Deno.readTextFile(f);
    // Explicit env read for the Global OpenAI key.
    if (/Deno\.env\.get\(\s*["']OPENAI_API_KEY["']\s*\)/.test(src)) {
      offenders.push(f);
    }
  }
  assertEquals(offenders, [], `Global OPENAI_API_KEY env reader(s) remaining: ${offenders.join(", ")}`);
});

// ---------------------------------------------------------------------------
// 3. Smoke: single request-ID variable per invocation
// ---------------------------------------------------------------------------

Deno.test("static — ai-guide-v2-smoke has exactly one crypto.randomUUID() call", async () => {
  const src = await read("ai-guide-v2-smoke/index.ts");
  const count = (src.match(/crypto\.randomUUID\(\)/g) || []).length;
  assertEquals(count, 1, `expected exactly one crypto.randomUUID() in Smoke, found ${count}`);
});

Deno.test("static — Smoke helpers accept requestId in their args", async () => {
  const src = await read("ai-guide-v2-smoke/index.ts");
  // Every helper args block that carries embeddingRuntime must also carry requestId.
  const argsBlocks = src.match(/embeddingRuntime:\s*GuideEmbeddingProviderRuntimeConfig \| null;\s*\n\s*requestId:\s*string;/g) || [];
  assert(argsBlocks.length >= 5, `expected >=5 helper arg blocks with requestId; found ${argsBlocks.length}`);
});

// ---------------------------------------------------------------------------
// 4. Reindex uses active-Org context and containment
// ---------------------------------------------------------------------------

Deno.test("static — ai-guide-v2-reindex uses resolveActiveOrganizationId and enforces containment", async () => {
  const src = await read("ai-guide-v2-reindex/index.ts");
  assert(src.includes("resolveActiveOrganizationId"), "reindex must call resolveActiveOrganizationId");
  // Historical comments may still mention the term; forbid only active reads.
  assert(!/\.from\(["']profiles["']\)[\s\S]*organization_id/.test(src), "reindex must not read profiles.organization_id");
  // Some containment guard on job Organization.
  assert(
    /organization_id\s*!==\s*/.test(src) || /organization_id\s*!=\s*/.test(src) || /containment/i.test(src),
    "reindex must enforce Organization containment on the job",
  );
});

// ---------------------------------------------------------------------------
// 5. Chat / Trace / Smoke forward embeddingRuntime to KP builds
// ---------------------------------------------------------------------------

const KP_CONSUMERS = [
  "ai-guide-v2-chat/index.ts",
  "ai-guide-v2-trace/index.ts",
  "ai-guide-v2-smoke/index.ts",
];

Deno.test("static — chat/trace/smoke pass embeddingRuntime to buildGuideV2KnowledgePack", async () => {
  for (const rel of KP_CONSUMERS) {
    const src = await read(rel);
    if (!src.includes("buildGuideV2KnowledgePack")) continue;
    assert(
      src.includes("embeddingRuntime"),
      `${rel} calls buildGuideV2KnowledgePack but never passes embeddingRuntime`,
    );
  }
});

Deno.test("static — knowledge-pack.ts accepts embeddingRuntime in its input", async () => {
  const src = await read("_shared/ai-guide-v2/knowledge-pack.ts");
  assert(src.includes("embeddingRuntime"), "knowledge-pack.ts must reference embeddingRuntime");
});

Deno.test("static — effective-pipeline.ts accepts embeddingRuntime in its input", async () => {
  const src = await read("_shared/ai-guide-v2/effective-pipeline.ts");
  assert(src.includes("embeddingRuntime"), "effective-pipeline.ts must reference embeddingRuntime");
});
