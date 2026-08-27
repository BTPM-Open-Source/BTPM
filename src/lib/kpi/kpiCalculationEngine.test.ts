/**
 * Wave C1 Step C1.4 — KPI Calculation Engine focused unit tests.
 * Pure tests; no Supabase / network / DOM.
 */

import { describe, it, expect } from "vitest";
import {
  calculateAutomaticKpi,
  calculateAutomaticKpis,
} from "./kpiCalculationEngine";
import type {
  KpiCalculationInput,
  KpiTaskInput,
} from "./kpiCalculationTypes";

const PROJECT_ID = "p1";

function makeInput(overrides: Partial<KpiCalculationInput> = {}): KpiCalculationInput {
  return {
    project: {
      id: PROJECT_ID,
      plannedStartDate: "2026-01-01",
      targetEndDate: "2026-12-31",
      baselineEndDate: "2026-12-31",
      actualEndDate: null,
      status: "active",
    },
    phases: [],
    tasks: [],
    blockers: [],
    risks: [],
    executionUpdates: [],
    snapshotDate: "2026-04-01",
    ...overrides,
  };
}

function task(overrides: Partial<KpiTaskInput> & { id: string }): KpiTaskInput {
  return {
    id: overrides.id,
    projectId: PROJECT_ID,
    phaseId: "ph1",
    taskType: "task",
    status: "active",
    plannedStartDate: "2026-01-01",
    dueDate: "2026-01-31",
    baselineEndDate: null,
    actualEndDate: null,
    isArchived: false,
    ...overrides,
  };
}

describe("task_count_completion_percent", () => {
  it("computes percent over non-cancelled tasks", () => {
    const input = makeInput({
      tasks: [
        task({ id: "t1", status: "completed" }),
        task({ id: "t2", status: "completed" }),
        task({ id: "t3", status: "active" }),
        task({ id: "t4", status: "cancelled" }), // excluded
      ],
    });
    const r = calculateAutomaticKpi("task_count_completion_percent", input);
    expect(r.calculationStatus).toBe("calculated");
    expect(r.valueAmount).toBe(66.67);
  });

  it("returns no_source_data when no non-cancelled tasks", () => {
    const r = calculateAutomaticKpi(
      "task_count_completion_percent",
      makeInput({ tasks: [task({ id: "t1", status: "cancelled" })] }),
    );
    expect(r.calculationStatus).toBe("no_source_data");
    expect(r.valueAmount).toBeNull();
  });
});

describe("duration_weighted_completion_percent", () => {
  it("weights by planned duration", () => {
    const input = makeInput({
      tasks: [
        task({
          id: "t1",
          status: "completed",
          plannedStartDate: "2026-01-01",
          dueDate: "2026-01-10",
        }), // 10 days
        task({
          id: "t2",
          status: "active",
          plannedStartDate: "2026-01-01",
          dueDate: "2026-01-30",
        }), // 30 days
      ],
    });
    const r = calculateAutomaticKpi(
      "duration_weighted_completion_percent",
      input,
    );
    expect(r.calculationStatus).toBe("calculated");
    expect(r.valueAmount).toBe(25); // 10/40
  });

  it("returns insufficient_date_basis when a task lacks dates", () => {
    const input = makeInput({
      tasks: [
        task({ id: "t1", plannedStartDate: null, dueDate: null }),
      ],
    });
    const r = calculateAutomaticKpi(
      "duration_weighted_completion_percent",
      input,
    );
    expect(r.calculationStatus).toBe("insufficient_date_basis");
  });
});

describe("time_elapsed_percent", () => {
  it("returns 0 before planned start", () => {
    const r = calculateAutomaticKpi(
      "time_elapsed_percent",
      makeInput({ snapshotDate: "2025-12-01" }),
    );
    expect(r.calculationStatus).toBe("calculated");
    expect(r.valueAmount).toBe(0);
  });

  it("returns calculated value during window", () => {
    const r = calculateAutomaticKpi(
      "time_elapsed_percent",
      makeInput({ snapshotDate: "2026-04-01" }),
    );
    expect(r.calculationStatus).toBe("calculated");
    expect((r.valueAmount ?? 0) > 0 && (r.valueAmount ?? 0) < 100).toBe(true);
  });

  it("does not clamp above 100 after planned end", () => {
    const r = calculateAutomaticKpi(
      "time_elapsed_percent",
      makeInput({ snapshotDate: "2027-06-01" }),
    );
    expect(r.calculationStatus).toBe("calculated");
    expect((r.valueAmount ?? 0) > 100).toBe(true);
  });

  it("insufficient_date_basis when planned end missing", () => {
    const r = calculateAutomaticKpi(
      "time_elapsed_percent",
      makeInput({
        project: {
          id: PROJECT_ID,
          plannedStartDate: "2026-01-01",
          targetEndDate: null,
          baselineEndDate: null,
          actualEndDate: null,
          status: "active",
        },
      }),
    );
    expect(r.calculationStatus).toBe("insufficient_date_basis");
  });
});

