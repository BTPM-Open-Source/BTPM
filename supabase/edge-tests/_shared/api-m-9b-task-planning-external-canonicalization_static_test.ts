// API-M.9B — Legacy Task planning external canonicalization.
//
// Focused repository static contract test. Locates the API-M.9B migration by its
// unique marker and asserts, from committed source only:
//   - exactly two functions are defined, both apply_task_planning_change;
//   - the existing 4-argument UUID UI signature still exists, unchanged;
//   - the 4-argument function fails closed on ANY API client identity before target lookup;
//   - the ordinary no-client UI path remains behaviourally unchanged;
//   - the new 5-argument JSONB external overload requires trusted context, api v1,
//     command kind, the exact capability tasks:plan and source channel external_api;
//   - expected_updated_at is mandatory externally; the Task row is locked FOR UPDATE;
//   - staleness compares canonical tasks.updated_at and returns bounded stale_task_planning;
//   - authority remains is_workspace_admin_or_higher on the target Task workspace;
//   - completed/cancelled/archived, range validation, no-change, Phase-window
//     confirmation, confirmed extension via _apply_phase_extension_internal and the
//     transaction-local app.allow_planned_extension mechanism are all present;
//   - Task mutation touches only start_date and due_date;
//   - applied result is bounded structural planning data only (no narrative);
//   - the preview function, Phase planning and API wrappers are untouched;
//   - PUBLIC and anon execution are revoked for both signatures, authenticated granted,
//     with no explicit service-role business execution grant.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-M.9B — Legacy Task planning external canonicalization";

async function findMigrationByMarker(marker: string): Promise<string> {
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (text.includes(`-- ${marker}`)) return text;
  }
  throw new Error(`migration marker not found: ${marker}`);
}

const RAW = await findMigrationByMarker(MARKER);
// Executable SQL only: governance prose in leading comments is not a definition.
const EXEC = RAW.split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");
const EXEC_FLAT = EXEC.replace(/\s+/g, " ");

const UI_SIG =
  "CREATE OR REPLACE FUNCTION public.apply_task_planning_change(_task_id uuid, _new_start date, _new_due date, _confirm_parent_extension boolean DEFAULT false)";
const EXT_SIG =
  "CREATE OR REPLACE FUNCTION public.apply_task_planning_change(_task_id uuid, _expected_updated_at timestamp with time zone, _new_start date, _new_due date, _confirm_parent_extension boolean DEFAULT false)";

function bodyOf(signature: string): string {
  const start = RAW.indexOf(signature);
  assert(start >= 0, `signature not found: ${signature.slice(0, 70)}`);
  const end = RAW.indexOf("$function$;", start);
  assert(end > start, "unterminated function body");
  return RAW.slice(start, end);
}

const UI_BODY = bodyOf(UI_SIG);
const EXT_BODY = bodyOf(EXT_SIG);
const UI_FLAT = UI_BODY.replace(/\s+/g, " ");
const EXT_FLAT = EXT_BODY.replace(/\s+/g, " ");

Deno.test("API-M.9B: exactly the two apply_task_planning_change overloads are defined", () => {
  const defs = RAW.match(/CREATE OR REPLACE FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi) ?? [];
  assert(defs.length === 2, `expected 2 function definitions, found ${defs.length}`);
  for (const d of defs) {
    assert(
      /public\.apply_task_planning_change/i.test(d),
      `unexpected function redefined: ${d}`,
    );
  }
  assert(RAW.includes(UI_SIG), "4-argument UUID UI signature missing/changed");
  assert(RAW.includes(EXT_SIG), "5-argument external overload signature missing");
});

Deno.test("API-M.9B: migration scope contains no schema, RLS, catalogue or API-F work", () => {
  for (
    const banned of [
      "CREATE TABLE",
      "ALTER TABLE",
      "ROW LEVEL SECURITY",
      "CREATE POLICY",
      "CREATE SCHEMA",
      "api_capability_catalogue",
      "api_capability_grants",
      "api_idempotency_registry",
      "claim_idempotency",
      "complete_idempotency",
      "_idempotency_key",
      "_correlation_id",
      "openapi",
    ]
  ) {
    assert(
      !EXEC.toLowerCase().includes(banned.toLowerCase()),
      `out-of-scope statement found: ${banned}`,
    );
  }
});

