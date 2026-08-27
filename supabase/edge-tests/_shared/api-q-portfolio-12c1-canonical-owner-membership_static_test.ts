// API-Q Portfolio-12C.1 — Canonical Portfolio Owner Membership Correction
// (durable focused static test).
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename) and verifies the executable
// SQL of the two redefined canonical writers.
//
// No database access, no network access, no Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER =
  "API-Q Portfolio-12C.1 — Canonical Portfolio Owner Membership Correction";

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

const createSection = sql.slice(
  sql.indexOf("CREATE OR REPLACE FUNCTION public.admin_create_portfolio_item"),
  sql.indexOf("CREATE OR REPLACE FUNCTION public.admin_update_portfolio_item"),
);
const updateSection = sql.slice(
  sql.indexOf("CREATE OR REPLACE FUNCTION public.admin_update_portfolio_item"),
);

Deno.test("12C.1: exactly one forward-only migration owns this correction", () => {
  assertEquals(found.length, 1, "exactly one migration must carry the marker");
  assert(createSection.length > 0 && updateSection.length > 0);
});

Deno.test("12C.1: only the two canonical Portfolio writers are replaced", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION public.admin_create_portfolio_item",
    "CREATE OR REPLACE FUNCTION public.admin_update_portfolio_item",
  ]);
});

// --------------------------------------------------------------------------
// A. admin_create_portfolio_item
// --------------------------------------------------------------------------

Deno.test("12C.1/A: Create signature, defaults and return type are unchanged", () => {
  assert(
    createSection.includes(
      "CREATE OR REPLACE FUNCTION public.admin_create_portfolio_item(_organization_id uuid, _name text, _code text DEFAULT NULL::text, _description text DEFAULT NULL::text, _lifecycle_state text DEFAULT 'opportunity_candidate'::text, _owner_id uuid DEFAULT NULL::uuid, _strategic_priority text DEFAULT 'medium'::text)",
    ),
  );
  assert(/RETURNS uuid/.test(createSection));
  assert(/RETURN _new_id;/.test(createSection));
});

Deno.test("12C.1/A: SECURITY DEFINER, search_path and privileges preserved", () => {
  assert(/\bSECURITY DEFINER\b/.test(createSection));
  assert(/SET search_path TO 'public'/.test(createSection));
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
  );
  assert(!/GRANT[^;]*TO service_role/.test(sql));
  assert(!/GRANT[^;]*TO (PUBLIC|anon)/.test(sql));
});

Deno.test("12C.1/A: 12B.2A OAuth containment guard remains", () => {
  assert(createSection.includes("v_client_id := api_e_private.jwt_client_id();"));
  assert(/EXCEPTION WHEN OTHERS THEN\s*v_client_id := 'unresolved_client';/.test(createSection));
  assert(/IF v_client_id IS NOT NULL THEN/.test(createSection));
  assert(createSection.includes("v_trusted := api_e_private.assert_trusted_context();"));
  assert(/v_trusted IS NOT TRUE/.test(createSection));
  assert(/current_setting\('api_e\.api_version', true\)[\s\S]{0,60}<> 'v1'/.test(createSection));
  assert(
    /current_setting\('api_e\.capability_kind', true\)[\s\S]{0,60}<> 'command'/.test(createSection),
  );
  assert(
    /current_setting\('api_e\.capability_key', true\)[\s\S]{0,60}<> 'portfolios:create'/.test(
      createSection,
    ),
  );
  assert(/v_trusted_channel NOT IN \('external_api','mcp'\)/.test(createSection));
  assert(/v_trusted_channel IS NULL/.test(createSection));
  assert(!createSection.includes("btpm_ui"));
  assert(/RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/.test(createSection));
});

Deno.test("12C.1/A: owner eligibility uses the canonical membership helper", () => {
  assert(/IF _owner_id IS NOT NULL THEN/.test(createSection), "nullable owner remains allowed");
  assert(
    createSection.includes(
      "IF public.is_user_org_member(_owner_id, _organization_id) IS NOT TRUE THEN",
    ),
    "membership must be asserted TRUE with the documented argument order",
  );
  assert(
    createSection.includes("RAISE EXCEPTION 'Owner must belong to the same organization'"),
  );
});

