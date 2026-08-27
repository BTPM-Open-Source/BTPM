// API-M.6B — Legacy Phase planning external canonicalization.
//
// Focused repository static contract test. Locates the API-M.6B migration by its
// unique marker and asserts, from committed source only:
//   - the existing 4-argument UUID UI signature still exists, unchanged;
//   - the new 5-argument JSONB external overload exists;
//   - the 4-argument function fails closed on ANY API client identity before target lookup;
//   - the ordinary no-client UI path remains available and behaviourally unchanged;
//   - the external overload requires trusted context, api v1, command kind,
//     the exact capability phases:plan, and source channel external_api;
//   - expected_updated_at is mandatory externally; the Phase row is locked FOR UPDATE;
//   - staleness compares canonical phases.updated_at and returns a bounded conflict;
//   - authority is derived from the target Phase workspace via is_workspace_admin_or_higher;
//   - completed/cancelled/archived, range validation, Project-window confirmation,
//     confirmed extension via _apply_project_extension_internal and the transaction-local
//     app.allow_planned_extension mechanism all remain;
//   - no-change writes nothing; applied result is bounded structural planning data only;
//   - the preview function and the M.6A Phase PMG commands are untouched;
//   - no API wrapper / idempotency / HTTP / grant broadening is introduced;
//   - PUBLIC and anon execution are revoked for both signatures.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-M.6B — Legacy Phase planning external canonicalization";

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
  "CREATE OR REPLACE FUNCTION public.apply_phase_planning_change(_phase_id uuid, _new_start date, _new_end date, _confirm_parent_extension boolean DEFAULT false)";
const EXT_SIG =
  "CREATE OR REPLACE FUNCTION public.apply_phase_planning_change(_phase_id uuid, _expected_updated_at timestamp with time zone, _new_start date, _new_end date, _confirm_parent_extension boolean DEFAULT false)";

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

Deno.test("API-M.6B: exactly the two apply_phase_planning_change overloads are defined", () => {
  const defs = RAW.match(/CREATE OR REPLACE FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi) ?? [];
  assert(defs.length === 2, `expected 2 function definitions, found ${defs.length}`);
  for (const d of defs) {
    assert(
      /public\.apply_phase_planning_change/i.test(d),
      `unexpected function redefined: ${d}`,
    );
  }
  assert(RAW.includes(UI_SIG), "4-argument UUID UI signature missing/changed");
  assert(RAW.includes(EXT_SIG), "5-argument external overload signature missing");
});

Deno.test("API-M.6B: return types are preserved/declared correctly", () => {
  assert(/RETURNS uuid/.test(UI_BODY), "UI overload must still RETURN uuid");
  assert(/RETURNS jsonb/.test(EXT_BODY), "external overload must RETURN jsonb");
});

Deno.test("API-M.6B: legacy overload fails closed on any API client identity before target lookup", () => {
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
  const lookup = UI_FLAT.indexOf("FROM public.phases");
  assert(lookup >= 0, "UI overload phase lookup missing");
  assert(
    clientCheck < lookup,
    "UI overload client rejection must occur BEFORE the Phase lookup",
  );
  const raiseIdx = UI_FLAT.indexOf(
    "RAISE EXCEPTION 'apply_phase_planning_change: not authorized'",
  );
  assert(raiseIdx > clientCheck && raiseIdx < lookup, "UI overload must fail closed by raising");
  // No caller-supplied version parameter is introduced on the UI contract.
  assert(!UI_SIG.includes("_expected_updated_at"), "UI overload must not require expectedUpdatedAt");
});

Deno.test("API-M.6B: ordinary no-client UI path remains behaviourally unchanged", () => {
  assert(
    UI_FLAT.includes(
      "IF NOT public.is_workspace_admin_or_higher(auth.uid(), ph.workspace_id) THEN",
    ),
    "UI authority check changed",
  );
  assert(UI_FLAT.includes("phase is completed and locked"), "completed lock removed");
  assert(UI_FLAT.includes("phase is cancelled/archived"), "cancelled/archived rule removed");
  assert(
    UI_FLAT.includes("end date must be on or after start date"),
    "range validation removed",
  );
  assert(
    UI_FLAT.includes("parent extension required but not confirmed"),
    "parent-extension confirmation removed",
  );
  assert(
    UI_FLAT.includes("public._apply_project_extension_internal(pr.id, prop_start, prop_end, _phase_id, 'phase')"),
    "canonical Project-extension helper call changed",
  );
  assert(
    UI_FLAT.includes("set_config('app.allow_planned_extension', 'on', true)") &&
      UI_FLAT.includes("set_config('app.allow_planned_extension', 'off', true)"),
    "transaction-local containment bypass changed",
  );
  assert(UI_FLAT.includes("RETURN _phase_id;"), "UI UUID result changed");
});

