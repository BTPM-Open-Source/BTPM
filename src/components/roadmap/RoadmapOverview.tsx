import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronDown,
  ChevronRight,
  PlayCircle,
  CalendarClock,
  AlertTriangle,
  CalendarDays,
  User,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getPmHealthBadgeClass } from "@/lib/btpmVisualSemantics";
import type { RoadmapProject } from "@/hooks/useRoadmapData";
import type { ProjectDashboardData } from "@/hooks/useRoadmapDashboardData";
import type { ProjectReportingSummary } from "@/lib/reportingSummary";
import { getRoadmapLifecycleGroup } from "@/lib/roadmapLifecycle";

/**
 * UX-1.6 — Roadmap operational overview.
 *
 * Lightweight, calm orientation layer answering:
 *   - What is currently active? (Current Timeline)
 *   - What is approaching?      (Upcoming Work)
 *   - What may need attention?  (At Risk / Delayed)
 *
 * No KPI strip, no portfolio analytics, no PMO scorecards. All values are
 * derived from the canonical project rows + the existing B.2 reporting
 * contract that other Roadmap surfaces already consume.
 */

interface Props {
  filtered: RoadmapProject[];
  reportingByProjectId: Map<string, ProjectReportingSummary>;
  dashboardData: Map<string, ProjectDashboardData> | undefined;
  dashboardLoading: boolean;
  activeTab: string;
}

const COLLAPSE_KEY = "btpm.roadmap.overview.collapsed.v1";
const UPCOMING_HORIZON_DAYS = 90;

type SectionKey = "active" | "upcoming" | "attention";

const SECTION_META: Record<SectionKey, { title: string; icon: React.ComponentType<any>; tone: string; help: string }> = {
  active: {
    title: "Current",
    icon: PlayCircle,
    tone: "text-primary",
    help: "Projects currently in execution",
  },
  upcoming: {
    title: "Upcoming",
    icon: CalendarClock,
    tone: "text-muted-foreground",
    help: `Approaching within the next ${UPCOMING_HORIZON_DAYS} days`,
  },
  attention: {
    title: "Needs Attention",
    icon: AlertTriangle,
    tone: "text-[hsl(var(--destructive))]",
    help: "Behind schedule, at risk, or past target",
  },
};

