import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface WorkspaceMember {
  user_id: string;
  display_name: string | null;
  email: string | null;
  workspace_role: string | null;
  is_active: boolean;
}

export interface WorkspacePendingInvite {
  id: string;
  email: string;
  role: string;
  invited_at: string;
  expires_at: string;
  is_expired: boolean;
}

export function useWorkspaceMembersList(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["ws-members", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase.rpc("ws_list_members", {
        _workspace_id: workspaceId,
      });
      if (error) throw error;
      return (data || []) as WorkspaceMember[];
    },
    enabled: !!workspaceId,
  });
}

export function useWorkspacePendingInvites(workspaceId: string | undefined, canManage: boolean) {
  return useQuery({
    queryKey: ["ws-pending-invites", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase.rpc("ws_list_pending_invitations", {
        _workspace_id: workspaceId,
      });
      if (error) throw error;
      return (data || []) as WorkspacePendingInvite[];
    },
    enabled: !!workspaceId && canManage,
  });
}

export function useCanManageWorkspace(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["ws-can-manage", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return false;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data } = await supabase.rpc("is_workspace_admin_or_higher", {
        _user_id: user.id,
        _workspace_id: workspaceId,
      });
      return !!data;
    },
    enabled: !!workspaceId,
  });
}

export function useWorkspaceMemberMutations(workspaceId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ws-members", workspaceId] });
    qc.invalidateQueries({ queryKey: ["ws-pending-invites", workspaceId] });
  };

  const addMember = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const { error } = await supabase.rpc("ws_add_member", {
        _workspace_id: workspaceId!,
        _target_user_id: userId,
        _role: role as any,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Member added" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const changeRole = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: string }) => {
      const { error } = await supabase.rpc("ws_change_member_role", {
        _workspace_id: workspaceId!,
        _target_user_id: userId,
        _new_role: newRole as any,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Role updated" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeMember = useMutation({
    mutationFn: async ({ userId }: { userId: string }) => {
      const { error } = await supabase.rpc("ws_remove_member", {
        _workspace_id: workspaceId!,
        _target_user_id: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Member removed" }); invalidate(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return { addMember, changeRole, removeMember };
}
