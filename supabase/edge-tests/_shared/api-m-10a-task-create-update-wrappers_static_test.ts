// API-M.10A — Dedicated transactional Task create and update API wrappers.
//
// Focused repository static contract test. Locates the API-M.10A migration by
// its unique marker and asserts, from committed source only:
//   - exactly two wrapper definitions exist (create + update), with exact typed signatures;
//   - both RETURN jsonb, are SECURITY DEFINER with a hardened search path;
//   - create hardcodes only tasks:create, update hardcodes only tasks:update;
//   - no caller-supplied capability/scope/command/function/RPC/table/SQL parameter;
//   - create scope derives from the target Phase, update scope from the target Task;
//   - Project structural containment is verified before authorization;
//   - authorize_and_establish is called exactly once with server-derived scope;
//   - trusted Organization/Workspace context is rechecked;
//   - exact Project Connected App enablement occurs before idempotency;
//   - the API-F claim uses the exact fixed capability constant;
//   - conflict/pending/replay branches never call a canonical Task command;
//   - each wrapper calls exactly one canonical command, once;
//   - both execute branches lock and re-confirm structural scope (TOCTOU);
//   - external results never contain Task name or description;
//   - create confirmation code is exactly extend_phase_window_required;
//   - update conflict requires and persists only the stable code stale_task;
//   - PUBLIC/anon are revoked, only authenticated is granted, no service-role grant;
//   - no dynamic SQL, generic dispatcher, or business-table write is introduced;
//   - the M.10A wrappers remain approved in the central API-F allowlist
//     (the central API-F guard owns the current exact global wrapper count).

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER =
  "API-M.10A — Dedicated transactional Task create and update API wrappers";

async function findMigrationByMarker(marker: string): Promise<string> {
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (text.includes(`-- ${marker}`)) return text;
  }
  throw new Error(`migration marker not found: ${marker}`);
}

const RAW = await findMigrationByMarker(MARKER);
// Executable SQL only: comments are governance prose, not definitions.
const EXEC = RAW.split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");
const FLAT = EXEC.replace(/\s+/g, " ");

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const CREATE_SIG =
  "CREATE OR REPLACE FUNCTION public.api_v1_create_task( _expected_oauth_client_id text, _phase_id uuid, _name text, _description text, _status text, _priority text, _task_type text, _start_date date, _due_date date, _estimated_hours numeric, _sort_order integer, _request_id text, _correlation_id text, _idempotency_key text, _payload_hash text ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'";

const UPDATE_SIG =
  "CREATE OR REPLACE FUNCTION public.api_v1_update_task( _expected_oauth_client_id text, _task_id uuid, _expected_updated_at timestamptz, _name text, _description text, _status text, _priority text, _task_type text, _estimated_hours numeric, _request_id text, _correlation_id text, _idempotency_key text, _payload_hash text ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'";

const createStart = FLAT.indexOf(
  "CREATE OR REPLACE FUNCTION public.api_v1_create_task(",
);
const updateStart = FLAT.indexOf(
  "CREATE OR REPLACE FUNCTION public.api_v1_update_task(",
);
assert(createStart >= 0, "create wrapper definition not found");
assert(updateStart > createStart, "update wrapper must follow create wrapper");
const CREATE_BODY = FLAT.slice(createStart, updateStart);
const UPDATE_BODY = FLAT.slice(updateStart);

Deno.test("M.10A defines exactly the two Task wrappers with exact signatures", () => {
  assert(FLAT.includes(CREATE_SIG), "exact create signature missing");
  assert(FLAT.includes(UPDATE_SIG), "exact update signature missing");
  assert(
    countOf(FLAT, "CREATE OR REPLACE FUNCTION") === 2,
    "migration must define exactly two functions",
  );
  assert(
    countOf(FLAT, "RETURNS jsonb") === 2,
    "both wrappers must return jsonb",
  );
  assert(
    countOf(FLAT, "SECURITY DEFINER") === 2 &&
      countOf(FLAT, "SET search_path TO 'pg_catalog', 'public'") === 2,
    "both wrappers must be SECURITY DEFINER with hardened search_path",
  );
  // No other Task wrapper, and no Phase/Risk/Blocker wrapper redefinition.
  for (
    const forbidden of [
      "api_v1_reorder_tasks",
      "api_v1_plan_task",
      "api_v1_assign_task",
      "api_v1_transition_task",
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
  // No schema/RLS/capability-assignment work.
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
    ]
  ) {
    assert(!FLAT.includes(forbidden), `unexpected out-of-scope SQL: ${forbidden}`);
  }
});

