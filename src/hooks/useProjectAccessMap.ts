import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * PA-3 — Frontend project visibility / authority truth.
 *
 * Returns a memoised access map for the current user:
 *  - isOrgAdmin: org_admin in current org
 *  - adminWorkspaceIds: workspaces where user is workspace_admin (or higher via role)
 *  - projectRoles: project_id -> project_role (active project_memberships only)
 *
 * Helpers:
 *  - canSeeProject({ id, workspace_id })  -> admin OR active membership
 *  - canManageProject({ id, workspace_id }) -> admin OR project_manager membership
 *  - projectRole(id)
 *
 * NOT a security boundary — mirrors PA-0.1 target model. RLS cutover is PA-4.
 */

export type ProjectRole = "project_manager" | "contributor" | "viewer";

export interface ProjectAccessMap {
  isLoading: boolean;
  isOrgAdmin: boolean;
  adminWorkspaceIds: Set<string>;
  projectRoles: Map<string, ProjectRole>;
  canSeeProject: (p: { id: string; workspace_id?: string | null }) => boolean;
  canManageProject: (p: { id: string; workspace_id?: string | null }) => boolean;
  projectRole: (projectId: string) => ProjectRole | null;
}

export function useProjectAccessMap(): ProjectAccessMap {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["project-access-map", user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) {
        return {
          isOrgAdmin: false,
          adminWorkspaceIds: [] as string[],
          memberships: [] as { project_id: string; role: ProjectRole }[],
        };
      }

      // Resolve organization for this user
      const { data: profileData } = await supabase.rpc("get_decrypted_profile");
      const profile = profileData as any;
      const orgId: string | null = profile?.organization_id ?? null;

      let isOrgAdmin = false;
      const adminWs: string[] = [];

      if (orgId) {
        const { data: orgAdmin } = await supabase.rpc("is_org_admin", {
          _user_id: user.id,
          _organization_id: orgId,
        });
        isOrgAdmin = !!orgAdmin;

        const { data: roleRows } = await supabase
          .from("user_roles")
          .select("workspace_id, role")
          .eq("user_id", user.id)
          .eq("organization_id", orgId);
        for (const r of (roleRows ?? []) as any[]) {
          if (r.workspace_id && (r.role === "workspace_admin" || r.role === "org_admin")) {
            adminWs.push(r.workspace_id);
          }
        }
      }

      const { data: membershipRows } = await supabase
        .from("project_memberships")
        .select("project_id, role")
        .eq("user_id", user.id)
        .is("removed_at", null);

      const memberships = ((membershipRows ?? []) as any[]).map((r) => ({
        project_id: r.project_id as string,
        role: r.role as ProjectRole,
      }));

      return { isOrgAdmin, adminWorkspaceIds: adminWs, memberships };
    },
    staleTime: 60_000,
  });

  return useMemo(() => {
    const isOrgAdmin = !!data?.isOrgAdmin;
    const adminWorkspaceIds = new Set<string>(data?.adminWorkspaceIds ?? []);
    const projectRoles = new Map<string, ProjectRole>();
    for (const m of data?.memberships ?? []) projectRoles.set(m.project_id, m.role);

    const canSeeProject = (p: { id: string; workspace_id?: string | null }) => {
      if (!user) return false;
      if (isOrgAdmin) return true;
      if (p.workspace_id && adminWorkspaceIds.has(p.workspace_id)) return true;
      return projectRoles.has(p.id);
    };

    const canManageProject = (p: { id: string; workspace_id?: string | null }) => {
      if (!user) return false;
      if (isOrgAdmin) return true;
      if (p.workspace_id && adminWorkspaceIds.has(p.workspace_id)) return true;
      return projectRoles.get(p.id) === "project_manager";
    };

    const projectRole = (projectId: string) => projectRoles.get(projectId) ?? null;

    return {
      isLoading,
      isOrgAdmin,
      adminWorkspaceIds,
      projectRoles,
      canSeeProject,
      canManageProject,
      projectRole,
    };
  }, [data, isLoading, user]);
}