Deno.test("API-M.9B: return types are preserved/declared correctly", () => {
  assert(/RETURNS uuid/.test(UI_BODY), "UI overload must still RETURN uuid");
  assert(/RETURNS jsonb/.test(EXT_BODY), "external overload must RETURN jsonb");
  assert(/SECURITY DEFINER/.test(EXT_BODY), "external overload must be SECURITY DEFINER");
  assert(
    /SET search_path TO 'pg_catalog', 'public'/.test(EXT_BODY),
    "external overload must pin search_path",
  );
});

Deno.test("API-M.9B: legacy overload fails closed on any API client identity before target lookup", () => {
  assert(
    UI_FLAT.includes("api_e_private.jwt_client_id()"),
    "UI overload must resolve api_e_private.jwt_client_id()",
  );
  assert(
    /EXCEPTION WHEN OTHERS THEN v_client_id := 'unresolved_client';/.test(UI_FLAT),
    "UI overload must resolve client identity exception-safely",
  );
  const clientCheck = UI_FLAT.indexOf("IF v_client_id IS NOT NULL THEN");
  assert(clientCheck >= 0, "UI overload must reject any non-null client identity");
  const lookup = UI_FLAT.indexOf("FROM public.tasks");
  assert(lookup >= 0, "UI overload task lookup missing");
  assert(
    clientCheck < lookup,
    "UI overload client rejection must occur BEFORE the Task lookup",
  );
  const raiseIdx = UI_FLAT.indexOf(
    "RAISE EXCEPTION 'apply_task_planning_change: not authorized'",
  );
  assert(raiseIdx > clientCheck && raiseIdx < lookup, "UI overload must fail closed by raising");
  // No caller-supplied version parameter is introduced on the UI contract.
  assert(!UI_SIG.includes("_expected_updated_at"), "UI overload must not require expectedUpdatedAt");
});

Deno.test("API-M.9B: ordinary no-client UI path remains behaviourally unchanged", () => {
  assert(
    UI_FLAT.includes(
      "IF NOT public.is_workspace_admin_or_higher(auth.uid(), t.workspace_id) THEN",
    ),
    "UI authority check changed",
  );
  assert(UI_FLAT.includes("task is completed and locked"), "completed lock removed");
  assert(UI_FLAT.includes("task is cancelled/archived"), "cancelled/archived rule removed");
  assert(
    UI_FLAT.includes("due date must be on or after start date"),
    "range validation removed",
  );
  assert(
    UI_FLAT.includes("parent extension required but not confirmed"),
    "parent-extension confirmation removed",
  );
  assert(
    UI_FLAT.includes(
      "public._apply_phase_extension_internal(ph.id, prop_start, prop_end, _task_id, 'task')",
    ),
    "canonical Phase-extension helper call changed",
  );
  assert(
    UI_FLAT.includes("set_config('app.allow_planned_extension', 'on', true)") &&
      UI_FLAT.includes("set_config('app.allow_planned_extension', 'off', true)"),
    "transaction-local containment bypass changed",
  );
  assert(
    UI_FLAT.includes("UPDATE public.tasks SET start_date = _new_start, due_date = _new_due"),
    "UI Task update must remain start_date/due_date only",
  );
  assert(UI_FLAT.includes("RETURN _task_id;"), "UI UUID result changed");
});

