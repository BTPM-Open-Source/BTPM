/**
 * API-Q Cross-Family-C9 — Task Clone Blueprint Preview
 * Browser Boundary and Canonical Read-Authority Hardening
 *
 * Focused static/contract test over the forward-only migration that redefines
 * public.preview_task_clone_blueprint(uuid).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = new URL(
  "../../migrations/20260819155840_9f2353e6-3701-440d-ae9f-32019042d4e3.sql",
  import.meta.url,
);
const DIALOG = new URL(
  "../../../src/components/planning/CloneTaskDialog.tsx",
  import.meta.url,
);

const sql = await Deno.readTextFile(MIGRATION);
const dialog = await Deno.readTextFile(DIALOG);
const U = sql.toUpperCase();
const has = (n: string) => sql.includes(n);
const idx = (n: string) => sql.indexOf(n);

const I_JWT = idx("api_e_private.jwt_client_id()");
const I_AUTHUID = idx("_caller := auth.uid();");
const I_ACTIVE = idx("public.is_active_user(_caller)");
const I_TASK_LOOKUP = idx("FROM public.tasks WHERE id = _task_id");
const I_MEMBER = idx("public.is_user_org_member(_caller, _task_row.organization_id)");
const I_PM = idx("public.has_pm_authority(_caller, _task_row.workspace_id)");
const I_PHASE_LOOKUP = idx("FROM public.phases WHERE id = _task_row.phase_id");
const I_ANCHOR = idx("public._clone_anchor_for_task(_task_id)");
const I_DECRYPT = idx("public.btpm_decrypt(");

Deno.test("1. only preview_task_clone_blueprint is redefined", () => {
  const matches = sql.match(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)/g) ?? [];
  assertEquals(matches.length, 1);
  assert(String(matches[0]).includes("preview_task_clone_blueprint"));
});

Deno.test("2. exact signature remains unchanged", () => {
  assert(has("public.preview_task_clone_blueprint(_task_id uuid)"));
});

Deno.test("3. RETURNS jsonb remains", () => {
  assert(/RETURNS jsonb/i.test(sql));
});

Deno.test("4. STABLE remains", () => {
  assert(has("STABLE SECURITY DEFINER"));
  assert(!/\bVOLATILE\b/i.test(sql));
  assert(!/\bIMMUTABLE\b/i.test(sql));
});

Deno.test("5. SECURITY DEFINER remains", () => {
  assert(has("SECURITY DEFINER"));
});

Deno.test("6. search_path remains", () => {
  assert(has("SET search_path TO 'public'"));
});

Deno.test("7. jwt_client_id() occurs before auth.uid()", () => {
  assert(I_JWT >= 0 && I_AUTHUID > I_JWT);
});

Deno.test("8. jwt_client_id() occurs before Task lookup", () => {
  assert(I_TASK_LOOKUP > I_JWT);
});

Deno.test("9. jwt_client_id() occurs before Phase lookup", () => {
  assert(I_PHASE_LOOKUP > I_JWT);
});

Deno.test("10. jwt_client_id() occurs before _clone_anchor_for_task", () => {
  assert(I_ANCHOR > I_JWT);
});

Deno.test("11. jwt_client_id() occurs before first btpm_decrypt", () => {
  assert(I_DECRYPT > I_JWT);
});

Deno.test("12. resolution failure sets unresolved_client", () => {
  assert(has("EXCEPTION WHEN OTHERS THEN\n    v_client_id := 'unresolved_client';"));
});

Deno.test("13. non-null client id raises Not authorized / 42501", () => {
  assert(
    has(
      "IF v_client_id IS NOT NULL THEN\n    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';",
    ),
  );
});

Deno.test("14. no trusted-context/capability/source-channel exception exists", () => {
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

Deno.test("15. auth.uid() remains authoritative caller identity", () => {
  assert(has("_caller uuid;"));
  assert(!has("_caller uuid := auth.uid();"));
  assert(I_AUTHUID > 0);
});

Deno.test("16. Authentication required / 42501 behavior remains", () => {
  assert(has("RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';"));
});

Deno.test("17. is_active_user(_caller) is required", () => {
  assert(I_ACTIVE > 0);
  assert(has("IF NOT public.is_active_user(_caller) THEN"));
  assert(has("'Account is deactivated'"));
});

Deno.test("18. Task scope derives from _task_row", () => {
  assert(has("SELECT * INTO _task_row FROM public.tasks WHERE id = _task_id;"));
  assert(has("_task_row.organization_id"));
  assert(has("_task_row.workspace_id"));
  assert(has("_task_row.project_id"));
  assert(has("_task_row.phase_id"));
  assert(has("'Task % not found'"));
});

Deno.test("19. canonical org membership check exists", () => {
  assert(I_MEMBER > 0);
  assert(has("IS NOT TRUE THEN"));
});

Deno.test("20. membership helper uses user-first argument order", () => {
  assert(has("is_user_org_member(_caller, _task_row.organization_id)"));
});

Deno.test("21. no legacy Organization-membership predicate is used", () => {
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

Deno.test("22. existing has_pm_authority check remains", () => {
  assert(I_PM > 0);
  assert(has("'Access denied: PM authority required in workspace %'"));
});

Deno.test("23. gates precede Phase lookup, anchor and decryption", () => {
  for (const gate of [I_ACTIVE, I_MEMBER, I_PM]) {
    assert(gate > 0);
    assert(gate < I_PHASE_LOOKUP);
    assert(gate < I_ANCHOR);
    assert(gate < I_DECRYPT);
  }
  assert(I_ACTIVE < I_TASK_LOOKUP);
  assert(I_TASK_LOOKUP < I_MEMBER && I_MEMBER < I_PM);
});

Deno.test("24. no can_write_demo is introduced", () => {
  assert(!has("can_write_demo"));
});

Deno.test("25. parent Phase lookup/provenance remains", () => {
  assert(has("SELECT * INTO _phase_row FROM public.phases WHERE id = _task_row.phase_id;"));
  assert(has("'ref', 'phase_1'"));
  assert(has("'source_id', _phase_row.id"));
});

Deno.test("26. all existing Task/Phase decrypt operations remain", () => {
  for (
    const call of [
      "public.btpm_decrypt(_phase_row.name, _phase_row.organization_id)",
      "public.btpm_decrypt(_phase_row.description, _phase_row.organization_id)",
      "public.btpm_decrypt(_task_row.name, _task_row.organization_id)",
      "public.btpm_decrypt(_task_row.description, _task_row.organization_id)",
    ]
  ) {
    assert(has(call), call);
  }
});

Deno.test("27. decrypt fallback behavior remains", () => {
  for (
    const fb of [
      "_phase_name := _phase_row.name;",
      "_phase_desc := _phase_row.description;",
      "_task_name := _task_row.name;",
      "_task_desc := _task_row.description;",
    ]
  ) {
    assert(has(fb), fb);
  }
});

Deno.test("28. _clone_anchor_for_task remains", () => {
  assert(has("_anchor := public._clone_anchor_for_task(_task_id);"));
});

Deno.test("29. schedule/offset behavior remains", () => {
  assert(has("'unscheduled'"));
  assert(has("'relative'"));
  assert(has("'task_start_date'"));
  assert(has("'task_earliest_date'"));
  assert(has("public._clone_offset_days(_anchor, _task_row.start_date)"));
  assert(has("public._clone_offset_days(_anchor, _task_row.due_date)"));
});

Deno.test("30. clone_blueprint_v1 Task result shape remains", () => {
  for (
    const key of [
      "'version', 'clone_blueprint_v1'",
      "'blueprint_kind', 'task'",
      "'saved_at', to_jsonb(now())",
      "'anchor_date', to_jsonb(_anchor)",
      "'task_type', _task_row.task_type",
      "'priority', _task_row.priority",
      "'estimated_hours', _task_row.estimated_hours",
      "'sort_order', _task_row.sort_order",
      "'backlog_item_id', _task_row.backlog_item_id",
      "'workflow_state_id', _task_row.workflow_state_id",
      "'kpi_definitions', '[]'::jsonb",
      "'enabled', false",
    ]
  ) {
    assert(has(key), key);
  }
});

Deno.test("31. zero-dependency behavior remains", () => {
  assert(has("'dependencies', '[]'::jsonb"));
});

Deno.test("32. no GRANT/REVOKE change occurs", () => {
  assert(!/\bGRANT\b/i.test(sql));
  assert(!/\bREVOKE\b/i.test(sql));
});

Deno.test("33. CloneTaskDialog still calls preview_task_clone_blueprint", () => {
  assert(dialog.includes('supabase.rpc("preview_task_clone_blueprint"'));
});

Deno.test("34. CloneTaskDialog still calls clone_task_in_phase", () => {
  assert(dialog.includes('supabase.rpc("clone_task_in_phase"'));
});

Deno.test("35. preview_task_clone_in_phase is not redefined", () => {
  assert(!/FUNCTION\s+public\.preview_task_clone_in_phase/i.test(sql));
});

Deno.test("36. clone_task_in_phase is not redefined", () => {
  assert(!/FUNCTION\s+public\.clone_task_in_phase/i.test(sql));
});

Deno.test("37. _clone_anchor_for_task is not redefined", () => {
  assert(!/FUNCTION\s+public\._clone_anchor_for_task/i.test(sql));
});

Deno.test("38. no external API/MCP capability is added", () => {
  for (
    const forbidden of [
      "api_v1_preview_task_clone_blueprint",
      "mcp_v1_preview_task_clone_blueprint",
      "api_capability_catalogue",
      "api_capability_grants",
    ]
  ) {
    assert(!has(forbidden), forbidden);
  }
});

Deno.test("39. no RLS/schema/encryption/frontend change occurs", () => {
  for (
    const forbidden of [
      "CREATE POLICY",
      "DROP POLICY",
      "ALTER POLICY",
      "ROW LEVEL SECURITY",
      "CREATE TABLE",
      "ALTER TABLE",
      "DROP TABLE",
      "CREATE INDEX",
      "CREATE TRIGGER",
      "CREATE TYPE",
      "BTPM_ENCRYPT",
    ]
  ) {
    assert(!U.includes(forbidden), forbidden);
  }
  assert(!/\.tsx?\b/i.test(sql));
  assert(!/supabase\.rpc/i.test(sql));
});

Deno.test("40. no migration-time business-data DML/backfill occurs", () => {
  const bodyStart = sql.indexOf("AS $function$");
  const bodyEnd = sql.lastIndexOf("$function$");
  const outside = sql.slice(0, bodyStart) + sql.slice(bodyEnd);
  assert(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|MERGE)\b/i.test(outside));
});
