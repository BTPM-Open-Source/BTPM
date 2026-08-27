// API-Q.10B1 — static contract guard for the Risk Update trusted MCP database
// bridge (apply_risk_update channel allowlist + dual-source wrapper bridge).
//
// Repository/static test only: it locates the committed API-Q.10B1 migration by
// its unique marker (never by a hardcoded timestamped filename) and verifies the
// executable SQL. No database, network or Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const FUNCTIONS_DIR = new URL("../../functions/", import.meta.url);
const MARKER = "API-Q.10B1 — Risk Update Trusted MCP Database Bridge";

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
  assert(found.length >= 1, "expected at least one API-Q.10B1 migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

const PUBLIC_ARGS =
  "(text, uuid, timestamptz, text, text, text, text, text, text, text, text, text, text)";
const EXEC_ARGS =
  "(text, text, uuid, timestamptz, text, text, text, text, text, text, text, text, text, text)";

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
  let depth = 0;
  let i = open;
  for (; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  return sql.slice(open + 1, i);
}

const canonicalBody = functionBody("public.apply_risk_update");
const execBody = functionBody("api_e_private.execute_v1_update_risk");
const restBody = functionBody("public.api_v1_update_risk");
const mcpBody = functionBody("public.mcp_v1_update_risk");

// ---------------------------------------------------------------------------
// Surface inventory
// ---------------------------------------------------------------------------

Deno.test("API-Q.10B1: exactly four function surfaces are defined", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION public.apply_risk_update",
    "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_risk",
    "CREATE OR REPLACE FUNCTION public.api_v1_update_risk",
    "CREATE OR REPLACE FUNCTION public.mcp_v1_update_risk",
  ]);
});

// ---------------------------------------------------------------------------
// A. apply_risk_update trusted channels
// ---------------------------------------------------------------------------

Deno.test("API-Q.10B1-A: canonical command keeps its exact signature and posture", () => {
  assert(
    sql.includes(
      "CREATE OR REPLACE FUNCTION public.apply_risk_update(_risk_id uuid, _expected_updated_at timestamp with time zone, _title text, _description text DEFAULT NULL::text, _mitigation_plan text DEFAULT NULL::text, _likelihood text DEFAULT NULL::text, _impact text DEFAULT NULL::text, _status text DEFAULT NULL::text, _user_links jsonb DEFAULT '[]'::jsonb, _object_links jsonb DEFAULT '[]'::jsonb, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text)",
    ),
    "apply_risk_update signature must be preserved verbatim",
  );
  assert(canonicalBody.length > 0);
  const header = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.apply_risk_update("),
    sql.indexOf("$function$"),
  );
  assert(header.includes("SECURITY DEFINER"));
  assert(header.includes("SET search_path TO 'pg_catalog', 'public'"));
  // No caller-controlled source argument was added.
  assert(!functionArgs("public.apply_risk_update").includes("_source"));
  assert(!functionArgs("public.apply_risk_update").includes("_execution_source"));
});

Deno.test("API-Q.10B1-A: trusted channel allowlist is exactly external_api|mcp", () => {
  assert(canonicalBody.includes("api_e_private.assert_trusted_context()"));
  assert(
    canonicalBody.includes("v_trusted_channel NOT IN ('external_api','mcp')"),
    "channel allowlist must be exactly external_api|mcp",
  );
  assert(canonicalBody.includes("v_trusted_channel IS NULL"));
  assert(
    canonicalBody.includes(
      "current_setting('api_e.source_channel', true)",
    ),
    "channel must be read from trusted API-E context only",
  );
  assert(
    canonicalBody.includes(
      "IF v_trusted_channel = 'external_api' THEN\n      v_source_channel := 'external_api'::public.pmg_source_channel;\n    ELSE\n      v_source_channel := 'mcp'::public.pmg_source_channel;\n    END IF;",
    ),
    "channel mapping must be a fixed two-branch mapping",
  );
});

