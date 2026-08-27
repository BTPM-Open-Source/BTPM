// API-M.7B — Phase reorder and planning transactional API wrappers.
//
// Focused repository static contract test. Locates the API-M.7B migration by its
// unique marker and asserts, from committed source only:
//   - exactly two wrapper definitions exist (reorder + plan), with exact typed signatures;
//   - both RETURN jsonb, are SECURITY DEFINER with a hardened search path;
//   - reorder hardcodes only phases:reorder, plan hardcodes only phases:plan;
//   - no caller-supplied capability/scope/command/function/RPC/table/SQL parameter,
//     and the only jsonb parameter is the bounded reorder collection _rows;
//   - plan mandates _expected_updated_at (optimistic concurrency is never optional);
//   - authoritative scope derivation happens before authorize_and_establish;
//   - plan derives Phase -> Project scope and enforces consistency;
//   - authorize_and_establish is called exactly once per wrapper; no authorize_project_scope;
//   - trusted Organization/Workspace context is compared to derived scope;
//   - explicit Project Connected App enablement occurs before idempotency;
//   - the API-F claim uses the exact fixed capability constant;
//   - conflict/pending/replay branches never call a canonical Phase command;
//   - reorder calls exactly one reorder_phases, plan exactly one 5-argument
//     apply_phase_planning_change, and neither calls a create/update command;
//   - the plan execute branch locks and re-confirms Phase scope (TOCTOU);
//   - external results are structural, narrative-free and never decrypt;
//   - reorder conflict persists only stale_phase_order; plan only stale_phase_planning;
//   - plan confirmation_required is bounded and never widens the Project itself;
//   - idempotency completion happens only after safe result construction;
//   - PUBLIC/anon are revoked, only authenticated is granted, no service-role grant;
//   - no dynamic SQL, generic dispatcher, or business-table write is introduced.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER =
  "API-M.7B — Phase reorder and planning transactional API wrappers";

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

const REORDER_SIG =
  "CREATE OR REPLACE FUNCTION public.api_v1_reorder_phases( _expected_oauth_client_id text, _project_id uuid, _rows jsonb, _request_id text, _correlation_id text, _idempotency_key text, _payload_hash text ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'";

const PLAN_SIG =
  "CREATE OR REPLACE FUNCTION public.api_v1_plan_phase( _expected_oauth_client_id text, _phase_id uuid, _expected_updated_at timestamptz, _new_start date, _new_end date, _confirm_parent_extension boolean, _request_id text, _correlation_id text, _idempotency_key text, _payload_hash text ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'";

// Per-wrapper bodies for scoped assertions.
const reorderStart = FLAT.indexOf(
  "CREATE OR REPLACE FUNCTION public.api_v1_reorder_phases(",
);
const planStart = FLAT.indexOf(
  "CREATE OR REPLACE FUNCTION public.api_v1_plan_phase(",
);
assert(reorderStart >= 0, "reorder wrapper definition not found");
assert(planStart > reorderStart, "plan wrapper must follow reorder wrapper");
const REORDER_BODY = FLAT.slice(reorderStart, planStart);
const PLAN_BODY = FLAT.slice(planStart);

Deno.test("M.7B defines exactly the two Phase wrappers with exact signatures", () => {
  assert(FLAT.includes(REORDER_SIG), "exact reorder signature missing");
  assert(FLAT.includes(PLAN_SIG), "exact plan signature missing");
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
      "CREATE TABLE",
      "ALTER TABLE",
      "CREATE TYPE",
      "ALTER TYPE",
      "CREATE POLICY",
      "DROP POLICY",
      "CREATE SCHEMA",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `unexpected DDL: ${forbidden}`);
  }
});

