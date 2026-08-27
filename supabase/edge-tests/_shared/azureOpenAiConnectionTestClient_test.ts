// Phase 4D.14A.8A — Azure OpenAI transport client tests with mock fetch.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  classifyAzureModelsResponse,
  classifyAzureTransportFailure,
  testAzureOpenAiConnection,
} from "../../functions/_shared/azureOpenAiConnectionTestClient.ts";

function mockFetch(
  status: number,
  body: unknown,
  opts: { throwName?: string } = {},
): typeof fetch {
  return ((_url: string, _init?: RequestInit) => {
    if (opts.throwName) {
      const e = new Error("mock");
      (e as { name?: string }).name = opts.throwName;
      return Promise.reject(e);
    }
    const res = new Response(JSON.stringify(body), { status });
    return Promise.resolve(res);
  }) as unknown as typeof fetch;
}

const BASE = "https://acme.openai.azure.com/openai/v1";
const KEY = "test-key";

Deno.test("classifyAzureModelsResponse maps status codes correctly", () => {
  assertEquals(
    classifyAzureModelsResponse({ status: 200, hasArrayShape: true }),
    "success",
  );
  assertEquals(
    classifyAzureModelsResponse({ status: 200, hasArrayShape: false }),
    "response_invalid",
  );
  assertEquals(
    classifyAzureModelsResponse({ status: 401, hasArrayShape: false }),
    "credential_rejected",
  );
  assertEquals(
    classifyAzureModelsResponse({ status: 403, hasArrayShape: false }),
    "permission_denied",
  );
  assertEquals(
    classifyAzureModelsResponse({ status: 404, hasArrayShape: false }),
    "endpoint_not_found",
  );
  assertEquals(
    classifyAzureModelsResponse({ status: 429, hasArrayShape: false }),
    "rate_limited",
  );
  assertEquals(
    classifyAzureModelsResponse({ status: 500, hasArrayShape: false }),
    "service_unavailable",
  );
  assertEquals(
    classifyAzureModelsResponse({ status: 502, hasArrayShape: false }),
    "service_unavailable",
  );
  assertEquals(
    classifyAzureModelsResponse({ status: 400, hasArrayShape: false }),
    "service_unavailable",
  );
});

Deno.test("classifyAzureTransportFailure recognizes abort/timeout", () => {
  const abort = Object.assign(new Error("x"), { name: "AbortError" });
  const to = Object.assign(new Error("x"), { name: "TimeoutError" });
  assertEquals(classifyAzureTransportFailure(abort), "timeout");
  assertEquals(classifyAzureTransportFailure(to), "timeout");
  assertEquals(
    classifyAzureTransportFailure(new Error("boom")),
    "network_error",
  );
});

Deno.test("testAzureOpenAiConnection: success with { data: [] }", async () => {
  const r = await testAzureOpenAiConnection({
    baseUrl: BASE,
    apiKey: KEY,
    requestId: "req-1",
    fetchImpl: mockFetch(200, { data: [{ id: "m1" }] }),
  });
  assertEquals(r.category, "success");
  assertEquals(r.httpStatus, 200);
});

Deno.test("testAzureOpenAiConnection: 200 without array → response_invalid", async () => {
  const r = await testAzureOpenAiConnection({
    baseUrl: BASE,
    apiKey: KEY,
    requestId: "req-1",
    fetchImpl: mockFetch(200, { foo: "bar" }),
  });
  assertEquals(r.category, "response_invalid");
});

Deno.test("testAzureOpenAiConnection maps 401/403/404/429/500", async () => {
  for (
    const [status, cat] of [
      [401, "credential_rejected"],
      [403, "permission_denied"],
      [404, "endpoint_not_found"],
      [429, "rate_limited"],
      [500, "service_unavailable"],
    ] as const
  ) {
    const r = await testAzureOpenAiConnection({
      baseUrl: BASE,
      apiKey: KEY,
      requestId: "r",
      fetchImpl: mockFetch(status, { error: "hidden" }),
    });
    assertEquals(r.category, cat, `status ${status}`);
    assertEquals(r.httpStatus, status);
  }
});

Deno.test("testAzureOpenAiConnection: timeout classification", async () => {
  const r = await testAzureOpenAiConnection({
    baseUrl: BASE,
    apiKey: KEY,
    requestId: "r",
    fetchImpl: mockFetch(0, {}, { throwName: "AbortError" }),
  });
  assertEquals(r.category, "timeout");
  assertEquals(r.httpStatus, null);
});

Deno.test("testAzureOpenAiConnection: network_error on generic throw", async () => {
  const r = await testAzureOpenAiConnection({
    baseUrl: BASE,
    apiKey: KEY,
    requestId: "r",
    fetchImpl: mockFetch(0, {}, { throwName: "TypeError" }),
  });
  assertEquals(r.category, "network_error");
});

Deno.test("testAzureOpenAiConnection: uses api-key header, GET /models", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  const fetchImpl = ((url: string, init?: RequestInit) => {
    capturedUrl = url;
    const h = init?.headers as Record<string, string> | undefined;
    if (h) capturedHeaders = h;
    return Promise.resolve(new Response(JSON.stringify({ data: [] }), {
      status: 200,
    }));
  }) as unknown as typeof fetch;
  await testAzureOpenAiConnection({
    baseUrl: BASE,
    apiKey: KEY,
    requestId: "r",
    fetchImpl,
  });
  assertEquals(capturedUrl, `${BASE}/models`);
  assertEquals(capturedHeaders["api-key"], KEY);
  assert(!("Authorization" in capturedHeaders));
});
