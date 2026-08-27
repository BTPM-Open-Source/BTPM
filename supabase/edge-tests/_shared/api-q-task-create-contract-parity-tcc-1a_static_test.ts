// API-Q Task Create Contract Parity Correction TCC-1A — static guard.
//
// Repository/static test only: it locates the committed correction migration by
// its unique marker (never by a hardcoded timestamped filename) and verifies
// that the restored private Task Create executor again uses the accepted
// REST/MCP trusted-context establishment paths and the explicit Project
// Connected App enablement check, while retaining the two correct TCC-1
// bounded-result additions. No database, network or Edge access.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q Task Create Contract Parity Correction TCC-1A";

function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      while (i < n && sql[i] !== "\n") i += 1;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < n && sql.slice(i, i + 2) !== "*/") i += 1;
      i += 2;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

function readCorrectionMigration(): string {
  const names: string[] = [];
  for (const entry of Deno.readDirSync(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) names.push(entry.name);
  }
  names.sort();
  const matches = names
    .map((name) => Deno.readTextFileSync(new URL(name, MIGRATIONS_DIR)))
    .filter((sql) => sql.includes(MARKER));
  assert(matches.length > 0, "TCC-1A correction migration marker not found");
  return matches[matches.length - 1];
}

const RAW = readCorrectionMigration();
const SQL = stripSqlComments(RAW);
const FLAT = SQL.replace(/\s+/g, " ");

Deno.test("TCC-1A: redefines exactly one function — the private executor", () => {
  const defs = SQL.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+[^\s(]+/gi) ?? [];
  assertEquals(defs.length, 1, "migration must define exactly one function");
  assert(
    (defs[0] ?? "").endsWith("api_e_private.execute_v1_create_task"),
    "unexpected function defined",
  );
  assert(SQL.includes("RETURNS jsonb"), "return type changed");
  assert(SQL.includes("LANGUAGE plpgsql"), "language changed");
  assert(SQL.includes("SECURITY DEFINER"), "SECURITY DEFINER removed");
  assert(
    SQL.includes("SET search_path TO 'pg_catalog', 'public'"),
    "search_path pinning changed",
  );
});

