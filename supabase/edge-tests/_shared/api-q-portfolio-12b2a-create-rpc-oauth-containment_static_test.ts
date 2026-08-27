// API-Q Portfolio-12B.2A — Canonical Portfolio Create RPC External-OAuth
// Containment (durable focused static test).
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename) and verifies the executable
// SQL of the single redefined function public.admin_create_portfolio_item.
//
// No database access, no network access, no Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER =
  "API-Q Portfolio-12B.2A — Canonical Portfolio Create RPC External-OAuth Containment";

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

const sql = stripSqlComments(found[0]?.text ?? "");

Deno.test("12B.2A: exactly one forward-only migration owns this correction", () => {
  assertEquals(found.length, 1, "exactly one migration must carry the marker");
});

Deno.test("12B.2A: only admin_create_portfolio_item is replaced", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION public.admin_create_portfolio_item",
  ]);
  for (const forbidden of [
    "admin_update_portfolio_item",
    "admin_archive_portfolio_item",
    "assign_project_portfolio",
    "admin_assign_projects_to_portfolio",
    "execute_v1_create_portfolio",
    "api_v1_create_portfolio",
    "mcp_v1_create_portfolio",
    "trg_encrypt_portfolio_item_fields",
    "portfolio_items_encrypt_fields",
    "btpm_encrypt",
    "btpm_decrypt",
    "CREATE POLICY",
    "DROP POLICY",
    "ALTER TABLE",
    "DROP FUNCTION",
    "api_capability_catalogue",
    "api_capability_grants",
  ]) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

Deno.test("12B.2A: signature, defaults and return type are unchanged", () => {
  assert(
    sql.includes(
      "CREATE OR REPLACE FUNCTION public.admin_create_portfolio_item(_organization_id uuid, _name text, _code text DEFAULT NULL::text, _description text DEFAULT NULL::text, _lifecycle_state text DEFAULT 'opportunity_candidate'::text, _owner_id uuid DEFAULT NULL::uuid, _strategic_priority text DEFAULT 'medium'::text)",
    ),
    "exact signature and defaults must be preserved",
  );
  assert(/RETURNS uuid/.test(sql));
  assert(/RETURN _new_id;/.test(sql));
});

Deno.test("12B.2A: SECURITY DEFINER and pinned search_path remain", () => {
  assert(/\bSECURITY DEFINER\b/.test(sql));
  assert(/SET search_path TO 'public'/.test(sql));
});

Deno.test("12B.2A: privileges are preserved, not widened", () => {
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.admin_create_portfolio_item(uuid, text, text, text, text, uuid, text) FROM PUBLIC;",
    ),
  );
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.admin_create_portfolio_item(uuid, text, text, text, text, uuid, text) FROM anon;",
    ),
  );
  assert(
    sql.includes(
      "GRANT EXECUTE ON FUNCTION public.admin_create_portfolio_item(uuid, text, text, text, text, uuid, text) TO authenticated;",
    ),
    "authenticated execution must remain for the ordinary browser",
  );
  assert(!/GRANT[^;]*TO service_role/.test(sql), "no service_role grant may be added");
  assert(!/GRANT[^;]*TO (PUBLIC|anon)/.test(sql));
});

Deno.test("12B.2A: OAuth identity is server-derived and fails closed", () => {
  assert(sql.includes("v_client_id := api_e_private.jwt_client_id();"));
  assert(
    /EXCEPTION WHEN OTHERS THEN\s*v_client_id := 'unresolved_client';/.test(sql),
    "unresolved jwt_client_id must fail closed as external/untrusted",
  );
  assert(
    /IF v_client_id IS NOT NULL THEN/.test(sql),
    "NULL client id must preserve the ordinary-browser flow",
  );
  assert(sql.includes("v_trusted := api_e_private.assert_trusted_context();"));
  assert(/EXCEPTION WHEN OTHERS THEN\s*v_trusted := false;/.test(sql));
});

Deno.test("12B.2A: exact trusted-context conditions are required", () => {
  assert(/v_trusted IS NOT TRUE/.test(sql));
  assert(/current_setting\('api_e\.api_version', true\)[\s\S]{0,60}<> 'v1'/.test(sql));
  assert(/current_setting\('api_e\.capability_kind', true\)[\s\S]{0,60}<> 'command'/.test(sql));
  assert(
    /current_setting\('api_e\.capability_key', true\)[\s\S]{0,60}<> 'portfolios:create'/.test(sql),
  );
  assert(sql.includes("current_setting('api_e.source_channel', true)"));
  assert(
    /v_trusted_channel NOT IN \('external_api','mcp'\)/.test(sql),
    "only external_api and mcp channels may be accepted",
  );
  assert(/v_trusted_channel IS NULL/.test(sql), "blank/NULL channel must fail closed");
  assert(!sql.includes("btpm_ui"), "browser channel must never be accepted here");
  assert(
    /RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/.test(sql),
    "denial must be a bounded generic 42501 authorization error",
  );
});

