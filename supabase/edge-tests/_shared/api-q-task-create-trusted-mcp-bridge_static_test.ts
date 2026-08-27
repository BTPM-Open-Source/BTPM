// API-Q Task Create Step 1 — static contract guard for the trusted MCP
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
const MARKER = "API-Q Task Create Step 1 — Trusted MCP Database Bridge";

const EXECUTOR_ARGS =
  "text, text, uuid, text, text, text, text, text, date, date, numeric, integer, text, text, text, text";
const WRAPPER_ARGS =
  "text, uuid, text, text, text, text, text, date, date, numeric, integer, text, text, text, text";

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
  assert(found.length >= 1, "expected at least one Task Create bridge migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

Deno.test("Task Create bridge: exactly four functions are (re)defined", () => {
  const created = (sql.match(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9.]+)/g) ?? [])
    .map((m) => m.replace(/CREATE OR REPLACE FUNCTION\s+/, ""));
  assertEquals(created.length, 4);
  assertEquals(
    new Set(created),
    new Set([
      "public.apply_task_create",
      "api_e_private.execute_v1_create_task",
      "public.api_v1_create_task",
      "public.mcp_v1_create_task",
    ]),
  );
});

Deno.test("Task Create bridge: canonical command keeps its exact signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.apply_task_create\(_phase_id uuid, _name text, _description text DEFAULT NULL::text, _status pm_status DEFAULT 'planned'::pm_status, _priority pm_priority DEFAULT 'medium'::pm_priority, _task_type task_type DEFAULT 'work_item'::task_type, _start_date date DEFAULT NULL::date, _due_date date DEFAULT NULL::date, _estimated_hours numeric DEFAULT NULL::numeric, _sort_order integer DEFAULT NULL::integer, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)/
      .test(sql),
    "apply_task_create signature must be unchanged",
  );
});

Deno.test("Task Create bridge: canonical command accepts external_api and mcp only", () => {
  assert(
    /v_trusted_channel NOT IN \('external_api','mcp'\)/.test(sql),
    "trusted channel allowlist must be exactly ('external_api','mcp')",
  );
  assert(
    sql.includes("v_trusted_channel IS NULL"),
    "NULL channel must be fail-closed",
  );
  assert(
    sql.includes("api_e_private.assert_trusted_context()"),
    "trusted context assertion must remain",
  );
  assert(
    sql.includes("<> 'tasks:create'"),
    "exact capability containment must remain",
  );
  assert(
    !/current_setting\('api_e\.source_channel', true\),''\)\),''\), ''\) <> 'external_api'/
      .test(sql),
    "the external_api-only condition must be replaced",
  );
  // The trusted source channel is never a function argument.
  assert(
    !/_source_channel[a-z_]* (text|public\.pmg_source_channel)(,|\))/.test(sql),
    "no public function may accept a source channel argument",
  );
});

Deno.test("Task Create bridge: ordinary internal/UI execution stays btpm_ui", () => {
  assert(
    sql.includes(
      "v_source_channel public.pmg_source_channel := 'btpm_ui'::public.pmg_source_channel;",
    ),
    "default provenance must remain btpm_ui",
  );
  assert(sql.includes("'external_api'::public.pmg_source_channel"));
  assert(sql.includes("'mcp'::public.pmg_source_channel"));
});

