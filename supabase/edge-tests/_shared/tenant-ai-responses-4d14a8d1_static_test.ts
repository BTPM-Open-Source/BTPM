// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/tenant-ai-responses-4d14a8d1_static_test.ts', import.meta.url).href;
// Phase 4D.14A.8D.1 — Static + mocked-fetch contract tests for the
// canonical Tenant AI Responses API transport.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  enqueueTenantAiResponse,
  executeTenantAiResponse,
  getTenantAiResponseStatus,
} from "../../functions/_shared/tenantAiResponsesClient.ts";
import type { TenantAiTextRuntime } from "../../functions/_shared/tenantAiTextRuntime.ts";

const REPO_ROOT = new URL("../../../", __BTPM_SRC_BASE__);

const OPENAI_RUNTIME: TenantAiTextRuntime = {
  provider: "openai",
  canonicalModel: "gpt-5.4",
  providerModel: "gpt-5.4",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-openai-key",
  authMode: "bearer",
};

const AZURE_RUNTIME: TenantAiTextRuntime = {
  provider: "azure_openai",
  canonicalModel: "gpt-5.4",
  providerModel: "my-gpt54-deployment",
  baseUrl: "https://acme.openai.azure.com/openai/v1",
  apiKey: "azure-key",
  authMode: "api_key",
};

function mockFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    return Promise.resolve(handler(url, init ?? {}));
  }) as unknown as typeof fetch;
}

function throwFetch(name: string): typeof fetch {
  return ((_url: string, _init?: RequestInit) => {
    const e = new Error("mock");
    (e as { name?: string }).name = name;
    return Promise.reject(e);
  }) as unknown as typeof fetch;
}

Deno.test("enqueue: OpenAI uses bearer + forces model/background/store", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: Record<string, unknown> = {};
  const fetchImpl = mockFetch((url, init) => {
    capturedUrl = url;
    capturedHeaders = (init.headers as Record<string, string>) ?? {};
    capturedBody = JSON.parse((init.body as string) ?? "{}");
    return new Response(
      JSON.stringify({ id: "resp_123", status: "queued" }),
      { status: 200 },
    );
  });
  const r = await enqueueTenantAiResponse({
    runtime: OPENAI_RUNTIME,
    payload: {
      input: "hi",
      model: "attacker-model",
      background: false,
      store: false,
    },
    fetchImpl,
  });
  assert(r.ok);
  assertEquals(capturedUrl, "https://api.openai.com/v1/responses");
  assertEquals(capturedHeaders["Authorization"], "Bearer sk-openai-key");
  assert(!("api-key" in capturedHeaders));
  assertEquals(capturedBody.model, "gpt-5.4");
  assertEquals(capturedBody.background, true);
  assertEquals(capturedBody.store, true);
  assertEquals(capturedBody.input, "hi");
  if (r.ok) {
    assertEquals(r.responseId, "resp_123");
    assertEquals(r.state, "queued");
    assertEquals(r.provider, "openai");
    assertEquals(r.canonicalModel, "gpt-5.4");
  }
});

Deno.test("enqueue: Azure uses api-key + provider deployment", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: Record<string, unknown> = {};
  const fetchImpl = mockFetch((url, init) => {
    capturedUrl = url;
    capturedHeaders = (init.headers as Record<string, string>) ?? {};
    capturedBody = JSON.parse((init.body as string) ?? "{}");
    return new Response(
      JSON.stringify({ id: "resp_abc", status: "in_progress" }),
      { status: 200 },
    );
  });
  const r = await enqueueTenantAiResponse({
    runtime: AZURE_RUNTIME,
    payload: { input: "hi" },
    fetchImpl,
  });
  assert(r.ok);
  assertEquals(
    capturedUrl,
    "https://acme.openai.azure.com/openai/v1/responses",
  );
  assertEquals(capturedHeaders["api-key"], "azure-key");
  assert(!("Authorization" in capturedHeaders));
  assertEquals(capturedBody.model, "my-gpt54-deployment");
  assertEquals(capturedBody.background, true);
  assertEquals(capturedBody.store, true);
  if (r.ok) {
    assertEquals(r.state, "in_progress");
    assertEquals(r.provider, "azure_openai");
  }
});

