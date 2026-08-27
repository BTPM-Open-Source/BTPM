// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-hr-10-organization-memberships-oauth-containment_static_test.ts', import.meta.url).href;
// API-HR.10 — public.organization_memberships OAuth direct-read containment (static contract test).
//
// Structural inspection of the committed API-HR.10 migration only. No live calls.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", __BTPM_SRC_BASE__);

async function findMigration(marker: string): Promise<string> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  const matches: string[] = [];
  for (const name of names) {
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

async function migrationSql(): Promise<string> {
  const name = await findMigration("API-HR.10");
  return await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
}

Deno.test("API-HR.10 migration exists, is unique and carries the marker", async () => {
  const name = await findMigration("API-HR.10");
  assert(/^\d{14}_[0-9a-f-]+\.sql$/.test(name), `Unexpected name: ${name}`);
  const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
  assertStringIncludes(sql, "API-HR.10");
});

Deno.test("API-HR.10 creates exactly one policy: api_e_oauth_read_containment on public.organization_memberships", async () => {
  const sql = await migrationSql();

  const creates = sql.match(/CREATE\s+POLICY\s+([a-zA-Z0-9_"]+)/gi) ?? [];
  assertEquals(creates.length, 1, "Exactly one CREATE POLICY is allowed.");
  assertStringIncludes(creates[0] ?? "", "api_e_oauth_read_containment");

  assert(
    /CREATE\s+POLICY\s+api_e_oauth_read_containment\s+ON\s+public\.organization_memberships\b/i
      .test(sql),
    "Policy must target public.organization_memberships.",
  );
});

Deno.test("API-HR.10 policy is restrictive SELECT for authenticated", async () => {
  const sql = await migrationSql();
  assert(/AS\s+RESTRICTIVE/i.test(sql), "Policy must be AS RESTRICTIVE.");
  assert(/FOR\s+SELECT/i.test(sql), "Policy must be FOR SELECT.");
  assert(/TO\s+authenticated/i.test(sql), "Policy must be granted TO authenticated.");
  assert(!/FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i.test(sql), "No other policy command allowed.");
  assert(!/\bTO\s+(anon|public|service_role)\b/i.test(sql), "Only authenticated may be targeted.");
});

Deno.test("API-HR.10 USING expression is exactly the accepted containment", async () => {
  const sql = await migrationSql();
  const match = sql.match(/USING\s*\(([\s\S]*?)\)\s*;/i);
  assert(match, "Policy must declare a USING expression.");
  const expr = match![1].replace(/\s+/g, " ").trim();
  assertEquals(
    expr,
    "api_e_private.jwt_client_id() IS NULL OR api_e_private.assert_trusted_context()",
  );
  assert(!/WITH\s+CHECK/i.test(sql), "No WITH CHECK clause allowed.");
});

Deno.test("API-HR.10 targets no second business table", async () => {
  const sql = await migrationSql();
  const refs = new Set(
    [...sql.matchAll(/\bpublic\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()),
  );
  assertEquals(
    [...refs],
    ["organization_memberships"],
    "Only public.organization_memberships may be referenced.",
  );
});

Deno.test("API-HR.10 leaves the five existing membership policies untouched", async () => {
  const sql = await migrationSql();
  for (const name of [
    "om_self_select",
    "om_org_admin_select",
    "om_tenant_admin_select",
    "om_org_admin_manage",
    "om_tenant_admin_manage",
  ]) {
    assert(!sql.includes(name), `Migration must not reference ${name}.`);
  }
  assert(!/DROP\s+POLICY/i.test(sql), "No policy drop permitted.");
  assert(!/ALTER\s+POLICY/i.test(sql), "No policy alteration permitted.");
  assert(!/RENAME/i.test(sql), "No rename permitted.");
});

Deno.test("API-HR.10 leaves membership authority helpers and API-v1 wrappers untouched", async () => {
  const sql = await migrationSql();
  for (const name of [
    "is_organization_admin",
    "is_tenant_admin",
    "is_organization_member",
    "api_v1_get_me",
    "api_v1_list_organizations",
    "api_v1_list_workspaces",
    "api_v1_list_projects",
    "api_v1_get_project",
  ]) {
    assert(!sql.includes(name), `Migration must not reference ${name}.`);
  }
});

Deno.test("API-HR.10 performs no DML or backfill", async () => {
  const sql = await migrationSql();
  for (const re of [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\s+public\./i,
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bCOPY\b/i,
    /\bMERGE\b/i,
  ]) {
    assert(!re.test(sql), `Forbidden DML construct: ${re}`);
  }
});

Deno.test("API-HR.10 changes no grant, function, trigger, index, view, enum or table definition", async () => {
  const sql = await migrationSql();
  const forbidden: Array<[RegExp, string]> = [
    [/\bGRANT\b/i, "grant"],
    [/\bREVOKE\b/i, "revoke"],
    [/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i, "function definition"],
    [/DROP\s+FUNCTION/i, "function drop"],
    [/ALTER\s+FUNCTION/i, "function alteration"],
    [/CREATE\s+TRIGGER/i, "trigger creation"],
    [/DROP\s+TRIGGER/i, "trigger drop"],
    [/CREATE\s+(UNIQUE\s+)?INDEX/i, "index creation"],
    [/DROP\s+INDEX/i, "index drop"],
    [/CREATE\s+TABLE/i, "table creation"],
    [/ALTER\s+TABLE/i, "table alteration"],
    [/DROP\s+TABLE/i, "table drop"],
    [/CREATE\s+(OR\s+REPLACE\s+)?VIEW/i, "view definition"],
    [/CREATE\s+TYPE/i, "type creation"],
    [/ALTER\s+TYPE/i, "type alteration"],
    [/\bCONSTRAINT\b/i, "constraint change"],
  ];
  for (const [re, label] of forbidden) {
    assert(!re.test(sql), `Migration must not include ${label}.`);
  }
});
