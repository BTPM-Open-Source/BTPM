import { useState } from "react";
import type { Tables } from "@/integrations/supabase/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateTask, useUpdateTask } from "@/hooks/useProjectPlanning";
import { useSetTaskAssignee } from "@/hooks/useTaskAssignment";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { useToast } from "@/hooks/use-toast";
import { Constants, type Enums } from "@/integrations/supabase/types";
import { DependencyPanel } from "@/components/dependencies/DependencyPanel";
import { useDependencyCandidates } from "@/hooks/useDependencyCandidates";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { mapDependencyError } from "@/lib/dependencyConflictEngine";
import {
  applyTaskPlanningChange,
  applyPhasePlanningChange,
  describeBlockedReason,
  previewTaskPlanningChange,
} from "@/lib/planningService";
import { ParentExtensionConfirmDialog } from "./ParentExtensionConfirmDialog";
import { DATE_RANGE_ERROR_MESSAGE, isInvalidDateRange } from "@/lib/dateRangeValidation";

const statuses = Constants.public.Enums.pm_status;
const priorities = Constants.public.Enums.pm_priority;
const taskTypes = Constants.public.Enums.task_type;

const UNASSIGNED = "__none__";

interface TaskFormDialogProps {
  open: boolean;
  onClose: () => void;
  phase: Tables<"phases">;
  task?: Tables<"tasks"> & { task_assignments?: any[] };
  allTasks: (Tables<"tasks"> & { task_assignments?: any[] })[];
  existingTaskCount: number;
  /** When set, the new task is inserted immediately after the task with this sort_order (within the same phase). */
  insertAfterSortOrder?: number;
}

interface PendingExtension {
  kind: "phase";
  parentName: string;
  currentStart: string | null;
  currentEnd: string | null;
  proposedStart: string | null;
  proposedEnd: string | null;
  run: () => Promise<void>;
}