Deno.test("each wrapper carries exactly one hardcoded capability identity", () => {
  assert(
    countOf(CREATE_BODY, "c_capability_key constant text := 'tasks:create';") ===
      1,
    "create must hardcode tasks:create once",
  );
  assert(
    !CREATE_BODY.includes("'tasks:update'") &&
      !CREATE_BODY.includes("'tasks:reorder'") &&
      !CREATE_BODY.includes("'tasks:plan'") &&
      !CREATE_BODY.includes("'tasks:assign'") &&
      !CREATE_BODY.includes("'tasks:transition'"),
    "create must not reference any other Task capability",
  );
  assert(
    countOf(UPDATE_BODY, "c_capability_key constant text := 'tasks:update';") ===
      1,
    "update must hardcode tasks:update once",
  );
  assert(
    !UPDATE_BODY.includes("'tasks:create'") &&
      !UPDATE_BODY.includes("'tasks:reorder'") &&
      !UPDATE_BODY.includes("'tasks:plan'") &&
      !UPDATE_BODY.includes("'tasks:assign'") &&
      !UPDATE_BODY.includes("'tasks:transition'"),
    "update must not reference any other Task capability",
  );
  for (const body of [CREATE_BODY, UPDATE_BODY]) {
    assert(
      body.includes("c_api_version constant text := 'v1';") &&
        body.includes("c_capability_kind constant text := 'command';"),
      "fixed api version and capability kind constants required",
    );
  }
});

Deno.test("no caller-supplied capability, scope, command or dispatch parameter", () => {
  const createParams = CREATE_SIG.slice(
    CREATE_SIG.indexOf("(") + 1,
    CREATE_SIG.indexOf(")"),
  );
  const updateParams = UPDATE_SIG.slice(
    UPDATE_SIG.indexOf("(") + 1,
    UPDATE_SIG.indexOf(")"),
  );
  for (const params of [createParams, updateParams]) {
    for (
      const forbidden of [
        "_capability",
        "_tenant",
        "_organization",
        "_workspace",
        "_project_id",
        "_source_channel",
        "_command",
        "_function",
        "_rpc",
        "_table",
        "_sql",
        "_payload jsonb",
        "jsonb",
      ]
    ) {
      assert(
        !params.includes(forbidden),
        `forbidden wrapper parameter: ${forbidden}`,
      );
    }
  }
});

