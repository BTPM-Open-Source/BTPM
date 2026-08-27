/**
 * BTPM — Wave C1, Step C1.8
 * Focused tests for the pure KPI readiness helper.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateKpiReadiness,
  formatKpiSnapshotValue,
  summarizeReadiness,
  type KpiReadinessDefinition,
  type KpiReadinessSnapshot,
} from "./kpiReadiness";

const REF = "2026-04-15"; // mid-April 2026

function makeDef(over: Partial<KpiReadinessDefinition> = {}): KpiReadinessDefinition {
  return {
    id: "kpi-1",
    name: "Test KPI",
    source_mode: "manual",
    value_type: "number",
    cadence: "monthly",
    is_archived: false,
    ...over,
  };
}

function makeSnap(over: Partial<KpiReadinessSnapshot>): KpiReadinessSnapshot {
  return {
    id: over.id ?? "snap-1",
    kpi_definition_id: over.kpi_definition_id ?? "kpi-1",
    snapshot_date: over.snapshot_date ?? "2026-04-10",
    period_start: over.period_start ?? "2026-04-01",
    period_end: over.period_end ?? "2026-04-30",
    source_mode: over.source_mode ?? "manual",
    value_type: over.value_type ?? "number",
    value_amount: over.value_amount ?? 5,
    string_value: over.string_value ?? null,
    calculation_status: over.calculation_status ?? "manual_entry",
    generated_by: over.generated_by ?? "user",
    comment: over.comment ?? null,
    action_plan: over.action_plan ?? null,
    calculation_key: over.calculation_key ?? null,
    formula_version: over.formula_version ?? null,
    created_at: over.created_at ?? "2026-04-10T10:00:00Z",
  };
}

describe("evaluateKpiReadiness — status", () => {
  it("returns archived for archived KPI regardless of snapshots", () => {
    const r = evaluateKpiReadiness(makeDef({ is_archived: true }), [makeSnap({})], REF);
    expect(r.readinessStatus).toBe("archived");
  });

  it("returns manual_only for manual_only cadence with no snapshot", () => {
    const r = evaluateKpiReadiness(makeDef({ cadence: "manual_only" }), [], REF);
    expect(r.readinessStatus).toBe("manual_only");
  });

  it("returns up_to_date for manual_only cadence WITH any snapshot", () => {
    const r = evaluateKpiReadiness(
      makeDef({ cadence: "manual_only" }),
      [makeSnap({ period_start: null, period_end: null })],
      REF,
    );
    expect(r.readinessStatus).toBe("up_to_date");
  });

  it("returns no_snapshot when periodic KPI has no snapshots", () => {
    const r = evaluateKpiReadiness(makeDef({ cadence: "monthly" }), [], REF);
    expect(r.readinessStatus).toBe("no_snapshot");
  });

  it("returns up_to_date when latest snapshot covers the current period", () => {
    const r = evaluateKpiReadiness(makeDef({ cadence: "monthly" }), [makeSnap({})], REF);
    expect(r.readinessStatus).toBe("up_to_date");
    expect(r.hasCurrentPeriodSnapshot).toBe(true);
  });

  it("returns due when latest snapshot is from a prior period", () => {
    const r = evaluateKpiReadiness(
      makeDef({ cadence: "monthly" }),
      [
        makeSnap({
          snapshot_date: "2026-03-15",
          period_start: "2026-03-01",
          period_end: "2026-03-31",
        }),
      ],
      REF,
    );
    expect(r.readinessStatus).toBe("due");
    expect(r.staleReason).toMatch(/previous monthly period/);
  });

  it("returns not_configured when cadence is unknown", () => {
    const r = evaluateKpiReadiness(makeDef({ cadence: "weird" as any }), [], REF);
    expect(r.readinessStatus).toBe("not_configured");
  });
});

describe("evaluateKpiReadiness — reportability", () => {
  it("numeric snapshot with value 0 IS reportable (not misleading)", () => {
    const r = evaluateKpiReadiness(
      makeDef({}),
      [makeSnap({ value_amount: 0, calculation_status: "calculated" })],
      REF,
    );
    expect(r.reportable).toBe(true);
    expect(r.latestValueDisplay).toBe("0");
  });

  it("no_source_data snapshot is NOT reportable", () => {
    const r = evaluateKpiReadiness(
      makeDef({}),
      [makeSnap({ value_amount: null, calculation_status: "no_source_data" })],
      REF,
    );
    expect(r.reportable).toBe(false);
    expect(r.reportableReason).toMatch(/no_source_data/);
    expect(r.latestValueDisplay).toBeNull();
  });

  it("text KPI: empty string is NOT reportable", () => {
    const r = evaluateKpiReadiness(
      makeDef({ value_type: "text" }),
      [makeSnap({ value_type: "text", value_amount: null, string_value: "", calculation_status: "calculated" })],
      REF,
    );
    expect(r.reportable).toBe(false);
  });

  it("schedule_signal returning no_schedule_basis is NOT reportable", () => {
    const r = evaluateKpiReadiness(
      makeDef({ value_type: "text", calculation_key: "schedule_signal" }),
      [makeSnap({
        value_type: "text",
        value_amount: null,
        string_value: "no_schedule_basis",
        calculation_status: "calculated",
        calculation_key: "schedule_signal",
      })],
      REF,
    );
    expect(r.reportable).toBe(false);
    expect(r.reportableReason).toMatch(/schedule_signal/);
  });
});

describe("formatKpiSnapshotValue", () => {
  it("renders percent with %", () => {
    expect(
      formatKpiSnapshotValue({
        value_amount: 42.5,
        string_value: null,
        value_type: "percent",
        calculation_status: "calculated",
      }),
    ).toBe("42.5%");
  });

  it("returns null for no_source_data even if amount is 0", () => {
    expect(
      formatKpiSnapshotValue({
        value_amount: 0,
        string_value: null,
        value_type: "number",
        calculation_status: "no_source_data",
      }),
    ).toBeNull();
  });

  it("renders text", () => {
    expect(
      formatKpiSnapshotValue({
        value_amount: null,
        string_value: "on_track",
        value_type: "text",
        calculation_status: "calculated",
      }),
    ).toBe("on_track");
  });
});

describe("summarizeReadiness", () => {
  it("rolls counts up correctly", () => {
    const results = [
      evaluateKpiReadiness(makeDef({ id: "a", cadence: "manual_only" }), [], REF),
      evaluateKpiReadiness(makeDef({ id: "b", cadence: "monthly" }), [], REF),
      evaluateKpiReadiness(
        makeDef({ id: "c", cadence: "monthly" }),
        [makeSnap({ kpi_definition_id: "c" })],
        REF,
      ),
      evaluateKpiReadiness(makeDef({ id: "d", is_archived: true }), [], REF),
    ];
    const s = summarizeReadiness(results);
    expect(s.total).toBe(4);
    expect(s.manualOnly).toBe(1);
    expect(s.noSnapshot).toBe(1);
    expect(s.upToDate).toBe(1);
    expect(s.archived).toBe(1);
    // Archived is excluded from reportable counts.
    expect(s.reportable + s.notReportable).toBe(3);
  });
});
