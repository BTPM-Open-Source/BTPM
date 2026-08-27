// Phase 4D.14A.8C.3 — Embedding transport tests.
// The transport now consumes the canonical Tenant AI runtime shape
// (baseUrl + providerModel + authMode) for both OpenAI and Azure OpenAI.

import { assertEquals, assertStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { embedGuideV2Texts } from "../../../functions/_shared/ai-guide-v2/embedding-provider.ts";
import type { GuideEmbeddingProviderRuntimeConfig } from "../../../functions/_shared/guideEmbeddingProviderRuntime.ts";

const originalFetch = globalThis.fetch;

function makeVec(fill: number): number[] {
  return new Array(1536).fill(fill);
}
function okBody(count: number) {
  return {
    data: Array.from({ length: count }, (_, i) => ({ embedding: makeVec(i + 1), index: i })),
  };
}

async function withMockedFetch<T>(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return await handler(url, init ?? {});
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const openaiRuntime: GuideEmbeddingProviderRuntimeConfig = {
  provider: "openai",
  canonicalModel: "text-embedding-3-small",
  providerModel: "text-embedding-3-small",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "TEST-OPENAI-KEY",
  authMode: "bearer",
  dimensions: 1536,
};
const azureRuntime: GuideEmbeddingProviderRuntimeConfig = {
  provider: "azure_openai",
  canonicalModel: "text-embedding-3-small",
  providerModel: "azure-emb-deploy",
  baseUrl: "https://acme.openai.azure.com/openai/v1",
  apiKey: "TEST-AZURE-KEY",
  authMode: "api_key",
  dimensions: 1536,
};

Deno.test("transport — OpenAI: bearer auth, canonical embeddings URL, canonical body", async () => {
  let capturedUrl = "";
  let capturedAuth = "";
  let capturedApiKeyHdr = "";
  let capturedBody: Record<string, unknown> = {};
  const res = await withMockedFetch(
    (url, init) => {
      capturedUrl = url;
      const h = init.headers as Record<string, string>;
      capturedAuth = String(h["authorization"] ?? "");
      capturedApiKeyHdr = String(h["api-key"] ?? "");
      capturedBody = JSON.parse(String(init.body ?? "{}"));
      return new Response(JSON.stringify(okBody(2)), { status: 200 });
    },
    () => embedGuideV2Texts({
      texts: ["a", "b"],
      modelLabel: "text-embedding-3-small@1536",
      dimensions: 1536,
      requestId: "req-1",
      runtime: openaiRuntime,
    }),
  );
  assertEquals(res.ok, true);
  assertEquals(capturedUrl, "https://api.openai.com/v1/embeddings");
  assertEquals(capturedAuth, "Bearer TEST-OPENAI-KEY");
  assertEquals(capturedApiKeyHdr, "");
  assertEquals(capturedBody.model, "text-embedding-3-small");
  assertEquals(Array.isArray(capturedBody.input), true);
  assertStrictEquals(capturedBody.dimensions, 1536);
  // Result surfaces canonical model only.
  assertEquals(res.model, "text-embedding-3-small");
  assertEquals(res.provider, "openai");
});

Deno.test("transport — Azure: api-key auth, same URL shape, Azure deployment as body model", async () => {
  let capturedUrl = "";
  let capturedAuth = "";
  let capturedApiKeyHdr = "";
  let capturedBody: Record<string, unknown> = {};
  const res = await withMockedFetch(
    (url, init) => {
      capturedUrl = url;
      const h = init.headers as Record<string, string>;
      capturedAuth = String(h["authorization"] ?? "");
      capturedApiKeyHdr = String(h["api-key"] ?? "");
      capturedBody = JSON.parse(String(init.body ?? "{}"));
      return new Response(JSON.stringify(okBody(1)), { status: 200 });
    },
    () => embedGuideV2Texts({
      texts: ["x"],
      modelLabel: "text-embedding-3-small@1536",
      dimensions: 1536,
      requestId: "req-1",
      runtime: azureRuntime,
    }),
  );
  assertEquals(res.ok, true);
  assertEquals(capturedUrl, "https://acme.openai.azure.com/openai/v1/embeddings");
  assertEquals(capturedApiKeyHdr, "TEST-AZURE-KEY");
  assertEquals(capturedAuth, "");
  assertEquals(capturedBody.model, "azure-emb-deploy");
  assertStrictEquals(capturedBody.dimensions, 1536);
  assertEquals(Array.isArray(capturedBody.input), true);
  // Result surfaces canonical model only — never the Azure deployment name.
  assertEquals(res.model, "text-embedding-3-small");
  assertEquals(res.provider, "azure_openai");
});

Deno.test("transport — batch over 128 rejected without fetch", async () => {
  let called = false;
  const res = await withMockedFetch(
    () => { called = true; return new Response("{}", { status: 200 }); },
    () => embedGuideV2Texts({
      texts: new Array(129).fill("x"),
      modelLabel: "text-embedding-3-small@1536",
      dimensions: 1536,
      requestId: "r",
      runtime: openaiRuntime,
    }),
  );
  assertEquals(res.ok, false);
  assertEquals(called, false);
  assertEquals(res.error?.code, "batch_too_large");
});

Deno.test("transport — wrong vector length fails safely", async () => {
  const res = await withMockedFetch(
    () => new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3], index: 0 }] }), { status: 200 }),
    () => embedGuideV2Texts({
      texts: ["a"], modelLabel: "l", dimensions: 1536, requestId: "r", runtime: openaiRuntime,
    }),
  );
  assertEquals(res.ok, false);
  assertEquals(res.error?.code, "dimension_mismatch");
});

