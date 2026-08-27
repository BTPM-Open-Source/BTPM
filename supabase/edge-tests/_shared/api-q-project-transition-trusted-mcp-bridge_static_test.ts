// API-Q Project Transition Step 1 — static contract guard for the trusted MCP
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
const MARKER = "API-Q Project Transition Step 1 — Trusted MCP Database Bridge";

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
  assert(
    found.length >= 1,
    "expected at least one Project Transition bridge migration",
  );
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

/** Body of one function definition, from its signature to the closing tag. */
function bodyOf(marker: string): string {
  const at = sql.indexOf(marker);
  assert(at >= 0, `definition not found: ${marker}`);
  const start = sql.indexOf("$function$", at);
  assert(start > at, "body opening tag not found");
  const end = sql.indexOf("$function$", start + 10);
  assert(end > start, "body closing tag not found");
  return sql.slice(start + 10, end);
}

const CANONICAL = bodyOf(
  "CREATE OR REPLACE FUNCTION public.apply_project_status_transition",
);
const EXECUTOR = bodyOf(
  "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_transition_project",
);
const REST = bodyOf(
  "CREATE OR REPLACE FUNCTION public.api_v1_transition_project",
);
const MCP = bodyOf(
  "CREATE OR REPLACE FUNCTION public.mcp_v1_transition_project",
);

const PRIVATE_ARGS =
  "(text, text, uuid, timestamptz, text, boolean, text, text, text, text)";
const PUBLIC_ARGS =
  "(text, uuid, timestamptz, text, boolean, text, text, text, text)";

// ---------------------------------------------------------------------------
// A. Migration shape
// ---------------------------------------------------------------------------

Deno.test("Project Transition bridge: exactly four functions are (re)defined", () => {
  const created =
    (sql.match(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9.]+)/g) ?? [])
      .map((m) => m.replace(/CREATE OR REPLACE FUNCTION\s+/, ""));
  assertEquals(created.length, 4);
  assertEquals(
    new Set(created),
    new Set([
      "public.apply_project_status_transition",
      "api_e_private.execute_v1_transition_project",
      "public.api_v1_transition_project",
      "public.mcp_v1_transition_project",
    ]),
  );
});

Deno.test("Project Transition bridge: canonical command keeps its exact signature", () => {
  assert(
    sql.includes(
      "CREATE OR REPLACE FUNCTION public.apply_project_status_transition(_project_id uuid, _expected_updated_at timestamp with time zone, _target_status pm_status, _confirm_warnings boolean DEFAULT false, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text)",
    ),
    "apply_project_status_transition signature must be unchanged",
  );
  assert(!/_source_channel\s+text/.test(sql), "no source-channel parameter");
  assert(!/_capability_key\s+text/.test(sql), "no capability-key parameter");
});

Deno.test("Project Transition bridge: private executor has the exact 10-argument signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION api_e_private\.execute_v1_transition_project\(\s*_execution_source text,\s*_expected_oauth_client_id text,\s*_project_id uuid,\s*_expected_updated_at timestamptz,\s*_target_status text,\s*_confirm_warnings boolean,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb/
      .test(sql),
    "private executor signature must be exact",
  );
});

