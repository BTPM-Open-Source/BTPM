import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Check if the current user has PM authority (workspace_admin+ or project_manager)
 * for the given workspace. Returns { canEdit, isLoading }.
 */
export function usePlanningAuthority(workspaceId: string | undefined) {
  const { data: canEdit = false, isLoading } = useQuery({
    queryKey: ["planning-authority", workspaceId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !workspaceId) return false;
      const { data, error } = await supabase.rpc("has_pm_authority", {
        _user_id: user.id,
        _workspace_id: workspaceId,
      });
      if (error) return false;
      return !!data;
    },
    enabled: !!workspaceId,
  });
  return { canEdit, isLoading };
}
