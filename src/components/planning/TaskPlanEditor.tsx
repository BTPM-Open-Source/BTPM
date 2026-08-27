import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldLabel } from "@/components/ui/field-label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Constants, type Enums } from "@/integrations/supabase/types";
import { useUpdateTask } from "@/hooks/useProjectPlanning";
import { useToast } from "@/hooks/use-toast";
import { mapDependencyError } from "@/lib/dependencyConflictEngine";
import {
  applyTaskPlanningChange,
  describeBlockedReason,
  previewTaskPlanningChange,
} from "@/lib/planningService";
import { ParentExtensionConfirmDialog } from "./ParentExtensionConfirmDialog";
import { DATE_RANGE_ERROR_MESSAGE, isInvalidDateRange } from "@/lib/dateRangeValidation";
import { getPmWorkflowStatusLabel, getPmWorkflowStatusBadgeClass, getPmPriorityLabel } from "@/lib/btpmVisualSemantics";

const priorities = Constants.public.Enums.pm_priority;
const taskTypes = Constants.public.Enums.task_type;
// Non-terminal statuses are editable from Plan. Completion + reopen live in Execution.
const NON_TERMINAL_STATUSES: Enums<"pm_status">[] = ["planned", "active", "on_hold"];

interface Props {
  task: any;
  canEdit: boolean;
}

interface PendingExtension {
  parentName: string;
  currentStart: string | null;
  currentEnd: string | null;
  proposedStart: string | null;
  proposedEnd: string | null;
  run: () => Promise<void>;
}

