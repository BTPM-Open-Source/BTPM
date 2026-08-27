import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface WorkspaceAccess {
  workspace_id: string;
  workspace_name: string;
  role: string | null;
}

export interface CurrentUserAccess {
  display_name: string | null;
  email: string | null;
  is_active: boolean;
  organization_name: string | null;
  organization_id: string | null;
  org_role: string | null;
  workspaces: WorkspaceAccess[];
}

export function useCurrentUserAccess() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["current-user-access", user?.id],
    queryFn: async (): Promise<CurrentUserAccess> => {
      if (!user) throw new Error("Not authenticated");

      // Fetch profile via decrypted RPC
      const { data: profileData } = await supabase.rpc("get_decrypted_profile");
      const profile = profileData as any;

      if (!profile) {
        return {
          display_name: null,
          email: user.email ?? null,
          is_active: true,
          organization_name: null,
          organization_id: null,
          org_role: null,
          workspaces: [],
        };
      }

      let organization_name: string | null = null;
      let org_role: string | null = null;
      let workspaces: WorkspaceAccess[] = [];

      if (profile.organization_id) {
        // Fetch org name
        const { data: org } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", profile.organization_id)
          .single();
        organization_name = org?.name ?? null;

        // Fetch org-level role
        const { data: orgRoleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("organization_id", profile.organization_id)
          .is("workspace_id", null)
          .limit(1);
        org_role = orgRoleData?.[0]?.role ?? null;

        // Fetch workspace memberships with roles
        const { data: memberships } = await supabase
          .from("workspace_memberships")
          .select("workspace_id, workspaces:workspace_id(id, name, organization_id)")
          .eq("user_id", user.id);

        if (memberships) {
          const wsIds = memberships
            .filter((m: any) => m.workspaces?.organization_id === profile.organization_id)
            .map((m: any) => m.workspace_id);

          if (wsIds.length > 0) {
            const { data: wsRoles } = await supabase
              .from("user_roles")
              .select("workspace_id, role")
              .eq("user_id", user.id)
              .eq("organization_id", profile.organization_id)
              .in("workspace_id", wsIds);

            const roleMap = new Map<string, string>();
            wsRoles?.forEach((r: any) => {
              if (r.workspace_id) roleMap.set(r.workspace_id, r.role);
            });

            workspaces = memberships
              .filter((m: any) => m.workspaces?.organization_id === profile.organization_id)
              .map((m: any) => ({
                workspace_id: m.workspace_id,
                workspace_name: m.workspaces?.name ?? "Unknown",
                role: roleMap.get(m.workspace_id) ?? null,
              }))
              .sort((a: WorkspaceAccess, b: WorkspaceAccess) => a.workspace_name.localeCompare(b.workspace_name));
          }
        }
      }

      return {
        display_name: profile.display_name,
        email: profile.email,
        is_active: profile.is_active,
        organization_name,
        organization_id: profile.organization_id,
        org_role,
        workspaces,
      };
    },
    enabled: !!user,
  });
}
