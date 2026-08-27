// API-Q.10D1 — static contract guard for the Blocker Update trusted MCP
// database bridge.
//
// Repository/static test only: it locates the committed API-Q.10D1 migration by
// its unique marker (never by a hardcoded timestamped filename), takes the
// latest one as the effective definition, and verifies the executable SQL.
// No database, network or Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q.10D1 — Blocker Update Trusted MCP Database Bridge";

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
  assert(found.length >= 1, "expected at least one API-Q.10D1 migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

/** Bounded slice of the private executor body. */
function executorBody(): string {
  const start = sql.indexOf(
    "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_blocker",
  );
  assert(start >= 0, "private executor must exist");
  const end = sql.indexOf(
    "REVOKE ALL ON FUNCTION api_e_private.execute_v1_update_blocker",
    start,
  );
  assert(end > start, "private executor revokes must follow the definition");
  return sql.slice(start, end);
}

/** Bounded slice of the canonical PMG command body. */
function canonicalBody(): string {
  const start = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.apply_blocker_update",
  );
  assert(start >= 0, "canonical command must be redefined");
  const end = sql.indexOf(
    "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_blocker",
    start,
  );
  assert(end > start);
  return sql.slice(start, end);
}

Deno.test("API-Q.10D1: exactly the three intended functions are (re)defined", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION public.apply_blocker_update",
    "CREATE OR REPLACE FUNCTION api_e_private.execute_v1_update_blocker",
    "CREATE OR REPLACE FUNCTION public.api_v1_update_blocker",
    "CREATE OR REPLACE FUNCTION public.mcp_v1_update_blocker",
  ]);
});

Deno.test("API-Q.10D1: canonical signature, SECURITY DEFINER and search_path preserved", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.apply_blocker_update\(_blocker_id uuid, _expected_updated_at timestamp with time zone, _title text, _description text DEFAULT NULL::text, _severity text DEFAULT NULL::text, _status text DEFAULT NULL::text, _user_links jsonb DEFAULT '\[\]'::jsonb, _object_links jsonb DEFAULT '\[\]'::jsonb, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)/
      .test(sql),
    "canonical signature must be unchanged",
  );
  const body = canonicalBody();
  assert(/RETURNS jsonb/.test(body));
  assert(/SECURITY DEFINER/.test(body));
  assert(/SET search_path TO 'pg_catalog', 'public'/.test(body));
});

// 1 + 6
Deno.test("API-Q.10D1: trusted delegated channel allowlist is exactly external_api and mcp", () => {
  const body = canonicalBody();
  assert(
    /v_trusted_channel := nullif\(btrim\(coalesce\(current_setting\('api_e\.source_channel', true\),''\)\),''\)/
      .test(body),
    "channel must be read from the trusted API-E context only (server-derived)",
  );
  assert(/v_trusted_channel IS NULL/.test(body), "missing channel must fail closed");
  assert(
    /v_trusted_channel NOT IN \('external_api','mcp'\)/.test(body),
    "allowlist must be exactly external_api and mcp",
  );
  assert(
    !/<> 'external_api'/.test(body),
    "the external_api-only condition must be replaced",
  );
  assert(/v_trusted := api_e_private\.assert_trusted_context\(\)/.test(body));
  assert(/v_trusted IS NOT TRUE/.test(body));
});

// 2
Deno.test("API-Q.10D1: capability identity is exactly v1 / command / blockers:update", () => {
  const body = canonicalBody();
  assert(/current_setting\('api_e\.api_version', true\)[\s\S]{0,60}<> 'v1'/.test(body));
  assert(
    /current_setting\('api_e\.capability_kind', true\)[\s\S]{0,60}<> 'command'/.test(body),
  );
  assert(
    /current_setting\('api_e\.capability_key', true\)[\s\S]{0,80}<> 'blockers:update'/.test(body),
  );
  const exec = executorBody();
  assert(/c_api_version    constant text := 'v1'/.test(exec));
  assert(/c_capability_kind constant text := 'command'/.test(exec));
  assert(/c_capability_key constant text := 'blockers:update'/.test(exec));
});

