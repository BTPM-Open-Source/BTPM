import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, RotateCcw, Lock, Info, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { describeExecutionError, reopenPhase } from "@/lib/executionService";
import { formatDate } from "@/lib/baselineUtils";
import { useUpdatePhase } from "@/hooks/useProjectPlanning";
import { getPmWorkflowStatusLabel, getPmWorkflowStatusBadgeClass } from "@/lib/btpmVisualSemantics";

interface Props {
  phase: any;
  canEdit: boolean;
}

/**
 * Phase 4F.5 (Closure correction 2) — Sole lifecycle surface for a phase.
 * Owns active/completed transitions and reopen.
 * Phase actuals are DERIVED from child tasks (4F.2). Read-only here.
 *
 * PMG-CORR.1 — Status transitions route through the protected
 * `apply_phase_update` RPC via the shared `useUpdatePhase` hook.
 */
export function PhaseExecutionPanel({ phase, canEdit }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const isCompleted = phase.status === "completed";
  const isActive = phase.status === "active";
  const isCancelled = phase.status === "cancelled" || phase.is_archived;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["phase-detail", phase.id] });
    qc.invalidateQueries({ queryKey: ["project-phases"] });
    qc.invalidateQueries({ queryKey: ["activity-events"] });
  };

  const updatePhase = useUpdatePhase();

  const markActive = useMutation({
    mutationFn: () =>
      updatePhase.mutateAsync({
        id: phase.id,
        project_id: phase.project_id,
        name: phase.name,
        description: phase.description ?? null,
        status: "active",
      }),
    onSuccess: () => {
      toast({ title: "Phase marked active" });
      refresh();
    },
    onError: (e) =>
      toast({ title: "Could not update phase", description: describeExecutionError(e), variant: "destructive" }),
  });

  const markCompleted = useMutation({
    mutationFn: () =>
      updatePhase.mutateAsync({
        id: phase.id,
        project_id: phase.project_id,
        name: phase.name,
        description: phase.description ?? null,
        status: "completed",
      }),
    onSuccess: () => {
      toast({ title: "Phase completed" });
      refresh();
    },
    onError: (e) =>
      toast({ title: "Could not complete phase", description: describeExecutionError(e), variant: "destructive" }),
  });

  const reopen = useMutation({
    mutationFn: () => reopenPhase(phase.id),
    onSuccess: () => {
      toast({ title: "Phase reopened", description: "Planned dates can be edited again." });
      refresh();
    },
    onError: (e) =>
      toast({ title: "Could not reopen", description: describeExecutionError(e), variant: "destructive" }),
  });

  const pending = markActive.isPending || markCompleted.isPending || reopen.isPending || updatePhase.isPending;

  if (isCancelled) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground flex items-center gap-2">
        <Lock className="h-4 w-4" />
        This phase is cancelled or archived. Execution actions are unavailable.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground inline-flex items-center gap-2">
          <Activity className="h-4 w-4" /> Execution
        </h3>
        <Badge className={getPmWorkflowStatusBadgeClass(phase.status)}>
          {getPmWorkflowStatusLabel(phase.status)}
        </Badge>
      </div>

      {isCompleted && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground flex items-start gap-2">
          <Lock className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            This phase is completed. Planned dates are locked. Reopen the phase to change the plan.
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 text-sm">
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <div className="text-xs text-muted-foreground">Actual start (derived)</div>
          <div className="mt-1 font-medium text-foreground">
            {formatDate(phase.actual_start_date) || "—"}
          </div>
        </div>
        <div className="rounded-md border border-border bg-muted/20 p-3">
          <div className="text-xs text-muted-foreground">Actual end (derived)</div>
          <div className="mt-1 font-medium text-foreground">
            {formatDate(phase.actual_end_date) || "—"}
          </div>
        </div>
      </div>

      <div className="text-xs text-muted-foreground inline-flex items-start gap-1.5 leading-snug">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          Phase actual dates are derived automatically from the actual dates of child tasks and cannot
          be edited directly. Record execution on each task in its own Execution tab.
        </span>
      </div>

      <div className="text-xs text-muted-foreground inline-flex items-start gap-1.5 leading-snug">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          This phase auto-completes when every non-archived, non-cancelled task is completed, and
          auto-reopens if a task is reopened or a new non-terminal task is added. Empty phases never
          auto-complete.
        </span>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!isCompleted && (
            <>
              {!isActive && (
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
            <Button size="sm" onClick={() => reopen.mutate()} disabled={pending}>
              <RotateCcw className="h-4 w-4 mr-1" /> Reopen phase
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
