// API-Q.9A2 — static contract guard for the API-client MCP audit provenance
// substrate in public.pmg_record_command_audit.
//
// Repository/static test only: it locates the committed API-Q.9A2 migration by
// its unique marker (never by a hardcoded timestamped filename) and verifies the
// executable SQL. No database, network or Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q.9A2 — API-Client MCP audit provenance substrate";

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
  assert(found.length >= 1, "expected at least one API-Q.9A2 migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

Deno.test("API-Q.9A2: only pmg_record_command_audit is redefined, signature unchanged", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION public.pmg_record_command_audit",
  ]);
  assert(
    /CREATE OR REPLACE FUNCTION public\.pmg_record_command_audit\(_status pmg_command_status, _command text, _source_channel pmg_source_channel, _project_id uuid, _target_type text, _target_id uuid, _integration_id uuid, _correlation_id text, _idempotency_key text, _metadata jsonb\)/
      .test(sql),
  );
  assert(/SECURITY DEFINER/.test(sql));
  assert(/SET search_path TO 'public', 'pg_temp'/.test(sql));
});

Deno.test("API-Q.9A2: external_api behavior preserved", () => {
  assert(/external_api must not supply an integration identity/.test(sql));
  assert(/external_api requires trusted API-E context/.test(sql));
  assert(/external_api requires api_e\.source_channel=external_api/.test(sql));
  assert(/external_api missing api_e\.authenticated_user_id/.test(sql));
  assert(/external_api missing api_e\.executing_user_id/.test(sql));
  assert(/external_api missing api_e\.api_client_id/.test(sql));
  assert(/external_api missing api_e\.request_id/.test(sql));
  assert(/external_api missing api_e\.capability_key/.test(sql));
  // external_api is never broadened to accept mcp.
  assert(!/_source_channel IN \('external_api', 'mcp'\)/.test(sql));
});

Deno.test("API-Q.9A2: legacy MCP integration mode still validates tenant_integrations", () => {
  assert(
    /IF v_integration_id IS NOT NULL AND _source_channel <> 'external_api' THEN[\s\S]{0,240}FROM public\.tenant_integrations ti/
      .test(sql),
  );
  assert(/integration % does not exist/.test(sql));
  assert(
    /IF _source_channel = 'mcp' THEN[\s\S]{0,160}integration % is not active/.test(sql),
  );
});

Deno.test("API-Q.9A2: new MCP mode is selected only by a null integration identity", () => {
  assert(
    /v_apiq_mcp boolean := \(_source_channel = 'mcp' AND _integration_id IS NULL\);/.test(sql),
  );
  // Missing integration identity must never fall through as anonymous/system MCP.
  assert(!/channel % requires an integration identity/.test(sql));
});

Deno.test("API-Q.9A2: new MCP mode requires a trusted API-E mcp context (NULL-safe)", () => {
  assert(
    sql.includes(
      "current_setting('api_e.trusted', true) IS DISTINCT FROM 'true'",
    ),
  );
  assert(
    sql.includes(
      "current_setting('api_e.source_channel', true) IS DISTINCT FROM 'mcp'",
    ),
  );
  assert(/mcp requires trusted API-E context/.test(sql));
  assert(/mcp requires api_e\.source_channel=mcp/.test(sql));
});

Deno.test("API-Q.9A2: new MCP mode requires the full trusted identity set", () => {
  assert(/mcp missing api_e\.authenticated_user_id/.test(sql));
  assert(/mcp missing api_e\.executing_user_id/.test(sql));
  assert(/mcp missing api_e\.api_client_id/.test(sql));
  assert(/mcp missing api_e\.request_id/.test(sql));
  assert(/mcp missing api_e\.capability_key/.test(sql));
  assert(/mcp requires a delegated-user identity/.test(sql));
});

Deno.test("API-Q.9A2: new MCP provenance is api_clients-based with no integration identity", () => {
  const branch = sql.slice(sql.indexOf("ELSIF v_apiq_mcp THEN"));
  assert(branch.includes("FROM public.api_clients ac"));
  assert(!branch.includes("tenant_integrations"));
  assert(branch.includes("v_delegation_mode := 'delegated_user';"));
  assert(branch.includes("v_source_system := v_client_key;"));
  assert(branch.includes("v_source_component := v_capability_key;"));
  assert(branch.includes("api_client % is not active"));
  assert(branch.includes("api_client % has blank client_key"));
  assert(branch.includes("client_key exceeds 128 characters"));
  assert(
    sql.includes(
      "CASE WHEN _source_channel = 'external_api' OR v_apiq_mcp THEN NULL ELSE v_integration_id END",
    ),
    "API-Q MCP audit rows must persist a NULL integration identity",
  );
  // actor_id remains auth.uid()-derived.
  assert(/v_actor uuid := auth\.uid\(\);/.test(sql));
});

Deno.test("API-Q.9A2: provenance never comes from caller metadata or new arguments", () => {
  const branch = sql.slice(
    sql.indexOf("ELSIF v_apiq_mcp THEN"),
    sql.indexOf("INSERT INTO public.pmg_command_audit"),
  );
  assert(!branch.includes("v_metadata"));
  assert(!branch.includes("_metadata"));
  const header = sql.slice(
    sql.indexOf("public.pmg_record_command_audit("),
    sql.indexOf("RETURNS uuid"),
  );
  for (const forbidden of [
    "api_client",
    "requested_user",
    "executing_user",
    "source_system",
    "source_component",
    "capability",
  ]) {
    assert(!header.includes(forbidden), `must not accept ${forbidden} argument`);
  }

});

Deno.test("API-Q.9A2: no other surface is touched and no MCP mutation is exposed", () => {
  for (const forbidden of [
    "append_execution_update",
    "authorize_and_establish",
    "api_idempotency_registry",
    "CREATE POLICY",
    "ALTER TABLE",
    "DROP FUNCTION",
    "GRANT",
  ]) {
    assert(!sql.includes(forbidden), `migration must not reference ${forbidden}`);
  }
  const registry = Deno.readTextFileSync(
    new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
  );
  assert(!registry.includes("pmg_record_command_audit"));
  assert(
    !/exposed:\s*true[\s\S]{0,200}mutation/.test(registry) ||
      !registry.includes("btpm_append_execution_update: { exposed: true"),
  );
});
