// API-M.7A — Dedicated transactional Phase create and update API wrappers.
//
// Focused repository static contract test. Locates the API-M.7A migration by its
// unique marker and asserts, from committed source only:
//   - exactly two wrapper definitions exist (create + update), with exact typed signatures;
//   - both RETURN jsonb, are SECURITY DEFINER with a hardened search path;
//   - create hardcodes only phases:create, update hardcodes only phases:update;
//   - no caller-supplied capability/scope/command/function/RPC/table/SQL parameter;
//   - authoritative scope derivation happens before authorize_and_establish;
//   - update derives Phase -> Project scope and enforces consistency;
//   - authorize_and_establish is called exactly once per wrapper; no authorize_project_scope;
//   - trusted Organization/Workspace context is compared to derived scope;
//   - explicit Project Connected App enablement occurs before idempotency;
//   - the API-F claim uses the exact fixed capability constant;
//   - conflict/pending/replay branches never call a canonical Phase mutation;
//   - create calls exactly one apply_phase_create, update exactly one apply_phase_update;
//   - the update execute branch locks and re-confirms Phase scope (TOCTOU);
//   - no reorder_phases / apply_phase_planning_change / preview call exists;
//   - external results never contain Phase name or description;
//   - create confirmation_required is bounded and does not widen the Project;
//   - update conflict persists only the stable failure code stale_phase;
//   - idempotency completion happens only after safe result construction;
//   - PUBLIC/anon are revoked, only authenticated is granted, no service-role grant;
//   - no dynamic SQL, generic dispatcher, or business-table write is introduced.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER =
  "API-M.7A — Dedicated transactional Phase create and update API wrappers";

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
  "CREATE OR REPLACE FUNCTION public.api_v1_create_phase( _expected_oauth_client_id text, _project_id uuid, _name text, _description text, _status text, _phase_type text, _start_date date, _target_end_date date, _sort_order integer, _request_id text, _correlation_id text, _idempotency_key text, _payload_hash text ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'";

const UPDATE_SIG =
  "CREATE OR REPLACE FUNCTION public.api_v1_update_phase( _expected_oauth_client_id text, _phase_id uuid, _expected_updated_at timestamptz, _name text, _description text, _status text, _phase_type text, _request_id text, _correlation_id text, _idempotency_key text, _payload_hash text ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'";

// Per-wrapper bodies for scoped assertions.
const createStart = FLAT.indexOf(
  "CREATE OR REPLACE FUNCTION public.api_v1_create_phase(",
);
const updateStart = FLAT.indexOf(
  "CREATE OR REPLACE FUNCTION public.api_v1_update_phase(",
);
assert(createStart >= 0, "create wrapper definition not found");
assert(updateStart > createStart, "update wrapper must follow create wrapper");
const CREATE_BODY = FLAT.slice(createStart, updateStart);
const UPDATE_BODY = FLAT.slice(updateStart);

