/**
 * Wave 5 Step 5.6 — Risk lifecycle (canonical)
 *
 * Stored DB enum values (snake_case) and their human-readable UI labels.
 *
 * Lifecycle:
 *   open → under_mitigation → monitoring → realized | closed
 *
 * Notes:
 *   - These are the ONLY values UI/forms should write going forward.
 *   - Old values (identified/mitigating/accepted) still exist in the DB enum
 *     for back-compat but have been remapped on existing rows. They are not
 *     selectable in the UI and will be dropped in a future cleanup step.
 *   - `realized` is an explicit user choice — it is never inferred.
 */

export const RISK_STATUS_VALUES = [
  "open",
  "under_mitigation",
  "monitoring",
  "realized",
  "closed",
] as const;

export type RiskStatus = (typeof RISK_STATUS_VALUES)[number];

export const RISK_STATUS_LABELS: Record<RiskStatus, string> = {
  open: "Open",
  under_mitigation: "Under Mitigation",
  monitoring: "Monitoring",
  realized: "Realized",
  closed: "Closed",
};

/** Tailwind classes for badge tinting. Uses semantic tokens where possible. */
export const RISK_STATUS_BADGE_CLASS: Record<RiskStatus, string> = {
  open: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  under_mitigation: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  monitoring: "bg-muted text-muted-foreground",
  realized: "bg-destructive/10 text-destructive",
  closed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

/**
 * Back-compat label resolver. Any legacy DB value that somehow surfaces
 * in the UI is rendered with the equivalent new label, never as a raw
 * snake_case token.
 */
const LEGACY_TO_CANONICAL: Record<string, RiskStatus> = {
  identified: "open",
  mitigating: "under_mitigation",
  accepted: "monitoring",
};

export function riskStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  if (status in RISK_STATUS_LABELS) return RISK_STATUS_LABELS[status as RiskStatus];
  const mapped = LEGACY_TO_CANONICAL[status];
  if (mapped) return RISK_STATUS_LABELS[mapped];
  return status;
}

export function riskStatusBadgeClass(status: string | null | undefined): string {
  if (!status) return "";
  if (status in RISK_STATUS_BADGE_CLASS) return RISK_STATUS_BADGE_CLASS[status as RiskStatus];
  const mapped = LEGACY_TO_CANONICAL[status];
  if (mapped) return RISK_STATUS_BADGE_CLASS[mapped];
  return "";
}

/** Active = drives risk pressure in derived health (open + under_mitigation). */
export function isActiveRiskStatus(status: string): boolean {
  return status === "open" || status === "under_mitigation" ||
    status === "identified" || status === "mitigating"; // legacy back-compat
}

/** Realized = strong negative signal in derived health. */
export function isRealizedRiskStatus(status: string): boolean {
  return status === "realized";
}
