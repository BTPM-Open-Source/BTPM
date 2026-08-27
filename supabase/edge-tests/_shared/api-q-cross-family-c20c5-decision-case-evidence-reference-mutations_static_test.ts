/**
 * API-Q Cross-Family-C20C5 — Decision Case Evidence Reference browser mutations:
 * OAuth/authentication boundary closure and owner-stakeholder tenant containment.
 * Focused static/contract test over the forward-only migration.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20260820103034_f52097e7-151c-4827-a212-a1b9313feb36.sql";

const sql = await Deno.readTextFile(MIGRATION);
const code = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

const FN = [
  "create_governance_record_evidence_reference",
  "update_governance_record_evidence_reference",
  "archive_governance_record_evidence_reference",
  "restore_governance_record_evidence_reference",
] as const;

/** Body of one redefined function (between its CREATE header and $function$ end). */
function body(name: string): string {
  const start = code.indexOf(`public.${name}(`);
  assert(start > -1, `missing ${name}`);
  const end = code.indexOf("$function$;", start);
  assert(end > start, `unterminated ${name}`);
  return code.slice(start, end);
}
const B = Object.fromEntries(FN.map((f) => [f, body(f)])) as Record<string, string>;

Deno.test("1. exactly four intended functions are redefined", () => {
  assertEquals((sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 4);
  for (const f of FN) assert(sql.includes(`CREATE OR REPLACE FUNCTION public.${f}(`), f);
});

Deno.test("2. effective signatures/defaults preserved", () => {
  assert(sql.includes(
    "public.create_governance_record_evidence_reference(_record_id uuid, _evidence_type text, _title text, _external_url text, _summary text DEFAULT NULL::text, _evidence_date date DEFAULT NULL::date, _owner_stakeholder_id uuid DEFAULT NULL::uuid, _relevance_level text DEFAULT 'medium'::text, _included_in_package boolean DEFAULT true)",
  ));
  assert(sql.includes(
    "public.update_governance_record_evidence_reference(_evidence_id uuid, _evidence_type text DEFAULT NULL::text, _title text DEFAULT NULL::text, _external_url text DEFAULT NULL::text, _summary text DEFAULT NULL::text, _evidence_date date DEFAULT NULL::date, _owner_stakeholder_id uuid DEFAULT NULL::uuid, _relevance_level text DEFAULT NULL::text, _included_in_package boolean DEFAULT NULL::boolean, _clear_summary boolean DEFAULT false, _clear_evidence_date boolean DEFAULT false, _clear_owner_stakeholder_id boolean DEFAULT false)",
  ));
  assert(sql.includes("public.archive_governance_record_evidence_reference(_evidence_id uuid)"));
  assert(sql.includes("public.restore_governance_record_evidence_reference(_evidence_id uuid)"));
});

Deno.test("3. return types / properties / search_path preserved", () => {
  assertEquals((sql.match(/RETURNS uuid/g) ?? []).length, 1);
  assertEquals((sql.match(/RETURNS void/g) ?? []).length, 3);
  assertEquals((sql.match(/LANGUAGE plpgsql/g) ?? []).length, 4);
  assertEquals((sql.match(/SECURITY DEFINER/g) ?? []).length, 4);
  assertEquals((sql.match(/SET search_path TO 'public', 'extensions'/g) ?? []).length, 4);
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
    // nothing business-related precedes the gate in the executable section
    const exec = b.slice(b.indexOf("\nBEGIN\n"));
    const pre = exec.slice(0, exec.indexOf("api_e_private.jwt_client_id()"));
    assertEquals(/SELECT|governance_record|project_stakeholders|auth\.uid\(\)/i.test(pre), false, f);
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
    ]
  ) assertEquals(sql.toLowerCase().includes(forbidden), false, forbidden);
});

Deno.test("8-9. auth.uid() resolves once into v_caller, denied before protected lookups", () => {
  for (const f of FN) {
    const b = B[f];
    assertEquals(b.split("auth.uid()").length - 1, 1, f);
    assert(b.includes("v_caller := auth.uid();"), f);
    assert(
      /IF v_caller IS NULL OR NOT public\.is_active_user\(v_caller\) THEN\s+RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';/
        .test(b),
      f,
    );
    const authDeny = b.indexOf("RAISE EXCEPTION 'Unauthorized'");
    const firstLookup = b.indexOf("SELECT * INTO");
    assert(firstLookup > authDeny, f);
    assertEquals(/DECLARE[\s\S]*?auth\.uid\(\)[\s\S]*?BEGIN/.test(b), false, f);
  }
});

