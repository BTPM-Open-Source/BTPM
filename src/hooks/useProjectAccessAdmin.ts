import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export type ProjectRole = "project_manager" | "contributor" | "viewer";

export interface UserWorkspaceProjectRow {
  project_id: string;
  project_name: string;
  is_archived: boolean;
  membership_id: string | null;
  role: ProjectRole | null;
  granted_at: string | null;
}

export function useUserWorkspaceProjects(userId?: string, workspaceId?: string, enabled = true) {
  return useQuery({
    queryKey: ["pa-user-ws-projects", userId, workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pa_list_user_workspace_projects", {
        _target_user_id: userId!,
        _workspace_id: workspaceId!,
      });
      if (error) throw error;
      return (data || []) as UserWorkspaceProjectRow[];
    },
    enabled: !!userId && !!workspaceId && enabled,
  });
}

export interface ProjectAccessCountsRow {
  user_id: string;
  accessible_count: number;
  total_active_projects: number;
}

export function useWorkspaceProjectAccessCounts(workspaceId?: string, enabled = true) {
  return useQuery({
    queryKey: ["pa-ws-counts", workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pa_workspace_project_access_counts", {
        _workspace_id: workspaceId!,
      });
      if (error) throw error;
      return (data || []) as ProjectAccessCountsRow[];
    },
    enabled: !!workspaceId && enabled,
  });
}

export function useProjectAccessMutations(userId?: string, workspaceId?: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pa-user-ws-projects", userId, workspaceId] });
    qc.invalidateQueries({ queryKey: ["pa-ws-counts", workspaceId] });
  };

  const grant = useMutation({
    mutationFn: async ({ projectId, role }: { projectId: string; role: ProjectRole }) => {
      const { error } = await supabase.rpc("pa_grant_project_access", {
        _target_user_id: userId!,
        _project_id: projectId,
        _role: role,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Project access updated" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async ({ projectId }: { projectId: string }) => {
      const { error } = await supabase.rpc("pa_remove_project_access", {
        _target_user_id: userId!,
        _project_id: projectId,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Project access removed" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const grantAll = useMutation({
    mutationFn: async (vars?: { wsId?: string; overrideRole?: ProjectRole | null }) => {
      const { data, error } = await supabase.rpc("pa_grant_all_workspace_projects", {
        _target_user_id: userId!,
        _workspace_id: vars?.wsId || workspaceId!,
        _override_role: vars?.overrideRole ?? null,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => { toast({ title: `Granted access to ${n ?? 0} projects` }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resetInherit = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("pa_reset_workspace_to_inherited", {
        _target_user_id: userId!,
        _workspace_id: workspaceId!,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => { toast({ title: `Reset ${n ?? 0} project memberships to inherited role` }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return { grant, remove, grantAll, resetInherit };
}