Deno.test("authoritative scope derivation precedes authorization", () => {
  const createPhaseRead = CREATE_BODY.indexOf(
    "FROM public.phases ph WHERE ph.id = _phase_id",
  );
  const createProjectRead = CREATE_BODY.indexOf(
    "FROM public.projects p WHERE p.id = v_row_project_id",
  );
  const createAuth = CREATE_BODY.indexOf(
    "api_e_private.authorize_and_establish(",
  );
  assert(
    createPhaseRead > 0 && createProjectRead > createPhaseRead,
    "create must derive Phase -> parent Project scope",
  );
  assert(
    createProjectRead < createAuth,
    "create scope derivation must precede authorization",
  );

  const updateTaskRead = UPDATE_BODY.indexOf(
    "FROM public.tasks t WHERE t.id = _task_id",
  );
  const updateProjectRead = UPDATE_BODY.indexOf(
    "FROM public.projects p WHERE p.id = v_row_project_id",
  );
  const updateAuth = UPDATE_BODY.indexOf(
    "api_e_private.authorize_and_establish(",
  );
  assert(
    updateTaskRead > 0 && updateProjectRead > updateTaskRead,
    "update must derive Task -> parent Project scope",
  );
  assert(
    updateProjectRead < updateAuth,
    "update scope derivation must precede authorization",
  );

  for (const body of [CREATE_BODY, UPDATE_BODY]) {
    assert(
      body.includes("v_workspace_id IS DISTINCT FROM v_row_workspace_id") &&
        body.includes(
          "v_organization_id IS DISTINCT FROM v_row_organization_id",
        ),
      "stored target scope must match the canonical parent Project",
    );
    // Non-enumerating failure on unresolved/inconsistent scope.
    assert(
      body.includes(
        `jsonb_build_object('ok', false, 'outcome', 'not_authorized')`,
      ),
      "unresolved scope must return a bounded not_authorized outcome",
    );
  }
  // Structural columns only: no protected narrative read for authorization.
  assert(
    CREATE_BODY.includes(
      "SELECT ph.project_id, ph.workspace_id, ph.organization_id",
    ),
    "create must read only structural Phase columns",
  );
  assert(
    UPDATE_BODY.includes(
      "SELECT t.project_id, t.phase_id, t.workspace_id, t.organization_id",
    ),
    "update must read only structural Task columns",
  );
  assert(!FLAT.includes("btpm_decrypt"), "no decryption may occur in wrappers");
  assert(
    !FLAT.includes("get_decrypted_task"),
    "no protected Task read helper may be used",
  );
});

Deno.test("authorize_and_establish is used exactly once and is the only mechanism", () => {
  for (const body of [CREATE_BODY, UPDATE_BODY]) {
    assert(
      countOf(body, "api_e_private.authorize_and_establish(") === 1,
      "exactly one authorize_and_establish call per wrapper",
    );
    assert(
      body.includes(
        "api_e_private.authorize_and_establish( _expected_oauth_client_id, v_organization_id, v_workspace_id, c_api_version, c_capability_kind, c_capability_key, _request_id )",
      ),
      "authorization must use derived scope and fixed capability identity",
    );
  }
  assert(
    !FLAT.includes("authorize_project_scope"),
    "authorize_project_scope must not be used",
  );
});

Deno.test("trusted context is rechecked against derived scope", () => {
  for (const body of [CREATE_BODY, UPDATE_BODY]) {
    for (
      const setting of [
        "api_e.api_client_id",
        "api_e.tenant_id",
        "api_e.organization_id",
        "api_e.workspace_id",
      ]
    ) {
      assert(body.includes(setting), `trusted context ${setting} not read`);
    }
    assert(
      body.includes("v_ctx_client_id IS NULL OR v_ctx_tenant_id IS NULL") &&
        body.includes("v_ctx_org_id IS DISTINCT FROM v_organization_id") &&
        body.includes("v_ctx_workspace_id IS DISTINCT FROM v_workspace_id"),
      "trusted context must be matched to derived Organization/Workspace",
    );
  }
});

Deno.test("exact Project Connected App enablement precedes idempotency", () => {
  for (const body of [CREATE_BODY, UPDATE_BODY]) {
    const enablement = body.indexOf(
      "FROM public.api_project_client_enablements e",
    );
    const claim = body.indexOf("api_e_private.claim_idempotency(");
    assert(enablement > 0, "Project enablement check missing");
    assert(enablement < claim, "enablement must be checked before idempotency");
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
  }
  // Organization/Workspace enablement must never substitute for Project.
  assert(
    !FLAT.includes("api_organization_client_enablements") &&
      !FLAT.includes("api_workspace_client_enablements"),
    "Project enablement must not be substituted",
  );
});

