import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RoadmapProject {
  id: string;
  name: string;
  status: string;
  priority: string;
  /** Wave 5 Step 5.7 — first-class Project Stage. Distinct from status/health. */
  project_stage: string | null;
  program_id: string | null;
  program_name: string | null;
  start_date: string | null;
  target_end_date: string | null;
  workspace_id: string;
  workspace_name: string;
  agile_enabled: boolean;
  portfolio_item_id: string | null;
  portfolio_name: string | null;
  portfolio_code: string | null;
  portfolio_lifecycle_state: string | null;
  portfolio_is_archived: boolean | null;
}

export interface RoadmapDep {
  id: string;
  source_id: string;
  target_id: string;
  dependency_type: string;
}

/**
 * Fetches all projects across user-visible workspaces for the roadmap.
 * Groups by workspace/program. Derives from canonical data only.
 */
export function useRoadmapProjects() {
  return useQuery({
    queryKey: ["roadmap-projects"],
    queryFn: async () => {
      // 1. Get user's workspaces
      const { data: workspaces, error: wsErr } = await supabase.rpc("list_user_workspaces");
      if (wsErr) throw wsErr;
      // KC.5: exclude Demo Workspace from operational roadmap rollups by default.
      // The B.2 reporting RPC also excludes demo via _include_demo=false; this client
      // filter prevents demo projects from appearing in cross-workspace roadmap views.
      const wsList = ((workspaces as any[]) || []).filter((w) => !w.is_demo);

      // 2. Fetch projects per workspace in parallel
      const projectPromises = wsList.map(async (ws: any) => {
        const { data, error } = await supabase.rpc("list_workspace_projects", {
          _workspace_id: ws.id,
        });
        if (error) throw error;
        return ((data as any[]) || []).map((p: any) => ({
          ...p,
          workspace_id: ws.id,
          workspace_name: ws.name,
        }));
      });

      const results = await Promise.all(projectPromises);
      return results.flat() as RoadmapProject[];
    },
  });
}

/**
 * Fetches project-to-project dependencies across workspaces.
 */
export function useRoadmapDependencies(projectIds: string[]) {
  return useQuery({
    queryKey: ["roadmap-deps", projectIds],
    queryFn: async () => {
      if (projectIds.length === 0) return [];
      const { data, error } = await supabase
        .from("dependencies")
        .select("id, source_id, target_id, dependency_type")
        .eq("source_type", "project")
        .eq("target_type", "project")
        .in("source_id", projectIds);
      if (error) throw error;
      return (data || []) as RoadmapDep[];
    },
    enabled: projectIds.length > 0,
  });
}
