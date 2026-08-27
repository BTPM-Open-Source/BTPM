// API-M.10C — Task assignment and execution transition transactional API wrappers.
//
// Permanent repository static contract guard. Locates the API-M.10C migration by
// its unique marker and asserts, from committed source only:
//   - exactly two wrapper definitions exist (assign + transition) with exact signatures;
//   - both RETURN jsonb, are SECURITY DEFINER with a hardened search path;
//   - assign hardcodes only tasks:assign, transition hardcodes only tasks:transition;
//   - no caller-supplied capability/scope/command/function/RPC/table/SQL parameter;
//   - both derive scope from the target Task -> canonical Project before authorization;
//   - trusted context and exact Project Connected App enablement precede API-F;
//   - assignment has no expectedUpdatedAt and no concurrency token;
//   - assignment failed replay recognizes exactly not_authorized|invalid;
//   - exactly one apply_task_assignee_set and no direct set_task_assignee;
//   - transition requires expectedUpdatedAt and preserves explicit start/end flags;
//   - nullable status conversion is exception-safe and bounded to invalid;
//   - exactly one apply_task_execution_change; stale conflict is exactly stale_task;
//   - transition failed replay recognizes exactly stale_task|not_authorized|invalid;
//   - no current timestamp is persisted or exposed for a stale transition;
//   - TOCTOU Task locks occur after the execute claim and before the canonical call;
//   - structural drift fails idempotency as not_authorized;
//   - no business-table DML, no narrative read and no decryption;
//   - PUBLIC/anon revoked, only authenticated granted, no service-role grant;
//   - canonical assumptions are cross-checked against the accepted M.9A migration;
//   - the M.10C wrappers remain approved in the central API-F allowlist
//     (the central API-F guard owns the current exact global wrapper count).

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER =
  "API-M.10C — Task assignment and execution transition transactional API wrappers";
const CANONICAL_TASK_PMG_MARKER =
  "API-M.9A — Task PMG exact-capability external readiness";

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

const CANONICAL_RAW = await requireMigrationByMarker(CANONICAL_TASK_PMG_MARKER);
const CANONICAL_FLAT = CANONICAL_RAW.replace(/\s+/g, " ");

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const ASSIGN_SIG =
  "CREATE OR REPLACE FUNCTION public.api_v1_assign_task( _expected_oauth_client_id text, _task_id uuid, _assignee_id uuid, _request_id text, _correlation_id text, _idempotency_key text, _payload_hash text ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'";

const TRANSITION_SIG =
  "CREATE OR REPLACE FUNCTION public.api_v1_transition_task( _expected_oauth_client_id text, _task_id uuid, _expected_updated_at timestamptz, _set_actual_start boolean, _actual_start_date date, _set_actual_end boolean, _actual_end_date date, _status text, _request_id text, _correlation_id text, _idempotency_key text, _payload_hash text ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'";

const assignStart = FLAT.indexOf(
  "CREATE OR REPLACE FUNCTION public.api_v1_assign_task(",
);
const transitionStart = FLAT.indexOf(
  "CREATE OR REPLACE FUNCTION public.api_v1_transition_task(",
);
assert(assignStart >= 0, "assign wrapper definition not found");
assert(
  transitionStart > assignStart,
  "transition wrapper must follow assign wrapper",
);
const ASSIGN_BODY = FLAT.slice(assignStart, transitionStart);
const TRANSITION_BODY = FLAT.slice(transitionStart);

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

