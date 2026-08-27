// API-Q Portfolio-9A — static contract guard for the Portfolio Create trusted
// MCP database bridge.
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
const MARKER = "API-Q Portfolio-9A — Trusted MCP Database Bridge";

const PRIVATE_SIG =
  "api_e_private.execute_v1_create_portfolio(text, text, uuid, text, text, text, text, text, uuid, text, text, text, text)";
const PUBLIC_SIG_ARGS =
  "(text, uuid, text, text, text, text, text, uuid, text, text, text, text)";

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
  assert(found.length >= 1, "expected at least one Portfolio-9A bridge migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

Deno.test("Portfolio-9A: exactly three functions are (re)defined", () => {
  const created = (sql.match(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9.]+)/g) ?? [])
    .map((m) => m.replace(/CREATE OR REPLACE FUNCTION\s+/, ""));
  assertEquals(new Set(created), new Set([
    "api_e_private.execute_v1_create_portfolio",
    "public.api_v1_create_portfolio",
    "public.mcp_v1_create_portfolio",
  ]));
  assertEquals(created.length, 3);
});

Deno.test("Portfolio-9A: private executor has the exact signature and hardening", () => {
  assert(
    /CREATE OR REPLACE FUNCTION api_e_private\.execute_v1_create_portfolio\(\s*_execution_source text,\s*_expected_oauth_client_id text,\s*_organization_id uuid,\s*_name text,\s*_code text,\s*_description text,\s*_lifecycle_state text,\s*_strategic_priority text,\s*_owner_id uuid,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb\s*LANGUAGE plpgsql\s*SECURITY DEFINER\s*SET search_path TO 'pg_catalog', 'public'/
      .test(sql),
    "private executor signature/hardening must match the contract",
  );
});

Deno.test("Portfolio-9A: REST wrapper keeps its exact 12-argument signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_create_portfolio\(\s*_expected_oauth_client_id text,\s*_organization_id uuid,\s*_name text,\s*_code text,\s*_description text,\s*_lifecycle_state text,\s*_strategic_priority text,\s*_owner_id uuid,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb/
      .test(sql),
    "REST wrapper public signature must be unchanged",
  );
});

Deno.test("Portfolio-9A: MCP wrapper has the same 12-argument signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.mcp_v1_create_portfolio\(\s*_expected_oauth_client_id text,\s*_organization_id uuid,\s*_name text,\s*_code text,\s*_description text,\s*_lifecycle_state text,\s*_strategic_priority text,\s*_owner_id uuid,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb/
      .test(sql),
    "MCP wrapper must mirror the REST public signature",
  );
});

