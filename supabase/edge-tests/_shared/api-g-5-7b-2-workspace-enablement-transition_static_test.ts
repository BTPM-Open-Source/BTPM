// API-G.5.7B-2 — Protected Workspace Client Enable/Disable Command.
// Repository-only static contract test. No runtime execution, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-G.5.7B-2";
const FN = "public.api_g_5_7_admin_transition_workspace_client";

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
  assertEquals(paths.length, 1, "expected exactly one API-G.5.7B-2 migration");
  return Deno.readTextFileSync(paths[0]);
}

Deno.test("exactly one migration carries the API-G.5.7B-2 marker", () => {
  assertEquals(markerMigrations().length, 1);
});

Deno.test("exact RPC signature and uuid return type", () => {
  const s = sql();
  assert(
    new RegExp(
      `CREATE OR REPLACE FUNCTION\\s+${FN.replace(".", "\\.")}\\s*\\(\\s*_organization_id uuid\\s*,\\s*_workspace_id uuid\\s*,\\s*_api_client_id uuid\\s*,\\s*_target_lifecycle_status text\\s*\\)\\s*RETURNS uuid`,
      "i",
    ).test(s),
    "exact signature and return type required",
  );
});

Deno.test("function posture is plpgsql VOLATILE SECURITY DEFINER with fixed search_path", () => {
  const s = sql();
  assert(/LANGUAGE plpgsql/i.test(s));
  assert(/\bVOLATILE\b/i.test(s));
  assert(!/\bSTABLE\b/i.test(s));
  assert(/SECURITY DEFINER/i.test(s));
  assert(/SET search_path = public, pg_catalog/i.test(s));
});

