/**
 * BTPM — Wave C1, Step C1.4
 * KPI Calculation Engine — input/output type contracts.
 *
 * Pure types. No Supabase, no React, no UI imports.
 *
 * Conceptually aligned with the kpi_snapshots table introduced in C1.2
 * but DOES NOT persist anything. The data-fetching adapter and snapshot
 * capture path land in later steps (C1.5/C1.6).
 *
 * Source-field mapping decisions (verified against the live repo schema,
 * see governance doc wave-c1-step-c1-4-kpi-calculation-engine.md):
 *
 *   - projects.status / phases.status / tasks.status  → pm_status
 *       ("planned" | "active" | "on_hold" | "completed" | "cancelled")
 *   - projects.start_date / phases.start_date / tasks.start_date → planned start
 *   - projects.target_end_date / phases.target_end_date          → current planned end
 *   - tasks.due_date                                              → preferred per-task due basis
 *       (falls back to baseline_end_date or start_date when missing)
 *   - tasks.actual_end_date                                       → completion date
 *   - *.baseline_end_date / projects.baseline_end_date            → baseline end
 *   - *.is_archived === true                                      → treated as cancelled/excluded
 *   - blockers.status (blocker_status: "open" | "in_progress" | "resolved")
 *       open + in_progress = "open" for KPI purposes
 *   - risks.status (risk_status) — active = "open" + "under_mitigation" (Wave 5.6)
 *   - risks.impact (pm_priority)  — high impact = "high" or "critical"
 *   - blockers.target_type / risks.target_type ∈ {"project","phase","task"}
 *   - execution_updates.update_date is the canonical "project status freshness" source
 *       when target_type="project" and target_id=project.id.
 */

// NOTE (C1.6a): use relative .ts imports so this module is consumable by both
// the Vite/TS app build AND Supabase Edge Functions (Deno). No @/ aliases.
// Inlined from src/lib/reportingSummary.ts to keep edge function self-contained.
type ReportingScheduleSignal =
  | "on_track"
  | "behind_schedule"
  | "complete"
  | "no_schedule_basis";
import type {
  AutomaticKpiCalculationKey,
  AutomaticKpiValueType,
} from "./automaticKpiLibrary.ts";

/** Completion-method selector for completion_vs_time_gap (mirrors kpi_definitions.completion_method). */
export type KpiCompletionMethod = "task_count" | "duration_weighted";

/**
 * Calculation status mirrors kpi_snap_calc_status_chk on kpi_snapshots (C1.2):
 * "calculated" | "no_source_data" | "insufficient_date_basis" | "not_applicable" | "error".
 */
export type KpiCalculationStatus =
  | "calculated"
  | "no_source_data"
  | "insufficient_date_basis"
  | "not_applicable"
  | "error";

// ---------- Normalized input shapes ----------
//
// These are the PURE inputs the engine consumes. The data-fetching adapter
// (later step) is responsible for translating Supabase rows into these.
// Field names mirror the live repo schema where possible.

export interface KpiProjectInput {
  id: string;
  /** projects.start_date — planned start. */
  plannedStartDate: string | null;
  /** projects.target_end_date — current planned/target end. */
  targetEndDate: string | null;
  /** projects.baseline_end_date — approved baseline end. */
  baselineEndDate: string | null;
  /** projects.actual_end_date — actual completion (informational). */
  actualEndDate: string | null;
  /** projects.status (pm_status). */
  status: string | null;
  /** projects.is_archived. */
  isArchived?: boolean;
}

export interface KpiPhaseInput {
  id: string;
  projectId: string;
  status: string | null;
  isArchived?: boolean;
}

export interface KpiTaskInput {
  id: string;
  projectId: string;
  phaseId: string | null;
  /** tasks.task_type — "milestone" identifies milestone tasks. */
  taskType: string | null;
  status: string | null;
  /** tasks.start_date — planned start. */
  plannedStartDate: string | null;
  /** tasks.due_date — preferred operational due basis. */
  dueDate: string | null;
  /** tasks.baseline_end_date — task-level baseline. */
  baselineEndDate: string | null;
  /** tasks.actual_end_date — completion timestamp. */
  actualEndDate: string | null;
  isArchived?: boolean;
}

export interface KpiBlockerInput {
  id: string;
  /** "project" | "phase" | "task" (blockers.target_type). */
  targetType: string;
  targetId: string;
  /** blocker_status: "open" | "in_progress" | "resolved". */
  status: string;
}

export interface KpiRiskInput {
  id: string;
  /** "project" | "phase" | "task". */
  targetType: string;
  targetId: string;
  /** risk_status (Wave 5.6). */
  status: string;
  /** pm_priority — "high" or "critical" counts as high impact. */
  impact: string;
}

export interface KpiExecutionUpdateInput {
  id: string;
  /** "project" | "phase" | "task". */
  targetType: string;
  targetId: string;
  /** execution_updates.update_date (ISO date or timestamp). */
  updateDate: string;
}

/**
 * Optional canonical reporting summary input. When provided, schedule_signal
 * MUST reuse `scheduleSignal` rather than re-deriving it (see C1.3 rule).
 */
export interface KpiReportingSummaryInput {
  scheduleSignal: ReportingScheduleSignal | null;
}

export interface KpiCalculationInput {
  project: KpiProjectInput;
  phases: ReadonlyArray<KpiPhaseInput>;
  tasks: ReadonlyArray<KpiTaskInput>;
  blockers: ReadonlyArray<KpiBlockerInput>;
  risks: ReadonlyArray<KpiRiskInput>;
  executionUpdates: ReadonlyArray<KpiExecutionUpdateInput>;
  /** Canonical reporting summary (optional but strongly preferred for schedule_signal). */
  reportingSummary?: KpiReportingSummaryInput | null;
  /**
   * Snapshot date the calculation is anchored to. Required so the engine
   * is deterministic and never reads `Date.now()` internally.
   */
  snapshotDate: string;
}

/** Per-KPI options the caller may pass through (mirrors kpi_definitions config). */
export interface KpiCalculationOptions {
  /** Used by completion_vs_time_gap; null => defaults to "task_count" in v1. */
  completionMethod?: KpiCompletionMethod | null;
  /** Override formula version (defaults to library defaultFormulaVersion). */
  formulaVersion?: number;
}

/** Per-key request used by calculateAutomaticKpis. */
export interface KpiCalculationRequest {
  calculationKey: AutomaticKpiCalculationKey;
  options?: KpiCalculationOptions;
}

// ---------- Output shape ----------

export interface KpiCalculationResult {
  calculationKey: AutomaticKpiCalculationKey;
  valueType: AutomaticKpiValueType;
  sourceMode: "automatic";
  /** Numeric/percent/currency value. null for text KPIs and no-basis cases. */
  valueAmount: number | null;
  /** Text value (only populated for text KPIs). null for numeric KPIs. */
  stringValue: string | null;
  calculationStatus: KpiCalculationStatus;
  /** Human-readable reason / context. Optional. */
  calculationMessage: string | null;
  /** Formula version used to produce this value (mirrors C1.3 metadata). */
  formulaVersion: number;
  /** Echo of the completion method used, when relevant. */
  completionMethod: KpiCompletionMethod | null;
  /** ISO snapshot date the calculation was anchored to. */
  snapshotDate: string;
  /** Optional basis metadata for diagnostics (counts, denominators, etc.). */
  sourceSummary?: Record<string, number | string | null>;
}
