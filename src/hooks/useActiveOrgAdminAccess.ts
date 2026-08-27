import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveContext } from "@/context/ActiveContextProvider";

/**
 * Phase 4D.8C — Active-Organization Org Admin check.
 *
 * Backend-authoritative via `public.is_org_admin(_user_id, _organization_id)`.
 * Scoped to the currently active Organization from ActiveContextProvider,
 * NOT the legacy `profiles.organization_id`.
 */
export function useActiveOrgAdminAccess() {
  const { user, loading: authLoading } = useAuth();
  const { activeOrganization, isLoading: ctxLoading } = useActiveContext();
  const organizationId = activeOrganization?.id ?? null;
  const organizationName = activeOrganization?.name ?? null;

  const q = useQuery({
    queryKey: ["is-org-admin-active", user?.id ?? null, organizationId],
    enabled: !!user && !!organizationId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_org_admin", {
        _user_id: user!.id,
        _organization_id: organizationId!,
      });
      if (error) throw error;
      return !!data;
    },
  });

  return {
    isOrgAdmin: !!q.data,
    organizationId,
    organizationName,
    isLoading: authLoading || ctxLoading || (!!organizationId && q.isLoading),
    error: q.error,
  };
}