// 3 + 4 + 5 + 6
Deno.test("API-Q.10D1: channel mapping external_api->external_api, mcp->mcp, default btpm_ui", () => {
  const body = canonicalBody();
  assert(
    /v_source_channel public\.pmg_source_channel := 'btpm_ui'::public\.pmg_source_channel/
      .test(body),
    "browser/no-client path remains btpm_ui",
  );
  assert(/IF v_client_id IS NOT NULL THEN/.test(body));
  assert(
    /IF v_trusted_channel = 'external_api' THEN\s*v_source_channel := 'external_api'::public\.pmg_source_channel;\s*ELSE\s*v_source_channel := 'mcp'::public\.pmg_source_channel;\s*END IF;/
      .test(body),
  );
  const channelLiterals = new Set(
    (body.match(
      /'(btpm_ui|external_api|mcp|admin_import|background_job|btpm_internal)'::public\.pmg_source_channel/g,
    ) ?? []).map((m) => m.split("'")[1]),
  );
  assertEquals(channelLiterals, new Set(["btpm_ui", "external_api", "mcp"]));
  // Conflict audit uses the derived channel, not a literal.
  assert(
    /'conflict'::public\.pmg_command_status, 'apply_blocker_update',\s*v_source_channel/.test(body),
  );
});

// 6
Deno.test("API-Q.10D1: no source-channel argument or caller-driven provenance", () => {
  assert(
    !/(^|[^a-z0-9_])_source_channel/.test(sql),
    "no source-channel argument may exist",
  );
  for (const forbidden of ["_expected_channel", "_allowed_channels"]) {
    assert(!sql.includes(forbidden), `must not accept ${forbidden}`);
  }
  const body = canonicalBody();
  for (const arg of ["_title", "_description", "_severity", "_status", "_correlation_id"]) {
    assert(
      !new RegExp(`v_source_channel\\s*:=[^;]*${arg}`).test(body),
      `channel must not derive from ${arg}`,
    );
  }
});

// 7
Deno.test("API-Q.10D1: private executor accepts only external_api|mcp", () => {
  const exec = executorBody();
  assert(/_execution_source text,/.test(exec), "leading internal argument required");
  assert(
    /IF v_source IS NULL OR v_source NOT IN \('external_api','mcp'\) THEN\s*RETURN jsonb_build_object\('ok', false, 'outcome', 'not_authorized'\);/
      .test(exec),
    "unknown execution source must return bounded not_authorized",
  );
});

