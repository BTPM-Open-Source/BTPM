/**
 * BTPM-BUG-PHASE-PLAN-C1 — Phase Plan editor save ordering.
 *
 * The planning apply RPC advances phases.updated_at, so the generic phase
 * update (optimistic concurrency, cached updated_at) must always run BEFORE
 * the planning apply — never after it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mutateAsync = vi.fn();
const toast = vi.fn();
const previewPhasePlanningChange = vi.fn();
const applyPhasePlanningChange = vi.fn();
const invalidateQueries = vi.fn();
const calls: string[] = [];

vi.mock("@/hooks/useProjectPlanning", () => ({
  useUpdatePhase: () => ({
    mutateAsync: (...a: any[]) => {
      calls.push("update");
      return mutateAsync(...a);
    },
    isPending: false,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/planningService", () => ({
  previewPhasePlanningChange: (...a: any[]) => previewPhasePlanningChange(...a),
  applyPhasePlanningChange: (...a: any[]) => {
    calls.push("apply");
    return applyPhasePlanningChange(...a);
  },
  describeBlockedReason: (r: string) => r,
}));


import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PhasePlanEditor } from "../PhasePlanEditor";

const phase = {
  id: "ph1",
  project_id: "p1",
  name: "Phase One",
  description: "",
  phase_type: "work_item",
  status: "planned",
  start_date: "2026-01-01",
  target_end_date: "2026-01-10",
  updated_at: "2026-01-01T00:00:00Z",
};

const okPreview = { blocked: false, requires_extension: false };

function setup() {
  const client = new QueryClient();
  vi.spyOn(client, "invalidateQueries").mockImplementation(((args: any) => {
    invalidateQueries(args);
    return Promise.resolve();
  }) as any);
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <PhasePlanEditor phase={phase} canEdit />
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
  applyPhasePlanningChange.mockResolvedValue(undefined);
  previewPhasePlanningChange.mockResolvedValue(okPreview);
});

describe("PhasePlanEditor save flow", () => {
  it("dates-only save calls planning preview + apply once and never the generic update", async () => {
    setup();
    fireEvent.change(dateInputs()[1], { target: { value: "2026-01-20" } });
    save();
    await waitFor(() => expect(applyPhasePlanningChange).toHaveBeenCalledTimes(1));
    expect(previewPhasePlanningChange).toHaveBeenCalledTimes(1);
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(calls).toEqual(["apply"]);
    expect(toast).toHaveBeenCalledWith({ title: "Phase saved" });
  });

  it("non-date-only save calls the generic update and no planning calls", async () => {
    setup();
    fireEvent.change(screen.getByDisplayValue("Phase One"), { target: { value: "Renamed" } });
    save();
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(previewPhasePlanningChange).not.toHaveBeenCalled();
    expect(applyPhasePlanningChange).not.toHaveBeenCalled();
  });

  it("combined save runs the generic update first, planning apply second, one toast", async () => {
    setup();
    fireEvent.change(screen.getByDisplayValue("Phase One"), { target: { value: "Renamed" } });
    fireEvent.change(dateInputs()[1], { target: { value: "2026-01-20" } });
    save();
    await waitFor(() => expect(applyPhasePlanningChange).toHaveBeenCalledTimes(1));
    expect(calls).toEqual(["update", "apply"]);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("project extension confirmation for a dates-only change does no generic update", async () => {
    previewPhasePlanningChange.mockResolvedValue({
      blocked: false,
      requires_extension: true,
      parent_project_name: "Project A",
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
    await waitFor(() =>
      expect(applyPhasePlanningChange).toHaveBeenCalledWith("ph1", "2026-01-01", "2026-01-20", true)
    );
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({ title: "Phase saved", description: "Project window extended to fit." });
  });

  it("project extension confirmation for a combined change updates first, applies second", async () => {
    previewPhasePlanningChange.mockResolvedValue({
      blocked: false,
      requires_extension: true,
      parent_project_name: "Project A",
      parent_current_start: "2026-01-01",
      parent_current_end: "2026-01-10",
      parent_proposed_start: "2026-01-01",
      parent_proposed_end: "2026-01-20",
    });
    setup();
    fireEvent.change(screen.getByDisplayValue("Phase One"), { target: { value: "Renamed" } });
    fireEvent.change(dateInputs()[1], { target: { value: "2026-01-20" } });
    save();
    const confirm = await screen.findByRole("button", { name: /extend/i });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(applyPhasePlanningChange).toHaveBeenCalledWith("ph1", "2026-01-01", "2026-01-20", true)
    );
    expect(calls).toEqual(["update", "apply"]);
  });

  it("a genuine concurrency conflict on the generic update blocks the planning apply", async () => {
    mutateAsync.mockRejectedValue(new Error("Phase is out of date. Please refresh and try again."));
    setup();
    fireEvent.change(screen.getByDisplayValue("Phase One"), { target: { value: "Renamed" } });
    fireEvent.change(dateInputs()[1], { target: { value: "2026-01-20" } });
    save();
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Save failed" })));
    expect(applyPhasePlanningChange).not.toHaveBeenCalled();
  });

  it("a successful planning apply refreshes the phase and project caches", async () => {
    setup();
    fireEvent.change(dateInputs()[1], { target: { value: "2026-01-20" } });
    save();
    await waitFor(() => expect(applyPhasePlanningChange).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(3));
    const keys = invalidateQueries.mock.calls.map((c) => c[0].queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["phase-detail", "ph1"],
        ["project-phases", "p1"],
        ["project", "p1"],
      ])
    );
  });
});
