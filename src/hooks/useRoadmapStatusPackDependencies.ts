/**
 * Roadmap Status Pack — Dependencies & Coordination data hook (Phase 6A.8).
 *
 * Reads project-to-project dependencies through the existing RLS-protected
 * `dependencies` SELECT path used by Roadmap. The current RLS policy
 * (`dep_select_scoped`) controls row visibility through the dependency
 * target via `can_read_project_by_target` (conceptually
 * `is_active_user(auth.uid()) AND can_read_project_by_target(auth.uid(),
 * target_type, target_id)`). This hook additionally filters to rows
 * touching the scoped project set, but it does not broaden access beyond
 * what RLS already authorizes.
 *
 * Because RLS is target-side based, some outbound dependencies pointing
 * to unauthorized external targets may not be visible in this preview.
 *
 * Same-level only: project-to-project rows only. Phase/task-level
 * dependencies are intentionally not surfaced at Roadmap Status Pack
 * scope yet.
 *
 * NO new RPCs, NO new Edge Functions, NO schema. Read-only.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RoadmapStatusPackDependencyRow {
  id: string;
  source_id: string;
  target_id: string;
  dependency_type: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface UseRoadmapStatusPackDependenciesResult {
  rows: readonly RoadmapStatusPackDependencyRow[];
  isLoading: boolean;
  isError: boolean;
  /** True when the scope is empty (no projects to query). */
  isEmptyScope: boolean;
}

/**
 * Fetch project-to-project dependencies where either side is in scope.
 * Returns RLS-filtered rows only. Reuses the same direct-select pattern
 * already used by `useRoadmapDependencies` (Roadmap surface).
 */
export function useRoadmapStatusPackDependencies(
  scopedProjectIds: readonly string[],
): UseRoadmapStatusPackDependenciesResult {
  const stableIds = useMemo(
    () => Array.from(new Set(scopedProjectIds)).sort(),
    [scopedProjectIds],
  );

  const query = useQuery({
    queryKey: ["roadmap-status-pack-deps", stableIds],
    enabled: stableIds.length > 0,
    queryFn: async () => {
      if (stableIds.length === 0) return [];
      const idList = stableIds.join(",");
      const { data, error } = await supabase
        .from("dependencies")
        .select(
          "id, source_id, target_id, dependency_type, description, created_at, updated_at",
        )
        .eq("source_type", "project")
        .eq("target_type", "project")
        .or(`source_id.in.(${idList}),target_id.in.(${idList})`);
      if (error) throw error;
      return (data || []) as RoadmapStatusPackDependencyRow[];
    },
  });

  return {
    rows: (query.data ?? []) as readonly RoadmapStatusPackDependencyRow[],
    isLoading: stableIds.length > 0 && query.isLoading,
    isError: query.isError,
    isEmptyScope: stableIds.length === 0,
  };
}
