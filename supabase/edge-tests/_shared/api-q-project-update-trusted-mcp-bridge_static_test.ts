// API-Q Project Update Step 1 — static contract guard for the trusted MCP
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
const MARKER = "API-Q Project Update Step 1 — Trusted MCP Database Bridge";

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
    "expected at least one Project Update bridge migration",
  );
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

/** The canonical PMG command block only. */
const canonical = (() => {
  const start = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.apply_project_update(",
  );
  const end = sql.indexOf(
    "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_project(",
  );
  assert(start >= 0 && end > start, "canonical command block must exist");
  return sql.slice(start, end);
})();

/** The shared private executor body only. */
const executor = (() => {
  const start = sql.indexOf(
    "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_project(",
  );
  const end = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.api_v1_update_project(",
  );
  assert(start >= 0 && end > start, "private executor block must exist");
  return sql.slice(start, end);
})();

const PRIVATE_ARGS =
  "\\(text, text, uuid, timestamptz, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text, text, text, text\\)";
const PUBLIC_ARGS =
  "\\(text, uuid, timestamptz, text, text, text, text, text, text, text, text, text, text, text, text, text, uuid, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, text, text, text, text\\)";

// A. Exactly four functions are defined.
Deno.test("Project Update bridge: exactly the four expected functions are (re)defined", () => {
  const created = (sql.match(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9.]+)/g) ?? [])
    .map((m) => m.replace(/CREATE OR REPLACE FUNCTION\s+/, ""));
  assertEquals(
    new Set(created),
    new Set([
      "public.apply_project_update",
      "api_e_private.execute_v1_update_project",
      "public.api_v1_update_project",
      "public.mcp_v1_update_project",
    ]),
  );
  assertEquals(created.length, 4);
});

// B. Canonical signature unchanged.
Deno.test("Project Update bridge: canonical command keeps its exact signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.apply_project_update\(_project_id uuid, _expected_updated_at timestamp with time zone, _name text DEFAULT NULL::text, _priority pm_priority DEFAULT NULL::pm_priority, _description text DEFAULT NULL::text, _charter text DEFAULT NULL::text, _goals text DEFAULT NULL::text, _scope_in text DEFAULT NULL::text, _scope_out text DEFAULT NULL::text, _business_case text DEFAULT NULL::text, _success_criteria text DEFAULT NULL::text, _completion_criteria text DEFAULT NULL::text, _budget_narrative text DEFAULT NULL::text, _assumptions text DEFAULT NULL::text, _constraints text DEFAULT NULL::text, _program_id uuid DEFAULT NULL::uuid, _delivery_model project_delivery_model DEFAULT NULL::project_delivery_model, _set_name boolean DEFAULT false, _set_priority boolean DEFAULT false, _set_description boolean DEFAULT false, _set_charter boolean DEFAULT false, _set_goals boolean DEFAULT false, _set_scope_in boolean DEFAULT false, _set_scope_out boolean DEFAULT false, _set_business_case boolean DEFAULT false, _set_success_criteria boolean DEFAULT false, _set_completion_criteria boolean DEFAULT false, _set_budget_narrative boolean DEFAULT false, _set_assumptions boolean DEFAULT false, _set_constraints boolean DEFAULT false, _set_program_id boolean DEFAULT false, _set_delivery_model boolean DEFAULT false, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)/
      .test(sql),
    "apply_project_update signature must be unchanged",
  );
  assert(canonical.includes("RETURNS jsonb"));
  assert(canonical.includes("SECURITY DEFINER"));
  assert(canonical.includes("SET search_path TO 'pg_catalog', 'public'"));
});

