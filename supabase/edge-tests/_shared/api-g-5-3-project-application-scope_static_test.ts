// API-G.5.3 — Project-level application scope.
//
// Repository static contract test. Locates the migration by its unique marker
// and asserts the frozen API-G.5.3 substrate contract:
//   - public.api_project_client_enablements exists with the required shape,
//     restrictive foreign keys, unique identity and lifecycle consistency.
//   - RLS enabled with zero policies; PUBLIC/anon/authenticated revoked;
//     service_role only; no browser-callable RPC.
//   - No seed and no backfill; Workspace enablement implies nothing.
//   - The scope trigger re-derives Project -> Workspace -> Organization ->
//     Tenant with locking and fails closed on mismatch.
//   - api_e_private.authorize_project_scope requires trusted context, exact
//     containment, has_project_access, an exact enabled project-client row and
//     an active scope_level = 'project' catalogue capability.
//   - No change to api_capability_grants, capabilities, clients, routes,
//     RPCs, OAuth metadata, UI or tenant_integrations.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-G.5.3 — Project-level application scope";

async function findMigrationByMarker(marker: string): Promise<string> {
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const sql = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (sql.includes(marker)) return sql;
  }
  throw new Error(`API-G.5.3 migration not found (marker: ${marker})`);
}

const sql = await findMigrationByMarker(MARKER);
const lower = sql.toLowerCase();

Deno.test("API-G.5.3: project enablement table shape", () => {
  assert(lower.includes("create table public.api_project_client_enablements"));
  for (
    const col of [
      "id uuid primary key default gen_random_uuid()",
      "tenant_id uuid not null",
      "organization_id uuid not null",
      "workspace_id uuid not null",
      "project_id uuid not null",
      "api_client_id uuid not null",
      "lifecycle_status text not null default 'disabled'",
      "enabled_at timestamptz null",
      "disabled_at timestamptz null default now()",
      "created_by uuid null",
      "updated_by uuid null",
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
    ]
  ) {
    assert(lower.includes(col), `missing column contract: ${col}`);
  }
});

Deno.test("API-G.5.3: restrictive parent FKs and SET NULL actor FKs", () => {
  for (
    const fk of [
      "references public.tenants(id) on delete restrict",
      "references public.organizations(id) on delete restrict",
      "references public.workspaces(id) on delete restrict",
      "references public.projects(id) on delete restrict",
      "references public.api_clients(id) on delete restrict",
    ]
  ) {
    assert(lower.includes(fk), `missing restrictive FK: ${fk}`);
  }
  const actorFks = lower.match(/references auth\.users\(id\) on delete set null/g) ?? [];
  assert(actorFks.length >= 2, "actor FKs must be ON DELETE SET NULL");
});

Deno.test("API-G.5.3: unique identity and lifecycle consistency", () => {
  assert(lower.includes("unique (project_id, api_client_id)"));
  assert(lower.includes("lifecycle_status in ('enabled','disabled')"));
  assert(lower.includes("lifecycle_status = 'enabled'"));
  assert(lower.includes("enabled_at is not null"));
  assert(lower.includes("disabled_at is null"));
  assert(lower.includes("lifecycle_status = 'disabled'"));
  assert(lower.includes("disabled_at is not null"));
  assert(
    lower.includes("update_api_project_client_enablements_updated_at"),
    "must reuse the existing updated-at trigger pattern",
  );
  assert(lower.includes("execute function public.update_updated_at_column()"));
});

Deno.test("API-G.5.3: RLS enabled with zero policies and no browser access", () => {
  assert(
    lower.includes(
      "alter table public.api_project_client_enablements enable row level security",
    ),
  );
  assert(
    !/create\s+policy/.test(lower),
    "API-G.5.3 must not create any RLS policy",
  );
  for (
    const revoke of [
      "revoke all on public.api_project_client_enablements from public",
      "revoke all on public.api_project_client_enablements from anon",
      "revoke all on public.api_project_client_enablements from authenticated",
    ]
  ) {
    assert(lower.includes(revoke), `missing revoke: ${revoke}`);
  }
  assert(
    lower.includes(
      "grant select, insert, update, delete on public.api_project_client_enablements to service_role",
    ),
  );
  assert(!lower.includes("to anon;"), "no anon grant is permitted");
});

Deno.test("API-G.5.3: no seed, no backfill, no implied project enablement", () => {
  assert(
    !lower.includes("insert into public.api_project_client_enablements"),
    "project enablement must not be seeded or backfilled",
  );
  assert(
    !lower.includes("from public.api_workspace_client_enablements"),
    "workspace enablement must not create or imply project enablement",
  );
  assert(!lower.includes("from public.api_organization_client_enablements"));
  assert(!lower.includes("insert into public.api_capability_catalogue"));
  assert(!lower.includes("insert into public.api_clients"));
  assert(!lower.includes("insert into public.api_capability_grants"));
  assert(!lower.toLowerCase().includes("astra"));
});

