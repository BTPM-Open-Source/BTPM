import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Plus, ArrowRight, ArrowUp, ArrowDown, Sparkles, Copy, PlusCircle } from "lucide-react";
import { TaskRow } from "./TaskRow";
import { TaskFormDialog } from "./TaskFormDialog";
import { PhaseFormDialog } from "./PhaseFormDialog";
import { ClonePhaseDialog } from "./ClonePhaseDialog";
import { computeVariance, formatVarianceDays, varianceTone, varianceLabel } from "@/lib/baselineUtils";
import { cn } from "@/lib/utils";
import { isNonStandardType, semanticTypeLabel } from "@/lib/phaseTypes";

import { getPmWorkflowStatusBadgeClass, getPmWorkflowStatusLabel } from "@/lib/btpmVisualSemantics";

interface PhaseSectionProps {
  phase: Tables<"phases">;
  tasks: (Tables<"tasks"> & { task_assignments?: any[] })[];
  allPhases: Tables<"phases">[];
  allTasks: (Tables<"tasks"> & { task_assignments?: any[] })[];
  dependencies: Tables<"dependencies">[];
  membersMap: Record<string, string>;
  adoptionBadgeByTaskId?: Map<string, import("@/hooks/useProjectAdoptionLinkBadges").AdoptionLinkBadge>;
  isFirst: boolean;
  isLast: boolean;
  canEdit: boolean;
  isProjectBaselined: boolean;
  onMovePhase: (phaseId: string, direction: "up" | "down") => void;
  onMoveTask: (taskId: string, phaseId: string, direction: "up" | "down") => void;
  /** Find-in-project: highlight & visibility flags (frontend-only). */
  findActive?: boolean;
  matchesOnly?: boolean;
  isPhaseMatch?: boolean;
  matchedTaskIds?: Set<string>;
  /** When true, force this phase expanded (e.g. has a matching task). */
  forceExpanded?: boolean;
}

