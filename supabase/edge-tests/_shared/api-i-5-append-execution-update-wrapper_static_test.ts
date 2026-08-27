// API-I.5 — Dedicated DB wrapper public.api_v1_append_execution_update.
//
// Repository static contract test. Locates the migration by its unique marker
// and asserts the frozen wrapper contract.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-I.5 — Dedicated DB wrapper api_v1_append_execution_update";

async function findMigrationByMarker(marker: string): Promise<string> {
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (text.includes(marker)) return text;
  }
  throw new Error(`migration marker not found: ${marker}`);
}

const SQL = await findMigrationByMarker(MARKER);

Deno.test("API-I.5: exact wrapper name and fixed typed signature", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_append_execution_update\(\s*_expected_oauth_client_id text,\s*_target_type text,\s*_target_id uuid,\s*_summary text,\s*_update_date date,\s*_status_label text,\s*_request_id text,\s*_correlation_id text,\s*_idempotency_key text,\s*_payload_hash text\s*\)/
      .test(SQL),
  );
  assert(/RETURNS jsonb/.test(SQL));
  // No generic parameters.
  for (const forbidden of ["_payload jsonb", "_command", "_function", "_rpc", "_table", "_sql"]) {
    assertEquals(SQL.includes(forbidden), false, `forbidden parameter: ${forbidden}`);
  }
  // Exactly one wrapper created.
  assertEquals([...SQL.matchAll(/CREATE OR REPLACE FUNCTION/g)].length, 1);
});

Deno.test("API-I.5: SECURITY DEFINER and restricted search path", () => {
  assert(/SECURITY DEFINER/.test(SQL));
  assert(/SET search_path TO 'pg_catalog', 'public'/.test(SQL));
});

Deno.test("API-I.5: only authenticated may execute", () => {
  assert(/REVOKE ALL ON FUNCTION public\.api_v1_append_execution_update\([^)]*\) FROM PUBLIC;/.test(SQL));
  assert(/REVOKE ALL ON FUNCTION public\.api_v1_append_execution_update\([^)]*\) FROM anon;/.test(SQL));
  assert(/GRANT EXECUTE ON FUNCTION public\.api_v1_append_execution_update\([^)]*\) TO authenticated;/.test(SQL));
  assertEquals(/TO service_role/.test(SQL), false);
  assertEquals(/TO anon;/.test(SQL), false);
});

Deno.test("API-I.5: scope is derived internally from phase or task", () => {
  assert(/FROM public\.phases p\s*\n\s*WHERE p\.id = _target_id;/.test(SQL));
  assert(/FROM public\.tasks t\s*\n\s*WHERE t\.id = _target_id;/.test(SQL));
  assert(/INTO v_project_id, v_workspace_id, v_organization_id/.test(SQL));
  // Caller never supplies scope: check the declared parameter list only.
  const sig = SQL.slice(SQL.indexOf("api_v1_append_execution_update("), SQL.indexOf("RETURNS jsonb"));
  for (const forbidden of ["_project_id", "_workspace_id", "_organization_id", "_tenant_id", "_api_client_id", "_user", "_source_channel", "_capability"]) {
    assertEquals(sig.includes(forbidden), false, `forbidden caller scope input: ${forbidden}`);
  }
  const derivIdx = SQL.indexOf("FROM public.phases p");
  const authIdx = SQL.indexOf("api_e_private.authorize_and_establish");
  assert(derivIdx > -1 && authIdx > derivIdx, "scope derivation precedes authorization");
});

Deno.test("API-I.5: fixed authorize_and_establish capability identity", () => {
  assert(/c_api_version\s+constant text := 'v1';/.test(SQL));
  assert(/c_capability_kind constant text := 'command';/.test(SQL));
  assert(/c_capability_key constant text := 'execution_updates:append';/.test(SQL));
  assert(
    /api_e_private\.authorize_and_establish\(\s*_expected_oauth_client_id,\s*v_organization_id,\s*v_workspace_id,\s*c_api_version,\s*c_capability_kind,\s*c_capability_key,\s*_request_id\s*\)/
      .test(SQL),
  );
  assertEquals([...SQL.matchAll(/authorize_and_establish/g)].length, 1);
});

