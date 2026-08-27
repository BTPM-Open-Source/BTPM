// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/tenant-ai-text-runtime-4d14a8c1_static_test.ts', import.meta.url).href;
// Phase 4D.14A.8C.1 — Static contract tests for the canonical Tenant AI
// text-runtime resolver. These tests pin the on-disk contract and prove:
//   - the resolver exposes the required result shape and pure classifiers
//   - OpenAI resolution wires bearer + api.openai.com/v1
//   - Azure resolution requires a mapped deployment
//   - no selected provider fails closed
//   - no Global env fallback is read
//   - no production Edge Function imports the new resolver yet

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  classifyActiveProviderLookup,
  classifyAzureDeploymentMapping,
  toSafeTenantAiTextRuntimePublicError,
  TenantAiTextRuntimeError,
} from "../../functions/_shared/tenantAiTextRuntime.ts";

const REPO_ROOT = new URL("../../../", __BTPM_SRC_BASE__);

async function read(rel: string): Promise<string> {
  return await Deno.readTextFile(new URL(rel, REPO_ROOT));
}

async function findMigration(marker: RegExp): Promise<string> {
  const dir = new URL("supabase/migrations/", REPO_ROOT);
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !e.name.endsWith(".sql")) continue;
    const body = await Deno.readTextFile(new URL(e.name, dir));
    if (marker.test(body)) return body;
  }
  throw new Error(`no migration matched ${marker}`);
}

Deno.test("resolver source declares canonical result contract", async () => {
  const src = await read("supabase/functions/_shared/tenantAiTextRuntime.ts");
  assertStringIncludes(src, "export interface TenantAiTextRuntime");
  for (
    const field of [
      "provider:",
      "canonicalModel:",
      "providerModel:",
      "baseUrl:",
      "apiKey:",
      "authMode:",
    ]
  ) {
    assertStringIncludes(src, field);
  }
  // OpenAI base URL is pinned to the public API root.
  assertStringIncludes(src, 'const OPENAI_BASE_URL = "https://api.openai.com/v1"');
  // Bearer for OpenAI, api_key for Azure.
  assertStringIncludes(src, 'authMode: "bearer"');
  assertStringIncludes(src, 'authMode: "api_key"');
});

Deno.test("active provider classifier fails closed when no provider selected", () => {
  const nullRow = classifyActiveProviderLookup(null, { active_provider: null });
  assert(!nullRow.ok);
  if (!nullRow.ok) assertEquals(nullRow.code, "ai_provider_not_selected");

  const missing = classifyActiveProviderLookup(null, null);
  assert(!missing.ok);
  if (!missing.ok) assertEquals(missing.code, "ai_provider_not_selected");

  const infra = classifyActiveProviderLookup(new Error("db down"), null);
  assert(!infra.ok);
  if (!infra.ok) {
    assertEquals(infra.code, "ai_provider_configuration_unavailable");
  }

  const openai = classifyActiveProviderLookup(null, {
    active_provider: "openai",
  });
  assert(openai.ok);
  if (openai.ok) assertEquals(openai.provider, "openai");

  const azure = classifyActiveProviderLookup(null, {
    active_provider: "azure_openai",
  });
  assert(azure.ok);
  if (azure.ok) assertEquals(azure.provider, "azure_openai");
});

