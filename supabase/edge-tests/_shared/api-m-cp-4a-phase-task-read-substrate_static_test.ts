// API-M.CP.4A — Phase + Task detail read substrate.
//
// Concise permanent static guard. Locates the API-M.CP.4A migration by its
// unique marker and asserts, from committed source only, the security- and
// business-critical properties of exactly two dedicated external detail read
// wrappers. No HTTP surface is asserted: route activation is deferred.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER =
  "API-M.CP.4A — Phase + Task detail read substrate + Execution Update scope-consistency correction";

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

function slice(fn: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert(start >= 0, `wrapper not found: ${fn}`);
  const end = SQL.indexOf(`REVOKE ALL ON FUNCTION public.${fn}(text, uuid)`);
  assert(end > start, `grant block not found: ${fn}`);
  return SQL.slice(start, end);
}

const PHASE = slice("api_v1_get_phase");
const TASK = slice("api_v1_get_task");

function containment(FN: string, capability: string, label: string): void {
  const checks: ReadonlyArray<[string, RegExp]> = [
    [
      "delegated read principal",
      /api_e_private\.resolve_delegated_read_principal\(_expected_oauth_client_id\)/,
    ],
    [
      "exactly one principal row",
      /_rowcount <> 1 OR _uid IS NULL OR _client_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/,
    ],
    [
      "authoritative Project derivation",
      /SELECT p\.organization_id, p\.workspace_id INTO _org_id, _ws_id FROM public\.projects p/,
    ],
    ["active Tenant", /t\.status = 'active' AND t\.suspended_at IS NULL/],
    [
      "active Tenant membership",
      /public\.tenant_memberships tm ON tm\.tenant_id = t\.id AND tm\.user_id = _uid AND tm\.status = 'active'/,
    ],
    [
      "active Organization membership",
      /public\.organization_memberships om ON om\.organization_id = o\.id AND om\.user_id = _uid AND om\.status = 'active'/,
    ],
    [
      "active non-archived Workspace",
      /w\.is_active = true AND w\.is_archived = false/,
    ],
    ["non-archived Project", /p\.is_archived = false/],
    ["canonical Project access", /public\.has_project_access\(_uid, p\.id\)/],
    [
      "Organization Connected App enablement",
      /api_organization_client_enablements oe[\s\S]*?oe\.lifecycle_status = 'enabled'/,
    ],
    [
      "Workspace Connected App enablement",
      /api_workspace_client_enablements we[\s\S]*?we\.lifecycle_status = 'enabled'/,
    ],
    [
      "Project Connected App enablement",
      /api_project_client_enablements pe[\s\S]*?pe\.lifecycle_status = 'enabled' AND pe\.enabled_at IS NOT NULL AND pe\.disabled_at IS NULL/,
    ],
    [
      `enabled supported capability ${capability}`,
      new RegExp(
        `api_client_supported_capabilities sc[\\s\\S]*?sc\\.api_version = 'v1' AND sc\\.capability_kind = 'read' AND sc\\.capability_key = '${capability}' AND sc\\.lifecycle_status = 'enabled'`,
      ),
    ],
    [
      "active project-scoped catalogue capability",
      new RegExp(
        `api_capability_catalogue cc[\\s\\S]*?cc\\.capability_key = '${capability}' AND cc\\.scope_level = 'project' AND cc\\.lifecycle_status = 'active'`,
      ),
    ],
    [
      "target Workspace/Organization consistency",
      /IF _org_id IS NULL OR _ws_id IS NULL OR _org_id <> _tgt_org_id OR _ws_id <> _tgt_ws_id THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/,
    ],
  ];
  for (const [check, pattern] of checks) {
    assert(pattern.test(FN), `${label} must enforce: ${check}`);
  }
  assert(FN.includes("STABLE"), `${label} must be STABLE`);
  assert(FN.includes("SECURITY DEFINER"), `${label} must be SECURITY DEFINER`);
  assert(
    /SET search_path TO 'pg_catalog'/.test(FN),
    `${label} must pin a hardened search_path`,
  );
  assert(
    !/EXECUTE |format\(|quote_ident|quote_literal/.test(FN),
    `${label} must contain no dynamic SQL`,
  );
  assert(!/not_found/.test(FN), `${label} must not enumerate not_found`);
  assert(
    /IF _result IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(FN),
    `${label} must fail closed non-enumerably with 42501`,
  );
}

Deno.test("API-M.CP.4A registers phases:read and tasks:read as catalogue metadata only", () => {
  assert(
    /\('v1', 'read', 'phases:read', 'phases\.get_by_id', 'GET', '\/v1\/phases\/:phaseid', 'project',[\s\S]*?true, 'active'\)/
      .test(SQL),
  );
  assert(
    /\('v1', 'read', 'tasks:read', 'tasks\.get_by_id', 'GET', '\/v1\/tasks\/:taskid', 'project',[\s\S]*?true, 'active'\)/
      .test(SQL),
  );
  for (
    const forbidden of [
      "INSERT INTO public.api_client_supported_capabilities",
      "UPDATE public.api_client_supported_capabilities",
      "INSERT INTO public.api_capability_grants",
      "INSERT INTO public.api_organization_client_enablements",
      "INSERT INTO public.api_workspace_client_enablements",
      "INSERT INTO public.api_project_client_enablements",
    ]
  ) {
    assert(!SQL.includes(forbidden), `must not perform: ${forbidden}`);
  }
});

Deno.test("API-M.CP.4A Phase wrapper has the frozen signature and structural containment", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_get_phase\( _expected_oauth_client_id text, _phase_id uuid \) RETURNS jsonb/
      .test(SQL),
  );
  assert(
    /SELECT ph\.project_id, ph\.workspace_id, ph\.organization_id INTO _project_id, _tgt_ws_id, _tgt_org_id FROM public\.phases ph WHERE ph\.id = _phase_id;/
      .test(PHASE),
    "Phase scope must be derived from the stored Phase and its parent Project",
  );
  assert(
    /IF _project_id IS NULL OR _tgt_ws_id IS NULL OR _tgt_org_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(PHASE),
  );
  assert(
    /WHERE ph\.id = _phase_id AND ph\.project_id = _project_id AND ph\.organization_id = _org_id AND ph\.workspace_id = _ws_id/
      .test(PHASE),
    "final projection must re-assert structural integrity",
  );
  containment(PHASE, "phases:read", "api_v1_get_phase");
});

