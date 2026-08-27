// API-Q Task Transition Step 1 — static contract guard for the trusted MCP
// database bridge.
//
// Repository/static test only: it locates the committed migration by its
// unique marker (never by a hardcoded timestamped filename), takes the latest
// one as the effective definition, and verifies the executable SQL.
//
// No database access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q Task Transition Step 1 — Trusted MCP Database Bridge";

/** Remove SQL line/block comments (executable SQL only). */
function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < n && sql.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

async function loadMigration(): Promise<{ name: string; text: string }> {
  const found: { name: string; text: string }[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
    if (text.includes(MARKER)) found.push({ name: entry.name, text });
  }
  assert(
    found.length >= 1,
    "expected at least one Task Transition bridge migration",
  );
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

const CANONICAL_HEAD =
  "CREATE OR REPLACE FUNCTION public.apply_task_execution_change(";
const EXECUTOR_HEAD =
  "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_transition_task(";
const REST_HEAD = "CREATE OR REPLACE FUNCTION public.api_v1_transition_task(";
const MCP_HEAD = "CREATE OR REPLACE FUNCTION public.mcp_v1_transition_task(";

/** The canonical command block only. */
const canonical = (() => {
  const start = sql.indexOf(CANONICAL_HEAD);
  const end = sql.indexOf(EXECUTOR_HEAD);
  assert(start >= 0 && end > start, "canonical command block must exist");
  return sql.slice(start, end);
})();

/** The shared private executor block only. */
const executor = (() => {
  const start = sql.indexOf(EXECUTOR_HEAD);
  const end = sql.indexOf(REST_HEAD);
  assert(start >= 0 && end > start, "private executor block must exist");
  return sql.slice(start, end);
})();

const restWrapper = (() => {
  const start = sql.indexOf(REST_HEAD);
  const end = sql.indexOf(MCP_HEAD);
  assert(start >= 0 && end > start, "REST wrapper block must exist");
  return sql.slice(start, end);
})();

const mcpWrapper = sql.slice(sql.indexOf(MCP_HEAD));

// ---------------------------------------------------------------------------
// A. Shape of the migration
// ---------------------------------------------------------------------------

Deno.test("Task Transition bridge: exactly the four expected functions are (re)defined", () => {
  const created =
    (sql.match(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9.]+)/g) ?? [])
      .map((m) => m.replace(/CREATE OR REPLACE FUNCTION\s+/, ""));
  assertEquals(
    new Set(created),
    new Set([
      "public.apply_task_execution_change",
      "api_e_private.execute_v1_transition_task",
      "public.api_v1_transition_task",
      "public.mcp_v1_transition_task",
    ]),
  );
  assertEquals(created.length, 4, "no function may be defined twice");
});

Deno.test("Task Transition bridge: no other Task command, table DDL or policy is touched", () => {
  for (
    const forbidden of [
      "apply_task_update",
      "apply_task_create",
      "apply_task_reorder",
      "apply_task_assignee_set",
      "apply_task_planning_change",
      "reopen_task",
      "CREATE POLICY",
      "ALTER POLICY",
      "DROP POLICY",
      "ALTER TABLE",
      "DROP FUNCTION",
      "CREATE TABLE",
      "DROP TABLE",
      "CREATE TRIGGER",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// B. Private executor: signature, security mode, search path, ACL
// ---------------------------------------------------------------------------

Deno.test("Task Transition bridge: private executor has the exact expected signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION api_e_private\.execute_v1_transition_task\(\s*_execution_source text,\s*_expected_oauth_client_id text,\s*_task_id uuid,\s*_expected_updated_at timestamptz,\s*_set_actual_start boolean,\s*_actual_start_date date,\s*_set_actual_end boolean,\s*_actual_end_date date,\s*_status text,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb/
      .test(sql),
    "executor signature and return type must be exact",
  );
});

Deno.test("Task Transition bridge: private executor is SECURITY DEFINER with a hardened search path", () => {
  assert(executor.includes("SECURITY DEFINER"), "must be SECURITY DEFINER");
  assert(
    executor.includes("SET search_path TO 'pg_catalog', 'public'"),
    "search path must be pinned to pg_catalog, public",
  );
  assert(executor.includes("LANGUAGE plpgsql"));
});

const EXECUTOR_SIG =
  "api_e_private.execute_v1_transition_task(text, text, uuid, timestamptz, boolean, date, boolean, date, text, text, text, text, text)";

Deno.test("Task Transition bridge: private executor ACL is fully revoked (postgres only)", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(`REVOKE ALL ON FUNCTION ${EXECUTOR_SIG} FROM ${role};`),
      `executor must revoke ${role}`,
    );
  }
  assert(
    !new RegExp(
      `GRANT[^;]*${EXECUTOR_SIG.replace(/[()]/g, "\\$&")}[^;]*`,
    ).test(sql),
    "no GRANT may be issued on the private executor",
  );
});