Deno.test("API-F idempotency uses the exact fixed capability and fails closed", () => {
  for (const body of [CREATE_BODY, UPDATE_BODY]) {
    assert(
      countOf(
        body,
        "api_e_private.claim_idempotency(c_capability_key, _idempotency_key, _payload_hash)",
      ) === 1,
      "claim must use the exact hardcoded capability constant",
    );
    assert(
      body.includes(`'outcome', 'idempotency_conflict'`) &&
        body.includes(`'outcome', 'idempotency_pending'`) &&
        body.includes(`jsonb_build_object('outcome', 'replayed')`),
      "conflict/pending/replay branches required",
    );
    assert(
      body.includes("jsonb_typeof(v_claim.canonical_result) <> 'object'"),
      "completed replay must require a stored JSON object result",
    );
    assert(
      body.includes("unexpected idempotency decision") &&
        body.includes("unknown persisted failure code") &&
        body.includes("unexpected replay state"),
      "unknown claim states must raise internal exceptions",
    );
    // Replay/conflict/pending must be resolved before any canonical mutation.
    const claim = body.indexOf("api_e_private.claim_idempotency(");
    const canonical = body.indexOf(
      body === CREATE_BODY
        ? "public.apply_task_create("
        : "public.apply_task_update(",
    );
    assert(
      claim > 0 && claim < canonical,
      "canonical command must be invoked only after the claim decision",
    );
    const preCanonical = body.slice(0, canonical);
    assert(
      !preCanonical.includes("public.apply_task_"),
      "no canonical mutation may occur in claim-decision branches",
    );
    // Completion/failure stay in the same wrapper transaction.
    assert(
      body.includes(
        "PERFORM api_e_private.complete_idempotency(v_claim.registry_id, v_result);",
      ) &&
        body.includes("api_e_private.fail_idempotency(v_claim.registry_id,"),
      "completion and failure must be performed inline",
    );
  }
  // Safe failed-replay codes only.
  assert(
    countOf(CREATE_BODY, "v_claim.failure_code = '") === 2 &&
      CREATE_BODY.includes(`v_claim.failure_code = 'not_authorized'`) &&
      CREATE_BODY.includes(`v_claim.failure_code = 'invalid'`),
    "create failed replay recognizes exactly not_authorized and invalid",
  );
  assert(
    countOf(UPDATE_BODY, "v_claim.failure_code = '") === 3 &&
      UPDATE_BODY.includes(`v_claim.failure_code = 'stale_task'`) &&
      UPDATE_BODY.includes(`v_claim.failure_code = 'not_authorized'`) &&
      UPDATE_BODY.includes(`v_claim.failure_code = 'invalid'`),
    "update failed replay recognizes exactly stale_task, not_authorized, invalid",
  );
});

Deno.test("both execute branches lock and re-confirm structural scope", () => {
  const createClaim = CREATE_BODY.indexOf("api_e_private.claim_idempotency(");
  const createLock = CREATE_BODY.indexOf(
    "FROM public.phases ph WHERE ph.id = _phase_id FOR UPDATE",
  );
  const createCanonical = CREATE_BODY.indexOf("public.apply_task_create(");
  assert(
    createLock > createClaim && createLock < createCanonical,
    "create must lock the target Phase between claim and command",
  );
  assert(
    CREATE_BODY.includes(
      "SELECT ph.project_id, ph.workspace_id, ph.organization_id INTO v_locked_project_id, v_locked_workspace_id, v_locked_organization_id",
    ),
    "create lock must read structural Phase scope only",
  );

  const updateClaim = UPDATE_BODY.indexOf("api_e_private.claim_idempotency(");
  const updateLock = UPDATE_BODY.indexOf(
    "FROM public.tasks t WHERE t.id = _task_id FOR UPDATE",
  );
  const updateCanonical = UPDATE_BODY.indexOf("public.apply_task_update(");
  assert(
    updateLock > updateClaim && updateLock < updateCanonical,
    "update must lock the target Task between claim and command",
  );
  assert(
    UPDATE_BODY.includes("v_locked_phase_id IS DISTINCT FROM v_row_phase_id"),
    "update must re-confirm the parent Phase identity",
  );

  for (const body of [CREATE_BODY, UPDATE_BODY]) {
    assert(
      body.includes("v_locked_project_id IS DISTINCT FROM v_row_project_id") &&
        body.includes("v_locked_project_id IS DISTINCT FROM v_project_id") &&
        body.includes(
          "v_locked_workspace_id IS DISTINCT FROM v_workspace_id",
        ) &&
        body.includes(
          "v_locked_organization_id IS DISTINCT FROM v_organization_id",
        ),
      "locked scope must be re-confirmed against the authorized scope",
    );
    assert(
      body.includes(
        "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'not_authorized'); RETURN jsonb_build_object('ok', false, 'outcome', 'not_authorized');",
      ),
      "scope drift must persist a bounded not_authorized failure",
    );
  }
});

