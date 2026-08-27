/**
 * TAE.9C — Team Work Requester/Executor filter helper tests.
 */
import { describe, it, expect } from "vitest";
import {
  applyAccountabilityFilter,
  deriveExecutorOptions,
  deriveRequesterOptions,
  isAccountabilityFilterActive,
  EMPTY_ACCOUNTABILITY_FILTER,
  type AccountabilityFilterState,
} from "@/lib/teamWork/teamWorkAccountabilityFilter";
import type {
  TeamWorkItem,
  TeamWorkStakeholderRef,
} from "@/hooks/useTeamWorkOverview";

function s(
  id: string,
  name: string,
  overrides: Partial<TeamWorkStakeholderRef> = {},
): TeamWorkStakeholderRef {
  return {
    id,
    display_name: name,
    stakeholder_type: "workspace_member",
    role_label: null,
    is_removed: false,
    ...overrides,
  };
}

function item(
  task_id: string,
  overrides: Partial<TeamWorkItem> = {},
): TeamWorkItem {
  return {
    task_id,
    task_name: task_id,
    task_status: "in_progress",
    task_priority: "medium",
    task_type: null,
    start_date: null,
    due_date: null,
    estimated_hours: null,
    assignee_id: null,
    assignee_name: null,
    assignee_email: null,
    phase_id: null,
    phase_name: null,
    project_id: "p1",
    project_name: "Project One",
    program_id: null,
    program_name: null,
    workspace_id: "w1",
    workspace_name: "WS",
    portfolio_item_id: null,
    portfolio_name: null,
    portfolio_code: null,
    portfolio_lifecycle_state: null,
    portfolio_is_archived: null,
    is_overdue: false,
    is_due_today: false,
    is_upcoming: false,
    is_blocked: false,
    is_unassigned: true,
    is_high_priority: false,
    is_unestimated: true,
    days_overdue: 0,
    days_until_due: null,
    open_blocker_count: 0,
    last_execution_update_at: null,
    is_stale: false,
    reason_flags: [],
    requested_by_stakeholder: null,
    executed_by_stakeholders: [],
    ...overrides,
  };
}

const rita = s("r1", "Rita");
const rob = s("r2", "Rob");
const eli = s("e1", "Eli");
const eve = s("e2", "Eve");
const eddy = s("e3", "Eddy");

// Task shapes reused across tests.
const T1 = item("t1", { requested_by_stakeholder: rita, executed_by_stakeholders: [eli] });
const T2 = item("t2", { requested_by_stakeholder: rob, executed_by_stakeholders: [eli, eve] });
const T3 = item("t3", { requested_by_stakeholder: null, executed_by_stakeholders: [eve, eddy] });
const T4 = item("t4", { requested_by_stakeholder: rita, executed_by_stakeholders: [] });
const T5 = item("t5", { requested_by_stakeholder: null, executed_by_stakeholders: [] });

const ITEMS = [T1, T2, T3, T4, T5];

function withReq(patch: Partial<AccountabilityFilterState>): AccountabilityFilterState {
  return { ...EMPTY_ACCOUNTABILITY_FILTER, ...patch };
}

