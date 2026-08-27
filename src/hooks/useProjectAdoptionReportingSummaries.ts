import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ProjectAdoptionReportingSummary } from "@/lib/adoptionReportingSummary";

/**
 * CM.7 — Project-level adoption reporting summaries.
 *
 * Calls the read-only SECURITY DEFINER RPC
 * `list_project_adoption_reporting_summaries(_workspace_id, _project_ids)`.
 *
 * Single hook serves both single-project and multi-project consumption.
 * Mirrors the pattern of `useProjectReportingSummaries`.
 */
export function useProjectAdoptionReportingSummaries(
  workspaceId: string | undefined,
  projectIds?: string[],
) {
  const idsKey = projectIds && projectIds.length > 0 ? [...projectIds].sort() : null;

  return useQuery({
    queryKey: ["project-adoption-reporting-summaries", workspaceId, idsKey],
    enabled: !!workspaceId,
    queryFn: async (): Promise<ProjectAdoptionReportingSummary[]> => {
      if (!workspaceId) return [];
      const { data, error } = await supabase.rpc(
        "list_project_adoption_reporting_summaries" as never,
        {
          _workspace_id: workspaceId,
          _project_ids: idsKey ?? null,
        } as never,
      );
      if (error) throw error;
      return (data as unknown as ProjectAdoptionReportingSummary[] | null) ?? [];
    },
    staleTime: 30_000,
  });
}
