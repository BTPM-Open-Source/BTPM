/**
 * Thin compatibility wrapper — the canonical PM visual-semantics source of
 * truth lives in `src/lib/btpmVisualSemantics.ts`. This module preserves the
 * legacy exported names so existing imports keep working, but it MUST NOT
 * maintain its own color/label truth.
 */

import {
  PM_WORKFLOW_STATUS_VALUES,
  getPmWorkflowStatusLabel,
  getPmWorkflowStatusBadgeClass,
  getPmPriorityLabel,
  type PmWorkflowStatus,
} from "./btpmVisualSemantics";

export const PM_STATUS_VALUES = PM_WORKFLOW_STATUS_VALUES;
export type PmStatus = PmWorkflowStatus;

export function isPmStatus(value: unknown): value is PmStatus {
  return (
    typeof value === "string" &&
    (PM_WORKFLOW_STATUS_VALUES as readonly string[]).includes(value)
  );
}

export function pmStatusLabel(status: string | null | undefined): string {
  return getPmWorkflowStatusLabel(status);
}

export function pmStatusBadgeClass(status: string | null | undefined): string {
  return getPmWorkflowStatusBadgeClass(status);
}

export function priorityLabel(value: string | null | undefined): string {
  return getPmPriorityLabel(value);
}

/** Deprecated — kept for any legacy imports. Prefer helpers above. */
export const PM_STATUS_LABELS: Record<PmStatus, string> = {
  planned: getPmWorkflowStatusLabel("planned"),
  active: getPmWorkflowStatusLabel("active"),
  on_hold: getPmWorkflowStatusLabel("on_hold"),
  completed: getPmWorkflowStatusLabel("completed"),
  cancelled: getPmWorkflowStatusLabel("cancelled"),
};

export const PM_STATUS_BADGE_CLASS: Record<PmStatus, string> = {
  planned: getPmWorkflowStatusBadgeClass("planned"),
  active: getPmWorkflowStatusBadgeClass("active"),
  on_hold: getPmWorkflowStatusBadgeClass("on_hold"),
  completed: getPmWorkflowStatusBadgeClass("completed"),
  cancelled: getPmWorkflowStatusBadgeClass("cancelled"),
};
