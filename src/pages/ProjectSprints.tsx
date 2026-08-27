import { useState } from "react";
import { useParams, useOutletContext } from "react-router-dom";
import { useProjectSprints, useBacklogItems } from "@/hooks/useAgileSubstrate";
import { useUpdateSprint, useUpdateBacklogItem } from "@/hooks/useAgileMutations";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { useCanHardDeleteBusinessObject } from "@/hooks/useCanHardDeleteBusinessObject";
import { LifecycleActions } from "@/components/lifecycle/LifecycleActions";
import { HARD_DELETE_CASCADE_COPY } from "@/lib/lifecycleVocabulary";
import { SprintFormDialog } from "@/components/agile/SprintFormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, ChevronDown, ChevronRight, ArrowRight, Undo2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePersistedViewState, codecs } from "@/hooks/usePersistedViewState";
import {
  getPmWorkflowStatusBadgeClass,
  getPmWorkflowStatusLabel,
} from "@/lib/btpmVisualSemantics";

// Sprint "planning" is not a PM workflow status — map it to the canonical
// "planned" bucket for badge purposes. All other sprint status values align
// with the canonical PM workflow status vocabulary.
function sprintWorkflowKey(status: string | null | undefined): string {
  const v = (status ?? "").toLowerCase();
  if (v === "planning") return "planned";
  return v;
}

export default function ProjectSprints() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project } = useOutletContext<{ project: any }>();
  const { canEdit } = useProjectPlanningAuthority(projectId);
  const { data: canHardDelete = false } = useCanHardDeleteBusinessObject(project?.workspace_id);
  const { toast } = useToast();

  const { data: sprints = [], isLoading } = useProjectSprints(projectId);
  const { data: backlogItems = [] } = useBacklogItems(projectId);
  const updateSprint = useUpdateSprint();
  const updateBacklogItem = useUpdateBacklogItem();

  const [formOpen, setFormOpen] = useState(false);
  const [editSprint, setEditSprint] = useState<any>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { state: vs, setField } = usePersistedViewState({
    viewId: "project-sprints",
    scopeKey: projectId ?? "none",
    schema: {
      showArchived: { mode: "local", default: false, codec: codecs.boolean },
    },
  });
  const showArchived = vs.showArchived;
  const setShowArchived = (v: boolean) => setField("showArchived", v);

  const activeSprints = (sprints as any[]).filter((s: any) => !s.is_archived);
  const archivedSprints = (sprints as any[]).filter((s: any) => s.is_archived);
  const displaySprints = showArchived ? archivedSprints : activeSprints;

  const unscheduledItems = (backlogItems as any[]).filter((i: any) => !i.sprint_id && !i.is_archived);

  const getSprintItems = (sprintId: string) =>
    (backlogItems as any[]).filter((i: any) => i.sprint_id === sprintId && !i.is_archived);

  // (Wave 5 Step 5.5: archive/unarchive handled by LifecycleActions inline.)

  const handleAssignToSprint = async (itemId: string, sprintId: string | null) => {
    const item = (backlogItems as any[]).find((i: any) => i.id === itemId);
    if (!item) {
      toast({ title: "Error", description: "Backlog item not found.", variant: "destructive" });
      return;
    }
    try {
      await updateBacklogItem.mutateAsync({
        id: itemId,
        project_id: projectId!,
        expected_updated_at: item.updated_at,
        sprint_id: sprintId,
      });
      toast({ title: sprintId ? "Assigned to sprint" : "Removed from sprint" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };


  if (isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Sprints</h2>
        <div className="flex gap-2">
          {archivedSprints.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowArchived(!showArchived)}>
              {showArchived ? "Show Active" : `Archived (${archivedSprints.length})`}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" onClick={() => { setEditSprint(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> New Sprint
            </Button>
          )}
        </div>
      </div>

      {displaySprints.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">{showArchived ? "No archived sprints." : "No sprints yet."}</p>
          {!showArchived && canEdit && (
            <Button variant="link" size="sm" className="mt-2" onClick={() => { setEditSprint(null); setFormOpen(true); }}>
              Create your first sprint
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {[...displaySprints].sort((a: any, b: any) => a.sort_order - b.sort_order).map((sprint: any) => {
            const sprintItems = getSprintItems(sprint.id);
            const isExpanded = expandedId === sprint.id;

            return (
              <div key={sprint.id} className="border border-border rounded-lg">
                {/* Sprint header */}
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : sprint.id)}>
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground">{sprint.name}</span>
                      <Badge variant="outline" className={`text-xs ${getPmWorkflowStatusBadgeClass(sprintWorkflowKey(sprint.status))}`}>
                        {sprint.status === "planning" ? "Planned" : getPmWorkflowStatusLabel(sprint.status)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{sprintItems.length} items</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      {sprint.start_date && sprint.end_date && (
                        <span>{sprint.start_date} → {sprint.end_date}</span>
                      )}
                      {sprint.goal && <span className="truncate max-w-xs">{sprint.goal}</span>}
                    </div>
                  </div>
                  {(canEdit || canHardDelete) && (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {canEdit && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditSprint(sprint); setFormOpen(true); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <LifecycleActions
                        target="sprint"
                        id={sprint.id}
                        name={sprint.name}
                        isArchived={!!sprint.is_archived}
                        canArchive={canEdit}
                        canHardDelete={canHardDelete}
                        cascadeDescription={HARD_DELETE_CASCADE_COPY.sprint}
                        invalidate={[["sprints", projectId!], ["backlog-items", projectId!]]}
                        iconOnly
                      />
                    </div>
                  )}
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-border px-4 py-3 space-y-2">
                    {sprintItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-2">No backlog items assigned to this sprint.</p>
                    ) : (
                      sprintItems.map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between py-1.5 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate">{item.title}</span>
                            <Badge variant="outline" className="text-xs">{item.priority}</Badge>
                          </div>
                          {canEdit && (
                            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => handleAssignToSprint(item.id, null)}>
                              <Undo2 className="h-3 w-3 mr-1" /> Remove
                            </Button>
                          )}
                        </div>
                      ))
                    )}

                    {/* Assign unscheduled items */}
                    {canEdit && unscheduledItems.length > 0 && (
                      <div className="pt-2 border-t border-border">
                        <p className="text-xs text-muted-foreground mb-1">Assign unscheduled item:</p>
                        <Select onValueChange={(itemId) => handleAssignToSprint(itemId, sprint.id)}>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select item…" />
                          </SelectTrigger>
                          <SelectContent>
                            {unscheduledItems.map((item: any) => (
                              <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Unscheduled items section */}
      {!showArchived && unscheduledItems.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Unscheduled ({unscheduledItems.length})</h3>
          <div className="border border-border rounded-lg divide-y divide-border">
            {unscheduledItems.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate">{item.title}</span>
                  <Badge variant="outline" className="text-xs">{item.priority}</Badge>
                </div>
                {canEdit && activeSprints.length > 0 && (
                  <Select onValueChange={(sprintId) => handleAssignToSprint(item.id, sprintId)}>
                    <SelectTrigger className="h-7 w-auto text-xs gap-1">
                      <ArrowRight className="h-3 w-3" />
                      <SelectValue placeholder="Assign" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeSprints.map((s: any) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <SprintFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditSprint(null); }}
        sprint={editSprint}
        projectId={projectId!}
        workspaceId={project?.workspace_id}
        organizationId={project?.organization_id}
        existingCount={activeSprints.length}
      />
    </div>
  );
}
