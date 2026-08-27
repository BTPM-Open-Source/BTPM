// API-Q Portfolio-12B.2C — Canonical Project→Portfolio Assignment RPC
// External-OAuth Containment (durable focused static test).
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename) and verifies the executable
// SQL of the single redefined function public.assign_project_portfolio.
//
// No database access, no network access, no Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER =
  "API-Q Portfolio-12B.2C — Canonical Project→Portfolio Assignment RPC External-OAuth Containment";

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

Deno.test("12B.2C: exactly one forward-only migration owns this correction", () => {
  assertEquals(found.length, 1, "exactly one migration must carry the marker");
});

Deno.test("12B.2C: only assign_project_portfolio is replaced", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION public.assign_project_portfolio",
  ]);
  for (const forbidden of [
    "admin_create_portfolio_item",
    "admin_update_portfolio_item",
    "admin_archive_portfolio_item",
    "admin_assign_projects_to_portfolio",
    "execute_v1_assign_project_portfolio",
    "api_v1_assign_project_portfolio",
    "mcp_v1_assign_project_portfolio",
    "validate_project_portfolio_item",
    "projects_validate_portfolio_item",
    "btpm_encrypt",
    "btpm_decrypt",
    "pgp_sym_encrypt",
    "CREATE POLICY",
    "DROP POLICY",
    "ALTER TABLE",
    "DROP FUNCTION",
    "api_capability_catalogue",
    "api_capability_grants",
    "api_idempotency_registry",
  ]) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

Deno.test("12B.2C: signature, default and return type are unchanged", () => {
  assert(
    sql.includes(
      "CREATE OR REPLACE FUNCTION public.assign_project_portfolio(_project_id uuid, _portfolio_item_id uuid DEFAULT NULL::uuid)",
    ),
    "exact signature and default must be preserved",
  );
  assert(/RETURNS void/.test(sql));
});

Deno.test("12B.2C: SECURITY DEFINER and pinned search_path remain", () => {
  assert(/\bSECURITY DEFINER\b/.test(sql));
  assert(/SET search_path TO 'public'/.test(sql));
});

Deno.test("12B.2C: privileges are preserved, not widened", () => {
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.assign_project_portfolio(uuid, uuid) FROM PUBLIC;",
    ),
  );
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.assign_project_portfolio(uuid, uuid) FROM anon;",
    ),
  );
  assert(
    sql.includes(
      "GRANT EXECUTE ON FUNCTION public.assign_project_portfolio(uuid, uuid) TO authenticated;",
    ),
    "authenticated execution must remain for the ordinary browser",
  );
  assert(!/GRANT[^;]*TO service_role/.test(sql), "no service_role grant may be added");
  assert(!/GRANT[^;]*TO (PUBLIC|anon)/.test(sql));
});

