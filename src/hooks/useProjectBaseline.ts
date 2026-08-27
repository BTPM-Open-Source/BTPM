import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Approve baseline for a project. Server validates that:
 * - project / phases / tasks all have closed planned ranges
 * - phases fit within project, tasks fit within phase
 * Then snapshots planned dates -> baseline_* fields and logs activity.
 * Authority: PM or higher (has_pm_authority).
 */
export function useApproveProjectBaseline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const { error } = await supabase.rpc("approve_project_baseline", { _project_id: projectId });
      if (error) throw error;
    },
    onSuccess: (_, projectId) => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["project-phases", projectId] });
      qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["activity-events"] });
      toast.success("Baseline approved");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to approve baseline");
    },
  });
}

/**
 * Rebaseline an already-baselined project. Overwrites baseline with current
 * planned dates after the same validations.
 */
export function useRebaselineProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      const { error } = await supabase.rpc("rebaseline_project", { _project_id: projectId });
      if (error) throw error;
    },
    onSuccess: (_, projectId) => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["project-phases", projectId] });
      qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["activity-events"] });
      toast.success("Project rebaselined");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to rebaseline project");
    },
  });
}
