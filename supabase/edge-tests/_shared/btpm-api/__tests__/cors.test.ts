// Focused Deno tests for API-G.1C exact-origin CORS.

import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ApiHttpError, toSafeHttpErrorResponse } from "../../../../functions/_shared/btpm-api/http.ts";
import { buildCorsHeaders, parseAllowedOrigins } from "../../../../functions/_shared/btpm-api/cors.ts";

function makeRequest(origin?: string): Request {
  const headers = new Headers();
  if (origin !== undefined) headers.set("Origin", origin);
  return new Request("http://localhost/anything", { method: "GET", headers });
}

// ---------- parseAllowedOrigins ----------

Deno.test("parseAllowedOrigins: undefined returns empty set", () => {
  const s = parseAllowedOrigins(undefined);
  assertEquals(s.size, 0);
});

Deno.test("parseAllowedOrigins: blank returns empty set", () => {
  assertEquals(parseAllowedOrigins("").size, 0);
  assertEquals(parseAllowedOrigins("   ").size, 0);
  assertEquals(parseAllowedOrigins(" , , ").size, 0);
});

Deno.test("parseAllowedOrigins: trims, normalizes and deduplicates", () => {
  const s = parseAllowedOrigins(
    "  https://a.example.com  , https://b.example.com/, https://a.example.com",
  );
  assertEquals(s.size, 2);
  assert(s.has("https://a.example.com"));
  assert(s.has("https://b.example.com"));
});

Deno.test("parseAllowedOrigins: rejects wildcards", () => {
  const err = assertThrows(
    () => parseAllowedOrigins("*"),
    ApiHttpError,
  );
  assertEquals(err.code, "internal_error");
  assertThrows(() => parseAllowedOrigins("https://*.example.com"), ApiHttpError);
  assertThrows(
    () => parseAllowedOrigins("https://a.example.com,*"),
    ApiHttpError,
  );
});

Deno.test("parseAllowedOrigins: rejects malformed and non-http protocols", () => {
  assertThrows(() => parseAllowedOrigins("not-a-url"), ApiHttpError);
  assertThrows(() => parseAllowedOrigins("ftp://a.example.com"), ApiHttpError);
  assertThrows(() => parseAllowedOrigins("javascript:alert(1)"), ApiHttpError);
  assertThrows(() => parseAllowedOrigins("file:///etc/passwd"), ApiHttpError);
});

Deno.test("parseAllowedOrigins: rejects credentials/paths/queries/fragments", () => {
  assertThrows(
    () => parseAllowedOrigins("https://user:pass@a.example.com"),
    ApiHttpError,
  );
  assertThrows(
    () => parseAllowedOrigins("https://a.example.com/foo"),
    ApiHttpError,
  );
  assertThrows(
    () => parseAllowedOrigins("https://a.example.com/?x=1"),
    ApiHttpError,
  );
  assertThrows(
    () => parseAllowedOrigins("https://a.example.com/#frag"),
    ApiHttpError,
  );
});

Deno.test("parseAllowedOrigins: trailing root slash is normalized", () => {
  const s = parseAllowedOrigins("https://a.example.com/");
  assertEquals(s.size, 1);
  assert(s.has("https://a.example.com"));
});

// ---------- buildCorsHeaders ----------

Deno.test("buildCorsHeaders: no Origin returns only Vary: Origin", () => {
  const allowed = parseAllowedOrigins("https://a.example.com");
  const headers = buildCorsHeaders(makeRequest(), allowed);
  assertEquals(headers.get("Vary"), "Origin");
  assertStrictEquals(headers.get("Access-Control-Allow-Origin"), null);
  assertStrictEquals(headers.get("Access-Control-Allow-Methods"), null);
  assertStrictEquals(headers.get("Access-Control-Allow-Headers"), null);
  assertStrictEquals(headers.get("Access-Control-Expose-Headers"), null);
  assertStrictEquals(headers.get("Access-Control-Max-Age"), null);
  assertStrictEquals(headers.get("Access-Control-Allow-Credentials"), null);
});

Deno.test("buildCorsHeaders: exact allowed origin is echoed", () => {
  const allowed = parseAllowedOrigins("https://a.example.com");
  const headers = buildCorsHeaders(
    makeRequest("https://a.example.com"),
    allowed,
  );
  assertEquals(
    headers.get("Access-Control-Allow-Origin"),
    "https://a.example.com",
  );
});

