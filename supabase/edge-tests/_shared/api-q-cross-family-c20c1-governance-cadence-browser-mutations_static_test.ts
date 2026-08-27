/**
 * API-Q Cross-Family-C20C1 — Governance Cadence Browser Mutations
 * Outer OAuth / Authentication Boundary Closure.
 *
 * Focused static/contract test over the forward-only migration that redefines
 * exactly five Governance Cadence mutation signatures.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20260820090753_dffd415d-3ac2-4a09-a577-e78d3bfee705.sql";
const HOOK = "src/hooks/useProjectGovernance.ts";

const sql = await Deno.readTextFile(MIGRATION);
const lower = sql.toLowerCase();

const HEADERS = [
  "public.archive_governance_cadence(_cadence_id uuid)",
  "public.restore_governance_cadence(_cadence_id uuid)",
  "public.adjust_governance_cadence_next_expected_date(_cadence_id uuid, _next_expected_date date)",
  // legacy overload (11 args)
  "public.update_governance_cadence(_cadence_id uuid, _event_type text DEFAULT NULL::text, _frequency_type text DEFAULT NULL::text, _event_name text DEFAULT NULL::text, _owner_id uuid DEFAULT NULL::uuid, _next_expected_date date DEFAULT NULL::date, _expected_evidence_type text DEFAULT NULL::text, _clear_event_name boolean DEFAULT false, _clear_owner boolean DEFAULT false, _clear_next_expected_date boolean DEFAULT false, _clear_expected_evidence_type boolean DEFAULT false)",
  // stakeholder-aware overload (13 args)
  "public.update_governance_cadence(_cadence_id uuid, _event_type text DEFAULT NULL::text, _frequency_type text DEFAULT NULL::text, _event_name text DEFAULT NULL::text, _owner_id uuid DEFAULT NULL::uuid, _next_expected_date date DEFAULT NULL::date, _expected_evidence_type text DEFAULT NULL::text, _clear_event_name boolean DEFAULT false, _clear_owner boolean DEFAULT false, _clear_next_expected_date boolean DEFAULT false, _clear_expected_evidence_type boolean DEFAULT false, _owner_stakeholder_id uuid DEFAULT NULL::uuid, _clear_owner_stakeholder boolean DEFAULT false)",
];

/** Split the migration into the five function definition blocks. */
function blocks(): string[] {
  const parts = sql.split("CREATE OR REPLACE FUNCTION ").slice(1);
  return parts.map((p) => "CREATE OR REPLACE FUNCTION " + p);
}
const BLOCKS = blocks();

