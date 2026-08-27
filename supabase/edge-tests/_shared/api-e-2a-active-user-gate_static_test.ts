// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-e-2a-active-user-gate_static_test.ts', import.meta.url).href;
// API-E.2A — OAuth containment at the shared active-user gate (static contract test).
//
// This test statically inspects the API-E.2A migration and asserts:
//   * The migration replaces ONLY public.is_active_user(uuid).
//   * The final function retains the original active-profile logic
//     (EXISTS on public.profiles WHERE id = _user_id AND is_active = true).
//   * The final function retains its original security/search_path posture
//     (STABLE, SECURITY DEFINER, SET search_path = 'public').
//   * No-client sessions follow the original logic.
//   * Signed-client sessions require api_e_private.assert_trusted_context()
//     before original logic executes.
//   * No request header / body / UI-context authority is introduced.
//   * No PMG function, table, policy, grant, token/secret storage,
//     or OAuth configuration is changed by this migration.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL(
  "../../migrations/",
  __BTPM_SRC_BASE__,
);

async function findMigration(marker: string): Promise<string> {
  const entries: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) entries.push(entry.name);
  }
  entries.sort();
  const matches: string[] = [];
  for (const name of entries) {
    const text = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
    if (text.includes(marker)) matches.push(name);
  }
  assertEquals(
    matches.length,
    1,
    `Expected exactly one migration containing marker ${marker}, found: ${matches.join(", ")}`,
  );
  return matches[0];
}

Deno.test("API-E.2A migration exists and is uniquely identifiable", async () => {
  const name = await findMigration("API-E.2A");
  assert(/^\d{14}_[0-9a-f-]+\.sql$/.test(name), `Unexpected name: ${name}`);
});

Deno.test("API-E.2A migration modifies only public.is_active_user(uuid)", async () => {
  const name = await findMigration("API-E.2A");
  const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));

  // The only CREATE OR REPLACE FUNCTION statement must target is_active_user.
  const createMatches = sql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-zA-Z0-9_."]+)/gi) ?? [];
  assertEquals(createMatches.length, 1, "Exactly one function replacement is allowed.");
  assertStringIncludes(createMatches[0] ?? "", "public.is_active_user");

  // Must not create any other functions.
  assert(
    !/CREATE\s+FUNCTION\s+/i.test(sql),
    "No new function definitions permitted.",
  );

  // Forbid touching PMG, tables, policies, grants, OAuth config, secrets.
  const forbidden: Array<[RegExp, string]> = [
    [/CREATE\s+TABLE/i, "table creation"],
    [/ALTER\s+TABLE/i, "table alteration"],
    [/DROP\s+TABLE/i, "table drop"],
    [/CREATE\s+POLICY/i, "policy creation"],
    [/DROP\s+POLICY/i, "policy drop"],
    [/ALTER\s+POLICY/i, "policy alteration"],
    [/\bGRANT\b/i, "grant statement"],
    [/\bREVOKE\b/i, "revoke statement"],
    [/pmg[_.]/i, "PMG surface"],
    [/service_role/i, "service_role reference"],
    [/auth\.jwt|request\.header|current_setting\(\s*'request\./i, "raw request/header authority"],
    [/oauth[_.]?config|token_store|secret_store/i, "OAuth/secret configuration"],
  ];
  for (const [re, label] of forbidden) {
    assert(!re.test(sql), `Migration must not include ${label}.`);
  }
});

Deno.test("API-E.2A final is_active_user preserves original logic and posture", async () => {
  const name = await findMigration("API-E.2A");
  const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));

  // Signature and posture.
  assert(
    /public\.is_active_user\s*\(\s*_user_id\s+uuid\s*\)/i.test(sql),
    "Signature must remain is_active_user(_user_id uuid).",
  );
  assert(/RETURNS\s+boolean/i.test(sql), "Return type must remain boolean.");
  assert(/\bSTABLE\b/i.test(sql), "Function must remain STABLE.");
  assert(/SECURITY\s+DEFINER/i.test(sql), "Function must remain SECURITY DEFINER.");
  assert(
    /SET\s+search_path\s*(?:TO|=)\s*'?public'?/i.test(sql),
    "search_path must remain fixed to 'public'.",
  );

  // Original active-profile logic present.
  assert(
    /FROM\s+public\.profiles[\s\S]{0,120}id\s*=\s*_user_id[\s\S]{0,80}is_active\s*=\s*true/i
      .test(sql),
    "Original active-profile EXISTS logic must be preserved.",
  );
});

Deno.test("API-E.2A gates via jwt_client_id and assert_trusted_context, in that order", async () => {
  const name = await findMigration("API-E.2A");
  const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));

  const jwtIdx = sql.search(/api_e_private\.jwt_client_id\s*\(/);
  const assertIdx = sql.search(/api_e_private\.assert_trusted_context\s*\(/);
  assert(jwtIdx > -1, "Must call api_e_private.jwt_client_id().");
  assert(assertIdx > -1, "Must call api_e_private.assert_trusted_context().");
  assert(
    jwtIdx < assertIdx,
    "Signed client identity must be checked before trusted-context assertion.",
  );

  // No-client path must fall through to original logic (branch on NULL client_id).
  assert(
    /jwt_client_id\s*\(\s*\)\s+IS\s+NULL/i.test(sql),
    "Function must branch on jwt_client_id() IS NULL to preserve non-OAuth behavior.",
  );

  // Signed-client path must return false when trusted context is absent.
  assert(
    /NOT\s+api_e_private\.assert_trusted_context\s*\(\s*\)[\s\S]{0,80}(false|FALSE|RETURN\s+false)/i
      .test(sql) ||
      /assert_trusted_context\s*\(\s*\)[\s\S]{0,40}THEN[\s\S]{0,80}false/i.test(sql),
    "Signed-client sessions must return false unless assert_trusted_context() is true.",
  );
});

Deno.test("API-E.2A introduces no new browser-callable function or authority surface", async () => {
  const name = await findMigration("API-E.2A");
  const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));

  // No new public.* function beyond is_active_user replacement.
  const publicFns = sql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.[a-zA-Z0-9_]+/gi) ?? [];
  assertEquals(publicFns.length, 1, "Only public.is_active_user may be replaced.");
  assertStringIncludes((publicFns[0] ?? "").toLowerCase(), "public.is_active_user");

  // Must not accept UI/profile-org, headers, or body as authority.
  const bannedAuthority = [
    /active[_ ]?workspace/i,
    /active[_ ]?organization/i,
    /profile\.organization/i,
    /request\.header/i,
    /http_header/i,
    /body_client/i,
  ];
  for (const re of bannedAuthority) {
    assert(!re.test(sql), `Forbidden authority surface referenced: ${re}`);
  }
});
