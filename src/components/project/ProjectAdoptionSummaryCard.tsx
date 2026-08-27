import { Link } from "react-router-dom";
import { HeartHandshake, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type {
  AdoptionSignal,
  ProjectAdoptionReportingSummary,
} from "@/lib/adoptionReportingSummary";

interface ProjectAdoptionSummaryCardProps {
  summary: ProjectAdoptionReportingSummary | null | undefined;
  isLoading: boolean;
  isError: boolean;
  workspaceId: string;
  projectId: string;
}

const SIGNAL_BADGE_CLASS: Record<AdoptionSignal, string> = {
  ready:
    "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/30",
  on_track:
    "bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] border-[hsl(var(--success))]/30",
  preparing: "bg-muted text-muted-foreground border-border",
  attention:
    "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30",
  at_risk:
    "bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))] border-[hsl(var(--destructive))]/30",
  not_enabled: "bg-muted text-muted-foreground border-border",
};

function readinessLabel(status: string | null): string {
  if (!status) return "Not started";
  return status
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

export function ProjectAdoptionSummaryCard({
  summary,
  isLoading,
  isError,
  workspaceId,
  projectId,
}: ProjectAdoptionSummaryCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    // Compact unavailable — never noisy for projects with no plan.
    return null;
  }

  if (!summary || !summary.has_adoption_plan) {
    // Prefer hiding for non-adoption projects to keep overview uncluttered.
    return null;
  }

  const adoptionUrl = `/workspace/${workspaceId}/project/${projectId}/adoption`;
  const reasons = summary.reason_lines?.slice(0, 3) ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2">
            <HeartHandshake className="h-4 w-4 text-primary" />
            Adoption Plan
          </CardTitle>
          <Badge
            variant="outline"
            className={cn(
              "text-[11px] px-2 py-0.5",
              SIGNAL_BADGE_CLASS[summary.adoption_signal],
            )}
          >
            {summary.adoption_label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <Stat label="Readiness" value={readinessLabel(summary.readiness_status)} />
          <Stat label="Open tasks" value={summary.adoption_task_open_count} />
          <Stat
            label="Overdue"
            value={summary.adoption_task_overdue_count}
            tone={summary.adoption_task_overdue_count > 0 ? "danger" : "muted"}
          />
          <Stat
            label="Linked R/B/K"
            value={`${summary.adoption_risk_count}/${summary.adoption_blocker_count}/${summary.adoption_kpi_count}`}
          />
        </div>

        {reasons.length > 0 && (
          <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-4">
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}

        <div className="pt-1">
          <Button variant="outline" size="sm" asChild className="text-xs h-8">
            <Link to={adoptionUrl}>
              Open Adoption Plan
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "danger" | "muted";
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-sm font-medium",
          tone === "danger" && "text-[hsl(var(--destructive))]",
          tone === "muted" && "text-muted-foreground",
          tone === "default" && "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}
