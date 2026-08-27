// API-Q.10C-C1 — static contract guard for trusted MCP source-channel support in
// public.apply_blocker_create.
//
// Repository/static test only: it locates the committed API-Q.10C-C1 migration by
// its unique marker (never by a hardcoded timestamped filename), takes the latest
// one as the effective definition, and verifies the executable SQL.
// No database, network or Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
const MARKER = "API-Q.10C-C1 — Blocker Create Trusted MCP PMG Channel Correction";

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
  assert(found.length >= 1, "expected at least one API-Q.10C-C1 migration");
  found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return found[found.length - 1];
}

const migration = await loadMigration();
const sql = stripSqlComments(migration.text);

Deno.test("API-Q.10C-C1: only public.apply_blocker_create is redefined", () => {
  const created = sql.match(/CREATE OR REPLACE FUNCTION ([a-z_0-9.]+)/g) ?? [];
  assertEquals(created, [
    "CREATE OR REPLACE FUNCTION public.apply_blocker_create",
  ]);
});

Deno.test("API-Q.10C-C1: existing signature, SECURITY DEFINER and search_path preserved", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.apply_blocker_create\(_target_type text, _target_id uuid, _title text, _description text DEFAULT NULL::text, _severity text DEFAULT 'medium'::text, _status text DEFAULT 'open'::text, _user_links jsonb DEFAULT '\[\]'::jsonb, _object_links jsonb DEFAULT '\[\]'::jsonb, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)/
      .test(sql),
    "signature must be unchanged",
  );
  assert(/RETURNS jsonb/.test(sql));
  assert(/SECURITY DEFINER/.test(sql));
  assert(/SET search_path TO 'pg_catalog', 'public'/.test(sql));
});

Deno.test("API-Q.10C-C1: OAuth/API caller detection and trusted-context requirement preserved", () => {
  assert(/v_client_id := api_e_private\.jwt_client_id\(\)/.test(sql));
  assert(/v_trusted := api_e_private\.assert_trusted_context\(\)/.test(sql));
  assert(/v_trusted IS NOT TRUE/.test(sql));
});

Deno.test("API-Q.10C-C1: capability identity remains v1 / command / blockers:create", () => {
  assert(/current_setting\('api_e\.api_version', true\)[\s\S]{0,60}<> 'v1'/.test(sql));
  assert(
    /current_setting\('api_e\.capability_kind', true\)[\s\S]{0,60}<> 'command'/.test(sql),
  );
  assert(
    /current_setting\('api_e\.capability_key', true\)[\s\S]{0,80}<> 'blockers:create'/.test(sql),
  );
});

Deno.test("API-Q.10C-C1: trusted channel allowlist is exactly external_api and mcp", () => {
  assert(
    /v_trusted_channel := nullif\(btrim\(coalesce\(current_setting\('api_e\.source_channel', true\),''\)\),''\)/
      .test(sql),
    "channel must be read from the trusted API-E context only",
  );
  assert(/v_trusted_channel IS NULL/.test(sql), "missing channel must fail closed");
  assert(
    /v_trusted_channel NOT IN \('external_api','mcp'\)/.test(sql),
    "allowlist must be exactly external_api and mcp",
  );
  assert(
    !/<> 'external_api'/.test(sql),
    "the API-K.3 external_api-only condition must be replaced",
  );
});

Deno.test("API-Q.10C-C1: channel mapping external_api->external_api, mcp->mcp, default btpm_ui", () => {
  assert(
    /v_source_channel public\.pmg_source_channel := 'btpm_ui'::public\.pmg_source_channel/
      .test(sql),
    "non-OAuth/UI callers remain btpm_ui",
  );
  assert(
    /IF v_trusted_channel = 'external_api' THEN\s*v_source_channel := 'external_api'::public\.pmg_source_channel;\s*ELSE\s*v_source_channel := 'mcp'::public\.pmg_source_channel;\s*END IF;/
      .test(sql),
  );
  const channelLiterals = new Set(
    (sql.match(/'(btpm_ui|external_api|mcp|admin_import|background_job|btpm_internal)'::public\.pmg_source_channel/g) ?? [])
      .map((m) => m.split("'")[1]),
  );
  assertEquals(channelLiterals, new Set(["btpm_ui", "external_api", "mcp"]));
  assert(
    /IF v_client_id IS NOT NULL THEN/.test(sql),
    "channel derivation only applies to delegated clients",
  );
});