// 8 + 9
Deno.test("API-Q.10D1: external_api uses authorize_and_establish, mcp uses authorize_and_establish_mcp", () => {
  const exec = executorBody();
  assert(
    /IF v_source = 'external_api' THEN[\s\S]{0,400}api_e_private\.authorize_and_establish\(/.test(exec),
  );
  assert(
    /ELSE[\s\S]{0,400}api_e_private\.authorize_and_establish_mcp\(/.test(exec),
  );
  assertEquals(
    (exec.match(/api_e_private\.authorize_and_establish\(/g) ?? []).length,
    1,
  );
  assertEquals(
    (exec.match(/api_e_private\.authorize_and_establish_mcp\(/g) ?? []).length,
    1,
  );
  assert(/IF v_trusted IS NOT TRUE THEN/.test(exec));
});

// 10
Deno.test("API-Q.10D1: stored Blocker target derives scope and cross-checks stored scope", () => {
  for (const body of [canonicalBody(), executorBody()]) {
    assert(/FROM public\.projects p/.test(body));
    assert(/FROM public\.phases ph/.test(body));
    assert(/FROM public\.tasks t/.test(body));
    assert(/ph\.project_id = t\.project_id/.test(body), "task containment preserved");
  }
  const exec = executorBody();
  assert(
    /FROM public\.blockers b\s*WHERE b\.id = _blocker_id/.test(exec),
    "stored Blocker target must be read structurally",
  );
  assert(
    /v_workspace_id IS DISTINCT FROM v_row_workspace_id\s*OR v_organization_id IS DISTINCT FROM v_row_organization_id/
      .test(exec),
  );
  assert(
    !/_project_id|_workspace_id text|_organization_id text|_tenant_id/.test(
      exec.slice(0, exec.indexOf("RETURNS jsonb")),
    ),
    "no caller-supplied scope arguments",
  );
  const canon = canonicalBody();
  assert(/NOT public\.has_project_pm_authority\(v_actor, v_project_id\)/.test(canon));
  assert(/NOT public\.can_write_demo\(v_actor, v_workspace_id\)/.test(canon));
  assert(/NOT public\.is_active_user\(v_actor\)/.test(canon));
});

// 11
Deno.test("API-Q.10D1: Project Connected App enablement stays before idempotency", () => {
  const exec = executorBody();
  const enablementAt = exec.indexOf("public.api_project_client_enablements");
  const claimAt = exec.indexOf("api_e_private.claim_idempotency(");
  assert(enablementAt >= 0, "enablement check must exist");
  assert(claimAt > enablementAt, "enablement must precede the idempotency claim");
  assert(/e\.lifecycle_status = 'enabled'/.test(exec));
  assert(/e\.enabled_at IS NOT NULL/.test(exec));
  assert(/e\.disabled_at IS NULL/.test(exec));
});

// 12
Deno.test("API-Q.10D1: API-F idempotency flow is preserved", () => {
  const exec = executorBody();
  assert(
    /api_e_private\.claim_idempotency\(c_capability_key, _idempotency_key, _payload_hash\)/.test(exec),
  );
  for (const branch of [
    "'idempotency_conflict'",
    "'idempotency_pending'",
    "'replayed'",
  ]) {
    assert(exec.includes(branch), `missing ${branch} handling`);
  }
  assert(/v_claim\.registry_state = 'completed'/.test(exec));
  assert(/v_claim\.registry_state = 'failed'/.test(exec));
  assert(/v_claim\.decision <> 'execute'/.test(exec));
  assert(/api_e_private\.complete_idempotency\(v_claim\.registry_id, v_result\)/.test(exec));
  assert(/api_e_private\.fail_idempotency\(v_claim\.registry_id, 'stale_blocker'\)/.test(exec));
});

// 13
Deno.test("API-Q.10D1: existing links are reconstructed and passed through unchanged", () => {
  const exec = executorBody();
  assert(/FOR UPDATE/.test(exec), "Blocker row must be locked before reconstruction");
  assert(
    /INTO v_user_links[\s\S]{0,400}eul\.link_role = 'related_person'/.test(exec),
  );
  assert(
    /INTO v_object_links[\s\S]{0,400}eol\.link_role = 'related_object'/.test(exec),
  );
  assert(
    /v_user_links,\s*v_object_links,/.test(exec),
    "complete reconstructed arrays must be passed to the canonical command",
  );
  assert(
    !/'\[\]'::jsonb,\s*'\[\]'::jsonb,\s*_correlation_id/.test(exec),
    "empty link arrays must never be passed",
  );
  assert(
    !/DELETE FROM public\.entity_(user|object)_links/.test(exec),
    "executor must never mutate Blocker links directly",
  );
  assert(!/UPDATE public\.blockers/.test(exec), "executor must never update blockers directly");
});

// 14 + 15 + 16
Deno.test("API-Q.10D1: exactly one canonical call with unchanged caller expectedUpdatedAt", () => {
  const exec = executorBody();
  const calls = exec.match(/public\.apply_blocker_update\(/g) ?? [];
  assertEquals(calls.length, 1, "exactly one canonical command call");
  assert(
    /public\.apply_blocker_update\(\s*_blocker_id,\s*_expected_updated_at,\s*_title,\s*_description,\s*_severity,\s*_status,\s*v_user_links,\s*v_object_links,\s*_correlation_id,\s*_idempotency_key\s*\)/
      .test(exec),
    "caller _expected_updated_at must be passed through unchanged",
  );
  assert(
    !/_expected_updated_at\s*:=/.test(exec),
    "no timestamp substitution allowed",
  );
  assert(!/LOOP/.test(exec), "no retry loop allowed in the executor");
  assert(
    !/updated_at\s*INTO\s*[a-z_]*expected/.test(exec),
    "no read-before-write timestamp refresh",
  );
  assert(!/EXECUTE /.test(exec), "no dynamic SQL");
});

// 17
Deno.test("API-Q.10D1: stale result is bounded to stale_blocker without current_updated_at", () => {
  const exec = executorBody();
  assert(
    /RETURN jsonb_build_object\('ok', false, 'outcome', 'conflict', 'code', 'stale_blocker'\);/
      .test(exec),
  );
  assert(
    !exec.includes("current_updated_at"),
    "the canonical DB timestamp must never be exposed externally",
  );
  // The canonical command keeps its internal conflict payload unchanged.
  assert(canonicalBody().includes("'current_updated_at', v_row.updated_at"));
});

// 18
Deno.test("API-Q.10D1: Blocker narrative never enters idempotency or audit metadata", () => {
  const exec = executorBody();
  assert(
    !/'title'|'description'/.test(exec.slice(exec.indexOf("v_result := jsonb_build_object"))),
    "canonical result must not carry Blocker narrative",
  );
  const canon = canonicalBody();
  const start = canon.indexOf("public.pmg_record_command_audit(\n    'applied'");
  const auditStart = start >= 0 ? start : canon.indexOf("'applied'::public.pmg_command_status, 'apply_blocker_update'");
  const auditCall = canon
    .slice(auditStart, canon.indexOf("RETURN public.pmg_build_result", auditStart))
    .replace(/\(v_description IS NOT NULL\)/g, "(presence)");
  assert(auditCall.length > 0);
  for (const forbidden of ["v_description", "_description", "v_title", "_title"]) {
    assert(
      !new RegExp(`(^|[^a-z0-9_'])${forbidden}([^a-z0-9_]|$)`).test(auditCall),
      `audit metadata must not contain ${forbidden}`,
    );
  }
  assert(/'has_description', \(v_description IS NOT NULL\)/.test(canon));
});

// 19 + 20
Deno.test("API-Q.10D1: REST wrapper hardcodes external_api and MCP wrapper hardcodes mcp", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_update_blocker\([\s\S]{0,1200}api_e_private\.execute_v1_update_blocker\(\s*'external_api',/
      .test(sql),
  );
  assert(
    /CREATE OR REPLACE FUNCTION public\.mcp_v1_update_blocker\([\s\S]{0,1200}api_e_private\.execute_v1_update_blocker\(\s*'mcp',/
      .test(sql),
  );
  // Both wrappers expose the same eleven public arguments.
  for (const fn of ["api_v1_update_blocker", "mcp_v1_update_blocker"]) {
    const at = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    const header = sql.slice(at, sql.indexOf("RETURNS jsonb", at));
    for (
      const arg of [
        "_expected_oauth_client_id text",
        "_blocker_id uuid",
        "_expected_updated_at timestamptz",
        "_title text",
        "_description text",
        "_severity text",
        "_status text",
        "_request_id text",
        "_correlation_id text",
        "_idempotency_key text",
        "_payload_hash text",
      ]
    ) {
      assert(header.includes(arg), `${fn} must declare ${arg}`);
    }
    assert(!header.includes("_execution_source"), `${fn} must not expose the source`);
  }
});

// 21
Deno.test("API-Q.10D1: private executor has no direct execution grant", () => {
  const sig =
    "api_e_private.execute_v1_update_blocker(text, text, uuid, timestamptz, text, text, text, text, text, text, text, text)";
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    assert(
      sql.includes(`REVOKE ALL ON FUNCTION ${sig} FROM ${role};`),
      `missing revoke for ${role}`,
    );
  }
  assert(
    !new RegExp(
      `GRANT EXECUTE ON FUNCTION api_e_private\\.execute_v1_update_blocker`,
    ).test(sql),
    "private executor must have no execute grant",
  );
});

// 22
Deno.test("API-Q.10D1: both public wrappers are authenticated-only", () => {
  for (const fn of ["api_v1_update_blocker", "mcp_v1_update_blocker"]) {
    const sig =
      `public.${fn}(text, uuid, timestamptz, text, text, text, text, text, text, text, text)`;
    for (const role of ["PUBLIC", "anon", "service_role"]) {
      assert(
        sql.includes(`REVOKE ALL ON FUNCTION ${sig} FROM ${role};`),
        `${fn} missing revoke for ${role}`,
      );
    }
    assert(
      sql.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated;`),
      `${fn} must grant execute to authenticated only`,
    );
  }
});

// 23
Deno.test("API-Q.10D1: Blocker Create, Risk and security surfaces are untouched", () => {
  for (
    const forbidden of [
      "apply_blocker_create",
      "api_v1_create_blocker",
      "mcp_v1_create_blocker",
      "execute_v1_create_blocker",
      "apply_risk_update",
      "apply_risk_create",
      "execute_v1_update_risk",
      "execute_v1_create_risk",
      "append_execution_update",
      "assert_trusted_context()\nRETURNS",
      "CREATE OR REPLACE FUNCTION api_e_private.authorize_and_establish",
      "CREATE OR REPLACE FUNCTION api_e_private.claim_idempotency",
      "CREATE POLICY",
      "DROP POLICY",
      "ALTER TABLE",
      "CREATE TABLE",
      "DROP FUNCTION",
      "api_capability_catalogue",
    ]
  ) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
  assert(
    !/(GRANT|REVOKE)[^;]*(blockers|risks|entity_user_links|entity_object_links)\b/.test(sql),
    "no table grant/revoke change may be introduced",
  );
  assert(
    !/CREATE (OR REPLACE )?(TRIGGER|FUNCTION public\.btpm_(en|de)crypt)/.test(sql),
    "encryption helpers/triggers must be untouched",
  );
});
