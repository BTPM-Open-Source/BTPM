import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field-label";
import { toast } from "sonner";
import {
  type GovernanceCadenceRow,
  useAdjustGovernanceCadenceNextDate,
} from "@/hooks/useProjectGovernance";

export function AdjustNextDateDialog({
  open,
  onOpenChange,
  projectId,
  cadence,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  cadence: GovernanceCadenceRow | null;
}) {
  const adjust = useAdjustGovernanceCadenceNextDate(projectId);
  const [nextDate, setNextDate] = useState<string>("");

  const isAdHoc = cadence?.frequency_type === "ad_hoc";

  useEffect(() => {
    if (open && cadence) setNextDate(cadence.next_expected_date ?? "");
  }, [open, cadence]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cadence) return;
    if (!isAdHoc && !nextDate) {
      toast.error("Recurring cadences require a next expected date.");
      return;
    }
    try {
      await adjust.mutateAsync({
        cadence_id: cadence.id,
        next_expected_date: isAdHoc && !nextDate ? null : nextDate,
      });
      toast.success("Next expected date updated.");
      onOpenChange(false);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.toLowerCase().includes("forbidden") || msg.includes("42501")) {
        toast.error("You do not have permission to manage governance cadences for this project.");
      } else {
        toast.error(msg || "Could not adjust next expected date.");
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust next expected date</DialogTitle>
          <DialogDescription>
            Manually override the next expected governance date. The cadence rhythm will resume from this date.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <FieldLabel>Next expected date {!isAdHoc && <span className="text-destructive">*</span>}</FieldLabel>
            <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
            {isAdHoc && (
              <p className="text-xs text-muted-foreground mt-1">
                Optional for ad hoc cadences — leave blank to clear.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={adjust.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={adjust.isPending}>
              {adjust.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
