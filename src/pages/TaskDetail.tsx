import { useParams, Link, useOutletContext, useLocation, useNavigate } from "react-router-dom";
import { LifecycleActions } from "@/components/lifecycle/LifecycleActions";
import { useCanHardDeleteBusinessObject } from "@/hooks/useCanHardDeleteBusinessObject";
import { HARD_DELETE_CASCADE_COPY } from "@/lib/lifecycleVocabulary";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Eye } from "lucide-react";
import { CommentsSection } from "@/components/execution/CommentsSection";
import { ExecutionUpdatesSection } from "@/components/execution/ExecutionUpdatesSection";
import { BlockersSection } from "@/components/execution/BlockersSection";
import { ActivitySection } from "@/components/execution/ActivitySection";
import { BaselineComparison } from "@/components/baseline/BaselineComparison";
import { BaselineHistorySection } from "@/components/baseline/BaselineHistorySection";
import { DependencyPanel } from "@/components/dependencies/DependencyPanel";
import { useDependencyCandidates } from "@/hooks/useDependencyCandidates";
import { useMemo } from "react";
import type { Tables } from "@/integrations/supabase/types";
import { TaskPlanEditor } from "@/components/planning/TaskPlanEditor";
import { TaskPeopleSummary } from "@/components/task/TaskPeopleSummary";

import { SendObjectEmailButton } from "@/components/email/SendObjectEmailButton";
import { formatTaskAccountabilityEmailLines } from "@/lib/email/formatTaskAccountabilityEmailLines";
import { SharepointDocumentSection } from "@/components/sharepoint/SharepointDocumentSection";
import { SiblingPager, neighbours } from "@/components/navigation/SiblingPager";
import { usePhaseTasks } from "@/hooks/useProjectPlanning";
import { TaskExecutionPanel } from "@/components/execution/TaskExecutionPanel";
import { ActualDatesCard } from "@/components/execution/ActualDatesCard";
import { AdoptionLinkBadge } from "@/components/adoption/AdoptionLinkBadge";
import { buildAdoptionBadgeLabel } from "@/hooks/useProjectAdoptionLinkBadges";
import {
  getPmWorkflowStatusBadgeClass,
  getPmWorkflowStatusLabel,
  getPmPriorityBadgeClass,
  getPmPriorityLabel,
} from "@/lib/btpmVisualSemantics";

