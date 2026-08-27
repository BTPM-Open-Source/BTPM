// API-Q.9A1 — static contract guard for the trusted MCP API-E context substrate.
//
// Repository/static test only. It locates the committed API-Q.9A1 migration by
// its unique marker (never by a hardcoded timestamped filename), takes the
// latest one as the effective definition, and verifies the executable SQL of
// the single new private helper
// `api_e_private.authorize_and_establish_mcp(...)`.
//
// It performs no database access, no network access and no Edge invocation.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q.9A1 — Trusted MCP API-E context substrate";

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
  assert(found.length >= 1, "expected at least one API-Q.9A1 migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

Deno.test("API-Q.9A1: helper exists with the exact accepted signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION api_e_private\.authorize_and_establish_mcp\(\s*_expected_oauth_client_id text,\s*_organization_id uuid,\s*_workspace_id uuid,\s*_api_version text,\s*_capability_kind text,\s*_capability_key text,\s*_request_id text\s*\)/
      .test(sql),
    "authorize_and_establish_mcp must declare exactly the canonical arguments",
  );
  assert(/RETURNS boolean/.test(sql));
  assert(/SECURITY DEFINER/.test(sql));
  assert(/SET search_path = public, pg_catalog/.test(sql));
});

Deno.test("API-Q.9A1: no source-channel or provenance argument is accepted", () => {
  const header = sql.slice(
    sql.indexOf("authorize_and_establish_mcp("),
    sql.indexOf("RETURNS boolean"),
  );
  for (const forbidden of [
    "source_channel",
    "delegation",
    "actor",
    "tenant_id",
    "api_client_id",
    "policy_version",
    "trusted",
  ]) {
    assert(
      !header.includes(forbidden),
      `argument list must not contain ${forbidden}`,
    );
  }
});