Deno.test("API-M.6B: external overload requires trusted context and exactly phases:plan", () => {
  assert(
    EXT_FLAT.includes("api_e_private.jwt_client_id()"),
    "external overload must resolve client identity",
  );
  assert(
    EXT_FLAT.includes("api_e_private.assert_trusted_context()"),
    "external overload must assert trusted context",
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
      EXT_FLAT.includes("<> 'phases:plan'"),
    "external overload must require exact capability phases:plan",
  );
  assert(
    EXT_FLAT.includes("current_setting('api_e.source_channel', true)") &&
      EXT_FLAT.includes("<> 'external_api'"),
    "external overload must require source channel external_api",
  );

  for (
    const forbidden of [
      "phases:create",
      "phases:update",
      "phases:reorder",
      "planning:read",
      "tasks:",
    ]
  ) {
    assert(
      !EXT_FLAT.includes(forbidden),
      `external overload must not reference capability ${forbidden}`,
    );
  }
  // No generic capability matching.
  assert(
    !/capability_key[^\n]*(LIKE|IN \(|= ANY)/i.test(EXT_FLAT),
    "capability matching must be an exact comparison only",
  );

  // Containment precedes any target lookup.
  const gate = EXT_FLAT.indexOf("<> 'phases:plan'");
  const lookup = EXT_FLAT.indexOf("FROM public.phases");
  assert(gate >= 0 && lookup > gate, "capability gate must precede the Phase lookup");
});

Deno.test("API-M.6B: external overload requires an active delegated actor and no caller-supplied scope", () => {
  assert(EXT_FLAT.includes("v_actor uuid := auth.uid()"), "actor must come from auth.uid()");
  assert(
    EXT_FLAT.includes("public.is_active_user(v_actor)"),
    "external overload must require an active BTPM user",
  );
  for (const p of ["_tenant_id", "_organization_id", "_workspace_id", "_project_id"]) {
    assert(!EXT_SIG.includes(p), `scope must not be caller-supplied: ${p}`);
  }
  assert(
    EXT_FLAT.includes("public.is_workspace_admin_or_higher(v_actor, v_phase.workspace_id)"),
    "planning authority must be derived from the target Phase workspace",
  );
  assert(
    !EXT_FLAT.includes("has_project_pm_authority"),
    "planning authority must not be broadened to Project PMs",
  );
});

Deno.test("API-M.6B: mandatory optimistic concurrency on canonical phases.updated_at", () => {
  assert(
    EXT_FLAT.includes("IF _expected_updated_at IS NULL THEN"),
    "expected_updated_at must be mandatory",
  );
  assert(
    EXT_FLAT.includes("'expected_updated_at_required'"),
    "missing bounded reason expected_updated_at_required",
  );
  assert(
    /FROM public\.phases WHERE id = _phase_id FOR UPDATE/.test(EXT_FLAT),
    "Phase row must be locked FOR UPDATE",
  );
  assert(
    EXT_FLAT.includes("v_phase.updated_at IS DISTINCT FROM _expected_updated_at"),
    "staleness must compare canonical phases.updated_at",
  );
  assert(
    EXT_FLAT.includes("'code', 'stale_phase_planning'") &&
      EXT_FLAT.includes("'current_updated_at', v_phase.updated_at"),
    "conflict result must be bounded and expose current_updated_at",
  );
  // No shadow concurrency fields.
  for (const banned of ["revision", "planning_version", "etag", "api_version_column"]) {
    assert(
      !EXT_FLAT.toLowerCase().includes(banned),
      `no shadow concurrency field allowed: ${banned}`,
    );
  }
  // Conflict precedes any mutation.
  const conflict = EXT_FLAT.indexOf("stale_phase_planning");
  const update = EXT_FLAT.indexOf("UPDATE public.phases");
  assert(conflict >= 0 && update > conflict, "conflict must be returned before any update");
});

Deno.test("API-M.6B: planning business-state rules are preserved as bounded results", () => {
  assert(
    EXT_FLAT.includes("v_phase.status = 'completed'") &&
      EXT_FLAT.includes("'phase_completed_locked'"),
    "completed Phase lock missing",
  );
  assert(
    EXT_FLAT.includes("v_phase.status = 'cancelled' OR v_phase.is_archived") &&
      EXT_FLAT.includes("'phase_cancelled_or_archived'"),
    "cancelled/archived rule missing",
  );
  assert(
    EXT_FLAT.includes("_new_end < _new_start") && EXT_FLAT.includes("'invalid_range'"),
    "invalid range rule missing",
  );
  // Unauthorized / missing target must not reveal existence.
  assert(
    /IF v_phase\.id IS NULL THEN(?:[^]*?)RETURN public\.pmg_build_result\(\s*'not_authorized'/.test(EXT_BODY),
    "missing target must return not_authorized",
  );
});

Deno.test("API-M.6B: Project-window confirmation contract is bounded and structural", () => {
  assert(
    EXT_FLAT.includes("IF v_needs_ext AND NOT COALESCE(_confirm_parent_extension, false) THEN"),
    "confirmation gate missing",
  );
  assert(
    EXT_FLAT.includes("'code', 'extend_project_window_required'"),
    "confirmation code missing",
  );
  for (
    const key of [
      "'project_id'",
      "'project_current_start'",
      "'project_current_target_end'",
      "'project_proposed_start'",
      "'project_proposed_target_end'",
      "'requested_phase_start'",
      "'requested_phase_end'",
    ]
  ) {
    assert(EXT_FLAT.includes(key), `confirmation payload key missing: ${key}`);
  }
  assert(
    EXT_FLAT.includes("confirmation_required"),
    "confirmation_required status missing",
  );
});

Deno.test("API-M.6B: confirmed extension reuses the canonical Project-extension path", () => {
  assert(
    EXT_FLAT.includes(
      "public._apply_project_extension_internal(v_project.id, v_prop_start, v_prop_end, _phase_id, 'phase')",
    ),
    "confirmed extension must call the existing internal helper",
  );
  assert(
    EXT_FLAT.includes("set_config('app.allow_planned_extension', 'on', true)") &&
      EXT_FLAT.includes("set_config('app.allow_planned_extension', 'off', true)"),
    "transaction-local containment bypass must be preserved and cleared",
  );
  // Only one Project-extension implementation; no direct project window write.
  assert(
    !/UPDATE public\.projects/i.test(EXEC),
    "no second Project-extension implementation allowed",
  );
});

Deno.test("API-M.6B: no-change performs no update and does not advance updated_at", () => {
  const noChange = EXT_FLAT.indexOf("'no_change'::public.pmg_command_status");
  assert(noChange >= 0, "no_change status missing");
  assert(
    EXT_FLAT.includes(
      "IF v_phase.start_date IS NOT DISTINCT FROM _new_start AND v_phase.target_end_date IS NOT DISTINCT FROM _new_end THEN",
    ),
    "no-change comparison missing",
  );
  const firstUpdate = EXT_FLAT.indexOf("UPDATE public.phases");
  assert(noChange < firstUpdate, "no_change must return before any Phase update");
});

Deno.test("API-M.6B: bounded statuses and applied payload contain no protected narrative", () => {
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
      "'phase_id', v_updated.id",
      "'project_id', v_updated.project_id",
      "'start_date', v_updated.start_date",
      "'target_end_date', v_updated.target_end_date",
      "'updated_at', v_updated.updated_at",
      "'project_extended', v_needs_ext",
    ]
  ) {
    assert(EXT_FLAT.includes(key), `applied payload key missing: ${key}`);
  }
  // Command identifier and target typing.
  assert(
    EXT_FLAT.includes("'apply_phase_planning_change', 'phase', _phase_id"),
    "command identifier / phase target typing missing",
  );
  // No narrative fields read back or returned.
  for (const narrative of ["v_updated.name", "v_updated.description", "v_project.name", "ph.name"]) {
    assert(!EXT_FLAT.includes(narrative), `narrative field must not be used: ${narrative}`);
  }
  assert(
    !/SELECT id, project_id, start_date, target_end_date, updated_at, name/.test(EXT_FLAT),
    "applied read-back must be bounded structural planning data only",
  );
});

