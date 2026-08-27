import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LayoutGrid,
  CheckCircle2,
  PlayCircle,
  Clock,
  Building2,
  FolderKanban,
  User,
  CalendarDays,
  Zap,
  ShieldAlert,
  CalendarClock,
} from "lucide-react";
import type { RoadmapProject } from "@/hooks/useRoadmapData";
import type { ProjectDashboardData } from "@/hooks/useRoadmapDashboardData";
import type { ProjectReportingSummary } from "@/lib/reportingSummary";
import type {
  AdoptionSignal,
  ProjectAdoptionReportingSummary,
} from "@/lib/adoptionReportingSummary";
import { cn } from "@/lib/utils";
import {
  PROJECT_STAGE_BADGE_CLASS,
  PROJECT_STAGE_LABELS,
  isProjectStage,
} from "@/lib/projectStage";
import { pmStatusLabel, pmStatusBadgeClass } from "@/lib/projectStatus";
import {
  getPmWorkflowStatusBorderTopClass,
  getPmHealthDotClass,
  getPmWorkflowStatusHex,
  getPmHealthHex,
} from "@/lib/btpmVisualSemantics";
import {
  getRoadmapLifecycleGroup,
  type RoadmapLifecycleGroup,
} from "@/lib/roadmapLifecycle";
import {
  HealthChip,
  ScheduleChip,
} from "@/components/roadmap/HealthScheduleIndicators";

/* ── Roadmap lifecycle group (derived bucket) — used ONLY for sorting,
   KPI counts, and the top-border accent on cards. The card's status badge
   itself shows the actual workflow status via pmStatusLabel. */
const GROUP_ORDER: Record<RoadmapLifecycleGroup, number> = {
  current: 0,
  upcoming: 1,
  on_hold: 2,
  completed: 3,
  closed_cancelled: 4,
};

const GROUP_BORDER: Record<RoadmapLifecycleGroup, string> = {
  current: getPmWorkflowStatusBorderTopClass("active"),
  upcoming: getPmWorkflowStatusBorderTopClass("planned"),
  on_hold: getPmWorkflowStatusBorderTopClass("on_hold"),
  completed: getPmWorkflowStatusBorderTopClass("completed"),
  closed_cancelled: getPmWorkflowStatusBorderTopClass("cancelled"),
};


/* ── Roadmap-local progress bar ──────────────────────
   The shared <Progress /> component has a fixed `bg-primary` indicator. We
   need the indicator colour to reflect canonical Health / Schedule severity
   for Roadmap project cards specifically — without globally re-themeing
   progress bars elsewhere in the app. Behind schedule is orange (delay),
   red is reserved for at-risk / critical health. */
type ProgressTone = "green" | "amber" | "orange" | "red" | "muted";

function toneFromReporting(
  reporting: ProjectReportingSummary | undefined,
): ProgressTone {
  if (!reporting) return "muted";
  if (reporting.health_rag === "red") return "red";
  if (reporting.schedule_signal === "behind_schedule") return "orange";
  if (reporting.health_rag === "amber") return "amber";
  if (
    reporting.health_rag === "green" &&
    (reporting.schedule_signal === "on_track" ||
      reporting.schedule_signal === "complete" ||
      reporting.schedule_signal === "no_schedule_basis")
  ) {
    return "green";
  }
  return "muted";
}

const PROGRESS_TONE_CLASS: Record<ProgressTone, string> = {
  green: getPmHealthDotClass("on_track"),
  amber: getPmHealthDotClass("needs_attention"),
  orange: getPmHealthDotClass("behind"),
  red: getPmHealthDotClass("at_risk"),
  muted: "bg-muted-foreground/40",
};