Deno.test("polling: GET URL encodes response id and uses runtime auth", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  const fetchImpl = mockFetch((url, init) => {
    capturedUrl = url;
    capturedHeaders = (init.headers as Record<string, string>) ?? {};
    return new Response(
      JSON.stringify({
        id: "resp/weird id",
        status: "completed",
        model: "provider-model-name",
        output_text: "done",
      }),
      { status: 200 },
    );
  });
  const r = await getTenantAiResponseStatus({
    runtime: AZURE_RUNTIME,
    responseId: "resp/weird id",
    fetchImpl,
  });
  assert(r.ok);
  assertEquals(
    capturedUrl,
    "https://acme.openai.azure.com/openai/v1/responses/resp%2Fweird%20id",
  );
  assertEquals(capturedHeaders["api-key"], "azure-key");
  if (r.ok) {
    assertEquals(r.state, "completed");
    assert(r.body !== null);
    // provider model must be stripped from returned body
    assert(!("model" in (r.body ?? {})));
    assertEquals((r.body as Record<string, unknown>).output_text, "done");
  }
});

Deno.test("polling: non-completed states return null body", async () => {
  const fetchImpl = mockFetch(() =>
    new Response(
      JSON.stringify({ id: "resp_1", status: "in_progress", model: "x" }),
      { status: 200 },
    )
  );
  const r = await getTenantAiResponseStatus({
    runtime: OPENAI_RUNTIME,
    responseId: "resp_1",
    fetchImpl,
  });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.state, "in_progress");
    assertEquals(r.body, null);
  }
});

Deno.test("polling: unknown status normalizes to 'unknown'", async () => {
  const fetchImpl = mockFetch(() =>
    new Response(
      JSON.stringify({ id: "resp_1", status: "weird_new_state" }),
      { status: 200 },
    )
  );
  const r = await getTenantAiResponseStatus({
    runtime: OPENAI_RUNTIME,
    responseId: "resp_1",
    fetchImpl,
  });
  assert(r.ok);
  if (r.ok) assertEquals(r.state, "unknown");
});

Deno.test("failure HTTP statuses map to safe categories (enqueue)", async () => {
  for (
    const [status, cat] of [
      [401, "credential_rejected"],
      [403, "permission_denied"],
      [404, "endpoint_not_found"],
      [429, "rate_limited"],
      [500, "service_unavailable"],
      [400, "request_rejected"],
    ] as const
  ) {
    const fetchImpl = mockFetch(() =>
      new Response(JSON.stringify({ error: { message: "hidden" } }), {
        status,
      })
    );
    const r = await enqueueTenantAiResponse({
      runtime: OPENAI_RUNTIME,
      payload: {},
      fetchImpl,
    });
    assert(!r.ok, `status ${status}`);
    if (!r.ok) {
      assertEquals(r.category, cat);
      assertEquals(r.httpStatus, status);
    }
  }
});

Deno.test("failure HTTP statuses map to safe categories (polling)", async () => {
  const fetchImpl = mockFetch(() =>
    new Response(JSON.stringify({ error: { message: "hidden" } }), {
      status: 429,
    })
  );
  const r = await getTenantAiResponseStatus({
    runtime: OPENAI_RUNTIME,
    responseId: "resp_1",
    fetchImpl,
  });
  assert(!r.ok);
  if (!r.ok) {
    assertEquals(r.category, "rate_limited");
    assertEquals(r.httpStatus, 429);
  }
});