Deno.test("API-M.CP.4A Phase wrapper returns exactly the fifteen frozen fields", () => {
  const fields = [
    "'phaseId', ph.id",
    "'projectId', ph.project_id",
    "'name', public.btpm_decrypt(ph.name, ph.organization_id)",
    "'description', public.btpm_decrypt(ph.description, ph.organization_id)",
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
  ];
  for (const field of fields) {
    assert(PHASE.includes(field), `Phase response must contain: ${field}`);
  }
  const emitted = PHASE.match(/'[a-zA-Z]+', (ph\.|public\.btpm_decrypt)/g) ?? [];
  assert(emitted.length === 15, "exactly fifteen Phase fields are permitted");
  for (
    const forbidden of [
      "'organizationId'",
      "'workspaceId'",
      "'createdBy'",
      "'createdAt'",
      "'isArchived'",
      "get_decrypted_phase",
      "btpm_encrypt",
    ]
  ) {
    assert(!PHASE.includes(forbidden), `Phase must not expose: ${forbidden}`);
  }
});

Deno.test("API-M.CP.4A Task wrapper has the frozen signature and structural containment", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.api_v1_get_task\( _expected_oauth_client_id text, _task_id uuid \) RETURNS jsonb/
      .test(SQL),
  );
  assert(
    /SELECT tk\.project_id, tk\.phase_id, tk\.workspace_id, tk\.organization_id INTO _project_id, _phase_id, _tgt_ws_id, _tgt_org_id FROM public\.tasks tk LEFT JOIN public\.phases tph ON tph\.id = tk\.phase_id WHERE tk\.id = _task_id AND \( tk\.phase_id IS NULL OR \( tph\.project_id = tk\.project_id AND tph\.workspace_id = tk\.workspace_id AND tph\.organization_id = tk\.organization_id \) \)/
      .test(TASK),
    "Task scope derivation must require Task/Phase Project + Workspace + Organization consistency",
  );
  assert(
    /IF _project_id IS NULL OR _tgt_ws_id IS NULL OR _tgt_org_id IS NULL THEN RAISE EXCEPTION 'api_v1_not_authorized' USING ERRCODE = '42501'/
      .test(TASK),
  );
  assert(
    /WHERE tk\.id = _task_id AND tk\.project_id = _project_id AND tk\.organization_id = _org_id AND tk\.workspace_id = _ws_id/
      .test(TASK),
    "final projection must re-assert structural integrity",
  );
  containment(TASK, "tasks:read", "api_v1_get_task");
});

