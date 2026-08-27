// API-Q Cross-Family-C1 — Program Create/Update canonical Organization
// membership alignment. Focused static contract test over the forward-only migration.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH = new URL(
  "../../migrations/20260819124912_d55ae9e3-707f-4765-ac7c-67d900a8e0ed.sql",
  import.meta.url,
).pathname;

const sql = await Deno.readTextFile(MIGRATION_PATH);
// SQL with `--` comments stripped (comment prose must not satisfy assertions).
const code = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const codeLower = code.toLowerCase();

const createBody = code.slice(
  code.indexOf("public.apply_program_create("),
  code.indexOf("public.apply_program_update("),
);
const updateBody = code.slice(code.indexOf("public.apply_program_update("));

Deno.test("1. exactly apply_program_create and apply_program_update are redefined", () => {
  const defs = code.match(/create or replace function public\.([a-z0-9_]+)/gi) ?? [];
  assertEquals(defs.length, 2);
  assert(codeLower.includes("create or replace function public.apply_program_create("));
  assert(codeLower.includes("create or replace function public.apply_program_update("));
  assertEquals(/drop function/i.test(code), false);
});

Deno.test("2. both signatures remain unchanged", () => {
  assert(
    codeLower.includes(
      "public.apply_program_create(_name text, _workspace_id uuid, _description text default null::text, _correlation_id text default null::text, _idempotency_key text default null::text)",
    ),
  );
  assert(
    codeLower.includes(
      "public.apply_program_update(_program_id uuid, _expected_updated_at timestamp with time zone, _name text default null::text, _status pm_status default null::pm_status, _description text default null::text, _set_description boolean default false, _correlation_id text default null::text, _idempotency_key text default null::text)",
    ),
  );
  assertEquals((code.match(/RETURNS jsonb/gi) ?? []).length, 2);
});

Deno.test("3. both remain SECURITY DEFINER with current search_path/volatility", () => {
  assertEquals((code.match(/SECURITY DEFINER/gi) ?? []).length, 2);
  assertEquals((code.match(/SET search_path TO 'pg_catalog', 'public'/gi) ?? []).length, 2);
  assertEquals((code.match(/LANGUAGE plpgsql/gi) ?? []).length, 2);
  // volatility unchanged: neither is declared STABLE/IMMUTABLE.
  assertEquals(/\b(STABLE|IMMUTABLE)\b/.test(code), false);
});

Deno.test("4. Program Create derives Organization from the supplied Workspace", () => {
  assert(
    /SELECT organization_id INTO v_org\s*\n\s*FROM public\.workspaces\s*\n\s*WHERE id = _workspace_id;/i
      .test(createBody),
  );
});

Deno.test("5. Program Update derives Organization/Workspace from the target Program", () => {
  assert(/SELECT \* INTO v_prog FROM public\.programs WHERE id = _program_id FOR UPDATE;/i.test(updateBody));
  assert(updateBody.includes("v_prog.workspace_id"));
  assert(updateBody.includes("v_prog.organization_id"));
});

Deno.test("6. Create uses exactly public.is_user_org_member(v_actor, v_org)", () => {
  const m = createBody.match(/public\.is_user_org_member\([^)]*\)/gi) ?? [];
  assertEquals(m.length, 1);
  assertEquals(m[0], "public.is_user_org_member(v_actor, v_org)");
  assert(createBody.includes("public.is_user_org_member(v_actor, v_org) IS NOT TRUE"));
});

Deno.test("7. Update uses exactly public.is_user_org_member(v_actor, v_prog.organization_id)", () => {
  const m = updateBody.match(/public\.is_user_org_member\([^)]*\)/gi) ?? [];
  assertEquals(m.length, 1);
  assertEquals(m[0], "public.is_user_org_member(v_actor, v_prog.organization_id)");
  assert(updateBody.includes("public.is_user_org_member(v_actor, v_prog.organization_id) IS NOT TRUE"));
});

Deno.test("8. correct user-first argument order is used", () => {
  for (const m of code.match(/public\.is_user_org_member\(([^)]*)\)/gi) ?? []) {
    const arg = m.replace(/^.*\(/, "").replace(/\)$/, "").split(",")[0].trim();
    assertEquals(arg, "v_actor");
  }
});

Deno.test("9. get_user_org_id is absent from both corrected function bodies", () => {
  assertEquals(codeLower.includes("get_user_org_id"), false);
});

