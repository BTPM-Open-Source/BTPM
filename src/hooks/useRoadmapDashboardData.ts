import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { RoadmapProject } from "@/hooks/useRoadmapData";
// Wave C1 progress correction — headline project progress on the Roadmap
// Dashboard (and the Calendar drawer that consumes the same hook) is
// duration-weighted via the canonical KPI Engine
// (`duration_weighted_completion_percent`). When the engine reports
// `insufficient_date_basis` or `no_source_data`, we transparently fall
// back to `task_count_completion_percent` and expose `completionBasis`
// so the UI can label the basis truthfully.
import {
  buildDashboardKpiInput,
  liveCalculateDashboardKpi,
  percentValueOrZero,
  todayIsoDate,
} from "@/lib/kpi/kpiDashboardMetrics";

export type ProjectCompletionBasis = "duration" | "task_count" | "none";

export interface ProjectDashboardData {
  projectId: string;
  taskTotal: number;
  taskCompleted: number;
  completionPercent: number;
  completionBasis: ProjectCompletionBasis;
  ownerName: string | null;
}

/**
 * Fetches task-level completion data + owner for each project in the filtered set.
 * Derives completion from canonical tasks table. No shadow/summary tables.
 */
export function useRoadmapDashboardData(filteredProjects: RoadmapProject[]) {
  const projectIds = filteredProjects.map((p) => p.id);

  return useQuery({
    queryKey: ["roadmap-dashboard", "duration-weighted-v1", projectIds],
    queryFn: async () => {
      if (projectIds.length === 0) return new Map<string, ProjectDashboardData>();

      // Batch fetch all tasks for these projects. We pull the date fields
      // required by `duration_weighted_completion_percent` (start_date,
      // due_date, baseline_end_date) so the KPI engine can weight tasks
      // by planned duration instead of equal task count.
      const { data: tasks, error: tErr } = await supabase
        .from("tasks")
        .select("project_id, status, start_date, due_date, baseline_end_date, task_type")
        .in("project_id", projectIds)
        .eq("is_archived", false);
      if (tErr) throw tErr;

      // Batch fetch project team members to find owner (first member or role_label containing lead/manager/owner)
      const { data: teamMembers, error: tmErr } = await supabase
        .from("project_team_members")
        .select("project_id, user_id, role_label")
        .in("project_id", projectIds);
      if (tmErr) throw tmErr;

      // Get unique user IDs and fetch decrypted display names
      const userIds = [...new Set((teamMembers || []).map((m) => m.user_id))];
      let profileMap = new Map<string, string>();
      // Fetch decrypted profiles one-by-one (RPC only supports single user)
      const profilePromises = userIds.map(async (uid) => {
        const { data } = await supabase.rpc("get_decrypted_profile", { _user_id: uid });
        if (data) {
          const p = data as any;
          profileMap.set(uid, p.display_name || p.email || "Unknown");
        }
      });
      await Promise.all(profilePromises);

      const result = new Map<string, ProjectDashboardData>();
      const snapshotDate = todayIsoDate();

      for (const pid of projectIds) {
        const projectTasks = (tasks || []).filter((t) => t.project_id === pid);
        const actionable = projectTasks.filter((t) => t.status !== "cancelled");
        const completed = actionable.filter((t) => t.status === "completed");

        const projectRow = filteredProjects.find((p) => p.id === pid);
        const kpiInput = buildDashboardKpiInput({
          project: {
            id: pid,
            status: projectRow?.status ?? null,
            target_end_date: (projectRow as any)?.target_end_date ?? null,
            start_date: (projectRow as any)?.start_date ?? null,
          },
          tasks: projectTasks.map((t) => ({
            project_id: t.project_id,
            status: t.status,
            start_date: t.start_date ?? null,
            due_date: t.due_date ?? null,
            baseline_end_date: t.baseline_end_date ?? null,
            task_type: t.task_type ?? null,
            is_archived: false,
          })),
          snapshotDate,
        });

        // 1) Try duration-weighted (headline default).
        const durationResult = liveCalculateDashboardKpi(
          "duration_weighted_completion_percent",
          kpiInput,
        );

        let percent = 0;
        let basis: ProjectCompletionBasis = "none";

        if (durationResult.calculationStatus === "calculated") {
          percent = percentValueOrZero(durationResult);
          basis = "duration";
        } else {
          // 2) Transparent fallback to task-count basis when date basis
          // is insufficient. The UI surfaces `basis` so users see why.
          const countResult = liveCalculateDashboardKpi(
            "task_count_completion_percent",
            kpiInput,
          );
          if (countResult.calculationStatus === "calculated") {
            percent = percentValueOrZero(countResult);
            basis = "task_count";
          } else {
            percent = 0;
            basis = "none";
          }
        }

        // Find owner: prefer role_label matching owner/lead/manager, else first member
        const members = (teamMembers || []).filter((m) => m.project_id === pid);
        let owner: string | null = null;
        const leaderMember = members.find((m) =>
          m.role_label && /owner|lead|manager|pm|director/i.test(m.role_label)
        );
        if (leaderMember) {
          owner = profileMap.get(leaderMember.user_id) || null;
        } else if (members.length > 0) {
          owner = profileMap.get(members[0].user_id) || null;
        }

        result.set(pid, {
          projectId: pid,
          taskTotal: actionable.length,
          taskCompleted: completed.length,
          completionPercent: percent,
          completionBasis: basis,
          ownerName: owner,
        });
      }

      return result;
    },
    enabled: projectIds.length > 0,
  });
}
