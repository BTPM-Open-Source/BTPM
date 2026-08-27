// API-Q Task Update Step 1 — static contract guard for the trusted MCP
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
const MARKER = "API-Q Task Update Step 1 — Trusted MCP Database Bridge";

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
  assert(found.length >= 1, "expected at least one Task Update bridge migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

/** The shared private executor body only. */
const executor = (() => {
  const start = sql.indexOf(
    "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_task(",
  );
  const end = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.api_v1_update_task(",
  );
  assert(start >= 0 && end > start, "private executor block must exist");
  return sql.slice(start, end);
})();

Deno.test("Task Update bridge: exactly the four expected functions are (re)defined", () => {
  const created = (sql.match(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9.]+)/g) ?? [])
    .map((m) => m.replace(/CREATE OR REPLACE FUNCTION\s+/, ""));
  assertEquals(new Set(created), new Set([
    "public.apply_task_update",
    "api_e_private.execute_v1_update_task",
    "public.api_v1_update_task",
    "public.mcp_v1_update_task",
  ]));
});

Deno.test("Task Update bridge: canonical command keeps its exact signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.apply_task_update\(_task_id uuid, _expected_updated_at timestamp with time zone, _name text, _description text DEFAULT NULL::text, _status pm_status DEFAULT NULL::pm_status, _priority pm_priority DEFAULT NULL::pm_priority, _task_type task_type DEFAULT NULL::task_type, _estimated_hours numeric DEFAULT NULL::numeric, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)/
      .test(sql),
    "apply_task_update signature must be unchanged",
  );
  assert(/RETURNS jsonb/.test(sql));
});

Deno.test("Task Update bridge: canonical command accepts trusted external_api or mcp only", () => {
  assert(
    sql.includes("v_trusted_channel NOT IN ('external_api','mcp')"),
    "trusted channel must be the fixed two-value allowlist",
  );
  assert(
    !sql.includes(
      "current_setting('api_e.source_channel', true),'')),''), '') <> 'external_api'",
    ),
    "the old external_api-only comparison must be gone",
  );
  assert(
    /IF v_trusted_channel = 'external_api' THEN\s*v_source_channel := 'external_api'::public\.pmg_source_channel;\s*ELSE\s*v_source_channel := 'mcp'::public\.pmg_source_channel;/
      .test(sql),
    "PMG provenance must map external_api -> external_api and mcp -> mcp",
  );
  assert(
    sql.includes(
      "v_source_channel public.pmg_source_channel := 'btpm_ui'::public.pmg_source_channel",
    ),
    "ordinary UI behavior must remain btpm_ui",
  );
  const channelLiterals = new Set(
    (sql.match(
      /'(btpm_ui|external_api|mcp|admin_import|background_job|btpm_internal)'::public\.pmg_source_channel/g,
    ) ?? []).map((m) => m.split("'")[1]),
  );
  assertEquals(channelLiterals, new Set(["btpm_ui", "external_api", "mcp"]));
});

Deno.test("Task Update bridge: exact capability remains tasks:update", () => {
  assert(
    sql.includes(
      "current_setting('api_e.capability_key', true),'')),''), '') <> 'tasks:update'",
    ),
    "canonical command must pin tasks:update",
  );
  assert(
    executor.includes("c_capability_key constant text := 'tasks:update';"),
    "executor must pin tasks:update",
  );
  assert(
    executor.includes("c_api_version    constant text := 'v1';") &&
      executor.includes("c_capability_kind constant text := 'command';"),
  );
});

Deno.test("Task Update bridge: source channel remains server-derived only", () => {
  assert(
    sql.includes(
      "v_trusted_channel := nullif(btrim(coalesce(current_setting('api_e.source_channel', true),'')),'');",
    ),
    "channel must come only from current_setting",
  );
  assert(
    !/apply_task_update\([^)]*_source_channel/.test(sql),
    "no source-channel parameter may be added to the canonical command",
  );
  assert(
    !/CREATE OR REPLACE FUNCTION public\.(api|mcp)_v1_update_task\([^)]*_source_channel/
      .test(sql),
    "no public wrapper may accept a source-channel parameter",
  );
});

