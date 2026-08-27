/**
 * Roadmap Status Pack — Progress Since Last Period data hook (Phase 6A.11).
 *
 * Fans out the existing protected SECURITY DEFINER RPC
 *   - `list_project_activity_events(_project_id)`
 * one call per scoped project. This is the SAME safe read path already used
 * by the Project Traceability surface (`useProjectActivityEvents`). The RPC
 * walks the project tree (project → phases → tasks → its blockers / risks /
 * KPIs) and only returns rows the caller is authorized to see.
 *
 * NO new RPCs. NO new Edge Functions. NO direct table reads. The client does
 * NOT decrypt anything — the RPC returns server-safe rows.
 *
 * Execution updates are NOT included here. The existing
 * `list_decrypted_execution_updates` RPC requires a per-target `target_type`
 * + `target_id` pair and there is no safe Roadmap-level aggregate path for
 * them yet. Surfacing them in this step would either require a new backend
 * resolver (out of scope) or unsafe broad table reads (forbidden). They are
 * surfaced in the section as "not separately available in this view".
 *
 * Period filtering (default `Last 7 days`) is applied in the pure derivation
 * helper, not here — this hook returns the raw authorized rows so the helper
 * stays testable without I/O.
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ProjectActivityEvent } from "@/hooks/useProjectActivityEvents";

export interface UseRoadmapStatusPackProgressResult {
  /** Activity events grouped by project id (authorized + scoped only). */
  rowsByProjectId: Map<string, ProjectActivityEvent[]>;
  isLoading: boolean;
  isError: boolean;
  failedProjectIds: string[];
  /** True while any per-project query is still in flight. */
  hasPartialLoading: boolean;
}

export function useRoadmapStatusPackProgress(
  scopedProjectIds: readonly string[],
): UseRoadmapStatusPackProgressResult {
  const stableIds = useMemo(() => {
    const u = Array.from(new Set(scopedProjectIds));
    u.sort();
    return u;
  }, [scopedProjectIds]);

  const queries = useQueries({
    queries: stableIds.map((pid) => ({
      queryKey: ["status-pack", "progress-activity", pid],
      enabled: !!pid,
      staleTime: 30_000,
      queryFn: async (): Promise<ProjectActivityEvent[]> => {
        const { data, error } = await supabase.rpc("list_project_activity_events", {
          _project_id: pid,
        });
        if (error) throw new Error(error.message);
        return (data as ProjectActivityEvent[] | null) ?? [];
      },
    })),
  });

  return useMemo(() => {
    const rowsByProjectId = new Map<string, ProjectActivityEvent[]>();
    const failed = new Set<string>();
    let hasPartialLoading = false;

    stableIds.forEach((pid, i) => {
      const q = queries[i];
      if (q?.isLoading) hasPartialLoading = true;
      if (q?.isError) {
        failed.add(pid);
      } else if (q?.data) {
        rowsByProjectId.set(pid, q.data);
      }
    });

    const total = stableIds.length;
    const isError = total > 0 && failed.size === total;
    const anyResolved = rowsByProjectId.size > 0 || failed.size > 0;
    const isLoading = hasPartialLoading && !anyResolved;

    return {
      rowsByProjectId,
      isLoading,
      isError,
      failedProjectIds: Array.from(failed),
      hasPartialLoading,
    };
  }, [stableIds, queries]);
}
