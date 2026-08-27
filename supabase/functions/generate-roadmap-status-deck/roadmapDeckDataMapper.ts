// Roadmap Status Deck — server-side data mapper.
// Aggregates canonical BTPM data for the selected Roadmap scope.
// Does NOT introduce a second reporting truth: uses the same
// `list_project_reporting_summaries` RPC the Roadmap UI consumes.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface RoadmapDeckInput {
  workspaceIds: string[];
  programIds?: string[] | null;
  projectIds?: string[] | null;
  calendarMode?: "year" | "month";
  calendarStart?: string | null;
  calendarEnd?: string | null;
  // Phase 6D.7B — canonical Portfolio scope provenance. Never contains "__none__".
  portfolioItemIds?: string[] | null;
  includeNoPortfolio?: boolean;
}

export interface RoadmapDeckProject {
  id: string;
  name: string;
  status: string | null;
  stage: string | null;
  priority: string | null;
  startDate: string | null;
  targetEndDate: string | null;
  workspaceId: string;
  workspaceName: string;
  programId: string | null;
  programName: string | null;
  deliveryModel: string | null;
  // Phase 6D.7B — Portfolio provenance.
  portfolioItemId: string | null;
  portfolioName: string | null;
  portfolioCode: string | null;
  portfolioLifecycleState: string | null;
  portfolioIsArchived: boolean | null;
  // Reporting summary (canonical)
  completionPercent: number | null;
  taskTotal: number | null;
  taskCompleted: number | null;
  healthRag: "green" | "amber" | "red" | null;
  healthLabel: string | null;
  scheduleSignal: string | null;
  scheduleReasonLines: string[];
  healthReasonLines: string[];
  ownerNames: string[];
}

function formatPortfolioLabel(p: RoadmapDeckProject): string | null {
  if (!p.portfolioItemId) return null;
  const name = p.portfolioName || "Unnamed Portfolio";
  const code = p.portfolioCode || null;
  const base = code ? `${code} — ${name}` : name;
  return p.portfolioIsArchived ? `${base} (archived)` : base;
}

export interface RoadmapDeckProgramBucket {
  workspaceId: string;
  workspaceName: string;
  programId: string | null; // null => "No Program / Unassigned"
  programName: string;
  projects: RoadmapDeckProject[];
}

export interface RoadmapDeckData {
  generatedAt: string;
  generatedByLabel: string;
  scope: {
    workspaces: Array<{ id: string; name: string }>;
    programs: Array<{ id: string; name: string }>;
    projectsExplicit: boolean;
    projectCount: number;
    calendarMode: "year" | "month";
    calendarStart: string;
    calendarEnd: string;
    scopeLabel: string;
    // Phase 6D.7B — Portfolio scope provenance derived from final filtered set.
    portfolioFilterExplicit: boolean;
    portfolioItemIds: string[];
    includeNoPortfolio: boolean;
    portfolioCount: number;
    portfolioIds: string[];
    portfolioLabels: string[];
    noPortfolioProjectCount: number;
    portfolioScopeLabel: string;
  };
  portfolio: {
    total: number;
    completed: number;
    inProgress: number;
    upcoming: number;
    atRiskCount: number;
    atRiskPercent: number;
    behindSchedule: number;
    completedPercent: number;
    signals: Array<{ label: string; value: string; tone: "good" | "warn" | "bad" | "info" }>;
  };
  projects: RoadmapDeckProject[];
  needsAttention: RoadmapDeckProject[];
  current: RoadmapDeckProject[];
  upcoming: RoadmapDeckProject[];
  completed: RoadmapDeckProject[];
  programBuckets: RoadmapDeckProgramBucket[];
  warnings: string[];
}

// Roadmap lifecycle grouping — MUST stay in lock-step with
// src/lib/roadmapLifecycle.ts. This is the deno-side mirror of the same
// rules so the Roadmap Status deck groups projects identically to the
// Roadmap Dashboard / Overview. Do not let on_hold or cancelled silently
// fall into "Current" or "Upcoming" — use the helper.
type DeckLifecycleGroup =
  | "current"
  | "upcoming"
  | "completed"
  | "closed_cancelled"
  | "on_hold";

