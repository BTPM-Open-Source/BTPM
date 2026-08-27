import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ShieldAlert, CalendarClock } from "lucide-react";
import type {
  ProjectReportingSummary,
  ReportingHealthRag,
  ReportingScheduleSignal,
} from "@/lib/reportingSummary";
import {
  getPmHealthBadgeClass,
  getPmHealthDotClass,
  getPmHealthBarBorderClass,
  getPmWorkflowStatusBadgeClass,
  getPmWorkflowStatusDotClass,
  type PmHealth,
} from "@/lib/btpmVisualSemantics";

/**
 * Wave B Step B.4 — Compact, shared indicators for Health/RAG and Schedule
 * signal on roadmap dashboard cards and timeline rows.
 *
 * These are pure renderers of the canonical B.2 contract. All colors derive
 * from btpmVisualSemantics so there is only one source of truth.
 */

export const HEALTH_LABELS: Record<ReportingHealthRag, string> = {
  green: "On Track",
  amber: "Needs Attention",
  red: "At Risk",
};

const RAG_TO_HEALTH: Record<ReportingHealthRag, PmHealth> = {
  green: "on_track",
  amber: "needs_attention",
  red: "at_risk",
};

/** Tailwind border-color class for timeline bar tints (Health left edge). */
export const HEALTH_BAR_BORDER_CLASS: Record<ReportingHealthRag, string> = {
  green: getPmHealthBarBorderClass("on_track"),
  amber: getPmHealthBarBorderClass("needs_attention"),
  red: getPmHealthBarBorderClass("at_risk"),
};

export const SCHEDULE_LABELS: Record<ReportingScheduleSignal, string> = {
  on_track: "On Track",
  behind_schedule: "Behind",
  complete: "Complete",
  no_schedule_basis: "No Basis",
};

function healthBadgeClsFor(rag: ReportingHealthRag): string {
  return getPmHealthBadgeClass(RAG_TO_HEALTH[rag]);
}

function healthDotClsFor(rag: ReportingHealthRag): string {
  return getPmHealthDotClass(RAG_TO_HEALTH[rag]);
}

function scheduleBadgeClsFor(sig: ReportingScheduleSignal): string {
  if (sig === "on_track") return getPmHealthBadgeClass("on_track");
  if (sig === "behind_schedule") return getPmHealthBadgeClass("behind");
  if (sig === "complete") return getPmWorkflowStatusBadgeClass("completed");
  return "bg-muted text-muted-foreground border-transparent";
}

function scheduleDotClsFor(sig: ReportingScheduleSignal): string {
  if (sig === "on_track") return getPmHealthDotClass("on_track");
  if (sig === "behind_schedule") return getPmHealthDotClass("behind");
  if (sig === "complete") return getPmWorkflowStatusDotClass("completed");
  return "bg-muted-foreground/40";
}

interface ChipProps {
  summary: ProjectReportingSummary | null | undefined;
  /** When true, render a single-letter compact form for very tight surfaces. */
  compact?: boolean;
}

export function HealthChip({ summary, compact = false }: ChipProps) {
  if (!summary) {
    return (
      <Badge
        variant="outline"
        className="text-[10px] px-1.5 py-0 h-4 gap-1 text-muted-foreground"
        title="Health unavailable"
      >
        <ShieldAlert className="h-2.5 w-2.5" />
        {compact ? "—" : "Health: —"}
      </Badge>
    );
  }
  const cls = healthBadgeClsFor(summary.health_rag);
  const tooltip = `Health: ${HEALTH_LABELS[summary.health_rag]}${
    summary.health_reason_lines.length > 0
      ? "\n• " + summary.health_reason_lines.join("\n• ")
      : ""
  }`;
  return (
    <Badge
      className={cn("text-[10px] px-1.5 py-0 h-4 gap-1 font-medium", cls)}
      title={tooltip}
    >
      <ShieldAlert className="h-2.5 w-2.5" />
      {compact ? HEALTH_LABELS[summary.health_rag][0] : HEALTH_LABELS[summary.health_rag]}
    </Badge>
  );
}

export function ScheduleChip({ summary, compact = false }: ChipProps) {
  if (!summary) {
    return (
      <Badge
        variant="outline"
        className="text-[10px] px-1.5 py-0 h-4 gap-1 text-muted-foreground"
        title="Schedule unavailable"
      >
        <CalendarClock className="h-2.5 w-2.5" />
        {compact ? "—" : "Schedule: —"}
      </Badge>
    );
  }
  const cls = scheduleBadgeClsFor(summary.schedule_signal);
  const tooltip = `Schedule: ${SCHEDULE_LABELS[summary.schedule_signal]}${
    summary.schedule_reason_lines.length > 0
      ? "\n• " + summary.schedule_reason_lines.join("\n• ")
      : ""
  }`;
  return (
    <Badge
      className={cn("text-[10px] px-1.5 py-0 h-4 gap-1 font-medium", cls)}
      title={tooltip}
    >
      <CalendarClock className="h-2.5 w-2.5" />
      {compact
        ? SCHEDULE_LABELS[summary.schedule_signal][0]
        : SCHEDULE_LABELS[summary.schedule_signal]}
    </Badge>
  );
}

/** Tiny dot pair for very tight rows (timeline label column). */
export function HealthScheduleDots({
  summary,
}: {
  summary: ProjectReportingSummary | null | undefined;
}) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <span
        className={cn(
          "w-2 h-2 rounded-full ring-1 ring-background",
          summary
            ? healthDotClsFor(summary.health_rag)
            : "bg-muted-foreground/30",
        )}
        title={
          summary
            ? `Health: ${HEALTH_LABELS[summary.health_rag]}`
            : "Health unavailable"
        }
      />
      <span
        className={cn(
          "w-2 h-2 rounded-sm ring-1 ring-background",
          summary
            ? scheduleDotClsFor(summary.schedule_signal)
            : "bg-muted-foreground/30",
        )}
        title={
          summary
            ? `Schedule: ${SCHEDULE_LABELS[summary.schedule_signal]}`
            : "Schedule unavailable"
        }
      />
    </div>
  );
}
