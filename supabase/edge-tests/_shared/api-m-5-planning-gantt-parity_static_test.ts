// Relocated out of supabase/functions/ (Edge deploy bundle size).
// Source-file reads stay anchored to the original module location.
const __BTPM_SELF_URL__ = import.meta.url;
const __BTPM_SRC_BASE__ = new URL('../../functions/_shared/api-m-5-planning-gantt-parity_static_test.ts', import.meta.url).href;
// API-M.5 — Permanent Planning / Gantt parity regression contract.
//
// This is a static repository guard. It reads the effective API-M.3 migration,
// the API-M.4 HTTP adapter / route / router wiring and the current BTPM Project
// Gantt sources, and proves that the accepted `planning:read` payload remains
// sufficient to reproduce the semantic content of the Gantt without creating a
// second planning source of truth.
//
// It must never mutate anything and must fail closed when an expected source
// file or contract marker disappears.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const REPO_ROOT = new URL("../../../", __BTPM_SRC_BASE__);

function readSource(relativePath: string): string {
  const url = new URL(relativePath, REPO_ROOT);
  let text: string;
  try {
    text = Deno.readTextFileSync(url);
  } catch (cause) {
    throw new Error(
      `API-M.5 parity guard: required source file is missing: ${relativePath} (${cause})`,
    );
  }
  if (text.trim().length === 0) {
    throw new Error(
      `API-M.5 parity guard: required source file is empty: ${relativePath}`,
    );
  }
  return text;
}