Deno.test("each wrapper invokes exactly one canonical Task command", () => {
  assert(
    countOf(CREATE_BODY, "public.apply_task_create(") === 1,
    "create must call apply_task_create exactly once",
  );
  assert(
    !CREATE_BODY.includes("public.apply_task_update("),
    "create must not call apply_task_update",
  );
  assert(
    countOf(UPDATE_BODY, "public.apply_task_update(") === 1,
    "update must call apply_task_update exactly once",
  );
  assert(
    !UPDATE_BODY.includes("public.apply_task_create("),
    "update must not call apply_task_create",
  );
  for (
    const forbidden of [
      "reorder_tasks",
      "apply_task_planning_change",
      "apply_task_assignee_set",
      "apply_task_execution_change",
      "apply_task_stakeholder_roles_set",
      "set_task_assignee",
      "preview_task_planning_change",
      "_apply_phase_extension_internal",
      "_apply_project_extension_internal",
      "apply_phase_planning_change",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `forbidden call present: ${forbidden}`);
  }
});

Deno.test("create canonical enum defaults are preserved and bounded", () => {
  for (
    const line of [
      "v_status := 'planned'::public.pm_status;",
      "v_priority := 'medium'::public.pm_priority;",
      "v_task_type := 'work_item'::public.task_type;",
    ]
  ) {
    assert(CREATE_BODY.includes(line), `canonical default missing: ${line}`);
  }
  // Invalid enum text must return a bounded, non-echoing invalid outcome.
  assert(
    countOf(
      CREATE_BODY,
      `EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'outcome', 'invalid'); END;`,
    ) === 3,
    "each create enum cast must fail closed as invalid",
  );
  // Update must not invent defaults; NULL is preserved.
  assert(
    !UPDATE_BODY.includes("'planned'::public.pm_status") &&
      !UPDATE_BODY.includes("'medium'::public.pm_priority") &&
      !UPDATE_BODY.includes("'work_item'::public.task_type"),
    "update must not invent enum defaults",
  );
  assert(
    countOf(
      UPDATE_BODY,
      `EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'outcome', 'invalid'); END;`,
    ) === 3,
    "each update enum cast must fail closed as invalid",
  );
  assert(
    UPDATE_BODY.includes("_expected_updated_at IS NULL"),
    "update must require expectedUpdatedAt",
  );
});

