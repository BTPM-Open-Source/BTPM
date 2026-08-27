import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * useRisksBlockersOps — operational risks & blockers list.
 *
 * Pulls canonical rows from `blockers` and `risks` scoped by workspace
 * (or across all accessible workspaces) and resolves the parent project
 * for navigation. No new tables, no aggregation, no analytics.
 */

export type RbType = "risk" | "blocker";

export type RbItem = {
  id: string;
  type: RbType;
  title: string;
  status: string;
  severity: string | null; // blocker.severity or risk impact
  targetType: string;
  targetId: string;
  projectId: string | null;
  projectName: string | null;
  workspaceId: string;
  workspaceName: string | null;
  reportedBy: string | null;
  ownerName: string | null;
  updatedAt: string;
  createdAt: string;
  resolvedAt?: string | null;
  portfolioItemId: string | null;
  portfolioName: string | null;
  portfolioCode: string | null;
  portfolioLifecycleState: string | null;
  portfolioIsArchived: boolean | null;
};

type ProjectInfo = {
  id: string;
  name: string | null;
  portfolioItemId: string | null;
  portfolioName: string | null;
  portfolioCode: string | null;
  portfolioLifecycleState: string | null;
  portfolioIsArchived: boolean | null;
};

export type RbScope =
  | { type: "all" }
  | { type: "workspace"; workspaceId: string };

const OPEN_BLOCKER = ["open", "in_progress"] as const;
const OPEN_RISK = ["identified", "analyzing", "mitigating", "monitoring"] as const;

