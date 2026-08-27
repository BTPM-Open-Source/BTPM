// API-Q Task Plan Step 1 — static contract guard for the trusted MCP
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
const MARKER = "API-Q Task Plan Step 1 — Trusted MCP Database Bridge";

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
  assert(found.length >= 1, "expected at least one Task Plan bridge migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

const EXECUTOR_SIGNATURE =
  "api_e_private.execute_v1_plan_task(text, text, uuid, timestamptz, date, date, boolean, text, text, text, text)";
const WRAPPER_SIGNATURE =
  "(text, uuid, timestamptz, date, date, boolean, text, text, text, text)";

// A — exactly four function definitions.
Deno.test("Task Plan bridge: exactly four functions are (re)defined", () => {
  const created = (sql.match(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9.]+)/g) ?? [])
    .map((m) => m.replace(/CREATE OR REPLACE FUNCTION\s+/, ""));
  assertEquals(created.length, 4, "exactly four functions may be defined");
  assertEquals(
    new Set(created),
    new Set([
      "public.apply_task_planning_change",
      "api_e_private.execute_v1_plan_task",
      "public.api_v1_plan_task",
      "public.mcp_v1_plan_task",
    ]),
  );
});

// B — canonical overload signature unchanged.
Deno.test("Task Plan bridge: canonical 5-argument overload keeps its signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.apply_task_planning_change\(_task_id uuid, _expected_updated_at timestamp with time zone, _new_start date, _new_due date, _confirm_parent_extension boolean DEFAULT false\)/
      .test(sql),
    "5-argument canonical planning signature must be unchanged",
  );
});

// C — the 4-argument UI overload is untouched.
Deno.test("Task Plan bridge: the 4-argument UI overload is never recreated", () => {
  assert(
    !/CREATE OR REPLACE FUNCTION public\.apply_task_planning_change\(_task_id uuid, _new_start date/
      .test(sql),
    "the BTPM UI/internal overload must not be redefined",
  );
  assert(
    !/apply_task_planning_change\(uuid, date, date, boolean\)/.test(sql),
    "no grant/revoke/comment may target the 4-argument overload",
  );
});

// D — trusted source allowlist is exactly external_api|mcp.
Deno.test("Task Plan bridge: trusted source allowlist is exactly external_api and mcp", () => {
  assert(
    /v_trusted_channel NOT IN \('external_api','mcp'\)/.test(sql),
    "trusted channel allowlist must be exactly ('external_api','mcp')",
  );
  assert(
    sql.includes("v_trusted_channel IS NULL"),
    "NULL channel must be fail-closed",
  );
  assert(
    sql.includes(
      "v_trusted_channel := nullif(btrim(coalesce(current_setting('api_e.source_channel', true),'')),'')",
    ),
    "the source must be derived from trusted API-E context",
  );
  assert(
    sql.includes("api_e_private.assert_trusted_context()"),
    "trusted context assertion must remain",
  );
  assert(
    !/current_setting\('api_e\.source_channel', true\),''\)\), ''\) <> 'external_api'/
      .test(sql),
    "the external_api-only condition must be replaced",
  );
});