Deno.test("Task Create bridge: exactly one PMG audit record, server-derived channel", () => {
  const audits = sql.match(/public\.pmg_record_command_audit\(/g) ?? [];
  assertEquals(audits.length, 1, "exactly one audit record may be written");
  assert(
    /public\.pmg_record_command_audit\(\s*'applied'::public\.pmg_command_status, 'apply_task_create',\s*v_source_channel,/
      .test(sql),
    "audit must receive the server-derived source channel",
  );
});

Deno.test("Task Create bridge: private executor selects a fixed source", () => {
  assert(
    /CREATE OR REPLACE FUNCTION api_e_private\.execute_v1_create_task\(\s*_execution_source text,/
      .test(sql),
    "executor must take an internal execution-source selector first",
  );
  assert(
    /v_source NOT IN \('external_api','mcp'\)/.test(sql),
    "executor must fail closed on any other source",
  );
  assert(
    /IF v_source = 'external_api' THEN\s*BEGIN\s*v_trusted := api_e_private\.authorize_and_establish\(/
      .test(sql),
    "external_api branch must use the REST establishment helper only",
  );
  assert(
    /ELSE\s*BEGIN\s*v_trusted := api_e_private\.authorize_and_establish_mcp\(/.test(
      sql,
    ),
    "mcp branch must use the MCP establishment helper only",
  );
  assertEquals(
    (sql.match(/api_e_private\.authorize_and_establish\(/g) ?? []).length,
    1,
  );
  assertEquals(
    (sql.match(/api_e_private\.authorize_and_establish_mcp\(/g) ?? []).length,
    1,
  );
});

Deno.test("Task Create bridge: capability and api version are hardcoded", () => {
  assert(sql.includes("c_api_version    constant text := 'v1';"));
  assert(sql.includes("c_capability_kind constant text := 'command';"));
  assert(sql.includes("c_capability_key constant text := 'tasks:create';"));
  assert(
    !/capability_key\s*:?=\s*_/.test(sql),
    "capability must never be caller-supplied",
  );
});

Deno.test("Task Create bridge: exactly one canonical business mutation call", () => {
  const definitions = sql.match(/CREATE OR REPLACE FUNCTION public\.apply_task_create\(/g) ?? [];
  const occurrences = sql.match(/public\.apply_task_create\(/g) ?? [];
  assertEquals(definitions.length, 1, "the command must be redefined exactly once");
  assertEquals(
    occurrences.length - definitions.length,
    1,
    "the executor must call the command exactly once",
  );
  assert(sql.includes("v_pmg := public.apply_task_create("));
  // No generic dispatch anywhere.
  assert(
    !/\bEXECUTE\b(?!\s+ON\s+FUNCTION)/.test(sql),
    "no PL/pgSQL EXECUTE dynamic dispatch",
  );
  for (const forbidden of ["regprocedure", "format("]) {
    assert(!sql.includes(forbidden), `no dynamic dispatch (${forbidden})`);
  }
});

Deno.test("Task Create bridge: Phase/Project structural containment remains", () => {
  assert(sql.includes("FROM public.phases ph"));
  assert(sql.includes("FROM public.projects p"));
  assert(sql.includes("v_workspace_id IS DISTINCT FROM v_row_workspace_id"));
  assert(sql.includes("v_organization_id IS DISTINCT FROM v_row_organization_id"));
  assert(sql.includes("v_ctx_org_id IS DISTINCT FROM v_organization_id"));
  assert(sql.includes("v_ctx_workspace_id IS DISTINCT FROM v_workspace_id"));
  // TOCTOU lock on the target Phase.
  assert(sql.includes("v_locked_project_id IS DISTINCT FROM v_project_id"));
  assert(/WHERE ph\.id = _phase_id\s*FOR UPDATE/.test(sql));
});

Deno.test("Task Create bridge: idempotency lifecycle is preserved", () => {
  assert(sql.includes("api_e_private.claim_idempotency(c_capability_key"));
  assert(sql.includes("api_e_private.complete_idempotency("));
  assert(sql.includes("api_e_private.fail_idempotency("));
  for (
    const outcome of [
      "idempotency_conflict",
      "idempotency_pending",
      "replayed",
    ]
  ) {
    assert(sql.includes(`'${outcome}'`), `${outcome} must be handled`);
  }
  for (const decision of ["conflict", "pending", "replay", "execute"]) {
    assert(sql.includes(`'${decision}'`), `decision ${decision} must be handled`);
  }
});

Deno.test("Task Create bridge: enablement and context checks precede idempotency", () => {
  const enablement = sql.indexOf("api_project_client_enablements");
  const claim = sql.indexOf("claim_idempotency");
  assert(
    enablement > 0 && claim > 0 && enablement < claim,
    "project enablement must be verified before claiming idempotency",
  );
  assert(sql.includes("lifecycle_status = 'enabled'"));
  assert(sql.includes("e.enabled_at IS NOT NULL"));
  assert(sql.includes("e.disabled_at IS NULL"));
});

Deno.test("Task Create bridge: confirmation code and no Phase widening", () => {
  assert(sql.includes("'extend_phase_window_required'"));
  assert(
    !/UPDATE public\.phases/.test(sql),
    "the bridge must never widen the Phase",
  );
  assert(
    !sql.includes("_apply_phase_extension_internal"),
    "no automatic Phase extension may be invoked",
  );
});

Deno.test("Task Create bridge: Task narrative never leaves the trusted boundary", () => {
  // The canonical result projection carries no name/description.
  const projections = sql.match(/'ok', true,[\s\S]*?\);/g) ?? [];
  assertEquals(projections.length, 1, "one applied projection must exist");
  const applied = projections[0] ?? "";
  assert(!/'name'/.test(applied), "no Task name in the returned result");
  assert(!/'description'/.test(applied), "no Task narrative in the returned result");
  assert(applied.includes("'taskId'"));
  assert(applied.includes("'shiftedSiblingCount'"));

  // Audit metadata carries presence flags only.
  assert(sql.includes("'has_description', (v_description IS NOT NULL)"));
  const audit = /pmg_record_command_audit\([\s\S]*?\n  \);/.exec(sql)?.[0] ?? "";
  assert(audit.length > 0, "audit call must be locatable");
  assert(!/'name', /.test(audit), "no Task name in audit metadata");
  assert(
    !/'description', v_/.test(audit),
    "no Task narrative in audit metadata",
  );

  // Encryption stays with the existing protected write/read path.
  assert(sql.includes("public.btpm_decrypt(v_new_row.description"));
});

Deno.test("Task Create bridge: public wrappers are thin and source-fixed", () => {
  assert(
    /public\.api_v1_create_task\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_create_task\(\s*'external_api',/
      .test(sql),
    "REST wrapper must delegate with fixed 'external_api'",
  );
  assert(
    /public\.mcp_v1_create_task\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_create_task\(\s*'mcp',/
      .test(sql),
    "MCP wrapper must delegate with fixed 'mcp'",
  );
  for (const fn of ["api_v1_create_task", "mcp_v1_create_task"]) {
    const match = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS jsonb`,
    ).exec(sql);
    assert(match !== null, `${fn} must be defined`);
    assert(
      !(match?.[1] ?? "").includes("_execution_source"),
      `public.${fn} must not expose the execution-source selector`,
    );
    assert(
      /RETURNS jsonb\s*LANGUAGE plpgsql\s*SECURITY DEFINER\s*SET search_path TO 'pg_catalog', 'public'/
        .test(sql.slice(sql.indexOf(`public.${fn}(\n`))),
      `public.${fn} must be SECURITY DEFINER with a locked search path`,
    );
  }
  // Both wrappers reach the same single private executor.
  assertEquals(
    (sql.match(/RETURN api_e_private\.execute_v1_create_task\(/g) ?? []).length,
    2,
  );
});

Deno.test("Task Create bridge: private executor is not callable by any app role", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(
        `REVOKE ALL ON FUNCTION api_e_private.execute_v1_create_task(${EXECUTOR_ARGS}) FROM ${role};`,
      ),
      `${role} must be revoked on the private executor`,
    );
  }
  assert(
    !/GRANT EXECUTE ON FUNCTION api_e_private\.execute_v1_create_task/.test(sql),
    "the private executor must never be granted",
  );
});

Deno.test("Task Create bridge: wrapper grants are authenticated-only", () => {
  const grants = (sql.match(/GRANT[^;]*;/g) ?? []).map((g) =>
    g.replace(/\s+/g, " ").trim()
  );
  assertEquals(grants.length, 2, "exactly two grants may exist");
  assert(grants.every((g) => g.endsWith("TO authenticated;")));
  assert(!/GRANT[^;]*TO (PUBLIC|anon|service_role)/.test(sql));
  for (const fn of ["api_v1_create_task", "mcp_v1_create_task"]) {
    assert(
      sql.includes(
        `GRANT EXECUTE ON FUNCTION public.${fn}(${WRAPPER_ARGS}) TO authenticated;`,
      ),
      `public.${fn} must be granted to authenticated`,
    );
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(
          `REVOKE ALL ON FUNCTION public.${fn}(${WRAPPER_ARGS}) FROM ${role};`,
        ),
        `${role} must be revoked on public.${fn}`,
      );
    }
  }
});

Deno.test("Task Create bridge: no unrelated surface is touched", () => {
  for (
    const forbidden of [
      "CREATE POLICY",
      "ALTER POLICY",
      "ALTER TABLE",
      "CREATE TABLE",
      "DROP FUNCTION",
      "apply_task_update",
      "api_v1_update_task",
      "mcp_v1_update_task",
      "apply_task_reorder",
      "mcp_v1_reorder_tasks",
      "apply_task_plan",
      "mcp_v1_plan_task",
      "apply_task_assign",
      "mcp_v1_assign_task",
      "apply_task_transition",
      "mcp_v1_transition_task",
      "apply_phase_create",
      "toolRegistry",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

Deno.test("Task Create bridge: no MCP tool surface is introduced", async () => {
  const registry = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
  );
  // The durable bridge invariant is that the database wrapper name never
  // reaches the metadata-only registry.
  assert(
    !registry.includes("mcp_v1_create_task"),
    "registry must not reference the MCP wrapper",
  );
});
