// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-i-3-source-aware-append-execution-update_static_test.ts', import.meta.url).href;
/**
 * API-I.3 — Source-Aware append_execution_update (static contract test)
 *
 * Verifies the migration that makes public.append_execution_update source-aware:
 *  - signature unchanged;
 *  - OAuth detection via api_e_private.jwt_client_id();
 *  - OAuth path requires api_e_private.assert_trusted_context();
 *  - exact trusted context required (v1 / command / execution_updates:append / external_api);
 *  - invalid or untrusted OAuth returns not_authorized before the INSERT;
 *  - external audit uses external_api with a NULL integration id;
 *  - ordinary UI still audits as btpm_ui;
 *  - has_project_pm_authority and can_write_demo checks remain;
 *  - no source-channel function parameter exists.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH =
  "supabase/migrations/20260807154641_4fc2b399-50b8-4e5d-86eb-9c2e58351667.sql";

const SQL = await Deno.readTextFile(new URL(`../../../${MIGRATION_PATH}`, __BTPM_SRC_BASE__));

Deno.test("API-I.3: function signature is unchanged", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.append_execution_update\(_target_type text, _target_id uuid, _summary text, _update_date date, _status_label text DEFAULT NULL::text, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text\)/
      .test(SQL),
  );
  assert(/RETURNS jsonb/.test(SQL));
  assert(/SECURITY DEFINER/.test(SQL));
  assert(/SET search_path TO 'pg_catalog', 'public'/.test(SQL));
});

Deno.test("API-I.3: OAuth detection uses api_e_private.jwt_client_id()", () => {
  assert(/v_client_id text := api_e_private\.jwt_client_id\(\);/.test(SQL));
  assert(/IF v_client_id IS NOT NULL THEN/.test(SQL));
});

Deno.test("API-I.3: OAuth path requires assert_trusted_context()", () => {
  assert(/v_trusted := api_e_private\.assert_trusted_context\(\);/.test(SQL));
  assert(/EXCEPTION WHEN OTHERS THEN[\s\S]{0,60}v_trusted := false;/.test(SQL));
  assert(/v_trusted IS NOT TRUE/.test(SQL));
});

Deno.test("API-I.3: exact trusted context values are required", () => {
  assert(/current_setting\('api_e\.api_version', true\)[\s\S]{0,80}<> 'v1'/.test(SQL));
  assert(/current_setting\('api_e\.capability_kind', true\)[\s\S]{0,80}<> 'command'/.test(SQL));
  assert(
    /current_setting\('api_e\.capability_key', true\)[\s\S]{0,80}<> 'execution_updates:append'/
      .test(SQL),
  );
  assert(/current_setting\('api_e\.source_channel', true\)[\s\S]{0,80}<> 'external_api'/.test(SQL));
});

Deno.test("API-I.3: untrusted OAuth fails closed before the INSERT", () => {
  const guardIdx = SQL.indexOf("Fail closed: no execution update, no audit row.");
  const insertIdx = SQL.indexOf("INSERT INTO public.execution_updates");
  const auditIdx = SQL.indexOf("public.pmg_record_command_audit");
  assert(guardIdx > -1);
  assert(insertIdx > guardIdx);
  assert(auditIdx > guardIdx);
  assert(
    /Fail closed[\s\S]{0,240}'not_authorized'::public\.pmg_command_status, 'append_execution_update'/
      .test(SQL),
  );
});

Deno.test("API-I.3: source channel is server-derived, external_api for API callers", () => {
  assert(
    /v_source_channel public\.pmg_source_channel := 'btpm_ui'::public\.pmg_source_channel;/.test(SQL),
  );
  assert(/v_source_channel := 'external_api'::public\.pmg_source_channel;/.test(SQL));
  assert(
    /public\.pmg_record_command_audit\([\s\S]{0,160}v_source_channel,/.test(SQL),
  );
});

Deno.test("API-I.3: audit passes a NULL integration id", () => {
  assert(
    /v_source_channel,[\s\S]{0,120}v_project_id, 'execution_update', v_new_id, NULL,/.test(SQL),
  );
});

Deno.test("API-I.3: business authorization checks remain", () => {
  assert(/public\.is_active_user\(v_actor\)/.test(SQL));
  assert(/NOT public\.has_project_pm_authority\(v_actor, v_project_id\)/.test(SQL));
  assert(/NOT public\.can_write_demo\(v_actor, v_workspace_id\)/.test(SQL));
  assert(/v_target_type NOT IN \('phase','task'\)/.test(SQL));
});

Deno.test("API-I.3: no source-channel function parameter exists", () => {
  const args = SQL.slice(SQL.indexOf("append_execution_update("), SQL.indexOf(")\n RETURNS"));
  assertEquals(/_source_channel/.test(args), false);
  assertEquals(/_api_client_id/.test(args), false);
  assertEquals(/_executing_user_id/.test(args), false);
  assertEquals(/_capability_key/.test(args), false);
  assertEquals(/_trusted/.test(args), false);
  assertEquals(
    args,
    "append_execution_update(_target_type text, _target_id uuid, _summary text, _update_date date, _status_label text DEFAULT NULL::text, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text",
  );
});