Deno.test("M.7A defines exactly the two Phase wrappers with exact signatures", () => {
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
  // No table/schema/enum/RLS/policy changes.
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
    countOf(CREATE_BODY, "c_capability_key constant text := 'phases:create';") ===
      1,
    "create must hardcode phases:create once",
  );
  assert(
    !CREATE_BODY.includes("'phases:update'") &&
      !CREATE_BODY.includes("'phases:reorder'") &&
      !CREATE_BODY.includes("'phases:plan'"),
    "create must not reference any other Phase capability",
  );
  assert(
    countOf(UPDATE_BODY, "c_capability_key constant text := 'phases:update';") ===
      1,
    "update must hardcode phases:update once",
  );
  assert(
    !UPDATE_BODY.includes("'phases:create'") &&
      !UPDATE_BODY.includes("'phases:reorder'") &&
      !UPDATE_BODY.includes("'phases:plan'"),
    "update must not reference any other Phase capability",
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
  const createDerive = CREATE_BODY.indexOf("FROM public.projects p WHERE p.id = _project_id");
  const createAuth = CREATE_BODY.indexOf(
    "api_e_private.authorize_and_establish(",
  );
  assert(createDerive > 0, "create must derive scope from the Project row");
  assert(
    createDerive < createAuth,
    "create scope derivation must precede authorization",
  );

  const updatePhaseRead = UPDATE_BODY.indexOf(
    "FROM public.phases ph WHERE ph.id = _phase_id",
  );
  const updateProjectRead = UPDATE_BODY.indexOf(
    "FROM public.projects p WHERE p.id = v_row_project_id",
  );
  const updateAuth = UPDATE_BODY.indexOf(
    "api_e_private.authorize_and_establish(",
  );
  assert(
    updatePhaseRead > 0 && updateProjectRead > updatePhaseRead,
    "update must derive Phase -> parent Project scope",
  );
  assert(
    updateProjectRead < updateAuth,
    "update scope derivation must precede authorization",
  );
  assert(
    UPDATE_BODY.includes(
      "v_workspace_id IS DISTINCT FROM v_row_workspace_id",
    ) &&
      UPDATE_BODY.includes(
        "v_organization_id IS DISTINCT FROM v_row_organization_id",
      ),
    "update must require stored Phase scope to match the parent Project",
  );
  // Non-enumerating failure on unresolved/inconsistent scope.
  for (const body of [CREATE_BODY, UPDATE_BODY]) {
    assert(
      body.includes(`jsonb_build_object('ok', false, 'outcome', 'not_authorized')`),
      "unresolved scope must return a bounded not_authorized outcome",
    );
  }
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

Deno.test("trusted context is verified against derived scope", () => {
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

Deno.test("explicit Project Connected App enablement precedes idempotency", () => {
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
      body.includes("unexpected idempotency decision") &&
        body.includes("unknown persisted failure code") &&
        body.includes("unexpected replay state"),
      "unknown claim states must raise internal exceptions",
    );
    // Replay/conflict/pending must be resolved before any canonical mutation.
    const claim = body.indexOf("api_e_private.claim_idempotency(");
    const canonical = body.indexOf(
      body === CREATE_BODY
        ? "public.apply_phase_create("
        : "public.apply_phase_update(",
    );
    assert(
      claim < canonical,
      "canonical command must be invoked only after the claim decision",
    );
    const preCanonical = body.slice(0, canonical);
    assert(
      !preCanonical.includes("public.apply_phase_"),
      "no canonical mutation may occur in claim-decision branches",
    );
  }
});

Deno.test("each wrapper invokes exactly one canonical Phase command", () => {
  assert(
    countOf(CREATE_BODY, "public.apply_phase_create(") === 1,
    "create must call apply_phase_create exactly once",
  );
  assert(
    !CREATE_BODY.includes("public.apply_phase_update("),
    "create must not call apply_phase_update",
  );
  assert(
    countOf(UPDATE_BODY, "public.apply_phase_update(") === 1,
    "update must call apply_phase_update exactly once",
  );
  assert(
    !UPDATE_BODY.includes("public.apply_phase_create("),
    "update must not call apply_phase_create",
  );
  for (
    const forbidden of [
      "reorder_phases",
      "apply_phase_planning_change",
      "preview_phase_planning_change",
      "apply_project_update",
      "_apply_project_extension_internal",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `forbidden call present: ${forbidden}`);
  }
});

Deno.test("update execution branch locks and re-confirms Phase scope", () => {
  const claim = UPDATE_BODY.indexOf("api_e_private.claim_idempotency(");
  const lock = UPDATE_BODY.indexOf(
    "FROM public.phases ph WHERE ph.id = _phase_id FOR UPDATE",
  );
  const canonical = UPDATE_BODY.indexOf("public.apply_phase_update(");
  assert(lock > claim && lock < canonical, "row lock must sit between claim and command");
  assert(
    UPDATE_BODY.includes(
      "v_locked_project_id IS DISTINCT FROM v_row_project_id",
    ) &&
      UPDATE_BODY.includes(
        "v_locked_workspace_id IS DISTINCT FROM v_workspace_id",
      ) &&
      UPDATE_BODY.includes(
        "v_locked_organization_id IS DISTINCT FROM v_organization_id",
      ),
    "locked scope must be re-confirmed against the authorized scope",
  );
  assert(
    UPDATE_BODY.includes(
      "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'not_authorized'); RETURN jsonb_build_object('ok', false, 'outcome', 'not_authorized');",
    ),
    "scope drift must persist a bounded not_authorized failure",
  );
});

Deno.test("external results are bounded and narrative-free", () => {
  // Result construction must never emit Phase name or description.
  for (const body of [CREATE_BODY, UPDATE_BODY]) {
    assert(!body.includes("'name'"), "result must not include Phase name");
    assert(
      !body.includes("'description'"),
      "result must not include Phase description",
    );
    assert(!body.includes("btpm_decrypt"), "wrapper must not decrypt narrative");
  }
  assert(
    CREATE_BODY.includes(`'ok', true, 'outcome', 'applied', 'phaseId', v_phase_id, 'projectId', _project_id,`),
    "create applied result shape mismatch",
  );
  for (
    const key of [
      "'status'",
      "'phaseType'",
      "'startDate'",
      "'targetEndDate'",
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
    UPDATE_BODY.includes(
      `'ok', true, 'outcome', v_pmg_status, 'phaseId', _phase_id, 'projectId', v_project_id, 'status', (v_data ->> 'status'), 'phaseType', (v_data ->> 'phase_type'), 'updatedAt', (v_data ->> 'updated_at')`,
    ),
    "update applied/no_change result shape mismatch",
  );
  assert(
    UPDATE_BODY.includes(`v_pmg_status IN ('applied','no_change')`),
    "update must accept applied and no_change",
  );
});

Deno.test("create confirmation_required is bounded and does not widen the Project", () => {
  assert(
    CREATE_BODY.includes(`v_pmg_status = 'confirmation_required'`),
    "create must handle confirmation_required",
  );
  for (
    const key of [
      `'code', 'extend_project_window_required'`,
      "'projectStartDate'",
      "'projectTargetEndDate'",
      "'requestedPhaseStartDate'",
      "'requestedPhaseTargetEndDate'",
      "'requiredProjectStartDate'",
      "'requiredProjectTargetEndDate'",
    ]
  ) {
    assert(CREATE_BODY.includes(key), `confirmation key missing: ${key}`);
  }
  assert(
    !CREATE_BODY.includes("UPDATE public.projects"),
    "create wrapper must never widen the Project",
  );
  assert(
    CREATE_BODY.includes("unexpected confirmation payload"),
    "unexpected confirmation payloads must fail closed",
  );
});

Deno.test("intentional terminal failures use only bounded stable codes", () => {
  assert(
    UPDATE_BODY.includes(
      "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'stale_phase');",
    ) &&
      UPDATE_BODY.includes(
        `jsonb_build_object('ok', false, 'outcome', 'conflict', 'code', 'stale_phase')`,
      ),
    "update conflict must persist and replay stale_phase",
  );
  assert(
    !CREATE_BODY.includes("stale_"),
    "create has no optimistic concurrency failure code",
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
    assert(
      body.includes("PERFORM api_e_private.complete_idempotency(v_claim.registry_id, v_result);"),
      "completion must persist only the bounded safe result",
    );
  }
  const failCount = countOf(FLAT, "fail_idempotency(");
  assert(failCount === 6, `unexpected fail_idempotency usage count: ${failCount}`);
});

Deno.test("grants: PUBLIC and anon revoked, only authenticated granted", () => {
  const createArgs =
    "public.api_v1_create_phase(text, uuid, text, text, text, text, date, date, integer, text, text, text, text)";
  const updateArgs =
    "public.api_v1_update_phase(text, uuid, timestamptz, text, text, text, text, text, text, text, text)";
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
    ]
  ) {
    assert(!FLAT.includes(forbidden), `forbidden construct present: ${forbidden}`);
  }
  // No M.7B / M.8 surface introduced here.
  for (
    const forbidden of [
      "api_v1_reorder_phases",
      "api_v1_plan_phase",
      "api_capability_catalogue",
      "api_client_supported_capabilities",
    ]
  ) {
    assert(!FLAT.includes(forbidden), `out-of-scope surface present: ${forbidden}`);
  }
});
