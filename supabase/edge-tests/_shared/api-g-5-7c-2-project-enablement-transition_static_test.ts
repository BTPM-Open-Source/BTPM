// API-G.5.7C-2 — Protected Project Client Enable/Disable Command.
// Repository-only static contract test. No runtime execution, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-G.5.7C-2";
const FN = "public.api_g_5_7_admin_transition_project_client";

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
  assertEquals(paths.length, 1, "expected exactly one API-G.5.7C-2 migration");
  return Deno.readTextFileSync(paths[0]);
}

function enableBlock(s: string): string {
  const i = s.indexOf("IF _target_lifecycle_status = 'enabled' THEN");
  const j = s.indexOf("SELECT * INTO v_row");
  assert(i > 0 && j > i);
  return s.slice(i, j);
}

Deno.test("exactly one migration carries the API-G.5.7C-2 marker", () => {
  assertEquals(markerMigrations().length, 1);
});

Deno.test("exact RPC signature and uuid return type", () => {
  const s = sql();
  assert(
    new RegExp(
      `CREATE OR REPLACE FUNCTION\\s+${FN.replace(".", "\\.")}\\s*\\(\\s*_organization_id uuid\\s*,\\s*_workspace_id uuid\\s*,\\s*_project_id uuid\\s*,\\s*_api_client_id uuid\\s*,\\s*_target_lifecycle_status text\\s*\\)\\s*RETURNS uuid`,
      "i",
    ).test(s),
    "exact argument list and uuid return type required",
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
      /project_memberships/i,
      /workspace_memberships/i,
      /project_team_members/i,
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

Deno.test("authority is exactly tenant-admin OR org-admin with accepted argument order", () => {
  const s = sql();
  assert(s.includes("public.is_tenant_admin(v_tenant_id, v_actor)"));
  assert(s.includes("public.is_org_admin(v_actor, _organization_id)"));
  const authCalls = s.match(/public\.is_(tenant|org)_admin\(/g) ?? [];
  assertEquals(authCalls.length, 2, "exactly two authority helper calls");
});

Deno.test("null identifiers and invalid target status are rejected", () => {
  const s = sql();
  assert(
    /_organization_id IS NULL OR _workspace_id IS NULL OR _project_id IS NULL OR _api_client_id IS NULL/
      .test(s),
  );
  assert(s.includes("invalid_arguments"));
  assert(s.includes("_target_lifecycle_status NOT IN ('enabled', 'disabled')"));
  assert(s.includes("invalid_target_lifecycle_status"));
  assert(/ERRCODE = '22023'/.test(s));
});

Deno.test("Workspace containment is scoped to the exact Organization", () => {
  const s = sql();
  assert(
    /FROM public\.workspaces w\s*\n\s*WHERE w\.id = _workspace_id\s*\n\s*AND w\.organization_id = _organization_id/i
      .test(s),
  );
});

Deno.test("Project containment is scoped to the exact Workspace and Organization", () => {
  const s = sql();
  assert(
    /FROM public\.projects p\s*\n\s*WHERE p\.id = _project_id\s*\n\s*AND p\.workspace_id = _workspace_id\s*\n\s*AND p\.organization_id = _organization_id/i
      .test(s),
  );
});

Deno.test("missing or foreign scope collapses into not_authorized", () => {
  const s = sql();
  const denials = s.match(/RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'/g) ?? [];
  assert(denials.length >= 5, "auth, tenant, authority, workspace and project denials");
});

Deno.test("exactly one accepted Organization/client advisory lock exists", () => {
  const s = sql();
  const locks = s.match(/pg_advisory_xact_lock\s*\(/g) ?? [];
  assertEquals(locks.length, 1);
  assert(!/pg_advisory_lock\s*\(/i.test(s));
  const i = s.indexOf("pg_advisory_xact_lock");
  const block = s.slice(i, s.indexOf(");", i) + 2);
  const hashes = block.match(/hashtextextended\s*\(/g) ?? [];
  assertEquals(hashes.length, 1);
  assert(block.includes("'api_g_5_7_organization_client_transition|'"));
  assert(block.includes("_organization_id::text"));
  assert(block.includes("_api_client_id::text"));
  assert(!block.includes("_workspace_id::text"));
  assert(!block.includes("_project_id::text"));
});

Deno.test("lock follows authority and containment, precedes enablement reads", () => {
  const s = sql();
  const lockIdx = s.indexOf("pg_advisory_xact_lock");
  const authorityIdx = s.indexOf("public.is_tenant_admin(");
  const projContainIdx = s.indexOf("AND p.workspace_id = _workspace_id");
  const orgParentIdx = s.indexOf("api_organization_client_enablements");
  const wsParentIdx = s.indexOf("api_workspace_client_enablements");
  const rowIdx = s.indexOf("api_project_client_enablements e");
  assert(authorityIdx > 0 && authorityIdx < lockIdx);
  assert(projContainIdx > 0 && projContainIdx < lockIdx);
  assert(lockIdx < orgParentIdx);
  assert(lockIdx < wsParentIdx);
  assert(lockIdx < rowIdx);
});

Deno.test("enable requires an active API client", () => {
  const b = enableBlock(sql());
  assert(b.includes("FROM public.api_clients c"));
  assert(b.includes("v_client_status IS DISTINCT FROM 'active'"));
  assert(b.includes("client_not_active"));
});

Deno.test("enable requires an enabled Organization parent scope", () => {
  const b = enableBlock(sql());
  const i = b.indexOf("api_organization_client_enablements oe");
  const block = b.slice(i, b.indexOf("organization_client_not_enabled"));
  assert(block.includes("oe.tenant_id = v_tenant_id"));
  assert(block.includes("oe.organization_id = _organization_id"));
  assert(block.includes("oe.api_client_id = _api_client_id"));
  assert(b.includes("v_org_parent_status IS DISTINCT FROM 'enabled'"));
});

Deno.test("enable requires an enabled Workspace parent scope re-verified against canonical scope", () => {
  const b = enableBlock(sql());
  const i = b.indexOf("api_workspace_client_enablements we");
  const block = b.slice(i, b.indexOf("workspace_client_not_enabled"));
  assert(block.includes("we.tenant_id = v_tenant_id"));
  assert(block.includes("we.organization_id = _organization_id"));
  assert(block.includes("we.workspace_id = _workspace_id"));
  assert(block.includes("we.api_client_id = _api_client_id"));
  assert(block.includes("w2.organization_id = _organization_id"));
  assert(b.includes("v_ws_parent_status IS DISTINCT FROM 'enabled'"));
});

Deno.test("enable requires an active non-archived Workspace", () => {
  const b = enableBlock(sql());
  assert(b.includes("w.is_active = true"));
  assert(b.includes("w.is_archived = false"));
  assert(b.includes("workspace_not_active"));
});

Deno.test("enable rejects an archived Project without inventing project is_active", () => {
  const s = sql();
  const b = enableBlock(s);
  assert(b.includes("COALESCE(p.is_archived, false) = false"));
  assert(b.includes("project_not_active"));
  assert(!/p\.is_active/i.test(s), "no invented Project is_active field");
  assert(!/p\.status/i.test(s), "Project usability must not derive from status");
});

Deno.test("Project enablement row is selected on all five scope keys with FOR UPDATE", () => {
  const s = sql();
  const i = s.indexOf("FROM public.api_project_client_enablements e");
  const block = s.slice(i, s.indexOf("FOR UPDATE") + 10);
  assert(block.includes("e.tenant_id = v_tenant_id"));
  assert(block.includes("e.organization_id = _organization_id"));
  assert(block.includes("e.workspace_id = _workspace_id"));
  assert(block.includes("e.project_id = _project_id"));
  assert(block.includes("e.api_client_id = _api_client_id"));
  assertEquals((s.match(/FOR UPDATE/g) ?? []).length, 1);
});

Deno.test("missing-row enable inserts exactly one enabled row", () => {
  const s = sql();
  const inserts = s.match(/INSERT INTO public\.api_project_client_enablements/g) ?? [];
  assertEquals(inserts.length, 1);
  const i = s.indexOf("INSERT INTO public.api_project_client_enablements");
  const block = s.slice(i, s.indexOf("RETURNING id INTO v_enablement_id", i));
  assert(block.includes("tenant_id, organization_id, workspace_id, project_id, api_client_id, lifecycle_status"));
  assert(block.includes("'enabled'"));
  assert(block.includes("now(), NULL, v_actor, v_actor"));
  assert(!/'disabled'/.test(block), "no disabled intermediate row");
});

Deno.test("disabled-to-enabled resets timestamps and records the actor", () => {
  const s = sql();
  const i = s.indexOf("ELSIF v_row.lifecycle_status = 'disabled' THEN");
  const block = s.slice(i, s.indexOf("v_action := 'enable_project_client'"));
  assert(block.includes("lifecycle_status = 'enabled'"));
  assert(block.includes("enabled_at = now()"));
  assert(block.includes("disabled_at = NULL"));
  assert(block.includes("updated_by = v_actor"));
  assert(block.includes("invalid_lifecycle_transition"));
});

Deno.test("enabled-to-disabled preserves enabled_at", () => {
  const s = sql();
  const i = s.indexOf("v_action := 'enable_project_client'");
  const block = s.slice(i, s.indexOf("v_action := 'disable_project_client'"));
  assert(block.includes("lifecycle_status = 'disabled'"));
  assert(block.includes("disabled_at = now()"));
  assert(block.includes("updated_by = v_actor"));
  assert(!/enabled_at\s*=/.test(block), "enabled_at must be preserved on disable");
});

Deno.test("missing-row and same-state disable transitions are rejected", () => {
  const s = sql();
  assert(
    s.includes("IF v_row.id IS NULL OR v_row.lifecycle_status IS DISTINCT FROM 'enabled' THEN"),
  );
  const rejections = s.match(/invalid_lifecycle_transition/g) ?? [];
  assert(rejections.length >= 2);
});

Deno.test("disable has no client or parent prerequisite beyond canonical containment", () => {
  const s = sql();
  for (
    const gated of [
      "client_not_active",
      "organization_client_not_enabled",
      "workspace_client_not_enabled",
      "workspace_not_active",
      "project_not_active",
    ]
  ) {
    const idx = s.indexOf(gated);
    assert(idx > 0);
    assert(
      idx < s.indexOf("SELECT * INTO v_row"),
      `${gated} must be confined to the enable-only branch`,
    );
  }
});

Deno.test("audit constraints retain Organization and Workspace values and add Project values", () => {
  const s = sql();
  for (
    const v of [
      "'organization_client_enablement'::text",
      "'workspace_client_enablement'::text",
      "'project_client_enablement'::text",
      "'enable_organization_client'::text",
      "'disable_organization_client'::text",
      "'enable_workspace_client'::text",
      "'disable_workspace_client'::text",
      "'enable_project_client'::text",
      "'disable_project_client'::text",
    ]
  ) {
    assert(s.includes(v), `missing accepted audit value: ${v}`);
  }
  const dropped = s.match(/DROP CONSTRAINT api_connected_apps_admin_audit_events_\w+/g) ?? [];
  assertEquals(dropped.length, 2, "only target_type and action constraints may be replaced");
  assert(s.includes("api_connected_apps_admin_audit_events_target_type_check"));
  assert(s.includes("api_connected_apps_admin_audit_events_action_check"));
});

Deno.test("exactly one audit insert exists with the required event values", () => {
  const s = sql();
  const inserts = s.match(/INSERT INTO public\.api_connected_apps_admin_audit_events/g) ?? [];
  assertEquals(inserts.length, 1);
  const i = s.indexOf("INSERT INTO public.api_connected_apps_admin_audit_events");
  const block = s.slice(i);
  assert(block.includes("gen_random_uuid(), v_actor, v_tenant_id, _organization_id, _api_client_id"));
  assert(block.includes("'project_client_enablement', v_enablement_id, v_action"));
  assert(block.includes("v_previous, _target_lifecycle_status, 'btpm_ui'"));
});

Deno.test("no parent enablement, grant or ordinary-access mutation exists", () => {
  const s = sql();
  for (
    const banned of [
      /UPDATE public\.api_organization_client_enablements/i,
      /INSERT INTO public\.api_organization_client_enablements/i,
      /UPDATE public\.api_workspace_client_enablements/i,
      /INSERT INTO public\.api_workspace_client_enablements/i,
      /UPDATE public\.api_capability_grants/i,
      /INSERT INTO public\.api_capability_grants/i,
      /UPDATE public\.api_clients/i,
      /api_client_policy_versions/i,
      /api_user_policy_acknowledgements/i,
      /UPDATE public\.projects/i,
      /UPDATE public\.workspaces/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden mutation present: ${banned}`);
  }
});

Deno.test("no delete, cascade, bulk behaviour or dynamic SQL exists", () => {
  const s = sql();
  for (
    const banned of [
      /\bDELETE\s+FROM\b/i,
      /\bTRUNCATE\b/i,
      /EXECUTE\s+format/i,
      /FOR\s+\w+\s+IN\s+SELECT/i,
      /LOOP/i,
      /\bCOMMIT\b/i,
      /\bROLLBACK\b/i,
      /ON CONFLICT/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden construct present: ${banned}`);
  }
});

Deno.test("no new table, column, policy, index or trigger surface exists", () => {
  const s = sql();
  for (
    const banned of [
      /CREATE\s+TABLE/i,
      /ADD\s+COLUMN/i,
      /DROP\s+COLUMN/i,
      /CREATE\s+POLICY/i,
      /DROP\s+POLICY/i,
      /CREATE\s+(UNIQUE\s+)?INDEX/i,
      /CREATE\s+TRIGGER/i,
      /CREATE\s+TYPE/i,
      /tenant_integrations/i,
      /oauth/i,
      /astra/i,
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

Deno.test("previously accepted functions and runtime helpers are not redefined", () => {
  const s = sql();
  const creates = s.match(/CREATE OR REPLACE FUNCTION\s+([a-zA-Z0-9_."]+)/gi) ?? [];
  assertEquals(creates.length, 1, "exactly one function definition allowed");
  assert((creates[0] ?? "").includes(FN));
  for (
    const banned of [
      "api_g_5_7_admin_list_organization_clients(",
      "api_g_5_7_admin_transition_organization_client(",
      "api_g_5_7_admin_list_organization_client_workspaces(",
      "api_g_5_7_admin_transition_workspace_client(",
      "api_g_5_7_admin_list_workspace_client_projects(",
      "authorize_project_scope",
      "api_g_5_3_enforce_project_enablement_scope_integrity",
      "btpm_decrypt(",
    ]
  ) {
    assert(!s.includes(banned), `accepted surface must not be redefined: ${banned}`);
  }
});
