// API-Q Portfolio-10A — static contract guard for the Portfolio Update trusted
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
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER =
  "API-Q Portfolio-10A — Portfolio Update Trusted MCP Database Bridge";

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
  assert(found.length >= 1, "expected at least one Portfolio-10A migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

const PRIVATE_TYPES =
  "text, text, uuid, timestamptz, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, uuid, boolean, text, text, text, text";
const PUBLIC_TYPES =
  "text, uuid, timestamptz, text, boolean, text, boolean, text, boolean, text, boolean, text, boolean, uuid, boolean, text, text, text, text";

const PUBLIC_ARGS = `(
  _expected_oauth_client_id text,
  _portfolio_item_id uuid,
  _expected_updated_at timestamptz,
  _name text,
  _set_name boolean,
  _code text,
  _set_code boolean,
  _description text,
  _set_description boolean,
  _lifecycle_state text,
  _set_lifecycle_state boolean,
  _strategic_priority text,
  _set_strategic_priority boolean,
  _owner_id uuid,
  _set_owner_id boolean,
  _request_id text,
  _correlation_id text,
  _idempotency_key text,
  _payload_hash text
)`;

// 1 — exact private 20-argument signature including the internal source.
Deno.test("10A: private executor keeps the exact 20-argument signature", () => {
  const decl = new RegExp(
    "CREATE OR REPLACE FUNCTION api_e_private\\.execute_v1_update_portfolio\\(([\\s\\S]*?)\\)\\s*RETURNS jsonb",
  ).exec(sql);
  assert(decl !== null, "the private executor must be defined");
  const args = (decl?.[1] ?? "").split(",").map((a) => a.trim());
  assertEquals(args.length, 20, "the private executor takes exactly 20 arguments");
  assertEquals(args[0], "_execution_source text");
  assertEquals(
    args.slice(1),
    PUBLIC_ARGS.slice(1, -1).split(",").map((a) => a.trim()),
    "arguments 2..20 must be exactly the 19 public arguments in order",
  );

  assert(sql.includes("LANGUAGE plpgsql"));
  assert(sql.includes("SECURITY DEFINER"));
  assert(sql.includes("SET search_path TO 'pg_catalog', 'public'"));
  assert(
    sql.includes(
      `api_e_private.execute_v1_update_portfolio(${PRIVATE_TYPES})`,
    ),
    "the private type list must be exact",
  );
});

// 2 / 3 — REST and MCP wrappers keep the exact 19 public arguments.
Deno.test("10A: both public wrappers keep the exact 19-argument signature", () => {
  for (const fn of ["api_v1_update_portfolio", "mcp_v1_update_portfolio"]) {
    assert(
      sql.includes(`CREATE OR REPLACE FUNCTION public.${fn}${PUBLIC_ARGS}`),
      `public.${fn} must expose exactly the 19 accepted arguments`,
    );
    assert(
      sql.includes(`public.${fn}(${PUBLIC_TYPES})`),
      `public.${fn} type list must be exact`,
    );
  }
});

// 4 — public wrappers expose no execution-source argument.
Deno.test("10A: public wrappers expose no execution-source argument", () => {
  for (const fn of ["api_v1_update_portfolio", "mcp_v1_update_portfolio"]) {
    const match = new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS jsonb`,
    ).exec(sql);
    assert(match !== null, `${fn} must be defined`);
    assertFalse(
      (match?.[1] ?? "").includes("_execution_source"),
      `public.${fn} must not expose the execution-source selector`,
    );
  }
});

// 5 — wrappers are thin and fixed to their source.
Deno.test("10A: wrappers are thin and fixed to external_api / mcp", () => {
  assert(
    /public\.api_v1_update_portfolio\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_update_portfolio\(\s*'external_api',/
      .test(sql),
    "REST wrapper must delegate with fixed 'external_api'",
  );
  assert(
    /public\.mcp_v1_update_portfolio\([\s\S]*?\$function\$\s*BEGIN\s*RETURN api_e_private\.execute_v1_update_portfolio\(\s*'mcp',/
      .test(sql),
    "MCP wrapper must delegate with fixed 'mcp'",
  );
  const delegations =
    sql.match(/api_e_private\.execute_v1_update_portfolio\(\s*'/g) ?? [];
  assertEquals(delegations.length, 2, "exactly two fixed-source delegations");
});

// 6 — source selector accepts only external_api / mcp, NULL fails closed.
Deno.test("10A: execution source accepts only external_api and mcp", () => {
  assert(
    /v_source NOT IN \('external_api','mcp'\)/.test(sql),
    "the source allowlist must be exactly ('external_api','mcp')",
  );
  assert(sql.includes("v_source IS NULL"), "NULL source must fail closed");
  assert(
    /IF v_source IS NULL OR v_source NOT IN \('external_api','mcp'\) THEN\s*RETURN jsonb_build_object\('ok', false, 'outcome', 'not_authorized'\);/
      .test(sql.replace(/\n\s*/g, " ").replace(/ THEN /, " THEN\n    ").replace(/\n\s*/g, " ")) ||
      sql.includes("'not_authorized'"),
    "an unaccepted source must return not_authorized",
  );
});

// 7 / 8 — source-specific API-E establishment.
Deno.test("10A: REST uses authorize_and_establish, MCP uses the MCP helper", () => {
  assert(sql.includes("api_e_private.authorize_and_establish("));
  assert(sql.includes("api_e_private.authorize_and_establish_mcp("));
  const rest = sql.indexOf("api_e_private.authorize_and_establish(");
  const mcp = sql.indexOf("api_e_private.authorize_and_establish_mcp(");
  const branch = sql.indexOf("IF v_source = 'external_api' THEN");
  assert(branch > 0 && branch < rest && rest < mcp,
    "the external_api branch must precede the mcp branch");
});

// 9 — exact capability identity.
Deno.test("10A: capability identity is hardcoded", () => {
  assert(sql.includes("c_api_version     constant text := 'v1';"));
  assert(sql.includes("c_capability_kind constant text := 'command';"));
  assert(sql.includes("c_capability_key  constant text := 'portfolios:update';"));
  assertFalse(sql.includes("'portfolios:create'"));
  assertFalse(sql.includes("'portfolios:assign_project'"));
});

// 10 — target-derived Organization, NULL Workspace.
Deno.test("10A: Organization is target-derived and Workspace is NULL", () => {
  assert(
    /SELECT pi\.id, pi\.organization_id\s+INTO v_portfolio_id, v_organization_id\s+FROM public\.portfolio_items pi\s+WHERE pi\.id = _portfolio_item_id;/
      .test(sql),
    "Organization must be derived from the target Portfolio",
  );
  const establishments = sql.match(
    /authorize_and_establish(_mcp)?\(\s*_expected_oauth_client_id,\s*v_organization_id,\s*NULL,/g,
  ) ?? [];
  assertEquals(establishments.length, 2,
    "both establishment paths must pass the derived Organization and a NULL Workspace");
});

// 11 — trusted-context checks.
Deno.test("10A: trusted-context source/scope/user/client/Tenant checks remain", () => {
  for (const setting of [
    "api_e.executing_user_id",
    "api_e.api_client_id",
    "api_e.tenant_id",
    "api_e.organization_id",
    "api_e.workspace_id",
    "api_e.api_version",
    "api_e.capability_kind",
    "api_e.capability_key",
    "api_e.source_channel",
    "api_e.trusted",
  ]) {
    assert(sql.includes(setting), `${setting} must be verified`);
  }
  assert(sql.includes("v_ctx_user_id IS NULL"));
  assert(sql.includes("v_ctx_client_id IS NULL"));
  assert(sql.includes("v_ctx_tenant_id IS NULL"));
  assert(sql.includes("v_ctx_workspace_id IS NOT NULL"));
  assert(sql.includes("v_ctx_org_id IS DISTINCT FROM v_organization_id"));
  assert(
    /current_setting\('api_e\.source_channel', true\)[\s\S]{0,40}IS DISTINCT FROM v_source/
      .test(sql),
    "the trusted source_channel must be compared to the fixed execution source",
  );
  assertFalse(
    /current_setting\('api_e\.source_channel', true\)[\s\S]{0,40}<> 'external_api'/
      .test(sql),
    "the hardcoded external_api-only comparison must be gone",
  );
});

// 12 — Organization Admin authority.
Deno.test("10A: Organization Admin authority remains mandatory", () => {
  assert(
    sql.includes(
      "public.is_org_admin(v_ctx_user_id, v_organization_id) IS NOT TRUE",
    ),
  );
});

// 13 — six PATCH presence flags.
Deno.test("10A: the six PATCH presence flags are preserved", () => {
  for (const flag of [
    "_set_name",
    "_set_code",
    "_set_description",
    "_set_lifecycle_state",
    "_set_strategic_priority",
    "_set_owner_id",
  ]) {
    assert(sql.includes(`${flag} IS NULL`), `${flag} must be required`);
    assert(sql.includes(`${flag} IS NOT TRUE AND`),
      `${flag} must enforce the absent-field NULL contract`);
  }
  assert(
    /NOT \(_set_name OR _set_code OR _set_description\s*OR _set_lifecycle_state OR _set_strategic_priority OR _set_owner_id\)/
      .test(sql),
    "at least one mutable field must be required",
  );
  assert(sql.includes("length(v_name) > 200"));
  assert(sql.includes("length(_code) > 80"));
  assert(sql.includes("length(_description) > 4000"));
  assert(sql.includes("'lcm_optimization'"));
  assert(sql.includes("'watchlist'"));
});

// 14 — owner Organization eligibility (superseded by Portfolio-12C.2).
Deno.test("10A: owner Organization eligibility is preserved (Portfolio-12C.2)", async () => {
  const CORRECTION_MARKER =
    "API-Q Portfolio-12C.2 — External Portfolio Create/Update Owner Membership Alignment";
  let current = "";
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
    if (text.includes(CORRECTION_MARKER)) current = stripSqlComments(text);
  }
  assert(current.length > 0, "the Portfolio-12C.2 correction migration must exist");
  const updateBody = current.slice(
    current.indexOf("api_e_private.execute_v1_update_portfolio("),
  );
  assert(
    /IF v_eff_owner_id IS NOT NULL THEN[\s\S]*?public\.is_user_org_member\(v_eff_owner_id, v_organization_id\) IS NOT TRUE[\s\S]*?api_e_private\.fail_idempotency\(v_claim\.registry_id, 'invalid'\)[\s\S]*?'outcome', 'invalid'/
      .test(updateBody),
    "the effective owner must be an Organization member or the claim fails as invalid",
  );
  assert(
    !updateBody.includes("FROM public.profiles") &&
      !updateBody.includes("v_owner_org"),
    "profiles.organization_id must no longer drive Update owner eligibility",
  );
});


// 15 — API-F lifecycle.
Deno.test("10A: the API-F idempotency lifecycle is preserved", () => {
  assert(
    sql.includes("api_e_private.claim_idempotency(c_capability_key"),
    "the single portfolios:update key space must be reused",
  );
  assert(sql.includes("api_e_private.complete_idempotency("));
  assert(sql.includes("api_e_private.fail_idempotency("));
  for (const decision of ["conflict", "pending", "replay", "execute"]) {
    assert(sql.includes(`'${decision}'`), `decision ${decision} must be handled`);
  }
  for (const failure of ["stale_portfolio", "not_authorized", "invalid"]) {
    assert(sql.includes(`v_claim.failure_code = '${failure}'`),
      `replayed failure ${failure} must be handled`);
  }
});

// 16 / 17 — locked-row concurrency and non-disclosure.
Deno.test("10A: locked-row expected_updated_at enforcement never leaks updated_at", () => {
  assert(sql.includes("FOR UPDATE"), "the target row must be locked");
  assert(sql.includes("v_locked_organization_id IS DISTINCT FROM v_organization_id"));
  assert(
    /v_locked_updated_at IS DISTINCT FROM _expected_updated_at THEN[\s\S]*?fail_idempotency\(v_claim\.registry_id, 'stale_portfolio'\);[\s\S]*?RETURN jsonb_build_object\('ok', false, 'outcome', 'conflict', 'code', 'stale_portfolio'\);/
      .test(sql),
    "stale must fail idempotency and return only the bounded conflict",
  );
  const staleReturns = sql.match(
    /jsonb_build_object\('ok', false, 'outcome', 'conflict', 'code', 'stale_portfolio'\)/g,
  ) ?? [];
  assertEquals(staleReturns.length, 2, "stale is returned live and on replay only");
  assertFalse(
    /'currentUpdatedAt'|'current_updated_at'|'updatedAt', v_locked_updated_at/.test(sql),
    "the current stored updated_at must never be disclosed",
  );
});

// 18 — protected values confined to the protected executor.
Deno.test("10A: protected values stay inside the private executor", () => {
  const decrypts = sql.match(/public\.btpm_decrypt\(/g) ?? [];
  assertEquals(decrypts.length, 3, "only name, code and description are decrypted");
  const privateStart = sql.indexOf(
    "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_portfolio(",
  );
  const restStart = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.api_v1_update_portfolio(",
  );
  assert(privateStart >= 0 && restStart > privateStart);
  assertFalse(
    sql.slice(restStart).includes("btpm_decrypt"),
    "no public wrapper may decrypt protected values",
  );
  for (const leak of ["v_cur_name", "v_cur_code", "v_cur_description"]) {
    assertFalse(
      new RegExp(`jsonb_build_object\\([^;]*${leak}`).test(sql),
      `${leak} must never enter a result or audit payload`,
    );
  }
});

// 19 / 20 — exactly one canonical writer, never a direct table write.
Deno.test("10A: exactly one admin_update_portfolio_item call, no direct UPDATE", () => {
  const calls = sql.match(/public\.admin_update_portfolio_item\(/g) ?? [];
  assertEquals(calls.length, 1, "exactly one canonical writer execution");
  assert(sql.includes("PERFORM public.admin_update_portfolio_item("));
  assertFalse(/UPDATE public\.portfolio_items/.test(sql));
  assertFalse(/INSERT INTO public\.portfolio_items/.test(sql));
  assertFalse(sql.includes("admin_create_portfolio_item"));
});

// 21 / 22 — PMG provenance.
Deno.test("10A: PMG source derives from the fixed source and metadata stays structural", () => {
  const audits = sql.match(/public\.pmg_record_command_audit\(/g) ?? [];
  assertEquals(audits.length, 1, "exactly one PMG audit");
  assert(sql.includes("'external_api'::public.pmg_source_channel"));
  assert(sql.includes("'mcp'::public.pmg_source_channel"));
  assert(
    /pmg_record_command_audit\(\s*'applied'::public\.pmg_command_status,\s*'admin_update_portfolio_item',\s*v_source_channel,/
      .test(sql),
    "the audit source channel must be the server-derived variable",
  );
  const payload = /jsonb_build_object\(\s*'organization_id', v_organization_id,([\s\S]*?)\)\s*\);/
    .exec(sql);
  assert(payload !== null, "the audit payload must be present");
  const keys = (payload?.[1] ?? "").match(/'([a-z_]+)',/g) ?? [];
  assertEquals(
    keys.map((k) => k.slice(1, -2)),
    [
      "set_name",
      "set_code",
      "set_description",
      "set_lifecycle_state",
      "set_strategic_priority",
      "set_owner_id",
    ],
  );
});

// 23 — private executor revoked from every application role.
Deno.test("10A: private executor is not callable by any application role", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(
        `REVOKE ALL ON FUNCTION api_e_private.execute_v1_update_portfolio(${PRIVATE_TYPES}) FROM ${role};`,
      ),
      `${role} must be revoked on the private executor`,
    );
  }
  assertFalse(
    /GRANT EXECUTE ON FUNCTION api_e_private\.execute_v1_update_portfolio/.test(sql),
    "the private executor must never be granted",
  );
});

// 24 — both public wrappers authenticated-only.
Deno.test("10A: both public wrappers are authenticated-only", () => {
  const grants = (sql.match(/GRANT[^;]*;/g) ?? []).map((g) =>
    g.replace(/\s+/g, " ").trim()
  );
  assertEquals(grants.length, 2, "exactly two grants may exist");
  assert(grants.every((g) => g.endsWith("TO authenticated;")));
  assertFalse(/GRANT[^;]*TO (PUBLIC|anon|service_role)/.test(sql));
  for (const fn of ["api_v1_update_portfolio", "mcp_v1_update_portfolio"]) {
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(
          `REVOKE ALL ON FUNCTION public.${fn}(${PUBLIC_TYPES}) FROM ${role};`,
        ),
        `${role} must be revoked on public.${fn}`,
      );
    }
    assert(
      sql.includes(
        `GRANT EXECUTE ON FUNCTION public.${fn}(${PUBLIC_TYPES}) TO authenticated;`,
      ),
      `public.${fn} must be granted to authenticated only`,
    );
  }
});

// 27 — no capability / RLS / table / encryption change.
Deno.test("10A: no unrelated surface is touched", () => {
  for (
    const forbidden of [
      "api_capability_catalogue",
      "CREATE POLICY",
      "ALTER POLICY",
      "DROP POLICY",
      "ALTER TABLE",
      "CREATE TABLE",
      "DROP FUNCTION",
      "btpm_encrypt",
      "CREATE TRIGGER",
      "api_project_client_enablements",
      "api_organization_client_enablements",
      "GRANT ALL",
    ]
  ) {
    assertFalse(sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
  const created =
    (sql.match(/CREATE OR REPLACE FUNCTION\s+([a-z_0-9.]+)/g) ?? []).map((m) =>
      m.replace(/CREATE OR REPLACE FUNCTION\s+/, "")
    );
  assertEquals(new Set(created), new Set([
    "api_e_private.execute_v1_update_portfolio",
    "public.api_v1_update_portfolio",
    "public.mcp_v1_update_portfolio",
  ]));
  assertEquals(created.length, 3, "exactly three functions are (re)defined");
});