Deno.test("actor derives from auth.uid() and must be an active user", () => {
  const s = sql();
  assert(s.includes("v_actor uuid := auth.uid()"));
  assert(s.includes("public.is_active_user(v_actor)"));
  for (
    const banned of [
      /request\.header/i,
      /is_super_admin/i,
      /platform_super_admins/i,
      /is_workspace_admin/i,
      /is_workspace_member/i,
      /is_project_manager/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden authority surface: ${banned}`);
  }
});

Deno.test("tenant derives server-side from the Organization", () => {
  const s = sql();
  assert(
    /SELECT o\.tenant_id INTO v_tenant_id[\s\S]{0,120}FROM public\.organizations o[\s\S]{0,80}WHERE o\.id = _organization_id/i
      .test(s),
  );
});

Deno.test("authority is exactly tenant-admin OR org-admin with accepted argument order", () => {
  const s = sql();
  assert(s.includes("public.is_tenant_admin(v_tenant_id, v_actor)"));
  assert(s.includes("public.is_org_admin(v_actor, _organization_id)"));
  assert(/not_authorized/.test(s));
  assert(/ERRCODE = '42501'/.test(s));
});

Deno.test("input validation rejects null identifiers and invalid targets", () => {
  const s = sql();
  assert(s.includes("_organization_id IS NULL OR _workspace_id IS NULL OR _api_client_id IS NULL"));
  assert(s.includes("invalid_arguments"));
  assert(s.includes("NOT IN ('enabled', 'disabled')"));
  assert(s.includes("invalid_target_lifecycle_status"));
  assert(/ERRCODE = '22023'/.test(s));
});

Deno.test("workspace containment is verified against the exact Organization", () => {
  const s = sql();
  const i = s.indexOf("FROM public.workspaces w");
  assert(i > 0);
  const block = s.slice(i, i + 200);
  assert(block.includes("w.id = _workspace_id"));
  assert(block.includes("w.organization_id = _organization_id"));
  const authIdx = s.indexOf("public.is_org_admin(v_actor, _organization_id)");
  assert(authIdx > 0 && authIdx < i, "containment check follows Organization authority");
});

Deno.test("single accepted Organization/client advisory lock, one-key bigint form", () => {
  const s = sql();
  const locks = s.match(/pg_advisory_xact_lock\s*\(/g) ?? [];
  assertEquals(locks.length, 1, "exactly one advisory lock expected");
  assert(!/pg_advisory_lock\s*\(/i.test(s));
  const i = s.indexOf("pg_advisory_xact_lock");
  const block = s.slice(i, s.indexOf(");", i) + 2);
  assertEquals((block.match(/hashtextextended\s*\(/g) ?? []).length, 1);
  assert(block.includes("'api_g_5_7_organization_client_transition|'"));
  assert(block.includes("_organization_id::text"));
  assert(block.includes("_api_client_id::text"));
  assert(
    !/pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\([^;]*?\)\s*,\s*hashtextextended\s*\(/is
      .test(s),
  );
});

Deno.test("advisory lock precedes parent-enablement and workspace-enablement evaluation", () => {
  const s = sql();
  const lockIdx = s.indexOf("pg_advisory_xact_lock");
  const parentIdx = s.indexOf("FROM public.api_organization_client_enablements oe");
  const wsEnableIdx = s.indexOf("FROM public.api_workspace_client_enablements e");
  const authorityIdx = s.indexOf("public.is_tenant_admin(v_tenant_id, v_actor)");
  assert(authorityIdx > 0 && authorityIdx < lockIdx);
  assert(lockIdx > 0 && parentIdx > lockIdx);
  assert(wsEnableIdx > lockIdx);
});

Deno.test("enable requires an active API client", () => {
  const s = sql();
  assert(s.includes("FROM public.api_clients c"));
  assert(s.includes("v_client_status IS DISTINCT FROM 'active'"));
  assert(s.includes("client_not_active"));
});

Deno.test("enable requires the exact parent Organization/client enablement to be enabled", () => {
  const s = sql();
  const i = s.indexOf("FROM public.api_organization_client_enablements oe");
  const block = s.slice(i, i + 300);
  assert(block.includes("oe.tenant_id = v_tenant_id"));
  assert(block.includes("oe.organization_id = _organization_id"));
  assert(block.includes("oe.api_client_id = _api_client_id"));
  assert(s.includes("v_parent_status IS DISTINCT FROM 'enabled'"));
  assert(s.includes("organization_client_not_enabled"));
});

Deno.test("enable rejects inactive or archived Workspaces", () => {
  const s = sql();
  assert(s.includes("w.is_active = true"));
  assert(s.includes("w.is_archived = false"));
  assert(s.includes("workspace_not_active"));
});

Deno.test("workspace enablement is selected on tenant, organization, workspace and client scope, locked FOR UPDATE", () => {
  const s = sql();
  const i = s.indexOf("FROM public.api_workspace_client_enablements e");
  const block = s.slice(i, s.indexOf("FOR UPDATE", i) + 10);
  assert(block.includes("e.tenant_id = v_tenant_id"));
  assert(block.includes("e.organization_id = _organization_id"));
  assert(block.includes("e.workspace_id = _workspace_id"));
  assert(block.includes("e.api_client_id = _api_client_id"));
  assert(block.includes("FOR UPDATE"));
});

Deno.test("missing-row enable inserts exactly one enabled workspace enablement row", () => {
  const s = sql();
  const inserts = s.match(/INSERT INTO public\.api_workspace_client_enablements/g) ?? [];
  assertEquals(inserts.length, 1);
  const i = s.indexOf("INSERT INTO public.api_workspace_client_enablements");
  const block = s.slice(i, i + 500);
  assert(block.includes("'enabled'"));
  assert(block.includes("now(), NULL, v_actor, v_actor"));
});

Deno.test("disabled-to-enabled resets timestamps, enabled-to-disabled preserves enabled_at", () => {
  const s = sql();
  assert(/SET lifecycle_status = 'enabled',\s*\n\s*enabled_at = now\(\),\s*\n\s*disabled_at = NULL,\s*\n\s*updated_by = v_actor/.test(s));
  const d = s.indexOf("SET lifecycle_status = 'disabled'");
  const dblock = s.slice(d, d + 200);
  assert(dblock.includes("disabled_at = now()"));
  assert(dblock.includes("updated_by = v_actor"));
  assert(!dblock.includes("enabled_at ="), "enabled_at must be preserved on disable");
});

Deno.test("same-state and missing-row transitions are rejected", () => {
  const s = sql();
  assert((s.match(/invalid_lifecycle_transition/g) ?? []).length >= 2);
  assert(s.includes("v_row.id IS NULL OR v_row.lifecycle_status IS DISTINCT FROM 'enabled'"));
});

Deno.test("disable does not require active client, enabled parent, or active workspace", () => {
  const s = sql();
  const enableGate = s.indexOf("IF _target_lifecycle_status = 'enabled' THEN");
  const clientIdx = s.indexOf("client_not_active");
  const parentIdx = s.indexOf("organization_client_not_enabled");
  const wsIdx = s.indexOf("workspace_not_active");
  const disableIdx = s.indexOf("v_action := 'disable_workspace_client'");
  assert(enableGate > 0 && clientIdx > enableGate && parentIdx > enableGate && wsIdx > enableGate);
  assert(disableIdx > wsIdx, "disable branch is after the enable-only prerequisites");
});

Deno.test("audit constraints retain Organization values and add Workspace values", () => {
  const s = sql();
  assert(s.includes("'organization_client_enablement'::text"));
  assert(s.includes("'workspace_client_enablement'::text"));
  assert(s.includes("'enable_organization_client'::text"));
  assert(s.includes("'disable_organization_client'::text"));
  assert(s.includes("'enable_workspace_client'::text"));
  assert(s.includes("'disable_workspace_client'::text"));
  assert(/ADD CONSTRAINT api_connected_apps_admin_audit_events_target_type_check/.test(s));
  assert(/ADD CONSTRAINT api_connected_apps_admin_audit_events_action_check/.test(s));
});

Deno.test("exactly one audit insert exists on the successful command path", () => {
  const s = sql();
  const inserts = s.match(/INSERT INTO public\.api_connected_apps_admin_audit_events/g) ?? [];
  assertEquals(inserts.length, 1);
  const i = s.indexOf("INSERT INTO public.api_connected_apps_admin_audit_events");
  const block = s.slice(i);
  assert(block.includes("gen_random_uuid(), v_actor, v_tenant_id, _organization_id, _api_client_id"));
  assert(block.includes("'workspace_client_enablement', v_enablement_id, v_action"));
  assert(block.includes("v_previous, _target_lifecycle_status, 'btpm_ui'"));
});

Deno.test("no Project enablement or capability-grant mutation, no cascade or bulk behaviour", () => {
  const s = sql();
  for (
    const banned of [
      /INSERT INTO public\.api_project_client_enablements/i,
      /UPDATE public\.api_project_client_enablements/i,
      /INSERT INTO public\.api_capability_grants/i,
      /UPDATE public\.api_capability_grants/i,
      /\bDELETE\s+FROM\b/i,
      /\bTRUNCATE\b/i,
      /ON CONFLICT/i,
      /EXECUTE\s+format/i,
      /UPDATE public\.api_organization_client_enablements/i,
      /api_user_policy_acknowledgements/i,
      /api_client_policy_versions/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden mutation present: ${banned}`);
  }
});

