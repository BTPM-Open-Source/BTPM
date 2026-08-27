/**
 * Phase 4D Step 4D.2 — Team Work derived-data contract (frontend hook).
 *
 * Thin React Query wrapper around the protected RPC
 * `public.get_team_work_overview`. The RPC derives results from canonical
 * project/phase/task/assignment/blocker data on every call — there is no
 * persistent rollup. Authorization (active user, workspace membership,
 * per-project access) is enforced server-side; this hook never bypasses RLS.
 *
 * No UI consumes this hook yet (Step 4D.3 introduces the Team Work page).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type TeamWorkTimeWindow =
  | "today"
  | "this_week"
  | "next_2_weeks"
  | "next_30_days"
  | "all_open";

/**
 * TAE.9A/9B — compact stakeholder reference returned by
 * `get_team_work_overview` for Requester/Executors display. Fields match the
 * protected read payload exactly; no email, user_id or scope IDs are exposed.
 */
export interface TeamWorkStakeholderRef {
  id: string;
  display_name: string;
  stakeholder_type: string | null;
  role_label: string | null;
  is_removed: boolean | null;
}

export type TeamWorkReasonFlag =
  | "overdue"
  | "due_today"
  | "blocked"
  | "unassigned"
  | "high_priority"
  | "unestimated";

export interface TeamWorkItem {
  task_id: string;
  task_name: string | null;
  task_status: string;
  task_priority: string | null;
  task_type: string | null;
  start_date: string | null;
  due_date: string | null;
  estimated_hours: number | null;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  phase_id: string | null;
  phase_name: string | null;
  project_id: string;
  project_name: string | null;
  program_id: string | null;
  program_name: string | null;
  workspace_id: string;
  workspace_name: string | null;
  portfolio_item_id: string | null;
  portfolio_name: string | null;
  portfolio_code: string | null;
  portfolio_lifecycle_state: string | null;
  portfolio_is_archived: boolean | null;
  is_overdue: boolean;
  is_due_today: boolean;
  is_upcoming: boolean;
  is_blocked: boolean;
  is_unassigned: boolean;
  is_high_priority: boolean;
  is_unestimated: boolean;
  days_overdue: number;
  days_until_due: number | null;
  open_blocker_count: number;
  last_execution_update_at: string | null;
  is_stale: boolean;
  reason_flags: TeamWorkReasonFlag[];
  requested_by_stakeholder: TeamWorkStakeholderRef | null;
  executed_by_stakeholders: TeamWorkStakeholderRef[];
}


export interface TeamWorkSummary {
  total_open: number;
  due_today: number;
  overdue: number;
  upcoming: number;
  blocked: number;
  unassigned: number;
  high_priority_open: number;
  unestimated: number;
  completed_in_window: number;
  estimated_open_hours: number;
}

export interface TeamWorkByPerson {
  assignee_id: string | null;
  assignee_name: string | null;
  open_tasks: number;
  overdue_tasks: number;
  due_this_week: number;
  blocked_tasks: number;
  estimated_open_hours: number;
  unestimated_tasks: number;
}

export interface TeamWorkByProject {
  project_id: string;
  project_name: string | null;
  workspace_id: string;
  workspace_name: string | null;
  portfolio_item_id: string | null;
  portfolio_name: string | null;
  portfolio_code: string | null;
  portfolio_lifecycle_state: string | null;
  portfolio_is_archived: boolean | null;
  open_tasks: number;
  overdue_tasks: number;
  due_this_week: number;
  blocked_tasks: number;
  high_priority_open: number;
  unassigned_tasks: number;
  estimated_open_hours: number;
}

export interface TeamWorkOverview {
  time_window: TeamWorkTimeWindow;
  as_of: string;
  items: TeamWorkItem[];
  summary: TeamWorkSummary;
  by_person: TeamWorkByPerson[];
  by_project: TeamWorkByProject[];
}

export interface TeamWorkOverviewParams {
  workspaceId?: string | null;
  /** Optional subset of authorized workspaces. Overrides workspaceId when non-empty. */
  workspaceIds?: string[] | null;
  programId?: string | null;
  projectId?: string | null;
  assigneeId?: string | null;
  timeWindow?: TeamWorkTimeWindow;
  includeCompleted?: boolean;
  /**
   * Optional Portfolio filter (real Portfolio UUIDs only). Null/empty = all Portfolios.
   * No sentinel strings are accepted. Currently the Team Work UI performs Portfolio
   * filtering client-side to keep option lists stable; this parameter is kept for
   * future server-side optimization.
   */
  portfolioItemIds?: string[] | null;
  /** Allow callers to gate fetching (Team Work UI is not exposed in 4D.2). */
  enabled?: boolean;
}


export function useTeamWorkOverview(params: TeamWorkOverviewParams = {}) {
  const { user } = useAuth();
  const {
    workspaceId = null,
    workspaceIds = null,
    programId = null,
    projectId = null,
    assigneeId = null,
    timeWindow = "this_week",
    includeCompleted = false,
    portfolioItemIds = null,
    enabled = true,
  } = params;

  // Stable key for the array so React Query cache keys behave.
  const normalizedIds =
    workspaceIds && workspaceIds.length > 0
      ? [...workspaceIds].sort()
      : null;
  const normalizedPortfolioIds =
    portfolioItemIds && portfolioItemIds.length > 0
      ? [...portfolioItemIds].sort()
      : null;

  return useQuery<TeamWorkOverview>({
    queryKey: [
      "team-work-overview",
      user?.id,
      {
        workspaceId,
        workspaceIds: normalizedIds,
        programId,
        projectId,
        assigneeId,
        timeWindow,
        includeCompleted,
        portfolioItemIds: normalizedPortfolioIds,
      },
    ],
    enabled: !!user && enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_team_work_overview", {
        _workspace_id: normalizedIds ? null : workspaceId,
        _workspace_ids: normalizedIds,
        _program_id: programId,
        _project_id: projectId,
        _assignee_id: assigneeId,
        _time_window: timeWindow,
        _include_completed: includeCompleted,
        _portfolio_item_ids: normalizedPortfolioIds,
      });
      if (error) throw error;

      return (data ?? {
        time_window: timeWindow,
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
  });
}
