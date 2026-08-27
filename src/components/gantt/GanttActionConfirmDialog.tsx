/**
 * Phase 4F.4 — Single confirmation modal for Gantt phase timeline actions.
 *
 * Used for:
 *   - shift_remaining_work (executed children present)
 *   - move_phase_plan / resize_phase that requires project extension
 *
 * Intentionally one decision: confirm or cancel.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ResolvedPhaseAction } from "@/lib/planningService";

interface Props {
  open: boolean;
  resolvedAction: ResolvedPhaseAction;
  phaseName: string;
  phaseCurrentStart: string | null;
  phaseCurrentEnd: string | null;
  phaseProposedStart: string | null;
  phaseProposedEnd: string | null;
  movedChildrenCount: number;
  anchoredChildrenCount: number;
  requiresProjectExtension: boolean;
  projectName?: string;
  projectCurrentStart: string | null;
  projectCurrentEnd: string | null;
  projectProposedStart: string | null;
  projectProposedEnd: string | null;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function fmt(d: string | null) {
  return d ?? "—";
}

function titleFor(action: ResolvedPhaseAction, requiresProj: boolean) {
  if (action === "shift_remaining_work") return "Shift remaining work?";
  if (action === "resize_phase" && requiresProj) return "Resize phase and extend project?";
  if (requiresProj) return "Move phase and extend project?";
  if (action === "resize_phase") return "Resize phase?";
  return "Move phase?";
}

function descriptionFor(action: ResolvedPhaseAction, anchored: number) {
  if (action === "shift_remaining_work") {
    return `This phase has ${anchored} task${anchored === 1 ? "" : "s"} that already started or completed. Those will stay anchored to their actual dates. Only not-started tasks will move.`;
  }
  if (action === "resize_phase") return "This will change the phase planned window.";
  return "This will move the phase and all not-started child tasks by the same amount.";
}

export function GanttActionConfirmDialog({
  open,
  resolvedAction,
  phaseName,
  phaseCurrentStart,
  phaseCurrentEnd,
  phaseProposedStart,
  phaseProposedEnd,
  movedChildrenCount,
  anchoredChildrenCount,
  requiresProjectExtension,
  projectName,
  projectCurrentStart,
  projectCurrentEnd,
  projectProposedStart,
  projectProposedEnd,
  pending,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titleFor(resolvedAction, requiresProjectExtension)}</DialogTitle>
          <DialogDescription>
            {descriptionFor(resolvedAction, anchoredChildrenCount)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-sm">
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground mb-1">Phase</div>
            <div className="font-medium text-foreground">{phaseName}</div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <div className="text-xs text-muted-foreground">Current</div>
                <div className="font-mono text-xs">{fmt(phaseCurrentStart)} → {fmt(phaseCurrentEnd)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">After save</div>
                <div className="font-mono text-xs font-semibold">{fmt(phaseProposedStart)} → {fmt(phaseProposedEnd)}</div>
              </div>
            </div>
          </div>

          {requiresProjectExtension && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="text-xs text-muted-foreground mb-1">Project will also extend</div>
              <div className="font-medium text-foreground">{projectName ?? "Project"}</div>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <div className="text-xs text-muted-foreground">Current</div>
                  <div className="font-mono text-xs">{fmt(projectCurrentStart)} → {fmt(projectCurrentEnd)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">After save</div>
                  <div className="font-mono text-xs font-semibold">{fmt(projectProposedStart)} → {fmt(projectProposedEnd)}</div>
                </div>
              </div>
            </div>
          )}

          {resolvedAction === "shift_remaining_work" && (
            <div className="text-xs text-muted-foreground">
              {movedChildrenCount} not-started task{movedChildrenCount === 1 ? "" : "s"} will shift. {anchoredChildrenCount} executed task{anchoredChildrenCount === 1 ? "" : "s"} will stay unchanged.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? "Saving…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
