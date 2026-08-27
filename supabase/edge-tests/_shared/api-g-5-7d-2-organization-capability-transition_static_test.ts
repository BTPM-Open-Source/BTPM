// API-G.5.7D-2 — Protected Organization Capability Grant Enable/Disable Command.
// Repository-only static contract test. No runtime execution, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-G.5.7D-2";
const FN = "public.api_g_5_7_admin_transition_organization_client_capability";

function listMigrations(): string[] {
  const out: string[] = [];
  for (const entry of Deno.readDirSync(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) {
      out.push(`${MIGRATIONS_DIR}/${entry.name}`);
    }
  }
  return out.sort();
}

function markerMigrations(): string[] {
  return listMigrations().filter((p) => Deno.readTextFileSync(p).includes(MARKER));
}

function sql(): string {
  const paths = markerMigrations();
  assertEquals(paths.length, 1, "expected exactly one API-G.5.7D-2 migration");
  return Deno.readTextFileSync(paths[0]);
}

Deno.test("exactly one migration carries the API-G.5.7D-2 marker", () => {
  assertEquals(markerMigrations().length, 1);
});

Deno.test("exact RPC signature and uuid return", () => {
  const s = sql();
  assert(
    new RegExp(
      `CREATE OR REPLACE FUNCTION\\s+${FN.replace(/\./g, "\\.")}\\s*\\(\\s*_organization_id uuid\\s*,\\s*_api_client_id uuid\\s*,\\s*_api_version text\\s*,\\s*_capability_key text\\s*,\\s*_target_lifecycle_status text\\s*\\)\\s*RETURNS uuid`,
      "i",
    ).test(s),
    "exact argument list and uuid return required",
  );
});

Deno.test("no caller-supplied capability kind argument", () => {
  const s = sql();
  const sig = s.slice(s.indexOf("CREATE OR REPLACE FUNCTION"), s.indexOf("RETURNS uuid"));
  assert(!/_capability_kind/i.test(sig), "capability_kind must not be a caller argument");
  assert(!/(?<![A-Za-z0-9])_capability_kind/i.test(s), "no caller capability_kind anywhere");
});

Deno.test("function posture is plpgsql VOLATILE SECURITY DEFINER with fixed search_path", () => {
  const s = sql();
  assert(/LANGUAGE plpgsql/i.test(s));
  assert(/\bVOLATILE\b/i.test(s));
  assert(!/\bSTABLE\b/i.test(s));
  assert(/SECURITY DEFINER/i.test(s));
  assert(/SET search_path = public, pg_catalog/i.test(s));
});