Deno.test("API-Q.10B1-A: capability identity and untrusted context fail closed", () => {
  assert(canonicalBody.includes("current_setting('api_e.api_version', true)"));
  assert(canonicalBody.includes("<> 'v1'"));
  assert(canonicalBody.includes("current_setting('api_e.capability_kind', true)"));
  assert(canonicalBody.includes("<> 'command'"));
  assert(canonicalBody.includes("current_setting('api_e.capability_key', true)"));
  assert(canonicalBody.includes("<> 'risks:update'"));
  assert(canonicalBody.includes("IF v_trusted IS NOT TRUE"));

  // The fail-closed return precedes every Risk read, write, decrypt and audit.
  const failClosed = canonicalBody.indexOf(
    "'not_authorized'::public.pmg_command_status, 'apply_risk_update'",
  );
  assert(failClosed > 0);
  for (
    const forbidden of [
      "FROM public.risks WHERE id = _risk_id FOR UPDATE",
      "UPDATE public.risks SET",
      "public.btpm_decrypt(",
      "public.pmg_record_command_audit(",
      "DELETE FROM public.entity_user_links",
    ]
  ) {
    const at = canonicalBody.indexOf(forbidden);
    assert(at > failClosed, `${forbidden} must occur after the fail-closed gate`);
  }
});

Deno.test("API-Q.10B1-A: btpm_ui default remains when no external client exists", () => {
  assert(
    canonicalBody.includes(
      "v_source_channel public.pmg_source_channel := 'btpm_ui'::public.pmg_source_channel;",
    ),
    "UI default channel must be preserved",
  );
  assert(canonicalBody.includes("v_client_id := api_e_private.jwt_client_id();"));
  assert(canonicalBody.includes("IF v_client_id IS NOT NULL THEN"));
});

Deno.test("API-Q.10B1-A: both conflict and applied audits use the derived channel", () => {
  const conflictAudit = canonicalBody.indexOf(
    "'conflict'::public.pmg_command_status, 'apply_risk_update',\n      v_source_channel,",
  );
  const appliedAudit = canonicalBody.indexOf(
    "'applied'::public.pmg_command_status, 'apply_risk_update',\n    v_source_channel,",
  );
  assert(conflictAudit > 0, "stale-conflict audit must use v_source_channel");
  assert(appliedAudit > 0, "applied audit must use v_source_channel");
  // No literal channel is ever passed to the audit helper.
  assert(!canonicalBody.includes("pmg_record_command_audit(\n      'conflict'::public.pmg_command_status, 'apply_risk_update',\n      'external_api'"));
});

// ---------------------------------------------------------------------------
// B. dual-source wrapper structure
// ---------------------------------------------------------------------------

Deno.test("API-Q.10B1-B: private executor has the fixed 14-argument signature", () => {
  const args = functionArgs("api_e_private.execute_v1_update_risk")
    .split(",")
    .map((a) => a.trim().replace(/\s+/g, " "));
  assertEquals(args, [
    "_execution_source text",
    "_expected_oauth_client_id text",
    "_risk_id uuid",
    "_expected_updated_at timestamptz",
    "_title text",
    "_description text",
    "_mitigation_plan text",
    "_likelihood text",
    "_impact text",
    "_status text",
    "_request_id text",
    "_correlation_id text",
    "_idempotency_key text",
    "_payload_hash text",
  ]);
});

Deno.test("API-Q.10B1-B: private executor accepts only external_api|mcp", () => {
  assert(
    execBody.includes(
      "IF v_source IS NULL OR v_source NOT IN ('external_api','mcp') THEN",
    ),
  );
  const gate = execBody.indexOf("v_source NOT IN ('external_api','mcp')");
  const auth = execBody.indexOf("api_e_private.authorize_and_establish");
  assert(gate < auth, "source selector must gate before authorization");
});

Deno.test("API-Q.10B1-B: each source uses its own authorization helper", () => {
  assert(execBody.includes("IF v_source = 'external_api' THEN"));
  const externalBranch = execBody.slice(
    execBody.indexOf("IF v_source = 'external_api' THEN"),
    execBody.indexOf("ELSE\n    BEGIN\n      v_trusted := api_e_private.authorize_and_establish_mcp("),
  );
  assert(
    externalBranch.includes("api_e_private.authorize_and_establish(") &&
      !externalBranch.includes("authorize_and_establish_mcp("),
    "external_api must use authorize_and_establish",
  );
  assert(
    execBody.includes("v_trusted := api_e_private.authorize_and_establish_mcp("),
    "mcp must use authorize_and_establish_mcp",
  );
});