Deno.test("transport throws classify as timeout / network_error", async () => {
  const to = await enqueueTenantAiResponse({
    runtime: OPENAI_RUNTIME,
    payload: {},
    fetchImpl: throwFetch("AbortError"),
  });
  assert(!to.ok);
  if (!to.ok) {
    assertEquals(to.category, "timeout");
    assertEquals(to.httpStatus, null);
  }
  const net = await getTenantAiResponseStatus({
    runtime: OPENAI_RUNTIME,
    responseId: "resp_1",
    fetchImpl: throwFetch("TypeError"),
  });
  assert(!net.ok);
  if (!net.ok) assertEquals(net.category, "network_error");
});

Deno.test("malformed / missing id → response_invalid", async () => {
  const badJson = await enqueueTenantAiResponse({
    runtime: OPENAI_RUNTIME,
    payload: {},
    fetchImpl: mockFetch(() => new Response("not-json", { status: 200 })),
  });
  assert(!badJson.ok);
  if (!badJson.ok) assertEquals(badJson.category, "response_invalid");

  const noId = await enqueueTenantAiResponse({
    runtime: OPENAI_RUNTIME,
    payload: {},
    fetchImpl: mockFetch(() =>
      new Response(JSON.stringify({ status: "queued" }), { status: 200 })
    ),
  });
  assert(!noId.ok);
  if (!noId.ok) assertEquals(noId.category, "response_invalid");

  const arr = await enqueueTenantAiResponse({
    runtime: OPENAI_RUNTIME,
    payload: {},
    fetchImpl: mockFetch(() =>
      new Response(JSON.stringify([1, 2, 3]), { status: 200 })
    ),
  });
  assert(!arr.ok);
  if (!arr.ok) assertEquals(arr.category, "response_invalid");
});

Deno.test("only the approved production Edge Functions import the responses transport", async () => {
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
      if (e.isDirectory) {
        if (e.name === "_shared") continue;
        await walk(new URL(e.name + "/", dir), functionName ?? e.name);
        continue;
      }
      if (!e.name.endsWith(".ts")) continue;
      const body = await Deno.readTextFile(new URL(e.name, dir));
      if (body.includes("tenantAiResponsesClient")) {
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
    `only ${[...ALLOWED].join(", ")} may import tenantAiResponsesClient: ${
      offenders.join(", ")
    }`,
  );
});

Deno.test("transport source declares no Global env or Supabase reads", async () => {
  const src = await Deno.readTextFile(
    new URL(
      "supabase/functions/_shared/tenantAiResponsesClient.ts",
      REPO_ROOT,
    ),
  );
  for (
    const forbidden of [
      "Deno.env",
      "createClient",
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "OPENAI_API_KEY",
      "AZURE_OPENAI_API_KEY",
      "AZURE_OPENAI_ENDPOINT",
      "tenant_ai_provider_settings",
      "tenant_integrations",
    ]
  ) {
    assert(
      !src.includes(forbidden),
      `transport must not reference ${forbidden}`,
    );
  }
  assertStringIncludes(src, "/responses");
  assertStringIncludes(src, "runtime.providerModel");
  assertStringIncludes(src, "background: true");
  assertStringIncludes(src, "store: true");
  // 4D.14A.8D.4: synchronous transport forces background/store OFF.
  assertStringIncludes(src, "background: false");
  assertStringIncludes(src, "store: false");
});

// ---------------------------------------------------------------------------
// 4D.14A.8D.4 — Synchronous executeTenantAiResponse transport
// ---------------------------------------------------------------------------

