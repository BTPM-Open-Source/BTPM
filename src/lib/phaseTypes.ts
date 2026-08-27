/**
 * Phase / task semantic type labels.
 *
 * The DB stores raw enum values (work_item, milestone, deliverable, decision,
 * review). The UX uses cleaner user-facing labels and treats `work_item` as
 * the implicit "Standard" type — no noisy badge unless the row explicitly
 * needs the full label.
 */

export type SemanticType = "work_item" | "milestone" | "deliverable" | "decision" | "review";

export const SEMANTIC_TYPE_VALUES: SemanticType[] = [
  "work_item",
  "milestone",
  "deliverable",
  "decision",
  "review",
];

const LABELS: Record<SemanticType, string> = {
  work_item: "Standard",
  milestone: "Milestone",
  deliverable: "Deliverable",
  decision: "Decision",
  review: "Review",
};

export function semanticTypeLabel(t: string | null | undefined): string {
  if (!t) return LABELS.work_item;
  return LABELS[t as SemanticType] ?? t.replace(/_/g, " ");
}

/** Standard (work_item) is implicit — UX should not render a badge for it. */
export function isNonStandardType(t: string | null | undefined): boolean {
  return !!t && t !== "work_item";
}
