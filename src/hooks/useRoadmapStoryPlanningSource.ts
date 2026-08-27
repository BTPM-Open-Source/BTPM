/**
 * Phase 6B.5b — Roadmap Story Pack planning source hook.
 *
 * Fans out the existing authorized SECURITY DEFINER RPCs:
 *   - `list_decrypted_project_phases(_project_id)`
 *   - `list_decrypted_project_tasks(_project_id)`
 * one call per scoped, already-authorized Story Pack project.
 *
 * These are the SAME safe read paths Planning, Gantt, Calendar, and Roadmap
 * hierarchy already use. NO new RPCs, NO direct table reads, NO client-side
 * decryption — the server returns decrypted phase/task names for authorized
 * callers only.
 *
 * The hook is opt-in: fetches only fire when `enabled` is true (i.e. the
 * `planning_phases_tasks` Story Pack source category is on).
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StoryPlanningPhaseRow {
  id: string;
  project_id: string;
  name: string;
  /** 6B.6a — Server-decrypted phase description (may be null). */
  description: string | null;
  status: string;
  sort_order: number | null;
  start_date: string | null;
  target_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  is_archived: boolean;
  updated_at: string;
}

export interface StoryPlanningTaskRow {
  id: string;
  project_id: string;
  phase_id: string | null;
  name: string;
  /** 6B.6a — Server-decrypted task description (may be null). */
  description: string | null;
  status: string;
  priority: string | null;
  sort_order: number | null;
  start_date: string | null;
  due_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  owner_id: string | null;
  is_archived: boolean;
  updated_at: string;
}

export interface UseRoadmapStoryPlanningSourceResult {
  phasesByProjectId: Map<string, StoryPlanningPhaseRow[]>;
  tasksByProjectId: Map<string, StoryPlanningTaskRow[]>;
  isLoading: boolean;
  isError: boolean;
  failedProjectIds: string[];
  hasPartialLoading: boolean;
  /** Convenience: number of projects with at least one successful read. */
  resolvedProjectCount: number;
}

const EMPTY_RESULT: UseRoadmapStoryPlanningSourceResult = {
  phasesByProjectId: new Map(),
  tasksByProjectId: new Map(),
  isLoading: false,
  isError: false,
  failedProjectIds: [],
  hasPartialLoading: false,
  resolvedProjectCount: 0,
};

export function useRoadmapStoryPlanningSource(
  scopedProjectIds: readonly string[],
  enabled: boolean,
): UseRoadmapStoryPlanningSourceResult {
  const stableIds = useMemo(() => {
    if (!enabled) return [] as string[];
    const u = Array.from(new Set(scopedProjectIds.filter(Boolean)));
    u.sort();
    return u;
  }, [scopedProjectIds, enabled]);

  const phaseQueries = useQueries({
    queries: stableIds.map((pid) => ({
      queryKey: ["story-pack", "planning", "phases", pid],
      enabled: enabled && !!pid,
      staleTime: 30_000,
      queryFn: async (): Promise<StoryPlanningPhaseRow[]> => {
        const { data, error } = await supabase.rpc("list_decrypted_project_phases", {
          _project_id: pid,
        });
        if (error) throw new Error(error.message);
        const rows = (data as any[]) ?? [];
        return rows
          .filter((r) => !r.is_archived)
          .map((r) => ({
            id: r.id,
            project_id: r.project_id,
            name: r.name,
            description: r.description ?? null,
            status: r.status,
            sort_order: r.sort_order ?? null,
            start_date: r.start_date ?? null,
            target_end_date: r.target_end_date ?? null,
            actual_start_date: r.actual_start_date ?? null,
            actual_end_date: r.actual_end_date ?? null,
            is_archived: !!r.is_archived,
            updated_at: r.updated_at,
          }));
      },
    })),
  });

  const taskQueries = useQueries({
    queries: stableIds.map((pid) => ({
      queryKey: ["story-pack", "planning", "tasks", pid],
      enabled: enabled && !!pid,
      staleTime: 30_000,
      queryFn: async (): Promise<StoryPlanningTaskRow[]> => {
        const { data, error } = await supabase.rpc("list_decrypted_project_tasks", {
          _project_id: pid,
        });
        if (error) throw new Error(error.message);
        const rows = (data as any[]) ?? [];
        return rows
          .filter((r) => !r.is_archived)
          .map((r) => ({
            id: r.id,
            project_id: r.project_id,
            phase_id: r.phase_id ?? null,
            name: r.name,
            description: r.description ?? null,
            status: r.status,
            priority: r.priority ?? null,
            sort_order: r.sort_order ?? null,
            start_date: r.start_date ?? null,
            due_date: r.due_date ?? null,
            actual_start_date: r.actual_start_date ?? null,
            actual_end_date: r.actual_end_date ?? null,
            owner_id: r.owner_id ?? null,
            is_archived: !!r.is_archived,
            updated_at: r.updated_at,
          }));
      },
    })),
  });

  return useMemo(() => {
    if (!enabled || stableIds.length === 0) return EMPTY_RESULT;

    const phasesByProjectId = new Map<string, StoryPlanningPhaseRow[]>();
    const tasksByProjectId = new Map<string, StoryPlanningTaskRow[]>();
    const failed = new Set<string>();
    let hasPartialLoading = false;

    stableIds.forEach((pid, i) => {
      const pq = phaseQueries[i];
      const tq = taskQueries[i];
      if (pq?.isLoading || tq?.isLoading) hasPartialLoading = true;
      if (pq?.isError || tq?.isError) {
        failed.add(pid);
        return;
      }
      if (pq?.data) phasesByProjectId.set(pid, pq.data);
      if (tq?.data) tasksByProjectId.set(pid, tq.data);
    });

    const total = stableIds.length;
    const isError = total > 0 && failed.size === total;
    const resolvedProjectCount = new Set([
      ...phasesByProjectId.keys(),
      ...tasksByProjectId.keys(),
    ]).size;
    const anyResolved = resolvedProjectCount > 0 || failed.size > 0;
    const isLoading = hasPartialLoading && !anyResolved;

    return {
      phasesByProjectId,
      tasksByProjectId,
      isLoading,
      isError,
      failedProjectIds: Array.from(failed),
      hasPartialLoading,
      resolvedProjectCount,
    };
  }, [enabled, stableIds, phaseQueries, taskQueries]);
}