Deno.test("API-Q.10C-C1: no source-channel argument or caller-driven provenance", () => {
  assert(
    !/(^|[^a-z0-9_])_source_channel/.test(sql),
    "no source-channel argument may exist",
  );
  for (const forbidden of ["_expected_channel", "_allowed_channels"]) {
    assert(!sql.includes(forbidden), `must not accept ${forbidden}`);
  }
  for (const arg of ["_title,", "_description,", "_severity,", "_status,", "_correlation_id,", "_idempotency_key,"]) {
    const assignment = new RegExp(
      `v_source_channel\\s*:=[^;]*${arg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    );
    assert(!assignment.test(sql), `channel must not derive from ${arg}`);
  }
});

Deno.test("API-Q.10C-C1: untrusted delegated context fails closed before target/write/audit", () => {
  const guardIdx = sql.indexOf("v_trusted_channel NOT IN ('external_api','mcp')");
  const targetIdx = sql.indexOf("FROM public.projects p");
  const insertIdx = sql.indexOf("INSERT INTO public.blockers");
  const auditIdx = sql.indexOf("public.pmg_record_command_audit(");
  assert(guardIdx > -1);
  assert(targetIdx > guardIdx, "target lookup must follow the guard");
  assert(insertIdx > guardIdx, "write must follow the guard");
  assert(auditIdx > guardIdx, "audit must follow the guard");
  assert(
    /'not_authorized'::public\.pmg_command_status, 'apply_blocker_create'/.test(sql),
  );
});

Deno.test("API-Q.10C-C1: target scope stays server-derived and authority is enforced", () => {
  assert(/v_target_type NOT IN \('project', 'phase', 'task'\)/.test(sql));
  assert(/FROM public\.phases ph/.test(sql));
  assert(/FROM public\.tasks t/.test(sql));
  assert(/ph\.project_id = t\.project_id/.test(sql), "task containment preserved");
  assert(/NOT public\.has_project_pm_authority\(v_actor, v_project_id\)/.test(sql));
  assert(/NOT public\.can_write_demo\(v_actor, v_workspace_id\)/.test(sql));
  assert(/NOT public\.is_active_user\(v_actor\)/.test(sql));
});

Deno.test("API-Q.10C-C1: persistence, links, encryption path and result preserved", () => {
  assert(/INSERT INTO public\.blockers/.test(sql));
  assert(/PERFORM public\._validate_object_links\(/.test(sql));
  assert(/PERFORM public\._validate_user_links\(/.test(sql));
  assert(/INSERT INTO public\.entity_user_links/.test(sql));
  assert(/INSERT INTO public\.entity_object_links/.test(sql));
  assert(!/encrypt|decrypt|tenant_encryption/i.test(sql), "encryption must be untouched");
  const audits = sql.match(/public\.pmg_record_command_audit\(/g) ?? [];
  assertEquals(audits.length, 1);
  assert(/public\.pmg_record_command_audit\([\s\S]{0,120}v_source_channel,/.test(sql));
  assert(/v_source_channel,\s*v_project_id, 'blocker', v_new_id, NULL,/.test(sql));
  assert(/public\.pmg_build_result\(/.test(sql));
});

Deno.test("API-Q.10C-C1: Blocker narrative never enters audit metadata", () => {
  const start = sql.indexOf("public.pmg_record_command_audit(");
  const auditCall = sql
    .slice(start, sql.indexOf("RETURN public.pmg_build_result", start))
    .replace(/\(v_description IS NOT NULL\)/g, "(presence)");
  assert(auditCall.length > 0);
  for (const forbidden of ["v_title", "v_description", "_title", "_description"]) {
    const token = new RegExp(`(^|[^a-z0-9_'])${forbidden}([^a-z0-9_]|$)`);
    assert(!token.test(auditCall), `audit metadata must not contain ${forbidden}`);
  }
  assert(/'has_description', \(v_description IS NOT NULL\)/.test(sql));
});

Deno.test("API-Q.10C-C1: no other canonical or security surface is touched", () => {
  for (const forbidden of [
    "apply_blocker_update",
    "apply_risk_create",
    "apply_risk_update",
    "api_v1_create_blocker",
    "api_v1_update_blocker",
    "mcp_v1_create_blocker",
    "execute_v1_create_blocker",
    "assert_trusted_context()\nRETURNS",
    "authorize_and_establish",
    "claim_idempotency",
    "api_idempotency_registry",
    "CREATE POLICY",
    "DROP POLICY",
    "ALTER TABLE",
    "CREATE TABLE",
    "DROP FUNCTION",
    "api_capability_catalogue",
    "api_clients",
  ]) {
    assert(!sql.includes(forbidden), `migration must not touch ${forbidden}`);
  }
  assert(!/GRANT|REVOKE/.test(sql), "no grant/revoke change may be introduced");
});
