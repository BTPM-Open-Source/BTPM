// API-G.5.7B-1 — Protected Organization Client Workspace Scope List.
// Repository-only static contract test. No runtime execution, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-G.5.7B-1";
const FN = "public.api_g_5_7_admin_list_organization_client_workspaces";

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
  assertEquals(paths.length, 1, "expected exactly one API-G.5.7B-1 migration");
  return Deno.readTextFileSync(paths[0]);
}

Deno.test("exactly one migration carries the API-G.5.7B-1 marker", () => {
  assertEquals(markerMigrations().length, 1);
});

Deno.test("exact RPC signature and typed return contract", () => {
  const s = sql();
  assert(
    new RegExp(
      `CREATE OR REPLACE FUNCTION\\s+${FN.replace(".", "\\.")}\\s*\\(\\s*_organization_id uuid\\s*,\\s*_api_client_id uuid\\s*,\\s*_include_archived boolean\\s*,\\s*_limit integer\\s*,\\s*_offset integer\\s*\\)`,
      "i",
    ).test(s),
    "exact argument list required",
  );
  for (
    const field of [
      "workspace_id uuid",
      "workspace_name text",
      "workspace_is_archived boolean",
      "workspace_enablement_id uuid",
      "workspace_enablement_status text",
      "workspace_enabled_at timestamptz",
      "workspace_disabled_at timestamptz",
      "enabled_project_count bigint",
      "enabled_capability_grant_count bigint",
      "total_count bigint",
    ]
  ) {
    assert(s.includes(field), `missing return field: ${field}`);
  }
});

