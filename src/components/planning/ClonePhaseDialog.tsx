import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Copy, AlertCircle } from "lucide-react";
import { parseWideningError, type WideningPayload } from "@/lib/cloneWideningService";
import { ParentExtensionConfirmDialog } from "@/components/planning/ParentExtensionConfirmDialog";

interface Props {
  open: boolean;
  onClose: () => void;
  phaseId: string;
  sourcePhaseName: string;
  projectId: string;
}

export function ClonePhaseDialog({ open, onClose, phaseId, sourcePhaseName, projectId }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState(`${sourcePhaseName} (copy)`);
  const [startDate, setStartDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [widening, setWidening] = useState<WideningPayload | null>(null);

  useEffect(() => {
    if (open) {
      setName(`${sourcePhaseName} (copy)`);
      setStartDate("");
      setError(null);
      setWidening(null);
    }
  }, [open, sourcePhaseName]);

  const preview = useQuery({
    queryKey: ["preview-phase-clone", phaseId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_phase_clone_blueprint", { _phase_id: phaseId });
      if (error) throw error;
      return data as any;
    },
    enabled: open,
  });

  const taskCount = Array.isArray(preview.data?.tasks) ? preview.data.tasks.length : 0;
  const depCount = Array.isArray(preview.data?.dependencies) ? preview.data.dependencies.length : 0;
  const scheduleMode: string = preview.data?.schedule_mode ?? "—";

  const cloneMutation = useMutation({
    mutationFn: async (confirmWidening: boolean) => {
      const { data, error } = await supabase.rpc("clone_phase_in_project", {
        _phase_id: phaseId,
        _new_phase_name: name.trim(),
        _phase_start_date: startDate,
        _confirm_widening: confirmWidening,
      } as any);
      if (error) throw error;
      return data;
    },
  });

  const onSuccess = () => {
    qc.invalidateQueries({ queryKey: ["project-phases", projectId] });
    qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
    qc.invalidateQueries({ queryKey: ["project-dependencies"] });
    toast.success("Phase copied");
    onClose();
  };

  const previewFailed = !!preview.error;
  const previewReady = !preview.isLoading && !preview.error && !!preview.data;

  const submit = async () => {
    setError(null);
    setWidening(null);
    if (!previewReady) return setError("Clone preview failed to load. Please retry before copying.");
    if (!name.trim()) return setError("Phase name is required");
    if (!startDate) return setError("Start date is required");
    try {
      await cloneMutation.mutateAsync(false);
      onSuccess();
    } catch (e: any) {
      const w = parseWideningError(e);
      if (w) setWidening(w);
      else setError(e?.message ?? "Failed to copy phase");
    }
  };

  const confirmWidening = async () => {
    setError(null);
    try {
      await cloneMutation.mutateAsync(true);
      onSuccess();
    } catch (e: any) {
      setWidening(null);
      setError(e?.message ?? "Failed to copy phase");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Copy className="h-4 w-4" /> Copy phase</DialogTitle>
            <DialogDescription>Insert a copy of this phase right after the source. Child tasks are copied; only internal task-to-task dependencies inside the phase are preserved.</DialogDescription>
          </DialogHeader>

          {preview.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : preview.error ? (
            <div className="text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Failed to load clone preview. Submit is disabled until preview succeeds.
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => preview.refetch()}>Retry</Button>
            </div>
          ) : (
            <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
              <div><span className="text-muted-foreground">Source:</span> <span className="font-medium">{sourcePhaseName}</span></div>
              <div><span className="text-muted-foreground">Schedule mode:</span> {scheduleMode}</div>
              <div><span className="text-muted-foreground">Tasks copied:</span> {taskCount}</div>
              <div><span className="text-muted-foreground">Internal task dependencies copied:</span> {depCount}</div>
              <div className="text-muted-foreground pt-1">External / phase-level / cross-level dependencies are not copied.</div>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <Label htmlFor="cp-name">New phase name</Label>
              <Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cp-date">New phase start date</Label>
              <Input id="cp-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Stored offsets are re-anchored from this date. If the new phase or its tasks would fall outside the project window, you&apos;ll be asked to confirm widening the project.</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={cloneMutation.isPending}>Cancel</Button>
            <Button onClick={submit} disabled={cloneMutation.isPending || !previewReady}>
              {cloneMutation.isPending ? "Copying…" : "Copy phase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ParentExtensionConfirmDialog
        open={!!widening}
        parentKind="project"
        parentName={widening?.parent_project_name ?? "Project"}
        currentStart={widening?.parent_current_start ?? null}
        currentEnd={widening?.parent_current_end ?? null}
        proposedStart={widening?.parent_proposed_start ?? null}
        proposedEnd={widening?.parent_proposed_end ?? null}
        pending={cloneMutation.isPending}
        onConfirm={confirmWidening}
        onCancel={() => setWidening(null)}
      />
    </>
  );
}
