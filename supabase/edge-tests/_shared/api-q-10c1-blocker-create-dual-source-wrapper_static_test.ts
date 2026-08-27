// API-Q.10C1 — static contract guard for the canonical Blocker-create
// dual-source wrapper bridge.
//
// Repository/static test only: it locates the committed API-Q.10C1 migration by
// its unique marker (never by a hardcoded timestamped filename) and verifies the
// executable SQL. No database, network or Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const FUNCTIONS_DIR = new URL("../../functions/", import.meta.url);
const MARKER = "API-Q.10C1 — Blocker Create dual-source database wrapper bridge";

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
  assert(found.length >= 1, "expected at least one API-Q.10C1 migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

const PUBLIC_ARGS =
  "(text, text, uuid, text, text, text, text, text, text, text, text)";
const EXEC_ARGS =
  "(text, text, text, uuid, text, text, text, text, text, text, text, text)";

const PUBLIC_SIGNATURE = [
  "_expected_oauth_client_id text",
  "_target_type text",
  "_target_id uuid",
  "_title text",
  "_description text",
  "_severity text",
  "_status text",
  "_request_id text",
  "_correlation_id text",
  "_idempotency_key text",
  "_payload_hash text",
];

/** Body of a CREATE OR REPLACE FUNCTION block, by qualified name. */
function functionBody(qualifiedName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${qualifiedName}(`);
  assert(start >= 0, `${qualifiedName} must be defined`);
  const bodyStart = sql.indexOf("$function$", start);
  const bodyEnd = sql.indexOf("$function$;", bodyStart + 10);
  assert(bodyEnd > bodyStart, `${qualifiedName} body must terminate`);
  return sql.slice(bodyStart + 10, bodyEnd);
}

/** Argument list text of a CREATE OR REPLACE FUNCTION block. */
function functionArgs(qualifiedName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION ${qualifiedName}(`);
  assert(start >= 0, `${qualifiedName} must be defined`);
  const open = sql.indexOf("(", start);
  const close = sql.indexOf(")", open);
  return sql.slice(open + 1, close);
}

const execBody = functionBody("api_e_private.execute_v1_create_blocker");
const restBody = functionBody("public.api_v1_create_blocker");
const mcpBody = functionBody("public.mcp_v1_create_blocker");

Deno.test("API-Q.10C1: exactly three function surfaces are defined", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_create_blocker",
    "CREATE OR REPLACE FUNCTION public.api_v1_create_blocker",
    "CREATE OR REPLACE FUNCTION public.mcp_v1_create_blocker",
  ]);
});

Deno.test("API-Q.10C1: private executor has the exact fixed 12-argument signature", () => {
  const args = functionArgs("api_e_private.execute_v1_create_blocker")
    .split(",")
    .map((a) => a.trim().replace(/\s+/g, " "));
  assertEquals(args, ["_execution_source text", ...PUBLIC_SIGNATURE]);
});

Deno.test("API-Q.10C1: executor is SECURITY DEFINER with safe search_path", () => {
  const start = sql.indexOf(
    "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_create_blocker(",
  );
  const header = sql.slice(start, sql.indexOf("$function$", start));
  assert(/RETURNS jsonb/.test(header));
  assert(/SECURITY DEFINER/.test(header));
  assert(/SET search_path TO 'pg_catalog', 'public'/.test(header));
});

Deno.test("API-Q.10C1: execution source accepts exactly external_api | mcp", () => {
  assert(
    /IF v_source IS NULL OR v_source NOT IN \('external_api','mcp'\) THEN/.test(
      execBody,
    ),
    "fixed source allowlist must fail closed",
  );
  const literals = new Set(
    (execBody.match(
      /'(external_api|mcp|btpm_ui|admin_import|background_job|btpm_internal)'/g,
    ) ?? []).map((m) => m.slice(1, -1)),
  );
  assertEquals(literals, new Set(["external_api", "mcp"]));
});