Deno.test("Task Update bridge: trusted-context failure precedes reads, locks, writes, decryption and audit", () => {
  const canonical = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.apply_task_update("),
    sql.indexOf("CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_task("),
  );
  const failClosed = canonical.indexOf("v_trusted_channel NOT IN ('external_api','mcp')");
  assert(failClosed > 0);
  for (const later of [
    "public.is_active_user(v_actor)",
    "FROM public.tasks",
    "FOR UPDATE",
    "public.btpm_decrypt(",
    "UPDATE public.tasks",
    "public.pmg_record_command_audit(",
  ]) {
    assert(
      canonical.indexOf(later) > failClosed,
      `${later} must occur after the trusted-context gate`,
    );
  }
});

Deno.test("Task Update bridge: private executor has the exact typed signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION api_e_private\.execute_v1_update_task\(\s*_execution_source text,\s*_expected_oauth_client_id text,\s*_task_id uuid,\s*_expected_updated_at timestamptz,\s*_name text,\s*_description text,\s*_status text,\s*_priority text,\s*_task_type text,\s*_estimated_hours numeric,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb/
      .test(sql),
    "private executor signature must match the contract exactly",
  );
  assert(executor.includes("SECURITY DEFINER"));
  assert(executor.includes("SET search_path TO 'pg_catalog', 'public'"));
});

Deno.test("Task Update bridge: internal selector accepts external_api/mcp only", () => {
  assert(
    /IF v_source IS NULL OR v_source NOT IN \('external_api','mcp'\) THEN\s*RETURN jsonb_build_object\('ok', false, 'outcome', 'not_authorized'\);/
      .test(executor),
    "any other selector value must fail closed as not_authorized",
  );
});