Deno.test("TCC-1A: restores exactly one REST and one MCP establishment call", () => {
  assertEquals(
    (SQL.match(/api_e_private\.authorize_and_establish\s*\(/g) ?? []).length,
    1,
    "expected exactly one authorize_and_establish call",
  );
  assertEquals(
    (SQL.match(/api_e_private\.authorize_and_establish_mcp\s*\(/g) ?? []).length,
    1,
    "expected exactly one authorize_and_establish_mcp call",
  );
  assert(
    !SQL.includes("api_e_private.assert_trusted_context"),
    "establishment must not be replaced by assert_trusted_context",
  );
});

Deno.test("TCC-1A: preserves the fixed source branch mapping", () => {
  assert(
    FLAT.includes("v_source NOT IN ('external_api','mcp')"),
    "execution-source selector changed",
  );
  const restBranch = FLAT.indexOf("IF v_source = 'external_api' THEN");
  const restCall = FLAT.indexOf("api_e_private.authorize_and_establish( ");
  const mcpCall = FLAT.indexOf("api_e_private.authorize_and_establish_mcp(");
  assert(restBranch >= 0, "external_api branch missing");
  assert(
    restBranch < restCall && restCall < mcpCall,
    "external_api must establish via REST before the MCP ELSE branch",
  );
  assert(
    FLAT.includes("IF v_trusted IS NOT TRUE THEN"),
    "fail-closed trusted check missing",
  );
});

Deno.test("TCC-1A: Project Connected App enablement is explicit and precedes idempotency", () => {
  assert(
    SQL.includes("public.api_project_client_enablements"),
    "explicit Project enablement check missing",
  );
  for (
    const clause of [
      "e.lifecycle_status = 'enabled'",
      "e.enabled_at IS NOT NULL",
      "e.disabled_at IS NULL",
      "e.project_id = v_project_id",
      "e.api_client_id = v_ctx_client_id",
      "e.tenant_id = v_ctx_tenant_id",
      "e.organization_id = v_organization_id",
      "e.workspace_id = v_workspace_id",
    ]
  ) {
    assert(SQL.includes(clause), `enablement clause missing: ${clause}`);
  }
  assert(
    SQL.indexOf("api_project_client_enablements") <
      SQL.indexOf("api_e_private.claim_idempotency"),
    "Project enablement must precede claim_idempotency",
  );
});

Deno.test("TCC-1A: no internal api_client_id vs OAuth client-id comparison", () => {
  assert(
    !/v_ctx_client_id[^;]*_expected_oauth_client_id/.test(FLAT),
    "incorrect internal/OAuth client-id comparison present",
  );
  assert(
    !/_expected_oauth_client_id[^;]*v_ctx_client_id/.test(FLAT),
    "incorrect internal/OAuth client-id comparison present",
  );
});

Deno.test("TCC-1A: preserves structural containment and the Phase TOCTOU lock", () => {
  assert(
    FLAT.includes("v_workspace_id IS DISTINCT FROM v_row_workspace_id"),
    "Phase/Project Workspace containment missing",
  );
  assert(
    FLAT.includes("v_organization_id IS DISTINCT FROM v_row_organization_id"),
    "Phase/Project Organization containment missing",
  );
  assert(
    FLAT.includes("v_ctx_org_id IS DISTINCT FROM v_organization_id"),
    "trusted-context Organization consistency missing",
  );
  assert(
    FLAT.includes("v_ctx_workspace_id IS DISTINCT FROM v_workspace_id"),
    "trusted-context Workspace consistency missing",
  );
  assert(
    FLAT.includes("WHERE ph.id = _phase_id FOR UPDATE"),
    "Phase FOR UPDATE TOCTOU lock missing",
  );
  assert(
    FLAT.includes(
      "v_locked_project_id IS DISTINCT FROM v_project_id",
    ),
    "locked Phase containment re-check missing",
  );
});

Deno.test("TCC-1A: retains the bounded task_dates_required mapping and replay", () => {
  assert(
    FLAT.includes(
      "IF (v_data ->> 'reason') = 'baselined_project_requires_task_dates' THEN",
    ),
    "bounded PMG reason mapping missing",
  );
  assert(
    FLAT.includes(
      "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'task_dates_required');",
    ),
    "bounded failure code is not persisted",
  );
  assert(
    FLAT.includes("ELSIF v_claim.failure_code = 'task_dates_required' THEN"),
    "failed-idempotency replay of the bounded code missing",
  );
  assert(
    FLAT.includes(
      "RETURN jsonb_build_object( 'ok', false, 'outcome', 'invalid', 'code', 'task_dates_required' );",
    ),
    "bounded result shape changed",
  );
  assert(
    !SQL.includes("'baselined_project_requires_task_dates'") ||
      (SQL.match(/baselined_project_requires_task_dates/g) ?? []).length === 1,
    "raw PMG reason must only be matched, never returned",
  );
});

Deno.test("TCC-1A: generic invalid and Phase-window behavior unchanged", () => {
  assert(
    FLAT.includes(
      "PERFORM api_e_private.fail_idempotency(v_claim.registry_id, 'invalid'); RETURN jsonb_build_object('ok', false, 'outcome', 'invalid');",
    ),
    "generic invalid behavior changed",
  );
  assert(
    SQL.includes("extend_phase_window_required"),
    "Phase-window confirmation contract removed",
  );
  assert(
    FLAT.includes("ELSIF v_claim.failure_code = 'invalid' THEN"),
    "generic invalid replay removed",
  );
  assert(
    FLAT.includes("IF v_claim.failure_code = 'not_authorized' THEN"),
    "not_authorized replay removed",
  );
});

Deno.test("TCC-1A: reasserts private executor REVOKEs and introduces no GRANT", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    const re = new RegExp(
      `REVOKE ALL ON FUNCTION\\s+api_e_private\\.execute_v1_create_task\\([^)]*\\)\\s+FROM ${role};`,
    );
    assert(re.test(SQL), `missing REVOKE from ${role}`);
  }
  assertEquals(SQL.includes("GRANT"), false, "migration must not GRANT");
});

Deno.test("TCC-1A: does not redefine canonical or public Task Create functions", () => {
  for (
    const forbidden of [
      "CREATE OR REPLACE FUNCTION public.apply_task_create",
      "FUNCTION public.apply_task_create",
      "FUNCTION public.api_v1_create_task",
      "FUNCTION public.mcp_v1_create_task",
    ]
  ) {
    assertEquals(
      SQL.includes(forbidden),
      false,
      `migration must not redefine ${forbidden}`,
    );
  }
  // Exactly one canonical PMG invocation remains.
  assertEquals(
    (SQL.match(/public\.apply_task_create\s*\(/g) ?? []).length,
    1,
    "exactly one apply_task_create call expected",
  );
  for (
    const forbidden of [
      "DROP FUNCTION",
      "is_baselined",
      "seed_post_baseline_task",
      "api_capability_catalogue",
    ]
  ) {
    assertEquals(
      SQL.includes(forbidden),
      false,
      `migration must not touch ${forbidden}`,
    );
  }
});

Deno.test("TCC-1A: no Phase Create surface is touched", () => {
  for (
    const forbidden of [
      "execute_v1_create_phase",
      "api_v1_create_phase",
      "mcp_v1_create_phase",
      "apply_phase_create",
      "phases:create",
    ]
  ) {
    assertEquals(
      SQL.includes(forbidden),
      false,
      `migration must not touch ${forbidden}`,
    );
  }
  assert(SQL.includes("'tasks:create'"), "fixed capability key changed");
});
