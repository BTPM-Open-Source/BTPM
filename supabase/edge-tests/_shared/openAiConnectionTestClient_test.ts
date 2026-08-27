// Phase 4D.14A.5A — Tests for the transport-only OpenAI connection test client
// and pure classifiers. No live network, Supabase, or Vault access.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  classifyOpenAiModelsResponse,
  classifyOpenAiTransportFailure,
  OPENAI_MODELS_URL,
  OPENAI_TEST_TIMEOUT_MS,
  testOpenAiConnection,
} from "../../functions/_shared/openAiConnectionTestClient.ts";
import {
  classifyOpenAiTransportResult,
  OPENAI_TEST_ENTRIES,
} from "../../functions/_shared/openAiTestConnectionHelpers.ts";

Deno.test("classifier: 200 with data[] → success", () => {
  assertEquals(
    classifyOpenAiModelsResponse({ status: 200, hasDataArray: true }),
    "success",
  );
});
Deno.test("classifier: 200 without data[] → invalid_response", () => {
  assertEquals(
    classifyOpenAiModelsResponse({ status: 200, hasDataArray: false }),
    "invalid_response",
  );
});
Deno.test("classifier: 401 → credential_rejected", () => {
  assertEquals(
    classifyOpenAiModelsResponse({ status: 401, hasDataArray: false }),
    "credential_rejected",
  );
});
Deno.test("classifier: 403 → access_forbidden", () => {
  assertEquals(
    classifyOpenAiModelsResponse({ status: 403, hasDataArray: false }),
    "access_forbidden",
  );
});
Deno.test("classifier: 429 → rate_limited", () => {
  assertEquals(
    classifyOpenAiModelsResponse({ status: 429, hasDataArray: false }),
    "rate_limited",
  );
});
Deno.test("classifier: 5xx → provider_unavailable", () => {
  for (const s of [500, 502, 503, 504, 599]) {
    assertEquals(
      classifyOpenAiModelsResponse({ status: s, hasDataArray: false }),
      "provider_unavailable",
    );
  }
});
Deno.test("classifier: transport AbortError → timeout", () => {
  assertEquals(
    classifyOpenAiTransportFailure({ name: "AbortError" }),
    "timeout",
  );
});
Deno.test("classifier: transport generic → network_error", () => {
  assertEquals(classifyOpenAiTransportFailure(new Error("boom")), "network_error");
});

Deno.test("testOpenAiConnection: hits GET /v1/models with Bearer key", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  let capturedAuth = "";
  const mock: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedMethod = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    capturedAuth = headers.get("Authorization") ?? "";
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  const r = await testOpenAiConnection({
    apiKey: "sk-test-abc",
    requestId: "r-1",
    fetchImpl: mock,
  });
  assertEquals(r.category, "success");
  assertEquals(capturedUrl, OPENAI_MODELS_URL);
  assertEquals(capturedMethod, "GET");
  assertEquals(capturedAuth, "Bearer sk-test-abc");
});

Deno.test("testOpenAiConnection: 401 maps to credential_rejected", async () => {
  const mock: typeof fetch = (async () =>
    new Response("nope", { status: 401 })) as unknown as typeof fetch;
  const r = await testOpenAiConnection({
    apiKey: "sk", requestId: "r", fetchImpl: mock,
  });
  assertEquals(r.category, "credential_rejected");
  assertEquals(r.httpStatus, 401);
});

Deno.test("testOpenAiConnection: 403 maps to access_forbidden", async () => {
  const mock: typeof fetch = (async () =>
    new Response("nope", { status: 403 })) as unknown as typeof fetch;
  const r = await testOpenAiConnection({
    apiKey: "sk", requestId: "r", fetchImpl: mock,
  });
  assertEquals(r.category, "access_forbidden");
});

Deno.test("testOpenAiConnection: 429 maps to rate_limited", async () => {
  const mock: typeof fetch = (async () =>
    new Response("nope", { status: 429 })) as unknown as typeof fetch;
  const r = await testOpenAiConnection({
    apiKey: "sk", requestId: "r", fetchImpl: mock,
  });
  assertEquals(r.category, "rate_limited");
});

