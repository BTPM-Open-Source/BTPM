import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface WorkspaceAccess {
  workspace_id: string;
  workspace_name: string;
  membership_id: string;
  role: string | null;
}

export interface AdminUserDetail {
  user_id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: string;
  is_active: boolean;
  is_org_admin: boolean;
  workspaces: WorkspaceAccess[];
}

interface AdminUserDetailResponse {
  ok: boolean;
  error?: string;
  user?: AdminUserDetail;
}

interface AdminUserMutationResponse {
  ok: boolean;
  error?: string;
}

export function useAdminUserDetail(organizationId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ["admin-user-detail", organizationId, userId],
    queryFn: async () => {
      if (!organizationId || !userId) return null;
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: {
          action: "detail",
          organization_id: organizationId,
          user_id: userId,
        },
      });
      if (error) throw error;

      const payload = data as AdminUserDetailResponse | null;
      if (!payload?.ok) throw new Error(payload?.error || "Failed to load user details");

      return payload.user ?? null;
    },
    enabled: !!organizationId && !!userId,
  });
}

export function useAdminUserMutations(organizationId: string | undefined, userId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-user-detail", organizationId, userId] });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  };

  const setOrgAdmin = useMutation({
    mutationFn: async (isAdmin: boolean) => {
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: {
          action: "set_org_admin",
          organization_id: organizationId!,
          user_id: userId!,
          is_admin: isAdmin,
        },
      });
      if (error) throw error;

      const payload = data as AdminUserMutationResponse | null;
      if (!payload?.ok) throw new Error(payload?.error || "Failed to update organization admin status");
    },
    onSuccess: (_, isAdmin) => {
      toast({ title: isAdmin ? "Granted organization admin" : "Removed organization admin" });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const addWorkspaceAccess = useMutation({
    mutationFn: async ({ workspaceId, role }: { workspaceId: string; role: string }) => {
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: {
          action: "add_workspace_access",
          organization_id: organizationId!,
          user_id: userId!,
          workspace_id: workspaceId,
          role,
        },
      });
      if (error) throw error;

      const payload = data as AdminUserMutationResponse | null;
      if (!payload?.ok) throw new Error(payload?.error || "Failed to add workspace access");
    },
    onSuccess: () => {
      toast({ title: "Workspace access added" });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const changeWorkspaceRole = useMutation({
    mutationFn: async ({ workspaceId, newRole }: { workspaceId: string; newRole: string }) => {
      const { error } = await supabase.rpc("admin_change_workspace_role", {
        _organization_id: organizationId!,
        _target_user_id: userId!,
        _workspace_id: workspaceId,
        _new_role: newRole as never,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Workspace role updated" });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const removeWorkspaceAccess = useMutation({
    mutationFn: async (workspaceId: string) => {
      const { error } = await supabase.rpc("admin_remove_workspace_access", {
        _organization_id: organizationId!,
        _target_user_id: userId!,
        _workspace_id: workspaceId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Workspace access removed" });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return { setOrgAdmin, addWorkspaceAccess, changeWorkspaceRole, removeWorkspaceAccess };
}
