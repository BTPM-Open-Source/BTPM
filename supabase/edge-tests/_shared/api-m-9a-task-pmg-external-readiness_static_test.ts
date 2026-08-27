// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-m-9a-task-pmg-external-readiness_static_test.ts', import.meta.url).href;
/**
 * API-M.9A — Task PMG exact-capability external readiness (static contract test)
 *
 * Regression guard over the migration that makes the five canonical Class-A
 * Task PMG commands source-aware and exact-capability bound:
 *
 *   apply_task_create            -> tasks:create
 *   apply_task_update            -> tasks:update
 *   reorder_tasks                -> tasks:reorder
 *   apply_task_assignee_set      -> tasks:assign
 *   apply_task_execution_change  -> tasks:transition
 *
 * Verifies:
 *  - the five signatures are unchanged and still SECURITY DEFINER with a pinned
 *    search_path;
 *  - each function declares the server-derived v_source_channel (default
 *    btpm_ui) and never accepts a caller-provided source channel / capability /
 *    client id / trust flag parameter;
 *  - OAuth detection uses api_e_private.jwt_client_id() inside an exception-safe
 *    block, and trust uses api_e_private.assert_trusted_context();
 *  - the exact frozen capability key is required per command — no wildcard,
 *    prefix, LIKE, ANY or dynamic capability match;
 *  - api_version=v1, capability_kind=command and source_channel=external_api are
 *    all required;
 *  - the containment block fails closed with a bounded PMG not_authorized
 *    result BEFORE is_active_user, target lookup, FOR UPDATE, any write,
 *    delegated business call or PMG audit;
 *  - every pmg_record_command_audit call now passes v_source_channel and no
 *    literal 'btpm_ui'::public.pmg_source_channel argument survives;
 *  - existing business authorization (has_project_pm_authority + can_write_demo)
 *    and optimistic concurrency remain in place;
 *  - apply_task_planning_change is NOT touched by this migration.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH =
  "supabase/migrations/20260811042655_6931029f-7486-4f31-ba66-eab19452914b.sql";

const SQL = await Deno.readTextFile(new URL(`../../../${MIGRATION_PATH}`, __BTPM_SRC_BASE__));

type Cmd = { fn: string; capability: string };

const COMMANDS: Cmd[] = [
  { fn: "apply_task_create", capability: "tasks:create" },
  { fn: "apply_task_update", capability: "tasks:update" },
  { fn: "reorder_tasks", capability: "tasks:reorder" },
  { fn: "apply_task_assignee_set", capability: "tasks:assign" },
  { fn: "apply_task_execution_change", capability: "tasks:transition" },
];

/** Slice the SQL text belonging to one function definition. */
function sectionFor(fn: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert(start > -1, `missing definition for ${fn}`);
  const end = SQL.indexOf("$function$;", start);
  assert(end > start, `missing terminator for ${fn}`);
  return SQL.slice(start, end + "$function$;".length);
}

Deno.test("API-M.9A: exactly the five Task commands are redefined", () => {
  const redefined = [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) =>
    m[1]
  );
  assertEquals(redefined.sort(), COMMANDS.map((c) => c.fn).sort());
});

Deno.test("API-M.9A: apply_task_planning_change is untouched", () => {
  assertEquals(/CREATE OR REPLACE FUNCTION public\.apply_task_planning_change/.test(SQL), false);
});

Deno.test("API-M.9A: no schema, grant, RLS or capability-catalogue change", () => {
  assertEquals(/\bCREATE TABLE\b/i.test(SQL), false);
  assertEquals(/\bALTER TABLE\b/i.test(SQL), false);
  assertEquals(/\bCREATE POLICY\b/i.test(SQL), false);
  assertEquals(/\bGRANT\b/i.test(SQL), false);
  assertEquals(/\bREVOKE\b/i.test(SQL), false);
  assertEquals(/api_capability_catalogue/i.test(SQL), false);
  assertEquals(/api_idempotency_registry/i.test(SQL), false);
  // CREATE TEMP TABLE inside reorder_tasks is pre-existing behavior, not schema.
  assert(/CREATE TEMP TABLE _pmg_task_reorder_input/.test(SQL));
});

