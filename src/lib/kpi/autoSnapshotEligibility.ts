/**
 * Wave C3 — Step C3.7
 * Pure helper that evaluates whether a KPI definition (or in-progress
 * KPI definition form state) is eligible for automatic snapshot capture.
 *
 * Mirrors the eligibility rules used by:
 *   - C3.2 DB validation (final authority)
 *   - C3.3 dry-run scheduler candidate selection
 *   - C3.6 AutoSnapshotCaptureStatus visibility
 *
 * This helper does NOT call any backend, does NOT read DB state, and
 * does NOT trigger the scheduler. It is used to drive the editable
 * toggle in KpiDefinitionDialog (C3.7).
 */
export const SUPPORTED_AUTO_SNAPSHOT_CADENCES = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
] as const;

export type AutoSnapshotEligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

export interface AutoSnapshotEligibilityInput {
  source_mode: string | null | undefined;
  cadence: string | null | undefined;
  calculation_key: string | null | undefined;
  is_archived?: boolean | null;
}

export function evaluateAutoSnapshotEligibility(
  input: AutoSnapshotEligibilityInput,
): AutoSnapshotEligibility {
  if (input.source_mode !== "automatic") {
    return {
      eligible: false,
      reason: "Manual KPIs use manual updates and official snapshots.",
    };
  }
  if (input.is_archived) {
    return {
      eligible: false,
      reason: "Archived KPIs cannot be captured automatically.",
    };
  }
  if (!input.calculation_key) {
    return {
      eligible: false,
      reason:
        "Automatic snapshot capture requires an automatic calculation key.",
    };
  }
  if (input.calculation_key === "schedule_signal") {
    return {
      eligible: false,
      reason:
        "schedule_signal is excluded until canonical reporting signal wiring is corrected.",
    };
  }
  if (!input.cadence || input.cadence === "manual_only") {
    return {
      eligible: false,
      reason: "Automatic snapshot capture requires a periodic cadence.",
    };
  }
  if (
    !SUPPORTED_AUTO_SNAPSHOT_CADENCES.includes(
      input.cadence as (typeof SUPPORTED_AUTO_SNAPSHOT_CADENCES)[number],
    )
  ) {
    return {
      eligible: false,
      reason: "This cadence is not supported for automatic snapshot capture.",
    };
  }
  return { eligible: true };
}
