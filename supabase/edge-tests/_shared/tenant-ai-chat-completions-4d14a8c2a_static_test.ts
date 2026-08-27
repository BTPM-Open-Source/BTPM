// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/tenant-ai-chat-completions-4d14a8c2a_static_test.ts', import.meta.url).href;
// Phase 4D.14A.8C.2A — Static + mocked-fetch contract tests for the
// canonical Tenant AI chat-completions transport.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  classifyChatCompletionsHttpStatus,
  classifyChatCompletionsTransportFailure,
  postTenantAiChatCompletion,
} from "../../functions/_shared/tenantAiChatCompletionsClient.ts";
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

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
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

Deno.test("classifyChatCompletionsHttpStatus maps codes correctly", () => {
  assertEquals(classifyChatCompletionsHttpStatus(401), "credential_rejected");
  assertEquals(classifyChatCompletionsHttpStatus(403), "permission_denied");
  assertEquals(classifyChatCompletionsHttpStatus(404), "endpoint_not_found");
  assertEquals(classifyChatCompletionsHttpStatus(429), "rate_limited");
  assertEquals(classifyChatCompletionsHttpStatus(500), "service_unavailable");
  assertEquals(classifyChatCompletionsHttpStatus(502), "service_unavailable");
  assertEquals(classifyChatCompletionsHttpStatus(400), "request_rejected");
  assertEquals(classifyChatCompletionsHttpStatus(418), "request_rejected");
});

Deno.test("classifyChatCompletionsTransportFailure recognizes abort/timeout", () => {
  assertEquals(
    classifyChatCompletionsTransportFailure(
      Object.assign(new Error("x"), { name: "AbortError" }),
    ),
    "timeout",
  );
  assertEquals(
    classifyChatCompletionsTransportFailure(
      Object.assign(new Error("x"), { name: "TimeoutError" }),
    ),
    "timeout",
  );
  assertEquals(
    classifyChatCompletionsTransportFailure(new Error("boom")),
    "network_error",
  );
});

Deno.test("OpenAI uses bearer Authorization header and /chat/completions URL", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: Record<string, unknown> = {};
  const fetchImpl = mockFetch((url, init) => {
    capturedUrl = url;
    capturedHeaders = (init.headers as Record<string, string>) ?? {};
    capturedBody = JSON.parse((init.body as string) ?? "{}");
    return new Response(JSON.stringify({ id: "x", choices: [] }), {
      status: 200,
    });
  });
  const r = await postTenantAiChatCompletion({
    runtime: OPENAI_RUNTIME,
    payload: { messages: [{ role: "user", content: "hi" }] },
    fetchImpl,
  });
  assert(r.ok);
  assertEquals(capturedUrl, "https://api.openai.com/v1/chat/completions");
  assertEquals(capturedHeaders["Authorization"], "Bearer sk-openai-key");
  assertEquals(capturedHeaders["Content-Type"], "application/json");
  assert(!("api-key" in capturedHeaders));
  assertEquals(capturedBody.model, "gpt-5.4");
});

Deno.test("Azure uses api-key header and provider deployment as model", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: Record<string, unknown> = {};
  const fetchImpl = mockFetch((url, init) => {
    capturedUrl = url;
    capturedHeaders = (init.headers as Record<string, string>) ?? {};
    capturedBody = JSON.parse((init.body as string) ?? "{}");
    return new Response(JSON.stringify({ id: "x" }), { status: 200 });
  });
  const r = await postTenantAiChatCompletion({
    runtime: AZURE_RUNTIME,
    payload: { messages: [] },
    fetchImpl,
  });
  assert(r.ok);
  assertEquals(
    capturedUrl,
    "https://acme.openai.azure.com/openai/v1/chat/completions",
  );
  assertEquals(capturedHeaders["api-key"], "azure-key");
  assert(!("Authorization" in capturedHeaders));
  assertEquals(capturedBody.model, "my-gpt54-deployment");
});

