import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { TaskRow } from "../TaskRow";
import type { AccountabilityStakeholder } from "../TaskAccountabilityInline";

function s(
  id: string,
  name: string,
  overrides: Partial<AccountabilityStakeholder> = {},
): AccountabilityStakeholder {
  return {
    id,
    display_name: name,
    stakeholder_type: "workspace_member",
    role_label: null,
    is_removed: false,
    ...overrides,
  };
}

function baseTask(extra: Record<string, any> = {}) {
  return {
    id: "t1",
    name: "Draft SOW",
    project_id: "p1",
    phase_id: "ph1",
    task_type: "task",
    status: "in_progress",
    priority: "medium",
    start_date: null,
    due_date: null,
    updated_at: "2026-01-01T00:00:00Z",
    task_assignments: [],
    ...extra,
  } as any;
}

function renderRow(taskOverrides: Record<string, any> = {}) {
  return render(
    <MemoryRouter initialEntries={["/workspace/w1/project/p1"]}>
      <Routes>
        <Route
          path="/workspace/:workspaceId/project/:projectId"
          element={
            <TaskRow
              task={baseTask(taskOverrides)}
              dependencies={[]}
              allTasks={[]}
              membersMap={{ "user-1": "Alice Assignee" }}
              isFirst
              isLast
              canEdit={false}
              onMove={() => {}}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TaskRow — TAE.7A accountability inline", () => {
  it("renders no accountability block when Requester and Executors are unset", () => {
    renderRow();
    expect(screen.queryByTestId("task-accountability-inline")).toBeNull();
  });

  it("renders Requester only when no Executors present", () => {
    renderRow({
      requested_by_stakeholder: s("r1", "Rita Requester"),
      executed_by_stakeholders: [],
    });
    const block = screen.getByTestId("task-accountability-inline");
    expect(block.textContent).toContain("Req");
    expect(block.textContent).toContain("Rita Requester");
    expect(block.textContent).not.toContain("Exec");
  });

  it("renders a single Executor without a remainder chip", () => {
    renderRow({
      executed_by_stakeholders: [s("e1", "Eli Executor")],
    });
    expect(screen.getByText("Eli Executor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show .* more executor/i })).toBeNull();
  });

  it("renders multiple Executors with accessible +N remainder", () => {
    renderRow({
      executed_by_stakeholders: [
        s("e1", "Alpha"),
        s("e2", "Bravo"),
        s("e3", "Charlie"),
        s("e4", "Delta"),
      ],
    });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    const more = screen.getByRole("button", { name: /Show 2 more executors/i });
    expect(more).toBeInTheDocument();
    expect(more.textContent).toBe("+2");
    const container = screen.getByTestId("task-accountability-inline");
    const executorsGroup = container.querySelector("[aria-label]");
    expect(executorsGroup?.getAttribute("aria-label")).toContain("Charlie");
    expect(executorsGroup?.getAttribute("aria-label")).toContain("Delta");
  });

  it("distinguishes External and Former stakeholders", () => {
    renderRow({
      requested_by_stakeholder: s("r1", "Ext Rita", {
        stakeholder_type: "external",
      }),
      executed_by_stakeholders: [
        s("e1", "Old Eli", { is_removed: true }),
      ],
    });
    expect(screen.getByText("Ext")).toBeInTheDocument();
    expect(screen.getByText("Former")).toBeInTheDocument();
  });

  it("propagates role_label via tooltip title", () => {
    renderRow({
      requested_by_stakeholder: s("r1", "Rita", {
        role_label: "Sponsor",
      }),
    });
    const chip = screen.getByText("Rita").closest("span[title]");
    expect(chip?.getAttribute("title")).toContain("Sponsor");
  });

  it("keeps Assignee display unchanged alongside accountability", () => {
    renderRow({
      task_assignments: [{ assignee_id: "user-1" }],
      requested_by_stakeholder: s("r1", "Rita"),
    });
    expect(screen.getByText("Alice Assignee")).toBeInTheDocument();
    expect(screen.getByText("Rita")).toBeInTheDocument();
  });
});
