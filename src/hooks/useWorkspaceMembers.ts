import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fetch all members of a workspace via ws_list_members RPC (decrypted).
 * Returns { id, display_name, email } for each member.
 */
export function useWorkspaceMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await supabase.rpc("ws_list_members", {
        _workspace_id: workspaceId,
      });
      if (error) throw error;
      return (data || []).map((m: any) => ({
        id: m.user_id as string,
        display_name: (m.display_name || m.email || m.user_id) as string,
        email: (m.email || null) as string | null,
      }));
    },
    enabled: !!workspaceId,
  });
}
