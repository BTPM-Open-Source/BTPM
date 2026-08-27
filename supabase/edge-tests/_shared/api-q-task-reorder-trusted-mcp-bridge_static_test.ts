// API-Q Task Reorder Step 1 — static contract guard for the trusted MCP
// database bridge.
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename), takes the latest one as
// the effective definition, and verifies the executable SQL.
// No database, network or Edge invocation. No MCP TypeScript surface is touched.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q Task Reorder Step 1 — Trusted MCP Database Bridge";

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
  assert(found.length >= 1, "expected at least one Task Reorder Step 1 migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

Deno.test("Task Reorder Step 1: exactly four functions are defined", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION public.reorder_tasks",
    "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_reorder_tasks",
    "CREATE OR REPLACE FUNCTION public.api_v1_reorder_tasks",
    "CREATE OR REPLACE FUNCTION public.mcp_v1_reorder_tasks",
  ]);
});

Deno.test("Task Reorder Step 1: canonical command signature and hardening unchanged", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.reorder_tasks\(_phase_id uuid, _rows jsonb, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)/
      .test(sql),
    "canonical reorder signature and defaults must be unchanged",
  );
  assert(/RETURNS jsonb/.test(sql));
  assert(/SECURITY DEFINER/.test(sql));
  assert(/SET search_path TO 'pg_catalog', 'public'/.test(sql));
  assert(
    !/(^|[^a-z0-9_])_source_channel/.test(sql),
    "no source-channel argument may exist on any surface",
  );
});

Deno.test("Task Reorder Step 1: trusted channel allowlist is exactly external_api and mcp", () => {
  assert(
    /v_trusted_channel := nullif\(btrim\(coalesce\(current_setting\('api_e\.source_channel', true\),''\)\),''\)/
      .test(sql),
    "channel must be read from the trusted API-E context only",
  );
  assert(/v_trusted_channel IS NULL/.test(sql), "missing channel must fail closed");
  assert(
    /v_trusted_channel NOT IN \('external_api','mcp'\)/.test(sql),
    "allowlist must be exactly external_api and mcp",
  );
  assert(
    !/<> 'external_api'/.test(sql),
    "the previous external_api-only condition must be replaced",
  );
  assert(
    /IF v_trusted_channel = 'external_api' THEN\s*v_source_channel := 'external_api'::public\.pmg_source_channel;\s*ELSE\s*v_source_channel := 'mcp'::public\.pmg_source_channel;\s*END IF;/
      .test(sql),
    "channel mapping must be external_api->external_api, otherwise mcp",
  );
  const channelLiterals = new Set(
    (sql.match(
      /'(btpm_ui|external_api|mcp|admin_import|background_job|btpm_internal)'::public\.pmg_source_channel/g,
    ) ?? []).map((m) => m.split("'")[1]),
  );
  assertEquals(channelLiterals, new Set(["btpm_ui", "external_api", "mcp"]));
  assert(
    /IF v_client_id IS NOT NULL THEN/.test(sql),
    "channel derivation only applies to delegated clients",
  );
});

Deno.test("Task Reorder Step 1: capability identity remains v1 / command / tasks:reorder", () => {
  assert(/current_setting\('api_e\.api_version', true\)[\s\S]{0,80}<> 'v1'/.test(sql));
  assert(
    /current_setting\('api_e\.capability_kind', true\)[\s\S]{0,80}<> 'command'/.test(sql),
  );
  assert(
    /current_setting\('api_e\.capability_key', true\)[\s\S]{0,100}<> 'tasks:reorder'/.test(sql),
  );
  assert(
    /c_capability_key constant text := 'tasks:reorder';/.test(sql),
    "executor capability key must be the fixed literal",
  );
});

Deno.test("Task Reorder Step 1: untrusted delegated context fails closed before temp table, read, lock, write and audit", () => {
  const guardIdx = sql.indexOf("v_trusted_channel NOT IN ('external_api','mcp')");
  const activeUserIdx = sql.indexOf("public.is_active_user(v_actor)");
  const phaseLookupIdx = sql.indexOf("FROM public.phases\n   WHERE id = _phase_id");
  const tempIdx = sql.indexOf("CREATE TEMP TABLE _pmg_task_reorder_input");
  const lockIdx = sql.indexOf("FOR UPDATE");
  const updateIdx = sql.indexOf("UPDATE public.tasks t");
  const auditIdx = sql.indexOf("public.pmg_record_command_audit(");
  assert(guardIdx > -1);
  assert(activeUserIdx > guardIdx, "active-user check must follow the guard");
  assert(phaseLookupIdx > guardIdx, "Phase lookup must follow the guard");
  assert(tempIdx > guardIdx, "temp table creation must follow the guard");
  assert(lockIdx > guardIdx, "row locking must follow the guard");
  assert(updateIdx > guardIdx, "write must follow the guard");
  assert(auditIdx > guardIdx, "audit must follow the guard");
  assert(/'not_authorized'::public\.pmg_command_status/.test(sql));
});