Deno.test("no new table, column, policy, index, trigger or type", () => {
  const s = sql();
  for (
    const banned of [
      /CREATE\s+TABLE/i,
      /ADD\s+COLUMN/i,
      /CREATE\s+POLICY/i,
      /DROP\s+POLICY/i,
      /CREATE\s+(UNIQUE\s+)?INDEX/i,
      /CREATE\s+TRIGGER/i,
      /CREATE\s+TYPE/i,
      /tenant_integrations/i,
      /oauth/i,
      /astra/i,
      /\bCOMMIT\b/i,
      /\bROLLBACK\b/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden surface present: ${banned}`);
  }
  assert(!/GRANT\s+(?!EXECUTE)/i.test(s), "only EXECUTE grants may appear");
});

Deno.test("execution denied to PUBLIC and anon, granted to authenticated", () => {
  const s = sql();
  assert(/REVOKE ALL ON FUNCTION[\s\S]{0,200}FROM PUBLIC/i.test(s));
  assert(/REVOKE ALL ON FUNCTION[\s\S]{0,200}FROM anon/i.test(s));
  assert(/GRANT EXECUTE ON FUNCTION[\s\S]{0,200}TO authenticated/i.test(s));
});

Deno.test("previously accepted API-G.5.7 functions are not redefined", () => {
  const s = sql();
  const creates = s.match(/CREATE OR REPLACE FUNCTION\s+([a-zA-Z0-9_."]+)/gi) ?? [];
  assertEquals(creates.length, 1, "exactly one function definition allowed");
  assert((creates[0] ?? "").includes(FN));
  assert(!s.includes("api_g_5_7_admin_list_organization_clients("));
  assert(!s.includes("api_g_5_7_admin_transition_organization_client("));
  assert(!s.includes("api_g_5_7_admin_list_organization_client_workspaces("));
});
