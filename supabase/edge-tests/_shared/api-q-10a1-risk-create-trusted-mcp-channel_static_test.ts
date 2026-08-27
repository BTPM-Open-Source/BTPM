// API-Q.10A1 — static contract guard for trusted MCP source-channel support in
// public.apply_risk_create.
//
// Open-source publication form: validate the current canonical function rather
// than depending on the private repository's historical migration marker.
// No database, network or Edge invocation.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { currentFunction, normalizeSql, stripSqlComments } from "./ossSqlContract.ts";

const FUNCTIONS_DIR = new URL("../../functions/", import.meta.url);
const sql = stripSqlComments(await currentFunction("apply_risk_create"));
const normalizedSql = normalizeSql(sql);
const header = /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.apply_risk_create\s*\((.*?)\)\s*RETURNS\s+jsonb\b/i.exec(
  normalizedSql,
);

Deno.test("API-Q.10A1: current canonical definition is public.apply_risk_create", () => {
  assert(header, "public.apply_risk_create declaration missing");
});

Deno.test("API-Q.10A1: existing signature, SECURITY DEFINER and search_path preserved", () => {
  assert(header, "public.apply_risk_create declaration missing");
  const actualSignature = header[1].replace(/\s*,\s*/g, ", ").trim();
  assertEquals(
    actualSignature,
    "_target_type text, _target_id uuid, _title text, _description text DEFAULT NULL::text, _mitigation_plan text DEFAULT NULL::text, _likelihood text DEFAULT 'medium'::text, _impact text DEFAULT 'medium'::text, _status text DEFAULT 'open'::text, _user_links jsonb DEFAULT '[]'::jsonb, _object_links jsonb DEFAULT '[]'::jsonb, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text",
    "signature must be unchanged",
  );
  assert(/RETURNS\s+jsonb\b/i.test(normalizedSql));
  assert(/SECURITY\s+DEFINER\b/i.test(normalizedSql));
  assert(/SET\s+search_path\s+TO\s+'pg_catalog'\s*,\s*'public'/i.test(normalizedSql));
});

Deno.test("API-Q.10A1: OAuth/API caller detection and trusted-context requirement preserved", () => {
  assert(/v_client_id := api_e_private\.jwt_client_id\(\)/.test(sql));
  assert(/v_trusted := api_e_private\.assert_trusted_context\(\)/.test(sql));
  assert(/v_trusted IS NOT TRUE/.test(sql));
});

Deno.test("API-Q.10A1: capability identity remains v1 / command / risks:create", () => {
  assert(/current_setting\('api_e\.api_version', true\)[\s\S]{0,40}<> 'v1'/.test(sql));
  assert(
    /current_setting\('api_e\.capability_kind', true\)[\s\S]{0,40}<> 'command'/.test(sql),
  );
  assert(
    /current_setting\('api_e\.capability_key', true\)[\s\S]{0,60}<> 'risks:create'/.test(sql),
  );
});

Deno.test("API-Q.10A1: trusted channel allowlist is exactly external_api and mcp", () => {
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
    "the external_api-only condition must be replaced",
  );
});

Deno.test("API-Q.10A1: channel mapping external_api->external_api, mcp->mcp, default btpm_ui", () => {
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
});

