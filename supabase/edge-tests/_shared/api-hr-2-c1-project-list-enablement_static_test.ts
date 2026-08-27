// API-HR.2-C1 — Project-list Connected App Project-enablement containment.
//
// Repository contract test. Asserts the effective
// public.api_v1_list_projects(text, uuid, integer, integer, text) definition
// contains the per-row Connected App Project-enablement predicate inside the
// eligible Project set (before search filtering, counting, row numbering and
// pagination), and preserves the pre-existing route authority conditions.
//
// Structural, not line-number based.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const CORRECTION_MIGRATION_PATH =
  "supabase/migrations/20260809192348_561a9db7-c616-45e3-965c-5b0c0516a5d2.sql";

function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

async function readCorrection(): Promise<string> {
  return normalize(await Deno.readTextFile(CORRECTION_MIGRATION_PATH));
}

Deno.test("API-HR.2-C1 correction migration exists", async () => {
  const stat = await Deno.stat(CORRECTION_MIGRATION_PATH);
  assert(stat.isFile);
});

Deno.test(
  "API-HR.2-C1 replaces only api_v1_list_projects with the frozen signature",
  async () => {
    const sql = await readCorrection();
    assert(
      sql.includes(
        "create or replace function public.api_v1_list_projects(_expected_oauth_client_id text, _workspace_id uuid, _limit integer default 50, _offset integer default 0, _search text default null::text)",
      ),
    );
    assert(sql.includes("returns jsonb"));
    assert(sql.includes("stable security definer"));
    assert(sql.includes("set search_path to 'pg_catalog'"));
    // Project detail and other wrappers must not be redefined here.
    assert(!sql.includes("api_v1_get_project"));
    assert(!sql.includes("drop function"));
    assert(!sql.includes("create table"));
    assert(!sql.includes("alter table"));
    assert(!sql.includes("create policy"));
    assert(!sql.includes("service_role_key"));
  },
);

Deno.test(
  "API-HR.2-C1 requires an active Project Connected App enablement per row",
  async () => {
    const sql = await readCorrection();
    assert(sql.includes("public.api_project_client_enablements pe"));
    assert(sql.includes("pe.tenant_id = _tenant_id"));
    assert(sql.includes("pe.organization_id = _org_id"));
    assert(sql.includes("pe.workspace_id = _workspace_id"));
    assert(sql.includes("pe.project_id = p.id"));
    assert(sql.includes("pe.api_client_id = _client_id"));
    assert(sql.includes("pe.lifecycle_status = 'enabled'"));
    assert(sql.includes("pe.enabled_at is not null"));
    assert(sql.includes("pe.disabled_at is null"));
  },
);

Deno.test(
  "API-HR.2-C1 applies the enablement filter inside the eligible set, before search/count/pagination",
  async () => {
    const sql = await readCorrection();
    const eligibleAt = sql.indexOf("with eligible as (");
    const enablementAt = sql.indexOf("public.api_project_client_enablements pe");
    const filteredAt = sql.indexOf("filtered as (");
    const searchAt = sql.indexOf("position(lower(_search_trimmed)");
    const countAt = sql.indexOf("count(*)::integer");
    const rowNumberAt = sql.indexOf("row_number() over (");

    assert(eligibleAt >= 0);
    assert(filteredAt > eligibleAt);
    assert(enablementAt > eligibleAt);
    assert(enablementAt < filteredAt, "enablement must be in the eligible CTE");
    assert(enablementAt < searchAt);
    assert(enablementAt < countAt);
    assert(enablementAt < rowNumberAt);
  },
);

Deno.test(
  "API-HR.2-C1 preserves delegated-user Project authority and route authority",
  async () => {
    const sql = await readCorrection();
    assert(sql.includes("public.has_project_access(_uid, p.id)"));
    assert(sql.includes("api_e_private.resolve_delegated_read_principal"));
    assert(sql.includes("public.api_organization_client_enablements"));
    assert(sql.includes("public.api_workspace_client_enablements"));
    assert(sql.includes("g.capability_key = 'projects:list'"));
    assert(sql.includes("g.capability_kind = 'read'"));
    assert(sql.includes("p.is_archived = false"));
    assert(sql.includes("public.btpm_decrypt(p.name, p.organization_id)"));
    // Authorized-but-empty Workspace still returns a normal payload.
    assert(sql.includes("'items', _items"));
    assert(sql.includes("'total', _total"));
  },
);
