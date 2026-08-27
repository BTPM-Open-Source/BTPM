// API-Q Portfolio-12C.2 — External Portfolio Create/Update Owner Membership
// Alignment (durable focused static test).
//
// Repository/static test only: it locates the committed migration by its unique
// marker (never by a hardcoded timestamped filename) and verifies the executable
// SQL of the two redefined private external executors.
//
// No database access, no network access, no Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER =
  "API-Q Portfolio-12C.2 — External Portfolio Create/Update Owner Membership Alignment";

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

const found: { name: string; text: string }[] = [];
for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
  if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
  const text = await Deno.readTextFile(new URL(entry.name, MIGRATIONS_DIR));
  if (text.includes(MARKER)) found.push({ name: entry.name, text });
}

const sql = stripSqlComments(found[0]?.text ?? "");
const createStart = sql.indexOf("api_e_private.execute_v1_create_portfolio(");
const updateStart = sql.indexOf("api_e_private.execute_v1_update_portfolio(");
const createBody = sql.slice(createStart, updateStart);
const updateBody = sql.slice(updateStart);

Deno.test("12C.2: exactly one forward-only migration owns this correction", () => {
  assertEquals(found.length, 1, "exactly one migration must carry the marker");
});

Deno.test("12C.2: only the two private executors are replaced", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_create_portfolio",
    "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_portfolio",
  ]);
});