export function TaskFormDialog({ open, onClose, phase, task, allTasks, existingTaskCount, insertAfterSortOrder }: TaskFormDialogProps) {
  const isEdit = !!task;
  const { toast } = useToast();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const setTaskAssignee = useSetTaskAssignee();
  const { data: members = [] } = useWorkspaceMembers(phase.workspace_id);

  const currentAssigneeId = task?.task_assignments?.[0]?.assignee_id || null;

  const [name, setName] = useState(task?.name || "");
  const [description, setDescription] = useState(task?.description || "");
  const [status, setStatus] = useState<Enums<"pm_status">>(task?.status || "planned");
  const [priority, setPriority] = useState<Enums<"pm_priority">>(task?.priority || "medium");
  const [taskType, setTaskType] = useState<Enums<"task_type">>(task?.task_type || "work_item");
  const [startDate, setStartDate] = useState(task?.start_date || (!task ? (phase.start_date || "") : ""));
  const [dueDate, setDueDate] = useState(task?.due_date || (!task ? (phase.target_end_date || "") : ""));
  const [estimatedHours, setEstimatedHours] = useState(task?.estimated_hours?.toString() || "");
  const [assigneeId, setAssigneeId] = useState<string>(currentAssigneeId || UNASSIGNED);

  const [pendingExt, setPendingExt] = useState<PendingExtension | null>(null);
  const [saving, setSaving] = useState(false);

  /** Save non-date fields through the existing UPDATE path. */
  async function saveNonDateFieldsForExisting() {
    if (!task) return;
    await updateTask.mutateAsync({
      id: task.id,
      project_id: task.project_id,
      name: name.trim(),
      description: description.trim() || null,
      status,
      priority,
      task_type: taskType,
      estimated_hours: estimatedHours ? Number(estimatedHours) : null,
    });
    const selectedAssignee = assigneeId === UNASSIGNED ? null : assigneeId;
    if (selectedAssignee !== currentAssigneeId) {
      await setTaskAssignee.mutateAsync({
        taskId: task.id,
        assigneeId: selectedAssignee,
        workspaceId: phase.workspace_id,
        organizationId: phase.organization_id,
        projectId: task.project_id,
      });
    }
  }

  async function performEditSave() {
    if (!task) return;
    const planStart = startDate || null;
    const planDue   = dueDate || null;
    const datesChanged = planStart !== (task.start_date || null) || planDue !== (task.due_date || null);

    if (!datesChanged) {
      // No planned-date change — go through normal UPDATE for everything.
      await updateTask.mutateAsync({
        id: task.id,
        project_id: task.project_id,
        name: name.trim(),
        description: description.trim() || null,
        status,
        priority,
        task_type: taskType,
        start_date: planStart,
        due_date: planDue,
        estimated_hours: estimatedHours ? Number(estimatedHours) : null,
      });
      const selectedAssignee = assigneeId === UNASSIGNED ? null : assigneeId;
      if (selectedAssignee !== currentAssigneeId) {
        await setTaskAssignee.mutateAsync({
          taskId: task.id,
          assigneeId: selectedAssignee,
          workspaceId: phase.workspace_id,
          organizationId: phase.organization_id,
          projectId: task.project_id,
        });
      }
      toast({ title: "Task updated" });
      onClose();
      return;
    }

    const preview = await previewTaskPlanningChange(task.id, null, planStart, planDue);
    if (preview.blocked) {
      toast({ title: "Cannot save", description: describeBlockedReason(preview.blocked_reason), variant: "destructive" });
      return;
    }

    if (preview.requires_extension) {
      setPendingExt({
        kind: "phase",
        parentName: preview.parent_phase_name ?? "Phase",
        currentStart: preview.parent_current_start,
        currentEnd:   preview.parent_current_end,
        proposedStart: preview.parent_proposed_start,
        proposedEnd:   preview.parent_proposed_end,
        run: async () => {
          await applyTaskPlanningChange(task.id, planStart, planDue, true);
          await saveNonDateFieldsForExisting();
          toast({ title: "Task updated", description: "Phase window extended to fit." });
          onClose();
        },
      });
      return;
    }

    await applyTaskPlanningChange(task.id, planStart, planDue, false);
    await saveNonDateFieldsForExisting();
    toast({ title: "Task updated" });
    onClose();
  }

  async function performCreateSave() {
    const useInsert = typeof insertAfterSortOrder === "number";
    const newSortOrder = useInsert ? insertAfterSortOrder! + 1 : existingTaskCount;
    const planStart = startDate || null;
    const planDue   = dueDate || null;

    let needsExt = false;
    let propStart = phase.start_date;
    let propEnd   = phase.target_end_date;
    if (planStart && phase.start_date && planStart < phase.start_date) {
      needsExt = true; propStart = planStart;
    }
    if (planDue && phase.target_end_date && planDue > phase.target_end_date) {
      needsExt = true; propEnd = planDue;
    }

    const selectedAssignee = assigneeId === UNASSIGNED ? null : assigneeId;

    let createdTaskId: string | null = null;

    const doInsert = async () => {
      // apply_task_create is the sole authority for locking the sibling set
      // and opening the insertion slot; no client-side pre-shift.


      const created = await createTask.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        status,
        priority,
        task_type: taskType,
        start_date: planStart,
        due_date: planDue,
        estimated_hours: estimatedHours ? Number(estimatedHours) : null,
        phase_id: phase.id,
        project_id: phase.project_id,
        workspace_id: phase.workspace_id,
        organization_id: phase.organization_id,
        sort_order: newSortOrder,
      });
      createdTaskId = (created as any)?.id ?? null;
      if (selectedAssignee && created) {
        await setTaskAssignee.mutateAsync({
          taskId: created.id,
          assigneeId: selectedAssignee,
          workspaceId: phase.workspace_id,
          organizationId: phase.organization_id,
          projectId: phase.project_id,
        });
      }
    };

    if (needsExt) {
      setPendingExt({
        kind: "phase",
        parentName: phase.name,
        currentStart: phase.start_date,
        currentEnd:   phase.target_end_date,
        proposedStart: propStart,
        proposedEnd:   propEnd,
        run: async () => {
          // Widen the phase via the canonical apply RPC (which itself cascades
          // a project extension if needed and logs the activity event).
          await applyPhasePlanningChange(phase.id, propStart, propEnd, true);
          await doInsert();
          toast({ title: "Task created", description: "Phase window extended to fit." });
          onClose();
        },
      });
      return;
    }

    await doInsert();
    toast({ title: "Task created" });
    onClose();
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (isInvalidDateRange(startDate || null, dueDate || null)) {
      toast({ title: "Cannot save", description: DATE_RANGE_ERROR_MESSAGE, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (isEdit && task) await performEditSave();
      else await performCreateSave();
    } catch (e: any) {
      toast({ title: "Error", description: mapDependencyError(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmExtension = async () => {
    if (!pendingExt) return;
    setSaving(true);
    try {
      await pendingExt.run();
      setPendingExt(null);
    } catch (e: any) {
      toast({ title: "Error", description: mapDependencyError(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const { canEdit } = useProjectPlanningAuthority(phase.project_id);
  const { data: taskCandidates = [] } = useDependencyCandidates("task", { projectId: phase.project_id });

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Task" : "New Task"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <FieldLabel hint="Short, action-oriented name for this task." required>
                Name
              </FieldLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Task name" />
            </div>
            <div>
              <FieldLabel hint="Optional context: what needs to be done, how to verify completion, links to references.">
                Description
              </FieldLabel>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <FieldLabel hint="What kind of work this represents (e.g. work item, milestone). Affects how it shows on Gantt and reports.">
                  Type
                </FieldLabel>
                <Select value={taskType} onValueChange={(v) => setTaskType(v as Enums<"task_type">)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {taskTypes.map((t) => (
                      <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel hint="Lifecycle state of the task: planned → active → on hold / completed / cancelled.">
                  Status
                </FieldLabel>
                <Select value={status} onValueChange={(v) => setStatus(v as Enums<"pm_status">)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statuses.map((s) => (
                      <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel hint="Business importance of this task relative to others in the same phase.">
                  Priority
                </FieldLabel>
                <Select value={priority} onValueChange={(v) => setPriority(v as Enums<"pm_priority">)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {priorities.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <FieldLabel hint="Workspace member responsible for executing this task. Leave 'Unassigned' if not yet decided.">
                Assignee
              </FieldLabel>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <FieldLabel hint="Planned start date. Must fit inside the phase window — you'll be asked to confirm if extending the phase is required.">
                  Start date
                </FieldLabel>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <FieldLabel hint="Planned completion date. Drives at-risk and variance indicators.">
                  Due date
                </FieldLabel>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div>
                <FieldLabel hint="Estimated effort in hours. Used for capacity and rollup reporting (decimals allowed).">
                  Est. hours
                </FieldLabel>
                <Input type="number" min="0" step="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} />
              </div>
            </div>

            {isEdit && task && (
              <DependencyPanel
                entityId={task.id}
                entityType="task"
                entityName={task.name}
                workspaceId={phase.workspace_id}
                organizationId={phase.organization_id}
                candidates={taskCandidates}
                canEdit={canEdit}
                compact
              />
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving || createTask.isPending || updateTask.isPending || setTaskAssignee.isPending}>
              {isEdit ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {pendingExt && (
        <ParentExtensionConfirmDialog
          open={!!pendingExt}
          parentKind={pendingExt.kind}
          parentName={pendingExt.parentName}
          currentStart={pendingExt.currentStart}
          currentEnd={pendingExt.currentEnd}
          proposedStart={pendingExt.proposedStart}
          proposedEnd={pendingExt.proposedEnd}
          pending={saving}
          onConfirm={handleConfirmExtension}
          onCancel={() => setPendingExt(null)}
        />
      )}
    </>
  );
}