Deno.test("API-M.CP.4A Task wrapper returns exactly the nineteen frozen fields", () => {
  const fields = [
    "'taskId', tk.id",
    "'projectId', tk.project_id",
    "'phaseId', tk.phase_id",
    "'name', public.btpm_decrypt(tk.name, tk.organization_id)",
    "'description', public.btpm_decrypt(tk.description, tk.organization_id)",
    "'status', tk.status::text",
    "'priority', tk.priority::text",
    "'taskType', tk.task_type::text",
    "'sortOrder', tk.sort_order",
    "'startDate', tk.start_date",
    "'dueDate', tk.due_date",
    "'baselineStartDate', tk.baseline_start_date",
    "'baselineEndDate', tk.baseline_end_date",
    "'addedAfterBaseline', tk.added_after_baseline",
    "'actualStartDate', tk.actual_start_date",
    "'actualEndDate', tk.actual_end_date",
    "'estimatedHours', tk.estimated_hours",
    "'assigneeId', _assignee_id",
    "'updatedAt', tk.updated_at",
  ];
  for (const field of fields) {
    assert(TASK.includes(field), `Task response must contain: ${field}`);
  }
  const emitted =
    TASK.match(/'[a-zA-Z]+', (tk\.|public\.btpm_decrypt|_assignee_id)/g) ?? [];
  assert(emitted.length === 19, "exactly nineteen Task fields are permitted");
  for (
    const forbidden of [
      "'organizationId'",
      "'workspaceId'",
      "'ownerId'",
      "'createdBy'",
      "'createdAt'",
      "'isArchived'",
      "'workflowStateId'",
      "'backlogItemId'",
      "'assignments'",
      "adoption_initiative_id",
      "task_stakeholder_roles",
      "profiles",
      "tk.owner_id",
      "btpm_encrypt",
    ]
  ) {
    assert(!TASK.includes(forbidden), `Task must not expose: ${forbidden}`);
  }
});

Deno.test("API-M.CP.4A resolves the effective Task assignee from task_assignments only", () => {
  assert(
    /SELECT ta\.assignee_id INTO _assignee_id FROM public\.task_assignments ta WHERE ta\.task_id = _task_id ORDER BY ta\.created_at DESC LIMIT 1/
      .test(TASK),
    "canonical effective-assignee treatment is required",
  );
  assert(
    !/jsonb_agg\([\s\S]*task_assignments/.test(TASK),
    "no raw assignment array may be exposed",
  );
});

Deno.test("API-M.CP.4A adds exactly the two detail wrappers and touches no mutation wrapper", () => {
  for (const [name, count] of [["api_v1_get_phase", 1], ["api_v1_get_task", 1]] as const) {
    const created =
      SQL.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, "g")) ??
        [];
    assert(created.length === count, `expected one creation of ${name}`);
  }
  for (
    const forbidden of [
      "api_v1_create_phase",
      "api_v1_update_phase",
      "api_v1_reorder_phases",
      "api_v1_plan_phase",
      "api_v1_create_task",
      "api_v1_update_task",
      "api_v1_reorder_tasks",
      "api_v1_plan_task",
      "api_v1_assign_task",
      "api_v1_transition_task",
    ]
  ) {
    assert(!SQL.includes(forbidden), `must not modify: ${forbidden}`);
  }
  assert(!/TO service_role/.test(SQL), "no service-role execution path");
  assert(
    SQL.includes(
      "GRANT EXECUTE ON FUNCTION public.api_v1_get_phase(text, uuid) TO authenticated",
    ),
  );
  assert(
    SQL.includes(
      "GRANT EXECUTE ON FUNCTION public.api_v1_get_task(text, uuid) TO authenticated",
    ),
  );
  assert(
    SQL.includes(
      "REVOKE ALL ON FUNCTION public.api_v1_get_phase(text, uuid) FROM anon",
    ),
  );
  assert(
    SQL.includes(
      "REVOKE ALL ON FUNCTION public.api_v1_get_task(text, uuid) FROM anon",
    ),
  );
  assert(!/CREATE TABLE|CREATE SCHEMA/i.test(SQL));
});