Deno.test("execute: OpenAI forces model + background=false + store=false, strips overrides", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: Record<string, unknown> = {};
  const fetchImpl = mockFetch((url, init) => {
    capturedUrl = url;
    capturedHeaders = (init.headers as Record<string, string>) ?? {};
    capturedBody = JSON.parse((init.body as string) ?? "{}");
    return new Response(
      JSON.stringify({
        id: "resp_x",
        status: "completed",
        model: "provider-model-name",
        output_text: "hello",
      }),
      { status: 200 },
    );
  });
  const r = await executeTenantAiResponse({
    runtime: OPENAI_RUNTIME,
    payload: {
      input: "hi",
      model: "attacker-model",
      background: true,
      store: true,
    },
    fetchImpl,
  });
  assert(r.ok);
  assertEquals(capturedUrl, "https://api.openai.com/v1/responses");
  assertEquals(capturedHeaders["Authorization"], "Bearer sk-openai-key");
  assertEquals(capturedBody.model, "gpt-5.4");
  assertEquals(capturedBody.background, false);
  assertEquals(capturedBody.store, false);
  if (r.ok) {
    assertEquals(r.provider, "openai");
    assertEquals(r.canonicalModel, "gpt-5.4");
    // Top-level provider model must be stripped from returned body.
    assert(!("model" in r.body));
    assertEquals((r.body as Record<string, unknown>).output_text, "hello");
  }
});

Deno.test("execute: Azure uses api-key + provider deployment", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: Record<string, unknown> = {};
  const fetchImpl = mockFetch((url, init) => {
    capturedUrl = url;
    capturedHeaders = (init.headers as Record<string, string>) ?? {};
    capturedBody = JSON.parse((init.body as string) ?? "{}");
    return new Response(
      JSON.stringify({ id: "resp_a", status: "completed", output_text: "ok" }),
      { status: 200 },
    );
  });
  const r = await executeTenantAiResponse({
    runtime: AZURE_RUNTIME,
    payload: { input: "hi" },
    fetchImpl,
  });
  assert(r.ok);
  assertEquals(
    capturedUrl,
    "https://acme.openai.azure.com/openai/v1/responses",
  );
  assertEquals(capturedHeaders["api-key"], "azure-key");
  assert(!("Authorization" in capturedHeaders));
  assertEquals(capturedBody.model, "my-gpt54-deployment");
  assertEquals(capturedBody.background, false);
  assertEquals(capturedBody.store, false);
});

Deno.test("execute: HTTP failures map to safe transport categories; body discarded", async () => {
  for (
    const [status, cat] of [
      [401, "credential_rejected"],
      [403, "permission_denied"],
      [404, "endpoint_not_found"],
      [429, "rate_limited"],
      [500, "service_unavailable"],
      [400, "request_rejected"],
    ] as const
  ) {
    const fetchImpl = mockFetch(() =>
      new Response(JSON.stringify({ error: { message: "hidden" } }), {
        status,
      })
    );
    const r = await executeTenantAiResponse({
      runtime: OPENAI_RUNTIME,
      payload: {},
      fetchImpl,
    });
    assert(!r.ok, `status ${status}`);
    if (!r.ok) {
      assertEquals(r.category, cat);
      assertEquals(r.httpStatus, status);
    }
  }
});

Deno.test("execute: transport failures classify as timeout/network_error", async () => {
  const to = await executeTenantAiResponse({
    runtime: OPENAI_RUNTIME,
    payload: {},
    fetchImpl: throwFetch("AbortError"),
  });
  assert(!to.ok);
  if (!to.ok) assertEquals(to.category, "timeout");

  const net = await executeTenantAiResponse({
    runtime: OPENAI_RUNTIME,
    payload: {},
    fetchImpl: throwFetch("TypeError"),
  });
  assert(!net.ok);
  if (!net.ok) assertEquals(net.category, "network_error");
});

Deno.test("execute: malformed / non-object body → response_invalid", async () => {
  const bad = await executeTenantAiResponse({
    runtime: OPENAI_RUNTIME,
    payload: {},
    fetchImpl: mockFetch(() => new Response("nope", { status: 200 })),
  });
  assert(!bad.ok);
  if (!bad.ok) assertEquals(bad.category, "response_invalid");

  const arr = await executeTenantAiResponse({
    runtime: OPENAI_RUNTIME,
    payload: {},
    fetchImpl: mockFetch(() =>
      new Response(JSON.stringify([1, 2]), { status: 200 })
    ),
  });
  assert(!arr.ok);
  if (!arr.ok) assertEquals(arr.category, "response_invalid");
});

