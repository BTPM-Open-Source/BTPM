import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const ACCESS_EVENT_TYPES = [
  "org_admin_granted", "org_admin_revoked",
  "workspace_access_added", "workspace_access_removed",
  "workspace_role_changed", "workspace_member_added", "workspace_member_removed",
  "user_deactivated", "user_reactivated", "user_deleted",
  "invitation_created", "invitation_revoked", "invitation_resent",
  "invitation_deleted", "invitation_accepted",
];

/** Recent access-change events for a specific user */
export function useUserAccessHistory(organizationId: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ["access-history", "user", organizationId, userId],
    queryFn: async () => {
      if (!organizationId || !userId) return [];
      const { data, error } = await supabase
        .from("activity_events")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("target_type", "user")
        .eq("target_id", userId)
        .in("event_type", ACCESS_EVENT_TYPES)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId && !!userId,
  });
}

/** Recent access-change events for a workspace (filter by metadata.workspace_id client-side) */
export function useWorkspaceAccessHistory(organizationId: string | undefined, workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["access-history", "workspace", organizationId, workspaceId],
    queryFn: async () => {
      if (!organizationId || !workspaceId) return [];
      const { data, error } = await supabase
        .from("activity_events")
        .select("*")
        .eq("organization_id", organizationId)
        .in("event_type", ACCESS_EVENT_TYPES)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []).filter((e) => {
        try {
          const meta = typeof e.metadata === 'string' ? JSON.parse(e.metadata) : e.metadata;
          return meta?.workspace_id === workspaceId;
        } catch { return false; }
      }).slice(0, 20);
    },
    enabled: !!organizationId && !!workspaceId,
  });
}
