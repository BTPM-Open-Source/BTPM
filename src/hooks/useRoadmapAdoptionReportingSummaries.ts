import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ProjectAdoptionReportingSummary } from "@/lib/adoptionReportingSummary";

/**
 * CM.7 — Roadmap-side multi-workspace adapter for the CM.7 derived adoption
 * reporting RPC.
 *
 * `list_project_adoption_reporting_summaries(_workspace_id, _project_ids)` is
 * workspace-scoped because access is enforced per workspace inside the
 * SECURITY DEFINER body. The roadmap surface aggregates projects from every
 * workspace the user can see, so we fan out one RPC call per workspace and
 * merge results into `Map<projectId, ProjectAdoptionReportingSummary>`.
 *
 * Same shape as `useRoadmapReportingSummaries` — single canonical contract.
 */

export interface RoadmapAdoptionReportingState {
  byProjectId: Map<string, ProjectAdoptionReportingSummary>;
  isLoading: boolean;
  isError: boolean;
}

export function useRoadmapAdoptionReportingSummaries(
  workspaceIds: string[],
): RoadmapAdoptionReportingState {
  const stableIds = useMemo(() => {
    const unique = Array.from(new Set(workspaceIds));
    unique.sort();
    return unique;
  }, [workspaceIds]);

  const queries = useQueries({
    queries: stableIds.map((wsId) => ({
      queryKey: ["project-adoption-reporting-summaries", wsId, null],
      enabled: !!wsId,
      staleTime: 30_000,
      queryFn: async (): Promise<ProjectAdoptionReportingSummary[]> => {
        const { data, error } = await supabase.rpc(
          "list_project_adoption_reporting_summaries" as never,
          {
            _workspace_id: wsId,
            _project_ids: null,
          } as never,
        );
        if (error) throw error;
        return (data as unknown as ProjectAdoptionReportingSummary[] | null) ?? [];
      },
    })),
  });

  return useMemo(() => {
    const byProjectId = new Map<string, ProjectAdoptionReportingSummary>();
    let isLoading = false;
    let isError = false;
    for (const q of queries) {
      if (q.isLoading) isLoading = true;
      if (q.isError) isError = true;
      if (q.data) {
        for (const row of q.data) {
          byProjectId.set(row.project_id, row);
        }
      }
    }
    return { byProjectId, isLoading, isError };
  }, [queries]);
}
