/**
 * CM.7 — Adoption reporting summary contract (frontend type).
 *
 * Mirrors the JSON returned by the SECURITY DEFINER RPC
 * `public.list_project_adoption_reporting_summaries(_workspace_id, _project_ids)`.
 *
 * Derived live from canonical Adoption Plan + Tasks + Adoption Object Links.
 * No persisted totals, no decrypted narrative text.
 */

export type AdoptionSignal =
  | "not_enabled"
  | "preparing"
  | "on_track"
  | "attention"
  | "at_risk"
  | "ready";

export interface ProjectAdoptionReportingSummary {
  project_id: string;
  workspace_id: string;
  organization_id: string;
  adoption_plan_id: string;
  has_adoption_plan: boolean;
  readiness_status: string | null;
  enabled: boolean;
  created_from_template: boolean;
  initiative_count: number;
  active_initiative_count: number;
  at_risk_initiative_count: number;
  completed_initiative_count: number;
  adoption_task_count: number;
  adoption_task_open_count: number;
  adoption_task_completed_count: number;
  adoption_task_overdue_count: number;
  adoption_risk_count: number;
  adoption_blocker_count: number;
  adoption_kpi_count: number;
  adoption_signal: AdoptionSignal;
  adoption_label: string;
  reason_lines: string[];
}
