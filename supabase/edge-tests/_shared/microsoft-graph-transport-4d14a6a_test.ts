// Phase 4D.14A.6A — Microsoft Graph transport tests with mocked fetch.
// Never hits real Microsoft. Verifies request shape, response classification,
// and that raw bodies / secrets are not exposed on the returned object.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  acquireMicrosoftGraphToken,
  probeMicrosoftGraphApi,
} from "../../functions/_shared/microsoftGraphClient.ts";

const runtime = {
  tenantId: "tenantRow",
  organizationId: "orgRow",
  integrationId: "integ",
  integrationName: "default",
  microsoftTenantId: "11111111-1111-1111-1111-111111111111",
  clientId: "22222222-2222-2222-2222-222222222222",
  clientSecret: "s3cret",
};

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {});
}

Deno.test("acquire_token: request shape (url, body, scope)", async () => {
  let capturedUrl = "";
  let capturedBody = "";
  let capturedMethod = "";
  const fetchImpl = mockFetch((url, init) => {
    capturedUrl = url;
    capturedMethod = init.method ?? "";
    capturedBody = String(init.body ?? "");
    return new Response(JSON.stringify({ access_token: "abc" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const r = await acquireMicrosoftGraphToken({
    runtime,
    requestId: "rq",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  assertEquals(r.category, "success");
  assertEquals(r.accessToken, "abc");
  assertEquals(capturedMethod, "POST");
  assertEquals(
    capturedUrl,
    `https://login.microsoftonline.com/${runtime.microsoftTenantId}/oauth2/v2.0/token`,
  );
  assert(capturedBody.includes(`client_id=${runtime.clientId}`));
  assert(capturedBody.includes("grant_type=client_credentials"));
  assert(
    capturedBody.includes("scope=https%3A%2F%2Fgraph.microsoft.com%2F.default"),
  );
  assert(capturedBody.includes(`client_secret=${runtime.clientSecret}`));
});

Deno.test("acquire_token: 401 credential rejected, body drained", async () => {
  const fetchImpl = mockFetch(() =>
    new Response("microsoft: bad secret", { status: 401 })
  );
  const r = await acquireMicrosoftGraphToken({
    runtime,
    requestId: "rq",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  assertEquals(r.category, "credential_rejected");
  assertEquals(r.accessToken, null);
});

Deno.test("acquire_token: 403/429/500 map correctly", async () => {
  for (const [status, expected] of [[403, "access_forbidden"], [429, "rate_limited"], [503, "provider_unavailable"]] as const) {
    const fetchImpl = mockFetch(() => new Response("x", { status }));
    const r = await acquireMicrosoftGraphToken({
      runtime,
      requestId: "rq",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    assertEquals(r.category, expected);
  }
});

Deno.test("acquire_token: malformed JSON => token_response_invalid", async () => {
  const fetchImpl = mockFetch(() =>
    new Response("not-json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
  const r = await acquireMicrosoftGraphToken({
    runtime,
    requestId: "rq",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  assertEquals(r.category, "token_response_invalid");
  assertEquals(r.accessToken, null);
});

Deno.test("acquire_token: missing access_token => token_response_invalid", async () => {
  const fetchImpl = mockFetch(() =>
    new Response(JSON.stringify({ token_type: "Bearer" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
  const r = await acquireMicrosoftGraphToken({
    runtime,
    requestId: "rq",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  assertEquals(r.category, "token_response_invalid");
});

Deno.test("acquire_token: network error => network_error", async () => {
  const fetchImpl = mockFetch(() => {
    throw new Error("boom");
  });
  const r = await acquireMicrosoftGraphToken({
    runtime,
    requestId: "rq",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  assertEquals(r.category, "network_error");
});

Deno.test("acquire_token: timeout (AbortError) => timeout", async () => {
  const fetchImpl = mockFetch(() => {
    const err = new Error("aborted");
    (err as { name: string }).name = "AbortError";
    throw err;
  });
  const r = await acquireMicrosoftGraphToken({
    runtime,
    requestId: "rq",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  assertEquals(r.category, "timeout");
});

Deno.test("probe: GET metadata with Bearer token; body not returned", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  let capturedAuth = "";
  const fetchImpl = mockFetch((url, init) => {
    capturedUrl = url;
    capturedMethod = init.method ?? "";
    const h = new Headers(init.headers);
    capturedAuth = h.get("Authorization") ?? "";
    return new Response("<edmx:Edmx ...>", { status: 200 });
  });
  const r = await probeMicrosoftGraphApi({
    accessToken: "tok",
    requestId: "rq",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  assertEquals(r.category, "success");
  assertEquals(capturedMethod, "GET");
  assertEquals(capturedUrl, "https://graph.microsoft.com/v1.0/$metadata");
  assertEquals(capturedAuth, "Bearer tok");
  // Result object exposes only category + httpStatus.
  assertEquals(Object.keys(r).sort(), ["category", "httpStatus"]);
});

Deno.test("probe: 401/403/429/500 map correctly", async () => {
  for (const [status, expected] of [
    [401, "credential_rejected"],
    [403, "access_forbidden"],
    [429, "rate_limited"],
    [500, "graph_api_unavailable"],
  ] as const) {
    const fetchImpl = mockFetch(() => new Response("x", { status }));
    const r = await probeMicrosoftGraphApi({
      accessToken: "tok",
      requestId: "rq",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    assertEquals(r.category, expected);
  }
});

Deno.test("probe: network error/timeout classified safely", async () => {
  const netFetch = mockFetch(() => {
    throw new Error("net");
  });
  const r1 = await probeMicrosoftGraphApi({
    accessToken: "tok",
    requestId: "rq",
    fetchImpl: netFetch as unknown as typeof fetch,
  });
  assertEquals(r1.category, "network_error");

  const abortFetch = mockFetch(() => {
    const e = new Error("x");
    (e as { name: string }).name = "AbortError";
    throw e;
  });
  const r2 = await probeMicrosoftGraphApi({
    accessToken: "tok",
    requestId: "rq",
    fetchImpl: abortFetch as unknown as typeof fetch,
  });
  assertEquals(r2.category, "timeout");
});