// ---------------------------------------------------------------------------
// Create executor
// ---------------------------------------------------------------------------
Deno.test("12C.2 Create: exact private signature and posture are unchanged", () => {
  assert(
    /^api_e_private\.execute_v1_create_portfolio\(\s*_execution_source text,\s*_expected_oauth_client_id text,\s*_organization_id uuid,\s*_name text,\s*_code text,\s*_description text,\s*_lifecycle_state text,\s*_strategic_priority text,\s*_owner_id uuid,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb\s*LANGUAGE plpgsql\s*SECURITY DEFINER\s*SET search_path TO 'pg_catalog', 'public'/
      .test(createBody),
    "13-argument signature, return type, SECURITY DEFINER and search_path must be preserved",
  );
});

Deno.test("12C.2 Create: fixed source architecture and authority remain", () => {
  assert(/v_source NOT IN \('external_api','mcp'\)/.test(createBody));
  assert(createBody.includes("api_e_private.authorize_and_establish("));
  assert(createBody.includes("api_e_private.authorize_and_establish_mcp("));
  assert(createBody.includes("'portfolios:create'"));
  assert(createBody.includes("c_api_version     constant text := 'v1'"));
  assert(createBody.includes("c_capability_kind constant text := 'command'"));
  assert(
    createBody.includes("public.is_org_admin(v_ctx_user_id, v_organization_id) IS NOT TRUE"),
    "Organization Admin authority must remain",
  );
});

Deno.test("12C.2 Create: owner eligibility is canonical membership, nullable owner allowed", () => {
  assert(
    /IF _owner_id IS NOT NULL THEN\s*IF public\.is_user_org_member\(_owner_id, v_organization_id\) IS NOT TRUE THEN\s*RETURN jsonb_build_object\('ok', false, 'outcome', 'invalid'\);/
      .test(createBody),
    "non-null owner must be validated through is_user_org_member and return bounded invalid",
  );
  assert(
    !createBody.includes("FROM public.profiles") &&
      !createBody.includes("p.organization_id") &&
      !createBody.includes("v_owner_org"),
    "no profiles.organization_id owner lookup may remain",
  );
  assert(
    !createBody.includes("organization_memberships") &&
      !createBody.includes("tenant_memberships"),
    "membership tables must never be queried directly",
  );
});

Deno.test("12C.2 Create: membership check precedes the idempotency claim", () => {
  const check = createBody.indexOf("public.is_user_org_member(_owner_id, v_organization_id)");
  const claim = createBody.indexOf("api_e_private.claim_idempotency(c_capability_key");
  assert(check > -1 && claim > -1);
  assert(check < claim, "owner invalidation must happen before the claim");
});

Deno.test("12C.2 Create: exactly one canonical writer call remains", () => {
  const writes = createBody.match(/public\.admin_create_portfolio_item\(/g) ?? [];
  assertEquals(writes.length, 1);
  assert(!createBody.includes("INSERT INTO public.portfolio_items"));
});

// ---------------------------------------------------------------------------
// Update executor
// ---------------------------------------------------------------------------
Deno.test("12C.2 Update: exact private signature and posture are unchanged", () => {
  assert(
    /^api_e_private\.execute_v1_update_portfolio\(\s*_execution_source text,\s*_expected_oauth_client_id text,\s*_portfolio_item_id uuid,\s*_expected_updated_at timestamptz,\s*_name text,\s*_set_name boolean,\s*_code text,\s*_set_code boolean,\s*_description text,\s*_set_description boolean,\s*_lifecycle_state text,\s*_set_lifecycle_state boolean,\s*_strategic_priority text,\s*_set_strategic_priority boolean,\s*_owner_id uuid,\s*_set_owner_id boolean,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)\s*RETURNS jsonb\s*LANGUAGE plpgsql\s*SECURITY DEFINER\s*SET search_path TO 'pg_catalog', 'public'/
      .test(updateBody),
    "20-argument signature and hardened posture must be preserved",
  );
  assert(updateBody.includes("'portfolios:update'"));
});

Deno.test("12C.2 Update: locked-row concurrency architecture remains", () => {
  assert(updateBody.includes("FOR UPDATE"));
  assert(
    updateBody.includes("v_locked_updated_at IS DISTINCT FROM _expected_updated_at"),
    "expectedUpdatedAt behavior must remain",
  );
  assert(
    updateBody.includes("api_e_private.fail_idempotency(v_claim.registry_id, 'stale_portfolio')"),
    "stale Portfolio handling must remain",
  );
  assert(updateBody.includes("api_e_private.claim_idempotency(c_capability_key"));
  assert(updateBody.includes("public.btpm_decrypt(pi.name, pi.organization_id)"));
});

Deno.test("12C.2 Update: effective PATCH resolution is preserved", () => {
  assert(
    updateBody.includes(
      "v_eff_owner_id           := CASE WHEN _set_owner_id THEN _owner_id ELSE v_cur_owner_id END;",
    ),
    "effective owner must remain derived from PATCH presence or the current value",
  );
});

Deno.test("12C.2 Update: effective owner is validated and fails the claim as invalid", () => {
  assert(
    /IF v_eff_owner_id IS NOT NULL THEN\s*IF public\.is_user_org_member\(v_eff_owner_id, v_organization_id\) IS NOT TRUE THEN\s*PERFORM api_e_private\.fail_idempotency\(v_claim\.registry_id, 'invalid'\);\s*RETURN jsonb_build_object\(\s*'ok', false,\s*'outcome', 'invalid'\s*\);/
      .test(updateBody),
    "invalid effective owner must fail idempotency as invalid and return bounded invalid",
  );
  assert(
    !updateBody.includes("FROM public.profiles") &&
      !updateBody.includes("p.organization_id") &&
      !updateBody.includes("v_owner_org"),
    "no profile Organization owner lookup may remain",
  );
  assert(
    !updateBody.includes("organization_memberships") &&
      !updateBody.includes("tenant_memberships"),
    "membership tables must never be queried directly",
  );
});

Deno.test("12C.2 Update: exactly one canonical writer call remains", () => {
  const writes = updateBody.match(/public\.admin_update_portfolio_item\(/g) ?? [];
  assertEquals(writes.length, 1);
  assert(!updateBody.includes("UPDATE public.portfolio_items"));
});

// ---------------------------------------------------------------------------
// Negative scope
// ---------------------------------------------------------------------------
Deno.test("12C.2: privileges stay revoked for every application role", () => {
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assertEquals(
      (sql.match(new RegExp(`REVOKE ALL ON FUNCTION api_e_private\\.[a-z_0-9]+\\([^)]*\\) FROM ${role};`, "g")) ?? [])
        .length,
      2,
      `both private executors must remain revoked from ${role}`,
    );
  }
  assert(!/\bGRANT\b/.test(sql), "no grant may be added");
});

Deno.test("12C.2: no unrelated surface is modified", () => {
  for (const forbidden of [
    "public.api_v1_create_portfolio",
    "public.api_v1_update_portfolio",
    "public.mcp_v1_create_portfolio",
    "public.mcp_v1_update_portfolio",
    "admin_create_portfolio_item(_organization_id",
    "admin_update_portfolio_item(_portfolio_item_id",
    "admin_archive_portfolio_item",
    "assign_project_portfolio",
    "CREATE POLICY",
    "DROP POLICY",
    "ALTER TABLE",
    "DROP FUNCTION",
    "CREATE TABLE",
    "btpm_encrypt",
    "pgp_sym_encrypt",
    "api_capability_catalogue",
    "api_capability_grants",
    "api_clients",
    "is_user_org_member(_user_id",
  ]) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
});

Deno.test("12C.2: no caller-supplied trusted-context parameter is added", () => {
  for (const forbidden of [
    "_source_channel",
    "_capability_key",
    "_capability_kind",
    "_tenant_id",
    "_executing_user_id",
    "_trusted",
  ]) {
    assert(
      !new RegExp(`(^|[\\s(,])${forbidden}\\b`, "m").test(sql),
      `must not accept ${forbidden}`,
    );
  }
});