Deno.test("API-I.5: authorize_project_scope is neither called nor modified", () => {
  // Only a documentary comment may mention it; it must never be invoked.
  assertEquals(/api_e_private\.authorize_project_scope\s*\(/.test(SQL), false);
  assertEquals(/FUNCTION api_e_private\.authorize_project_scope/.test(SQL), false);
});

Deno.test("API-I.5: explicit project connected app enablement is enforced", () => {
  assert(/FROM public\.api_project_client_enablements e/.test(SQL));
  for (
    const clause of [
      "e.project_id = v_project_id",
      "e.api_client_id = v_ctx_client_id",
      "e.tenant_id = v_ctx_tenant_id",
      "e.organization_id = v_organization_id",
      "e.workspace_id = v_workspace_id",
      "e.lifecycle_status = 'enabled'",
      "e.enabled_at IS NOT NULL",
      "e.disabled_at IS NULL",
    ]
  ) {
    assert(SQL.includes(clause), `missing enablement clause: ${clause}`);
  }
  // Trusted context reads.
  for (const key of ["api_e.api_client_id", "api_e.tenant_id", "api_e.organization_id", "api_e.workspace_id"]) {
    assert(SQL.includes(`current_setting('${key}', true)`), `missing trusted read: ${key}`);
  }
  // Trusted org/workspace must equal derived scope.
  assert(/v_ctx_org_id IS DISTINCT FROM v_organization_id/.test(SQL));
  assert(/v_ctx_workspace_id IS DISTINCT FROM v_workspace_id/.test(SQL));
  assert(/v_enabled IS NOT TRUE THEN\s*\n\s*RETURN jsonb_build_object\('ok', false, 'outcome', 'not_authorized'\);/.test(SQL));
  // Enablement is enforced after authorization and before idempotency.
  const authIdx = SQL.indexOf("api_e_private.authorize_and_establish");
  const enableIdx = SQL.indexOf("public.api_project_client_enablements");
  const claimIdx = SQL.indexOf("api_e_private.claim_idempotency");
  assert(authIdx < enableIdx && enableIdx < claimIdx);
});

Deno.test("API-I.5: claim_idempotency uses the fixed capability key", () => {
  assert(
    /api_e_private\.claim_idempotency\(c_capability_key, _idempotency_key, _payload_hash\)/.test(SQL),
  );
  assertEquals(/claim_idempotency\('append_execution_update'/.test(SQL), false);
});

Deno.test("API-I.5: conflict, pending and replay never invoke PMG", () => {
  const claimIdx = SQL.indexOf("api_e_private.claim_idempotency");
  const pmgIdx = SQL.indexOf("v_pmg := public.append_execution_update(");
  assert(claimIdx > -1 && pmgIdx > claimIdx);
  const between = SQL.slice(claimIdx, pmgIdx);
  for (
    const outcome of [
      "'idempotency_conflict'",
      "'idempotency_pending'",
      "'replayed'",
    ]
  ) {
    assert(between.includes(outcome), `missing branch outcome: ${outcome}`);
  }
  assertEquals(between.includes("append_execution_update("), false);
  // Replay of a completed claim requires a JSON object.
  assert(/jsonb_typeof\(v_claim\.canonical_result\) <> 'object'/.test(SQL));
  // Unexpected decisions fail closed.
  assert(/v_claim\.decision <> 'execute' THEN\s*\n\s*RAISE EXCEPTION/.test(SQL));
});

Deno.test("API-I.5: execute branch calls exactly one hardcoded canonical PMG", () => {
  assert(
    /v_pmg := public\.append_execution_update\(\s*_target_type,\s*_target_id,\s*_summary,\s*_update_date,\s*_status_label,\s*_correlation_id,\s*_idempotency_key\s*\);/
      .test(SQL),
  );
  assertEquals([...SQL.matchAll(/public\.append_execution_update\(/g)].length, 1);
});

Deno.test("API-I.5: no direct execution-update INSERT exists in the wrapper", () => {
  assertEquals(/INSERT INTO/i.test(SQL), false);
  assertEquals(/execution_updates\b(?!:append)/.test(SQL.replace(/execution_updates:append/g, "")), false);
  assertEquals(/UPDATE public\./i.test(SQL), false);
  assertEquals(/DELETE FROM/i.test(SQL), false);
});

Deno.test("API-I.5: applied canonical result contains only approved bounded fields", () => {
  const start = SQL.indexOf("v_result := jsonb_build_object(");
  assert(start > -1);
  const block = SQL.slice(start, SQL.indexOf(");", start));
  for (
    const key of [
      "'ok', true",
      "'outcome', 'applied'",
      "'executionUpdateId', v_exec_id",
      "'targetType', v_target_type",
      "'targetId', _target_id",
      "'updateDate', _update_date",
      "'hasStatusLabel'",
    ]
  ) {
    assert(block.includes(key), `missing bounded field: ${key}`);
  }
  for (
    const forbidden of [
      "_summary",
      "summary",
      "'status_label'",
      "->> 'status_label'",
      "project_id",
      "workspace_id",
      "organization_id",
      "tenant_id",
      "warnings",
      "changes",
      "v_pmg",
      "registry",
      "payload_hash",
    ]
  ) {
    assertEquals(block.includes(forbidden), false, `forbidden result field: ${forbidden}`);
  }
  // hasStatusLabel is the PMG boolean flag, never label text.
  assert(block.includes("(v_data -> 'has_status_label')"));
  // Internal consistency checks on the PMG applied result.
  assert(/\(v_data ->> 'target_type'\) IS DISTINCT FROM v_target_type/.test(SQL));
  assert(/\(v_data ->> 'target_id'\) IS DISTINCT FROM _target_id::text/.test(SQL));
  assert(/\(v_data ->> 'update_date'\) IS DISTINCT FROM _update_date::text/.test(SQL));
  assert(/jsonb_typeof\(v_data -> 'has_status_label'\) <> 'boolean'/.test(SQL));
});

Deno.test("API-I.5: complete_idempotency occurs after PMG execution", () => {
  const pmgIdx = SQL.indexOf("v_pmg := public.append_execution_update(");
  const completeIdx = SQL.indexOf("api_e_private.complete_idempotency");
  assert(pmgIdx > -1 && completeIdx > pmgIdx);
  assert(/api_e_private\.complete_idempotency\(v_claim\.registry_id, v_result\)/.test(SQL));
  // Result construction precedes completion.
  assert(SQL.indexOf("v_result := jsonb_build_object(") < completeIdx);
});

Deno.test("API-I.5: safe stable failure codes only", () => {
  assert(/api_e_private\.fail_idempotency\(v_claim\.registry_id, 'not_authorized'\)/.test(SQL));
  assert(/api_e_private\.fail_idempotency\(v_claim\.registry_id, 'invalid'\)/.test(SQL));
  assertEquals([...SQL.matchAll(/fail_idempotency\(/g)].length, 2);
  assertEquals(/fail_idempotency\([^)]*SQLERRM/.test(SQL), false);
  assertEquals(SQL.includes("SQLERRM"), false);
  // Any other PMG status rolls back.
  assert(/RAISE EXCEPTION 'api_v1_append_execution_update: unexpected canonical command status'/.test(SQL));
});

Deno.test("API-I.5: bounded validation outcomes never echo input", () => {
  assert(SQL.includes("'^[A-Za-z0-9._~:@/-]{1,128}$'"));
  assert(SQL.includes("'^[A-Za-z0-9._~:@/+!=-]{1,255}$'"));
  assert(SQL.includes("'^[0-9a-f]{64}$'"));
  assertEquals(/now\(\)|current_date/.test(SQL), false, "no future-date restriction");
  const outcomes = [...SQL.matchAll(/'outcome', '([a-z_]+)'/g)].map((m) => m[1]);
  const allowed = new Set([
    "invalid",
    "not_authorized",
    "idempotency_conflict",
    "idempotency_pending",
    "replayed",
    "applied",
  ]);
  for (const o of outcomes) assert(allowed.has(o), `unexpected outcome: ${o}`);
});

Deno.test("API-I.5: no dynamic SQL, EXECUTE or generic dispatcher", () => {
  for (
    const forbidden of [
      "format(",
      "quote_ident",
      "quote_literal",
      "regprocedure",
      "::regproc",
      "service_role",
      "CASE WHEN _command",
    ]
  ) {
    assertEquals(SQL.includes(forbidden), false, `forbidden construct: ${forbidden}`);
  }
  // No PL/pgSQL dynamic EXECUTE (GRANT EXECUTE ON ... is permitted).
  assertEquals(/EXECUTE\s+(?!ON\b)/.test(SQL), false);
});

Deno.test("API-I.5: protected surfaces are not redefined", () => {
  for (
    const forbidden of [
      "FUNCTION public.append_execution_update",
      "FUNCTION public.pmg_record_command_audit",
      "FUNCTION api_e_private.authorize_and_establish",
      "FUNCTION api_e_private.claim_idempotency",
      "FUNCTION api_e_private.complete_idempotency",
      "FUNCTION api_e_private.fail_idempotency",
      "api_capability_catalogue",
      "api_capability_grants",
      "CREATE TABLE",
      "ALTER TABLE",
      "DROP ",
      "CREATE POLICY",
    ]
  ) {
    assertEquals(SQL.includes(forbidden), false, `must not touch: ${forbidden}`);
  }
});
