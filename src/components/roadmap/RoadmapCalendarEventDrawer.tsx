import { useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Flag,
  ExternalLink,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import {
  type LandingEvent,
  type ProjectWindow,
  getStatusTone,
  MARKER_TYPE_LABELS,
  parseYmd,
  dayLongLabel,
} from "./roadmapCalendarUtils";
import type { RoadmapProject, RoadmapDep } from "@/hooks/useRoadmapData";
import type { ProjectDashboardData } from "@/hooks/useRoadmapDashboardData";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: LandingEvent | null;
  /** All filtered projects (already loaded). Used to resolve project context + dep target names. */
  projects: RoadmapProject[];
  /** Per-project derived completion map. */
  dashboardData: Map<string, ProjectDashboardData> | undefined;
  dashboardLoading: boolean;
  /** Project↔project dependencies across user's visible portfolio. */
  deps: RoadmapDep[];
  /** Open the parent project page. */
  onOpenProject: (project: ProjectWindow | RoadmapProject) => void;
  /** Open the phase/task detail page for a marker. */
  onOpenMarkerObject: (event: LandingEvent) => void;
}

const PRIORITY_LABELS: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function formatDate(s: string | null | undefined): string {
  const d = parseYmd(s ?? null);
  return d ? dayLongLabel(d) : "—";
}

export function RoadmapCalendarEventDrawer({
  open,
  onOpenChange,
  event,
  projects,
  dashboardData,
  dashboardLoading,
  deps,
  onOpenProject,
  onOpenMarkerObject,
}: Props) {
  // ── Resolve parent project from the event ──
  const projectId = event
    ? event.kind === "marker"
      ? event.marker?.project_id ?? null
      : event.project?.id ?? null
    : null;

  const project = useMemo<RoadmapProject | null>(() => {
    if (!projectId) return null;
    return projects.find((p) => p.id === projectId) ?? null;
  }, [projectId, projects]);

  // ── Completion ──
  const completion = projectId ? dashboardData?.get(projectId) : undefined;

  // ── Project-level dependency context ──
  const { incoming, outgoing } = useMemo(() => {
    if (!projectId) return { incoming: [] as RoadmapProject[], outgoing: [] as RoadmapProject[] };
    const projectMap = new Map(projects.map((p) => [p.id, p]));
    const incomingList: RoadmapProject[] = [];
    const outgoingList: RoadmapProject[] = [];
    for (const d of deps) {
      if (d.source_id === projectId) {
        const tgt = projectMap.get(d.target_id);
        if (tgt) outgoingList.push(tgt);
      } else if (d.target_id === projectId) {
        const src = projectMap.get(d.source_id);
        if (src) incomingList.push(src);
      }
    }
    return { incoming: incomingList, outgoing: outgoingList };
  }, [projectId, deps, projects]);

  if (!event) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md" />
      </Sheet>
    );
  }

  const isMarker = event.kind === "marker";
  const isStart = event.kind === "start";

  // ── Header content ──
  const familyLabel = isMarker ? "Key marker" : isStart ? "Project start" : "Target end";
  const FamilyIcon = isMarker ? Flag : isStart ? ArrowUpFromLine : ArrowDownToLine;
  const familyTone = isMarker
    ? "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]"
    : isStart
      ? "bg-primary/15 text-primary"
      : "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]";

  const projectName = project?.name ?? event.project?.name ?? event.marker?.project_name ?? "—";
  const projectStatus = project?.status ?? event.project?.status ?? event.marker?.project_status ?? "planned";
  const tone = getStatusTone(projectStatus);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="p-4 pb-3 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded", familyTone)}>
              <FamilyIcon className="h-3.5 w-3.5" />
            </span>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
              {familyLabel}
            </Badge>
            {isMarker && event.marker && (
              <Badge
                variant="outline"
                className="text-[10px] uppercase tracking-wide border-[hsl(var(--warning))]/40 text-[hsl(var(--warning))]"
              >
                {MARKER_TYPE_LABELS[event.marker.semantic_type]}
              </Badge>
            )}
          </div>
          <SheetTitle className="text-base leading-snug">
            {isMarker && event.marker ? event.marker.object_name : projectName}
          </SheetTitle>
          <SheetDescription className="text-xs">{formatDate(event.date)}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* ── Marker-specific context ── */}
          {isMarker && event.marker && (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Marker
              </h3>
              <div className="space-y-1 text-sm">
                <Row label="Object kind" value={<span className="capitalize">{event.marker.object_kind}</span>} />
                <Row label="Semantic type" value={MARKER_TYPE_LABELS[event.marker.semantic_type]} />
                <Row
                  label="Date source"
                  value={event.marker.object_kind === "phase" ? "phase.target_end_date" : "task.due_date"}
                />
                {event.marker.phase_name && (
                  <Row label="Parent phase" value={event.marker.phase_name} />
                )}
              </div>
            </section>
          )}

          {/* ── Project context ── */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Project context
            </h3>
            <div className="space-y-1 text-sm">
              <Row label="Project" value={projectName} />
              <Row label="Workspace" value={project?.workspace_name ?? event.project?.workspace_name ?? "—"} />
              <Row label="Program" value={project?.program_name ?? event.project?.program_name ?? "Standalone"} />
              <Row
                label="Status"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <span className={cn("inline-block h-2 w-2 rounded-sm", tone.dot)} />
                    {tone.label}
                  </span>
                }
              />
              <Row
                label="Priority"
                value={PRIORITY_LABELS[project?.priority ?? event.project?.priority ?? ""] ?? "—"}
              />
              <Row label="Planned start" value={formatDate(project?.start_date ?? event.project?.start ?? null)} />
              <Row label="Target end" value={formatDate(project?.target_end_date ?? event.project?.end ?? null)} />
            </div>
          </section>

          {/* ── Progress / completion ── */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Progress
            </h3>
            {dashboardLoading ? (
              <Skeleton className="h-4 w-full" />
            ) : completion ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {completion.completionPercent}%
                  </span>
                </div>
                <Progress value={completion.completionPercent} className="h-1.5" />
                <p className="text-[11px] text-muted-foreground">
                  {completion.completionBasis === "duration"
                    ? "Duration-weighted completion based on planned task duration."
                    : completion.completionBasis === "task_count"
                    ? "Using task-count basis — some tasks are missing planned start/end dates."
                    : "Progress unavailable — no actionable tasks."}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {completion.taskCompleted} of {completion.taskTotal} actionable tasks completed
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">Completion unavailable</p>
            )}
          </section>

          {/* ── Project-level dependency context ── */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Project dependencies
            </h3>
            {incoming.length === 0 && outgoing.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No cross-project dependencies for this project.
              </p>
            ) : (
              <div className="space-y-3">
                <DepGroup
                  icon={<ArrowLeft className="h-3 w-3" />}
                  heading={`Depends on (${incoming.length})`}
                  items={incoming}
                  onOpen={onOpenProject}
                />
                <DepGroup
                  icon={<ArrowRight className="h-3 w-3" />}
                  heading={`Feeds into (${outgoing.length})`}
                  items={outgoing}
                  onOpen={onOpenProject}
                />
              </div>
            )}
          </section>
        </div>

        {/* ── Actions ── */}
        <div className="border-t border-border p-3 flex flex-col gap-2">
          {isMarker && (
            <Button
              variant="default"
              size="sm"
              className="w-full justify-between"
              onClick={() => onOpenMarkerObject(event)}
            >
              <span className="flex items-center gap-2">
                <ExternalLink className="h-3.5 w-3.5" />
                Open {event.marker?.object_kind ?? "object"}
              </span>
            </Button>
          )}
          <Button
            variant={isMarker ? "outline" : "default"}
            size="sm"
            className="w-full justify-between"
            onClick={() => {
              if (project) onOpenProject(project);
              else if (event.project) onOpenProject(event.project);
            }}
          >
            <span className="flex items-center gap-2">
              <ExternalLink className="h-3.5 w-3.5" />
              Open project
            </span>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-xs text-muted-foreground flex-shrink-0">{label}</span>
      <span className="text-foreground text-right break-words">{value}</span>
    </div>
  );
}

