import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";
import { Badge } from "@/components/ui/badge";
import { Activity, CheckCircle2, RotateCcw, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  describeExecutionError,
  reopenTask,
  todayIso,
  updateTaskExecution,
} from "@/lib/executionService";
import { getPmWorkflowStatusLabel, getPmWorkflowStatusBadgeClass } from "@/lib/btpmVisualSemantics";

interface Props {
  task: any;
  canEdit: boolean;
}

/**
 * Phase 4F.5 — Execution surface for a task.
 * Owns: actual_start, actual_end, lifecycle transitions to active/completed,
 * and the Reopen action. Plan tab no longer owns these.
 */
export function TaskExecutionPanel({ task, canEdit }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const isCompleted = task.status === "completed";
  const isCancelled = task.status === "cancelled" || task.is_archived;

  // Prefill inputs from planned dates when no actual is set yet, so users see
  // a useful default instead of an empty date field. Saving without changes is
  // still disabled (dirty check below) so this prefill never silently writes.
  const [actualStart, setActualStart] = useState<string>(
    task.actual_start_date || task.start_date || "",
  );
  const [actualEnd, setActualEnd] = useState<string>(
    task.actual_end_date || task.due_date || "",
  );

  useEffect(() => {
    setActualStart(task.actual_start_date || task.start_date || "");
    setActualEnd(task.actual_end_date || task.due_date || "");
  }, [
    task.id,
    task.updated_at,
    task.actual_start_date,
    task.actual_end_date,
    task.start_date,
    task.due_date,
  ]);

  const dirty = useMemo(
    () =>
      (actualStart || "") !== (task.actual_start_date || "") ||
      (actualEnd || "") !== (task.actual_end_date || ""),
    [actualStart, actualEnd, task.actual_start_date, task.actual_end_date],
  );

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["task-detail", task.id] });
    qc.invalidateQueries({ queryKey: ["phase-detail"] });
    qc.invalidateQueries({ queryKey: ["project-phases"] });
    qc.invalidateQueries({ queryKey: ["phase-tasks"] });
    qc.invalidateQueries({ queryKey: ["activity-events"] });
  };

  const saveActuals = useMutation({
    mutationFn: () =>
      updateTaskExecution(
        task.id,
        {
          actual_start_date: actualStart || null,
          actual_end_date: actualEnd || null,
        },
        task.updated_at,
      ),
    onSuccess: () => {
      toast({ title: "Actual dates saved" });
      refresh();
    },
    onError: (e) =>
      toast({ title: "Could not save", description: describeExecutionError(e), variant: "destructive" }),
  });

  const markActive = useMutation({
    mutationFn: () => {
      // Prefill from planned start date when present, else today.
      // Never overwrite an already-entered actual_start_date.
      const start =
        actualStart ||
        task.actual_start_date ||
        task.start_date ||
        todayIso();
      setActualStart(start);
      return updateTaskExecution(
        task.id,
        {
          status: "active",
          actual_start_date: start,
        },
        task.updated_at,
      );
    },
    onSuccess: () => {
      toast({ title: "Task started" });
      refresh();
    },
    onError: (e) =>
      toast({ title: "Could not start task", description: describeExecutionError(e), variant: "destructive" }),
  });

  const markCompleted = useMutation({
    mutationFn: () => {
      // Prefill actuals from planned dates first; today is a last-resort fallback.
      // Never overwrite values the user already entered.
      const start =
        actualStart ||
        task.actual_start_date ||
        task.start_date ||
        todayIso();
      const end =
        actualEnd ||
        task.actual_end_date ||
        task.due_date ||
        todayIso();
      setActualStart(start);
      setActualEnd(end);
      return updateTaskExecution(
        task.id,
        {
          status: "completed",
          actual_start_date: start,
          actual_end_date: end,
        },
        task.updated_at,
      );
    },
    onSuccess: () => {
      toast({ title: "Task completed" });
      refresh();
    },
    onError: (e) =>
      toast({ title: "Could not complete task", description: describeExecutionError(e), variant: "destructive" }),
  });

  const reopen = useMutation({
    mutationFn: () => reopenTask(task.id),
    onSuccess: () => {
      toast({ title: "Task reopened", description: "Planned dates and actuals can be edited again." });
      refresh();
    },
    onError: (e) =>
      toast({ title: "Could not reopen", description: describeExecutionError(e), variant: "destructive" }),
  });

  const pending =
    saveActuals.isPending || markActive.isPending || markCompleted.isPending || reopen.isPending;

  // Cancelled / archived: nothing to do here.
  if (isCancelled) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Lock className="h-4 w-4" />
        This task is cancelled or archived. Execution actions are unavailable.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground inline-flex items-center gap-2">
          <Activity className="h-4 w-4" /> Execution
        </h3>
        <Badge className={getPmWorkflowStatusBadgeClass(task.status)}>
          {getPmWorkflowStatusLabel(task.status)}
        </Badge>
      </div>

      {isCompleted && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground flex items-start gap-2">
          <Lock className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            This task is completed. Planned and actual dates are locked. Reopen the task to make changes.
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel hint="The date work actually started on this task.">Actual start</FieldLabel>
          <Input
            type="date"
            value={actualStart}
            onChange={(e) => setActualStart(e.target.value)}
            disabled={!canEdit || isCompleted || pending}
          />
        </div>
        <div>
          <FieldLabel hint="The date work actually finished on this task.">Actual end</FieldLabel>
          <Input
            type="date"
            value={actualEnd}
            onChange={(e) => setActualEnd(e.target.value)}
            disabled={!canEdit || isCompleted || pending}
          />
        </div>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!isCompleted && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => saveActuals.mutate()}
                disabled={!dirty || pending}
              >
                Save actual dates
              </Button>
              {task.status !== "active" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => markActive.mutate()}
                  disabled={pending}
                >
                  <Activity className="h-4 w-4 mr-1" /> Mark active
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => markCompleted.mutate()}
                disabled={pending}
              >
                <CheckCircle2 className="h-4 w-4 mr-1" /> Mark completed
              </Button>
            </>
          )}
          {isCompleted && (
            <Button size="sm" variant="default" onClick={() => reopen.mutate()} disabled={pending}>
              <RotateCcw className="h-4 w-4 mr-1" /> Reopen task
            </Button>
          )}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground leading-snug">
        Actual dates default from the planned start/due dates when available, and fall back to today
        otherwise. You can override them before saving. Editing actuals here does not change planned
        dates on the Plan tab.
      </p>
    </div>
  );
}
