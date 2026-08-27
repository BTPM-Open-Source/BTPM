// API-G.5.7D-4 — Protected Workspace Capability Grant Enable/Disable Command.
// Repository-only static contract test. No runtime execution, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-G.5.7D-4";
const FN = "public.api_g_5_7_admin_transition_workspace_client_capability";

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
  assertEquals(paths.length, 1, "expected exactly one API-G.5.7D-4 migration");
  return Deno.readTextFileSync(paths[0]);
}

function body(): string {
  const s = sql();
  const i = s.indexOf("AS $function$");
  const j = s.lastIndexOf("$function$;");
  assert(i > 0 && j > i);
  return s.slice(i, j);
}

Deno.test("exactly one migration carries the API-G.5.7D-4 marker", () => {
  assertEquals(markerMigrations().length, 1);
});

Deno.test("exact RPC name, argument order and uuid return", () => {
  const s = sql();
  assert(
    new RegExp(
      `CREATE OR REPLACE FUNCTION\\s+${FN.replace(/\./g, "\\.")}\\s*\\(\\s*_organization_id uuid\\s*,\\s*_workspace_id uuid\\s*,\\s*_api_client_id uuid\\s*,\\s*_api_version text\\s*,\\s*_capability_key text\\s*,\\s*_target_lifecycle_status text\\s*\\)\\s*RETURNS uuid`,
      "i",
    ).test(s),
    "exact signature and uuid return required",
  );
});

Deno.test("caller does not supply capability_kind", () => {
  const s = sql();
  const sig = s.slice(s.indexOf("CREATE OR REPLACE FUNCTION"), s.indexOf("RETURNS uuid"));
  assert(!/[^a-z_]_capability_kind/i.test(sig), "capability_kind must not be an argument");
});

Deno.test("function posture is plpgsql VOLATILE SECURITY DEFINER with fixed search_path", () => {
  const s = sql();
  assert(/LANGUAGE plpgsql/i.test(s));
  assert(/\bVOLATILE\b/i.test(s));
  assert(!/\bSTABLE\b/i.test(s));
  assert(/SECURITY DEFINER/i.test(s));
  assert(/SET search_path = public, pg_catalog/i.test(s));
});

