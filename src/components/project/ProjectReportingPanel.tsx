import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  Activity,
  ShieldAlert,
  CalendarClock,
  Flag,
  CircleDot,
  AlertTriangle,
} from "lucide-react";
import type {
  ProjectReportingSummary,
  ReportingHealthRag,
  ReportingScheduleSignal,
} from "@/lib/reportingSummary";
import {
  getPmWorkflowStatusLabel,
  getPmWorkflowStatusHex,
  getPmWorkflowStatusBadgeClass,
  getPmHealthBadgeClass,
  getPmHealthDotClass,
  getPmHealthHex,
  type PmHealth,
} from "@/lib/btpmVisualSemantics";

/**
 * Wave B Step B.3 — Project-level reporting panel.
 *
 * Consumes the canonical Wave B.2 RPC contract (`ProjectReportingSummary`)
 * and renders Completion, Status breakdown, Health/RAG, Schedule signal,
 * and Baseline variance as five visually distinct tiles.
 *
 * Frozen rules enforced here:
 *   - Health and Schedule are separate tiles with separate reason lines
 *   - Baseline variance is shown as its own summary, never silently merged
 *     into the Schedule signal label
 *   - No client-side re-derivation: this component is a pure renderer of the
 *     B.2 contract; if the contract is unavailable it shows safe placeholders
 *   - Stage and Lifecycle are NOT rendered here — they live in
 *     `ProjectIdentityHeader` so the five axes stay visually distinct
 */

interface Props {
  summary: ProjectReportingSummary | null | undefined;
  isLoading: boolean;
  isError?: boolean;
}

// Canonical health/schedule tint classes — align with btpmVisualSemantics:
// green = on_track, amber = needs_attention, red = at_risk (destructive red),
// schedule behind_schedule = orange (not red), complete = blue.
const RAG_TO_HEALTH: Record<ReportingHealthRag, PmHealth> = {
  green: "on_track",
  amber: "needs_attention",
  red: "at_risk",
};

const scheduleBadgeClass: Record<ReportingScheduleSignal, string> = {
  on_track: getPmHealthBadgeClass("on_track"),
  behind_schedule: getPmHealthBadgeClass("behind"),
  complete: getPmWorkflowStatusBadgeClass("completed"),
  no_schedule_basis: "bg-muted text-muted-foreground",
};

const scheduleLabel: Record<ReportingScheduleSignal, string> = {
  on_track: "On Track",
  behind_schedule: "Behind Schedule",
  complete: "Complete",
  no_schedule_basis: "No Schedule Basis",
};

/**
 * Task status breakdown rows — dot colors derive from canonical PM workflow
 * status hex values via getPmWorkflowStatusHex. Kept as inline color so
 * Tailwind JIT does not need to resolve dynamic class strings.
 */
const statusRows: {
  key: keyof ProjectReportingSummary["status_counts"];
  label: string;
  hex: string;
}[] = [
  { key: "completed", label: getPmWorkflowStatusLabel("completed"), hex: getPmWorkflowStatusHex("completed") },
  { key: "active",    label: getPmWorkflowStatusLabel("active"),    hex: getPmWorkflowStatusHex("active") },
  { key: "planned",   label: getPmWorkflowStatusLabel("planned"),   hex: getPmWorkflowStatusHex("planned") },
  { key: "on_hold",   label: getPmWorkflowStatusLabel("on_hold"),   hex: getPmWorkflowStatusHex("on_hold") },
  { key: "cancelled", label: getPmWorkflowStatusLabel("cancelled"), hex: getPmWorkflowStatusHex("cancelled") },
];

function formatSlip(days: number | null): string {
  if (days === null) return "—";
  if (days === 0) return "On baseline";
  if (days > 0) return `+${days} day${days === 1 ? "" : "s"} slip`;
  return `${days} day${days === -1 ? "" : "s"} ahead`;
}

function TileSkeleton() {
  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-3 w-32" />
      </CardContent>
    </Card>
  );
}

