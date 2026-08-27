/**
 * GT.6a — Shared governance marker construction for Project Calendar.
 *
 * Pure mapping of GT.1/GT.2 cadence + record rows into compact day-cell
 * markers. Read-only. No future occurrence series, no recurrence
 * generation, no client-side status derivation. Marker dates come
 * directly from `next_expected_date` (cadences) and `actual_date_held`
 * (records) returned by the protected RPCs.
 */
import type {
  GovernanceCadenceRow,
  GovernanceRecordRow,
} from "@/hooks/useProjectGovernance";
import { eventTypeLabel } from "@/hooks/useProjectGovernance";

export type GovernanceMarkerKind = "expected" | "overdue" | "completed";

export interface GovernanceMarker {
  kind: GovernanceMarkerKind;
  /** yyyy-mm-dd */
  date: string;
  label: string;
  cadence?: GovernanceCadenceRow;
  record?: GovernanceRecordRow;
}

const ORDER: Record<GovernanceMarkerKind, number> = {
  overdue: 0,
  expected: 1,
  completed: 2,
};

export function buildGovernanceMarkers(
  cadences: GovernanceCadenceRow[],
  records: GovernanceRecordRow[],
): GovernanceMarker[] {
  const out: GovernanceMarker[] = [];

  for (const c of cadences) {
    if (c.archived_at) continue;
    if (!c.next_expected_date) continue;
    const isOverdue = c.derived_status === "overdue";
    out.push({
      kind: isOverdue ? "overdue" : "expected",
      date: c.next_expected_date,
      label: c.event_name?.trim() || eventTypeLabel(c.event_type),
      cadence: c,
    });
  }

  for (const r of records) {
    if (r.archived_at) continue;
    if (!r.actual_date_held) continue;
    out.push({
      kind: "completed",
      date: r.actual_date_held,
      label: r.event_name?.trim() || eventTypeLabel(r.event_type),
      record: r,
    });
  }

  return out;
}

export function groupMarkersByDate(
  markers: GovernanceMarker[],
): Record<string, GovernanceMarker[]> {
  const map: Record<string, GovernanceMarker[]> = {};
  for (const m of markers) {
    (map[m.date] ||= []).push(m);
  }
  for (const day of Object.keys(map)) {
    map[day].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  }
  return map;
}

export function markerToneClass(kind: GovernanceMarkerKind): string {
  switch (kind) {
    case "overdue":
      return "border-destructive/50 bg-destructive/15 text-destructive hover:bg-destructive/20";
    case "expected":
      return "border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-200 hover:bg-amber-500/20";
    case "completed":
      return "border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-500/20";
  }
}

export function markerDotClass(kind: GovernanceMarkerKind): string {
  switch (kind) {
    case "overdue":
      return "bg-destructive";
    case "expected":
      return "bg-amber-500";
    case "completed":
      return "bg-emerald-500";
  }
}

export function markerPrefix(kind: GovernanceMarkerKind): string {
  return kind === "overdue" ? "Overdue" : kind === "expected" ? "Expected" : "Completed";
}