Deno.test("API-Q.10B1-B: capability identity is fixed at v1/command/risks:update", () => {
  assert(execBody.includes("c_api_version    constant text := 'v1';"));
  assert(execBody.includes("c_capability_kind constant text := 'command';"));
  assert(execBody.includes("c_capability_key constant text := 'risks:update';"));
  assert(!execBody.includes("'risks:create'"));
});

Deno.test("API-Q.10B1-B: REST wrapper is thin and hardcodes external_api", () => {
  assert(restBody.includes("RETURN api_e_private.execute_v1_update_risk(\n    'external_api',"));
  assert(!restBody.includes("'mcp'"));
  assert(!restBody.includes("apply_risk_update"));
  const args = functionArgs("public.api_v1_update_risk")
    .split(",")
    .map((a) => a.trim().replace(/\s+/g, " "));
  assertEquals(args.length, 13);
  assertEquals(args[0], "_expected_oauth_client_id text");
  assert(!args.some((a) => a.includes("source")));
});

Deno.test("API-Q.10B1-B: MCP wrapper is thin and hardcodes mcp", () => {
  assert(mcpBody.includes("RETURN api_e_private.execute_v1_update_risk(\n    'mcp',"));
  assert(!mcpBody.includes("'external_api'"));
  assert(!mcpBody.includes("apply_risk_update"));
  const args = functionArgs("public.mcp_v1_update_risk")
    .split(",")
    .map((a) => a.trim().replace(/\s+/g, " "));
  assertEquals(
    args,
    functionArgs("public.api_v1_update_risk")
      .split(",")
      .map((a) => a.trim().replace(/\s+/g, " ")),
    "MCP wrapper must share the exact public contract",
  );
  assert(!args.some((a) => a.includes("source")));
});

