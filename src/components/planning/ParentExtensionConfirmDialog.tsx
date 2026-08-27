/**
 * Phase 4F.3 — Single, minimal confirmation modal shown when a normal
 * planning edit requires extending the parent's planned window.
 *
 * Intentionally one decision: confirm extension or cancel save.
 */
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  /** "phase" (when extending the project) or "phase" with childKind="task" (when extending the phase). */
  parentKind: "phase" | "project";
  parentName: string;
  currentStart: string | null;
  currentEnd: string | null;
  proposedStart: string | null;
  proposedEnd: string | null;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function fmt(d: string | null) {
  return d ?? "—";
}

export function ParentExtensionConfirmDialog({
  open,
  parentKind,
  parentName,
  currentStart,
  currentEnd,
  proposedStart,
  proposedEnd,
  pending,
  onConfirm,
  onCancel,
}: Props) {
  const startChanges = currentStart !== proposedStart;
  const endChanges   = currentEnd   !== proposedEnd;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Extend parent {parentKind} window?</DialogTitle>
          <DialogDescription>
            Your change does not fit inside the {parentKind}&apos;s current planned window. Saving will also extend the {parentKind}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-sm">
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="text-xs text-muted-foreground mb-1">{parentKind === "phase" ? "Phase" : "Project"}</div>
            <div className="font-medium text-foreground">{parentName}</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-muted-foreground">Current</div>
              <div className="font-mono text-xs">{fmt(currentStart)} → {fmt(currentEnd)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">After save</div>
              <div className={`font-mono text-xs ${(startChanges || endChanges) ? "text-foreground font-semibold" : ""}`}>
                {fmt(proposedStart)} → {fmt(proposedEnd)}
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            The child change and the {parentKind} extension are saved together. Cancel to keep everything unchanged.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? "Saving…" : `Extend ${parentKind} & save`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
