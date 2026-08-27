// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-q-portfolio-12b1-portfolio-items-oauth-mutation-containment_static_test.ts', import.meta.url).href;
// API-Q Portfolio-12B.1 — public.portfolio_items direct external-OAuth INSERT/UPDATE
// containment (static contract test).
//
// Structural inspection of the committed Portfolio-12B.1 migration only. No live calls.

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
  const name = await findMigration("API-Q Portfolio-12B.1");
  return await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
}

/** Remove SQL comments (block + line) so informational headers do not trip
 *  forbidden-pattern assertions. */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

Deno.test("Portfolio-12B.1 migration exists, is unique and carries the marker", async () => {
  const name = await findMigration("API-Q Portfolio-12B.1");
  assert(/^\d{14}_[0-9a-f-]+\.sql$/.test(name), `Unexpected name: ${name}`);
  const sql = await Deno.readTextFile(new URL(name, MIGRATIONS_DIR));
  assertStringIncludes(sql, "API-Q Portfolio-12B.1");
});

Deno.test("Portfolio-12B.1 creates exactly two policies on public.portfolio_items", async () => {
  const sql = stripSqlComments(await migrationSql());

  const creates = sql.match(/CREATE\s+POLICY\s+([a-zA-Z0-9_]+)/gi) ?? [];
  assertEquals(creates.length, 2, "Exactly two CREATE POLICY statements are allowed.");

  assertStringIncludes(creates[0] ?? "", "api_e_oauth_insert_containment");
  assertStringIncludes(creates[1] ?? "", "api_e_oauth_update_containment");

  assert(
    /CREATE\s+POLICY\s+api_e_oauth_insert_containment\s+ON\s+public\.portfolio_items\b/i
      .test(sql),
    "INSERT policy must target public.portfolio_items.",
  );
  assert(
    /CREATE\s+POLICY\s+api_e_oauth_update_containment\s+ON\s+public\.portfolio_items\b/i
      .test(sql),
    "UPDATE policy must target public.portfolio_items.",
  );
});

