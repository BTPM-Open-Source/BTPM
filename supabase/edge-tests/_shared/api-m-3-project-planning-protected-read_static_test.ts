// API-M.3 — Protected Project planning read database contract.
//
// Focused repository static contract test. Locates the API-M.3 migration by its
// unique marker and asserts, from committed source only, that the delegated
// planning read wrapper exists with the frozen API-M.1 projection, the required
// security composition, and no mutation / shadow planning state.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-M.3 — Protected Project planning read database wrapper";

async function findMigrationByMarker(marker: string): Promise<string> {
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const text = await Deno.readTextFile(`${MIGRATIONS_DIR}/${entry.name}`);
    if (text.includes(marker)) return text;
  }
  throw new Error(`migration marker not found: ${marker}`);
}

const RAW = await findMigrationByMarker(MARKER);
const SQL = RAW.replace(/\s+/g, " ");

// Body only: the trailing COMMENT ON FUNCTION prose is documentation, not SQL
// behavior, so projection-exclusion assertions run against the function body.
const BODY = SQL.split("COMMENT ON FUNCTION")[0];

Deno.test("API-M.3 wrapper exists with the exact signature and security attributes", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_get_project_planning\( _expected_oauth_client_id text, _project_id uuid \) RETURNS jsonb/
      .test(SQL),
    "exact signature returning jsonb is required",
  );
  assert(SQL.includes("STABLE"), "must be STABLE");
  assert(SQL.includes("SECURITY DEFINER"), "must be SECURITY DEFINER");
  assert(
    /SET search_path TO 'pg_catalog'/.test(SQL),
    "must pin a hardened search_path",
  );
});

Deno.test("API-M.3 resolves the delegated principal through the trusted helper", () => {
  assert(
    SQL.includes(
      "api_e_private.resolve_delegated_read_principal(_expected_oauth_client_id)",
    ),
    "delegated principal must come from the trusted helper",
  );
  assert(SQL.includes("r.authenticated_user_id"), "delegated user required");
  assert(SQL.includes("r.api_client_id"), "API client identity required");
});

Deno.test("API-M.3 fails closed with bounded errors", () => {
  assert(
    /_project_id IS NULL THEN RAISE EXCEPTION 'api_v1_invalid_request' USING ERRCODE = '22023'/
      .test(SQL),
    "null target must raise api_v1_invalid_request / 22023",
  );
  assert(
    /RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/.test(SQL),
    "unauthorized target must raise api_v1_not_authorized / 42501",
  );
});

Deno.test("API-M.3 requires the exact planning:read capability and never projects:read", () => {
  assert(
    /api_client_supported_capabilities sc WHERE sc\.api_client_id = _client_id AND sc\.api_version = 'v1' AND sc\.capability_kind = 'read' AND sc\.capability_key = 'planning:read' AND sc\.lifecycle_status = 'enabled'/
      .test(SQL),
    "exact enabled supported capability planning:read is required",
  );
  assert(
    /api_capability_catalogue cc WHERE cc\.api_version = 'v1' AND cc\.capability_kind = 'read' AND cc\.capability_key = 'planning:read' AND cc\.scope_level = 'project' AND cc\.lifecycle_status = 'active'/
      .test(SQL),
    "active project-scoped planning:read catalogue row is required",
  );
  assert(
    !/capability_key = 'projects:read'/.test(SQL),
    "projects:read must not be used as authorization",
  );
});

Deno.test("API-M.3 enforces Tenant, membership, Workspace, Project and enablement composition", () => {
  assert(/public\.tenants t/.test(SQL) && /t\.status = 'active'/.test(SQL));
  assert(/tenant_memberships tm/.test(SQL) && /tm\.status = 'active'/.test(SQL));
  assert(
    /organization_memberships om/.test(SQL) && /om\.status = 'active'/.test(SQL),
  );
  assert(
    /public\.workspaces w[\s\S]*w\.is_active = true AND w\.is_archived = false/
      .test(SQL),
    "Workspace must be active and non-archived",
  );
  assert(
    /p\.is_archived = false/.test(SQL),
    "target Project must be non-archived",
  );
  assert(
    SQL.includes("public.has_project_access(_uid, p.id)"),
    "canonical Project access must be enforced",
  );
  assert(SQL.includes("api_organization_client_enablements"));
  assert(SQL.includes("api_workspace_client_enablements"));
  assert(SQL.includes("api_project_client_enablements"));
});

