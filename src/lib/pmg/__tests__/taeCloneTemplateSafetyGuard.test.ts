/**
 * TAE.8A — Clone and template safety guard for Task Requester/Executors.
 *
 * OSS/current-state contract: Task accountability relationships are never
 * copied by clone/template paths. Frontend clone/template surfaces are scanned
 * directly, while server-side behaviour is checked against the exact current
 * function definitions in the clean database baseline rather than deleted
 * historical migration files.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { currentFunction } from "../../../test/ossSqlContract";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

const SOURCE_PATHS = [
  "src/components/planning/CloneTaskDialog.tsx",
  "src/components/planning/ClonePhaseDialog.tsx",
  "src/components/project/NewProjectDialog.tsx",
  "src/lib/cloneWideningService.ts",
  "src/hooks/useProjectAdoption.ts",
  "src/components/adoption/AddTasksFromTemplatePanel.tsx",
  "src/pages/AdminProjectMoves.tsx",
] as const;

const SERVER_FUNCTIONS = [
  "clone_phase_in_project",
  "clone_task_in_phase",
  "instantiate_project_from_template",
  "add_adoption_template_tasks_to_existing_plan",
  "generate_project_adoption_plan_from_saved_template",
  "generate_project_adoption_plan_from_template",
] as const;

const FORBIDDEN_IDENTIFIERS = [
  "task_stakeholder_roles",
  "task_stakeholder_role_type",
  "apply_task_stakeholder_roles_set",
  "requested_by_stakeholder",
  "executed_by_stakeholders",
] as const;

function assertNoAccountabilityCopy(content: string, source: string): void {
  const hits = FORBIDDEN_IDENTIFIERS.filter((id) => content.includes(id));
  expect(
    hits,
    `TAE.8A violation in ${source}: clone/template paths must not read or write ` +
      `Task Requester/Executor state. Forbidden identifiers found: ${hits.join(", ")}. ` +
      `Cloned or template-created Tasks must start with empty Requester and Executor sets.`,
  ).toEqual([]);
}

describe("TAE.8A clone/template safety for Task Requester/Executors", () => {
  it("covers frontend and current server-side clone/template surfaces", () => {
    expect(SOURCE_PATHS.length).toBeGreaterThan(0);
    expect(SERVER_FUNCTIONS.length).toBeGreaterThan(0);
  });

  it("all inspected repository source paths exist on disk", () => {
    const missing = SOURCE_PATHS.filter(
      (p) => !existsSync(resolve(REPO_ROOT, p)),
    );
    expect(missing).toEqual([]);
  });

  it.each(SOURCE_PATHS)(
    "%s does not reference Task Requester/Executor persistence identifiers",
    (relPath) => {
      assertNoAccountabilityCopy(
        readFileSync(resolve(REPO_ROOT, relPath), "utf8"),
        relPath,
      );
    },
  );

  it.each(SERVER_FUNCTIONS)(
    "public.%s does not copy Task Requester/Executor state",
    (functionName) => {
      assertNoAccountabilityCopy(
        currentFunction(functionName),
        `public.${functionName}`,
      );
    },
  );
});