Deno.test("API-Q.10C1: external_api establishes API-E, mcp establishes MCP context", () => {
  assert(
    /IF v_source = 'external_api' THEN[\s\S]*api_e_private\.authorize_and_establish\(/
      .test(execBody),
  );
  assert(
    /ELSE[\s\S]*api_e_private\.authorize_and_establish_mcp\(/.test(execBody),
  );
  assertEquals(
    (execBody.match(/api_e_private\.authorize_and_establish\(/g) ?? []).length,
    1,
  );
  assertEquals(
    (execBody.match(/api_e_private\.authorize_and_establish_mcp\(/g) ?? [])
      .length,
    1,
  );
  assert(/v_trusted IS NOT TRUE/.test(execBody));
});

Deno.test("API-Q.10C1: capability identity is exactly v1 / command / blockers:create", () => {
  assert(/c_api_version\s+constant text := 'v1'/.test(execBody));
  assert(/c_capability_kind constant text := 'command'/.test(execBody));
  assert(/c_capability_key constant text := 'blockers:create'/.test(execBody));
});

Deno.test("API-Q.10C1: target scope remains server-derived", () => {
  assert(/v_target_type NOT IN \('project','phase','task'\)/.test(execBody));
  assert(/FROM public\.projects p/.test(execBody));
  assert(/FROM public\.phases ph/.test(execBody));
  assert(/FROM public\.tasks t/.test(execBody));
  assert(/ph\.project_id = t\.project_id/.test(execBody));
});

Deno.test("API-Q.10C1: Project Connected App enablement remains enforced", () => {
  assert(/FROM public\.api_project_client_enablements e/.test(execBody));
  assert(/e\.lifecycle_status = 'enabled'/.test(execBody));
  assert(/v_enabled IS NOT TRUE/.test(execBody));
  assert(!/authorize_project_scope/.test(sql));
});

Deno.test("API-Q.10C1: API-F idempotency claim/complete/fail remain present", () => {
  assert(
    /api_e_private\.claim_idempotency\(c_capability_key, _idempotency_key, _payload_hash\)/
      .test(execBody),
  );
  assert(
    /api_e_private\.complete_idempotency\(v_claim\.registry_id, v_result\)/.test(
      execBody,
    ),
  );
  assert(
    /api_e_private\.fail_idempotency\(v_claim\.registry_id, 'not_authorized'\)/
      .test(execBody),
  );
  assert(
    /api_e_private\.fail_idempotency\(v_claim\.registry_id, 'invalid'\)/.test(
      execBody,
    ),
  );
});

Deno.test("API-Q.10C1: exactly one hardcoded public.apply_blocker_create call", () => {
  assertEquals(
    (execBody.match(/public\.apply_blocker_create\(/g) ?? []).length,
    1,
  );
  assertEquals((sql.match(/public\.apply_blocker_create\(/g) ?? []).length, 1);
});

Deno.test("API-Q.10C1: no dynamic RPC or function dispatch exists", () => {
  for (const forbidden of [
    "EXECUTE format",
    "regprocedure",
    "quote_ident",
    "execute_sql",
    "|| '('",
    "_function_name",
    "_rpc_name",
  ]) {
    assert(!sql.includes(forbidden), `must not contain ${forbidden}`);
  }
  assert(!/\bEXECUTE\s+['"v]/.test(sql), "no dynamic EXECUTE may exist");
});

Deno.test("API-Q.10C1: REST wrapper keeps its exact signature and fixes external_api", () => {
  const args = functionArgs("public.api_v1_create_blocker")
    .split(",")
    .map((a) => a.trim().replace(/\s+/g, " "));
  assertEquals(args, PUBLIC_SIGNATURE);
  assert(
    /api_e_private\.execute_v1_create_blocker\(\s*'external_api',/.test(
      restBody,
    ),
  );
  assert(!/'mcp'/.test(restBody));
});

Deno.test("API-Q.10C1: MCP wrapper mirrors the contract and fixes mcp", () => {
  assertEquals(
    functionArgs("public.mcp_v1_create_blocker").replace(/\s+/g, " ").trim(),
    functionArgs("public.api_v1_create_blocker").replace(/\s+/g, " ").trim(),
  );
  assert(/api_e_private\.execute_v1_create_blocker\(\s*'mcp',/.test(mcpBody));
  assert(!/'external_api'/.test(mcpBody));
});

Deno.test("API-Q.10C1: neither public wrapper accepts an execution source", () => {
  for (
    const name of [
      "public.api_v1_create_blocker",
      "public.mcp_v1_create_blocker",
    ]
  ) {
    assert(
      !functionArgs(name).includes("_execution_source"),
      `${name} must not expose _execution_source`,
    );
  }
});

Deno.test("API-Q.10C1: private executor is unreachable by every app role", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(
        `REVOKE ALL ON FUNCTION api_e_private.execute_v1_create_blocker${EXEC_ARGS} FROM ${role};`,
      ),
      `executor must be revoked from ${role}`,
    );
  }
  assert(
    !/GRANT EXECUTE ON FUNCTION api_e_private\.execute_v1_create_blocker/.test(
      sql,
    ),
    "executor must never be granted",
  );
});

Deno.test("API-Q.10C1: public wrappers are delegated-user only", () => {
  for (
    const fn of [
      "public.api_v1_create_blocker",
      "public.mcp_v1_create_blocker",
    ]
  ) {
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(`REVOKE ALL ON FUNCTION ${fn}${PUBLIC_ARGS} FROM ${role};`),
        `${fn} must be revoked from ${role}`,
      );
    }
    assert(
      sql.includes(
        `GRANT EXECUTE ON FUNCTION ${fn}${PUBLIC_ARGS} TO authenticated;`,
      ),
      `${fn} must grant authenticated`,
    );
  }
});

Deno.test("API-Q.10C1: Blocker narrative never enters generic metadata", () => {
  const pmgStart = execBody.indexOf("public.apply_blocker_create(");
  const pmgEnd = execBody.indexOf(");", pmgStart);
  const pmgCall = execBody.slice(pmgStart, pmgEnd);
  for (const narrative of ["_title", "_description"]) {
    const occurrences = (execBody.match(
      new RegExp(`(^|[^a-z0-9_])${narrative}([^a-z0-9_]|$)`, "g"),
    ) ?? []).length;
    const inPmg = (pmgCall.match(
      new RegExp(`(^|[^a-z0-9_])${narrative}([^a-z0-9_]|$)`, "g"),
    ) ?? []).length;
    assertEquals(
      occurrences,
      inPmg,
      `${narrative} must only appear in the PMG call`,
    );
  }
  assert(!/jsonb_build_object\([^)]*_title/.test(execBody));
  assert(!/v_result := jsonb_build_object\([\s\S]*_description/.test(execBody));
});

Deno.test("API-Q.10C1: execution source never enters payload, key or result", () => {
  assert(!/_payload_hash[^;]*v_source/.test(execBody));
  assert(!/_idempotency_key[^;]*v_source/.test(execBody));
  const resultStart = execBody.indexOf("v_result := jsonb_build_object(");
  const resultEnd = execBody.indexOf(");", resultStart);
  const result = execBody.slice(resultStart, resultEnd);
  assert(!result.includes("v_source"));
  assert(!result.includes("_execution_source"));
});

Deno.test("API-Q.10C1: no other canonical or security surface is touched", () => {
  for (
    const forbidden of [
      "apply_blocker_update",
      "api_v1_update_blocker",
      "mcp_v1_update_blocker",
      "execute_v1_update_blocker",
      "CREATE OR REPLACE FUNCTION public.apply_blocker_create",
      "apply_risk_create",
      "apply_risk_update",
      "CREATE POLICY",
      "DROP POLICY",
      "ALTER TABLE",
      "CREATE TABLE",
      "DROP FUNCTION",
      "api_capability_catalogue",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
  assert(
    !/encrypt|decrypt|tenant_encryption/i.test(sql),
    "encryption must be untouched",
  );
});

Deno.test("API-Q.10C1: blockers.create remains not_exposed and no MCP writer exists", async () => {
  const registry = await Deno.readTextFile(
    new URL("btpm-mcp/mcp/toolRegistry.ts", FUNCTIONS_DIR),
  );
  const at = registry.indexOf('operationId: "blockers.create"');
  assert(at >= 0, "registry must still declare blockers.create");
  // API-Q.10C4 exposed `blockers.create`; this step's durable invariant is the
  // canonical registry identity plus mandatory confirmation.
  const bounded = registry.slice(at, at + 400);
  assert(/toolName: "btpm_create_blocker"/.test(bounded));
  assert(/operationClass: "mutation"/.test(bounded));
  assert(/confirmation: "required"/.test(bounded));

  const factory = await Deno.readTextFile(
    new URL("btpm-mcp/mcp/serverFactory.ts", FUNCTIONS_DIR),
  );
  const index = await Deno.readTextFile(
    new URL("btpm-mcp/index.ts", FUNCTIONS_DIR),
  );
  const blocker = await Deno.readTextFile(
    new URL("_shared/btpm-api/supabaseBlocker.ts", FUNCTIONS_DIR),
  );
  // API-Q.10C2 added the fixed MCP Blocker-create RPC adapter, so the wrapper
  // name now appears exactly in the accepted adapter module — and nowhere in
  // the MCP registry, factory or transport runtime.
  for (const source of [factory, index]) {
    assert(
      !source.includes("mcp_v1_create_blocker"),
      "MCP runtime must not gain a Blocker-create writer in this step",
    );
  }
  assert(
    /const MCP_V1_CREATE_BLOCKER_FUNCTION_NAME = "mcp_v1_create_blocker"/.test(
      blocker,
    ),
    "the adapter names the MCP wrapper only through a fixed module constant",
  );
});