Deno.test("Task Reorder Step 1: canonical reorder algorithm preserved", () => {
  for (const fragment of [
    "public.has_project_pm_authority(v_actor, v_project_id)",
    "public.can_write_demo(v_actor, v_phase.workspace_id)",
    "public.is_active_user(v_actor)",
    "'rows_not_array'",
    "'malformed_rows'",
    "'no_rows'",
    "'row_field_missing'",
    "'duplicate_row_ids'",
    "'duplicate_sort_positions'",
    "'non_contiguous_sort_positions'",
    "'row_count_mismatch'",
    "'unknown_or_cross_phase_rows'",
    "'missing_task_rows'",
    "'stale_task_order'",
    "PERFORM 1 FROM public.tasks WHERE phase_id = _phase_id FOR UPDATE;",
    "t.updated_at IS DISTINCT FROM i.expected_updated_at",
    "SET sort_order = i.new_sort_order",
    "t.sort_order IS DISTINCT FROM i.new_sort_order",
    "'no_change'::public.pmg_command_status",
    "'applied'::public.pmg_command_status",
    "public.pmg_build_result(",
  ]) {
    assert(sql.includes(fragment), `canonical behaviour fragment missing: ${fragment}`);
  }
  const audits = sql.match(/public\.pmg_record_command_audit\(/g) ?? [];
  assertEquals(audits.length, 2, "conflict + terminal audit calls only");
});

Deno.test("Task Reorder Step 1: one private dual-source executor with an internal fixed source", () => {
  assert(
    /CREATE OR REPLACE FUNCTION api_e_private\.execute_v1_reorder_tasks\(\s*_execution_source text,\s*_expected_oauth_client_id text,\s*_phase_id uuid,\s*_rows jsonb,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)/
      .test(sql),
    "executor must take the internal execution source first, then the fixed parameter list",
  );
  assert(
    /v_source NOT IN \('external_api','mcp'\)/.test(sql),
    "executor must accept only the two internal sources",
  );
  assert(/api_e_private\.authorize_and_establish\(/.test(sql));
  assert(/api_e_private\.authorize_and_establish_mcp\(/.test(sql));
  assert(
    /api_e_private\.claim_idempotency\(c_capability_key, _idempotency_key, _payload_hash\)/.test(
      sql,
    ),
  );
  assert(/api_e_private\.complete_idempotency\(v_claim\.registry_id, v_result\)/.test(sql));
  assert(/api_e_private\.fail_idempotency\(v_claim\.registry_id, 'stale_task_order'\)/.test(sql));
  assert(/'idempotency_conflict'/.test(sql));
  assert(/'idempotency_pending'/.test(sql));
  assert(/jsonb_build_object\('outcome', 'replayed'\)/.test(sql));
  assert(
    sql.indexOf("api_project_client_enablements") <
      sql.indexOf("api_e_private.claim_idempotency("),
    "project enablement must be verified before idempotency",
  );
  const pmgCalls = sql.match(/public\.reorder_tasks\(/g) ?? [];
  assertEquals(pmgCalls.length, 2, "one definition plus exactly one hardcoded call");
});

Deno.test("Task Reorder Step 1: executor derives scope from the Phase and re-verifies after the claim", () => {
  const start = sql.indexOf("FUNCTION api_e_private.execute_v1_reorder_tasks");
  const end = sql.indexOf("FUNCTION public.api_v1_reorder_tasks");
  const body = sql.slice(start, end);
  assert(body.length > 0);
  assert(
    body.includes("FROM public.phases ph\n   WHERE ph.id = _phase_id;"),
    "scope must be derived from the target Phase",
  );
  assert(
    body.includes("v_workspace_id IS DISTINCT FROM v_row_workspace_id") &&
      body.includes("v_organization_id IS DISTINCT FROM v_row_organization_id"),
    "structural inconsistency between Phase and Project must be rejected",
  );
  const claimIdx = body.indexOf("api_e_private.claim_idempotency(");
  const lockIdx = body.indexOf("FOR UPDATE");
  assert(claimIdx > -1 && lockIdx > claimIdx, "the Phase lock must follow the claim");
  assert(
    body.indexOf("v_locked_project_id IS DISTINCT FROM v_project_id") > lockIdx,
    "scope must be re-verified after the lock",
  );
});

Deno.test("Task Reorder Step 1: executor never re-implements the reorder algorithm", () => {
  const start = sql.indexOf("FUNCTION api_e_private.execute_v1_reorder_tasks");
  const end = sql.indexOf("FUNCTION public.api_v1_reorder_tasks");
  const body = sql.slice(start, end);
  for (const forbidden of [
    "UPDATE public.tasks",
    "INSERT INTO public.tasks",
    "DELETE FROM public.tasks",
    "CREATE TEMP TABLE",
    "pmg_record_command_audit",
    "sort_order =",
    "expected_updated_at",
    "has_project_pm_authority",
    "can_write_demo",
    "is_active_user",
  ]) {
    assert(!body.includes(forbidden), `executor must not contain ${forbidden}`);
  }
  assert(
    body.includes("_rows,"),
    "caller row tokens must be forwarded unchanged to the canonical command",
  );
});

Deno.test("Task Reorder Step 1: bounded success and stale_task_order contracts", () => {
  assert(
    /'ok', true,\s*'outcome', v_pmg_status,\s*'projectId', v_project_id,\s*'phaseId', _phase_id,\s*'submittedCount', \(v_data -> 'submitted_count'\),\s*'changedCount', \(v_data -> 'changed_count'\),\s*'orderedTasks', v_ordered/
      .test(sql),
    "success payload must be exactly the seven bounded fields",
  );
  assert(
    /'taskId', \(elem ->> 'id'\)::uuid,\s*'sortOrder', \(elem -> 'sort_order'\),\s*'updatedAt', \(elem ->> 'updated_at'\)/
      .test(sql),
    "ordered rows must carry only taskId, sortOrder and updatedAt",
  );
  assert(
    /'code', 'stale_task_order',\s*'projectId', v_project_id,\s*'phaseId', _phase_id,\s*'staleTaskIds', v_stale/
      .test(sql),
    "direct conflict must be bounded stale_task_order",
  );
  assert(
    /v_claim\.failure_code = 'stale_task_order' THEN\s*RETURN jsonb_build_object\('ok', false, 'outcome', 'conflict', 'code', 'stale_task_order'\);/
      .test(sql),
    "failed-idempotency replay must not invent stale identifiers",
  );
  for (const forbidden of ["title", "description", "notes", "narrative", "decrypt"]) {
    assert(!sql.includes(forbidden), `no narrative surface allowed: ${forbidden}`);
  }
});

Deno.test("Task Reorder Step 1: no generic dispatch anywhere", () => {
  for (const forbidden of [
    "EXECUTE format",
    "regprocedure",
    "quote_ident",
    "_function_name",
    "_rpc_name",
    "_table_name",
    "_sql",
  ]) {
    assert(!sql.includes(forbidden), `no dynamic dispatch allowed: ${forbidden}`);
  }
  assert(!/\bEXECUTE\s+'/.test(sql), "no dynamic SQL string execution");
});

Deno.test("Task Reorder Step 1: wrappers are thin and hardcode exactly one source", () => {
  assert(
    /FUNCTION public\.api_v1_reorder_tasks\([\s\S]*?RETURN api_e_private\.execute_v1_reorder_tasks\(\s*'external_api',/
      .test(sql),
    "REST wrapper must hardcode external_api",
  );
  assert(
    /FUNCTION public\.mcp_v1_reorder_tasks\([\s\S]*?RETURN api_e_private\.execute_v1_reorder_tasks\(\s*'mcp',/
      .test(sql),
    "MCP wrapper must hardcode mcp",
  );
  const restSig =
    /FUNCTION public\.api_v1_reorder_tasks\(\s*_expected_oauth_client_id text,\s*_phase_id uuid,\s*_rows jsonb,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)/;
  const mcpSig =
    /FUNCTION public\.mcp_v1_reorder_tasks\(\s*_expected_oauth_client_id text,\s*_phase_id uuid,\s*_rows jsonb,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)/;
  assert(restSig.test(sql), "REST wrapper signature must be unchanged");
  assert(mcpSig.test(sql), "MCP wrapper signature must mirror the REST wrapper");
  assert(
    !/FUNCTION public\.(api|mcp)_v1_reorder_tasks\([\s\S]{0,400}_execution_source/.test(sql),
    "no wrapper may expose the execution source",
  );
});

Deno.test("Task Reorder Step 1: privileges are minimal and the executor is unreachable", () => {
  const priv =
    "api_e_private.execute_v1_reorder_tasks(text, text, uuid, jsonb, text, text, text, text)";
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(`REVOKE ALL ON FUNCTION ${priv} FROM ${role};`),
      `${priv} must be revoked from ${role}`,
    );
  }
  assert(
    !new RegExp(`GRANT[^;]*ON FUNCTION ${priv.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(sql),
    "the private executor must never be granted",
  );
  for (const fn of [
    "public.api_v1_reorder_tasks(text, uuid, jsonb, text, text, text, text)",
    "public.mcp_v1_reorder_tasks(text, uuid, jsonb, text, text, text, text)",
  ]) {
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(`REVOKE ALL ON FUNCTION ${fn} FROM ${role};`),
        `${fn} must be revoked from ${role}`,
      );
    }
    assert(
      sql.includes(`GRANT EXECUTE ON FUNCTION ${fn} TO authenticated;`),
      `${fn} must grant EXECUTE to authenticated only`,
    );
  }
  assert(!/GRANT[^;]*TO (PUBLIC|anon|service_role)/.test(sql), "no widened grants");
  assert(
    !/ON FUNCTION public\.reorder_tasks/.test(sql),
    "the canonical command ACL must not change",
  );
});

Deno.test("Task Reorder Step 1: no unrelated surface is touched", () => {
  for (const forbidden of [
    "apply_task_create",
    "apply_task_update",
    "apply_task_transition",
    "reorder_phases",
    "plan_phase",
    "CREATE POLICY",
    "DROP POLICY",
    "ALTER TABLE",
    "CREATE TABLE public",
    "DROP FUNCTION",
    "api_capability_catalogue",
    "api_clients",
  ]) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});
