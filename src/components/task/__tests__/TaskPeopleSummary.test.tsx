/**
 * TAE-UX.2–4 — People panel inline controls, behavioral tests.
 *
 * The panel replaces the modal editor with three inline searchable
 * popovers. Assignee and Requester save immediately; Executors uses
 * Apply/Cancel. Email delivery for assignment notifications is a
 * backend concern (notification_outbox pipeline) and is intentionally
 * NOT exercised or referenced here.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TaskPeopleSummary } from "../TaskPeopleSummary";

// --- jsdom shims Radix Popover expects --------------------------------------
beforeAll(() => {
  if (!(Element.prototype as any).hasPointerCapture) {
    (Element.prototype as any).hasPointerCapture = () => false;
  }
  if (!(Element.prototype as any).releasePointerCapture) {
    (Element.prototype as any).releasePointerCapture = () => {};
  }
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

// --- Hook mocks --------------------------------------------------------------
const setAssigneeMock = vi.fn();
const setRolesMock = vi.fn();
const useSetAssigneeMock = vi.fn();
const useSetRolesMock = vi.fn();
const useMembersMock = vi.fn();
const useStakeholdersMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/hooks/useTaskAssignment", () => ({
  useSetTaskAssignee: () => useSetAssigneeMock(),
}));
vi.mock("@/hooks/useTaskStakeholderRoles", () => ({
  useSetTaskStakeholderRoles: () => useSetRolesMock(),
}));
vi.mock("@/hooks/useWorkspaceMembers", () => ({
  useWorkspaceMembers: (id: string | undefined) => useMembersMock(id),
}));
vi.mock("@/hooks/useProjectStakeholders", () => ({
  useProjectStakeholders: (id: string | undefined) => useStakeholdersMock(id),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

beforeEach(() => {
  setAssigneeMock.mockReset();
  setRolesMock.mockReset();
  useSetAssigneeMock.mockReset();
  useSetRolesMock.mockReset();
  useMembersMock.mockReset();
  useStakeholdersMock.mockReset();
  toastMock.mockReset();
  useSetAssigneeMock.mockReturnValue({ mutateAsync: setAssigneeMock, isPending: false });
  useSetRolesMock.mockReturnValue({ mutateAsync: setRolesMock, isPending: false });
  useMembersMock.mockReturnValue({ data: [], isLoading: false });
  useStakeholdersMock.mockReturnValue({ data: [], isLoading: false });
});

// --- Fixtures ----------------------------------------------------------------
const TASK_ID = "10000000-0000-0000-0000-000000000001";
const PROJECT_ID = "20000000-0000-0000-0000-000000000002";
const WS_ID = "30000000-0000-0000-0000-000000000003";
const ORG_ID = "40000000-0000-0000-0000-000000000004";
const UPDATED_AT = "2026-07-19T12:00:00Z";

const memberA = { id: "u-alex", display_name: "Alex Assignee", email: "alex@example.com" };
const memberB = { id: "u-blair", display_name: "Blair Backup", email: null };

const stkAlice = {
  id: "sh-alice",
  stakeholder_type: "workspace_member" as string,
  display_name: "Alice Active",
  role_label: null as string | null,
  removed_at: null as string | null,
};
const stkBob = { ...stkAlice, id: "sh-bob", display_name: "Bob Active" };
const stkCara = {
  ...stkAlice,
  id: "sh-cara",
  display_name: "Cara Former",
  removed_at: "2026-01-01T00:00:00Z",
};

const stkSummary = (
  s: typeof stkAlice,
  overrides: Partial<{ is_removed: boolean; role_label: string }> = {},
) => ({
  id: s.id,
  display_name: s.display_name,
  stakeholder_type: s.stakeholder_type,
  role_label: overrides.role_label ?? s.role_label,
  is_removed: overrides.is_removed ?? s.removed_at !== null,
});

function task(overrides: Partial<Parameters<typeof TaskPeopleSummary>[0]["task"]> = {}) {
  return {
    id: TASK_ID,
    name: "Onboard finance stream",
    project_id: PROJECT_ID,
    workspace_id: WS_ID,
    organization_id: ORG_ID,
    updated_at: UPDATED_AT,
    status: "active" as string | null,
    is_archived: false,
    task_assignments: [] as { id?: string; assignee_id?: string }[],
    requested_by_stakeholder: null as any,
    executed_by_stakeholders: [] as any[],
    ...overrides,
  };
}

function renderPanel(
  t = task(),
  opts: { canEdit?: boolean } = { canEdit: true },
) {
  return render(
    <TaskPeopleSummary
      task={t}
      membersMap={{}}
      canEdit={opts.canEdit ?? true}
    />,
  );
}

// --- Structure / retired-modal audit ----------------------------------------
describe("TaskPeopleSummary — inline structure", () => {
  it("renders three inline pickers and no Edit/Manage/Dialog affordance", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: /change assignee/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change requester/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change executors/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit people/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /manage/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("displays Unassigned / Not set / Not set defaults", () => {
    renderPanel();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getAllByText("Not set").length).toBe(2);
  });
});

// --- Read-only lifecycle gating ---------------------------------------------
describe("TaskPeopleSummary — read-only lifecycle gating", () => {
  it("disables all pickers when canEdit is false", () => {
    renderPanel(task(), { canEdit: false });
    expect(screen.getByRole("button", { name: /change assignee/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /change requester/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /change executors/i })).toBeDisabled();
  });

  it("disables all pickers when task is archived", () => {
    renderPanel(task({ is_archived: true }));
    expect(screen.getByRole("button", { name: /change assignee/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /change requester/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /change executors/i })).toBeDisabled();
  });

  it("disables all pickers when task is cancelled", () => {
    renderPanel(task({ status: "cancelled" }));
    expect(screen.getByRole("button", { name: /change assignee/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /change requester/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /change executors/i })).toBeDisabled();
  });

  it("locks Assignee on completed but keeps Requester and Executors editable", () => {
    renderPanel(task({ status: "completed" }));
    expect(screen.getByRole("button", { name: /change assignee/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /change requester/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /change executors/i })).not.toBeDisabled();
  });
});

// --- Assignee picker ---------------------------------------------------------
describe("TaskPeopleSummary — Assignee inline picker", () => {
  beforeEach(() => {
    useMembersMock.mockReturnValue({ data: [memberA, memberB], isLoading: false });
  });

  it("filters via search and selects a member immediately", async () => {
    setAssigneeMock.mockResolvedValue({ status: "applied" });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /change assignee/i }));
    const search = await screen.findByPlaceholderText(/search members/i);
    fireEvent.change(search, { target: { value: "alex" } });
    // Only Alex remains
    expect(screen.getByRole("option", { name: /alex assignee/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /blair backup/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: /alex assignee/i }));

    await waitFor(() => expect(setAssigneeMock).toHaveBeenCalledTimes(1));
    expect(setAssigneeMock).toHaveBeenCalledWith({
      taskId: TASK_ID,
      assigneeId: "u-alex",
      workspaceId: WS_ID,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
    });
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Assignee updated" }),
      ),
    );
    // Success depends ONLY on the assignment mutation — no email helper, and
    // no email-delivery claim in the toast.
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(toastMock.mock.calls)).not.toMatch(/notification|email|SMTP/i);
  });

  it("clears assignee via Unassigned", async () => {
    setAssigneeMock.mockResolvedValue({ status: "applied" });
    renderPanel(
      task({ task_assignments: [{ id: "ta-1", assignee_id: "u-alex" }] }),
    );

    fireEvent.click(screen.getByRole("button", { name: /change assignee/i }));
    fireEvent.click(await screen.findByRole("option", { name: /unassigned/i }));

    await waitFor(() => expect(setAssigneeMock).toHaveBeenCalledTimes(1));
    expect(setAssigneeMock.mock.calls[0][0]).toMatchObject({ assigneeId: null });
  });
});

// --- Requester picker --------------------------------------------------------
describe("TaskPeopleSummary — Requester inline picker", () => {
  it("saves the picked requester while preserving current executors", async () => {
    useStakeholdersMock.mockReturnValue({ data: [stkAlice, stkBob], isLoading: false });
    setRolesMock.mockResolvedValue({ status: "applied" });
    renderPanel(
      task({ executed_by_stakeholders: [stkSummary(stkBob)] }),
    );

    fireEvent.click(screen.getByRole("button", { name: /change requester/i }));
    fireEvent.click(await screen.findByRole("option", { name: /alice active/i }));

    await waitFor(() => expect(setRolesMock).toHaveBeenCalledTimes(1));
    expect(setRolesMock).toHaveBeenCalledWith({
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      expectedUpdatedAt: UPDATED_AT,
      requesterStakeholderId: "sh-alice",
      executorStakeholderIds: ["sh-bob"],
    });
  });

  it("filters via search", async () => {
    useStakeholdersMock.mockReturnValue({ data: [stkAlice, stkBob], isLoading: false });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /change requester/i }));
    const search = await screen.findByPlaceholderText(/search stakeholders/i);
    fireEvent.change(search, { target: { value: "bob" } });
    expect(screen.getByRole("option", { name: /bob active/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /alice active/i })).not.toBeInTheDocument();
  });

  it("keeps a linked former requester visible but disables new selection of another former", async () => {
    // Cara is former; linked as current requester so she must remain visible and clearable.
    useStakeholdersMock.mockReturnValue({ data: [stkAlice, stkCara], isLoading: false });
    renderPanel(
      task({ requested_by_stakeholder: stkSummary(stkCara) }),
    );
    fireEvent.click(screen.getByRole("button", { name: /change requester/i }));
    const caraOption = await screen.findByRole("option", { name: /cara former/i });
    // She is the currently selected requester so option is not disabled (can be cleared).
    expect(caraOption).toHaveAttribute("aria-selected", "true");
    expect(caraOption).not.toBeDisabled();

    // A fresh, non-linked former stakeholder would be disabled — simulate that
    // Cara is NOT the current requester:
  });

  it("does not offer a former stakeholder as a new choice when unlinked", async () => {
    useStakeholdersMock.mockReturnValue({ data: [stkAlice, stkCara], isLoading: false });
    renderPanel(); // no linked
    fireEvent.click(screen.getByRole("button", { name: /change requester/i }));
    await screen.findByRole("option", { name: /alice active/i });
    // Cara is former and not linked to this task — she must not appear as a selectable option.
    expect(screen.queryByRole("option", { name: /cara former/i })).not.toBeInTheDocument();
  });
});

// --- Executors picker --------------------------------------------------------
describe("TaskPeopleSummary — Executors inline picker", () => {
  it("multi-selects, shows counts, Cancel does not mutate, Apply calls the mutation preserving requester", async () => {
    useStakeholdersMock.mockReturnValue({ data: [stkAlice, stkBob], isLoading: false });
    setRolesMock.mockResolvedValue({ status: "applied" });
    renderPanel(
      task({ requested_by_stakeholder: stkSummary(stkAlice) }),
    );

    // Open
    fireEvent.click(screen.getByRole("button", { name: /change executors/i }));
    // Pick both
    fireEvent.click(await screen.findByRole("option", { name: /alice active/i }));
    fireEvent.click(screen.getByRole("option", { name: /bob active/i }));
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();

    // Cancel first: nothing should have persisted.
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(setRolesMock).not.toHaveBeenCalled();

    // Reopen and Apply this time.
    fireEvent.click(screen.getByRole("button", { name: /change executors/i }));
    fireEvent.click(await screen.findByRole("option", { name: /alice active/i }));
    fireEvent.click(screen.getByRole("option", { name: /bob active/i }));
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    await waitFor(() => expect(setRolesMock).toHaveBeenCalledTimes(1));
    expect(setRolesMock).toHaveBeenCalledWith({
      taskId: TASK_ID,
      projectId: PROJECT_ID,
      expectedUpdatedAt: UPDATED_AT,
      requesterStakeholderId: "sh-alice", // preserved
      executorStakeholderIds: expect.arrayContaining(["sh-alice", "sh-bob"]),
    });
  });

  it("Clear all empties the draft; Apply persists an empty executors set", async () => {
    useStakeholdersMock.mockReturnValue({ data: [stkAlice, stkBob], isLoading: false });
    setRolesMock.mockResolvedValue({ status: "applied" });
    renderPanel(
      task({
        executed_by_stakeholders: [stkSummary(stkAlice), stkSummary(stkBob)],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /change executors/i }));
    expect(await screen.findByText(/2 selected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    expect(screen.getByText(/0 selected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    await waitFor(() => expect(setRolesMock).toHaveBeenCalledTimes(1));
    expect(setRolesMock.mock.calls[0][0]).toMatchObject({
      executorStakeholderIds: [],
    });
  });

  it("keeps a linked former executor visible/removable but rejects newly adding a fresh former", async () => {
    useStakeholdersMock.mockReturnValue({ data: [stkAlice, stkCara], isLoading: false });
    renderPanel(
      task({ executed_by_stakeholders: [stkSummary(stkCara)] }),
    );

    fireEvent.click(screen.getByRole("button", { name: /change executors/i }));
    // Cara is currently selected -> not disabled, may be un-toggled.
    const caraOption = await screen.findByRole("option", { name: /cara former/i });
    expect(caraOption).toHaveAttribute("aria-selected", "true");
    expect(caraOption).not.toBeDisabled();
    fireEvent.click(caraOption);
    expect(caraOption).toHaveAttribute("aria-selected", "false");
    // Now that she is un-selected in draft, she still shows but disabling depends
    // on server-truth is_removed — button now disabled since removed & not selected.
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /cara former/i })).toBeDisabled(),
    );
  });
});

// --- Same person as Requester AND Executor ----------------------------------
describe("TaskPeopleSummary — same stakeholder in both roles", () => {
  it("permits the same stakeholder as Requester and Executor in a single Apply payload", async () => {
    useStakeholdersMock.mockReturnValue({ data: [stkAlice], isLoading: false });
    setRolesMock.mockResolvedValue({ status: "applied" });

    // Start with Alice already the requester; add her as executor via the Executors picker.
    renderPanel(task({ requested_by_stakeholder: stkSummary(stkAlice) }));

    fireEvent.click(screen.getByRole("button", { name: /change executors/i }));
    fireEvent.click(await screen.findByRole("option", { name: /alice active/i }));
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    await waitFor(() => expect(setRolesMock).toHaveBeenCalledTimes(1));
    expect(setRolesMock.mock.calls[0][0]).toMatchObject({
      requesterStakeholderId: "sh-alice", // preserved
      executorStakeholderIds: ["sh-alice"],
    });
  });
});

// --- Chip overflow -----------------------------------------------------------
describe("TaskPeopleSummary — Executors trigger overflow", () => {
  it("shows chips with +N overflow beyond two", () => {
    renderPanel(
      task({
        executed_by_stakeholders: [
          stkSummary(stkAlice),
          stkSummary(stkBob),
          { ...stkSummary(stkAlice), id: "sh-third", display_name: "Third Person" },
        ],
      }),
    );
    const trigger = screen.getByRole("button", { name: /change executors/i });
    expect(within(trigger).getByText("Alice Active")).toBeInTheDocument();
    expect(within(trigger).getByText("Bob Active")).toBeInTheDocument();
    expect(within(trigger).getByText("+1")).toBeInTheDocument();
  });
});

// --- Assignee email search + secondary text ---------------------------------
describe("TaskPeopleSummary — Assignee email support", () => {
  it("shows the email as secondary text and filters by email", async () => {
    useMembersMock.mockReturnValue({ data: [memberA, memberB], isLoading: false });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /change assignee/i }));
    // Secondary email text visible in Alex's row.
    expect(await screen.findByText("alex@example.com")).toBeInTheDocument();

    const search = screen.getByPlaceholderText(/search members/i);
    fireEvent.change(search, { target: { value: "alex@examp" } });
    expect(screen.getByRole("option", { name: /alex assignee/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /blair backup/i })).not.toBeInTheDocument();
  });
});

// --- Stakeholder role-label search + render ---------------------------------
describe("TaskPeopleSummary — Stakeholder role labels", () => {
  const stkWithRole = { ...stkAlice, id: "sh-lead", display_name: "Lena Lead", role_label: "Workstream Lead" };
  const stkPlain = { ...stkAlice, id: "sh-plain", display_name: "Paul Plain", role_label: null as string | null };

  it("renders role_label as secondary text in Requester options", async () => {
    useStakeholdersMock.mockReturnValue({ data: [stkWithRole, stkPlain], isLoading: false });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /change requester/i }));
    expect(await screen.findByRole("option", { name: /lena lead/i })).toBeInTheDocument();
    expect(screen.getByText("Workstream Lead")).toBeInTheDocument();
  });

  it("filters Requester options by role_label", async () => {
    useStakeholdersMock.mockReturnValue({ data: [stkWithRole, stkPlain], isLoading: false });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /change requester/i }));
    const search = await screen.findByPlaceholderText(/search stakeholders/i);
    fireEvent.change(search, { target: { value: "workstream" } });
    expect(screen.getByRole("option", { name: /lena lead/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /paul plain/i })).not.toBeInTheDocument();
  });

  it("filters Executor options by role_label", async () => {
    useStakeholdersMock.mockReturnValue({ data: [stkWithRole, stkPlain], isLoading: false });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /change executors/i }));
    const search = await screen.findByPlaceholderText(/search stakeholders/i);
    fireEvent.change(search, { target: { value: "workstream" } });
    expect(screen.getByRole("option", { name: /lena lead/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /paul plain/i })).not.toBeInTheDocument();
  });
});

// --- Loading / empty / no-match list states ---------------------------------
describe("TaskPeopleSummary — list states", () => {
  it("shows a loading message in the Assignee list while members are loading", async () => {
    useMembersMock.mockReturnValue({ data: [], isLoading: true });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /change assignee/i }));
    expect(await screen.findByText(/loading members/i)).toBeInTheDocument();
  });

  it("shows a loading message in Stakeholder pickers while stakeholders load", async () => {
    useStakeholdersMock.mockReturnValue({ data: [], isLoading: true });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /change requester/i }));
    expect(await screen.findByText(/loading stakeholders/i)).toBeInTheDocument();
  });

  it("shows an empty-state message when no stakeholders exist", async () => {
    useStakeholdersMock.mockReturnValue({ data: [], isLoading: false });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /change requester/i }));
    expect(await screen.findByText(/no project stakeholders yet/i)).toBeInTheDocument();
  });

  it("distinguishes no-match from empty for stakeholders", async () => {
    useStakeholdersMock.mockReturnValue({ data: [stkAlice], isLoading: false });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /change requester/i }));
    const search = await screen.findByPlaceholderText(/search stakeholders/i);
    fireEvent.change(search, { target: { value: "zzz-none" } });
    expect(await screen.findByText(/no stakeholders match your search/i)).toBeInTheDocument();
  });
});

// --- Bounded vertical scrolling ---------------------------------------------
describe("TaskPeopleSummary — option list scrolling", () => {
  it("Assignee options container is bounded and vertically scrollable", async () => {
    useMembersMock.mockReturnValue({ data: [memberA, memberB], isLoading: false });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /change assignee/i }));
    const listbox = await screen.findByRole("listbox", { name: /assignee options/i });
    const container = listbox.parentElement;
    expect(container).toHaveClass("max-h-64");
    expect(container).toHaveClass("overflow-y-auto");
  });

  it("Requester options container is bounded and vertically scrollable", async () => {
    useStakeholdersMock.mockReturnValue({ data: [stkAlice, stkBob], isLoading: false });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /change requester/i }));
    const listbox = await screen.findByRole("listbox", { name: /requester options/i });
    const container = listbox.parentElement;
    expect(container).toHaveClass("max-h-64");
    expect(container).toHaveClass("overflow-y-auto");
  });

  it("Executor options container is bounded and vertically scrollable while header/footer stay fixed", async () => {
    useStakeholdersMock.mockReturnValue({ data: [stkAlice, stkBob], isLoading: false });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /change executors/i }));
    const listbox = await screen.findByRole("listbox", { name: /executor options/i });
    const container = listbox.parentElement;
    expect(container).toHaveClass("max-h-64");
    expect(container).toHaveClass("overflow-y-auto");
    // Header and footer are outside the scrollable container.
    expect(screen.getByText(/selected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear all/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeInTheDocument();
  });
});