Deno.test("API-Q.10B1-B: no generic dispatch anywhere in the migration", () => {
  for (
    const forbidden of [
      "EXECUTE format",
      "EXECUTE '",
      "regprocedure",
      "quote_ident",
      "CASE _command",
      "current_setting('api_e.source_channel', true)::public.pmg_source_channel",
    ]
  ) {
    assert(!sql.includes(forbidden), `${forbidden} must not appear`);
  }
  // Exactly one canonical business command CALL exists, inside the executor
  // (the second textual occurrence is the canonical definition itself).
  const calls = sql.match(/public\.apply_risk_update\(/g) ?? [];
  assertEquals(calls.length, 2);
  assert(sql.includes("CREATE OR REPLACE FUNCTION public.apply_risk_update("));
  assert(execBody.includes("v_pmg := public.apply_risk_update("));
  assertEquals((execBody.match(/public\.apply_risk_update\(/g) ?? []).length, 1);

});

// ---------------------------------------------------------------------------
// C. concurrency preservation
// ---------------------------------------------------------------------------

Deno.test("API-Q.10B1-C: expectedUpdatedAt stays in every public signature", () => {
  assert(functionArgs("public.api_v1_update_risk").includes("_expected_updated_at timestamptz"));
  assert(functionArgs("public.mcp_v1_update_risk").includes("_expected_updated_at timestamptz"));
  assert(
    functionArgs("public.apply_risk_update").includes(
      "_expected_updated_at timestamp with time zone",
    ),
  );
});

Deno.test("API-Q.10B1-C: the caller timestamp flows through unchanged", () => {
  for (const body of [restBody, mcpBody]) {
    assert(
      /execute_v1_update_risk\(\s*'(external_api|mcp)',\s*_expected_oauth_client_id,\s*_risk_id,\s*_expected_updated_at,/
        .test(body),
      "wrapper must forward _expected_updated_at unchanged",
    );
  }
  assert(
    /apply_risk_update\(\s*_risk_id,\s*_expected_updated_at,/.test(execBody),
    "executor must forward _expected_updated_at unchanged",
  );
  // No substitution, refresh or retry of the expected timestamp.
  assert(!execBody.includes("_expected_updated_at :="));
  assert(!execBody.includes("v_expected_updated_at"));
  assert(!/SELECT[^;]*updated_at[^;]*INTO/.test(execBody));
  assert(!execBody.includes("LOOP"));
  assert(!execBody.includes("now()"));
});

Deno.test("API-Q.10B1-C: stale_risk remains a bounded supported result", () => {
  assert(
    execBody.includes(
      "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'stale_risk');",
    ),
  );
  assert(
    execBody.includes(
      "jsonb_build_object('ok', false, 'outcome', 'conflict', 'code', 'stale_risk')",
    ),
  );
  assert(execBody.includes("IF v_claim.failure_code = 'stale_risk' THEN"));
  assert(
    canonicalBody.includes("IF v_row.updated_at IS DISTINCT FROM _expected_updated_at THEN"),
    "canonical command remains the sole concurrency authority",
  );
});

// ---------------------------------------------------------------------------
// D. existing semantics
// ---------------------------------------------------------------------------

Deno.test("API-Q.10B1-D: Project Connected App gate precedes idempotency", () => {
  const gate = execBody.indexOf("FROM public.api_project_client_enablements e");
  const claim = execBody.indexOf("api_e_private.claim_idempotency(");
  assert(gate > 0 && claim > gate, "enablement gate must precede idempotency claim");
  assert(execBody.includes("e.lifecycle_status = 'enabled'"));
  assert(execBody.includes("e.disabled_at IS NULL"));
});

Deno.test("API-Q.10B1-D: idempotency identity and states are unchanged", () => {
  assert(
    execBody.includes(
      "FROM api_e_private.claim_idempotency(c_capability_key, _idempotency_key, _payload_hash) c",
    ),
  );
  for (
    const state of [
      "'idempotency_conflict'",
      "'idempotency_pending'",
      "'replayed'",
      "api_e_private.complete_idempotency(",
      "api_e_private.fail_idempotency(",
    ]
  ) {
    assert(execBody.includes(state), `${state} must be preserved`);
  }
});

Deno.test("API-Q.10B1-D: complete existing links are reconstructed, never mutated", () => {
  assert(execBody.includes("WHERE r.id = _risk_id\n     FOR UPDATE"));
  assert(execBody.includes("eul.link_role = 'related_person'"));
  assert(execBody.includes("eol.link_role = 'related_object'"));
  assert(execBody.includes("v_user_links,\n    v_object_links,"));
  // The executor performs no link or Risk mutation itself.
  for (
    const forbidden of [
      "DELETE FROM public.entity_user_links",
      "DELETE FROM public.entity_object_links",
      "INSERT INTO public.entity_user_links",
      "INSERT INTO public.entity_object_links",
      "UPDATE public.risks",
    ]
  ) {
    assert(!execBody.includes(forbidden), `${forbidden} must not appear in the executor`);
  }
  assert(!execBody.includes("'[]'::jsonb,\n    '[]'::jsonb,"), "links must never be reset");
});

Deno.test("API-Q.10B1-D: bounded canonical result carries no narrative", () => {
  const resultStart = execBody.indexOf("v_result := jsonb_build_object(");
  const resultEnd = execBody.indexOf(");", resultStart);
  const result = execBody.slice(resultStart, resultEnd);
  for (const narrative of ["title", "description", "mitigation"]) {
    assert(!result.includes(narrative), `${narrative} must not enter the canonical result`);
  }
  for (
    const field of ["'riskId'", "'targetType'", "'targetId'", "'likelihood'", "'impact'", "'status'", "'updatedAt'"]
  ) {
    assert(result.includes(field), `${field} must remain in the bounded result`);
  }
});

Deno.test("API-Q.10B1-D: PMG audit metadata stays narrative-free", () => {
  const auditStart = canonicalBody.indexOf(
    "'applied'::public.pmg_command_status, 'apply_risk_update',",
  );
  const auditEnd = canonicalBody.indexOf("RETURN public.pmg_build_result(", auditStart);
  const audit = canonicalBody.slice(auditStart, auditEnd);
  assert(audit.includes("'has_description', (v_description IS NOT NULL)"));
  assert(audit.includes("'has_mitigation_plan', (v_mitigation IS NOT NULL)"));
  assert(!audit.includes("'title', v_title"));
  assert(!audit.includes("'description', v_description"));
  assert(!audit.includes("'mitigation_plan', v_mitigation"));
  // Only diff KEYS may be audited, never old/new narrative values.
  assert(
    audit.includes("'changed_fields', ARRAY(SELECT jsonb_object_keys(v_scalar_diff))"),
    "audit may carry changed field names only",
  );
  assert(!audit.includes("'diff', v_scalar_diff"));
  assert(!audit.includes("jsonb_each(v_scalar_diff)"));

});

Deno.test("API-Q.10B1-D: encryption path is untouched", () => {
  // Narrative is written as plaintext columns through the existing trigger.
  assert(
    canonicalBody.includes("description     = v_description,") &&
      canonicalBody.includes("mitigation_plan = v_mitigation,"),
  );
  for (
    const forbidden of [
      "btpm_encrypt(",
      "CREATE OR REPLACE TRIGGER",
      "CREATE TRIGGER",
      "organization_encryption_keys",
      "tenant_encryption_keys",
    ]
  ) {
    assert(!sql.includes(forbidden), `${forbidden} must not appear`);
  }
});

Deno.test("API-Q.10B1-D: no RLS policy or table change is bundled", () => {
  for (
    const forbidden of ["CREATE POLICY", "DROP POLICY", "ALTER TABLE", "CREATE TABLE", "DROP FUNCTION"]
  ) {
    assert(!sql.includes(forbidden), `${forbidden} must not appear`);
  }
});

// ---------------------------------------------------------------------------
// E. permissions
// ---------------------------------------------------------------------------

Deno.test("API-Q.10B1-E: private executor is revoked from every role", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(
        `REVOKE ALL ON FUNCTION api_e_private.execute_v1_update_risk${EXEC_ARGS} FROM ${role};`,
      ),
      `executor must be revoked from ${role}`,
    );
  }
  assert(
    !sql.includes(`GRANT EXECUTE ON FUNCTION api_e_private.execute_v1_update_risk`),
    "executor must never be granted",
  );
});

Deno.test("API-Q.10B1-E: both public wrappers are authenticated-only", () => {
  for (const fn of ["public.api_v1_update_risk", "public.mcp_v1_update_risk"]) {
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(`REVOKE ALL ON FUNCTION ${fn}${PUBLIC_ARGS} FROM ${role};`),
        `${fn} must be revoked from ${role}`,
      );
    }
    assert(
      sql.includes(`GRANT EXECUTE ON FUNCTION ${fn}${PUBLIC_ARGS} TO authenticated;`),
      `${fn} must be granted only to authenticated`,
    );
  }
});

