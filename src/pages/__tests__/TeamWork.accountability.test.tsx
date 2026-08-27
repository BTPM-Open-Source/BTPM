import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  TaskAccountabilityInline,
  type AccountabilityStakeholder,
} from "@/components/planning/TaskAccountabilityInline";

/**
 * TAE.9B — Team Work default task-list Requester/Executors column.
 *
 * The Team Work table's People cell renders the same shared
 * `TaskAccountabilityInline` component used by Planning/Board rows, fed by the
 * `requested_by_stakeholder` and `executed_by_stakeholders` fields returned by
 * `get_team_work_overview` (TAE.9A). Tests mirror the exact data path (no
 * additional fetch) without spinning up the full Team Work page.
 */

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

function renderPeopleCell(item: {
  task_name?: string;
  assignee_name?: string | null;
  requested_by_stakeholder?: AccountabilityStakeholder | null;
  executed_by_stakeholders?: AccountabilityStakeholder[] | null;
}) {
  const hasAny =
    item.requested_by_stakeholder ||
    (item.executed_by_stakeholders?.length ?? 0) > 0;
  return render(
    <table>
      <tbody>
        <tr>
          <td>{item.task_name ?? "Task"}</td>
          <td>{item.assignee_name ?? "Unassigned"}</td>
          <td>
            {hasAny ? (
              <TaskAccountabilityInline
                requester={item.requested_by_stakeholder}
                executors={item.executed_by_stakeholders}
              />
            ) : (
              <span>—</span>
            )}
          </td>
        </tr>
      </tbody>
    </table>,
  );
}

describe("TeamWork task-list — TAE.9B People column", () => {
  it("renders an empty-state dash when Requester and Executors are unset", () => {
    renderPeopleCell({ task_name: "T1", assignee_name: "Alice" });
    expect(screen.queryByTestId("task-accountability-inline")).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
    // Preserves existing Assignee and task content.
    expect(screen.getByText("T1")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders Requester only", () => {
    renderPeopleCell({
      requested_by_stakeholder: s("r1", "Rita Requester"),
    });
    const block = screen.getByTestId("task-accountability-inline");
    expect(block.textContent).toContain("Req");
    expect(block.textContent).toContain("Rita Requester");
    expect(block.textContent).not.toContain("Exec");
  });

  it("renders one Executor without a remainder", () => {
    renderPeopleCell({
      executed_by_stakeholders: [s("e1", "Eli Executor")],
    });
    expect(screen.getByText("Eli Executor")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /more executor/i }),
    ).toBeNull();
  });

  it("renders multiple Executors with an accurate +N remainder", () => {
    renderPeopleCell({
      executed_by_stakeholders: [
        s("e1", "Alpha"),
        s("e2", "Bravo"),
        s("e3", "Charlie"),
        s("e4", "Delta"),
      ],
    });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    const more = screen.getByRole("button", {
      name: /Show 2 more executors/i,
    });
    expect(more.textContent).toBe("+2");
    const group = screen
      .getByTestId("task-accountability-inline")
      .querySelector("[aria-label]");
    expect(group?.getAttribute("aria-label")).toContain("Charlie");
    expect(group?.getAttribute("aria-label")).toContain("Delta");
  });

  it("marks External and Former stakeholders without exposing email/user id", () => {
    renderPeopleCell({
      requested_by_stakeholder: s("r1", "Ext Rita", {
        stakeholder_type: "external",
      }),
      executed_by_stakeholders: [s("e1", "Old Eli", { is_removed: true })],
    });
    expect(screen.getByText("Ext")).toBeInTheDocument();
    expect(screen.getByText("Former")).toBeInTheDocument();
  });

  it("propagates role_label via tooltip title", () => {
    renderPeopleCell({
      requested_by_stakeholder: s("r1", "Rita", { role_label: "Sponsor" }),
    });
    const chip = screen.getByText("Rita").closest("span[title]");
    expect(chip?.getAttribute("title")).toContain("Sponsor");
  });

  it("preserves existing Assignee cell content alongside People", () => {
    renderPeopleCell({
      task_name: "Ship module",
      assignee_name: "Alice",
      requested_by_stakeholder: s("r1", "Rita"),
      executed_by_stakeholders: [s("e1", "Eli")],
    });
    expect(screen.getByText("Ship module")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Rita")).toBeInTheDocument();
    expect(screen.getByText("Eli")).toBeInTheDocument();
  });
});