Deno.test("actor derives only from auth.uid() and must be active", () => {
  const s = sql();
  assert(s.includes("v_actor uuid := auth.uid()"));
  assert(s.includes("public.is_active_user(v_actor)"));
  for (
    const banned of [
      /request\.header/i,
      /\b_actor\b/i,
      /_user_id\s+uuid\s*,/i,
      /is_super_admin/i,
      /platform_super_admins/i,
      /is_workspace_admin/i,
      /is_workspace_member/i,
      /is_project_manager/i,
      /has_project_access/i,
      /organization_memberships/i,
      /project_memberships/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden authority surface: ${banned}`);
  }
});

Deno.test("tenant is derived server-side from the Organization", () => {
  const s = sql();
  assert(
    /SELECT o\.tenant_id INTO v_tenant_id[\s\S]{0,120}FROM public\.organizations o[\s\S]{0,80}WHERE o\.id = _organization_id/i
      .test(s),
  );
});

Deno.test("authority is exactly tenant admin or organization admin with accepted order", () => {
  const s = sql();
  assert(s.includes("public.is_tenant_admin(v_tenant_id, v_actor)"));
  assert(s.includes("public.is_org_admin(v_actor, _organization_id)"));
  assert(/not_authorized/.test(s));
  assert(/ERRCODE = '42501'/.test(s));
});

Deno.test("inputs and target lifecycle are validated", () => {
  const s = sql();
  assert(s.includes("_organization_id IS NULL"));
  assert(s.includes("_api_client_id IS NULL"));
  assert(s.includes("_api_version IS NULL"));
  assert(s.includes("_capability_key IS NULL"));
  assert(s.includes("btrim(_api_version) = ''"));
  assert(s.includes("btrim(_capability_key) = ''"));
  assert(s.includes("invalid_arguments"));
  assert(s.includes("_target_lifecycle_status NOT IN ('enabled', 'disabled')"));
  assert(s.includes("invalid_target_lifecycle_status"));
  assert(/ERRCODE = '22023'/.test(s));
});

Deno.test("exactly one accepted Organization/client advisory lock", () => {
  const s = sql();
  const locks = s.match(/pg_advisory_xact_lock\s*\(/g) ?? [];
  assertEquals(locks.length, 1);
  assert(!/pg_advisory_lock\s*\(/i.test(s));
  const idx = s.indexOf("pg_advisory_xact_lock");
  const block = s.slice(idx, s.indexOf(");", idx) + 2);
  assertEquals((block.match(/hashtextextended\s*\(/g) ?? []).length, 1);
  assert(block.includes("'api_g_5_7_organization_client_transition|'"));
  assert(block.includes("_organization_id::text"));
  assert(block.includes("_api_client_id::text"));
});

Deno.test("lock follows authority and precedes parent, capability and grant reads", () => {
  const s = sql();
  const lockIdx = s.indexOf("pg_advisory_xact_lock");
  const authorityIdx = s.indexOf("public.is_tenant_admin(");
  const parentIdx = s.indexOf("public.api_organization_client_enablements");
  const capIdx = s.indexOf("public.api_client_supported_capabilities");
  const grantIdx = s.indexOf("FROM public.api_capability_grants g");
  assert(authorityIdx > 0 && authorityIdx < lockIdx);
  assert(lockIdx < parentIdx);
  assert(lockIdx < capIdx);
  assert(lockIdx < grantIdx);
});

Deno.test("enable requires an active client and enabled Organization parent", () => {
  const s = sql();
  assert(s.includes("v_client_status IS DISTINCT FROM 'active'"));
  assert(s.includes("client_not_active"));
  assert(s.includes("v_org_parent_status IS DISTINCT FROM 'enabled'"));
  assert(s.includes("organization_client_not_enabled"));
  const parentBlock = s.slice(
    s.indexOf("FROM public.api_organization_client_enablements oe"),
    s.indexOf("organization_client_not_enabled"),
  );
  assert(parentBlock.includes("oe.tenant_id = v_tenant_id"));
  assert(parentBlock.includes("oe.organization_id = _organization_id"));
  assert(parentBlock.includes("oe.api_client_id = _api_client_id"));
});

Deno.test("capability resolution starts from the exact supported declaration and joins the catalogue on version, kind and key", () => {
  const s = sql();
  const derive = s.slice(
    s.indexOf("SELECT cat.capability_kind INTO v_capability_kind"),
    s.indexOf("IF _target_lifecycle_status = 'enabled' THEN\n    SELECT c.lifecycle_status"),
  );
  assert(derive.includes("FROM public.api_client_supported_capabilities s"));
  assert(derive.includes("JOIN public.api_capability_catalogue cat"));
  assert(derive.includes("cat.api_version = s.api_version"));
  assert(derive.includes("cat.capability_kind = s.capability_kind"));
  assert(derive.includes("cat.capability_key = s.capability_key"));
  assert(derive.includes("s.api_client_id = _api_client_id"));
  assert(derive.includes("s.api_version = _api_version"));
  assert(derive.includes("s.capability_key = _capability_key"));
});

Deno.test("enable eligibility requires enabled support, active catalogue, assignable, organization scope and read kind", () => {
  const s = sql();
  const block = s.slice(
    s.indexOf("PERFORM 1\n    FROM public.api_client_supported_capabilities s"),
    s.indexOf("capability_not_available"),
  );
  assert(block.includes("s.lifecycle_status = 'enabled'"));
  assert(block.includes("cat.lifecycle_status = 'active'"));
  assert(block.includes("cat.administrator_assignable = true"));
  assert(block.includes("cat.scope_level = 'organization'"));
  assert(block.includes("cat.capability_kind = 'read'"));
  assert(s.includes("capability_not_available"));
});

Deno.test("command capabilities cannot be enabled", () => {
  const s = sql();
  assert(s.includes("cat.capability_kind = 'read'"));
  assert(!/capability_kind\s*=\s*'command'/i.test(s));
  assert(!/capability_kind\s+IN\s*\(/i.test(s));
});

Deno.test("grant lookup identity uses tenant, organization, null workspace, client, version and key only", () => {
  const s = sql();
  const block = s.slice(
    s.indexOf("FROM public.api_capability_grants g"),
    s.indexOf("FOR UPDATE"),
  );
  assert(block.includes("g.tenant_id = v_tenant_id"));
  assert(block.includes("g.organization_id = _organization_id"));
  assert(block.includes("g.workspace_id IS NULL"));
  assert(block.includes("g.api_client_id = _api_client_id"));
  assert(block.includes("g.api_version = _api_version"));
  assert(block.includes("g.capability_key = _capability_key"));
  assert(!/g\.capability_kind\s*=/i.test(block), "kind must not be part of lookup identity");
});

Deno.test("existing grant is locked FOR UPDATE and kind mismatch fails closed", () => {
  const s = sql();
  assert(s.includes("FOR UPDATE"));
  assert(s.includes("v_row.capability_kind IS DISTINCT FROM v_capability_kind"));
  const mismatchIdx = s.indexOf("v_row.capability_kind IS DISTINCT FROM v_capability_kind");
  const after = s.slice(mismatchIdx, mismatchIdx + 220);
  assert(after.includes("capability_not_available"));
});

Deno.test("missing-row enable inserts exactly one Organization-level enabled grant", () => {
  const s = sql();
  const inserts = s.match(/INSERT INTO public\.api_capability_grants/g) ?? [];
  assertEquals(inserts.length, 1);
  const block = s.slice(
    s.indexOf("INSERT INTO public.api_capability_grants"),
    s.indexOf("RETURNING id INTO v_grant_id"),
  );
  assert(block.includes("workspace_id"));
  assert(block.includes("v_tenant_id, _organization_id, NULL, _api_client_id"));
  assert(block.includes("_api_version, v_capability_kind, _capability_key"));
  assert(block.includes("'enabled', NULL, now(), NULL, v_actor, v_actor"));
});

Deno.test("disabled-to-enabled resets lifecycle timestamps and preserves reason", () => {
  const s = sql();
  const block = s.slice(
    s.indexOf("ELSIF v_row.lifecycle_status = 'disabled' THEN"),
    s.indexOf("v_action := 'enable_organization_capability'"),
  );
  assert(block.includes("lifecycle_status = 'enabled'"));
  assert(block.includes("enabled_at = now()"));
  assert(block.includes("disabled_at = NULL"));
  assert(block.includes("updated_by = v_actor"));
  assert(!/reason\s*=/i.test(block), "reason must be preserved on enable");
});

Deno.test("enabled-to-disabled preserves enabled_at and reason", () => {
  const s = sql();
  const block = s.slice(
    s.indexOf("v_action := 'disable_organization_capability'") - 700,
    s.indexOf("v_action := 'disable_organization_capability'"),
  );
  assert(block.includes("lifecycle_status = 'disabled'"));
  assert(block.includes("disabled_at = now()"));
  assert(block.includes("updated_by = v_actor"));
  assert(!/enabled_at\s*=/i.test(block), "enabled_at must be preserved on disable");
  assert(!/reason\s*=/i.test(block), "reason must be preserved on disable");
});

Deno.test("same-state transitions and missing-row disable are rejected", () => {
  const s = sql();
  const rejects = s.match(/invalid_lifecycle_transition/g) ?? [];
  assert(rejects.length >= 2);
  assert(s.includes("v_row.id IS NULL OR v_row.lifecycle_status IS DISTINCT FROM 'enabled'"));
});

Deno.test("disable path has no client, parent or capability-eligibility prerequisite", () => {
  const s = sql();
  const clientIdx = s.indexOf("client_not_active");
  const parentIdx = s.indexOf("organization_client_not_enabled");
  const eligibilityIdx = s.indexOf("cat.scope_level = 'organization'");
  const enableGuard = s.indexOf("IF _target_lifecycle_status = 'enabled' THEN\n    SELECT c.lifecycle_status");
  const enableGuardEnd = s.indexOf("-- Exact Organization-level grant identity");
  for (const idx of [clientIdx, parentIdx, eligibilityIdx]) {
    assert(idx > enableGuard && idx < enableGuardEnd, "prerequisites must be enable-only");
  }
});

Deno.test("audit constraint extension preserves all accepted values and adds the new ones", () => {
  const s = sql();
  for (
    const kept of [
      "organization_client_enablement",
      "workspace_client_enablement",
      "project_client_enablement",
      "enable_organization_client",
      "disable_organization_client",
      "enable_workspace_client",
      "disable_workspace_client",
      "enable_project_client",
      "disable_project_client",
    ]
  ) {
    assert(s.includes(kept), `accepted audit value dropped: ${kept}`);
  }
  assert(s.includes("organization_capability_grant"));
  assert(s.includes("enable_organization_capability"));
  assert(s.includes("disable_organization_capability"));
  assert(s.includes("api_connected_apps_admin_audit_events_target_type_check"));
  assert(s.includes("api_connected_apps_admin_audit_events_action_check"));
});

Deno.test("exactly one audit insert with the required values", () => {
  const s = sql();
  const inserts = s.match(/INSERT INTO public\.api_connected_apps_admin_audit_events/g) ?? [];
  assertEquals(inserts.length, 1);
  const block = s.slice(s.indexOf("INSERT INTO public.api_connected_apps_admin_audit_events"));
  assert(block.includes("gen_random_uuid(), v_actor, v_tenant_id, _organization_id, _api_client_id"));
  assert(block.includes("'organization_capability_grant', v_grant_id, v_action"));
  assert(block.includes("v_previous, _target_lifecycle_status, 'btpm_ui'"));
});

Deno.test("no catalogue, supported-capability, parent enablement or workspace-grant mutation", () => {
  const s = sql();
  for (
    const banned of [
      /INSERT INTO public\.api_capability_catalogue/i,
      /UPDATE public\.api_capability_catalogue/i,
      /INSERT INTO public\.api_client_supported_capabilities/i,
      /UPDATE public\.api_client_supported_capabilities/i,
      /INSERT INTO public\.api_organization_client_enablements/i,
      /UPDATE public\.api_organization_client_enablements/i,
      /INSERT INTO public\.api_workspace_client_enablements/i,
      /UPDATE public\.api_workspace_client_enablements/i,
      /INSERT INTO public\.api_project_client_enablements/i,
      /UPDATE public\.api_project_client_enablements/i,
      /UPDATE public\.api_clients/i,
      /api_client_policy_versions/i,
      /api_user_policy_acknowledgements/i,
      /workspace_id\s*=\s*_workspace_id/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden mutation present: ${banned}`);
  }
});

