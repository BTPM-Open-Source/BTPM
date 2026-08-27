/**
 * API-Q Cross-Family-C10 — Task Clone Mutation
 * Browser Boundary and Canonical Write-Authority Hardening
 *
 * Focused static/contract test over the forward-only migration that redefines
 * public.clone_task_in_phase(uuid, text, date, boolean).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = new URL(
  "../../migrations/20260819160435_26b9e6d3-8676-44e7-87f4-51bef1eedb5d.sql",
  import.meta.url,
);
const DIALOG = new URL(
  "../../../src/components/planning/CloneTaskDialog.tsx",
  import.meta.url,
);

const sql = await Deno.readTextFile(MIGRATION);
const dialog = await Deno.readTextFile(DIALOG);
const has = (n: string) => sql.includes(n);
const idx = (n: string) => sql.indexOf(n);

const I_JWT = idx("api_e_private.jwt_client_id()");
const I_AUTHUID = idx("_caller := auth.uid();");
const I_ACTIVE = idx("public.is_active_user(_caller)");
const I_VALIDATE = idx("New task name is required");
const I_TASK_LOOKUP = idx("FROM public.tasks WHERE id = _task_id");
const I_MEMBER = idx("public.is_user_org_member(_caller, _src_task.organization_id)");
const I_PM = idx("public.has_pm_authority(_caller, _src_task.workspace_id)");
const I_WRITE = idx("public.can_write_demo(_caller, _src_task.workspace_id)");
const I_PHASE_LOOKUP = idx("FROM public.phases WHERE id = _src_task.phase_id");
const I_PREVIEW_WIDEN = idx("public.preview_task_clone_in_phase(_task_id, _task_start_date)");
const I_PREVIEW_BP = idx("public.preview_task_clone_blueprint(_task_id)");
const I_UPDATE = idx("UPDATE public.tasks");
const I_INSERT = idx("INSERT INTO public.tasks");
const I_APPLY = idx("public.apply_phase_planning_change(");

Deno.test("1. only clone_task_in_phase is redefined", () => {
  const matches = sql.match(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)/g) ?? [];
  assertEquals(matches.length, 1);
  assert(String(matches[0]).includes("clone_task_in_phase"));
});

Deno.test("2. exact four-parameter signature/defaults remain", () => {
  assert(has(
    "public.clone_task_in_phase(_task_id uuid, _new_task_name text, _task_start_date date DEFAULT NULL::date, _confirm_widening boolean DEFAULT false)",
  ));
});

Deno.test("3. RETURNS jsonb remains", () => {
  assert(/RETURNS jsonb/i.test(sql));
});

Deno.test("4. SECURITY DEFINER remains", () => {
  assert(has("SECURITY DEFINER"));
});

Deno.test("5. search_path remains", () => {
  assert(has("SET search_path TO 'public'"));
});

Deno.test("6. volatility remains unchanged (default VOLATILE)", () => {
  assert(!/\bSTABLE\b/i.test(sql));
  assert(!/\bIMMUTABLE\b/i.test(sql));
});

Deno.test("7. auth.uid() is not evaluated in DECLARE", () => {
  assert(has("_caller uuid;"));
  assert(!has("_caller uuid := auth.uid()"));
  const declare = sql.slice(idx("DECLARE"), idx("BEGIN"));
  assert(!declare.includes("auth.uid()"));
});

Deno.test("8. jwt_client_id() occurs before auth.uid()", () => {
  assert(I_JWT > -1 && I_AUTHUID > I_JWT);
});

Deno.test("9. jwt_client_id() occurs before Task lookup", () => {
  assert(I_TASK_LOOKUP > I_JWT);
});

Deno.test("10. jwt_client_id() occurs before Phase lookup", () => {
  assert(I_PHASE_LOOKUP > I_JWT);
});

Deno.test("11. jwt_client_id() occurs before both preview calls", () => {
  assert(I_PREVIEW_WIDEN > I_JWT && I_PREVIEW_BP > I_JWT);
});

Deno.test("12. jwt_client_id() occurs before first mutation", () => {
  assert(I_UPDATE > I_JWT && I_INSERT > I_JWT && I_APPLY > I_JWT);
});

Deno.test("13. resolution failure sets unresolved_client", () => {
  assert(/EXCEPTION WHEN OTHERS THEN\s*\n?\s*v_client_id := 'unresolved_client';/.test(sql));
});

Deno.test("14. non-null client id raises Not authorized / 42501", () => {
  assert(/IF v_client_id IS NOT NULL THEN\s*\n\s*RAISE EXCEPTION 'Not authorized'\s*\n\s*USING ERRCODE = '42501';/.test(sql));
});

Deno.test("15. no trusted-context/capability/source-channel exception exists", () => {
  for (const bad of ["source_channel", "api_version", "capability", "trusted", "btpm_internal", "external_api"]) {
    assert(!sql.toLowerCase().includes(bad), bad);
  }
});

Deno.test("16. authentication behavior remains", () => {
  assert(has("IF _caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;"));
});

Deno.test("17. is_active_user(_caller) is required", () => {
  assert(has("IF NOT public.is_active_user(_caller) THEN"));
  assert(has("Account is deactivated"));
  assert(I_ACTIVE > I_AUTHUID);
});

Deno.test("18. Task scope derives from _src_task", () => {
  assert(has("_src_task.organization_id, _src_task.workspace_id, _src_task.project_id, _src_task.phase_id"));
});

Deno.test("19. canonical is_user_org_member on authoritative org exists", () => {
  assert(has("IF public.is_user_org_member(_caller, _src_task.organization_id) IS NOT TRUE THEN"));
});

Deno.test("20. helper uses user-first argument order", () => {
  assert(I_MEMBER < idx(", _src_task.organization_id)") + 1);
  assert(has("is_user_org_member(_caller, _src_task.organization_id)"));
});

Deno.test("21. no legacy Organization-membership predicate exists", () => {
  for (const bad of ["get_user_org_id", "profiles.organization_id", "is_organization_member", "public.is_org_member("]) {
    assert(!sql.includes(bad), bad);
  }
});

Deno.test("22. has_pm_authority remains", () => {
  assert(has("IF NOT public.has_pm_authority(_caller, _src_task.workspace_id) THEN"));
  assert(has("PM authority required"));
});

Deno.test("23. can_write_demo is required", () => {
  assert(has("IF NOT public.can_write_demo(_caller, _src_task.workspace_id) THEN"));
});

Deno.test("24. authority gates precede Phase lookup, previews and writes", () => {
  assert(I_ACTIVE < I_TASK_LOOKUP);
  assert(I_TASK_LOOKUP < I_MEMBER);
  assert(I_MEMBER < I_PM);
  assert(I_PM < I_WRITE);
  assert(I_WRITE < I_PHASE_LOOKUP);
  assert(I_PHASE_LOOKUP < I_PREVIEW_WIDEN);
  assert(I_PREVIEW_WIDEN < I_PREVIEW_BP);
  assert(I_PREVIEW_BP < I_APPLY);
  assert(I_WRITE < I_UPDATE && I_WRITE < I_INSERT);
  assert(I_VALIDATE < I_TASK_LOOKUP && I_VALIDATE > I_ACTIVE);
});

Deno.test("25. preview_task_clone_in_phase call remains", () => {
  assert(has("_preview := public.preview_task_clone_in_phase(_task_id, _task_start_date);"));
});

Deno.test("26. BTPM_REQUIRES_WIDENING behavior remains", () => {
  assert(has("RAISE EXCEPTION 'BTPM_REQUIRES_WIDENING:%'"));
  assert(has("jsonb_build_object('scope','task_clone')"));
  assert(has("USING ERRCODE = 'check_violation'"));
  assert(has("NOT _confirm_widening"));
});

Deno.test("27. preview_task_clone_blueprint call remains", () => {
  assert(has("_bp := public.preview_task_clone_blueprint(_task_id);"));
});

Deno.test("28. apply_phase_planning_change widening path remains", () => {
  assert(has("PERFORM public.apply_phase_planning_change("));
  assert(has("_phase.id, _new_ph_start, _new_ph_end, true"));
  assert(has("parent_proposed_start"));
  assert(has("parent_proposed_end"));
});

Deno.test("29. phase_extended_for_task_clone event remains", () => {
  assert(has("'phase_extended_for_task_clone'"));
  assert(has("'trigger_task_id', _task_id"));
  assert(has("_did_widen := true;"));
});

Deno.test("30. scheduled/unscheduled Task-date behavior remains", () => {
  assert(has("IF _task_start_date IS NULL OR (_bp->>'schedule_mode') <> 'relative' THEN"));
  assert(has("start_offset_days"));
  assert(has("due_offset_days"));
});

Deno.test("31. sibling sort-order shift remains", () => {
  assert(has("SET sort_order = sort_order + 1, updated_at = now()"));
  assert(has("AND sort_order > _src_task.sort_order"));
  assert(has("_next_sort := _src_task.sort_order + 1;"));
});

Deno.test("32. Task INSERT behavior remains", () => {
  assert(has("INSERT INTO public.tasks ("));
  assert(has("'planned'::pm_status"));
  assert(has("'work_item'::task_type"));
  assert(has("'medium'::pm_priority"));
  assert(has("estimated_hours"));
  assert(has("false, _t_start, _t_due, _caller"));
});

Deno.test("33. task_cloned activity event remains", () => {
  assert(has("'task_cloned'"));
  assert(has("'source_task_id', _task_id"));
  assert(has("'new_task_id', _new_task_id"));
});

Deno.test("34. returned JSON/widened result remains", () => {
  assert(has("'task_id', _new_task_id"));
  assert(has("'phase_id', _src_task.phase_id"));
  assert(has("'project_id', _src_task.project_id"));
  assert(has("'workspace_id', _src_task.workspace_id"));
  assert(has("'widened', _did_widen"));
});

Deno.test("35. zero dependency-copy behavior is not changed", () => {
  assert(!sql.includes("dependencies"));
});

Deno.test("36. no GRANT/REVOKE change occurs", () => {
  assert(!/\bGRANT\b/i.test(sql));
  assert(!/\bREVOKE\b/i.test(sql));
});

Deno.test("37. CloneTaskDialog still calls clone_task_in_phase", () => {
  assert(dialog.includes("clone_task_in_phase"));
  assert(dialog.includes("preview_task_clone_blueprint"));
});

Deno.test("38. preview_task_clone_blueprint is not redefined", () => {
  assert(!/FUNCTION\s+public\.preview_task_clone_blueprint/.test(sql));
});

Deno.test("39. preview_task_clone_in_phase is not redefined", () => {
  assert(!/FUNCTION\s+public\.preview_task_clone_in_phase/.test(sql));
});

Deno.test("40. _clone_anchor_for_task is not redefined", () => {
  assert(!/FUNCTION\s+public\._clone_anchor_for_task/.test(sql));
});

Deno.test("41. no API/MCP capability is added", () => {
  for (const bad of ["api_v1_", "mcp_v1_", "api_capability", "api_clients"]) {
    assert(!sql.includes(bad), bad);
  }
});

Deno.test("42. no RLS/schema/encryption/frontend change occurs", () => {
  for (const bad of ["CREATE TABLE", "ALTER TABLE", "CREATE POLICY", "DROP POLICY", "ROW LEVEL SECURITY", "CREATE INDEX", "btpm_encrypt", "btpm_decrypt", "CREATE TRIGGER"]) {
    assert(!sql.toUpperCase().includes(bad.toUpperCase()), bad);
  }
});

Deno.test("43. no migration-time business-data DML/backfill occurs", () => {
  const body = sql.slice(0, idx("CREATE OR REPLACE FUNCTION"));
  assert(!/\b(INSERT|UPDATE|DELETE)\b/i.test(body));
  const tail = sql.slice(sql.lastIndexOf("$function$") + 10);
  assert(!/\b(INSERT|UPDATE|DELETE)\b/i.test(tail));
});
