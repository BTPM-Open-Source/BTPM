import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// --- Toggle Agile Mode ---

export function useToggleAgileMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, enable }: { projectId: string; enable: boolean }) => {
      const { error } = await (supabase.rpc as any)("toggle_project_agile_mode", {
        _project_id: projectId,
        _enable: enable,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["project", vars.projectId] });
      qc.invalidateQueries({ queryKey: ["workflow-states", vars.projectId] });
    },
  });
}

// --- Workflow States ---

export function useWorkflowStates(projectId: string | undefined) {
  return useQuery({
    queryKey: ["workflow-states", projectId],
    queryFn: async () => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await (supabase.rpc as any)("list_decrypted_workflow_states", {
        _project_id: projectId,
      });
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: !!projectId,
  });
}

// --- Sprints ---

export function useProjectSprints(projectId: string | undefined) {
  return useQuery({
    queryKey: ["sprints", projectId],
    queryFn: async () => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await (supabase.rpc as any)("list_decrypted_sprints", {
        _project_id: projectId,
      });
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: !!projectId,
  });
}

// --- Backlog Items ---

export function useBacklogItems(projectId: string | undefined) {
  return useQuery({
    queryKey: ["backlog-items", projectId],
    queryFn: async () => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await (supabase.rpc as any)("list_decrypted_backlog_items", {
        _project_id: projectId,
      });
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: !!projectId,
  });
}
