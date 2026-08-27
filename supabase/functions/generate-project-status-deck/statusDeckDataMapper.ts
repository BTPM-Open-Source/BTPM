// PPT v2 — Weekly Project Status Deck data mapper.
//
// Pulls canonical BTPM data via decryption-aware RPCs. KPI values come from
// OFFICIAL kpi_snapshots (not kpi_definitions.current_value). Progress is
// aggregated from project/phase/task execution updates, KPI snapshots,
// blocker/risk lifecycle changes, and material task status-change activity
// events captured during the reporting period.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface KpiSnapshotView {
  snapshotId: string;
  snapshotDate: string; // ISO date
  periodStart: string | null;
  periodEnd: string | null;
  valueType: string | null;
  valueAmount: number | null;
  stringValue: string | null;
  comment: string | null;
  sourceMode: string | null;
  calculationStatus: string | null;
}

export interface KpiView {
  id: string;
  name: string;
  unit: string | null;
  targetValue: number | null;
  targetDirection: string | null; // increase|decrease|maintain|target_exact
  sourceMode: string | null;
  cadence: string | null;
  latestSnapshot: KpiSnapshotView | null;
  inPeriodSnapshot: KpiSnapshotView | null;
  status: "up_to_date" | "due" | "no_snapshot" | "manual_only" | "not_reportable";
  targetComparison: "on_target" | "below_target" | "above_target" | "no_target";
}

export interface ProgressEvent {
  date: string; // ISO date
  category: "completed" | "kpi_snapshot" | "risk_blocker" | "other_update";
  kind: string; // task_completed | phase_completed | kpi_snapshot | risk_opened | risk_updated | blocker_opened | blocker_resolved | execution_update_(project|phase|task)
  title: string;
  detail?: string | null;
  badge?: string | null; // severity/status badge for table rendering
}

export interface StatusDeckData {
  generatedAt: string;
  generatedByLabel: string;
  organizationName: string | null;
  period: { start: string; end: string };
  project: {
    id: string;
    name: string;
    workspaceName: string | null;
    programName: string | null;
    statusLabel: string | null;
    stageLabel: string | null;
    startDate: string | null;
    targetEndDate: string | null;
    pmNames: string[];
    sponsorNames: string[];
    // Phase 6D.7C — Portfolio context (org-level classification).
    // Sourced from get_decrypted_project; never read portfolio_items directly.
    portfolioItemId: string | null;
    portfolioName: string | null;
    portfolioCode: string | null;
    portfolioLifecycleState: string | null;
    portfolioIsArchived: boolean | null;
    portfolioLabel: string | null;
  };
  reporting: {
    completionPercent: number | null;
    taskTotal: number | null;
    taskCompleted: number | null;
    statusCounts: Record<string, number>;
    scheduleSignal: string | null;
    scheduleReasonLines: string[];
    healthRag: string | null;
    healthLabel: string | null;
    healthReasonLines: string[];
    baselineSlipDays: number | null;
  } | null;
  timeline: Array<{
    kind: "phase" | "task";
    name: string;
    start: string | null;
    end: string | null;
    status: string | null;
  }>;
  progress: {
    events: ProgressEvent[];
    counts: {
      completed: number;
      kpi_snapshot: number;
      risk_blocker: number;
      other_update: number;
    };
  };
  blockers: {
    open: Array<{ title: string; severity: string | null; status: string | null }>;
    createdInPeriod: number;
    resolvedInPeriod: number;
  };
  risks: {
    highImpactOpen: Array<{
      title: string;
      likelihood: string | null;
      impact: string | null;
      status: string | null;
    }>;
    createdInPeriod: number;
    updatedInPeriod: number;
  };
  kpis: KpiView[];
  consistency: {
    allTasksCompleteButStatusActive: boolean;
  };
  periodDigest: PeriodDigest;
  warnings: string[];
}

// ---- Period digest (Project Status Deck v4) -----------------------------
// Derived at generation time from canonical sources (activity_events,
// governance_records, governance_record_decisions, risks, blockers, KPI
// snapshots, execution_updates). No new reporting table is introduced.

export interface PeriodDigestItem {
  date: string | null;
  kind: string;
  title: string;
  detail?: string | null;
  badge?: string | null;
}

export interface PeriodDecisionItem {
  date: string | null;        // governance record actual_date_held
  recordTitle: string;        // governance record event_name
  decisionText: string;       // decrypted
  targetDate?: string | null;
}

export interface PeriodAttentionItem {
  kind: "risk" | "blocker";
  title: string;
  severity: string | null;    // impact (risk) or severity (blocker)
  status: string | null;
  detail?: string | null;
}