Deno.test("each wrapper carries exactly one hardcoded capability identity", () => {
  assert(
    countOf(
      REORDER_BODY,
      "c_capability_key constant text := 'phases:reorder';",
    ) === 1,
    "reorder must hardcode phases:reorder once",
  );
  assert(
    !REORDER_BODY.includes("'phases:plan'") &&
      !REORDER_BODY.includes("'phases:create'") &&
      !REORDER_BODY.includes("'phases:update'"),
    "reorder must not reference any other Phase capability",
  );
  assert(
    countOf(PLAN_BODY, "c_capability_key constant text := 'phases:plan';") === 1,
    "plan must hardcode phases:plan once",
  );
  assert(
    !PLAN_BODY.includes("'phases:reorder'") &&
      !PLAN_BODY.includes("'phases:create'") &&
      !PLAN_BODY.includes("'phases:update'"),
    "plan must not reference any other Phase capability",
  );
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
        "_tenant",
        "_organization",
        "_workspace",
        "_source_channel",
        "_command",
        "_function",
        "_rpc",
        "_table",
        "_sql",
        "_payload jsonb",
      ]
    ) {
      assert(
        !params.includes(forbidden),
        `forbidden wrapper parameter: ${forbidden}`,
      );
    }
  }
  // The only permitted jsonb input is the bounded reorder collection.
  assert(
    countOf(reorderParams, "jsonb") === 1 && reorderParams.includes("_rows jsonb"),
    "reorder may accept exactly one bounded jsonb collection parameter",
  );
  assert(!planParams.includes("jsonb"), "plan must not accept any jsonb payload");
  // Optimistic concurrency is mandatory for the planning route.
  assert(
    planParams.includes("_expected_updated_at timestamptz"),
    "plan must require an explicit concurrency token",
  );
  assert(
    PLAN_BODY.includes("_expected_updated_at IS NULL"),
    "plan must reject a missing concurrency token",
  );
});

Deno.test("authoritative scope derivation precedes authorization", () => {
  const reorderDerive = REORDER_BODY.indexOf(
    "FROM public.projects p WHERE p.id = _project_id",
  );
  const reorderAuth = REORDER_BODY.indexOf(
    "api_e_private.authorize_and_establish(",
  );
  assert(reorderDerive > 0, "reorder must derive scope from the Project row");
  assert(
    reorderDerive < reorderAuth,
    "reorder scope derivation must precede authorization",
  );

  const planPhaseRead = PLAN_BODY.indexOf(
    "FROM public.phases ph WHERE ph.id = _phase_id",
  );
  const planProjectRead = PLAN_BODY.indexOf(
    "FROM public.projects p WHERE p.id = v_row_project_id",
  );
  const planAuth = PLAN_BODY.indexOf("api_e_private.authorize_and_establish(");
  assert(
    planPhaseRead > 0 && planProjectRead > planPhaseRead,
    "plan must derive Phase -> parent Project scope",
  );
  assert(
    planProjectRead < planAuth,
    "plan scope derivation must precede authorization",
  );
  assert(
    PLAN_BODY.includes("v_workspace_id IS DISTINCT FROM v_row_workspace_id") &&
      PLAN_BODY.includes(
        "v_organization_id IS DISTINCT FROM v_row_organization_id",
      ),
    "plan must require stored Phase scope to match the parent Project",
  );
  for (const body of [REORDER_BODY, PLAN_BODY]) {
    assert(
      body.includes(`jsonb_build_object('ok', false, 'outcome', 'not_authorized')`),
      "unresolved scope must return a bounded not_authorized outcome",
    );
  }
});

