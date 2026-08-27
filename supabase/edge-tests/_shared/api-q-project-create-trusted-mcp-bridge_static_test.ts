// API-Q Project Create Step 1 — static contract guard for the trusted MCP
// database bridge.
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename), takes the latest one as
// the effective definition, and verifies the executable SQL.
//
// No database access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q Project Create Step 1 — Trusted MCP Database Bridge";

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
  assert(found.length >= 1, "expected at least one Project Create bridge migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

/** Replace single-quoted literals (API-N.5 precedent: executable SQL only). */
function stripSqlStrings(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    if (sql[i] === "'") {
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      out += " '' ";
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);
/** Comment- and literal-free SQL: no descriptive text can satisfy a guard. */
const execSql = stripSqlStrings(sql);


/** Isolate the body of a named function definition. */
function functionBody(name: string): string {
  const at = sql.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  assert(at >= 0, `${name} definition not found`);
  const start = sql.indexOf("$function$", at);
  assert(start > at, `${name} body opening tag not found`);
  const end = sql.indexOf("$function$", start + 10);
  assert(end > start, `${name} body closing tag not found`);
  return sql.slice(start + 10, end);
}

// ---------------------------------------------------------------------------
// A. Canonical PMG
// ---------------------------------------------------------------------------

Deno.test("Project Create bridge: exactly the four expected functions are (re)defined", () => {
  const created = (sql.match(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9.]+)/g) ?? [])
    .map((m) => m.replace(/CREATE OR REPLACE FUNCTION\s+/, ""));
  assertEquals(new Set(created), new Set([
    "public.apply_project_create_blank",
    "api_e_private.execute_v1_create_project",
    "public.api_v1_create_project",
    "public.mcp_v1_create_project",
  ]));
});

Deno.test("Project Create bridge: canonical command keeps its exact signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.apply_project_create_blank\(_name text, _workspace_id uuid, _program_id uuid DEFAULT NULL::uuid, _delivery_model project_delivery_model DEFAULT NULL::project_delivery_model, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)/
      .test(sql),
    "apply_project_create_blank signature must be unchanged",
  );
});

Deno.test("Project Create bridge: canonical command accepts external_api and mcp only", () => {
  const body = functionBody("public.apply_project_create_blank");
  assert(
    /v_trusted_channel NOT IN \('external_api','mcp'\)/.test(body),
    "trusted channel allowlist must be exactly ('external_api','mcp')",
  );
  assert(body.includes("v_trusted_channel IS NULL"), "NULL channel must fail closed");
  assert(
    body.includes("api_e_private.assert_trusted_context()"),
    "trusted context assertion must remain",
  );
  assert(body.includes("<> 'projects:create'"), "exact capability containment must remain");
  assert(
    !/v_trusted_channel <> 'external_api'/.test(body),
    "the external_api-only condition must be replaced",
  );
  // No caller-controlled source parameter exists on the canonical command.
  const header = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.apply_project_create_blank"),
    sql.indexOf("$function$"),
  );
  assert(!/_source_channel/i.test(header), "no caller-supplied source channel parameter");
  assert(!/_execution_source/i.test(header), "no caller-supplied execution source parameter");
});