export interface PeriodGovernanceEvidence {
  date: string | null;        // actual_date_held
  eventType: string | null;
  eventName: string;
  decisionCount: number;
  hasSharepointEvidence: boolean;
}

export interface PeriodDigest {
  completedDelivered: PeriodDigestItem[];
  materialChanges: PeriodDigestItem[];
  governanceEvidence: PeriodGovernanceEvidence[];
  decisions: PeriodDecisionItem[];
  sponsorAttention: PeriodAttentionItem[];
  kpiSnapshots: PeriodDigestItem[];
  riskBlockerMovements: PeriodDigestItem[];
  counts: {
    completedDelivered: number;
    materialChanges: number;
    governanceRecords: number;
    decisions: number;
    sponsorAttention: number;
    kpiSnapshots: number;
    riskBlockerMovements: number;
  };
}

export interface MapResult {
  data: StatusDeckData;
  workspaceId: string;
  organizationId: string;
}

function pickName(p: { display_name?: string | null; email?: string | null } | null | undefined): string | null {
  if (!p) return null;
  return (p.display_name && p.display_name.trim()) || p.email || null;
}

// Phase 6D.7C — Portfolio label helper. Uses Portfolio fields already
// returned by get_decrypted_project; no direct portfolio_items read.
function formatPortfolioLabelFromProject(project: any): string | null {
  const id = project?.portfolio_item_id ?? null;
  if (!id) return null;
  const name = project?.portfolio_name || "Unnamed Portfolio";
  const code = project?.portfolio_code || null;
  const base = code ? `${code} — ${name}` : name;
  return project?.portfolio_is_archived ? `${base} (archived)` : base;
}

async function decrypt(
  supabase: SupabaseClient,
  ciphertext: string | null | undefined,
  orgId: string,
): Promise<string | null> {
  if (!ciphertext) return null;
  const { data, error } = await supabase.rpc("btpm_decrypt", {
    _ciphertext: ciphertext,
    _org_id: orgId,
  });
  if (error) return null;
  const v = (data as unknown as string) ?? null;
  return v && v.length > 0 ? v : null;
}

function inRange(iso: string | null | undefined, startIso: string, endIso: string): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= new Date(startIso).getTime() && t < new Date(endIso).getTime();
}

function onOrBefore(iso: string | null | undefined, endIso: string): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < new Date(endIso).getTime();
}

function computeKpiStatus(
  k: { sourceMode: string | null; cadence: string | null },
  latest: KpiSnapshotView | null,
  inPeriod: KpiSnapshotView | null,
): KpiView["status"] {
  const cadence = (k.cadence || "manual_only").toLowerCase();
  if (!latest) {
    if (cadence === "manual_only") return "manual_only";
    return "no_snapshot";
  }
  if (inPeriod) return "up_to_date";
  if (cadence === "manual_only") return "manual_only";
  return "due";
}

function computeTargetComparison(
  targetValue: number | null,
  direction: string | null,
  snapshot: KpiSnapshotView | null,
): KpiView["targetComparison"] {
  if (targetValue == null || !snapshot || snapshot.valueAmount == null) return "no_target";
  const v = snapshot.valueAmount;
  switch ((direction || "").toLowerCase()) {
    case "increase":
      return v >= targetValue ? "on_target" : "below_target";
    case "decrease":
      return v <= targetValue ? "on_target" : "above_target";
    case "maintain":
    case "target_exact":
      return v === targetValue ? "on_target" : (v > targetValue ? "above_target" : "below_target");
    default:
      return "no_target";
  }
}

function toSnapshotView(row: any): KpiSnapshotView {
  return {
    snapshotId: row.id,
    snapshotDate: row.snapshot_date,
    periodStart: row.period_start ?? null,
    periodEnd: row.period_end ?? null,
    valueType: row.value_type ?? null,
    valueAmount: row.value_amount != null ? Number(row.value_amount) : null,
    stringValue: row.string_value ?? null,
    comment: row.comment ?? null,
    sourceMode: row.source_mode ?? null,
    calculationStatus: row.calculation_status ?? null,
  };
}