Deno.test("external results are bounded and narrative-free", () => {
  for (const body of [CREATE_BODY, UPDATE_BODY]) {
    assert(!body.includes("'name'"), "result must not include Task name");
    assert(
      !body.includes("'description'"),
      "result must not include Task description",
    );
    for (
      const forbidden of ["'organizationId'", "'workspaceId'", "'taskName'"]
    ) {
      assert(!body.includes(forbidden), `forbidden result key: ${forbidden}`);
    }
  }
  assert(
    CREATE_BODY.includes(
      `'ok', true, 'outcome', 'applied', 'taskId', v_task_id, 'projectId', v_project_id, 'phaseId', _phase_id,`,
    ),
    "create applied result shape mismatch",
  );
  for (
    const key of [
      "'status'",
      "'priority'",
      "'taskType'",
      "'startDate'",
      "'dueDate'",
      "'estimatedHours'",
      "'sortOrder'",
      "'isArchived'",
      "'createdAt'",
      "'updatedAt'",
      "'shiftedSiblingCount'",
    ]
  ) {
    assert(CREATE_BODY.includes(key), `create applied key missing: ${key}`);
  }
  assert(
    CREATE_BODY.includes("inconsistent applied result") &&
      CREATE_BODY.includes(`(v_data ->> 'phase_id') IS DISTINCT FROM _phase_id::text`) &&
      CREATE_BODY.includes(
        `(v_data ->> 'project_id') IS DISTINCT FROM v_project_id::text`,
      ),
    "create must validate canonical applied identity before exposure",
  );
  assert(
    UPDATE_BODY.includes(
      `'ok', true, 'outcome', v_pmg_status, 'taskId', _task_id, 'projectId', v_project_id, 'phaseId', v_row_phase_id, 'status', (v_data ->> 'status'), 'priority', (v_data ->> 'priority'), 'taskType', (v_data ->> 'task_type'), 'estimatedHours', (v_data -> 'estimated_hours'), 'updatedAt', (v_data ->> 'updated_at')`,
    ),
    "update applied/no_change result shape mismatch",
  );
  assert(
    UPDATE_BODY.includes(`v_pmg_status IN ('applied','no_change')`),
    "update must accept only applied/no_change as success",
  );
  assert(
    !UPDATE_BODY.includes("current_updated_at"),
    "the wrapper must not expose current_updated_at",
  );
});

Deno.test("create confirmation_required is bounded and does not widen the Phase", () => {
  assert(
    CREATE_BODY.includes(`v_pmg_status = 'confirmation_required'`),
    "create must handle confirmation_required",
  );
  assert(
    CREATE_BODY.includes(
      `IF (v_confirmation ->> 'code') IS DISTINCT FROM 'extend_phase_window_required' THEN`,
    ),
    "confirmation code must be exactly extend_phase_window_required",
  );
  for (
    const key of [
      `'code', 'extend_phase_window_required'`,
      "'phaseStartDate'",
      "'phaseTargetEndDate'",
      "'requestedTaskStartDate'",
      "'requestedTaskDueDate'",
      "'requiredPhaseStartDate'",
      "'requiredPhaseTargetEndDate'",
    ]
  ) {
    assert(CREATE_BODY.includes(key), `confirmation key missing: ${key}`);
  }
  // Confirmation is completed as a safe replayable result.
  const confirmation = CREATE_BODY.indexOf(
    `'outcome', 'confirmation_required'`,
  );
  const completeAfter = CREATE_BODY.indexOf(
    "PERFORM api_e_private.complete_idempotency(v_claim.registry_id, v_result);",
    confirmation,
  );
  assert(
    completeAfter > confirmation,
    "confirmation must be completed as a safe replayable result",
  );
  assert(
    !CREATE_BODY.includes("UPDATE public.phases"),
    "create wrapper must never widen the Phase",
  );
  assert(
    CREATE_BODY.includes("unexpected confirmation payload"),
    "unexpected confirmation payloads must fail closed",
  );
  assert(
    !UPDATE_BODY.includes("confirmation_required"),
    "update has no confirmation path",
  );
});

