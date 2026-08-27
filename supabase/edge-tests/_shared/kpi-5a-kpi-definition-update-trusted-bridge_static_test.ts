// KPI-5A — static contract guard for the trusted dual-source KPI definition
// update database bridge.
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
const MARKER =
  "KPI-5A — Trusted dual-source KPI definition update database bridge";

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
  assert(found.length >= 1, "expected at least one KPI-5A bridge migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

const CANONICAL_HEAD =
  "CREATE OR REPLACE FUNCTION public.apply_kpi_definition_update(";
const EXECUTOR_HEAD =
  "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_kpi(";
const REST_HEAD = "CREATE OR REPLACE FUNCTION public.api_v1_update_kpi(";
const MCP_HEAD = "CREATE OR REPLACE FUNCTION public.mcp_v1_update_kpi(";

function block(startNeedle: string, endNeedle: string): string {
  const start = sql.indexOf(startNeedle);
  const end = sql.indexOf(endNeedle);
  assert(start >= 0 && end > start, `block missing: ${startNeedle}`);
  return sql.slice(start, end);
}

const catalogue = sql.slice(0, sql.indexOf(CANONICAL_HEAD));
const canonical = block(CANONICAL_HEAD, EXECUTOR_HEAD);
const executor = block(EXECUTOR_HEAD, REST_HEAD);
const restWrapper = block(REST_HEAD, MCP_HEAD);
const mcpWrapper = sql.slice(sql.indexOf(MCP_HEAD));

// ---------------------------------------------------------------------------
// 1. Capability catalogue row
// ---------------------------------------------------------------------------
Deno.test("KPI-5A: capability catalogue registers kpis:update exactly", () => {
  assert(catalogue.includes("public.api_capability_catalogue"));
  assert(catalogue.includes("'kpis:update'"));
  assert(catalogue.includes("'kpis.update'"));
  assert(catalogue.includes("'PATCH'"));
  assert(catalogue.includes("'/v1/kpis/:kpiid'"));
  assert(catalogue.includes("'project'"));
  assert(catalogue.includes("'v1'"));
  assert(catalogue.includes("'command'"));
  assert(catalogue.includes("'Update Project KPI'"));
  assert(catalogue.includes("'active'"));
  assert(!catalogue.includes("'kpis:read'"));
  assert(!catalogue.includes("'kpis:create'"));
  assert(!catalogue.includes("api_project_client_enablements"));
  assert(!catalogue.includes("api_capability_grants"));
});

// ---------------------------------------------------------------------------
// 2. Canonical PMG signature and source-awareness
// ---------------------------------------------------------------------------
Deno.test("KPI-5A: canonical PMG keeps its exact public signature", () => {
  for (
    const param of [
      "_kpi_definition_id uuid",
      "_expected_updated_at timestamp with time zone",
      "_target_direction public.kpi_target_direction DEFAULT NULL::public.kpi_target_direction",
      "_correlation_id text DEFAULT NULL::text",
      "_idempotency_key text DEFAULT NULL::text",
    ]
  ) {
    assert(canonical.includes(param), `missing canonical param: ${param}`);
  }
  for (
    const flag of [
      "_set_name",
      "_set_description",
      "_set_unit",
      "_set_target_value",
      "_set_target_direction",
      "_set_source_mode",
      "_set_value_type",
      "_set_cadence",
      "_set_calculation_key",
      "_set_formula_version",
      "_set_completion_method",
      "_set_comment_required",
      "_set_action_plan_required",
      "_set_auto_snapshot_enabled",
    ]
  ) {
    assert(
      canonical.includes(`${flag} boolean DEFAULT false`),
      `missing canonical presence flag default: ${flag}`,
    );
  }
});

Deno.test("KPI-5A: canonical default source channel remains btpm_ui", () => {
  assert(
    canonical.includes(
      "v_source_channel public.pmg_source_channel := 'btpm_ui'::public.pmg_source_channel",
    ),
  );
  // No hardcoded btpm_ui audit remains.
  assert(!canonical.includes("'btpm_ui'::public.pmg_source_channel,"));
});

Deno.test("KPI-5A: external execution requires exactly v1/command/kpis:update and external_api|mcp", () => {
  assert(canonical.includes("api_e_private.jwt_client_id()"));
  assert(canonical.includes("api_e_private.assert_trusted_context()"));
  assert(canonical.includes("<> 'v1'"));
  assert(canonical.includes("<> 'command'"));
  assert(canonical.includes("<> 'kpis:update'"));
  assert(canonical.includes("NOT IN ('external_api','mcp')"));
  assert(!canonical.includes("'kpis:create'"));
});

Deno.test("KPI-5A: external containment fails closed before lookup, decryption, write and audit", () => {
  const guard = canonical.indexOf("NOT IN ('external_api','mcp')");
  const activeUser = canonical.indexOf("public.is_active_user(v_actor)");
  const lookup = canonical.indexOf("FROM public.kpi_definitions");
  const decrypt = canonical.indexOf("public.btpm_decrypt(");
  const update = canonical.indexOf("UPDATE public.kpi_definitions");
  const audit = canonical.indexOf("public.pmg_record_command_audit(");
  assert(guard > 0);
  for (const later of [activeUser, lookup, decrypt, update, audit]) {
    assert(later > guard, "external guard must precede all canonical work");
  }
});

Deno.test("KPI-5A: every canonical audit uses the server-derived source channel", () => {
  const audits = canonical.split("public.pmg_record_command_audit(").slice(1);
  assertEquals(audits.length, 3); // conflict, no_change, applied
  for (const a of audits) {
    assert(
      a.slice(0, 200).includes("v_source_channel"),
      "audit must use v_source_channel",
    );
  }
});

Deno.test("KPI-5A: description plaintext comparison stays inside canonical PMG only", () => {
  assert(
    canonical.includes(
      "public.btpm_decrypt(v_row.description, v_row.organization_id)",
    ),
  );
  for (const b of [executor, restWrapper, mcpWrapper]) {
    assert(!b.includes("btpm_decrypt"));
    assert(!b.includes("btpm_encrypt"));
    assert(!b.includes("description'"));
  }
});

// ---------------------------------------------------------------------------
// 3. Private executor properties
// ---------------------------------------------------------------------------
Deno.test("KPI-5A: executor is SECURITY DEFINER with a pinned search_path", () => {
  assert(executor.includes("SECURITY DEFINER"));
  assert(executor.includes("SET search_path TO 'pg_catalog', 'public'"));
});

Deno.test("KPI-5A: executor takes no caller-supplied scope, actor, time or source channel", () => {
  const header = executor.slice(0, executor.indexOf("RETURNS jsonb"));
  for (
    const forbidden of [
      "_project_id",
      "_workspace_id",
      "_organization_id",
      "_tenant_id",
      "_actor",
      "_user_id",
      "_source_channel",
      "_now",
      "_current_updated_at",
    ]
  ) {
    assert(!header.includes(forbidden), `forbidden input: ${forbidden}`);
  }
  assert(header.includes("_execution_source text"));
  assert(header.includes("_expected_updated_at timestamp with time zone"));
  assert(header.includes("_payload_hash text"));
});

Deno.test("KPI-5A: executor validates transport inputs and all 14 presence flags", () => {
  assert(executor.includes("'^[0-9a-f]{64}$'"));
  assert(executor.includes("_expected_updated_at IS NULL"));
  assert(executor.includes("'00000000-0000-0000-0000-000000000000'::uuid"));
  for (
    const flag of [
      "_set_name IS NULL",
      "_set_description IS NULL",
      "_set_unit IS NULL",
      "_set_target_value IS NULL",
      "_set_target_direction IS NULL",
      "_set_source_mode IS NULL",
      "_set_value_type IS NULL",
      "_set_cadence IS NULL",
      "_set_calculation_key IS NULL",
      "_set_formula_version IS NULL",
      "_set_completion_method IS NULL",
      "_set_comment_required IS NULL",
      "_set_action_plan_required IS NULL",
      "_set_auto_snapshot_enabled IS NULL",
    ]
  ) {
    assert(executor.includes(flag), `missing null flag check: ${flag}`);
  }
});

Deno.test("KPI-5A: target direction cast is exception-safe and only applied when set", () => {
  assert(executor.includes("IF _set_target_direction THEN"));
  assert(executor.includes("v_direction_raw::public.kpi_target_direction"));
  assert(executor.includes("EXCEPTION WHEN OTHERS THEN"));
  assert(executor.includes("'outcome', 'invalid'"));
});

Deno.test("KPI-5A: executor does not duplicate KPI business vocabularies", () => {
  for (
    const vocab of ["'manual'", "'number'", "'manual_only'", "'increase'", "'decrease'"]
  ) {
    assert(!executor.includes(vocab), `business vocabulary leaked: ${vocab}`);
  }
});

Deno.test("KPI-5A: executor derives scope from KPI -> Project only, project-targeted, consistent", () => {
  assert(executor.includes("FROM public.kpi_definitions k"));
  assert(executor.includes("JOIN public.projects p ON p.id = k.target_id"));
  assert(executor.includes("k.target_type = 'project'"));
  assert(executor.includes("k.workspace_id = p.workspace_id"));
  assert(executor.includes("k.organization_id = p.organization_id"));
  assert(executor.includes("'outcome', 'not_authorized'"));
  // Never reads narrative, configuration or current concurrency token.
  assert(!executor.includes("k.name"));
  assert(!executor.includes("k.description"));
  assert(!executor.includes("k.updated_at"));
  assert(!executor.includes("SELECT updated_at"));
});

Deno.test("KPI-5A: executor establishes exact trusted context per fixed source", () => {
  assert(executor.includes("c_capability_key  constant text := 'kpis:update'"));
  assert(executor.includes("c_api_version     constant text := 'v1'"));
  assert(executor.includes("c_capability_kind constant text := 'command'"));
  assert(executor.includes("api_e_private.authorize_and_establish("));
  assert(executor.includes("api_e_private.authorize_and_establish_mcp("));
  assert(executor.includes("current_setting('api_e.api_client_id', true)"));
  assert(executor.includes("current_setting('api_e.tenant_id', true)"));
  assert(executor.includes("v_ctx_org_id IS DISTINCT FROM v_organization_id"));
  assert(executor.includes("v_ctx_workspace_id IS DISTINCT FROM v_workspace_id"));
  assert(executor.includes("v_ctx_api_version IS DISTINCT FROM c_api_version"));
  assert(
    executor.includes("v_ctx_capability_kind IS DISTINCT FROM c_capability_kind"),
  );
  assert(
    executor.includes("v_ctx_capability_key IS DISTINCT FROM c_capability_key"),
  );
  assert(executor.includes("v_ctx_source_channel IS DISTINCT FROM v_source"));
});

Deno.test("KPI-5A: exact Project Connected App enablement is required before API-F and PMG", () => {
  const enablement = executor.indexOf("public.api_project_client_enablements");
  const claim = executor.indexOf("api_e_private.claim_idempotency(");
  const pmg = executor.indexOf("public.apply_kpi_definition_update(");
  assert(enablement > 0 && claim > enablement && pmg > claim);
  assert(executor.includes("e.lifecycle_status = 'enabled'"));
  assert(executor.includes("e.enabled_at IS NOT NULL"));
  assert(executor.includes("e.disabled_at IS NULL"));
  assert(!executor.includes("INSERT INTO public.api_project_client_enablements"));
  assert(!executor.includes("UPDATE public.api_project_client_enablements"));
});

Deno.test("KPI-5A: idempotency uses the fixed capability key and bounded outcomes", () => {
  assert(
    executor.includes(
      "api_e_private.claim_idempotency(c_capability_key, _idempotency_key, _payload_hash)",
    ),
  );
  assert(executor.includes("'outcome', 'idempotency_conflict'"));
  assert(executor.includes("'outcome', 'idempotency_pending'"));
  assert(executor.includes("'outcome', 'replayed'"));
  assert(executor.includes("v_claim.failure_code = 'stale_kpi_definition'"));
  assert(executor.includes("v_claim.failure_code = 'not_authorized'"));
  assert(executor.includes("v_claim.failure_code = 'invalid'"));
  assert(executor.includes("unknown persisted failure code"));
});

Deno.test("KPI-5A: TOCTOU containment recheck happens after claim, before PMG", () => {
  const claim = executor.indexOf("api_e_private.claim_idempotency(");
  const lock = executor.indexOf("FOR UPDATE OF k");
  const pmg = executor.indexOf("public.apply_kpi_definition_update(");
  assert(claim > 0 && lock > claim && pmg > lock);
  assert(executor.includes("k.target_id = v_project_id"));
  assert(
    executor.includes(
      "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'not_authorized')",
    ),
  );
});

Deno.test("KPI-5A: exactly one canonical PMG invocation and no direct KPI write", () => {
  assertEquals(
    executor.split("public.apply_kpi_definition_update(").length - 1,
    1,
  );
  assert(!executor.includes("UPDATE public.kpi_definitions"));
  assert(!executor.includes("INSERT INTO public.kpi_definitions"));
  assert(!executor.includes("DELETE FROM public.kpi_definitions"));
  assert(!executor.includes("EXECUTE "));
});

Deno.test("KPI-5A: expected_updated_at is forwarded unchanged to canonical PMG", () => {
  const call = executor.slice(
    executor.indexOf("public.apply_kpi_definition_update("),
  );
  assert(call.includes("_kpi_definition_id,"));
  assert(call.includes("_expected_updated_at,"));
  assert(!call.includes("now()"));
  assert(!call.includes("coalesce(_expected_updated_at"));
  for (
    const flag of [
      "_set_name,",
      "_set_description,",
      "_set_unit,",
      "_set_target_value,",
      "_set_target_direction,",
      "_set_source_mode,",
      "_set_value_type,",
      "_set_cadence,",
      "_set_calculation_key,",
      "_set_formula_version,",
      "_set_completion_method,",
      "_set_comment_required,",
      "_set_action_plan_required,",
      "_set_auto_snapshot_enabled,",
    ]
  ) {
    assert(call.includes(flag), `presence flag not forwarded: ${flag}`);
  }
  for (
    const value of [
      "_name,",
      "_description,",
      "_unit,",
      "_target_value,",
      "v_direction,",
      "_source_mode,",
      "_value_type,",
      "_cadence,",
      "_calculation_key,",
      "_formula_version,",
      "_completion_method,",
      "_comment_required,",
      "_action_plan_required,",
      "_auto_snapshot_enabled,",
    ]
  ) {
    assert(call.includes(value), `value not forwarded: ${value}`);
  }
});

Deno.test("KPI-5A: bounded applied/no_change result exposes only kpiId/projectId/updatedAt", () => {
  assert(executor.includes("v_status = 'applied' OR v_status = 'no_change'"));
  assert(executor.includes("'kpiId', v_kpi_id"));
  assert(executor.includes("'projectId', v_project_id"));
  assert(executor.includes("'updatedAt', v_updated_at"));
  assert(executor.includes("'outcome', v_status"));
  assert(
    executor.includes(
      "PERFORM api_e_private.complete_idempotency(v_claim.registry_id, v_result)",
    ),
  );
  assert(!executor.includes("'name'"));
  assert(!executor.includes("'reason'"));
});

Deno.test("KPI-5A: stale conflict is bounded and leaks no current timestamp", () => {
  assert(
    executor.includes(
      "'outcome', 'conflict', 'code', 'stale_kpi_definition'",
    ),
  );
  assert(
    executor.includes(
      "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'stale_kpi_definition')",
    ),
  );
  assert(!executor.includes("current_updated_at"));
});

Deno.test("KPI-5A: invalid/not_authorized are persisted and returned bounded", () => {
  assert(
    executor.includes(
      "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'invalid')",
    ),
  );
  assert(
    executor.includes(
      "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'not_authorized')",
    ),
  );
  assert(executor.includes("unexpected canonical command status"));
});

// ---------------------------------------------------------------------------
// 4. Wrappers and ACL
// ---------------------------------------------------------------------------
Deno.test("KPI-5A: REST wrapper is thin and fixed to external_api", () => {
  assert(restWrapper.includes("api_e_private.execute_v1_update_kpi("));
  assert(restWrapper.includes("'external_api',"));
  assert(!restWrapper.includes("'mcp',"));
  assert(!restWrapper.includes("_execution_source"));
  assert(!restWrapper.includes("public.apply_kpi_definition_update("));
  assert(!restWrapper.includes("kpi_definitions"));
});

Deno.test("KPI-5A: MCP wrapper is thin and fixed to mcp", () => {
  assert(mcpWrapper.includes("api_e_private.execute_v1_update_kpi("));
  assert(mcpWrapper.includes("'mcp',"));
  assert(!mcpWrapper.includes("'external_api',"));
  assert(!mcpWrapper.includes("_execution_source"));
  assert(!mcpWrapper.includes("public.apply_kpi_definition_update("));
  assert(!mcpWrapper.includes("kpi_definitions"));
});

Deno.test("KPI-5A: ACL is least privilege", () => {
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION api_e_private.execute_v1_update_kpi",
    ),
  );
  for (const role of ["FROM PUBLIC", "FROM anon", "FROM authenticated", "FROM service_role"]) {
    assert(
      sql.includes(`api_e_private.execute_v1_update_kpi`) && sql.includes(role),
      `missing revoke role: ${role}`,
    );
  }
  assert(
    !sql.includes("GRANT EXECUTE ON FUNCTION api_e_private.execute_v1_update_kpi"),
  );
  assert(sql.includes("GRANT EXECUTE ON FUNCTION public.api_v1_update_kpi"));
  assert(sql.includes("GRANT EXECUTE ON FUNCTION public.mcp_v1_update_kpi"));
  assert(sql.includes("TO authenticated;"));
  assert(!sql.includes("TO anon;"));
  assert(!sql.includes("TO service_role;"));
});

