// Phase 4D.14A.7D — Static contract tests for the SharePoint file manager.
// Ensures zero active runtime references to Global M365_* / BTPM_SP_*
// secrets, local Graph token acquisition, local generic Graph fetch, or
// direct login.microsoftonline.com calls in the file-manager runtime
// files. Comments describing retired configuration are allowed; active
// runtime occurrences must be zero.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FILES = [
  "sharepoint-files/index.ts",
  "_shared/sharePointWorkspaceBindingRuntime.ts",
];

async function readFile(path: string): Promise<string> {
  const url = new URL(`../${path}`, import.meta.url);
  return await Deno.readTextFile(url);
}

/** Strip block + line comments so we only inspect active runtime code. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

Deno.test("file-manager: no active M365_ / BTPM_SP_ env reads", async () => {
  for (const f of FILES) {
    const code = stripComments(await readFile(f));
    for (const needle of [
      'Deno.env.get("M365_',
      "Deno.env.get('M365_",
      'Deno.env.get("BTPM_SP_',
      "Deno.env.get('BTPM_SP_",
      "M365_TENANT_ID",
      "M365_CLIENT_ID",
      "M365_CLIENT_SECRET",
      "BTPM_SP_SITE_URL",
      "BTPM_SP_SITE_ID",
    ]) {
      assertEquals(
        code.includes(needle),
        false,
        `${f} still contains active reference to ${needle}`,
      );
    }
  }
});

Deno.test("file-manager: no active login.microsoftonline.com call", async () => {
  for (const f of FILES) {
    const code = stripComments(await readFile(f));
    assertEquals(
      code.includes("login.microsoftonline.com"),
      false,
      `${f} still calls login.microsoftonline.com directly`,
    );
  }
});

Deno.test("file-manager: no local getGraphToken / graphFetch identifiers", async () => {
  for (const f of FILES) {
    const code = stripComments(await readFile(f));
    for (const needle of ["function getGraphToken", "function graphFetch"]) {
      assertEquals(
        code.includes(needle),
        false,
        `${f} still defines ${needle}`,
      );
    }
  }
});

Deno.test("file-manager: uses canonical shared runtimes", async () => {
  const idx = await readFile("sharepoint-files/index.ts");
  for (const needle of [
    "resolveTenantSharePointRuntimeConfig",
    "resolveAndAcquireTenantMicrosoftGraph",
    "resolveTenantMicrosoftGraphClientIdentity",
    "resolveSharePointProjectRoot",
    "resolveSharePointWorkspaceLibraryRoot",
  ]) {
    assertEquals(idx.includes(needle), true, `sharepoint-files must import ${needle}`);
  }
});

Deno.test("file-manager: Supabase SDK pin supports auth.getClaims", async () => {
  const idx = await readFile("sharepoint-files/index.ts");
  assertEquals(
    idx.includes("@supabase/supabase-js@2.50.0"),
    true,
    "sharepoint-files must pin Supabase JS >= 2.50.0 so browser-session guard can call auth.getClaims",
  );
});

Deno.test("file-manager: Supabase import uses npm: specifier, not esm.sh", async () => {
  const idx = await readFile("sharepoint-files/index.ts");
  assertEquals(
    idx.includes('npm:@supabase/supabase-js@2.50.0'),
    true,
    "sharepoint-files must import Supabase JS via npm:@supabase/supabase-js@2.50.0",
  );
  assertEquals(
    /esm\.sh\/@supabase\/supabase-js/.test(idx),
    false,
    "sharepoint-files must not import Supabase JS from esm.sh (breaks Edge Runtime module load)",
  );
});

Deno.test("file-manager: browser-session guard and error mapping remain present", async () => {
  const idx = await readFile("sharepoint-files/index.ts");
  for (const needle of [
    "assertBrowserSessionOnly",
    "createSupabaseTokenVerifier",
    "toSafeErrorResponse",
  ]) {
    assertEquals(idx.includes(needle), true, `sharepoint-files must retain ${needle}`);
  }
});
