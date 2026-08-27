import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ProjectReportingSummary } from "@/lib/reportingSummary";

/**
 * Wave B Step B.4 — Roadmap-side multi-workspace adapter for the B.2
 * canonical reporting contract.
 *
 * The B.2 RPC `list_project_reporting_summaries(_workspace_id, _project_ids)`
 * is workspace-scoped because authority is enforced per workspace inside the
 * SECURITY DEFINER body. The roadmap surface aggregates projects from every
 * workspace the user can see, so we fan out one RPC call per workspace and
 * merge the results into a `Map<projectId, ProjectReportingSummary>`.
 *
 * This is NOT a second reporting contract — it returns the same
 * `ProjectReportingSummary` rows produced by B.2. No client-side derivation,
 * no parallel RPC, no shadow summary table.
 */

export interface RoadmapReportingState {
  byProjectId: Map<string, ProjectReportingSummary>;
  isLoading: boolean;
  isError: boolean;
}

export function useRoadmapReportingSummaries(
  workspaceIds: string[],
): RoadmapReportingState {
  // Stable keys — sort to keep React Query cache stable across re-renders.
  const stableIds = useMemo(() => {
    const unique = Array.from(new Set(workspaceIds));
    unique.sort();
    return unique;
  }, [workspaceIds]);

  const queries = useQueries({
    queries: stableIds.map((wsId) => ({
      queryKey: ["project-reporting-summaries", wsId, null],
      enabled: !!wsId,
      staleTime: 30_000,
      queryFn: async (): Promise<ProjectReportingSummary[]> => {
        const { data, error } = await supabase.rpc(
          "list_project_reporting_summaries" as never,
          {
            _workspace_id: wsId,
            _project_ids: null,
          } as never,
        );
        if (error) throw error;
        return (data as unknown as ProjectReportingSummary[] | null) ?? [];
      },
    })),
  });

  return useMemo(() => {
    const byProjectId = new Map<string, ProjectReportingSummary>();
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