// ---------------------------------------------------------------------------
// Intentional non-work: no MCP exposure or runtime wiring in this step.
// ---------------------------------------------------------------------------

// API-Q.10B4 exposed and wired `risks.update`. What must still hold for this
// database-bridge step is that the registry entry keeps its canonical identity
// and concurrency contract, and that the MCP wrapper name never leaks into the
// MCP server factory.
Deno.test("API-Q.10B1: the risks.update registry entry keeps its canonical contract", async () => {
  const registry = await Deno.readTextFile(
    new URL("btpm-mcp/mcp/toolRegistry.ts", FUNCTIONS_DIR),
  );
  const entryStart = registry.indexOf('operationId: "risks.update"');
  assert(entryStart > 0, "risks.update must remain declared in the registry");
  const entry = registry.slice(entryStart, registry.indexOf("}),", entryStart));
  assert(entry.includes('toolName: "btpm_update_risk"'));
  assert(entry.includes('operationClass: "mutation"'));
  assert(entry.includes('confirmation: "required"'));
  assert(entry.includes('concurrencyToken: "required"'));

  const factory = await Deno.readTextFile(
    new URL("btpm-mcp/mcp/serverFactory.ts", FUNCTIONS_DIR),
  );
  assert(!factory.includes("mcp_v1_update_risk"));
  assert(!factory.includes("createClient"));
});


Deno.test("API-Q.10B1: the MCP Risk-update control layer stays out of the database bridge", async () => {
  // API-Q.10B2 introduced the caller-bound executor + fixed TypeScript
  // adapter; API-Q.10B3 introduced the control/composition module. What must
  // still hold is that the control module performs no registration and no
  // database wrapper work of its own.
  const tool = await Deno.readTextFile(
    new URL("btpm-mcp/mcp/riskUpdateMutationTool.ts", FUNCTIONS_DIR),
  );
  for (const forbidden of [".rpc(", "createClient", "Deno.env", "registerTool"]) {
    assert(!tool.includes(forbidden), `control module references ${forbidden}`);
  }
});

