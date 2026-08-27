/**
 * BTPM-BUG-TASK-PLAN-C1 — Task Plan editor save ordering.
 *
 * The planning apply RPC advances tasks.updated_at, so the generic task
 * update (optimistic concurrency, cached updated_at) must always run BEFORE
 * the planning apply — never after it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mutateAsync = vi.fn();
const toast = vi.fn();
const previewTaskPlanningChange = vi.fn();
const applyTaskPlanningChange = vi.fn();
const calls: string[] = [];

vi.mock("@/hooks/useProjectPlanning", () => ({
  useUpdateTask: () => ({
    mutateAsync: (...a: any[]) => {
      calls.push("update");
      return mutateAsync(...a);
    },
    isPending: false,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/planningService", () => ({
  previewTaskPlanningChange: (...a: any[]) => previewTaskPlanningChange(...a),
  applyTaskPlanningChange: (...a: any[]) => {
    calls.push("apply");
    return applyTaskPlanningChange(...a);
  },
  describeBlockedReason: (r: string) => r,
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TaskPlanEditor } from "../TaskPlanEditor";

const task = {
  id: "t1",
  project_id: "p1",
  name: "Task One",
  description: "",
  priority: "medium",
  status: "planned",
  task_type: "work_item",
  start_date: "2026-01-01",
  due_date: "2026-01-10",
  estimated_hours: null,
  updated_at: "2026-01-01T00:00:00Z",
};

const okPreview = { blocked: false, requires_extension: false };

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <TaskPlanEditor task={task} canEdit />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function dateInputs() {
  return Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
}

const save = () => fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue(undefined);
  applyTaskPlanningChange.mockResolvedValue(undefined);
  previewTaskPlanningChange.mockResolvedValue(okPreview);
});

describe("TaskPlanEditor save flow", () => {
  it("dates-only save calls planning apply once and never the generic update", async () => {
    setup();
    fireEvent.change(dateInputs()[1], { target: { value: "2026-01-20" } });
    save();
    await waitFor(() => expect(applyTaskPlanningChange).toHaveBeenCalledTimes(1));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(calls).toEqual(["apply"]);
    expect(toast).toHaveBeenCalledWith({ title: "Task saved" });
  });

  it("non-date-only save calls the generic update and no planning apply", async () => {
    setup();
    fireEvent.change(screen.getByDisplayValue("Task One"), { target: { value: "Renamed" } });
    save();
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(previewTaskPlanningChange).not.toHaveBeenCalled();
    expect(applyTaskPlanningChange).not.toHaveBeenCalled();
  });

  it("combined save runs the generic update first, planning apply second", async () => {
    setup();
    fireEvent.change(screen.getByDisplayValue("Task One"), { target: { value: "Renamed" } });
    fireEvent.change(dateInputs()[1], { target: { value: "2026-01-20" } });
    save();
    await waitFor(() => expect(applyTaskPlanningChange).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(["update", "apply"]);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("parent extension confirmation for a dates-only change does no generic update", async () => {
    previewTaskPlanningChange.mockResolvedValue({
      blocked: false,
      requires_extension: true,
      parent_phase_name: "Phase A",
      parent_current_start: "2026-01-01",
      parent_current_end: "2026-01-10",
      parent_proposed_start: "2026-01-01",
      parent_proposed_end: "2026-01-20",
    });
    setup();
    fireEvent.change(dateInputs()[1], { target: { value: "2026-01-20" } });
    save();
    const confirm = await screen.findByRole("button", { name: /extend/i });
    fireEvent.click(confirm);
    await waitFor(() => expect(applyTaskPlanningChange).toHaveBeenCalledWith("t1", "2026-01-01", "2026-01-20", true));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ title: "Task saved", description: "Phase window extended to fit." });
  });

  it("a genuine concurrency conflict on the generic update blocks the planning apply", async () => {
    mutateAsync.mockRejectedValue(new Error("This Task was updated elsewhere. Please refresh and try again."));
    setup();
    fireEvent.change(screen.getByDisplayValue("Task One"), { target: { value: "Renamed" } });
    fireEvent.change(dateInputs()[1], { target: { value: "2026-01-20" } });
    save();
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Save failed" })));
    expect(applyTaskPlanningChange).not.toHaveBeenCalled();
  });
});
