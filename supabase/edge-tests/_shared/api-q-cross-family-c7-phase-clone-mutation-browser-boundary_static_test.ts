/**
 * API-Q Cross-Family-C7 — Phase Clone Mutation Browser Boundary
 *
 * Focused static/contract test over the forward-only migration that redefines
 * public.clone_phase_in_project.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = new URL(
  "../../migrations/20260819154102_2c94b95d-744a-4d91-8702-1bf50dc5200b.sql",
  import.meta.url,
);
const DIALOG = new URL(
  "../../../src/components/planning/ClonePhaseDialog.tsx",
  import.meta.url,
);

const sql = await Deno.readTextFile(MIGRATION);
const idx = (needle: string) => sql.indexOf(needle);
const has = (needle: string) => sql.includes(needle);

const I_JWT = idx("api_e_private.jwt_client_id()");
const I_AUTHUID = idx("_caller := auth.uid();");
const I_PHASE_LOOKUP = idx("FROM public.phases WHERE id = _phase_id");
const I_PREVIEW_IN_PROJECT = idx("public.preview_phase_clone_in_project(");
const I_PREVIEW_BP = idx("public.preview_phase_clone_blueprint(");
const I_FIRST_MUTATION = Math.min(
  ...[
    idx("UPDATE public.projects"),
    idx("UPDATE public.phases"),
    idx("INSERT INTO public.phases"),
    idx("INSERT INTO public.tasks"),
    idx("INSERT INTO public.dependencies"),
    idx("log_activity_event"),
  ].filter((n) => n >= 0),
);
const I_ACTIVE = idx("public.is_active_user(_caller)");
const I_MEMBER = idx("public.is_user_org_member(_caller, _src_phase.organization_id)");
const I_PM = idx("public.has_pm_authority(_caller, _src_phase.workspace_id)");
const I_WRITE = idx("public.can_write_demo(_caller, _src_phase.workspace_id)");

Deno.test("1. only clone_phase_in_project is redefined", () => {
  const matches = sql.match(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)/g) ?? [];
  assertEquals(matches.length, 1);
  assert(String(matches[0]).includes("clone_phase_in_project"));
});

Deno.test("2. exact signature/defaults remain", () => {
  assert(
    has(
      "public.clone_phase_in_project(_phase_id uuid, _new_phase_name text, _phase_start_date date DEFAULT NULL::date, _confirm_widening boolean DEFAULT false)",
    ),
  );
});

Deno.test("3. RETURNS jsonb remains", () => {
  assert(/RETURNS jsonb/i.test(sql));
});

Deno.test("4. SECURITY DEFINER / search_path / volatility remain", () => {
  assert(has("SECURITY DEFINER"));
  assert(has("SET search_path TO 'public'"));
  assert(!/\b(IMMUTABLE|STABLE)\b/.test(sql));
});

Deno.test("5. auth.uid() is not evaluated in the DECLARE initializer", () => {
  assert(has("_caller uuid;"));
  assert(!has("_caller uuid := auth.uid();"));
});

Deno.test("6. jwt_client_id() occurs before auth.uid()", () => {
  assert(I_JWT >= 0 && I_AUTHUID > I_JWT);
});

Deno.test("7. jwt_client_id() occurs before Phase lookup", () => {
  assert(I_PHASE_LOOKUP > I_JWT);
});

Deno.test("8. jwt_client_id() occurs before both preview calls", () => {
  assert(I_PREVIEW_IN_PROJECT > I_JWT);
  assert(I_PREVIEW_BP > I_JWT);
});

Deno.test("9. jwt_client_id() occurs before first mutation", () => {
  assert(I_FIRST_MUTATION > I_JWT);
});

Deno.test("10. resolution failure sets unresolved_client", () => {
  assert(has("EXCEPTION WHEN OTHERS THEN\n    v_client_id := 'unresolved_client';"));
});

Deno.test("11. non-null client id raises Not authorized / 42501", () => {
  assert(
    has(
      "IF v_client_id IS NOT NULL THEN\n    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';",
    ),
  );
});

Deno.test("12. no trusted-context/capability/source-channel exception exists", () => {
  for (
    const forbidden of [
      "assert_trusted_context",
      "capability_kind",
      "capability_key",
      "source_channel",
      "api_version",
    ]
  ) {
    assert(!has(forbidden), forbidden);
  }
});

Deno.test("13. authentication behavior remains", () => {
  assert(has("IF _caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;"));
});

Deno.test("14. is_active_user(_caller) is required", () => {
  assert(has("IF NOT public.is_active_user(_caller) THEN"));
  assert(has("'Account is deactivated'"));
});

Deno.test("15. Phase scope derives from _src_phase", () => {
  assert(has("SELECT * INTO _src_phase FROM public.phases WHERE id = _phase_id;"));
  assert(has("_src_phase.organization_id"));
  assert(has("_src_phase.workspace_id"));
  assert(has("_src_phase.project_id"));
  assert(has("'Phase not found'"));
});

Deno.test("16. canonical org membership check exists", () => {
  assert(I_MEMBER > 0);
  assert(has("IS NOT TRUE THEN"));
});

Deno.test("17. helper argument order is user-first", () => {
  assert(has("is_user_org_member(_caller, _src_phase.organization_id)"));
});

Deno.test("18. no legacy Organization membership authority exists", () => {
  for (
    const forbidden of [
      "get_user_org_id",
      "profiles.organization_id",
      "is_organization_member",
      "public.is_org_member(",
    ]
  ) {
    assert(!has(forbidden), forbidden);
  }
});

Deno.test("19. existing has_pm_authority check remains", () => {
  assert(I_PM > 0);
  assert(has("'PM authority required'"));
});

Deno.test("20. can_write_demo is required", () => {
  assert(I_WRITE > 0);
});

Deno.test("21. all four authority gates precede previews and mutations", () => {
  for (const gate of [I_ACTIVE, I_MEMBER, I_PM, I_WRITE]) {
    assert(gate > 0);
    assert(gate < I_PREVIEW_IN_PROJECT);
    assert(gate < I_PREVIEW_BP);
    assert(gate < I_FIRST_MUTATION);
  }
  assert(I_ACTIVE < I_MEMBER && I_MEMBER < I_PM && I_PM < I_WRITE);
});

Deno.test("22. preview_phase_clone_in_project call remains unchanged", () => {
  assert(has("public.preview_phase_clone_in_project(_phase_id, _phase_start_date);"));
});

Deno.test("23. BTPM_REQUIRES_WIDENING behavior remains", () => {
  assert(has("RAISE EXCEPTION 'BTPM_REQUIRES_WIDENING:%'"));
  assert(has("jsonb_build_object('scope','phase_clone')"));
  assert(has("USING ERRCODE = 'check_violation'"));
});

Deno.test("24. Project-widening behavior remains", () => {
  assert(has("parent_proposed_start"));
  assert(has("parent_proposed_end"));
  assert(has("set_config('app.allow_planned_extension','on', true)"));
  assert(has("SET start_date = _new_proj_start"));
  assert(has("target_end_date = _new_proj_end"));
  assert(has("'project_extended_for_phase_clone'"));
  assert(has("_did_widen := true;"));
});

Deno.test("25. preview_phase_clone_blueprint call remains", () => {
  assert(has("_bp := public.preview_phase_clone_blueprint(_phase_id);"));
});

Deno.test("26. Phase sort-order behavior remains", () => {
  assert(has("SET sort_order = sort_order + 1, updated_at = now()"));
  assert(has("AND sort_order > _src_phase.sort_order;"));
  assert(has("_next_sort := _src_phase.sort_order + 1;"));
});

Deno.test("27. Phase INSERT behavior remains", () => {
  assert(has("INSERT INTO public.phases ("));
  assert(has("'planned'::pm_status, false,"));
  assert(has("_ph_start, _ph_end, _caller"));
});

Deno.test("28. Task cloning remains", () => {
  assert(has("INSERT INTO public.tasks ("));
  assert(has("_task_map := _task_map || jsonb_build_object(_tk->>'ref', _new_id::text);"));
  assert(has("estimated_hours"));
});

Deno.test("29. dependency cloning / entity_type behavior remains", () => {
  assert(has("_dep_entity := COALESCE(_dep->>'entity_type', _dep->>'source_type');"));
  assert(has("IF _dep_entity = 'task' THEN"));
  assert(has("INSERT INTO public.dependencies ("));
});

Deno.test("30. phase_cloned event remains", () => {
  assert(has("'phase_cloned'"));
});

Deno.test("31. result JSON / created_counts remain", () => {
  assert(has("'phase_id', _new_phase_id"));
  assert(has("'widened', _did_widen"));
  assert(
    has("'created_counts', jsonb_build_object('tasks', _task_count, 'dependencies', _dep_count)"),
  );
});

Deno.test("32. no GRANT/REVOKE change occurs", () => {
  assert(!/\bGRANT\b/i.test(sql));
  assert(!/\bREVOKE\b/i.test(sql));
});

Deno.test("33. ClonePhaseDialog still calls clone_phase_in_project", async () => {
  const dialog = await Deno.readTextFile(DIALOG);
  assert(dialog.includes('supabase.rpc("clone_phase_in_project"'));
});

Deno.test("34-35. preview functions are not redefined", () => {
  assert(!/CREATE OR REPLACE FUNCTION\s+public\.preview_phase_clone_blueprint/.test(sql));
  assert(!/CREATE OR REPLACE FUNCTION\s+public\.preview_phase_clone_in_project/.test(sql));
});

Deno.test("36. no external API/MCP capability is added", () => {
  for (
    const forbidden of [
      "api_v1_clone_phase_in_project",
      "mcp_v1_clone_phase_in_project",
      "api_capability_catalogue",
      "api_capability_grants",
    ]
  ) {
    assert(!has(forbidden), forbidden);
  }
});

Deno.test("37. no RLS/schema/encryption change occurs", () => {
  for (
    const forbidden of [
      "CREATE POLICY",
      "DROP POLICY",
      "ALTER POLICY",
      "ROW LEVEL SECURITY",
      "CREATE TABLE",
      "ALTER TABLE",
      "CREATE INDEX",
      "btpm_encrypt",
      "btpm_decrypt",
      "CREATE TRIGGER",
    ]
  ) {
    assert(!sql.toUpperCase().includes(forbidden.toUpperCase()), forbidden);
  }
});

Deno.test("38. no migration-time business-data DML/backfill occurs", () => {
  // All DML must live inside the function body (after the AS $function$ marker).
  const bodyStart = sql.indexOf("AS $function$");
  const bodyEnd = sql.lastIndexOf("$function$");
  const outside = sql.slice(0, bodyStart) + sql.slice(bodyEnd);
  assert(!/\b(INSERT|UPDATE|DELETE)\b/i.test(outside));
});