Deno.test("authorize_and_establish is used exactly once and is the only mechanism", () => {
  for (const body of [REORDER_BODY, PLAN_BODY]) {
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

Deno.test("trusted context is verified against derived scope", () => {
  for (const body of [REORDER_BODY, PLAN_BODY]) {
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

Deno.test("explicit Project Connected App enablement precedes idempotency", () => {
  for (const body of [REORDER_BODY, PLAN_BODY]) {
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
});

Deno.test("API-F idempotency uses the exact fixed capability and fails closed", () => {
  for (const body of [REORDER_BODY, PLAN_BODY]) {
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
      body.includes("unexpected idempotency decision") &&
        body.includes("unknown persisted failure code") &&
        body.includes("unexpected replay state"),
      "unknown claim states must raise internal exceptions",
    );
    const claim = body.indexOf("api_e_private.claim_idempotency(");
    const canonical = body.indexOf(
      body === REORDER_BODY
        ? "public.reorder_phases("
        : "public.apply_phase_planning_change(",
    );
    assert(
      claim > 0 && canonical > 0 && claim < canonical,
      "canonical command must be invoked only after the claim decision",
    );
    const preCanonical = body.slice(0, canonical);
    assert(
      !preCanonical.includes("public.reorder_phases(") &&
        !preCanonical.includes("public.apply_phase_planning_change("),
      "no canonical mutation may occur in claim-decision branches",
    );
  }
});

Deno.test("each wrapper invokes exactly one canonical Phase command", () => {
  assert(
    countOf(REORDER_BODY, "public.reorder_phases(") === 1,
    "reorder must call reorder_phases exactly once",
  );
  assert(
    REORDER_BODY.includes(
      "public.reorder_phases( _project_id, _rows, _correlation_id, _idempotency_key )",
    ),
    "reorder must call the canonical command with its fixed argument list",
  );
  assert(
    !REORDER_BODY.includes("apply_phase_planning_change"),
    "reorder must not call the planning command",
  );
  assert(
    countOf(PLAN_BODY, "v_pmg := public.apply_phase_planning_change(") === 1,
    "plan must call apply_phase_planning_change exactly once",
  );
  // The 5-argument external overload only: the legacy 4-argument overload is banned.
  assert(
    PLAN_BODY.includes(
      "public.apply_phase_planning_change( _phase_id, _expected_updated_at, _new_start, _new_end, COALESCE(_confirm_parent_extension, false) )",
    ),
    "plan must call the concurrency-bearing 5-argument overload",
  );
  assert(
    !PLAN_BODY.includes("public.reorder_phases("),
    "plan must not call the reorder command",
  );
  for (
    const forbidden of [
      "apply_phase_create",
      "apply_phase_update",
      "preview_phase_planning_change",
      "preview_phase_timeline_action",
      "apply_phase_timeline_action",
      "apply_project_update",
      "_apply_project_extension_internal",
      "apply_task_planning_change",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `forbidden call present: ${forbidden}`);
  }
});

Deno.test("plan execution branch locks and re-confirms Phase scope", () => {
  const claim = PLAN_BODY.indexOf("api_e_private.claim_idempotency(");
  const lock = PLAN_BODY.indexOf(
    "FROM public.phases ph WHERE ph.id = _phase_id FOR UPDATE",
  );
  const canonical = PLAN_BODY.indexOf("public.apply_phase_planning_change(");
  assert(
    lock > claim && lock < canonical,
    "row lock must sit between claim and command",
  );
  assert(
    PLAN_BODY.includes("v_locked_project_id IS DISTINCT FROM v_row_project_id") &&
      PLAN_BODY.includes("v_locked_workspace_id IS DISTINCT FROM v_workspace_id") &&
      PLAN_BODY.includes(
        "v_locked_organization_id IS DISTINCT FROM v_organization_id",
      ),
    "locked scope must be re-confirmed against the authorized scope",
  );
  assert(
    PLAN_BODY.includes(
      "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'not_authorized'); RETURN jsonb_build_object('ok', false, 'outcome', 'not_authorized');",
    ),
    "scope drift must persist a bounded not_authorized failure",
  );
});

Deno.test("external results are bounded, structural and narrative-free", () => {
  for (const body of [REORDER_BODY, PLAN_BODY]) {
    assert(!body.includes("'name'"), "result must not include Phase name");
    assert(
      !body.includes("'description'"),
      "result must not include Phase description",
    );
    assert(!body.includes("btpm_decrypt"), "wrapper must not decrypt narrative");
  }
  assert(
    REORDER_BODY.includes(
      `'ok', true, 'outcome', v_pmg_status, 'projectId', v_project_id, 'submittedCount', (v_data -> 'submitted_count'), 'changedCount', (v_data -> 'changed_count'), 'orderedPhases', v_ordered`,
    ),
    "reorder applied/no_change result shape mismatch",
  );
  for (const key of ["'phaseId'", "'sortOrder'", "'updatedAt'"]) {
    assert(
      REORDER_BODY.includes(key),
      `reorder ordering key missing: ${key}`,
    );
  }
  assert(
    REORDER_BODY.includes("inconsistent canonical result") &&
      REORDER_BODY.includes("malformed canonical ordering"),
    "reorder must validate the canonical ordering payload",
  );
  assert(
    PLAN_BODY.includes(
      `'ok', true, 'outcome', v_pmg_status, 'phaseId', _phase_id, 'projectId', v_project_id, 'startDate', (v_data ->> 'start_date'), 'targetEndDate', (v_data ->> 'target_end_date'), 'updatedAt', (v_data ->> 'updated_at'), 'projectExtended', (v_data -> 'project_extended')`,
    ),
    "plan applied/no_change result shape mismatch",
  );
  for (const key of ["'projectStartDate'", "'projectTargetEndDate'"]) {
    assert(PLAN_BODY.includes(key), `plan result key missing: ${key}`);
  }
  for (const body of [REORDER_BODY, PLAN_BODY]) {
    assert(
      body.includes(`v_pmg_status IN ('applied','no_change')`),
      "both wrappers must accept applied and no_change",
    );
  }
});

Deno.test("plan confirmation_required is bounded and never widens the Project", () => {
  assert(
    PLAN_BODY.includes(`v_pmg_status = 'confirmation_required'`),
    "plan must handle confirmation_required",
  );
  for (
    const key of [
      `'code', 'extend_project_window_required'`,
      "'projectCurrentStart'",
      "'projectCurrentTargetEnd'",
      "'projectProposedStart'",
      "'projectProposedTargetEnd'",
      "'requestedPhaseStart'",
      "'requestedPhaseEnd'",
    ]
  ) {
    assert(PLAN_BODY.includes(key), `confirmation key missing: ${key}`);
  }
  assert(
    PLAN_BODY.includes("unexpected confirmation payload"),
    "unexpected confirmation payloads must fail closed",
  );
  assert(
    !REORDER_BODY.includes("confirmation_required"),
    "reorder has no confirmation semantics",
  );
});

Deno.test("intentional terminal failures use only bounded stable codes", () => {
  assert(
    REORDER_BODY.includes(
      "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'stale_phase_order');",
    ) &&
      REORDER_BODY.includes(
        `jsonb_build_object('ok', false, 'outcome', 'conflict', 'code', 'stale_phase_order')`,
      ),
    "reorder conflict must persist and replay stale_phase_order",
  );
  assert(
    !REORDER_BODY.includes("'stale_phase_planning'"),
    "reorder must not use the planning conflict code",
  );
  assert(
    PLAN_BODY.includes(
      "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'stale_phase_planning');",
    ) &&
      PLAN_BODY.includes(
        `jsonb_build_object('ok', false, 'outcome', 'conflict', 'code', 'stale_phase_planning')`,
      ),
    "plan conflict must persist and replay stale_phase_planning",
  );
  assert(
    !PLAN_BODY.includes("'stale_phase_order'"),
    "plan must not use the reorder conflict code",
  );
  for (const body of [REORDER_BODY, PLAN_BODY]) {
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
    const build = body.indexOf("v_result := jsonb_build_object(");
    const complete = body.indexOf("api_e_private.complete_idempotency(");
    assert(
      build > 0 && build < complete,
      "complete_idempotency must follow safe result construction",
    );
    assert(
      body.includes(
        "PERFORM api_e_private.complete_idempotency(v_claim.registry_id, v_result);",
      ),
      "completion must persist only the bounded safe result",
    );
  }
  const failCount = countOf(FLAT, "fail_idempotency(");
  assert(failCount === 7, `unexpected fail_idempotency usage count: ${failCount}`);
});

Deno.test("grants: PUBLIC and anon revoked, only authenticated granted", () => {
  const reorderArgs =
    "public.api_v1_reorder_phases(text, uuid, jsonb, text, text, text, text)";
  const planArgs =
    "public.api_v1_plan_phase(text, uuid, timestamptz, date, date, boolean, text, text, text, text)";
  for (const sig of [reorderArgs, planArgs]) {
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
});

Deno.test("no generic dispatch, dynamic SQL or wrapper business mutation", () => {
  for (
    const forbidden of [
      "EXECUTE format",
      "EXECUTE '",
      "regprocedure",
      "quote_ident",
      "INSERT INTO public.phases",
      "UPDATE public.phases",
      "DELETE FROM public.phases",
      "INSERT INTO public.projects",
      "UPDATE public.projects",
      "pmg_record_command_audit",
      "pmg_build_result",
      "CREATE TEMP TABLE",
      "set_config",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `forbidden construct present: ${forbidden}`);
  }
  // No task, timeline or capability-registration surface introduced here.
  for (
    const forbidden of [
      "api_v1_create_phase",
      "api_v1_update_phase",
      "api_capability_catalogue",
      "api_client_supported_capabilities",
      "public.tasks",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `out-of-scope surface present: ${forbidden}`);
  }
});