Deno.test("API-Q.10A1: no source-channel argument or caller-driven provenance", () => {
  assert(
    !/(^|[^a-z0-9_])_source_channel/.test(sql),
    "no source-channel argument may exist",
  );
  for (const forbidden of ["_expected_channel", "_allowed_channels"]) {
    assert(!sql.includes(forbidden), `must not accept ${forbidden}`);
  }
  for (const arg of ["_title,", "_description,", "_mitigation_plan,", "_correlation_id,", "_idempotency_key,"]) {
    const assignment = new RegExp(
      `v_source_channel\\s*:=[^;]*${arg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    );
    assert(!assignment.test(sql), `channel must not derive from ${arg}`);
  }
});

Deno.test("API-Q.10A1: target scope stays server-derived and authority is enforced", () => {
  assert(/v_target_type NOT IN \('project', 'phase', 'task'\)/.test(sql));
  assert(/FROM public\.projects p/.test(sql));
  assert(/FROM public\.phases ph/.test(sql));
  assert(/FROM public\.tasks t/.test(sql));
  assert(/ph\.project_id = t\.project_id/.test(sql), "task containment preserved");
  assert(/NOT public\.has_project_pm_authority\(v_actor, v_project_id\)/.test(sql));
  assert(/NOT public\.can_write_demo\(v_actor, v_workspace_id\)/.test(sql));
  assert(/NOT public\.is_active_user\(v_actor\)/.test(sql));
});

Deno.test("API-Q.10A1: persistence, link validation and audit preserved", () => {
  assert(/INSERT INTO public\.risks/.test(sql));
  assert(/PERFORM public\._validate_object_links\(/.test(sql));
  assert(/PERFORM public\._validate_user_links\(/.test(sql));
  const audits = sql.match(/public\.pmg_record_command_audit\(/g) ?? [];
  assertEquals(audits.length, 1);
  assert(/public\.pmg_build_result\(/.test(sql));
});

Deno.test("API-Q.10A1: Risk narrative never enters audit metadata", () => {
  const start = sql.indexOf("public.pmg_record_command_audit(");
  const auditCall = sql
    .slice(start, sql.indexOf("RETURN public.pmg_build_result", start))
    .replace(/\(v_description IS NOT NULL\)/g, "(presence)")
    .replace(/\(v_mitigation IS NOT NULL\)/g, "(presence)");
  assert(auditCall.length > 0);
  for (const forbidden of ["v_title", "v_description", "v_mitigation", "_title", "_description", "_mitigation_plan"]) {
    const token = new RegExp(`(^|[^a-z0-9_'])${forbidden}([^a-z0-9_]|$)`);
    assert(
      !token.test(auditCall),
      `audit metadata must not contain ${forbidden}`,
    );
  }

  assert(/'has_description', \(v_description IS NOT NULL\)/.test(sql));
  assert(/'has_mitigation_plan', \(v_mitigation IS NOT NULL\)/.test(sql));
});

Deno.test("API-Q.10A1: current function introduces no adjacent security surface", () => {
  for (const forbidden of [
    "apply_risk_update",
    "api_v1_create_risk",
    "api_v1_update_risk",
    "assert_trusted_context()\nRETURNS",
    "authorize_and_establish",
    "claim_idempotency",
    "CREATE POLICY",
    "DROP POLICY",
    "ALTER TABLE",
    "CREATE TABLE",
    "DROP FUNCTION",
    "api_capability_catalogue",
  ]) {
    assert(!sql.includes(forbidden), `function must not contain ${forbidden}`);
  }
  assert(!/GRANT|REVOKE/.test(sql), "function definition contains no grant/revoke surface");
  assert(!/encrypt|decrypt|tenant_encryption/i.test(sql), "encryption must be untouched");
});

Deno.test("API-Q.10A1: MCP registry/runtime preserve the accepted Risk-create boundary", async () => {
  const registry = await Deno.readTextFile(
    new URL("btpm-mcp/mcp/toolRegistry.ts", FUNCTIONS_DIR),
  );
  const marker = 'operationId: "risks.create"';
  const at = registry.indexOf(marker);
  assert(at >= 0, "registry must still declare risks.create");
  const bounded = registry.slice(at, at + 800);
  assert(/toolName: "btpm_create_risk"/.test(bounded));
  assert(/operationClass: "mutation"/.test(bounded));
  assert(/confirmation: "required"/.test(bounded));

  const factory = await Deno.readTextFile(
    new URL("btpm-mcp/mcp/serverFactory.ts", FUNCTIONS_DIR),
  );
  const index = await Deno.readTextFile(
    new URL("btpm-mcp/index.ts", FUNCTIONS_DIR),
  );
  for (const source of [factory, index]) {
    assert(
      !source.includes("apply_risk_create") &&
        !source.includes("mcp_v1_create_risk"),
      "MCP presentation/runtime must not call the database wrapper directly",
    );
  }
});