Deno.test("Project Create bridge: ordinary UI stays btpm_ui and channels map to provenance", () => {
  const body = functionBody("public.apply_project_create_blank");
  assert(
    /v_source_channel public\.pmg_source_channel := 'btpm_ui'::public\.pmg_source_channel/
      .test(body),
    "ordinary UI execution must remain btpm_ui",
  );
  assert(body.includes("'external_api'::public.pmg_source_channel"));
  assert(body.includes("'mcp'::public.pmg_source_channel"));
  assert(
    /pmg_record_command_audit\([\s\S]*?v_source_channel/.test(body),
    "PMG audit provenance must be the server-derived channel",
  );
});

Deno.test("Project Create bridge: canonical business delegate and protections remain", () => {
  const body = functionBody("public.apply_project_create_blank");
  assert(
    /v_new_id := public\.create_blank_project\(/.test(body),
    "canonical business delegate must remain create_blank_project",
  );
  assert(body.includes("public.is_active_user(v_actor)"), "active-user guard must remain");
  assert(body.includes("public.can_write_demo(v_actor, v_ws_id)"), "demo-write guard must remain");
  assert(body.includes("FROM public.workspaces"), "Workspace validation must remain");
  assert(
    body.includes("'Project name is required'") &&
      body.includes("'Project name must be 200 characters or less'"),
    "Project name validation mapping must remain",
  );
  assert(
    body.includes("'Program must belong to the same workspace as the project'"),
    "Program containment mapping must remain",
  );
});

// ---------------------------------------------------------------------------
// B. Private executor
// ---------------------------------------------------------------------------

Deno.test("Project Create bridge: private executor has the exact ten-argument signature", () => {
  const at = sql.indexOf("CREATE OR REPLACE FUNCTION api_e_private.execute_v1_create_project");
  assert(at >= 0, "private executor must be defined");
  const header = sql.slice(at, sql.indexOf("$function$", at));
  const params = [
    "_execution_source text",
    "_expected_oauth_client_id text",
    "_workspace_id uuid",
    "_name text",
    "_program_id uuid",
    "_delivery_model text",
    "_request_id text",
    "_correlation_id text",
    "_idempotency_key text",
    "_payload_hash text",
  ];
  for (const p of params) assert(header.includes(p), `executor signature missing ${p}`);
  const declared = header.slice(header.indexOf("(") + 1, header.indexOf(")"))
    .split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  assertEquals(declared.length, 10, "executor must take exactly ten arguments");
  assert(/RETURNS jsonb/.test(header));
  assert(/LANGUAGE plpgsql/.test(header));
  assert(/SECURITY DEFINER/.test(header));
  assert(/SET search_path TO 'pg_catalog', 'public'/.test(header), "search_path must be hardened");
  assert(!/_tenant_id/i.test(header), "no caller-supplied tenant id");
  assert(!/_organization_id/i.test(header), "no caller-supplied organization id");
});

Deno.test("Project Create bridge: capability and api version are hardcoded", () => {
  assert(sql.includes("c_api_version    constant text := 'v1';"));
  assert(sql.includes("c_capability_kind constant text := 'command';"));
  assert(sql.includes("c_capability_key constant text := 'projects:create';"));
});

Deno.test("Project Create bridge: private executor selects a fixed source", () => {
  const body = functionBody("api_e_private.execute_v1_create_project");
  assert(
    /v_source NOT IN \('external_api','mcp'\)/.test(body),
    "executor must fail closed on any other source",
  );
  assert(
    body.includes("api_e_private.authorize_and_establish("),
    "external_api branch must use the REST establishment helper",
  );
  assert(
    body.includes("api_e_private.authorize_and_establish_mcp("),
    "mcp branch must use the MCP establishment helper",
  );
  assert(
    body.indexOf("IF v_source = 'external_api' THEN") <
      body.indexOf("api_e_private.authorize_and_establish_mcp("),
    "the helper selection must be a fixed source branch",
  );
});

Deno.test("Project Create bridge: Workspace/Organization scope is derived server-side", () => {
  const body = functionBody("api_e_private.execute_v1_create_project");
  assert(/FROM public\.workspaces w/.test(body), "must read public.workspaces");
  assert(/w\.id = _workspace_id/.test(body), "Workspace lookup keys on _workspace_id");
  assert(/w\.organization_id/.test(body), "Organization must be derived from the Workspace");
  assert(/w\.is_active IS TRUE/.test(body) && /w\.is_archived IS NOT TRUE/.test(body));
  const derivationAt = body.indexOf("FROM public.workspaces w");
  const authorizeAt = body.indexOf("api_e_private.authorize_and_establish");
  assert(derivationAt > 0 && authorizeAt > derivationAt, "derivation precedes authorization");
});

Deno.test("Project Create bridge: trusted context is re-confirmed after authorization", () => {
  const body = functionBody("api_e_private.execute_v1_create_project");
  for (
    const setting of [
      "api_e.api_client_id",
      "api_e.tenant_id",
      "api_e.organization_id",
      "api_e.workspace_id",
      "api_e.api_version",
      "api_e.capability_kind",
      "api_e.capability_key",
      "api_e.source_channel",
    ]
  ) {
    assert(body.includes(setting), `trusted context must verify ${setting}`);
  }
  assert(
    /current_setting\('api_e\.source_channel', true\)[\s\S]{0,80}IS DISTINCT FROM v_source/
      .test(body),
    "established source channel must match the fixed execution source",
  );
  const verifyAt = body.indexOf("api_e.api_client_id");
  const claimAt = body.indexOf("claim_idempotency");
  assert(verifyAt > 0 && claimAt > verifyAt, "context verification precedes idempotency");
});

Deno.test("Project Create bridge: API-F idempotency lifecycle is preserved", () => {
  const body = functionBody("api_e_private.execute_v1_create_project");
  assert(body.includes("api_e_private.claim_idempotency(c_capability_key"));
  assert(body.includes("api_e_private.complete_idempotency("));
  assert(body.includes("api_e_private.fail_idempotency("));
  for (const decision of ["conflict", "pending", "replay", "execute"]) {
    assert(body.includes(`'${decision}'`), `decision ${decision} must be handled`);
  }
  assert(body.includes("'idempotency_conflict'") && body.includes("'idempotency_pending'"));
  assert(body.includes("'outcome', 'replayed'"), "completed replay must be canonical");
  assert(
    body.includes("fail_idempotency(v_claim.registry_id, 'not_authorized')") &&
      body.includes("fail_idempotency(v_claim.registry_id, 'invalid')"),
    "bounded canonical failures must be persisted",
  );
  const replayAt = body.indexOf("'replay'");
  const replayBlock = body.slice(replayAt, body.indexOf("'execute'", replayAt));
  assert(
    !replayBlock.includes("apply_project_create_blank"),
    "replay path must not invoke the canonical command",
  );
});

Deno.test("Project Create bridge: exactly one canonical business mutation call", () => {
  const definitions = sql.match(/CREATE OR REPLACE FUNCTION public\.apply_project_create_blank\(/g) ?? [];
  const occurrences = sql.match(/public\.apply_project_create_blank\(/g) ?? [];
  assertEquals(definitions.length, 1, "the command must be redefined exactly once");
  assertEquals(
    occurrences.length - definitions.length,
    1,
    "the executor must call the command exactly once",
  );
  assert(sql.includes("v_pmg := public.apply_project_create_blank("));

  const body = functionBody("api_e_private.execute_v1_create_project");
  assert(
    !/public\.create_blank_project\s*\(/.test(body),
    "the executor must not call create_blank_project directly",
  );
  assert(!/INSERT\s+INTO\s+public\.projects\b/i.test(body), "no direct Project insert");
  assert(!/UPDATE\s+public\.projects\b/i.test(body), "no direct Project update");
  assert(!/\bEXECUTE\b/.test(body), "no dynamic SQL / PLpgSQL EXECUTE");
  assert(!/\bformat\s*\(/.test(body), "no SQL text construction");
  assert(!/regprocedure/.test(body), "no function-OID dispatch");
});

// ---------------------------------------------------------------------------
// C. Project Create special rule — no Connected-App enablement
// ---------------------------------------------------------------------------

Deno.test("Project Create bridge: no Project Connected-App enablement path exists", () => {
  assert(
    !/api_project_client_enablements/i.test(execSql),
    "executable SQL must never reference api_project_client_enablements",
  );
  assert(
    !/enable_project[a-z_]*\s*\(/i.test(execSql),
    "no Project-enablement RPC/helper call permitted",
  );
  assert(
    !/(INSERT\s+INTO|UPDATE)\s+[a-z_.]*enablement/i.test(execSql),
    "no enablement writes permitted",
  );
});

// ---------------------------------------------------------------------------
// D. Wrappers
// ---------------------------------------------------------------------------

Deno.test("Project Create bridge: public wrappers are thin and source-fixed", () => {
  assert(
    /public\.api_v1_create_project\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_create_project\(\s*'external_api',/
      .test(sql),
    "REST wrapper must delegate with fixed 'external_api'",
  );
  assert(
    /public\.mcp_v1_create_project\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_create_project\(\s*'mcp',/
      .test(sql),
    "MCP wrapper must delegate with fixed 'mcp'",
  );

  const params = [
    "_expected_oauth_client_id text",
    "_workspace_id uuid",
    "_name text",
    "_program_id uuid",
    "_delivery_model text",
    "_request_id text",
    "_correlation_id text",
    "_idempotency_key text",
    "_payload_hash text",
  ];
  for (const fn of ["api_v1_create_project", "mcp_v1_create_project"]) {
    const match = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS jsonb`,
    ).exec(sql);
    assert(match !== null, `${fn} must be defined`);
    const header = match?.[1] ?? "";
    for (const p of params) assert(header.includes(p), `public.${fn} missing ${p}`);
    assertEquals(
      header.split(",").map((s) => s.trim()).filter((s) => s.length > 0).length,
      9,
      `public.${fn} must expose exactly nine arguments`,
    );
    assert(
      !header.includes("_execution_source") && !/_source_channel/i.test(header),
      `public.${fn} must not expose the execution-source selector`,
    );

    // Thin: no duplicated authorization, derivation, idempotency or business logic.
    const body = functionBody(`public.${fn}`);
    for (
      const forbidden of [
        "authorize_and_establish",
        "claim_idempotency",
        "complete_idempotency",
        "fail_idempotency",
        "public.workspaces",
        "apply_project_create_blank",
        "create_blank_project",
        "current_setting",
      ]
    ) {
      assert(!body.includes(forbidden), `public.${fn} must not contain ${forbidden}`);
    }
  }
});

Deno.test("Project Create bridge: private executor is not callable by any app role", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(
        `REVOKE ALL ON FUNCTION api_e_private.execute_v1_create_project(text, text, uuid, text, uuid, text, text, text, text, text) FROM ${role};`,
      ),
      `${role} must be revoked on the private executor`,
    );
  }
  assert(
    !/GRANT EXECUTE ON FUNCTION api_e_private\.execute_v1_create_project/.test(sql),
    "the private executor must never be granted",
  );
});

Deno.test("Project Create bridge: wrapper grants are authenticated-only", () => {
  const grants = (sql.match(/GRANT[^;]*;/g) ?? []).map((g) => g.replace(/\s+/g, " ").trim());
  assertEquals(grants.length, 2, "exactly two grants may exist");
  assert(grants.every((g) => g.endsWith("TO authenticated;")));
  assert(!/GRANT[^;]*TO (PUBLIC|anon|service_role)/.test(sql));
  for (const fn of ["api_v1_create_project", "mcp_v1_create_project"]) {
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(
          `REVOKE ALL ON FUNCTION public.${fn}(text, uuid, text, uuid, text, text, text, text, text) FROM ${role};`,
        ),
        `${role} must be revoked on public.${fn}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// E. Privacy / bounded result contract
// ---------------------------------------------------------------------------

Deno.test("Project Create bridge: the success result is bounded to ok/outcome/projectId", () => {
  const body = functionBody("api_e_private.execute_v1_create_project");
  const successAt = body.indexOf("'outcome', 'applied'");
  assert(successAt > 0, "applied result object not found");
  const start = body.lastIndexOf("jsonb_build_object", successAt);
  const block = body.slice(start, body.indexOf(")", successAt) + 1);
  const keys = [...block.matchAll(/'([A-Za-z]+)'\s*,/g)].map((m) => m[1])
    .filter((k) => k !== "applied");
  assertEquals(new Set(keys), new Set(["ok", "outcome", "projectId"]));
});

Deno.test("Project Create bridge: negative results are bounded to ok/outcome", () => {
  const body = functionBody("api_e_private.execute_v1_create_project");
  const negatives = [
    "'invalid'",
    "'not_authorized'",
    "'idempotency_conflict'",
    "'idempotency_pending'",
  ];
  for (const outcome of negatives) {
    const needle = `jsonb_build_object('ok', false, 'outcome', ${outcome})`;
    assert(body.includes(needle), `negative outcome ${outcome} must be bounded`);
  }
  const objects = [...body.matchAll(/jsonb_build_object\(([\s\S]*?)\)/g)].map((m) => m[1]);
  for (const obj of objects) {
    for (
      const forbidden of [
        "'name'",
        "'projectName'",
        "'narrative'",
        "'workspaceId'",
        "'tenantId'",
        "'organizationId'",
        "'programId'",
        "'capability'",
        "'grant'",
        "btpm_decrypt",
      ]
    ) {
      assert(!obj.includes(forbidden), `result must not expose ${forbidden}`);
    }
  }
});

Deno.test("Project Create bridge: no concurrency or stale-project behavior is introduced", () => {
  for (
    const forbidden of [
      "_expected_updated_at",
      "stale_project",
      "'stale'",
      "concurrency_token",
      "confirmation_required",
    ]
  ) {
    assert(!sql.includes(forbidden), `Project Create must not introduce ${forbidden}`);
  }
});

Deno.test("Project Create bridge: no unrelated surface is touched", () => {
  for (
    const forbidden of [
      "CREATE POLICY",
      "ALTER TABLE",
      "DROP FUNCTION",
      "CREATE TABLE",
      "apply_project_update",
      "apply_project_status_transition",
      "api_v1_update_project",
      "mcp_v1_update_project",
      "apply_program",
      "portfolio",
      "toolRegistry",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

Deno.test("Project Create bridge: the registry never names the MCP wrapper", async () => {
  const registry = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
  );
  // Exposure of `projects.create` is owned by Step 4; the durable bridge
  // invariant is that the database wrapper name never reaches the
  // metadata-only registry.
  assert(
    !registry.includes("mcp_v1_create_project"),
    "registry must not reference the MCP wrapper",
  );
});