Deno.test("API-Q.9A1: delegates to the canonical authorize_and_establish once, unchanged", () => {
  const calls = sql.match(
    /api_e_private\.authorize_and_establish\(/g,
  ) ?? [];
  assertEquals(calls.length, 1, "exactly one canonical delegation call");
  assert(
    /_established :=\s*api_e_private\.authorize_and_establish\(\s*_expected_oauth_client_id,\s*_organization_id,\s*_workspace_id,\s*_api_version,\s*_capability_kind,\s*_capability_key,\s*_request_id\s*\)/
      .test(sql),
    "arguments must be forwarded unchanged",
  );
  assert(
    /IF _established IS DISTINCT FROM true THEN\s*RETURN false;/.test(sql),
    "non-true canonical result must return false",
  );
  // No second authorization model: no membership/enablement/grant re-checks.
  for (const forbidden of [
    "tenant_memberships",
    "organization_memberships",
    "workspace_memberships",
    "api_capability_grants",
    "api_organization_client_enablements",
    "api_workspace_client_enablements",
    "api_client_policy_versions",
    "jwt_client_id",
    "auth.uid()",
  ]) {
    assert(
      !sql.includes(forbidden),
      `helper must not duplicate authorization via ${forbidden}`,
    );
  }
});

Deno.test("API-Q.9A1: converts only a consistent external_api context to mcp", () => {
  // API-Q.9A1-C1: the two trusted-context checks must be NULL-safe
  // (IS DISTINCT FROM). Ordinary <> silently passes a NULL current_setting,
  // which must be rejected. Regression back to <> is forbidden.
  assert(
    sql.includes(
      "current_setting('api_e.source_channel', true) IS DISTINCT FROM 'external_api'",
    ),
    "must require the canonical external_api channel via the NULL-safe IS DISTINCT FROM form",
  );
  assert(
    sql.includes(
      "current_setting('api_e.trusted', true) IS DISTINCT FROM 'true'",
    ),
    "must require api_e.trusted = true via the NULL-safe IS DISTINCT FROM form",
  );
  // Regression guard: ordinary <> must not be used for these two checks.
  assert(
    !sql.includes("current_setting('api_e.source_channel', true) <> 'external_api'"),
    "must not regress to ordinary <> for api_e.source_channel",
  );
  assert(
    !sql.includes("current_setting('api_e.trusted', true) <> 'true'"),
    "must not regress to ordinary <> for api_e.trusted",
  );
  for (const key of [
    "api_e.authenticated_user_id",
    "api_e.executing_user_id",
    "api_e.signed_oauth_client_id",
    "api_e.api_client_id",
    "api_e.policy_version_id",
  ]) {
    assert(
      sql.includes(`current_setting('${key}', true)`),
      `must verify presence of ${key}`,
    );
  }
  for (const [key, arg] of [
    ["api_e.api_version", "_api_version"],
    ["api_e.capability_kind", "_capability_kind"],
    ["api_e.capability_key", "_capability_key"],
    ["api_e.request_id", "_request_id"],
  ] as const) {
    assert(
      new RegExp(
        `current_setting\\('${key.replace(".", "\\.")}', true\\)\\s*IS DISTINCT FROM ${arg}`,
      ).test(sql),
      `must verify ${key} matches ${arg}`,
    );
  }

  // Exactly one provenance write, and it is the server-hardcoded 'mcp'.
  const channelWrites = sql.match(
    /set_config\('api_e\.source_channel',\s*'([^']*)'/g,
  ) ?? [];
  const mcpWrites = channelWrites.filter((w) => w.includes("'mcp'"));
  assertEquals(mcpWrites.length, 1, "exactly one 'mcp' provenance write");
  assert(
    !sql.includes("set_config('api_e.source_channel', 'external_api'"),
    "must not re-establish external_api",
  );
  // No other trusted identity/containment field is written on the success path.
  const successPath = sql.slice(
    sql.indexOf("set_config('api_e.source_channel', 'mcp'"),
    sql.indexOf("EXCEPTION"),
  );
  assert(
    !/set_config\('api_e\.(?!source_channel)/.test(successPath),
    "no other api_e key may be written after provenance replacement",
  );
});

Deno.test("API-Q.9A1: fails closed and resets on inconsistency or error", () => {
  const resetKeys = [
    "api_e.trusted",
    "api_e.authenticated_user_id",
    "api_e.executing_user_id",
    "api_e.signed_oauth_client_id",
    "api_e.api_client_id",
    "api_e.policy_version_id",
    "api_e.tenant_id",
    "api_e.organization_id",
    "api_e.workspace_id",
    "api_e.api_version",
    "api_e.capability_kind",
    "api_e.capability_key",
    "api_e.source_channel",
    "api_e.request_id",
  ];
  for (const key of resetKeys) {
    const writes = sql.split(`set_config('${key}',`).length - 1;
    assert(
      writes >= 2,
      `${key} must be reset on both the inconsistency and exception paths`,
    );
  }
  assert(
    (sql.match(/PERFORM set_config\('api_e\.trusted', 'false', true\);/g) ?? [])
      .length >= 2,
    "trusted must be cleared on both fail-closed paths",
  );
  assert(/EXCEPTION\s*WHEN OTHERS THEN/.test(sql), "exception handler required");
  assert(!/\bRAISE\b/.test(sql), "must not raise or expose SQL error detail");
  assert(!sql.includes("SQLERRM") && !sql.includes("SQLSTATE"));
});

Deno.test("API-Q.9A1: EXECUTE is revoked from PUBLIC, anon and authenticated", () => {
  for (const role of ["PUBLIC", "anon", "authenticated"]) {
    assert(
      new RegExp(
        `REVOKE ALL ON FUNCTION api_e_private\\.authorize_and_establish_mcp\\(\\s*text, uuid, uuid, text, text, text, text\\s*\\) FROM ${role};`,
      ).test(sql),
      `EXECUTE must be revoked from ${role}`,
    );
  }
  assert(!/\bGRANT\b/.test(sql), "migration must grant nothing");
});

Deno.test("API-Q.9A1: canonical and protected surfaces are untouched", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION api_e_private.authorize_and_establish_mcp",
  ]);
  for (const forbidden of [
    "assert_trusted_context",
    "api_v1_append_execution_update",
    "public.append_execution_update",
    "pmg_record_command_audit",
    "api_idempotency_registry",
    "btpm_append_execution_update",
    "CREATE POLICY",
    "ALTER TABLE",
    "DROP FUNCTION",
  ]) {
    assert(
      !sql.includes(forbidden),
      `migration must not reference ${forbidden}`,
    );
  }
});

Deno.test("API-Q.9A1: no MCP tool becomes exposed", async () => {
  const registry = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
  );
  assert(
    !registry.includes("authorize_and_establish_mcp"),
    "the MCP tool registry must not reference the new helper",
  );
  const index = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
  );
  assert(
    !index.includes("authorize_and_establish_mcp"),
    "the MCP endpoint must not reference the new helper",
  );
});
