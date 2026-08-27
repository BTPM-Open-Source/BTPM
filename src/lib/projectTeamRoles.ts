// Standard Project Team role catalog (Step 4D.3)
// canonical_role_key is the system-readable controlled value;
// label is the user-facing display when no custom label is provided.

export type CanonicalRoleKey =
  | "project_manager"
  | "project_sponsor"
  | "pm_deputy"
  | "sme"
  | "workstream_lead"
  | "functional_lead"
  | "contributor"
  | "informed_stakeholder"
  | "custom";

export interface StandardRole {
  key: CanonicalRoleKey;
  label: string;
}

export const STANDARD_ROLES: StandardRole[] = [
  { key: "project_manager", label: "Project Manager" },
  { key: "project_sponsor", label: "Project Sponsor" },
  { key: "pm_deputy", label: "PM Deputy" },
  { key: "sme", label: "SME" },
  { key: "workstream_lead", label: "Workstream Lead" },
  { key: "functional_lead", label: "Functional Lead" },
  { key: "contributor", label: "Contributor" },
  { key: "informed_stakeholder", label: "Informed Stakeholder" },
  { key: "custom", label: "Other / Custom" },
];

const STANDARD_LABEL_BY_KEY: Record<CanonicalRoleKey, string> = STANDARD_ROLES.reduce(
  (acc, r) => ({ ...acc, [r.key]: r.label }),
  {} as Record<CanonicalRoleKey, string>,
);

/**
 * Resolve the user-facing role label for a team-member row.
 * - If a standard (non-custom) role key is set, prefer the standard label.
 * - Otherwise, fall back to the free-text role_label.
 */
export function getDisplayRoleLabel(
  canonicalRoleKey: string | null | undefined,
  roleLabel: string | null | undefined,
): string | null {
  if (canonicalRoleKey && canonicalRoleKey !== "custom") {
    const standard = STANDARD_LABEL_BY_KEY[canonicalRoleKey as CanonicalRoleKey];
    if (standard) return standard;
  }
  return roleLabel?.trim() || null;
}

export function isStandardRoleKey(key: string | null | undefined): key is CanonicalRoleKey {
  if (!key) return false;
  return STANDARD_ROLES.some((r) => r.key === key);
}
