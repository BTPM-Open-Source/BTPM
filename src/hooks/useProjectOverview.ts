import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { normalizeProjectTeamRoleLabels } from "@/hooks/projectTeamUtils";

type DecryptedOverviewTeamMember = {
  id: string;
  user_id: string;
  role_label: string | null;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await supabase.rpc("get_decrypted_project", {
        _project_id: projectId,
      });
      if (error) throw error;
      return data as any;
    },
    enabled: !!projectId,
  });
}

export function useProjectRisks(projectId: string | undefined, workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["project-risks", projectId],
    queryFn: async () => {
      if (!projectId || !workspaceId) throw new Error("Missing IDs");

      const { data: projectRisks, error: e1 } = await supabase
        .from("risks")
        .select("id, title, status, likelihood, impact")
        .eq("target_type", "project")
        .eq("target_id", projectId);
      if (e1) throw e1;

      const { data: phases, error: e2 } = await supabase
        .from("phases")
        .select("id")
        .eq("project_id", projectId);
      if (e2) throw e2;

      const phaseIds = (phases || []).map((p) => p.id);
      let phaseRisks: typeof projectRisks = [];
      if (phaseIds.length > 0) {
        const { data, error } = await supabase
          .from("risks")
          .select("id, title, status, likelihood, impact")
          .eq("target_type", "phase")
          .in("target_id", phaseIds);
        if (error) throw error;
        phaseRisks = data || [];
      }

      const { data: tasks, error: e3 } = await supabase
        .from("tasks")
        .select("id")
        .eq("project_id", projectId);
      if (e3) throw e3;

      const taskIds = (tasks || []).map((t) => t.id);
      let taskRisks: typeof projectRisks = [];
      if (taskIds.length > 0) {
        const { data, error } = await supabase
          .from("risks")
          .select("id, title, status, likelihood, impact")
          .eq("target_type", "task")
          .in("target_id", taskIds);
        if (error) throw error;
        taskRisks = data || [];
      }

      return [...(projectRisks || []), ...phaseRisks, ...taskRisks];
    },
    enabled: !!projectId && !!workspaceId,
  });
}

export function useProjectTeam(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-team", projectId],
    queryFn: async () => {
      if (!projectId) throw new Error("No project ID");

      const { data, error } = await supabase.rpc("list_decrypted_project_team", {
        _project_id: projectId,
      });

      if (error) throw error;

      const members = await normalizeProjectTeamRoleLabels(
        projectId,
        ((data as DecryptedOverviewTeamMember[]) || []),
      );

      return members.map((member) => ({
        id: member.id,
        user_id: member.user_id,
        role_label: member.role_label,
        profiles: {
          display_name: member.display_name,
          email: member.email,
          avatar_url: member.avatar_url,
        },
      }));
    },
    enabled: !!projectId,
  });
}

export function useProjectKpis(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-kpis", projectId],
    queryFn: async () => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await supabase
        .from("kpi_definitions")
        .select("id, name, unit, target_value, current_value, target_direction, is_archived")
        .eq("target_type", "project")
        .eq("target_id", projectId)
        .eq("is_archived", false);
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId,
  });
}

export function useProjectBlockers(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-blockers", projectId],
    queryFn: async () => {
      if (!projectId) throw new Error("No project ID");

      const { data: projectBlockers, error: e1 } = await supabase
        .from("blockers")
        .select("id, title, status, severity")
        .eq("target_type", "project")
        .eq("target_id", projectId);
      if (e1) throw e1;

      const { data: phases } = await supabase
        .from("phases")
        .select("id")
        .eq("project_id", projectId);

      const phaseIds = (phases || []).map((p) => p.id);
      let phaseBlockers: typeof projectBlockers = [];
      if (phaseIds.length > 0) {
        const { data, error } = await supabase
          .from("blockers")
          .select("id, title, status, severity")
          .eq("target_type", "phase")
          .in("target_id", phaseIds);
        if (error) throw error;
        phaseBlockers = data || [];
      }

      const { data: tasks } = await supabase
        .from("tasks")
        .select("id")
        .eq("project_id", projectId);

      const taskIds = (tasks || []).map((t) => t.id);
      let taskBlockers: typeof projectBlockers = [];
      if (taskIds.length > 0) {
        const { data, error } = await supabase
          .from("blockers")
          .select("id, title, status, severity")
          .eq("target_type", "task")
          .in("target_id", taskIds);
        if (error) throw error;
        taskBlockers = data || [];
      }

      return [...(projectBlockers || []), ...phaseBlockers, ...taskBlockers];
    },
    enabled: !!projectId,
  });
}

export function useWorkspaces() {
  // Phase 4D.7 — key on active org so switching org refetches the scoped list.
  // Reading the active org from localStorage avoids a circular dep with
  // ActiveContextProvider (useWorkspaces is consumed by ActiveWorkspaceProvider,
  // which itself sits under ActiveContextProvider — but this hook is called
  // there and elsewhere). Server-side list_user_workspaces authoritatively
  // scopes to user_active_context_preferences.
  let activeOrgHint: string | null = null;
  try {
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem("btpm:active-context-org:v1");
      activeOrgHint = raw && raw.length > 0 ? raw : null;
    }
  } catch {
    /* ignore */
  }
  return useQuery({
    queryKey: ["workspaces", activeOrgHint],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_user_workspaces");
      if (error) throw error;
      return (data as any[]) || [];
    },
  });
}

export function useWorkspaceProjects(
  workspaceId: string | undefined,
  options?: { includeArchived?: boolean },
) {
  const includeArchived = !!options?.includeArchived;
  return useQuery({
    queryKey: ["workspace-projects", workspaceId, { includeArchived }],
    queryFn: async () => {
      if (!workspaceId) throw new Error("No workspace ID");
      const { data, error } = await supabase.rpc("list_workspace_projects", {
        _workspace_id: workspaceId,
        _include_archived: includeArchived,
      } as any);
      if (error) throw error;
      const projects = (data as any[]) || [];
      // Map program_name to nested programs object for compatibility
      return projects.map((p: any) => ({
        ...p,
        programs: p.program_name ? { name: p.program_name } : null,
      }));
    },
    enabled: !!workspaceId,
  });
}
