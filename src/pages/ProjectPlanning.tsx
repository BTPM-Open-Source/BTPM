import { useOutletContext, useParams } from "react-router-dom";
import { useProjectPhases, usePhaseTasks, useProjectDependencies, useReorderPhases, useReorderTasks } from "@/hooks/useProjectPlanning";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { PhaseSection } from "@/components/planning/PhaseSection";
import { PhaseFormDialog } from "@/components/planning/PhaseFormDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, Eye } from "lucide-react";
import { useState, useMemo } from "react";
import type { Tables } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { ConceptHelp } from "@/components/knowledge/ConceptHelp";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";
import { KC_CONCEPTS } from "@/components/knowledge/kc-concepts";
import { useProjectAdoptionLinkBadges } from "@/hooks/useProjectAdoptionLinkBadges";


import { FindInProjectToolbar } from "@/components/project/FindInProjectToolbar";
import { computeFindState, type FindResult } from "@/lib/projectFindInProject";

export default function ProjectPlanning() {
  const { projectId } = useParams<{ projectId: string }>();
  const context = useOutletContext<{ project: Tables<"projects">; workspace: { id: string; name: string } }>();
  const project = context?.project;

  const { data: phases = [], isLoading: phasesLoading } = useProjectPhases(projectId);
  const { data: allTasks = [], isLoading: tasksLoading } = usePhaseTasks(projectId);
  const { canEdit, isLoading: authLoading } = useProjectPlanningAuthority(projectId);
  const { data: members = [] } = useWorkspaceMembers(project?.workspace_id);
  const adoptionBadges = useProjectAdoptionLinkBadges(projectId);

  const membersMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) map[m.id] = m.display_name;
    return map;
  }, [members]);

  const phaseIds = phases.map((p) => p.id);
  const taskIds = allTasks.map((t) => t.id);
  const { data: dependencies = [] } = useProjectDependencies(projectId, phaseIds, taskIds);

  const reorderPhases = useReorderPhases();
  const reorderTasks = useReorderTasks();
  const { toast } = useToast();
  const [showNewPhase, setShowNewPhase] = useState(false);

  // Find-in-project (frontend-only)
  const [findQuery, setFindQuery] = useState("");
  const [matchesOnly, setMatchesOnly] = useState(false);
  const findState = useMemo(
    () => computeFindState(findQuery, phases, allTasks),
    [findQuery, phases, allTasks]
  );

  const sortedPhases = [...phases].sort((a, b) => a.sort_order - b.sort_order);
  const visiblePhases = findState.active && matchesOnly
    ? sortedPhases.filter((p) => findState.contextPhaseIds.has(p.id))
    : sortedPhases;

  const handlePickResult = (r: FindResult) => {
    const sel = r.type === "phase"
      ? `[data-find-phase-id="${r.id}"]`
      : `[data-find-task-id="${r.id}"]`;
    requestAnimationFrame(() => {
      const el = document.querySelector(sel) as HTMLElement | null;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const handleMovePhase = async (phaseId: string, direction: "up" | "down") => {
    const idx = sortedPhases.findIndex((p) => p.id === phaseId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sortedPhases.length) return;
    try {
      await reorderPhases.mutateAsync([
        { id: sortedPhases[idx].id, sort_order: sortedPhases[swapIdx].sort_order },
        { id: sortedPhases[swapIdx].id, sort_order: sortedPhases[idx].sort_order },
      ]);
    } catch (e: any) {
      toast({ title: "Reorder failed", description: e.message, variant: "destructive" });
    }
  };

  const handleMoveTask = async (taskId: string, phaseId: string, direction: "up" | "down") => {
    const phaseTasks = allTasks.filter((t) => t.phase_id === phaseId).sort((a, b) => a.sort_order - b.sort_order);
    const idx = phaseTasks.findIndex((t) => t.id === taskId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= phaseTasks.length) return;
    try {
      await reorderTasks.mutateAsync([
        { id: phaseTasks[idx].id, sort_order: phaseTasks[swapIdx].sort_order },
        { id: phaseTasks[swapIdx].id, sort_order: phaseTasks[idx].sort_order },
      ]);
    } catch (e: any) {
      toast({ title: "Reorder failed", description: e.message, variant: "destructive" });
    }
  };

  if (phasesLoading || tasksLoading || authLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3">
        <ConceptHelp
          term={KC_CONCEPTS.classification.term}
          shortText={KC_CONCEPTS.classification.shortText}
          articleSlug={KC_CONCEPTS.classification.slug}
        />
        <ConceptHelp
          term={KC_CONCEPTS.taskTypes.term}
          shortText={KC_CONCEPTS.taskTypes.shortText}
          articleSlug={KC_CONCEPTS.taskTypes.slug}
        />
        <KnowledgeLink slug="how-to-create-phases-and-tasks" label="How to plan phases & tasks" />
      </div>

      {/* Read-only indicator */}
      {!canEdit && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted border border-border">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Read-only — you do not have edit authority for this workspace</span>
        </div>
      )}

      {/* Find-in-project toolbar */}
      <div className="flex flex-col gap-1">
        <FindInProjectToolbar
          query={findQuery}
          onQueryChange={setFindQuery}
          matchesOnly={matchesOnly}
          onMatchesOnlyChange={setMatchesOnly}
          state={findState}
          onPick={handlePickResult}
        />
        {findState.active && matchesOnly && (
          <p className="text-xs text-muted-foreground px-1">
            Clear find or turn off Show matches only to reorder or insert in context.
          </p>
        )}
      </div>

      {sortedPhases.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          {canEdit
            ? "No phases yet. Create the first phase to start planning."
            : "No phases yet."}
        </div>
      ) : visiblePhases.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No phases or tasks match your search.
        </div>
      ) : (
        visiblePhases.map((phase) => {
          const idx = sortedPhases.findIndex((p) => p.id === phase.id);
          return (
            <PhaseSection
              adoptionBadgeByTaskId={adoptionBadges.byType.task}
              key={phase.id}
              phase={phase}
              tasks={allTasks.filter((t) => t.phase_id === phase.id)}
              allPhases={sortedPhases}
              allTasks={allTasks}
              dependencies={dependencies}
              membersMap={membersMap}
              isFirst={idx === 0}
              isLast={idx === sortedPhases.length - 1}
              canEdit={canEdit}
              isProjectBaselined={!!(project as any)?.is_baselined}
              onMovePhase={handleMovePhase}
              onMoveTask={handleMoveTask}
              findActive={findState.active}
              matchesOnly={matchesOnly}
              isPhaseMatch={findState.matchedPhaseIds.has(phase.id)}
              matchedTaskIds={findState.matchedTaskIds}
              forceExpanded={
                findState.active &&
                Array.from(findState.matchedTaskIds).some(
                  (tid) => allTasks.find((t) => t.id === tid)?.phase_id === phase.id
                )
              }
            />
          );
        })
      )}

      {canEdit && !(findState.active && matchesOnly) && (
        <Button variant="outline" onClick={() => setShowNewPhase(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add phase
        </Button>
      )}

      {showNewPhase && project && (
        <PhaseFormDialog
          open={showNewPhase}
          onClose={() => setShowNewPhase(false)}
          projectId={project.id}
          workspaceId={project.workspace_id}
          organizationId={project.organization_id}
          existingPhaseCount={phases.length}
        />
      )}
    </div>
  );
}
