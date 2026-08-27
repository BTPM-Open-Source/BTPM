import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ProjectReportingSummary } from "@/lib/reportingSummary";

/**
 * Wave B Step B.2 — client wrapper for the canonical reporting summary RPC.
 *
 * Calls `list_project_reporting_summaries(_workspace_id, _project_ids)`.
 *
 * Single hook serves both single-project and multi-project consumption:
 *   - omit `projectIds` to fetch every non-archived project in the workspace
 *   - pass a project id list to narrow (e.g. one project on overview)
 *
 * Read-only. No UI surface consumes this in B.2; surfacing lands in B.3 / B.4.
 */
export function useProjectReportingSummaries(
  workspaceId: string | undefined,
  projectIds?: string[],
) {
  const idsKey = projectIds && projectIds.length > 0 ? [...projectIds].sort() : null;

  return useQuery({
    queryKey: ["project-reporting-summaries", workspaceId, idsKey],
    enabled: !!workspaceId,
    queryFn: async (): Promise<ProjectReportingSummary[]> => {
      if (!workspaceId) return [];
      const { data, error } = await supabase.rpc(
        "list_project_reporting_summaries" as never,
        {
          _workspace_id: workspaceId,
          _project_ids: idsKey ?? null,
        } as never,
      );
      if (error) throw error;
      return (data as unknown as ProjectReportingSummary[] | null) ?? [];
    },
    staleTime: 30_000,
  });
}
