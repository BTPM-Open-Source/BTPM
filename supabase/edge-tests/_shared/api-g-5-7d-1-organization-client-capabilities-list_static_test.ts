// API-G.5.7D-1 — Protected Organization Client Capability Grant List.
// Repository-only static contract test. No runtime execution, no network.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-G.5.7D-1";
const FN = "public.api_g_5_7_admin_list_organization_client_capabilities";

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
  assertEquals(paths.length, 1, "expected exactly one API-G.5.7D-1 migration");
  return Deno.readTextFileSync(paths[0]);
}

Deno.test("exactly one migration carries the API-G.5.7D-1 marker", () => {
  assertEquals(markerMigrations().length, 1);
});

Deno.test("exact RPC signature and typed return contract", () => {
  const s = sql();
  assert(
    new RegExp(
      `CREATE OR REPLACE FUNCTION\\s+${FN.replace(/\./g, "\\.")}\\s*\\(\\s*_organization_id uuid\\s*,\\s*_api_client_id uuid\\s*,\\s*_limit integer\\s*,\\s*_offset integer\\s*\\)`,
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
      "grant_id uuid",
      "grant_status text",
      "grant_enabled_at timestamptz",
      "grant_disabled_at timestamptz",
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

Deno.test("null identifiers use the non-enumerating failure", () => {
  const s = sql();
  assert(
    /_organization_id IS NULL OR _api_client_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'/
      .test(s),
  );
});

Deno.test("pagination is bounded", () => {
  const s = sql();
  assert(s.includes("_limit < 1 OR _limit > 200"));
  assert(s.includes("_offset < 0 OR _offset > 10000"));
  assert(s.includes("invalid_limit"));
  assert(s.includes("invalid_offset"));
  assert(s.includes("ERRCODE = '22023'"));
});

Deno.test("client relevance is active client or retained exact-Organization configuration", () => {
  const s = sql();
  const idx = s.indexOf("v_client_relevant boolean");
  assert(idx > 0);
  const block = s.slice(s.indexOf("SELECT EXISTS ("), s.indexOf("RETURN QUERY"));
  assert(block.includes("c.lifecycle_status = 'active'"));
  assert(block.includes("public.api_organization_client_enablements"));
  assert(block.includes("public.api_workspace_client_enablements"));
  assert(block.includes("public.api_project_client_enablements"));
  assert(block.includes("public.api_capability_grants"));
  const orgScoped = block.match(/organization_id = _organization_id/g) ?? [];
  assert(orgScoped.length >= 4, "each relevance probe must be Organization-scoped");
  const tenantScoped = block.match(/tenant_id = v_tenant_id/g) ?? [];
  assert(tenantScoped.length >= 4, "each relevance probe must be Tenant-scoped");
  assert(block.includes("w2.organization_id = _organization_id"));
  assert(block.includes("pj.organization_id = _organization_id"));
});

Deno.test("rows start from exact client-supported declarations joined to the catalogue identity", () => {
  const s = sql();
  const i = s.indexOf("supported AS (");
  assert(i > 0);
  const sup = s.slice(i, s.indexOf("joined AS ("));
  assert(sup.includes("public.api_client_supported_capabilities s"));
  assert(sup.includes("s.api_client_id = _api_client_id"));

  const j = s.slice(s.indexOf("joined AS ("), s.indexOf("projected AS ("));
  assert(j.includes("public.api_capability_catalogue cat"));
  assert(j.includes("cat.api_version = sup.api_version"));
  assert(j.includes("cat.capability_kind = sup.capability_kind"));
  assert(j.includes("cat.capability_key = sup.capability_key"));
});

Deno.test("normal availability requires enabled support, active catalogue, assignable, organization scope and read kind", () => {
  const s = sql();
  const e = s.slice(s.indexOf("eligible AS ("), s.indexOf("counted AS ("));
  assert(e.includes("p.supported_capability_status = 'enabled'"));
  assert(e.includes("p.catalogue_lifecycle_status = 'active'"));
  assert(e.includes("p.administrator_assignable = true"));
  assert(e.includes("p.scope_level = 'organization'"));
  assert(e.includes("p.capability_kind = 'read'"));
});

Deno.test("retained exact Organization grant remains visible despite normal unavailability", () => {
  const s = sql();
  const e = s.slice(s.indexOf("eligible AS ("), s.indexOf("counted AS ("));
  assert(/OR p\.grant_id IS NOT NULL/.test(e));
});

Deno.test("exact Organization grant join is fully contained and excludes Workspace grants", () => {
  const s = sql();
  const p = s.slice(s.indexOf("projected AS ("), s.indexOf("eligible AS ("));
  assert(p.includes("LEFT JOIN public.api_capability_grants eg"));
  assert(p.includes("eg.tenant_id = v_tenant_id"));
  assert(p.includes("eg.organization_id = _organization_id"));
  assert(p.includes("eg.workspace_id IS NULL"));
  assert(p.includes("eg.api_client_id = _api_client_id"));
  assert(p.includes("eg.api_version = j.api_version"));
  assert(p.includes("eg.capability_kind = j.capability_kind"));
  assert(p.includes("eg.capability_key = j.capability_key"));
  assert(!/eg\.workspace_id IS NOT NULL/.test(s));
});

Deno.test("missing grants stay NULL; no synthesized disabled grant row", () => {
  const s = sql();
  assert(!/COALESCE\(\s*eg\.lifecycle_status\s*,\s*'disabled'/i.test(s));
  assert(!/'disabled'::text AS grant_status/i.test(s));
  assert(s.includes("eg.lifecycle_status AS grant_status"));
});

Deno.test("total_count is computed before pagination", () => {
  const s = sql();
  const totalIdx = s.indexOf("count(*) OVER ()::bigint AS total");
  const limitIdx = s.lastIndexOf("LIMIT _limit OFFSET _offset");
  assert(totalIdx > 0 && limitIdx > totalIdx);
  assert(!/INSERT INTO[\s\S]{0,80}total/i.test(s), "no stored total may be written");
});

Deno.test("ordering is deterministic and null-safe", () => {
  const s = sql();
  assert(
    /ORDER BY c\.api_version ASC,\s*\n\s*c\.capability_kind ASC,\s*\n\s*lower\(COALESCE\(c\.display_name, ''\)\) ASC,\s*\n\s*c\.capability_key ASC/
      .test(s),
  );
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

Deno.test("no new table, view, policy, trigger, index or unrelated surface", () => {
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
      /CREATE\s+(OR REPLACE\s+)?(MATERIALIZED\s+)?VIEW/i,
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

Deno.test("previously accepted API-G.5.7 and runtime helpers are not redefined", () => {
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
      "authorize_and_establish",
      "api_c_enforce_capability_grant_scope_integrity",
      "api_g_5_2_enforce_grant_capability_lifecycle",
    ]
  ) {
    assert(!s.includes(banned), `must not redefine: ${banned}`);
  }
});