// C. Trusted allowlist external_api|mcp, UI stays btpm_ui.
Deno.test("Project Update bridge: canonical command accepts trusted external_api or mcp only", () => {
  assert(
    canonical.includes("v_trusted_channel NOT IN ('external_api','mcp')"),
    "trusted channel must be the fixed two-value allowlist",
  );
  assert(
    !sql.includes(
      "current_setting('api_e.source_channel', true),'')),''), '') <> 'external_api'",
    ),
    "the old external_api-only comparison must be gone",
  );
  assert(
    /IF v_trusted_channel = 'external_api' THEN\s*v_source_channel := 'external_api'::public\.pmg_source_channel;\s*ELSE\s*v_source_channel := 'mcp'::public\.pmg_source_channel;/
      .test(canonical),
    "PMG provenance must map external_api -> external_api and mcp -> mcp",
  );
  assert(
    canonical.includes(
      "v_source_channel public.pmg_source_channel := 'btpm_ui'::public.pmg_source_channel",
    ),
    "ordinary UI behavior must remain btpm_ui",
  );
  const channelLiterals = new Set(
    (sql.match(
      /'(btpm_ui|external_api|mcp|admin_import|background_job|btpm_internal)'::public\.pmg_source_channel/g,
    ) ?? []).map((m) => m.split("'")[1]),
  );
  assertEquals(channelLiterals, new Set(["btpm_ui", "external_api", "mcp"]));
});

// D. Server-derived channel + gate ordering.
Deno.test("Project Update bridge: source channel remains server-derived only", () => {
  assert(
    canonical.includes(
      "v_trusted_channel := nullif(btrim(coalesce(current_setting('api_e.source_channel', true),'')),'');",
    ),
    "channel must come only from current_setting",
  );
  assert(
    !/apply_project_update\([^)]*_source_channel/.test(sql),
    "no source-channel parameter may be added to the canonical command",
  );
  assert(
    !/CREATE OR REPLACE FUNCTION public\.(api|mcp)_v1_update_project\([^)]*_source_channel/
      .test(sql),
    "no public wrapper may accept a source-channel parameter",
  );
});

Deno.test("Project Update bridge: trusted-context failure precedes reads, locks, decryption, writes and audit", () => {
  const gate = canonical.indexOf(
    "v_trusted_channel NOT IN ('external_api','mcp')",
  );
  assert(gate > 0);
  for (const later of [
    "public.is_active_user(v_actor)",
    "FROM public.projects",
    "FOR UPDATE",
    "public.btpm_decrypt(",
    "UPDATE public.projects",
    "public.pmg_record_command_audit(",
  ]) {
    assert(
      canonical.indexOf(later) > gate,
      `${later} must occur after the trusted-context gate`,
    );
  }
});

// E. Exact capability.
Deno.test("Project Update bridge: exact capability remains projects:update", () => {
  assert(
    canonical.includes(
      "current_setting('api_e.capability_key', true),'')),''), '') <> 'projects:update'",
    ),
    "canonical command must pin projects:update",
  );
  assert(
    executor.includes("c_capability_key  constant text := 'projects:update';"),
    "executor must pin projects:update",
  );
  assert(
    executor.includes("c_api_version     constant text := 'v1';") &&
      executor.includes("c_capability_kind constant text := 'command';"),
  );
});

// F. Private executor exact signature.
Deno.test("Project Update bridge: private executor has the exact 38-argument signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION api_e_private\.execute_v1_update_project\(\s*_execution_source text,\s*_expected_oauth_client_id text,\s*_project_id uuid,\s*_expected_updated_at timestamptz,\s*_name text,\s*_priority text,\s*_description text,\s*_charter text,\s*_goals text,\s*_scope_in text,\s*_scope_out text,\s*_business_case text,\s*_success_criteria text,\s*_completion_criteria text,\s*_budget_narrative text,\s*_assumptions text,\s*_constraints text,\s*_program_id uuid,\s*_delivery_model text,\s*_set_name boolean,\s*_set_priority boolean,\s*_set_description boolean,\s*_set_charter boolean,\s*_set_goals boolean,\s*_set_scope_in boolean,\s*_set_scope_out boolean,\s*_set_business_case boolean,\s*_set_success_criteria boolean,\s*_set_completion_criteria boolean,\s*_set_budget_narrative boolean,\s*_set_assumptions boolean,\s*_set_constraints boolean,\s*_set_program_id boolean,\s*_set_delivery_model boolean,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb/
      .test(sql),
    "private executor signature must match the contract exactly",
  );
  assert(executor.includes("SECURITY DEFINER"));
  assert(executor.includes("SET search_path TO 'pg_catalog', 'public'"));
});

// G. Internal selector allowlist.
Deno.test("Project Update bridge: internal selector accepts external_api/mcp only", () => {
  assert(
    /IF v_source IS NULL OR v_source NOT IN \('external_api','mcp'\) THEN\s*RETURN jsonb_build_object\('ok', false, 'outcome', 'not_authorized'\);/
      .test(executor),
    "any other selector value must fail closed as not_authorized",
  );
});

