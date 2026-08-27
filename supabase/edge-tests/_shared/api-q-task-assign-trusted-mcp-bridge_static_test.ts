// API-Q Task Assign Step 1 — static contract guard for the trusted MCP
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
const MARKER = "API-Q Task Assign Step 1 — Trusted MCP Database Bridge";

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
  assert(found.length >= 1, "expected at least one Task Assign bridge migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

const EXECUTOR_HEAD =
  "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_assign_task(";
const REST_HEAD = "CREATE OR REPLACE FUNCTION public.api_v1_assign_task(";
const MCP_HEAD = "CREATE OR REPLACE FUNCTION public.mcp_v1_assign_task(";

/** The shared private executor block only. */
const executor = (() => {
  const start = sql.indexOf(EXECUTOR_HEAD);
  const end = sql.indexOf(REST_HEAD);
  assert(start >= 0 && end > start, "private executor block must exist");
  return sql.slice(start, end);
})();

/** The canonical command block only. */
const canonical = (() => {
  const start = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.apply_task_assignee_set(",
  );
  const end = sql.indexOf(EXECUTOR_HEAD);
  assert(start >= 0 && end > start, "canonical command block must exist");
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

Deno.test("Task Assign bridge: exactly the four expected functions are (re)defined", () => {
  const created = (sql.match(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9.]+)/g) ?? [])
    .map((m) => m.replace(/CREATE OR REPLACE FUNCTION\s+/, ""));
  assertEquals(new Set(created), new Set([
    "public.apply_task_assignee_set",
    "api_e_private.execute_v1_assign_task",
    "public.api_v1_assign_task",
    "public.mcp_v1_assign_task",
  ]));
  assertEquals(created.length, 4, "no function may be defined twice");
});

Deno.test("Task Assign bridge: no other Task command, table DDL or policy is touched", () => {
  for (
    const forbidden of [
      "apply_task_update",
      "apply_task_create",
      "apply_task_reorder",
      "apply_task_planning_change",
      "apply_task_transition",
      "CREATE POLICY",
      "ALTER TABLE",
      "DROP FUNCTION",
      "CREATE TABLE",
      "DROP TABLE",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// B. Private executor: signature, security mode, search path, ACL
// ---------------------------------------------------------------------------

Deno.test("Task Assign bridge: private executor has the exact expected signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION api_e_private\.execute_v1_assign_task\(\s*_execution_source text,\s*_expected_oauth_client_id text,\s*_task_id uuid,\s*_assignee_id uuid,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb/
      .test(sql),
    "executor signature and return type must be exact",
  );
});

Deno.test("Task Assign bridge: private executor is SECURITY DEFINER with a hardened search path", () => {
  assert(executor.includes("SECURITY DEFINER"), "must be SECURITY DEFINER");
  assert(
    executor.includes("SET search_path TO 'pg_catalog', 'public'"),
    "search path must be pinned to pg_catalog, public",
  );
  assert(executor.includes("LANGUAGE plpgsql"));
});

Deno.test("Task Assign bridge: private executor ACL is fully revoked (postgres only)", () => {
  const sig =
    "api_e_private.execute_v1_assign_task(text, text, uuid, uuid, text, text, text, text)";
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(`REVOKE ALL ON FUNCTION ${sig} FROM ${role};`),
      `executor must revoke ${role}`,
    );
  }
  assert(
    !new RegExp(
      `GRANT[^;]*${sig.replace(/[()]/g, "\\$&")}[^;]*`,
    ).test(sql),
    "no GRANT may be issued on the private executor",
  );
});

// ---------------------------------------------------------------------------
// C. Public wrappers: unchanged REST signature, identical MCP signature
// ---------------------------------------------------------------------------

const PUBLIC_ARGS =
  /\(\s*_expected_oauth_client_id text,\s*_task_id uuid,\s*_assignee_id uuid,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb/;

Deno.test("Task Assign bridge: REST wrapper keeps its exact existing signature", () => {
  assert(
    PUBLIC_ARGS.test(restWrapper),
    "public.api_v1_assign_task signature must be unchanged",
  );
});

Deno.test("Task Assign bridge: MCP wrapper signature is identical to REST", () => {
  assert(
    PUBLIC_ARGS.test(mcpWrapper),
    "public.mcp_v1_assign_task signature must be identical to REST",
  );
  const norm = (s: string) =>
    s.slice(s.indexOf("("), s.indexOf("RETURNS jsonb")).replace(/\s+/g, " ");
  assertEquals(norm(restWrapper), norm(mcpWrapper));
});

Deno.test("Task Assign bridge: both wrappers are thin delegates with literal fixed sources", () => {
  assert(
    /BEGIN\s*RETURN api_e_private\.execute_v1_assign_task\(\s*'external_api',\s*_expected_oauth_client_id,\s*_task_id,\s*_assignee_id,\s*_request_id,\s*_correlation_id,\s*_idempotency_key,\s*_payload_hash\s*\);\s*END;/
      .test(restWrapper),
    "REST wrapper must delegate with the literal 'external_api'",
  );
  assert(
    /BEGIN\s*RETURN api_e_private\.execute_v1_assign_task\(\s*'mcp',\s*_expected_oauth_client_id,\s*_task_id,\s*_assignee_id,\s*_request_id,\s*_correlation_id,\s*_idempotency_key,\s*_payload_hash\s*\);\s*END;/
      .test(mcpWrapper),
    "MCP wrapper must delegate with the literal 'mcp'",
  );
  for (const wrapper of [restWrapper, mcpWrapper]) {
    assert(
      !/\bEXECUTE\s+(format|'|_)/.test(wrapper),
      "wrappers must contain no dynamic SQL EXECUTE",
    );
    for (
      const forbidden of [
        "apply_task_assignee_set",
        "set_task_assignee",
        "claim_idempotency",
        "complete_idempotency",
        "fail_idempotency",
        "authorize_and_establish",
        "current_setting",
        "public.tasks",
        "task_assignments",
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

Deno.test("Task Assign bridge: no public execution-source or dispatch selector exists", () => {
  for (
    const forbidden of [
      "_execution_source text,\n  _expected_oauth_client_id text,\n  _task_id uuid,\n  _assignee_id uuid,\n  _request_id",
    ]
  ) {
    // only the private executor may carry _execution_source
    assertEquals(
      (sql.match(/_execution_source/g) ?? []).length,
      2,
      `_execution_source may only appear in the private executor declaration and its assignment (${forbidden.slice(0, 0)})`,
    );
  }
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

Deno.test("Task Assign bridge: public wrapper ACLs are not widened", () => {
  for (const name of ["api_v1_assign_task", "mcp_v1_assign_task"]) {
    const sig = `public.${name}(text, uuid, uuid, text, text, text, text)`;
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

Deno.test("Task Assign bridge: unsupported private sources fail closed before any work", () => {
  const idx = executor.indexOf(
    "IF v_source IS NULL OR v_source NOT IN ('external_api','mcp') THEN",
  );
  assert(idx >= 0, "fixed-source selector must exist");
  const before = executor.slice(0, idx);
  for (
    const later of [
      "authorize_and_establish",
      "claim_idempotency",
      "apply_task_assignee_set",
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

Deno.test("Task Assign bridge: exactly one REST and one MCP authorization-helper call", () => {
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
  // Helper exceptions fail closed.
  assertEquals(
    (executor.match(/EXCEPTION WHEN OTHERS THEN\s*v_trusted := false;/g) ?? [])
      .length,
    2,
  );
  assert(
    executor.includes(
      "IF v_trusted IS NOT TRUE THEN\n    RETURN jsonb_build_object('ok', false, 'outcome', 'not_authorized');",
    ),
  );
});

Deno.test("Task Assign bridge: fixed v1 / command / tasks:assign identity", () => {
  assert(executor.includes("c_api_version    constant text := 'v1';"));
  assert(executor.includes("c_capability_kind constant text := 'command';"));
  assert(executor.includes("c_capability_key constant text := 'tasks:assign';"));
  assert(
    canonical.includes(
      "current_setting('api_e.capability_key', true),'')),''), '') <> 'tasks:assign'",
    ),
    "canonical command must pin tasks:assign",
  );
  assert(
    !executor.includes("'tasks:update'") && !executor.includes("'tasks:plan'"),
  );
});

// ---------------------------------------------------------------------------
// E. Ordering: trusted context -> enablement -> idempotency claim
// ---------------------------------------------------------------------------

Deno.test("Task Assign bridge: trusted-context re-verification precedes enablement and idempotency", () => {
  const ctx = executor.indexOf("current_setting('api_e.api_client_id', true)");
  const enable = executor.indexOf("public.api_project_client_enablements");
  const claim = executor.indexOf("api_e_private.claim_idempotency(");
  const pmg = executor.indexOf("public.apply_task_assignee_set(");
  assert(ctx > 0 && enable > ctx, "context verification must precede enablement");
  assert(claim > enable, "Project enablement must precede the API-F claim");
  assert(pmg > claim, "the canonical command must run after the claim");
});

Deno.test("Task Assign bridge: full API-F lifecycle and replay semantics remain intact", () => {
  for (
    const fragment of [
      "api_e_private.claim_idempotency(c_capability_key, _idempotency_key, _payload_hash)",
      "'idempotency_conflict'",
      "'idempotency_pending'",
      "v_claim.registry_state = 'completed'",
      "jsonb_build_object('outcome', 'replayed')",
      "v_claim.registry_state = 'failed'",
      "api_e_private.complete_idempotency(v_claim.registry_id, v_result)",
      "api_e_private.fail_idempotency(v_claim.registry_id, 'not_authorized')",
      "api_e_private.fail_idempotency(v_claim.registry_id, 'invalid')",
    ]
  ) {
    assert(executor.includes(fragment), `missing API-F fragment: ${fragment}`);
  }
  // Assignment has no concurrency token: no stale outcome or retry.
  for (
    const forbidden of [
      "stale_task",
      "'outcome', 'conflict'",
      "_expected_updated_at",
    ]
  ) {
    assert(
      !executor.includes(forbidden),
      `${forbidden} must not exist in the Assign executor`,
    );
  }
});

Deno.test("Task Assign bridge: containment is structural and re-verified under lock", () => {
  assert(
    executor.includes(
      "SELECT t.project_id, t.workspace_id, t.organization_id\n    INTO v_row_project_id, v_row_workspace_id, v_row_organization_id",
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
      executor.includes(
        "v_locked_workspace_id IS DISTINCT FROM v_workspace_id",
      ) &&
      executor.includes(
        "v_locked_organization_id IS DISTINCT FROM v_organization_id",
      ),
    "post-claim scope re-verification must exist",
  );
});

Deno.test("Task Assign bridge: assignee stays nullable and no concurrency token is added", () => {
  assert(
    /_assignee_id uuid,\s*_request_id text/.test(executor),
    "_assignee_id must remain a plain nullable uuid with no NOT NULL guard",
  );
  assert(
    !/_task_id IS NULL\s*OR _assignee_id IS NULL/.test(executor),
    "_assignee_id must never be required",
  );
  for (
    const forbidden of ["expectedUpdatedAt", "_expected_updated_at", "updated_at"]
  ) {
    assert(
      !executor.includes(forbidden),
      `no concurrency token may be introduced (${forbidden})`,
    );
  }
});

// ---------------------------------------------------------------------------
// F. Single canonical command path, no direct assignment write
// ---------------------------------------------------------------------------

Deno.test("Task Assign bridge: exactly one canonical command call, none in the wrappers", () => {
  assertEquals(
    (executor.match(/public\.apply_task_assignee_set\(/g) ?? []).length,
    1,
  );
  assert(!restWrapper.includes("apply_task_assignee_set"));
  assert(!mcpWrapper.includes("apply_task_assignee_set"));
});

Deno.test("Task Assign bridge: the private executor performs no assignment write", () => {
  for (
    const forbidden of [
      "set_task_assignee",
      "INSERT INTO",
      "UPDATE public.",
      "DELETE FROM",
      "task_assignments",
      "is_workspace_member",
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

Deno.test("Task Assign bridge: canonical command keeps its exact signature and defaults", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.apply_task_assignee_set\(_task_id uuid, _assignee_id uuid DEFAULT NULL::uuid, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)\s*\n\s*RETURNS jsonb/
      .test(sql),
    "canonical signature and defaults must be unchanged",
  );
  assert(canonical.includes("SECURITY DEFINER"));
  assert(canonical.includes("SET search_path TO 'pg_catalog', 'public'"));
  assert(
    !/(REVOKE|GRANT)[^;]*apply_task_assignee_set/.test(sql),
    "the canonical command ACL must not change",
  );
});

Deno.test("Task Assign bridge: canonical command accepts trusted external_api or mcp only", () => {
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
      "v_trusted_channel := nullif(btrim(coalesce(current_setting('api_e.source_channel', true),'')),'');",
    ),
    "provenance must come only from the trusted source channel setting",
  );
  assert(
    /IF v_trusted_channel = 'external_api' THEN\s*v_source_channel := 'external_api'::public\.pmg_source_channel;\s*ELSE\s*v_source_channel := 'mcp'::public\.pmg_source_channel;/
      .test(canonical),
    "external_api -> external_api and mcp -> mcp provenance mapping required",
  );
  assert(
    !/apply_task_assignee_set\([^)]*_source_channel/.test(sql),
    "no public source-channel argument may exist",
  );
});

Deno.test("Task Assign bridge: UI/internal execution remains btpm_ui", () => {
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

Deno.test("Task Assign bridge: canonical command fails closed before business work", () => {
  const gate = canonical.indexOf("v_trusted_channel NOT IN ('external_api','mcp')");
  const active = canonical.indexOf("public.is_active_user(v_actor)");
  const lookup = canonical.indexOf("FROM public.tasks");
  const audit = canonical.indexOf("public.pmg_record_command_audit(");
  assert(gate > 0 && active > gate, "trusted gate must precede active-user check");
  assert(lookup > gate, "trusted gate must precede Task lookup");
  assert(audit > gate, "trusted gate must precede audit");
});

Deno.test("Task Assign bridge: canonical command retains eligibility, authority, demo, clearing, no-change, write and audit", () => {
  for (
    const fragment of [
      "public.is_active_user(v_actor)",
      "public.has_project_pm_authority(v_actor, v_project_id)",
      "public.can_write_demo(v_actor, v_workspace_id)",
      "public.is_workspace_member(_assignee_id, v_workspace_id)",
      "'assignee_not_eligible'",
      "FROM public.task_assignments",
      "v_current_assignee IS NOT DISTINCT FROM _assignee_id",
      "'no_change'::public.pmg_command_status",
      "PERFORM public.set_task_assignee(_task_id, _assignee_id);",
      "'assignee_cleared', _assignee_id IS NULL",
      "'applied'::public.pmg_command_status",
    ]
  ) {
    assert(canonical.includes(fragment), `missing canonical fragment: ${fragment}`);
  }
  assertEquals(
    (canonical.match(/PERFORM public\.set_task_assignee\(/g) ?? []).length,
    1,
    "exactly one canonical set_task_assignee path",
  );
  assertEquals(
    (canonical.match(/PERFORM public\.pmg_record_command_audit\(/g) ?? []).length,
    2,
    "exactly one audit record for applied and one for no-change",
  );
  assert(
    (canonical.match(/v_source_channel,/g) ?? []).length === 2,
    "both audit records must carry the derived source channel",
  );
});

// ---------------------------------------------------------------------------
// H. Bounded result surface, privacy, encryption
// ---------------------------------------------------------------------------

Deno.test("Task Assign bridge: the bounded result contains exactly the approved fields", () => {
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
    "oldAssigneeId",
    "newAssigneeId",
  ]);
  for (
    const forbidden of [
      "workspaceId",
      "'workspace_id'",
      "name",
      "description",
      "narrative",
      "btpm_decrypt",
      "btpm_encrypt",
      "digest(",
      "encode(",
    ]
  ) {
    assert(
      !executor.includes(forbidden),
      `${forbidden} must never appear in the executor`,
    );
  }
});

Deno.test("Task Assign bridge: outcomes remain bounded and non-echoing", () => {
  const outcomes = new Set(
    (executor.match(/'outcome', '([a-z_]+)'/g) ?? []).map((m) =>
      m.split("'")[3]
    ),
  );
  assertEquals(
    outcomes,
    new Set([
      "not_authorized",
      "invalid",
      "idempotency_conflict",
      "idempotency_pending",
      "replayed",
    ]),
  );
  assert(
    !executor.includes("SQLERRM") && !executor.includes("SQLSTATE"),
    "no raw database error text may be surfaced",
  );
});