// ---------------------------------------------------------------------------
// 5. Migration containment
// ---------------------------------------------------------------------------
Deno.test("KPI-5A: migration performs no table, RLS, trigger or grant broadening", () => {
  for (
    const forbidden of [
      "CREATE TABLE",
      "ALTER TABLE",
      "DROP TABLE",
      "CREATE POLICY",
      "DROP POLICY",
      "ENABLE ROW LEVEL SECURITY",
      "CREATE TRIGGER",
      "DROP TRIGGER",
      "GRANT SELECT",
      "GRANT INSERT",
      "GRANT UPDATE",
      "GRANT DELETE",
      "GRANT ALL",
    ]
  ) {
    assert(!sql.includes(forbidden), `forbidden statement: ${forbidden}`);
  }
});

Deno.test("KPI-5A: migration creates only the KPI-5A functions", () => {
  const created = [...sql.matchAll(/CREATE OR REPLACE FUNCTION ([\w.]+)\(/g)]
    .map((m) => m[1]);
  assertEquals(created, [
    "public.apply_kpi_definition_update",
    "api_e_private.execute_v1_update_kpi",
    "public.api_v1_update_kpi",
    "public.mcp_v1_update_kpi",
  ]);
});

// Superseded by the accepted KPI-5B (REST) and KPI-5C (MCP) activation steps.
// What remains durable for KPI-5A is that the runtime never bypasses the
// accepted database wrappers with its own SQL or a generic RPC name.
Deno.test("KPI-5A: the runtime reaches the substrate only through the accepted wrappers", async () => {
  const router = await Deno.readTextFile(
    new URL("../../functions/btpm-api-v1/router.ts", import.meta.url),
  );
  assert(!router.includes("execute_v1_update_kpi"));
  assert(!router.includes("apply_kpi_definition_update"));
  assert(!router.includes(".rpc("));
});