Deno.test("no delete, cascade, bulk or dynamic behaviour", () => {
  const s = sql();
  for (
    const banned of [
      /\bDELETE\s+FROM\b/i,
      /\bTRUNCATE\b/i,
      /EXECUTE\s+format/i,
      /\bFOR\s+\w+\s+IN\s+SELECT\b/i,
      /\bLOOP\b/i,
      /\bCOMMIT\b/i,
      /\bROLLBACK\b/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden behaviour present: ${banned}`);
  }
});

Deno.test("no new table, column, index, policy, trigger, frontend or edge function surface", () => {
  const s = sql();
  for (
    const banned of [
      /CREATE\s+TABLE/i,
      /ADD\s+COLUMN/i,
      /CREATE\s+(UNIQUE\s+)?INDEX/i,
      /CREATE\s+POLICY/i,
      /DROP\s+POLICY/i,
      /CREATE\s+TRIGGER/i,
      /CREATE\s+TYPE/i,
      /ENABLE ROW LEVEL SECURITY/i,
      /tenant_integrations/i,
      /astra/i,
      /oauth/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden surface present: ${banned}`);
  }
  assert(!/^\s*GRANT\s+(?!EXECUTE)/im.test(s), "only EXECUTE grants may appear");
});

Deno.test("execution denied to PUBLIC and anon, granted to authenticated", () => {
  const s = sql();
  assert(/REVOKE ALL ON FUNCTION[\s\S]{0,220}FROM PUBLIC/i.test(s));
  assert(/REVOKE ALL ON FUNCTION[\s\S]{0,220}FROM anon/i.test(s));
  assert(/GRANT EXECUTE ON FUNCTION[\s\S]{0,220}TO authenticated/i.test(s));
});

Deno.test("earlier accepted functions and runtime helpers are not redefined", () => {
  const s = sql();
  const creates = s.match(/CREATE OR REPLACE FUNCTION\s+([a-zA-Z0-9_."]+)/gi) ?? [];
  assertEquals(creates.length, 1, "exactly one function definition allowed");
  assert((creates[0] ?? "").includes(FN));
  for (
    const banned of [
      "api_g_5_7_admin_list_organization_clients(",
      "api_g_5_7_admin_transition_organization_client(",
      "api_g_5_7_admin_transition_workspace_client(",
      "api_g_5_7_admin_transition_project_client(",
      "api_g_5_7_admin_list_organization_client_capabilities(",
      "authorize_and_establish",
      "api_c_enforce_capability_grant_scope_integrity",
      "api_g_5_2_enforce_grant_capability_lifecycle",
    ]
  ) {
    assert(!s.includes(banned), `must not redefine: ${banned}`);
  }
});