Deno.test("intentional terminal failures use only bounded stable codes", () => {
  assert(
    UPDATE_BODY.includes(
      `IF (v_data ->> 'code') IS DISTINCT FROM 'stale_task' THEN`,
    ) &&
      UPDATE_BODY.includes("unexpected conflict payload"),
    "update conflict must require the exact canonical stale_task code",
  );
  assert(
    UPDATE_BODY.includes(
      "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'stale_task');",
    ) &&
      countOf(
        UPDATE_BODY,
        `jsonb_build_object('ok', false, 'outcome', 'conflict', 'code', 'stale_task')`,
      ) === 2,
    "update conflict must persist and replay the same bounded stale_task semantic",
  );
  assert(
    !CREATE_BODY.includes("stale_"),
    "create has no optimistic concurrency failure code",
  );
  assert(
    !CREATE_BODY.includes(`'outcome', 'conflict'`) &&
      !CREATE_BODY.includes(`'no_change'`),
    "create must not accept conflict or no_change canonical results",
  );
  for (const body of [CREATE_BODY, UPDATE_BODY]) {
    assert(
      body.includes("fail_idempotency(v_claim.registry_id, 'not_authorized')") &&
        body.includes("fail_idempotency(v_claim.registry_id, 'invalid')"),
      "bounded not_authorized/invalid failure codes required",
    );
    assert(
      body.includes("unexpected canonical command status"),
      "unexpected canonical status must raise an internal exception",
    );
    assert(
      !body.includes("SQLERRM"),
      "raw error text must never be captured or persisted",
    );
    // Completion happens only after the safe result object is built.
    const build = body.indexOf("v_result := jsonb_build_object(");
    const complete = body.indexOf("api_e_private.complete_idempotency(");
    assert(
      build > 0 && build < complete,
      "complete_idempotency must follow safe result construction",
    );
  }
});

Deno.test("grants: PUBLIC and anon revoked, only authenticated granted", () => {
  const createArgs =
    "public.api_v1_create_task(text, uuid, text, text, text, text, text, date, date, numeric, integer, text, text, text, text)";
  const updateArgs =
    "public.api_v1_update_task(text, uuid, timestamptz, text, text, text, text, text, numeric, text, text, text, text)";
  for (const sig of [createArgs, updateArgs]) {
    assert(
      FLAT.includes(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`),
      `PUBLIC not revoked for ${sig}`,
    );
    assert(
      FLAT.includes(`REVOKE ALL ON FUNCTION ${sig} FROM anon;`),
      `anon not revoked for ${sig}`,
    );
    assert(
      FLAT.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`),
      `authenticated grant missing for ${sig}`,
    );
  }
  assert(
    !FLAT.includes("TO service_role"),
    "no service-role business-execution grant may be added",
  );
  assert(!FLAT.includes("TO anon;"), "anon must never be granted");
  // Governance comments identify the step, capability and canonical command.
  assert(
    RAW.includes(
      "API-M.10A explicit transactional wrapper. Capability tasks:create. Canonical command public.apply_task_create only.",
    ) &&
      RAW.includes(
        "API-M.10A explicit transactional wrapper. Capability tasks:update. Canonical command public.apply_task_update only.",
      ),
    "wrapper comments must identify step, capability and canonical command",
  );
});

Deno.test("no generic dispatch, dynamic SQL or wrapper business mutation", () => {
  for (
    const forbidden of [
      "EXECUTE format",
      "EXECUTE '",
      "regprocedure",
      "quote_ident",
      "INSERT INTO public.tasks",
      "UPDATE public.tasks",
      "DELETE FROM public.tasks",
      "INSERT INTO public.phases",
      "UPDATE public.phases",
      "UPDATE public.projects",
      "pmg_record_command_audit",
      "pmg_build_result",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `forbidden construct present: ${forbidden}`);
  }
});

Deno.test("central API-F allowlist still approves the two API-M.10A wrappers", async () => {
  const guard = await Deno.readTextFile(
    "supabase/edge-tests/_shared/api-f-3-database-execution-wrapper_static_test.ts",
  );
  const start = guard.indexOf("const APPROVED_IDEMPOTENCY_WRAPPERS = new Set([");
  assert(start > 0, "approved wrapper allowlist not found");
  const end = guard.indexOf("]);", start);
  const block = guard.slice(start, end);
  const names = [...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
  for (const expected of ["api_v1_create_task", "api_v1_update_task"]) {
    assert(names.includes(expected), `allowlist missing ${expected}`);
  }
  // Exact-name allowlist only: no prefix/wildcard/regex weakening.
  assert(
    guard.includes("APPROVED_IDEMPOTENCY_WRAPPERS.has(fn.name.toLowerCase())"),
    "allowlist must remain an exact-name membership check",
  );
});
