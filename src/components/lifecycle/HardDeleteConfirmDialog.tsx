// Wave 5 Step 5.5 — Reusable hard-delete confirmation dialog.
//
// Used by every admin-only hard-delete affordance. Enforces:
//   - explicit destructive-consequence messaging
//   - typed-name confirmation for high-risk targets
//   - shows attachment / cascade scope when known

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display label, e.g. "Project", "Phase". */
  targetLabel: string;
  /** Human name of the object. */
  targetName: string;
  /** Plain-language description of cascade scope. */
  cascadeDescription?: string;
  /** When true, require typing the target name to confirm. */
  requireTypeName?: boolean;
  isPending: boolean;
  onConfirm: () => void;
}

export function HardDeleteConfirmDialog({
  open,
  onOpenChange,
  targetLabel,
  targetName,
  cascadeDescription,
  requireTypeName = false,
  isPending,
  onConfirm,
}: Props) {
  const [typed, setTyped] = useState("");
  const canConfirm = !requireTypeName || typed.trim() === targetName.trim();

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped("");
        onOpenChange(o);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Permanent Delete — {targetLabel}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                <strong>{targetName}</strong> will be permanently removed.
                This is destructive and cannot be undone.
              </p>
              {cascadeDescription && (
                <p className="text-muted-foreground">{cascadeDescription}</p>
              )}
              <p className="text-muted-foreground">
                Permanent Delete is only available after archiving and is
                restricted to Organization Admins. Any attachments will be
                permanently removed from storage. Activity history is
                preserved for audit.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {requireTypeName && (
          <div className="space-y-2 py-2">
            <Label htmlFor="confirm-name" className="text-xs">
              Type <span className="font-mono font-semibold">{targetName}</span> to confirm
            </Label>
            <Input
              id="confirm-name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isPending || !canConfirm}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Permanent Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