Deno.test("10. profiles.organization_id is not used for membership authority", () => {
  assertEquals(/from public\.profiles/i.test(code), false);
  assertEquals(codeLower.includes("organization_memberships"), false);
  assertEquals(codeLower.includes("tenant_memberships"), false);
  assertEquals(/\bis_org_member\(|is_organization_member\(/i.test(code), false);
});

Deno.test("11. has_pm_authority remains required in both", () => {
  assert(createBody.includes("NOT public.has_pm_authority(v_actor, _workspace_id)"));
  assert(updateBody.includes("NOT public.has_pm_authority(v_actor, v_prog.workspace_id)"));
});

Deno.test("12. can_write_demo remains required in both", () => {
  assert(createBody.includes("NOT public.can_write_demo(v_actor, _workspace_id)"));
  assert(updateBody.includes("NOT public.can_write_demo(v_actor, v_prog.workspace_id)"));
});

Deno.test("13. canonical Organization membership remains required in both (not removed)", () => {
  for (const body of [createBody, updateBody]) {
    const gate = body.match(/IF NOT public\.has_pm_authority[\s\S]*?THEN/i);
    assert(gate);
    assert(/is_user_org_member/i.test(gate![0]));
    assert(/can_write_demo/i.test(gate![0]));
  }
  assert(/public\.is_active_user\(v_actor\)/i.test(createBody));
  assert(/public\.is_active_user\(v_actor\)/i.test(updateBody));
});

Deno.test("14. programs:create OAuth/MCP source containment unchanged", () => {
  assert(createBody.includes("api_e_private.jwt_client_id()"));
  assert(createBody.includes("api_e_private.assert_trusted_context()"));
  assert(createBody.includes("<> 'programs:create'"));
  assert(createBody.includes("<> 'v1'"));
  assert(createBody.includes("<> 'command'"));
  assert(createBody.includes("v_trusted_channel NOT IN ('external_api','mcp')"));
  assert(createBody.includes("v_client_id := 'unresolved_client';"));
  // Containment precedes the workspace lookup.
  assert(
    createBody.indexOf("<> 'programs:create'") <
      createBody.indexOf("FROM public.workspaces"),
  );
});

Deno.test("15. programs:update OAuth/MCP source containment unchanged", () => {
  assert(updateBody.includes("api_e_private.jwt_client_id()"));
  assert(updateBody.includes("api_e_private.assert_trusted_context()"));
  assert(updateBody.includes("<> 'programs:update'"));
  assert(updateBody.includes("v_trusted_channel NOT IN ('external_api','mcp')"));
  assert(
    updateBody.indexOf("<> 'programs:update'") <
      updateBody.indexOf("FROM public.programs WHERE id = _program_id FOR UPDATE"),
  );
});

Deno.test("16. Create validation/write/result behavior remains present", () => {
  assert(createBody.includes("'Program name is required'"));
  assert(createBody.includes("'Program name must be 200 characters or less'"));
  assert(createBody.includes("'Workspace is required'"));
  assert(createBody.includes("'Workspace not found'"));
  assert(createBody.includes("v_desc := nullif(btrim(coalesce(_description, '')), '');"));
  assert(/INSERT INTO public\.programs \(\s*\n\s*name, description, workspace_id, organization_id, created_by/i.test(createBody));
  assert(createBody.includes("jsonb_build_object('id', v_new_id, 'program_id', v_new_id)"));
});

Deno.test("17. Update concurrency/no-change/write/result behavior remains present", () => {
  assert(updateBody.includes("v_prog.updated_at IS DISTINCT FROM _expected_updated_at"));
  assert(updateBody.includes("'stale_program'"));
  assert(updateBody.includes("'Program is archived and cannot be edited'"));
  assert(updateBody.includes("IF v_changed_count = 0 THEN"));
  assert(/UPDATE public\.programs SET/i.test(updateBody));
  assert(updateBody.includes("'changed_field_count', v_changed_count"));
  assert(updateBody.includes("public.btpm_decrypt(v_prog.name, v_prog.organization_id)"));
});

Deno.test("18. PMG provenance remains present", () => {
  assertEquals((code.match(/pmg_record_command_audit/g) ?? []).length >= 4, true);
  assert(code.includes("v_source_channel public.pmg_source_channel := 'btpm_ui'::public.pmg_source_channel;"));
  assert(codeLower.includes("pmg_build_result"));
});

Deno.test("19. external api_v1/mcp wrappers/executors are not redefined", () => {
  for (
    const n of [
      "api_e_private.execute_v1_create_program",
      "api_e_private.execute_v1_update_program",
      "api_v1_create_program",
      "api_v1_update_program",
      "mcp_v1_create_program",
      "mcp_v1_update_program",
      "api_capability_catalogue",
      "api_capability_grants",
      "idempotency_registry",
    ]
  ) {
    assertEquals(codeLower.includes(n.toLowerCase()), false, n);
  }
});

Deno.test("20. no Portfolio/Project/Phase/Task function is redefined", () => {
  for (
    const n of [
      "portfolio",
      "apply_project_",
      "apply_phase_",
      "apply_task_",
    ]
  ) {
    assertEquals(codeLower.includes(n), false, n);
  }
});

Deno.test("21. no RLS/grant/schema/encryption/frontend change occurs", () => {
  assertEquals(/create policy|alter policy|drop policy|row level security/i.test(code), false);
  assertEquals(/\bgrant\b|\brevoke\b/i.test(code), false);
  assertEquals(/alter table|create table|drop table|add column|drop column/i.test(code), false);
  assertEquals(/create or replace function public\.btpm_(encrypt|decrypt)/i.test(code), false);
  assertEquals(/create trigger|drop trigger/i.test(code), false);
});

Deno.test("22. no migration-time business-data DML/backfill occurs", () => {
  const topLevel = code.replace(/\$function\$[\s\S]*?\$function\$/g, "");
  assertEquals(/insert\s+into|update\s+public\.|delete\s+from/i.test(topLevel), false);
  assertEquals((code.match(/INSERT INTO public\./gi) ?? []).length, 1);
  assertEquals((code.match(/UPDATE public\.programs SET/gi) ?? []).length, 1);
});
