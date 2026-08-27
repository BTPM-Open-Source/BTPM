/**
 * GT.5 — Compact Governance panel for the Project Overview.
 *
 * Read-model driven: all displayed values come from the existing GT.2/GT.4
 * protected RPCs (`get_project_governance_summary`, `list_project_governance_cadences`).
 * No local derivation of governance health, no localStorage, no duplicate
 * summary state. Reuses GT.4 `RecordFormDialog` for the optional quick action.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Info,
  Plus,
} from "lucide-react";
import {
  eventTypeLabel,
  useProjectGovernanceCadences,
  useProjectGovernanceSummary,
} from "@/hooks/useProjectGovernance";
import { RecordFormDialog } from "@/components/project/governance/RecordFormDialog";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";
import { KC_SLUGS } from "@/components/knowledge/kc-concepts";

function formatDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

export function ProjectOverviewGovernancePanel({
  projectId,
  workspaceId,
  canEdit,
  compact = false,
}: {
  projectId: string;
  workspaceId: string;
  canEdit: boolean;
  compact?: boolean;
}) {
  const summaryQ = useProjectGovernanceSummary(projectId);
  // Active-only cadences (already excludes archived) — used to label next/last events.
  const cadencesQ = useProjectGovernanceCadences(projectId, false);
  const [recordOpen, setRecordOpen] = useState(false);

  const governanceHref = `/workspace/${workspaceId}/project/${projectId}/governance`;

  const { nextEventName, lastEventName } = useMemo(() => {
    const cadences = cadencesQ.data ?? [];
    const summary = summaryQ.data;
    let nextEventName: string | null = null;
    let lastEventName: string | null = null;
    if (summary?.next_expected_cadence_id) {
      const c = cadences.find((x) => x.id === summary.next_expected_cadence_id);
      if (c) nextEventName = c.event_name?.trim() || eventTypeLabel(c.event_type);
    }
    if (summary?.last_completed_record_id) {
      // The summary doesn't expose the last record's event name; derive from cadence
      // metadata only when the latest record's cadence matches a known cadence.
      // We still surface "Last completed" date below; an event name is best-effort.
      const c = cadences.find((x) => x.last_record_id === summary.last_completed_record_id);
      if (c) lastEventName = c.event_name?.trim() || eventTypeLabel(c.event_type);
    }
    return { nextEventName, lastEventName };
  }, [cadencesQ.data, summaryQ.data]);

  const isLoading = summaryQ.isLoading;
  const isError = summaryQ.isError;
  const summary = summaryQ.data;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-lg">Governance</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Expected governance rhythm and latest evidence for this project.
              </p>
              <div className="mt-1">
                <KnowledgeLink slug={KC_SLUGS.governanceOverviewCalendar} label="About governance status" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && summary && summary.active_cadence_count > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-8"
                  onClick={() => setRecordOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Record evidence
                </Button>
              )}
              <Button variant="outline" size="sm" className="text-xs h-8" asChild>
                <Link to={governanceHref}>
                  Open Governance <ExternalLink className="h-3.5 w-3.5 ml-1" />
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading governance summary…</p>
          ) : isError ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Could not load governance summary. Open the Governance tab to retry.
              </AlertDescription>
            </Alert>
          ) : !summary ? (
            <p className="text-sm text-muted-foreground">No governance data available.</p>
          ) : summary.active_cadence_count === 0 ? (
            <NoCadenceState
              canEdit={canEdit}
              governanceHref={governanceHref}
            />
          ) : compact ? (
            <>
              <StatusHeadline
                overdue={summary.overdue_cadence_count}
                dueSoon={summary.due_soon_cadence_count}
              />
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
                <CompactStat label="Active" value={summary.active_cadence_count} />
                <CompactStat
                  label="Overdue"
                  value={summary.overdue_cadence_count}
                  emphasis={summary.overdue_cadence_count > 0 ? "danger" : "muted"}
                />
                <CompactStat
                  label="Due soon"
                  value={summary.due_soon_cadence_count}
                  emphasis={summary.due_soon_cadence_count > 0 ? "warning" : "muted"}
                />
                <CompactStat
                  label="Next expected"
                  value={formatDate(summary.next_expected_governance_date)}
                />
                <CompactStat
                  label="Last completed"
                  value={formatDate(summary.last_completed_governance_date)}
                />
              </div>
              {summary.records_missing_sharepoint_evidence_count > 0 && (
                <p className="text-xs text-amber-600">
                  {summary.records_missing_sharepoint_evidence_count} governance record
                  {summary.records_missing_sharepoint_evidence_count === 1 ? " is" : "s are"}{" "}
                  missing evidence links.
                </p>
              )}
            </>
          ) : (
            <>
              <StatusHeadline
                overdue={summary.overdue_cadence_count}
                dueSoon={summary.due_soon_cadence_count}
              />

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Metric label="Active cadences" value={summary.active_cadence_count} />
                <Metric
                  label="Overdue"
                  value={summary.overdue_cadence_count}
                  emphasis={summary.overdue_cadence_count > 0 ? "danger" : "muted"}
                />
                <Metric
                  label="Due soon"
                  value={summary.due_soon_cadence_count}
                  hint="Next 7 days"
                  emphasis={summary.due_soon_cadence_count > 0 ? "warning" : "muted"}
                />
                <Metric
                  label="Next expected"
                  value={formatDate(summary.next_expected_governance_date)}
                  hint={nextEventName ?? undefined}
                />
                <Metric
                  label="Last completed"
                  value={formatDate(summary.last_completed_governance_date)}
                  hint={lastEventName ?? undefined}
                />
                <Metric label="Total records" value={summary.total_record_count} />
              </div>

              {summary.records_missing_sharepoint_evidence_count > 0 && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    {summary.records_missing_sharepoint_evidence_count} governance record
                    {summary.records_missing_sharepoint_evidence_count === 1 ? " is" : "s are"}{" "}
                    missing evidence links.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <RecordFormDialog
          open={recordOpen}
          onOpenChange={setRecordOpen}
          projectId={projectId}
        />
      )}
    </>
  );
}

function StatusHeadline({ overdue, dueSoon }: { overdue: number; dueSoon: number }) {
  if (overdue > 0) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" /> Governance overdue
        </Badge>
        <span className="text-xs text-muted-foreground">
          {overdue} cadence{overdue === 1 ? "" : "s"} past expected date
        </span>
      </div>
    );
  }
  if (dueSoon > 0) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          <CircleDashed className="h-3 w-3" /> Governance due soon
        </Badge>
        <span className="text-xs text-muted-foreground">
          {dueSoon} cadence{dueSoon === 1 ? "" : "s"} due in the next 7 days
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-600/40">
        <CheckCircle2 className="h-3 w-3" /> Governance on track
      </Badge>
    </div>
  );
}

function NoCadenceState({
  canEdit,
  governanceHref,
}: {
  canEdit: boolean;
  governanceHref: string;
}) {
  return (
    <div className="rounded-md border border-dashed p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium">No governance cadence defined</p>
        <p className="text-xs text-muted-foreground">
          Define a recurring cadence (e.g. weekly project team meeting) to track governance
          rhythm and evidence.
        </p>
      </div>
      <Button size="sm" variant="default" asChild disabled={!canEdit}>
        <Link to={governanceHref}>Set up governance</Link>
      </Button>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  emphasis = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  emphasis?: "default" | "muted" | "warning" | "danger";
}) {
  const valueClass =
    emphasis === "danger"
      ? "text-destructive"
      : emphasis === "warning"
      ? "text-amber-600"
      : emphasis === "muted"
      ? "text-muted-foreground"
      : "text-foreground";
  return (
    <div className="rounded-md border p-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${valueClass}`}>{value}</div>
      {hint ? <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</div> : null}
    </div>
  );
}

function CompactStat({
  label,
  value,
  emphasis = "default",
}: {
  label: string;
  value: string | number;
  emphasis?: "default" | "muted" | "warning" | "danger";
}) {
  const valueClass =
    emphasis === "danger"
      ? "text-destructive font-semibold"
      : emphasis === "warning"
      ? "text-amber-600 font-semibold"
      : emphasis === "muted"
      ? "text-muted-foreground"
      : "text-foreground font-medium";
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}