Deno.test("API-M.9A: signatures and executor properties are unchanged", () => {
  const signatures: Record<string, RegExp> = {
    apply_task_create:
      /CREATE OR REPLACE FUNCTION public\.apply_task_create\(_phase_id uuid, _name text, _description text DEFAULT NULL::text, _status pm_status DEFAULT 'planned'::pm_status, _priority pm_priority DEFAULT 'medium'::pm_priority, _task_type task_type DEFAULT 'work_item'::task_type, _start_date date DEFAULT NULL::date, _due_date date DEFAULT NULL::date, _estimated_hours numeric DEFAULT NULL::numeric, _sort_order integer DEFAULT NULL::integer, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)/,
    apply_task_update:
      /CREATE OR REPLACE FUNCTION public\.apply_task_update\(_task_id uuid, _expected_updated_at timestamp with time zone, _name text, _description text DEFAULT NULL::text, _status pm_status DEFAULT NULL::pm_status, _priority pm_priority DEFAULT NULL::pm_priority, _task_type task_type DEFAULT NULL::task_type, _estimated_hours numeric DEFAULT NULL::numeric, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)/,
    reorder_tasks:
      /CREATE OR REPLACE FUNCTION public\.reorder_tasks\(_phase_id uuid, _rows jsonb, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)/,
    apply_task_assignee_set:
      /CREATE OR REPLACE FUNCTION public\.apply_task_assignee_set\(\s*_task_id uuid,\s*_assignee_id uuid DEFAULT NULL,\s*_correlation_id text DEFAULT NULL,\s*_idempotency_key text DEFAULT NULL\s*\)/,
    apply_task_execution_change:
      /CREATE OR REPLACE FUNCTION public\.apply_task_execution_change\(\s*_task_id uuid,\s*_expected_updated_at timestamptz,\s*_set_actual_start boolean DEFAULT false,\s*_actual_start_date date DEFAULT NULL,\s*_set_actual_end boolean DEFAULT false,\s*_actual_end_date date DEFAULT NULL,\s*_status public\.pm_status DEFAULT NULL,\s*_correlation_id text DEFAULT NULL,\s*_idempotency_key text DEFAULT NULL\s*\)/,
  };

  for (const { fn } of COMMANDS) {
    const section = sectionFor(fn);
    assert(signatures[fn].test(section), `${fn}: signature drift`);
    assert(/RETURNS jsonb/.test(section), `${fn}: return type drift`);
    assert(/SECURITY DEFINER/.test(section), `${fn}: missing SECURITY DEFINER`);
    assert(
      /SET search_path (TO 'pg_catalog', 'public'|= pg_catalog, public)/.test(section),
      `${fn}: search_path not pinned`,
    );
  }
});

Deno.test("API-M.9A: no caller-provided source, capability, client or trust parameter", () => {
  for (const { fn } of COMMANDS) {
    const section = sectionFor(fn);
    const args = section.slice(
      section.indexOf(`public.${fn}(`),
      section.indexOf("RETURNS jsonb"),
    );
    for (const forbidden of [
      "_source_channel",
      "_capability_key",
      "_api_client_id",
      "_executing_user_id",
      "_trusted",
      "_actor",
    ]) {
      assertEquals(args.includes(forbidden), false, `${fn}: forbidden parameter ${forbidden}`);
    }
  }
});

Deno.test("API-M.9A: server-derived source channel is declared and defaults to btpm_ui", () => {
  for (const { fn } of COMMANDS) {
    const section = sectionFor(fn);
    assert(
      /-- API-M\.9A: server-derived source channel\. Never caller-provided\./.test(section),
      `${fn}: missing provenance comment`,
    );
    assert(/v_client_id text;/.test(section), `${fn}: missing v_client_id`);
    assert(/v_trusted boolean := false;/.test(section), `${fn}: missing v_trusted`);
    assert(
      /v_source_channel public\.pmg_source_channel := 'btpm_ui'::public\.pmg_source_channel;/.test(
        section,
      ),
      `${fn}: missing default btpm_ui source channel`,
    );
    assert(
      /v_source_channel := 'external_api'::public\.pmg_source_channel;/.test(section),
      `${fn}: missing external_api promotion`,
    );
  }
});