Deno.test("12B.2A: guard runs before owner lookup, INSERT, encryption and logging", () => {
  const guard = sql.indexOf("USING ERRCODE = '42501'");
  const active = sql.indexOf("public.is_active_user(_uid)");
  const orgAdmin = sql.indexOf("public.is_org_admin(_uid, _organization_id)");
  const ownerLookup = sql.indexOf("FROM public.profiles WHERE id = _owner_id");
  const insert = sql.indexOf("INSERT INTO public.portfolio_items");
  const log = sql.indexOf("public.log_activity_event");
  assert(guard > -1);
  for (const idx of [active, orgAdmin, ownerLookup, insert, log]) {
    assert(idx > guard, "containment must precede all business logic");
  }
});

Deno.test("12B.2A: no caller-supplied capability or source parameter is added", () => {
  const args = sql.slice(
    sql.indexOf("admin_create_portfolio_item(_organization_id"),
    sql.indexOf(")\n RETURNS uuid"),
  );
  for (const forbidden of [
    "_source_channel",
    "_capability_key",
    "_capability_kind",
    "_api_client_id",
    "_trusted",
    "_executing_user_id",
  ]) {
    assertEquals(args.includes(forbidden), false, `must not accept ${forbidden}`);
  }
});

Deno.test("12B.2A: existing Portfolio business validations remain unchanged", () => {
  assert(sql.includes("RAISE EXCEPTION 'Not authenticated'"));
  assert(sql.includes("RAISE EXCEPTION 'Account is deactivated'"));
  assert(sql.includes("public.is_org_admin(_uid, _organization_id)"));
  assert(sql.includes("RAISE EXCEPTION 'Name is required'"));
  assert(sql.includes("RAISE EXCEPTION 'Name exceeds 200 characters'"));
  assert(sql.includes("RAISE EXCEPTION 'Code exceeds 80 characters'"));
  assert(sql.includes("RAISE EXCEPTION 'Description exceeds 4000 characters'"));
  assert(sql.includes("RAISE EXCEPTION 'Invalid lifecycle_state'"));
  assert(sql.includes("RAISE EXCEPTION 'Invalid strategic_priority'"));
});

// Portfolio-12C.1 superseded the owner-eligibility predicate frozen here.
// The current canonical writer is owned by the 12C.1 migration.
Deno.test("12B.2A: owner eligibility is now membership-based (Portfolio-12C.1)", async () => {
  const CORRECTION_MARKER =
    "API-Q Portfolio-12C.1 — Canonical Portfolio Owner Membership Correction";
  let current = "";
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
    if (text.includes(CORRECTION_MARKER)) current = stripSqlComments(text);
  }
  assert(current.length > 0, "the Portfolio-12C.1 correction migration must exist");
  assert(
    current.includes("public.is_user_org_member(_owner_id, _organization_id)"),
    "owner eligibility must use the canonical membership helper",
  );
  assert(
    current.includes("RAISE EXCEPTION 'Owner must belong to the same organization'"),
    "the browser-facing owner error text must be preserved",
  );
  assert(
    !current.includes("FROM public.profiles WHERE id = _owner_id"),
    "profiles.organization_id must no longer drive owner eligibility",
  );
  assert(
    !current.includes("organization_memberships") &&
      !current.includes("tenant_memberships"),
    "membership tables must not be queried directly",
  );
});


Deno.test("12B.2A: exactly one INSERT remains and encryption stays trigger-delegated", () => {
  const inserts = sql.match(/INSERT INTO public\.portfolio_items/g) ?? [];
  assertEquals(inserts.length, 1);
  assert(
    sql.includes(
      "organization_id, name, code, description, lifecycle_state, strategic_priority, owner_id, created_by, updated_by",
    ),
    "INSERT field list must be unchanged",
  );
  assert(!/btpm_encrypt|pgp_sym_encrypt/.test(sql), "no inline encryption path");
  assert(
    sql.includes(
      "_organization_id, _name_trim, _code, _description, _lifecycle_state, _strategic_priority, _owner_id, _uid, _uid",
    ),
    "plaintext narrative values remain delegated to the existing encryption trigger",
  );
  assert(
    /public\.log_activity_event\([\s\S]{0,140}'portfolio_created', 'portfolio', _new_id/.test(sql),
  );
});

Deno.test("12B.2A: no API/MCP wrapper or frontend source is modified", async () => {
  const hook = await Deno.readTextFile(
    new URL("../../../src/hooks/useAdminPortfolioItems.ts", import.meta.url),
  );
  assert(
    hook.includes('supabase.rpc("admin_create_portfolio_item"'),
    "the ordinary browser must still call the canonical RPC directly",
  );
  assert(
    !hook.includes("api_e.source_channel") && !hook.includes("capability_key"),
    "frontend must not supply trusted-context values",
  );
});
