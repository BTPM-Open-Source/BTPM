import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AdminUserRow {
  row_kind: "active_user" | "pending_invitation";
  user_id: string | null;
  display_name: string | null;
  email: string;
  status: "active" | "invited" | "deactivated";
  org_role: string | null;
  workspace_count: number;
  workspace_names: string[] | null;
  invitation_state: string | null;
  invitation_workspace_name: string | null;
}

interface AdminUsersResponse {
  ok: boolean;
  error?: string;
  users?: AdminUserRow[];
}

export function useAdminUsers(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["admin-users", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: {
          action: "list",
          organization_id: organizationId,
        },
      });
      if (error) throw error;

      const payload = data as AdminUsersResponse | null;
      if (!payload?.ok) throw new Error(payload?.error || "Failed to load users");

      return payload.users || [];
    },
    enabled: !!organizationId,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });
}