export function ProjectReportingPanel({ summary, isLoading, isError }: Props) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <TileSkeleton />
        <TileSkeleton />
        <TileSkeleton />
        <TileSkeleton />
      </div>
    );
  }

  // Graceful unavailable: do not crash, do not fabricate signals.
  if (isError || !summary) {
    return (
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <div>
              <p className="font-medium text-foreground">
                Reporting summary unavailable
              </p>
              <p className="text-xs mt-1">
                Health and Schedule signals could not be loaded. Project
                identity and context fields above remain accurate.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const completionDenominator =
    summary.task_total_count - summary.task_cancelled_count;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {/* ── Completion ─────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" />
            Completion
          </div>
          <div className="flex items-end gap-2">
            <span className="text-3xl font-bold text-foreground">
              {summary.completion_percent}%
            </span>
            <span className="text-xs text-muted-foreground mb-1">
              {summary.task_completed_count}/{Math.max(completionDenominator, 0)} tasks
            </span>
          </div>
          <Progress value={summary.completion_percent} className="h-2" />
          {summary.task_cancelled_count > 0 && (
            <p className="text-xs text-muted-foreground">
              {summary.task_cancelled_count} cancelled (excluded)
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Status breakdown ───────────────────────────────── */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Activity className="h-4 w-4" />
            Status Breakdown
          </div>
          <div className="space-y-1.5">
            {statusRows.map(({ key, label, hex }) => {
              const count = summary.status_counts[key] ?? 0;
              if (count === 0) return null;
              return (
                <div key={key} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    <CircleDot className="h-3 w-3" style={{ color: hex }} />
                    {label}
                  </span>
                  <span className="font-medium text-foreground">{count}</span>
                </div>
              );
            })}
            {summary.status_counts.total === 0 && (
              <p className="text-xs text-muted-foreground">No tasks yet</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Health / RAG ───────────────────────────────────── */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ShieldAlert className="h-4 w-4" />
            Health
          </div>
          <div className="flex items-center gap-3">
            <Badge className={`${getPmHealthBadgeClass(RAG_TO_HEALTH[summary.health_rag])} text-sm px-3 py-1`}>
              {summary.health_label}
            </Badge>
          </div>
          <ul className="space-y-0.5">
            {(summary.health_reason_lines.length > 0
              ? summary.health_reason_lines
              : ["No issues detected"]
            ).map((line, i) => (
              <li
                key={i}
                className={`text-xs flex items-start gap-1.5 ${
                  summary.health_rag === "green"
                    ? "text-muted-foreground"
                    : "text-foreground"
                }`}
              >
                <CircleDot
                  className={`h-2.5 w-2.5 mt-1 shrink-0 ${getPmHealthDotClass(RAG_TO_HEALTH[summary.health_rag])}`}
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* ── Schedule signal ────────────────────────────────── */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <CalendarClock className="h-4 w-4" />
            Schedule
          </div>
          <div className="flex items-center gap-3">
            <Badge
              className={`${scheduleBadgeClass[summary.schedule_signal]} text-sm px-3 py-1`}
            >
              {scheduleLabel[summary.schedule_signal]}
            </Badge>
          </div>
          <ul className="space-y-0.5">
            {(summary.schedule_reason_lines.length > 0
              ? summary.schedule_reason_lines
              : summary.schedule_signal === "on_track"
                ? ["On schedule"]
                : summary.schedule_signal === "complete"
                  ? ["All phases complete"]
                  : summary.schedule_signal === "no_schedule_basis"
                    ? ["No target end date set"]
                    : []
            ).map((line, i) => (
              <li
                key={i}
                className="text-xs flex items-start gap-1.5 text-foreground"
              >
                <CircleDot className="h-2.5 w-2.5 mt-1 shrink-0 text-muted-foreground" />
                <span>{line}</span>
              </li>
            ))}
            {(summary.behind_phase_count > 0 || summary.behind_task_count > 0) && (
              <li className="text-xs text-muted-foreground pt-1">
                {summary.behind_phase_count > 0 &&
                  `${summary.behind_phase_count} phase${summary.behind_phase_count === 1 ? "" : "s"} behind`}
                {summary.behind_phase_count > 0 && summary.behind_task_count > 0 && " · "}
                {summary.behind_task_count > 0 &&
                  `${summary.behind_task_count} task${summary.behind_task_count === 1 ? "" : "s"} behind`}
              </li>
            )}
          </ul>
        </CardContent>
      </Card>

      {/* ── Baseline variance (separate, only when baselined) ── */}
      {summary.is_baselined && (
        <Card className="md:col-span-2 xl:col-span-4">
          <CardContent className="pt-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Flag className="h-4 w-4" />
                Baseline Variance
              </div>
              <div className="flex items-center gap-4 text-sm flex-wrap">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Baseline end</span>
                  <span className="font-medium text-foreground">
                    {summary.baseline_end_date ?? "—"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Target end</span>
                  <span className="font-medium text-foreground">
                    {summary.target_end_date ?? "—"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">Variance</span>
                  <span
                    className={`font-medium ${
                      (summary.baseline_slip_days ?? 0) > 0
                        ? "text-[hsl(var(--destructive))]"
                        : (summary.baseline_slip_days ?? 0) < 0
                          ? "text-[hsl(var(--success))]"
                          : "text-foreground"
                    }`}
                  >
                    {formatSlip(summary.baseline_slip_days)}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Baseline variance is reported separately from the Schedule signal
              and does not override it.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