export default function TaskDetail() {
  const { workspaceId, projectId, taskId } = useParams<{ workspaceId: string; projectId: string; taskId: string }>();
  const context = useOutletContext<{ project: Tables<"projects">; workspace: { id: string; name: string } }>();
  const project = context?.project;
  const location = useLocation();
  const navigate = useNavigate();
  const { data: canHardDelete = false } = useCanHardDeleteBusinessObject(workspaceId);

  const { data: task, isLoading } = useQuery({
    queryKey: ["task-detail", taskId],
    queryFn: async () => {
      if (!taskId) throw new Error("No task ID");
      const { data, error } = await supabase.rpc("get_decrypted_task", { _task_id: taskId });
      if (error) throw error;
      return data as any;
    },
    enabled: !!taskId,
  });

  const { canEdit } = useProjectPlanningAuthority(projectId);
  const { data: taskCandidates = [] } = useDependencyCandidates("task", { projectId });
  const { data: members = [] } = useWorkspaceMembers(project?.workspace_id);
  const { data: allProjectTasks = [] } = usePhaseTasks(projectId);
  const membersMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members) map[m.id] = m.display_name;
    return map;
  }, [members]);

  const basePath = `/workspace/${workspaceId}/project/${projectId}`;
  const searchParams = new URLSearchParams(location.search);
  const returnToParam = searchParams.get("returnTo");
  const fromParam = searchParams.get("from") || (location.state as any)?.from;
  const fromGantt = fromParam === "gantt";
  const fromRoadmap = fromParam === "roadmap";
  const fromCalendar = fromParam === "calendar";
  const fromMyWork = fromParam === "my-work";
  const fromProjects = fromParam === "projects";
  const fromRisks = fromParam === "risks-blockers";
  const fromFiles = fromParam === "files";
  const backTo = returnToParam
    ? decodeURIComponent(returnToParam)
    : ((location.state as any)?.returnTo as string | undefined)
      || (fromGantt ? `${basePath}/gantt`
        : fromRoadmap ? "/roadmap"
        : fromCalendar ? `${basePath}/calendar`
        : fromMyWork ? "/my-work"
        : fromRisks ? "/risks-blockers"
        : fromFiles ? "/files"
        : fromProjects ? "/projects"
        : `${basePath}/planning`);
  const backLabel = fromGantt ? "Back to Gantt"
    : fromRoadmap ? "Back to Roadmap"
    : fromCalendar ? "Back to Calendar"
    : fromMyWork ? "Back to My Work"
    : fromRisks ? "Back to Risks & Blockers"
    : fromFiles ? "Back to Files"
    : fromProjects ? "Back to Projects"
    : "Back to Planning";

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-40 w-full" /></div>;
  }

  if (!task) {
    return <p className="text-destructive">Task not found.</p>;
  }

  const assigneeId = (task as any).task_assignments?.[0]?.assignee_id;
  const assigneeName = assigneeId ? (membersMap[assigneeId] || assigneeId.slice(0, 8)) : "Unassigned";
  const phaseName = (task as any).phase_name || "Unknown phase";

  // Sibling pager — tasks within the SAME phase only.
  const phaseSiblings = (allProjectTasks as any[])
    .filter((t) => t.phase_id === task.phase_id && !t.is_archived)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const { prev: prevTask, next: nextTask } = neighbours(phaseSiblings, task.id);
  const buildSiblingTo = (id: string) => `${basePath}/task/${id}${location.search}`;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to={backTo}>
          <ArrowLeft className="h-4 w-4 mr-1" /> {backLabel}
        </Link>
      </Button>

      {!canEdit && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted border border-border">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Read-only — you do not have edit authority for this workspace</span>
        </div>
      )}

      {/* Identity header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{project?.name} › {phaseName}</p>
          <div className="flex items-center gap-2">
            <SiblingPager
              prevTo={prevTask ? buildSiblingTo(prevTask.id) : null}
              nextTo={nextTask ? buildSiblingTo(nextTask.id) : null}
              prevState={location.state}
              nextState={location.state}
              prevLabel="Previous task"
              nextLabel="Next task"
            />
            <h2 className="text-xl font-bold text-foreground">{task.name}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge className={getPmWorkflowStatusBadgeClass(task.status)}>{getPmWorkflowStatusLabel(task.status)}</Badge>
            <Badge variant="outline" className="capitalize">{task.task_type.replace("_", " ")}</Badge>
            <Badge className={getPmPriorityBadgeClass(task.priority)}>{getPmPriorityLabel(task.priority)}</Badge>
            {((task as any).is_adoption_related || (task as any).adoption_initiative_id) && (
              <AdoptionLinkBadge
                badge={{
                  objectType: "task",
                  objectId: task.id,
                  adoptionPlanId: null,
                  adoptionInitiativeId: (task as any).adoption_initiative_id ?? null,
                  adoptionInitiativeName: (task as any).adoption_initiative_name ?? null,
                  label: buildAdoptionBadgeLabel((task as any).adoption_initiative_name ?? null),
                }}
              />
            )}
            
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <SendObjectEmailButton
            workspaceId={task.workspace_id}
            projectId={task.project_id}
            targetType="task"
            targetId={task.id}
            objectName={task.name}
            summaryLines={[
              { label: "Project", value: project?.name },
              { label: "Phase", value: phaseName },
              { label: "Task", value: task.name },
              { label: "Status", value: getPmWorkflowStatusLabel(task.status) },
              { label: "Priority", value: getPmPriorityLabel(task.priority) },
              { label: "Assignee", value: assigneeName !== "Unassigned" ? assigneeName : null },
              { label: "Start", value: task.start_date },
              { label: "Due", value: task.due_date },
              ...formatTaskAccountabilityEmailLines({
                requester: (task as any).requested_by_stakeholder ?? null,
                executors: (task as any).executed_by_stakeholders ?? null,
              }),
            ]}
          />
          <LifecycleActions
            target="task"
            id={task.id}
            name={task.name}
            isArchived={!!(task as any).is_archived}
            canArchive={canEdit}
            canHardDelete={canHardDelete}
            cascadeDescription={HARD_DELETE_CASCADE_COPY.task}
            invalidate={[["task-detail", task.id], ["project-tasks", projectId], ["phase-tasks", projectId]]}
            onAfterHardDelete={() => navigate(`/workspace/${workspaceId}/project/${projectId}/planning`)}
          />
        </div>
      </div>

      <TaskPeopleSummary task={task} membersMap={membersMap} canEdit={canEdit} />

      <Tabs defaultValue="plan" className="w-full">

        <TabsList>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="execution">Execution</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* Plan tab */}
        <TabsContent value="plan" className="space-y-6 mt-4">
          <TaskPlanEditor task={task} canEdit={canEdit} />

          <div className="grid gap-3 lg:grid-cols-2">
            <BaselineComparison
              currentStart={task.start_date ?? null}
              currentEnd={task.due_date ?? null}
              baselineStart={(task as any).baseline_start_date ?? null}
              baselineEnd={(task as any).baseline_end_date ?? null}
              isBaselined={!!(project as any)?.is_baselined}
              addedAfterBaseline={(task as any).added_after_baseline ?? false}
            />
            {task.status === "completed" ? (
              <ActualDatesCard
                actualStart={(task as any).actual_start_date ?? null}
                actualEnd={(task as any).actual_end_date ?? null}
              />
            ) : (
              <div />
            )}
          </div>

          <DependencyPanel
            entityId={task.id}
            entityType="task"
            entityName={task.name}
            workspaceId={task.workspace_id}
            organizationId={task.organization_id}
            candidates={(taskCandidates || []).filter((c) => c.id !== task.id)}
            canEdit={canEdit}
          />
        </TabsContent>

        {/* Execution tab */}
        <TabsContent value="execution" className="space-y-6 mt-4">
          <TaskExecutionPanel task={task} canEdit={canEdit} />

          <BlockersSection
            targetType="task"
            targetId={task.id}
            organizationId={task.organization_id}
            workspaceId={task.workspace_id}
            projectId={projectId!}
            canEdit={canEdit}
            membersMap={membersMap}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <CommentsSection
              targetType="task"
              targetId={task.id}
              organizationId={task.organization_id}
              workspaceId={task.workspace_id}
              canEdit={canEdit}
              membersMap={membersMap}
            />
            <ExecutionUpdatesSection
              targetType="task"
              targetId={task.id}
              organizationId={task.organization_id}
              workspaceId={task.workspace_id}
              canEdit={canEdit}
              membersMap={membersMap}
            />
          </div>

          <SharepointDocumentSection
            targetType="task"
            targetId={task.id}
            targetName={task.name}
            projectId={task.project_id}
            workspaceId={task.workspace_id}
            canEdit={canEdit}
          />
        </TabsContent>

        {/* History tab */}
        <TabsContent value="history" className="space-y-6 mt-4">
          <BaselineHistorySection targetType="task" targetId={task.id} membersMap={membersMap} />
          <ActivitySection
            targetType="task"
            targetId={task.id}
            membersMap={membersMap}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