Deno.test("Azure deployment mapping classifier requires a valid mapped name", () => {
  // Missing entirely.
  const noMeta = classifyAzureDeploymentMapping(null, "gpt-5.4");
  assert(!noMeta.ok);

  const noMap = classifyAzureDeploymentMapping({}, "gpt-5.4");
  assert(!noMap.ok);

  const wrongType = classifyAzureDeploymentMapping(
    { azure_deployments: { "gpt-5.4": 42 } },
    "gpt-5.4",
  );
  assert(!wrongType.ok);

  const emptyString = classifyAzureDeploymentMapping(
    { azure_deployments: { "gpt-5.4": "   " } },
    "gpt-5.4",
  );
  assert(!emptyString.ok);

  const badChars = classifyAzureDeploymentMapping(
    { azure_deployments: { "gpt-5.4": "bad/name" } },
    "gpt-5.4",
  );
  assert(!badChars.ok);

  const ok = classifyAzureDeploymentMapping(
    { azure_deployments: { "gpt-5.4": "my-gpt54-deployment" } },
    "gpt-5.4",
  );
  assert(ok.ok);
  if (ok.ok) assertEquals(ok.deployment, "my-gpt54-deployment");

  // Empty canonical model is rejected.
  const noModel = classifyAzureDeploymentMapping(
    { azure_deployments: { "gpt-5.4": "x" } },
    "",
  );
  assert(!noModel.ok);
});

Deno.test("safe public error mapper never leaks internals", () => {
  const notSelected = toSafeTenantAiTextRuntimePublicError(
    new TenantAiTextRuntimeError(
      "ai_provider_not_selected",
      "internal detail",
    ),
  );
  assertEquals(notSelected.error, "ai_provider_not_selected");

  const missing = toSafeTenantAiTextRuntimePublicError(
    new TenantAiTextRuntimeError("ai_model_mapping_missing", "internal"),
  );
  assertEquals(missing.error, "ai_model_mapping_missing");

  const unavailable = toSafeTenantAiTextRuntimePublicError(
    new TenantAiTextRuntimeError(
      "ai_provider_configuration_unavailable",
      "internal",
    ),
  );
  assertEquals(unavailable.error, "ai_provider_configuration_unavailable");

  const unknown = toSafeTenantAiTextRuntimePublicError(new Error("boom"));
  assertEquals(unknown.error, "ai_provider_configuration_unavailable");
});

Deno.test("resolver never reads Global AI env or profiles.organization_id", async () => {
  const src = await read("supabase/functions/_shared/tenantAiTextRuntime.ts");
  for (
    const forbidden of [
      "AI_PROVIDER",
      "AI_EMBEDDING_PROVIDER",
      "AZURE_OPENAI_ENDPOINT",
      "AZURE_OPENAI_DEPLOYMENT",
      "AZURE_OPENAI_API_KEY",
      "AZURE_OPENAI_API_VERSION",
      "OPENAI_API_KEY",
      "profiles.organization_id",
    ]
  ) {
    assert(
      !src.includes(forbidden),
      `resolver must not reference ${forbidden}`,
    );
  }
  // Provider selection comes from the Tenant setting.
  assertStringIncludes(src, "tenant_ai_provider_settings");
  assertStringIncludes(src, "active_provider");
});

Deno.test("only the approved production Edge Functions import the 8C.1 runtime resolver", async () => {
  const ALLOWED = new Set([
    "generate-roadmap-story",
    "poll-roadmap-story",
    "generate-roadmap-story-presentation",
    "poll-roadmap-story-presentation",
    "generate-decision-case-ai-brief",
    "poll-decision-case-ai-brief",
    "test-openai-decision-evidence-summary",
  ]);
  const fnRoot = new URL("supabase/functions/", REPO_ROOT);
  const offenders: string[] = [];
  async function walk(dir: URL, functionName: string | null) {
    for await (const e of Deno.readDir(dir)) {
      // Skip the _shared folder — the resolver lives there and only its
      // own dedicated tests/helpers may import it.
      if (e.isDirectory) {
        if (e.name === "_shared") continue;
        await walk(new URL(e.name + "/", dir), functionName ?? e.name);
        continue;
      }
      if (!e.name.endsWith(".ts")) continue;
      const body = await Deno.readTextFile(new URL(e.name, dir));
      if (body.includes("tenantAiTextRuntime")) {
        if (!functionName || !ALLOWED.has(functionName)) {
          offenders.push(dir.pathname + e.name);
        }
      }
    }
  }
  await walk(fnRoot, null);
  assertEquals(
    offenders,
    [],
    `only ${[...ALLOWED].join(", ")} may import tenantAiTextRuntime: ${
      offenders.join(", ")
    }`,
  );
});