Deno.test("Portfolio-12B.1 INSERT policy is restrictive INSERT for authenticated with WITH CHECK only", async () => {
  const sql = stripSqlComments(await migrationSql());
  const block = sql.match(
    /CREATE\s+POLICY\s+api_e_oauth_insert_containment[\s\S]*?;\s*CREATE\s+POLICY\s+api_e_oauth_update_containment/i,
  );
  assert(block, "INSERT policy block must be followed by the UPDATE policy.");
  const insertBlock = block![0];

  assert(/AS\s+RESTRICTIVE/i.test(insertBlock), "INSERT policy must be AS RESTRICTIVE.");
  assert(/FOR\s+INSERT/i.test(insertBlock), "INSERT policy must be FOR INSERT.");
  assert(/TO\s+authenticated/i.test(insertBlock), "INSERT policy must be granted TO authenticated.");
  assert(!/FOR\s+(SELECT|UPDATE|DELETE|ALL)\b/i.test(insertBlock), "No other policy command allowed.");
  assert(!/\bTO\s+(anon|public|service_role)\b/i.test(insertBlock), "Only authenticated may be targeted.");
  assert(!/USING\s*\(/i.test(insertBlock), "INSERT policy must not declare a USING clause.");
  assert(/WITH\s+CHECK\s*\(/i.test(insertBlock), "INSERT policy must declare a WITH CHECK clause.");
});

Deno.test("Portfolio-12B.1 UPDATE policy is restrictive UPDATE for authenticated with USING and WITH CHECK", async () => {
  const sql = stripSqlComments(await migrationSql());
  const block = sql.match(
    /CREATE\s+POLICY\s+api_e_oauth_update_containment[\s\S]*?;/i,
  );
  assert(block, "UPDATE policy block must be present.");
  const updateBlock = block![0];

  assert(/AS\s+RESTRICTIVE/i.test(updateBlock), "UPDATE policy must be AS RESTRICTIVE.");
  assert(/FOR\s+UPDATE/i.test(updateBlock), "UPDATE policy must be FOR UPDATE.");
  assert(/TO\s+authenticated/i.test(updateBlock), "UPDATE policy must be granted TO authenticated.");
  assert(!/FOR\s+(SELECT|INSERT|DELETE|ALL)\b/i.test(updateBlock), "No other policy command allowed.");
  assert(!/\bTO\s+(anon|public|service_role)\b/i.test(updateBlock), "Only authenticated may be targeted.");
  assert(/USING\s*\(/i.test(updateBlock), "UPDATE policy must declare a USING clause.");
  assert(/WITH\s+CHECK\s*\(/i.test(updateBlock), "UPDATE policy must declare a WITH CHECK clause.");
});

Deno.test("Portfolio-12B.1 containment condition is exactly the accepted expression in every clause", async () => {
  const sql = stripSqlComments(await migrationSql()).replace(/\s+/g, " ");
  const cond = "api_e_private.jwt_client_id() IS NULL OR api_e_private.assert_trusted_context()";

  // Exactly three clauses carry the condition: INSERT WITH CHECK, UPDATE USING, UPDATE WITH CHECK.
  const count = sql.split(cond).length - 1;
  assertEquals(count, 3, `Expected 3 occurrences of the containment condition, got ${count}.`);

  // No other jwt_client_id / assert_trusted_context expression may appear outside the condition.
  assert(
    !/jwt_client_id\(\)\s+IS\s+NOT\s+NULL/i.test(sql),
    "Inverted containment condition is forbidden.",
  );
  assert(
    !/NOT\s+assert_trusted_context/i.test(sql),
    "Negated trusted-context assertion is forbidden.",
  );
});

Deno.test("Portfolio-12B.1 targets no second business table", async () => {
  const sql = stripSqlComments(await migrationSql());
  const refs = new Set(
    [...sql.matchAll(/\bpublic\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase()),
  );
  assertEquals(
    [...refs],
    ["portfolio_items"],
    "Only public.portfolio_items may be referenced.",
  );
});

Deno.test("Portfolio-12B.1 leaves the existing SELECT containment and ordinary admin policies untouched", async () => {
  const sql = stripSqlComments(await migrationSql());
  for (const name of [
    "api_e_oauth_read_containment",
    "portfolio_items_admin_select",
    "portfolio_items_admin_insert",
    "portfolio_items_admin_update",
  ]) {
    assert(!sql.includes(name), `Migration must not reference ${name}.`);
  }
  assert(!/DROP\s+POLICY/i.test(sql), "No policy drop permitted.");
  assert(!/ALTER\s+POLICY/i.test(sql), "No policy alteration permitted.");
  assert(!/RENAME/i.test(sql), "No rename permitted.");
});

Deno.test("Portfolio-12B.1 leaves authority helpers and canonical writers untouched", async () => {
  const sql = stripSqlComments(await migrationSql());
  for (const name of [
    "is_active_user",
    "is_org_admin",
    "admin_create_portfolio_item",
    "admin_update_portfolio_item",
    "admin_archive_portfolio_item",
    "admin_assign_projects_to_portfolio",
    "assign_project_portfolio",
    "trg_encrypt_portfolio_item_fields",
    "portfolio_items_encrypt_fields",
    "btpm_encrypt",
    "btpm_decrypt",
  ]) {
    assert(
      !new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+.*${name}`, "i").test(sql),
      `Migration must not define/replace function ${name}.`,
    );
    assert(
      !new RegExp(`DROP\\s+FUNCTION\\s+.*${name}`, "i").test(sql),
      `Migration must not drop function ${name}.`,
    );
  }
});

Deno.test("Portfolio-12B.1 performs no DML or backfill", async () => {
  const sql = stripSqlComments(await migrationSql());
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

Deno.test("Portfolio-12B.1 changes no grant, function, trigger, index, view, enum, constraint or table definition", async () => {
  const sql = stripSqlComments(await migrationSql());
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
    [/ADD\s+CONSTRAINT/i, "constraint addition"],
    [/DROP\s+CONSTRAINT/i, "constraint drop"],
  ];
  for (const [re, label] of forbidden) {
    assert(!re.test(sql), `Migration must not include ${label}.`);
  }
});

Deno.test("Portfolio-12B.1 widens no table privilege and adds no service_role privilege", async () => {
  const sql = stripSqlComments(await migrationSql());
  assert(!/GRANT\s+.*ON\s+public\.portfolio_items/i.test(sql), "No privilege grant on portfolio_items.");
  assert(!/service_role/i.test(sql), "Migration must not reference service_role.");
  assert(!/\banon\b/i.test(sql), "Migration must not reference anon.");
});