Deno.test("10. create Governance Record lookup / P0002 preserved", () => {
  const b = B[FN[0]];
  assert(b.includes("SELECT * INTO _row FROM governance_records WHERE id = _record_id;"));
  assert(b.includes("RAISE EXCEPTION 'Record not found' USING ERRCODE='P0002'"));
});

Deno.test("11. update/archive/restore evidence + parent lookup contracts preserved", () => {
  for (const f of FN.slice(1)) {
    const b = B[f];
    assert(b.includes(
      "SELECT * INTO _ev FROM governance_record_evidence_references WHERE id = _evidence_id;",
    ), f);
    assert(b.includes("RAISE EXCEPTION 'Evidence reference not found' USING ERRCODE='P0002'"), f);
    assert(b.includes(
      "SELECT * INTO _row FROM governance_records WHERE id = _ev.governance_record_id;",
    ), f);
    assert(b.includes("RAISE EXCEPTION 'Parent record not found' USING ERRCODE='P0002'"), f);
  }
});

Deno.test("12. _gov_assert_project_write precedes record_kind/type check", () => {
  for (const f of FN) {
    const b = B[f];
    const w = b.indexOf("_gov_assert_project_write(_row.project_id)");
    const k = b.indexOf("_row.record_kind IS DISTINCT FROM 'decision_case'");
    assert(w > -1 && k > w, f);
    assert(b.includes(
      "RAISE EXCEPTION 'Evidence references are only allowed on decision_case records' USING ERRCODE='22023'",
    ), f);
    // no duplicated organization containment
    assertEquals(/is_user_org_member\(v_caller/.test(b), false, f);
  }
});

Deno.test("13. create validation and normalization preserved", () => {
  const b = B[FN[0]];
  for (
    const s of [
      "'sharepoint_file','onenote_page','outlook_reference','teams_reference','meeting_minutes','other_link'",
      "_relevance_level NOT IN ('high','medium','low')",
      "_t := NULLIF(trim(_title), '');",
      "_u := NULLIF(trim(_external_url), '');",
      "_s := NULLIF(trim(coalesce(_summary,'')), '');",
      "RAISE EXCEPTION 'Title is required'",
      "RAISE EXCEPTION 'External URL is required'",
      "RAISE EXCEPTION 'External URL must start with http:// or https://'",
      "COALESCE(_included_in_package, true)",
      "RETURNING id INTO _id;",
      "RETURN _id;",
    ]
  ) assert(b.includes(s), s);
});

Deno.test("14. update fields / clear flags / validation preserved", () => {
  const b = B[FN[1]];
  for (
    const s of [
      "RAISE EXCEPTION 'Title cannot be blank'",
      "RAISE EXCEPTION 'External URL cannot be blank'",
      "summary = CASE WHEN _clear_summary THEN NULL",
      "evidence_date = CASE WHEN _clear_evidence_date THEN NULL",
      "owner_stakeholder_id = CASE WHEN _clear_owner_stakeholder_id THEN NULL",
      "relevance_level = COALESCE(_relevance_level, relevance_level)",
      "included_in_package = COALESCE(_included_in_package, included_in_package)",
      "updated_at = now()",
    ]
  ) assert(b.includes(s), s);
});

Deno.test("15. owner stakeholder requires project + organization + workspace + not removed", () => {
  for (const f of [FN[0], FN[1]]) {
    const b = B[f];
    assert(b.includes("FROM project_stakeholders s WHERE s.id = _owner_stakeholder_id;"), f);
    for (
      const s of [
        "_sh_project IS DISTINCT FROM _row.project_id",
        "_sh_org IS DISTINCT FROM _row.organization_id",
        "_sh_ws IS DISTINCT FROM _row.workspace_id",
        "_sh_removed IS NOT NULL",
        "RAISE EXCEPTION 'Owner stakeholder does not belong to this project' USING ERRCODE='22023';",
      ]
    ) assert(b.includes(s), `${f}:${s}`);
    // bounded: no condition disclosure
    assertEquals(/inactive|removed from|left the|stale/i.test(b), false, f);
  }
  assert(B[FN[1]].includes("_owner_stakeholder_id IS NOT NULL AND NOT _clear_owner_stakeholder_id"));
});

Deno.test("16. internal owner user requires active + Organization + Workspace eligibility", () => {
  for (const f of [FN[0], FN[1]]) {
    const b = B[f];
    assert(b.includes("IF _sh_type = 'workspace_member' THEN"), f);
    assert(b.includes("_sh_user IS NULL"), f);
    assert(b.includes("NOT public.is_active_user(_sh_user)"), f);
    assert(b.includes(
      "public.is_user_org_member(_sh_user, _row.organization_id) IS NOT TRUE",
    ), f);
    assert(b.includes(
      "public.is_user_workspace_member(_sh_user, _row.workspace_id) IS NOT TRUE",
    ), f);
    // user-first ordering
    assert(b.indexOf("is_active_user(_sh_user)") < b.indexOf("is_user_org_member(_sh_user"), f);
  }
});

Deno.test("17. external owner stakeholder remains valid without user_id", () => {
  for (const f of [FN[0], FN[1]]) {
    const b = B[f];
    const start = b.indexOf("IF _sh_type = 'workspace_member' THEN");
    const gate = b.slice(0, start);
    // user-identity requirements only inside the workspace_member branch
    assertEquals(gate.includes("is_active_user(_sh_user)"), false, f);
    assertEquals(gate.includes("_sh_user IS NULL"), false, f);
  }
});

Deno.test("18. archive/restore semantics preserved", () => {
  assert(B[FN[2]].includes(
    "SET archived_at = now(), archived_by = v_caller, updated_by = v_caller, updated_at = now()",
  ));
  assert(B[FN[3]].includes(
    "SET archived_at = NULL, archived_by = NULL, updated_by = v_caller, updated_at = now()",
  ));
  assertEquals(/DELETE FROM governance_record_evidence_references/i.test(sql), false);
});

Deno.test("19-20. persistence/activity actors use v_caller; event names + metadata preserved", () => {
  assert(B[FN[0]].includes("v_caller, v_caller)"));
  for (const f of FN) {
    const b = B[f];
    assert(b.includes("PERFORM log_activity_event(_row.organization_id, v_caller,"), f);
    assert(b.includes("'project_id', _row.project_id"), f);
  }
  for (
    const ev of [
      "'governance_record_evidence_reference_created'",
      "'governance_record_evidence_reference_updated'",
      "'governance_record_evidence_reference_archived'",
      "'governance_record_evidence_reference_restored'",
    ]
  ) assert(sql.includes(ev), ev);
  assert(B[FN[0]].includes("'evidence_type', _evidence_type"));
  assert(B[FN[0]].includes("'relevance_level', _relevance_level"));
});

Deno.test("21. encryption path unchanged", () => {
  assertEquals(/btpm_encrypt|btpm_decrypt|tenant_encryption|pgp_/i.test(sql), false);
  assertEquals(/CREATE (OR REPLACE )?TRIGGER|DROP TRIGGER/i.test(sql), false);
});

Deno.test("22-23. frontend caller unchanged, no service-role caller", async () => {
  const hook = await Deno.readTextFile("src/hooks/useGovernanceEvidenceReferences.ts");
  for (const f of FN) assert(hook.includes(`"${f}"`), f);
  assert(hook.includes('import { supabase } from "@/integrations/supabase/client"'));
  assertEquals(/service_role|SERVICE_ROLE/.test(hook), false);
  assertEquals(/\.tsx?|src\//.test(sql), false);
});

Deno.test("24. no GRANT/REVOKE", () => {
  assertEquals(/\bGRANT\b|\bREVOKE\b/i.test(sql), false);
});

Deno.test("25. no schema/RLS/PMG/reporting/business-data drift", () => {
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
      "list_governance_record_evidence_references",
      "governance_record_evidence_files",
      "governance_record_btpm_context_links",
      "governance_record_cross_project_links",
      "governance_record_brief_versions",
      "governance_record_stakeholder_packages",
      "governance_record_copilot_data_packages",
      "close_governance_decision_case",
      "upsert_governance_record_decision_outcome",
    ]
  ) assertEquals(sql.includes(untouched), false, untouched);
});