function deckLifecycleGroup(
  p: RoadmapDeckProject,
  asOf: Date = new Date(),
): DeckLifecycleGroup {
  const s = (p.status || "").toLowerCase();
  if (s === "completed") return "completed";
  if (s === "cancelled" || s === "canceled" || s === "closed") return "closed_cancelled";
  if (s === "on_hold") return "on_hold";
  if (s === "active") return "current";
  const plannedLike = !s || s === "planned" || s === "not_started" || s === "upcoming";
  if (plannedLike) {
    const progress = p.completionPercent ?? 0;
    if (progress > 0) return "current";
    if ((p.stage || "").toLowerCase() === "execution") return "current";
    if (p.startDate) {
      const t = new Date(p.startDate).getTime();
      if (!Number.isNaN(t) && t <= asOf.getTime()) return "current";
    }
    return "upcoming";
  }
  return "current";
}

function isCompletedStatus(p: RoadmapDeckProject): boolean {
  const g = deckLifecycleGroup(p);
  return g === "completed" || g === "closed_cancelled";
}
function isBehind(p: RoadmapDeckProject): boolean {
  return p.scheduleSignal === "behind_schedule";
}
function isAtRisk(p: RoadmapDeckProject): boolean {
  return p.healthRag === "amber" || p.healthRag === "red";
}
function isPastTarget(p: RoadmapDeckProject): boolean {
  if (!p.targetEndDate) return false;
  if (isCompletedStatus(p)) return false;
  return new Date(p.targetEndDate).getTime() < Date.now();
}


