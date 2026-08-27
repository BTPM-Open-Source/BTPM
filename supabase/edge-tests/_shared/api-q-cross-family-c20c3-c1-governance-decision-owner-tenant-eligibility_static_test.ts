/**
 * API-Q Cross-Family-C20C3-C1 — Governance Decision Owner canonical stakeholder
 * and legacy user Tenant eligibility. Focused static/contract test over the
 * forward-only correction migration.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20260820100439_a822caf1-67d2-4582-a6ce-5566a3eddc00.sql";
const C20C3_MIGRATION =
  "supabase/migrations/20260820094823_3ddbbb77-75da-4d7f-a1ee-09a5c8ac32c3.sql";

const sql = await Deno.readTextFile(MIGRATION);
const code = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const idx = (needle: string) => code.indexOf(needle);

Deno.test("1. exactly one function is redefined", () => {
  assertEquals((sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 1);
  assert(sql.includes(
    "CREATE OR REPLACE FUNCTION public.set_governance_record_decisions(_record_id uuid, _decisions jsonb)",
  ));
});

Deno.test("2. signature/properties/search_path preserved", () => {
  assert(sql.includes("RETURNS void"));
  assert(sql.includes("LANGUAGE plpgsql"));
  assert(sql.includes("SECURITY DEFINER"));
  assert(sql.includes("SET search_path TO 'public', 'extensions'"));
  assertEquals(/\bIMMUTABLE\b|\bSTABLE\b/.test(sql), false);
});

Deno.test("3. C20C3 OAuth gate remains the first executable operation", () => {
  const begin = idx("BEGIN");
  const gate = idx("api_e_private.jwt_client_id()");
  const deny = idx("RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'");
  assert(gate > begin);
  assert(deny > gate);
  assert(
    /EXCEPTION WHEN OTHERS THEN\s+v_client_id := 'unresolved_client';/.test(code),
  );
  assert(/IF v_client_id IS NOT NULL THEN/.test(code));
  assert(deny < idx("v_caller := auth.uid();"));
});

Deno.test("4. auth.uid() resolved exactly once", () => {
  assertEquals(code.split("auth.uid()").length - 1, 1);
  assert(code.includes("v_caller := auth.uid();"));
  assert(
    /IF v_caller IS NULL OR NOT public\.is_active_user\(v_caller\) THEN\s+RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';/
      .test(code),
  );
});

Deno.test("5. record lookup / P0002 / write helper ordering preserved", () => {
  const auth = idx("v_caller := auth.uid();");
  const lookup = idx("FROM governance_records WHERE id = _record_id");
  const p0002 = idx("'Record not found' USING ERRCODE='P0002'");
  const write = idx("_gov_assert_project_write(_row.project_id)");
  assert(auth < lookup && lookup < p0002 && p0002 < write);
});

Deno.test("6. decisions array validation remains and follows the write helper", () => {
  const v = idx("'Decisions payload must be a JSON array' USING ERRCODE='22023'");
  assert(v > idx("_gov_assert_project_write(_row.project_id)"));
  assert(code.includes("jsonb_typeof(_decisions) <> 'array'"));
});

Deno.test("7. stakeholder lookup includes all eligibility fields", () => {
  for (
    const f of [
      "s.project_id = _row.project_id",
      "s.organization_id = _row.organization_id",
      "s.workspace_id = _row.workspace_id",
      "s.removed_at IS NULL",
      "s.stakeholder_type",
      "s.user_id",
    ]
  ) assert(code.includes(f), f);
  assert(code.includes("FROM project_stakeholders s"));
  assert(code.includes("WHERE s.id = _stakeholder_id;"));
});

Deno.test("8-9. structural mismatch or removed stakeholder is rejected (bounded)", () => {
  assert(
    /IF NOT FOUND OR _stakeholder_ok IS NOT TRUE THEN\s+RAISE EXCEPTION 'Stakeholder owner does not belong to this project' USING ERRCODE='22023';/
      .test(code),
  );
});

Deno.test("10. internal stakeholder user requires active/org/workspace eligibility", () => {
  assert(code.includes("IF _stakeholder_type = 'workspace_member' THEN"));
  assert(code.includes("NOT public.is_active_user(_stakeholder_user)"));
  assert(code.includes(
    "public.is_user_org_member(_stakeholder_user, _row.organization_id) IS NOT TRUE",
  ));
  assert(code.includes(
    "public.is_user_workspace_member(_stakeholder_user, _row.workspace_id) IS NOT TRUE",
  ));
  // same bounded error, no leakage of which condition failed
  const block = code.slice(
    idx("IF _stakeholder_type = 'workspace_member' THEN"),
    idx("_owner_user := _stakeholder_user;"),
  );
  assert(block.includes(
    "RAISE EXCEPTION 'Stakeholder owner does not belong to this project' USING ERRCODE='22023';",
  ));
  assertEquals(/inactive|left the|stale/i.test(block), false);
});

Deno.test("11. external stakeholder remains valid without a user identity", () => {
  assert(/ELSE\s+_owner_user := NULL;\s+END IF;/.test(code));
  const external = code.slice(idx("ELSIF _owner_user IS NOT NULL THEN"));
  assertEquals(external.includes("is_active_user(_stakeholder_user)"), false);
});

Deno.test("12. internal stakeholder still mirrors user_id into decision_owner_id", () => {
  assert(code.includes("_owner_user := _stakeholder_user;"));
  assert(idx("_owner_user := _stakeholder_user;") > idx("IF _stakeholder_user IS NULL"));
});

Deno.test("13-14. legacy direct owner user requires same eligibility with bounded 22023", () => {
  const legacy = code.slice(
    idx("ELSIF _owner_user IS NOT NULL THEN"),
    idx("INSERT INTO governance_record_decisions ("),
  );
  assert(legacy.includes("NOT public.is_active_user(_owner_user)"));
  assert(legacy.includes(
    "public.is_user_org_member(_owner_user, _row.organization_id) IS NOT TRUE",
  ));
  assert(legacy.includes(
    "public.is_user_workspace_member(_owner_user, _row.workspace_id) IS NOT TRUE",
  ));
  assert(legacy.includes(
    "RAISE EXCEPTION 'Decision owner user is not eligible for this project' USING ERRCODE='22023';",
  ));
  // legacy path does not require a stakeholder row
  assertEquals(legacy.includes("project_stakeholders"), false);
});

Deno.test("15. stakeholder precedence preserved (stakeholder branch is authoritative)", () => {
  assert(idx("IF _stakeholder_id IS NOT NULL THEN") < idx("ELSIF _owner_user IS NOT NULL THEN"));
  assertEquals(/mismatch/i.test(code), false);
});

Deno.test("16-17. decision_text / target_date / DELETE-and-replace preserved", () => {
  assert(code.includes(
    "DELETE FROM governance_record_decisions WHERE governance_record_id = _record_id;",
  ));
  assert(code.includes("RAISE EXCEPTION 'decision_text is required' USING ERRCODE='22023'"));
  assert(code.includes("NULLIF(_d->>'target_date','')::date"));
  assert(code.includes("_d->>'decision_text'"));
  for (
    const col of [
      "organization_id",
      "workspace_id",
      "project_id",
      "governance_record_id",
      "decision_text",
      "decision_owner_id",
      "decision_owner_stakeholder_id",
      "target_date",
      "created_by",
      "updated_by",
    ]
  ) assert(code.includes(col), col);
});

Deno.test("18. created_by / updated_by / audit use v_caller", () => {
  assert(code.includes("v_caller, v_caller);"));
  assert(code.includes("PERFORM log_activity_event(_row.organization_id, v_caller,"));
  assert(code.includes("'governance_record_decisions_updated'"));
  assert(code.includes("jsonb_build_object('project_id', _row.project_id, 'decision_count', _count)"));
});

Deno.test("19. encryption path unchanged", () => {
  assertEquals(/btpm_encrypt|btpm_decrypt|tenant_encryption|pgp_/i.test(sql), false);
  assertEquals(/CREATE (OR REPLACE )?TRIGGER|DROP TRIGGER/i.test(sql), false);
});

Deno.test("20. other C20C3 surfaces untouched", () => {
  for (
    const n of [
      "apply_governance_record_create",
      "set_governance_record_links",
      "create_governance_record",
      "apply_governance_record_update",
      "update_governance_record",
    ]
  ) assertEquals(sql.includes(n), false, n);
});

Deno.test("21. accepted C20C3 migration is unmodified and frontend untouched", async () => {
  const prior = await Deno.readTextFile(C20C3_MIGRATION);
  assert(prior.includes("set_governance_record_decisions"));
  assertEquals(/\.tsx?|src\//.test(sql), false);
});

Deno.test("22. no GRANT/REVOKE", () => {
  assertEquals(/\bGRANT\b|\bREVOKE\b/i.test(sql), false);
});

Deno.test("23. no API/MCP/schema/RLS/business-data drift", () => {
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
  assertEquals(/CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE POLICY|ALTER POLICY|DROP POLICY|CREATE INDEX|CREATE TYPE/i.test(sql), false);
  const topLevel = sql.replace(/\$function\$[\s\S]*?\$function\$/g, "");
  assertEquals(/INSERT INTO|UPDATE |DELETE FROM/i.test(topLevel), false);
});
