import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * PA-3 — Project-level planning authority.
 *
 * canEditPlan = org_admin OR workspace_admin (workspace of project) OR
 *               active project_memberships row with role=project_manager.
 *
 * Server-side truth via RPC `has_project_pm_authority` (added in PA-1, SECURITY DEFINER).
 */
export function useProjectPlanningAuthority(projectId: string | undefined) {
  const { user } = useAuth();
  const { data: canEdit = false, isLoading } = useQuery({
    queryKey: ["project-planning-authority", projectId, user?.id],
    enabled: !!user && !!projectId,
    queryFn: async () => {
      if (!user || !projectId) return false;
      const { data, error } = await supabase.rpc("has_project_pm_authority", {
        _user_id: user.id,
        _project_id: projectId,
      });
      if (error) return false;
      return !!data;
    },
    staleTime: 60_000,
  });
  return { canEdit, isLoading };
}