function readCollapsed(): Record<SectionKey, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (raw) return { active: false, upcoming: false, attention: false, ...JSON.parse(raw) };
  } catch {
    /* noop */
  }
  return { active: false, upcoming: false, attention: false };
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "No date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No date";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function ProjectLine({
  project,
  reporting,
  dash,
  activeTab,
}: {
  project: RoadmapProject;
  reporting: ProjectReportingSummary | undefined;
  dash: ProjectDashboardData | undefined;
  activeTab: string;
}) {
  const navigate = useNavigate();
  const onClick = () => {
    const returnTo = `/roadmap?tab=${activeTab}`;
    navigate(
      `/workspace/${project.workspace_id}/project/${project.id}?from=roadmap&returnTo=${encodeURIComponent(returnTo)}`,
      { state: { from: "roadmap", returnTo } },
    );
  };

  const dDays = daysUntil(project.target_end_date);
  const overdue = dDays !== null && dDays < 0 && project.status !== "completed";
  const behind = reporting?.schedule_signal === "behind_schedule";
  const atRisk = reporting?.health_rag === "red";

  return (
    <Card
      className="hover:bg-accent/40 transition-colors cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <CardContent className="py-2.5 px-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <p className="font-medium text-sm text-foreground truncate">{project.name}</p>
            {atRisk && (
              <Badge className={cn("text-[10px] px-1.5 py-0 h-4", getPmHealthBadgeClass("at_risk"))}>
                At risk
              </Badge>
            )}
            {behind && !atRisk && (
              <Badge className={cn("text-[10px] px-1.5 py-0 h-4", getPmHealthBadgeClass("behind"))}>
                Behind
              </Badge>
            )}
            {overdue && !behind && !atRisk && (
              <Badge className={cn("text-[10px] px-1.5 py-0 h-4", getPmHealthBadgeClass("overdue"))}>
                Overdue
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1 truncate">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{project.workspace_name}</span>
            </span>
            {project.program_name && (
              <>
                <span>·</span>
                <span className="truncate">{project.program_name}</span>
              </>
            )}
            {dash?.ownerName && (
              <>
                <span>·</span>
                <span className="flex items-center gap-1 truncate">
                  <User className="h-3 w-3 shrink-0" />
                  <span className="truncate">{dash.ownerName}</span>
                </span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-muted-foreground flex items-center gap-1">
          <CalendarDays className="h-3 w-3" />
          <span className={cn(overdue && "text-destructive font-medium")}>
            {fmtDate(project.target_end_date)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Section({
  k,
  items,
  reportingByProjectId,
  dashboardData,
  collapsed,
  onToggle,
  activeTab,
}: {
  k: SectionKey;
  items: RoadmapProject[];
  reportingByProjectId: Map<string, ProjectReportingSummary>;
  dashboardData: Map<string, ProjectDashboardData> | undefined;
  collapsed: boolean;
  onToggle: () => void;
  activeTab: string;
}) {
  const meta = SECTION_META[k];
  const Icon = meta.icon;
  return (
    <Collapsible open={!collapsed} onOpenChange={onToggle}>
      <CollapsibleTrigger className="w-full flex items-center gap-2 py-2 group">
        {collapsed ? (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
        <Icon className={cn("h-4 w-4", meta.tone)} />
        <h2 className="text-sm font-semibold text-foreground">{meta.title}</h2>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
          {items.length}
        </Badge>
        <span className="text-xs text-muted-foreground hidden sm:inline">— {meta.help}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1.5 pl-1 pt-1">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-3">Nothing here right now.</p>
        ) : (
          items.map((p) => (
            <ProjectLine
              key={p.id}
              project={p}
              reporting={reportingByProjectId.get(p.id)}
              dash={dashboardData?.get(p.id)}
              activeTab={activeTab}
            />
          ))
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function RoadmapOverview({
  filtered,
  reportingByProjectId,
  dashboardData,
  dashboardLoading,
  activeTab,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>(readCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed));
    } catch {
      /* noop */
    }
  }, [collapsed]);

  const sections = useMemo(() => {
    const active: RoadmapProject[] = [];
    const upcoming: RoadmapProject[] = [];
    const attention: RoadmapProject[] = [];
    const seenAttention = new Set<string>();
    const asOf = new Date();

    for (const p of filtered) {
      const r = reportingByProjectId.get(p.id);
      const dEnd = daysUntil(p.target_end_date);
      const overdue = dEnd !== null && dEnd < 0 && p.status !== "completed";
      const needsAttention =
        r?.schedule_signal === "behind_schedule" || r?.health_rag === "red" || overdue;

      if (needsAttention) {
        attention.push(p);
        seenAttention.add(p.id);
      }

      const group = getRoadmapLifecycleGroup(
        {
          status: p.status,
          project_stage: p.project_stage,
          start_date: p.start_date,
          progressPercent: dashboardData?.get(p.id)?.completionPercent ?? null,
        },
        asOf,
      );

      if (group === "current") {
        active.push(p);
      } else if (group === "upcoming") {
        const dStart = daysUntil(p.start_date);
        if (dStart === null || (dStart >= 0 && dStart <= UPCOMING_HORIZON_DAYS)) {
          upcoming.push(p);
        }
      }
    }

    const byEnd = (a: RoadmapProject, b: RoadmapProject) =>
      (a.target_end_date || "9999").localeCompare(b.target_end_date || "9999") ||
      a.name.localeCompare(b.name);
    const byStart = (a: RoadmapProject, b: RoadmapProject) =>
      (a.start_date || "9999").localeCompare(b.start_date || "9999") ||
      a.name.localeCompare(b.name);

    active.sort(byEnd);
    upcoming.sort(byStart);
    attention.sort(byEnd);

    return { active, upcoming, attention };
  }, [filtered, reportingByProjectId, dashboardData]);


  if (dashboardLoading && filtered.length > 0 && !dashboardData) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground">
        No projects match the current scope.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Section
        k="attention"
        items={sections.attention}
        reportingByProjectId={reportingByProjectId}
        dashboardData={dashboardData}
        collapsed={collapsed.attention}
        onToggle={() =>
          setCollapsed((c) => ({ ...c, attention: !c.attention }))
        }
        activeTab={activeTab}
      />
      <Section
        k="active"
        items={sections.active}
        reportingByProjectId={reportingByProjectId}
        dashboardData={dashboardData}
        collapsed={collapsed.active}
        onToggle={() => setCollapsed((c) => ({ ...c, active: !c.active }))}
        activeTab={activeTab}
      />
      <Section
        k="upcoming"
        items={sections.upcoming}
        reportingByProjectId={reportingByProjectId}
        dashboardData={dashboardData}
        collapsed={collapsed.upcoming}
        onToggle={() => setCollapsed((c) => ({ ...c, upcoming: !c.upcoming }))}
        activeTab={activeTab}
      />
    </div>
  );
}
