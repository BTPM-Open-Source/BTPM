// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-adm-1-target-activity-scope-resolver_static_test.ts', import.meta.url).href;
// API-ADM.1 — A. Resolver database contract (static migration guard).
//
// Proves the committed migration for
// `public.api_g_5_10_resolve_target_activity_scope` keeps its
// service-role-only, hierarchy-only contract. No live database access.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH = new URL(
  "../../migrations/20260810085057_b9093298-c65e-48ff-9c40-97c1769b08f2.sql",
  __BTPM_SRC_BASE__,
);

const SQL = await Deno.readTextFile(MIGRATION_PATH);

function count(needle: string): number {
  return SQL.split(needle).length - 1;
}

Deno.test("A — exact resolver signature and return contract", () => {
  assert(
    SQL.includes(
      "CREATE OR REPLACE FUNCTION public.api_g_5_10_resolve_target_activity_scope(",
    ),
  );
  assert(SQL.includes("_target_type text"));
  assert(SQL.includes("_target_id uuid"));
  assert(SQL.includes("RETURNS TABLE ("));
  for (const col of [
    "tenant_id uuid",
    "organization_id uuid",
    "workspace_id uuid",
    "project_id uuid",
  ]) {
    assert(SQL.includes(col), `missing column: ${col}`);
  }
  assertEquals(count("CREATE OR REPLACE FUNCTION"), 1);
});

Deno.test("A — security posture: definer, fixed search_path, read-only", () => {
  assert(SQL.includes("SECURITY DEFINER"));
  assert(SQL.includes("SET search_path = public"));
  assert(SQL.includes("STABLE"));
  for (
    const forbidden of ["INSERT INTO", "UPDATE public.", "DELETE FROM", "EXECUTE format", "EXECUTE '"]
  ) {
    assert(!SQL.includes(forbidden), `unexpected: ${forbidden}`);
  }
});

Deno.test("A — grants: service_role only; PUBLIC/anon/authenticated denied", () => {
  assert(
    SQL.includes(
      "REVOKE ALL ON FUNCTION public.api_g_5_10_resolve_target_activity_scope(text, uuid) FROM PUBLIC;",
    ),
  );
  assert(
    SQL.includes(
      "REVOKE ALL ON FUNCTION public.api_g_5_10_resolve_target_activity_scope(text, uuid) FROM anon;",
    ),
  );
  assert(
    SQL.includes(
      "REVOKE ALL ON FUNCTION public.api_g_5_10_resolve_target_activity_scope(text, uuid) FROM authenticated;",
    ),
  );
  assert(
    SQL.includes(
      "GRANT EXECUTE ON FUNCTION public.api_g_5_10_resolve_target_activity_scope(text, uuid) TO service_role;",
    ),
  );
  assertEquals(count("GRANT EXECUTE ON FUNCTION"), 1);
  assert(!SQL.includes("TO authenticated;"));
  assert(!SQL.includes("TO anon;"));
});

Deno.test("A — canonical hierarchy resolution for project, phase and task", () => {
  // project -> workspace -> organization -> tenant, via explicit joins.
  assert(
    SQL.includes("FROM public.projects p") &&
      SQL.includes("JOIN public.workspaces w ON w.id = p.workspace_id") &&
      SQL.includes("JOIN public.organizations o ON o.id = w.organization_id"),
  );
  assert(SQL.includes("SELECT o.tenant_id, o.id, w.id, p.id"));

  // phase -> project
  assert(
    SQL.includes("SELECT ph.project_id INTO v_project_id") &&
      SQL.includes("FROM public.phases ph"),
  );
  // task -> phase -> project
  assert(
    SQL.includes("FROM public.tasks t") &&
      SQL.includes("JOIN public.phases ph ON ph.id = t.phase_id"),
  );
});

Deno.test("A — unsupported target types and invalid identity fail closed", () => {
  assert(SQL.includes("IF _target_type NOT IN ('project', 'phase', 'task') THEN"));
  assert(SQL.includes("IF _target_id = '00000000-0000-0000-0000-000000000000'::uuid THEN"));
  assert(SQL.includes("IF _target_type IS NULL OR _target_id IS NULL THEN"));
  assert(SQL.includes("IF v_project_id IS NULL THEN"));
  for (const forbidden of ["'risk'", "'blocker'", "'tenant'", "'organization'", "'workspace'"]) {
    assert(!SQL.includes(forbidden), `unexpected accepted target: ${forbidden}`);
  }
});

Deno.test("A — no business or narrative fields are returned", () => {
  for (
    const forbidden of [
      "title",
      "description",
      "summary",
      "mitigation",
      "status_label",
      "idempotency",
      "payload_hash",
      "token",
      "decrypt",
    ]
  ) {
    assert(!SQL.toLowerCase().includes(forbidden), `unexpected: ${forbidden}`);
  }
});

Deno.test("A — no RLS, grant or business-table changes; no data mutation", () => {
  for (
    const forbidden of [
      "ENABLE ROW LEVEL SECURITY",
      "CREATE POLICY",
      "DROP POLICY",
      "ALTER TABLE",
      "api_request_activity_events",
      "api_g_5_10_list_client_activity",
      "api_g_5_10_record_api_activity",
    ]
  ) {
    assert(!SQL.includes(forbidden), `unexpected: ${forbidden}`);
  }
});