export function useRisksBlockersOps(scope: RbScope) {
  const { user } = useAuth();
  return useQuery<RbItem[]>({
    queryKey: ["rb-ops", user?.id, scope],
    enabled: !!user,
    queryFn: async () => {
      let blockerQ = supabase
        .from("blockers")
        .select(
          "id, title, status, severity, target_type, target_id, workspace_id, reported_by, created_at, updated_at, resolved_at",
        );
      let riskQ = supabase
        .from("risks")
        .select(
          "id, title, status, impact, target_type, target_id, workspace_id, reported_by, created_at, updated_at",
        );
      if (scope.type === "workspace") {
        blockerQ = blockerQ.eq("workspace_id", scope.workspaceId);
        riskQ = riskQ.eq("workspace_id", scope.workspaceId);
      }

      const [{ data: blockers, error: bErr }, { data: risks, error: rErr }] =
        await Promise.all([blockerQ, riskQ]);
      if (bErr) throw bErr;
      if (rErr) throw rErr;

      const allRows = [...(blockers ?? []), ...(risks ?? [])];
      if (allRows.length === 0) return [];

      // Resolve project_id for each item via target lookups.
      const taskIds = new Set<string>();
      const phaseIds = new Set<string>();
      const directProjectIds = new Set<string>();
      for (const r of allRows) {
        if (r.target_type === "task") taskIds.add(r.target_id);
        else if (r.target_type === "phase") phaseIds.add(r.target_id);
        else if (r.target_type === "project") directProjectIds.add(r.target_id);
      }

      const wsIds = Array.from(new Set(allRows.map((r) => r.workspace_id)));

      const [tasksRes, phasesRes, wsRes] = await Promise.all([
        taskIds.size
          ? supabase
              .from("tasks")
              .select("id, project_id")
              .in("id", Array.from(taskIds))
          : Promise.resolve({ data: [] as { id: string; project_id: string }[], error: null }),
        phaseIds.size
          ? supabase
              .from("phases")
              .select("id, project_id")
              .in("id", Array.from(phaseIds))
          : Promise.resolve({ data: [] as { id: string; project_id: string }[], error: null }),
        wsIds.length
          ? supabase.from("workspaces").select("id, name").in("id", wsIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
      ]);

      const tMap = new Map((tasksRes.data ?? []).map((t) => [t.id, t.project_id]));
      const phMap = new Map((phasesRes.data ?? []).map((p) => [p.id, p.project_id]));
      const wsMap = new Map((wsRes.data ?? []).map((w) => [w.id, w.name]));

      const projectIds = new Set<string>(directProjectIds);
      for (const id of tMap.values()) projectIds.add(id);
      for (const id of phMap.values()) projectIds.add(id);

      const projRes = projectIds.size
        ? await supabase.from("projects").select("id, name").in("id", Array.from(projectIds))
        : { data: [] as { id: string; name: string }[], error: null };
      const pMap = new Map((projRes.data ?? []).map((p) => [p.id, p.name]));

      // Enrich each project with Portfolio context via authorized RPC.
      // Per-project failures degrade gracefully so one bad project does
      // not break the whole page.
      const projectInfoMap = new Map<string, ProjectInfo>();
      await Promise.all(
        Array.from(projectIds).map(async (pid) => {
          const fallback: ProjectInfo = {
            id: pid,
            name: pMap.get(pid) ?? null,
            portfolioItemId: null,
            portfolioName: null,
            portfolioCode: null,
            portfolioLifecycleState: null,
            portfolioIsArchived: null,
          };
          try {
            const { data, error } = await supabase.rpc("get_decrypted_project", {
              _project_id: pid,
            });
            if (error || !data) {
              projectInfoMap.set(pid, fallback);
              return;
            }
            const d = data as any;
            projectInfoMap.set(pid, {
              id: pid,
              name: d.name ?? fallback.name,
              portfolioItemId: d.portfolio_item_id ?? null,
              portfolioName: d.portfolio_name ?? null,
              portfolioCode: d.portfolio_code ?? null,
              portfolioLifecycleState: d.portfolio_lifecycle_state ?? null,
              portfolioIsArchived: d.portfolio_is_archived ?? null,
            });
          } catch {
            projectInfoMap.set(pid, fallback);
          }
        }),
      );

      const resolveProjectId = (target_type: string, target_id: string) => {
        if (target_type === "project") return target_id;
        if (target_type === "task") return tMap.get(target_id) ?? null;
        if (target_type === "phase") return phMap.get(target_id) ?? null;
        return null;
      };

      const items: RbItem[] = [];
      for (const b of blockers ?? []) {
        if (!OPEN_BLOCKER.includes(b.status as typeof OPEN_BLOCKER[number])) continue;
        const pid = resolveProjectId(b.target_type, b.target_id);
        const info = pid ? projectInfoMap.get(pid) ?? null : null;
        items.push({
          id: b.id,
          type: "blocker",
          title: b.title,
          status: b.status,
          severity: b.severity,
          targetType: b.target_type,
          targetId: b.target_id,
          projectId: pid,
          projectName: info?.name ?? (pid ? pMap.get(pid) ?? null : null),
          workspaceId: b.workspace_id,
          workspaceName: wsMap.get(b.workspace_id) ?? null,
          reportedBy: b.reported_by,
          ownerName: null,
          updatedAt: b.updated_at,
          createdAt: b.created_at,
          resolvedAt: b.resolved_at,
          portfolioItemId: info?.portfolioItemId ?? null,
          portfolioName: info?.portfolioName ?? null,
          portfolioCode: info?.portfolioCode ?? null,
          portfolioLifecycleState: info?.portfolioLifecycleState ?? null,
          portfolioIsArchived: info?.portfolioIsArchived ?? null,
        });
      }
      for (const r of risks ?? []) {
        if (!OPEN_RISK.includes(r.status as typeof OPEN_RISK[number])) continue;
        const pid = resolveProjectId(r.target_type, r.target_id);
        const info = pid ? projectInfoMap.get(pid) ?? null : null;
        items.push({
          id: r.id,
          type: "risk",
          title: r.title,
          status: r.status,
          severity: r.impact,
          targetType: r.target_type,
          targetId: r.target_id,
          projectId: pid,
          projectName: info?.name ?? (pid ? pMap.get(pid) ?? null : null),
          workspaceId: r.workspace_id,
          workspaceName: wsMap.get(r.workspace_id) ?? null,
          reportedBy: r.reported_by,
          ownerName: null,
          updatedAt: r.updated_at,
          createdAt: r.created_at,
          portfolioItemId: info?.portfolioItemId ?? null,
          portfolioName: info?.portfolioName ?? null,
          portfolioCode: info?.portfolioCode ?? null,
          portfolioLifecycleState: info?.portfolioLifecycleState ?? null,
          portfolioIsArchived: info?.portfolioIsArchived ?? null,
        });
      }
      return items;
    },
  });
}

// --- Bucket helpers ---------------------------------------------------------

const HIGH_PRIORITIES = new Set(["high", "critical", "urgent"]);
const STALE_DAYS = 14;

export type RbBuckets = {
  blockers: RbItem[];
  risks: RbItem[];
  recentlyUpdated: RbItem[];
  needsAttention: RbItem[];
};

export function bucketRb(items: RbItem[]): RbBuckets {
  const now = Date.now();
  const staleCutoff = now - STALE_DAYS * 24 * 60 * 60 * 1000;

  const blockers = items.filter((i) => i.type === "blocker");
  const risks = items.filter((i) => i.type === "risk");

  const byUpdatedDesc = (a: RbItem, b: RbItem) =>
    b.updatedAt.localeCompare(a.updatedAt);

  const recentlyUpdated = [...items].sort(byUpdatedDesc).slice(0, 8);

  const needsAttention = items.filter((i) => {
    const stale = new Date(i.updatedAt).getTime() < staleCutoff;
    const high = i.severity ? HIGH_PRIORITIES.has(i.severity) : false;
    const noOwner = !i.reportedBy;
    return stale || high || noOwner;
  });

  blockers.sort(byUpdatedDesc);
  risks.sort(byUpdatedDesc);
  needsAttention.sort(byUpdatedDesc);

  return { blockers, risks, recentlyUpdated, needsAttention };
}
