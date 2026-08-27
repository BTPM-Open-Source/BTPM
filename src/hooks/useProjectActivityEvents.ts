/**
 * Wave B.5 — Project-scoped traceability hook.
 *
 * Single source for the project Traceability surface. Reads exclusively from
 * `activity_events` via the SECURITY DEFINER RPC `list_project_activity_events`
 * (which walks the project tree: project → phases → tasks → its blockers /
 * risks / KPIs). No comments. No execution updates. No client derivation.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ProjectActivityEvent = {
  id: string;
  event_type: string;
  target_type: string;
  target_id: string;
  actor_id: string | null;
  organization_id: string;
  workspace_id: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

export function useProjectActivityEvents(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["project-activity-events", projectId],
    queryFn: async (): Promise<ProjectActivityEvent[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc("list_project_activity_events", {
        _project_id: projectId,
      });
      if (error) throw error;
      const rows = (data as ProjectActivityEvent[] | null) ?? [];
      // RPC already orders newest first; defensively sort in JS too.
      return [...rows].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    },
    enabled: !!projectId && enabled,
    staleTime: 15_000,
  });
}