Deno.test("API-M.3 derives scope from the Project, not caller-supplied identifiers", () => {
  assert(
    !/_tenant_id\b|_organization_id\b|_workspace_id\b/.test(SQL),
    "no caller-supplied Tenant/Organization/Workspace parameters",
  );
  assert(
    /WHERE p\.id = _project_id/.test(SQL),
    "the only business target input is _project_id",
  );
});

Deno.test("API-M.3 returns the four canonical projections", () => {
  assert(
    /RETURN jsonb_build_object\( 'project', _project, 'phases', _phases, 'tasks', _tasks, 'dependencies', _dependencies \)/
      .test(SQL),
    "single top-level object with project/phases/tasks/dependencies",
  );
  for (
    const key of [
      "'projectId', p.id",
      "'startDate', p.start_date",
      "'targetEndDate', p.target_end_date",
      "'actualStartDate', p.actual_start_date",
      "'actualEndDate', p.actual_end_date",
      "'isBaselined', p.is_baselined",
    ]
  ) {
    assert(SQL.includes(key), `Project projection must include ${key}`);
  }
});

Deno.test("API-M.3 includes all frozen Phase planning fields", () => {
  for (
    const key of [
      "'phaseId', ph.id",
      "'projectId', ph.project_id",
      "'status', ph.status::text",
      "'phaseType', ph.phase_type::text",
      "'sortOrder', ph.sort_order",
      "'startDate', ph.start_date",
      "'targetEndDate', ph.target_end_date",
      "'baselineStartDate', ph.baseline_start_date",
      "'baselineEndDate', ph.baseline_end_date",
      "'addedAfterBaseline', ph.added_after_baseline",
      "'actualStartDate', ph.actual_start_date",
      "'actualEndDate', ph.actual_end_date",
      "'updatedAt', ph.updated_at",
    ]
  ) {
    assert(SQL.includes(key), `Phase projection must include ${key}`);
  }
  assert(
    /ORDER BY ph\.sort_order, ph\.id/.test(SQL),
    "Phases must be ordered by canonical sort_order",
  );
  assert(
    /public\.phases ph WHERE ph\.project_id = _project_id AND ph\.is_archived = false/
      .test(SQL),
    "Phase planning set mirrors the non-archived Gantt inclusion behavior",
  );
});

Deno.test("API-M.3 includes all frozen Task planning fields", () => {
  for (
    const key of [
      "'taskId', t.id",
      "'projectId', t.project_id",
      "'phaseId', t.phase_id",
      "'status', t.status::text",
      "'priority', t.priority::text",
      "'taskType', t.task_type::text",
      "'sortOrder', t.sort_order",
      "'startDate', t.start_date",
      "'dueDate', t.due_date",
      "'baselineStartDate', t.baseline_start_date",
      "'baselineEndDate', t.baseline_end_date",
      "'addedAfterBaseline', t.added_after_baseline",
      "'actualStartDate', t.actual_start_date",
      "'actualEndDate', t.actual_end_date",
      "'updatedAt', t.updated_at",
    ]
  ) {
    assert(SQL.includes(key), `Task projection must include ${key}`);
  }
  assert(
    /ORDER BY ph\.sort_order, ph\.id, t\.sort_order, t\.id/.test(SQL),
    "Tasks preserve parent Phase then sibling sort_order ordering",
  );
  assert(
    /public\.tasks t WHERE t\.project_id = _project_id AND t\.is_archived = false AND t\.phase_id = ANY \(_phase_ids\)/
      .test(SQL),
    "Task planning set is non-archived Tasks of non-archived Phases",
  );
});