/** Locate the API-M.3 migration by its unique marker, not by timestamp name. */
function readApiM3Migration(): { path: string; sql: string } {
  const dir = new URL("supabase/migrations/", REPO_ROOT);
  const matches: { path: string; sql: string }[] = [];
  for (const entry of Deno.readDirSync(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const sql = Deno.readTextFileSync(new URL(entry.name, dir));
    if (
      sql.includes("API-M.3") &&
      sql.includes("public.api_v1_get_project_planning(")
    ) {
      matches.push({ path: `supabase/migrations/${entry.name}`, sql });
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      `API-M.5 parity guard: expected exactly one API-M.3 planning migration, found ${matches.length}`,
    );
  }
  return matches[0];
}

const M3 = readApiM3Migration();
const M3_SQL = M3.sql;

const ADAPTER = readSource(
  "supabase/functions/_shared/btpm-api/supabaseProjectPlanning.ts",
);
const DELEGATED_READER = readSource(
  "supabase/functions/_shared/btpm-api/supabaseDelegatedProjectPlanning.ts",
);
const ROUTE = readSource(
  "supabase/functions/_shared/btpm-api/routes/projectPlanning.ts",
);
const ROUTER = readSource("supabase/functions/btpm-api-v1/router.ts");
const CONTRACT_DOC = readSource(
  "docs/governance/api/API_M1_PHASE_TASK_PLANNING_CONTRACT_AND_EXECUTION_PLAN_FREEZE.md",
);

const GANTT_PAGE = readSource("src/pages/ProjectGantt.tsx");
const GANTT_DATA = readSource("src/components/gantt/useGanttData.ts");
const GANTT_UTILS = readSource("src/components/gantt/ganttUtils.ts");
const GANTT_CHART = readSource("src/components/gantt/GanttChart.tsx");
const PLANNING_HOOKS = readSource("src/hooks/useProjectPlanning.ts");

/** Strip line/block comments so guards do not pass or fail on commentary. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .replace(/^\s*--.*$/gm, "\n")
    .replace(/^\s*\/\/.*$/gm, "\n");
}

// The trailing COMMENT ON FUNCTION documentation text is governance prose, not
// an executable projection, so it is excluded from the projection guards.
const M3_COMMENT_INDEX = M3_SQL.indexOf("COMMENT ON FUNCTION");
const M3_CODE = stripComments(
  M3_COMMENT_INDEX >= 0 ? M3_SQL.slice(0, M3_COMMENT_INDEX) : M3_SQL,
);
const ADAPTER_CODE = stripComments(ADAPTER);
const DELEGATED_CODE = stripComments(DELEGATED_READER);
const ROUTE_CODE = stripComments(ROUTE);

/** Extract an exact-key array declared in the M.4 adapter. */
function adapterKeySet(constName: string): string[] {
  const match = new RegExp(
    `const ${constName}[^=]*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`,
  ).exec(ADAPTER_CODE);
  if (!match) {
    throw new Error(
      `API-M.5 parity guard: adapter key contract ${constName} not found in supabaseProjectPlanning.ts`,
    );
  }
  return [...match[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
}

/** Extract the keys of a jsonb_build_object projection in the M.3 migration. */
function migrationObjectKeys(anchorKey: string): string[] {
  const idx = M3_CODE.indexOf(`'${anchorKey}',`);
  assert(
    idx >= 0,
    `API-M.5 parity guard: M.3 projection anchor '${anchorKey}' not found`,
  );
  const start = M3_CODE.lastIndexOf("jsonb_build_object(", idx);
  assert(start >= 0, "API-M.5 parity guard: M.3 projection block not found");
  // Balanced-paren scan from the opening of jsonb_build_object(...).
  let depth = 0;
  let end = -1;
  for (let i = M3_CODE.indexOf("(", start); i < M3_CODE.length; i++) {
    const ch = M3_CODE[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert(end > start, "API-M.5 parity guard: unterminated M.3 projection block");
  const block = M3_CODE.slice(start, end);
  return [...block.matchAll(/'([A-Za-z0-9_]+)',/g)].map((m) => m[1]);
}

const PROJECT_KEYS = [
  "projectId",
  "name",
  "startDate",
  "targetEndDate",
  "actualStartDate",
  "actualEndDate",
  "isBaselined",
];

const PHASE_KEYS = [
  "phaseId",
  "projectId",
  "name",
  "status",
  "phaseType",
  "sortOrder",
  "startDate",
  "targetEndDate",
  "baselineStartDate",
  "baselineEndDate",
  "addedAfterBaseline",
  "actualStartDate",
  "actualEndDate",
  "updatedAt",
];

const TASK_KEYS = [
  "taskId",
  "projectId",
  "phaseId",
  "name",
  "status",
  "priority",
  "taskType",
  "sortOrder",
  "startDate",
  "dueDate",
  "baselineStartDate",
  "baselineEndDate",
  "addedAfterBaseline",
  "actualStartDate",
  "actualEndDate",
  "updatedAt",
];

const DEPENDENCY_KEYS = [
  "dependencyId",
  "sourceType",
  "sourceId",
  "targetType",
  "targetId",
  "dependencyType",
];

// ---------------------------------------------------------------------------
// 4. Project planning parity
// ---------------------------------------------------------------------------

Deno.test("API-M.5 parity — Project planning context is complete in the API projection", () => {
  assertEquals(
    migrationObjectKeys("projectId"),
    PROJECT_KEYS,
    "Project parity dimension: M.3 Project projection keys drifted",
  );
  assertEquals(
    adapterKeySet("EXPECTED_PROJECT_KEYS"),
    PROJECT_KEYS,
    "Project parity dimension: M.4 Project key contract drifted",
  );
});

Deno.test("API-M.5 parity — Project fields map from the canonical Project row", () => {
  for (const mapping of [
    "'projectId', p.id",
    "'startDate', p.start_date",
    "'targetEndDate', p.target_end_date",
    "'actualStartDate', p.actual_start_date",
    "'actualEndDate', p.actual_end_date",
    "'isBaselined', p.is_baselined",
  ]) {
    assertStringIncludes(
      M3_CODE,
      mapping,
      `Project parity dimension: canonical mapping missing (${mapping})`,
    );
  }
  assertStringIncludes(M3_CODE, "FROM public.projects p");
});

Deno.test("API-M.5 parity — Gantt Project planning window and baseline state are canonical", () => {
  assertStringIncludes(
    GANTT_CHART,
    "project.start_date",
    "Project parity dimension: Gantt no longer uses canonical Project start",
  );
  assertStringIncludes(
    GANTT_CHART,
    "project.target_end_date",
    "Project parity dimension: Gantt no longer uses canonical Project target end",
  );
  assertStringIncludes(
    GANTT_CHART,
    "is_baselined",
    "Project parity dimension: Gantt no longer uses canonical Project baseline state",
  );
  // No second planning window / baseline source on the Gantt surface.
  for (const forbidden of ["planningWindow", "apiBaseline", "planning_snapshot"]) {
    assert(
      !GANTT_CHART.includes(forbidden),
      `Project parity dimension: Gantt introduced a second planning source (${forbidden})`,
    );
  }
});

// ---------------------------------------------------------------------------
// 5. Phase parity
// ---------------------------------------------------------------------------

Deno.test("API-M.5 parity — Phase semantic fields are complete on both layers", () => {
  assertEquals(
    migrationObjectKeys("phaseId"),
    PHASE_KEYS,
    "Phase parity dimension: M.3 Phase projection keys drifted",
  );
  assertEquals(
    adapterKeySet("EXPECTED_PHASE_KEYS"),
    PHASE_KEYS,
    "Phase parity dimension: M.4 Phase key contract drifted",
  );
});

Deno.test("API-M.5 parity — Phase fields map from the canonical Phase row", () => {
  for (const mapping of [
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
  ]) {
    assertStringIncludes(
      M3_CODE,
      mapping,
      `Phase parity dimension: canonical mapping missing (${mapping})`,
    );
  }
});

Deno.test("API-M.5 parity — Gantt Phase rows consume the same canonical Phase fields", () => {
  for (const expr of [
    "id: phase.id",
    "name: phase.name",
    "status: phase.status",
    "phase.start_date",
    "phase.target_end_date",
    "baseline_start_date",
    "baseline_end_date",
    "added_after_baseline",
    "actual_start_date",
    "actual_end_date",
    "a.sort_order - b.sort_order",
  ]) {
    assertStringIncludes(
      GANTT_DATA,
      expr,
      `Phase parity dimension: Gantt mapping changed (${expr})`,
    );
  }
});

Deno.test("API-M.5 parity — non-archived Phase inclusion and canonical Phase ordering are aligned", () => {
  assertStringIncludes(
    M3_CODE,
    "ph.is_archived = false",
    "Phase parity dimension: M.3 lost the non-archived Phase inclusion rule",
  );
  assertStringIncludes(
    GANTT_PAGE,
    "is_archived",
    "Phase parity dimension: Gantt lost the non-archived Phase inclusion rule",
  );
  assertStringIncludes(
    M3_CODE,
    "ORDER BY ph.sort_order, ph.id",
    "ordering parity dimension: M.3 Phase order is no longer canonical sort_order + stable tie-breaker",
  );
  // No API-specific Phase sequence field.
  for (const forbidden of [
    "'sequence'",
    "'order'",
    "'apiSortOrder'",
    "'displayOrder'",
    "'rowIndex'",
  ]) {
    assert(
      !M3_CODE.includes(forbidden),
      `ordering parity dimension: API-specific Phase order field introduced (${forbidden})`,
    );
  }
});

// ---------------------------------------------------------------------------
// 6. Task parity
// ---------------------------------------------------------------------------

Deno.test("API-M.5 parity — Task semantic fields are complete on both layers", () => {
  assertEquals(
    migrationObjectKeys("taskId"),
    TASK_KEYS,
    "Task parity dimension: M.3 Task projection keys drifted",
  );
  assertEquals(
    adapterKeySet("EXPECTED_TASK_KEYS"),
    TASK_KEYS,
    "Task parity dimension: M.4 Task key contract drifted",
  );
});

Deno.test("API-M.5 parity — Task fields map from the canonical Task row", () => {
  for (const mapping of [
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
  ]) {
    assertStringIncludes(
      M3_CODE,
      mapping,
      `Task parity dimension: canonical mapping missing (${mapping})`,
    );
  }
});

Deno.test("API-M.5 parity — Task hierarchy, ordering and milestone semantics stay canonical", () => {
  assertStringIncludes(
    M3_CODE,
    "t.phase_id = ANY (_phase_ids)",
    "Task parity dimension: returned Tasks are no longer bounded to returned non-archived Phases",
  );
  assertStringIncludes(
    M3_CODE,
    "t.is_archived = false",
    "Task parity dimension: M.3 lost the non-archived Task inclusion rule",
  );
  assertStringIncludes(
    M3_CODE,
    "ORDER BY ph.sort_order, ph.id, t.sort_order, t.id",
    "ordering parity dimension: M.3 Task sibling order is no longer parent Phase order + canonical sort_order",
  );
  for (const expr of [
    "t.phase_id === phase.id",
    "a.sort_order - b.sort_order",
    "taskType: task.task_type",
    "task.start_date",
    "task.due_date",
  ]) {
    assertStringIncludes(
      GANTT_DATA,
      expr,
      `Task parity dimension: Gantt mapping changed (${expr})`,
    );
  }
  // Milestone semantics remain derived from canonical task_type.
  assertStringIncludes(
    GANTT_UTILS,
    "taskType?: string",
    "task type/milestone parity dimension: Gantt row no longer carries canonical task type",
  );
  assertStringIncludes(
    GANTT_DATA,
    "taskType: task.task_type",
    "task type/milestone parity dimension: Gantt no longer derives milestone semantics from canonical task_type",
  );
});

// ---------------------------------------------------------------------------
// 7. Assignee boundary
// ---------------------------------------------------------------------------

Deno.test("API-M.5 parity — assignee identity remains outside the planning payload", () => {
  const forbidden = [
    "assignee",
    "assignment",
    "task_assignments",
    "raci",
    "stakeholder",
    "profiles",
    "display_name",
  ];
  for (const needle of forbidden) {
    assert(
      !M3_CODE.toLowerCase().includes(needle),
      `assignee boundary: M.3 planning projection referenced ${needle}`,
    );
    assert(
      !ADAPTER_CODE.toLowerCase().includes(needle),
      `assignee boundary: M.4 adapter referenced ${needle}`,
    );
  }
  // The Gantt continues to resolve assignee labels via the separate
  // Workspace-members path, not via planning data.
  assertStringIncludes(
    GANTT_PAGE,
    "useWorkspaceMembers",
    "assignee boundary: Gantt no longer resolves assignees via Workspace membership",
  );
  assertStringIncludes(
    GANTT_DATA,
    "membersMap",
    "assignee boundary: Gantt assignee label path changed",
  );
});

// ---------------------------------------------------------------------------
// 8. Dependency parity
// ---------------------------------------------------------------------------

Deno.test("API-M.5 parity — dependency edges and types remain canonical", () => {
  assertEquals(
    migrationObjectKeys("dependencyId"),
    DEPENDENCY_KEYS,
    "dependency parity dimension: M.3 dependency projection keys drifted",
  );
  assertEquals(
    adapterKeySet("EXPECTED_DEPENDENCY_KEYS"),
    DEPENDENCY_KEYS,
    "dependency parity dimension: M.4 dependency key contract drifted",
  );
  for (const mapping of [
    "'dependencyId', d.id",
    "'sourceType', d.source_type",
    "'sourceId', d.source_id",
    "'targetType', d.target_type",
    "'targetId', d.target_id",
    "'dependencyType', d.dependency_type::text",
  ]) {
    assertStringIncludes(
      M3_CODE,
      mapping,
      `dependency parity dimension: canonical mapping missing (${mapping})`,
    );
  }
  // Both endpoints must be inside the authorized planning set: no cross-Project
  // identifier can be returned.
  assertStringIncludes(
    M3_CODE,
    "d.source_id = ANY (_object_ids)",
    "dependency parity dimension: source endpoint containment lost",
  );
  assertStringIncludes(
    M3_CODE,
    "d.target_id = ANY (_object_ids)",
    "dependency parity dimension: target endpoint containment lost",
  );
  // Endpoint types are validated and same-level semantics preserved in M.4.
  assertStringIncludes(ADAPTER_CODE, "requireEndpointType");
  assertStringIncludes(
    ADAPTER_CODE,
    "if (sourceType !== targetType)",
    "dependency parity dimension: same-level dependency semantics lost",
  );
  for (const forbidden of ["'description'", "'notes'", "'narrative'"]) {
    assert(
      !M3_CODE.includes(forbidden),
      `dependency parity dimension: narrative exposed (${forbidden})`,
    );
  }
  // Gantt dependency lines are derived from canonical source/target objects.
  assertStringIncludes(
    GANTT_DATA,
    "dep.source_id",
    "dependency parity dimension: Gantt line logic no longer uses canonical source id",
  );
  assertStringIncludes(
    GANTT_DATA,
    "dep.target_id",
    "dependency parity dimension: Gantt line logic no longer uses canonical target id",
  );
});

// ---------------------------------------------------------------------------
// 9. M.3 ↔ M.4 cross-layer parity
// ---------------------------------------------------------------------------

Deno.test("API-M.5 parity — M.3 and M.4 top-level payload contracts match exactly", () => {
  const topLevel = ["project", "phases", "tasks", "dependencies"];
  assertEquals(
    adapterKeySet("EXPECTED_TOP_LEVEL_KEYS"),
    topLevel,
    "cross-layer parity: M.4 top-level key contract drifted",
  );
  const returnBlock = M3_CODE.slice(M3_CODE.lastIndexOf("RETURN jsonb_build_object("));
  assertEquals(
    [...returnBlock.matchAll(/'([A-Za-z0-9_]+)', _/g)].map((m) => m[1]),
    topLevel,
    "cross-layer parity: M.3 top-level response keys drifted",
  );
  // M.4 must keep exact-key validation on every level.
  const exactKeyAssertions = [
    ...ADAPTER_CODE.matchAll(/assertExactKeys\(/g),
  ].length;
  assert(
    exactKeyAssertions >= 5,
    `cross-layer parity: M.4 exact-key validation was weakened (${exactKeyAssertions} call sites)`,
  );
});

// ---------------------------------------------------------------------------
// 10. Single-source-of-truth guard
// ---------------------------------------------------------------------------

Deno.test("API-M.5 single source — the M.3 migration is a read-only projection", () => {
  for (const forbidden of [
    "CREATE TABLE",
    "CREATE MATERIALIZED VIEW",
    "INSERT INTO",
    "UPDATE public.",
    "DELETE FROM",
    "ON CONFLICT",
    "TRUNCATE",
  ]) {
    assert(
      !M3_CODE.toUpperCase().includes(forbidden),
      `single source guard: API-M.3 introduced persistence (${forbidden})`,
    );
  }
  assertStringIncludes(
    M3_CODE,
    "STABLE",
    "single source guard: API-M.3 planning read is no longer declared STABLE",
  );
});

Deno.test("API-M.5 single source — no Gantt shadow model exists in the API-M planning path", () => {
  const forbidden = [
    "gantt_rows",
    "gantt_snapshot",
    "planning_cache",
    "planning_snapshot",
    "serialized_hierarchy",
    "barcoordinate",
    "bar_coordinate",
    "pixelposition",
    "pixel_position",
    "timelinecoordinate",
    "zoomlevel",
    "zoom_level",
    "scrollposition",
    "scroll_state",
    "collapsedphaseids",
    "collapsed_state",
    "localstorage",
    "sessionstorage",
    "cache.set",
    "upsert(",
  ];
  for (const [label, source] of [
    ["M.3 migration", M3_CODE],
    ["M.4 adapter", ADAPTER_CODE],
    ["M.4 delegated reader", DELEGATED_CODE],
    ["M.4 route", ROUTE_CODE],
  ] as const) {
    const lowered = source.toLowerCase();
    for (const needle of forbidden) {
      assert(
        !lowered.includes(needle),
        `single source guard: ${label} introduced Gantt shadow/persistence state (${needle})`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 12. Date / baseline / actual semantics summary guard
// ---------------------------------------------------------------------------

Deno.test("API-M.5 parity — planned, baseline and actual date semantics are exposed at every level", () => {
  const projectKeys = migrationObjectKeys("projectId");
  for (const key of [
    "startDate",
    "targetEndDate",
    "actualStartDate",
    "actualEndDate",
    "isBaselined",
  ]) {
    assert(
      projectKeys.includes(key),
      `dates parity dimension: Project ${key} missing`,
    );
  }
  const phaseKeys = migrationObjectKeys("phaseId");
  for (const key of [
    "startDate",
    "targetEndDate",
    "baselineStartDate",
    "baselineEndDate",
    "actualStartDate",
    "actualEndDate",
    "addedAfterBaseline",
  ]) {
    assert(
      phaseKeys.includes(key),
      `baseline/actual parity dimension: Phase ${key} missing`,
    );
  }
  const taskKeys = migrationObjectKeys("taskId");
  for (const key of [
    "startDate",
    "dueDate",
    "baselineStartDate",
    "baselineEndDate",
    "actualStartDate",
    "actualEndDate",
    "addedAfterBaseline",
  ]) {
    assert(
      taskKeys.includes(key),
      `baseline/actual parity dimension: Task ${key} missing`,
    );
  }
  // Gantt row model still carries the same baseline/actual semantics.
  for (const field of [
    "baselineStart",
    "baselineEnd",
    "addedAfterBaseline",
    "actualStart",
    "actualEnd",
  ]) {
    assertStringIncludes(
      GANTT_UTILS,
      field,
      `baseline/actual parity dimension: Gantt row model lost ${field}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 13. Encryption / protected-data guard
// ---------------------------------------------------------------------------

Deno.test("API-M.5 encryption boundary — names are decrypted server-side and narrative stays excluded", () => {
  for (const mapping of [
    "'name', public.btpm_decrypt(p.name, p.organization_id)",
    "'name', public.btpm_decrypt(ph.name, ph.organization_id)",
    "'name', public.btpm_decrypt(t.name, t.organization_id)",
  ]) {
    assertStringIncludes(
      M3_CODE,
      mapping,
      `encryption boundary: server-side decrypt mapping missing (${mapping})`,
    );
  }
  // No new decryption algorithm and no plaintext persistence in the API path.
  for (const forbidden of [
    "CREATE OR REPLACE FUNCTION public.btpm_decrypt",
    "pgp_sym_decrypt",
    "decrypt(",
    "pgcrypto",
  ]) {
    assert(
      !M3_CODE.includes(forbidden) || forbidden === "decrypt(",
      `encryption boundary: API-M.3 introduced its own decryption (${forbidden})`,
    );
  }
  assert(
    !/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.btpm_decrypt/i.test(M3_CODE),
    "encryption boundary: API-M.3 redefined public.btpm_decrypt",
  );
  for (const narrative of [
    "'description'",
    "'notes'",
    "'objectives'",
    "'narrative'",
    "'summary'",
  ]) {
    assert(
      !M3_CODE.includes(narrative),
      `encryption boundary: protected narrative exposed (${narrative})`,
    );
  }
  for (const key of ["description", "notes", "narrative", "objectives"]) {
    assert(
      !adapterKeySet("EXPECTED_PROJECT_KEYS").includes(key) &&
        !adapterKeySet("EXPECTED_PHASE_KEYS").includes(key) &&
        !adapterKeySet("EXPECTED_TASK_KEYS").includes(key),
      `encryption boundary: narrative key ${key} entered the M.4 contract`,
    );
  }
});

// ---------------------------------------------------------------------------
// 14. Presentation state must not become API contract
// ---------------------------------------------------------------------------

Deno.test("API-M.5 parity — Gantt presentation state is not part of the planning payload", () => {
  const presentationKeys = [
    "assigneeLabel",
    "collapsedPhaseIds",
    "statusFilter",
    "hideCompleted",
    "showBaseline",
    "savedView",
    "findQuery",
    "isFindMatch",
    "zoom",
    "todayMarker",
    "axisLabels",
    "viewport",
    "barHeight",
    "barWidth",
    "dragPreview",
    "scrollLeft",
    "color",
  ];
  const contractKeys = new Set([
    ...adapterKeySet("EXPECTED_TOP_LEVEL_KEYS"),
    ...adapterKeySet("EXPECTED_PROJECT_KEYS"),
    ...adapterKeySet("EXPECTED_PHASE_KEYS"),
    ...adapterKeySet("EXPECTED_TASK_KEYS"),
    ...adapterKeySet("EXPECTED_DEPENDENCY_KEYS"),
  ]);
  for (const key of presentationKeys) {
    assert(
      !contractKeys.has(key),
      `presentation boundary: frontend-only state ${key} entered the planning contract`,
    );
    assert(
      !M3_CODE.includes(`'${key}'`),
      `presentation boundary: frontend-only state ${key} entered the M.3 projection`,
    );
  }
});

// ---------------------------------------------------------------------------
// Contract wiring sanity — fail closed if the accepted surface disappears
// ---------------------------------------------------------------------------

Deno.test("API-M.5 parity — the accepted planning read surface is still wired", () => {
  assertStringIncludes(
    ROUTE_CODE,
    '"/v1/projects/:projectid/planning"',
    "wiring guard: planning route path changed",
  );
  assertStringIncludes(
    ROUTE_CODE,
    '"projects.planning.get"',
    "wiring guard: planning route id changed",
  );
  assertStringIncludes(
    ROUTER,
    "PROJECT_PLANNING_ROUTE",
    "wiring guard: planning route is no longer registered in the router",
  );
  assertStringIncludes(
    ADAPTER_CODE,
    "api_v1_get_project_planning",
    "wiring guard: M.4 adapter no longer calls the M.3 database contract",
  );
  assertStringIncludes(
    CONTRACT_DOC,
    "planning:read",
    "wiring guard: accepted API-M.1 contract no longer freezes planning:read",
  );
  assertStringIncludes(
    PLANNING_HOOKS,
    "sort_order",
    "ordering parity dimension: Planning/Gantt hooks no longer read canonical sort_order",
  );
});