Deno.test("testOpenAiConnection: 503 maps to provider_unavailable", async () => {
  const mock: typeof fetch = (async () =>
    new Response("down", { status: 503 })) as unknown as typeof fetch;
  const r = await testOpenAiConnection({
    apiKey: "sk", requestId: "r", fetchImpl: mock,
  });
  assertEquals(r.category, "provider_unavailable");
});

Deno.test("testOpenAiConnection: 200 without data[] maps to invalid_response", async () => {
  const mock: typeof fetch = (async () =>
    new Response(JSON.stringify({ what: 1 }), { status: 200 })) as unknown as typeof fetch;
  const r = await testOpenAiConnection({
    apiKey: "sk", requestId: "r", fetchImpl: mock,
  });
  assertEquals(r.category, "invalid_response");
});

Deno.test("testOpenAiConnection: network error → network_error", async () => {
  const mock: typeof fetch = (async () => {
    throw new Error("dns");
  }) as unknown as typeof fetch;
  const r = await testOpenAiConnection({
    apiKey: "sk", requestId: "r", fetchImpl: mock,
  });
  assertEquals(r.category, "network_error");
  assertEquals(r.httpStatus, null);
});

Deno.test("testOpenAiConnection: aborted fetch → timeout", async () => {
  const mock: typeof fetch = ((_url: string, init?: RequestInit) =>
    new Promise((_res, rej) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("aborted");
        (err as { name?: string }).name = "AbortError";
        rej(err);
      });
    })) as unknown as typeof fetch;
  const r = await testOpenAiConnection({
    apiKey: "sk", requestId: "r", fetchImpl: mock, timeoutMs: 20,
  });
  assertEquals(r.category, "timeout");
});

Deno.test("transport classification -> UI classification: success", () => {
  assertEquals(
    classifyOpenAiTransportResult("success"),
    OPENAI_TEST_ENTRIES.connection_successful,
  );
});
Deno.test("transport classification -> UI classification: credential_rejected", () => {
  assertEquals(
    classifyOpenAiTransportResult("credential_rejected"),
    OPENAI_TEST_ENTRIES.credential_rejected,
  );
});
Deno.test("transport classification -> UI classification: access_forbidden -> blocked", () => {
  assertEquals(
    classifyOpenAiTransportResult("access_forbidden"),
    OPENAI_TEST_ENTRIES.openai_access_blocked,
  );
});
Deno.test("transport classification -> UI classification: rate_limited", () => {
  assertEquals(
    classifyOpenAiTransportResult("rate_limited"),
    OPENAI_TEST_ENTRIES.openai_rate_limited,
  );
});
Deno.test("transport classification -> UI classification: timeout", () => {
  assertEquals(
    classifyOpenAiTransportResult("timeout"),
    OPENAI_TEST_ENTRIES.openai_timeout,
  );
});
Deno.test("transport classification -> UI classification: network/provider -> unavailable", () => {
  assertEquals(
    classifyOpenAiTransportResult("network_error"),
    OPENAI_TEST_ENTRIES.openai_unavailable,
  );
  assertEquals(
    classifyOpenAiTransportResult("provider_unavailable"),
    OPENAI_TEST_ENTRIES.openai_unavailable,
  );
});
Deno.test("transport classification -> UI classification: invalid_response", () => {
  assertEquals(
    classifyOpenAiTransportResult("invalid_response"),
    OPENAI_TEST_ENTRIES.openai_response_invalid,
  );
});

Deno.test("recorder result vocabulary is bounded per entry", () => {
  const allowed = new Set(["success", "failure", "blocked"]);
  for (const e of Object.values(OPENAI_TEST_ENTRIES)) {
    assert(allowed.has(e.recorderResult), `bad recorderResult ${e.recorderResult}`);
  }
});

Deno.test("transport timeout default is bounded (20s)", () => {
  assertEquals(OPENAI_TEST_TIMEOUT_MS, 20_000);
});
