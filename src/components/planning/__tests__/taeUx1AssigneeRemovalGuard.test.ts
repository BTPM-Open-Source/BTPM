/**
 * TAE-UX.1 — Static guard proving duplicate Assignee controls have been removed
 * from the Task Detail header and TaskPlanEditor. The People panel is the only
 * place for Assignee, Requested by, and Executed by.
 *
 * Non-goals: does NOT change TaskPeopleSummary or add inline pickers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");
const TASK_DETAIL = readFileSync(join(ROOT, "src/pages/TaskDetail.tsx"), "utf8");
const TASK_PLAN_EDITOR = readFileSync(
  join(ROOT, "src/components/planning/TaskPlanEditor.tsx"),
  "utf8",
);

describe("TAE-UX.1 Task Detail identity header", () => {
  it("does not render an Assignee label in the header row", () => {
    // The removed line was:
    //   <span className="text-muted-foreground">Assignee: {assigneeName}</span>
    expect(TASK_DETAIL).not.toMatch(/>\s*Assignee:\s*\{/);
    expect(TASK_DETAIL).not.toMatch(/Assignee:\s*\{assigneeName\}/);
  });
});

describe("TAE-UX.1 TaskPlanEditor — Assignee control and mutations removed", () => {
  it("does not import the assignee mutation hook", () => {
    expect(TASK_PLAN_EDITOR).not.toMatch(/useSetTaskAssignee/);
    expect(TASK_PLAN_EDITOR).not.toMatch(/useTaskAssignment/);
  });

  it("does not import the workspace-members query", () => {
    expect(TASK_PLAN_EDITOR).not.toMatch(/useWorkspaceMembers/);
  });

  it("does not import the assignee notification helper", () => {
    expect(TASK_PLAN_EDITOR).not.toMatch(/notifyAssignee/);
    expect(TASK_PLAN_EDITOR).not.toMatch(/notifyAssigneeOfTaskAssignment/);
  });

  it("does not declare any Assignee state or field", () => {
    expect(TASK_PLAN_EDITOR).not.toMatch(/assigneeId/);
    expect(TASK_PLAN_EDITOR).not.toMatch(/currentAssigneeId/);
    expect(TASK_PLAN_EDITOR).not.toMatch(/selectedAssignee/);
    expect(TASK_PLAN_EDITOR).not.toMatch(/setTaskAssignee/);
    expect(TASK_PLAN_EDITOR).not.toMatch(/task_assignments/);
    // No Assignee <FieldLabel> block remains.
    expect(TASK_PLAN_EDITOR).not.toMatch(/>Assignee</);
  });

  it("preserves the non-Assignee Plan field save contract", () => {
    // Core Plan fields still present:
    for (const field of [
      "name",
      "description",
      "priority",
      "status",
      "task_type",
      "start_date",
      "due_date",
      "estimated_hours",
    ]) {
      expect(TASK_PLAN_EDITOR).toContain(field);
    }
    // Date preview / extension flow preserved:
    expect(TASK_PLAN_EDITOR).toMatch(/previewTaskPlanningChange/);
    expect(TASK_PLAN_EDITOR).toMatch(/applyTaskPlanningChange/);
    expect(TASK_PLAN_EDITOR).toMatch(/ParentExtensionConfirmDialog/);
    // Save toast still fires:
    expect(TASK_PLAN_EDITOR).toMatch(/title:\s*"Task saved"/);
  });
});
