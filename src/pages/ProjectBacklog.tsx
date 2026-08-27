import { useState } from "react";
import { useParams, useOutletContext } from "react-router-dom";
import { useBacklogItems, useWorkflowStates, useProjectSprints } from "@/hooks/useAgileSubstrate";
import { useProjectPhases } from "@/hooks/useProjectPlanning";
import { useUpdateBacklogItem, useReorderBacklogItems } from "@/hooks/useAgileMutations";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { useCanHardDeleteBusinessObject } from "@/hooks/useCanHardDeleteBusinessObject";
import { LifecycleActions } from "@/components/lifecycle/LifecycleActions";
import { HARD_DELETE_CASCADE_COPY } from "@/lib/lifecycleVocabulary";
import { BacklogItemFormDialog } from "@/components/agile/BacklogItemFormDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, ChevronUp, ChevronDown, Pencil } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { usePersistedViewState, codecs } from "@/hooks/usePersistedViewState";
import {
  getPmPriorityBadgeClass,
  getPmPriorityLabel,
} from "@/lib/btpmVisualSemantics";

export default function ProjectBacklog() {
  const { projectId } = useParams<{ projectId: string }>();
  const { project } = useOutletContext<{ project: any }>();
  const { canEdit } = useProjectPlanningAuthority(projectId);
  const { data: canHardDelete = false } = useCanHardDeleteBusinessObject(project?.workspace_id);
  const { toast } = useToast();

  const { data: items = [], isLoading } = useBacklogItems(projectId);
  const { data: workflowStates = [] } = useWorkflowStates(projectId);
  const { data: sprints = [] } = useProjectSprints(projectId);
  const { data: phases = [] } = useProjectPhases(projectId);

  const reorderItems = useReorderBacklogItems();

  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const { state: vs, setField } = usePersistedViewState({
    viewId: "project-backlog",
    scopeKey: projectId ?? "none",
    schema: {
      showArchived: { mode: "local", default: false, codec: codecs.boolean },
    },
  });
  const showArchived = vs.showArchived;
  const setShowArchived = (v: boolean) => setField("showArchived", v);

  const activeItems = (items as any[]).filter((i: any) => !i.is_archived);
  const archivedItems = (items as any[]).filter((i: any) => i.is_archived);
  const displayItems = showArchived ? archivedItems : activeItems;

  const getStateName = (stateId: string | null) => {
    if (!stateId) return null;
    const state = (workflowStates as any[]).find((s: any) => s.id === stateId);
    return state?.name || null;
  };

  const getSprintName = (sprintId: string | null) => {
    if (!sprintId) return null;
    const sprint = (sprints as any[]).find((s: any) => s.id === sprintId);
    return sprint?.name || null;
  };

  // (Wave 5 Step 5.5: archive/unarchive moved to LifecycleActions component
  // which calls archive_backlog_item / unarchive_backlog_item RPCs.)

  const handleMove = async (index: number, direction: -1 | 1) => {
    const sorted = [...activeItems].sort((a: any, b: any) => a.sort_order - b.sort_order);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= sorted.length) return;
    const a = sorted[index];
    const b = sorted[swapIndex];
    const updates = [
      { id: a.id, expected_updated_at: a.updated_at, new_sort_order: b.sort_order },
      { id: b.id, expected_updated_at: b.updated_at, new_sort_order: a.sort_order },
    ];
    try {
      await reorderItems.mutateAsync({ items: updates, projectId: projectId! });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };


  if (isLoading) return <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Backlog</h2>
        <div className="flex gap-2">
          {archivedItems.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setShowArchived(!showArchived)}>
              {showArchived ? "Show Active" : `Archived (${archivedItems.length})`}
            </Button>
          )}
          {canEdit && (
            <Button size="sm" onClick={() => { setEditItem(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Add Item
            </Button>
          )}
        </div>
      </div>

      {displayItems.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm">{showArchived ? "No archived backlog items." : "No backlog items yet."}</p>
          {!showArchived && canEdit && (
            <Button variant="link" size="sm" className="mt-2" onClick={() => { setEditItem(null); setFormOpen(true); }}>
              Create your first backlog item
            </Button>
          )}
        </div>
      ) : (
        <div className="border border-border rounded-lg divide-y divide-border">
          {[...displayItems].sort((a: any, b: any) => a.sort_order - b.sort_order).map((item: any, index: number) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors">
              {/* Reorder controls */}
              {canEdit && !showArchived && (
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => handleMove(index, -1)} disabled={index === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleMove(index, 1)} disabled={index === activeItems.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-foreground truncate">{item.title}</span>
                  <Badge variant="outline" className={`text-xs ${getPmPriorityBadgeClass(item.priority)}`}>
                    {getPmPriorityLabel(item.priority)}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                  {getStateName(item.workflow_state_id) && (
                    <span>{getStateName(item.workflow_state_id)}</span>
                  )}
                  {getSprintName(item.sprint_id) && (
                    <span>Sprint: {getSprintName(item.sprint_id)}</span>
                  )}
                  {!item.sprint_id && <span className="italic">Unscheduled</span>}
                </div>
              </div>

              {/* Actions */}
              {(canEdit || canHardDelete) && (
                <div className="flex items-center gap-1">
                  {canEdit && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditItem(item); setFormOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <LifecycleActions
                    target="backlog_item"
                    id={item.id}
                    name={item.title}
                    isArchived={!!item.is_archived}
                    canArchive={canEdit}
                    canHardDelete={canHardDelete}
                    cascadeDescription={HARD_DELETE_CASCADE_COPY.backlog_item}
                    invalidate={[["backlog-items", projectId!]]}
                    iconOnly
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <BacklogItemFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditItem(null); }}
        item={editItem}
        projectId={projectId!}
        workspaceId={project?.workspace_id}
        organizationId={project?.organization_id}
        phases={phases as any[]}
        sprints={sprints as any[]}
        workflowStates={workflowStates as any[]}
        existingCount={activeItems.length}
      />
    </div>
  );
}
