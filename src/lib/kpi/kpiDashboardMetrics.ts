/**
 * BTPM — Wave C1, Step C1.7
 * Dashboard-facing KPI consumption helper.
 *
 * Purpose:
 *   Provide dashboard/reporting surfaces a single, formula-free way to
 *   consume the canonical KPI Engine (C1.3/C1.4) WITHOUT duplicating
 *   formulas in dashboard code and WITHOUT issuing extra queries when the
 *   dashboard already holds the relevant operational rows in memory.
 *
 * Rules (per C1.6b + C1.7):
 *   - Live calculation only. This helper NEVER inserts into kpi_snapshots
 *     and NEVER calls capture-kpi-snapshot.
 *   - All formula logic lives in the canonical engine; this file only
 *     reshapes already-fetched rows into KpiCalculationInput and
 *     dispatches to `calculateAutomaticKpi`.
 *   - `schedule_signal` is intentionally NOT exposed here because the
 *     dashboard does not currently feed canonical ReportingScheduleSignal.
 *     Dashboard schedule display continues to use Wave B.2 reporting
 *     summaries, unchanged.
 */

import {
  calculateAutomaticKpi,
} from "./kpiCalculationEngine";
import type {
  AutomaticKpiCalculationKey,
} from "./automaticKpiLibrary";
import type {
  KpiCalculationInput,
  KpiCalculationOptions,
  KpiCalculationResult,
  KpiPhaseInput,
  KpiTaskInput,
  KpiBlockerInput,
  KpiRiskInput,
  KpiExecutionUpdateInput,
  KpiProjectInput,
} from "./kpiCalculationTypes";

/** Loose row shapes that already exist in dashboard hooks. */
export interface DashboardProjectRow {
  id: string;
  start_date?: string | null;
  target_end_date?: string | null;
  baseline_end_date?: string | null;
  actual_end_date?: string | null;
  status?: string | null;
  is_archived?: boolean | null;
}

export interface DashboardTaskRow {
  id?: string;
  project_id: string;
  phase_id?: string | null;
  task_type?: string | null;
  status: string | null;
  start_date?: string | null;
  due_date?: string | null;
  baseline_end_date?: string | null;
  actual_end_date?: string | null;
  is_archived?: boolean | null;
}

export interface DashboardPhaseRow {
  id: string;
  project_id: string;
  status?: string | null;
  is_archived?: boolean | null;
}

export interface DashboardBlockerRow {
  id: string;
  target_type: string;
  target_id: string;
  status: string;
}

export interface DashboardRiskRow {
  id: string;
  target_type: string;
  target_id: string;
  status: string;
  impact: string;
}

export interface DashboardExecutionUpdateRow {
  id: string;
  target_type: string;
  target_id: string;
  update_date: string;
}

export interface BuildDashboardInputArgs {
  project: DashboardProjectRow;
  tasks?: ReadonlyArray<DashboardTaskRow>;
  phases?: ReadonlyArray<DashboardPhaseRow>;
  blockers?: ReadonlyArray<DashboardBlockerRow>;
  risks?: ReadonlyArray<DashboardRiskRow>;
  executionUpdates?: ReadonlyArray<DashboardExecutionUpdateRow>;
  /** ISO snapshot date the live calculation should be anchored to. */
  snapshotDate: string;
}

/**
 * Pure, in-memory adapter. Use when dashboard queries already returned
 * the operational rows — avoids extra database round-trips.
 */
export function buildDashboardKpiInput(args: BuildDashboardInputArgs): KpiCalculationInput {
  const project: KpiProjectInput = {
    id: args.project.id,
    plannedStartDate: args.project.start_date ?? null,
    targetEndDate: args.project.target_end_date ?? null,
    baselineEndDate: args.project.baseline_end_date ?? null,
    actualEndDate: args.project.actual_end_date ?? null,
    status: args.project.status ?? null,
    isArchived: !!args.project.is_archived,
  };

  const phases: KpiPhaseInput[] = (args.phases ?? []).map((p) => ({
    id: p.id,
    projectId: p.project_id,
    status: p.status ?? null,
    isArchived: !!p.is_archived,
  }));

  const tasks: KpiTaskInput[] = (args.tasks ?? []).map((t, idx) => ({
    id: t.id ?? `${t.project_id}:${idx}`,
    projectId: t.project_id,
    phaseId: t.phase_id ?? null,
    taskType: t.task_type ?? null,
    status: t.status ?? null,
    plannedStartDate: t.start_date ?? null,
    dueDate: t.due_date ?? null,
    baselineEndDate: t.baseline_end_date ?? null,
    actualEndDate: t.actual_end_date ?? null,
    isArchived: !!t.is_archived,
  }));

  const blockers: KpiBlockerInput[] = (args.blockers ?? []).map((b) => ({
    id: b.id,
    targetType: b.target_type,
    targetId: b.target_id,
    status: b.status,
  }));

  const risks: KpiRiskInput[] = (args.risks ?? []).map((r) => ({
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    status: r.status,
    impact: r.impact,
  }));

  const executionUpdates: KpiExecutionUpdateInput[] = (args.executionUpdates ?? []).map((u) => ({
    id: u.id,
    targetType: u.target_type,
    targetId: u.target_id,
    updateDate: u.update_date,
  }));

  return {
    project,
    phases,
    tasks,
    blockers,
    risks,
    executionUpdates,
    // Dashboard does not currently feed canonical ReportingScheduleSignal.
    // schedule_signal is intentionally unsupported here (see C1.6b rule).
    reportingSummary: null,
    snapshotDate: args.snapshotDate,
  };
}

/** Source-of-value tag for dashboard surfaces. */
export type DashboardKpiSource = "live_calculation" | "official_snapshot";

export interface DashboardKpiValue extends KpiCalculationResult {
  source: DashboardKpiSource;
}

/**
 * Live-calculate a single automatic KPI for dashboard display.
 *
 * Dashboard MUST NOT use this to write snapshots — official snapshot
 * capture is server-authoritative via `capture-kpi-snapshot`.
 */
export function liveCalculateDashboardKpi(
  calculationKey: AutomaticKpiCalculationKey,
  input: KpiCalculationInput,
  options?: KpiCalculationOptions,
): DashboardKpiValue {
  const result = calculateAutomaticKpi(calculationKey, input, options);
  return { ...result, source: "live_calculation" };
}

/**
 * Convenience: convert a live-calculation percentage value into the
 * 0–100 integer that existing dashboard cards display. Returns 0 for
 * any non-`calculated` status so existing UI fallbacks remain stable.
 */
export function percentValueOrZero(result: KpiCalculationResult): number {
  if (result.calculationStatus !== "calculated") return 0;
  if (typeof result.valueAmount !== "number") return 0;
  return Math.round(result.valueAmount);
}

/** Today's snapshot anchor in ISO date form (UTC). */
export function todayIsoDate(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