Deno.test("transport — network error returns fixed safe internal code", async () => {
  const res = await withMockedFetch(
    () => { throw new Error("boom"); },
    () => embedGuideV2Texts({
      texts: ["a"], modelLabel: "l", dimensions: 1536, requestId: "r", runtime: openaiRuntime,
    }),
  );
  assertEquals(res.ok, false);
  assertEquals(res.error?.code, "network_error");
});

Deno.test("transport — malformed provider response fails safely", async () => {
  const res = await withMockedFetch(
    () => new Response("not-json", { status: 200 }),
    () => embedGuideV2Texts({
      texts: ["a"], modelLabel: "l", dimensions: 1536, requestId: "r", runtime: openaiRuntime,
    }),
  );
  assertEquals(res.ok, false);
  assertEquals(res.error?.code, "invalid_response");
});

Deno.test("transport — HTTP 401 maps to auth_failed and does NOT include raw body or deployment", async () => {
  const res = await withMockedFetch(
    () => new Response(JSON.stringify({ error: { message: "TEST-AZURE-KEY leaked azure-emb-deploy" } }), { status: 401 }),
    () => embedGuideV2Texts({
      texts: ["a"], modelLabel: "l", dimensions: 1536, requestId: "r", runtime: azureRuntime,
    }),
  );
  assertEquals(res.ok, false);
  assertEquals(res.error?.code, "auth_failed");
  const blob = JSON.stringify(res);
  assertEquals(blob.includes("TEST-AZURE-KEY"), false);
  assertEquals(blob.includes("azure-emb-deploy"), false);
  assertEquals(blob.includes("leaked"), false);
});

Deno.test("transport — runtime missing rejected without fetch", async () => {
  let called = false;
  const res = await withMockedFetch(
    () => { called = true; return new Response("{}", { status: 200 }); },
    () => embedGuideV2Texts({
      texts: ["a"], modelLabel: "l", dimensions: 1536, requestId: "r",
      // deno-lint-ignore no-explicit-any
      runtime: undefined as any,
    }),
  );
  assertEquals(res.ok, false);
  assertEquals(called, false);
  assertEquals(res.error?.code, "runtime_missing");
});
