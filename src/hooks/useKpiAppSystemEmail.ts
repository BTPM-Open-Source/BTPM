// BTPM — Wave C3, Step C3.10d
// Read-only hook returning the configured scheduled-auto-submit system email
// via the admin-gated Edge Function. Frontend never reads secrets directly.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface KpiAppSystemEmailResult {
  configured: boolean;
  system_entered_by_email: string | null;
}

export function useKpiAppSystemEmail(
  organizationId: string | null | undefined,
  workspaceId: string | null | undefined,
  enabled: boolean = true,
) {
  return useQuery<KpiAppSystemEmailResult>({
    queryKey: ["kpi-app-system-email", organizationId, workspaceId],
    enabled: !!organizationId && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "get-kpi-app-system-email",
        {
          body: {
            organization_id: organizationId,
            workspace_id: workspaceId ?? null,
          },
        },
      );
      if (error) throw error;
      if (!data?.ok) {
        throw new Error(data?.error ?? "Failed to load system email");
      }
      return {
        configured: !!data.configured,
        system_entered_by_email: data.system_entered_by_email ?? null,
      };
    },
  });
}