Deno.test("12C.1/A: no legacy or direct membership reads remain in Create", () => {
  assert(!createSection.includes("FROM public.profiles WHERE id = _owner_id"));
  assert(!createSection.includes("_owner_org"));
  assert(!createSection.includes("organization_memberships"));
  assert(!createSection.includes("tenant_memberships"));
});

Deno.test("12C.1/A: one INSERT remains and encryption stays trigger-delegated", () => {
  const inserts = createSection.match(/INSERT INTO public\.portfolio_items/g) ?? [];
  assertEquals(inserts.length, 1);
  assert(
    createSection.includes(
      "organization_id, name, code, description, lifecycle_state, strategic_priority, owner_id, created_by, updated_by",
    ),
  );
  assert(
    createSection.includes(
      "_organization_id, _name_trim, _code, _description, _lifecycle_state, _strategic_priority, _owner_id, _uid, _uid",
    ),
  );
  assert(!/btpm_encrypt|pgp_sym_encrypt|btpm_decrypt/.test(sql));
  assert(
    /public\.log_activity_event\([\s\S]{0,140}'portfolio_created', 'portfolio', _new_id/.test(
      createSection,
    ),
  );
});

// --------------------------------------------------------------------------
// B. admin_update_portfolio_item
// --------------------------------------------------------------------------

Deno.test("12C.1/B: Update signature, defaults and return type are unchanged", () => {
  assert(
    updateSection.includes(
      "CREATE OR REPLACE FUNCTION public.admin_update_portfolio_item(_portfolio_item_id uuid, _name text, _code text DEFAULT NULL::text, _description text DEFAULT NULL::text, _lifecycle_state text DEFAULT 'opportunity_candidate'::text, _owner_id uuid DEFAULT NULL::uuid, _strategic_priority text DEFAULT 'medium'::text)",
    ),
  );
  assert(/RETURNS void/.test(updateSection));
});

Deno.test("12C.1/B: SECURITY DEFINER, search_path and privileges preserved", () => {
  assert(/\bSECURITY DEFINER\b/.test(updateSection));
  assert(/SET search_path TO 'public'/.test(updateSection));
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.admin_update_portfolio_item(uuid, text, text, text, text, uuid, text) FROM PUBLIC;",
    ),
  );
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.admin_update_portfolio_item(uuid, text, text, text, text, uuid, text) FROM anon;",
    ),
  );
  assert(
    sql.includes(
      "GRANT EXECUTE ON FUNCTION public.admin_update_portfolio_item(uuid, text, text, text, text, uuid, text) TO authenticated;",
    ),
  );
});

Deno.test("12C.1/B: 12B.2B OAuth containment guard remains", () => {
  assert(updateSection.includes("v_client_id := api_e_private.jwt_client_id();"));
  assert(/EXCEPTION WHEN OTHERS THEN\s*v_client_id := 'unresolved_client';/.test(updateSection));
  assert(/IF v_client_id IS NOT NULL THEN/.test(updateSection));
  assert(updateSection.includes("v_trusted := api_e_private.assert_trusted_context();"));
  assert(/v_trusted IS NOT TRUE/.test(updateSection));
  assert(/current_setting\('api_e\.api_version', true\)[\s\S]{0,60}<> 'v1'/.test(updateSection));
  assert(
    /current_setting\('api_e\.capability_kind', true\)[\s\S]{0,60}<> 'command'/.test(updateSection),
  );
  assert(
    /current_setting\('api_e\.capability_key', true\)[\s\S]{0,60}<> 'portfolios:update'/.test(
      updateSection,
    ),
  );
  assert(!updateSection.includes("portfolios:create"));
  assert(/v_trusted_channel NOT IN \('external_api','mcp'\)/.test(updateSection));
  assert(/v_trusted_channel IS NULL/.test(updateSection));
  assert(!updateSection.includes("btpm_ui"));
  assert(/RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/.test(updateSection));
});