Deno.test("payload.model cannot override runtime.providerModel", async () => {
  let capturedBody: Record<string, unknown> = {};
  const fetchImpl = mockFetch((_u, init) => {
    capturedBody = JSON.parse((init.body as string) ?? "{}");
    return new Response(JSON.stringify({ id: "x" }), { status: 200 });
  });
  await postTenantAiChatCompletion({
    runtime: OPENAI_RUNTIME,
    payload: { model: "attacker-model", messages: [] },
    fetchImpl,
  });
  assertEquals(capturedBody.model, "gpt-5.4");
  // Azure
  await postTenantAiChatCompletion({
    runtime: AZURE_RUNTIME,
    payload: { model: "attacker-model", messages: [] },
    fetchImpl,
  });
  assertEquals(capturedBody.model, "my-gpt54-deployment");
});

Deno.test("failure HTTP statuses map to safe categories", async () => {
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
      new Response(JSON.stringify({ error: "hidden" }), { status })
    );
    const r = await postTenantAiChatCompletion({
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

Deno.test("transport throw classifies as timeout / network_error", async () => {
  const to = await postTenantAiChatCompletion({
    runtime: OPENAI_RUNTIME,
    payload: {},
    fetchImpl: throwFetch("AbortError"),
  });
  assert(!to.ok);
  if (!to.ok) {
    assertEquals(to.category, "timeout");
    assertEquals(to.httpStatus, null);
  }
  const net = await postTenantAiChatCompletion({
    runtime: OPENAI_RUNTIME,
    payload: {},
    fetchImpl: throwFetch("TypeError"),
  });
  assert(!net.ok);
  if (!net.ok) assertEquals(net.category, "network_error");
});

Deno.test("malformed success body → response_invalid", async () => {
  const fetchImpl = mockFetch(() =>
    new Response("not-json", { status: 200 })
  );
  const r = await postTenantAiChatCompletion({
    runtime: OPENAI_RUNTIME,
    payload: {},
    fetchImpl,
  });
  assert(!r.ok);
  if (!r.ok) {
    assertEquals(r.category, "response_invalid");
    assertEquals(r.httpStatus, 200);
  }
});

Deno.test("array/non-object success body → response_invalid", async () => {
  const fetchImpl = mockFetch(() =>
    new Response(JSON.stringify([1, 2, 3]), { status: 200 })
  );
  const r = await postTenantAiChatCompletion({
    runtime: OPENAI_RUNTIME,
    payload: {},
    fetchImpl,
  });
  assert(!r.ok);
  if (!r.ok) assertEquals(r.category, "response_invalid");
});

Deno.test("only approved production Edge Functions import the chat-completions transport", async () => {
  const APPROVED = new Set<string>([
    "ai-help-chat",
  ]);
  const fnRoot = new URL("supabase/functions/", REPO_ROOT);
  const offenders: string[] = [];
  async function walk(dir: URL, topName: string | null) {
    for await (const e of Deno.readDir(dir)) {
      if (e.isDirectory) {
        if (topName === null && e.name === "_shared") continue;
        await walk(new URL(e.name + "/", dir), topName ?? e.name);
        continue;
      }
      if (!e.name.endsWith(".ts")) continue;
      const body = await Deno.readTextFile(new URL(e.name, dir));
      if (body.includes("tenantAiChatCompletionsClient")) {
        if (!topName || !APPROVED.has(topName)) {
          offenders.push(dir.pathname + e.name);
        }
      }
    }
  }
  await walk(fnRoot, null);
  assertEquals(
    offenders,
    [],
    `only approved production functions may import tenantAiChatCompletionsClient: ${
      offenders.join(", ")
    }`,
  );
});

Deno.test("transport source declares no Global env or Supabase reads", async () => {
  const src = await Deno.readTextFile(
    new URL(
      "supabase/functions/_shared/tenantAiChatCompletionsClient.ts",
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
  assertStringIncludes(src, "/chat/completions");
  assertStringIncludes(src, "runtime.providerModel");
});
