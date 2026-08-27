/**
 * Roadmap Status Pack — Risks & Blockers data hook (Phase 6A.7).
 *
 * Fans out the existing protected SECURITY DEFINER RPCs
 *   - `list_project_all_risks(_project_id)`
 *   - `list_project_all_blockers(_project_id)`
 * one call per scoped project. This is the SAME safe read path already used
 * by `useProjectRisksBlockers` and by the legacy roadmap deck Edge Function.
 *
 * No new RPCs. No new Edge Functions. No direct plaintext table reads. No
 * decryption work in the client — the RPCs return server-decrypted rows.
 *
 * Scope filtering is applied BEFORE issuing queries (only authorized,
 * scoped projects from the Roadmap Status Pack preview).
 */
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  rpcTyped,
  type ProjectBlockerRow,
  type ProjectRiskRow,
} from "@/lib/entityLinks";

export interface ScopedProjectIdentity {
  id: string;
  /** Used for fallback labelling only; never used to bypass authorization. */
  name?: string;
}

export interface UseRoadmapStatusPackRisksBlockersResult {
  /** Risks grouped by project id (authorized + scoped only). */
  risksByProjectId: Map<string, ProjectRiskRow[]>;
  /** Blockers grouped by project id (authorized + scoped only). */
  blockersByProjectId: Map<string, ProjectBlockerRow[]>;
  isLoading: boolean;
  isError: boolean;
  /** Per-project failure flags — used to mark partial coverage honestly. */
  failedProjectIds: string[];
  /** True if at least one query is still loading. */
  hasPartialLoading: boolean;
}

export function useRoadmapStatusPackRisksBlockers(
  scopedProjects: readonly ScopedProjectIdentity[],
): UseRoadmapStatusPackRisksBlockersResult {
  // Stable ordered ids — sort to keep React Query cache stable across renders.
  const stableIds = useMemo(() => {
    const unique = Array.from(new Set(scopedProjects.map((p) => p.id)));
    unique.sort();
    return unique;
  }, [scopedProjects]);

  const riskQueries = useQueries({
    queries: stableIds.map((pid) => ({
      queryKey: ["status-pack", "risks", pid],
      enabled: !!pid,
      staleTime: 30_000,
      queryFn: async (): Promise<ProjectRiskRow[]> => {
        const { data, error } = await rpcTyped<ProjectRiskRow[]>(
          "list_project_all_risks",
          { _project_id: pid },
        );
        if (error) throw new Error(error.message);
        return data ?? [];
      },
    })),
  });

  const blockerQueries = useQueries({
    queries: stableIds.map((pid) => ({
      queryKey: ["status-pack", "blockers", pid],
      enabled: !!pid,
      staleTime: 30_000,
      queryFn: async (): Promise<ProjectBlockerRow[]> => {
        const { data, error } = await rpcTyped<ProjectBlockerRow[]>(
          "list_project_all_blockers",
          { _project_id: pid },
        );
        if (error) throw new Error(error.message);
        return data ?? [];
      },
    })),
  });

  return useMemo(() => {
    const risksByProjectId = new Map<string, ProjectRiskRow[]>();
    const blockersByProjectId = new Map<string, ProjectBlockerRow[]>();
    const failed = new Set<string>();
    let isLoading = false;
    let hasPartialLoading = false;
    let isError = false;

    stableIds.forEach((pid, i) => {
      const rq = riskQueries[i];
      const bq = blockerQueries[i];
      if (rq?.isLoading || bq?.isLoading) {
        isLoading = isLoading || (rq?.isLoading ?? false) && (bq?.isLoading ?? false);
        hasPartialLoading = true;
      }
      if (rq?.isError) {
        failed.add(pid);
      } else if (rq?.data) {
        risksByProjectId.set(pid, rq.data);
      }
      if (bq?.isError) {
        failed.add(pid);
      } else if (bq?.data) {
        blockersByProjectId.set(pid, bq.data);
      }
    });

    // Treat aggregate as errored only if EVERY project failed and none loaded.
    const totalProjects = stableIds.length;
    if (totalProjects > 0 && failed.size === totalProjects) isError = true;

    // "isLoading" reported only while NO project has resolved yet.
    const anyResolved =
      risksByProjectId.size > 0 || blockersByProjectId.size > 0 || failed.size > 0;
    isLoading = hasPartialLoading && !anyResolved;

    return {
      risksByProjectId,
      blockersByProjectId,
      isLoading,
      isError,
      failedProjectIds: Array.from(failed),
      hasPartialLoading,
    };
  }, [stableIds, riskQueries, blockerQueries]);
}
