// API-Q.9A4 — static contract guard for the canonical Execution Update
// dual-source wrapper bridge.
//
// Repository/static test only: it locates the committed API-Q.9A4 migration by
// its unique marker (never by a hardcoded timestamped filename) and verifies the
// executable SQL. No database, network or Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const FUNCTIONS_DIR = new URL("../../functions/", import.meta.url);
const MARKER = "API-Q.9A4 — Canonical Execution Update dual-source wrapper bridge";

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
  assert(found.length >= 1, "expected at least one API-Q.9A4 migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

const REST_ARGS =
  "(text, text, uuid, text, date, text, text, text, text, text)";
const EXEC_ARGS =
  "(text, text, text, uuid, text, date, text, text, text, text, text)";

/** Body of a CREATE OR REPLACE FUNCTION block, by qualified name. */
function functionBody(qualifiedName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${qualifiedName}(`);
  assert(start >= 0, `${qualifiedName} must be defined`);
  const bodyStart = sql.indexOf("$function$", start);
  const bodyEnd = sql.indexOf("$function$;", bodyStart + 10);
  assert(bodyEnd > bodyStart, `${qualifiedName} body must terminate`);
  return sql.slice(bodyStart + 10, bodyEnd);
}

Deno.test("API-Q.9A4: exactly three function surfaces are defined", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_append_execution_update",
    "CREATE OR REPLACE FUNCTION public.api_v1_append_execution_update",
    "CREATE OR REPLACE FUNCTION public.mcp_v1_append_execution_update",
  ]);
  // Non-goals: no other canonical surface, table, policy or RLS change.
  for (const forbidden of [
    "CREATE OR REPLACE FUNCTION public.append_execution_update",
    "CREATE OR REPLACE FUNCTION public.pmg_record_command_audit",
    "CREATE OR REPLACE FUNCTION api_e_private.authorize_and_establish(",
    "CREATE OR REPLACE FUNCTION api_e_private.authorize_and_establish_mcp(",
    "CREATE OR REPLACE FUNCTION api_e_private.claim_idempotency",
    "CREATE TABLE",
    "ALTER TABLE",
    "CREATE POLICY",
    "DROP POLICY",
    "DROP FUNCTION",
  ]) {
    assert(!sql.includes(forbidden), `migration must not contain ${forbidden}`);
  }
});

Deno.test("API-Q.9A4: REST wrapper signature is unchanged", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_append_execution_update\(\s*_expected_oauth_client_id text,\s*_target_type text,\s*_target_id uuid,\s*_summary text,\s*_update_date date,\s*_status_label text,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb/
      .test(sql),
    "REST wrapper must keep its exact ten-argument signature and jsonb result",
  );
});

Deno.test("API-Q.9A4: MCP wrapper has the same ten-argument contract", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.mcp_v1_append_execution_update\(\s*_expected_oauth_client_id text,\s*_target_type text,\s*_target_id uuid,\s*_summary text,\s*_update_date date,\s*_status_label text,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb/
      .test(sql),
    "MCP wrapper must mirror the ten-argument contract and jsonb result",
  );
});

Deno.test("API-Q.9A4: neither public wrapper accepts a source-channel argument", () => {
  for (const name of [
    "public.api_v1_append_execution_update",
    "public.mcp_v1_append_execution_update",
  ]) {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
    const header = sql.slice(start, sql.indexOf("RETURNS jsonb", start));
    for (const forbidden of [
      "_execution_source",
      "_source_channel",
      "source_channel",
      "_channel",
      "_provenance",
      "_delegation",
    ]) {
      assert(
        !header.includes(forbidden),
        `${name} must not accept ${forbidden}`,
      );
    }
  }
});

Deno.test("API-Q.9A4: both wrappers are thin delegates with a hardcoded fixed source", () => {
  const rest = functionBody("public.api_v1_append_execution_update");
  const mcp = functionBody("public.mcp_v1_append_execution_update");

  assert(
    /RETURN api_e_private\.execute_v1_append_execution_update\(\s*'external_api',/
      .test(rest),
    "REST wrapper must delegate with the literal external_api source",
  );
  assert(!rest.includes("'mcp'"), "REST caller must never reach the mcp source");

  assert(
    /RETURN api_e_private\.execute_v1_append_execution_update\(\s*'mcp',/.test(mcp),
    "MCP wrapper must delegate with the literal mcp source",
  );
  assert(
    !mcp.includes("'external_api'"),
    "MCP wrapper must not select external_api",
  );

  // Thin: no authorization, containment, idempotency, PMG or persistence logic.
  for (const body of [rest, mcp]) {
    for (const forbidden of [
      "authorize_and_establish",
      "api_project_client_enablements",
      "claim_idempotency",
      "complete_idempotency",
      "fail_idempotency",
      "public.append_execution_update",
      "current_setting",
      "INSERT INTO",
      "pmg_record_command_audit",
    ]) {
      assert(!body.includes(forbidden), `thin wrapper must not contain ${forbidden}`);
    }
    // Exactly one delegation call.
    assertEquals(
      (body.match(/execute_v1_append_execution_update\(/g) ?? []).length,
      1,
    );
  }
});

Deno.test("API-Q.9A4: private executor fails closed on any other source and maps establishment", () => {
  const body = functionBody("api_e_private.execute_v1_append_execution_update");
  assert(
    /IF v_source IS NULL OR v_source NOT IN \('external_api','mcp'\) THEN\s*RETURN jsonb_build_object\('ok', false, 'outcome', 'not_authorized'\);/
      .test(body),
    "unknown internal source must fail closed before any other work",
  );
  // The source gate precedes establishment, enablement, idempotency and PMG.
  const gate = body.indexOf("v_source NOT IN");
  assert(gate >= 0);
  for (const later of [
    "authorize_and_establish",
    "api_project_client_enablements",
    "claim_idempotency",
    "public.append_execution_update",
  ]) {
    assert(gate < body.indexOf(later), `source gate must precede ${later}`);
  }
  // Source-selected establishment mapping.
  assert(
    /IF v_source = 'external_api' THEN[\s\S]*?api_e_private\.authorize_and_establish\(/
      .test(body),
    "external_api must call the canonical authorize_and_establish",
  );
  assert(
    /ELSE[\s\S]*?api_e_private\.authorize_and_establish_mcp\(/.test(body),
    "mcp must call authorize_and_establish_mcp",
  );
  assertEquals(
    (body.match(/api_e_private\.authorize_and_establish\(/g) ?? []).length,
    1,
    "exactly one canonical REST establishment call",
  );
  assertEquals(
    (body.match(/api_e_private\.authorize_and_establish_mcp\(/g) ?? []).length,
    1,
    "exactly one MCP establishment call",
  );
  assert(/IF v_trusted IS NOT TRUE THEN/.test(body));
});

Deno.test("API-Q.9A4: canonical controls exist exactly once, in the common executor", () => {
  for (const [needle, count] of [
    ["public.api_project_client_enablements", 1],
    ["api_e_private.claim_idempotency(", 1],
    ["public.append_execution_update(", 1],
    ["api_e_private.complete_idempotency(", 1],
    ["api_e_private.fail_idempotency(", 2], // not_authorized + invalid branches
  ] as const) {
    const found = sql.split(needle).length - 1;
    assertEquals(found, count, `${needle} must appear ${count}x in the migration`);
  }
  const body = functionBody("api_e_private.execute_v1_append_execution_update");
  for (const needle of [
    "public.api_project_client_enablements",
    "api_e_private.claim_idempotency(",
    "public.append_execution_update(",
    "api_e_private.complete_idempotency(",
    "api_e_private.fail_idempotency(",
  ]) {
    assert(body.includes(needle), `${needle} must live in the common executor`);
  }
});

Deno.test("API-Q.9A4: capability key, containment and PMG behavior are preserved", () => {
  const body = functionBody("api_e_private.execute_v1_append_execution_update");
  assert(
    /c_capability_key constant text := 'execution_updates:append'/.test(body),
    "capability key must remain exactly execution_updates:append",
  );
  assert(/c_api_version    constant text := 'v1'/.test(body));
  assert(/c_capability_kind constant text := 'command'/.test(body));
  // Authoritative scope derived only from the target.
  assert(/FROM public\.phases p/.test(body));
  assert(/FROM public\.tasks t/.test(body));
  assert(/v_target_type NOT IN \('phase','task'\)/.test(body));
  assert(/current_setting\('api_e\.tenant_id', true\)/.test(body));
  assert(/v_ctx_org_id IS DISTINCT FROM v_organization_id/.test(body));
  assert(/v_ctx_workspace_id IS DISTINCT FROM v_workspace_id/.test(body));
  // Idempotency outcomes.
  for (const outcome of [
    "idempotency_conflict",
    "idempotency_pending",
    "'replayed'",
    "'applied'",
    "'invalid'",
    "'not_authorized'",
  ]) {
    assert(body.includes(outcome), `bounded outcome ${outcome} must be preserved`);
  }
  // No dynamic dispatch, no confirmation in the database wrapper.
  for (const forbidden of [
    "EXECUTE ",
    "regprocedure",
    "operationId",
    "_confirm",
    "confirmation",
  ]) {
    assert(!body.includes(forbidden), `executor must not contain ${forbidden}`);
  }
});

Deno.test("API-Q.9A4: execution source never enters the payload hash or provenance write", () => {
  const body = functionBody("api_e_private.execute_v1_append_execution_update");
  assert(
    /claim_idempotency\(c_capability_key, _idempotency_key, _payload_hash\)/.test(
      body,
    ),
    "idempotency claim must use only capability key, key and payload hash",
  );
  assert(
    !/claim_idempotency\([^)]*v_source/.test(body),
    "the execution source must not be part of the idempotency contract",
  );
  assert(
    !/_payload_hash[^;]*v_source|v_source[^;]*_payload_hash/.test(body),
    "the execution source must not be mixed into the payload hash",
  );
  // Provenance is never written manually here.
  assert(!body.includes("set_config('api_e.source_channel'"));
  assert(!body.includes("pmg_record_command_audit"));
});

Deno.test("API-Q.9A4: privileges — private executor is unreachable, wrappers authenticated-only", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(
        `REVOKE ALL ON FUNCTION api_e_private.execute_v1_append_execution_update${EXEC_ARGS} FROM ${role};`,
      ),
      `private executor EXECUTE must be revoked from ${role}`,
    );
  }
  assert(
    !new RegExp(
      `GRANT[^;]*api_e_private\\.execute_v1_append_execution_update`,
    ).test(sql),
    "the private executor must never be granted to anyone",
  );

  for (const name of [
    "public.api_v1_append_execution_update",
    "public.mcp_v1_append_execution_update",
  ]) {
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(`REVOKE ALL ON FUNCTION ${name}${REST_ARGS} FROM ${role};`),
        `${name} must be revoked from ${role}`,
      );
    }
    assert(
      sql.includes(
        `GRANT EXECUTE ON FUNCTION ${name}${REST_ARGS} TO authenticated;`,
      ),
      `${name} must be executable by authenticated only`,
    );
  }
});

Deno.test("API-Q.9A4: all three functions are SECURITY DEFINER with a safe search_path", () => {
  assertEquals((sql.match(/SECURITY DEFINER/g) ?? []).length, 3);
  assertEquals(
    (sql.match(/SET search_path TO 'pg_catalog', 'public'/g) ?? []).length,
    3,
  );
});

// API-Q.9B2 update: the MCP mutation tool is now exposed, but the fixed-source
// database wrapper must still be reachable ONLY through the accepted API-Q.9A5
// adapter — never from the registry or the transport runtime.
Deno.test("API-Q.9A4: the MCP wrapper is never named outside the accepted adapter", async () => {
  const registry = await Deno.readTextFile(
    new URL("btpm-mcp/mcp/toolRegistry.ts", FUNCTIONS_DIR),
  );
  const entry = registry
    .slice(registry.indexOf('toolName: "btpm_append_execution_update"'))
    .slice(0, 800);
  assert(entry.length > 0, "registry must declare the execution-update operation");
  assert(
    /operationClass: "mutation"/.test(entry),
    "btpm_append_execution_update must remain classified as a mutation",
  );
  assert(
    !registry.includes("mcp_v1_append_execution_update"),
    "the MCP tool registry must not reference the new database wrapper",
  );
  const index = await Deno.readTextFile(
    new URL("btpm-mcp/index.ts", FUNCTIONS_DIR),
  );
  assert(
    !index.includes("mcp_v1_append_execution_update"),
    "btpm-mcp/index.ts must not reference the new database wrapper",
  );
});