Deno.test("API-M.9A: OAuth detection and trust use api_e_private, exception-safe", () => {
  for (const { fn } of COMMANDS) {
    const section = sectionFor(fn);
    assert(
      /BEGIN\s+v_client_id := api_e_private\.jwt_client_id\(\);\s+EXCEPTION WHEN OTHERS THEN\s+v_client_id := 'unresolved_client';\s+END;/
        .test(section),
      `${fn}: client identity not exception-safe`,
    );
    assert(/IF v_client_id IS NOT NULL THEN/.test(section), `${fn}: missing OAuth branch`);
    assert(
      /BEGIN\s+v_trusted := api_e_private\.assert_trusted_context\(\);\s+EXCEPTION WHEN OTHERS THEN\s+v_trusted := false;\s+END;/
        .test(section),
      `${fn}: trusted context not exception-safe`,
    );
    assert(/IF v_trusted IS NOT TRUE/.test(section), `${fn}: missing trust assertion`);
  }
});

Deno.test("API-M.9A: each command requires its exact frozen capability key", () => {
  for (const { fn, capability } of COMMANDS) {
    const section = sectionFor(fn);
    assert(
      section.includes(
        `OR COALESCE(NULLIF(btrim(COALESCE(current_setting('api_e.capability_key', true),'')),''), '') <> '${capability}'`,
      ),
      `${fn}: missing exact capability binding for ${capability}`,
    );
    // Exactly one capability comparison, and it is this command's capability.
    const keys = [...section.matchAll(/api_e\.capability_key[\s\S]{0,90}?<> '([^']+)'/g)].map((m) =>
      m[1]
    );
    assertEquals(keys, [capability], `${fn}: unexpected capability comparisons`);
    // No other Task capability may be accepted by this command.
    for (const other of COMMANDS.filter((c) => c.fn !== fn)) {
      assertEquals(
        section.includes(`'${other.capability}'`),
        false,
        `${fn}: leaks capability ${other.capability}`,
      );
    }
  }
});

