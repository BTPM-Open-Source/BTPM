// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/microsoft-graph-runtime-cutover-4d14a6b_static_test.ts', import.meta.url).href;
// Phase 4D.14A.6B — Static contract tests for the Microsoft Graph
// Tenant runtime cutover on the four evidence-read Edge Functions.
//
// These tests do NOT hit Microsoft Graph, OpenAI, Supabase, or Vault.
// They read the migrated function sources as text and assert that no
// active `M365_*` runtime reads or Global Graph fallbacks remain, and
// that each migrated caller uses the canonical Tenant runtime and the
// transport-only shared helpers.

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const files = [
  "generate-decision-case-ai-brief/index.ts",
  "test-openai-decision-evidence-summary/index.ts",
  "generate-decision-case-data-package-bundle/index.ts",
  "generate-roadmap-story/index.ts",
] as const;

async function readFn(name: string): Promise<string> {
  const url = new URL(`../${name}`, __BTPM_SRC_BASE__);
  return await Deno.readTextFile(url);
}

function stripLineComments(src: string): string {
  // Very small stripper: removes `// ...` line comments and /* */ blocks
  // so tests reason about ACTIVE code only.
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlock.split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}

Deno.test("no active M365_TENANT_ID / M365_CLIENT_ID / M365_CLIENT_SECRET reads", async () => {
  for (const f of files) {
    const code = stripLineComments(await readFn(f));
    assertFalse(
      /Deno\.env\.get\(\s*["']M365_TENANT_ID["']\s*\)/.test(code),
      `${f} still reads M365_TENANT_ID`,
    );
    assertFalse(
      /Deno\.env\.get\(\s*["']M365_CLIENT_ID["']\s*\)/.test(code),
      `${f} still reads M365_CLIENT_ID`,
    );
    assertFalse(
      /Deno\.env\.get\(\s*["']M365_CLIENT_SECRET["']\s*\)/.test(code),
      `${f} still reads M365_CLIENT_SECRET`,
    );
  }
});

Deno.test("no local getGraphToken() and no direct login.microsoftonline.com token endpoint call", async () => {
  for (const f of files) {
    const code = stripLineComments(await readFn(f));
    assertFalse(
      /function\s+getGraphToken\s*\(/.test(code),
      `${f} still defines a local getGraphToken()`,
    );
    assertFalse(
      /login\.microsoftonline\.com/.test(code),
      `${f} still calls login.microsoftonline.com directly`,
    );
    // No direct v1.0 token fetches remaining
    assertFalse(
      /oauth2\/v2\.0\/token/.test(code),
      `${f} still constructs an OAuth2 token URL directly`,
    );
  }
});

Deno.test("each migrated function imports the canonical Tenant Graph runtime bootstrap", async () => {
  for (const f of files) {
    const code = await readFn(f);
    assert(
      code.includes("resolveAndAcquireTenantMicrosoftGraph"),
      `${f} must use resolveAndAcquireTenantMicrosoftGraph`,
    );
  }
});

Deno.test("each migrated function uses the transport-only download helper (not zero-arg getGraphToken)", async () => {
  const usesTransport = [
    "generate-decision-case-ai-brief/index.ts",
    "test-openai-decision-evidence-summary/index.ts",
    "generate-decision-case-data-package-bundle/index.ts",
  ];
  for (const f of usesTransport) {
    const code = await readFn(f);
    assert(
      code.includes("downloadMicrosoftGraphDriveItemBytes"),
      `${f} must use downloadMicrosoftGraphDriveItemBytes`,
    );
  }
  const roadmap = await readFn("generate-roadmap-story/index.ts");
  assertFalse(
    /from\s+["'][^"']*graph-client\.ts["']/.test(roadmap),
    "generate-roadmap-story must not import getGraphToken from graph-client.ts",
  );
});

Deno.test("no profiles.organization_id resolution in migrated paths", async () => {
  for (const f of files) {
    const code = await readFn(f);
    assertFalse(
      /profiles.*organization_id/.test(code),
      `${f} must not resolve org via profiles.organization_id`,
    );
  }
});

Deno.test("shared graph-client.ts contains no Global M365_* reads and no zero-arg token acquisition", async () => {
  const url = new URL("../_shared/graph-client.ts", __BTPM_SRC_BASE__);
  const raw = await Deno.readTextFile(url);
  const code = stripLineComments(raw);
  assertFalse(/Deno\.env\.get\(\s*["']M365_/.test(code));
  assertFalse(/login\.microsoftonline\.com/.test(code));
  assertFalse(/oauth2\/v2\.0\/token/.test(code));
  // The compatibility wrapper must not expose a zero-argument
  // getGraphToken export.
  assertFalse(
    /export\s+async\s+function\s+getGraphToken\s*\(\s*\)/.test(code),
    "graph-client.ts must not export getGraphToken()",
  );
});

Deno.test("resolveAndAcquireTenantMicrosoftGraph is only invoked when files exist (grep sanity)", async () => {
  // Best-effort static check: the call site sits inside an
  // `includedFiles.length > 0` / `needsGraph` / `includedEvidenceFiles.length > 0`
  // conditional. Confirm each file's call site occurs on the same
  // conditional as SharePoint-file presence.
  const briefCode = await readFn("generate-decision-case-ai-brief/index.ts");
  assert(briefCode.includes("needsGraph"), "brief must conditionally resolve Graph");
  const diagCode = await readFn("test-openai-decision-evidence-summary/index.ts");
  assert(diagCode.includes("needsGraph"), "diagnostic must conditionally resolve Graph");
  const bundleCode = await readFn("generate-decision-case-data-package-bundle/index.ts");
  assert(
    bundleCode.includes("includedEvidenceFiles.length > 0"),
    "bundle must conditionally resolve Graph",
  );
  const storyCode = await readFn("generate-roadmap-story/index.ts");
  assert(
    storyCode.includes("includedFiles.length > 0"),
    "story must conditionally resolve Graph",
  );
});

Deno.test("brief cutover: Graph resolution occurs before ai run insert and OpenAI call", async () => {
  const code = await readFn("generate-decision-case-ai-brief/index.ts");
  const idxGraph = code.indexOf("resolveAndAcquireTenantMicrosoftGraph");
  const idxRunInsert = code.indexOf("decision_case_ai_runs");
  const idxOpenAiCall = code.indexOf("api.openai.com");
  assert(idxGraph > -1 && idxRunInsert > -1);
  assert(
    idxGraph < idxRunInsert,
    "Graph resolution must precede decision_case_ai_runs insert",
  );
  if (idxOpenAiCall > -1) {
    assert(idxGraph < idxOpenAiCall, "Graph resolution must precede OpenAI call");
  }
});

Deno.test("bundle cutover: Graph resolution occurs before ZIP construction", async () => {
  const code = await readFn("generate-decision-case-data-package-bundle/index.ts");
  const idxGraph = code.indexOf("resolveAndAcquireTenantMicrosoftGraph");
  const idxZip = code.indexOf("zipSync(");
  assert(idxGraph > -1, "bundle must resolve Graph runtime");
  if (idxZip > -1) {
    assert(idxGraph < idxZip, "Graph resolution must precede zipSync()");
  }
});

Deno.test("story cutover: Graph resolution occurs before AI-run start + OpenAI enqueue", async () => {
  const code = await readFn("generate-roadmap-story/index.ts");
  const idxGraph = code.indexOf("resolveAndAcquireTenantMicrosoftGraph");
  const idxRun = code.indexOf("start_roadmap_story_generation_run");
  const idxEnq = code.indexOf("enqueueOpenAIResponse");
  assert(idxGraph > -1);
  assert(idxRun > -1 && idxGraph < idxRun);
  assert(idxEnq > -1 && idxGraph < idxEnq);
});
