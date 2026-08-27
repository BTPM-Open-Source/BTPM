/**
 * GT.6 — Project Calendar Governance Visibility Layer.
 *
 * Read-only visibility of Project governance markers on the Project
 * Calendar surface. Reuses GT.1/GT.2 protected RPCs through
 * `useProjectGovernanceCadences` / `useProjectGovernanceRecords` and
 * reuses the GT.4 `RecordFormDialog` / `RecordDetailDialog` for
 * interactions. Calendar never owns governance state, never generates
 * future occurrence rows, and never schedules meetings.
 *
 * Markers shown for the visible window (current month in Month view,
 * 12-month rolling window in Year view):
 *   - Expected governance — active cadence with non-overdue
 *     `next_expected_date`
 *   - Overdue governance  — active cadence with `derived_status = overdue`
 *   - Completed governance — governance records on `actual_date_held`
 *
 * Only the current `next_expected_date` is shown per cadence. No future
 * series is materialised in the frontend.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CalendarClock, ShieldAlert, FileText, ExternalLink, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  addMonths,
  endOfMonth,
  parseYmd,
  startOfMonth,
  ymd,
} from "./calendarUtils";
import {
  eventTypeLabel,
  useProjectGovernanceCadences,
  useProjectGovernanceRecords,
  type GovernanceCadenceRow,
  type GovernanceRecordRow,
} from "@/hooks/useProjectGovernance";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { RecordFormDialog } from "@/components/project/governance/RecordFormDialog";
import { RecordDetailDialog } from "@/components/project/governance/RecordDetailDialog";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";
import { KC_SLUGS } from "@/components/knowledge/kc-concepts";

type MarkerKind = "expected" | "overdue" | "completed";

interface GovernanceMarker {
  kind: MarkerKind;
  date: string; // yyyy-mm-dd
  label: string;
  cadence?: GovernanceCadenceRow;
  record?: GovernanceRecordRow;
  /** Sort hint inside a single day. */
  sortKey: string;
}

interface Props {
  projectId: string;
  workspaceId: string;
  /** Visible anchor month. */
  anchor: Date;
  /** Calendar view mode — drives the visibility window. */
  viewMode: "month" | "year";
}