function RoadmapProgressBar({
  value,
  tone,
}: {
  value: number;
  tone: ProgressTone;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary"
    >
      <div
        className={cn("h-full transition-all", PROGRESS_TONE_CLASS[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ── Sorting: lifecycle group → target_end_date → name ── */
function sortProjects(
  projects: RoadmapProject[],
  dashboardData: Map<string, ProjectDashboardData> | undefined,
): RoadmapProject[] {
  const groupOf = (p: RoadmapProject) =>
    getRoadmapLifecycleGroup({
      status: p.status,
      project_stage: p.project_stage,
      start_date: p.start_date,
      progressPercent: dashboardData?.get(p.id)?.completionPercent ?? null,
    });
  return [...projects].sort((a, b) => {
    const ba = GROUP_ORDER[groupOf(a)];
    const bb = GROUP_ORDER[groupOf(b)];
    if (ba !== bb) return ba - bb;
    const da = a.target_end_date || "9999";
    const db = b.target_end_date || "9999";
    if (da !== db) return da.localeCompare(db);
    return a.name.localeCompare(b.name);
  });
}


/* ── KPI Strip ───────────────────────────────────────
   Wave B.4: extended with two derived portfolio indicators sourced from the
   B.2 reporting contract — % red Health and # behind-schedule. They are
   rendered only when reporting data is present; otherwise the original four
   bucket KPIs render alone. No client-side derivation. */
function KpiStrip({
  projects,
  reportingByProjectId,
}: {
  projects: RoadmapProject[];
  reportingByProjectId: Map<string, ProjectReportingSummary>;
}) {
  const total = projects.length;
  // Lifecycle group counts — replaces old fallback-based bucket counts.
  // "Upcoming" now strictly means planned-and-not-started; in-progress no
  // longer absorbs on-hold/cancelled projects, and planned-but-started
  // projects are counted as In Progress.
  const groupOf = (p: RoadmapProject) =>
    getRoadmapLifecycleGroup({
      status: p.status,
      project_stage: p.project_stage,
      start_date: p.start_date,
      progressPercent: reportingByProjectId.get(p.id)?.completion_percent ?? null,
    });
  const completed = projects.filter((p) => groupOf(p) === "completed").length;
  const completedPct = total === 0 ? 0 : Math.round((completed / total) * 100);
  const inProgress = projects.filter((p) => groupOf(p) === "current").length;
  const upcoming = projects.filter((p) => groupOf(p) === "upcoming").length;


  // Reporting-derived KPIs — only count projects that have a B.2 row.
  const summaries = projects
    .map((p) => reportingByProjectId.get(p.id))
    .filter((s): s is ProjectReportingSummary => !!s);
  const reportingCovered = summaries.length;
  const redCount = summaries.filter((s) => s.health_rag === "red").length;
  const redPct = reportingCovered === 0 ? 0 : Math.round((redCount / reportingCovered) * 100);
  const behindCount = summaries.filter((s) => s.schedule_signal === "behind_schedule").length;

  const kpis: Array<{
    label: string;
    value: string | number;
    icon: typeof LayoutGrid;
    color?: string;
  }> = [
    { label: "Total Projects", value: total, icon: LayoutGrid },
    { label: "Completed Projects %", value: `${completedPct}%`, icon: CheckCircle2, color: getPmWorkflowStatusHex("completed") },
    { label: "In Progress", value: inProgress, icon: PlayCircle, color: getPmWorkflowStatusHex("active") },
    { label: "Upcoming", value: upcoming, icon: Clock },
  ];

  // Append reporting KPIs only if at least one project has reporting data.
  if (reportingCovered > 0) {
    kpis.push(
      {
        label: "At-Risk Projects %",
        value: `${redPct}%`,
        icon: ShieldAlert,
        color: getPmHealthHex("at_risk"),
      },
      {
        label: "Behind Schedule",
        value: behindCount,
        icon: CalendarClock,
        color: getPmHealthHex("behind"),
      },
    );
  }

  return (
    <div
      className={cn(
        "grid gap-3 grid-cols-2",
        kpis.length === 4
          ? "md:grid-cols-4"
          : "md:grid-cols-3 lg:grid-cols-6",
      )}
    >
      {kpis.map((k) => {
        const styled = k.color ? { color: k.color } : undefined;
        return (
          <Card key={k.label}>
            <CardContent className="pt-4 pb-3 px-4">
              <div
                className={cn(
                  "flex items-center gap-2 text-xs mb-1",
                  k.color ? "" : "text-muted-foreground",
                )}
                style={styled}
              >
                <k.icon className="h-3.5 w-3.5" style={styled} />
                <span className={k.color ? "" : "text-muted-foreground"}>{k.label}</span>
              </div>
              <span
                className={cn("text-2xl font-bold", k.color ? "" : "text-foreground")}
                style={styled}
              >
                {k.value}
              </span>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ── Adoption signal badge classes (CM.7) ── */
const ADOPTION_BADGE_CLASS: Record<AdoptionSignal, string> = {
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

/* ── Project Card ──────────────────────────────────── */
function ProjectCard({
  project,
  dashData,
  reporting,
  adoption,
  onClick,
}: {
  project: RoadmapProject;
  dashData: ProjectDashboardData | undefined;
  reporting: ProjectReportingSummary | undefined;
  adoption?: ProjectAdoptionReportingSummary | undefined;
  onClick: () => void;
}) {
  const completion = dashData?.completionPercent ?? 0;
  const lifecycleGroup = getRoadmapLifecycleGroup({
    status: project.status,
    project_stage: project.project_stage,
    start_date: project.start_date,
    progressPercent: completion,
  });
  const statusLabel = pmStatusLabel(project.status);
  const statusBadgeClass = pmStatusBadgeClass(project.status);
  const completionBasis = dashData?.completionBasis ?? "none";
  const completionTooltip =
    completionBasis === "duration"
      ? "Duration-weighted completion based on planned task duration."
      : completionBasis === "task_count"
      ? "Using task-count basis because some tasks are missing planned start/end dates."
      : "No actionable tasks to derive progress from.";
  const owner = dashData?.ownerName ?? "—";
  const endDate = project.target_end_date
    ? new Date(project.target_end_date).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "No date";


  return (
    <Card
      className={cn(
        "border-t-4 cursor-pointer transition-all hover:shadow-md hover:ring-2 hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-primary",
        GROUP_BORDER[lifecycleGroup]
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <CardContent className="pt-3 pb-3 px-4 space-y-2.5">
        {/* Status + Stage badges (Wave 5 Step 5.7) */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge className={cn("text-[10px] px-2 py-0.5", statusBadgeClass)} title="Project Status">
              {statusLabel}
            </Badge>
            {isProjectStage(project.project_stage) && (
              <Badge
                className={cn(
                  "text-[10px] px-2 py-0.5",
                  PROJECT_STAGE_BADGE_CLASS[project.project_stage],
                )}
                title="Project Stage"
              >
                Stage: {PROJECT_STAGE_LABELS[project.project_stage]}
              </Badge>
            )}
          </div>
          {project.agile_enabled && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-primary/40 text-primary">
              <Zap className="h-2.5 w-2.5" />
              Agile
            </Badge>
          )}
        </div>

        {/* Title */}
        <h4 className="text-sm font-semibold text-foreground leading-tight line-clamp-2">
          {project.name}
        </h4>

        {/* Health + Schedule (Wave B.4) — visually separate from Stage/Status above. */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <HealthChip summary={reporting} />
          <ScheduleChip summary={reporting} />
          {adoption && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0",
                ADOPTION_BADGE_CLASS[adoption.adoption_signal],
              )}
              title={
                adoption.adoption_task_overdue_count > 0
                  ? `${adoption.adoption_task_overdue_count} overdue adoption task${adoption.adoption_task_overdue_count === 1 ? "" : "s"}`
                  : undefined
              }
            >
              {adoption.adoption_label}
              {adoption.adoption_task_overdue_count > 0 &&
                ` · ${adoption.adoption_task_overdue_count} overdue`}
            </Badge>
          )}
        </div>

        {/* Owner + Date */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 truncate">
            <User className="h-3 w-3 shrink-0" />
            <span className="truncate">{owner}</span>
          </span>
          <span className="flex items-center gap-1 shrink-0">
            <CalendarDays className="h-3 w-3" />
            {endDate}
          </span>
        </div>

        {/* Progress (duration-weighted with safe fallback) */}
        <div className="space-y-1" title={completionTooltip}>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Progress
              {completionBasis === "task_count" && (
                <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  · count basis
                </span>
              )}
            </span>
            <span className="font-medium text-foreground">{completion}%</span>
          </div>
          <RoadmapProgressBar value={completion} tone={toneFromReporting(reporting)} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Main Dashboard Component ──────────────────────── */
interface ProjectDashboardProps {
  filtered: RoadmapProject[];
  dashboardData: Map<string, ProjectDashboardData> | undefined;
  dashboardLoading: boolean;
  reportingByProjectId: Map<string, ProjectReportingSummary>;
  adoptionByProjectId?: Map<string, ProjectAdoptionReportingSummary>;
}

export function ProjectDashboard({
  filtered,
  dashboardData,
  dashboardLoading,
  reportingByProjectId,
  adoptionByProjectId,
}: ProjectDashboardProps) {
  const navigate = useNavigate();

  // Group: workspace → program → projects
  const grouped = useMemo(() => {
    const byWs = new Map<
      string,
      {
        wsName: string;
        programs: Map<string, { progName: string; projects: RoadmapProject[] }>;
        noProgram: RoadmapProject[];
      }
    >();

    for (const p of filtered) {
      if (!byWs.has(p.workspace_id)) {
        byWs.set(p.workspace_id, {
          wsName: p.workspace_name,
          programs: new Map(),
          noProgram: [],
        });
      }
      const ws = byWs.get(p.workspace_id)!;
      if (p.program_id && p.program_name) {
        if (!ws.programs.has(p.program_id)) {
          ws.programs.set(p.program_id, { progName: p.program_name, projects: [] });
        }
        ws.programs.get(p.program_id)!.projects.push(p);
      } else {
        ws.noProgram.push(p);
      }
    }

    return byWs;
  }, [filtered]);

  if (filtered.length === 0) {
    return (
      <div className="space-y-4">
        <KpiStrip projects={[]} reportingByProjectId={reportingByProjectId} />
        <div className="text-center py-8 text-sm text-muted-foreground">
          No projects match the current filters.
        </div>
      </div>
    );
  }

  if (dashboardLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="pt-4 pb-3 px-4 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-12" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="pt-4 pb-3 px-4 space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-2 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <KpiStrip projects={filtered} reportingByProjectId={reportingByProjectId} />

      {Array.from(grouped).map(([wsId, ws]) => (
        <div key={wsId} className="space-y-3">
          {/* Workspace heading */}
          <div className="flex items-center gap-2 pt-1">
            <Building2 className="h-4 w-4 text-foreground" />
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
              {ws.wsName}
            </h3>
          </div>

          {/* Program subsections */}
          {Array.from(ws.programs).map(([progId, prog]) => (
            <div key={progId} className="space-y-2 pl-2">
              <div className="flex items-center gap-2">
                <FolderKanban className="h-3.5 w-3.5 text-primary" />
                <h4 className="text-xs font-semibold text-primary">{prog.progName}</h4>
                <span className="text-[10px] text-muted-foreground">
                  ({prog.projects.length})
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {sortProjects(prog.projects, dashboardData).map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    dashData={dashboardData?.get(p.id)}
                    reporting={reportingByProjectId.get(p.id)}
                    adoption={adoptionByProjectId?.get(p.id)}
                    onClick={() => {
                      const returnTo = `/roadmap?tab=dashboard`;
                      navigate(
                        `/workspace/${p.workspace_id}/project/${p.id}?from=roadmap&returnTo=${encodeURIComponent(returnTo)}`,
                        { state: { from: "roadmap", returnTo } }
                      );
                    }}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* No Program bucket */}
          {ws.noProgram.length > 0 && (
            <div className="space-y-2 pl-2">
              <div className="flex items-center gap-2">
                <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
                <h4 className="text-xs font-semibold text-muted-foreground">No Program</h4>
                <span className="text-[10px] text-muted-foreground">
                  ({ws.noProgram.length})
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {sortProjects(ws.noProgram, dashboardData).map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    dashData={dashboardData?.get(p.id)}
                    reporting={reportingByProjectId.get(p.id)}
                    adoption={adoptionByProjectId?.get(p.id)}
                    onClick={() => {
                      const returnTo = `/roadmap?tab=dashboard`;
                      navigate(
                        `/workspace/${p.workspace_id}/project/${p.id}?from=roadmap&returnTo=${encodeURIComponent(returnTo)}`,
                        { state: { from: "roadmap", returnTo } }
                      );
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