// E — no caller-supplied source on the canonical command or public wrappers.
Deno.test("Task Plan bridge: no caller-supplied source argument exists", () => {
  const canonical = /CREATE OR REPLACE FUNCTION public\.apply_task_planning_change\(([^)]*)\)/
    .exec(sql);
  assert(canonical !== null);
  assert(
    !(canonical?.[1] ?? "").includes("source"),
    "canonical command must not accept a source argument",
  );
  for (const fn of ["api_v1_plan_task", "mcp_v1_plan_task"]) {
    const match = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS jsonb`,
    ).exec(sql);
    assert(match !== null, `${fn} must be defined`);
    const args = match?.[1] ?? "";
    assert(
      !args.includes("_execution_source") && !args.includes("source"),
      `public.${fn} must not expose the execution-source selector`,
    );
  }
});

// F — capability identity.
Deno.test("Task Plan bridge: capability identity is hardcoded", () => {
  assert(sql.includes("c_api_version    constant text := 'v1';"));
  assert(sql.includes("c_capability_kind constant text := 'command';"));
  assert(sql.includes("c_capability_key constant text := 'tasks:plan';"));
  assert(sql.includes("<> 'tasks:plan'"), "exact capability containment must remain");
});

// G — untrusted source fails before Task lookup/lock/write.
Deno.test("Task Plan bridge: untrusted source fails before Task lookup", () => {
  const canonicalStart = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.apply_task_planning_change(",
  );
  const canonicalEnd = sql.indexOf("$function$;", canonicalStart);
  const body = sql.slice(canonicalStart, canonicalEnd);
  const guard = body.indexOf("v_trusted_channel NOT IN ('external_api','mcp')");
  const taskLookup = body.indexOf("FROM public.tasks");
  const lock = body.indexOf("FOR UPDATE");
  const write = body.indexOf("UPDATE public.tasks");
  assert(guard > 0, "guard must exist");
  assert(guard < taskLookup, "guard must precede the Task lookup");
  assert(guard < lock, "guard must precede the row lock");
  assert(guard < write, "guard must precede any write");
});

// H — canonical planning behaviour fragments remain.
Deno.test("Task Plan bridge: canonical planning semantics remain present", () => {
  for (const fragment of [
    "public.is_active_user(v_actor)",
    "public.is_workspace_admin_or_higher(v_actor, v_task.workspace_id)",
    "expected_updated_at_required",
    "FOR UPDATE",
    "v_task.updated_at IS DISTINCT FROM _expected_updated_at",
    "'stale_task_planning'",
    "task_completed_locked",
    "task_cancelled_or_archived",
    "invalid_range",
    "'no_change'::public.pmg_command_status",
    "extend_phase_window_required",
    "public._apply_phase_extension_internal(",
    "app.allow_planned_extension",
    "SET start_date = _new_start",
    "due_date   = _new_due",
    "'applied'::public.pmg_command_status",
  ]) {
    assert(sql.includes(fragment), `canonical fragment missing: ${fragment}`);
  }
});

// I — no PMG command audit is introduced.
Deno.test("Task Plan bridge: no PMG command audit is introduced", () => {
  assert(
    !sql.includes("pmg_record_command_audit"),
    "this legacy planning command must not gain PMG command audit",
  );
});

// J — private executor contract.
Deno.test("Task Plan bridge: private executor is source-fixed and canonical", () => {
  const start = sql.indexOf(
    "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_plan_task(",
  );
  assert(start > 0, "executor must be defined");
  const body = sql.slice(start, sql.indexOf("$function$;", start));

  const argsMatch = /CREATE OR REPLACE FUNCTION api_e_private\.execute_v1_plan_task\(\s*([^,]+),/
    .exec(body);
  assertEquals((argsMatch?.[1] ?? "").trim(), "_execution_source text");

  assert(
    /v_source NOT IN \('external_api','mcp'\)/.test(body),
    "executor must fail closed on any other source",
  );
  assert(body.includes("api_e_private.authorize_and_establish("));
  assert(body.includes("api_e_private.authorize_and_establish_mcp("));

  const enablement = body.indexOf("api_project_client_enablements");
  const claim = body.indexOf("claim_idempotency");
  assert(
    enablement > 0 && claim > 0 && enablement < claim,
    "Project enablement must be verified before claiming idempotency",
  );
  assert(body.includes("lifecycle_status = 'enabled'"));
  assert(body.includes("e.disabled_at IS NULL"));
  assert(body.includes("api_e_private.claim_idempotency(c_capability_key"));
  assert(body.includes("api_e_private.complete_idempotency("));
  assert(body.includes("api_e_private.fail_idempotency("));
  for (const decision of ["conflict", "pending", "replay", "execute"]) {
    assert(body.includes(`'${decision}'`), `decision ${decision} must be handled`);
  }

  // Confirmation-required replay behaviour: the confirmation result is stored
  // as a completed canonical result, so replay is deterministic.
  const confirmationBranch = body.indexOf("v_pmg_status = 'confirmation_required'");
  assert(confirmationBranch > 0);
  assert(
    body.slice(confirmationBranch).includes(
      "PERFORM api_e_private.complete_idempotency(v_claim.registry_id, v_result);",
    ),
    "confirmation_required must complete the idempotency record",
  );
  assert(
    body.includes(
      "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'stale_task_planning');",
    ),
    "stale planning must fail the idempotency record",
  );

  // Exactly one canonical 5-argument invocation, and no duplicated mutation.
  const calls = body.match(/public\.apply_task_planning_change\(/g) ?? [];
  assertEquals(calls.length, 1, "exactly one canonical command call");
  assert(body.includes("_expected_updated_at,\n    _new_start,"));
  assert(body.includes("COALESCE(_confirm_parent_extension, false)"));

  for (const forbidden of [
    "UPDATE public.tasks",
    "UPDATE public.phases",
    "UPDATE public.projects",
    "INSERT INTO public.tasks",
    "INSERT INTO public.phases",
    "DELETE FROM public.tasks",
    "DELETE FROM public.phases",
    "is_workspace_admin_or_higher",
    "_apply_phase_extension_internal",
    "pmg_record_command_audit",
  ]) {
    assert(
      !body.includes(forbidden),
      `executor must not contain ${forbidden}`,
    );
  }
});

// K — thin wrappers.
Deno.test("Task Plan bridge: public wrappers are thin and source-fixed", () => {
  assert(
    /public\.api_v1_plan_task\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_plan_task\(\s*'external_api',/
      .test(sql),
    "REST wrapper must delegate with fixed 'external_api'",
  );
  assert(
    /public\.mcp_v1_plan_task\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_plan_task\(\s*'mcp',/
      .test(sql),
    "MCP wrapper must delegate with fixed 'mcp'",
  );
  const rest = /CREATE OR REPLACE FUNCTION public\.api_v1_plan_task\(([\s\S]*?)\)\s*RETURNS jsonb/
    .exec(sql)?.[1] ?? "";
  const mcp = /CREATE OR REPLACE FUNCTION public\.mcp_v1_plan_task\(([\s\S]*?)\)\s*RETURNS jsonb/
    .exec(sql)?.[1] ?? "";
  assert(rest.trim().length > 0 && mcp.trim().length > 0);
  assertEquals(
    rest.replace(/\s+/g, " ").trim(),
    mcp.replace(/\s+/g, " ").trim(),
    "wrapper signatures must mirror exactly",
  );
});

// L — ACL.
Deno.test("Task Plan bridge: private executor is not callable by any app role", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(`REVOKE ALL ON FUNCTION ${EXECUTOR_SIGNATURE} FROM ${role};`),
      `${role} must be revoked on the private executor`,
    );
  }
  assert(
    !/GRANT EXECUTE ON FUNCTION api_e_private\.execute_v1_plan_task/.test(sql),
    "the private executor must never be granted",
  );
});

Deno.test("Task Plan bridge: wrapper grants are authenticated-only", () => {
  const grants = (sql.match(/GRANT[^;]*;/g) ?? []).map((g) =>
    g.replace(/\s+/g, " ").trim()
  );
  assertEquals(grants.length, 2, "exactly two grants may exist");
  assert(grants.every((g) => g.endsWith("TO authenticated;")));
  assert(!/GRANT[^;]*TO (PUBLIC|anon|service_role)/.test(sql));
  for (const fn of ["api_v1_plan_task", "mcp_v1_plan_task"]) {
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(
          `REVOKE ALL ON FUNCTION public.${fn}${WRAPPER_SIGNATURE} FROM ${role};`,
        ),
        `${role} must be revoked on public.${fn}`,
      );
    }
  }
});

// M — no generic dispatch / dynamic SQL.
Deno.test("Task Plan bridge: no dynamic SQL or generic dispatch", () => {
  for (const forbidden of [
    "EXECUTE format",
    "EXECUTE '",
    "quote_ident",
    "_function_name",
    "_rpc_name",
    "_table_name",
  ]) {
    assert(!sql.includes(forbidden), `migration must not contain ${forbidden}`);
  }
});

// Scope guard — no unrelated surface is touched.
Deno.test("Task Plan bridge: no unrelated surface is touched", () => {
  for (const forbidden of [
    "CREATE POLICY",
    "ALTER TABLE",
    "DROP FUNCTION",
    "CREATE TABLE",
    "reorder_tasks",
    "reorder_phases",
    "apply_task_update",
    "apply_task_create",
    "apply_phase_planning_change",
    "append_execution_update",
    "apply_blocker",
    "apply_risk",
    "toolRegistry",
  ]) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

// N — the MCP wrapper name never reaches the metadata-only registry.
Deno.test("Task Plan bridge: registry never references the MCP wrapper", async () => {
  const registry = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
  );
  assert(
    !registry.includes("mcp_v1_plan_task"),
    "registry must not reference the MCP wrapper",
  );
});

// O — the MCP wrapper name never leaks into factory or runtime in Step 1.
Deno.test("Task Plan bridge: the MCP wrapper name never leaks into factory or runtime", async () => {
  for (
    const path of [
      "../../functions/btpm-mcp/mcp/serverFactory.ts",
      "../../functions/btpm-mcp/index.ts",
    ]
  ) {
    const text = await Deno.readTextFile(new URL(path, import.meta.url));
    assert(
      !text.includes("mcp_v1_plan_task"),
      "the fixed MCP wrapper name must stay out of factory and runtime",
    );
  }
});
