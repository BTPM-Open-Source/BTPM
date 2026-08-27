/**
 * Roadmap Status Pack — Team Work Summary data hook (Phase 6A.12).
 *
 * Fans out the existing protected RPC `public.get_team_work_overview`
 * one call per scoped project. That RPC is the SAME authorized read path
 * already used by the Team Work / Work Hub surface (see
 * `useTeamWorkOverview`) — it derives results from canonical
 * project/phase/task/assignment/blocker data on every call, enforces
 * workspace membership and per-project access server-side, and never
 * exposes rows the caller is not authorized to see.
 *
 * NO new RPCs, NO new Edge Functions, NO direct table reads. NO unsafe
 * decryption on the client. The hook returns the raw authorized
 * `TeamWorkOverview` per project; bucketing/sorting is applied in the
 * pure derivation helper.
 *
 * `_time_window: "all_open"` with `_include_completed: false` is used so
 * the section can summarize the current open backlog (overdue, due
 * today/soon, blocked, unassigned, high priority). Recently-completed
 * work is intentionally NOT surfaced in this summary view — the RPC's
 * `completed_in_window` is scoped to the requested time window, and
 * adding a separate fan-out solely for that signal would require either
 * a new aggregate resolver (out of scope) or a second multiplicative
 * fan-out. It is labelled honestly in the UI.
 */
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { TeamWorkOverview } from "@/hooks/useTeamWorkOverview";

export interface UseRoadmapStatusPackTeamWorkResult {
  /** Per-project authorized Team Work overview (open work, no completed). */
  overviewByProjectId: Map<string, TeamWorkOverview>;
  isLoading: boolean;
  isError: boolean;
  failedProjectIds: string[];
  /** True while ANY per-project query is still in flight. */
  hasPartialLoading: boolean;
}

export function useRoadmapStatusPackTeamWork(
  scopedProjectIds: readonly string[],
): UseRoadmapStatusPackTeamWorkResult {
  const { user } = useAuth();

  const stableIds = useMemo(() => {
    const u = Array.from(new Set(scopedProjectIds));
    u.sort();
    return u;
  }, [scopedProjectIds]);

  const queries = useQueries({
    queries: stableIds.map((pid) => ({
      queryKey: ["status-pack", "team-work-overview", user?.id, pid],
      enabled: !!user && !!pid,
      staleTime: 30_000,
      queryFn: async (): Promise<TeamWorkOverview> => {
        const { data, error } = await supabase.rpc("get_team_work_overview", {
          _workspace_id: null,
          _workspace_ids: null,
          _program_id: null,
          _project_id: pid,
          _assignee_id: null,
          _time_window: "all_open",
          _include_completed: false,
        });
        if (error) throw new Error(error.message);
        return (data ?? {
          time_window: "all_open",
          as_of: new Date().toISOString().slice(0, 10),
          items: [],
          summary: {
            total_open: 0, due_today: 0, overdue: 0, upcoming: 0, blocked: 0,
            unassigned: 0, high_priority_open: 0, unestimated: 0,
            completed_in_window: 0, estimated_open_hours: 0,
          },
          by_person: [],
          by_project: [],
        }) as unknown as TeamWorkOverview;
      },
    })),
  });

  return useMemo(() => {
    const overviewByProjectId = new Map<string, TeamWorkOverview>();
    const failed = new Set<string>();
    let hasPartialLoading = false;

    stableIds.forEach((pid, i) => {
      const q = queries[i];
      if (q?.isLoading) hasPartialLoading = true;
      if (q?.isError) failed.add(pid);
      else if (q?.data) overviewByProjectId.set(pid, q.data);
    });

    const total = stableIds.length;
    const isError = total > 0 && failed.size === total;
    const anyResolved = overviewByProjectId.size > 0 || failed.size > 0;
    const isLoading = hasPartialLoading && !anyResolved;

    return {
      overviewByProjectId,
      isLoading,
      isError,
      failedProjectIds: Array.from(failed),
      hasPartialLoading,
    };
  }, [stableIds, queries]);
}