Deno.test("API-M.9B: external overload requires trusted context and exactly tasks:plan", () => {
  assert(
    EXT_FLAT.includes("api_e_private.jwt_client_id()"),
    "external overload must resolve client identity",
  );
  assert(
    /EXCEPTION WHEN OTHERS THEN v_client_id := 'unresolved_client';/.test(EXT_FLAT),
    "external overload must resolve client identity exception-safely",
  );
  assert(
    EXT_FLAT.includes("IF v_client_id IS NULL THEN"),
    "external overload must require an API client identity",
  );
  assert(
    EXT_FLAT.includes("api_e_private.assert_trusted_context()") &&
      /EXCEPTION WHEN OTHERS THEN v_trusted := false;/.test(EXT_FLAT),
    "trusted-context assertion must be present and exception-safe",
  );
  assert(
    EXT_FLAT.includes("current_setting('api_e.api_version', true)") &&
      EXT_FLAT.includes("<> 'v1'"),
    "external overload must require api version v1",
  );
  assert(
    EXT_FLAT.includes("current_setting('api_e.capability_kind', true)") &&
      EXT_FLAT.includes("<> 'command'"),
    "external overload must require capability kind command",
  );
  assert(
    EXT_FLAT.includes("current_setting('api_e.capability_key', true)") &&
      EXT_FLAT.includes("<> 'tasks:plan'"),
    "external overload must require exact capability tasks:plan",
  );
  assert(
    EXT_FLAT.includes("current_setting('api_e.source_channel', true)") &&
      EXT_FLAT.includes("<> 'external_api'"),
    "external overload must require source channel external_api",
  );

  for (
    const forbidden of [
      "tasks:create",
      "tasks:update",
      "tasks:reorder",
      "tasks:assign",
      "tasks:transition",
      "phases:plan",
      "planning:read",
    ]
  ) {
    assert(
      !EXT_FLAT.includes(forbidden),
      `external overload must not reference capability ${forbidden}`,
    );
  }
  // No generic capability matching.
  assert(
    !/capability_key[^\n]*(LIKE|IN \(|= ANY|~)/i.test(EXT_FLAT),
    "capability matching must be an exact comparison only",
  );

  // Containment precedes any target lookup.
  const gate = EXT_FLAT.indexOf("<> 'tasks:plan'");
  const lookup = EXT_FLAT.indexOf("FROM public.tasks");
  assert(gate >= 0 && lookup > gate, "capability gate must precede the Task lookup");
});

Deno.test("API-M.9B: external overload requires an active delegated actor and no caller-supplied scope", () => {
  assert(EXT_FLAT.includes("v_actor uuid := auth.uid()"), "actor must come from auth.uid()");
  assert(
    EXT_FLAT.includes("public.is_active_user(v_actor)"),
    "external overload must require an active BTPM user",
  );
  for (const p of ["_tenant_id", "_organization_id", "_workspace_id", "_project_id", "_phase_id"]) {
    assert(!EXT_SIG.includes(p), `scope must not be caller-supplied: ${p}`);
  }
  assert(
    EXT_FLAT.includes("public.is_workspace_admin_or_higher(v_actor, v_task.workspace_id)"),
    "planning authority must be derived from the target Task workspace",
  );
  assert(
    !EXT_FLAT.includes("has_project_pm_authority"),
    "planning authority must not be broadened to Project PMs",
  );
});

Deno.test("API-M.9B: mandatory optimistic concurrency on canonical tasks.updated_at", () => {
  assert(
    EXT_FLAT.includes("IF _expected_updated_at IS NULL THEN"),
    "expected_updated_at must be mandatory",
  );
  assert(
    EXT_FLAT.includes("'expected_updated_at_required'"),
    "missing bounded reason expected_updated_at_required",
  );
  assert(
    /FROM public\.tasks WHERE id = _task_id FOR UPDATE/.test(EXT_FLAT),
    "Task row must be locked FOR UPDATE",
  );
  assert(
    EXT_FLAT.includes(
      "SELECT id, phase_id, project_id, workspace_id, organization_id, status, is_archived, start_date, due_date, updated_at",
    ),
    "locked Task row must expose the canonical structural scope fields",
  );
  assert(
    EXT_FLAT.includes("v_task.updated_at IS DISTINCT FROM _expected_updated_at"),
    "staleness must compare canonical tasks.updated_at",
  );
  assert(
    EXT_FLAT.includes("'code', 'stale_task_planning'") &&
      EXT_FLAT.includes("'current_updated_at', v_task.updated_at"),
    "conflict result must be bounded and expose current_updated_at",
  );
  // No shadow concurrency fields.
  for (const banned of ["revision", "planning_version", "etag", "row_version"]) {
    assert(
      !EXT_FLAT.toLowerCase().includes(banned),
      `no shadow concurrency field allowed: ${banned}`,
    );
  }
  // Conflict precedes any mutation.
  const conflict = EXT_FLAT.indexOf("stale_task_planning");
  const update = EXT_FLAT.indexOf("UPDATE public.tasks");
  assert(conflict >= 0 && update > conflict, "conflict must be returned before any update");
});

Deno.test("API-M.9B: planning business-state rules are preserved as bounded results", () => {
  assert(
    EXT_FLAT.includes("v_task.status = 'completed'") &&
      EXT_FLAT.includes("'task_completed_locked'"),
    "completed Task lock missing",
  );
  assert(
    EXT_FLAT.includes("v_task.status = 'cancelled' OR v_task.is_archived") &&
      EXT_FLAT.includes("'task_cancelled_or_archived'"),
    "cancelled/archived rule missing",
  );
  assert(
    EXT_FLAT.includes("_new_due < _new_start") && EXT_FLAT.includes("'invalid_range'"),
    "invalid range rule missing",
  );
  // Unauthorized / missing target must not reveal existence.
  assert(
    /IF v_task\.id IS NULL THEN(?:[^]*?)RETURN public\.pmg_build_result\(\s*'not_authorized'/.test(
      EXT_BODY,
    ),
    "missing target must return not_authorized",
  );
});

Deno.test("API-M.9B: the parent Phase is derived strictly from the locked Task", () => {
  assert(
    EXT_FLAT.includes("FROM public.phases WHERE id = v_task.phase_id"),
    "parent Phase must be derived from v_task.phase_id",
  );
  assert(
    EXT_FLAT.includes("SELECT id, project_id, start_date, target_end_date INTO v_phase"),
    "parent Phase read must be bounded structural data",
  );
  assert(
    EXT_FLAT.includes("'parent_phase_unresolved'"),
    "unresolved parent Phase must fail closed with a bounded result",
  );
  // No Task Phase reassignment: no UPDATE ... SET clause may touch phase_id.
  assert(
    !/UPDATE public\.tasks SET [^;]*phase_id/i.test(EXT_FLAT),
    "Task must never be reassigned to another Phase",
  );

});

Deno.test("API-M.9B: Phase-window confirmation contract is bounded and structural", () => {
  assert(
    EXT_FLAT.includes("IF v_needs_ext AND NOT COALESCE(_confirm_parent_extension, false) THEN"),
    "confirmation gate missing",
  );
  assert(
    EXT_FLAT.includes("'code', 'extend_phase_window_required'"),
    "confirmation code missing",
  );
  for (
    const key of [
      "'task_id', v_task.id",
      "'project_id', v_task.project_id",
      "'phase_id', v_phase.id",
      "'phase_current_start', v_phase.start_date",
      "'phase_current_target_end', v_phase.target_end_date",
      "'phase_proposed_start', v_prop_start",
      "'phase_proposed_target_end', v_prop_end",
      "'requested_task_start', _new_start",
      "'requested_task_due', _new_due",
    ]
  ) {
    assert(EXT_FLAT.includes(key), `confirmation payload key missing: ${key}`);
  }
  assert(
    EXT_FLAT.includes("'confirmation_required'::public.pmg_command_status"),
    "confirmation_required status missing",
  );
  // Confirmation must not mutate.
  const confirm = EXT_FLAT.indexOf("extend_phase_window_required");
  const firstUpdate = EXT_FLAT.indexOf("UPDATE public.tasks");
  assert(confirm >= 0 && firstUpdate > confirm, "confirmation must return before any mutation");
  const extension = EXT_FLAT.indexOf("_apply_phase_extension_internal");
  assert(extension > confirm, "confirmation must return before any Phase extension");
});

Deno.test("API-M.9B: confirmed extension reuses exactly the canonical Phase-extension path", () => {
  const calls =
    EXT_FLAT.match(/public\._apply_phase_extension_internal\(/g) ?? [];
  assert(calls.length === 1, `expected exactly one canonical helper call, found ${calls.length}`);
  assert(
    EXT_FLAT.includes(
      "public._apply_phase_extension_internal(v_phase.id, v_prop_start, v_prop_end, _task_id, 'task')",
    ),
    "confirmed extension must call the existing internal helper",
  );
  assert(
    EXT_FLAT.includes("set_config('app.allow_planned_extension', 'on', true)") &&
      EXT_FLAT.includes("set_config('app.allow_planned_extension', 'off', true)"),
    "transaction-local containment bypass must be preserved and cleared",
  );
  // No second Phase/Project extension implementation.
  assert(!/UPDATE public\.phases/i.test(EXEC), "no direct Phase window write allowed");
  assert(!/UPDATE public\.projects/i.test(EXEC), "no direct Project window write allowed");
  // Task mutation is planning-dates only.
  const updates = EXEC_FLAT.match(/UPDATE public\.tasks SET [^;]+;/g) ?? [];
  assert(updates.length > 0, "Task update statements missing");
  for (const u of updates) {
    assert(
      /UPDATE public\.tasks SET start_date = _new_start, due_date = _new_due WHERE id = _task_id;/
        .test(u),
      `Task update must change only start_date and due_date: ${u}`,
    );
  }
});

Deno.test("API-M.9B: no-change performs no update and does not advance updated_at", () => {
  const noChange = EXT_FLAT.indexOf("'no_change'::public.pmg_command_status");
  assert(noChange >= 0, "no_change status missing");
  assert(
    EXT_FLAT.includes(
      "IF v_task.start_date IS NOT DISTINCT FROM _new_start AND v_task.due_date IS NOT DISTINCT FROM _new_due THEN",
    ),
    "no-change comparison missing",
  );
  assert(EXT_FLAT.includes("'phase_extended', false"), "no-change payload must be bounded");
  const firstUpdate = EXT_FLAT.indexOf("UPDATE public.tasks");
  assert(noChange < firstUpdate, "no_change must return before any Task update");
  const extension = EXT_FLAT.indexOf("_apply_phase_extension_internal");
  assert(noChange < extension, "no_change must return before any parent extension");
});

Deno.test("API-M.9B: bounded statuses and applied payload contain no protected narrative", () => {
  for (
    const status of [
      "not_authorized",
      "invalid",
      "conflict",
      "confirmation_required",
      "no_change",
      "applied",
    ]
  ) {
    assert(
      EXT_FLAT.includes(`'${status}'::public.pmg_command_status`),
      `status missing from external overload: ${status}`,
    );
  }
  for (
    const key of [
      "'task_id', v_updated.id",
      "'phase_id', v_updated.phase_id",
      "'project_id', v_updated.project_id",
      "'start_date', v_updated.start_date",
      "'due_date', v_updated.due_date",
      "'updated_at', v_updated.updated_at",
      "'phase_extended', v_needs_ext",
      "'phase_start_date', CASE WHEN v_needs_ext THEN v_prop_start ELSE NULL END",
      "'phase_target_end_date', CASE WHEN v_needs_ext THEN v_prop_end ELSE NULL END",
    ]
  ) {
    assert(EXT_FLAT.includes(key), `applied payload key missing: ${key}`);
  }
  // Command identifier and target typing.
  assert(
    EXT_FLAT.includes("'apply_task_planning_change', 'task', _task_id"),
    "command identifier / task target typing missing",
  );
  // No narrative fields read back or returned.
  for (
    const narrative of [
      "v_updated.name",
      "v_updated.description",
      "v_task.name",
      "v_phase.name",
      "assignee",
      "estimated_hours",
    ]
  ) {
    assert(!EXT_FLAT.includes(narrative), `narrative field must not be used: ${narrative}`);
  }
  assert(
    EXT_FLAT.includes(
      "SELECT id, phase_id, project_id, start_date, due_date, updated_at INTO v_updated",
    ),
    "applied read-back must be bounded structural planning data only",
  );
});

Deno.test("API-M.9B: preview, Phase planning and other domains are untouched", () => {
  for (
    const untouched of [
      "preview_task_planning_change",
      "preview_phase_planning_change",
      "apply_phase_planning_change",
      "apply_task_create",
      "apply_task_update",
      "reorder_tasks",
      "apply_task_assignee_set",
      "apply_task_execution_change",
      "apply_project_planning_change",
      "api_v1_",
    ]
  ) {
    assert(!EXEC.includes(untouched), `must not touch ${untouched}`);
  }
});

Deno.test("API-M.9B: direct-invocation grants are hardened for both signatures", () => {
  for (
    const sig of [
      "public.apply_task_planning_change(uuid, date, date, boolean)",
      "public.apply_task_planning_change(uuid, timestamptz, date, date, boolean)",
    ]
  ) {
    assert(
      EXEC.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`),
      `PUBLIC execution must be revoked: ${sig}`,
    );
    assert(
      EXEC.includes(`REVOKE ALL ON FUNCTION ${sig} FROM anon;`),
      `anon execution must be revoked: ${sig}`,
    );
    assert(
      EXEC.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`),
      `authenticated execution grant missing: ${sig}`,
    );
  }
  assert(
    !/GRANT[^;]*apply_task_planning_change[^;]*service_role/i.test(EXEC_FLAT),
    "no explicit service-role business execution grant allowed",
  );
});
