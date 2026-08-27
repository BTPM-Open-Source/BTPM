// API-G.5.7C-1 — Protected Workspace Client Project Scope List.
// Repository-only static contract test. No runtime execution, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-G.5.7C-1";
const FN = "public.api_g_5_7_admin_list_workspace_client_projects";

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
  assertEquals(paths.length, 1, "expected exactly one API-G.5.7C-1 migration");
  return Deno.readTextFileSync(paths[0]);
}

Deno.test("exactly one migration carries the API-G.5.7C-1 marker", () => {
  assertEquals(markerMigrations().length, 1);
});

Deno.test("exact RPC signature and typed return contract", () => {
  const s = sql();
  assert(
    new RegExp(
      `CREATE OR REPLACE FUNCTION\\s+${FN.replace(".", "\\.")}\\s*\\(\\s*_organization_id uuid\\s*,\\s*_workspace_id uuid\\s*,\\s*_api_client_id uuid\\s*,\\s*_include_archived boolean\\s*,\\s*_limit integer\\s*,\\s*_offset integer\\s*\\)`,
      "i",
    ).test(s),
    "exact argument list required",
  );
  for (
    const field of [
      "project_id uuid",
      "project_name text",
      "project_is_archived boolean",
      "project_enablement_id uuid",
      "project_enablement_status text",
      "project_enabled_at timestamptz",
      "project_disabled_at timestamptz",
      "total_count bigint",
    ]
  ) {
    assert(s.includes(field), `missing return field: ${field}`);
  }
  for (
    const banned of [
      /program_id/i,
      /portfolio/i,
      /phase_/i,
      /task_/i,
      /budget/i,
      /owner_/i,
      /project_description/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden extra Project field: ${banned}`);
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
      /has_project_access/i,
      /project_memberships/i,
      /workspace_memberships/i,
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

Deno.test("workspace containment requires exact Workspace inside exact Organization", () => {
  const s = sql();
  const i = s.indexOf("v_ws_ok");
  assert(i > 0);
  const block = s.slice(i, s.indexOf("v_client_relevant", i));
  assert(block.includes("FROM public.workspaces w"));
  assert(block.includes("w.id = _workspace_id"));
  assert(block.includes("w.organization_id = _organization_id"));
  assert(
    /IF NOT v_ws_ok THEN[\s\S]{0,120}not_authorized[\s\S]{0,80}42501/.test(s),
    "missing or foreign Workspace must use the non-enumerating failure",
  );
  assert(!/w\.is_archived\s*=\s*false[\s\S]{0,40}w\.id = _workspace_id/i.test(block));
});

Deno.test("null identifiers preserve the non-enumerating posture", () => {
  const s = sql();
  assert(
    /_organization_id IS NULL OR _workspace_id IS NULL OR _api_client_id IS NULL[\s\S]{0,120}not_authorized/
      .test(s),
  );
});

Deno.test("client relevance is contained to the exact Organization", () => {
  const s = sql();
  const idx = s.indexOf("v_client_relevant :=") > 0
    ? s.indexOf("v_client_relevant :=")
    : s.indexOf("SELECT EXISTS (\n    SELECT 1 FROM public.api_clients c");
  const start = s.indexOf("public.api_clients c");
  assert(start > 0);
  const block = s.slice(start, s.indexOf("RETURN QUERY"));
  assert(idx !== 0);
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

Deno.test("project rows are restricted to the exact Organization and Workspace", () => {
  const s = sql();
  const i = s.indexOf("ws_projects AS (");
  assert(i > 0);
  const block = s.slice(i, s.indexOf("proj_enable AS ("));
  assert(block.includes("FROM public.projects p"));
  assert(block.includes("p.workspace_id = _workspace_id"));
  assert(block.includes("p.organization_id = _organization_id"));
  assert(block.includes("w.organization_id = _organization_id"));
  assert(block.includes("COALESCE(p.is_archived, false)"));
});

Deno.test("project name uses the established protected decryption helper", () => {
  const s = sql();
  assert(s.includes("public.btpm_decrypt(p.name, _organization_id)"));
  assert(!/name_plain|plaintext_name|CREATE OR REPLACE FUNCTION public\.btpm_decrypt/i.test(s));
});

Deno.test("archive eligibility honours request flag or the Project's own retained enablement", () => {
  const s = sql();
  const i = s.indexOf("eligible AS (");
  const block = s.slice(i, s.indexOf("counted AS ("));
  assert(block.includes("wp.is_archived = false"));
  assert(block.includes("_include_archived = true"));
  assert(block.includes("pe.id IS NOT NULL"));
  assert(!/api_capability_grants/i.test(block), "grants must not retain archived Projects");
  assert(
    !/api_workspace_client_enablements|api_organization_client_enablements/i.test(block),
    "parent enablement must not retain archived Projects",
  );
});

Deno.test("project enablement is matched on tenant, org, workspace, project and client", () => {
  const s = sql();
  const i = s.indexOf("proj_enable AS (");
  const block = s.slice(i, s.indexOf("eligible AS ("));
  assert(block.includes("pe.api_client_id = _api_client_id"));
  assert(block.includes("pe.tenant_id = v_tenant_id"));
  assert(block.includes("pe.organization_id = _organization_id"));
  assert(block.includes("pe.workspace_id = _workspace_id"));
  // canonical Project re-verification of stored parent scope
  assert(block.includes("pj.id = pe.project_id"));
  assert(block.includes("pj.workspace_id = pe.workspace_id"));
  assert(block.includes("pj.organization_id = pe.organization_id"));
  assert(/LEFT JOIN proj_enable pe ON pe\.project_id = wp\.id/.test(s));
  assert(!/'disabled'::text AS/i.test(s), "no synthesized disabled row");
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
  assert(s.includes("_include_archived IS NULL"));
  assert(s.includes("invalid_include_archived"));
  assert(s.includes("_limit < 1 OR _limit > 200"));
  assert(s.includes("_offset < 0 OR _offset > 10000"));
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

Deno.test("no new table, view, policy, trigger, index, frontend or Edge Function surface", () => {
  const s = sql();
  for (
    const banned of [
      /CREATE\s+TABLE/i,
      /ALTER\s+TABLE/i,
      /CREATE\s+POLICY/i,
      /DROP\s+POLICY/i,
      /CREATE\s+(OR REPLACE\s+)?(MATERIALIZED\s+)?VIEW/i,
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
  assert(!/\bGRANT\s+(?!EXECUTE)/.test(s), "only EXECUTE grants may appear");
});

Deno.test("execution denied to PUBLIC and anon, granted to authenticated", () => {
  const s = sql();
  assert(/REVOKE ALL ON FUNCTION[\s\S]{0,200}FROM PUBLIC/i.test(s));
  assert(/REVOKE ALL ON FUNCTION[\s\S]{0,200}FROM anon/i.test(s));
  assert(/GRANT EXECUTE ON FUNCTION[\s\S]{0,200}TO authenticated/i.test(s));
});

Deno.test("previously accepted API-G.5.7 and Project runtime helpers are not redefined", () => {
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
      "api_g_5_3_enforce_project_enablement_scope_integrity",
      "authorize_project_scope",
    ]
  ) {
    assert(!s.includes(banned), `must not redefine: ${banned}`);
  }
});
