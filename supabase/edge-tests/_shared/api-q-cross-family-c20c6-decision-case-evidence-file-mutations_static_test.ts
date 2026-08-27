/**
 * API-Q Cross-Family-C20C6 — Decision Case Evidence File native browser
 * mutations: OAuth / authentication boundary closure.
 * Focused static/contract test over the forward-only migration.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20260820103803_3964e36d-597e-448c-9f46-22ec0267bf3b.sql";

const sql = await Deno.readTextFile(MIGRATION);
const code = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

const FN = [
  "update_governance_record_evidence_file",
  "archive_governance_record_evidence_file",
  "restore_governance_record_evidence_file",
] as const;

function body(name: string): string {
  const start = code.indexOf(`public.${name}(`);
  assert(start > -1, `missing ${name}`);
  const end = code.indexOf("$function$;", start);
  assert(end > start, `unterminated ${name}`);
  return code.slice(start, end);
}
const B = Object.fromEntries(FN.map((f) => [f, body(f)])) as Record<string, string>;

Deno.test("1. exactly three intended functions are redefined", () => {
  assertEquals((sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 3);
  for (const f of FN) assert(sql.includes(`CREATE OR REPLACE FUNCTION public.${f}(`), f);
});

Deno.test("2. effective signatures/defaults preserved", () => {
  assert(sql.includes(
    "public.update_governance_record_evidence_file(_evidence_file_id uuid, _evidence_title text DEFAULT NULL::text, _evidence_summary text DEFAULT NULL::text, _evidence_date date DEFAULT NULL::date, _relevance_level text DEFAULT NULL::text, _included_in_package boolean DEFAULT NULL::boolean, _clear_evidence_summary boolean DEFAULT false)",
  ));
  assert(sql.includes("public.archive_governance_record_evidence_file(_evidence_file_id uuid)"));
  assert(sql.includes("public.restore_governance_record_evidence_file(_evidence_file_id uuid)"));
});

Deno.test("3. return types / properties / search_path preserved", () => {
  assertEquals((sql.match(/RETURNS void/g) ?? []).length, 3);
  assertEquals((sql.match(/LANGUAGE plpgsql/g) ?? []).length, 3);
  assertEquals((sql.match(/SECURITY DEFINER/g) ?? []).length, 3);
  assertEquals((sql.match(/SET search_path TO 'public', 'extensions'/g) ?? []).length, 3);
  assertEquals(/\bIMMUTABLE\b|\bSTABLE\b|ALTER FUNCTION|OWNER TO/i.test(sql), false);
});

Deno.test("4-6. OAuth resolver is the first executable security operation, fail-closed", () => {
  for (const f of FN) {
    const b = B[f];
    const gate = b.indexOf("api_e_private.jwt_client_id()");
    const deny = b.indexOf("RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'");
    assert(gate > -1 && deny > gate, f);
    assert(/EXCEPTION WHEN OTHERS THEN\s+v_client_id := 'unresolved_client';/.test(b), f);
    assert(/IF v_client_id IS NOT NULL THEN/.test(b), f);
    const exec = b.slice(b.indexOf("\nBEGIN\n"));
    const pre = exec.slice(0, exec.indexOf("api_e_private.jwt_client_id()"));
    assertEquals(
      /SELECT|governance_record|_gov_assert|auth\.uid\(\)/i.test(pre),
      false,
      f,
    );
  }
});

Deno.test("7. no trusted/API/MCP/capability/source-channel/service-role bypass", () => {
  for (
    const forbidden of [
      "trusted",
      "capability",
      "source_channel",
      "mcp",
      "connected_app",
      "service_role",
      "api_capability",
      "idempotency",
      "has_project_pm_authority",
      "can_write_demo",
    ]
  ) assertEquals(sql.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
});

Deno.test("8-9. auth.uid() resolves once into v_caller; denied before protected lookups", () => {
  for (const f of FN) {
    const b = B[f];
    assertEquals(b.split("auth.uid()").length - 1, 1, f);
    assert(b.includes("v_caller := auth.uid();"), f);
    assert(
      /IF v_caller IS NULL OR NOT public\.is_active_user\(v_caller\) THEN\s+RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';/
        .test(b),
      f,
    );
    assert(b.indexOf("SELECT * INTO _ev") > b.indexOf("RAISE EXCEPTION 'Unauthorized'"), f);
    assertEquals(/DECLARE[\s\S]*?auth\.uid\(\)[\s\S]*?\nBEGIN/.test(b), false, f);
  }
});

Deno.test("10-11. Evidence File and parent Governance Record lookups + P0002 preserved", () => {
  for (const f of FN) {
    const b = B[f];
    assert(b.includes(
      "SELECT * INTO _ev FROM governance_record_evidence_files WHERE id = _evidence_file_id;",
    ), f);
    assert(b.includes("RAISE EXCEPTION 'Evidence file not found' USING ERRCODE='P0002'"), f);
    assert(b.includes(
      "SELECT * INTO _row FROM governance_records WHERE id = _ev.governance_record_id;",
    ), f);
    assert(b.includes("RAISE EXCEPTION 'Parent record not found' USING ERRCODE='P0002'"), f);
    assert(b.indexOf("SELECT * INTO _ev") < b.indexOf("SELECT * INTO _row"), f);
  }
});

Deno.test("12. _gov_assert_project_write precedes record_kind/type validation", () => {
  for (const f of FN) {
    const b = B[f];
    const w = b.indexOf("_gov_assert_project_write(_row.project_id)");
    const k = b.indexOf("_row.record_kind IS DISTINCT FROM 'decision_case'");
    assert(w > -1 && k > w, f);
    assert(b.includes(
      "RAISE EXCEPTION 'Evidence files are only allowed on decision_case records' USING ERRCODE='22023'",
    ), f);
    assertEquals((b.match(/_gov_assert_project_write/g) ?? []).length, 1, f);
    assertEquals(/is_user_org_member|is_user_workspace_member/.test(b), false, f);
  }
});

Deno.test("13-14. update validation and _clear_evidence_summary semantics preserved", () => {
  const b = B[FN[0]];
  for (
    const s of [
      "_relevance_level IS NOT NULL AND _relevance_level NOT IN ('high','medium','low')",
      "RAISE EXCEPTION 'Invalid relevance_level' USING ERRCODE='22023'",
      "_t := NULLIF(trim(_evidence_title), '');",
      "RAISE EXCEPTION 'Evidence title cannot be blank' USING ERRCODE='22023'",
      "_s := NULLIF(trim(_evidence_summary), '');",
      "evidence_title = COALESCE(_t, evidence_title)",
      "evidence_summary = CASE WHEN _clear_evidence_summary THEN NULL",
      "WHEN _evidence_summary IS NOT NULL THEN _s",
      "ELSE evidence_summary END",
      "evidence_date = COALESCE(_evidence_date, evidence_date)",
      "relevance_level = COALESCE(_relevance_level, relevance_level)",
      "included_in_package = COALESCE(_included_in_package, included_in_package)",
      "updated_at = now()",
    ]
  ) assert(b.includes(s), s);
});

Deno.test("15. immutable SharePoint reference fields are never written", () => {
  for (
    const col of [
      "site_id",
      "drive_id",
      "item_id",
      "item_reference_hash",
      "file_name",
      "file_extension",
      "mime_type",
      "etag",
      "ctag",
      "parent_path",
      "sharepoint_web_url",
      "source_system",
    ]
  ) assertEquals(sql.includes(col), false, col);
  // update writes exactly the editable metadata + audit columns
  const set = B[FN[0]].slice(
    B[FN[0]].indexOf("UPDATE governance_record_evidence_files SET"),
    B[FN[0]].lastIndexOf("WHERE id = _evidence_file_id;"),
  );
  const assigned = [...set.matchAll(/\n\s*([a-z_]+) = /g)].map((m) => m[1]).sort();
  assertEquals(assigned, [
    "evidence_date",
    "evidence_summary",
    "evidence_title",
    "included_in_package",
    "relevance_level",
    "updated_at",
    "updated_by",
  ]);
});

Deno.test("16-17. archive and restore semantics preserved", () => {
  assert(B[FN[1]].includes(
    "SET archived_at = now(), archived_by = v_caller, updated_by = v_caller, updated_at = now()",
  ));
  assert(B[FN[2]].includes(
    "SET archived_at = NULL, archived_by = NULL, updated_by = v_caller, updated_at = now()",
  ));
  assertEquals(/DELETE FROM governance_record_evidence_files/i.test(sql), false);
  // no invented idempotency / no-change short-circuit
  assertEquals(/archived_at IS NULL THEN\s+RETURN|IF _ev\.archived_at/i.test(sql), false);
});

Deno.test("18-19. v_caller persistence/audit; activity event names + metadata preserved", () => {
  for (const f of FN) {
    const b = B[f];
    assert(b.includes("PERFORM log_activity_event(_row.organization_id, v_caller,"), f);
    assert(b.includes(
      "jsonb_build_object('project_id', _row.project_id, 'evidence_file_id', _evidence_file_id)",
    ), f);
    assert(b.includes("'governance_record', _ev.governance_record_id,"), f);
    assert(b.includes("_row.workspace_id);"), f);
    assert(b.includes("updated_by = v_caller"), f);
  }
  for (
    const ev of [
      "'governance_record_evidence_file_updated'",
      "'governance_record_evidence_file_archived'",
      "'governance_record_evidence_file_restored'",
    ]
  ) assert(sql.includes(ev), ev);
});

Deno.test("20. evidence-file encryption/trigger architecture untouched", () => {
  assertEquals(/btpm_encrypt|btpm_decrypt|tenant_encryption|pgp_/i.test(sql), false);
  assertEquals(/CREATE (OR REPLACE )?TRIGGER|DROP TRIGGER|ALTER TABLE/i.test(sql), false);
});

Deno.test("21. browser hook remains the unchanged caller", async () => {
  const hook = await Deno.readTextFile("src/hooks/useGovernanceEvidenceFiles.ts");
  for (const f of FN) assert(hook.includes(`"${f}"`), f);
  assert(hook.includes('from "@/integrations/supabase/client"'));
  assertEquals(/service_role|SERVICE_ROLE/.test(hook), false);
  assertEquals(/\.tsx?|src\//.test(sql), false);
});

Deno.test("22. SharePoint browse/select Edge Functions untouched by this migration", async () => {
  for (
    const p of [
      "supabase/functions/select-governance-decision-sharepoint-evidence-files/index.ts",
      "supabase/functions/browse-governance-decision-sharepoint-files/index.ts",
    ]
  ) {
    const src = await Deno.readTextFile(p);
    assert(src.length > 0, p);
    assert(src.includes("assertBrowserSessionOnly"), p);
  }
  assertEquals(/sharepoint|select-governance|browse-governance/i.test(sql), false);
});

Deno.test("23. no other direct caller / no native create RPC added", () => {
  assertEquals(sql.includes("create_governance_record_evidence_file"), false);
});

Deno.test("24. no GRANT/REVOKE", () => {
  assertEquals(/\bGRANT\b|\bREVOKE\b/i.test(sql), false);
});

Deno.test("25. no API/MCP/PMG/reporting/schema/RLS/business-data drift", () => {
  assertEquals(
    /CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE POLICY|ALTER POLICY|DROP POLICY|CREATE INDEX|CREATE TYPE|CREATE SCHEMA/i
      .test(sql),
    false,
  );
  assertEquals(/pmg_command_audit|pbi_reporting|apply_governance_record/i.test(sql), false);
  const topLevel = sql.replace(/\$function\$[\s\S]*?\$function\$/g, "");
  assertEquals(/INSERT INTO|UPDATE |DELETE FROM/i.test(topLevel), false);
  for (
    const untouched of [
      "list_governance_record_evidence_files",
      "evidence_reference",
      "governance_record_btpm_context_links",
      "governance_record_cross_project_links",
      "governance_record_brief_versions",
      "governance_record_stakeholder_packages",
      "governance_record_copilot_data_packages",
      "close_governance_decision_case",
      "upsert_governance_record_decision_outcome",
      "_gov_assert_project_read",
    ]
  ) assertEquals(sql.includes(untouched), false, untouched);
});
