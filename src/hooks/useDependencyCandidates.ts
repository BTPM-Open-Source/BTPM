import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DependencyCandidate, DepEntityType } from "@/components/dependencies/DependencyPanel";

/**
 * Returns same-level candidate items eligible to be linked as a dependency
 * for the given entity. Self-exclusion is left to the panel; this hook only
 * returns the same-level universe within the proper scope:
 *   - project: all projects in same workspace
 *   - phase:   all phases in same project
 *   - task:    all tasks in same project (any phase)
 */
export function useDependencyCandidates(
  entityType: DepEntityType,
  scope: { workspaceId?: string; projectId?: string }
) {
  return useQuery<DependencyCandidate[]>({
    queryKey: ["dep-candidates", entityType, scope.workspaceId ?? null, scope.projectId ?? null],
    queryFn: async () => {
      if (entityType === "project") {
        if (!scope.workspaceId) return [];
        const { data, error } = await supabase
          .from("projects")
          .select("id, name, status")
          .eq("workspace_id", scope.workspaceId)
          .eq("is_archived", false)
          .order("name");
        if (error) throw error;
        return (data || []).map((p) => ({
          id: p.id, name: p.name, hint: p.status,
        }));
      }
      if (entityType === "phase") {
        if (!scope.projectId) return [];
        const { data, error } = await supabase
          .from("phases")
          .select("id, name, start_date, target_end_date")
          .eq("project_id", scope.projectId)
          .eq("is_archived", false)
          .order("sort_order");
        if (error) throw error;
        return (data || []).map((p) => ({
          id: p.id,
          name: p.name,
          hint: [p.start_date, p.target_end_date].filter(Boolean).join(" → ") || undefined,
        }));
      }
      // task
      if (!scope.projectId) return [];
      const { data, error } = await supabase
        .from("tasks")
        .select("id, name, phase_id, phases:phase_id(name)")
        .eq("project_id", scope.projectId)
        .eq("is_archived", false)
        .order("sort_order");
      if (error) throw error;
      return (data || []).map((t: any) => ({
        id: t.id, name: t.name, hint: t.phases?.name,
      }));
    },
    enabled:
      (entityType === "project" && !!scope.workspaceId) ||
      (entityType !== "project" && !!scope.projectId),
  });
}
