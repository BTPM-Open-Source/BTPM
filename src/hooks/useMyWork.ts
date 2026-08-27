import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * useMyWork — operational items assigned to the current user.
 *
 * Pulls only canonical task data (tasks + task_assignments + projects)
 * scoped to either a single workspace or all accessible workspaces.
 * No new tables, no aggregation, no analytics.
 */

export type MyWorkItem = {
  taskId: string;
  title: string;
  status: string;
  dueDate: string | null;
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string | null;
  hasOpenBlocker: boolean;
  lastActivityAt: string; // tasks.updated_at as a lightweight proxy
};

export type MyWorkScope =
  | { type: "all" }
  | { type: "workspace"; workspaceId: string };

const OPEN_STATUSES = ["active", "planned", "on_hold"] as const satisfies readonly ("active" | "cancelled" | "completed" | "on_hold" | "planned")[];

export function useMyWork(scope: MyWorkScope) {
  const { user } = useAuth();
  return useQuery<MyWorkItem[]>({
    queryKey: ["my-work", user?.id, scope],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [];

      // 1. Assignments for this user
      let assignQ = supabase
        .from("task_assignments")
        .select("task_id, workspace_id")
        .eq("assignee_id", user.id);
      if (scope.type === "workspace") {
        assignQ = assignQ.eq("workspace_id", scope.workspaceId);
      }
      const { data: assigns, error: aErr } = await assignQ;
      if (aErr) throw aErr;
      const taskIds = Array.from(new Set((assigns ?? []).map((a) => a.task_id)));
      if (taskIds.length === 0) return [];

      // 2. Tasks (open only)
      const { data: tasks, error: tErr } = await supabase
        .from("tasks")
        .select(
          "id, name, status, due_date, project_id, workspace_id, updated_at",
        )
        .in("id", taskIds)
        .in("status", OPEN_STATUSES)
        .eq("is_archived", false);
      if (tErr) throw tErr;
      const openTasks = tasks ?? [];
      if (openTasks.length === 0) return [];

      const projectIds = Array.from(new Set(openTasks.map((t) => t.project_id)));
      const wsIds = Array.from(new Set(openTasks.map((t) => t.workspace_id)));

      // 3. Project + workspace lookups
      const [{ data: projects }, { data: workspaces }, { data: blockers }] =
        await Promise.all([
          supabase.from("projects").select("id, name").in("id", projectIds),
          supabase.from("workspaces").select("id, name").in("id", wsIds),
          supabase
            .from("blockers")
            .select("target_id, status")
            .eq("target_type", "task")
            .in("target_id", openTasks.map((t) => t.id))
            .neq("status", "resolved"),
        ]);

      const pMap = new Map((projects ?? []).map((p) => [p.id, p.name]));
      const wMap = new Map((workspaces ?? []).map((w) => [w.id, w.name]));
      const blockedSet = new Set((blockers ?? []).map((b) => b.target_id));

      return openTasks.map<MyWorkItem>((t) => ({
        taskId: t.id,
        title: t.name,
        status: t.status as string,
        dueDate: t.due_date,
        projectId: t.project_id,
        projectName: pMap.get(t.project_id) ?? "Project",
        workspaceId: t.workspace_id,
        workspaceName: wMap.get(t.workspace_id) ?? null,
        hasOpenBlocker: blockedSet.has(t.id),
        lastActivityAt: t.updated_at,
      }));
    },
  });
}

// --- Bucket helpers ---------------------------------------------------------

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const NEEDS_UPDATE_DAYS = 7;
const UPCOMING_DAYS = 7;

export type MyWorkBuckets = {
  dueToday: MyWorkItem[];
  overdue: MyWorkItem[];
  upcoming: MyWorkItem[];
  needsUpdate: MyWorkItem[];
  blocked: MyWorkItem[];
};

export function bucketMyWork(items: MyWorkItem[]): MyWorkBuckets {
  const today = startOfDay(new Date());
  const upcomingLimit = new Date(today);
  upcomingLimit.setDate(today.getDate() + UPCOMING_DAYS);
  const staleThreshold = new Date(today);
  staleThreshold.setDate(today.getDate() - NEEDS_UPDATE_DAYS);

  const dueToday: MyWorkItem[] = [];
  const overdue: MyWorkItem[] = [];
  const upcoming: MyWorkItem[] = [];
  const needsUpdate: MyWorkItem[] = [];
  const blocked: MyWorkItem[] = [];

  for (const it of items) {
    if (it.hasOpenBlocker || it.status === "on_hold") blocked.push(it);
    if (new Date(it.lastActivityAt) < staleThreshold) needsUpdate.push(it);
    if (!it.dueDate) continue;
    const d = startOfDay(new Date(it.dueDate));
    if (d.getTime() === today.getTime()) dueToday.push(it);
    else if (d < today) overdue.push(it);
    else if (d <= upcomingLimit) upcoming.push(it);
  }

  const sortByDate = (a: MyWorkItem, b: MyWorkItem) =>
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999");
  dueToday.sort(sortByDate);
  overdue.sort(sortByDate);
  upcoming.sort(sortByDate);

  return { dueToday, overdue, upcoming, needsUpdate, blocked };
}
