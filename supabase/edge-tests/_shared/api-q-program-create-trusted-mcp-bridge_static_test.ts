// API-Q Program Create Step 1 — static contract guard for the trusted MCP
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
const MARKER = "API-Q Program Create Step 1 — Trusted MCP Database Bridge";

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
  assert(found.length >= 1, "expected at least one Program Create bridge migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

const EXECUTOR_ARGS = "text, text, uuid, text, text, text, text, text, text";
const WRAPPER_ARGS = "text, uuid, text, text, text, text, text, text";

// ---------------------------------------------------------------------------
// A. Migration / function scope
// ---------------------------------------------------------------------------

Deno.test("Program Create bridge: the marker exists in the migration", () => {
  assert(migration.text.includes(MARKER), "marker must be present");
});

Deno.test("Program Create bridge: exactly the intended functions are (re)defined", () => {
  const created = (sql.match(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9.]+)/g) ?? [])
    .map((m) => m.replace(/CREATE OR REPLACE FUNCTION\s+/, ""));
  assertEquals(created.length, 4, "exactly four functions may be (re)defined");
  assertEquals(
    new Set(created),
    new Set([
      "public.apply_program_create",
      "api_e_private.execute_v1_create_program",
      "public.api_v1_create_program",
      "public.mcp_v1_create_program",
    ]),
  );
});

Deno.test("Program Create bridge: historical Program migrations are untouched", async () => {
  for (
    const historical of [
      "20260812112914_a8b5eb6c-ffea-449f-812e-46262706ba66.sql",
      "20260812114626_44519d81-f60b-456b-808e-1bf7fe48b12d.sql",
    ]
  ) {
    const text = await Deno.readTextFile(new URL(historical, MIGRATIONS_DIR));
    assert(
      !text.includes(MARKER),
      `historical migration ${historical} must not carry the Step 1 marker`,
    );
    assert(
      !text.includes("execute_v1_create_program"),
      `historical migration ${historical} must not define the private executor`,
    );
    assert(
      !text.includes("mcp_v1_create_program"),
      `historical migration ${historical} must not define the MCP wrapper`,
    );
  }
});

// ---------------------------------------------------------------------------
// B. Canonical PMG
// ---------------------------------------------------------------------------

Deno.test("Program Create bridge: canonical command keeps its exact signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.apply_program_create\(_name text, _workspace_id uuid, _description text DEFAULT NULL::text, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)/
      .test(sql),
    "apply_program_create signature must be unchanged",
  );
  assert(
    !/apply_program_create\([^)]*_execution_source/.test(sql),
    "the canonical PMG must not gain a caller-controlled source argument",
  );
});

Deno.test("Program Create bridge: canonical command accepts external_api and mcp only", () => {
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
    sql.includes("<> 'programs:create'"),
    "exact capability containment must remain",
  );
  assert(
    !/v_trusted_channel <> 'external_api'/.test(sql),
    "the external_api-only condition must be replaced",
  );
});

Deno.test("Program Create bridge: ordinary UI execution stays btpm_ui", () => {
  assert(
    sql.includes(
      "v_source_channel public.pmg_source_channel := 'btpm_ui'::public.pmg_source_channel",
    ),
    "default provenance must remain btpm_ui",
  );
});

Deno.test("Program Create bridge: canonical command maps channel to provenance", () => {
  assert(sql.includes("'external_api'::public.pmg_source_channel"));
  assert(sql.includes("'mcp'::public.pmg_source_channel"));
  assert(
    sql.includes("v_source_channel"),
    "audit provenance must be server-derived",
  );
  assert(
    sql.includes("public.pmg_record_command_audit("),
    "canonical PMG audit must remain",
  );
});

Deno.test("Program Create bridge: existing PMG protections remain", () => {
  for (
    const guard of [
      "public.is_active_user(v_actor)",
      "public.has_pm_authority(v_actor, _workspace_id)",
      "public.get_user_org_id(v_actor)",
      "public.can_write_demo(v_actor, _workspace_id)",
      "Program name is required",
      "Program name must be 200 characters or less",
      "Workspace is required",
      "Workspace not found",
    ]
  ) {
    assert(sql.includes(guard), `PMG guard must remain: ${guard}`);
  }
});

