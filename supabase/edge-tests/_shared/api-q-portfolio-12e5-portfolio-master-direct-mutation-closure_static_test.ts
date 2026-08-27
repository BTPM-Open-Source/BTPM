// API-Q Portfolio-12E.5 — Portfolio Master Direct Authenticated Mutation Closure
// (durable focused static test).
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename) and verifies the executable
// SQL of the single REVOKE statement that closes the ordinary-authenticated
// direct-table mutation path on public.portfolio_items.
//
// No database access, no network access, no Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q Portfolio-12E.5 — Portfolio Master Direct Authenticated Mutation Closure";

function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < n && sql.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

const found: { name: string; text: string }[] = [];
for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
  if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
  const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
  if (text.includes(MARKER)) found.push({ name: entry.name, text });
}

const raw = found[0]?.text ?? "";
const sql = stripSqlComments(raw).trim();

Deno.test("12E.5: exactly one forward-only migration owns this correction", () => {
  assertEquals(found.length, 1, "exactly one migration must carry the marker");
});

Deno.test("12E.5: the migration performs exactly one REVOKE statement", () => {
  const revokes = sql.match(/\bREVOKE\b[^;]*;/gi) ?? [];
  assertEquals(revokes.length, 1, "exactly one REVOKE statement is allowed");
  const [onlyRevoke = ""] = revokes;
  assertEquals(
    /REVOKE\s+INSERT\s*,\s*UPDATE\s+ON\s+public\.portfolio_items\s+FROM\s+authenticated\s*;/i
      .test(onlyRevoke),
    true,
    "the single REVOKE must be INSERT, UPDATE on public.portfolio_items from authenticated",
  );
});

Deno.test("12E.5: authenticated INSERT on portfolio_items is revoked", () => {
  assert(/REVOKE\s+INSERT\s*,\s*UPDATE\s+ON\s+public\.portfolio_items\s+FROM\s+authenticated/i
    .test(sql));
});

Deno.test("12E.5: authenticated UPDATE on portfolio_items is revoked", () => {
  assert(/REVOKE\s+INSERT\s*,\s*UPDATE\s+ON\s+public\.portfolio_items\s+FROM\s+authenticated/i
    .test(sql));
});

Deno.test("12E.5: authenticated SELECT is not revoked", () => {
  assert(!/REVOKE\s+SELECT\b/i.test(sql), "SELECT must not be revoked");
  assert(!/REVOKE\s+(SELECT|ALL|ALL\s+PRIVILEGES)/i.test(sql), "no broad SELECT revoke");
});

Deno.test("12E.5: service_role privileges are not changed", () => {
  assert(!/service_role/i.test(sql), "service_role must not be referenced at all");
});

Deno.test("12E.5: anon grants are not changed", () => {
  assert(!/\banon\b/i.test(sql), "anon must not be referenced at all");
});

Deno.test("12E.5: DELETE access is not added", () => {
  assert(!/GRANT\s+DELETE/i.test(sql), "no DELETE grant");
  assert(!/REVOKE\s+DELETE/i.test(sql), "no DELETE revoke (DELETE state untouched)");
});

Deno.test("12E.5: existing portfolio_items RLS policies are not altered", () => {
  for (const forbidden of [
    "CREATE POLICY",
    "DROP POLICY",
    "ALTER POLICY",
    "ROW LEVEL SECURITY",
    "api_e_oauth_read_containment",
    "api_e_oauth_insert_containment",
    "api_e_oauth_update_containment",
    "portfolio_items_admin_select",
    "portfolio_items_admin_insert",
    "portfolio_items_admin_update",
  ]) {
    assert(!sql.includes(forbidden), `must not reference ${forbidden}`);
  }
});

Deno.test("12E.5: API-E OAuth containment policies are not altered", () => {
  assert(!sql.includes("api_e_oauth"), "API-E OAuth policies must be untouched");
  assert(!/api_e_private/.test(sql), "api_e_private must not be referenced");
});

Deno.test("12E.5: admin_create_portfolio_item is not redefined", () => {
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*admin_create_portfolio_item/i.test(sql));
  assert(!/DROP\s+FUNCTION[^(]*admin_create_portfolio_item/i.test(sql));
});

Deno.test("12E.5: admin_update_portfolio_item is not redefined", () => {
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*admin_update_portfolio_item/i.test(sql));
  assert(!/DROP\s+FUNCTION[^(]*admin_update_portfolio_item/i.test(sql));
});

