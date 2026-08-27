// API-M.10B — Dedicated transactional Task reorder and planning API wrappers.
//
// Permanent repository static contract guard. Locates the API-M.10B migration by
// its unique marker and asserts, from committed source only:
//   - exactly two wrapper definitions exist (reorder + plan) with exact typed signatures;
//   - both RETURN jsonb, are SECURITY DEFINER with a hardened search path;
//   - reorder hardcodes only tasks:reorder, plan hardcodes only tasks:plan;
//   - no caller-supplied capability/scope/command/function/RPC/table/SQL parameter;
//   - reorder derives scope Phase -> Project, plan derives Task -> Phase -> Project;
//   - authorize_and_establish runs after target-derived scope and is rechecked;
//   - exact Project Connected App enablement precedes API-F idempotency;
//   - API-F claim uses the exact fixed capability constant, replay codes are exact;
//   - TOCTOU locks and structural re-confirmation precede the canonical command;
//   - exactly one canonical command per wrapper, and no wrapper-side business write;
//   - canonical result locations match the accepted M.9A/M.9B canonical migrations;
//   - no narrative, name, description or decryption anywhere;
//   - PUBLIC/anon revoked, only authenticated granted, no service-role grant;
//   - the M.10B wrappers remain approved in the central API-F allowlist
//     (the central API-F guard owns the current exact global wrapper count).

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER =
  "API-M.10B — Task reorder and planning transactional API wrappers";
const CANONICAL_TASK_PMG_MARKER =
  "API-M.9A — Task PMG exact-capability external readiness";
const CANONICAL_TASK_PLANNING_MARKER =
  "API-M.9B — Legacy Task planning external canonicalization";

async function findMigrationByMarker(marker: string): Promise<string | null> {
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (text.includes(marker)) return text;
  }
  return null;
}

async function requireMigrationByMarker(marker: string): Promise<string> {
  const found = await findMigrationByMarker(marker);
  if (found === null) throw new Error(`migration marker not found: ${marker}`);
  return found;
}

const RAW = await requireMigrationByMarker(`-- ${MARKER}`);
// Executable SQL only: comments are governance prose, not definitions.
const EXEC = RAW.split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");
const FLAT = EXEC.replace(/\s+/g, " ");

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const REORDER_SIG =
  "CREATE OR REPLACE FUNCTION public.api_v1_reorder_tasks( _expected_oauth_client_id text, _phase_id uuid, _rows jsonb, _request_id text, _correlation_id text, _idempotency_key text, _payload_hash text ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'";

const PLAN_SIG =
  "CREATE OR REPLACE FUNCTION public.api_v1_plan_task( _expected_oauth_client_id text, _task_id uuid, _expected_updated_at timestamptz, _new_start date, _new_due date, _confirm_parent_extension boolean, _request_id text, _correlation_id text, _idempotency_key text, _payload_hash text ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'";

const reorderStart = FLAT.indexOf(
  "CREATE OR REPLACE FUNCTION public.api_v1_reorder_tasks(",
);
const planStart = FLAT.indexOf(
  "CREATE OR REPLACE FUNCTION public.api_v1_plan_task(",
);
assert(reorderStart >= 0, "reorder wrapper definition not found");
assert(planStart > reorderStart, "plan wrapper must follow reorder wrapper");
const REORDER_BODY = FLAT.slice(reorderStart, planStart);
const PLAN_BODY = FLAT.slice(planStart);

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