function fmtLong(d: string): string {
  const dt = parseYmd(d);
  if (!dt) return d;
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function inWindow(date: string | null | undefined, start: Date, end: Date): boolean {
  if (!date) return false;
  const d = parseYmd(date);
  if (!d) return false;
  return d >= start && d <= end;
}

export function ProjectCalendarGovernancePanel({
  projectId,
  workspaceId,
  anchor,
  viewMode,
}: Props) {
  const { canEdit } = useProjectPlanningAuthority(projectId);

  const cadencesQ = useProjectGovernanceCadences(projectId, false);
  const recordsQ = useProjectGovernanceRecords(projectId, false);

  // Dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [preselectedCadenceId, setPreselectedCadenceId] = useState<string | null>(null);
  const [detailRecordId, setDetailRecordId] = useState<string | null>(null);

  const governanceTabPath = `/workspace/${workspaceId}/project/${projectId}/governance`;

  // Visible window — Month view: current calendar month. Year view: 12 months
  // starting at anchor.
  const { winStart, winEnd, windowLabel } = useMemo(() => {
    if (viewMode === "month") {
      const s = startOfMonth(anchor);
      const e = endOfMonth(anchor);
      return {
        winStart: s,
        winEnd: e,
        windowLabel: anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      };
    }
    const s = startOfMonth(anchor);
    const eMonth = addMonths(s, 11);
    const e = endOfMonth(eMonth);
    return {
      winStart: s,
      winEnd: e,
      windowLabel: `${s.toLocaleDateString(undefined, { month: "short", year: "numeric" })} → ${eMonth.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`,
    };
  }, [anchor, viewMode]);

  const cadences = cadencesQ.data ?? [];
  const records = recordsQ.data ?? [];

  const markers: GovernanceMarker[] = useMemo(() => {
    const out: GovernanceMarker[] = [];

    for (const c of cadences) {
      if (c.archived_at) continue;
      const d = c.next_expected_date;
      if (!d) continue;
      if (!inWindow(d, winStart, winEnd)) continue;
      const isOverdue = c.derived_status === "overdue";
      const labelBase = c.event_name?.trim() || eventTypeLabel(c.event_type);
      out.push({
        kind: isOverdue ? "overdue" : "expected",
        date: d,
        label: labelBase,
        cadence: c,
        sortKey: `1-${c.id}`,
      });
    }

    for (const r of records) {
      if (r.archived_at) continue;
      const d = r.actual_date_held;
      if (!inWindow(d, winStart, winEnd)) continue;
      const labelBase = r.event_name?.trim() || eventTypeLabel(r.event_type);
      out.push({
        kind: "completed",
        date: d,
        label: labelBase,
        record: r,
        sortKey: `2-${r.id}`,
      });
    }

    out.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      // Within same day: overdue → expected → completed
      const order: Record<MarkerKind, number> = { overdue: 0, expected: 1, completed: 2 };
      if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
      return a.sortKey < b.sortKey ? -1 : 1;
    });
    return out;
  }, [cadences, records, winStart, winEnd]);

  const grouped = useMemo(() => {
    const map = new Map<string, GovernanceMarker[]>();
    for (const m of markers) {
      const arr = map.get(m.date) ?? [];
      arr.push(m);
      map.set(m.date, arr);
    }
    return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
  }, [markers]);

  const counts = useMemo(() => {
    const c = { expected: 0, overdue: 0, completed: 0 };
    for (const m of markers) c[m.kind] += 1;
    return c;
  }, [markers]);

  const cadencesError = cadencesQ.error;
  const recordsError = recordsQ.error;
  const anyError = cadencesError || recordsError;
  const isLoading = cadencesQ.isLoading || recordsQ.isLoading;

  const handleExpectedClick = (cadence: GovernanceCadenceRow) => {
    if (!canEdit) {
      // Read-only fallback: navigate to Governance tab.
      window.location.assign(governanceTabPath);
      return;
    }
    setPreselectedCadenceId(cadence.id);
    setFormOpen(true);
  };

  const handleCompletedClick = (record: GovernanceRecordRow) => {
    setDetailRecordId(record.id);
  };

  return (
    <Card className="border-dashed">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Governance markers</h3>
              <Badge variant="outline" className="text-[10px]">Read-only</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Project governance visibility for {windowLabel}. Calendar shows the current next expected date for each
              active cadence, overdue cadences, and completed governance records. Calendar never schedules meetings,
              creates Outlook/Teams events, or rewrites cadence dates.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <KnowledgeLink slug={KC_SLUGS.governanceOverviewCalendar} label="Governance calendar guide" />
            <Button asChild variant="ghost" size="sm">
              <Link to={governanceTabPath}>
                Open Governance <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Legend / counts */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-destructive/70" />
            Overdue ({counts.overdue})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500/80" />
            Expected ({counts.expected})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
            Completed ({counts.completed})
          </span>
        </div>

        {anyError && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Could not load some governance markers. Other calendar items remain available.
            </AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading governance markers…</p>
        ) : grouped.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No governance markers in this window. Manage cadences and record evidence in the{" "}
            <Link to={governanceTabPath} className="underline">Governance tab</Link>.
          </p>
        ) : (
          <ul className="space-y-2">
            {grouped.map(({ date, items }) => (
              <li key={date} className="rounded-md border bg-card/40 p-2">
                <div className="text-xs font-medium text-muted-foreground mb-1.5">{fmtLong(date)}</div>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((m, idx) => (
                    <MarkerChip
                      key={`${date}-${idx}`}
                      marker={m}
                      onExpectedClick={handleExpectedClick}
                      onCompletedClick={handleCompletedClick}
                      canEdit={canEdit}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Reused dialogs */}
        <RecordFormDialog
          open={formOpen}
          onOpenChange={(v) => {
            setFormOpen(v);
            if (!v) setPreselectedCadenceId(null);
          }}
          projectId={projectId}
          preselectedCadenceId={preselectedCadenceId}
        />
        <RecordDetailDialog
          open={!!detailRecordId}
          onOpenChange={(v) => {
            if (!v) setDetailRecordId(null);
          }}
          recordId={detailRecordId}
        />
      </CardContent>
    </Card>
  );
}

function MarkerChip({
  marker,
  onExpectedClick,
  onCompletedClick,
  canEdit,
}: {
  marker: GovernanceMarker;
  onExpectedClick: (c: GovernanceCadenceRow) => void;
  onCompletedClick: (r: GovernanceRecordRow) => void;
  canEdit: boolean;
}) {
  const tone =
    marker.kind === "overdue"
      ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
      : marker.kind === "expected"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15"
        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15";

  const Icon = marker.kind === "completed" ? FileText : marker.kind === "overdue" ? ShieldAlert : CalendarClock;

  const prefix =
    marker.kind === "overdue" ? "Overdue" : marker.kind === "expected" ? "Expected" : "Completed";

  const title =
    marker.kind === "completed"
      ? `Completed: ${marker.label}${marker.record?.has_sharepoint_evidence ? " · evidence attached" : ""}`
      : marker.kind === "overdue"
        ? `Overdue governance: ${marker.label}${canEdit ? " · click to record evidence" : " · open Governance tab"}`
        : `Expected governance: ${marker.label}${canEdit ? " · click to record evidence" : " · open Governance tab"}`;

  const handleClick = () => {
    if (marker.kind === "completed" && marker.record) {
      onCompletedClick(marker.record);
      return;
    }
    if (marker.cadence) onExpectedClick(marker.cadence);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 max-w-full text-[11px] px-2 py-1 rounded-md border transition truncate",
        tone,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="font-semibold">{prefix}:</span>
      <span className="truncate">{marker.label}</span>
      {marker.kind === "completed" && marker.record?.has_sharepoint_evidence && (
        <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
      )}
    </button>
  );
}

// Re-export ymd helper consumer site won't need it — kept for tests.
export const __test__ = { ymd };