Deno.test("Project Transition bridge: both public wrappers keep the exact nine-argument contract", () => {
  for (const fn of ["api_v1_transition_project", "mcp_v1_transition_project"]) {
    assert(
      new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fn}\\(\\s*_expected_oauth_client_id text,\\s*_project_id uuid,\\s*_expected_updated_at timestamptz,\\s*_target_status text,\\s*_confirm_warnings boolean,\\s*_request_id text,\\s*_correlation_id text,\\s*_idempotency_key text,\\s*_payload_hash text\\s*\\)\\s*RETURNS jsonb`,
      ).test(sql),
      `public.${fn} must expose exactly the accepted nine arguments`,
    );
  }
});

// ---------------------------------------------------------------------------
// B. Fixed execution source
// ---------------------------------------------------------------------------

Deno.test("Project Transition bridge: public wrappers are thin and source-fixed", () => {
  assert(
    /^\s*BEGIN\s*RETURN api_e_private\.execute_v1_transition_project\(\s*'external_api',/
      .test(REST),
    "REST wrapper must delegate with fixed 'external_api'",
  );
  assert(
    /^\s*BEGIN\s*RETURN api_e_private\.execute_v1_transition_project\(\s*'mcp',/
      .test(MCP),
    "MCP wrapper must delegate with fixed 'mcp'",
  );
  for (const body of [REST, MCP]) {
    assert(!body.includes("_execution_source"), "no source pass-through");
    assert(
      !body.includes("public.apply_project_status_transition"),
      "wrappers must not call the canonical command directly",
    );
  }
});

Deno.test("Project Transition bridge: executor fails closed on any other execution source", () => {
  assert(
    /v_source NOT IN \('external_api','mcp'\)/.test(EXECUTOR),
    "executor must allow exactly external_api and mcp",
  );
  assert(EXECUTOR.includes("v_source IS NULL"), "NULL source must fail closed");
  const guard = EXECUTOR.indexOf("v_source NOT IN ('external_api','mcp')");
  const pmg = EXECUTOR.indexOf("public.apply_project_status_transition(");
  assert(guard > 0 && pmg > guard, "source guard must precede business call");
});

// ---------------------------------------------------------------------------
// C. Canonical PMG trusted-source behavior
// ---------------------------------------------------------------------------

Deno.test("Project Transition bridge: canonical command accepts external_api and mcp only", () => {
  assert(
    /v_trusted_channel NOT IN \('external_api','mcp'\)/.test(CANONICAL),
    "trusted channel allowlist must be exactly ('external_api','mcp')",
  );
  assert(
    CANONICAL.includes("v_trusted_channel IS NULL"),
    "NULL channel must be fail-closed",
  );
  assert(
    CANONICAL.includes("api_e_private.assert_trusted_context()"),
    "trusted context assertion must remain",
  );
  assert(
    CANONICAL.includes("api_e_private.jwt_client_id()"),
    "client identity resolution must remain",
  );
  assert(
    CANONICAL.includes("<> 'projects:transition'"),
    "exact capability containment must remain",
  );
  assert(
    !/v_trusted_channel <> 'external_api'/.test(CANONICAL),
    "the external_api-only condition must be replaced",
  );
  assert(
    !CANONICAL.includes("'projects:update'") &&
      !CANONICAL.includes("'projects:create'"),
    "no other capability may be accepted",
  );
});

Deno.test("Project Transition bridge: ordinary UI stays btpm_ui and channels map to provenance", () => {
  assert(
    CANONICAL.includes(
      "v_source_channel public.pmg_source_channel := 'btpm_ui'::public.pmg_source_channel;",
    ),
    "default provenance must remain btpm_ui",
  );
  assert(CANONICAL.includes("'external_api'::public.pmg_source_channel"));
  assert(CANONICAL.includes("'mcp'::public.pmg_source_channel"));
  assert(
    CANONICAL.includes("v_source_channel"),
    "audit provenance must be server-derived",
  );
});

Deno.test("Project Transition bridge: untrusted context fails closed before business execution", () => {
  const reject = CANONICAL.indexOf(
    "'not_authorized'::public.pmg_command_status",
  );
  assert(reject > 0, "fail-closed envelope missing");
  for (
    const marker of [
      "FROM public.projects",
      "FOR UPDATE",
      "public.validate_project_completion(",
      "public.pmg_record_command_audit",
      "UPDATE public.projects",
    ]
  ) {
    const at = CANONICAL.indexOf(marker);
    if (at < 0) continue;
    assert(reject < at, `fail-closed must precede ${marker}`);
  }
});

// ---------------------------------------------------------------------------
// D. Authorization source selection and containment
// ---------------------------------------------------------------------------

Deno.test("Project Transition bridge: each source uses its own establishment helper", () => {
  assert(
    EXECUTOR.includes("api_e_private.authorize_and_establish("),
    "external_api branch must use the REST establishment helper",
  );
  assert(
    EXECUTOR.includes("api_e_private.authorize_and_establish_mcp("),
    "mcp branch must use the MCP establishment helper",
  );
  assert(/c_api_version\s+constant text := 'v1';/.test(EXECUTOR));
  assert(/c_capability_kind\s+constant text := 'command';/.test(EXECUTOR));
  assert(
    /c_capability_key\s+constant text := 'projects:transition';/.test(EXECUTOR),
  );

});

Deno.test("Project Transition bridge: trusted context is revalidated against the derived scope", () => {
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
    assert(EXECUTOR.includes(setting), `missing revalidation of ${setting}`);
  }
  assert(EXECUTOR.includes("v_ctx_org_id IS DISTINCT FROM v_organization_id"));
  assert(
    EXECUTOR.includes("v_ctx_workspace_id IS DISTINCT FROM v_workspace_id"),
  );
  assert(

    /current_setting\('api_e\.source_channel', true\)[^\n]*<> v_source/
      .test(EXECUTOR),
    "the established channel must equal the fixed execution source",
  );
});

Deno.test("Project Transition bridge: scope is derived from the target Project, never from caller input", () => {
  const derive = EXECUTOR.indexOf("FROM public.projects p");
  const establish = EXECUTOR.indexOf("api_e_private.authorize_and_establish");
  assert(derive > 0 && establish > derive, "derivation must precede establish");
  assert(
    !/(^|[\s(,])_tenant_id uuid|(^|[\s(,])_organization_id uuid|(^|[\s(,])_workspace_id uuid/
      .test(sql),

    "no caller-supplied tenancy scope arguments may exist",
  );
  // TOCTOU containment on the locked Project row.
  assert(EXECUTOR.includes("FOR UPDATE"));
  assert(
    EXECUTOR.includes("v_locked_workspace_id IS DISTINCT FROM v_workspace_id"),
  );
  assert(
    EXECUTOR.includes(
      "v_locked_organization_id IS DISTINCT FROM v_organization_id",
    ),
  );
});

// ---------------------------------------------------------------------------
// E. Connected App gate
// ---------------------------------------------------------------------------

Deno.test("Project Transition bridge: exact Project enablement precedes idempotency and PMG", () => {
  const enable = EXECUTOR.indexOf("api_project_client_enablements");
  const claim = EXECUTOR.indexOf("api_e_private.claim_idempotency");
  const pmg = EXECUTOR.indexOf("public.apply_project_status_transition(");
  assert(enable > 0, "enablement check missing");
  assert(claim > enable, "idempotency must follow enablement");
  assert(pmg > claim, "PMG must follow idempotency");
  for (
    const col of [
      "e.project_id = v_project_id",
      "e.api_client_id = v_ctx_client_id",
      "e.tenant_id = v_ctx_tenant_id",
      "e.organization_id = v_organization_id",
      "e.workspace_id = v_workspace_id",
      "e.lifecycle_status = 'enabled'",
      "e.enabled_at IS NOT NULL",
      "e.disabled_at IS NULL",
    ]
  ) {
    assert(EXECUTOR.includes(col), `enablement predicate missing: ${col}`);
  }
});

Deno.test("Project Transition bridge: no enablement write or auto-enable exists", () => {
  assert(
    !/INSERT\s+INTO\s+public\.api_project_client_enablements/i.test(sql),
    "must never insert enablement",
  );
  assert(
    !/UPDATE\s+public\.api_project_client_enablements/i.test(sql),
    "must never update enablement",
  );
  assert(!/auto_enable|enable_project_client/i.test(sql));
});

// ---------------------------------------------------------------------------
// F. Canonical command ownership
// ---------------------------------------------------------------------------

Deno.test("Project Transition bridge: exactly one canonical business call site", () => {
  const definitions =
    sql.match(
      /CREATE OR REPLACE FUNCTION public\.apply_project_status_transition\(/g,
    ) ?? [];
  const occurrences =
    sql.match(/public\.apply_project_status_transition\(/g) ?? [];
  assertEquals(definitions.length, 1, "redefined exactly once");
  assertEquals(
    occurrences.length - definitions.length,
    1,
    "the executor must call the canonical command exactly once",
  );
  assert(EXECUTOR.includes("v_pmg := public.apply_project_status_transition("));
});

Deno.test("Project Transition bridge: no duplicated lifecycle or completion engine", () => {
  assert(
    !/UPDATE\s+public\.projects/i.test(EXECUTOR),
    "the bridge must never write projects directly",
  );
  assert(!/INSERT\s+INTO\s+public\.projects/i.test(EXECUTOR));
  assert(!/DELETE\s+FROM\s+public\.projects/i.test(EXECUTOR));
  assert(
    !EXECUTOR.includes("validate_project_completion"),
    "no completion validator may be re-run at this layer",
  );
  assert(!/\bEXECUTE\s+format/i.test(EXECUTOR), "no dynamic SQL");
  assert(!/\bEXECUTE\s+'/i.test(EXECUTOR), "no dynamic SQL");
});

// ---------------------------------------------------------------------------
// G. Optimistic concurrency
// ---------------------------------------------------------------------------

Deno.test("Project Transition bridge: expected_updated_at is forwarded unchanged", () => {
  assert(
    /_expected_updated_at\s*=>\s*_expected_updated_at/.test(EXECUTOR),
    "the caller timestamp must be passed straight through",
  );
  assert(
    !/SELECT\s+updated_at/i.test(EXECUTOR),
    "the bridge must not read the current project timestamp",
  );
  assert(
    !/\bLOOP\b/.test(
      EXECUTOR.slice(0, EXECUTOR.indexOf("FOREACH v_key IN ARRAY")),
    ),
    "no retry loop before result sanitization",
  );
  assert(!/v_retry|_retry|retry_count/i.test(EXECUTOR), "no retry mechanism");
  assert(
    EXECUTOR.includes(
      "'ok', false, 'outcome', 'conflict', 'code', 'stale_project'",
    ),
    "stale must remain bounded stale_project",
  );
  assert(
    !EXECUTOR.includes("current_updated_at"),
    "the database timestamp must not be exposed",
  );
});

// ---------------------------------------------------------------------------
// H. Replay fidelity
// ---------------------------------------------------------------------------

Deno.test("Project Transition bridge: replay fidelity is preserved exactly", () => {
  assert(
    /IF \(v_claim\.canonical_result ->> 'ok'\) = 'true' THEN\s*RETURN v_claim\.canonical_result \|\| jsonb_build_object\('outcome', 'replayed'\);\s*END IF;\s*RETURN v_claim\.canonical_result;/
      .test(EXECUTOR),
    "successful replays become 'replayed'; deterministic negatives replay verbatim",
  );
  assert(
    !/jsonb_build_object\('outcome', 'replayed'\)[\s\S]{0,200}blocked/.test(
      EXECUTOR,
    ),
    "blocked results must not be rewritten to replayed",
  );
  for (
    const decision of ["conflict", "pending", "replay", "execute"]
  ) {
    assert(
      EXECUTOR.includes(`'${decision}'`),
      `decision ${decision} must be handled`,
    );
  }
  assert(
    EXECUTOR.includes("v_claim.failure_code = 'stale_project'") &&
      EXECUTOR.includes("v_claim.failure_code = 'not_authorized'") &&
      EXECUTOR.includes("v_claim.failure_code = 'invalid'"),
    "persisted failure replay mapping must be preserved",
  );
  assert(
    EXECUTOR.includes("api_e_private.complete_idempotency("),
    "blocked/confirmation results must be persisted for faithful replay",
  );
  assert(EXECUTOR.includes("api_e_private.fail_idempotency("));
});

// ---------------------------------------------------------------------------
// I. Bounded completion output
// ---------------------------------------------------------------------------

Deno.test("Project Transition bridge: completion output stays bounded and sanitized", () => {
  for (
    const category of [
      "open_blockers",
      "incomplete_phases",
      "incomplete_tasks",
      "open_risks",
      "target_end_in_future",
    ]
  ) {
    assert(
      EXECUTOR.includes(category),
      `missing canonical category ${category}`,
    );
  }
  assert(EXECUTOR.includes("completion_hard_blocked"));
  assert(EXECUTOR.includes("completion_soft_warnings"));
  assert(EXECUTOR.includes("'count', (e ->> 'count')::int"));
  assert(EXECUTOR.includes("'code', e ->> 'code'"));
  assert(EXECUTOR.includes("'message', e ->> 'message'"));
  // The raw PMG envelope never leaves the bridge.
  assert(!/RETURN\s+v_pmg\s*;/.test(EXECUTOR));
  for (
    const outcome of [
      "'applied'",
      "'no_change'",
      "'replayed'",
      "'blocked'",
      "'confirmation_required'",
      "'conflict'",
      "'not_authorized'",
      "'invalid'",
      "'idempotency_conflict'",
      "'idempotency_pending'",
    ]
  ) {
    assert(EXECUTOR.includes(outcome), `missing outcome mapping ${outcome}`);
  }
});

Deno.test("Project Transition bridge: no narrative or encryption handling is introduced", () => {
  for (
    const forbidden of [
      "btpm_encrypt",
      "btpm_decrypt",
      "charter",
      "business_case",
      "budget_narrative",
      "success_criteria",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// J. ACL
// ---------------------------------------------------------------------------

Deno.test("Project Transition bridge: private executor is not callable by any app role", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(
        `REVOKE ALL ON FUNCTION api_e_private.execute_v1_transition_project${PRIVATE_ARGS} FROM ${role};`,
      ),
      `${role} must be revoked on the private executor`,
    );
  }
  assert(
    !/GRANT EXECUTE ON FUNCTION api_e_private\.execute_v1_transition_project/
      .test(sql),
    "the private executor must never be granted",
  );
});

Deno.test("Project Transition bridge: public wrappers keep the delegated authenticated ACL", () => {
  const grants = (sql.match(/GRANT[^;]*;/g) ?? []).map((g) =>
    g.replace(/\s+/g, " ").trim()
  );
  assertEquals(grants.length, 2, "exactly two grants may exist");
  assert(grants.every((g) => g.endsWith("TO authenticated;")));
  assert(!/GRANT[^;]*TO (PUBLIC|anon|service_role)/.test(sql));
  for (const fn of ["api_v1_transition_project", "mcp_v1_transition_project"]) {
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(
          `REVOKE ALL ON FUNCTION public.${fn}${PUBLIC_ARGS} FROM ${role};`,
        ),
        `${role} must be revoked on public.${fn}`,
      );
    }
    assert(
      sql.includes(
        `GRANT EXECUTE ON FUNCTION public.${fn}${PUBLIC_ARGS} TO authenticated;`,
      ),
      `public.${fn} must be granted to authenticated only`,
    );
  }
});

Deno.test("Project Transition bridge: security posture is unchanged", () => {
  assertEquals((sql.match(/SECURITY DEFINER/g) ?? []).length, 4);
  assertEquals(
    (sql.match(/SET search_path TO 'pg_catalog', 'public'/g) ?? []).length,
    4,
  );
});

Deno.test("Project Transition bridge: no unrelated surface is touched", () => {
  for (
    const forbidden of [
      "CREATE POLICY",
      "ALTER POLICY",
      "DROP POLICY",
      "CREATE TABLE",
      "ALTER TABLE",
      "DROP TABLE",
      "DROP FUNCTION",
      "api_client_supported_capabilities",
      "api_capability_grants",
      "apply_project_update",
      "apply_project_create_blank",
      "api_v1_update_project",
      "mcp_v1_update_project",
      "apply_program",
      "portfolio",
      "toolRegistry",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not contain ${forbidden}`);
  }
});