Deno.test("buildCorsHeaders: default-port equivalents match", () => {
  const allowed = parseAllowedOrigins("https://a.example.com");
  const headers = buildCorsHeaders(
    makeRequest("https://a.example.com:443"),
    allowed,
  );
  assertEquals(
    headers.get("Access-Control-Allow-Origin"),
    "https://a.example.com",
  );

  const allowed2 = parseAllowedOrigins("http://a.example.com:80");
  const headers2 = buildCorsHeaders(
    makeRequest("http://a.example.com"),
    allowed2,
  );
  assertEquals(
    headers2.get("Access-Control-Allow-Origin"),
    "http://a.example.com",
  );
});

Deno.test("buildCorsHeaders: unapproved origin throws cors_origin_denied", () => {
  const allowed = parseAllowedOrigins("https://a.example.com");
  const err = assertThrows(
    () => buildCorsHeaders(makeRequest("https://evil.example.com"), allowed),
    ApiHttpError,
  );
  assertEquals(err.code, "cors_origin_denied");
  assertEquals(err.status, 403);
  assertEquals(err.publicMessage, "Origin is not allowed.");
});

Deno.test("buildCorsHeaders: rejects blank, comma-combined and malformed Origin", () => {
  const allowed = parseAllowedOrigins("https://a.example.com");
  for (const bad of [
    "",
    "   ",
    "https://a.example.com, https://b.example.com",
    "not-a-url",
    "ftp://a.example.com",
    "javascript:alert(1)",
  ]) {
    const err = assertThrows(
      () => buildCorsHeaders(makeRequest(bad), allowed),
      ApiHttpError,
    );
    assertEquals(err.code, "cors_origin_denied");
  }
});

Deno.test("buildCorsHeaders: rejects Origin with credentials/path/query/fragment", () => {
  const allowed = parseAllowedOrigins("https://a.example.com");
  for (const bad of [
    "https://user:pass@a.example.com",
    "https://a.example.com/foo",
    "https://a.example.com/?x=1",
    "https://a.example.com/#frag",
  ]) {
    const err = assertThrows(
      () => buildCorsHeaders(makeRequest(bad), allowed),
      ApiHttpError,
    );
    assertEquals(err.code, "cors_origin_denied");
  }
});

Deno.test("buildCorsHeaders: allowed response has exact expected headers", () => {
  const allowed = parseAllowedOrigins("https://a.example.com");
  const headers = buildCorsHeaders(
    makeRequest("https://a.example.com"),
    allowed,
  );
  assertEquals(
    headers.get("Access-Control-Allow-Origin"),
    "https://a.example.com",
  );
  assertEquals(
    headers.get("Access-Control-Allow-Methods"),
    // API-K.7 — PATCH advertised for the external Risk update route.
    "GET, POST, PATCH, PUT, OPTIONS",
  );
  assertEquals(
    headers.get("Access-Control-Allow-Headers"),
    "Authorization, Content-Type, X-Request-ID, X-Correlation-ID, Idempotency-Key",
  );
  assertEquals(headers.get("Access-Control-Expose-Headers"), "X-Request-ID");
  assertEquals(headers.get("Access-Control-Max-Age"), "600");
  assertEquals(headers.get("Vary"), "Origin");
});

Deno.test("buildCorsHeaders: never emits '*' or Allow-Credentials", () => {
  const allowed = parseAllowedOrigins(
    "https://a.example.com, https://b.example.com",
  );
  for (const req of [
    makeRequest(),
    makeRequest("https://a.example.com"),
    makeRequest("https://b.example.com"),
  ]) {
    const headers = buildCorsHeaders(req, allowed);
    for (const [, v] of headers) {
      assert(v !== "*", `header value must not be '*', got '${v}'`);
    }
    assertStrictEquals(headers.get("Access-Control-Allow-Credentials"), null);
  }
});

Deno.test("safe serialization: 403 body exposes only stable code + requestId", async () => {
  const allowed = parseAllowedOrigins("https://a.example.com");
  let caught: unknown = null;
  try {
    buildCorsHeaders(makeRequest("https://evil.example.com"), allowed);
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof ApiHttpError);
  const response = toSafeHttpErrorResponse(caught, "req-abc-123");
  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body, {
    error: { code: "cors_origin_denied", message: "Origin is not allowed." },
    requestId: "req-abc-123",
  });
  const text = JSON.stringify(body);
  assert(!text.includes("evil.example.com"));
  assert(!text.includes("a.example.com"));
});
