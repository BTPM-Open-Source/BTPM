// API-Q.9A3 — static contract guard for trusted MCP source-channel support in
// public.append_execution_update.
//
// Repository/static test only: it locates the committed API-Q.9A3 migration by
// its unique marker (never by a hardcoded timestamped filename) and verifies the
// executable SQL. No database, network or Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const FUNCTIONS_DIR = new URL("../../functions/", import.meta.url);
const MARKER = "API-Q.9A3 — Execution Update PMG trusted MCP channel support";

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
  assert(found.length >= 1, "expected at least one API-Q.9A3 migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

Deno.test("API-Q.9A3: only append_execution_update is redefined, signature unchanged", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION public.append_execution_update",
  ]);
  assert(
    /CREATE OR REPLACE FUNCTION public\.append_execution_update\(_target_type text, _target_id uuid, _summary text, _update_date date, _status_label text DEFAULT NULL::text, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)/
      .test(sql),
    "signature must be unchanged",
  );
  assert(/RETURNS jsonb/.test(sql));
  assert(/SECURITY DEFINER/.test(sql));
  assert(/SET search_path TO 'pg_catalog', 'public'/.test(sql));
  // No other canonical surface is touched.
  assert(!/authorize_and_establish/.test(sql));
  assert(!/CREATE OR REPLACE FUNCTION public\.pmg_record_command_audit/.test(sql));
  assert(!/api_v1_append_execution_update/.test(sql));
  assert(!/CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP POLICY/.test(sql));
});

Deno.test("API-Q.9A3: source channel stays server-derived, never caller-supplied", () => {
  // Caller detection from JWT client identity only.
  assert(/v_client_id text := api_e_private\.jwt_client_id\(\)/.test(sql));
  // Trusted channel read exclusively from trusted API-E context.
  assert(
    /v_trusted_channel := nullif\(btrim\(coalesce\(current_setting\('api_e\.source_channel', true\),''\)\),''\)/
      .test(sql),
  );
  // No argument or payload may influence the channel.
  assert(
    !/(^|[^a-z0-9_])_source_channel/.test(sql),
    "no source-channel argument may exist",
  );
  for (const forbidden of [
    "_summary,",
    "_status_label,",
    "_correlation_id,",
    "_idempotency_key,",
  ]) {
    const assignment = new RegExp(
      `v_source_channel\\s*:=[^;]*${forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    );
    assert(!assignment.test(sql), `channel must not derive from ${forbidden}`);
  }
});

Deno.test("API-Q.9A3: OAuth callers still require trusted v1 command capability", () => {
  assert(/v_trusted := api_e_private\.assert_trusted_context\(\)/.test(sql));
  assert(/v_trusted IS NOT TRUE/.test(sql));
  assert(/current_setting\('api_e\.api_version', true\)[\s\S]{0,40}<> 'v1'/.test(sql));
  assert(
    /current_setting\('api_e\.capability_kind', true\)[\s\S]{0,40}<> 'command'/.test(sql),
  );
  assert(
    /current_setting\('api_e\.capability_key', true\)[\s\S]{0,60}<> 'execution_updates:append'/
      .test(sql),
  );
});

Deno.test("API-Q.9A3: only trusted external_api and mcp are accepted, else fail closed", () => {
  assert(/v_trusted_channel IS NULL/.test(sql), "missing channel must be rejected");
  assert(
    /v_trusted_channel NOT IN \('external_api','mcp'\)/.test(sql),
    "channel allowlist must be exactly external_api and mcp",
  );
  // Fail-closed branch returns not_authorized before any persistence/audit.
  const gate = sql.slice(
    sql.indexOf("v_trusted_channel NOT IN"),
    sql.indexOf("IF v_actor IS NULL"),
  );
  assert(gate.length > 0);
  assert(/'not_authorized'::public\.pmg_command_status/.test(gate));
  assert(!/INSERT INTO public\.execution_updates/.test(gate));
  assert(!/pmg_record_command_audit/.test(gate));
  // Ordering: the gate precedes persistence and audit in the function body.
  assert(
    sql.indexOf("v_trusted_channel NOT IN") <
      sql.indexOf("INSERT INTO public.execution_updates"),
  );
  assert(
    sql.indexOf("v_trusted_channel NOT IN") <
      sql.indexOf("public.pmg_record_command_audit"),
  );
});

Deno.test("API-Q.9A3: channel mapping external_api->external_api, mcp->mcp, default btpm_ui", () => {
  assert(
    /v_source_channel public\.pmg_source_channel := 'btpm_ui'::public\.pmg_source_channel/
      .test(sql),
    "non-OAuth/UI callers remain btpm_ui",
  );
  assert(
    /IF v_trusted_channel = 'external_api' THEN\s*v_source_channel := 'external_api'::public\.pmg_source_channel;\s*ELSE\s*v_source_channel := 'mcp'::public\.pmg_source_channel;\s*END IF;/
      .test(sql),
  );
});

Deno.test("API-Q.9A3: audit called once with server-derived channel and NULL integration", () => {
  const calls = sql.match(/public\.pmg_record_command_audit\(/g) ?? [];
  assertEquals(calls.length, 1);
  assert(
    /PERFORM public\.pmg_record_command_audit\(\s*'applied'::public\.pmg_command_status, 'append_execution_update',\s*v_source_channel,\s*v_project_id, 'execution_update', v_new_id, NULL,/
      .test(sql),
    "audit must receive v_source_channel and a NULL integration identity",
  );
});

Deno.test("API-Q.9A3: canonical business behavior preserved", () => {
  assert(/NOT public\.is_active_user\(v_actor\)/.test(sql));
  assert(/v_target_type NOT IN \('phase','task'\)/.test(sql));
  assert(/NOT public\.has_project_pm_authority\(v_actor, v_project_id\)/.test(sql));
  assert(/NOT public\.can_write_demo\(v_actor, v_workspace_id\)/.test(sql));
  assert(/'summary_required'/.test(sql));
  assert(/'invalid_update_date'/.test(sql));
  assert(/INSERT INTO public\.execution_updates/.test(sql));
  assert(/public\.pmg_build_result\(/.test(sql));
  assert(/_correlation_id, _idempotency_key/.test(sql));
});

// API-Q.9B2 update: the execution-update mutation is now the single exposed
// MCP mutation. The 9A3 invariant that still matters here is that its registry
// entry keeps confirmation mandatory and the canonical mutation class.
Deno.test("API-Q.9A3: the MCP execution-update mutation stays confirmation-gated", async () => {
  const registry = await Deno.readTextFile(
    new URL("btpm-mcp/mcp/toolRegistry.ts", FUNCTIONS_DIR),
  );
  const entry = registry.slice(
    registry.indexOf('toolName: "btpm_append_execution_update"'),
  ).slice(0, 800);
  assert(entry.length > 0, "registry must declare the execution-update operation");
  assert(
    /operationClass: "mutation"/.test(entry),
    "btpm_append_execution_update must remain classified as a mutation",
  );
  assert(
    /confirmation: "required"/.test(entry),
    "btpm_append_execution_update must remain confirmation-gated",
  );
});