function DepGroup({
  icon,
  heading,
  items,
  onOpen,
}: {
  icon: React.ReactNode;
  heading: string;
  items: RoadmapProject[];
  onOpen: (p: RoadmapProject) => void;
}) {
  if (items.length === 0) {
    return (
      <div>
        <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
          {icon}
          {heading}
        </p>
        <p className="text-[11px] text-muted-foreground italic mt-1">None</p>
      </div>
    );
  }
  const visible = items.slice(0, 3);
  const more = items.length - visible.length;
  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
        {icon}
        {heading}
      </p>
      <ul className="mt-1 space-y-0.5">
        {visible.map((p) => {
          const tone = getStatusTone(p.status);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onOpen(p)}
                className="w-full text-left text-xs px-1.5 py-1 rounded hover:bg-accent/50 transition flex items-center gap-1.5"
              >
                <span className={cn("inline-block h-2 w-2 rounded-sm flex-shrink-0", tone.dot)} />
                <span className="truncate text-foreground">{p.name}</span>
                <span className="text-[10px] text-muted-foreground truncate ml-auto">
                  {p.workspace_name}
                </span>
              </button>
            </li>
          );
        })}
        {more > 0 && (
          <li className="text-[10px] text-muted-foreground px-1.5">+{more} more</li>
        )}
      </ul>
    </div>
  );
}