describe("completion_vs_time_gap", () => {
  it("defaults completion_method to task_count when null", () => {
    const input = makeInput({
      tasks: [
        task({ id: "t1", status: "completed" }),
        task({ id: "t2", status: "completed" }),
      ],
      snapshotDate: "2026-07-01",
    });
    const r = calculateAutomaticKpi("completion_vs_time_gap", input);
    expect(r.calculationStatus).toBe("calculated");
    expect(r.completionMethod).toBe("task_count");
  });
});

describe("open_blocker_count and high_impact_active_risk_count", () => {
  it("returns calculated 0 when none match", () => {
    const r1 = calculateAutomaticKpi("open_blocker_count", makeInput());
    expect(r1.calculationStatus).toBe("calculated");
    expect(r1.valueAmount).toBe(0);
    const r2 = calculateAutomaticKpi(
      "high_impact_active_risk_count",
      makeInput(),
    );
    expect(r2.calculationStatus).toBe("calculated");
    expect(r2.valueAmount).toBe(0);
  });

  it("counts in-scope blockers/risks across project/phase/task", () => {
    const input = makeInput({
      phases: [{ id: "ph1", projectId: PROJECT_ID, status: "active" }],
      tasks: [task({ id: "t1" })],
      blockers: [
        { id: "b1", targetType: "project", targetId: PROJECT_ID, status: "open" },
        { id: "b2", targetType: "phase", targetId: "ph1", status: "in_progress" },
        { id: "b3", targetType: "task", targetId: "t1", status: "resolved" },
        { id: "b4", targetType: "task", targetId: "tX", status: "open" }, // out of scope
      ],
      risks: [
        {
          id: "r1",
          targetType: "project",
          targetId: PROJECT_ID,
          status: "open",
          impact: "high",
        },
        {
          id: "r2",
          targetType: "phase",
          targetId: "ph1",
          status: "under_mitigation",
          impact: "critical",
        },
        {
          id: "r3",
          targetType: "project",
          targetId: PROJECT_ID,
          status: "open",
          impact: "medium",
        },
      ],
    });
    expect(calculateAutomaticKpi("open_blocker_count", input).valueAmount).toBe(2);
    expect(
      calculateAutomaticKpi("high_impact_active_risk_count", input).valueAmount,
    ).toBe(2);
  });
});

describe("schedule_signal", () => {
  it("uses provided canonical signal", () => {
    const r = calculateAutomaticKpi(
      "schedule_signal",
      makeInput({ reportingSummary: { scheduleSignal: "behind_schedule" } }),
    );
    expect(r.calculationStatus).toBe("calculated");
    expect(r.stringValue).toBe("behind_schedule");
    expect(r.valueAmount).toBeNull();
  });

  it("returns not_applicable when no canonical signal supplied", () => {
    const r = calculateAutomaticKpi("schedule_signal", makeInput());
    expect(r.calculationStatus).toBe("not_applicable");
    expect(r.stringValue).toBe("no_schedule_basis");
  });
});

describe("days_since_last_project_status_update", () => {
  it("returns no_source_data when no project-scoped execution updates", () => {
    const r = calculateAutomaticKpi(
      "days_since_last_project_status_update",
      makeInput({
        executionUpdates: [
          { id: "u1", targetType: "task", targetId: "t1", updateDate: "2026-03-01" },
        ],
      }),
    );
    expect(r.calculationStatus).toBe("no_source_data");
  });

  it("computes days from latest project-scoped update", () => {
    const r = calculateAutomaticKpi(
      "days_since_last_project_status_update",
      makeInput({
        snapshotDate: "2026-04-10",
        executionUpdates: [
          { id: "u1", targetType: "project", targetId: PROJECT_ID, updateDate: "2026-04-01" },
          { id: "u2", targetType: "project", targetId: PROJECT_ID, updateDate: "2026-03-15" },
        ],
      }),
    );
    expect(r.calculationStatus).toBe("calculated");
    expect(r.valueAmount).toBe(9);
  });
});

describe("calculateAutomaticKpis batch", () => {
  it("returns results in request order", () => {
    const results = calculateAutomaticKpis(
      [
        { calculationKey: "open_blocker_count" },
        { calculationKey: "phase_completion_percent" },
      ],
      makeInput(),
    );
    expect(results.map((r) => r.calculationKey)).toEqual([
      "open_blocker_count",
      "phase_completion_percent",
    ]);
  });
});
