// BTPM — Wave C2, Step C2.10
// Manual Retry button for failed / retry_pending outbox rows.
// Used inside Admin → KPI App Integration only. Not for ProjectKpis.

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
import { Loader2, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useKpiAppRetry } from "@/hooks/useKpiAppRetry";

interface Props {
  outboxId: string;
  organizationId: string;
  // Restrict to known retry-eligible statuses; component still re-checks.
  latestStatus: string | null | undefined;
  /** C2-FIX.4: superseded rows are audit history only — hide Retry. */
  supersededAt?: string | null;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "ghost";
}

const ELIGIBLE = new Set(["failed", "retry_pending"]);

export function KpiAppRetryButton({
  outboxId,
  organizationId,
  latestStatus,
  supersededAt,
  size = "sm",
  variant = "outline",
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { retry } = useKpiAppRetry();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!latestStatus || !ELIGIBLE.has(latestStatus)) return null;
  if (supersededAt) return null;

  async function handleConfirm() {
    setBusy(true);
    const res = await retry(outboxId);
    setBusy(false);
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["kpi-app-mappings", organizationId] });
    if (res.ok) {
      toast({
        title: "Retry submitted",
        description: `Outbox ${res.outbox_id ?? outboxId} → ${res.status ?? "submitted"} (retry #${res.retry_count ?? "?"})`,
      });
    } else {
      toast({
        title: "Retry failed",
        description: res.error || "See submission history for details.",
        variant: "destructive",
      });
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
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
        )}
        Retry
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retry submission?</AlertDialogTitle>
            <AlertDialogDescription>
              BTPM will validate the current Tenant integration configuration
              and retry the same prepared payload. If an external request is
              attempted, a new attempt record will be created and{" "}
              <strong>retry_count</strong> will increment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Retry now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