export async function mapRoadmapDeckData(
  supabase: SupabaseClient,
  callerUserId: string,
  input: RoadmapDeckInput,
  workspaceMeta: Array<{ id: string; name: string; organizationId: string }>,
): Promise<RoadmapDeckData> {
  const warnings: string[] = [];
  const generatedAt = new Date().toISOString();

  // Caller label
  let generatedByLabel = "BTPM";
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, email, organization_id")
      .eq("id", callerUserId).maybeSingle();
    if (profile) {
      const orgId = (profile as any).organization_id ?? workspaceMeta[0]?.organizationId;
      const dn = await decrypt(supabase, (profile as any).display_name, orgId);
      const em = await decrypt(supabase, (profile as any).email, orgId);
      generatedByLabel = (dn && dn.trim()) || em || "BTPM";
    }
  } catch { /* keep default */ }

  // 1. Pull projects per workspace
  const allProjects: RoadmapDeckProject[] = [];
  for (const ws of workspaceMeta) {
    let rows: any[] = [];
    try {
      const { data } = await supabase.rpc("list_workspace_projects", { _workspace_id: ws.id });
      rows = (data as any[]) ?? [];
    } catch {
      warnings.push(`workspace_projects_failed:${ws.id}`);
      continue;
    }
    for (const r of rows) {
      allProjects.push({
        id: r.id,
        name: String(r.name || "").trim() || "(unnamed project)",
        status: r.status ?? null,
        stage: r.project_stage ?? null,
        priority: r.priority ?? null,
        startDate: r.start_date ?? null,
        targetEndDate: r.target_end_date ?? null,
        workspaceId: ws.id,
        workspaceName: ws.name,
        programId: r.program_id ?? null,
        programName: r.program_name ?? null,
        deliveryModel: (r.delivery_model ?? null) as string | null,
        portfolioItemId: (r.portfolio_item_id ?? null) as string | null,
        portfolioName: (r.portfolio_name ?? null) as string | null,
        portfolioCode: (r.portfolio_code ?? null) as string | null,
        portfolioLifecycleState: (r.portfolio_lifecycle_state ?? null) as string | null,
        portfolioIsArchived: (r.portfolio_is_archived ?? null) as boolean | null,
        completionPercent: null,
        taskTotal: null,
        taskCompleted: null,
        healthRag: null,
        healthLabel: null,
        scheduleSignal: null,
        scheduleReasonLines: [],
        healthReasonLines: [],
        ownerNames: [],
      });
    }
  }

  // 2a. Phase 6D.7B — Portfolio filter matrix (applied before program/project).
  // Never trust "__none__" as a Portfolio id here (sanitized in index.ts too).
  const portfolioItemIds = Array.from(new Set(
    (input.portfolioItemIds ?? []).filter(
      (x): x is string => typeof x === "string" && x.length > 0 && x !== "__none__",
    ),
  ));
  const includeNoPortfolio = input.includeNoPortfolio === true;
  const portfolioFilterExplicit = portfolioItemIds.length > 0 || includeNoPortfolio;

  let filtered = allProjects;
  if (portfolioFilterExplicit) {
    const pfSet = new Set(portfolioItemIds);
    filtered = filtered.filter((p) => {
      const assigned = p.portfolioItemId && pfSet.has(p.portfolioItemId);
      const noneMatch = !p.portfolioItemId && includeNoPortfolio;
      return assigned || noneMatch;
    });
  }

  // 2b. Filter by program/project scope
  // NOTE: Roadmap UI uses the sentinel "__none__" to represent
  // "No Program / Unassigned" projects. Honor it here so unassigned
  // projects (e.g. PLAIO) are included when explicitly selected.
  const programFilter = (input.programIds && input.programIds.length > 0)
    ? new Set(input.programIds) : null;
  const includeNoProgram = !!programFilter && programFilter.has("__none__");
  const projectFilter = (input.projectIds && input.projectIds.length > 0)
    ? new Set(input.projectIds) : null;

  if (programFilter) {
    filtered = filtered.filter((p) =>
      (p.programId && programFilter.has(p.programId)) ||
      (!p.programId && includeNoProgram)
    );
  }
  if (projectFilter) {
    const beforeIds = new Set(filtered.map((p) => p.id));
    filtered = filtered.filter((p) => projectFilter.has(p.id));
    if (portfolioFilterExplicit) {
      const pruned = Array.from(projectFilter).filter(
        (id) => !filtered.some((p) => p.id === id) && beforeIds.has(id) === false,
      );
      if (pruned.length > 0) {
        warnings.push(`portfolio_scope_pruned_project_ids:${pruned.slice(0, 8).join(",")}${pruned.length > 8 ? "…" : ""}`);
      }
    }
  }

  // 3. Reporting summaries per workspace
  const byProjectId = new Map<string, any>();
  for (const ws of workspaceMeta) {
    try {
      const { data } = await supabase.rpc("list_project_reporting_summaries", {
        _workspace_id: ws.id,
        _project_ids: null,
        _include_demo: false,
      });
      for (const row of ((data as any[]) ?? [])) byProjectId.set(row.project_id, row);
    } catch { warnings.push(`reporting_summaries_failed:${ws.id}`); }
  }
  for (const p of filtered) {
    const rs = byProjectId.get(p.id);
    if (rs) {
      p.completionPercent = rs.completion_percent ?? null;
      p.taskTotal = rs.task_total_count ?? null;
      p.taskCompleted = rs.task_completed_count ?? null;
      p.healthRag = rs.health_rag ?? null;
      p.healthLabel = rs.health_label ?? null;
      p.scheduleSignal = rs.schedule_signal ?? null;
      p.scheduleReasonLines = rs.schedule_reason_lines ?? [];
      p.healthReasonLines = rs.health_reason_lines ?? [];
    }
  }

  // 4. Categorize via shared lifecycle rules (mirrors src/lib/roadmapLifecycle.ts).
  // - completed deck list includes both `completed` and `closed_cancelled`
  //   (the slide sub-groups them as Completed / Closed / Cancelled).
  // - upcoming strictly means planned-and-not-yet-started.
  // - on_hold projects roll into the "current" deck list rather than being
  //   miscategorised as Upcoming. Deck layout is unchanged.
  const groupByPid = new Map<string, DeckLifecycleGroup>();
  for (const p of filtered) groupByPid.set(p.id, deckLifecycleGroup(p));
  const completedSet = filtered.filter((p) => {
    const g = groupByPid.get(p.id)!;
    return g === "completed" || g === "closed_cancelled";
  });
  const upcoming = filtered.filter((p) => groupByPid.get(p.id) === "upcoming");
  const inProgress = filtered.filter((p) => {
    const g = groupByPid.get(p.id)!;
    return g === "current" || g === "on_hold";
  });
  const atRisk = filtered.filter((p) => !isCompletedStatus(p) && isAtRisk(p));
  const behind = filtered.filter((p) => !isCompletedStatus(p) && isBehind(p));
  const needsAttention = dedupeById([
    ...behind,
    ...atRisk,
    ...filtered.filter(isPastTarget),
  ]);


  const total = filtered.length;
  const atRiskPct = total > 0 ? Math.round((atRisk.length / total) * 100) : 0;
  const completedPct = total > 0 ? Math.round((completedSet.length / total) * 100) : 0;

  const signals: RoadmapDeckData["portfolio"]["signals"] = [];
  signals.push({
    label: "Portfolio size", tone: "info",
    value: `${total} project${total === 1 ? "" : "s"} in scope`,
  });
  signals.push({
    label: "Delivery", tone: completedPct >= 50 ? "good" : "info",
    value: `${completedPct}% completed · ${inProgress.length} in progress · ${upcoming.length} upcoming`,
  });
  if (needsAttention.length > 0) {
    signals.push({
      label: "Attention required", tone: "warn",
      value: `${needsAttention.length} project${needsAttention.length === 1 ? "" : "s"} need management attention`,
    });
  }
  if (behind.length > 0) {
    signals.push({
      label: "Schedule", tone: "bad",
      value: `${behind.length} behind schedule`,
    });
  }
  if (atRisk.length > 0) {
    signals.push({
      label: "Health", tone: "warn",
      value: `${atRiskPct}% at-risk (RAG amber/red)`,
    });
  }

  // 5. Program buckets (selected programs only, or all programs present)
  const bucketKey = (wsId: string, progId: string | null) => `${wsId}::${progId ?? "__none__"}`;
  const bucketsMap = new Map<string, RoadmapDeckProgramBucket>();
  for (const p of filtered) {
    const k = bucketKey(p.workspaceId, p.programId);
    let b = bucketsMap.get(k);
    if (!b) {
      b = {
        workspaceId: p.workspaceId,
        workspaceName: p.workspaceName,
        programId: p.programId,
        programName: p.programName || (p.programId ? "(unnamed program)" : "No Program / Unassigned"),
        projects: [],
      };
      bucketsMap.set(k, b);
    }
    b.projects.push(p);
  }
  const programBuckets = Array.from(bucketsMap.values()).sort((a, b) => {
    if (a.workspaceName !== b.workspaceName) return a.workspaceName.localeCompare(b.workspaceName);
    if (a.programId == null && b.programId != null) return 1;
    if (a.programId != null && b.programId == null) return -1;
    return a.programName.localeCompare(b.programName);
  });

  // 6. Calendar window
  const calMode: "year" | "month" = input.calendarMode === "month" ? "month" : "year";
  const { calStart, calEnd } = computeCalendarWindow(calMode, input.calendarStart, input.calendarEnd);

  // 7. Scope label
  const scopeLabel = makeScopeLabel(workspaceMeta, input, programBuckets);

  // Programs metadata for scope
  const programsForScope = Array.from(
    new Map(
      filtered.filter((p) => p.programId)
        .map((p) => [p.programId!, { id: p.programId!, name: p.programName || "(program)" }]),
    ).values(),
  );


  // Phase 6D.7B — Portfolio scope metadata derived from final filtered set.
  const portfolioIdsSet = new Set<string>();
  const portfolioLabelSet = new Set<string>();
  let noPortfolioProjectCount = 0;
  for (const p of filtered) {
    if (p.portfolioItemId) {
      portfolioIdsSet.add(p.portfolioItemId);
      const l = formatPortfolioLabel(p);
      if (l) portfolioLabelSet.add(l);
    } else {
      noPortfolioProjectCount++;
    }
  }
  const portfolioIds = Array.from(portfolioIdsSet);
  const portfolioLabels = Array.from(portfolioLabelSet);
  const portfolioCount = portfolioIds.length;
  let portfolioScopeLabel: string;
  if (!portfolioFilterExplicit) {
    portfolioScopeLabel = "All Portfolios";
  } else if (portfolioCount === 0 && noPortfolioProjectCount > 0) {
    portfolioScopeLabel = "No Portfolio";
  } else if (portfolioCount === 1 && noPortfolioProjectCount === 0) {
    portfolioScopeLabel = portfolioLabels[0] ?? "1 Portfolio";
  } else if (portfolioCount > 1 && noPortfolioProjectCount === 0) {
    portfolioScopeLabel = `${portfolioCount} Portfolios`;
  } else {
    portfolioScopeLabel = `${portfolioCount} Portfolios + No Portfolio`;
  }

  return {
    generatedAt,
    generatedByLabel,
    scope: {
      workspaces: workspaceMeta.map((w) => ({ id: w.id, name: w.name })),
      programs: programsForScope,
      projectsExplicit: !!projectFilter,
      projectCount: total,
      calendarMode: calMode,
      calendarStart: calStart,
      calendarEnd: calEnd,
      scopeLabel,
      portfolioFilterExplicit,
      portfolioItemIds,
      includeNoPortfolio,
      portfolioCount,
      portfolioIds,
      portfolioLabels,
      noPortfolioProjectCount,
      portfolioScopeLabel,
    },
    portfolio: {
      total,
      completed: completedSet.length,
      inProgress: inProgress.length,
      upcoming: upcoming.length,
      atRiskCount: atRisk.length,
      atRiskPercent: atRiskPct,
      behindSchedule: behind.length,
      completedPercent: completedPct,
      signals: signals.slice(0, 5),
    },
    projects: filtered,
    needsAttention: prioritize(needsAttention).slice(0, 12),
    current: prioritize(inProgress).slice(0, 12),
    upcoming: upcoming.slice(0, 12),
    completed: completedSet,
    programBuckets,
    warnings,
  };
}