Deno.test("API-G.5.3: scope trigger re-derives authoritative hierarchy", () => {
  assert(
    lower.includes(
      "create or replace function public.api_g_5_3_enforce_project_enablement_scope_integrity()",
    ),
  );
  assert(lower.includes("from public.projects p"));
  assert(lower.includes("from public.workspaces w"));
  assert(lower.includes("from public.organizations o"));
  const locks = lower.match(/for update/g) ?? [];
  assert(locks.length >= 3, "authoritative rows must be locked");
  assert(lower.includes("security definer"));
  assert(lower.includes("set search_path = public, pg_catalog"));
  assert(
    lower.includes(
      "before insert or update on public.api_project_client_enablements",
    ),
  );
  assert(
    !lower.includes(
      "create or replace function public.api_c_enforce_enablement_scope_integrity",
    ),
    "existing organization/workspace enablement behaviour must be untouched",
  );
});

Deno.test("API-G.5.3: mismatched supplied scope fails closed", () => {
  assert(lower.includes("new.workspace_id <> v_project_workspace_id"));
  assert(lower.includes("new.organization_id <> v_project_organization_id"));
  assert(lower.includes("new.tenant_id <> v_authoritative_tenant_id"));
  assert(
    !/raise exception[^;]*new\.(project_id|api_client_id)/s.test(lower) ||
      lower.includes("project_id is required"),
    "exceptions must remain non-enumerating",
  );
  for (
    const revoke of [
      "revoke all on function public.api_g_5_3_enforce_project_enablement_scope_integrity() from public",
      "revoke all on function public.api_g_5_3_enforce_project_enablement_scope_integrity() from anon",
      "revoke all on function public.api_g_5_3_enforce_project_enablement_scope_integrity() from authenticated",
    ]
  ) {
    assert(lower.includes(revoke), `missing revoke: ${revoke}`);
  }
});

Deno.test("API-G.5.3: private helper posture", () => {
  assert(
    lower.includes(
      "create or replace function api_e_private.authorize_project_scope(_project_id uuid)",
    ),
  );
  assert(lower.includes("returns boolean"));
  assert(lower.includes("stable"));
  assert(lower.includes("security definer"));
  assert(lower.includes("set search_path = public, pg_catalog"));
  for (
    const revoke of [
      "revoke all on function api_e_private.authorize_project_scope(uuid) from public",
      "revoke all on function api_e_private.authorize_project_scope(uuid) from anon",
      "revoke all on function api_e_private.authorize_project_scope(uuid) from authenticated",
    ]
  ) {
    assert(lower.includes(revoke), `missing revoke: ${revoke}`);
  }
  assert(
    !lower.includes("grant execute on function api_e_private.authorize_project_scope"),
    "helper must not be browser-executable",
  );
  assert(!lower.includes("execute format("), "no dynamic SQL permitted");
});

Deno.test("API-G.5.3: helper requires trusted context and full intersection", () => {
  assert(lower.includes("if not api_e_private.assert_trusted_context() then"));
  for (
    const key of [
      "api_e.authenticated_user_id",
      "api_e.api_client_id",
      "api_e.tenant_id",
      "api_e.organization_id",
      "api_e.workspace_id",
      "api_e.api_version",
      "api_e.capability_kind",
      "api_e.capability_key",
    ]
  ) {
    assert(lower.includes(key.toLowerCase()), `missing context read: ${key}`);
  }
  // Exact workspace/organization/project containment and archived exclusion.
  assert(lower.includes("p.workspace_id = v_workspace_id"));
  assert(lower.includes("p.organization_id = v_organization_id"));
  assert(lower.includes("coalesce(p.is_archived, false) = false"));
  // Ordinary user project access.
  assert(lower.includes("public.has_project_access(v_user_id, _project_id)"));
  // Exact enabled project-client row.
  assert(lower.includes("from public.api_project_client_enablements e"));
  assert(lower.includes("e.api_client_id = v_client_id"));
  assert(lower.includes("e.tenant_id = v_tenant_id"));
  assert(lower.includes("e.organization_id = v_organization_id"));
  assert(lower.includes("e.workspace_id = v_workspace_id"));
  assert(lower.includes("e.lifecycle_status = 'enabled'"));
  // Active project-scoped catalogue capability.
  assert(lower.includes("from public.api_capability_catalogue c"));
  assert(lower.includes("c.scope_level = 'project'"));
  assert(lower.includes("c.lifecycle_status = 'active'"));
  // Fail closed on exceptions.
  assert(lower.includes("exception when others then"));
  assert(lower.includes("return false"));
});

Deno.test("API-G.5.3: no grant-model, route, RPC or integration drift", () => {
  assert(
    !lower.includes("alter table public.api_capability_grants"),
    "api_capability_grants must remain unchanged",
  );
  assert(
    !/alter\s+table\s+public\.api_capability_grants\s+add\s+column/.test(lower),
  );
  assert(
    !lower.includes("create or replace function api_e_private.authorize_and_establish"),
  );
  assert(!lower.includes("api_v1_get_me"));
  assert(!lower.includes("api_v1_list_organizations"));
  assert(!lower.includes("tenant_integrations"));
  assert(!lower.includes("oauth"));
});