export function PhaseSection({
  phase,
  tasks,
  allPhases,
  allTasks,
  dependencies,
  membersMap,
  adoptionBadgeByTaskId,
  isFirst,
  isLast,
  canEdit,
  isProjectBaselined,
  onMovePhase,
  onMoveTask,
  findActive = false,
  matchesOnly = false,
  isPhaseMatch = false,
  matchedTaskIds,
  forceExpanded = false,
}: PhaseSectionProps) {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const [expanded, setExpanded] = useState(true);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskInsertAfter, setTaskInsertAfter] = useState<number | undefined>(undefined);
  const [showPhaseBelow, setShowPhaseBelow] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const phaseDetailPath = `/workspace/${workspaceId}/project/${projectId}/phase/${phase.id}`;

  const effectiveExpanded = forceExpanded ? true : expanded;
  const editingLocked = findActive && matchesOnly;

  const sortedTasksRaw = [...tasks].sort((a, b) => a.sort_order - b.sort_order);
  const sortedTasks =
    findActive && matchesOnly && matchedTaskIds
      ? sortedTasksRaw.filter((t) => matchedTaskIds.has(t.id))
      : sortedTasksRaw;
  const taskDeps = dependencies.filter((d) => d.source_type === "task");
  const phaseDeps = dependencies.filter(
    (d) => d.source_type === "phase" && (d.source_id === phase.id || d.target_id === phase.id)
  );

  return (
    <Card
      data-find-phase-id={phase.id}
      className={cn(
        findActive && isPhaseMatch && "ring-1 ring-ring/40 ring-offset-1 ring-offset-background bg-accent/40"
      )}
    >
      <CardHeader className="py-3 px-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setExpanded(!expanded)} disabled={forceExpanded}>
            {effectiveExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
          <Link to={`/workspace/${workspaceId}/project/${projectId}/phase/${phase.id}`} className="font-semibold text-foreground flex-1 hover:underline">{phase.name}</Link>
          {isNonStandardType((phase as any).phase_type) && (
            <Badge variant="secondary" className="text-xs">{semanticTypeLabel((phase as any).phase_type)}</Badge>
          )}
          <Badge className={getPmWorkflowStatusBadgeClass(phase.status)}>{getPmWorkflowStatusLabel(phase.status)}</Badge>
          {phase.start_date && (
            <span className="text-xs text-muted-foreground">{phase.start_date}</span>
          )}
          {phase.target_end_date && (
            <span className="text-xs text-muted-foreground">→ {phase.target_end_date}</span>
          )}
          {(() => {
            if (!isProjectBaselined) return null;
            if ((phase as any).added_after_baseline) {
              return (
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide gap-1" title="Added after baseline approval">
                  <Sparkles className="h-3 w-3" /> new
                </Badge>
              );
            }
            const v = computeVariance(phase.start_date, phase.target_end_date,
              (phase as any).baseline_start_date, (phase as any).baseline_end_date).endDays;
            if (v === null) return null;
            return (
              <Badge variant="outline" className={cn("text-xs font-mono", varianceTone(v))} title={`End vs baseline: ${varianceLabel(v)}`}>
                {formatVarianceDays(v)}
              </Badge>
            );
          })()}
          {phaseDeps.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {phaseDeps.length} dep{phaseDeps.length > 1 ? "s" : ""}
            </Badge>
          )}
          <div className="flex gap-1">
            {canEdit && !isFirst && !editingLocked && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMovePhase(phase.id, "up")}>
                <ArrowUp className="h-3 w-3" />
              </Button>
            )}
            {canEdit && !isLast && !editingLocked && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onMovePhase(phase.id, "down")}>
                <ArrowDown className="h-3 w-3" />
              </Button>
            )}
            {canEdit && !editingLocked && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowPhaseBelow(true)} title="Create phase below">
                <PlusCircle className="h-3 w-3" />
              </Button>
            )}
            {canEdit && !editingLocked && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowClone(true)} title="Copy phase">
                <Copy className="h-3 w-3" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-6 w-6" asChild title="Open phase">
              <Link to={phaseDetailPath}><ArrowRight className="h-3 w-3" /></Link>
            </Button>
          </div>
        </div>
      </CardHeader>

      {effectiveExpanded && (
        <CardContent className="px-4 pb-3 pt-0">
          {sortedTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2 pl-8">
              {findActive && matchesOnly ? "No matching tasks in this phase." : "No tasks in this phase yet."}
            </p>
          ) : (
            <div className="space-y-1">
              {sortedTasks.map((task, idx) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  dependencies={taskDeps}
                  allTasks={allTasks}
                  membersMap={membersMap}
                  isFirst={idx === 0}
                  isLast={idx === sortedTasks.length - 1}
                  canEdit={canEdit && !editingLocked}
                  isProjectBaselined={isProjectBaselined}
                  adoptionBadge={adoptionBadgeByTaskId?.get(task.id) ?? null}
                  isFindMatch={findActive && matchedTaskIds?.has(task.id)}
                  onMove={(dir) => onMoveTask(task.id, phase.id, dir)}
                  onAddBelow={editingLocked ? undefined : () => {
                    setTaskInsertAfter(task.sort_order);
                    setShowTaskForm(true);
                  }}
                />

              ))}
            </div>
          )}
          {canEdit && !editingLocked && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 ml-6"
              onClick={() => {
                setTaskInsertAfter(undefined);
                setShowTaskForm(true);
              }}
            >
              <Plus className="h-3 w-3 mr-1" /> Add task
            </Button>
          )}
        </CardContent>
      )}

      {showTaskForm && (
        <TaskFormDialog
          open={showTaskForm}
          onClose={() => {
            setShowTaskForm(false);
            setTaskInsertAfter(undefined);
          }}
          phase={phase}
          allTasks={allTasks}
          existingTaskCount={tasks.length}
          insertAfterSortOrder={taskInsertAfter}
        />
      )}

      {showPhaseBelow && (
        <PhaseFormDialog
          open={showPhaseBelow}
          onClose={() => setShowPhaseBelow(false)}
          projectId={phase.project_id}
          workspaceId={phase.workspace_id}
          organizationId={phase.organization_id}
          allPhases={allPhases}
          existingPhaseCount={allPhases.filter((p) => !(p as any).is_archived).length}
          insertAfterSortOrder={phase.sort_order}
        />
      )}

      {showClone && (
        <ClonePhaseDialog
          open={showClone}
          onClose={() => setShowClone(false)}
          phaseId={phase.id}
          sourcePhaseName={phase.name}
          projectId={phase.project_id}
        />
      )}

    </Card>
  );
}
