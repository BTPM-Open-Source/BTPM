/**
 * Canonical Reporting Summary Contract (frontend types).
 *
 * Mirrors the JSON returned by the SECURITY DEFINER RPC
 * `public.list_project_reporting_summaries(_workspace_id uuid, _project_ids uuid[])`.
 * Project overview and roadmap reporting surfaces consume this shared contract.
 */

export type ReportingHealthRag = "green" | "amber" | "red";

export type ReportingScheduleSignal =
  | "on_track"
  | "behind_schedule"
  | "complete"
  | "no_schedule_basis";

export type ReportingScheduleReasonCode =
  | "all_phases_complete"
  | "no_schedule_basis"
  | "project_target_overdue"
  | "behind_phases"
  | "behind_tasks"
  | "baseline_slip";

export type ReportingHealthReasonCode =
  | "overdue_tasks"
  | "overdue_phases"
  | "project_target_overdue"
  | "open_blockers"
  | "active_high_risks"
  | "realized_risks"
  | "baseline_slip";

export interface ReportingStatusCounts {
  planned: number;
  active: number;
  on_hold: number;
  completed: number;
  cancelled: number;
  total: number;
}

export interface ReportingDataSufficiencyFlags {
  has_phases: boolean;
  has_tasks: boolean;
  has_target_end_date: boolean;
  has_baseline: boolean;
  has_schedule_basis: boolean;
}

export interface ProjectReportingSummary {
  project_id: string;
  workspace_id: string;
  program_id: string | null;

  // Completion
  completion_percent: number;
  task_total_count: number;
  task_completed_count: number;
  task_cancelled_count: number;

  // Status breakdown
  status_counts: ReportingStatusCounts;

  // Schedule signal
  schedule_signal: ReportingScheduleSignal;
  schedule_reason_codes: ReportingScheduleReasonCode[];
  schedule_reason_lines: string[];
  behind_task_count: number;
  behind_phase_count: number;
  has_schedule_basis: boolean;

  // Health / RAG
  health_score: number;
  health_rag: ReportingHealthRag;
  health_label: string;
  health_reason_codes: ReportingHealthReasonCode[];
  health_reason_lines: string[];

  // Baseline variance
  is_baselined: boolean;
  baseline_end_date: string | null;
  target_end_date: string | null;
  /** Positive => current target end is later than baseline end (slip). null when not baselined. */
  baseline_slip_days: number | null;

  // Data sufficiency
  data_sufficiency_flags: ReportingDataSufficiencyFlags;

  computed_at: string;
}
