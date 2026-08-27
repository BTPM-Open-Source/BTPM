/**
 * TAE.8B — Project Move preservation guard for Task Requester/Executors.
 *
 * OSS/current-state contract: task_stakeholder_roles remains scope-agnostic,
 * and admin_move_project_workspace moves canonical parent rows in place while
 * leaving Task Requester/Executor links untouched.
 */
import { describe, it, expect } from "vitest";
import { currentFunction, tableDefinition } from "../../../test/ossSqlContract";

const ROLE_TABLE = tableDefinition("task_stakeholder_roles");
const MOVE_RPC = currentFunction("admin_move_project_workspace");

describe("TAE.8B Project Move preserves Task Requester/Executor links", () => {
  it("task_stakeholder_roles carries no redundant scope columns (single source of truth)", () => {
    expect(ROLE_TABLE).not.toMatch(/\bworkspace_id\b/i);
    expect(ROLE_TABLE).not.toMatch(/\bproject_id\b/i);
    expect(ROLE_TABLE).not.toMatch(/\borganization_id\b/i);
    expect(ROLE_TABLE).toMatch(/\btask_id\b/i);
    expect(ROLE_TABLE).toMatch(/\bproject_stakeholder_id\b/i);
  });

  it("Admin Project Move RPC never mutates Task Requester/Executor links", () => {
    expect(MOVE_RPC).not.toMatch(/task_stakeholder_roles/i);
    expect(MOVE_RPC).not.toMatch(/apply_task_stakeholder_roles_set/i);
  });

  it("Admin Project Move RPC updates tasks.workspace_id in place and preserves task IDs", () => {
    expect(MOVE_RPC).toMatch(
      /UPDATE\s+public\.tasks\s+SET\s+workspace_id\s*=\s*_target_workspace_id\s+WHERE\s+project_id\s*=\s*_project_id/i,
    );
    expect(MOVE_RPC).not.toMatch(/DELETE\s+FROM\s+public\.tasks\b/i);
    expect(MOVE_RPC).not.toMatch(/INSERT\s+INTO\s+public\.tasks\b/i);
  });

  it("Admin Project Move RPC updates project_stakeholders.workspace_id in place and preserves stakeholder IDs", () => {
    expect(MOVE_RPC).toMatch(
      /UPDATE\s+public\.project_stakeholders\s+SET\s+workspace_id\s*=\s*_target_workspace_id\s+WHERE\s+project_id\s*=\s*_project_id/i,
    );
    expect(MOVE_RPC).not.toMatch(/DELETE\s+FROM\s+public\.project_stakeholders\b/i);
    expect(MOVE_RPC).not.toMatch(/INSERT\s+INTO\s+public\.project_stakeholders\b/i);
  });

  it("Admin Project Move RPC updates the Project workspace in place and preserves Project ID", () => {
    expect(MOVE_RPC).toMatch(
      /UPDATE\s+public\.projects[\s\S]{0,500}?SET[\s\S]{0,500}?workspace_id\s*=\s*_target_workspace_id/i,
    );
    expect(MOVE_RPC).not.toMatch(/DELETE\s+FROM\s+public\.projects\b/i);
    expect(MOVE_RPC).not.toMatch(/INSERT\s+INTO\s+public\.projects\b/i);
  });
});
