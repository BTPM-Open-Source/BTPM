// API-G.5.7D-3 — Protected Workspace Client Capability Grant List.
// Repository-only static contract test. No runtime execution, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-G.5.7D-3";
const FN = "public.api_g_5_7_admin_list_workspace_client_capabilities";

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
  assertEquals(paths.length, 1, "expected exactly one API-G.5.7D-3 migration");
  return Deno.readTextFileSync(paths[0]);
}

function block(s: string, startNeedle: string, endNeedle: string): string {
  const i = s.indexOf(startNeedle);
  assert(i > 0, `missing block start: ${startNeedle}`);
  const j = s.indexOf(endNeedle, i);
  assert(j > i, `missing block end: ${endNeedle}`);
  return s.slice(i, j);
}

Deno.test("exactly one migration carries the API-G.5.7D-3 marker", () => {
  assertEquals(markerMigrations().length, 1);
});

Deno.test("exact RPC argument order and typed return contract", () => {
  const s = sql();
  assert(
    new RegExp(
      `CREATE OR REPLACE FUNCTION\\s+${
        FN.replace(".", "\\.")
      }\\s*\\(\\s*_organization_id uuid\\s*,\\s*_workspace_id uuid\\s*,\\s*_api_client_id uuid\\s*,\\s*_limit integer\\s*,\\s*_offset integer\\s*\\)`,
      "i",
    ).test(s),
    "exact argument list required",
  );
  for (
    const field of [
      "api_version text",
      "capability_kind text",
      "capability_key text",
      "display_name text",
      "description text",
      "scope_level text",
      "catalogue_lifecycle_status text",
      "administrator_assignable boolean",
      "supported_capability_id uuid",
      "supported_capability_status text",
      "organization_grant_id uuid",
      "organization_grant_status text",
      "organization_grant_enabled_at timestamptz",
      "organization_grant_disabled_at timestamptz",
      "workspace_grant_id uuid",
      "workspace_grant_status text",
      "workspace_grant_enabled_at timestamptz",
      "workspace_grant_disabled_at timestamptz",
      "effective_grant_status text",
      "effective_grant_source text",
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

Deno.test("authority is exactly tenant-admin OR org-admin with accepted argument order", () => {
  const s = sql();
  assert(s.includes("public.is_tenant_admin(v_tenant_id, v_actor)"));
  assert(s.includes("public.is_org_admin(v_actor, _organization_id)"));
  assert(/not_authorized/.test(s));
  assert(/ERRCODE = '42501'/.test(s));
});

Deno.test("workspace containment is verified against the exact Organization", () => {
  const s = sql();
  const b = block(s, "v_workspace_ok", "Client relevance");
  assert(b.includes("FROM public.workspaces w"));
  assert(b.includes("w.id = _workspace_id"));
  assert(b.includes("w.organization_id = _organization_id"));
  assert(/IF NOT v_workspace_ok THEN[\s\S]{0,120}not_authorized/.test(s));
});

Deno.test("null inputs collapse to the non-enumerating failure", () => {
  const s = sql();
  assert(
    s.includes(
      "IF _organization_id IS NULL OR _workspace_id IS NULL OR _api_client_id IS NULL THEN",
    ),
  );
});

Deno.test("limit and offset are bounded", () => {
  const s = sql();
  assert(s.includes("_limit < 1 OR _limit > 200"));
  assert(s.includes("_offset < 0 OR _offset > 10000"));
  assert(s.includes("invalid_limit"));
  assert(s.includes("invalid_offset"));
  assert(s.includes("ERRCODE = '22023'"));
});

Deno.test("client relevance is active client or exact-Organization retained configuration", () => {
  const s = sql();
  const b = block(s, "v_client_relevant;", "RETURN QUERY");
  const rel = block(s, "SELECT EXISTS (\n    SELECT 1 FROM public.api_clients c", "INTO v_client_relevant");
  assert(rel.includes("c.lifecycle_status = 'active'"));
  assert(rel.includes("public.api_organization_client_enablements"));
  assert(rel.includes("public.api_workspace_client_enablements"));
  assert(rel.includes("public.api_project_client_enablements"));
  assert(rel.includes("public.api_capability_grants"));
  const orgScoped = rel.match(/organization_id = _organization_id/g) ?? [];
  assert(orgScoped.length >= 6, "each relevance probe must be Organization-scoped");
  const tenantScoped = rel.match(/tenant_id = v_tenant_id/g) ?? [];
  assert(tenantScoped.length >= 4, "each relevance probe must be Tenant-scoped");
  // Workspace and Project retained probes re-verify canonical parents.
  assert(rel.includes("w2.organization_id = _organization_id"));
  assert(rel.includes("pj.organization_id = _organization_id"));
  assert(b.includes("not_authorized"));
});

Deno.test("rows start from exact client-supported declarations", () => {
  const s = sql();
  const b = block(s, "WITH supported AS (", "joined AS (");
  assert(b.includes("public.api_client_supported_capabilities s"));
  assert(b.includes("s.api_client_id = _api_client_id"));
});

Deno.test("catalogue join uses version, kind and key", () => {
  const s = sql();
  const b = block(s, "joined AS (", "projected AS (");
  assert(b.includes("public.api_capability_catalogue cat"));
  assert(b.includes("cat.api_version = sup.api_version"));
  assert(b.includes("cat.capability_kind = sup.capability_kind"));
  assert(b.includes("cat.capability_key = sup.capability_key"));
});

Deno.test("normally available rows require enabled support, active catalogue, assignability, workspace scope and read kind", () => {
  const s = sql();
  const b = block(s, "eligible AS (", "effective AS (");
  assert(b.includes("p.supported_capability_status = 'enabled'"));
  assert(b.includes("p.catalogue_lifecycle_status = 'active'"));
  assert(b.includes("p.administrator_assignable = true"));
  assert(b.includes("p.scope_level = 'workspace'"));
  assert(b.includes("p.capability_kind = 'read'"));
  assert(!/scope_level = 'organization'/.test(b));
  assert(!/scope_level = 'project'/.test(b));
  assert(!/capability_kind = 'command'/.test(b));
});

Deno.test("exact Organization grant join requires tenant, org, null workspace, client, version, kind, key", () => {
  const s = sql();
  const b = block(s, "LEFT JOIN public.api_capability_grants og", "LEFT JOIN (");
  assert(b.includes("og.tenant_id = v_tenant_id"));
  assert(b.includes("og.organization_id = _organization_id"));
  assert(b.includes("og.workspace_id IS NULL"));
  assert(b.includes("og.api_client_id = _api_client_id"));
  assert(b.includes("og.api_version = j.api_version"));
  assert(b.includes("og.capability_kind = j.capability_kind"));
  assert(b.includes("og.capability_key = j.capability_key"));
});

Deno.test("exact Workspace grant join requires tenant, org, workspace, client, version, kind, key with parent re-verification", () => {
  const s = sql();
  const b = block(s, "FROM public.api_capability_grants g2", "eligible AS (");
  assert(b.includes("w3.id = g2.workspace_id"));
  assert(b.includes("w3.organization_id = _organization_id"));
  assert(b.includes("g2.tenant_id = v_tenant_id"));
  assert(b.includes("g2.organization_id = _organization_id"));
  assert(b.includes("g2.workspace_id = _workspace_id"));
  assert(b.includes("g2.api_client_id = _api_client_id"));
  assert(b.includes("wg.api_version = j.api_version"));
  assert(b.includes("wg.capability_kind = j.capability_kind"));
  assert(b.includes("wg.capability_key = j.capability_key"));
});

Deno.test("retained exact Organization or Workspace grants remain visible", () => {
  const s = sql();
  const b = block(s, "eligible AS (", "effective AS (");
  assert(b.includes("p.workspace_grant_id IS NOT NULL"));
  assert(b.includes("p.organization_grant_id IS NOT NULL"));
});

Deno.test("missing grants remain NULL; no disabled row is synthesized", () => {
  const s = sql();
  assert(/LEFT JOIN/i.test(s));
  assert(!/COALESCE\(\s*(og|wg)\.lifecycle_status/i.test(s));
  assert(!/'disabled'\s*AS\s*(organization|workspace)_grant_status/i.test(s));
});

Deno.test("effective status uses additive workspace-OR-organization semantics", () => {
  const s = sql();
  const b = block(s, "effective AS (", "counted AS (");
  assert(b.includes("WHEN e.workspace_grant_status = 'enabled'"));
  assert(b.includes("OR e.organization_grant_status = 'enabled' THEN 'enabled'"));
  assert(b.includes("THEN 'disabled'"));
  assert(b.includes("ELSE NULL"));
});

Deno.test("exact Workspace enablement takes source precedence, Organization inheritance remains effective", () => {
  const s = sql();
  const b = block(s, "AS effective_grant_status", "AS effective_grant_source");
  const wsIdx = b.indexOf("WHEN e.workspace_grant_status = 'enabled' THEN 'workspace'");
  const orgIdx = b.indexOf("WHEN e.organization_grant_status = 'enabled' THEN 'organization'");
  assert(wsIdx > 0 && orgIdx > wsIdx, "workspace source must be evaluated first");
  assert(b.includes("ELSE 'none'"));
});

Deno.test("no deny-override model is introduced", () => {
  const s = sql();
  for (
    const banned of [
      /workspace_override/i,
      /inherited_disabled/i,
      /'deny'/i,
      /'blocked'/i,
      /revoked_override/i,
    ]
  ) {
    assert(!banned.test(s), `forbidden override model: ${banned}`);
  }
  // A disabled workspace grant must not gate the organization branch.
  assert(!/workspace_grant_status\s*=\s*'disabled'\s*THEN\s*'disabled'/i.test(s));
});

Deno.test("total_count is computed before pagination", () => {
  const s = sql();
  const totalIdx = s.indexOf("count(*) OVER ()::bigint AS total");
  const limitIdx = s.lastIndexOf("LIMIT _limit OFFSET _offset");
  assert(totalIdx > 0 && limitIdx > totalIdx);
  assert(!/INSERT INTO[\s\S]{0,80}total/i.test(s), "no stored total may be written");
});

Deno.test("ordering is deterministic", () => {
  const s = sql();
  assert(
    /ORDER BY c\.api_version ASC,\s*\n\s*c\.capability_kind ASC,\s*\n\s*lower\(COALESCE\(c\.display_name, ''\)\) ASC,\s*\n\s*c\.capability_key ASC/
      .test(s),
  );
});

Deno.test("no write, audit insert, advisory lock or row lock exists", () => {
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

Deno.test("no new table, view, column, index, policy, trigger or unrelated surface", () => {
  const s = sql();
  for (
    const banned of [
      /CREATE\s+TABLE/i,
      /ALTER\s+TABLE/i,
      /CREATE\s+(OR REPLACE\s+)?(MATERIALIZED\s+)?VIEW/i,
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
  assert(!/^\s*GRANT\s+(?!EXECUTE)/im.test(s), "only EXECUTE grants may appear");
});

Deno.test("execution denied to PUBLIC and anon, granted to authenticated", () => {
  const s = sql();
  assert(/REVOKE ALL ON FUNCTION[\s\S]{0,200}FROM PUBLIC/i.test(s));
  assert(/REVOKE ALL ON FUNCTION[\s\S]{0,200}FROM anon/i.test(s));
  assert(/GRANT EXECUTE ON FUNCTION[\s\S]{0,200}TO authenticated/i.test(s));
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
      "api_g_5_7_admin_list_organization_client_workspaces(",
      "api_g_5_7_admin_transition_workspace_client(",
      "api_g_5_7_admin_list_workspace_client_projects(",
      "api_g_5_7_admin_transition_project_client(",
      "api_g_5_7_admin_list_organization_client_capabilities(",
      "api_g_5_7_admin_transition_organization_client_capability(",
      "authorize_and_establish",
      "api_c_enforce_capability_grant_scope_integrity",
      "api_g_5_2_enforce_grant_capability_lifecycle",
    ]
  ) {
    assert(!s.includes(banned), `must not redefine: ${banned}`);
  }
});
