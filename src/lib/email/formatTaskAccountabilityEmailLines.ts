/**
 * TAE.7C — Manual Task email accountability snapshot formatter.
 *
 * Produces zero, one, or two `summaryLines` entries for the manual
 * "Send email with Task context" action:
 *   - "Requested by": current requester display name (omitted when unset).
 *   - "Executed by":  all current executors in payload order, joined with
 *                     "; ", each annotated with concise `(External)` /
 *                     `(Former)` / `— <role>` markers only when needed.
 *
 * The helper is pure and consumes only the stakeholder objects already
 * present on the protected Task read payload
 * (`requested_by_stakeholder`, `executed_by_stakeholders`). No PII (email
 * addresses, user IDs) is ever emitted.
 */

export interface EmailStakeholder {
  id?: string;
  display_name?: string | null;
  stakeholder_type?: string | null;
  role_label?: string | null;
  is_removed?: boolean | null;
}

export interface EmailSummaryLine {
  label: string;
  value: string | null | undefined;
}

function formatStakeholder(s: EmailStakeholder): string {
  const name = (s.display_name || "").trim() || "Unknown stakeholder";
  const markers: string[] = [];
  if (s.stakeholder_type === "external") markers.push("External");
  if (s.is_removed === true) markers.push("Former");
  const markerText = markers.length ? ` (${markers.join(", ")})` : "";
  const roleText =
    s.role_label && s.role_label.trim().length > 0
      ? ` — ${s.role_label.trim()}`
      : "";
  return `${name}${markerText}${roleText}`;
}

export function formatTaskAccountabilityEmailLines(input: {
  requester?: EmailStakeholder | null;
  executors?: EmailStakeholder[] | null;
}): EmailSummaryLine[] {
  const lines: EmailSummaryLine[] = [];

  if (input.requester) {
    lines.push({
      label: "Requested by",
      value: formatStakeholder(input.requester),
    });
  }

  const execs = Array.isArray(input.executors) ? input.executors : [];
  if (execs.length > 0) {
    lines.push({
      label: "Executed by",
      value: execs.map(formatStakeholder).join("; "),
    });
  }

  return lines;
}