Deno.test("API-M.6B: preview, M.6A commands and other domains are untouched", () => {
  for (
    const untouched of [
      "preview_phase_planning_change",
      "apply_phase_create",
      "apply_phase_update",
      "reorder_phases",
      "apply_task_planning_change",
      "apply_project_planning_change",
      "apply_risk_",
      "apply_blocker_",
      "api_v1_get_project_planning",
    ]
  ) {
    assert(!EXEC.includes(untouched), `must not touch ${untouched}`);
  }
});

Deno.test("API-M.6B: no M.7 wrapper, idempotency, HTTP or catalogue work", () => {
  for (
    const banned of [
      "api_v1_phase_plan",
      "api_idempotency_registry",
      "_idempotency_key",
      "_correlation_id",
      "api_capability_catalogue",
      "api_capability_grants",
      "openapi",
    ]
  ) {
    assert(
      !EXEC.toLowerCase().includes(banned.toLowerCase()),
      `out-of-scope reference found: ${banned}`,
    );
  }
  // No schema work at all.
  for (const ddl of ["CREATE TABLE", "ALTER TABLE", "CREATE TYPE", "CREATE TRIGGER", "CREATE POLICY"]) {
    assert(!EXEC.toUpperCase().includes(ddl), `no schema work allowed: ${ddl}`);
  }
});

Deno.test("API-M.6B: PUBLIC and anon execution revoked for both signatures; no grant broadening", () => {
  const sigs = [
    "public.apply_phase_planning_change(uuid, date, date, boolean)",
    "public.apply_phase_planning_change(uuid, timestamptz, date, date, boolean)",
  ];
  for (const sig of sigs) {
    assert(
      EXEC_FLAT.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`),
      `missing REVOKE ... FROM PUBLIC for ${sig}`,
    );
    assert(
      EXEC_FLAT.includes(`REVOKE ALL ON FUNCTION ${sig} FROM anon;`),
      `missing REVOKE ... FROM anon for ${sig}`,
    );
    assert(
      EXEC_FLAT.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`),
      `missing authenticated execute grant for ${sig}`,
    );
  }
  assert(!/GRANT[^;]*TO anon/i.test(EXEC), "anon must never be granted");
  assert(
    !/GRANT[^;]*TO service_role/i.test(EXEC),
    "no service-role business-execution path allowed",
  );
});