// ---------------------------------------------------------------------------
// C. Public wrappers: unchanged REST signature, identical MCP signature
// ---------------------------------------------------------------------------

const PUBLIC_ARGS =
  /\(\s*_expected_oauth_client_id text,\s*_task_id uuid,\s*_expected_updated_at timestamptz,\s*_set_actual_start boolean,\s*_actual_start_date date,\s*_set_actual_end boolean,\s*_actual_end_date date,\s*_status text,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb/;

Deno.test("Task Transition bridge: REST wrapper keeps its exact existing signature", () => {
  assert(
    PUBLIC_ARGS.test(restWrapper),
    "public.api_v1_transition_task signature must be unchanged",
  );
});

Deno.test("Task Transition bridge: MCP wrapper signature is identical to REST", () => {
  assert(
    PUBLIC_ARGS.test(mcpWrapper),
    "public.mcp_v1_transition_task signature must be identical to REST",
  );
  const norm = (s: string) =>
    s.slice(s.indexOf("("), s.indexOf("RETURNS jsonb")).replace(/\s+/g, " ");
  assertEquals(norm(restWrapper), norm(mcpWrapper));
});

Deno.test("Task Transition bridge: both wrappers are thin delegates with literal fixed sources", () => {
  const delegateArgs =
    "_expected_oauth_client_id,\\s*_task_id,\\s*_expected_updated_at,\\s*_set_actual_start,\\s*_actual_start_date,\\s*_set_actual_end,\\s*_actual_end_date,\\s*_status,\\s*_request_id,\\s*_correlation_id,\\s*_idempotency_key,\\s*_payload_hash";
  assert(
    new RegExp(
      `BEGIN\\s*RETURN api_e_private\\.execute_v1_transition_task\\(\\s*'external_api',\\s*${delegateArgs}\\s*\\);\\s*END;`,
    ).test(restWrapper),
    "REST wrapper must delegate with the literal 'external_api'",
  );
  assert(
    new RegExp(
      `BEGIN\\s*RETURN api_e_private\\.execute_v1_transition_task\\(\\s*'mcp',\\s*${delegateArgs}\\s*\\);\\s*END;`,
    ).test(mcpWrapper),
    "MCP wrapper must delegate with the literal 'mcp'",
  );
  for (const wrapper of [restWrapper, mcpWrapper]) {
    assert(
      !/\bEXECUTE\s+(format|'|_)/.test(wrapper),
      "wrappers must contain no dynamic SQL EXECUTE",
    );
    for (
      const forbidden of [
        "apply_task_execution_change",
        "claim_idempotency",
        "complete_idempotency",
        "fail_idempotency",
        "authorize_and_establish",
        "current_setting",
        "public.tasks",
        "public.projects",
        "api_project_client_enablements",
        "format(",
        "quote_ident",
      ]
    ) {
      assert(
        !wrapper.includes(forbidden),
        `wrappers must stay thin: ${forbidden} is forbidden`,
      );
    }
  }
});

Deno.test("Task Transition bridge: no public execution-source or dispatch selector exists", () => {
  // _execution_source may only appear in the private executor declaration and
  // its single internal assignment.
  assertEquals((sql.match(/_execution_source/g) ?? []).length, 2);
  for (const wrapper of [restWrapper, mcpWrapper]) {
    for (
      const forbidden of [
        "_execution_source",
        "_source_channel",
        "_capability_key",
        "_capability_kind",
        "_command",
        "_function_name",
        "_rpc",
        "_table_name",
        "_organization_id",
        "_workspace_id",
        "_project_id",
      ]
    ) {
      assert(
        !wrapper.includes(forbidden),
        `no public ${forbidden} selector may exist`,
      );
    }
  }
});

Deno.test("Task Transition bridge: public wrapper ACLs are not widened", () => {
  for (const name of ["api_v1_transition_task", "mcp_v1_transition_task"]) {
    const sig =
      `public.${name}(text, uuid, timestamptz, boolean, date, boolean, date, text, text, text, text, text)`;
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(`REVOKE ALL ON FUNCTION ${sig} FROM ${role};`),
        `${name} must revoke ${role}`,
      );
    }
    assert(
      sql.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`),
      `${name} must grant only authenticated`,
    );
  }
  const grantedRoles = new Set(
    (sql.match(/GRANT EXECUTE ON FUNCTION[^;]*TO ([a-z_]+);/g) ?? [])
      .map((m) => m.replace(/.*TO /, "").replace(";", "")),
  );
  assertEquals(grantedRoles, new Set(["authenticated"]));
});

// ---------------------------------------------------------------------------
// D. Fixed source selection, authorization helpers, fixed identity
// ---------------------------------------------------------------------------

Deno.test("Task Transition bridge: unsupported private sources fail closed before any work", () => {
  const idx = executor.indexOf(
    "IF v_source IS NULL OR v_source NOT IN ('external_api','mcp') THEN",
  );
  assert(idx >= 0, "fixed-source selector must exist");
  const before = executor.slice(0, idx);
  for (
    const later of [
      "authorize_and_establish",
      "claim_idempotency",
      "apply_task_execution_change",
      "FROM public.tasks",
      "api_project_client_enablements",
    ]
  ) {
    assert(
      !before.includes(later),
      `${later} must not run before the source check`,
    );
  }
  assert(
    executor.slice(idx).includes(
      "RETURN jsonb_build_object('ok', false, 'outcome', 'not_authorized');",
    ),
    "unsupported source must return bounded not_authorized",
  );
});

Deno.test("Task Transition bridge: exactly one REST and one MCP authorization-helper call", () => {
  assertEquals(
    (executor.match(/api_e_private\.authorize_and_establish\(/g) ?? []).length,
    1,
  );
  assertEquals(
    (executor.match(/api_e_private\.authorize_and_establish_mcp\(/g) ?? [])
      .length,
    1,
  );
  assert(
    /IF v_source = 'external_api' THEN[\s\S]*authorize_and_establish\([\s\S]*ELSE[\s\S]*authorize_and_establish_mcp\(/
      .test(executor),
    "external_api must use the REST helper and mcp the MCP helper",
  );
  assertEquals(
    (executor.match(/EXCEPTION WHEN OTHERS THEN\s*v_trusted := false;/g) ?? [])
      .length,
    2,
    "both helper calls must fail closed on exception",
  );
  assert(
    executor.includes(
      "IF v_trusted IS NOT TRUE THEN\n    RETURN jsonb_build_object('ok', false, 'outcome', 'not_authorized');",
    ),
  );
});

Deno.test("Task Transition bridge: fixed v1 / command / tasks:transition identity", () => {
  assert(executor.includes("c_api_version    constant text := 'v1';"));
  assert(executor.includes("c_capability_kind constant text := 'command';"));
  assert(
    executor.includes("c_capability_key constant text := 'tasks:transition';"),
  );
  for (
    const forbidden of [
      "'tasks:assign'",
      "'tasks:update'",
      "'tasks:create'",
      "'tasks:reorder'",
      "'tasks:plan'",
      "'query'",
      "'v2'",
    ]
  ) {
    assert(
      !executor.includes(forbidden),
      `executor must not reference ${forbidden}`,
    );
  }
});

Deno.test("Task Transition bridge: trusted context and project enablement precede idempotency", () => {
  const ctx = executor.indexOf("current_setting('api_e.api_client_id', true)");
  const enablement = executor.indexOf("api_project_client_enablements");
  const claim = executor.indexOf("api_e_private.claim_idempotency(");
  assert(ctx > 0 && enablement > ctx, "enablement must follow context read");
  assert(claim > enablement, "idempotency must follow enablement");
  assert(
    executor.includes("v_ctx_org_id IS DISTINCT FROM v_organization_id") &&
      executor.includes(
        "v_ctx_workspace_id IS DISTINCT FROM v_workspace_id",
      ),
    "trusted context scope must be re-verified",
  );
});

// ---------------------------------------------------------------------------
// E. Containment, optimistic concurrency, idempotency preservation
// ---------------------------------------------------------------------------

Deno.test("Task Transition bridge: containment is structural and re-verified under lock", () => {
  assert(
    executor.includes(
      "SELECT t.project_id, t.phase_id, t.workspace_id, t.organization_id",
    ),
    "structural Task scope read must exist",
  );
  assert(
    executor.includes("FROM public.projects p"),
    "authoritative scope must derive from the parent Project",
  );
  assert(
    executor.includes("v_workspace_id IS DISTINCT FROM v_row_workspace_id") &&
      executor.includes(
        "v_organization_id IS DISTINCT FROM v_row_organization_id",
      ),
    "structurally inconsistent stored scope must be rejected",
  );
  const lock = executor.indexOf("FOR UPDATE");
  const claim = executor.indexOf("api_e_private.claim_idempotency(");
  assert(lock > claim, "the Task lock must follow the idempotency claim");
  assert(
    executor.includes("v_locked_project_id IS DISTINCT FROM v_project_id") &&
      executor.includes("v_locked_phase_id IS DISTINCT FROM v_row_phase_id") &&
      executor.includes(
        "v_locked_workspace_id IS DISTINCT FROM v_workspace_id",
      ) &&
      executor.includes(
        "v_locked_organization_id IS DISTINCT FROM v_organization_id",
      ),
    "post-claim scope re-verification must exist",
  );
});

Deno.test("Task Transition bridge: optimistic concurrency is preserved and mandatory", () => {
  assert(
    executor.includes("OR _expected_updated_at IS NULL"),
    "_expected_updated_at must remain mandatory",
  );
  assert(
    executor.includes("OR _set_actual_start IS NULL") &&
      executor.includes("OR _set_actual_end IS NULL"),
    "explicit actual set flags must remain mandatory",
  );
  assert(
    executor.includes("'outcome', 'conflict', 'code', 'stale_task'") ||
      executor.includes("'code', 'stale_task'"),
    "stale conflicts must surface the stable stale_task code",
  );
  assert(
    !executor.includes("current_updated_at"),
    "no live timestamp may be exposed on a stale conflict",
  );
});

Deno.test("Task Transition bridge: idempotency claim, completion and failure paths are intact", () => {
  assert(
    executor.includes(
      "api_e_private.claim_idempotency(c_capability_key, _idempotency_key, _payload_hash)",
    ),
    "the claim must use the fixed capability key",
  );
  for (
    const fragment of [
      "'idempotency_conflict'",
      "'idempotency_pending'",
      "'replayed'",
      "api_e_private.complete_idempotency(v_claim.registry_id, v_result)",
      "api_e_private.fail_idempotency(v_claim.registry_id, 'stale_task')",
      "api_e_private.fail_idempotency(v_claim.registry_id, 'not_authorized')",
      "api_e_private.fail_idempotency(v_claim.registry_id, 'invalid')",
    ]
  ) {
    assert(executor.includes(fragment), `missing idempotency path: ${fragment}`);
  }
  assertEquals(
    (executor.match(/api_e_private\.claim_idempotency\(/g) ?? []).length,
    1,
  );
  assertEquals(
    (executor.match(/api_e_private\.complete_idempotency\(/g) ?? []).length,
    1,
  );
});

// ---------------------------------------------------------------------------
// F. Single canonical command path, no direct execution write
// ---------------------------------------------------------------------------

Deno.test("Task Transition bridge: exactly one canonical command call, none in the wrappers", () => {
  assertEquals(
    (executor.match(/public\.apply_task_execution_change\(/g) ?? []).length,
    1,
  );
  assert(!restWrapper.includes("apply_task_execution_change"));
  assert(!mcpWrapper.includes("apply_task_execution_change"));
});

Deno.test("Task Transition bridge: the private executor performs no execution write", () => {
  for (
    const forbidden of [
      "INSERT INTO",
      "UPDATE public.",
      "DELETE FROM",
      "set_task_assignee",
      "pmg_record_command_audit",
      "has_project_pm_authority",
      "can_write_demo",
    ]
  ) {
    assert(
      !executor.includes(forbidden),
      `executor must not contain ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// G. Canonical command semantics and trusted provenance
// ---------------------------------------------------------------------------

Deno.test("Task Transition bridge: canonical command keeps its exact signature and defaults", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.apply_task_execution_change\(_task_id uuid, _expected_updated_at timestamp with time zone, _set_actual_start boolean DEFAULT false, _actual_start_date date DEFAULT NULL::date, _set_actual_end boolean DEFAULT false, _actual_end_date date DEFAULT NULL::date, _status pm_status DEFAULT NULL::pm_status, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)\s*\n\s*RETURNS jsonb/
      .test(sql),
    "canonical signature and defaults must be unchanged",
  );
  assert(canonical.includes("SECURITY DEFINER"));
  assert(canonical.includes("SET search_path TO 'pg_catalog', 'public'"));
  assert(
    !/(REVOKE|GRANT)[^;]*apply_task_execution_change/.test(sql),
    "the canonical command ACL must not change",
  );
});

Deno.test("Task Transition bridge: canonical command accepts trusted external_api or mcp only", () => {
  assert(
    canonical.includes("v_trusted_channel NOT IN ('external_api','mcp')"),
    "trusted channel must be the fixed two-value allowlist",
  );
  assert(
    !canonical.includes(
      "current_setting('api_e.source_channel', true),'')),''), '') <> 'external_api'",
    ),
    "the old external_api-only comparison must be gone",
  );
  assert(
    canonical.includes(
      "v_trusted_channel := COALESCE(NULLIF(btrim(COALESCE(current_setting('api_e.source_channel', true),'')),''), '');",
    ),
    "provenance must come only from the trusted source channel setting",
  );
  assert(
    /IF v_trusted_channel = 'external_api' THEN\s*v_source_channel := 'external_api'::public\.pmg_source_channel;\s*ELSE\s*v_source_channel := 'mcp'::public\.pmg_source_channel;/
      .test(canonical),
    "external_api -> external_api and mcp -> mcp provenance mapping required",
  );
  assert(
    !/apply_task_execution_change\([^)]*_source_channel/.test(sql),
    "no public source-channel argument may exist",
  );
});

Deno.test("Task Transition bridge: UI/internal execution remains btpm_ui", () => {
  assert(
    canonical.includes(
      "v_source_channel public.pmg_source_channel := 'btpm_ui'::public.pmg_source_channel",
    ),
  );
  const channelLiterals = new Set(
    (canonical.match(
      /'(btpm_ui|external_api|mcp|admin_import|background_job|btpm_internal)'::public\.pmg_source_channel/g,
    ) ?? []).map((m) => m.split("'")[1]),
  );
  assertEquals(channelLiterals, new Set(["btpm_ui", "external_api", "mcp"]));
});

Deno.test("Task Transition bridge: canonical command fails closed before business work", () => {
  const gate = canonical.indexOf(
    "v_trusted_channel NOT IN ('external_api','mcp')",
  );
  const active = canonical.indexOf("public.is_active_user(v_actor)");
  const lookup = canonical.indexOf("FROM public.tasks");
  const write = canonical.indexOf("UPDATE public.tasks");
  const audit = canonical.indexOf("public.pmg_record_command_audit(");
  assert(
    gate > 0 && active > gate,
    "trusted gate must precede active-user check",
  );
  assert(lookup > gate, "trusted gate must precede Task lookup");
  assert(write > gate, "trusted gate must precede the write");
  assert(audit > gate, "trusted gate must precede audit");
});

Deno.test("Task Transition bridge: canonical command retains authority, concurrency, status bounds, write and audit", () => {
  for (
    const fragment of [
      "public.is_active_user(v_actor)",
      "public.has_project_pm_authority(v_actor, v_project_id)",
      "public.can_write_demo(v_actor, v_project.workspace_id)",
      "'expected_updated_at_required'",
      "'status_not_allowed'",
      "v_task.updated_at IS DISTINCT FROM _expected_updated_at",
      "'code', 'stale_task'",
      "'no_change'::public.pmg_command_status",
      "UPDATE public.tasks",
      "'applied'::public.pmg_command_status",
    ]
  ) {
    assert(
      canonical.includes(fragment),
      `missing canonical fragment: ${fragment}`,
    );
  }
  assert(
    canonical.includes(
      "_status NOT IN ('active'::public.pm_status, 'completed'::public.pm_status)",
    ),
    "reopen must stay unroutable through this command",
  );
  assertEquals(
    (canonical.match(/UPDATE public\.tasks/g) ?? []).length,
    1,
    "exactly one canonical write path",
  );
  assertEquals(
    (canonical.match(/PERFORM public\.pmg_record_command_audit\(/g) ?? [])
      .length,
    4,
    "audit records for conflict, no-change, invalid and applied",
  );
  assertEquals(
    (canonical.match(/v_source_channel,/g) ?? []).length,
    4,
    "every audit record must carry the derived source channel",
  );
});

// ---------------------------------------------------------------------------
// H. Bounded result surface, privacy, encryption
// ---------------------------------------------------------------------------

Deno.test("Task Transition bridge: the bounded result contains exactly the approved fields", () => {
  const start = executor.indexOf("v_result := jsonb_build_object(");
  assert(start > 0, "result construction must exist");
  const block = executor.slice(start, executor.indexOf(");", start));
  const keys = (block.match(/'([A-Za-z]+)',/g) ?? []).map((k) =>
    k.replace(/['|,]/g, "")
  );
  assertEquals(keys, [
    "ok",
    "outcome",
    "taskId",
    "projectId",
    "phaseId",
    "status",
    "actualStartDate",
    "actualEndDate",
    "updatedAt",
  ]);
});

Deno.test("Task Transition bridge: no protected or encrypted Task content is read or returned", () => {
  for (
    const forbidden of [
      "title",
      "description",
      "notes",
      "decrypt",
      "encrypt",
      "pgp_",
      "tenant_encryption",
      "assignee",
      "email",
    ]
  ) {
    assert(
      !executor.includes(forbidden),
      `executor must not touch ${forbidden}`,
    );
  }
});

Deno.test("Task Transition bridge: no dynamic SQL anywhere in the migration", () => {
  for (
    const forbidden of [
      "EXECUTE format",
      "EXECUTE '",
      "quote_ident",
      "quote_literal",
      "concat(",
      "||' '||",
    ]
  ) {
    assert(!sql.includes(forbidden), `dynamic SQL is forbidden: ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// I. Step boundary: no TypeScript adapter or MCP runtime wiring in this step
// ---------------------------------------------------------------------------

Deno.test("Task Transition bridge: no MCP exposure or runtime wiring is implied", () => {
  for (
    const forbidden of [
      "toolRegistry",
      "serverFactory",
      "tools/call",
      "exposure",
      "btpm-mcp",
    ]
  ) {
    assert(
      !migration.text.includes(forbidden),
      `Step 1 must not reference ${forbidden}`,
    );
  }
});
