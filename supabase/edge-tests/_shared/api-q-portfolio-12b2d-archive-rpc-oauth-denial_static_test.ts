// API-Q Portfolio-12B.2D — Canonical Portfolio Archive/Unarchive RPC
// External-OAuth Denial (durable focused static test).
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename) and verifies the executable
// SQL of the single redefined function public.admin_archive_portfolio_item.
//
// No database access, no network access, no Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER =
  "API-Q Portfolio-12B.2D — Canonical Portfolio Archive/Unarchive RPC External-OAuth Denial";

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

Deno.test("12B.2D: exactly one forward-only migration owns this correction", () => {
  assertEquals(found.length, 1, "exactly one migration must carry the marker");
});

Deno.test("12B.2D: only admin_archive_portfolio_item is replaced", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION public.admin_archive_portfolio_item",
  ]);
  for (const forbidden of [
    "admin_create_portfolio_item",
    "admin_update_portfolio_item",
    "assign_project_portfolio",
    "admin_assign_projects_to_portfolio",
    "admin_list_portfolio_items",
    "get_portfolio_item_project_membership_summary",
    "api_v1_",
    "mcp_v1_",
    "execute_v1_",
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

Deno.test("12B.2D: signature, default and return type are unchanged", () => {
  assert(
    sql.includes(
      "CREATE OR REPLACE FUNCTION public.admin_archive_portfolio_item(_portfolio_item_id uuid, _is_archived boolean DEFAULT true)",
    ),
    "exact signature and default must be preserved",
  );
  assert(/RETURNS void/.test(sql));
});

Deno.test("12B.2D: SECURITY DEFINER and pinned search_path remain", () => {
  assert(/\bSECURITY DEFINER\b/.test(sql));
  assert(/SET search_path TO 'public'/.test(sql));
});

Deno.test("12B.2D: privileges are preserved, not widened", () => {
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.admin_archive_portfolio_item(uuid, boolean) FROM PUBLIC;",
    ),
  );
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.admin_archive_portfolio_item(uuid, boolean) FROM anon;",
    ),
  );
  assert(
    sql.includes(
      "GRANT EXECUTE ON FUNCTION public.admin_archive_portfolio_item(uuid, boolean) TO authenticated;",
    ),
    "authenticated execution must remain for the ordinary browser",
  );
  assert(!/GRANT[^;]*TO service_role/.test(sql), "no service_role grant may be added");
  assert(!/GRANT[^;]*TO (PUBLIC|anon)/.test(sql));
});

Deno.test("12B.2D: OAuth identity is server-derived and fails closed", () => {
  assert(sql.includes("v_client_id := api_e_private.jwt_client_id();"));
  assert(
    /EXCEPTION WHEN OTHERS THEN\s*v_client_id := 'unresolved_client';/.test(sql),
    "unresolved jwt_client_id must fail closed as external/untrusted",
  );
  assert(
    /IF v_client_id IS NOT NULL THEN\s*RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';\s*END IF;/
      .test(sql),
    "any non-NULL client id must be denied unconditionally",
  );
});

Deno.test("12B.2D: no caller-supplied client/source/capability parameter is added", () => {
  const args = sql.slice(
    sql.indexOf("admin_archive_portfolio_item(_portfolio_item_id"),
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

Deno.test("12B.2D: no capability-aware trusted execution is introduced", () => {
  assert(
    !sql.includes("assert_trusted_context"),
    "trusted context must never make archive/unarchive callable externally",
  );
  assert(!sql.includes("api_e.api_version"));
  assert(!sql.includes("api_e.capability_key"));
  assert(!sql.includes("api_e.capability_kind"));
  assert(!sql.includes("api_e.source_channel"));
  assert(!sql.includes("api_e.organization_id"));
  assert(!sql.includes("api_e.workspace_id"));
  assert(!sql.includes("external_api"));
  assert(!sql.includes("mcp"));
  assert(!sql.includes("btpm_ui"));
  assert(!/portfolios:(archive|unarchive|create|update|assign_project)/.test(sql));
});

Deno.test("12B.2D: denial is a single generic 42501", () => {
  const denials = sql.match(/RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/g) ?? [];
  assertEquals(denials.length, 1, "exactly one bounded generic external denial");
});

Deno.test("12B.2D: denial precedes every business step", () => {
  const guard = sql.indexOf("USING ERRCODE = '42501'");
  const active = sql.indexOf("public.is_active_user(_uid)");
  const lookup = sql.indexOf("FROM public.portfolio_items WHERE id = _portfolio_item_id");
  const notFound = sql.indexOf("RAISE EXCEPTION 'Portfolio item not found'");
  const orgAdmin = sql.indexOf("public.is_org_admin(_uid, _org)");
  const update = sql.indexOf("UPDATE public.portfolio_items");
  const log = sql.indexOf("public.log_activity_event");
  assert(guard > -1);
  for (const idx of [active, lookup, notFound, orgAdmin, update, log]) {
    assert(idx > guard, "denial must precede all business logic");
  }
});

Deno.test("12B.2D: existing canonical browser semantics remain unchanged", () => {
  assert(sql.includes("RAISE EXCEPTION 'Not authenticated'"));
  assert(sql.includes("RAISE EXCEPTION 'Account is deactivated'"));
  assert(sql.includes("SELECT organization_id INTO _org FROM public.portfolio_items"));
  assert(sql.includes("IF NOT public.is_org_admin(_uid, _org) THEN RAISE EXCEPTION 'Not authorized'"));
  const updates = sql.match(/UPDATE public\.portfolio_items/g) ?? [];
  assertEquals(updates.length, 1, "exactly one narrow archive UPDATE remains");
  assert(sql.includes("SET is_archived = _is_archived"));
  assert(
    sql.includes("archived_at = CASE WHEN _is_archived THEN now() ELSE NULL END"),
    "archive sets archived_at, unarchive clears it",
  );
  assert(sql.includes("updated_by = _uid"));
  assert(
    /CASE WHEN _is_archived THEN 'portfolio_archived' ELSE 'portfolio_unarchived' END/.test(sql),
    "existing activity event names must remain",
  );
  assert(sql.includes("'portfolio', _portfolio_item_id"));
});

Deno.test("12B.2D: no encryption path is introduced", () => {
  assert(!/btpm_encrypt|btpm_decrypt|pgp_sym_(en|de)crypt/.test(sql));
});

Deno.test("12B.2D: frontend still calls the canonical RPC for archive and unarchive", async () => {
  const hook = await Deno.readTextFile(
    new URL("../../../src/hooks/useAdminPortfolioItems.ts", import.meta.url),
  );
  const calls = hook.match(/supabase\.rpc\("admin_archive_portfolio_item"/g) ?? [];
  assertEquals(calls.length, 2, "archive and unarchive both use the canonical RPC");
  assert(hook.includes("_is_archived: true"));
  assert(hook.includes("_is_archived: false"));
  assert(
    !hook.includes("api_e.source_channel") && !hook.includes("capability_key"),
    "frontend must not supply trusted-context values",
  );
});
