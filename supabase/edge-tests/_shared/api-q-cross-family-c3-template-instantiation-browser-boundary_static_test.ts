import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = "supabase/migrations/20260819132040_7dd123af-356a-4cc2-a9c9-378c8f306ad2.sql";
const DIALOG = "src/components/project/NewProjectDialog.tsx";

async function read(path: string): Promise<string> {
  const url = new URL(`../../../${path}`, import.meta.url);
  return await Deno.readTextFile(url);
}

const sql = await read(MIGRATION);
const idx = (needle: string) => sql.indexOf(needle);

Deno.test("1. exactly instantiate_project_from_template is redefined", () => {
  const defs = sql.match(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)/g) ?? [];
  assertEquals(defs.length, 1);
  assert(String(defs[0]).includes("instantiate_project_from_template"));
});

Deno.test("2. exact signature and defaults unchanged", () => {
  assert(sql.includes("_template_id uuid, _new_project_name text, _program_id uuid DEFAULT NULL::uuid, _project_start_date date DEFAULT NULL::date, _confirm_widening boolean DEFAULT false, _delivery_model project_delivery_model DEFAULT NULL::project_delivery_model"));
});

Deno.test("3. RETURNS jsonb unchanged", () => {
  assert(/RETURNS jsonb/.test(sql));
});

Deno.test("4. SECURITY DEFINER unchanged", () => {
  assert(sql.includes("SECURITY DEFINER"));
});

Deno.test("5. search_path and volatility unchanged", () => {
  assert(sql.includes("SET search_path TO 'public'"));
  assert(sql.includes("LANGUAGE plpgsql"));
  assert(!/\b(IMMUTABLE|STABLE)\b/.test(sql));
});

Deno.test("6. jwt_client_id evaluated before auth, lookup, decryption and mutation", () => {
  const guard = idx("api_e_private.jwt_client_id()");
  assert(guard > -1);
  assert(guard < idx("IF _caller IS NULL"));
  assert(guard < idx("FROM public.project_templates"));
  assert(guard < idx("public.btpm_decrypt"));
  assert(guard < idx("INSERT INTO public.projects"));
});

Deno.test("7. jwt_client_id resolution failure fails closed", () => {
  assert(sql.includes("EXCEPTION WHEN OTHERS THEN\n    v_client_id := 'unresolved_client';"));
});

Deno.test("8. non-null signed client raises Not authorized / 42501", () => {
  assert(sql.includes("IF v_client_id IS NOT NULL THEN\n    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';"));
});

Deno.test("9. no trusted-context or capability exception", () => {
  for (const banned of [
    "assert_trusted_context",
    "source_channel",
    "api_version",
    "capability",
    "connected_app",
  ]) {
    assert(!sql.includes(banned), `unexpected ${banned}`);
  }
});

Deno.test("10. auth.uid() requirement remains", () => {
  assert(sql.includes("_caller uuid := auth.uid();"));
  assert(sql.includes("RAISE EXCEPTION 'Authentication required'"));
});

Deno.test("11. is_active_user(_caller) required", () => {
  assert(sql.includes("IF NOT public.is_active_user(_caller) THEN"));
  assert(sql.includes("'Account is deactivated'"));
});

Deno.test("12. Organization/Workspace derived from project_templates", () => {
  assert(sql.includes("INTO _tpl FROM public.project_templates WHERE id = _template_id;"));
  assert(sql.includes("_org := _tpl.organization_id;"));
  assert(sql.includes("_ws  := _tpl.workspace_id;"));
});

Deno.test("13/14. canonical membership with user-first argument order", () => {
  assert(sql.includes("public.is_user_org_member(_caller, _org) IS NOT TRUE"));
  for (const banned of ["get_user_org_id", "is_organization_member", "profiles.organization_id"]) {
    assert(!sql.includes(banned), `unexpected ${banned}`);
  }
});

Deno.test("15. PM authority preserved", () => {
  assert(sql.includes("IF NOT public.has_pm_authority(_caller, _ws) THEN"));
  assert(sql.includes("'PM authority required in template workspace'"));
});

Deno.test("16. can_write_demo(_caller, _ws) required", () => {
  assert(sql.includes("IF NOT public.can_write_demo(_caller, _ws) THEN"));
});

