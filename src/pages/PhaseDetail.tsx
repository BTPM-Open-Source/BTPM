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

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { isNonStandardType, semanticTypeLabel } from "@/lib/phaseTypes";
import { PhasePlanEditor } from "@/components/planning/PhasePlanEditor";
import { SendObjectEmailButton } from "@/components/email/SendObjectEmailButton";
import { SharepointDocumentSection } from "@/components/sharepoint/SharepointDocumentSection";
import { SiblingPager, neighbours } from "@/components/navigation/SiblingPager";
import { useProjectPhases, usePhaseTasks } from "@/hooks/useProjectPlanning";
import { TaskFormDialog } from "@/components/planning/TaskFormDialog";
import { PhaseExecutionPanel } from "@/components/execution/PhaseExecutionPanel";
import { ActualDatesCard } from "@/components/execution/ActualDatesCard";
import { getPmWorkflowStatusLabel, getPmWorkflowStatusBadgeClass } from "@/lib/btpmVisualSemantics";

export default function PhaseDetail() {
  const { workspaceId, projectId, phaseId } = useParams<{ workspaceId: string; projectId: string; phaseId: string }>();
  const context = useOutletContext<{ project: Tables<"projects">; workspace: { id: string; name: string } }>();
  const project = context?.project;
  const location = useLocation();
  const navigate = useNavigate();
  const { data: canHardDelete = false } = useCanHardDeleteBusinessObject(workspaceId);

  const { data: phase, isLoading } = useQuery({
    queryKey: ["phase-detail", phaseId],
    queryFn: async () => {
      if (!phaseId) throw new Error("No phase ID");
      const { data, error } = await supabase.rpc("get_decrypted_phase", { _phase_id: phaseId });
      if (error) throw error;
      return data as any;
    },
    enabled: !!phaseId,
  });

  const { data: allProjectTasks = [] } = usePhaseTasks(projectId);
  const childTasks = useMemo(
    () =>
      (allProjectTasks as any[])
        .filter((t) => t.phase_id === phaseId && !t.is_archived)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [allProjectTasks, phaseId],
  );

  const [showTaskForm, setShowTaskForm] = useState(false);

  const { canEdit } = useProjectPlanningAuthority(projectId);
  const { data: phaseCandidates = [] } = useDependencyCandidates("phase", { projectId });
  const { data: members = [] } = useWorkspaceMembers(project?.workspace_id);
  const { data: projectPhases = [] } = useProjectPhases(projectId);
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

  if (!phase) {
    return <p className="text-destructive">Phase not found.</p>;
  }

  const statusCounts = childTasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Sibling pager — phases within the SAME project only.
  const phaseSiblings = (projectPhases as any[])
    .filter((p) => !p.is_archived)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const { prev: prevPhase, next: nextPhase } = neighbours(phaseSiblings, phase.id);
  const buildSiblingTo = (id: string) => `${basePath}/phase/${id}${location.search}`;

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
          <p className="text-xs text-muted-foreground">{project?.name}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <SiblingPager
              prevTo={prevPhase ? buildSiblingTo(prevPhase.id) : null}
              nextTo={nextPhase ? buildSiblingTo(nextPhase.id) : null}
              prevState={location.state}
              nextState={location.state}
              prevLabel="Previous phase"
              nextLabel="Next phase"
            />
            <h2 className="text-xl font-bold text-foreground">{phase.name}</h2>
            {isNonStandardType(phase.phase_type) && (
              <Badge variant="secondary" className="text-xs">{semanticTypeLabel(phase.phase_type)}</Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge className={getPmWorkflowStatusBadgeClass(phase.status)}>
              {getPmWorkflowStatusLabel(phase.status)}
            </Badge>
            <span className="text-xs text-muted-foreground">Change lifecycle state in the Execution tab.</span>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <SendObjectEmailButton
            workspaceId={phase.workspace_id}
            projectId={phase.project_id}
            targetType="phase"
            targetId={phase.id}
            objectName={phase.name}
            summaryLines={[
              { label: "Project", value: project?.name },
              { label: "Phase", value: phase.name },
              { label: "Status", value: getPmWorkflowStatusLabel(phase.status) },
              { label: "Start", value: phase.start_date },
              { label: "Target end", value: phase.target_end_date },
            ]}
          />
          <LifecycleActions
            target="phase"
            id={phase.id}
            name={phase.name}
            isArchived={!!(phase as any).is_archived}
            canArchive={canEdit}
            canHardDelete={canHardDelete}
            cascadeDescription={HARD_DELETE_CASCADE_COPY.phase}
            requireTypeName
            invalidate={[["phase-detail", phase.id], ["project-phases", projectId]]}
            onAfterHardDelete={() => navigate(`/workspace/${workspaceId}/project/${projectId}/planning`)}
          />
        </div>
      </div>

      <Tabs defaultValue="plan" className="w-full">
        <TabsList>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="execution">Execution</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* Plan tab */}
        <TabsContent value="plan" className="space-y-6 mt-4">
          <PhasePlanEditor phase={phase} canEdit={canEdit} />

          <div className="grid gap-3 lg:grid-cols-2">
            <BaselineComparison
              currentStart={phase.start_date ?? null}
              currentEnd={phase.target_end_date ?? null}
              baselineStart={(phase as any).baseline_start_date ?? null}
              baselineEnd={(phase as any).baseline_end_date ?? null}
              isBaselined={!!(project as any)?.is_baselined}
              addedAfterBaseline={(phase as any).added_after_baseline ?? false}
            />
            <ActualDatesCard
              actualStart={(phase as any).actual_start_date ?? null}
              actualEnd={(phase as any).actual_end_date ?? null}
              derived
              derivedNote="Derived from non-cancelled child tasks. Edit actuals on each task's Execution tab."
            />
          </div>

          <DependencyPanel
            entityId={phase.id}
            entityType="phase"
            entityName={phase.name}
            workspaceId={phase.workspace_id}
            organizationId={phase.organization_id}
            candidates={(phaseCandidates || []).filter((c) => c.id !== phase.id)}
            canEdit={canEdit}
          />
        </TabsContent>

        {/* Execution tab */}
        <TabsContent value="execution" className="space-y-6 mt-4">
          <PhaseExecutionPanel phase={phase} canEdit={canEdit} />

          <div className="border border-border rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">Tasks ({childTasks.length})</h3>
              {canEdit && childTasks.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => setShowTaskForm(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Add task
                </Button>
              )}
            </div>
            {childTasks.length > 0 ? (
              <>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(statusCounts).map(([status, count]) => (
                    <Badge key={status} variant="outline" className="text-xs">
                      {getPmWorkflowStatusLabel(status)}: {String(count)}
                    </Badge>
                  ))}
                </div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {childTasks.map((t: any) => (
                    <Link
                      key={t.id}
                      to={`${basePath}/task/${t.id}`}
                      className="flex items-center justify-between text-sm hover:bg-accent/50 rounded px-2 py-1 transition-colors"
                    >
                      <span className="truncate text-foreground">{t.name}</span>
                      <Badge className={`text-xs ml-2 ${getPmWorkflowStatusBadgeClass(t.status)}`}>{getPmWorkflowStatusLabel(t.status)}</Badge>
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-start gap-2 py-2">
                <p className="text-sm text-muted-foreground">No tasks yet for this phase.</p>
                {canEdit && (
                  <Button size="sm" onClick={() => setShowTaskForm(true)}>
                    <Plus className="h-4 w-4 mr-1" /> Add task
                  </Button>
                )}
              </div>
            )}
          </div>

          {showTaskForm && phase && (
            <TaskFormDialog
              open={showTaskForm}
              onClose={() => setShowTaskForm(false)}
              phase={phase as Tables<"phases">}
              allTasks={allProjectTasks as any}
              existingTaskCount={childTasks.length}
            />
          )}

          <BlockersSection
            targetType="phase"
            targetId={phase.id}
            organizationId={phase.organization_id}
            workspaceId={phase.workspace_id}
            projectId={projectId!}
            canEdit={canEdit}
            membersMap={membersMap}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <CommentsSection
              targetType="phase"
              targetId={phase.id}
              organizationId={phase.organization_id}
              workspaceId={phase.workspace_id}
              canEdit={canEdit}
              membersMap={membersMap}
            />
            <ExecutionUpdatesSection
              targetType="phase"
              targetId={phase.id}
              organizationId={phase.organization_id}
              workspaceId={phase.workspace_id}
              canEdit={canEdit}
              membersMap={membersMap}
            />
          </div>

          <SharepointDocumentSection
            targetType="phase"
            targetId={phase.id}
            targetName={phase.name}
            projectId={phase.project_id}
            workspaceId={phase.workspace_id}
            canEdit={canEdit}
          />
        </TabsContent>

        {/* History tab */}
        <TabsContent value="history" className="space-y-6 mt-4">
          <BaselineHistorySection targetType="phase" targetId={phase.id} membersMap={membersMap} />
          <ActivitySection
            targetType="phase"
            targetId={phase.id}
            membersMap={membersMap}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
