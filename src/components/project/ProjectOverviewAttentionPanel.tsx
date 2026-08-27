import { Link } from "react-router-dom";
import { AlertTriangle, ChevronRight, CircleCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ProjectReportingSummary } from "@/lib/reportingSummary";

type Severity = "high" | "medium" | "low";
type Category =
  | "blockers"
  | "schedule"
  | "risks"
  | "baseline"
  | "kpis"
  | "team"
  | "health";

interface AttentionItem {
  key: string;
  category: Category;
  label: string;
  severity: Severity;
  to?: string;
}

interface RiskLike {
  status: string;
  impact: string;
  likelihood?: string;
}
interface BlockerLike {
  status: string;
  severity: string;
}
interface KpiLike { id: string }
interface TeamLike { id: string }

interface Props {
  workspaceId: string;
  projectId: string;
  reportingSummary: ProjectReportingSummary | null;
  reportingLoading: boolean;
  risks: RiskLike[];
  blockers: BlockerLike[];
  kpis: KpiLike[];
  team: TeamLike[];
  loading?: boolean;
}

const sevDot: Record<Severity, string> = {
  high: "bg-destructive",
  medium: "bg-amber-500",
  low: "bg-muted-foreground/60",
};

/**
 * Read-only "Attention needed" panel. Derived entirely from already-loaded
 * Overview data — no new queries, no persisted dashboard state.
 *
 * Dedup rules:
 *  - At most one item per category (blockers, schedule, risks, baseline, kpis, team).
 *  - Reporting reason lines (health/schedule) are only added when they don't
 *    overlap a category already represented by explicit counts.
 *  - Capped at 5 visible items.
 */
