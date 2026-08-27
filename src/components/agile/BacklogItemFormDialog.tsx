import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldLabel } from "@/components/ui/field-label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateBacklogItem, useUpdateBacklogItem } from "@/hooks/useAgileMutations";
import { useToast } from "@/hooks/use-toast";

const priorities = ["low", "medium", "high", "critical"];

/** UI-only sentinels — Radix Select forbids empty-string item values. Never persisted. */
export const NO_PHASE_VALUE = "__none__";
export const NO_SPRINT_VALUE = "__unscheduled__";

/** Maps a Select UI value back to the persisted value (sentinel -> null). */
export function toPersistedOptionalId(uiValue: string, sentinel: string): string | null {
  return !uiValue || uiValue === sentinel ? null : uiValue;
}

interface BacklogItemFormDialogProps {
  open: boolean;
  onClose: () => void;
  item?: any;
  projectId: string;
  workspaceId: string;
  organizationId: string;
  phases?: any[];
  sprints?: any[];
  workflowStates?: any[];
  existingCount?: number;
}

export function BacklogItemFormDialog({
  open,
  onClose,
  item,
  projectId,
  workspaceId,
  organizationId,
  phases = [],
  sprints = [],
  workflowStates = [],
  existingCount = 0,
}: BacklogItemFormDialogProps) {
  const isEdit = !!item;
  const { toast } = useToast();
  const create = useCreateBacklogItem();
  const update = useUpdateBacklogItem();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [phaseId, setPhaseId] = useState<string>(NO_PHASE_VALUE);
  const [sprintId, setSprintId] = useState<string>(NO_SPRINT_VALUE);
  const [workflowStateId, setWorkflowStateId] = useState<string>("");

  useEffect(() => {
    if (open) {
      setTitle(item?.title || "");
      setDescription(item?.description || "");
      setPriority(item?.priority || "medium");
      setPhaseId(item?.phase_id || NO_PHASE_VALUE);
      setSprintId(item?.sprint_id || NO_SPRINT_VALUE);
      setWorkflowStateId(item?.workflow_state_id || "");
    }
  }, [open, item]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    try {
      const defaultWsId = workflowStates.find((ws: any) => ws.category === "todo")?.id;
      if (isEdit) {
        await update.mutateAsync({
          id: item.id,
          project_id: projectId,
          expected_updated_at: item.updated_at,
          title: title.trim(),
          description: description.trim() || null,
          priority,
          phase_id: toPersistedOptionalId(phaseId, NO_PHASE_VALUE),
          sprint_id: toPersistedOptionalId(sprintId, NO_SPRINT_VALUE),
          workflow_state_id: workflowStateId || defaultWsId || null,
        });
        toast({ title: "Backlog item updated" });
      } else {
        await create.mutateAsync({
          title: title.trim(),
          description: description.trim() || null,
          priority,
          project_id: projectId,
          phase_id: toPersistedOptionalId(phaseId, NO_PHASE_VALUE),
          sprint_id: toPersistedOptionalId(sprintId, NO_SPRINT_VALUE),
          workflow_state_id: workflowStateId || defaultWsId || null,
        });
        toast({ title: "Backlog item created" });

      }
      onClose();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Backlog Item" : "New Backlog Item"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <FieldLabel hint="Short, user-story-style title for this backlog item." required>
              Title
            </FieldLabel>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Backlog item title" />
          </div>
          <div>
            <FieldLabel hint="Optional details: acceptance criteria, links, technical notes.">
              Description
            </FieldLabel>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Optional description" />
          </div>
          <div>
            <FieldLabel hint="Business importance of this item relative to others in the backlog.">
              Priority
            </FieldLabel>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {priorities.map((p) => (
                  <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <FieldLabel hint="Current column on the board (e.g. To do, In progress, Done). Defaults to the first 'todo' state.">
              Workflow State
            </FieldLabel>
            <Select value={workflowStateId} onValueChange={setWorkflowStateId}>
              <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent>
                {workflowStates.filter((ws: any) => !ws.is_archived).map((ws: any) => (
                  <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {phases.length > 0 && (
            <div>
              <FieldLabel hint="Optionally tie this backlog item to a delivery phase for structured planning.">
                Phase (optional)
              </FieldLabel>
              <Select value={phaseId || NO_PHASE_VALUE} onValueChange={setPhaseId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PHASE_VALUE}>None</SelectItem>
                  {phases.map((ph: any) => (
                    <SelectItem key={ph.id} value={ph.id}>{ph.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {sprints.length > 0 && (
            <div>
              <FieldLabel hint="Schedule this item into a sprint, or leave it Unscheduled in the backlog.">
                Sprint (optional)
              </FieldLabel>
              <Select value={sprintId || NO_SPRINT_VALUE} onValueChange={setSprintId}>
                <SelectTrigger><SelectValue placeholder="Unscheduled" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SPRINT_VALUE}>Unscheduled</SelectItem>
                  {sprints.filter((s: any) => !s.is_archived).map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={create.isPending || update.isPending}>
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