export async function mapProjectToStatusDeckData(
  supabase: SupabaseClient,
  projectId: string,
  callerUserId: string,
  periodStart: string,
  periodEndExclusiveIso: string,
  periodEndDate: string,
): Promise<MapResult> {
  const warnings: string[] = [];
  const generatedAt = new Date().toISOString();

  // Project
  const { data: projectJson, error: pErr } = await supabase.rpc("get_decrypted_project", {
    _project_id: projectId,
  });
  if (pErr || !projectJson) throw new Error("Project not accessible");
  const project = projectJson as any;
  const orgId: string = project.organization_id;
  const workspaceId: string = project.workspace_id;
  const projectName: string =
    (await decrypt(supabase, project.name, orgId)) || (project.name as string);

  // Workspace / org / program
  const { data: wsJson } = await supabase.rpc("get_decrypted_workspace", {
    _workspace_id: workspaceId,
  });
  const workspaceName: string | null = (wsJson as any)?.name ?? null;

  let organizationName: string | null = null;
  {
    const { data: orgRow } = await supabase
      .from("organizations").select("name").eq("id", orgId).maybeSingle();
    organizationName = await decrypt(supabase, (orgRow as any)?.name ?? null, orgId);
  }
  let programName: string | null = null;
  if (project.program_id) {
    const { data: prog } = await supabase
      .from("programs").select("name").eq("id", project.program_id).maybeSingle();
    programName = await decrypt(supabase, (prog as any)?.name ?? null, orgId);
  }

  // Caller label
  let generatedByLabel = "BTPM";
  {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, email, organization_id")
      .eq("id", callerUserId).maybeSingle();
    if (profile) {
      const pOrg = (profile as any).organization_id ?? orgId;
      const dn = await decrypt(supabase, (profile as any).display_name, pOrg);
      const em = await decrypt(supabase, (profile as any).email, pOrg);
      generatedByLabel = pickName({ display_name: dn, email: em }) || "BTPM";
    }
  }

  // Team
  const { data: teamJson } = await supabase.rpc("list_decrypted_project_team", {
    _project_id: projectId,
  });
  const teamRows: any[] = (teamJson as any) ?? [];
  const pmNames = uniqueNames(teamRows.filter((t) => t.canonical_role_key === "project_manager"));
  const sponsorNames = uniqueNames(teamRows.filter((t) => t.canonical_role_key === "project_sponsor"));

  // Reporting summary
  let reporting: StatusDeckData["reporting"] = null;
  try {
    const { data: rs } = await supabase.rpc("list_project_reporting_summaries", {
      _workspace_id: workspaceId,
      _project_ids: [projectId],
      _include_demo: true,
    });
    const row = Array.isArray(rs) && rs.length > 0 ? (rs[0] as any) : null;
    if (row) {
      reporting = {
        completionPercent: row.completion_percent ?? null,
        taskTotal: row.task_total_count ?? null,
        taskCompleted: row.task_completed_count ?? null,
        statusCounts: row.status_counts ?? {},
        scheduleSignal: row.schedule_signal ?? null,
        scheduleReasonLines: row.schedule_reason_lines ?? [],
        healthRag: row.health_rag ?? null,
        healthLabel: row.health_label ?? null,
        healthReasonLines: row.health_reason_lines ?? [],
        baselineSlipDays: row.baseline_slip_days ?? null,
      };
    } else {
      warnings.push("reporting_summary_unavailable");
    }
  } catch { warnings.push("reporting_summary_failed"); }

  // Phases / Tasks
  const { data: phasesJson } = await supabase.rpc("list_decrypted_project_phases", { _project_id: projectId });
  const phases: any[] = (phasesJson as any) ?? [];
  const { data: tasksJson } = await supabase.rpc("list_decrypted_project_tasks", { _project_id: projectId });
  const tasks: any[] = (tasksJson as any) ?? [];

  // Timeline — prefer phases; include only milestone/deliverable tasks
  const timeline: StatusDeckData["timeline"] = [];
  for (const ph of phases.filter((p) => !p.is_archived).sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  )) {
    timeline.push({
      kind: "phase",
      name: String(ph.name || "").trim() || "(unnamed phase)",
      start: (ph.target_start_date as string | null) ?? (ph.start_date as string | null) ?? null,
      end: (ph.target_end_date as string | null) ?? null,
      status: (ph.status as string | null) ?? null,
    });
  }
  const milestoneTasks = tasks.filter((t) =>
    !t.is_archived && (t.task_type === "deliverable" || t.task_type === "milestone"),
  );
  // Only include milestone/deliverable tasks; keep limit so timeline stays readable
  const TIMELINE_TASK_LIMIT = 8;
  if (milestoneTasks.length > TIMELINE_TASK_LIMIT) warnings.push("timeline_tasks_summarized");
  for (const t of milestoneTasks.slice(0, TIMELINE_TASK_LIMIT)) {
    timeline.push({
      kind: "task",
      name: String(t.name || "").trim() || "(unnamed task)",
      start: (t.start_date as string | null) ?? null,
      end: (t.due_date as string | null) ?? (t.target_end_date as string | null) ?? null,
      status: (t.status as string | null) ?? null,
    });
  }

  // ---- Period progress aggregation -------------------------------------
  const progressEvents: ProgressEvent[] = [];

  // Project-level execution updates
  await collectExecutionUpdates(supabase, "project", projectId, "(project)", periodStart, periodEndExclusiveIso, progressEvents, warnings);
  // Phase-level execution updates
  for (const ph of phases.filter((p) => !p.is_archived)) {
    const phName = String(ph.name || "").trim() || "(phase)";
    await collectExecutionUpdates(supabase, "phase", ph.id, phName, periodStart, periodEndExclusiveIso, progressEvents, warnings);
  }
  // Task-level execution updates — only for tasks updated within or near the period
  const taskCandidates = tasks
    .filter((t) => !t.is_archived)
    .filter((t) => {
      const u = t.updated_at as string | null;
      if (!u) return false;
      // include if updated_at within +/- 7 days of the period to be safe
      const t0 = new Date(periodStart).getTime() - 7 * 86_400_000;
      const t1 = new Date(periodEndExclusiveIso).getTime() + 7 * 86_400_000;
      const tt = new Date(u).getTime();
      return tt >= t0 && tt <= t1;
    })
    .slice(0, 40);
  for (const t of taskCandidates) {
    const nm = String(t.name || "").trim() || "(task)";
    await collectExecutionUpdates(supabase, "task", t.id, nm, periodStart, periodEndExclusiveIso, progressEvents, warnings);
  }

  // KPI snapshots
  let kpiDefs: any[] = [];
  try {
    const { data: kpiJson } = await supabase.rpc("list_decrypted_kpi_definitions", { _project_id: projectId });
    const rows: any[] = (kpiJson as any) ?? [];
    kpiDefs = rows.filter((k) => !k.is_archived && k.target_type === "project" && k.target_id === projectId);
  } catch { warnings.push("kpis_failed"); }

  const kpiList: KpiView[] = [];
  let allSnapshots: any[] = [];
  try {
    const { data: snapAll } = await supabase.rpc("list_decrypted_kpi_snapshots", { _project_id: projectId });
    allSnapshots = (snapAll as any) ?? [];
  } catch { warnings.push("kpi_snapshots_failed"); }

  for (const k of kpiDefs) {
    const own = allSnapshots
      .filter((s) => s.kpi_definition_id === k.id)
      .map(toSnapshotView)
      .sort((a, b) => (a.snapshotDate < b.snapshotDate ? 1 : -1));
    const latest = own.find((s) => onOrBefore(s.snapshotDate, periodEndExclusiveIso)) ?? null;
    const inPeriod = own.find((s) => inRange(s.snapshotDate, periodStart, periodEndExclusiveIso)) ?? null;
    const status = computeKpiStatus({ sourceMode: k.source_mode ?? null, cadence: k.cadence ?? null }, latest, inPeriod);
    const targetComparison = computeTargetComparison(
      k.target_value != null ? Number(k.target_value) : null, k.target_direction ?? null, latest,
    );
    kpiList.push({
      id: k.id,
      name: String(k.name || "").trim() || "(unnamed KPI)",
      unit: (k.unit as string | null) ?? null,
      targetValue: k.target_value != null ? Number(k.target_value) : null,
      targetDirection: (k.target_direction as string | null) ?? null,
      sourceMode: (k.source_mode as string | null) ?? null,
      cadence: (k.cadence as string | null) ?? null,
      latestSnapshot: latest,
      inPeriodSnapshot: inPeriod,
      status,
      targetComparison,
    });
    if (inPeriod) {
      progressEvents.push({
        date: inPeriod.snapshotDate,
        category: "kpi_snapshot",
        kind: "kpi_snapshot",
        title: `KPI snapshot · ${k.name}`,
        detail: kpiValueLabel(inPeriod, k.unit) +
          (inPeriod.comment ? ` — ${inPeriod.comment}` : ""),
      });
    }
  }
  if (kpiDefs.length > 0 && allSnapshots.length === 0) {
    warnings.push("kpis_have_no_snapshots");
  }

  // Blockers
  const { data: blockersJson } = await supabase.rpc("list_project_all_blockers", { _project_id: projectId });
  const allBlockers: any[] = (blockersJson as any) ?? [];
  const openBlockers = allBlockers
    .filter((b) => b.status === "open" || b.status === "in_progress")
    .map((b) => ({
      title: String(b.title || "").trim() || "(untitled blocker)",
      severity: (b.severity as string | null) ?? null,
      status: (b.status as string | null) ?? null,
    }));
  let blockerCreatedInPeriod = 0;
  let blockerResolvedInPeriod = 0;
  for (const b of allBlockers) {
    const created = inRange(b.created_at, periodStart, periodEndExclusiveIso);
    const resolved = b.resolved_at && inRange(b.resolved_at, periodStart, periodEndExclusiveIso);
    if (created) {
      blockerCreatedInPeriod++;
      progressEvents.push({
        date: b.created_at,
        category: "risk_blocker",
        kind: "blocker_opened",
        title: `Blocker opened · ${String(b.title || "").trim() || "(untitled)"}`,
        badge: (b.severity || "").toUpperCase() || null,
      });
    }
    if (resolved) {
      blockerResolvedInPeriod++;
      progressEvents.push({
        date: b.resolved_at,
        category: "risk_blocker",
        kind: "blocker_resolved",
        title: `Blocker resolved · ${String(b.title || "").trim() || "(untitled)"}`,
      });
    }
  }

  // Risks
  const { data: risksJson } = await supabase.rpc("list_project_all_risks", { _project_id: projectId });
  const allRisks: any[] = (risksJson as any) ?? [];
  const HIGH = new Set(["high", "critical"]);
  const ACTIVE = new Set(["open", "identified", "under_mitigation", "mitigating"]);
  const highImpactOpen = allRisks
    .filter((r) => ACTIVE.has(r.status) && HIGH.has(r.impact))
    .map((r) => ({
      title: String(r.title || "").trim() || "(untitled risk)",
      likelihood: (r.likelihood as string | null) ?? null,
      impact: (r.impact as string | null) ?? null,
      status: (r.status as string | null) ?? null,
    }));
  let riskCreatedInPeriod = 0, riskUpdatedInPeriod = 0;
  for (const r of allRisks) {
    const created = inRange(r.created_at, periodStart, periodEndExclusiveIso);
    const updated = inRange(r.updated_at, periodStart, periodEndExclusiveIso) && !created;
    if (created) {
      riskCreatedInPeriod++;
      progressEvents.push({
        date: r.created_at, category: "risk_blocker", kind: "risk_opened",
        title: `Risk opened · ${String(r.title || "").trim() || "(untitled)"}`,
        badge: (r.impact || "").toUpperCase() || null,
      });
    } else if (updated) {
      riskUpdatedInPeriod++;
      progressEvents.push({
        date: r.updated_at, category: "risk_blocker", kind: "risk_updated",
        title: `Risk updated · ${String(r.title || "").trim() || "(untitled)"}`,
      });
    }
  }

  // Completed-in-period via activity_events (task/phase status_changed → completed)
  const targetIds = [
    projectId,
    ...phases.map((p) => p.id),
    ...tasks.map((t) => t.id),
  ];
  let completionDerivable = false;
  if (targetIds.length > 0) {
    const { data: events, error: aeErr } = await supabase
      .from("activity_events")
      .select("target_type, target_id, event_type, metadata, created_at")
      .in("target_id", targetIds.slice(0, 500))
      .in("event_type", ["status_changed", "phase_auto_completed"])
      .gte("created_at", periodStart)
      .lt("created_at", periodEndExclusiveIso)
      .order("created_at", { ascending: false })
      .limit(200);
    if (!aeErr && Array.isArray(events)) {
      completionDerivable = true;
      const tasksById = new Map(tasks.map((t) => [t.id, t]));
      const phasesById = new Map(phases.map((p) => [p.id, p]));
      for (const ev of events) {
        let isCompleted = ev.event_type === "phase_auto_completed";
        if (ev.event_type === "status_changed") {
          let md: any = ev.metadata;
          if (typeof md === "string") { try { md = JSON.parse(md); } catch { md = {}; } }
          const ns = (md?.new_status || md?.to || md?.status || "").toString().toLowerCase();
          if (ns === "completed" || ns === "done") isCompleted = true;
        }
        if (!isCompleted) continue;
        let name = "(item)";
        if (ev.target_type === "task") name = String(tasksById.get(ev.target_id)?.name || "").trim() || "(task)";
        else if (ev.target_type === "phase") name = String(phasesById.get(ev.target_id)?.name || "").trim() || "(phase)";
        else if (ev.target_type === "project") name = projectName;
        progressEvents.push({
          date: ev.created_at,
          category: "completed",
          kind: `${ev.target_type}_completed`,
          title: `${ev.target_type === "task" ? "Task" : ev.target_type === "phase" ? "Phase" : "Project"} completed · ${name}`,
        });
      }
    }
  }
  if (!completionDerivable) warnings.push("task_completion_not_derivable_from_events");

  // Deduplicate / sort progress events newest first
  progressEvents.sort((a, b) => (a.date < b.date ? 1 : -1));
  const counts = {
    completed: progressEvents.filter((e) => e.category === "completed").length,
    kpi_snapshot: progressEvents.filter((e) => e.category === "kpi_snapshot").length,
    risk_blocker: progressEvents.filter((e) => e.category === "risk_blocker").length,
    other_update: progressEvents.filter((e) => e.category === "other_update").length,
  };
  if (progressEvents.length === 0) warnings.push("no_period_progress_events");

  // ---- Period digest (broader canonical evidence) ----------------------
  const periodDigest = await buildPeriodDigest(
    supabase,
    projectId,
    projectName,
    phases,
    tasks,
    allBlockers,
    allRisks,
    progressEvents,
    periodStart,
    periodEndExclusiveIso,
    warnings,
  );

  // Consistency signal
  const completion = reporting?.completionPercent ?? null;
  const statusLabel = project.status ? String(project.status) : null;
  const allCompleteButActive =
    completion != null && completion >= 100 &&
    !!statusLabel && statusLabel.toLowerCase() === "active";

  const data: StatusDeckData = {
    generatedAt,
    generatedByLabel,
    organizationName,
    period: { start: periodStart.slice(0, 10), end: periodEndDate },
    project: {
      id: projectId,
      name: projectName,
      workspaceName,
      programName,
      statusLabel,
      stageLabel: project.project_stage ? String(project.project_stage) : null,
      startDate: (project.start_date as string | null) ?? null,
      targetEndDate: (project.target_end_date as string | null) ?? null,
      pmNames,
      sponsorNames,
      portfolioItemId: (project as any).portfolio_item_id ?? null,
      portfolioName: (project as any).portfolio_name ?? null,
      portfolioCode: (project as any).portfolio_code ?? null,
      portfolioLifecycleState: (project as any).portfolio_lifecycle_state ?? null,
      portfolioIsArchived: (project as any).portfolio_is_archived ?? null,
      portfolioLabel: formatPortfolioLabelFromProject(project),
    },
    reporting,
    timeline,
    progress: { events: progressEvents, counts },
    blockers: { open: openBlockers, createdInPeriod: blockerCreatedInPeriod, resolvedInPeriod: blockerResolvedInPeriod },
    risks: { highImpactOpen, createdInPeriod: riskCreatedInPeriod, updatedInPeriod: riskUpdatedInPeriod },
    kpis: kpiList,
    consistency: { allTasksCompleteButStatusActive: allCompleteButActive },
    periodDigest,
    warnings,
  };

  return { data, workspaceId, organizationId: orgId };
}

