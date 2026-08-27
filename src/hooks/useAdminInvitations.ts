import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface InvitationRow {
  id: string;
  email: string;
  status: string;
  role: string;
  workspace_name: string | null;
  invited_at: string;
  expires_at: string;
  is_expired: boolean;
}

export function useAdminInvitations(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["admin-invitations", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: {
          action: "list_invitations",
          organization_id: organizationId,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data?.invitations || []) as InvitationRow[];
    },
    enabled: !!organizationId,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });
}

export function useAdminInvitationMutations(organizationId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-invitations"] });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  };

  const createInvitation = useMutation({
    mutationFn: async (params: { email: string }) => {
      const { data, error } = await supabase.functions.invoke("invite-user", {
        body: {
          action: "invite",
          email: params.email,
          organization_id: organizationId!,
          redirectTo: `${window.location.origin}/accept-invite`,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: data?.note ? "Invitation recorded" : "Invitation sent",
        description: typeof data?.note === "string" ? data.note : undefined,
      });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resendInvitation = useMutation({
    mutationFn: async (params: { invitationId: string; email: string }) => {
      const { data, error } = await supabase.functions.invoke("invite-user", {
        body: {
          action: "resend",
          email: params.email,
          invitation_id: params.invitationId,
          organization_id: organizationId!,
          redirectTo: `${window.location.origin}/accept-invite`,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: data?.note ? "Invitation updated" : "Invitation resent",
        description: typeof data?.note === "string" ? data.note : undefined,
      });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const revokeInvitation = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await supabase.rpc("admin_revoke_invitation", {
        _organization_id: organizationId!,
        _invitation_id: invitationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Invitation revoked" });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteInvitation = useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await supabase.rpc("admin_delete_invitation", {
        _organization_id: organizationId!,
        _invitation_id: invitationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Invitation deleted" });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return { createInvitation, resendInvitation, revokeInvitation, deleteInvitation };
}

export function useAdminLifecycleMutations(organizationId: string | undefined, userId: string | undefined) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-user-detail", organizationId, userId] });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["admin-invitations"] });
  };

  const deactivateUser = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_deactivate_user", {
        _organization_id: organizationId!,
        _target_user_id: userId!,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "User deactivated" });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const reactivateUser = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_reactivate_user", {
        _organization_id: organizationId!,
        _target_user_id: userId!,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "User reactivated" });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteUser = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("admin-delete-user", {
        body: {
          organization_id: organizationId!,
          target_user_id: userId!,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast({ title: "User deleted from organization" });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return { deactivateUser, reactivateUser, deleteUser };
}