Deno.test("API-M.3 dependency projection is contained to the Project planning set", () => {
  for (
    const key of [
      "'dependencyId', d.id",
      "'sourceType', d.source_type",
      "'sourceId', d.source_id",
      "'targetType', d.target_type",
      "'targetId', d.target_id",
      "'dependencyType', d.dependency_type::text",
    ]
  ) {
    assert(SQL.includes(key), `Dependency projection must include ${key}`);
  }
  assert(
    /public\.dependencies d WHERE d\.source_id = ANY \(_object_ids\) AND d\.target_id = ANY \(_object_ids\)/
      .test(SQL),
    "both dependency endpoints must belong to this Project planning set",
  );
  assert(
    !/d\.description/.test(SQL),
    "dependency narrative must not be returned",
  );
});

Deno.test("API-M.3 exposes no protected narrative and no user-directory data", () => {
  for (
    const forbidden of [
      "ph.description",
      "t.description",
      "p.description",
      "p.charter",
      "p.goals",
      "p.scope_in",
      "p.scope_out",
      "p.business_case",
      "t.estimated_hours",
      "t.owner_id",
      "assignee",
      "task_assignments",
      "raci_assignments",
      "task_stakeholder_roles",
      "profiles",
      "display_name",
      "backlog_item_id",
    ]
  ) {
    assert(
      !BODY.includes(forbidden),
      `${forbidden} must not appear in the planning projection`,
    );
  }
});

Deno.test("API-M.3 uses the approved decryption helper for names only", () => {
  assert(SQL.includes("public.btpm_decrypt(p.name, p.organization_id)"));
  assert(SQL.includes("public.btpm_decrypt(ph.name, ph.organization_id)"));
  assert(SQL.includes("public.btpm_decrypt(t.name, t.organization_id)"));
  assert(
    !/pgp_sym_|\bcrypt\(|\bencode\(|digest\(/.test(BODY),
    "no new encryption/decryption algorithm may be introduced",
  );
});

Deno.test("API-M.3 is read-only and introduces no shadow planning state", () => {
  assert(!/\bINSERT\s+INTO\b/i.test(SQL), "no INSERT");
  assert(!/\bUPDATE\s+public\./i.test(SQL), "no UPDATE");
  assert(!/\bDELETE\s+FROM\b/i.test(SQL), "no DELETE");
  assert(!/\bON CONFLICT\b/i.test(SQL), "no UPSERT");
  assert(!/CREATE\s+TABLE/i.test(SQL), "no new table");
  assert(!/CREATE\s+MATERIALIZED\s+VIEW/i.test(SQL), "no materialized model");
  assert(!/TEMP(ORARY)?\s+TABLE/i.test(SQL), "no temporary planning table");
});

Deno.test("API-M.3 revokes PUBLIC and anon and grants only authenticated", () => {
  assert(
    SQL.includes(
      "REVOKE ALL ON FUNCTION public.api_v1_get_project_planning(text, uuid) FROM PUBLIC",
    ),
  );
  assert(
    SQL.includes(
      "REVOKE ALL ON FUNCTION public.api_v1_get_project_planning(text, uuid) FROM anon",
    ),
  );
  assert(
    SQL.includes(
      "GRANT EXECUTE ON FUNCTION public.api_v1_get_project_planning(text, uuid) TO authenticated",
    ),
  );
  assert(
    !/GRANT EXECUTE ON FUNCTION public\.api_v1_get_project_planning\(text, uuid\) TO anon/
      .test(SQL),
  );
});

Deno.test("API-M.3 migration touches no other API wrapper or capability registration", () => {
  assert(
    !/api_v1_get_project\(/.test(SQL),
    "existing API-H project-detail wrapper must not be modified",
  );
  assert(
    !/INSERT INTO public\.api_capability_catalogue/i.test(SQL),
    "no capability catalogue change",
  );
  assert(
    !/api_client_supported_capabilities \(/.test(SQL),
    "no client capability assignment change",
  );
});
