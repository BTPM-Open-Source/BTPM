/**
 * API-Q Cross-Family-C20C2 — static/contract test.
 *
 * Verifies the C20C2 migration closes the outer OAuth / authentication gap for
 * exactly the three effective Governance Record core mutation signatures
 * (archive, restore, current extended update) without behavioral, ACL,
 * signature, encryption, schema, RLS or frontend drift.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20260820092621_6ff22f18-59bb-4370-97e2-69a922e388d4.sql";
const HOOK = "src/hooks/useProjectGovernance.ts";

const sql = await Deno.readTextFile(MIGRATION);

function bodyOf(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert(start >= 0, `${name} not redefined`);
  const next = sql.indexOf("CREATE OR REPLACE FUNCTION", start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

const ARCHIVE = bodyOf("archive_governance_record");
const RESTORE = bodyOf("restore_governance_record");
const UPDATE = bodyOf("update_governance_record");
const ALL: Array<[string, string]> = [
  ["archive_governance_record", ARCHIVE],
  ["restore_governance_record", RESTORE],
  ["update_governance_record", UPDATE],
];

const UPDATE_ARGS = [
  "_record_id uuid",
  "_event_type text DEFAULT NULL::text",
  "_actual_date_held date DEFAULT NULL::date",
  "_cadence_id uuid DEFAULT NULL::uuid",
  "_event_name text DEFAULT NULL::text",
  "_expected_date_snapshot date DEFAULT NULL::date",
  "_summary text DEFAULT NULL::text",
  "_decisions_summary text DEFAULT NULL::text",
  "_external_reference_url text DEFAULT NULL::text",
  "_sharepoint_evidence_reference text DEFAULT NULL::text",
  "_clear_cadence boolean DEFAULT false",
  "_clear_event_name boolean DEFAULT false",
  "_clear_expected_date_snapshot boolean DEFAULT false",
  "_clear_summary boolean DEFAULT false",
  "_clear_decisions_summary boolean DEFAULT false",
  "_clear_external_reference_url boolean DEFAULT false",
  "_clear_sharepoint_evidence_reference boolean DEFAULT false",
  "_decision_stage text DEFAULT NULL::text",
  "_decision_question text DEFAULT NULL::text",
  "_decision_owner_stakeholder_id uuid DEFAULT NULL::uuid",
  "_target_decision_date date DEFAULT NULL::date",
  "_clear_decision_question boolean DEFAULT false",
  "_clear_decision_owner_stakeholder_id boolean DEFAULT false",
  "_clear_target_decision_date boolean DEFAULT false",
];

Deno.test("C20C2: exactly three functions redefined, and only the intended ones", () => {
  const defs = sql.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
  assertEquals(defs.length, 3);
  const names = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)]
    .map((m) => m[1]).sort();
  assertEquals(names, [
    "archive_governance_record",
    "restore_governance_record",
    "update_governance_record",
  ]);
  for (
    const forbidden of [
      "create_governance_record",
      "set_governance_record_decisions",
      "set_governance_record_links",
      "_gov_assert_project_read",
      "apply_governance_record_update",
    ]
  ) {
    assert(
      !sql.includes(`FUNCTION public.${forbidden}`),
      `must not redefine ${forbidden}`,
    );
  }
});

Deno.test("C20C2: exact effective update signature and defaults preserved", () => {
  const sig = UPDATE.slice(
    UPDATE.indexOf("(") + 1,
    UPDATE.indexOf(")\n RETURNS"),
  );
  assertEquals(sig.split(", ").map((s) => s.trim()), UPDATE_ARGS);
});

Deno.test("C20C2: return type, language, volatility, secdef and search_path preserved", () => {
  for (const [name, body] of ALL) {
    assert(body.includes("RETURNS void"), `${name} return`);
    assert(body.includes("LANGUAGE plpgsql"), `${name} language`);
    assert(body.includes("SECURITY DEFINER"), `${name} secdef`);
    assert(!/\bIMMUTABLE|\bSTABLE\b/.test(body), `${name} stays volatile`);
  }
  assert(ARCHIVE.includes("SET search_path TO 'public'"));
  assert(RESTORE.includes("SET search_path TO 'public'"));
  assert(UPDATE.includes("SET search_path TO 'pg_catalog', 'public'"));
});

Deno.test("C20C2: OAuth resolver is the first executable security operation", () => {
  for (const [name, body] of ALL) {
    const begin = body.indexOf("\nBEGIN");
    const gate = body.indexOf("api_e_private.jwt_client_id()");
    const raise = body.indexOf("'Not authorized'");
    const uid = body.indexOf("auth.uid()");
    const lookup = body.indexOf("FROM governance_records WHERE id = _record_id");
    assert(gate > begin, `${name} gate after BEGIN`);
    assert(raise > gate && raise < uid, `${name} rejection before auth resolution`);
    assert(uid < lookup, `${name} auth before record lookup`);
    const declare = body.slice(body.indexOf("DECLARE"), begin);
    assert(!declare.includes("auth.uid()"), `${name} DECLARE clean`);
  }
});

Deno.test("C20C2: resolver failure maps to unresolved_client; non-null client is 42501", () => {
  for (const [name, body] of ALL) {
    assert(
      /EXCEPTION WHEN OTHERS THEN\s+v_client_id := 'unresolved_client';/.test(body),
      `${name} unresolved_client`,
    );
    assert(
      /IF v_client_id IS NOT NULL THEN\s+RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';/
        .test(body),
      `${name} fail-closed 42501`,
    );
  }
});

Deno.test("C20C2: no trusted/API/MCP/source-channel/service-role bypass", () => {
  for (const [name, body] of ALL) {
    for (
      const forbidden of [
        "trusted",
        "capability",
        "source_channel",
        "mcp",
        "connected_app",
        "service_role",
        "assert_trusted_context",
      ]
    ) {
      assert(
        !body.toLowerCase().includes(forbidden),
        `${name} must not reference ${forbidden}`,
      );
    }
  }
});

Deno.test("C20C2: auth.uid() resolves exactly once into v_caller and gates active users", () => {
  for (const [name, body] of ALL) {
    assertEquals(body.split("auth.uid()").length - 1, 1, `${name} single auth.uid()`);
    assert(body.includes("v_caller := auth.uid();"), `${name} v_caller`);
    assert(
      /IF v_caller IS NULL OR NOT public\.is_active_user\(v_caller\) THEN\s+RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';/
        .test(body),
      `${name} unauthorized semantics`,
    );
  }
});

Deno.test("C20C2: authoritative record lookup, P0002 and write helper ordering preserved", () => {
  for (const [name, body] of ALL) {
    assert(
      body.includes("SELECT * INTO _row FROM governance_records WHERE id = _record_id;"),
      `${name} lookup`,
    );
    const lookup = body.indexOf("FROM governance_records WHERE id = _record_id");
    const notFound = body.indexOf("'Record not found' USING ERRCODE='P0002'");
    const helper = body.indexOf("PERFORM _gov_assert_project_write(_row.project_id);");
    const write = body.indexOf("UPDATE governance_records SET");
    assert(notFound > lookup, `${name} missing-row behavior`);
    assert(helper > notFound, `${name} helper after record resolution`);
    assert(write > helper, `${name} helper before write`);
    for (
      const forbidden of [
        "has_project_pm_authority",
        "can_write_demo",
        "can_read_project",
        "is_user_org_member",
      ]
    ) {
      assert(!body.includes(forbidden), `${name} must not add ${forbidden}`);
    }
  }
});

Deno.test("C20C2: archive semantics preserved with v_caller actor", () => {
  assert(ARCHIVE.includes("IF _row.archived_at IS NULL THEN"), "no-change guard");
  assert(
    ARCHIVE.includes(
      "SET archived_at = now(), archived_by = v_caller, updated_at = now()",
    ),
    "archive persistence",
  );
  assert(ARCHIVE.includes("'governance_record_archived', 'governance_record', _record_id"));
  assert(
    ARCHIVE.includes("log_activity_event(_row.organization_id, v_caller,"),
    "audit actor",
  );
  assert(
    ARCHIVE.includes("jsonb_build_object('project_id', _row.project_id), _row.workspace_id)"),
    "audit metadata",
  );
});

Deno.test("C20C2: restore semantics preserved with v_caller actor", () => {
  assert(RESTORE.includes("IF _row.archived_at IS NOT NULL THEN"), "no-change guard");
  assert(
    RESTORE.includes(
      "SET archived_at = NULL, archived_by = NULL, updated_at = now()",
    ),
    "restore persistence",
  );
  assert(RESTORE.includes("'governance_record_restored', 'governance_record', _record_id"));
  assert(RESTORE.includes("log_activity_event(_row.organization_id, v_caller,"));
  assert(
    RESTORE.includes("jsonb_build_object('project_id', _row.project_id), _row.workspace_id)"),
  );
});

Deno.test("C20C2: update evidence_record branch retains all fields and clear flags", () => {
  assert(UPDATE.includes("IF _row.record_kind = 'evidence_record' THEN"), "branch");
  const branch = UPDATE.slice(
    UPDATE.indexOf("IF _row.record_kind = 'evidence_record' THEN"),
    UPDATE.indexOf("\n  ELSE"),
  );
  for (
    const expr of [
      "event_type = COALESCE(_event_type, event_type)",
      "actual_date_held = COALESCE(_actual_date_held, actual_date_held)",
      "cadence_id = CASE WHEN _clear_cadence THEN NULL ELSE COALESCE(_cadence_id, cadence_id) END",
      "event_name = CASE WHEN _clear_event_name THEN NULL ELSE COALESCE(_event_name, event_name) END",
      "expected_date_snapshot = CASE WHEN _clear_expected_date_snapshot THEN NULL ELSE COALESCE(_expected_date_snapshot, expected_date_snapshot) END",
      "summary = CASE WHEN _clear_summary THEN NULL ELSE COALESCE(_summary, summary) END",
      "decisions_summary = CASE WHEN _clear_decisions_summary THEN NULL ELSE COALESCE(_decisions_summary, decisions_summary) END",
      "external_reference_url = CASE WHEN _clear_external_reference_url THEN NULL ELSE COALESCE(_external_reference_url, external_reference_url) END",
      "sharepoint_evidence_reference = CASE WHEN _clear_sharepoint_evidence_reference THEN NULL ELSE COALESCE(_sharepoint_evidence_reference, sharepoint_evidence_reference) END",
      "updated_by = v_caller",
    ]
  ) {
    assert(branch.includes(expr), `evidence branch missing: ${expr}`);
  }
  for (
    const leak of [
      "decision_stage =",
      "decision_question =",
      "decision_owner_stakeholder_id =",
      "target_decision_date =",
    ]
  ) {
    assert(!branch.includes(leak), `evidence branch must not set ${leak}`);
  }
});

Deno.test("C20C2: update decision_case branch retains Decision Case fields and clear flags", () => {
  const branch = UPDATE.slice(UPDATE.indexOf("\n  ELSE"));
  for (
    const expr of [
      "decision_stage = COALESCE(_decision_stage, decision_stage)",
      "decision_question = CASE WHEN _clear_decision_question THEN NULL ELSE COALESCE(_decision_question, decision_question) END",
      "decision_owner_stakeholder_id = CASE WHEN _clear_decision_owner_stakeholder_id THEN NULL ELSE COALESCE(_decision_owner_stakeholder_id, decision_owner_stakeholder_id) END",
      "target_decision_date = CASE WHEN _clear_target_decision_date THEN NULL ELSE COALESCE(_target_decision_date, target_decision_date) END",
      "summary = CASE WHEN _clear_summary THEN NULL ELSE COALESCE(_summary, summary) END",
      "sharepoint_evidence_reference = CASE WHEN _clear_sharepoint_evidence_reference THEN NULL ELSE COALESCE(_sharepoint_evidence_reference, sharepoint_evidence_reference) END",
      "updated_by = v_caller",
    ]
  ) {
    assert(branch.includes(expr), `decision branch missing: ${expr}`);
  }
});

Deno.test("C20C2: same-project decision-owner stakeholder validation preserved", () => {
  assert(
    UPDATE.includes("FROM project_stakeholders s") &&
      UPDATE.includes("AND s.project_id = _row.project_id"),
    "same-project validation",
  );
  assert(
    UPDATE.includes(
      "RAISE EXCEPTION 'Decision owner stakeholder does not belong to this project' USING ERRCODE='22023'",
    ),
    "error preserved",
  );
  assert(
    UPDATE.includes("IF NOT _clear_decision_owner_stakeholder_id"),
    "clear-flag guard preserved",
  );
});

Deno.test("C20C2: update audit uses v_caller and preserves metadata", () => {
  assert(UPDATE.includes("log_activity_event(_row.organization_id, v_caller,"));
  assert(UPDATE.includes("'governance_record_updated', 'governance_record', _record_id"));
  assert(UPDATE.includes("'record_kind', _row.record_kind"));
  assert(UPDATE.includes("_row.workspace_id)"));
});

Deno.test("C20C2: no record_kind/lifecycle/cadence redesign", () => {
  assert(
    !/^\s*record_kind\s*=/m.test(UPDATE),
    "no record_kind assignment in any UPDATE SET list",
  );
  assert(!/UPDATE governance_cadences/i.test(sql), "no cadence writes");
  assert(!/decision_lifecycle|transition_/i.test(sql), "no lifecycle logic");
});

Deno.test("C20C2: no GRANT/REVOKE and no schema/RLS/trigger/encryption drift", () => {
  assert(!/\bGRANT\b/i.test(sql), "no GRANT");
  assert(!/\bREVOKE\b/i.test(sql), "no REVOKE");
  for (
    const re of [
      /CREATE TABLE/i,
      /ALTER TABLE/i,
      /DROP TABLE/i,
      /CREATE POLICY/i,
      /DROP POLICY/i,
      /CREATE TRIGGER/i,
      /DROP TRIGGER/i,
      /CREATE TYPE/i,
      /ALTER TYPE/i,
      /CREATE (UNIQUE )?INDEX/i,
      /btpm_(encrypt|decrypt)/i,
      /INSERT INTO/i,
      /DELETE FROM/i,
      /TRUNCATE/i,
      /pmg_|api_e_(?!private\.jwt_client_id)|mcp_|pbi_/i,
    ]
  ) {
    assert(!re.test(sql), `forbidden construct: ${re}`);
  }
});

Deno.test("C20C2: browser callers remain caller-scoped and unchanged", async () => {
  const hook = await Deno.readTextFile(HOOK);
  assert(
    hook.includes('supabase.rpc("archive_governance_record", { _record_id: recordId })'),
    "archive caller",
  );
  assert(
    hook.includes('supabase.rpc("restore_governance_record", { _record_id: recordId })'),
    "restore caller",
  );
  assert(
    hook.includes('"apply_governance_record_update" as never'),
    "update flows through the PMG wrapper on the browser client",
  );
  assert(!hook.includes("SERVICE_ROLE"), "no service-role client in the hook");
});