Deno.test("12B.2C: OAuth identity is server-derived and fails closed", () => {
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

Deno.test("12B.2C: exact trusted-context conditions are required", () => {
  assert(/v_trusted IS NOT TRUE/.test(sql));
  assert(/current_setting\('api_e\.api_version', true\)[\s\S]{0,60}<> 'v1'/.test(sql));
  assert(/current_setting\('api_e\.capability_kind', true\)[\s\S]{0,60}<> 'command'/.test(sql));
  assert(
    /current_setting\('api_e\.capability_key', true\)[\s\S]{0,60}<> 'portfolios:assign_project'/
      .test(sql),
  );
  assert(sql.includes("current_setting('api_e.source_channel', true)"));
  assert(
    /v_trusted_channel NOT IN \('external_api','mcp'\)/.test(sql),
    "only external_api and mcp channels may be accepted",
  );
  assert(/v_trusted_channel IS NULL/.test(sql), "blank/NULL channel must fail closed");
  assert(!sql.includes("btpm_ui"), "browser channel must never be accepted here");
  const denials = sql.match(/RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/g) ?? [];
  assertEquals(denials.length, 2, "guard and scope binding both deny generically");
});

Deno.test("12B.2C: initial guard precedes Project lookup and existence disclosure", () => {
  const guard = sql.indexOf("USING ERRCODE = '42501'");
  const lookup = sql.indexOf("FROM public.projects WHERE id = _project_id");
  const notFound = sql.indexOf("RAISE EXCEPTION 'Project not found'");
  const pm = sql.indexOf("public.has_project_pm_authority(_uid, _project_id)");
  const demo = sql.indexOf("public.can_write_demo(_uid, _p_ws)");
  const target = sql.indexOf("FROM public.portfolio_items WHERE id = _portfolio_item_id");
  const update = sql.indexOf("UPDATE public.projects");
  const log = sql.indexOf("public.log_activity_event");
  assert(guard > -1);
  for (const idx of [lookup, notFound, pm, demo, target, update, log]) {
    assert(idx > guard, "containment must precede all business logic");
  }
});

Deno.test("12B.2C: Project lookup still derives Organization, Workspace and current Portfolio", () => {
  assert(
    sql.includes("SELECT organization_id, workspace_id, portfolio_item_id"),
    "derived scope columns must be unchanged",
  );
  assert(sql.includes("INTO _p_org, _p_ws, _current"));
});

Deno.test("12B.2C: external trusted Organization/Workspace must match the Project", () => {
  assert(/IF v_external THEN/.test(sql), "scope binding applies to external calls only");
  assert(sql.includes("current_setting('api_e.organization_id', true)"));
  assert(sql.includes("current_setting('api_e.workspace_id', true)"));
  assert(/v_trusted_org[\s\S]{0,200}::uuid/.test(sql));
  assert(/v_trusted_ws[\s\S]{0,200}::uuid/.test(sql));
  assert(
    /EXCEPTION WHEN OTHERS THEN\s*v_trusted_org := NULL;/.test(sql),
    "malformed trusted organization must fail closed",
  );
  assert(
    /EXCEPTION WHEN OTHERS THEN\s*v_trusted_ws := NULL;/.test(sql),
    "malformed trusted workspace must fail closed",
  );
  assert(/v_trusted_org IS NULL/.test(sql));
  assert(/v_trusted_ws IS NULL/.test(sql));
  assert(/v_trusted_org IS DISTINCT FROM _p_org/.test(sql));
  assert(/v_trusted_ws IS DISTINCT FROM _p_ws/.test(sql));

  const lookup = sql.indexOf("FROM public.projects WHERE id = _project_id");
  const binding = sql.indexOf("IF v_external THEN");
  const update = sql.indexOf("UPDATE public.projects");
  assert(binding > lookup, "scope binding runs after structural derivation");
  assert(binding < update, "scope binding runs before the write");
});

Deno.test("12B.2C: no caller-supplied scope, capability or source parameter is added", () => {
  const args = sql.slice(
    sql.indexOf("assign_project_portfolio(_project_id"),
    sql.indexOf(")\n RETURNS void"),
  );
  for (const forbidden of [
    "_organization_id",
    "_workspace_id",
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

Deno.test("12B.2C: existing domain authority and validation remain unchanged", () => {
  assert(sql.includes("RAISE EXCEPTION 'Not authenticated'"));
  assert(sql.includes("RAISE EXCEPTION 'Account is deactivated'"));
  assert(sql.includes("public.has_project_pm_authority(_uid, _project_id)"));
  assert(sql.includes("public.can_write_demo(_uid, _p_ws)"));
  assert(sql.includes("RAISE EXCEPTION 'Demo workspace is read-only'"));
  assert(sql.includes("RAISE EXCEPTION 'Portfolio item not found'"));
  assert(
    sql.includes("RAISE EXCEPTION 'Portfolio item belongs to a different organization'"),
  );
  assert(sql.includes("RAISE EXCEPTION 'Portfolio item is archived'"));
});

Deno.test("12B.2C: clear and same-value semantics are unchanged", () => {
  assert(
    sql.includes("IF _portfolio_item_id IS NOT NULL THEN"),
    "NULL clear must skip target validation exactly as today",
  );
  assert(
    /IF _current IS NOT DISTINCT FROM _portfolio_item_id THEN\s*RETURN;/.test(sql),
    "same-value assignment must remain a no-op without UPDATE or logging",
  );
});

Deno.test("12B.2C: exactly one narrow UPDATE and unchanged activity event remain", () => {
  const updates = sql.match(/UPDATE public\.projects/g) ?? [];
  assertEquals(updates.length, 1);
  assert(
    /UPDATE public\.projects\s*SET portfolio_item_id = _portfolio_item_id\s*WHERE id = _project_id;/
      .test(sql),
    "the write must remain limited to portfolio_item_id",
  );
  assert(
    /public\.log_activity_event\([\s\S]{0,140}'project_portfolio_changed', 'project', _project_id/
      .test(sql),
  );
  assert(sql.includes("'old_portfolio_item_id', _current"));
  assert(sql.includes("'new_portfolio_item_id', _portfolio_item_id"));
});

Deno.test("12B.2C: no encryption path is introduced", () => {
  assert(!/btpm_encrypt|btpm_decrypt|pgp_sym_(en|de)crypt/.test(sql));
});

Deno.test("12B.2C: no API/MCP wrapper or frontend source is modified", async () => {
  const hook = await Deno.readTextFile(
    new URL("../../../src/hooks/useProjectPortfolio.ts", import.meta.url),
  );
  assert(
    hook.includes('supabase.rpc("assign_project_portfolio"'),
    "the ordinary browser must still call the canonical RPC directly",
  );
  assert(
    !hook.includes("api_e.source_channel") && !hook.includes("capability_key"),
    "frontend must not supply trusted-context values",
  );
});