describe("TAE.9C teamWorkAccountabilityFilter", () => {
  it("no filter values → returns all items unchanged", () => {
    expect(isAccountabilityFilterActive(EMPTY_ACCOUNTABILITY_FILTER)).toBe(false);
    expect(applyAccountabilityFilter(ITEMS, EMPTY_ACCOUNTABILITY_FILTER)).toEqual(ITEMS);
  });

  it("single Requester selection matches only that Requester", () => {
    const out = applyAccountabilityFilter(ITEMS, withReq({ requesterIds: ["r1"] }));
    expect(out.map((i) => i.task_id)).toEqual(["t1", "t4"]);
  });

  it("multiple Requester selections OR within the dimension", () => {
    const out = applyAccountabilityFilter(ITEMS, withReq({ requesterIds: ["r1", "r2"] }));
    expect(out.map((i) => i.task_id)).toEqual(["t1", "t2", "t4"]);
  });

  it("No Requester alone matches only tasks with no Requester", () => {
    const out = applyAccountabilityFilter(ITEMS, withReq({ includeNoRequester: true }));
    expect(out.map((i) => i.task_id)).toEqual(["t3", "t5"]);
  });

  it("No Requester unioned with selected Requesters", () => {
    const out = applyAccountabilityFilter(
      ITEMS,
      withReq({ requesterIds: ["r1"], includeNoRequester: true }),
    );
    expect(out.map((i) => i.task_id)).toEqual(["t1", "t3", "t4", "t5"]);
  });

  it("single Executor selection matches any task containing that executor", () => {
    const out = applyAccountabilityFilter(ITEMS, withReq({ executorIds: ["e1"] }));
    expect(out.map((i) => i.task_id)).toEqual(["t1", "t2"]);
  });

  it("multiple Executor selections OR: any-executor matching", () => {
    const out = applyAccountabilityFilter(ITEMS, withReq({ executorIds: ["e1", "e3"] }));
    expect(out.map((i) => i.task_id)).toEqual(["t1", "t2", "t3"]);
  });

  it("No Executors alone matches only tasks with no executors", () => {
    const out = applyAccountabilityFilter(ITEMS, withReq({ includeNoExecutors: true }));
    expect(out.map((i) => i.task_id)).toEqual(["t4", "t5"]);
  });

  it("No Executors unioned with selected Executors", () => {
    const out = applyAccountabilityFilter(
      ITEMS,
      withReq({ executorIds: ["e1"], includeNoExecutors: true }),
    );
    expect(out.map((i) => i.task_id)).toEqual(["t1", "t2", "t4", "t5"]);
  });

  it("Requester AND Executor dimensions combine with AND", () => {
    const out = applyAccountabilityFilter(
      ITEMS,
      withReq({ requesterIds: ["r1", "r2"], executorIds: ["e1"] }),
    );
    // Requester ∈ {r1,r2} = t1,t2,t4; Executor ∈ {e1} = t1,t2 → intersection t1,t2
    expect(out.map((i) => i.task_id)).toEqual(["t1", "t2"]);
  });

  it("combines with an existing external filter (status pre-filter still ANDs)", () => {
    // Simulate an existing Team Work filter by pre-filtering upstream.
    const preFiltered = ITEMS.filter((i) => i.task_id !== "t2"); // pretend a status filter drops t2
    const out = applyAccountabilityFilter(preFiltered, withReq({ executorIds: ["e1"] }));
    expect(out.map((i) => i.task_id)).toEqual(["t1"]);
  });

  it("reset/clear restores the empty state", () => {
    const active: AccountabilityFilterState = {
      requesterIds: ["r1"],
      executorIds: ["e2"],
      includeNoRequester: true,
      includeNoExecutors: true,
    };
    expect(isAccountabilityFilterActive(active)).toBe(true);
    const cleared = EMPTY_ACCOUNTABILITY_FILTER;
    expect(applyAccountabilityFilter(ITEMS, cleared)).toEqual(ITEMS);
  });

  it("duplicate display names get project context appended", () => {
    const ritaP1 = s("r1", "Rita");
    const ritaP2 = s("r99", "Rita"); // different stakeholder id, same display name
    const items = [
      item("a", { project_name: "Alpha", requested_by_stakeholder: ritaP1 }),
      item("b", { project_name: "Bravo", requested_by_stakeholder: ritaP2 }),
    ];
    const opts = deriveRequesterOptions(items);
    expect(opts.map((o) => o.name)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Rita · Alpha$/),
        expect.stringMatching(/^Rita · Bravo$/),
      ]),
    );
  });

  it("non-duplicate display names have no project suffix and preserve External/Former/role_label", () => {
    const items = [
      item("a", {
        requested_by_stakeholder: s("r1", "Rita", {
          stakeholder_type: "external",
          role_label: "Sponsor",
        }),
      }),
      item("b", {
        executed_by_stakeholders: [s("e1", "Old Eli", { is_removed: true })],
      }),
    ];
    const req = deriveRequesterOptions(items);
    const exec = deriveExecutorOptions(items);
    expect(req[0].name).toBe("Rita (External) — Sponsor");
    expect(exec[0].name).toBe("Old Eli (Former)");
  });
});