Deno.test("M.10B defines exactly the two Task wrappers with exact signatures", () => {
  assert(FLAT.includes(REORDER_SIG), "exact reorder signature missing");
  assert(FLAT.includes(PLAN_SIG), "exact plan signature missing");
  assert(
    countOf(FLAT, "CREATE OR REPLACE FUNCTION") === 2,
    "migration must define exactly two functions",
  );
  assert(countOf(FLAT, "RETURNS jsonb") === 2, "both wrappers must return jsonb");
  assert(
    countOf(FLAT, "SECURITY DEFINER") === 2 &&
      countOf(FLAT, "SET search_path TO 'pg_catalog', 'public'") === 2,
    "both wrappers must be SECURITY DEFINER with hardened search_path",
  );
  for (
    const forbidden of [
      "api_v1_assign_task",
      "api_v1_transition_task",
      "api_v1_create_task",
      "api_v1_update_task",
      "api_v1_create_phase",
      "api_v1_update_phase",
      "api_v1_reorder_phases",
      "api_v1_plan_phase",
      "api_v1_create_risk",
      "api_v1_update_risk",
      "api_v1_create_blocker",
      "api_v1_update_blocker",
      "api_v1_append_execution_update",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `out-of-scope wrapper present: ${forbidden}`);
  }
  for (
    const forbidden of [
      "CREATE TABLE",
      "ALTER TABLE",
      "CREATE TYPE",
      "ALTER TYPE",
      "CREATE POLICY",
      "DROP POLICY",
      "CREATE SCHEMA",
      "INSERT INTO public.api_capability_catalogue",
      "api_capability_grants",
      "api_client_supported_capabilities",
      "openapi",
      "OpenAPI",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `unexpected out-of-scope SQL: ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Fixed architecture
// ---------------------------------------------------------------------------

Deno.test("each wrapper carries exactly one hardcoded capability identity", () => {
  assert(
    countOf(REORDER_BODY, "c_capability_key constant text := 'tasks:reorder';") ===
      1,
    "reorder must hardcode tasks:reorder once",
  );
  for (
    const other of [
      "'tasks:create'",
      "'tasks:update'",
      "'tasks:plan'",
      "'tasks:assign'",
      "'tasks:transition'",
      "'phases:reorder'",
      "'phases:plan'",
    ]
  ) {
    assert(
      !REORDER_BODY.includes(other),
      `reorder must not reference capability ${other}`,
    );
  }
  assert(
    countOf(PLAN_BODY, "c_capability_key constant text := 'tasks:plan';") === 1,
    "plan must hardcode tasks:plan once",
  );
  for (
    const other of [
      "'tasks:create'",
      "'tasks:update'",
      "'tasks:reorder'",
      "'tasks:assign'",
      "'tasks:transition'",
      "'phases:plan'",
    ]
  ) {
    assert(
      !PLAN_BODY.includes(other),
      `plan must not reference capability ${other}`,
    );
  }
  for (const body of [REORDER_BODY, PLAN_BODY]) {
    assert(
      body.includes("c_api_version constant text := 'v1';") &&
        body.includes("c_capability_kind constant text := 'command';"),
      "fixed api version and capability kind constants required",
    );
  }
});

Deno.test("no caller-supplied capability, scope, command or dispatch parameter", () => {
  const reorderParams = REORDER_SIG.slice(
    REORDER_SIG.indexOf("(") + 1,
    REORDER_SIG.indexOf(")"),
  );
  const planParams = PLAN_SIG.slice(
    PLAN_SIG.indexOf("(") + 1,
    PLAN_SIG.indexOf(")"),
  );
  for (const params of [reorderParams, planParams]) {
    for (
      const forbidden of [
        "_capability",
        "_command",
        "_function",
        "_rpc",
        "_table",
        "_sql",
        "_tenant_id",
        "_organization_id",
        "_workspace_id",
        "_project_id",
        "_source_channel",
        "_actor",
        "_user_id",
      ]
    ) {
      assert(
        !params.includes(forbidden),
        `forbidden caller-supplied parameter ${forbidden}`,
      );
    }
  }
  // Only the reorder wrapper may accept a JSONB payload parameter.
  assert(reorderParams.includes("_rows jsonb"), "reorder must accept _rows jsonb");
  assert(!planParams.includes("jsonb"), "plan must not accept a jsonb parameter");
  // No dynamic SQL anywhere.
  for (const kw of ["EXECUTE format", "EXECUTE '", "quote_ident", "quote_literal"]) {
    assert(!FLAT.includes(kw), `dynamic SQL construct present: ${kw}`);
  }
});

// ---------------------------------------------------------------------------
// Scope containment
// ---------------------------------------------------------------------------

Deno.test("reorder derives scope Phase -> Project before authorization", () => {
  const phaseRead = REORDER_BODY.indexOf(
    "FROM public.phases ph WHERE ph.id = _phase_id;",
  );
  const projectRead = REORDER_BODY.indexOf("FROM public.projects p WHERE p.id = v_row_project_id;");
  const authorize = REORDER_BODY.indexOf("api_e_private.authorize_and_establish(");
  assert(phaseRead > 0, "structural Phase read required");
  assert(projectRead > phaseRead, "canonical Project read must follow Phase read");
  assert(authorize > projectRead, "authorization must follow scope derivation");
  assert(
    REORDER_BODY.includes("v_workspace_id IS DISTINCT FROM v_row_workspace_id") &&
      REORDER_BODY.includes(
        "v_organization_id IS DISTINCT FROM v_row_organization_id",
      ),
    "Phase/Project Workspace + Organization consistency must be checked",
  );
});

Deno.test("plan derives scope Task -> Phase -> Project before authorization", () => {
  const taskRead = PLAN_BODY.indexOf("FROM public.tasks t WHERE t.id = _task_id;");
  const phaseRead = PLAN_BODY.indexOf(
    "FROM public.phases ph WHERE ph.id = v_task_phase_id;",
  );
  const projectRead = PLAN_BODY.indexOf(
    "FROM public.projects p WHERE p.id = v_task_project_id;",
  );
  const authorize = PLAN_BODY.indexOf("api_e_private.authorize_and_establish(");
  assert(taskRead > 0, "structural Task read required");
  assert(phaseRead > taskRead, "parent Phase read must follow Task read");
  assert(projectRead > phaseRead, "canonical Project read must follow Phase read");
  assert(authorize > projectRead, "authorization must follow scope derivation");
  assert(
    PLAN_BODY.includes("v_phase_id IS DISTINCT FROM v_task_phase_id") &&
      PLAN_BODY.includes("v_phase_project_id IS DISTINCT FROM v_task_project_id"),
    "Phase identity must agree with the Task",
  );
  assert(
    PLAN_BODY.includes("v_phase_workspace_id IS DISTINCT FROM v_task_workspace_id") &&
      PLAN_BODY.includes(
        "v_phase_organization_id IS DISTINCT FROM v_task_organization_id",
      ) &&
      PLAN_BODY.includes("v_workspace_id IS DISTINCT FROM v_phase_workspace_id") &&
      PLAN_BODY.includes(
        "v_organization_id IS DISTINCT FROM v_phase_organization_id",
      ),
    "Task/Phase/Project Workspace + Organization identity must all agree",
  );
});

Deno.test("trusted context rechecked and Project enablement precedes idempotency", () => {
  for (const body of [REORDER_BODY, PLAN_BODY]) {
    assert(
      countOf(body, "api_e_private.authorize_and_establish(") === 1,
      "exactly one authorize_and_establish call",
    );
    for (
      const setting of [
        "current_setting('api_e.api_client_id', true)",
        "current_setting('api_e.tenant_id', true)",
        "current_setting('api_e.organization_id', true)",
        "current_setting('api_e.workspace_id', true)",
      ]
    ) {
      assert(body.includes(setting), `trusted context recheck missing: ${setting}`);
    }
    assert(
      body.includes("v_ctx_org_id IS DISTINCT FROM v_organization_id") &&
        body.includes("v_ctx_workspace_id IS DISTINCT FROM v_workspace_id"),
      "trusted Organization/Workspace must equal server-derived scope",
    );
    const enablement = body.indexOf("FROM public.api_project_client_enablements e");
    const claim = body.indexOf("api_e_private.claim_idempotency(");
    assert(enablement > 0, "Project Connected App enablement check required");
    assert(claim > enablement, "enablement must precede API-F claim");
    for (
      const clause of [
        "e.project_id = v_project_id",
        "e.api_client_id = v_ctx_client_id",
        "e.tenant_id = v_ctx_tenant_id",
        "e.organization_id = v_organization_id",
        "e.workspace_id = v_workspace_id",
        "e.lifecycle_status = 'enabled'",
        "e.enabled_at IS NOT NULL",
        "e.disabled_at IS NULL",
      ]
    ) {
      assert(body.includes(clause), `enablement clause missing: ${clause}`);
    }
    assert(
      !body.includes("api_organization_client_enablements") &&
        !body.includes("api_workspace_client_enablements"),
      "no Organization-only or Workspace-only enablement substitute",
    );
  }
});

Deno.test("no protected narrative read or decryption in either wrapper", () => {
  for (
    const forbidden of [
      "btpm_decrypt",
      "get_decrypted_task",
      "get_decrypted_phase",
      "description",
      "'name'",
      ".name",
      "narrative",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `protected-data reference present: ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// API-F
// ---------------------------------------------------------------------------

Deno.test("API-F claim uses the exact fixed capability constant and standard branches", () => {
  for (const body of [REORDER_BODY, PLAN_BODY]) {
    assert(
      countOf(
        body,
        "api_e_private.claim_idempotency(c_capability_key, _idempotency_key, _payload_hash)",
      ) === 1,
      "claim must use the fixed capability constant exactly once",
    );
    assert(
      body.includes("'outcome', 'idempotency_conflict'") &&
        body.includes("'outcome', 'idempotency_pending'"),
      "conflict and pending outcomes required",
    );
    assert(
      body.includes("jsonb_typeof(v_claim.canonical_result) <> 'object'") &&
        body.includes(
          "RETURN v_claim.canonical_result || jsonb_build_object('outcome', 'replayed');",
        ),
      "completed replay must validate the stored object and overlay replayed",
    );
  }
});

Deno.test("failed-replay codes are exactly the approved per-wrapper sets", () => {
  const reorderCodes = [...REORDER_BODY.matchAll(/v_claim\.failure_code = '([a-z_]+)'/g)]
    .map((m) => m[1]);
  assert(
    JSON.stringify(reorderCodes) ===
      JSON.stringify(["stale_task_order", "not_authorized", "invalid"]),
    `unexpected reorder failed-replay codes: ${reorderCodes.join(",")}`,
  );
  const planCodes = [...PLAN_BODY.matchAll(/v_claim\.failure_code = '([a-z_]+)'/g)]
    .map((m) => m[1]);
  assert(
    JSON.stringify(planCodes) ===
      JSON.stringify(["stale_task_planning", "not_authorized", "invalid"]),
    `unexpected plan failed-replay codes: ${planCodes.join(",")}`,
  );
});

Deno.test("canonical mutation happens only after the execute claim", () => {
  const reorderClaim = REORDER_BODY.indexOf("api_e_private.claim_idempotency(");
  const reorderCall = REORDER_BODY.indexOf("public.reorder_tasks(");
  assert(reorderCall > reorderClaim, "reorder command must follow the claim");
  const planClaim = PLAN_BODY.indexOf("api_e_private.claim_idempotency(");
  const planCall = PLAN_BODY.indexOf("public.apply_task_planning_change(");
  assert(planCall > planClaim, "planning command must follow the claim");
  for (const body of [REORDER_BODY, PLAN_BODY]) {
    assert(
      body.includes("v_claim.decision <> 'execute'"),
      "non-execute decisions must terminate before the canonical command",
    );
    assert(
      countOf(body, "api_e_private.complete_idempotency(") >= 1 &&
        countOf(body, "api_e_private.fail_idempotency(") >= 1,
      "completion and failure must both remain in the same transaction",
    );
  }
});

// ---------------------------------------------------------------------------
// TOCTOU
// ---------------------------------------------------------------------------

Deno.test("reorder locks and re-confirms the target Phase after the claim", () => {
  const claim = REORDER_BODY.indexOf("api_e_private.claim_idempotency(");
  const lock = REORDER_BODY.indexOf(
    "FROM public.phases ph WHERE ph.id = _phase_id FOR UPDATE;",
  );
  const call = REORDER_BODY.indexOf("public.reorder_tasks(");
  assert(lock > claim && call > lock, "Phase lock must sit between claim and command");
  assert(
    REORDER_BODY.includes("v_locked_project_id IS DISTINCT FROM v_project_id") &&
      REORDER_BODY.includes("v_locked_workspace_id IS DISTINCT FROM v_workspace_id") &&
      REORDER_BODY.includes(
        "v_locked_organization_id IS DISTINCT FROM v_organization_id",
      ),
    "locked Phase structural scope must be re-confirmed",
  );
});

Deno.test("plan locks and re-confirms the Task then the canonical parent Phase", () => {
  const claim = PLAN_BODY.indexOf("api_e_private.claim_idempotency(");
  const taskLock = PLAN_BODY.indexOf(
    "FROM public.tasks t WHERE t.id = _task_id FOR UPDATE;",
  );
  const phaseLock = PLAN_BODY.indexOf(
    "FROM public.phases ph WHERE ph.id = v_locked_task_phase_id FOR UPDATE;",
  );
  const call = PLAN_BODY.indexOf("public.apply_task_planning_change(");
  assert(taskLock > claim, "Task lock must follow the claim");
  assert(phaseLock > taskLock, "parent Phase lock must follow the Task lock");
  assert(call > phaseLock, "canonical command must follow both locks");
  assert(
    PLAN_BODY.includes("v_locked_task_phase_id IS DISTINCT FROM v_phase_id") &&
      PLAN_BODY.includes("v_locked_phase_project_id IS DISTINCT FROM v_project_id"),
    "locked Task/Phase structural scope must be re-confirmed",
  );
});

Deno.test("structural drift fails idempotency as not_authorized and neither wrapper writes business tables", () => {
  const driftBranches = [...FLAT.matchAll(
    /api_e_private\.fail_idempotency\(v_claim\.registry_id, 'not_authorized'\)/g,
  )];
  assert(driftBranches.length >= 3, "drift branches must fail API-F as not_authorized");
  for (
    const forbidden of [
      "UPDATE public.tasks",
      "UPDATE public.phases",
      "UPDATE public.projects",
      "INSERT INTO public.tasks",
      "INSERT INTO public.phases",
      "DELETE FROM public.tasks",
      "DELETE FROM public.phases",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `wrapper-side business write present: ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Reorder semantics
// ---------------------------------------------------------------------------

Deno.test("reorder calls exactly one canonical command and reproduces no algorithm", () => {
  assert(
    countOf(REORDER_BODY, "public.reorder_tasks(") === 1,
    "exactly one public.reorder_tasks call",
  );
  assert(
    REORDER_BODY.includes(
      "public.reorder_tasks( _phase_id, _rows, _correlation_id, _idempotency_key )",
    ),
    "canonical reorder argument list must be exact",
  );
  for (
    const forbidden of [
      "jsonb_array_elements(_rows)",
      "duplicate",
      "sibling",
      "expected_updated_at",
      "_pmg_task_reorder_input",
    ]
  ) {
    assert(
      !REORDER_BODY.includes(forbidden),
      `reorder wrapper must not reimplement validation: ${forbidden}`,
    );
  }
  assert(
    !REORDER_BODY.includes("confirmation"),
    "reorder has no confirmation path",
  );
});

Deno.test("reorder success is bounded and conflict is read from the PMG conflict object", () => {
  assert(
    REORDER_BODY.includes("IF v_pmg_status IN ('applied','no_change') THEN"),
    "reorder success accepts only applied/no_change",
  );
  assert(
    REORDER_BODY.includes("jsonb_typeof(v_data -> 'submitted_count') <> 'number'") &&
      REORDER_BODY.includes("jsonb_typeof(v_data -> 'changed_count') <> 'number'") &&
      REORDER_BODY.includes("jsonb_typeof(v_data -> 'ordered_tasks') <> 'array'"),
    "canonical structural result must be validated",
  );
  assert(
    REORDER_BODY.includes("'taskId', (elem ->> 'id')::uuid") &&
      REORDER_BODY.includes("'sortOrder', (elem -> 'sort_order')") &&
      REORDER_BODY.includes("'updatedAt', (elem ->> 'updated_at')") &&
      REORDER_BODY.includes("'orderedTasks', v_ordered"),
    "canonical ordered_tasks must map to bounded orderedTasks",
  );
  assert(
    REORDER_BODY.includes("v_conflict := v_pmg -> 'conflict';") &&
      REORDER_BODY.includes("(v_conflict ->> 'code') IS DISTINCT FROM 'stale_task_order'"),
    "conflict must be read from the PMG conflict object with the exact code",
  );
  assert(
    !REORDER_BODY.includes("v_data -> 'stale_ids'"),
    "stale identifiers must never be read from PMG data",
  );
  assert(
    REORDER_BODY.includes("jsonb_typeof(v_conflict -> 'stale_ids') = 'array'") &&
      REORDER_BODY.includes("to_jsonb((elem #>> '{}')::uuid)") &&
      REORDER_BODY.includes("'staleTaskIds', v_stale"),
    "direct stale IDs must be validated as UUIDs and bounded",
  );
  assert(
    REORDER_BODY.includes(
      "api_e_private.fail_idempotency(v_claim.registry_id, 'stale_task_order')",
    ),
    "only the stable failure code may be persisted",
  );
  // Failed replay is intentionally the smaller contract.
  assert(
    REORDER_BODY.includes(
      "RETURN jsonb_build_object('ok', false, 'outcome', 'conflict', 'code', 'stale_task_order');",
    ),
    "failed replay must contain no stale Task identifiers",
  );
});

// ---------------------------------------------------------------------------
// Planning semantics
// ---------------------------------------------------------------------------

Deno.test("plan requires expectedUpdatedAt and calls only the 5-argument overload", () => {
  assert(
    PLAN_BODY.includes("_expected_updated_at IS NULL"),
    "expectedUpdatedAt must be mandatory",
  );
  // The COMMENT statement also names the canonical command, so the invocation
  // itself is counted by its exact argument list.
  assert(
    countOf(PLAN_BODY, "public.apply_task_planning_change( _task_id,") === 1,
    "exactly one canonical planning call",
  );
  assert(
    !PLAN_BODY.includes(
      "public.apply_task_planning_change( _task_id, _new_start",
    ) && !PLAN_BODY.includes("apply_task_planning_change(uuid, date, date, boolean)"),
    "the legacy 4-argument overload must never be invoked",
  );
  assert(
    PLAN_BODY.includes(
      "public.apply_task_planning_change( _task_id, _expected_updated_at, _new_start, _new_due, COALESCE(_confirm_parent_extension, false) )",
    ),
    "the 5-argument external overload must be invoked with the exact arguments",
  );
  for (
    const forbidden of [
      "preview_task_planning_change",
      "_apply_phase_extension_internal",
      "_apply_project_extension_internal",
      "app.allow_planned_extension",
    ]
  ) {
    assert(!PLAN_BODY.includes(forbidden), `forbidden helper call: ${forbidden}`);
  }
  assert(
    PLAN_BODY.includes("_new_due < _new_start"),
    "wrapper-level date-order validation required",
  );
});

Deno.test("plan success, confirmation and conflict contracts are exact and bounded", () => {
  assert(
    PLAN_BODY.includes("IF v_pmg_status IN ('applied','no_change') THEN"),
    "plan success accepts only applied/no_change",
  );
  assert(
    PLAN_BODY.includes("(v_data ->> 'task_id') IS DISTINCT FROM _task_id::text") &&
      PLAN_BODY.includes("(v_data ->> 'phase_id') IS DISTINCT FROM v_phase_id::text") &&
      PLAN_BODY.includes(
        "(v_data ->> 'project_id') IS DISTINCT FROM v_project_id::text",
      ) &&
      PLAN_BODY.includes("jsonb_typeof(v_data -> 'phase_extended') <> 'boolean'"),
    "canonical result identities must be validated",
  );
  for (
    const key of [
      "'taskId'",
      "'projectId'",
      "'phaseId'",
      "'startDate'",
      "'dueDate'",
      "'updatedAt'",
      "'phaseExtended'",
      "'phaseStartDate'",
      "'phaseTargetEndDate'",
    ]
  ) {
    assert(PLAN_BODY.includes(key), `success result key missing: ${key}`);
  }
  // Confirmation
  assert(
    PLAN_BODY.includes("v_confirmation := coalesce(v_pmg -> 'confirmations' -> 0,") &&
      PLAN_BODY.includes(
        "(v_confirmation ->> 'code') IS DISTINCT FROM 'extend_phase_window_required'",
      ),
    "confirmation must be read from the PMG confirmations array with the exact code",
  );
  assert(
    PLAN_BODY.includes("(v_confirmation ->> 'task_id') IS DISTINCT FROM _task_id::text") &&
      PLAN_BODY.includes(
        "(v_confirmation ->> 'phase_id') IS DISTINCT FROM v_phase_id::text",
      ) &&
      PLAN_BODY.includes(
        "(v_confirmation ->> 'project_id') IS DISTINCT FROM v_project_id::text",
      ),
    "confirmation Task/Phase/Project identities must be validated",
  );
  const confirmIdx = PLAN_BODY.indexOf("'outcome', 'confirmation_required'");
  const completeAfter = PLAN_BODY.indexOf(
    "api_e_private.complete_idempotency(",
    confirmIdx,
  );
  assert(confirmIdx > 0 && completeAfter > confirmIdx, "confirmation must be stored via complete_idempotency");
  // Conflict
  assert(
    PLAN_BODY.includes("v_conflict := v_pmg -> 'conflict';") &&
      PLAN_BODY.includes(
        "(v_conflict ->> 'code') IS DISTINCT FROM 'stale_task_planning'",
      ) &&
      PLAN_BODY.includes(
        "nullif(btrim(coalesce(v_conflict ->> 'current_updated_at','')),'') IS NULL",
      ),
    "planning conflict must come from the PMG conflict object with current_updated_at",
  );
  assert(
    PLAN_BODY.includes("'currentUpdatedAt', (v_conflict ->> 'current_updated_at')") &&
      PLAN_BODY.includes(
        "api_e_private.fail_idempotency(v_claim.registry_id, 'stale_task_planning')",
      ) &&
      PLAN_BODY.includes(
        "RETURN jsonb_build_object('ok', false, 'outcome', 'conflict', 'code', 'stale_task_planning');",
      ),
    "direct conflict is bounded and replayed conflict stays minimal",
  );
});

// ---------------------------------------------------------------------------
// Cross-layer: canonical command contracts (M.9A / M.9B)
// ---------------------------------------------------------------------------

Deno.test("expected canonical result locations exist in the accepted M.9A/M.9B migrations", async () => {
  const pmg = await findMigrationByMarker(CANONICAL_TASK_PMG_MARKER) ??
    await requireMigrationByMarker("public.reorder_tasks(_phase_id uuid, _rows jsonb");
  assert(
    pmg.includes("'code', 'stale_task_order'") && pmg.includes("'stale_ids'"),
    "canonical reorder conflict object must carry stale_task_order/stale_ids",
  );
  assert(
    pmg.includes("'submitted_count'") && pmg.includes("'changed_count'") &&
      pmg.includes("'ordered_tasks'"),
    "canonical reorder data must carry submitted/changed counts and ordered_tasks",
  );
  const planning = await findMigrationByMarker(CANONICAL_TASK_PLANNING_MARKER) ??
    await requireMigrationByMarker(
      "public.apply_task_planning_change(_task_id uuid, _expected_updated_at timestamptz",
    );
  assert(
    planning.includes("'code', 'stale_task_planning'") &&
      planning.includes("'current_updated_at'"),
    "canonical planning conflict must carry stale_task_planning/current_updated_at",
  );
  assert(
    planning.includes("'code', 'extend_phase_window_required'") &&
      planning.includes("'phase_proposed_target_end'") &&
      planning.includes("'requested_task_due'"),
    "canonical planning confirmation keys must match the wrapper mapping",
  );
  assert(
    planning.includes("'phase_extended'") && planning.includes("'phase_start_date'") &&
      planning.includes("'phase_target_end_date'"),
    "canonical planning data keys must match the wrapper mapping",
  );
});

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

Deno.test("both wrappers revoke PUBLIC/anon and grant only authenticated", () => {
  for (
    const sig of [
      "public.api_v1_reorder_tasks(text, uuid, jsonb, text, text, text, text)",
      "public.api_v1_plan_task(text, uuid, timestamptz, date, date, boolean, text, text, text, text)",
    ]
  ) {
    assert(
      FLAT.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`),
      `PUBLIC must be revoked for ${sig}`,
    );
    assert(
      FLAT.includes(`REVOKE ALL ON FUNCTION ${sig} FROM anon;`),
      `anon must be revoked for ${sig}`,
    );
    assert(
      FLAT.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`),
      `authenticated must be granted for ${sig}`,
    );
  }
  assert(!FLAT.includes("service_role"), "no explicit service-role grant permitted");
  assert(
    countOf(FLAT, "GRANT EXECUTE ON FUNCTION") === 2,
    "exactly two execute grants",
  );
  assert(
    FLAT.includes("API-M.10B explicit transactional wrapper. Capability tasks:reorder") &&
      FLAT.includes("API-M.10B explicit transactional wrapper. Capability tasks:plan"),
    "both wrappers must carry an API-M.10B identifying comment",
  );
});

// ---------------------------------------------------------------------------
// API-F permanent guard
// ---------------------------------------------------------------------------

Deno.test("central API-F allowlist still approves the two API-M.10B wrappers", async () => {
  const guard = await Deno.readTextFile(
    "supabase/edge-tests/_shared/api-f-3-database-execution-wrapper_static_test.ts",
  );
  const block = guard.slice(
    guard.indexOf("const APPROVED_IDEMPOTENCY_WRAPPERS = new Set(["),
  );
  const set = block.slice(0, block.indexOf("]);"));
  const names = [...set.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
  assert(
    names.includes("api_v1_reorder_tasks") && names.includes("api_v1_plan_task"),
    "both API-M.10B wrappers must be approved",
  );
  // Exact-membership detector must remain unchanged.
  assert(
    guard.includes(
      "if (APPROVED_IDEMPOTENCY_WRAPPERS.has(fn.name.toLowerCase())) continue;",
    ),
    "exact-name membership detector must remain unchanged",
  );
  assert(
    !/APPROVED_IDEMPOTENCY_WRAPPERS[\s\S]{0,400}startsWith|includes\(fn\.name/.test(
      guard,
    ),
    "no prefix or fuzzy matching may be introduced",
  );
});
