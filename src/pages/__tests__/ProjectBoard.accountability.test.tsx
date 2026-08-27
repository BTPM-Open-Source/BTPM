import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskAccountabilityInline, type AccountabilityStakeholder } from "@/components/planning/TaskAccountabilityInline";

/**
 * TAE.7B — Board Task card accountability.
 *
 * The Board card renders `TaskAccountabilityInline` fed by the same task
 * payload fields (`requested_by_stakeholder`, `executed_by_stakeholders`) that
 * the Board's `usePhaseTasks` hook already returns. These tests cover the
 * exact shapes the Board card passes through, mirroring the card's data path
 * without spinning up the full Board page.
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

function renderCardAccountability(task: {
  requested_by_stakeholder?: AccountabilityStakeholder | null;
  executed_by_stakeholders?: AccountabilityStakeholder[] | null;
}) {
  // Mimic the Board card wrapper structure so the inline sits inside a card-like box.
  return render(
    <div className="rounded-xl border p-3">
      <div className="text-sm">Task name</div>
      <div className="mt-2">
        <TaskAccountabilityInline
          requester={task.requested_by_stakeholder}
          executors={task.executed_by_stakeholders}
        />
      </div>
    </div>,
  );
}

describe("Board card — TAE.7B accountability inline", () => {
  it("renders nothing when Requester and Executors are unset", () => {
    renderCardAccountability({});
    expect(screen.queryByTestId("task-accountability-inline")).toBeNull();
  });

  it("renders Requester only", () => {
    renderCardAccountability({
      requested_by_stakeholder: s("r1", "Rita Requester"),
    });
    const block = screen.getByTestId("task-accountability-inline");
    expect(block.textContent).toContain("Req");
    expect(block.textContent).toContain("Rita Requester");
    expect(block.textContent).not.toContain("Exec");
  });

  it("renders one Executor without a remainder chip", () => {
    renderCardAccountability({
      executed_by_stakeholders: [s("e1", "Eli Executor")],
    });
    expect(screen.getByText("Eli Executor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /more executor/i })).toBeNull();
  });

  it("renders multiple Executors with accurate +N remainder", () => {
    renderCardAccountability({
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
    expect(more.textContent).toBe("+2");
    const group = screen.getByTestId("task-accountability-inline").querySelector("[aria-label]");
    expect(group?.getAttribute("aria-label")).toContain("Charlie");
    expect(group?.getAttribute("aria-label")).toContain("Delta");
  });

  it("marks External and Former stakeholders", () => {
    renderCardAccountability({
      requested_by_stakeholder: s("r1", "Ext Rita", { stakeholder_type: "external" }),
      executed_by_stakeholders: [s("e1", "Old Eli", { is_removed: true })],
    });
    expect(screen.getByText("Ext")).toBeInTheDocument();
    expect(screen.getByText("Former")).toBeInTheDocument();
  });

  it("propagates role_label via tooltip title", () => {
    renderCardAccountability({
      requested_by_stakeholder: s("r1", "Rita", { role_label: "Sponsor" }),
    });
    const chip = screen.getByText("Rita").closest("span[title]");
    expect(chip?.getAttribute("title")).toContain("Sponsor");
  });

  it("does not disturb existing card content", () => {
    renderCardAccountability({
      requested_by_stakeholder: s("r1", "Rita"),
    });
    expect(screen.getByText("Task name")).toBeInTheDocument();
    expect(screen.getByText("Rita")).toBeInTheDocument();
  });
});
