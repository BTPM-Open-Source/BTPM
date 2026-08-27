import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Roadmap Calendar v2.2 — cross-project key marker read.
 *
 * Single bulk RPC `list_roadmap_calendar_markers(_project_ids)` returns only
 * non-standard typed phases (target_end_date) and tasks (due_date) the caller
 * may read. Standard / work_item items are excluded server-side.
 */
export type MarkerSemanticType = "milestone" | "deliverable" | "decision" | "review";
export type MarkerObjectKind = "phase" | "task";

export interface RoadmapMarkerEvent {
  object_kind: MarkerObjectKind;
  object_id: string;
  object_name: string;
  semantic_type: MarkerSemanticType;
  /** yyyy-mm-dd */
  event_date: string;
  project_id: string;
  project_name: string;
  project_status: string;
  workspace_id: string;
  /** Set only for task markers. */
  phase_id: string | null;
  phase_name: string | null;
}

export function useRoadmapCalendarMarkers(projectIds: string[]) {
  // Stable cache key: sorted ids.
  const key = [...projectIds].sort().join(",");
  return useQuery({
    queryKey: ["roadmap-calendar-markers", key],
    queryFn: async () => {
      if (projectIds.length === 0) return [] as RoadmapMarkerEvent[];
      const { data, error } = await supabase.rpc("list_roadmap_calendar_markers", {
        _project_ids: projectIds,
      });
      if (error) throw error;
      return ((data as any[]) || []) as RoadmapMarkerEvent[];
    },
    enabled: projectIds.length > 0,
    staleTime: 60_000,
  });
}