Deno.test("C20C1.1 exactly five functions redefined, matching the five target signatures", () => {
  assertEquals((sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 5);
  assertEquals(BLOCKS.length, 5);
  for (const h of HEADERS) assert(sql.includes(h), `missing signature: ${h.slice(0, 60)}`);
  // both update overloads present separately
  assertEquals((sql.match(/FUNCTION public\.update_governance_cadence\(/g) ?? []).length, 2);
  // create_governance_cadence untouched
  assertEquals(lower.includes("create_governance_cadence"), false);
});

Deno.test("C20C1.2 properties preserved: void / plpgsql / secdef / volatile / search_path", () => {
  assertEquals((sql.match(/RETURNS void/g) ?? []).length, 5);
  assertEquals((sql.match(/LANGUAGE plpgsql/g) ?? []).length, 5);
  assertEquals((sql.match(/SECURITY DEFINER/g) ?? []).length, 5);
  assertEquals((sql.match(/SET search_path TO 'public'\n/g) ?? []).length, 2); // archive + restore
  assertEquals((sql.match(/SET search_path TO 'public', 'extensions'/g) ?? []).length, 3);
  // no explicit volatility marker introduced
  assert(!/\b(STABLE|IMMUTABLE)\b/i.test(sql));
  assert(!/ALTER FUNCTION|OWNER TO/i.test(sql));
});

Deno.test("C20C1.3 OAuth gate is the first executable security operation in every function", () => {
  for (const b of BLOCKS) {
    const begin = b.indexOf("\nBEGIN");
    const gate = b.indexOf("api_e_private.jwt_client_id()");
    const uid = b.indexOf("auth.uid()");
    const lookup = b.indexOf("FROM governance_cadences WHERE id = _cadence_id");
    assert(gate > begin, "gate after BEGIN");
    assert(gate < uid, "gate before auth.uid()");
    assert(uid < lookup, "auth before cadence lookup");
    const declare = b.slice(b.indexOf("DECLARE"), begin);
    assert(!declare.includes("auth.uid()"), "DECLARE must not initialize auth.uid()");
    assert(declare.includes("v_client_id text"), "v_client_id declared");
    assert(declare.includes("v_caller uuid"), "v_caller declared");
  }
});

Deno.test("C20C1.4 resolver failure maps to unresolved_client; non-null client_id is 42501", () => {
  assertEquals(
    (sql.match(/EXCEPTION WHEN OTHERS THEN\s+v_client_id := 'unresolved_client';/g) ?? []).length,
    5,
  );
  assertEquals(
    (sql.match(
      /IF v_client_id IS NOT NULL THEN\s+RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/g,
    ) ?? []).length,
    5,
  );
});

Deno.test("C20C1.5 no trusted/API/MCP/source-channel/service-role bypass", () => {
  for (
    const banned of [
      "trusted",
      "capability",
      "source_channel",
      "mcp",
      "connected_app",
      "service_role",
      "api_version",
      "api_v1_",
      "rest_",
    ]
  ) {
    assertEquals(lower.includes(banned), false, banned);
  }
});

Deno.test("C20C1.6 auth.uid() resolved exactly once per function; inactive/null denied pre-lookup", () => {
  assertEquals((sql.match(/auth\.uid\(\)/g) ?? []).length, 5);
  assertEquals((sql.match(/v_caller := auth\.uid\(\);/g) ?? []).length, 5);
  assertEquals(
    (sql.match(
      /IF v_caller IS NULL OR NOT public\.is_active_user\(v_caller\) THEN\s+RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';/g,
    ) ?? []).length,
    5,
  );
});

Deno.test("C20C1.7 cadence lookup authoritative, P0002 preserved, write helper ordering", () => {
  for (const b of BLOCKS) {
    assert(
      b.includes("SELECT * INTO _row FROM governance_cadences WHERE id = _cadence_id;"),
      "authoritative lookup",
    );
    const notFound = b.indexOf("RAISE EXCEPTION 'Cadence not found' USING ERRCODE='P0002'");
    const lookup = b.indexOf("FROM governance_cadences WHERE id = _cadence_id");
    const helper = b.indexOf("PERFORM _gov_assert_project_write(_row.project_id);");
    const write = b.indexOf("UPDATE governance_cadences SET");
    assert(notFound > lookup, "missing-row behavior after lookup");
    assert(helper > notFound, "write helper after cadence resolution");
    if (write > 0) assert(write > helper, "persistence after write helper");
    assertEquals((b.match(/_gov_assert_project_write/g) ?? []).length, 1);
  }
  // no duplicated org-membership helper, no substituted authority helper
  for (
    const banned of [
      "is_user_org_member",
      "has_project_pm_authority",
      "can_write_demo",
      "can_read_project",
      "_assert_pm_or_admin",
      "_gov_assert_project_read",
    ]
  ) {
    assertEquals(lower.includes(banned.toLowerCase()), false, banned);
  }
});

Deno.test("C20C1.8 archive and restore behavior preserved", () => {
  const archive = BLOCKS[0];
  assert(archive.includes("public.archive_governance_cadence"));
  assert(archive.includes("IF _row.archived_at IS NULL THEN"), "no-change when archived");
  assert(
    archive.includes(
      "SET archived_at = now(), archived_by = v_caller, updated_at = now()",
    ),
  );
  assert(archive.includes("'governance_cadence_archived', 'governance_cadence', _cadence_id"));

  const restore = BLOCKS[1];
  assert(restore.includes("public.restore_governance_cadence"));
  assert(restore.includes("IF _row.archived_at IS NOT NULL THEN"), "no-change when not archived");
  assert(
    restore.includes("SET archived_at = NULL, archived_by = NULL, updated_at = now()"),
  );
  assert(restore.includes("'governance_cadence_restored', 'governance_cadence', _cadence_id"));
});

Deno.test("C20C1.9 adjust-date validation, persistence and audit metadata preserved", () => {
  const adj = BLOCKS[2];
  assert(adj.includes("public.adjust_governance_cadence_next_expected_date"));
  assert(
    adj.includes("RAISE EXCEPTION 'Cannot adjust archived cadence' USING ERRCODE='42501'"),
  );
  assert(
    adj.includes(
      "IF _row.frequency_type <> 'ad_hoc' AND _next_expected_date IS NULL THEN",
    ),
  );
  assert(
    adj.includes(
      "RAISE EXCEPTION 'Non-ad-hoc cadence requires a next expected date' USING ERRCODE='22023'",
    ),
  );
  assert(adj.includes("_old := _row.next_expected_date;"));
  assert(adj.includes("SET next_expected_date = _next_expected_date"));
  assert(adj.includes("updated_by = v_caller"));
  assert(adj.includes("'governance_cadence_next_expected_date_adjusted'"));
  for (
    const k of [
      "'project_id', _row.project_id",
      "'cadence_id', _cadence_id",
      "'old_next_expected_date', _old",
      "'new_next_expected_date', _next_expected_date",
      "'event_type', _row.event_type",
      "'frequency_type', _row.frequency_type",
    ]
  ) assert(adj.includes(k), k);
});

Deno.test("C20C1.10 legacy update overload fields and clear flags preserved, no stakeholder params", () => {
  const legacy = BLOCKS[3];
  assert(legacy.includes(HEADERS[3]), "legacy signature/defaults");
  assertEquals(legacy.includes("_owner_stakeholder_id"), false);
  assertEquals(legacy.includes("_clear_owner_stakeholder"), false);
  assertEquals(legacy.includes("owner_stakeholder_id"), false);
  for (
    const f of [
      "event_type = COALESCE(_event_type, event_type)",
      "frequency_type = COALESCE(_frequency_type, frequency_type)",
      "event_name = CASE WHEN _clear_event_name THEN NULL ELSE COALESCE(_event_name, event_name) END",
      "owner_id = CASE WHEN _clear_owner THEN NULL ELSE COALESCE(_owner_id, owner_id) END",
      "next_expected_date = CASE WHEN _clear_next_expected_date THEN NULL ELSE COALESCE(_next_expected_date, next_expected_date) END",
      "expected_evidence_type = CASE WHEN _clear_expected_evidence_type THEN NULL ELSE COALESCE(_expected_evidence_type, expected_evidence_type) END",
      "updated_at = now()",
      "updated_by = v_caller",
      "'governance_cadence_updated', 'governance_cadence', _cadence_id",
    ]
  ) assert(legacy.includes(f), f);
});

Deno.test("C20C1.11 stakeholder-aware overload lookup, back-compat and owner semantics preserved", () => {
  const sh = BLOCKS[4];
  assert(sh.includes(HEADERS[4]), "stakeholder signature/defaults");
  assert(sh.includes("_sh project_stakeholders%ROWTYPE"));
  assert(sh.includes("_eff_owner_id := _owner_id;"));
  assert(
    sh.includes(
      "WHERE id = _owner_stakeholder_id AND project_id = _row.project_id;",
    ),
    "stakeholder lookup restricted to cadence project",
  );
  assert(
    sh.includes(
      "RAISE EXCEPTION 'Stakeholder not found for this project' USING ERRCODE='P0002'",
    ),
  );
  assert(
    sh.includes(
      "IF _sh.stakeholder_type = 'workspace_member' AND _sh.user_id IS NOT NULL AND _eff_owner_id IS NULL THEN",
    ),
    "workspace_member back-compat",
  );
  assert(sh.includes("_eff_owner_id := _sh.user_id;"));
  assert(sh.includes("WHEN _clear_owner OR _clear_owner_stakeholder THEN NULL"));
  assert(sh.includes("WHEN _clear_owner_stakeholder THEN NULL"));
  assert(sh.includes("COALESCE(_owner_stakeholder_id, owner_stakeholder_id)"));
  assert(sh.includes("updated_by = v_caller"));
  assert(sh.includes("'governance_cadence_updated', 'governance_cadence', _cadence_id"));
});

Deno.test("C20C1.12 all actor persistence/audit writes use v_caller", () => {
  assert(!/archived_by = auth\.uid\(\)/.test(sql));
  assert(!/updated_by = auth\.uid\(\)/.test(sql));
  assert(!/log_activity_event\([^,]+, auth\.uid\(\)/.test(sql));
  assertEquals((sql.match(/log_activity_event\(_row\.organization_id, v_caller,/g) ?? []).length, 5);
});

Deno.test("C20C1.13 no GRANT/REVOKE and no schema/RLS/trigger/encryption/DML drift", () => {
  for (
    const banned of [
      "grant ",
      "revoke ",
      "create policy",
      "alter policy",
      "drop policy",
      "row level security",
      "create table",
      "alter table",
      "create index",
      "create trigger",
      "drop trigger",
      "drop function",
      "btpm_encrypt",
      "btpm_decrypt",
      "insert into",
      "delete from",
      "truncate",
      ".tsx",
      ".ts\"",
      "supabase.rpc",
    ]
  ) {
    assertEquals(lower.includes(banned), false, banned);
  }
  // only governance_cadences is written
  assertEquals((sql.match(/UPDATE governance_cadences SET/g) ?? []).length, 4);
  assertEquals((sql.match(/UPDATE governance_cadences\b/g) ?? []).length, 5);
});

Deno.test("C20C1.14 committed browser caller remains unchanged and caller-scoped", async () => {
  const src = await Deno.readTextFile(HOOK);
  for (
    const rpc of [
      "update_governance_cadence",
      "archive_governance_cadence",
      "restore_governance_cadence",
      "adjust_governance_cadence_next_expected_date",
    ]
  ) {
    assert(src.includes(`supabase.rpc("${rpc}"`), `${rpc} browser call present`);
  }
  assertEquals(src.includes("SERVICE_ROLE"), false, "no service-role caller in hook");
});
