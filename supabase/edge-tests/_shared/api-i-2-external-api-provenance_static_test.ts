// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-i-2-external-api-provenance_static_test.ts', import.meta.url).href;
/**
 * API-I.2 — External API Provenance Correction (static contract test)
 *
 * Verifies the corrective migration for public.pmg_record_command_audit:
 *  - external_api no longer sits in the branch that requires a Tenant integration;
 *  - a non-null _integration_id is rejected for external_api (fail closed);
 *  - tenant_integrations is not consulted for external_api provenance;
 *  - trusted API-E context is still required;
 *  - client identity still comes from api_e.api_client_id resolved via public.api_clients;
 *  - source_system still derives from client_key, source_component from capability_key;
 *  - MCP still requires + validates an active Tenant integration.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH =
  "supabase/migrations/20260807153555_1783ff6c-2ab9-48a8-96a2-929938446856.sql";

const SQL = await Deno.readTextFile(new URL(`../../../${MIGRATION_PATH}`, __BTPM_SRC_BASE__));

Deno.test("API-I.2: function signature is unchanged", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.pmg_record_command_audit\(_status pmg_command_status, _command text, _source_channel pmg_source_channel, _project_id uuid, _target_type text, _target_id uuid, _integration_id uuid, _correlation_id text, _idempotency_key text, _metadata jsonb\)/
      .test(SQL),
  );
  assert(/SECURITY DEFINER/.test(SQL));
  assert(/SET search_path TO 'public', 'pg_temp'/.test(SQL));
});

Deno.test("API-I.2: external_api is not in the integration-required branch", () => {
  // The legacy combined branch must be gone.
  assertEquals(/_source_channel IN \('external_api', 'mcp'\)/.test(SQL), false);
  assert(/ELSIF _source_channel = 'mcp' THEN[\s\S]{0,240}requires an integration identity/.test(SQL));
});

Deno.test("API-I.2: external_api rejects a non-null _integration_id", () => {
  assert(
    /ELSIF _source_channel = 'external_api' THEN[\s\S]{0,400}IF _integration_id IS NOT NULL THEN[\s\S]{0,200}external_api must not supply an integration identity/
      .test(SQL),
  );
  assert(/v_integration_id := NULL;/.test(SQL));
});

Deno.test("API-I.2: tenant_integrations is not consulted for external_api", () => {
  assert(
    /IF v_integration_id IS NOT NULL AND _source_channel <> 'external_api' THEN[\s\S]{0,200}FROM public\.tenant_integrations ti/
      .test(SQL),
  );
  // external API audit rows persist a NULL integration identity.
  assert(/CASE WHEN _source_channel = 'external_api' THEN NULL ELSE v_integration_id END/.test(SQL));
});

Deno.test("API-I.2: trusted API-E context is still required for external_api", () => {
  assert(/current_setting\('api_e\.trusted', true\)/.test(SQL));
  assert(/external_api requires trusted API-E context/.test(SQL));
  assert(/external_api requires api_e\.source_channel=external_api/.test(SQL));
  assert(/current_setting\('api_e\.authenticated_user_id', true\)/.test(SQL));
  assert(/current_setting\('api_e\.executing_user_id', true\)/.test(SQL));
  assert(/current_setting\('api_e\.request_id', true\)/.test(SQL));
  assert(/v_delegation_mode := 'delegated_user';/.test(SQL));
});

Deno.test("API-I.2: client identity resolves through api_clients", () => {
  assert(/current_setting\('api_e\.api_client_id', true\)/.test(SQL));
  assert(/FROM public\.api_clients ac[\s\S]{0,120}WHERE ac\.id = v_source_client_id/.test(SQL));
  assert(/api_client % is not active/.test(SQL));
  assert(/v_source_system := v_client_key;/.test(SQL));
  assert(/v_source_component := v_capability_key;/.test(SQL));
  assert(/current_setting\('api_e\.capability_key', true\)/.test(SQL));
});

Deno.test("API-I.2: MCP integration validation is preserved", () => {
  assert(/FROM public\.tenant_integrations ti/.test(SQL));
  assert(/integration % does not exist/.test(SQL));
  assert(
    /IF _source_channel = 'mcp' THEN[\s\S]{0,160}integration % is not active/.test(SQL),
  );
  assert(/ti\.status, ti\.is_enabled/.test(SQL));
});

Deno.test("API-I.2: btpm_ui and admin_import keep direct-user provenance", () => {
  assert(/IF _source_channel IN \('btpm_ui', 'admin_import'\) THEN[\s\S]{0,300}requires an authenticated user/.test(SQL));
  assert(/v_delegation_mode := 'direct_user';/.test(SQL));
});
