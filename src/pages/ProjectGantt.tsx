import { useOutletContext, useParams, Link } from "react-router-dom";
import { useProjectPhases, usePhaseTasks, useProjectDependencies } from "@/hooks/useProjectPlanning";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { GanttChart } from "@/components/gantt/GanttChart";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PhaseFormDialog } from "@/components/planning/PhaseFormDialog";
import { Plus, ArrowRight, GanttChartSquare } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * Measures the element's distance from the top of the viewport and returns a
 * height that consumes the remaining viewport space. Layout-only: keeps the
 * Work plan surface height-constrained so only the Gantt rows scroll.
 */
function useAvailableHeight(bottomGutter = 24) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      // Bound by the nearest scrolling ancestor (the app shell <main>) so the
      // Gantt body owns the overflow instead of the page.
      let bottom = window.innerHeight;
      let parent: HTMLElement | null = el.parentElement;
      while (parent) {
        const style = window.getComputedStyle(parent);
        if (/(auto|scroll|hidden)/.test(style.overflowY)) {
          bottom = Math.min(bottom, parent.getBoundingClientRect().bottom);
          break;
        }
        parent = parent.parentElement;
      }
      setHeight(Math.max(320, bottom - top - bottomGutter));
    };
    measure();
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [bottomGutter]);

  return { ref, height };
}

import type { Tables } from "@/integrations/supabase/types";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";

export default function ProjectGantt() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const context = useOutletContext<{ project: Tables<"projects">; workspace: { id: string; name: string } }>();
  const project = context?.project;

  const { data: phases = [], isLoading: phasesLoading } = useProjectPhases(projectId);
  const { data: allTasks = [], isLoading: tasksLoading } = usePhaseTasks(projectId);
  const { data: members = [] } = useWorkspaceMembers(project?.workspace_id);
  const { canEdit } = useProjectPlanningAuthority(projectId);

  const [addPhaseOpen, setAddPhaseOpen] = useState(false);
  const { ref: frameRef, height: frameHeight } = useAvailableHeight();


  const membersMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) map[m.id] = m.display_name;
    return map;
  }, [members]);

  const phaseIds = phases.map(p => p.id);
  const taskIds = allTasks.map(t => t.id);
  const { data: dependencies = [] } = useProjectDependencies(projectId, phaseIds, taskIds);

  if (phasesLoading || tasksLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!project) return null;

  const activePhases = phases.filter((p: any) => !p.is_archived);
  const planningPath = `/workspace/${workspaceId}/project/${projectId}/planning`;

  if (activePhases.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center justify-center text-center py-16 px-4 border border-dashed border-border rounded-md bg-muted/30">
          <GanttChartSquare className="h-10 w-10 text-muted-foreground mb-3" />
          <h3 className="text-base font-semibold text-foreground mb-1">Nothing to chart yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mb-4">
            The Gantt timeline is built from this project's phases and tasks. Add a phase to get started, or open Planning to set things up.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {canEdit && (
              <Button size="sm" onClick={() => setAddPhaseOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add phase
              </Button>
            )}
            <Button size="sm" variant="outline" asChild>
              <Link to={planningPath}>
                Go to Planning <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </div>
        </div>

        {addPhaseOpen && projectId && project.workspace_id && project.organization_id && (
          <PhaseFormDialog
            open={addPhaseOpen}
            onClose={() => setAddPhaseOpen(false)}
            projectId={projectId}
            workspaceId={project.workspace_id}
            organizationId={project.organization_id}
            allPhases={phases as any}
            existingPhaseCount={0}
          />
        )}
      </>
    );
  }

  return (
    <div
      ref={frameRef}
      data-workplan-frame
      className="flex min-h-[420px] flex-col gap-3 overflow-hidden"
      style={frameHeight ? { height: frameHeight } : undefined}
    >
      <div className="shrink-0 flex items-center justify-end">
        <KnowledgeLink slug="how-to-use-gantt" label="How to use Gantt" />
      </div>
      <GanttChart
        project={project}
        phases={phases}
        tasks={allTasks}
        dependencies={dependencies}
        membersMap={membersMap}
        canEdit={canEdit}
      />
    </div>
  );
}

