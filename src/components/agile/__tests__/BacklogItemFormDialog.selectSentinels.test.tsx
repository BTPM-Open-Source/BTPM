import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import fs from "node:fs";
import path from "node:path";
import {
  BacklogItemFormDialog,
  NO_PHASE_VALUE,
  NO_SPRINT_VALUE,
  toPersistedOptionalId,
} from "../BacklogItemFormDialog";

vi.mock("@/hooks/useAgileMutations", () => ({
  useCreateBacklogItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateBacklogItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../BacklogItemFormDialog.tsx"),
  "utf8",
);

describe("BacklogItemFormDialog — Radix Select sentinel hotfix", () => {
  it("contains no empty-string SelectItem values", () => {
    expect(SOURCE).not.toContain('<SelectItem value="">');
    expect(SOURCE).not.toMatch(/SelectItem[^>]*value=\{?""/);
  });

  it("renders with phases and sprints present without crashing", () => {
    render(
      <TooltipProvider>
      <BacklogItemFormDialog
        open
        onClose={() => {}}
        projectId="p1"
        workspaceId="w1"
        organizationId="o1"
        phases={[{ id: "phase-1", name: "Discovery" }]}
        sprints={[{ id: "sprint-1", name: "Sprint 1", is_archived: false }]}
        workflowStates={[{ id: "ws-1", name: "To do", category: "todo", is_archived: false }]}
      />
      </TooltipProvider>,
    );

    expect(screen.getByText("New Backlog Item")).toBeInTheDocument();
    expect(screen.getByText("Phase (optional)")).toBeInTheDocument();
    expect(screen.getByText("Sprint (optional)")).toBeInTheDocument();
  });

  it("maps sentinels and empty values to null, real ids through unchanged", () => {
    expect(NO_PHASE_VALUE).not.toBe("");
    expect(NO_SPRINT_VALUE).not.toBe("");
    expect(toPersistedOptionalId(NO_PHASE_VALUE, NO_PHASE_VALUE)).toBeNull();
    expect(toPersistedOptionalId(NO_SPRINT_VALUE, NO_SPRINT_VALUE)).toBeNull();
    expect(toPersistedOptionalId("", NO_PHASE_VALUE)).toBeNull();
    expect(toPersistedOptionalId("phase-1", NO_PHASE_VALUE)).toBe("phase-1");
    expect(toPersistedOptionalId("sprint-1", NO_SPRINT_VALUE)).toBe("sprint-1");
  });
});