async function collectExecutionUpdates(
  supabase: SupabaseClient,
  targetType: "project" | "phase" | "task",
  targetId: string,
  targetName: string,
  periodStart: string,
  periodEndExclusiveIso: string,
  out: ProgressEvent[],
  warnings: string[],
) {
  try {
    const { data: euJson } = await supabase.rpc("list_decrypted_execution_updates", {
      _target_type: targetType,
      _target_id: targetId,
    });
    const eu: any[] = (euJson as any) ?? [];
    for (const u of eu) {
      const d = (u.update_date as string) ?? (u.created_at as string);
      if (!inRange(d, periodStart, periodEndExclusiveIso)) continue;
      out.push({
        date: d,
        category: "other_update",
        kind: `execution_update_${targetType}`,
        title: `${cap(targetType)} update · ${targetName}`,
        detail: u.summary ?? null,
        badge: u.status_label ?? null,
      });
    }
  } catch {
    warnings.push(`execution_updates_failed_${targetType}`);
  }
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

function kpiValueLabel(s: KpiSnapshotView, unit: string | null): string {
  if (s.valueAmount != null) {
    const u = unit ? ` ${unit}` : "";
    return `${s.valueAmount}${u}`;
  }
  if (s.stringValue) return s.stringValue;
  return "—";
}

function uniqueNames(rows: Array<{ display_name: string | null; email: string | null }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const n = pickName(r);
    if (!n) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

// =====================================================================
// Period digest builder — broader canonical evidence for slides 5 & 8.
// Pulls:
//   - activity_events (project-tree) via list_project_activity_events
//   - governance_records via list_project_governance_records + per-record
//     get_governance_record_detail for decision text
//   - risks/blockers already loaded by the caller
// All RPCs are SECURITY DEFINER and respect existing project access.
// =====================================================================

// Material activity_events event_type allow-list for the Status Deck.
// Intentionally excludes pure admin/lifecycle/archival/invitation noise.
const MATERIAL_EVENT_TYPES = new Set<string>([
  "status_changed",
  "schedule_changed",
  "task_actual_dates_updated",
  "phase_auto_completed",
  "phase_auto_reopened",
  "phase_plan_moved",
  "phase_resized",
  "phase_reopened",
  "task_reopened",
  "baseline_post_add",
  "baseline_approved",
  "project_planning_window_changed",
  "project_stage_transitioned",
  "risk_opened",
  "risk_updated",
  "risk_state_changed",
  "blocker_opened",
  "blocker_updated",
  "blocker_state_changed",
  "blocker_resolved",
  "kpi_value_recorded",
  "kpi_target_changed",
  "dependency_added",
  "dependency_removed",
  "dependency_type_changed",
  "governance_record_created",
  "governance_record_updated",
  "governance_record_decisions_updated",
  "governance_cadence_advanced",
  "parent_extended_for_child_edit",
]);

// Events already represented by other digest sections — avoid double-listing
// in "Material changes" when also rendered as "Completed" or as governance.
const COMPLETION_EVENT_TYPES = new Set<string>([
  "phase_auto_completed",
]);
const GOVERNANCE_EVENT_TYPES = new Set<string>([
  "governance_record_created",
  "governance_record_updated",
  "governance_record_decisions_updated",
  "governance_cadence_advanced",
]);

function parseMetadata(md: unknown): Record<string, any> {
  if (!md) return {};
  if (typeof md === "object") return md as Record<string, any>;
  if (typeof md === "string") {
    try { return JSON.parse(md) as Record<string, any>; } catch { return {}; }
  }
  return {};
}

function humanizeEventType(t: string): string {
  return t.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isInPeriod(iso: string | null | undefined, start: string, endExclusive: string): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= new Date(start).getTime() && t < new Date(endExclusive).getTime();
}

function isDateInPeriod(dateOnly: string | null | undefined, start: string, endExclusive: string): boolean {
  if (!dateOnly) return false;
  // Treat date as UTC midnight.
  const iso = dateOnly.length === 10 ? `${dateOnly}T00:00:00.000Z` : dateOnly;
  return isInPeriod(iso, start, endExclusive);
}

async function buildPeriodDigest(
  supabase: SupabaseClient,
  projectId: string,
  projectName: string,
  phases: any[],
  tasks: any[],
  allBlockers: any[],
  allRisks: any[],
  progressEvents: ProgressEvent[],
  periodStart: string,
  periodEndExclusiveIso: string,
  warnings: string[],
): Promise<PeriodDigest> {
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const phasesById = new Map(phases.map((p) => [p.id, p]));

  // ---- Activity events (project tree) -------------------------------
  let activityEvents: any[] = [];
  try {
    const { data: ae } = await supabase.rpc("list_project_activity_events", {
      _project_id: projectId,
    });
    activityEvents = Array.isArray(ae) ? (ae as any[]) : [];
  } catch {
    warnings.push("activity_events_failed");
  }

  const inPeriodEvents = activityEvents.filter((ev) =>
    isInPeriod(ev.created_at, periodStart, periodEndExclusiveIso) &&
    MATERIAL_EVENT_TYPES.has(ev.event_type),
  );

  const completedDelivered: PeriodDigestItem[] = progressEvents
    .filter((e) => e.category === "completed")
    .map((e) => ({ date: e.date, kind: e.kind, title: e.title, detail: e.detail ?? null }));

  const materialChanges: PeriodDigestItem[] = [];
  for (const ev of inPeriodEvents) {
    if (COMPLETION_EVENT_TYPES.has(ev.event_type)) continue;
    if (GOVERNANCE_EVENT_TYPES.has(ev.event_type)) continue;
    // status_changed → completed is already covered by completedDelivered
    if (ev.event_type === "status_changed") {
      const md = parseMetadata(ev.metadata);
      const ns = (md?.new_status || md?.to || md?.status || "").toString().toLowerCase();
      if (ns === "completed" || ns === "done") continue;
    }
    let name = "(item)";
    if (ev.target_type === "task") {
      name = String(tasksById.get(ev.target_id)?.name || "").trim() || "(task)";
    } else if (ev.target_type === "phase") {
      name = String(phasesById.get(ev.target_id)?.name || "").trim() || "(phase)";
    } else if (ev.target_type === "project") {
      name = projectName;
    } else {
      name = ev.target_type ? `(${ev.target_type})` : "(item)";
    }
    const md = parseMetadata(ev.metadata);
    let detail: string | null = null;
    if (ev.event_type === "status_changed") {
      const prev = (md?.old_status || md?.from || "").toString();
      const next = (md?.new_status || md?.to || "").toString();
      if (prev || next) detail = `${prev || "—"} → ${next || "—"}`;
    } else if (ev.event_type === "schedule_changed") {
      detail = "Schedule updated";
    } else if (ev.event_type === "task_actual_dates_updated") {
      detail = "Actual dates updated";
    } else if (ev.event_type === "baseline_approved" || ev.event_type === "baseline_post_add") {
      detail = "Baseline update";
    } else if (ev.event_type.startsWith("dependency_")) {
      detail = humanizeEventType(ev.event_type);
    } else if (ev.event_type === "project_stage_transitioned") {
      const prev = (md?.from || md?.previous_stage || "").toString();
      const next = (md?.to || md?.new_stage || "").toString();
      detail = `Stage ${prev || "—"} → ${next || "—"}`;
    } else if (ev.event_type === "project_planning_window_changed") {
      detail = "Planning window updated";
    }
    materialChanges.push({
      date: ev.created_at,
      kind: ev.event_type,
      title: `${humanizeEventType(ev.event_type)} · ${name}`,
      detail,
    });
  }

  // ---- Governance records held in period ----------------------------
  const governanceEvidence: PeriodGovernanceEvidence[] = [];
  const decisions: PeriodDecisionItem[] = [];
  let govRecords: any[] = [];
  try {
    const { data: gr } = await supabase.rpc("list_project_governance_records", {
      _project_id: projectId,
      _include_archived: false,
    });
    govRecords = Array.isArray(gr) ? (gr as any[]) : [];
  } catch {
    warnings.push("governance_records_failed");
  }
  const heldInPeriod = govRecords.filter((r) =>
    isDateInPeriod(r.actual_date_held, periodStart, periodEndExclusiveIso),
  );

  // Cap detail fetches so the function stays well within Edge limits.
  const DETAIL_FETCH_CAP = 20;
  const limited = heldInPeriod.slice(0, DETAIL_FETCH_CAP);
  if (heldInPeriod.length > DETAIL_FETCH_CAP) {
    warnings.push("governance_records_truncated_for_decisions");
  }

  for (const rec of limited) {
    let decisionRows: any[] = [];
    try {
      const { data: detail } = await supabase.rpc("get_governance_record_detail", {
        _record_id: rec.id,
      });
      const obj = (detail as any) ?? {};
      decisionRows = Array.isArray(obj.decisions) ? obj.decisions : [];
    } catch {
      warnings.push("governance_record_detail_failed");
    }
    const liveDecisions = decisionRows.filter((d) => !d.archived_at);
    governanceEvidence.push({
      date: rec.actual_date_held ?? null,
      eventType: rec.event_type ?? null,
      eventName: String(rec.event_name || "").trim() || "(governance record)",
      decisionCount: liveDecisions.length,
      hasSharepointEvidence: !!rec.sharepoint_evidence_reference,
    });
    for (const d of liveDecisions) {
      const text = String(d.decision_text || "").trim();
      if (!text) continue;
      decisions.push({
        date: rec.actual_date_held ?? null,
        recordTitle: String(rec.event_name || "").trim() || "(governance record)",
        decisionText: text,
        targetDate: d.target_date ?? null,
      });
    }
  }

  // ---- KPI snapshots (already in progressEvents) ---------------------
  const kpiSnapshots: PeriodDigestItem[] = progressEvents
    .filter((e) => e.category === "kpi_snapshot")
    .map((e) => ({ date: e.date, kind: e.kind, title: e.title, detail: e.detail ?? null }));

  // ---- Risk/blocker movements (created/updated/resolved in period) ---
  const riskBlockerMovements: PeriodDigestItem[] = progressEvents
    .filter((e) => e.category === "risk_blocker")
    .map((e) => ({
      date: e.date, kind: e.kind, title: e.title,
      detail: e.detail ?? null, badge: e.badge ?? null,
    }));

  // ---- Sponsor attention: high-impact open risks + high-severity open
  // blockers. No invented escalations.
  const HIGH = new Set(["high", "critical"]);
  const ACTIVE_RISK = new Set(["open", "identified", "under_mitigation", "mitigating"]);
  const sponsorAttention: PeriodAttentionItem[] = [];
  for (const r of allRisks) {
    if (ACTIVE_RISK.has(r.status) && HIGH.has((r.impact || "").toLowerCase())) {
      sponsorAttention.push({
        kind: "risk",
        title: String(r.title || "").trim() || "(untitled risk)",
        severity: r.impact ?? null,
        status: r.status ?? null,
        detail: r.likelihood ? `Likelihood: ${r.likelihood}` : null,
      });
    }
  }
  for (const b of allBlockers) {
    const openish = b.status === "open" || b.status === "in_progress";
    if (openish && HIGH.has((b.severity || "").toLowerCase())) {
      sponsorAttention.push({
        kind: "blocker",
        title: String(b.title || "").trim() || "(untitled blocker)",
        severity: b.severity ?? null,
        status: b.status ?? null,
      });
    }
  }

  return {
    completedDelivered,
    materialChanges,
    governanceEvidence,
    decisions,
    sponsorAttention,
    kpiSnapshots,
    riskBlockerMovements,
    counts: {
      completedDelivered: completedDelivered.length,
      materialChanges: materialChanges.length,
      governanceRecords: heldInPeriod.length,
      decisions: decisions.length,
      sponsorAttention: sponsorAttention.length,
      kpiSnapshots: kpiSnapshots.length,
      riskBlockerMovements: riskBlockerMovements.length,
    },
  };
}