Deno.test("Program Create bridge: canonical Program persistence is unchanged", () => {
  assert(
    /INSERT INTO public\.programs \(\s*name, description, workspace_id, organization_id, created_by\s*\)/
      .test(sql),
    "canonical Program insert must remain in the PMG",
  );
  const inserts = sql.match(/INSERT INTO public\.programs/g) ?? [];
  assertEquals(inserts.length, 1, "exactly one Program insert may exist");
});

// ---------------------------------------------------------------------------
// C. Private executor
// ---------------------------------------------------------------------------

Deno.test("Program Create bridge: private executor has the exact 9-argument signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION api_e_private\.execute_v1_create_program\(\s*_execution_source text,\s*_expected_oauth_client_id text,\s*_workspace_id uuid,\s*_name text,\s*_description text,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb/
      .test(sql),
    "private executor signature must be exact",
  );
});

Deno.test("Program Create bridge: private executor is SECURITY DEFINER with pinned search_path", () => {
  const body = sql.slice(sql.indexOf("api_e_private.execute_v1_create_program("));
  assert(body.includes("LANGUAGE plpgsql"));
  assert(body.includes("SECURITY DEFINER"));
  assert(body.includes("SET search_path TO 'pg_catalog', 'public'"));
});

Deno.test("Program Create bridge: capability and api version are hardcoded", () => {
  assert(sql.includes("c_api_version    constant text := 'v1';"));
  assert(sql.includes("c_capability_kind constant text := 'command';"));
  assert(sql.includes("c_capability_key constant text := 'programs:create';"));
});

