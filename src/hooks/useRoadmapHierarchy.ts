import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RoadmapPhase {
  id: string;
  name: string;
  status: string;
  start_date: string | null;
  target_end_date: string | null;
  sort_order: number;
  project_id: string;
}

export interface RoadmapTask {
  id: string;
  name: string;
  status: string;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  phase_id: string;
  project_id: string;
  sort_order: number;
}

/**
 * Fetches phases for a single project (canonical, decrypted).
 * Enabled only when the project row is expanded.
 */
export function useRoadmapPhases(projectId: string | undefined) {
  return useQuery({
    queryKey: ["roadmap-phases", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc("list_decrypted_project_phases", {
        _project_id: projectId,
      });
      if (error) throw error;
      return ((data as any[]) || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        start_date: p.start_date,
        target_end_date: p.target_end_date,
        sort_order: p.sort_order ?? 0,
        project_id: projectId,
      })) as RoadmapPhase[];
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });
}

/**
 * Fetches tasks for a single project (canonical, decrypted).
 * Enabled only when at least one phase is expanded.
 */
export function useRoadmapTasks(projectId: string | undefined) {
  return useQuery({
    queryKey: ["roadmap-tasks", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc("list_decrypted_project_tasks", {
        _project_id: projectId,
      });
      if (error) throw error;
      return ((data as any[]) || []).map((t: any) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        priority: t.priority,
        start_date: t.start_date,
        due_date: t.due_date,
        phase_id: t.phase_id,
        project_id: projectId,
        sort_order: t.sort_order ?? 0,
      })) as RoadmapTask[];
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });
}
