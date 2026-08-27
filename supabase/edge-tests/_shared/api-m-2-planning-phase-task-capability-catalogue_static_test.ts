// API-M.2 — Planning + Phase/Task capability catalogue registration.
//
// Focused repository static contract test. Locates the API-M.2 migration by its
// unique marker and asserts, from committed source only:
//   - all 11 API-M capability keys are registered in the canonical catalogue;
//   - planning:read is read + project scoped and separate from projects:read;
//   - the ten Phase/Task capabilities are command + workspace scoped;
//   - route IDs, HTTP methods and route paths match the accepted API-M.1 freeze;
//   - all rows are administrator_assignable = true and lifecycle 'active';
//   - the migration writes no Connected App grant / assignment / enablement row
//     and creates no new tables or schemas.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const MARKER = "API-M.2 — Register Planning + Phase/Task API capability catalogue";

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

interface Row {
  kind: "read" | "command";
  key: string;
  routeId: string;
  method: string;
  path: string;
  scope: "project" | "workspace";
}

const ROWS: readonly Row[] = [
  {
    kind: "read",
    key: "planning:read",
    routeId: "projects.planning.get",
    method: "GET",
    path: "/v1/projects/:projectid/planning",
    scope: "project",
  },
  {
    kind: "command",
    key: "phases:create",
    routeId: "phases.create",
    method: "POST",
    path: "/v1/phases",
    scope: "workspace",
  },
  {
    kind: "command",
    key: "phases:update",
    routeId: "phases.update",
    method: "PATCH",
    path: "/v1/phases/:phaseid",
    scope: "workspace",
  },
  {
    kind: "command",
    key: "phases:reorder",
    routeId: "phases.reorder",
    method: "POST",
    path: "/v1/projects/:projectid/phases/reorder",
    scope: "workspace",
  },
  {
    kind: "command",
    key: "phases:plan",
    routeId: "phases.plan",
    method: "PATCH",
    path: "/v1/phases/:phaseid/planning",
    scope: "workspace",
  },
  {
    kind: "command",
    key: "tasks:create",
    routeId: "tasks.create",
    method: "POST",
    path: "/v1/tasks",
    scope: "workspace",
  },
  {
    kind: "command",
    key: "tasks:update",
    routeId: "tasks.update",
    method: "PATCH",
    path: "/v1/tasks/:taskid",
    scope: "workspace",
  },
  {
    kind: "command",
    key: "tasks:reorder",
    routeId: "tasks.reorder",
    method: "POST",
    path: "/v1/phases/:phaseid/tasks/reorder",
    scope: "workspace",
  },
  {
    kind: "command",
    key: "tasks:plan",
    routeId: "tasks.plan",
    method: "PATCH",
    path: "/v1/tasks/:taskid/planning",
    scope: "workspace",
  },
  {
    kind: "command",
    key: "tasks:assign",
    routeId: "tasks.assign",
    method: "PUT",
    path: "/v1/tasks/:taskid/assignee",
    scope: "workspace",
  },
  {
    kind: "command",
    key: "tasks:transition",
    routeId: "tasks.transition",
    method: "POST",
    path: "/v1/tasks/:taskid/transition",
    scope: "workspace",
  },
] as const;

Deno.test("registers into the canonical catalogue only, idempotently", () => {
  assert(SQL.includes("INSERT INTO public.api_capability_catalogue"));
  assert(SQL.includes("ON CONFLICT (api_version, capability_key) DO UPDATE SET"));
  assert(!/CREATE TABLE/i.test(SQL));
  assert(!/CREATE SCHEMA/i.test(SQL));
  assert(!/\bDELETE\b/i.test(SQL));
  assert(!/DROP /i.test(SQL));
});

Deno.test("all 11 API-M capabilities are registered with the frozen metadata", () => {
  for (const row of ROWS) {
    const tuple =
      `('v1', '${row.kind}', '${row.key}', '${row.routeId}', '${row.method}', '${row.path}', '${row.scope}',`;
    assert(SQL.includes(tuple), `missing or drifted catalogue tuple: ${row.key}`);
  }
  assert(ROWS.length === 11);
});

Deno.test("planning read is project-scoped and separate from projects:read", () => {
  assert(SQL.includes("'planning:read'"));
  assert(!SQL.includes("'projects:read'"));
  assert(
    SQL.includes(
      "'read', 'planning:read', 'projects.planning.get', 'GET', '/v1/projects/:projectid/planning', 'project'",
    ),
  );
  // planning:read is the only 'read' row in this migration.
  assert((SQL.match(/'v1', 'read',/g) ?? []).length === 1);
});

Deno.test("all ten Phase/Task capabilities are command + workspace scoped", () => {
  const commands = ROWS.filter((r) => r.kind === "command");
  assert(commands.length === 10);
  for (const row of commands) {
    assert(row.scope === "workspace");
  }
  assert((SQL.match(/'v1', 'command',/g) ?? []).length === 10);
  // No phase-level or task-level scope types introduced.
  assert(!SQL.includes("'phase',"));
  assert(!SQL.includes("'task',"));
});

Deno.test("every registered row is administrator-assignable and active", () => {
  const occurrences = SQL.match(/true, 'active'\)/g) ?? [];
  assert(occurrences.length === 11, `expected 11 assignable+active rows, saw ${occurrences.length}`);
  assert(!SQL.includes("false, 'active'"));
  assert(!SQL.includes("'retired'"));
});

Deno.test("no Connected App grant, assignment or enablement write", () => {
  for (
    const forbidden of [
      "api_capability_grants",
      "api_client_supported_capabilities",
      "api_organization_client_enablements",
      "api_workspace_client_enablements",
      "api_project_client_enablements",
      "api_clients",
      "api_client_policy_versions",
      "api_rate_limit_profiles",
      "astra",
    ]
  ) {
    assert(
      !SQL.toLowerCase().includes(forbidden.toLowerCase()),
      `forbidden reference in API-M.2 migration: ${forbidden}`,
    );
  }
});
