/**
 * API-Q Cross-Family-C20C2-C1 — Governance Record PMG update wrapper:
 * outer browser OAuth / authentication boundary closure.
 *
 * Focused static contract test over the forward-only correction migration.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION = new URL(
  "../../migrations/20260820093638_728ed275-d70a-456b-8d69-e91f7ab347af.sql",
  import.meta.url,
).pathname;

const C20C2_MIGRATION = new URL(
  "../../migrations/20260820092621_6ff22f18-59bb-4370-97e2-69a922e388d4.sql",
  import.meta.url,
).pathname;

const sql = await Deno.readTextFile(MIGRATION);
// Strip `--` comments so prose cannot satisfy assertions.
const code = sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const lower = code.toLowerCase();

const declStart = code.indexOf("DECLARE");
const bodyStart = code.indexOf("\nBEGIN", declStart);
const decl = code.slice(declStart, bodyStart);
const body = code.slice(bodyStart);

const idx = (re: RegExp) => body.search(re);

Deno.test("1. exactly apply_governance_record_update is redefined", () => {
  const defs = code.match(/CREATE OR REPLACE FUNCTION public\.(\w+)/g) ?? [];
  assertEquals(defs.length, 1);
  assertEquals(defs[0], "CREATE OR REPLACE FUNCTION public.apply_governance_record_update");
  assertEquals(/DROP FUNCTION/i.test(code), false);
});

Deno.test("2. exact effective signature and defaults remain", () => {
  const sig = code.slice(
    code.indexOf("apply_governance_record_update("),
    code.indexOf(")\n RETURNS jsonb"),
  );
  assertEquals(
    sig,
    "apply_governance_record_update(_record_id uuid, _expected_updated_at timestamp with time zone, _event_type text DEFAULT NULL::text, _actual_date_held date DEFAULT NULL::date, _cadence_id uuid DEFAULT NULL::uuid, _event_name text DEFAULT NULL::text, _expected_date_snapshot date DEFAULT NULL::date, _summary text DEFAULT NULL::text, _decisions_summary text DEFAULT NULL::text, _external_reference_url text DEFAULT NULL::text, _sharepoint_evidence_reference text DEFAULT NULL::text, _clear_cadence boolean DEFAULT false, _clear_event_name boolean DEFAULT false, _clear_expected_date_snapshot boolean DEFAULT false, _clear_summary boolean DEFAULT false, _clear_decisions_summary boolean DEFAULT false, _clear_external_reference_url boolean DEFAULT false, _clear_sharepoint_evidence_reference boolean DEFAULT false, _decision_stage text DEFAULT NULL::text, _decision_question text DEFAULT NULL::text, _decision_owner_stakeholder_id uuid DEFAULT NULL::uuid, _target_decision_date date DEFAULT NULL::date, _clear_decision_question boolean DEFAULT false, _clear_decision_owner_stakeholder_id boolean DEFAULT false, _clear_target_decision_date boolean DEFAULT false, _decisions jsonb DEFAULT NULL::jsonb, _links jsonb DEFAULT NULL::jsonb, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text",
  );
});

Deno.test("3. function properties and search_path remain", () => {
  assert(/RETURNS jsonb/.test(code));
  assert(/LANGUAGE plpgsql/.test(code));
  assert(/SECURITY DEFINER/.test(code));
  assert(/SET search_path TO 'pg_catalog', 'public'/.test(code));
  assertEquals(/IMMUTABLE|STABLE/i.test(code), false);
});

Deno.test("4. jwt_client_id resolver is the first executable security operation", () => {
  const resolver = idx(/v_client_id\s*:=\s*api_e_private\.jwt_client_id\(\)/);
  assert(resolver > -1);
  for (
    const later of [
      /auth\.uid\(\)/,
      /is_active_user/,
      /FROM public\.governance_records/,
      /FOR UPDATE/,
      /FROM public\.projects/,
      /can_write_demo/,
      /pmg_record_command_audit/,
      /update_governance_record/,
    ]
  ) {
    const i = idx(later);
    if (i >= 0) assert(resolver < i, `resolver must precede ${later}`);
  }
});

Deno.test("5. resolver failure maps to unresolved_client", () => {
  assert(
    /EXCEPTION WHEN OTHERS THEN\s*v_client_id\s*:=\s*'unresolved_client';/.test(body),
  );
});

Deno.test("6. any non-null client id returns PMG not_authorized", () => {
  assert(
    /IF v_client_id IS NOT NULL THEN\s*RETURN public\.pmg_build_result\(\s*'not_authorized'::public\.pmg_command_status,\s*'apply_governance_record_update',\s*'governance_record',\s*_record_id,\s*NULL,/
      .test(body),
  );
});

Deno.test("7. no trusted/API/MCP/capability/source-channel/service-role bypass", () => {
  for (
    const forbidden of [
      "assert_trusted_context",
      "api_e.api_version",
      "capability_kind",
      "capability_key",
      "external_api",
      "'mcp'",
      "service_role",
      "api_capability",
    ]
  ) {
    assertEquals(lower.includes(forbidden.toLowerCase()), false, forbidden);
  }
});

Deno.test("8. auth.uid() is not initialized in DECLARE", () => {
  assertEquals(/auth\.uid\(\)/.test(decl), false);
  assert(/v_client_id text;/.test(decl));
  assert(/v_actor uuid;/.test(decl));
});

Deno.test("9. auth.uid() resolves exactly once, after the source gate", () => {
  const hits = body.match(/auth\.uid\(\)/g) ?? [];
  assertEquals(hits.length, 1);
  assert(/v_actor := auth\.uid\(\);/.test(body));
  assert(idx(/v_client_id IS NOT NULL/) < idx(/v_actor := auth\.uid\(\)/));
});

Deno.test("10. inactive/null actor retains the existing not_authorized envelope", () => {
  assert(
    /IF v_actor IS NULL OR NOT public\.is_active_user\(v_actor\) THEN\s*RETURN public\.pmg_build_result\(\s*'not_authorized'::public\.pmg_command_status, 'apply_governance_record_update',/
      .test(body),
  );
});

Deno.test("11. source+actor checks precede governance_records lookup and FOR UPDATE", () => {
  const actor = idx(/NOT public\.is_active_user\(v_actor\)/);
  assert(actor < idx(/FROM public\.governance_records/));
  assert(actor < idx(/FOR UPDATE/));
  assert(actor < idx(/FROM public\.projects/));
});

Deno.test("12. source+actor checks precede stale-write / current_updated_at handling", () => {
  const actor = idx(/NOT public\.is_active_user\(v_actor\)/);
  assert(actor < idx(/v_current_updated_at IS DISTINCT FROM _expected_updated_at/));
  assert(actor < idx(/'current_updated_at'/));
});

Deno.test("13. expected_updated_at validation remains", () => {
  assert(/IF _expected_updated_at IS NULL THEN/.test(body));
  assert(/'expected_updated_at_required'/.test(body));
  assert(/IF _record_id IS NULL THEN/.test(body));
  assert(/'Record id is required'/.test(body));
});

Deno.test("14. decisions/links input validation remains", () => {
  assert(/v_decisions_provided AND jsonb_typeof\(_decisions\) <> 'array'/.test(body));
  assert(/v_links_provided AND jsonb_typeof\(_links\) <> 'array'/.test(body));
  assert(/'Decisions payload must be a JSON array'/.test(body));
  assert(/'Links payload must be a JSON array'/.test(body));
});

Deno.test("15. record lock and authoritative Project/Workspace flow remain", () => {
  assert(
    /SELECT project_id, updated_at\s*INTO v_project_id, v_current_updated_at\s*FROM public\.governance_records\s*WHERE id = _record_id\s*FOR UPDATE;/
      .test(body),
  );
  assert(/IF NOT FOUND THEN/.test(body));
  assert(
    /SELECT workspace_id INTO v_workspace_id\s*FROM public\.projects\s*WHERE id = v_project_id;/
      .test(body),
  );
});

Deno.test("16. can_write_demo remains unchanged", () => {
  assert(
    /IF v_workspace_id IS NULL OR NOT public\.can_write_demo\(v_actor, v_workspace_id\) THEN/
      .test(body),
  );
});

Deno.test("17. conflict / current_updated_at contract remains", () => {
  assert(/'conflict'::public\.pmg_command_status/.test(body));
  assert(/'code','stale_governance_record'/.test(body));
  assert(/'current_updated_at', v_current_updated_at/.test(body));
  assert(/jsonb_build_object\('stale', true\)/.test(body));
});

Deno.test("18. downstream update_governance_record call remains", () => {
  assert(/PERFORM public\.update_governance_record\(/.test(body));
  assert(/_clear_target_decision_date\);/.test(body));
});

Deno.test("19. optional decisions/links child calls remain", () => {
  assert(
    /IF v_decisions_provided THEN\s*PERFORM public\.set_governance_record_decisions\(_record_id, _decisions\);/
      .test(body),
  );
  assert(
    /IF v_links_provided THEN\s*PERFORM public\.set_governance_record_links\(_record_id, _links\);/
      .test(body),
  );
  assert(/v_decision_count := jsonb_array_length\(_decisions\);/.test(body));
  assert(/v_link_count := jsonb_array_length\(_links\);/.test(body));
});

Deno.test("20. audit provenance remains btpm_ui only", () => {
  const channels = body.match(/'(\w+)'::public\.pmg_source_channel/g) ?? [];
  assert(channels.length >= 2);
  for (const c of channels) assertEquals(c, "'btpm_ui'::public.pmg_source_channel");
});

Deno.test("21. correlation/idempotency and result envelope remain", () => {
  assert(/_correlation_id, _idempotency_key,/.test(body));
  assert(/'applied'::public\.pmg_command_status, 'apply_governance_record_update'/.test(body));
  assert(/'governance_record_id', _record_id/.test(body));
  assert(/WHEN insufficient_privilege THEN/.test(body));
  assert(/WHEN invalid_parameter_value/.test(body));
});

Deno.test("22. C20C2 downstream migration is unchanged by this step", async () => {
  const prior = await Deno.readTextFile(C20C2_MIGRATION);
  assert(/update_governance_record/.test(prior));
  for (
    const fn of [
      "public.archive_governance_record",
      "public.restore_governance_record",
      "public.update_governance_record",
      "public.set_governance_record_decisions",
      "public.set_governance_record_links",
      "public.apply_governance_record_create",
    ]
  ) {
    assertEquals(
      code.includes(`CREATE OR REPLACE FUNCTION ${fn}`),
      false,
      fn,
    );
  }
});

Deno.test("23. frontend caller remains apply_governance_record_update on the browser client", async () => {
  const hook = await Deno.readTextFile(
    new URL("../../../src/hooks/useProjectGovernance.ts", import.meta.url).pathname,
  );
  assert(hook.includes("apply_governance_record_update"));
  assert(/from "@\/integrations\/supabase\/client"/.test(hook));
  assertEquals(/service_role|SERVICE_ROLE/.test(hook), false);
});

Deno.test("24. no GRANT / REVOKE", () => {
  assertEquals(/^\s*grant\s/im.test(code), false);
  assertEquals(/^\s*revoke\s/im.test(code), false);
  assertEquals(/alter function/i.test(code), false);
});

Deno.test("25. no API/MCP/schema/RLS/trigger/encryption/business-data drift", () => {
  assertEquals(/create table|alter table|create policy|create trigger/i.test(code), false);
  assertEquals(/btpm_encrypt|btpm_decrypt|tenant_encryption/i.test(code), false);
  const topLevel = code.replace(/\$function\$[\s\S]*?\$function\$/g, "");
  assertEquals(/insert\s+into|update\s+public\.|delete\s+from/i.test(topLevel), false);
});
