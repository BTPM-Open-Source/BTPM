// API-Q Cross-Family-C18-C1 — Project Team / RACI target-user tenant eligibility
// and read containment. Focused static contract test over the forward-only
// correction migration.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH = new URL(
  "../../migrations/20260820044200_b464c4ff-ba39-4368-b97b-469844c83300.sql",
  import.meta.url,
).pathname;

const sql = await Deno.readTextFile(MIGRATION_PATH);
// SQL with `--` comments stripped (comment prose must not satisfy assertions).
const code = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const codeLower = code.toLowerCase();
const idx = (re: RegExp) => code.search(re);

function fn(name: string): string {
  const start = code.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert(start >= 0, `${name} must be redefined`);
  const end = code.indexOf("$function$;", code.indexOf("AS $function$", start) + 5);
  assert(end > start, `${name} body must terminate`);
  return code.slice(start, end);
}

const TEAM_ADD = fn("apply_project_team_member_add");
const RACI_ADD = fn("apply_project_raci_add");
const TEAM_READ = fn("list_decrypted_project_team");
const RACI_READ = fn("list_project_raci");

Deno.test("1. exactly the four target functions are redefined", () => {
  const defs = code.match(/CREATE OR REPLACE FUNCTION public\.([a-z0-9_]+)\(/gi) ?? [];
  assertEquals(defs.length, 4);
  for (
    const n of [
      "apply_project_team_member_add",
      "apply_project_raci_add",
      "list_decrypted_project_team",
      "list_project_raci",
    ]
  ) {
    assert(codeLower.includes(`create or replace function public.${n}(`), n);
  }
  assertEquals(/drop function/i.test(code), false);
});

Deno.test("2a. Team Add: authoritative Project scope drives org/workspace", () => {
  assert(
    /SELECT id, workspace_id, organization_id\s*\n\s*INTO v_project\s*\n\s*FROM public\.projects\s*\n\s*WHERE id = _project_id\s*\n\s*FOR SHARE;/i
      .test(TEAM_ADD),
  );
  assert(/has_project_pm_authority\(v_actor, _project_id\)/i.test(TEAM_ADD));
  assert(/can_write_demo\(v_actor, v_project\.workspace_id\)/i.test(TEAM_ADD));
});

Deno.test("2b. Team Add: selected user requires active + canonical org + workspace membership", () => {
  const gate = TEAM_ADD.match(
    /IF NOT public\.is_active_user\(_user_id\)[\s\S]*?END IF;/i,
  );
  assert(gate, "target-user eligibility gate must exist");
  assert(/public\.is_user_org_member\(_user_id, v_project\.organization_id\) IS NOT TRUE/i.test(gate![0]));
  assert(/public\.is_user_workspace_member\(_user_id, v_project\.workspace_id\) IS NOT TRUE/i.test(gate![0]));
  assert(/'reason','user_not_eligible'/i.test(gate![0]));
  // undifferentiated failure: exactly one invalid envelope for all three causes
  assertEquals((gate![0].match(/pmg_build_result/gi) ?? []).length, 1);
  assertEquals(/inactive|wrong_organization|wrong_workspace|not_org_member|not_workspace_member/i.test(TEAM_ADD), false);
});

Deno.test("2c. Team Add: eligibility runs after caller authority, before writes", () => {
  const eligibility = TEAM_ADD.search(/IF NOT public\.is_active_user\(_user_id\)/i);
  assert(TEAM_ADD.search(/has_project_pm_authority/i) < eligibility);
  assert(eligibility < TEAM_ADD.search(/FROM public\.project_team_members/i));
  assert(eligibility < TEAM_ADD.search(/INSERT INTO public\.project_team_members/i));
});

Deno.test("2d. Team Add: PMG audit/result/duplicate behavior intact", () => {
  assert(/'already_member'/i.test(TEAM_ADD));
  assert(/'race_already_member'/i.test(TEAM_ADD));
  assert(/WHEN unique_violation THEN/i.test(TEAM_ADD));
  assert(/'project_id_and_user_id_required'/i.test(TEAM_ADD));
  assertEquals((TEAM_ADD.match(/pmg_record_command_audit/gi) ?? []).length, 3);
  assert(/'applied'::public\.pmg_command_status, 'apply_project_team_member_add'/i.test(TEAM_ADD));
  assert(/role_label_present/i.test(TEAM_ADD) && /canonical_role_key_present/i.test(TEAM_ADD));
  assertEquals((TEAM_ADD.match(/INSERT INTO public\./gi) ?? []).length, 1);
});

Deno.test("3a. RACI Add: stakeholder must match project + organization + workspace, not removed", () => {
  assert(/SELECT id, project_id, organization_id, workspace_id, user_id, removed_at/i.test(RACI_ADD));
  const gate = RACI_ADD.match(/IF v_stakeholder\.id IS NULL[\s\S]*?END IF;/i);
  assert(gate);
  assert(/v_stakeholder\.project_id <> _project_id/i.test(gate![0]));
  assert(/v_stakeholder\.organization_id IS DISTINCT FROM v_project\.organization_id/i.test(gate![0]));
  assert(/v_stakeholder\.workspace_id IS DISTINCT FROM v_project\.workspace_id/i.test(gate![0]));
  assert(/v_stakeholder\.removed_at IS NOT NULL/i.test(gate![0]));
  assert(/'reason','stakeholder_not_eligible'/i.test(gate![0]));
});

Deno.test("3b. RACI Add: internal stakeholder user requires active + canonical org + workspace", () => {
  const gate = RACI_ADD.match(/IF v_stakeholder\.user_id IS NOT NULL\s*\n\s*AND \(NOT public\.is_active_user[\s\S]*?END IF;/i);
  assert(gate, "internal stakeholder user eligibility gate must exist");
  assert(/is_user_org_member\(v_stakeholder\.user_id, v_project\.organization_id\) IS NOT TRUE/i.test(gate![0]));
  assert(/is_user_workspace_member\(v_stakeholder\.user_id, v_project\.workspace_id\) IS NOT TRUE/i.test(gate![0]));
  assert(/'reason','stakeholder_not_eligible'/i.test(gate![0]));
});

Deno.test("3c. RACI Add: external stakeholder (user_id NULL) remains valid", () => {
  assert(/v_effective_user := v_stakeholder\.user_id;/i.test(RACI_ADD));
  // eligibility gates are conditional on a non-null user reference
  assert(/IF v_stakeholder\.user_id IS NOT NULL/i.test(RACI_ADD));
  assert(/IF v_effective_user IS NOT NULL/i.test(RACI_ADD));
});

Deno.test("3d. RACI Add: direct user requires active + canonical org + workspace", () => {
  const gate = RACI_ADD.match(/IF v_effective_user IS NOT NULL[\s\S]*?END IF;/i);
  assert(gate);
  assert(/NOT public\.is_active_user\(v_effective_user\)/i.test(gate![0]));
  assert(/is_user_org_member\(v_effective_user, v_project\.organization_id\) IS NOT TRUE/i.test(gate![0]));
  assert(/is_user_workspace_member\(v_effective_user, v_project\.workspace_id\) IS NOT TRUE/i.test(gate![0]));
  assert(/'reason','user_not_eligible'/i.test(gate![0]));
});

Deno.test("3e. RACI Add: mismatch rule, role validation, uniqueness, audit preserved", () => {
  assert(/'stakeholder_user_mismatch'/i.test(RACI_ADD));
  assert(/'invalid_raci_role'/i.test(RACI_ADD));
  assert(/'stakeholder_or_user_required'/i.test(RACI_ADD));
  assert(/'accountable_already_assigned'/i.test(RACI_ADD));
  assert(/'already_assigned'/i.test(RACI_ADD));
  assert(/'race_already_assigned'/i.test(RACI_ADD));
  assertEquals((RACI_ADD.match(/pmg_record_command_audit/gi) ?? []).length, 4);
  assertEquals((RACI_ADD.match(/INSERT INTO public\./gi) ?? []).length, 1);
});

Deno.test("4a. Team Read: C18 OAuth/caller/read-authority sequence preserved in order", () => {
  const order = [
    /api_e_private\.jwt_client_id\(\)/i,
    /IF v_client_id IS NOT NULL THEN/i,
    /v_caller := auth\.uid\(\)/i,
    /public\.is_active_user\(v_caller\)/i,
    /FROM public\.projects WHERE id = _project_id/i,
    /public\.is_user_org_member\(v_caller, v_proj\.organization_id\)/i,
    /public\.can_read_project_or_demo\(v_caller, _project_id\)/i,
    /FROM public\.project_team_members ptm/i,
  ];
  let prev = -1;
  for (const re of order) {
    const i = TEAM_READ.search(re);
    assert(i > prev, `sequence broken at ${re}`);
    prev = i;
  }
  assert(/v_client_id := 'unresolved_client';/i.test(TEAM_READ));
  assert(/ERRCODE = '42501'/i.test(TEAM_READ));
});

Deno.test("4b. Team Read: rows filtered to authoritative project/org/workspace + member users", () => {
  const where = TEAM_READ.match(/WHERE ptm\.project_id = _project_id[\s\S]*?;/i);
  assert(where);
  assert(/ptm\.organization_id = v_proj\.organization_id/i.test(where![0]));
  assert(/ptm\.workspace_id = v_proj\.workspace_id/i.test(where![0]));
  assert(/public\.is_user_org_member\(ptm\.user_id, v_proj\.organization_id\) IS TRUE/i.test(where![0]));
});

Deno.test("4c. Team Read: decrypt / readable-value treatment unchanged", () => {
  assert(/public\.btpm_decrypt\(ptm\.role_label, ptm\.organization_id\)/i.test(TEAM_READ));
  assert(/public\.btpm_decrypt\(p\.display_name, p\.organization_id\)/i.test(TEAM_READ));
  assert(/p\.organization_id IS NOT NULL AND p\.email IS NOT NULL/i.test(TEAM_READ));
  assert(/p\.organization_id IS NOT NULL AND p\.avatar_url IS NOT NULL/i.test(TEAM_READ));
  assert(/COALESCE\(json_agg/i.test(TEAM_READ));
});

Deno.test("5a. RACI Read: C18 OAuth/caller/read-authority sequence and [] hiding preserved", () => {
  const order = [
    /api_e_private\.jwt_client_id\(\)/i,
    /IF v_client_id IS NOT NULL THEN/i,
    /v_caller := auth\.uid\(\)/i,
    /public\.is_active_user\(v_caller\)/i,
    /FROM public\.projects pr WHERE pr\.id = _project_id/i,
    /public\.is_user_org_member\(v_caller, v_org\)/i,
    /public\.can_read_project\(v_caller, _project_id\)/i,
    /FROM public\.raci_assignments ra/i,
  ];
  let prev = -1;
  for (const re of order) {
    const i = RACI_READ.search(re);
    assert(i > prev, `sequence broken at ${re}`);
    prev = i;
  }
  assertEquals((RACI_READ.match(/RETURN '\[\]'::json;/gi) ?? []).length, 3);
  assert(/RETURN COALESCE\(_result, '\[\]'::json\);/i.test(RACI_READ));
});

Deno.test("5b. RACI Read: authoritative lookup obtains organization_id and workspace_id", () => {
  assert(/SELECT pr\.organization_id, pr\.workspace_id INTO v_org, v_ws/i.test(RACI_READ));
  assert(/v_ws uuid;/i.test(RACI_READ));
});

Deno.test("5c. RACI Read: row containment and stakeholder scope join", () => {
  const where = RACI_READ.match(/WHERE ra\.target_type = 'project'[\s\S]*?ORDER BY ra\.created_at/i);
  assert(where);
  assert(/ra\.target_id = _project_id/i.test(where![0]));
  assert(/ra\.organization_id = v_org/i.test(where![0]));
  assert(/ra\.workspace_id = v_ws/i.test(where![0]));
  assert(/\(ra\.stakeholder_id IS NULL OR ps\.id IS NOT NULL\)/i.test(where![0]));
  assert(/\(ra\.user_id IS NULL OR public\.is_user_org_member\(ra\.user_id, v_org\) IS TRUE\)/i.test(where![0]));
  assert(/\(ps\.user_id IS NULL OR public\.is_user_org_member\(ps\.user_id, v_org\) IS TRUE\)/i.test(where![0]));

  const join = RACI_READ.match(/LEFT JOIN public\.project_stakeholders ps[\s\S]*?LEFT JOIN public\.profiles psp/i);
  assert(join);
  assert(/ps\.project_id = _project_id/i.test(join![0]));
  assert(/ps\.organization_id = v_org/i.test(join![0]));
  assert(/ps\.workspace_id = v_ws/i.test(join![0]));
});

Deno.test("5d. RACI Read: readable-value handling and result shape/order unchanged", () => {
  assert(/ps\.external_name/i.test(RACI_READ));
  assert(/btpm_decrypt\(psp\.display_name, psp\.organization_id\)/i.test(RACI_READ));
  assert(/btpm_decrypt\(p\.display_name, p\.organization_id\)/i.test(RACI_READ));
  assert(/AS email/i.test(RACI_READ) && /AS avatar_url/i.test(RACI_READ));
  assert(/ps\.stakeholder_type AS stakeholder_type/i.test(RACI_READ));
  assert(/ps\.role_label AS stakeholder_role_label/i.test(RACI_READ));
  assert(/ORDER BY ra\.created_at/i.test(RACI_READ));
});

Deno.test("6. no GRANT/REVOKE", () => {
  assertEquals(/\bgrant\b|\brevoke\b/i.test(code), false);
});

Deno.test("7a. no schema/RLS/trigger drift", () => {
  assertEquals(/alter table|create table|drop table|add constraint/i.test(code), false);
  assertEquals(/create policy|alter policy|drop policy|row level security/i.test(code), false);
  assertEquals(/create trigger|drop trigger/i.test(code), false);
});

Deno.test("7b. no encryption-storage or business-data drift", () => {
  assertEquals(/btpm_encrypt|tenant_encryption|organization_encryption_keys/i.test(code), false);
  const topLevel = code.replace(/\$function\$[\s\S]*?\$function\$/g, "");
  assertEquals(/insert\s+into|update\s+public\.|delete\s+from/i.test(topLevel), false);
});

Deno.test("7c. no API/MCP/capability/frontend drift", () => {
  for (
    const forbidden of [
      "api_capability_catalogue",
      "api_capability_grants",
      "api_e_private.execute_",
      "api_v1_",
      "mcp",
      "idempotency_registry",
      "project_people_preset",
    ]
  ) {
    assertEquals(codeLower.includes(forbidden), false, forbidden);
  }
});

Deno.test("7d. non-goal functions are untouched", () => {
  for (
    const n of [
      "apply_project_team_member_role_update",
      "apply_project_team_member_remove",
      "apply_project_raci_remove",
      "add_project_stakeholder",
      "remove_project_stakeholder",
    ]
  ) {
    assertEquals(codeLower.includes(n), false, n);
  }
});

Deno.test("8. signatures, security properties and search_paths preserved", () => {
  assert(
    codeLower.includes(
      "public.apply_project_team_member_add(_project_id uuid, _user_id uuid, _role_label text default null::text, _canonical_role_key text default null::text, _correlation_id text default null::text, _idempotency_key text default null::text)",
    ),
  );
  assert(
    codeLower.includes(
      "public.apply_project_raci_add(_project_id uuid, _raci_role text, _stakeholder_id uuid default null::uuid, _user_id uuid default null::uuid, _correlation_id text default null::text, _idempotency_key text default null::text)",
    ),
  );
  assert(codeLower.includes("public.list_decrypted_project_team(_project_id uuid)"));
  assert(codeLower.includes("public.list_project_raci(_project_id uuid)"));
  assertEquals((code.match(/SECURITY DEFINER/gi) ?? []).length, 4);
  assertEquals((code.match(/SET search_path TO 'pg_catalog', 'public'/gi) ?? []).length, 2);
  assertEquals((code.match(/SET search_path TO 'public'/gi) ?? []).length, 2);
  assertEquals((code.match(/STABLE SECURITY DEFINER/gi) ?? []).length, 2);
});