Deno.test("Portfolio-9A: public wrappers never expose the execution source", () => {
  for (const fn of ["api_v1_create_portfolio", "mcp_v1_create_portfolio"]) {
    const match = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS jsonb`,
    ).exec(sql);
    assert(match !== null, `${fn} must be defined`);
    assert(
      !(match?.[1] ?? "").includes("_execution_source"),
      `public.${fn} must not expose the execution-source selector`,
    );
  }
});

Deno.test("Portfolio-9A: wrappers are thin and source-fixed", () => {
  assert(
    /public\.api_v1_create_portfolio\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_create_portfolio\(\s*'external_api',/
      .test(sql),
    "REST wrapper must delegate with fixed 'external_api'",
  );
  assert(
    /public\.mcp_v1_create_portfolio\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_create_portfolio\(\s*'mcp',/
      .test(sql),
    "MCP wrapper must delegate with fixed 'mcp'",
  );
});

Deno.test("Portfolio-9A: source selector accepts only external_api and mcp", () => {
  assert(
    /v_source IS NULL OR v_source NOT IN \('external_api','mcp'\)/.test(sql),
    "the selector must fail closed on NULL and any other value",
  );
  assert(
    /IF v_source IS NULL OR v_source NOT IN \('external_api','mcp'\) THEN\s*RETURN jsonb_build_object\('ok', false, 'outcome', 'not_authorized'\);/
      .test(sql),
    "fail-closed outcome must be bounded not_authorized",
  );
});

Deno.test("Portfolio-9A: source-specific API-E establishment paths", () => {
  assert(
    /IF v_source = 'external_api' THEN[\s\S]*?api_e_private\.authorize_and_establish\(/.test(sql),
    "external_api must use the REST establishment helper",
  );
  assert(
    sql.includes("api_e_private.authorize_and_establish_mcp("),
    "mcp must use the MCP establishment helper",
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

Deno.test("Portfolio-9A: capability identity is hardcoded", () => {
  assert(sql.includes("c_api_version     constant text := 'v1';"));
  assert(sql.includes("c_capability_kind constant text := 'command';"));
  assert(sql.includes("c_capability_key  constant text := 'portfolios:create';"));
});

Deno.test("Portfolio-9A: Organization scope preserved and Workspace context NULL", () => {
  assert(
    /SELECT o\.id INTO v_organization_id\s*FROM public\.organizations o\s*WHERE o\.id = _organization_id;/
      .test(sql),
    "authoritative Organization lookup must remain",
  );
  // Both establishment calls pass the Organization then a NULL Workspace.
  assertEquals(
    (sql.match(/v_organization_id,\s*NULL,\s*c_api_version/g) ?? []).length,
    2,
    "both establishment paths must pass a NULL Workspace",
  );
  assert(sql.includes("v_ctx_workspace_id IS NOT NULL"));
});

Deno.test("Portfolio-9A: trusted context reconfirms source, scope and identity", () => {
  assert(sql.includes("api_e.executing_user_id"));
  assert(sql.includes("api_e.api_client_id"));
  assert(sql.includes("api_e.tenant_id"));
  assert(sql.includes("v_ctx_user_id IS NULL"));
  assert(sql.includes("v_ctx_client_id IS NULL"));
  assert(sql.includes("v_ctx_tenant_id IS NULL"));
  assert(sql.includes("v_ctx_org_id IS DISTINCT FROM v_organization_id"));
  assert(
    /current_setting\('api_e\.source_channel', true\)[\s\S]{0,40}IS DISTINCT FROM v_source/
      .test(sql),
    "source channel must equal the fixed execution source",
  );
  assert(
    /current_setting\('api_e\.trusted', true\)[\s\S]{0,40}<> 'true'/.test(sql),
    "trusted flag must be reconfirmed",
  );
  const params = /CREATE OR REPLACE FUNCTION api_e_private\.execute_v1_create_portfolio\(([\s\S]*?)\)\s*RETURNS jsonb/
    .exec(sql)?.[1] ?? "";
  assert(params.length > 0, "private executor parameter list must be present");
  for (const forbidden of ["_tenant_id", "_executing_user_id", "_api_client_id", "_workspace_id", "_source_channel"]) {
    assert(
      !params.includes(forbidden),
      `caller must never supply ${forbidden}`,
    );
  }
});

Deno.test("Portfolio-9A: Organization Admin authority and owner validation remain", async () => {
  assert(
    sql.includes("public.is_org_admin(v_ctx_user_id, v_organization_id) IS NOT TRUE"),
    "Organization Admin authority must remain mandatory",
  );

  // Portfolio-12C.2 superseded the profile-pointer owner predicate frozen here.
  const CORRECTION_MARKER =
    "API-Q Portfolio-12C.2 — External Portfolio Create/Update Owner Membership Alignment";
  let current = "";
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
    if (text.includes(CORRECTION_MARKER)) current = stripSqlComments(text);
  }
  assert(current.length > 0, "the Portfolio-12C.2 correction migration must exist");
  const createBody = current.slice(
    current.indexOf("api_e_private.execute_v1_create_portfolio("),
    current.indexOf("api_e_private.execute_v1_update_portfolio("),
  );
  assert(
    /IF _owner_id IS NOT NULL THEN[\s\S]*?public\.is_user_org_member\(_owner_id, v_organization_id\) IS NOT TRUE/
      .test(createBody),
    "Create owner eligibility must use the canonical membership helper",
  );
  assert(
    !createBody.includes("FROM public.profiles") &&
      !createBody.includes("v_owner_org"),
    "profiles.organization_id must no longer drive Create owner eligibility",
  );
});


Deno.test("Portfolio-9A: API-F idempotency lifecycle is preserved", () => {
  assert(sql.includes("api_e_private.claim_idempotency(c_capability_key"));
  assert(sql.includes("api_e_private.complete_idempotency("));
  for (const decision of ["conflict", "pending", "replay", "execute"]) {
    assert(sql.includes(`'${decision}'`), `decision ${decision} must be handled`);
  }
  assert(sql.includes("'idempotency_conflict'"));
  assert(sql.includes("'idempotency_pending'"));
  assert(sql.includes("'replayed'"));
  assert(sql.includes("v_claim.failure_code = 'not_authorized'"));
  assert(sql.includes("v_claim.failure_code = 'invalid'"));
});

Deno.test("Portfolio-9A: exactly one canonical Portfolio writer execution", () => {
  assertEquals(
    (sql.match(/public\.admin_create_portfolio_item\(/g) ?? []).length,
    1,
    "the canonical writer must be called exactly once",
  );
  assert(sql.includes("v_portfolio_id := public.admin_create_portfolio_item("));
  assert(
    !/CREATE OR REPLACE FUNCTION public\.admin_create_portfolio_item/.test(sql),
    "the canonical writer must not be redefined",
  );
});

Deno.test("Portfolio-9A: no direct portfolio_items write is introduced", () => {
  assert(!/INSERT INTO public\.portfolio_items/i.test(sql));
  assert(!/UPDATE public\.portfolio_items/i.test(sql));
  assert(!/portfolio_items/.test(sql.replace(/admin_create_portfolio_item/g, "")));
  assert(!/decrypt/i.test(sql), "no decryption may be introduced");
});

Deno.test("Portfolio-9A: PMG provenance is derived from the fixed source", () => {
  assert(sql.includes("'external_api'::public.pmg_source_channel"));
  assert(sql.includes("'mcp'::public.pmg_source_channel"));
  assert(
    /PERFORM public\.pmg_record_command_audit\([\s\S]*?v_source_channel,/.test(sql),
    "audit must use the server-derived source channel",
  );
  assertEquals(
    (sql.match(/pmg_record_command_audit\(/g) ?? []).length,
    1,
  );
});

Deno.test("Portfolio-9A: audit metadata excludes protected narrative", () => {
  const audit = /PERFORM public\.pmg_record_command_audit\(([\s\S]*?)\n  \);/.exec(sql)?.[1] ?? "";
  assert(audit.length > 0, "audit call must be present");
  assert(audit.includes("'code_set'"));
  assert(audit.includes("'description_set'"));
  for (const forbidden of ["v_name", "'name'", "v_code,", "v_description,", "_expected_oauth_client_id"]) {
    assert(!audit.includes(forbidden), `audit metadata must not contain ${forbidden}`);
  }
});

Deno.test("Portfolio-9A: private executor is inaccessible to all ordinary roles", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(`REVOKE ALL ON FUNCTION ${PRIVATE_SIG} FROM ${role};`),
      `${role} must be revoked on the private executor`,
    );
  }
  assert(
    !/GRANT EXECUTE ON FUNCTION api_e_private\.execute_v1_create_portfolio/.test(sql),
    "the private executor must never be granted",
  );
});

Deno.test("Portfolio-9A: both public wrappers are authenticated-only", () => {
  const grants = (sql.match(/GRANT[^;]*;/g) ?? []).map((g) => g.replace(/\s+/g, " ").trim());
  assertEquals(grants.length, 2, "exactly two grants may exist");
  assert(grants.every((g) => g.endsWith("TO authenticated;")));
  assert(!/GRANT[^;]*TO (PUBLIC|anon|service_role)/.test(sql));
  for (const fn of ["api_v1_create_portfolio", "mcp_v1_create_portfolio"]) {
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(`REVOKE ALL ON FUNCTION public.${fn}${PUBLIC_SIG_ARGS} FROM ${role};`),
        `${role} must be revoked on public.${fn}`,
      );
    }
    assert(
      sql.includes(`GRANT EXECUTE ON FUNCTION public.${fn}${PUBLIC_SIG_ARGS} TO authenticated;`),
      `public.${fn} must be granted to authenticated`,
    );
  }
});

Deno.test("Portfolio-9A: no table, enablement, capability or RLS change", () => {
  for (const forbidden of [
    "CREATE TABLE",
    "ALTER TABLE",
    "DROP FUNCTION",
    "CREATE POLICY",
    "ALTER POLICY",
    "ROW LEVEL SECURITY",
    "api_capability_catalogue",
    "api_client_capability_grants",
    "api_project_client_enablements",
    "CREATE TRIGGER",
    "api_v1_update_portfolio",
    "api_v1_assign_project_portfolio",
  ]) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});
