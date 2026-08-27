import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type WorkspaceProjectDeepMatch = {
  project_id: string;
  match_count: number;
  matches: Array<{
    type: "project" | "program" | "phase" | "task";
    label: string;
    context_label: string | null;
    phase_id: string | null;
    task_id: string | null;
  }>;
};

export function useWorkspaceProjectDeepSearch(
  workspaceId: string | undefined,
  query: string,
  includeArchived: boolean,
) {
  const q = (query ?? "").trim();
  const enabled = !!workspaceId && q.length >= 2;
  return useQuery({
    queryKey: ["workspace-project-deep-search", workspaceId, q, includeArchived],
    queryFn: async (): Promise<WorkspaceProjectDeepMatch[]> => {
      const { data, error } = await supabase.rpc(
        "search_workspace_project_deep_matches" as any,
        {
          _workspace_id: workspaceId,
          _query: q,
          _include_archived: includeArchived,
        } as any,
      );
      if (error) throw error;
      return (data as WorkspaceProjectDeepMatch[]) ?? [];
    },
    enabled,
    staleTime: 15_000,
    retry: 1,
  });
}
