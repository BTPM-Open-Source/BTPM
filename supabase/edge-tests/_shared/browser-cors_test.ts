import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildBrowserCorsHeaders,
  parseBrowserAllowedOrigins,
} from "../../functions/_shared/browserCors.ts";

Deno.test("browser CORS parser accepts and normalizes exact origins", () => {
  const origins = parseBrowserAllowedOrigins(
    "https://app.example.com, http://localhost:8080/",
  );
  assertEquals([...origins], [
    "https://app.example.com",
    "http://localhost:8080",
  ]);
});

Deno.test("browser CORS parser rejects wildcards and non-origin URLs", () => {
  assertThrows(() => parseBrowserAllowedOrigins("https://*.example.com"));
  assertThrows(() => parseBrowserAllowedOrigins("https://example.com/path"));
  assertThrows(() => parseBrowserAllowedOrigins("javascript:alert(1)"));
});

Deno.test("browser CORS headers echo only an explicitly allowed exact origin", () => {
  const origins = parseBrowserAllowedOrigins("https://app.example.com");
  const allowed = buildBrowserCorsHeaders(
    new Request("https://edge.example.test", {
      headers: { Origin: "https://app.example.com" },
    }),
    { allowedOrigins: origins },
  );
  assertEquals(allowed["Access-Control-Allow-Origin"], "https://app.example.com");
  assertEquals(allowed.Vary, "Origin");

  const denied = buildBrowserCorsHeaders(
    new Request("https://edge.example.test", {
      headers: { Origin: "https://attacker.example" },
    }),
    { allowedOrigins: origins },
  );
  assert(!("Access-Control-Allow-Origin" in denied));
});

Deno.test("browser CORS headers do not invent an origin for non-browser callers", () => {
  const origins = parseBrowserAllowedOrigins("https://app.example.com");
  const headers = buildBrowserCorsHeaders(
    new Request("https://edge.example.test"),
    { allowedOrigins: origins },
  );
  assert(!("Access-Control-Allow-Origin" in headers));
});