// API-N.6 validation preservation.
Deno.test("Project Update bridge: API-N.6 transport validation is preserved", () => {
  for (const check of [
    "nullif(btrim(coalesce(_expected_oauth_client_id,'')),'') IS NULL",
    "_project_id IS NULL",
    "_expected_updated_at IS NULL",
    "coalesce(_payload_hash,'') !~ '^[0-9a-f]{64}$'",
    "_set_program_id IS NULL",
    "_set_delivery_model IS NULL",
    "length(btrim(_name)) > 200",
    "v_priority := v_priority_text::public.pm_priority;",
    "v_delivery_model := v_delivery_text::public.project_delivery_model;",
  ]) {
    assert(executor.includes(check), `missing preserved validation: ${check}`);
  }
});

// H. Authorization helper branch by fixed source.
Deno.test("Project Update bridge: external_api uses authorize_and_establish, mcp uses the MCP helper", () => {
  assertEquals(
    (executor.match(/api_e_private\.authorize_and_establish\(/g) ?? []).length,
    1,
  );
  assertEquals(
    (executor.match(/api_e_private\.authorize_and_establish_mcp\(/g) ?? [])
      .length,
    1,
  );
  assert(
    /IF v_source = 'external_api' THEN[\s\S]*?api_e_private\.authorize_and_establish\([\s\S]*?ELSE[\s\S]*?api_e_private\.authorize_and_establish_mcp\(/
      .test(executor),
    "each fixed source must use its own accepted authorization helper",
  );
});

// I. Structural scope derived from the target Project only.
Deno.test("Project Update bridge: structural scope is derived from the target Project only", () => {
  assert(
    /SELECT p\.id, p\.workspace_id, p\.organization_id\s*INTO v_project_id, v_workspace_id, v_organization_id\s*FROM public\.projects p\s*WHERE p\.id = _project_id;/
      .test(executor),
  );
  assert(
    !/p\.updated_at|p\.status|p\.description|p\.charter|p\.start_date|p\.target_end_date/
      .test(executor),
    "no narrative, status, planning or concurrency column may be read here",
  );
});

// J. Trusted-context re-verification.
Deno.test("Project Update bridge: trusted context is re-verified against the derived target", () => {
  for (const cond of [
    "v_ctx_client_id IS NULL",
    "v_ctx_tenant_id IS NULL",
    "v_ctx_org_id IS DISTINCT FROM v_organization_id",
    "v_ctx_workspace_id IS DISTINCT FROM v_workspace_id",
    "current_setting('api_e.api_version', true),'')),''),'') <> c_api_version",
    "current_setting('api_e.capability_kind', true),'')),''),'') <> c_capability_kind",
    "current_setting('api_e.capability_key', true),'')),''),'') <> c_capability_key",
    "current_setting('api_e.source_channel', true),'')),''),'') <> v_source",
  ]) {
    assert(executor.includes(cond), `missing context re-verification: ${cond}`);
  }
});

// K + L. Enablement required before idempotency, never written.
Deno.test("Project Update bridge: Connected App enablement precedes idempotency", () => {
  const enablement = executor.indexOf("api_project_client_enablements");
  const claim = executor.indexOf("api_e_private.claim_idempotency(");
  assert(enablement > 0 && claim > enablement, "enablement must come first");
  for (const cond of [
    "e.project_id = v_project_id",
    "e.api_client_id = v_ctx_client_id",
    "e.tenant_id = v_ctx_tenant_id",
    "e.organization_id = v_organization_id",
    "e.workspace_id = v_workspace_id",
    "e.lifecycle_status = 'enabled'",
    "e.enabled_at IS NOT NULL",
    "e.disabled_at IS NULL",
  ]) {
    assert(executor.includes(cond), `enablement must still require ${cond}`);
  }
  assert(
    !executor.includes("tenant_integrations"),
    "no tenant_integrations identity may be introduced",
  );
});

Deno.test("Project Update bridge: no Project enablement write or auto-enablement exists", () => {
  for (const forbidden of [
    "INSERT INTO public.api_project_client_enablements",
    "UPDATE public.api_project_client_enablements",
    "enable_project_for_api_client",
  ]) {
    assert(!sql.includes(forbidden), `must not contain ${forbidden}`);
  }
  assertEquals(
    (sql.match(/api_project_client_enablements/g) ?? []).length,
    1,
    "enablement is only ever read once, in the private executor",
  );
});

// M. API-F lifecycle.
Deno.test("Project Update bridge: complete API-F idempotency lifecycle", () => {
  assert(
    executor.includes(
      "api_e_private.claim_idempotency(c_capability_key, _idempotency_key, _payload_hash)",
    ),
  );
  for (const branch of [
    "'outcome', 'idempotency_conflict'",
    "'outcome', 'idempotency_pending'",
    "RETURN v_claim.canonical_result || jsonb_build_object('outcome', 'replayed');",
    "PERFORM api_e_private.complete_idempotency(v_claim.registry_id, v_result);",
    "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'stale_project');",
    "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'not_authorized');",
    "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'invalid');",
  ]) {
    assert(executor.includes(branch), `missing lifecycle branch: ${branch}`);
  }
});

// N. TOCTOU.
Deno.test("Project Update bridge: execution branch locks and re-confirms Project scope", () => {
  const claim = executor.indexOf("api_e_private.claim_idempotency(");
  const lock = executor.indexOf("FOR UPDATE");
  const apply = executor.indexOf("public.apply_project_update(");
  assert(claim < lock && lock < apply, "lock must sit between claim and apply");
  assert(
    executor.includes("v_locked_workspace_id IS DISTINCT FROM v_workspace_id") &&
      executor.includes(
        "v_locked_organization_id IS DISTINCT FROM v_organization_id",
      ),
    "TOCTOU re-confirmation must compare Workspace and Organization",
  );
});

// O + P + Q.
Deno.test("Project Update bridge: exactly one canonical command call in the shared executor", () => {
  assertEquals(
    (executor.match(/public\.apply_project_update\(/g) ?? []).length,
    1,
  );
  assert(
    !/UPDATE public\.projects/.test(executor),
    "the executor must never write Project business fields",
  );
});

Deno.test("Project Update bridge: caller expected_updated_at is forwarded unchanged with no retry", () => {
  assert(
    executor.includes("_expected_updated_at => _expected_updated_at,"),
    "the caller-supplied concurrency token must be forwarded verbatim",
  );
  assert(
    !/_expected_updated_at\s*:=/.test(executor),
    "expected_updated_at must never be reassigned",
  );
  assert(
    !/projects\.updated_at|p\.updated_at/.test(executor),
    "the executor must not read the stored updated_at",
  );
  assert(
    !/\bLOOP\b/.test(executor) && !/\bWHILE\b/.test(executor),
    "no automatic retry construct may exist",
  );
});

// R + S + T + U.
Deno.test("Project Update bridge: stale conflict remains bounded and non-leaking", () => {
  const staleReturns =
    (executor.match(
      /jsonb_build_object\('ok', false, 'outcome', 'conflict', 'code', 'stale_project'\)/g,
    ) ?? []).length;
  assertEquals(staleReturns, 2, "live conflict and replayed conflict only");
  assert(
    !executor.includes("current_updated_at"),
    "no current DB timestamp may be exposed on the stale path",
  );
});

Deno.test("Project Update bridge: applied / no_change / replayed remain represented", () => {
  assert(executor.includes("IF v_pmg_status IN ('applied','no_change') THEN"));
  assert(executor.includes("'outcome', v_pmg_status"));
  assert(executor.includes("'outcome', 'replayed'"));
});

Deno.test("Project Update bridge: no Project narrative is returned or persisted", () => {
  const safeResult = executor.slice(
    executor.indexOf("v_result := jsonb_build_object("),
    executor.indexOf("PERFORM api_e_private.complete_idempotency("),
  );
  for (const forbidden of [
    "'name'",
    "'description'",
    "'charter'",
    "'goals'",
    "'scope_in'",
    "'business_case'",
    "'program_id'",
  ]) {
    assert(
      !safeResult.includes(forbidden),
      `safe canonical result must not contain ${forbidden}`,
    );
  }
  assert(
    !executor.includes("btpm_decrypt") && !executor.includes("btpm_encrypt"),
    "the executor must never decrypt or encrypt narrative",
  );
  assert(
    !/tenant_encryption|encrypt\(|decrypt\(/i.test(executor),
    "encryption must remain in the canonical command only",
  );
});

// V. Audit ownership + derived provenance.
Deno.test("Project Update bridge: audit stays in the canonical command with derived provenance", () => {
  const audits = canonical.match(/public\.pmg_record_command_audit\(/g) ?? [];
  // conflict, no_change and applied — the three canonical terminal states.
  assertEquals(audits.length, 3);
  assertEquals(
    (canonical.match(/\n\s*v_source_channel,\n/g) ?? []).length,
    3,
    "every audit record must use the derived source channel",
  );
  assert(
    !executor.includes("pmg_record_command_audit"),
    "the executor must never write its own audit record",
  );
});

// W. Fixed-source public wrappers.
Deno.test("Project Update bridge: public wrappers hardcode their fixed source", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_update_project\([\s\S]*?RETURN api_e_private\.execute_v1_update_project\(\s*'external_api',/
      .test(sql),
    "REST wrapper must hardcode external_api",
  );
  assert(
    /CREATE OR REPLACE FUNCTION public\.mcp_v1_update_project\([\s\S]*?RETURN api_e_private\.execute_v1_update_project\(\s*'mcp',/
      .test(sql),
    "MCP wrapper must hardcode mcp",
  );
  const wrappers = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.api_v1_update_project("),
  );
  for (const forbidden of [
    "_execution_source text",
    "_source_channel",
    "_organization_id",
    "_tenant_id",
    "_workspace_id",
    "_api_client_id",
  ]) {
    assert(
      !wrappers.includes(forbidden),
      `no public wrapper may accept ${forbidden}`,
    );
  }
});

// X. ACL posture.
Deno.test("Project Update bridge: private executor is revoked from every application role", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      new RegExp(
        `REVOKE ALL ON FUNCTION api_e_private\\.execute_v1_update_project${PRIVATE_ARGS} FROM ${role};`,
      ).test(sql),
      `private executor EXECUTE must be revoked from ${role}`,
    );
  }
  assert(
    !/GRANT[^;]*api_e_private\.execute_v1_update_project/.test(sql),
    "the private executor must never be granted",
  );
});

Deno.test("Project Update bridge: public wrapper ACLs match the accepted posture", () => {
  for (const fn of ["api_v1_update_project", "mcp_v1_update_project"]) {
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${fn}${PUBLIC_ARGS} FROM ${role};`,
        ).test(sql),
        `${fn} must revoke ${role}`,
      );
    }
    assert(
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${fn}${PUBLIC_ARGS} TO authenticated;`,
      ).test(sql),
      `${fn} must grant authenticated`,
    );
  }
  assert(
    !/GRANT[^;]*(mcp_v1_update_project|api_v1_update_project)[^;]*TO (PUBLIC|anon|service_role)/
      .test(sql),
  );
  assert(
    !/(GRANT|REVOKE)[^;]*public\.apply_project_update/.test(sql),
    "the canonical command ACL must not be changed",
  );
});

// Y. No adjacent surface, schema, policy or capability change.
Deno.test("Project Update bridge: no adjacent Project command or surface is touched", () => {
  for (const forbidden of [
    "apply_project_create_blank",
    "apply_project_status_transition",
    "apply_project_planning_change",
    "apply_program_create",
    "apply_program_update",
    "portfolio",
  ]) {
    assert(!sql.includes(forbidden), `must not reference ${forbidden}`);
  }
});

Deno.test("Project Update bridge: no schema, policy or capability change", () => {
  for (const forbidden of [
    "CREATE TABLE",
    "ALTER TABLE",
    "CREATE POLICY",
    "DROP POLICY",
    "DROP FUNCTION",
    "api_capability_catalogue",
    "api_capability_grants",
    "api_client_supported_capabilities",
  ]) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

// Z. No runtime reference.
Deno.test("Project Update bridge: the MCP wrapper name never leaks into registry, factory or runtime", async () => {
  const registry = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
  );
  const factory = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/serverFactory.ts", import.meta.url),
  );
  const index = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
  );

  for (const source of [registry, factory, index]) {
    assert(
      !source.includes("mcp_v1_update_project") &&
        !source.includes("execute_v1_update_project"),
      "no MCP registry, factory or runtime module may name the Project Update wrapper",
    );
  }
});
