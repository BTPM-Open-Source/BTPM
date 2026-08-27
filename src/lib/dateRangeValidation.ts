/**
 * Shared date-range invariant for canonical planning objects.
 *
 * For every project / phase / task, if BOTH a start date and an end (or due)
 * date are present, the end/due MUST be on or after the start.
 *  - Same-day start/end is valid.
 *  - Missing start or missing end/due remains allowed.
 *  - Only end/due < start is invalid.
 *
 * Used as a pre-save guard in PhaseFormDialog, TaskFormDialog, PhasePlanEditor,
 * TaskPlanEditor, ProjectEditDialog, and the Gantt edit hook. The same
 * invariant is enforced at the database level by check constraints.
 */

export const DATE_RANGE_ERROR_MESSAGE = "End date must be on or after start date.";

/**
 * Returns true when both dates are non-empty AND end is strictly before start.
 * Accepts ISO date strings (YYYY-MM-DD) or null/undefined/empty.
 */
export function isInvalidDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): boolean {
  if (!startDate || !endDate) return false;
  return endDate < startDate;
}