Deno.test("17/18. all five gates precede decryption and first INSERT", () => {
  const gates = [
    idx("api_e_private.jwt_client_id()"),
    idx("IF _caller IS NULL"),
    idx("public.is_active_user(_caller)"),
    idx("public.is_user_org_member(_caller, _org)"),
    idx("public.has_pm_authority(_caller, _ws)"),
    idx("public.can_write_demo(_caller, _ws)"),
  ];
  const decrypt = idx("public.btpm_decrypt(_tpl.blueprint_payload, _org)");
  const firstInsert = idx("INSERT INTO public.projects");
  for (const g of gates) {
    assert(g > -1);
    assert(g < decrypt);
    assert(g < firstInsert);
  }
});

Deno.test("19. Program same-organization/workspace validation remains", () => {
  assert(sql.includes("FROM public.programs"));
  assert(sql.includes("WHERE id = _program_id AND organization_id = _org"));
  assert(sql.includes("AND workspace_id = _ws AND is_archived = false"));
  assert(sql.includes("'Program not found in template workspace/organization'"));
});

Deno.test("20. blueprint decryption remains organization-context correct", () => {
  assert(sql.includes("public.btpm_decrypt(_tpl.blueprint_payload, _org)"));
  assert(sql.includes("'Template not found'"));
  assert(sql.includes("'Template is archived'"));
  assert(sql.includes("Unsupported blueprint version"));
});

Deno.test("21. widening/confirmation behavior remains", () => {
  assert(sql.includes("_compute_project_effective_window(_bp, _project_start_date)"));
  assert(sql.includes("BTPM_REQUIRES_WIDENING"));
  assert(sql.includes("NOT _confirm_widening"));
  assert(sql.includes("relative_reanchored"));
});

Deno.test("22/23. created-object logic preserved", () => {
  for (const t of [
    "INSERT INTO public.projects",
    "INSERT INTO public.phases",
    "INSERT INTO public.tasks",
    "INSERT INTO public.dependencies",
    "INSERT INTO public.kpi_definitions",
    "INSERT INTO public.board_workflow_states",
    "INSERT INTO public.sprints",
    "INSERT INTO public.backlog_items",
  ]) {
    assert(sql.includes(t), `missing ${t}`);
  }
  assert(sql.includes("_delivery_model"));
});

Deno.test("24. activity-event behavior remains", () => {
  assert(sql.includes("'project_template_instantiated'"));
  assert(sql.includes("'project_widened_for_template_instantiation'"));
});

Deno.test("25. result shape and created_counts remain", () => {
  for (const k of [
    "'project_id', _new_project_id",
    "'schedule_mode_applied', _schedule_mode_applied",
    "'effective_window'",
    "'created_counts'",
    "'phases', _phase_count",
    "'backlog_items', _backlog_count",
  ]) {
    assert(sql.includes(k), `missing ${k}`);
  }
});

Deno.test("26/27. authenticated EXECUTE preserved, no PUBLIC/anon widening", () => {
  assert(sql.includes("GRANT EXECUTE ON FUNCTION public.instantiate_project_from_template(uuid, text, uuid, date, boolean, public.project_delivery_model) TO authenticated;"));
  assert(!/\bTO\s+(PUBLIC|public\b\s*;|anon)\b/i.test(sql.replace(/public\./g, "")));
  assert(!/REVOKE/i.test(sql));
});

Deno.test("28/30/31. no external wrapper, no other command redefined, no schema/RLS change", () => {
  for (const banned of [
    "api_v1_instantiate_project_from_template",
    "mcp_v1_instantiate_project_from_template",
    "apply_project_create_blank",
    "apply_program_create",
    "admin_create_portfolio_item",
    "CREATE TABLE",
    "ALTER TABLE",
    "CREATE POLICY",
    "DROP POLICY",
    "CREATE INDEX",
    "btpm_encrypt(",
    "CREATE TRIGGER",
  ]) {
    assert(!sql.includes(banned), `unexpected ${banned}`);
  }
});

Deno.test("29. NewProjectDialog still calls the RPC", async () => {
  const dialog = await read(DIALOG);
  assert(dialog.includes("instantiate_project_from_template"));
});

Deno.test("32. no migration-time business-data DML/backfill", () => {
  const body = sql.slice(idx("AS $function$"), sql.lastIndexOf("$function$") + 11);
  const outside = sql.replace(body, "");
  assert(!/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(outside));
});
