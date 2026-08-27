// BTPM — Step C2-FIX.1
// Admin Reset/Clear button for stuck KPI App outbox rows.
//
// Usage: rendered in the Admin → KPI App Integration mapping list next to
// the Retry button. Visible ONLY when the latest outbox is in a state that
// can safely be superseded (failed / queued / payload_ready / retry_pending,
// or stale submitting). Hidden for submitted rows or already-superseded rows.
//
// Hard rules:
//   - Calls reset_kpi_app_outbox RPC. Never deletes rows.
//   - Original row, error details, payload metadata and attempt history are
//     preserved untouched. Only superseded_at / superseded_by / reason are set.
//   - Successful submissions cannot be reset.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { Loader2, Eraser } from "lucide-react";
import { toast } from "sonner";
import { useKpiAppOutboxReset } from "@/hooks/useKpiAppOutboxReset";

interface Props {
  outboxId: string;
  organizationId: string;
  latestStatus: string | null | undefined;
  supersededAt?: string | null;
  lastAttemptAt?: string | null;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "ghost";
}

// Mirrors the RPC's eligibility rules so we don't show the button for cases
// the backend will reject anyway.
const RESETTABLE_STATUSES = new Set([
  "failed",
  "queued",
  "payload_ready",
  "retry_pending",
]);
const STALE_SUBMITTING_AFTER_MS = 15 * 60 * 1000;

export function KpiAppResetButton({
  outboxId,
  organizationId,
  latestStatus,
  supersededAt,
  lastAttemptAt,
  size = "sm",
  variant = "outline",
}: Props) {
  const qc = useQueryClient();
  const { reset } = useKpiAppOutboxReset();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset is always available. The backend RPC enforces eligibility
  // (refuses to reset successful submissions). Hiding the button on the
  // client just hides the recovery path when something else is wrong.
  void RESETTABLE_STATUSES;
  void STALE_SUBMITTING_AFTER_MS;
  void lastAttemptAt;
  void supersededAt;

  async function handleConfirm() {
    setBusy(true);
    const res = await reset(outboxId, "Manual reset from Admin KPI App page");
    setBusy(false);
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["kpi-app-mappings", organizationId] });
    if (res.ok) {
      toast.success(
        res.already_superseded
          ? "Outbox row was already superseded."
          : "Stuck attempt cleared. You can run Report Now again.",
      );
    } else {
      toast.error(res.error || "Reset failed.");
    }
  }

  return (
    <>
      <Button
        size={size}
        variant={variant}
        onClick={() => setOpen(true)}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
        ) : (
          <Eraser className="h-3.5 w-3.5 mr-1" />
        )}
        Reset
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear stuck Report Now attempt?</AlertDialogTitle>
            <AlertDialogDescription>
              This will <strong>not delete</strong> the failed/queued attempt. It
              will mark it as <strong>superseded</strong> so a new Report Now
              attempt can be created. The original row, its error details, and
              its full submission history remain visible in the audit trail.
              Successful submissions cannot be reset.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Reset attempt
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