export function TaskPlanEditor({ task, canEdit }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateTask = useUpdateTask();

  const [name, setName] = useState(task.name || "");
  const [description, setDescription] = useState(task.description || "");
  const [priority, setPriority] = useState<Enums<"pm_priority">>(task.priority || "medium");
  const [status, setStatus] = useState<Enums<"pm_status">>(task.status || "planned");
  const [taskType, setTaskType] = useState<Enums<"task_type">>(task.task_type || "work_item");
  const [startDate, setStartDate] = useState(task.start_date || "");
  const [dueDate, setDueDate] = useState(task.due_date || "");
  const [estimatedHours, setEstimatedHours] = useState(task.estimated_hours?.toString() || "");

  const [pendingExt, setPendingExt] = useState<PendingExtension | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(task.name || "");
    setDescription(task.description || "");
    setPriority(task.priority || "medium");
    setStatus(task.status || "planned");
    setTaskType(task.task_type || "work_item");
    setStartDate(task.start_date || "");
    setDueDate(task.due_date || "");
    setEstimatedHours(task.estimated_hours?.toString() || "");
  }, [task.id, task.updated_at]);

  const dirty =
    name !== (task.name || "") ||
    description !== (task.description || "") ||
    priority !== task.priority ||
    status !== task.status ||
    taskType !== task.task_type ||
    startDate !== (task.start_date || "") ||
    dueDate !== (task.due_date || "") ||
    estimatedHours !== (task.estimated_hours?.toString() || "");

  // The planning apply RPC writes dates outside React Query mutations,
  // so cached task/phase reads must be refreshed explicitly.
  async function refreshPlanningCaches() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["task-detail", task.id] }),
      queryClient.invalidateQueries({ queryKey: ["project-tasks", task.project_id] }),
      queryClient.invalidateQueries({ queryKey: ["project-phases", task.project_id] }),
      queryClient.invalidateQueries({ queryKey: ["project", task.project_id] }),
    ]);
  }

  async function saveNonDateFields() {
    await updateTask.mutateAsync({
      id: task.id,
      project_id: task.project_id,
      name: name.trim(),
      description: description.trim() || null,
      priority,
      status,
      task_type: taskType,
      estimated_hours: estimatedHours ? Number(estimatedHours) : null,
    } as any);
  }

  const handleSave = async () => {
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
      const planStart = startDate || null;
      const planDue   = dueDate || null;
      const datesChanged = planStart !== (task.start_date || null) || planDue !== (task.due_date || null);
      const nonDateFieldsChanged =
        name.trim() !== (task.name || "") ||
        (description.trim() || null) !== (task.description || null) ||
        priority !== task.priority ||
        status !== task.status ||
        taskType !== task.task_type ||
        (estimatedHours ? Number(estimatedHours) : null) !== (task.estimated_hours ?? null);

      if (!datesChanged) {
        await saveNonDateFields();
        toast({ title: "Task saved" });
        return;
      }

      const preview = await previewTaskPlanningChange(task.id, null, planStart, planDue);
      if (preview.blocked) {
        toast({ title: "Cannot save", description: describeBlockedReason(preview.blocked_reason), variant: "destructive" });
        return;
      }
      if (preview.requires_extension) {
        setPendingExt({
          parentName: preview.parent_phase_name ?? "Phase",
          currentStart: preview.parent_current_start,
          currentEnd:   preview.parent_current_end,
          proposedStart: preview.parent_proposed_start,
          proposedEnd:   preview.parent_proposed_end,
          run: async () => {
            // Non-date fields must be written BEFORE the planning apply:
            // the apply advances tasks.updated_at, which would make the
            // generic update fail optimistic concurrency against stale cache.
            if (nonDateFieldsChanged) await saveNonDateFields();
            await applyTaskPlanningChange(task.id, planStart, planDue, true);
            await refreshPlanningCaches();
            toast({ title: "Task saved", description: "Phase window extended to fit." });
          },
        });
        return;
      }

      if (nonDateFieldsChanged) await saveNonDateFields();
      await applyTaskPlanningChange(task.id, planStart, planDue, false);
      await refreshPlanningCaches();
      toast({ title: "Task saved" });

    } catch (e: any) {
      toast({ title: "Save failed", description: mapDependencyError(e), variant: "destructive" });
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
      toast({ title: "Save failed", description: mapDependencyError(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const isCompleted = task.status === "completed";
  const isCancelled = task.status === "cancelled" || task.is_archived;
  const planLocked = isCompleted || isCancelled;
  const disabled = !canEdit || planLocked;
  const pending = updateTask.isPending || saving;

  return (
    <>
      <div className="space-y-4 border border-border rounded-md p-4 bg-card">
        <h3 className="text-sm font-semibold text-foreground">Plan</h3>
        {isCompleted && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            This task is completed. Planned dates are locked — open the <span className="font-medium text-foreground">Execution</span> tab to reopen the task before editing the plan.
          </div>
        )}
        {isCancelled && !isCompleted && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            This task is cancelled or archived. Planning fields are read-only.
          </div>
        )}
        <div>
          <FieldLabel hint="Short, action-oriented name for this task." required>Name</FieldLabel>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={disabled} />
        </div>
        <div>
          <FieldLabel hint="Optional context: what needs to be done, how to verify completion.">Description</FieldLabel>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} disabled={disabled} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <FieldLabel hint="What kind of work this represents.">Type</FieldLabel>
            <Select value={taskType} onValueChange={(v) => setTaskType(v as Enums<"task_type">)} disabled={disabled}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {taskTypes.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <FieldLabel hint="Set planning state here. Mark completed and reopen are handled in the Execution tab.">Status</FieldLabel>
            {isCompleted ? (
              <div className="h-10 flex items-center">
                <Badge className={getPmWorkflowStatusBadgeClass(task.status)}>
                  {getPmWorkflowStatusLabel(task.status)}
                </Badge>
              </div>
            ) : (
              <Select
                value={NON_TERMINAL_STATUSES.includes(status) ? status : "planned"}
                onValueChange={(v) => setStatus(v as Enums<"pm_status">)}
                disabled={disabled}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NON_TERMINAL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{getPmWorkflowStatusLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div>
            <FieldLabel hint="Business importance relative to peers.">Priority</FieldLabel>
            <Select value={priority} onValueChange={(v) => setPriority(v as Enums<"pm_priority">)} disabled={disabled}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {priorities.map((p) => <SelectItem key={p} value={p}>{getPmPriorityLabel(p)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <FieldLabel hint="Planned start date. Must fit inside the phase window — you'll be asked to confirm if extending the phase is required.">Start date</FieldLabel>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={disabled} />
          </div>
          <div>
            <FieldLabel hint="Planned completion date.">Due date</FieldLabel>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={disabled} />
          </div>
          <div>
            <FieldLabel hint="Estimated effort in hours.">Est. hours</FieldLabel>
            <Input type="number" min="0" step="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} disabled={disabled} />
          </div>
        </div>
        {canEdit && !planLocked && (
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={!dirty || pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </div>

      {pendingExt && (
        <ParentExtensionConfirmDialog
          open={!!pendingExt}
          parentKind="phase"
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
