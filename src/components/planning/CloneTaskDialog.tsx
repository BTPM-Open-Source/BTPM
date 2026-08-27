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
  taskId: string;
  sourceTaskName: string;
  projectId: string;
}

export function CloneTaskDialog({ open, onClose, taskId, sourceTaskName, projectId }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState(`${sourceTaskName} (copy)`);
  const [startDate, setStartDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [widening, setWidening] = useState<WideningPayload | null>(null);

  useEffect(() => {
    if (open) {
      setName(`${sourceTaskName} (copy)`);
      setStartDate("");
      setError(null);
      setWidening(null);
    }
  }, [open, sourceTaskName]);

  const preview = useQuery({
    queryKey: ["preview-task-clone", taskId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_task_clone_blueprint", { _task_id: taskId });
      if (error) throw error;
      return data as any;
    },
    enabled: open,
  });

  const previewReady = !preview.isLoading && !preview.error && !!preview.data;
  const scheduleMode: string | null = previewReady ? (preview.data?.schedule_mode ?? null) : null;
  const isRelative = scheduleMode === "relative";
  const sourceTask = preview.data?.tasks?.[0];

  const cloneMutation = useMutation({
    mutationFn: async (confirmWidening: boolean) => {
      const { data, error } = await supabase.rpc("clone_task_in_phase", {
        _task_id: taskId,
        _new_task_name: name.trim(),
        _task_start_date: startDate || undefined,
        _confirm_widening: confirmWidening,
      } as any);
      if (error) throw error;
      return data;
    },
  });

  const onSuccess = () => {
    qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
    qc.invalidateQueries({ queryKey: ["project-phases", projectId] });
    toast.success("Task copied");
    onClose();
  };

  const submit = async () => {
    setError(null);
    setWidening(null);
    if (!previewReady) return setError("Clone preview failed to load. Please retry before copying.");
    if (!name.trim()) return setError("Task name is required");
    if (isRelative && !startDate) return setError("Start date is required for a scheduled (relative) source task");
    try {
      await cloneMutation.mutateAsync(false);
      onSuccess();
    } catch (e: any) {
      const w = parseWideningError(e);
      if (w) setWidening(w);
      else setError(e?.message ?? "Failed to copy task");
    }
  };

  const confirmWidening = async () => {
    setError(null);
    try {
      await cloneMutation.mutateAsync(true);
      onSuccess();
    } catch (e: any) {
      setWidening(null);
      setError(e?.message ?? "Failed to copy task");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Copy className="h-4 w-4" /> Copy task</DialogTitle>
            <DialogDescription>Insert a copy of this task right after the source. Only reusable task structure is copied — no dependencies are copied.</DialogDescription>
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
              <div><span className="text-muted-foreground">Source:</span> <span className="font-medium">{sourceTaskName}</span></div>
              <div><span className="text-muted-foreground">Schedule mode:</span> {scheduleMode ?? "—"}</div>
              {sourceTask?.task_type && <div><span className="text-muted-foreground">Type:</span> {String(sourceTask.task_type).replace("_", " ")}</div>}
              {sourceTask?.priority && <div><span className="text-muted-foreground">Priority:</span> {sourceTask.priority}</div>}
              {sourceTask?.estimated_hours != null && <div><span className="text-muted-foreground">Estimated hours:</span> {sourceTask.estimated_hours}</div>}
              <div className="text-muted-foreground pt-1">Zero dependencies are copied in v1.</div>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <Label htmlFor="ct-name">New task name</Label>
              <Input id="ct-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ct-date">Task start date {isRelative ? "(required)" : "(optional)"}</Label>
              <Input id="ct-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">
                {isRelative
                  ? "Source is scheduled (relative). Dates will be re-anchored from the chosen start date. If the new task would fall outside the phase window, you'll be asked to confirm widening the phase."
                  : "Source is unscheduled. Leave blank to keep the copy unscheduled, or set a date to seed the start only."}
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={cloneMutation.isPending}>Cancel</Button>
            <Button onClick={submit} disabled={cloneMutation.isPending || !previewReady}>
              {cloneMutation.isPending ? "Copying…" : "Copy task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ParentExtensionConfirmDialog
        open={!!widening}
        parentKind="phase"
        parentName={widening?.parent_phase_name ?? "Phase"}
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