Deno.test("12C.1/B: Portfolio Organization is still derived from the target Portfolio", () => {
  assert(
    updateSection.includes(
      "SELECT organization_id INTO _org FROM public.portfolio_items WHERE id = _portfolio_item_id;",
    ),
  );
  assert(updateSection.includes("RAISE EXCEPTION 'Portfolio item not found'"));
  assert(updateSection.includes("public.is_org_admin(_uid, _org)"));
});

Deno.test("12C.1/B: owner eligibility uses the canonical membership helper", () => {
  assert(/IF _owner_id IS NOT NULL THEN/.test(updateSection), "nullable owner remains allowed");
  assert(
    updateSection.includes("IF public.is_user_org_member(_owner_id, _org) IS NOT TRUE THEN"),
    "membership must be asserted TRUE with the documented argument order",
  );
  assert(
    updateSection.includes("RAISE EXCEPTION 'Owner must belong to the same organization'"),
  );
});

Deno.test("12C.1/B: no legacy or direct membership reads remain in Update", () => {
  assert(!updateSection.includes("FROM public.profiles WHERE id = _owner_id"));
  assert(!updateSection.includes("_owner_org"));
  assert(!updateSection.includes("organization_memberships"));
  assert(!updateSection.includes("tenant_memberships"));
});

Deno.test("12C.1/B: one UPDATE remains with an unchanged field list", () => {
  const updates = updateSection.match(/UPDATE public\.portfolio_items/g) ?? [];
  assertEquals(updates.length, 1);
  for (const line of [
    "SET name = _name_trim,",
    "code = _code,",
    "description = _description,",
    "lifecycle_state = _lifecycle_state,",
    "strategic_priority = _strategic_priority,",
    "owner_id = _owner_id,",
    "updated_by = _uid",
    "WHERE id = _portfolio_item_id;",
  ]) {
    assert(updateSection.includes(line), `UPDATE field list must be unchanged: ${line}`);
  }
  assert(
    /public\.log_activity_event\([\s\S]{0,140}'portfolio_updated', 'portfolio', _portfolio_item_id/
      .test(updateSection),
  );
});

// --------------------------------------------------------------------------
// C. Negative architecture assertions
// --------------------------------------------------------------------------

Deno.test("12C.1/C: no membership authority, schema, RLS or encryption change", () => {
  for (const forbidden of [
    "FUNCTION public.is_user_org_member",
    "FUNCTION public.is_org_member",
    "ALTER TABLE",
    "CREATE TABLE",
    "DROP FUNCTION",
    "CREATE POLICY",
    "DROP POLICY",
    "trg_encrypt_portfolio_item_fields",
    "portfolio_items_encrypt_fields",
    "btpm_encrypt",
    "btpm_decrypt",
    "UPDATE public.profiles",
    "INSERT INTO public.organization_memberships",
    "tenant_memberships",
  ]) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

Deno.test("12C.1/C: no external executor, API/MCP wrapper or new helper is touched", () => {
  for (const forbidden of [
    "execute_v1_create_portfolio",
    "execute_v1_update_portfolio",
    "api_v1_create_portfolio",
    "mcp_v1_create_portfolio",
    "api_v1_update_portfolio",
    "mcp_v1_update_portfolio",
    "admin_archive_portfolio_item",
    "assign_project_portfolio",
    "admin_assign_projects_to_portfolio",
    "api_capability_catalogue",
    "api_capability_grants",
    "api_idempotency_registry",
    "is_portfolio_owner_eligible",
  ]) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

Deno.test("12C.1/C: frontend Portfolio admin surface is unchanged", async () => {
  const hook = await Deno.readTextFile(
    new URL("../../../src/hooks/useAdminPortfolioItems.ts", import.meta.url),
  );
  assert(hook.includes('supabase.rpc("admin_create_portfolio_item"'));
  assert(hook.includes('supabase.rpc("admin_update_portfolio_item"'));
  assert(!hook.includes("is_user_org_member"));
  assert(!hook.includes("api_e.source_channel") && !hook.includes("capability_key"));
});