Deno.test("function posture is plpgsql STABLE SECURITY DEFINER with fixed search_path", () => {
  const s = sql();
  assert(/LANGUAGE plpgsql/i.test(s));
  assert(/\bSTABLE\b/i.test(s));
  assert(!/\bVOLATILE\b/i.test(s));
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
      /\(_actor\b/i,
      /_user_id\s+uuid\s*,/i,
      /_role\b/i,
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

Deno.test("tenant is derived server-side from the Organization", () => {
  const s = sql();
  assert(
    /SELECT o\.tenant_id INTO v_tenant_id[\s\S]{0,120}FROM public\.organizations o[\s\S]{0,80}WHERE o\.id = _organization_id/i
      .test(s),
  );
});

Deno.test("authority uses exactly tenant-admin OR org-admin with accepted argument order", () => {
  const s = sql();
  assert(s.includes("public.is_tenant_admin(v_tenant_id, v_actor)"));
  assert(s.includes("public.is_org_admin(v_actor, _organization_id)"));
  assert(/not_authorized/.test(s));
  assert(/ERRCODE = '42501'/.test(s));
});

Deno.test("client relevance is contained to the exact Organization", () => {
  const s = sql();
  const idx = s.indexOf("v_client_relevant");
  assert(idx > 0);
  const block = s.slice(idx, s.indexOf("RETURN QUERY"));
  assert(block.includes("c.lifecycle_status = 'active'"));
  assert(block.includes("public.api_organization_client_enablements"));
  assert(block.includes("public.api_workspace_client_enablements"));
  assert(block.includes("public.api_project_client_enablements"));
  assert(block.includes("public.api_capability_grants"));
  const orgScoped = block.match(/organization_id = _organization_id/g) ?? [];
  assert(orgScoped.length >= 4, "each relevance probe must be Organization-scoped");
  const tenantScoped = block.match(/tenant_id = v_tenant_id/g) ?? [];
  assert(tenantScoped.length >= 4, "each relevance probe must be Tenant-scoped");
});

Deno.test("workspace rows are restricted to the exact Organization", () => {
  const s = sql();
  assert(
    /FROM public\.workspaces w\s*\n\s*WHERE w\.organization_id = _organization_id/i.test(s),
  );
});

Deno.test("archived retained-configuration behaviour is present", () => {
  const s = sql();
  assert(s.includes("_include_archived = true"));
  assert(/retained r WHERE r\.workspace_id = ow\.id/.test(s));
  assert(/ow\.is_archived = false/.test(s));
});

Deno.test("workspace name uses the established protected decryption helper", () => {
  const s = sql();
  assert(s.includes("public.btpm_decrypt(w.name, _organization_id)"));
  assert(!/name_plain|plaintext_name|CREATE OR REPLACE FUNCTION public\.btpm_decrypt/i.test(s));
});

Deno.test("workspace enablement join is scoped to workspace, organization, tenant and client", () => {
  const s = sql();
  const i = s.indexOf("ws_enable AS (");
  assert(i > 0);
  const block = s.slice(i, s.indexOf("proj_counts AS ("));
  assert(block.includes("public.api_workspace_client_enablements we"));
  assert(block.includes("w2.organization_id = _organization_id"));
  assert(block.includes("we.api_client_id = _api_client_id"));
  assert(block.includes("we.organization_id = _organization_id"));
  assert(block.includes("we.tenant_id = v_tenant_id"));
});

Deno.test("project count counts only enabled exact-scope project enablements", () => {
  const s = sql();
  const i = s.indexOf("proj_counts AS (");
  const block = s.slice(i, s.indexOf("grant_counts AS ("));
  assert(block.includes("pe.api_client_id = _api_client_id"));
  assert(block.includes("pe.organization_id = _organization_id"));
  assert(block.includes("pe.tenant_id = v_tenant_id"));
  assert(block.includes("pe.lifecycle_status = 'enabled'"));
  assert(block.includes("pj.organization_id = _organization_id"));
  assert(block.includes("pj.workspace_id = pe.workspace_id"));
});

Deno.test("capability-grant count counts only enabled workspace-level grants in scope", () => {
  const s = sql();
  const i = s.indexOf("grant_counts AS (");
  const block = s.slice(i, s.indexOf("retained AS ("));
  assert(block.includes("g.api_client_id = _api_client_id"));
  assert(block.includes("g.organization_id = _organization_id"));
  assert(block.includes("g.tenant_id = v_tenant_id"));
  assert(block.includes("g.workspace_id IS NOT NULL"));
  assert(block.includes("g.lifecycle_status = 'enabled'"));
  assert(block.includes("w4.organization_id = _organization_id"));
});

Deno.test("total_count is computed before pagination", () => {
  const s = sql();
  const totalIdx = s.indexOf("count(*) OVER ()::bigint AS total");
  const limitIdx = s.lastIndexOf("LIMIT _limit OFFSET _offset");
  assert(totalIdx > 0 && limitIdx > totalIdx);
  assert(!/INSERT INTO[\s\S]{0,80}total/i.test(s), "no stored total may be written");
});

Deno.test("pagination is bounded and ordering deterministic", () => {
  const s = sql();
  assert(s.includes("_limit < 1 OR _limit > 200"));
  assert(s.includes("_offset < 0"));
  assert(s.includes("invalid_limit"));
  assert(s.includes("invalid_offset"));
  assert(s.includes("ERRCODE = '22023'"));
  assert(/ORDER BY lower\(COALESCE\(c\.name, ''\)\) ASC, c\.id ASC/.test(s));
});

Deno.test("no mutation, audit insert, advisory lock or row lock exists", () => {
  const s = sql();
  for (
    const banned of [
      /\bINSERT\s+INTO\b/i,
      /\bUPDATE\s+public\./i,
      /\bDELETE\s+FROM\b/i,
      /\bUPSERT\b/i,
      /ON CONFLICT/i,
      /pg_advisory/i,
      /FOR UPDATE/i,
      /FOR SHARE/i,
      /api_connected_apps_admin_audit_events/i,
      /\bTRUNCATE\b/i,
      /EXECUTE\s+format/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden statement present: ${banned}`);
  }
});

Deno.test("no new table, policy, trigger, index, or unrelated surface", () => {
  const s = sql();
  for (
    const banned of [
      /CREATE\s+TABLE/i,
      /ALTER\s+TABLE/i,
      /CREATE\s+POLICY/i,
      /DROP\s+POLICY/i,
      /CREATE\s+(UNIQUE\s+)?INDEX/i,
      /CREATE\s+TRIGGER/i,
      /CREATE\s+TYPE/i,
      /tenant_integrations/i,
      /astra/i,
      /oauth/i,
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
});