Deno.test("M.10C defines exactly the two Task wrappers with exact signatures", () => {
  assert(FLAT.includes(ASSIGN_SIG), "exact assign signature missing");
  assert(FLAT.includes(TRANSITION_SIG), "exact transition signature missing");
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
  for (
    const forbidden of [
      "api_v1_create_task",
      "api_v1_update_task",
      "api_v1_reorder_tasks",
      "api_v1_plan_task",
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
    assert(
      !FLAT.includes(forbidden),
      `out-of-scope wrapper present: ${forbidden}`,
    );
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
    assert(
      !FLAT.includes(forbidden),
      `unexpected out-of-scope SQL: ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Fixed capability identity, no generic dispatch
// ---------------------------------------------------------------------------

Deno.test("each wrapper carries exactly one hardcoded capability identity", () => {
  assert(
    countOf(ASSIGN_BODY, "c_capability_key constant text := 'tasks:assign';") ===
      1,
    "assign must hardcode tasks:assign once",
  );
  assert(
    countOf(
      TRANSITION_BODY,
      "c_capability_key constant text := 'tasks:transition';",
    ) === 1,
    "transition must hardcode tasks:transition once",
  );
  assert(
    !ASSIGN_BODY.includes("tasks:transition"),
    "assign must not reference tasks:transition",
  );
  assert(
    !TRANSITION_BODY.includes("tasks:assign"),
    "transition must not reference tasks:assign",
  );
  for (const body of [ASSIGN_BODY, TRANSITION_BODY]) {
    for (
      const other of [
        "tasks:create",
        "tasks:update",
        "tasks:reorder",
        "tasks:plan",
        "phases:",
        "risks:",
        "blockers:",
      ]
    ) {
      assert(!body.includes(other), `unexpected capability reference: ${other}`);
    }
    assert(
      countOf(body, "c_api_version constant text := 'v1';") === 1 &&
        countOf(body, "c_capability_kind constant text := 'command';") === 1,
      "each wrapper must fix api_version v1 and capability_kind command",
    );
  }
});

Deno.test("no generic dispatch and no caller-selected scope or command", () => {
  for (
    const forbidden of [
      "EXECUTE '",
      "EXECUTE format",
      "EXECUTE v_",
      "format(",
      "regprocedure",
      "quote_ident",
      "quote_literal",
      "_function_name",
      "_command_name",
      "_rpc",
      "_sql",
      "_table_name",
      "_capability_key text",
      "CASE WHEN _command",
    ]
  ) {
    assert(
      !FLAT.includes(forbidden),
      `generic or caller-supplied construct present: ${forbidden}`,
    );
  }
  // No caller-supplied Tenant/Organization/Workspace/Project parameter exists.
  for (const sig of [ASSIGN_SIG, TRANSITION_SIG]) {
    for (
      const param of [
        "_tenant_id",
        "_organization_id",
        "_workspace_id",
        "_project_id",
        "_phase_id",
      ]
    ) {
      assert(
        !sig.includes(param),
        `caller-supplied scope parameter present: ${param}`,
      );
    }
  }
  // Signatures accept no scope or capability parameters at all.
  assert(
    !ASSIGN_SIG.includes("organization") && !ASSIGN_SIG.includes("workspace") &&
      !ASSIGN_SIG.includes("project"),
    "assign signature must not accept caller scope",
  );
  assert(
    !TRANSITION_SIG.includes("organization") &&
      !TRANSITION_SIG.includes("workspace") &&
      !TRANSITION_SIG.includes("project"),
    "transition signature must not accept caller scope",
  );
});

// ---------------------------------------------------------------------------
// Target-derived scope, trusted context, Project enablement ordering
// ---------------------------------------------------------------------------

Deno.test("both wrappers derive Project containment from the target Task before authorization", () => {
  for (const [name, body] of [
    ["assign", ASSIGN_BODY],
    ["transition", TRANSITION_BODY],
  ] as const) {
    const taskRead = body.indexOf("FROM public.tasks t WHERE t.id = _task_id");
    const projectRead = body.indexOf("FROM public.projects p WHERE p.id =");
    const establish = body.indexOf(
      "api_e_private.authorize_and_establish(",
    );
    assert(taskRead > 0, `${name}: target Task structural read missing`);
    assert(projectRead > taskRead, `${name}: canonical Project read missing`);
    assert(
      establish > projectRead,
      `${name}: authorization must follow target-derived scope`,
    );
    assert(
      countOf(body, "api_e_private.authorize_and_establish(") === 1,
      `${name}: exactly one authorize_and_establish call required`,
    );
    // Derived scope, not caller scope, is passed to authorization.
    assert(
      body.includes(
        "api_e_private.authorize_and_establish( _expected_oauth_client_id, v_organization_id, v_workspace_id, c_api_version, c_capability_kind, c_capability_key, _request_id )",
      ),
      `${name}: authorization must use derived organization/workspace`,
    );
    // Structural Workspace/Organization identity must match the Project.
    assert(
      body.includes("v_workspace_id IS DISTINCT FROM v_row_workspace_id") &&
        body.includes(
          "v_organization_id IS DISTINCT FROM v_row_organization_id",
        ),
      `${name}: stored Task scope must match the canonical Project`,
    );
  }
});

Deno.test("trusted context and exact Project enablement are verified before API-F", () => {
  for (const [name, body] of [
    ["assign", ASSIGN_BODY],
    ["transition", TRANSITION_BODY],
  ] as const) {
    for (
      const setting of [
        "api_e.api_client_id",
        "api_e.tenant_id",
        "api_e.organization_id",
        "api_e.workspace_id",
      ]
    ) {
      assert(
        body.includes(`current_setting('${setting}', true)`),
        `${name}: trusted context ${setting} must be re-read`,
      );
    }
    const recheck = body.indexOf("current_setting('api_e.api_client_id'");
    const enablement = body.indexOf(
      "FROM public.api_project_client_enablements e",
    );
    const claim = body.indexOf("api_e_private.claim_idempotency(");
    assert(recheck > 0 && enablement > recheck, `${name}: enablement ordering`);
    assert(claim > enablement, `${name}: enablement must precede API-F claim`);
    assert(
      body.includes("e.project_id = v_project_id") &&
        body.includes("e.api_client_id = v_ctx_client_id") &&
        body.includes("e.tenant_id = v_ctx_tenant_id") &&
        body.includes("e.organization_id = v_organization_id") &&
        body.includes("e.workspace_id = v_workspace_id") &&
        body.includes("e.lifecycle_status = 'enabled'") &&
        body.includes("e.enabled_at IS NOT NULL") &&
        body.includes("e.disabled_at IS NULL"),
      `${name}: exact enabled Project Connected App row required`,
    );
    assert(
      body.includes(
        "api_e_private.claim_idempotency(c_capability_key, _idempotency_key, _payload_hash)",
      ),
      `${name}: API-F claim must use the fixed capability constant`,
    );
  }
});

// ---------------------------------------------------------------------------
// Assignment specifics
// ---------------------------------------------------------------------------

Deno.test("assignment has no expectedUpdatedAt and introduces no concurrency", () => {
  assert(
    !ASSIGN_SIG.includes("_expected_updated_at"),
    "assign signature must not accept an expectedUpdatedAt",
  );
  assert(
    !ASSIGN_BODY.includes("_expected_updated_at") &&
      !ASSIGN_BODY.includes("updated_at"),
    "assign must not reference any concurrency token",
  );
  for (
    const forbidden of [
      "stale_task",
      "stale_task_order",
      "stale_task_planning",
      "'outcome', 'conflict'",
      "v_pmg_status = 'conflict'",
      "confirmation_required",
    ]
  ) {
    assert(
      !ASSIGN_BODY.includes(forbidden),
      `assign must have no conflict/confirmation path: ${forbidden}`,
    );
  }
  // Nullable assignee is preserved: NULL clears the assignment.
  assert(
    ASSIGN_SIG.includes("_assignee_id uuid,"),
    "assign must accept a nullable assignee",
  );
  assert(
    !ASSIGN_BODY.includes("_assignee_id IS NULL OR") &&
      !ASSIGN_BODY.includes("OR _assignee_id IS NULL"),
    "assign must not reject a NULL assignee",
  );
});

Deno.test("assignment failed replay recognizes exactly not_authorized and invalid", () => {
  const failed = ASSIGN_BODY.slice(
    ASSIGN_BODY.indexOf("v_claim.registry_state = 'failed'"),
    ASSIGN_BODY.indexOf("unexpected replay state"),
  );
  const codes = [...failed.matchAll(/v_claim\.failure_code = '([a-z_]+)'/g)].map(
    (m) => m[1],
  ).sort();
  assert(
    JSON.stringify(codes) === JSON.stringify(["invalid", "not_authorized"]),
    `unexpected assign replay codes: ${codes.join(",")}`,
  );
  assert(
    ASSIGN_BODY.includes("idempotency_conflict") &&
      ASSIGN_BODY.includes("idempotency_pending") &&
      ASSIGN_BODY.includes("unknown persisted failure code"),
    "assign must handle the standard claim decisions and fail closed",
  );
});

Deno.test("assignment invokes exactly one canonical command and never set_task_assignee", () => {
  assert(
    countOf(
      ASSIGN_BODY,
      "v_pmg := public.apply_task_assignee_set( _task_id, _assignee_id, _correlation_id, _idempotency_key );",
    ) === 1,
    "assign must call apply_task_assignee_set exactly once with fixed arguments",
  );
  assert(
    countOf(ASSIGN_BODY, "public.apply_task_assignee_set(") === 1,
    "exactly one canonical assignment invocation allowed",
  );
  assert(
    !ASSIGN_BODY.includes("set_task_assignee("),
    "assign must never call set_task_assignee directly",
  );
  for (
    const forbidden of [
      "is_workspace_member",
      "has_project_pm_authority",
      "can_write_demo",
      "task_assignments",
    ]
  ) {
    assert(
      !ASSIGN_BODY.includes(forbidden),
      `assign must not reproduce canonical logic: ${forbidden}`,
    );
  }
});

Deno.test("assignment returns a bounded structural result without Workspace exposure", () => {
  assert(
    ASSIGN_BODY.includes("'ok', true, 'outcome', v_pmg_status, 'taskId'") &&
      ASSIGN_BODY.includes("'projectId', v_project_id") &&
      ASSIGN_BODY.includes("'oldAssigneeId', v_old_assignee") &&
      ASSIGN_BODY.includes("'newAssigneeId', v_new_assignee"),
    "assign success shape must be exactly the bounded structural object",
  );
  assert(
    !ASSIGN_BODY.includes("'workspaceId'"),
    "assign must never expose the Workspace ID",
  );
  assert(
    ASSIGN_BODY.includes("v_pmg_status IN ('applied','no_change')"),
    "assign must accept only applied and no_change",
  );
  assert(
    ASSIGN_BODY.includes("(v_data ->> 'task_id') IS DISTINCT FROM _task_id::text"),
    "assign must validate the canonical task_id",
  );
  assert(
    ASSIGN_BODY.includes(
      "v_pmg_status = 'applied' AND ((v_data ->> 'project_id') IS DISTINCT FROM v_project_id::text)",
    ),
    "assign must validate applied Project identity against derived Project",
  );
  assert(
    ASSIGN_BODY.includes("v_new_assignee IS DISTINCT FROM _assignee_id"),
    "assign must require the canonical new assignee to match the request, including NULL",
  );
  assert(
    ASSIGN_BODY.includes("::uuid") &&
      ASSIGN_BODY.includes("malformed canonical assignee identity"),
    "assign must validate non-null assignee identifiers as UUIDs",
  );
  assert(
    ASSIGN_BODY.includes(
      "api_e_private.fail_idempotency(v_claim.registry_id, 'not_authorized')",
    ) &&
      ASSIGN_BODY.includes(
        "api_e_private.fail_idempotency(v_claim.registry_id, 'invalid')",
      ),
    "assign must persist the matching safe failure code",
  );
  assert(
    countOf(ASSIGN_BODY, "api_e_private.complete_idempotency(") === 1,
    "assign must complete idempotency exactly once",
  );
});

// ---------------------------------------------------------------------------
// Transition specifics
// ---------------------------------------------------------------------------

Deno.test("transition requires expectedUpdatedAt and preserves explicit flags", () => {
  assert(
    TRANSITION_SIG.includes("_expected_updated_at timestamptz"),
    "transition must accept expectedUpdatedAt",
  );
  assert(
    TRANSITION_BODY.includes("_expected_updated_at IS NULL") &&
      TRANSITION_BODY.includes("_set_actual_start IS NULL") &&
      TRANSITION_BODY.includes("_set_actual_end IS NULL"),
    "transition must require expectedUpdatedAt and both non-null set flags",
  );
  assert(
    TRANSITION_SIG.includes("_set_actual_start boolean") &&
      TRANSITION_SIG.includes("_set_actual_end boolean"),
    "explicit actual-start/actual-end flags must be preserved",
  );
});

Deno.test("transition status conversion is nullable and exception-safe", () => {
  assert(
    TRANSITION_SIG.includes("_status text"),
    "transition must accept status as external text",
  );
  assert(
    TRANSITION_BODY.includes(
      "v_status_text text := nullif(btrim(coalesce(_status,'')),'');",
    ),
    "transition must normalize the optional status text",
  );
  assert(
    TRANSITION_BODY.includes(
      "IF v_status_text IS NOT NULL THEN BEGIN v_status := v_status_text::public.pm_status; EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'outcome', 'invalid'); END; END IF;",
    ),
    "transition must convert status exception-safely to a bounded invalid",
  );
  // The allowed-status business rule stays in the canonical command.
  assert(
    !TRANSITION_BODY.includes("'completed'::public.pm_status") &&
      !TRANSITION_BODY.includes("'active'::public.pm_status") &&
      !TRANSITION_BODY.includes("status_not_allowed") &&
      !TRANSITION_BODY.includes("reopen_task"),
    "transition must not reproduce allowed-status or reopen semantics",
  );
});

Deno.test("transition invokes exactly one canonical command with fixed arguments", () => {
  assert(
    countOf(
      TRANSITION_BODY,
      "v_pmg := public.apply_task_execution_change( _task_id, _expected_updated_at, _set_actual_start, _actual_start_date, _set_actual_end, _actual_end_date, v_status, _correlation_id, _idempotency_key );",
    ) === 1,
    "transition must call apply_task_execution_change exactly once with fixed arguments",
  );
  assert(
    countOf(TRANSITION_BODY, "public.apply_task_execution_change(") === 1,
    "exactly one canonical execution invocation allowed",
  );
  for (
    const forbidden of [
      "apply_task_planning_change",
      "apply_task_assignee_set",
      "apply_task_create",
      "apply_task_update",
      "reorder_tasks",
      "reopen_task",
      "preview_",
    ]
  ) {
    assert(
      !TRANSITION_BODY.includes(forbidden),
      `transition must not invoke ${forbidden}`,
    );
  }
});

Deno.test("transition stale conflict is exactly stale_task and exposes no timestamp", () => {
  assert(
    TRANSITION_BODY.includes(
      "(v_data ->> 'code') IS DISTINCT FROM 'stale_task'",
    ),
    "transition must require the exact stale_task code from the canonical data object",
  );
  assert(
    TRANSITION_BODY.includes(
      "api_e_private.fail_idempotency(v_claim.registry_id, 'stale_task')",
    ),
    "transition must persist only the stable stale_task code",
  );
  assert(
    TRANSITION_BODY.includes(
      "'ok', false, 'outcome', 'conflict', 'code', 'stale_task'",
    ),
    "direct stale response must remain bounded",
  );
  assert(
    !TRANSITION_BODY.includes("current_updated_at") &&
      !TRANSITION_BODY.includes("'currentUpdatedAt'"),
    "transition must never persist or expose the current timestamp for a stale conflict",
  );
  assert(
    !TRANSITION_BODY.includes("confirmation_required"),
    "transition has no confirmation path",
  );
});

Deno.test("transition failed replay recognizes exactly stale_task, not_authorized and invalid", () => {
  const failed = TRANSITION_BODY.slice(
    TRANSITION_BODY.indexOf("v_claim.registry_state = 'failed'"),
    TRANSITION_BODY.indexOf("unexpected replay state"),
  );
  const codes = [...failed.matchAll(/v_claim\.failure_code = '([a-z_]+)'/g)].map(
    (m) => m[1],
  ).sort();
  assert(
    JSON.stringify(codes) ===
      JSON.stringify(["invalid", "not_authorized", "stale_task"]),
    `unexpected transition replay codes: ${codes.join(",")}`,
  );
  assert(
    failed.includes("'ok', false, 'outcome', 'conflict', 'code', 'stale_task'"),
    "replayed stale response must match the direct bounded stale response",
  );
});

Deno.test("transition returns the bounded structural success mapping", () => {
  assert(
    TRANSITION_BODY.includes("v_pmg_status IN ('applied','no_change')"),
    "transition must accept only applied and no_change",
  );
  for (
    const check of [
      "(v_data ->> 'id') IS DISTINCT FROM _task_id::text",
      "(v_data ->> 'project_id') IS DISTINCT FROM v_project_id::text",
      "(v_data ->> 'phase_id') IS DISTINCT FROM v_row_phase_id::text",
      "v_data ->> 'status'",
      "v_data ->> 'updated_at'",
    ]
  ) {
    assert(
      TRANSITION_BODY.includes(check),
      `transition must validate canonical field: ${check}`,
    );
  }
  for (
    const field of [
      "'taskId', _task_id",
      "'projectId', v_project_id",
      "'phaseId', v_row_phase_id",
      "'status', (v_data ->> 'status')",
      "'actualStartDate', (v_data ->> 'actual_start_date')",
      "'actualEndDate', (v_data ->> 'actual_end_date')",
      "'updatedAt', (v_data ->> 'updated_at')",
    ]
  ) {
    assert(
      TRANSITION_BODY.includes(field),
      `transition success mapping missing: ${field}`,
    );
  }
  assert(
    TRANSITION_BODY.includes("unexpected canonical command status"),
    "transition must fail internally on any unexpected canonical status",
  );
  assert(
    countOf(TRANSITION_BODY, "api_e_private.complete_idempotency(") === 1,
    "transition must complete idempotency exactly once",
  );
});

// ---------------------------------------------------------------------------
// TOCTOU and structural drift
// ---------------------------------------------------------------------------

Deno.test("TOCTOU Task locks occur after the execute claim and before the canonical command", () => {
  for (const [name, body, canonical] of [
    ["assign", ASSIGN_BODY, "public.apply_task_assignee_set("],
    ["transition", TRANSITION_BODY, "public.apply_task_execution_change("],
  ] as const) {
    const claim = body.indexOf("api_e_private.claim_idempotency(");
    const executeGate = body.indexOf("v_claim.decision <> 'execute'");
    const lock = body.indexOf("WHERE t.id = _task_id FOR UPDATE");
    const call = body.indexOf(canonical);
    assert(claim > 0, `${name}: claim missing`);
    assert(executeGate > claim, `${name}: execute gate must follow the claim`);
    assert(lock > executeGate, `${name}: Task lock must follow the execute claim`);
    assert(call > lock, `${name}: canonical command must follow the Task lock`);
    assert(
      countOf(body, "FOR UPDATE") === 1,
      `${name}: exactly one structural lock expected`,
    );
  }
  // Transition re-confirms the full structure, including Phase.
  assert(
    TRANSITION_BODY.includes("v_locked_phase_id IS DISTINCT FROM v_row_phase_id"),
    "transition must re-confirm the Phase after locking",
  );
});

Deno.test("structural drift fails idempotency as not_authorized without invoking the canonical command", () => {
  for (const [name, body] of [
    ["assign", ASSIGN_BODY],
    ["transition", TRANSITION_BODY],
  ] as const) {
    const lock = body.indexOf("WHERE t.id = _task_id FOR UPDATE");
    const drift = body.indexOf(
      "api_e_private.fail_idempotency(v_claim.registry_id, 'not_authorized')",
      lock,
    );
    const call = body.indexOf(
      name === "assign"
        ? "public.apply_task_assignee_set("
        : "public.apply_task_execution_change(",
    );
    assert(drift > lock, `${name}: drift handling must follow the lock`);
    assert(drift < call, `${name}: drift must fail before the canonical command`);
    assert(
      body.includes("v_locked_project_id IS DISTINCT FROM v_project_id") &&
        body.includes("v_locked_workspace_id IS DISTINCT FROM v_workspace_id") &&
        body.includes(
          "v_locked_organization_id IS DISTINCT FROM v_organization_id",
        ),
      `${name}: locked structural scope must be re-confirmed`,
    );
  }
});

// ---------------------------------------------------------------------------
// Protected-data boundary and grants
// ---------------------------------------------------------------------------

Deno.test("no business-table DML, narrative read or decryption in either wrapper", () => {
  for (
    const forbidden of [
      "UPDATE public.tasks",
      "INSERT INTO public.tasks",
      "DELETE FROM public.tasks",
      "UPDATE public.task_assignments",
      "INSERT INTO public.task_assignments",
      "DELETE FROM public.task_assignments",
      "UPDATE public.projects",
      "UPDATE public.phases",
      "pgp_sym_decrypt",
      "pgp_sym_encrypt",
      "decrypt",
      "get_decrypted_task",
      "t.name",
      "t.description",
      "'name'",
      "'description'",
      "SET LOCAL ROLE",
      "service_role",
    ]
  ) {
    assert(
      !FLAT.includes(forbidden),
      `protected-data or DML boundary violated: ${forbidden}`,
    );
  }
  // Only structural Task columns are ever selected.
  const selects = [...FLAT.matchAll(/SELECT ([^;]*?) INTO/g)].map((m) => m[1]);
  for (const s of selects) {
    for (const col of ["name", "description", "notes"]) {
      assert(
        !s.includes(`.${col}`),
        `narrative column selected in wrapper: ${col}`,
      );
    }
  }
});

Deno.test("grants revoke PUBLIC and anon and grant only authenticated", () => {
  for (const fn of ["api_v1_assign_task", "api_v1_transition_task"]) {
    assert(
      FLAT.includes(`REVOKE ALL ON FUNCTION public.${fn}(`) &&
        FLAT.includes(`GRANT EXECUTE ON FUNCTION public.${fn}(`),
      `${fn}: grant block missing`,
    );
  }
  assert(
    countOf(FLAT, "FROM PUBLIC;") === 2 && countOf(FLAT, "FROM anon;") === 2,
    "both wrappers must revoke PUBLIC and anon",
  );
  assert(
    countOf(FLAT, "TO authenticated;") === 2,
    "both wrappers must grant execute only to authenticated",
  );
  assert(
    !FLAT.includes("TO service_role"),
    "no service-role business-execution grant is permitted",
  );
  assert(
    RAW.includes("API-M.10C explicit transactional wrapper. Capability tasks:assign. Canonical command public.apply_task_assignee_set only.") &&
      RAW.includes(
        "API-M.10C explicit transactional wrapper. Capability tasks:transition. Canonical command public.apply_task_execution_change only.",
      ),
    "comments must identify API-M.10C, the capability and the canonical command",
  );
});

// ---------------------------------------------------------------------------
// Cross-checks against the accepted API-M.9A canonical migration
// ---------------------------------------------------------------------------

Deno.test("M.9A cross-check: canonical assignment signature and semantics", () => {
  assert(
    CANONICAL_FLAT.includes(
      "CREATE OR REPLACE FUNCTION public.apply_task_assignee_set( _task_id uuid, _assignee_id uuid DEFAULT NULL, _correlation_id text DEFAULT NULL, _idempotency_key text DEFAULT NULL )",
    ),
    "M.9A assignment signature drifted from the wrapper's fixed call",
  );
  assert(
    CANONICAL_FLAT.includes("current_setting('api_e.capability_key', true)") &&
      CANONICAL_FLAT.includes("<> 'tasks:assign'"),
    "M.9A assignment must require the exact tasks:assign capability",
  );
  // The canonical command owns eligibility and the single delegated mutation.
  assert(
    CANONICAL_FLAT.includes(
      "public.is_workspace_member(_assignee_id, v_workspace_id)",
    ) && CANONICAL_FLAT.includes("PERFORM public.set_task_assignee(_task_id, _assignee_id);"),
    "M.9A assignment must retain eligibility and the delegated set_task_assignee call",
  );
  // Canonical data keys relied upon by the wrapper.
  for (
    const key of ["'task_id', _task_id", "'old_assignee_id'", "'new_assignee_id'"]
  ) {
    assert(
      CANONICAL_FLAT.includes(key),
      `M.9A assignment data key missing: ${key}`,
    );
  }
  // Assignment has no concurrency token in the canonical command either.
  assert(
    !CANONICAL_FLAT.includes(
      "apply_task_assignee_set( _task_id uuid, _expected_updated_at",
    ),
    "M.9A assignment must not have gained a concurrency token",
  );
});

Deno.test("M.9A cross-check: canonical execution transition signature and stale location", () => {
  assert(
    CANONICAL_FLAT.includes(
      "CREATE OR REPLACE FUNCTION public.apply_task_execution_change( _task_id uuid, _expected_updated_at timestamptz, _set_actual_start boolean DEFAULT false, _actual_start_date date DEFAULT NULL, _set_actual_end boolean DEFAULT false, _actual_end_date date DEFAULT NULL, _status public.pm_status DEFAULT NULL, _correlation_id text DEFAULT NULL, _idempotency_key text DEFAULT NULL )",
    ),
    "M.9A execution signature drifted from the wrapper's fixed call",
  );
  assert(
    CANONICAL_FLAT.includes("<> 'tasks:transition'"),
    "M.9A execution must require the exact tasks:transition capability",
  );
  // Stale conflict is reported in the canonical data object as stale_task.
  assert(
    CANONICAL_FLAT.includes(
      "jsonb_build_object( 'code', 'stale_task', 'current_updated_at', v_task.updated_at )",
    ),
    "M.9A stale_task conflict location drifted",
  );
  // Explicit flag semantics and allowed statuses stay canonical.
  assert(
    CANONICAL_FLAT.includes("IF _set_actual_start THEN") &&
      CANONICAL_FLAT.includes("IF _set_actual_end THEN") &&
      CANONICAL_FLAT.includes("'status_not_allowed'"),
    "M.9A explicit flag and allowed-status ownership drifted",
  );
  // Canonical success keys relied upon by the wrapper.
  for (
    const key of [
      "'id', v_updated.id",
      "'project_id', v_updated.project_id",
      "'phase_id', v_updated.phase_id",
      "'status', v_updated.status",
      "'actual_start_date', v_updated.actual_start_date",
      "'actual_end_date', v_updated.actual_end_date",
      "'updated_at', v_updated.updated_at",
    ]
  ) {
    assert(
      CANONICAL_FLAT.includes(key),
      `M.9A execution data key missing: ${key}`,
    );
  }
});

// ---------------------------------------------------------------------------
// API-F permanent guard
// ---------------------------------------------------------------------------

Deno.test("central API-F allowlist still approves the two API-M.10C wrappers", async () => {
  const guard = await Deno.readTextFile(
    "supabase/edge-tests/_shared/api-f-3-database-execution-wrapper_static_test.ts",
  );
  const start = guard.indexOf("const APPROVED_IDEMPOTENCY_WRAPPERS = new Set([");
  assert(start > 0, "approved wrapper allowlist not found");
  const end = guard.indexOf("]);", start);
  const block = guard.slice(start, end);
  const names = [...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
  assert(
    names.includes("api_v1_assign_task") &&
      names.includes("api_v1_transition_task"),
    "both API-M.10C wrappers must be approved",
  );
  // Exact-name membership detector must remain unchanged.
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