Deno.test("Azure deployment validator is STABLE (not IMMUTABLE) in latest migration", async () => {
  const dir = new URL("supabase/migrations/", REPO_ROOT);
  const matches: { name: string; body: string }[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !e.name.endsWith(".sql")) continue;
    const body = await Deno.readTextFile(new URL(e.name, dir));
    if (/FUNCTION public\._validate_azure_openai_deployments/.test(body)) {
      matches.push({ name: e.name, body });
    }
  }
  assert(matches.length > 0, "expected at least one validator migration");
  matches.sort((a, b) => (a.name < b.name ? -1 : 1));
  const latest = matches[matches.length - 1];
  const idx = latest.body.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public._validate_azure_openai_deployments",
  );
  const tail = latest.body.slice(idx, idx + 400);
  assertStringIncludes(tail, "STABLE");
  assert(
    !/\bIMMUTABLE\b/.test(tail),
    `latest validator must not be IMMUTABLE (in ${latest.name})`,
  );
});

// ---------------------------------------------------------------------------
// 4D.14A.8D.2A — Pinned-provider resolver contract
// ---------------------------------------------------------------------------

Deno.test("pinned resolver exists and accepts only openai/azure_openai", async () => {
  const src = await read("supabase/functions/_shared/tenantAiTextRuntime.ts");
  assertStringIncludes(
    src,
    "export async function resolveTenantAiTextRuntimeForProvider",
  );
  assertStringIncludes(src, "ResolveTenantAiTextRuntimeForProviderArgs");
  // Rejects any provider that is not one of the two accepted values.
  assertStringIncludes(
    src,
    'args?.provider !== "openai" && args?.provider !== "azure_openai"',
  );
});

Deno.test("pinned resolver does not read tenant_ai_provider_settings", async () => {
  const src = await read("supabase/functions/_shared/tenantAiTextRuntime.ts");
  const pinnedStart = src.indexOf(
    "export async function resolveTenantAiTextRuntimeForProvider",
  );
  assert(pinnedStart > 0, "pinned resolver must exist");
  // The pinned function body ends at the next top-level `async function` or
  // `export`. Slice to the next declaration so we only inspect the pinned body.
  const rest = src.slice(pinnedStart);
  const bodyEnd = rest.indexOf("\nasync function ");
  const pinnedBody = bodyEnd > 0 ? rest.slice(0, bodyEnd) : rest;
  assert(
    !pinnedBody.includes("tenant_ai_provider_settings"),
    "pinned resolver must not read the active-provider table",
  );
  assert(
    !pinnedBody.includes("classifyActiveProviderLookup"),
    "pinned resolver must not consult the active-provider classifier",
  );
  // But it must still resolve through the shared branch helper.
  assertStringIncludes(pinnedBody, "resolveForProvider");
});

Deno.test("existing active-provider resolver remains unchanged in shape", async () => {
  const src = await read("supabase/functions/_shared/tenantAiTextRuntime.ts");
  const activeStart = src.indexOf(
    "export async function resolveTenantAiTextRuntime(",
  );
  assert(activeStart > 0);
  const activeBody = src.slice(activeStart, activeStart + 2000);
  // Still reads active provider selection + still delegates via the shared
  // helper (no duplicated OpenAI/Azure branch logic).
  assertStringIncludes(activeBody, "tenant_ai_provider_settings");
  assertStringIncludes(activeBody, "classifyActiveProviderLookup");
  assertStringIncludes(activeBody, "resolveForProvider");
});

Deno.test("OpenAI/Azure branch logic is not duplicated", async () => {
  const src = await read("supabase/functions/_shared/tenantAiTextRuntime.ts");
  // The `if (provider === "openai")` branch must appear exactly once (in the
  // shared internal helper), proving the pinned and active paths share it.
  const matches = src.match(/if \(provider === "openai"\)/g) ?? [];
  assertEquals(matches.length, 1);
});

