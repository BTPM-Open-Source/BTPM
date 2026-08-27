// BTPM — Wave C2, Step C2.8a
// Determines whether the current user is allowed to read KPI App outbox
// metadata for a given project workspace.
//
// Effective rule (mirrors C2.4 RLS for kpi_app_submission_outbox):
//   canReadOutboxMetadata = is_org_admin OR is_workspace_admin_or_higher
//
// We compute this *explicitly* rather than inferring it from a SELECT
// returning zero rows, because Postgres/Supabase RLS filters denied rows
// silently — a non-admin would otherwise see "no submissions yet" when
// in reality the rows are simply hidden.
//
// Read-only. Calls no Edge Functions. Writes nothing.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCanReadKpiAppOutboxMetadata(
  workspaceId: string | null | undefined,
  organizationId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["can-read-kpi-app-outbox-metadata", workspaceId, organizationId],
    enabled: !!workspaceId && !!organizationId,
    queryFn: async (): Promise<boolean> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      // Org admin path
      const { data: orgAdmin } = await supabase.rpc("is_org_admin", {
        _user_id: user.id,
        _organization_id: organizationId!,
      });
      if (orgAdmin === true) return true;

      // Workspace admin (or higher) path — covers project workspace admins
      const { data: wsAdmin } = await supabase.rpc("is_workspace_admin_or_higher", {
        _user_id: user.id,
        _workspace_id: workspaceId!,
      });
      return wsAdmin === true;
    },
  });
}
