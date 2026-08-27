// API-Q.9C1-C1 — static contract guard for the trusted-context source-channel
// allowlist correction.
//
// Repository/static test only: it locates the committed API-Q.9C1-C1 migration
// by its unique marker (never by a hardcoded timestamped filename), takes the
// latest one as the effective definition, and verifies the executable SQL of
// the single redefined helper `api_e_private.assert_trusted_context()`.
//
// No database access, no network access, no Edge invocation.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q.9C1-C1 — Trusted MCP Context Assertion Compatibility Correction";

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
  assert(found.length >= 1, "expected at least one API-Q.9C1-C1 migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

Deno.test("API-Q.9C1-C1: exact same zero-argument signature is retained", () => {
  assert(
    /CREATE OR REPLACE FUNCTION api_e_private\.assert_trusted_context\(\)\s*\nRETURNS boolean/
      .test(sql),
    "assert_trusted_context() must keep its zero-argument signature and boolean result",
  );
});

Deno.test("API-Q.9C1-C1: remains STABLE, SECURITY DEFINER with a safe search_path", () => {
  assert(/\bSTABLE\b/.test(sql), "must remain STABLE");
  assert(/\bSECURITY DEFINER\b/.test(sql), "must remain SECURITY DEFINER");
  assert(
    /SET search_path = pg_catalog/.test(sql),
    "safe search_path must be preserved",
  );
});

Deno.test("API-Q.9C1-C1: identity and trusted-context checks remain present", () => {
  assert(sql.includes("_uid uuid := auth.uid();"));
  assert(
    sql.includes("current_setting('api_e.trusted', true)") &&
      sql.includes("_trusted IS DISTINCT FROM 'true'"),
    "trusted flag check must remain",
  );
  for (const key of [
    "api_e.authenticated_user_id",
    "api_e.executing_user_id",
    "api_e.signed_oauth_client_id",
    "api_e.api_client_id",
    "api_e.policy_version_id",
    "api_e.tenant_id",
    "api_e.organization_id",
    "api_e.api_version",
    "api_e.capability_kind",
    "api_e.capability_key",
    "api_e.source_channel",
    "api_e.request_id",
  ]) {
    assert(
      sql.includes(`current_setting('${key}', true)`),
      `context field ${key} must still be read`,
    );
    assert(
      sql.includes(`length(_ctx_`),
      "presence/blank checks must remain",
    );
  }
});

Deno.test("API-Q.9C1-C1: authenticated_user_id must equal executing_user_id", () => {
  assert(
    /IF _ctx_auth_user <> _ctx_exec_user THEN\s*RETURN false;/.test(sql),
    "authenticated/executing user equality must remain",
  );
});

Deno.test("API-Q.9C1-C1: authenticated user must equal auth.uid()", () => {
  assert(
    /IF _ctx_auth_user <> _uid::text THEN\s*RETURN false;/.test(sql),
    "authenticated user must still equal auth.uid()",
  );
});

Deno.test("API-Q.9C1-C1: JWT client must equal signed context client", () => {
  assert(
    sql.includes("_signed_client_id := api_e_private.jwt_client_id();"),
    "signed JWT client must still be resolved from the JWT",
  );
  assert(
    /IF _signed_client_id IS NULL OR _signed_client_id <> _ctx_signed_client THEN\s*RETURN false;/
      .test(sql),
    "JWT client / context client equality must remain",
  );
});

Deno.test("API-Q.9C1-C1: source channel is a fixed two-value allowlist", () => {
  // external_api remains accepted and mcp is now accepted.
  assert(
    /_ctx_channel NOT IN \('external_api', 'mcp'\)/.test(sql),
    "the trusted source channel must be the fixed allowlist ('external_api', 'mcp')",
  );
  // No third channel is accepted anywhere in the condition.
  const literals = (sql.match(/'[a-z_]+'\s*(?=[,)])/g) ?? []).filter((l) =>
    /external_api|mcp|btpm_ui/.test(l)
  );
  assertEquals(
    new Set(literals.map((l) => l.trim())),
    new Set(["'external_api'", "'mcp'"]),
    "only external_api and mcp may appear as accepted channel literals",
  );
  assert(!sql.includes("btpm_ui"), "browser channel must never be accepted");
  // NULL / blank remains fail-closed.
  assert(
    sql.includes("_ctx_channel IS NULL OR _ctx_channel NOT IN"),
    "NULL channel must be explicitly fail-closed",
  );
  assert(
    sql.includes("_ctx_channel IS NULL OR length(_ctx_channel) = 0"),
    "blank channel must remain rejected",
  );
  // The old single-channel condition must be gone.
  assert(
    !sql.includes("_ctx_channel <> 'external_api'"),
    "the external_api-only condition must be replaced",
  );
});

Deno.test("API-Q.9C1-C1: no source-channel parameter is introduced", () => {
  assert(
    !/assert_trusted_context\(\s*[^)]+\)/.test(sql),
    "no argument may be added to assert_trusted_context",
  );
  for (const forbidden of [
    "_source_channel",
    "_expected_channel",
    "_allowed_channels",
  ]) {
    assert(!sql.includes(forbidden), `must not accept ${forbidden}`);
  }
});

Deno.test("API-Q.9C1-C1: no privilege is widened", () => {
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION api_e_private.assert_trusted_context() FROM PUBLIC;",
    ) &&
      sql.includes(
        "REVOKE ALL ON FUNCTION api_e_private.assert_trusted_context() FROM anon;",
      ),
    "PUBLIC and anon must remain revoked",
  );
  assert(
    !/GRANT[^;]*TO (PUBLIC|anon)/.test(sql),
    "no GRANT to PUBLIC or anon may be added",
  );
  // The only GRANT permitted is the re-assertion of the pre-existing
  // `authenticated` EXECUTE privilege required for RLS policy evaluation
  // (established in the API-E read-containment migration).
  const grants = sql.match(/GRANT[^;]*;/g) ?? [];
  assertEquals(grants.length, 1, "at most the pre-existing grant may appear");
  assertEquals(
    (grants[0] ?? "").replace(/\s+/g, " ").trim(),
    "GRANT EXECUTE ON FUNCTION api_e_private.assert_trusted_context() TO authenticated;",
  );
});

Deno.test("API-Q.9C1-C1: authorize_and_establish_mcp remains private and untouched", () => {
  assert(
    !sql.includes("authorize_and_establish_mcp"),
    "the MCP establishment helper must not be redefined or granted here",
  );
});

Deno.test("API-Q.9C1-C1: only assert_trusted_context is redefined", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION api_e_private.assert_trusted_context",
  ]);
  for (const forbidden of [
    "claim_idempotency",
    "complete_idempotency",
    "fail_idempotency",
    "api_idempotency_registry",
    "api_v1_append_execution_update",
    "mcp_v1_append_execution_update",
    "execute_v1_append_execution_update",
    "public.append_execution_update",
    "pmg_record_command_audit",
    "authorize_and_establish(",
    "CREATE POLICY",
    "ALTER TABLE",
    "DROP FUNCTION",
  ]) {
    assert(
      !sql.includes(forbidden),
      `migration must not touch ${forbidden}`,
    );
  }
});

Deno.test("API-Q.9C1-C1: no MCP registry, runtime or tool file is changed", async () => {
  const registry = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/mcp/toolRegistry.ts", import.meta.url),
  );
  const index = await Deno.readTextFile(
    new URL("../../functions/btpm-mcp/index.ts", import.meta.url),
  );
  for (const source of [registry, index]) {
    assert(
      !source.includes("assert_trusted_context"),
      "MCP registry/runtime must not reference the database helper",
    );
  }
});
