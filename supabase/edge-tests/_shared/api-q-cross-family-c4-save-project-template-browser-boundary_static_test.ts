import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = "supabase/migrations/20260819133106_cf4a55fc-42a8-48f4-8cd4-165ff093378a.sql";
const DIALOG = "src/components/templates/SaveAsTemplateDialog.tsx";

async function read(path: string): Promise<string> {
  const url = new URL(`../../../${path}`, import.meta.url);
  return await Deno.readTextFile(url);
}

const sql = await read(MIGRATION);
const idx = (needle: string) => sql.indexOf(needle);

Deno.test("1. exactly save_project_template_from_project is redefined", () => {
  const defs = sql.match(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)/g) ?? [];
  assertEquals(defs.length, 1);
  assert(String(defs[0]).includes("save_project_template_from_project"));
});

Deno.test("2. exact signature and default unchanged", () => {
  assert(sql.includes("_project_id uuid, _template_name text, _template_description text DEFAULT NULL::text"));
});

Deno.test("3. RETURNS jsonb unchanged", () => {
  assert(/RETURNS jsonb/.test(sql));
});

Deno.test("4. SECURITY DEFINER unchanged", () => {
  assert(sql.includes("SECURITY DEFINER"));
});

Deno.test("5. search_path and volatility unchanged", () => {
  assert(sql.includes("SET search_path TO 'public', 'extensions'"));
  assert(sql.includes("LANGUAGE plpgsql"));
  assert(!/\b(IMMUTABLE|STABLE)\b/.test(sql));
});

Deno.test("6/7/8. jwt_client_id evaluated before lookup, preview and INSERT", () => {
  const guard = idx("api_e_private.jwt_client_id()");
  assert(guard > -1);
  assert(guard < idx("FROM public.projects p"));
  assert(guard < idx("public.preview_project_clone_blueprint(_project_id)"));
  assert(guard < idx("INSERT INTO public.project_templates"));
});

Deno.test("9. resolution failure fails closed", () => {
  assert(sql.includes("EXCEPTION WHEN OTHERS THEN\n    v_client_id := 'unresolved_client';"));
});

Deno.test("10. non-null signed client raises Not authorized / 42501", () => {
  assert(sql.includes("IF v_client_id IS NOT NULL THEN\n    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';"));
});