Deno.test("actor derives only from auth.uid() and must be an active user", () => {
  const s = sql();
  assert(s.includes("v_actor uuid := auth.uid()"));
  assert(s.includes("public.is_active_user(v_actor)"));
  for (
    const banned of [
      /request\.header/i,
      /_actor\s+uuid\s*,/i,
      /_user_id\s+uuid\s*,/i,
      /_role\b/i,
      /is_super_admin/i,
      /platform_super_admins/i,
      /is_workspace_admin/i,
      /is_workspace_member/i,
      /is_project_manager/i,
      /has_project_access/i,
      /organization_memberships/i,
      /workspace_memberships/i,
      /project_memberships/i,
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

Deno.test("inputs and target lifecycle are validated", () => {
  const s = sql();
  for (
    const arg of [
      "_organization_id IS NULL",
      "_workspace_id IS NULL",
      "_api_client_id IS NULL",
      "_api_version IS NULL",
      "_capability_key IS NULL",
      "btrim(_api_version) = ''",
      "btrim(_capability_key) = ''",
    ]
  ) {
    assert(s.includes(arg), `missing validation: ${arg}`);
  }
  assert(s.includes("invalid_arguments"));
  assert(s.includes("_target_lifecycle_status NOT IN ('enabled', 'disabled')"));
  assert(s.includes("invalid_target_lifecycle_status"));
  assert(/ERRCODE = '22023'/.test(s));
  assert(!/lower\(_capability_key\)|lower\(_api_version\)/i.test(s), "no case folding");
});

Deno.test("workspace containment is verified against the exact Organization", () => {
  const s = sql();
  assert(
    /FROM public\.workspaces w\s*\n\s*WHERE w\.id = _workspace_id\s*\n\s*AND w\.organization_id = _organization_id/i
      .test(s),
  );
  const idx = s.indexOf("WHERE w.id = _workspace_id");
  const after = s.slice(idx, idx + 400);
  assert(after.includes("not_authorized"), "foreign/missing workspace must be not_authorized");
});

Deno.test("exactly one accepted Organization/client advisory lock exists", () => {
  const s = sql();
  const locks = s.match(/pg_advisory_xact_lock\s*\(/g) ?? [];
  assertEquals(locks.length, 1);
  assert(!/pg_advisory_lock\s*\(/i.test(s));
  const lockIdx = s.indexOf("pg_advisory_xact_lock");
  const lockBlock = s.slice(lockIdx, s.indexOf(");", lockIdx) + 2);
  assert(lockBlock.includes("'api_g_5_7_organization_client_transition|'"));
  assert(lockBlock.includes("_organization_id::text"));
  assert(lockBlock.includes("_api_client_id::text"));
  const hashes = lockBlock.match(/hashtextextended\s*\(/g) ?? [];
  assertEquals(hashes.length, 1);
  assert(!/_workspace_id::text/.test(lockBlock), "no separate workspace lock key");
});

Deno.test("lock occurs after authority/containment and before enablement, capability and grant reads", () => {
  const s = sql();
  const lockIdx = s.indexOf("pg_advisory_xact_lock");
  assert(s.indexOf("public.is_tenant_admin(") < lockIdx);
  assert(s.indexOf("WHERE w.id = _workspace_id") < lockIdx);
  assert(s.indexOf("public.api_organization_client_enablements") > lockIdx);
  assert(s.indexOf("public.api_workspace_client_enablements") > lockIdx);
  assert(s.indexOf("public.api_client_supported_capabilities") > lockIdx);
  assert(s.indexOf("FROM public.api_capability_grants") > lockIdx);
  assert(s.indexOf("FOR UPDATE") > lockIdx);
});

Deno.test("enable requires an active API client", () => {
  const s = sql();
  assert(s.includes("FROM public.api_clients c"));
  assert(s.includes("v_client_status IS DISTINCT FROM 'active'"));
  assert(s.includes("client_not_active"));
});

Deno.test("enable requires enabled Organization/client and Workspace/client parents", () => {
  const s = sql();
  assert(s.includes("v_org_parent_status IS DISTINCT FROM 'enabled'"));
  assert(s.includes("organization_client_not_enabled"));
  assert(s.includes("v_ws_parent_status IS DISTINCT FROM 'enabled'"));
  assert(s.includes("workspace_client_not_enabled"));
  const i = s.indexOf("public.api_workspace_client_enablements we");
  const block = s.slice(i, i + 500);
  assert(block.includes("we.tenant_id = v_tenant_id"));
  assert(block.includes("we.organization_id = _organization_id"));
  assert(block.includes("we.workspace_id = _workspace_id"));
  assert(block.includes("we.api_client_id = _api_client_id"));
  assert(block.includes("w2.organization_id = _organization_id"));
});

Deno.test("enable requires an active, non-archived Workspace", () => {
  const s = sql();
  assert(s.includes("w.is_active = true"));
  assert(s.includes("w.is_archived = false"));
  assert(s.includes("workspace_not_active"));
});

Deno.test("capability resolution starts from the exact supported declaration and joins the catalogue on version, kind and key", () => {
  const s = sql();
  const i = s.indexOf("SELECT cat.capability_kind INTO v_capability_kind");
  assert(i > 0, "server-derived kind required");
  const block = s.slice(i, i + 700);
  assert(block.includes("FROM public.api_client_supported_capabilities s"));
  assert(block.includes("JOIN public.api_capability_catalogue cat"));
  assert(block.includes("cat.api_version = s.api_version"));
  assert(block.includes("cat.capability_kind = s.capability_kind"));
  assert(block.includes("cat.capability_key = s.capability_key"));
  assert(block.includes("s.api_client_id = _api_client_id"));
  assert(block.includes("s.api_version = _api_version"));
  assert(block.includes("s.capability_key = _capability_key"));
});

Deno.test("enable eligibility requires enabled support, active catalogue, assignability, workspace scope and read kind", () => {
  const s = sql();
  assert(s.includes("s.lifecycle_status = 'enabled'"));
  assert(s.includes("cat.lifecycle_status = 'active'"));
  assert(s.includes("cat.administrator_assignable = true"));
  assert(s.includes("cat.scope_level = 'workspace'"));
  assert(s.includes("cat.capability_kind = 'read'"));
  assert(s.includes("capability_not_available"));
  assert(!/scope_level = 'organization'/.test(s), "organization scope must not be enable-eligible");
  assert(!/scope_level = 'project'/.test(s), "project scope must not be enable-eligible");
  assert(!/capability_kind = 'command'/.test(s), "command kind must not be enable-eligible");
});

Deno.test("exact grant identity uses tenant, organization, workspace, client, version and key but never kind", () => {
  const s = sql();
  const i = s.indexOf("FROM public.api_capability_grants g");
  assert(i > 0);
  const block = s.slice(i, s.indexOf("FOR UPDATE", i) + 20);
  assert(block.includes("g.tenant_id = v_tenant_id"));
  assert(block.includes("g.organization_id = _organization_id"));
  assert(block.includes("g.workspace_id = _workspace_id"));
  assert(block.includes("g.api_client_id = _api_client_id"));
  assert(block.includes("g.api_version = _api_version"));
  assert(block.includes("g.capability_key = _capability_key"));
  assert(!/g\.capability_kind\s*=/.test(block), "kind must not be part of grant identity lookup");
  assert(block.includes("w3.organization_id = _organization_id"), "workspace containment re-verified");
  assert(/FOR UPDATE/.test(block), "existing grant row must be locked");
});

Deno.test("stored-kind mismatch fails closed", () => {
  const s = sql();
  assert(
    s.includes(
      "v_capability_kind IS NULL OR v_row.capability_kind IS DISTINCT FROM v_capability_kind",
    ),
  );
  assert(!/UPDATE public\.api_capability_grants[\s\S]{0,200}capability_kind\s*=/i.test(s),
    "stored kind must never be repaired");
});

Deno.test("missing-row enable inserts exactly one exact Workspace-level enabled grant", () => {
  const s = sql();
  const inserts = s.match(/INSERT INTO public\.api_capability_grants/g) ?? [];
  assertEquals(inserts.length, 1);
  const i = s.indexOf("INSERT INTO public.api_capability_grants");
  const block = s.slice(i, s.indexOf("RETURNING id INTO v_grant_id", i));
  assert(block.includes("v_tenant_id, _organization_id, _workspace_id, _api_client_id"));
  assert(block.includes("_api_version, v_capability_kind, _capability_key"));
  assert(block.includes("'enabled', NULL, now(), NULL, v_actor, v_actor"));
  assert(!/'disabled'\s*,\s*NULL\s*,\s*now\(\)/.test(block), "no disabled intermediate row");
});

Deno.test("disabled-to-enabled resets lifecycle timestamps and preserves reason", () => {
  const s = sql();
  const i = s.indexOf("v_row.lifecycle_status = 'disabled'");
  assert(i > 0);
  const block = s.slice(i, i + 500);
  assert(block.includes("lifecycle_status = 'enabled'"));
  assert(block.includes("enabled_at = now()"));
  assert(block.includes("disabled_at = NULL"));
  assert(block.includes("updated_by = v_actor"));
  assert(!/reason\s*=/.test(block), "reason must be preserved");
});

Deno.test("already-enabled exact Workspace grant is rejected and inherited Organization grant never blocks enable", () => {
  const s = sql();
  assert(s.includes("invalid_lifecycle_transition"));
  const b = body();
  assert(
    !/[^_]workspace_id IS NULL/.test(b),
    "no organization-scope grant read may gate the workspace enable path",
  );
});

Deno.test("enabled-to-disabled preserves enabled_at and reason", () => {
  const s = sql();
  const i = s.indexOf("v_action := 'disable_workspace_capability'");
  assert(i > 0);
  const block = s.slice(s.lastIndexOf("UPDATE public.api_capability_grants g", i), i);
  assert(block.includes("lifecycle_status = 'disabled'"));
  assert(block.includes("disabled_at = now()"));
  assert(block.includes("updated_by = v_actor"));
  assert(!/enabled_at\s*=/.test(block), "enabled_at must be preserved");
  assert(!/reason\s*=/.test(block), "reason must be preserved");
});

Deno.test("missing-row and already-disabled disable transitions are rejected", () => {
  const s = sql();
  assert(
    s.includes("v_row.id IS NULL OR v_row.lifecycle_status IS DISTINCT FROM 'enabled'"),
  );
});

Deno.test("disable has no client, parent, workspace-state or capability-eligibility prerequisite", () => {
  const b = body();
  const gates = [
    "client_not_active",
    "organization_client_not_enabled",
    "workspace_client_not_enabled",
    "workspace_not_active",
  ];
  const enableBranchStart = b.indexOf("IF _target_lifecycle_status = 'enabled' THEN");
  assert(enableBranchStart > 0);
  const disableBranch = b.slice(b.lastIndexOf("ELSE"));
  for (const g of gates) {
    assert(!disableBranch.includes(g), `disable must not gate on ${g}`);
  }
  assert(!disableBranch.includes("cat.scope_level"));
});

Deno.test("no organization-grant mutation or deny-override model is introduced", () => {
  const s = sql();
  const updates = s.match(/UPDATE public\.api_capability_grants/g) ?? [];
  assertEquals(updates.length, 2, "only the exact workspace grant is updated");
  for (
    const banned of [
      /[^_]workspace_id IS NULL/i,
      /is_denied/i,
      /deny_/i,
      /_override/i,
      /effective_grant/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden inheritance surface: ${banned}`);
  }
});

Deno.test("audit constraints preserve all accepted values and add workspace capability values", () => {
  const s = sql();
  for (
    const v of [
      "organization_client_enablement",
      "workspace_client_enablement",
      "project_client_enablement",
      "organization_capability_grant",
      "workspace_capability_grant",
    ]
  ) {
    assert(s.includes(`'${v}'::text`), `missing target_type: ${v}`);
  }
  for (
    const a of [
      "enable_organization_client",
      "disable_organization_client",
      "enable_workspace_client",
      "disable_workspace_client",
      "enable_project_client",
      "disable_project_client",
      "enable_organization_capability",
      "disable_organization_capability",
      "enable_workspace_capability",
      "disable_workspace_capability",
    ]
  ) {
    assert(s.includes(`'${a}'::text`), `missing action: ${a}`);
  }
});

Deno.test("exactly one audit insert occurs with the accepted values", () => {
  const s = sql();
  const inserts = s.match(/INSERT INTO public\.api_connected_apps_admin_audit_events/g) ?? [];
  assertEquals(inserts.length, 1);
  const i = s.indexOf("INSERT INTO public.api_connected_apps_admin_audit_events");
  const block = s.slice(i, s.indexOf("RETURN v_grant_id", i));
  assert(block.includes("gen_random_uuid(), v_actor, v_tenant_id, _organization_id, _api_client_id"));
  assert(block.includes("'workspace_capability_grant', v_grant_id, v_action"));
  assert(block.includes("v_previous, _target_lifecycle_status, 'btpm_ui'"));
  assert(s.includes("v_previous := NULL"), "missing previous state representation for insert path");
});

Deno.test("no catalogue, supported-capability, parent-enablement or project mutation exists", () => {
  const s = sql();
  for (
    const banned of [
      /UPDATE public\.api_capability_catalogue/i,
      /INSERT INTO public\.api_capability_catalogue/i,
      /UPDATE public\.api_client_supported_capabilities/i,
      /INSERT INTO public\.api_client_supported_capabilities/i,
      /UPDATE public\.api_organization_client_enablements/i,
      /INSERT INTO public\.api_organization_client_enablements/i,
      /UPDATE public\.api_workspace_client_enablements/i,
      /INSERT INTO public\.api_workspace_client_enablements/i,
      /api_project_client_enablements/i,
      /UPDATE public\.api_clients/i,
      /api_client_policy_versions/i,
      /api_user_policy_acknowledgements/i,
      /\bDELETE\s+FROM\b/i,
      /\bTRUNCATE\b/i,
      /CASCADE/i,
      /EXECUTE\s+format/i,
      /\bCOMMIT\b/i,
      /\bROLLBACK\b/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden mutation present: ${banned}`);
  }
});

Deno.test("no new table, column, index, view, policy, trigger or unrelated surface", () => {
  const s = sql();
  for (
    const banned of [
      /CREATE\s+TABLE/i,
      /ADD\s+COLUMN/i,
      /DROP\s+COLUMN/i,
      /CREATE\s+(UNIQUE\s+)?INDEX/i,
      /DROP\s+INDEX/i,
      /CREATE\s+VIEW/i,
      /CREATE\s+MATERIALIZED\s+VIEW/i,
      /CREATE\s+POLICY/i,
      /DROP\s+POLICY/i,
      /CREATE\s+TRIGGER/i,
      /DROP\s+TRIGGER/i,
      /CREATE\s+TYPE/i,
      /ENABLE ROW LEVEL SECURITY/i,
      /tenant_integrations/i,
      /astra/i,
      /oauth/i,
      /api_e_private/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden surface present: ${banned}`);
  }
  const alters = s.match(/ALTER TABLE public\.[a-z_]+/gi) ?? [];
  assert(
    alters.every((a) => a.includes("api_connected_apps_admin_audit_events")),
    "only the audit constraint table may be altered",
  );
});

Deno.test("execution denied to PUBLIC and anon, granted to authenticated, no table privileges", () => {
  const s = sql();
  assert(/REVOKE ALL ON FUNCTION[\s\S]{0,220}FROM PUBLIC/i.test(s));
  assert(/REVOKE ALL ON FUNCTION[\s\S]{0,220}FROM anon/i.test(s));
  assert(/GRANT EXECUTE ON FUNCTION[\s\S]{0,220}TO authenticated/i.test(s));
  assert(!/^\s*GRANT\s+(?!EXECUTE)/im.test(s), "only EXECUTE grants may appear");
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
      "api_g_5_7_admin_list_workspace_client_capabilities(",
      "api_g_5_7_admin_transition_organization_client_capability(",
      "authorize_and_establish",
      "api_c_enforce_capability_grant_scope_integrity",
      "api_g_5_2_enforce_grant_capability_lifecycle",
    ]
  ) {
    assert(!s.includes(banned), `must not redefine: ${banned}`);
  }
});