Deno.test("Program Create bridge: private executor selects a fixed source", () => {
  assert(
    /_execution_source text/.test(sql),
    "executor must take an internal execution-source selector",
  );
  assert(
    /v_source NOT IN \('external_api','mcp'\)/.test(sql),
    "executor must fail closed on any other source",
  );
  assert(
    sql.includes("v_source IS NULL"),
    "NULL execution source must fail closed",
  );
  assert(
    sql.includes("api_e_private.authorize_and_establish("),
    "external_api branch must use the REST establishment helper",
  );
  assert(
    sql.includes("api_e_private.authorize_and_establish_mcp("),
    "mcp branch must use the MCP establishment helper",
  );
  assert(
    /IF v_source = 'external_api' THEN[\s\S]*?authorize_and_establish\([\s\S]*?ELSE[\s\S]*?authorize_and_establish_mcp\(/
      .test(sql),
    "source selection must map external_api -> REST helper, mcp -> MCP helper",
  );
});

// ---------------------------------------------------------------------------
// D. Scope derivation
// ---------------------------------------------------------------------------

Deno.test("Program Create bridge: Organization is derived from an active Workspace", () => {
  assert(
    /SELECT w\.id, w\.organization_id\s*INTO v_workspace_id, v_organization_id\s*FROM public\.workspaces w\s*WHERE w\.id = _workspace_id\s*AND w\.is_active IS TRUE\s*AND w\.is_archived IS NOT TRUE;/
      .test(sql),
    "Workspace must be authoritative, active and non-archived",
  );
  assert(
    sql.includes("'outcome', 'not_authorized'"),
    "missing/archived Workspace must be non-enumerating",
  );
});

Deno.test("Program Create bridge: no caller-supplied Tenant or Organization", () => {
  const executor = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION api_e_private.execute_v1_create_program("),
  );
  const args = /execute_v1_create_program\(([\s\S]*?)\)\s*RETURNS jsonb/.exec(
    executor,
  )?.[1] ?? "";
  assert(!/_tenant_id/.test(args), "no caller Tenant argument may exist");
  assert(!/_organization_id/.test(args), "no caller Organization argument may exist");
  assert(!/_actor|_user_id/.test(args), "no caller actor argument may exist");
});

// ---------------------------------------------------------------------------
// E. Trusted-context reconfirmation
// ---------------------------------------------------------------------------

Deno.test("Program Create bridge: trusted context is revalidated in full", () => {
  for (
    const key of [
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
    assert(sql.includes(key), `trusted context must revalidate ${key}`);
  }
  assert(sql.includes("v_ctx_org_id IS DISTINCT FROM v_organization_id"));
  assert(sql.includes("v_ctx_workspace_id IS DISTINCT FROM v_workspace_id"));
  assert(
    /current_setting\('api_e\.source_channel', true\)[\s\S]{0,40}IS DISTINCT FROM v_source/
      .test(sql),
    "established source_channel must equal the fixed execution source",
  );
});

Deno.test("Program Create bridge: context verification precedes idempotency", () => {
  const ctx = sql.indexOf("api_e.source_channel");
  const claim = sql.indexOf("claim_idempotency");
  assert(ctx > 0 && claim > 0 && ctx < claim,
    "trusted-context verification must precede the idempotency claim");
});

// ---------------------------------------------------------------------------
// F. Connected App model
// ---------------------------------------------------------------------------

Deno.test("Program Create bridge: no Program-level Connected-App enablement model", () => {
  assert(
    !sql.includes("api_project_client_enablements"),
    "no Project/Program enablement table may be queried",
  );
  assert(
    !/api_program_client_enablements/.test(sql),
    "no Program enablement table may be introduced",
  );
  assert(!/CREATE TABLE/i.test(sql), "no table may be created");
  assert(
    !/INSERT INTO [a-z_.]*enablement/i.test(sql),
    "no auto-enablement insert may exist",
  );
  assert(
    !/UPDATE [a-z_.]*enablement/i.test(sql),
    "no enablement update may exist",
  );
});

// ---------------------------------------------------------------------------
// G. API-F idempotency
// ---------------------------------------------------------------------------

Deno.test("Program Create bridge: idempotency lifecycle is preserved", () => {
  assert(sql.includes("api_e_private.claim_idempotency(c_capability_key"));
  assert(sql.includes("api_e_private.complete_idempotency("));
  assert(sql.includes("api_e_private.fail_idempotency("));
  for (const decision of ["conflict", "pending", "replay", "execute"]) {
    assert(sql.includes(`'${decision}'`), `decision ${decision} must be handled`);
  }
  assert(sql.includes("'outcome', 'idempotency_conflict'"));
  assert(sql.includes("'outcome', 'idempotency_pending'"));
  assert(
    sql.includes(
      "RETURN v_claim.canonical_result || jsonb_build_object('outcome', 'replayed');",
    ),
    "completed replay must rewrite only the outcome to replayed",
  );
  assert(
    /v_claim\.failure_code = 'not_authorized'[\s\S]{0,200}'outcome', 'not_authorized'/
      .test(sql),
    "failed not_authorized replay must be preserved",
  );
  assert(
    /v_claim\.failure_code = 'invalid'[\s\S]{0,200}'outcome', 'invalid'/.test(sql),
    "failed invalid replay must be preserved",
  );
  assert(
    sql.includes("unexpected replay state"),
    "unexpected registry state must fail internally",
  );
});

// ---------------------------------------------------------------------------
// H. Canonical business command
// ---------------------------------------------------------------------------

Deno.test("Program Create bridge: exactly one canonical business mutation call", () => {
  const definitions = sql.match(/CREATE OR REPLACE FUNCTION public\.apply_program_create\(/g) ?? [];
  const occurrences = sql.match(/public\.apply_program_create\(/g) ?? [];
  assertEquals(definitions.length, 1, "the command must be redefined exactly once");
  assertEquals(
    occurrences.length - definitions.length,
    1,
    "the executor must call the command exactly once",
  );
  assert(sql.includes("v_pmg := public.apply_program_create("));
});

Deno.test("Program Create bridge: private executor never mutates public.programs", () => {
  const executor = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION api_e_private.execute_v1_create_program("),
    sql.indexOf("REVOKE ALL ON FUNCTION api_e_private.execute_v1_create_program"),
  );
  assert(!/INSERT INTO public\.programs/.test(executor));
  assert(!/UPDATE public\.programs/.test(executor));
  assert(!/DELETE FROM public\.programs/.test(executor));
  assert(
    !/apply_program_update|apply_project_create_blank|apply_project_update/.test(
      executor,
    ),
    "no other PMG may be invoked",
  );
});

// ---------------------------------------------------------------------------
// I. Bounded output
// ---------------------------------------------------------------------------

Deno.test("Program Create bridge: bounded result contract", () => {
  assert(
    /jsonb_build_object\(\s*'ok', true,\s*'outcome', 'applied',\s*'programId', v_program_id\s*\)/
      .test(sql),
    "applied result must return only ok/outcome/programId",
  );
  for (
    const outcome of [
      "'outcome', 'invalid'",
      "'outcome', 'not_authorized'",
      "'outcome', 'idempotency_conflict'",
      "'outcome', 'idempotency_pending'",
    ]
  ) {
    assert(sql.includes(outcome), `bounded negative outcome missing: ${outcome}`);
  }
  assert(
    !/'name', v_name|'description', v_description|'organizationId'|'tenantId'|'workspaceId'/
      .test(sql),
    "no Program narrative or scope identity may be returned",
  );
  assert(
    sql.includes("malformed applied result") &&
      sql.includes("inconsistent applied result"),
    "malformed PMG output must fail closed internally",
  );
});

// ---------------------------------------------------------------------------
// J. Wrappers
// ---------------------------------------------------------------------------

Deno.test("Program Create bridge: public wrappers are thin and source-fixed", () => {
  assert(
    /public\.api_v1_create_program\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_create_program\(\s*'external_api',/
      .test(sql),
    "REST wrapper must delegate with fixed 'external_api'",
  );
  assert(
    /public\.mcp_v1_create_program\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_create_program\(\s*'mcp',/
      .test(sql),
    "MCP wrapper must delegate with fixed 'mcp'",
  );
  for (const fn of ["api_v1_create_program", "mcp_v1_create_program"]) {
    const match = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS jsonb`,
    ).exec(sql);
    assert(match !== null, `${fn} must be defined`);
    const args = match?.[1] ?? "";
    assert(
      !args.includes("_execution_source"),
      `public.${fn} must not expose the execution-source selector`,
    );
    assertEquals(
      args
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a.length > 0),
      [
        "_expected_oauth_client_id text",
        "_workspace_id uuid",
        "_name text",
        "_description text",
        "_request_id text",
        "_correlation_id text",
        "_idempotency_key text",
        "_payload_hash text",
      ],
      `public.${fn} must keep the exact eight-argument contract`,
    );
  }
});

Deno.test("Program Create bridge: wrappers contain no business logic", () => {
  for (const fn of ["api_v1_create_program", "mcp_v1_create_program"]) {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    const body = sql.slice(start, sql.indexOf("$function$;", start));
    for (
      const forbidden of [
        "authorize_and_establish",
        "claim_idempotency",
        "public.workspaces",
        "apply_program_create",
        "INSERT INTO",
      ]
    ) {
      assert(
        !body.includes(forbidden),
        `public.${fn} must not contain ${forbidden}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// K. ACL
// ---------------------------------------------------------------------------

Deno.test("Program Create bridge: private executor is not callable by any app role", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(
        `REVOKE ALL ON FUNCTION api_e_private.execute_v1_create_program(${EXECUTOR_ARGS}) FROM ${role};`,
      ),
      `${role} must be revoked on the private executor`,
    );
  }
  assert(
    !/GRANT EXECUTE ON FUNCTION api_e_private\.execute_v1_create_program/.test(sql),
    "the private executor must never be granted",
  );
});

Deno.test("Program Create bridge: wrapper grants are authenticated-only", () => {
  const grants = (sql.match(/GRANT[^;]*;/g) ?? []).map((g) =>
    g.replace(/\s+/g, " ").trim()
  );
  assertEquals(grants.length, 2, "exactly two grants may exist");
  assert(grants.every((g) => g.endsWith("TO authenticated;")));
  assert(!/GRANT[^;]*TO (PUBLIC|anon|service_role)/.test(sql));
  for (const fn of ["api_v1_create_program", "mcp_v1_create_program"]) {
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

// ---------------------------------------------------------------------------
// L. Encryption / protected data
// ---------------------------------------------------------------------------

Deno.test("Program Create bridge: no new encryption implementation", () => {
  assert(!/btpm_encrypt|btpm_decrypt/.test(sql));
  assert(!/RAISE (NOTICE|LOG|WARNING)/.test(sql), "no narrative logging may exist");
  assert(
    !/pgp_sym_encrypt|pgp_sym_decrypt|pgcrypto/.test(sql),
    "no direct crypto call may exist",
  );
});

// ---------------------------------------------------------------------------
// N. No unrelated surface is touched
// ---------------------------------------------------------------------------

Deno.test("Program Create bridge: no unrelated surface is touched", () => {
  for (
    const forbidden of [
      "CREATE POLICY",
      "ALTER TABLE",
      "DROP FUNCTION",
      "CREATE TABLE",
      "apply_program_update",
      "api_v1_update_program",
      "mcp_v1_update_program",
      "apply_project_create_blank",
      "apply_project_update",
      "apply_project_transition",
      "apply_phase_create",
      "apply_task_create",
      "toolRegistry",
      "portfolio",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});