Deno.test("11. no trusted-context or capability exception", () => {
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

Deno.test("12. auth.uid() requirement remains", () => {
  assert(sql.includes("_caller uuid := auth.uid();"));
  assert(sql.includes("RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'"));
});

Deno.test("13. is_active_user(_caller) required", () => {
  assert(sql.includes("IF NOT public.is_active_user(_caller) THEN"));
  assert(sql.includes("'Account is deactivated'"));
});

Deno.test("14. Organization/Workspace derive from the target Project", () => {
  assert(sql.includes("SELECT p.organization_id, p.workspace_id INTO _org, _ws FROM public.projects p WHERE p.id = _project_id;"));
  assert(sql.includes("'project not found'"));
});

Deno.test("15/16. canonical membership with user-first argument order", () => {
  assert(sql.includes("public.is_user_org_member(_caller, _org) IS NOT TRUE"));
});

Deno.test("17. legacy membership authorities absent", () => {
  for (const banned of ["get_user_org_id", "is_organization_member", "profiles.organization_id"]) {
    assert(!sql.includes(banned), `unexpected ${banned}`);
  }
});

Deno.test("18. Project PM authority remains required", () => {
  assert(sql.includes("IF NOT public.has_project_pm_authority(_caller, _project_id) THEN"));
  assert(sql.includes("'access denied: PM authority required'"));
});

Deno.test("19. can_write_demo(_caller, _ws) required", () => {
  assert(sql.includes("IF NOT public.can_write_demo(_caller, _ws) THEN"));
});

Deno.test("20. all authority gates precede preview generation and INSERT", () => {
  const preview = idx("public.preview_project_clone_blueprint(_project_id)");
  const ins = idx("INSERT INTO public.project_templates");
  for (const g of [
    idx("api_e_private.jwt_client_id()"),
    idx("IF _caller IS NULL"),
    idx("public.is_active_user(_caller)"),
    idx("public.is_user_org_member(_caller, _org)"),
    idx("public.has_project_pm_authority(_caller, _project_id)"),
    idx("public.can_write_demo(_caller, _ws)"),
  ]) {
    assert(g > -1);
    assert(g < preview);
    assert(g < ins);
  }
});

Deno.test("21/22. blueprint call and clone_blueprint_v1 validation remain", () => {
  assert(sql.includes("_blueprint := public.preview_project_clone_blueprint(_project_id);"));
  assert(sql.includes("_blueprint->>'version' <> 'clone_blueprint_v1'"));
  assert(sql.includes("_blueprint->>'blueprint_kind' <> 'project'"));
  assert(sql.includes("'invalid blueprint payload returned by preview_project_clone_blueprint'"));
});

Deno.test("23. project_templates INSERT fields unchanged", () => {
  assert(sql.includes("INSERT INTO public.project_templates (organization_id, workspace_id, source_project_id,\n    name, description, blueprint_payload, blueprint_version, created_by, updated_by)"));
  assert(sql.includes("VALUES (_org, _ws, _project_id, _template_name, _template_description, _blueprint::text,\n    'clone_blueprint_v1', _caller, _caller) RETURNING id INTO _new_id;"));
});

Deno.test("24. activity-event semantics remain", () => {
  assert(sql.includes("'project_template_created'"));
  assert(sql.includes("EXCEPTION WHEN OTHERS THEN NULL; END;"));
});

Deno.test("25. copied_counts remain", () => {
  for (const k of ["'phases'", "'tasks'", "'dependencies'", "'kpi_definitions'", "'workflow_states'", "'sprints'", "'backlog_items'"]) {
    assert(sql.includes(k), `missing ${k}`);
  }
});

Deno.test("26. returned JSON shape remains", () => {
  for (const k of [
    "'template_id', _new_id",
    "'organization_id', _org",
    "'workspace_id', _ws",
    "'source_project_id', _project_id",
    "'blueprint_version', 'clone_blueprint_v1'",
    "'template_name', _template_name",
    "'schedule_mode', _blueprint->>'schedule_mode'",
    "'copied_counts', _counts",
  ]) {
    assert(sql.includes(k), `missing ${k}`);
  }
});

Deno.test("27/28. authenticated EXECUTE preserved, no PUBLIC/anon widening", () => {
  assert(sql.includes("GRANT EXECUTE ON FUNCTION public.save_project_template_from_project(uuid, text, text) TO authenticated;"));
  assert(!/REVOKE/i.test(sql));
  assert(!/\bTO\s+(PUBLIC|anon)\b/i.test(sql));
});

Deno.test("29/31/32/33. no external wrapper and no other command redefined", () => {
  for (const banned of [
    "api_v1_save_project_template_from_project",
    "mcp_v1_save_project_template_from_project",
    "instantiate_project_from_template",
    "CREATE OR REPLACE FUNCTION public.preview_project_clone_blueprint",
    "create_blank_project",
    "apply_project_create_blank",
    "apply_program_create",
    "admin_create_portfolio_item",
    "apply_phase_",
    "apply_task_",
  ]) {
    assert(!sql.includes(banned), `unexpected ${banned}`);
  }
});

Deno.test("34. no RLS/schema/encryption change", () => {
  for (const banned of [
    "CREATE TABLE",
    "ALTER TABLE",
    "CREATE INDEX",
    "CREATE POLICY",
    "DROP POLICY",
    "CREATE TRIGGER",
    "tg_project_templates_encrypt",
    "btpm_encrypt(",
    "btpm_decrypt(",
    "ensure_org_encryption_key",
  ]) {
    assert(!sql.includes(banned), `unexpected ${banned}`);
  }
});

Deno.test("35. no migration-time business-data DML/backfill", () => {
  const body = sql.slice(idx("AS $function$"), sql.lastIndexOf("$function$") + 11);
  const outside = sql.replace(body, "");
  assert(!/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i.test(outside));
});

Deno.test("30. SaveAsTemplateDialog remains and calls this RPC", async () => {
  const dialog = await read(DIALOG);
  assert(dialog.includes('supabase.rpc("save_project_template_from_project"'));
});
