/**
 * PMG-CORR.1.1 — Phase status actions must preserve canonical name/description.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const mutateAsync = vi.fn().mockResolvedValue({ ok: true });

vi.mock("@/hooks/useProjectPlanning", () => ({
  useUpdatePhase: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/executionService", () => ({
  reopenPhase: vi.fn().mockResolvedValue({ ok: true }),
  describeExecutionError: (e: any) => String(e?.message ?? e),
}));

import { PhaseExecutionPanel } from "../PhaseExecutionPanel";

function renderPanel(phase: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PhaseExecutionPanel phase={phase} canEdit={true} />
    </QueryClientProvider>,
  );
}

const basePhase = {
  id: "phase-1",
  project_id: "proj-1",
  name: "Build",
  description: "Configuration and development",
  status: "planned",
  actual_start_date: null,
  actual_end_date: null,
  is_archived: false,
};

describe("PhaseExecutionPanel — PMG-CORR.1.1 status payload", () => {
  beforeEach(() => {
    mutateAsync.mockClear();
  });

  it("Mark active preserves canonical name and description", async () => {
    renderPanel(basePhase);
    fireEvent.click(screen.getByRole("button", { name: /mark active/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toEqual({
      id: "phase-1",
      project_id: "proj-1",
      name: "Build",
      description: "Configuration and development",
      status: "active",
    });
  });

  it("Mark completed preserves canonical name and description", async () => {
    renderPanel({ ...basePhase, status: "active" });
    fireEvent.click(screen.getByRole("button", { name: /mark completed/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toEqual({
      id: "phase-1",
      project_id: "proj-1",
      name: "Build",
      description: "Configuration and development",
      status: "completed",
    });
  });

  it("Null description remains null and property is present", async () => {
    renderPanel({ ...basePhase, description: null });
    fireEvent.click(screen.getByRole("button", { name: /mark active/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mutateAsync.mock.calls[0][0];
    expect(payload).toHaveProperty("description");
    expect(payload.description).toBeNull();
    expect(payload.status).toBe("active");
  });
});