export function ProjectOverviewAttentionPanel({
  workspaceId,
  projectId,
  reportingSummary,
  reportingLoading,
  risks,
  blockers,
  kpis,
  team,
  loading,
}: Props) {
  const risksRoute = `/workspace/${workspaceId}/project/${projectId}/risks`;
  const planningRoute = `/workspace/${workspaceId}/project/${projectId}/planning`;
  const kpisRoute = `/workspace/${workspaceId}/project/${projectId}/kpis`;
  const teamRoute = `/workspace/${workspaceId}/project/${projectId}/team`;

  const items: AttentionItem[] = [];
  const categoriesUsed = new Set<Category>();

  const addOnce = (item: AttentionItem) => {
    if (categoriesUsed.has(item.category)) return;
    categoriesUsed.add(item.category);
    items.push(item);
  };

  // 1. Blockers — single item, smarter wording
  const openBlockers = (blockers || []).filter((b) => b.status !== "resolved");
  if (openBlockers.length > 0) {
    const highSev = openBlockers.filter(
      (b) => b.severity === "critical" || b.severity === "high",
    ).length;
    let label: string;
    if (openBlockers.length === 1) {
      label = highSev > 0 ? "1 open high-priority blocker" : "1 open blocker";
    } else if (highSev > 0) {
      label = `${openBlockers.length} open blockers, ${highSev} high-priority`;
    } else {
      label = `${openBlockers.length} open blockers`;
    }
    addOnce({
      key: "blockers",
      category: "blockers",
      label,
      severity: highSev > 0 ? "high" : "medium",
      to: risksRoute,
    });
  }

  // 2. Schedule — collapse overdue + behind into a single combined item
  if (reportingSummary) {
    const overdueTasks = Math.max(
      0,
      (reportingSummary as any).overdue_task_count ?? 0,
    );
    const behindPhases = reportingSummary.behind_phase_count ?? 0;
    const behindTasks = reportingSummary.behind_task_count ?? 0;
    const totalTaskIssues = overdueTasks + behindTasks;

    if (totalTaskIssues > 0 || behindPhases > 0) {
      const parts: string[] = [];
      if (totalTaskIssues > 0) {
        parts.push(
          `${totalTaskIssues} overdue / behind task${totalTaskIssues === 1 ? "" : "s"}`,
        );
      }
      if (behindPhases > 0) {
        parts.push(`${behindPhases} phase${behindPhases === 1 ? "" : "s"} behind`);
      }
      addOnce({
        key: "schedule",
        category: "schedule",
        label: parts.join(" · "),
        severity: "medium",
        to: planningRoute,
      });
    } else if (
      reportingSummary.schedule_signal &&
      reportingSummary.schedule_signal !== "on_track" &&
      reportingSummary.schedule_signal !== "complete" &&
      (reportingSummary.schedule_reason_lines?.length ?? 0) > 0
    ) {
      addOnce({
        key: "schedule",
        category: "schedule",
        label: reportingSummary.schedule_reason_lines[0],
        severity: "medium",
        to: planningRoute,
      });
    }
  }

  // 3. Risks — single high/critical line
  const activeRisks = (risks || []).filter((r) => r.status !== "closed");
  const highRisks = activeRisks.filter(
    (r) => r.impact === "critical" || r.impact === "high",
  );
  if (highRisks.length > 0) {
    addOnce({
      key: "high-risks",
      category: "risks",
      label: `${highRisks.length} active high/critical risk${highRisks.length === 1 ? "" : "s"}`,
      severity: "high",
      to: risksRoute,
    });
  }

  // 4. Baseline — only if no stronger schedule issue is already listed
  if (reportingSummary) {
    if (!reportingSummary.is_baselined) {
      addOnce({
        key: "no-baseline",
        category: "baseline",
        label: "Schedule baseline not approved",
        severity: "low",
        to: planningRoute,
      });
    } else {
      const slip = reportingSummary.baseline_slip_days;
      if (typeof slip === "number" && slip > 0 && !categoriesUsed.has("schedule")) {
        addOnce({
          key: "baseline-slip",
          category: "baseline",
          label: `Target end slipped ${slip} day${slip === 1 ? "" : "s"} vs baseline`,
          severity: "medium",
          to: planningRoute,
        });
      }
    }
  }

  // 5. Health reason lines — only when they add a NEW category-free insight
  if (
    reportingSummary &&
    reportingSummary.health_rag &&
    reportingSummary.health_rag !== "green"
  ) {
    const codes = reportingSummary.health_reason_codes ?? [];
    const lines = reportingSummary.health_reason_lines ?? [];
    // Map each code to a category it would duplicate
    const codeToCategory: Record<string, Category> = {
      open_blockers: "blockers",
      overdue_tasks: "schedule",
      overdue_phases: "schedule",
      project_target_overdue: "schedule",
      baseline_slip: "baseline",
      active_high_risks: "risks",
      realized_risks: "risks",
    };
    for (let i = 0; i < lines.length; i++) {
      const code = codes[i];
      const cat = code ? codeToCategory[code] : undefined;
      if (cat && categoriesUsed.has(cat)) continue;
      // Add as a "health" item; only one allowed.
      if (categoriesUsed.has("health")) continue;
      addOnce({
        key: `health-${i}`,
        category: "health",
        label: lines[i],
        severity: reportingSummary.health_rag === "red" ? "high" : "medium",
        to: planningRoute,
      });
    }
  }

  // 6. No KPIs
  if ((kpis || []).length === 0) {
    addOnce({
      key: "no-kpis",
      category: "kpis",
      label: "No KPIs defined",
      severity: "low",
      to: kpisRoute,
    });
  }

  // 7. No team
  if ((team || []).length === 0) {
    addOnce({
      key: "no-team",
      category: "team",
      label: "No team members assigned",
      severity: "low",
      to: teamRoute,
    });
  }

  const visible = items.slice(0, 5);
  const hidden = Math.max(0, items.length - visible.length);
  const isLoading = loading || reportingLoading;

  // Footer links based on categories actually present
  const footerLinks: { to: string; label: string }[] = [];
  if (
    categoriesUsed.has("risks") ||
    categoriesUsed.has("blockers")
  ) {
    footerLinks.push({ to: risksRoute, label: "Review risks & blockers" });
  }
  if (categoriesUsed.has("schedule") || categoriesUsed.has("baseline")) {
    footerLinks.push({ to: planningRoute, label: "Review work plan" });
  }
  if (categoriesUsed.has("kpis")) {
    footerLinks.push({ to: kpisRoute, label: "Define KPIs" });
  }
  if (categoriesUsed.has("team")) {
    footerLinks.push({ to: teamRoute, label: "Manage team" });
  }

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-foreground">Attention needed</h3>
            {visible.length > 0 ? (
              <Badge variant="secondary" className="text-[10px]">
                {visible.length}
                {hidden > 0 ? `+${hidden}` : ""}
              </Badge>
            ) : null}
          </div>
        </div>
        {isLoading && visible.length === 0 ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheck className="h-4 w-4 text-emerald-500" />
            No immediate attention items.
          </div>
        ) : (
          <>
            <ul className="space-y-1.5">
              {visible.map((it) => {
                const body = (
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`h-2 w-2 rounded-full flex-none ${sevDot[it.severity]}`} />
                    <span className="text-sm text-foreground truncate">{it.label}</span>
                  </div>
                );
                return (
                  <li key={it.key}>
                    {it.to ? (
                      <Link
                        to={it.to}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
                      >
                        {body}
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-none" />
                      </Link>
                    ) : (
                      <div className="px-2 py-1.5">{body}</div>
                    )}
                  </li>
                );
              })}
              {hidden > 0 ? (
                <li className="px-2 pt-1 text-[11px] text-muted-foreground">
                  {hidden} more item{hidden === 1 ? "" : "s"} not shown
                </li>
              ) : null}
            </ul>
            {footerLinks.length > 0 && (
              <div className="mt-3 pt-2 border-t flex flex-wrap gap-x-3 gap-y-1">
                {footerLinks.map((l) => (
                  <Link
                    key={l.to + l.label}
                    to={l.to}
                    className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {l.label} →
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
