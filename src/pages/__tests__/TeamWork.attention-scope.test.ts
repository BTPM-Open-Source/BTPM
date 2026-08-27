/**
 * TAE.9C.1 — Scope-separation contract for Team Work accountability filters.
 *
 * Verifies (a) the source file has separate `filtered` (standard) and
 * `attentionFiltered` (standard + accountability) collections, (b) summary /
 * By Person / By Project consume `filtered` only, and (c) `sorted` (which
 * feeds the Attention list, bulk selection and reminders) consumes
 * `attentionFiltered`.
 *
 * Also asserts helper semantics remain: with an empty accountability state,
 * `attentionFiltered` equals `filtered`; with an active state it strictly
 * narrows the Attention set without touching the standard-filtered set.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyAccountabilityFilter,
  EMPTY_ACCOUNTABILITY_FILTER,
} from "@/lib/teamWork/teamWorkAccountabilityFilter";
import type {
  TeamWorkItem,
  TeamWorkStakeholderRef,
} from "@/hooks/useTeamWorkOverview";

const SRC = readFileSync(
  resolve(__dirname, "../TeamWork.tsx"),
  "utf8",
);

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
  id: string,
  requester: TeamWorkStakeholderRef | null,
  executors: TeamWorkStakeholderRef[],
): TeamWorkItem {
  return {
    task_id: id,
    task_name: id,
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
    project_name: "P1",
    program_id: null,
    program_name: null,
    workspace_id: "w1",
    workspace_name: "W1",
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
    requested_by_stakeholder: requester,
    executed_by_stakeholders: executors,
  };
}

describe("TAE.9C.1 — Attention/summary scope separation (source contract)", () => {
  it("defines a standard `filtered` collection whose deps exclude accountability state", () => {
    // Match the `filtered` useMemo block and its dependency array.
    const filteredMemo = SRC.match(
      /const filtered = useMemo\(\(\) => \{[\s\S]*?\}, \[([^\]]+)\]\);/,
    );
    expect(filteredMemo, "`filtered` useMemo must exist").not.toBeNull();
    const deps = filteredMemo![1];
    for (const forbidden of [
      "requesterIds",
      "executorIds",
      "includeNoRequester",
      "includeNoExecutors",
    ]) {
      expect(
        deps.includes(forbidden),
        `\`filtered\` deps must not contain ${forbidden}`,
      ).toBe(false);
    }
  });

  it("defines a separate `attentionFiltered` collection that applies accountability filters over `filtered`", () => {
    expect(SRC).toMatch(/const attentionFiltered = useMemo\(/);
    expect(SRC).toMatch(/applyAccountabilityFilter\(\s*filtered\s*,/);
  });

  it("summary, byPerson, byProject consume `filtered` (not `attentionFiltered`)", () => {
    for (const name of ["summary", "byPerson", "byProject"]) {
      const re = new RegExp(
        `const ${name} = useMemo(?:<[^>]+>)?\\(\\(\\) => \\{[\\s\\S]*?\\}, \\[([^\\]]+)\\]\\);`,
      );
      const m = SRC.match(re);
      expect(m, `${name} useMemo must exist`).not.toBeNull();
      const deps = m![1];
      expect(
        deps.includes("filtered"),
        `${name} must depend on filtered`,
      ).toBe(true);
      expect(
        deps.includes("attentionFiltered"),
        `${name} must NOT depend on attentionFiltered`,
      ).toBe(false);
    }
  });

  it("`sorted` (Attention rows / bulk selection source) consumes `attentionFiltered`", () => {
    const m = SRC.match(
      /const sorted = useMemo\(\(\) => \{[\s\S]*?\}, \[([^\]]+)\]\);/,
    );
    expect(m, "`sorted` useMemo must exist").not.toBeNull();
    expect(m![1]).toContain("attentionFiltered");
  });
});

describe("TAE.9C.1 — Accountability helper narrowing semantics", () => {
  const rA = s("rA", "Alice");
  const eB = s("eB", "Bob");
  const items: TeamWorkItem[] = [
    item("t1", rA, [eB]),
    item("t2", null, []),
    item("t3", s("rC", "Carol"), []),
  ];

  it("empty accountability state leaves the Attention set equal to standard-filtered set", () => {
    const out = applyAccountabilityFilter(items, EMPTY_ACCOUNTABILITY_FILTER);
    expect(out.map((x) => x.task_id)).toEqual(items.map((x) => x.task_id));
  });

  it("active Requester selection narrows only the Attention set; the input (standard) set is untouched", () => {
    const before = items.slice();
    const out = applyAccountabilityFilter(items, {
      requesterIds: ["rA"],
      executorIds: [],
      includeNoRequester: false,
      includeNoExecutors: false,
    });
    expect(out.map((x) => x.task_id)).toEqual(["t1"]);
    // Input array reference and contents preserved.
    expect(items).toEqual(before);
  });
});
