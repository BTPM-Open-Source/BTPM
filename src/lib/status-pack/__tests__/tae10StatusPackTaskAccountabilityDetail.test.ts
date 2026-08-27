/**
 * TAE.10 — Status Pack Task Accountability Detail
 *
 * Verifies that the pure `deriveRoadmapStatusPackTeamWorkDetailAnnex` helper
 * plumbs the Requester (`requested_by_stakeholder`) and Executors
 * (`executed_by_stakeholders`) resolved by `get_team_work_overview` (TAE.9A)
 * into each Status Pack detail row without inventing, altering or leaking
 * data. Also verifies:
 *
 *   • Sanitization drops refs missing an `id`.
 *   • Duplicate Executor ids are de-duplicated.
 *   • Executors are ordered by `display_name` (case-insensitive), then `id`.
 *   • `role_label` and `is_removed` are preserved for downstream UI.
 *   • Rows with unset Requester/Executors expose safe defaults (`null` / `[]`).
 *   • Executive counters, sorting and display cap are unchanged by this data.
 */

import { describe, expect, it } from "vitest";
import {
  deriveRoadmapStatusPackTeamWorkDetailAnnex,
  type RoadmapTeamWorkItemInput,
  type RoadmapTeamWorkOverviewInput,
} from "@/lib/status-pack/roadmapStatusPackData";
import type { RoadmapProject } from "@/hooks/useRoadmapData";

const PROJECT: RoadmapProject = {
  id: "proj-1",
  name: "Alpha",
  status: "on_track",
  organization_id: "org-1",
  workspace_id: "ws-1",
} as unknown as RoadmapProject;

function baseItem(
  overrides: Partial<RoadmapTeamWorkItemInput> = {},
): RoadmapTeamWorkItemInput {
  return {
    task_id: "task-1",
    task_name: "Do the thing",
    task_status: "in_progress",
    task_priority: "medium",
    start_date: null,
    due_date: "2026-08-01",
    assignee_id: null,
    assignee_name: null,
    phase_id: null,
    phase_name: null,
    project_id: "proj-1",
    project_name: "Alpha",
    workspace_id: "ws-1",
    workspace_name: "WS",
    program_id: null,
    program_name: null,
    is_overdue: false,
    is_due_today: false,
    is_upcoming: true,
    is_blocked: false,
    is_unassigned: true,
    is_high_priority: false,
    is_unestimated: false,
    days_overdue: 0,
    days_until_due: 5,
    open_blocker_count: 0,
    ...overrides,
  };
}

describe("TAE.10 — Status Pack Task Accountability Detail", () => {
  it("passes Requester + normalized/sorted Executors into each row", () => {
    const items: RoadmapTeamWorkItemInput[] = [
      baseItem({
        task_id: "t1",
        requested_by_stakeholder: {
          id: "sh-req",
          display_name: "Alice Requester",
          stakeholder_type: "internal",
          role_label: "Sponsor",
          is_removed: false,
        },
        executed_by_stakeholders: [
          {
            id: "sh-x2",
            display_name: "charlie",
            stakeholder_type: "external",
            role_label: null,
            is_removed: false,
          },
          {
            id: "sh-x1",
            display_name: "Bob",
            stakeholder_type: "internal",
            role_label: "Lead",
            is_removed: true,
          },
          // duplicate id → dropped
          {
            id: "sh-x1",
            display_name: "Bob Duplicate",
            stakeholder_type: "internal",
            role_label: null,
            is_removed: false,
          },
          // missing id → dropped
          {
            id: "",
            display_name: "Ghost",
            stakeholder_type: null,
            role_label: null,
            is_removed: null,
          },
        ],
      }),
    ];
    const ov: RoadmapTeamWorkOverviewInput = { items };
    const map = new Map([[PROJECT.id, ov]]);

    const annex = deriveRoadmapStatusPackTeamWorkDetailAnnex({
      scopedProjects: [PROJECT],
      overviewByProjectId: map,
      failedProjectIds: [],
      isError: false,
    });

    expect(annex.items).toHaveLength(1);
    const row = annex.items[0];

    expect(row.requestedByStakeholder).toEqual({
      id: "sh-req",
      display_name: "Alice Requester",
      stakeholder_type: "internal",
      role_label: "Sponsor",
      is_removed: false,
    });

    // De-duplicated (sh-x1 kept once), Ghost dropped, and sorted case-insensitive.
    expect(row.executedByStakeholders.map((e) => e.id)).toEqual([
      "sh-x1",
      "sh-x2",
    ]);
    // Former + role_label preserved.
    const bob = row.executedByStakeholders.find((e) => e.id === "sh-x1")!;
    expect(bob.is_removed).toBe(true);
    expect(bob.role_label).toBe("Lead");
    // External preserved.
    const charlie = row.executedByStakeholders.find((e) => e.id === "sh-x2")!;
    expect(charlie.stakeholder_type).toBe("external");
  });

  it("defaults to null Requester and empty Executors when unset", () => {
    const items: RoadmapTeamWorkItemInput[] = [baseItem({ task_id: "t2" })];
    const annex = deriveRoadmapStatusPackTeamWorkDetailAnnex({
      scopedProjects: [PROJECT],
      overviewByProjectId: new Map([[PROJECT.id, { items }]]),
      failedProjectIds: [],
      isError: false,
    });
    const row = annex.items[0];
    expect(row.requestedByStakeholder).toBeNull();
    expect(row.executedByStakeholders).toEqual([]);
  });

  it("does not alter executive counters when stakeholder fields are present", () => {
    const items: RoadmapTeamWorkItemInput[] = [
      baseItem({
        task_id: "t3",
        is_overdue: true,
        days_overdue: 4,
        is_unassigned: false,
        requested_by_stakeholder: {
          id: "sh-r",
          display_name: "R",
          stakeholder_type: "internal",
          role_label: null,
          is_removed: false,
        },
        executed_by_stakeholders: [
          {
            id: "sh-e",
            display_name: "E",
            stakeholder_type: "internal",
            role_label: null,
            is_removed: false,
          },
        ],
      }),
    ];
    const annex = deriveRoadmapStatusPackTeamWorkDetailAnnex({
      scopedProjects: [PROJECT],
      overviewByProjectId: new Map([[PROJECT.id, { items }]]),
      failedProjectIds: [],
      isError: false,
    });
    expect(annex.overdueCount).toBe(1);
    expect(annex.unassignedCount).toBe(0);
    expect(annex.rowsShown).toBe(1);
    expect(annex.totalAvailable).toBe(1);
  });
});
