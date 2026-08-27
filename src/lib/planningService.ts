/**
 * Phase 4F.3 — Canonical client wrapper for normal planning edits.
 *
 * All non-Gantt planning edits to task/phase planned dates must go through
 * this service so that:
 *  1) parent-child containment is checked server-side (preview),
 *  2) explicit parent extension is confirmed by the user before being applied,
 *  3) the actual save is atomic (apply RPC).
 *
 * Gantt is intentionally NOT routed through this in step 4F.3.
 */
import { supabase } from "@/integrations/supabase/client";

export interface PreviewResult {
  valid: boolean;
  requires_extension: boolean;
  blocked: boolean;
  blocked_reason: string | null;
  parent_phase_id?: string;
  parent_phase_name?: string;
  parent_project_id?: string;
  parent_project_name?: string;
  parent_current_start: string | null;
  parent_current_end: string | null;
  parent_proposed_start: string | null;
  parent_proposed_end: string | null;
}

export async function previewTaskPlanningChange(
  taskId: string,
  newPhaseId: string | null,
  newStart: string | null,
  newDue: string | null,
): Promise<PreviewResult> {
  const { data, error } = await supabase.rpc("preview_task_planning_change", {
    _task_id: taskId,
    _new_phase_id: newPhaseId,
    _new_start: newStart,
    _new_due: newDue,
  });
  if (error) throw error;
  return data as unknown as PreviewResult;
}

export async function previewPhasePlanningChange(
  phaseId: string,
  newStart: string | null,
  newEnd: string | null,
): Promise<PreviewResult> {
  const { data, error } = await supabase.rpc("preview_phase_planning_change", {
    _phase_id: phaseId,
    _new_start: newStart,
    _new_end: newEnd,
  });
  if (error) throw error;
  return data as unknown as PreviewResult;
}

export async function applyTaskPlanningChange(
  taskId: string,
  newStart: string | null,
  newDue: string | null,
  confirmParentExtension: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("apply_task_planning_change", {
    _task_id: taskId,
    _new_start: newStart,
    _new_due: newDue,
    _confirm_parent_extension: confirmParentExtension,
  });
  if (error) throw error;
}

export async function applyPhasePlanningChange(
  phaseId: string,
  newStart: string | null,
  newEnd: string | null,
  confirmParentExtension: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("apply_phase_planning_change", {
    _phase_id: phaseId,
    _new_start: newStart,
    _new_end: newEnd,
    _confirm_parent_extension: confirmParentExtension,
  });
  if (error) throw error;
}

/* ─────────────────────────────────────────────────────────────────────
 * Phase 4F.4 — Canonical Gantt phase timeline action wrappers.
 * Gantt routes phase drag/resize through these instead of writing dates
 * directly so the system can:
 *   - resolve move_phase_plan vs shift_remaining_work from execution state
 *   - never rewrite anchored/executed child work
 *   - require explicit project extension confirmation
 *   - log one coherent activity event per phase action
 * ───────────────────────────────────────────────────────────────────── */

export type PhaseTimelineAction = "drag" | "resize";
export type ResolvedPhaseAction = "move_phase_plan" | "shift_remaining_work" | "resize_phase";

export interface PhaseTimelinePreview {
  valid: boolean;
  blocked: boolean;
  blocked_reason: string | null;
  resolved_action?: ResolvedPhaseAction;
  has_executed_children?: boolean;
  requires_project_extension?: boolean;
  phase_id?: string;
  phase_name?: string;
  phase_current_start: string | null;
  phase_current_end: string | null;
  phase_proposed_start: string | null;
  phase_proposed_end: string | null;
  parent_project_id?: string;
  parent_project_name?: string;
  parent_current_start: string | null;
  parent_current_end: string | null;
  parent_proposed_start: string | null;
  parent_proposed_end: string | null;
  moved_children_count?: number;
  anchored_children_count?: number;
  delta_days?: number;
}

export async function previewPhaseTimelineAction(
  phaseId: string,
  action: PhaseTimelineAction,
  newStart: string | null,
  newEnd: string | null,
): Promise<PhaseTimelinePreview> {
  const { data, error } = await supabase.rpc("preview_phase_timeline_action", {
    _phase_id: phaseId,
    _action: action,
    _new_start: newStart,
    _new_end: newEnd,
  });
  if (error) throw error;
  return data as unknown as PhaseTimelinePreview;
}

export async function applyPhaseTimelineAction(
  phaseId: string,
  action: PhaseTimelineAction,
  newStart: string | null,
  newEnd: string | null,
  confirmProjectExtension: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("apply_phase_timeline_action", {
    _phase_id: phaseId,
    _action: action,
    _new_start: newStart,
    _new_end: newEnd,
    _confirm_project_extension: confirmProjectExtension,
  });
  if (error) throw error;
}

/* ─────────────────────────────────────────────────────────────────────
 * Canonical project planned-date preview / apply wrappers (4F Closure Correction 1)
 * ───────────────────────────────────────────────────────────────────── */

export interface ProjectPlanningPreview {
  valid: boolean;
  blocked: boolean;
  blocked_reason: string | null;
  parent_project_id?: string;
  parent_project_name?: string;
  parent_current_start: string | null;
  parent_current_end: string | null;
  parent_proposed_start: string | null;
  parent_proposed_end: string | null;
}

export async function previewProjectPlanningChange(
  projectId: string,
  newStart: string | null,
  newEnd: string | null,
): Promise<ProjectPlanningPreview> {
  const { data, error } = await supabase.rpc("preview_project_planning_change", {
    _project_id: projectId,
    _new_start: newStart,
    _new_end: newEnd,
  });
  if (error) throw error;
  return data as unknown as ProjectPlanningPreview;
}

export async function applyProjectPlanningChange(
  projectId: string,
  newStart: string | null,
  newEnd: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("apply_project_planning_change", {
    _project_id: projectId,
    _new_start: newStart,
    _new_end: newEnd,
  });
  if (error) throw error;
}

/** Map raw blocked_reason codes from the preview RPCs to plain English. */
export function describeBlockedReason(reason: string | null | undefined): string {
  if (!reason) return "This change is not allowed.";
  if (reason === "task_completed_locked") return "This task is completed. Reopen it before editing planned dates.";
  if (reason === "phase_completed_locked") return "This phase is completed. Reopen it before editing planned dates.";
  if (reason === "task_cancelled_or_archived") return "This task is cancelled or archived and cannot be edited.";
  if (reason === "phase_cancelled_or_archived") return "This phase is cancelled or archived and cannot be edited.";
  if (reason === "invalid_range") return "End date must be on or after start date.";
  if (reason === "not_authorized") return "You do not have permission to change planning on this workspace.";
  if (reason === "task_not_found" || reason === "phase_not_found" || reason === "project_not_found") return "Item no longer exists.";
  if (reason.startsWith("phase_shrinks_under_child_start:")) {
    const [, name, date] = reason.split(":");
    return `Cannot shrink phase: child task "${name}" starts ${date}.`;
  }
  if (reason.startsWith("phase_shrinks_under_child_end:")) {
    const [, name, date] = reason.split(":");
    return `Cannot shrink phase: child task "${name}" ends ${date}.`;
  }
  if (reason.startsWith("project_shrinks_under_child_start:")) {
    const [, name, date] = reason.split(":");
    return `Cannot shrink project: child phase "${name}" starts ${date}.`;
  }
  if (reason.startsWith("project_shrinks_under_child_end:")) {
    const [, name, date] = reason.split(":");
    return `Cannot shrink project: child phase "${name}" ends ${date}.`;
  }
  return reason;
}
