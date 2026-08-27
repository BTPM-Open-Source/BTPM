import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useActiveContext } from "@/context/ActiveContextProvider";

export function useIsOrgAdmin() {
  const { user, loading: authLoading } = useAuth();
  const { activeOrganization, isLoading: contextLoading } = useActiveContext();
  const organizationId = activeOrganization?.id ?? null;

  const query = useQuery({
    queryKey: ["is-org-admin", user?.id ?? null, organizationId],
    enabled: !!user && !!organizationId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_org_admin", {
        _user_id: user!.id,
        _organization_id: organizationId!,
      });
      if (error) throw error;
      return { isAdmin: !!data, organizationId };
    },
  });

  return {
    ...query,
    data: query.data ?? { isAdmin: false, organizationId },
    isLoading:
      authLoading ||
      contextLoading ||
      (!!user && !!organizationId && query.isLoading),
  };
}