Deno.test("12E.5: admin_archive_portfolio_item is not redefined", () => {
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*admin_archive_portfolio_item/i.test(sql));
  assert(!/DROP\s+FUNCTION[^(]*admin_archive_portfolio_item/i.test(sql));
});

Deno.test("12E.5: external api_v1/mcp Portfolio wrappers are not redefined", () => {
  assert(!/api_v1_(create|update|list|get)_portfolio/i.test(sql));
  assert(!/mcp_v1_(create|update)_portfolio/i.test(sql));
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*api_v1_create_portfolio/i.test(sql));
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*api_v1_update_portfolio/i.test(sql));
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*mcp_v1_create_portfolio/i.test(sql));
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*mcp_v1_update_portfolio/i.test(sql));
});

Deno.test("12E.5: private external Portfolio executors are not redefined", () => {
  assert(!/execute_v1_create_portfolio/i.test(sql));
  assert(!/execute_v1_update_portfolio/i.test(sql));
  assert(!/api_e_private/.test(sql));
});

Deno.test("12E.5: Portfolio Team is untouched", () => {
  for (const forbidden of [
    "portfolio_item_team_members",
    "admin_list_portfolio_team_members",
    "admin_add_portfolio_team_member",
    "admin_update_portfolio_team_member_role",
    "admin_remove_portfolio_team_member",
    "portfolio_team_external_oauth_denial",
  ]) {
    assert(!sql.includes(forbidden), `Portfolio Team surface must be untouched: ${forbidden}`);
  }
});

Deno.test("12E.5: Project↔Portfolio assignment is untouched", () => {
  for (const forbidden of [
    "admin_assign_projects_to_portfolio",
    "assign_project_portfolio",
    "api_v1_assign_project_portfolio",
    "mcp_v1_assign_project_portfolio",
    "portfolio_items_projects",
  ]) {
    assert(!sql.includes(forbidden), `assignment surface must be untouched: ${forbidden}`);
  }
});

Deno.test("12E.5: Portfolio-12D organization immutability is untouched", () => {
  assert(!/trg_portfolio_items_assert_organization_immutable/i.test(sql));
  assert(!/portfolio_items_00_assert_organization_immutable/i.test(sql));
  assert(!/portfolio_organization_immutable/i.test(sql));
});

Deno.test("12E.5: encryption functions and triggers are untouched", () => {
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*btpm_encrypt/i.test(sql));
  assert(!/CREATE\s+OR\s+REPLACE\s+FUNCTION[^(]*btpm_decrypt/i.test(sql));
  assert(!sql.includes("portfolio_items_encrypt_fields"));
  assert(!sql.includes("pgp_sym_encrypt"));
  assert(!sql.includes("pgp_sym_decrypt"));
  assert(!/CREATE\s+TRIGGER/i.test(sql));
  assert(!/DROP\s+TRIGGER/i.test(sql));
  assert(!/tenant_encryption/i.test(sql));
});

Deno.test("12E.5: no capability/API/MCP/frontend change occurs", () => {
  for (const forbidden of [
    "api_capability_catalogue",
    "api_capability_grants",
    "api_client",
    "connected_app",
    "api_idempotency_registry",
    "btpm-api-v1",
    "btpm-mcp",
  ]) {
    assert(!sql.includes(forbidden), `must not touch ${forbidden}`);
  }
  assert(!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(sql), "no function definition");
  assert(!/DROP\s+FUNCTION/i.test(sql), "no function drop");
  assert(!/ALTER\s+TABLE/i.test(sql), "no table alteration");
  assert(!/CREATE\s+TABLE/i.test(sql), "no table creation");
  assert(!/DROP\s+TABLE/i.test(sql), "no table drop");
  assert(!/CREATE\s+(UNIQUE\s+)?INDEX/i.test(sql), "no index change");
  assert(!/ADD\s+CONSTRAINT/i.test(sql), "no constraint addition");
});

Deno.test("12E.5: no business-data DML or backfill occurs", () => {
  for (const forbidden of [
    "INSERT INTO",
    "DELETE FROM",
    "TRUNCATE",
    "MERGE INTO",
  ]) {
    assert(!sql.includes(forbidden), `must not contain ${forbidden}`);
  }
  assert(!/\bUPDATE\s+public\./i.test(sql), "must not UPDATE business data");
});

Deno.test("12E.5: no GRANT statement widens any privilege", () => {
  assert(!/\bGRANT\b/i.test(sql), "no GRANT may appear in this migration");
});