Deno.test("Task Update bridge: external_api uses authorize_and_establish, mcp uses the MCP helper", () => {
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
    /IF v_source = 'external_api' THEN[\s\S]*?api_e_private\.authorize_and_establish\([\s\S]*?ELSE[\s\S]*?api_e_private\.authorize_and_establish_mcp\(/
      .test(executor),
    "each fixed source must use its own accepted authorization helper",
  );
});

Deno.test("Task Update bridge: Task -> Phase/Project -> Workspace/Organization containment preserved", () => {
  assert(
    /SELECT t\.project_id, t\.phase_id, t\.workspace_id, t\.organization_id\s*INTO v_row_project_id, v_row_phase_id, v_row_workspace_id, v_row_organization_id/
      .test(executor),
  );
  assert(
    /SELECT p\.id, p\.workspace_id, p\.organization_id\s*INTO v_project_id, v_workspace_id, v_organization_id\s*FROM public\.projects p/
      .test(executor),
  );
  assert(
    executor.includes("v_workspace_id IS DISTINCT FROM v_row_workspace_id") &&
      executor.includes(
        "v_organization_id IS DISTINCT FROM v_row_organization_id",
      ),
    "stored Task scope must match the parent Project",
  );
});

Deno.test("Task Update bridge: Connected App enablement precedes idempotency", () => {
  const enablement = executor.indexOf("api_project_client_enablements");
  const claim = executor.indexOf("api_e_private.claim_idempotency(");
  assert(enablement > 0 && claim > enablement, "enablement must come first");
  for (const cond of [
    "e.project_id = v_project_id",
    "e.api_client_id = v_ctx_client_id",
    "e.tenant_id = v_ctx_tenant_id",
    "e.organization_id = v_organization_id",
    "e.workspace_id = v_workspace_id",
    "e.lifecycle_status = 'enabled'",
    "e.enabled_at IS NOT NULL",
    "e.disabled_at IS NULL",
  ]) {
    assert(executor.includes(cond), `enablement must still require ${cond}`);
  }
  assert(
    !executor.includes("tenant_integrations"),
    "no tenant_integrations identity may be introduced",
  );
});

Deno.test("Task Update bridge: complete API-F idempotency lifecycle", () => {
  assert(
    executor.includes(
      "api_e_private.claim_idempotency(c_capability_key, _idempotency_key, _payload_hash)",
    ),
  );
  for (const branch of [
    "'outcome', 'idempotency_conflict'",
    "'outcome', 'idempotency_pending'",
    "RETURN v_claim.canonical_result || jsonb_build_object('outcome', 'replayed');",
    "PERFORM api_e_private.complete_idempotency(v_claim.registry_id, v_result);",
    "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'stale_task');",
    "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'not_authorized');",
    "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'invalid');",
  ]) {
    assert(executor.includes(branch), `missing lifecycle branch: ${branch}`);
  }
});

Deno.test("Task Update bridge: execution branch locks and re-confirms Task scope", () => {
  const claim = executor.indexOf("api_e_private.claim_idempotency(");
  const lock = executor.indexOf("FOR UPDATE");
  const apply = executor.indexOf("public.apply_task_update(");
  assert(claim < lock && lock < apply, "lock must sit between claim and apply");
  for (const cond of [
    "v_locked_project_id IS DISTINCT FROM v_row_project_id",
    "v_locked_project_id IS DISTINCT FROM v_project_id",
    "v_locked_phase_id IS DISTINCT FROM v_row_phase_id",
    "v_locked_workspace_id IS DISTINCT FROM v_workspace_id",
    "v_locked_organization_id IS DISTINCT FROM v_organization_id",
  ]) {
    assert(executor.includes(cond), `TOCTOU re-confirmation must keep ${cond}`);
  }
});

Deno.test("Task Update bridge: exactly one canonical command call in the shared executor", () => {
  assertEquals(
    (executor.match(/public\.apply_task_update\(/g) ?? []).length,
    1,
  );
});

Deno.test("Task Update bridge: caller expected_updated_at is forwarded unchanged", () => {
  assert(
    /public\.apply_task_update\(\s*_task_id,\s*_expected_updated_at,\s*_name,\s*_description,\s*v_status,\s*v_priority,\s*v_task_type,\s*_estimated_hours,\s*_correlation_id,\s*_idempotency_key\s*\)/
      .test(executor),
    "the caller-supplied concurrency token must be forwarded verbatim",
  );
  assert(
    !/_expected_updated_at\s*:=/.test(executor),
    "expected_updated_at must never be reassigned",
  );
  assert(
    !/t\.updated_at/.test(executor) && !/updated_at\s+INTO/.test(executor),
    "the executor must not read the stored updated_at",
  );
  assert(
    !/\bLOOP\b/.test(executor) && !/\bWHILE\b/.test(executor),
    "no automatic retry construct may exist",
  );
});

Deno.test("Task Update bridge: stale conflict remains bounded and non-leaking", () => {
  const staleReturns =
    (executor.match(
      /jsonb_build_object\('ok', false, 'outcome', 'conflict', 'code', 'stale_task'\)/g,
    ) ?? []).length;
  assertEquals(staleReturns, 2, "live conflict and replayed conflict only");
  assert(
    !executor.includes("current_updated_at"),
    "no current DB timestamp may be exposed on the stale path",
  );
});

Deno.test("Task Update bridge: applied / no_change / replayed remain represented", () => {
  assert(executor.includes("IF v_pmg_status IN ('applied','no_change') THEN"));
  assert(executor.includes("'outcome', v_pmg_status"));
});

Deno.test("Task Update bridge: no Task narrative is returned or persisted", () => {
  const safeResult = executor.slice(
    executor.indexOf("v_result := jsonb_build_object("),
    executor.indexOf("PERFORM api_e_private.complete_idempotency("),
  );
  for (const forbidden of ["name", "description"]) {
    assert(
      !safeResult.includes(`'${forbidden}'`),
      `safe canonical result must not contain ${forbidden}`,
    );
  }
  assert(
    !executor.includes("btpm_decrypt"),
    "the wrapper must never decrypt narrative",
  );
});

Deno.test("Task Update bridge: exactly one audit path with derived provenance", () => {
  const canonical = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.apply_task_update("),
    sql.indexOf("CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_task("),
  );
  const audits = canonical.match(/public\.pmg_record_command_audit\(/g) ?? [];
  // conflict, no_change and applied — the three canonical terminal states.
  assertEquals(audits.length, 3);
  assertEquals(
    (canonical.match(/\n\s*v_source_channel,\n/g) ?? []).length,
    3,
    "every audit record must use the derived source channel",
  );
  assert(
    !executor.includes("pmg_record_command_audit"),
    "the executor must never write its own audit record",
  );
});

Deno.test("Task Update bridge: public wrappers hardcode their fixed source", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_update_task\([\s\S]*?RETURN api_e_private\.execute_v1_update_task\(\s*'external_api',/
      .test(sql),
    "REST wrapper must hardcode external_api",
  );
  assert(
    /CREATE OR REPLACE FUNCTION public\.mcp_v1_update_task\([\s\S]*?RETURN api_e_private\.execute_v1_update_task\(\s*'mcp',/
      .test(sql),
    "MCP wrapper must hardcode mcp",
  );
  assert(
    !/_execution_source text/.test(
      sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.api_v1_update_task(")),
    ),
    "no public wrapper may accept a source parameter",
  );
});

Deno.test("Task Update bridge: private executor is revoked from every application role", () => {
  const args =
    "\\(text, text, uuid, timestamptz, text, text, text, text, text, numeric, text, text, text, text\\)";
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      new RegExp(
        `REVOKE ALL ON FUNCTION api_e_private\\.execute_v1_update_task${args} FROM ${role};`,
      ).test(sql),
      `private executor EXECUTE must be revoked from ${role}`,
    );
  }
  assert(
    !/GRANT[^;]*api_e_private\.execute_v1_update_task/.test(sql),
    "the private executor must never be granted",
  );
});

Deno.test("Task Update bridge: public wrapper ACLs match the accepted posture", () => {
  const args =
    "\\(text, uuid, timestamptz, text, text, text, text, text, numeric, text, text, text, text\\)";
  for (const fn of ["api_v1_update_task", "mcp_v1_update_task"]) {
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${fn}${args} FROM ${role};`,
        ).test(sql),
        `${fn} must revoke ${role}`,
      );
    }
    assert(
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${fn}${args} TO authenticated;`,
      ).test(sql),
      `${fn} must grant authenticated`,
    );
  }
  assert(
    !/GRANT[^;]*(mcp_v1_update_task|api_v1_update_task)[^;]*TO (PUBLIC|anon|service_role)/
      .test(sql),
  );
  assert(
    !/(GRANT|REVOKE)[^;]*public\.apply_task_update/.test(sql),
    "the canonical command ACL must not be changed",
  );
});

Deno.test("Task Update bridge: no adjacent Task command or Project widening is introduced", () => {
  for (const forbidden of [
    "apply_task_create",
    "apply_task_reorder",
    "apply_task_planning",
    "apply_task_transition",
    "task_stakeholder_roles",
    "extend_phase_window_required",
    "start_date",
    "due_date",
    "sort_order",
    "UPDATE public.projects",
    "UPDATE public.phases",
  ]) {
    assert(
      !executor.includes(forbidden),
      `Task Update must remain metadata-only: ${forbidden} must not appear`,
    );
  }
});

Deno.test("Task Update bridge: no schema, policy or encryption surface is touched", () => {
  for (const forbidden of [
    "CREATE TABLE",
    "ALTER TABLE",
    "CREATE POLICY",
    "DROP POLICY",
    "DROP FUNCTION",
    "api_capability_catalogue",
  ]) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
  assert(
    !/tenant_encryption|encrypt\(|decrypt\(/i.test(executor),
    "encryption must remain in the canonical command only",
  );
});

Deno.test("Task Update bridge: the MCP wrapper name never leaks into registry, factory or runtime", async () => {
  const registry = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
  );
  const factory = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
  );
  const index = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
  );

  for (const source of [registry, factory, index]) {
    assert(
      !source.includes("mcp_v1_update_task") &&
        !source.includes("execute_v1_update_task"),
      "no MCP registry, factory or runtime module may name the Task Update wrapper",
    );
  }
});
