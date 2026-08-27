// API-H.6A4-C1 — Source/config contract test.
//
// Proves at source level that the btpm-api-v1 gateway JWT verifier is
// disabled (required for ES256 access tokens) AND that the live entry point
// still composes the accepted in-function authentication pipeline.
//
// Comment text is deliberately stripped before assertions so the test cannot
// pass on documentation alone.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const CONFIG_PATH = new URL("../../config.toml", import.meta.url);
const INDEX_PATH = new URL("./index.ts", import.meta.url);

function stripTomlComments(source: string): string {
  return source
    .split("\n")
    .map((line) => line.replace(/#.*$/, ""))
    .join("\n");
}

function stripTsComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function readSectionBody(toml: string, section: string): string {
  const lines = toml.split("\n");
  const start = lines.findIndex((l) => l.trim() === `[${section}]`);
  assert(start >= 0, `missing [${section}] section`);
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n");
}

Deno.test("btpm-api-v1 gateway verify_jwt is disabled for ES256 tokens", async () => {
  const raw = await Deno.readTextFile(CONFIG_PATH);
  const body = readSectionBody(stripTomlComments(raw), "functions.btpm-api-v1");
  const match = body.match(/^\s*verify_jwt\s*=\s*(true|false)\s*$/m);
  assert(match, "verify_jwt must be declared for functions.btpm-api-v1");
  assertEquals(match![1], "false");
});

Deno.test("btpm-api-v1 entry point still composes authenticateApiRequest", async () => {
  const raw = await Deno.readTextFile(INDEX_PATH);
  const code = stripTsComments(raw);

  assert(
    /import\s*\{[^}]*\bauthenticateApiRequest\b[^}]*\}\s*from\s*["'][^"']*authenticateApiRequest\.ts["']/
      .test(code),
    "index.ts must import authenticateApiRequest from the shared middleware",
  );
  assert(
    /const\s+authenticate\s*=\s*\(request:\s*Request\)\s*=>\s*\n?\s*authenticateApiRequest\(/
      .test(code),
    "protected route dependencies must wire authenticate to authenticateApiRequest",
  );
  assert(
    /tokenVerifier/.test(code) && /currentUserResolver/.test(code) &&
      /clientAuthorizationStore/.test(code),
    "authentication pipeline dependencies must remain wired",
  );
});