Deno.test("API-M.9A: no wildcard, prefix, LIKE, ANY or dynamic capability match", () => {
  assertEquals(/capability_key[^\n]*\bLIKE\b/i.test(SQL), false);
  assertEquals(/capability_key[^\n]*\bANY\b/i.test(SQL), false);
  assertEquals(/capability_key[^\n]*\bIN \(/i.test(SQL), false);
  assertEquals(/tasks:\*/.test(SQL), false);
  assertEquals(/tasks:%/.test(SQL), false);
  assertEquals(/\bEXECUTE format\b/i.test(SQL), false);
  assertEquals(/\bEXECUTE '/.test(SQL), false);
  assertEquals(/starts_with\s*\(/i.test(SQL), false);
  assertEquals(/split_part\s*\(\s*[^,]*capability_key/i.test(SQL), false);
});

Deno.test("API-M.9A: version, kind and channel are all required for external callers", () => {
  for (const { fn } of COMMANDS) {
    const section = sectionFor(fn);
    assert(
      section.includes(
        "OR COALESCE(NULLIF(btrim(COALESCE(current_setting('api_e.api_version', true),'')),''), '') <> 'v1'",
      ),
      `${fn}: missing api_version=v1 requirement`,
    );
    assert(
      section.includes(
        "OR COALESCE(NULLIF(btrim(COALESCE(current_setting('api_e.capability_kind', true),'')),''), '') <> 'command'",
      ),
      `${fn}: missing capability_kind=command requirement`,
    );
    assert(
      section.includes(
        "OR COALESCE(NULLIF(btrim(COALESCE(current_setting('api_e.source_channel', true),'')),''), '') <> 'external_api'",
      ),
      `${fn}: missing source_channel=external_api requirement`,
    );
  }
});

Deno.test("API-M.9A: containment fails closed before lookup, lock, write, delegation or audit", () => {
  for (const { fn } of COMMANDS) {
    const section = sectionFor(fn);
    const guardIdx = section.indexOf(
      "-- Fail closed BEFORE is_active_user, target lookup, FOR UPDATE, write or audit.",
    );
    assert(guardIdx > -1, `${fn}: missing fail-closed marker`);

    // The fail-closed return is a bounded PMG not_authorized result.
    assert(
      new RegExp(
        `Fail closed BEFORE[\\s\\S]{0,120}RETURN public\\.pmg_build_result\\(\\s*'not_authorized'::public\\.pmg_command_status, '${fn}'`,
      ).test(section),
      `${fn}: fail-closed path does not return a bounded not_authorized result`,
    );

    // Everything security-relevant happens strictly after the guard.
    for (const marker of [
      "public.is_active_user(",
      "public.has_project_pm_authority(",
      "public.can_write_demo(",
      "public.pmg_record_command_audit(",
    ]) {
      const idx = section.indexOf(marker);
      assert(idx > guardIdx, `${fn}: ${marker} appears before the containment guard`);
    }

    const forUpdate = section.indexOf("FOR UPDATE");
    if (forUpdate > -1) {
      assert(forUpdate > guardIdx, `${fn}: FOR UPDATE appears before the containment guard`);
    }
    for (const write of ["INSERT INTO public.tasks", "UPDATE public.tasks", "set_task_assignee("]) {
      const idx = section.indexOf(write);
      if (idx > -1) assert(idx > guardIdx, `${fn}: ${write} appears before the containment guard`);
    }
  }
});

Deno.test("API-M.9A: every audit call uses the server-derived source channel", () => {
  // No literal source channel argument survives anywhere in the migration.
  assertEquals(/'btpm_ui'::public\.pmg_source_channel,/.test(SQL), false);
  assertEquals(/'external_api'::public\.pmg_source_channel,\s*\n/.test(SQL), false);

  const expectedAuditCounts: Record<string, number> = {
    apply_task_create: 1,
    apply_task_update: 3,
    reorder_tasks: 2,
    apply_task_assignee_set: 2,
    apply_task_execution_change: 4,
  };

  for (const { fn } of COMMANDS) {
    const section = sectionFor(fn);
    const audits = section.match(/PERFORM public\.pmg_record_command_audit\(/g) ?? [];
    assertEquals(audits.length, expectedAuditCounts[fn], `${fn}: audit call count drift`);
    const channelArgs = section.match(/^\s*v_source_channel,$/gm) ?? [];
    assertEquals(
      channelArgs.length,
      expectedAuditCounts[fn],
      `${fn}: not every audit call passes v_source_channel`,
    );
  }
});

Deno.test("API-M.9A: business authority and demo-write gates are preserved", () => {
  for (const { fn } of COMMANDS) {
    const section = sectionFor(fn);
    assert(/public\.is_active_user\(v_actor\)/.test(section), `${fn}: lost active-user gate`);
    assert(
      /public\.has_project_pm_authority\(v_actor, v_project_id\)/.test(section),
      `${fn}: lost PM authority gate`,
    );
    assert(/public\.can_write_demo\(v_actor, /.test(section), `${fn}: lost demo-write gate`);
    assert(/v_actor uuid := auth\.uid\(\);/.test(section), `${fn}: actor no longer from auth.uid()`);
  }
});

Deno.test("API-M.9A: optimistic concurrency is preserved where it existed", () => {
  for (const fn of ["apply_task_update", "apply_task_execution_change"]) {
    const section = sectionFor(fn);
    assert(
      /IF _expected_updated_at IS NULL THEN/.test(section),
      `${fn}: lost expected_updated_at requirement`,
    );
    assert(
      /v_task\.updated_at IS DISTINCT FROM _expected_updated_at/.test(section),
      `${fn}: lost staleness comparison`,
    );
    assert(/'conflict'::public\.pmg_command_status/.test(section), `${fn}: lost conflict result`);
  }

  const reorder = sectionFor("reorder_tasks");
  assert(/t\.updated_at IS DISTINCT FROM i\.expected_updated_at/.test(reorder));
  assert(/'stale_task_order'/.test(reorder));
});

/* ============================================================================
 * API-M.9A-C1 — permanent preservation guards for the five Task commands.
 * These statically pin canonical behavior that M.9A must not weaken.
 * ==========================================================================*/

/** Executable SQL only: drop `-- ...` comment lines before structural checks. */
function executableSql(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
}

Deno.test("API-M.9A-C1 create: Phase-window confirmation remains canonical", () => {
  const section = sectionFor("apply_task_create");
  for (const marker of [
    "'reason','task_start_before_phase_start'",
    "'reason','task_due_after_phase_end'",
    "'confirmation_required'::public.pmg_command_status, 'apply_task_create'",
    "'code','extend_phase_window_required'",
  ]) {
    assert(section.includes(marker), `apply_task_create: lost ${marker}`);
  }
  // Both window branches must still exist (two confirmation_required returns).
  assertEquals(
    (section.match(/'confirmation_required'::public\.pmg_command_status/g) ?? []).length,
    2,
    "apply_task_create: Phase-window confirmation branch count drift",
  );
  // Task create must never silently widen the Phase window.
  assertEquals(
    /UPDATE public\.phases/.test(section),
    false,
    "apply_task_create: must not write to phases",
  );
});

Deno.test("API-M.9A-C1 create: no concurrency token is introduced", () => {
  const section = sectionFor("apply_task_create");
  assertEquals(
    section.includes("_expected_updated_at"),
    false,
    "apply_task_create: _expected_updated_at must not exist",
  );
});

Deno.test("API-M.9A-C1 create: existing create mechanics remain", () => {
  const section = sectionFor("apply_task_create");
  for (const marker of [
    "public.has_project_pm_authority",
    "public.can_write_demo",
    "INSERT INTO public.tasks",
    "FOR UPDATE",
  ]) {
    assert(section.includes(marker), `apply_task_create: lost ${marker}`);
  }
  // Canonical sibling-shift ordering mechanics.
  assert(
    /WITH shifted AS \(\s*UPDATE public\.tasks\s*SET sort_order = sort_order \+ 1\s*WHERE phase_id = _phase_id\s*AND sort_order >= v_resolved_sort\s*RETURNING id\s*\)/
      .test(section),
    "apply_task_create: lost canonical sibling-shift mechanics",
  );
  assert(
    /SELECT count\(\*\) INTO v_shifted_count FROM shifted;/.test(section),
    "apply_task_create: lost shifted sibling count",
  );
  assert(
    section.includes("'shifted_sibling_count', v_shifted_count"),
    "apply_task_create: lost shifted_sibling_count in result/audit",
  );
});

Deno.test("API-M.9A-C1 update: bounded stale contract and protected description compare", () => {
  const section = sectionFor("apply_task_update");
  for (const marker of [
    "_expected_updated_at IS NULL",
    "v_task.updated_at IS DISTINCT FROM _expected_updated_at",
    "'code', 'stale_task'",
    "'current_updated_at', v_task.updated_at",
    "public.btpm_decrypt",
  ]) {
    assert(section.includes(marker), `apply_task_update: lost ${marker}`);
  }
});

Deno.test("API-M.9A-C1 update: Task planning fields never enter the metadata contract", () => {
  const section = sectionFor("apply_task_update");
  assertEquals(
    /\bstart_date\b/.test(section),
    false,
    "apply_task_update: start_date must not become part of the metadata contract",
  );
  assertEquals(
    /\bdue_date\b/.test(section),
    false,
    "apply_task_update: due_date must not become part of the metadata contract",
  );
});

Deno.test("API-M.9A-C1 reorder: canonical full-sibling-set algorithm is intact", () => {
  const section = sectionFor("reorder_tasks");
  for (
    const reason of [
      "rows_not_array",
      "no_rows",
      "row_field_missing",
      "duplicate_row_ids",
      "duplicate_sort_positions",
      "non_contiguous_sort_positions",
      "row_count_mismatch",
      "unknown_or_cross_phase_rows",
      "missing_task_rows",
      "stale_task_order",
    ]
  ) {
    assert(section.includes(`'${reason}'`), `reorder_tasks: lost ${reason}`);
  }
  assert(
    section.includes("PERFORM 1 FROM public.tasks WHERE phase_id = _phase_id FOR UPDATE"),
    "reorder_tasks: lost full-sibling-set lock",
  );
  assert(
    section.includes("t.updated_at IS DISTINCT FROM i.expected_updated_at"),
    "reorder_tasks: lost per-row staleness comparison",
  );
  for (
    const out of [
      "'submitted_count'",
      "'changed_count'",
      "'ordered_tasks'",
      "'sort_order'",
      "'updated_at'",
    ]
  ) {
    assert(section.includes(out), `reorder_tasks: lost success output ${out}`);
  }
});

Deno.test("API-M.9A-C1 assignment: eligibility, no-change and single delegation", () => {
  const section = sectionFor("apply_task_assignee_set");
  assert(section.includes("public.is_workspace_member"), "lost workspace eligibility check");
  assert(section.includes("'assignee_not_eligible'"), "lost assignee_not_eligible reason");
  assert(
    section.includes("v_current_assignee IS NOT DISTINCT FROM _assignee_id"),
    "lost no-change comparison",
  );
  assert(
    /'no_change'::public\.pmg_command_status, 'apply_task_assignee_set'/.test(section),
    "lost canonical no_change path",
  );

  // Exactly one executable business delegation, comments excluded.
  const executable = executableSql(section);
  const delegations =
    executable.match(/PERFORM public\.set_task_assignee\(_task_id, _assignee_id\);/g) ?? [];
  assertEquals(delegations.length, 1, "apply_task_assignee_set: delegation count drift");
  const anyCall = executable.match(/set_task_assignee\s*\(/g) ?? [];
  assertEquals(anyCall.length, 1, "apply_task_assignee_set: unexpected extra set_task_assignee use");

  // Clearing assignment must remain possible.
  assert(
    /_assignee_id uuid DEFAULT NULL/.test(section),
    "apply_task_assignee_set: assignee must remain nullable",
  );
  assertEquals(
    /_assignee_id IS NULL THEN[\s\S]{0,200}'invalid'::public\.pmg_command_status/.test(section),
    false,
    "apply_task_assignee_set: NULL assignee must not be rejected",
  );
});

Deno.test("API-M.9A-C1 execution: concurrency, explicit set flags, bounded statuses, triggers", () => {
  const section = sectionFor("apply_task_execution_change");
  for (const marker of [
    "_expected_updated_at IS NULL",
    "v_task.updated_at IS DISTINCT FROM _expected_updated_at",
    "'code', 'stale_task'",
    "'current_updated_at', v_task.updated_at",
  ]) {
    assert(section.includes(marker), `apply_task_execution_change: lost ${marker}`);
  }

  // Explicit set flags drive each date independently.
  assert(
    /IF _set_actual_start THEN\s*v_new_actual_start := _actual_start_date;\s*ELSE\s*v_new_actual_start := v_task\.actual_start_date;\s*END IF;/
      .test(section),
    "apply_task_execution_change: lost explicit actual-start set semantics",
  );
  assert(
    /IF _set_actual_end THEN\s*v_new_actual_end := _actual_end_date;\s*ELSE\s*v_new_actual_end := v_task\.actual_end_date;\s*END IF;/
      .test(section),
    "apply_task_execution_change: lost explicit actual-end set semantics",
  );

  // Allowed execution statuses stay exactly active/completed.
  assert(
    section.includes(
      "IF _status IS NOT NULL AND _status NOT IN ('active'::public.pm_status, 'completed'::public.pm_status) THEN",
    ),
    "apply_task_execution_change: execution status restriction drift",
  );
  const statusLiterals = [
    ...executableSql(section).matchAll(/'(\w+)'::public\.pm_status/g),
  ].map((m) => m[1]);
  assertEquals(
    [...new Set(statusLiterals)].sort(),
    ["active", "completed"],
    "apply_task_execution_change: pm_status literals broadened",
  );

  // Trigger-owned validation is surfaced, not bypassed.
  assert(
    /EXCEPTION\s*\n\s*WHEN check_violation OR raise_exception OR not_null_violation OR invalid_text_representation THEN/
      .test(section),
    "apply_task_execution_change: lost trigger-owned validation mapping",
  );
  assert(
    section.includes("jsonb_build_object('reason', SQLERRM)"),
    "apply_task_execution_change: lost trigger message surfacing",
  );
});

Deno.test("API-M.9A-C1 out of scope: no Phase, planning, wrapper or dispatcher definitions", () => {
  const executable = executableSql(SQL);
  for (
    const fn of [
      "apply_phase_create",
      "apply_phase_update",
      "reorder_phases",
      "apply_phase_planning_change",
      "apply_task_planning_change",
    ]
  ) {
    assertEquals(
      new RegExp(`FUNCTION\\s+public\\.${fn}\\s*\\(`).test(executable),
      false,
      `out-of-scope definition present: ${fn}`,
    );
  }
  // No external API wrapper definitions.
  assertEquals(
    /CREATE[\s\S]{0,40}FUNCTION\s+public\.api_v1_/.test(executable),
    false,
    "out-of-scope: api_v1_ wrapper defined",
  );
  // No generic / dynamic dispatcher.
  assertEquals(/EXECUTE\s+format\(/i.test(executable), false, "dynamic SQL dispatcher introduced");
  assertEquals(/\bEXECUTE\s+'/i.test(executable), false, "dynamic SQL dispatcher introduced");
  assertEquals(
    /\bEXECUTE\s+v_\w+/i.test(executable),
    false,
    "dynamic SQL dispatcher introduced",
  );
});