function dedupeById<T extends { id: string }>(arr: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) if (!seen.has(x.id)) { seen.add(x.id); out.push(x); }
  return out;
}

function prioritize(arr: RoadmapDeckProject[]): RoadmapDeckProject[] {
  const rank = (p: RoadmapDeckProject): number => {
    if (p.healthRag === "red") return 0;
    if (p.scheduleSignal === "behind_schedule") return 1;
    if (p.healthRag === "amber") return 2;
    if (isPastTarget(p)) return 3;
    return 4;
  };
  return [...arr].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const aEnd = a.targetEndDate ? new Date(a.targetEndDate).getTime() : Number.POSITIVE_INFINITY;
    const bEnd = b.targetEndDate ? new Date(b.targetEndDate).getTime() : Number.POSITIVE_INFINITY;
    return aEnd - bEnd;
  });
}

function computeCalendarWindow(
  mode: "year" | "month",
  start?: string | null,
  end?: string | null,
): { calStart: string; calEnd: string } {
  if (start && end) return { calStart: start.slice(0, 10), calEnd: end.slice(0, 10) };
  const now = new Date();
  if (mode === "month") {
    const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    return { calStart: s.toISOString().slice(0, 10), calEnd: e.toISOString().slice(0, 10) };
  }
  const s = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const e = new Date(Date.UTC(now.getUTCFullYear(), 11, 31));
  return { calStart: s.toISOString().slice(0, 10), calEnd: e.toISOString().slice(0, 10) };
}

function makeScopeLabel(
  ws: Array<{ id: string; name: string }>,
  input: RoadmapDeckInput,
  buckets: RoadmapDeckProgramBucket[],
): string {
  if (ws.length === 1) {
    const wsName = ws[0].name;
    if (input.projectIds && input.projectIds.length === 1) return `${wsName} - ${buckets[0]?.projects[0]?.name ?? "Project"}`;
    if (input.programIds && input.programIds.length === 1) {
      const pName = buckets.find((b) => b.programId === input.programIds![0])?.programName ?? "Program";
      return `${wsName} - ${pName}`;
    }
    return wsName;
  }
  return `${ws.length} workspaces`;
}

async function decrypt(supabase: SupabaseClient, ciphertext: string | null | undefined, orgId: string): Promise<string | null> {
  if (!ciphertext) return null;
  const { data, error } = await supabase.rpc("btpm_decrypt", { _ciphertext: ciphertext, _org_id: orgId });
  if (error) return null;
  const v = (data as unknown as string) ?? null;
  return v && v.length > 0 ? v : null;
}
