import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useOutletContext, useParams } from "react-router-dom";
import { usePhaseTasks, useProjectPhases } from "@/hooks/useProjectPlanning";
import { useBacklogItems, useProjectSprints, useWorkflowStates } from "@/hooks/useAgileSubstrate";
import { useMoveTaskWorkflowState } from "@/hooks/useAgileMutations";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { useProjectAllBlockers } from "@/hooks/useProjectRisksBlockers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Link2,
  ShieldAlert,
  UserCircle2,
  Workflow,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TaskAccountabilityInline } from "@/components/planning/TaskAccountabilityInline";
import {
  getPmPriorityBadgeClass,
  getPmPriorityLabel,
} from "@/lib/btpmVisualSemantics";

const ALL_SPRINTS_VALUE = "__all_sprint_linked__";

export default function ProjectBoard() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const { project } = useOutletContext<{ project: any }>();
  const { toast } = useToast();
  const { canEdit } = useProjectPlanningAuthority(projectId);

  const { data: tasks = [], isLoading: tasksLoading } = usePhaseTasks(projectId);
  const { data: workflowStates = [], isLoading: statesLoading } = useWorkflowStates(projectId);
  const { data: sprints = [], isLoading: sprintsLoading } = useProjectSprints(projectId);
  const { data: backlogItems = [], isLoading: backlogLoading } = useBacklogItems(projectId);
  const { data: phases = [] } = useProjectPhases(projectId);
  const { data: members = [] } = useWorkspaceMembers(project?.workspace_id);
  const { data: blockers = [], isLoading: blockersLoading } = useProjectAllBlockers(projectId);

  const moveTask = useMoveTaskWorkflowState();
  const [selectedSprint, setSelectedSprint] = useState<string>(ALL_SPRINTS_VALUE);

  const activeSprints = useMemo(
    () => (sprints as any[])
      .filter((s: any) => !s.is_archived)
      .sort((a: any, b: any) => a.sort_order - b.sort_order),
    [sprints]
  );

  useEffect(() => {
    if (activeSprints.length === 0) return;
    const activeSprint = activeSprints.find((s: any) => s.status === "active");
    if (activeSprint) {
      setSelectedSprint((current) => (current === ALL_SPRINTS_VALUE ? activeSprint.id : current));
    }
  }, [activeSprints]);

  const workflowColumns = useMemo(
    () => (workflowStates as any[])
      .filter((state: any) => !state.is_archived)
      .sort((a: any, b: any) => a.sort_order - b.sort_order),
    [workflowStates]
  );

  const backlogById = useMemo(
    () => Object.fromEntries((backlogItems as any[]).map((item: any) => [item.id, item])),
    [backlogItems]
  );

  const phaseById = useMemo(
    () => Object.fromEntries((phases as any[]).map((phase: any) => [phase.id, phase])),
    [phases]
  );

  const memberNameById = useMemo(
    () => Object.fromEntries((members as any[]).map((member: any) => [member.id, member.display_name])),
    [members]
  );

  const blockerCountByTaskId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const blocker of blockers as any[]) {
      if (blocker.target_type !== "task") continue;
      counts[blocker.target_id] = (counts[blocker.target_id] || 0) + 1;
    }
    return counts;
  }, [blockers]);

  const sprintLinkedBacklogItems = useMemo(
    () => (backlogItems as any[]).filter((item: any) => !item.is_archived && !!item.sprint_id),
    [backlogItems]
  );

  const sprintScopedBacklogIds = useMemo(() => {
    if (selectedSprint === ALL_SPRINTS_VALUE) {
      return new Set(sprintLinkedBacklogItems.map((item: any) => item.id));
    }

    return new Set(
      (backlogItems as any[])
        .filter((item: any) => !item.is_archived && item.sprint_id === selectedSprint)
        .map((item: any) => item.id)
    );
  }, [backlogItems, selectedSprint, sprintLinkedBacklogItems]);

  const visibleTasks = useMemo(() => {
    return (tasks as any[])
      .filter((task: any) => !task.is_archived)
      .filter((task: any) => task.backlog_item_id && sprintScopedBacklogIds.has(task.backlog_item_id));
      }, [tasks, sprintScopedBacklogIds]);

  const selectedSprintRecord = activeSprints.find((s: any) => s.id === selectedSprint) || null;
  const selectedSprintBacklogCount = selectedSprint === ALL_SPRINTS_VALUE
    ? sprintLinkedBacklogItems.length
    : (backlogItems as any[]).filter((item: any) => !item.is_archived && item.sprint_id === selectedSprint).length;

  const boardCounts = useMemo(() => {
    const firstColumnId = workflowColumns[0]?.id;
    const counts: Record<string, number> = {};
    for (const column of workflowColumns) counts[column.id] = 0;
    for (const task of visibleTasks) {
      const columnId = task.workflow_state_id || firstColumnId;
      if (columnId) counts[columnId] = (counts[columnId] || 0) + 1;
    }
    return counts;
  }, [visibleTasks, workflowColumns]);

  if (!project?.agile_enabled) {
    return <Navigate to={`/workspace/${workspaceId}/project/${projectId}`} replace />;
  }

  const isLoading = tasksLoading || statesLoading || sprintsLoading || backlogLoading || blockersLoading;
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (workflowColumns.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        No workflow columns are available for this Agile project yet.
      </div>
    );
  }

  if (activeSprints.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 space-y-2">
        <h2 className="text-lg font-semibold text-foreground">Board</h2>
        <p className="text-sm text-muted-foreground">Create a sprint first to open a sprint-aware execution board.</p>
        <Link to={`/workspace/${workspaceId}/project/${projectId}/agile/sprints`} className="text-sm text-primary hover:underline">
          Go to Sprint Planning
        </Link>
      </div>
    );
  }

  const moveCard = async (task: any, nextWorkflowStateId: string) => {
    try {
      await moveTask.mutateAsync({ taskId: task.id, projectId: projectId!, workflowStateId: nextWorkflowStateId });
      toast({ title: "Task moved", description: `${task.name} updated on the board.` });
    } catch (error: any) {
      toast({ title: "Move failed", description: error.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Board</h2>
            <Badge variant="outline" className="text-xs">Agile execution</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Task board driven by canonical workflow states and sprint-linked backlog items.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-[260px]">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Sprint context</p>
            <Select value={selectedSprint} onValueChange={setSelectedSprint}>
              <SelectTrigger>
                <SelectValue placeholder="Select sprint" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_SPRINTS_VALUE}>All sprint-linked Agile tasks</SelectItem>
                {activeSprints.map((sprint: any) => (
                  <SelectItem key={sprint.id} value={sprint.id}>
                    {sprint.name}{sprint.status === "active" ? " · Active" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            <div>
              {selectedSprint === ALL_SPRINTS_VALUE
                ? "All sprint-linked backlog items"
                : selectedSprintRecord?.goal || selectedSprintRecord?.status || "Sprint selected"}
            </div>
            <div className="mt-0.5 text-foreground">
              {selectedSprintBacklogCount} backlog items · {visibleTasks.length} tasks on board
            </div>
          </div>
        </div>
      </div>

      {selectedSprintBacklogCount === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No backlog items are assigned to {selectedSprint === ALL_SPRINTS_VALUE ? "any sprint" : `“${selectedSprintRecord?.name}”`} yet.
        </div>
      ) : visibleTasks.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No tasks linked into this sprint context yet. Link tasks to sprint-backed backlog items from Planning or Backlog first.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-4">
          {workflowColumns.map((column: any, index: number) => {
            const columnTasks = visibleTasks.filter((task: any) => {
              if (task.workflow_state_id === column.id) return true;
              return !task.workflow_state_id && column.id === workflowColumns[0]?.id;
            });

            return (
              <section key={column.id} className="rounded-xl border border-border bg-card/80 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{column.name}</h3>
                    <p className="text-xs text-muted-foreground capitalize">{column.category.replace("_", " ")}</p>
                  </div>
                  <Badge variant="secondary" className="text-xs">{boardCounts[column.id] || 0}</Badge>
                </div>

                <div className="space-y-3">
                  {columnTasks.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                      No tasks in this column.
                    </div>
                  ) : (
                    columnTasks.map((task: any) => {
                      const linkedBacklog = task.backlog_item_id ? backlogById[task.backlog_item_id] : null;
                      const phase = task.phase_id ? phaseById[task.phase_id] : null;
                      const assigneeId = task.task_assignments?.[0]?.assignee_id;
                      const assigneeName = assigneeId ? memberNameById[assigneeId] || "Assigned" : null;
                      const blockerCount = blockerCountByTaskId[task.id] || 0;
                      const prevColumn = workflowColumns[index - 1];
                      const nextColumn = workflowColumns[index + 1];

                      return (
                        <div key={task.id} className="rounded-xl border border-border bg-background p-3 shadow-sm">
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <Link
                              to={`/workspace/${workspaceId}/project/${projectId}/task/${task.id}`}
                              className="text-sm font-medium text-foreground hover:underline"
                            >
                              {task.name}
                            </Link>
                            <Badge variant="outline" className={`text-[11px] ${getPmPriorityBadgeClass(task.priority)}`}>
                              {getPmPriorityLabel(task.priority)}
                            </Badge>
                          </div>

                          <div className="space-y-1.5 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                              <Workflow className="h-3.5 w-3.5" />
                              <span>{column.name}</span>
                            </div>
                            {assigneeName ? (
                              <div className="flex items-center gap-1.5">
                                <UserCircle2 className="h-3.5 w-3.5" />
                                <span className="truncate">{assigneeName}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <UserCircle2 className="h-3.5 w-3.5" />
                                <span>Unassigned</span>
                              </div>
                            )}
                            {linkedBacklog && (
                              <div className="flex items-center gap-1.5">
                                <Link2 className="h-3.5 w-3.5" />
                                <span className="truncate">{linkedBacklog.title}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-1.5">
                              <ArrowRight className="h-3.5 w-3.5" />
                              <span className="truncate">{phase?.name || task.phase_name || "Phase context unavailable"}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="capitalize">Status: {(task.status || "planned").replace("_", " ")}</span>
                              {blockerCount > 0 && (
                                <span className="inline-flex items-center gap-1 text-destructive">
                                  <ShieldAlert className="h-3.5 w-3.5" />
                                  {blockerCount}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="mt-2">
                            <TaskAccountabilityInline
                              requester={task.requested_by_stakeholder}
                              executors={task.executed_by_stakeholders}
                            />
                          </div>





                          {canEdit ? (
                            <div className="mt-3 flex items-center justify-between gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 px-2"
                                disabled={!prevColumn || moveTask.isPending}
                                onClick={() => prevColumn && moveCard(task, prevColumn.id)}
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                                Move
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 px-2"
                                disabled={!nextColumn || moveTask.isPending}
                                onClick={() => nextColumn && moveCard(task, nextColumn.id)}
                              >
                                Move
                                <ChevronRight className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <div className="mt-3 rounded-md bg-muted px-2.5 py-2 text-[11px] text-muted-foreground">
                              Read-only board access.
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5" />
          <span>Board moves write back to canonical task workflow state and are recorded in normal task activity history.</span>
        </div>
        {!canEdit && (
          <div className="mt-2 flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5" />
            <span>You can view execution state here, but only PM-authorized users can move tasks between columns.</span>
          </div>
        )}
      </div>
    </div>
  );
}
