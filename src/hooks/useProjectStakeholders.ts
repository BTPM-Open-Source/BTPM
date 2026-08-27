/**
 * Project Stakeholders — read + mutations.
 *
 * All reads/writes go through SECURITY DEFINER RPCs:
 *   list_project_stakeholders, add_project_stakeholder,
 *   update_project_stakeholder, remove_project_stakeholder,
 *   restore_project_stakeholder
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ProjectStakeholder = {
  id: string;
  stakeholder_type: "workspace_member" | "external";
  user_id: string | null;
  external_name: string | null;
  display_name: string;
  role_label: string | null;
  notes: string | null;
  start_date: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  removed_at: string | null;
  removed_by: string | null;
  removed_by_name: string | null;
  updated_at: string;
};

export function useProjectStakeholders(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-stakeholders", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectStakeholder[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc("list_project_stakeholders", {
        _project_id: projectId,
      });
      if (error) throw error;
      return (data as ProjectStakeholder[] | null) ?? [];
    },
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>, projectId: string) {
  qc.invalidateQueries({ queryKey: ["project-stakeholders", projectId] });
  qc.invalidateQueries({ queryKey: ["project-activity-events", projectId] });
}

export function useAddProjectStakeholder(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      stakeholder_type: "workspace_member" | "external";
      user_id?: string | null;
      external_name?: string | null;
      role_label?: string | null;
      notes?: string | null;
      start_date?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("add_project_stakeholder", {
        _project_id: projectId,
        _stakeholder_type: input.stakeholder_type,
        _user_id: input.user_id ?? null,
        _external_name: input.external_name ?? null,
        _role_label: input.role_label ?? null,
        _notes: input.notes ?? null,
        _start_date: input.start_date ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useUpdateProjectStakeholder(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      stakeholder_id: string;
      role_label?: string | null;
      external_name?: string | null;
      notes?: string | null;
      start_date?: string | null;
    }) => {
      const { error } = await supabase.rpc("update_project_stakeholder", {
        _stakeholder_id: input.stakeholder_id,
        _role_label: input.role_label ?? null,
        _external_name: input.external_name ?? null,
        _notes: input.notes ?? null,
        _start_date: input.start_date ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useRemoveProjectStakeholder(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (stakeholder_id: string) => {
      const { error } = await supabase.rpc("remove_project_stakeholder", {
        _stakeholder_id: stakeholder_id,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}

export function useRestoreProjectStakeholder(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (stakeholder_id: string) => {
      const { error } = await supabase.rpc("restore_project_stakeholder", {
        _stakeholder_id: stakeholder_id,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(qc, projectId),
  });
}
