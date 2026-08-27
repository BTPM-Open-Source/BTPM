// Phase 6C — Step 6C.8: Data mapper for Project Closure Report.
//
// Pulls canonical BTPM data via SECURITY DEFINER RPCs so encrypted narrative
// stays server-side and ciphertext never reaches the .docx. This is a
// read-only mapper — no source-of-truth mutation occurs here.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { ClosureReportData } from "./closureReportTemplate.ts";

function pickName(
  p: { display_name?: string | null; email?: string | null } | null | undefined,
): string | null {
  if (!p) return null;
  return (p.display_name && p.display_name.trim()) || p.email || null;
}

// Phase 6D.7D — Portfolio label from get_decrypted_project fields only.
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

export interface MapResult {
  data: ClosureReportData;
  snapshotAt: string;
  workspaceId: string;
  organizationId: string;
}

export async function mapProjectToClosureReportData(
  supabase: SupabaseClient,
  projectId: string,
  callerUserId: string,
): Promise<MapResult> {
  const snapshotAt = new Date().toISOString();

  // 1) Project (decrypted).
  const { data: projectJson, error: pErr } = await supabase.rpc(
    "get_decrypted_project",
    { _project_id: projectId },
  );
  if (pErr || !projectJson) throw new Error("Project not accessible");
  const project = projectJson as any;
  const orgId: string = project.organization_id;
  const workspaceId: string = project.workspace_id;

  const projectName: string =
    (await decrypt(supabase, project.name, orgId)) || (project.name as string);

  // 2) Workspace / org / program names.
  const { data: wsJson } = await supabase.rpc("get_decrypted_workspace", {
    _workspace_id: workspaceId,
  });
  const workspaceName: string | null = (wsJson as any)?.name ?? null;

  let organizationName: string | null = null;
  {
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    organizationName = await decrypt(supabase, (orgRow as any)?.name ?? null, orgId);
  }

  let programName: string | null = null;
  if (project.program_id) {
    const { data: prog } = await supabase
      .from("programs")
      .select("name")
      .eq("id", project.program_id)
      .maybeSingle();
    programName = await decrypt(supabase, (prog as any)?.name ?? null, orgId);
  }

  // 3) Generated-by label.
  let generatedByLabel = "BTPM";
  {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, email, organization_id")
      .eq("id", callerUserId)
      .maybeSingle();
    if (profile) {
      const pOrg = (profile as any).organization_id ?? orgId;
      const dn = await decrypt(supabase, (profile as any).display_name, pOrg);
      const em = await decrypt(supabase, (profile as any).email, pOrg);
      generatedByLabel = pickName({ display_name: dn, email: em }) || "BTPM";
    }
  }

  // 4) Team → PM / Sponsor derivation (mirrors charter mapper conventions).
  const { data: teamJson } = await supabase.rpc("list_decrypted_project_team", {
    _project_id: projectId,
  });
  const teamRows: Array<{
    user_id: string;
    role_label: string | null;
    canonical_role_key: string | null;
    display_name: string | null;
    email: string | null;
  }> = (teamJson as any) ?? [];

  const LEGACY_PM = new Set(["project manager", "pm", "pm lead"]);
  const LEGACY_SPONSOR = new Set(["project sponsor", "sponsor"]);

  function namesByCanonical(key: string, legacy: Set<string>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of teamRows) {
      const ck = (t.canonical_role_key || "").trim();
      const labelLc = (t.role_label || "").trim().toLowerCase();
      if (!(ck === key || (!ck && legacy.has(labelLc)))) continue;
      const n = pickName(t);
      if (!n) continue;
      const k = n.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(n);
    }
    return out;
  }

  const projectManagerNames = namesByCanonical("project_manager", LEGACY_PM);
  const teamSponsorNames = namesByCanonical("project_sponsor", LEGACY_SPONSOR);

  // 5) Stakeholders (also feeds sponsor derivation).
  const { data: shJson } = await supabase.rpc("list_project_stakeholders", {
    _project_id: projectId,
  });
  const stakeholderRows: Array<{
    role_label: string | null;
    display_name: string | null;
    email: string | null;
    removed_at: string | null;
  }> = (shJson as any) ?? [];

  const stakeholderSponsorNames: string[] = [];
  const SPONSOR_LABELS = new Set(["executive sponsor", "project sponsor"]);
  const activeStakeholders: Array<{ name: string; role: string | null }> = [];
  for (const s of stakeholderRows) {
    if (s.removed_at) continue;
    const n = (s.display_name || s.email || "").trim();
    if (!n) continue;
    activeStakeholders.push({ name: n, role: s.role_label ?? null });
    const labelLc = (s.role_label || "").trim().toLowerCase();
    if (SPONSOR_LABELS.has(labelLc)) stakeholderSponsorNames.push(n);
  }

  const projectSponsorNames: string[] = [];
  {
    const seen = new Set<string>();
    for (const n of [...stakeholderSponsorNames, ...teamSponsorNames]) {
      const k = n.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      projectSponsorNames.push(n);
    }
  }

  const teamMemberNames: string[] = [];
  {
    const seen = new Set<string>();
    for (const t of teamRows) {
      const n = pickName(t);
      if (!n) continue;
      const k = n.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      teamMemberNames.push(n);
    }
  }

  // 6) RACI grouped.
  const { data: raciJson } = await supabase.rpc("list_project_raci", {
    _project_id: projectId,
  });
  const raciRows: Array<{
    raci_role: string;
    display_name: string | null;
    email: string | null;
  }> = (raciJson as any) ?? [];
  const raciSummary = {
    responsible: [] as string[],
    accountable: [] as string[],
    consulted: [] as string[],
    informed: [] as string[],
  };
  const raciSeen = {
    responsible: new Set<string>(),
    accountable: new Set<string>(),
    consulted: new Set<string>(),
    informed: new Set<string>(),
  };
  for (const r of raciRows) {
    const role = String(r.raci_role || "").toLowerCase();
    const bucket = (raciSummary as any)[role] as string[] | undefined;
    const seen = (raciSeen as any)[role] as Set<string> | undefined;
    if (!bucket || !seen) continue;
    const n = pickName(r);
    if (!n) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    bucket.push(n);
  }

  // 7) Phases.
  const { data: phasesJson } = await supabase.rpc(
    "list_decrypted_project_phases",
    { _project_id: projectId },
  );
  const phases: any[] = (phasesJson as any) ?? [];
  const activePhases = phases.filter((p) => !p.is_archived);
  const phaseSummaries = activePhases
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((ph) => ({
      name: ph.name as string,
      status: (ph.status as string | null) ?? null,
      startDate: (ph.start_date as string | null) ?? null,
      targetEndDate: (ph.target_end_date as string | null) ?? null,
    }));

  // 8) Tasks — rollup counts only.
  const { data: tasksJson } = await supabase.rpc(
    "list_decrypted_project_tasks",
    { _project_id: projectId },
  );
  const allTasks: any[] = (tasksJson as any) ?? [];
  const activeTasks = allTasks.filter((t) => !t.is_archived);
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  let completed = 0, open = 0, overdue = 0;
  for (const t of activeTasks) {
    const st = String(t.status || "").toLowerCase();
    if (st === "done" || st === "completed" || st === "closed") completed++;
    else {
      open++;
      const due = (t.due_date as string | null) ?? null;
      if (due && due < todayIso) overdue++;
    }
  }

  // 9) Closure summary.
  const { data: closureJson } = await supabase.rpc(
    "get_decrypted_project_closure_summary",
    { _project_id: projectId },
  );
  const closureRows = (closureJson as any[] | null) ?? [];
  const closure = closureRows.length > 0 ? closureRows[0] : null;

  // 10) Benefits (active only).
  const { data: benefitsJson } = await supabase.rpc(
    "list_decrypted_project_benefits",
    { _project_id: projectId, _include_archived: false },
  );
  const benefits = ((benefitsJson as any[] | null) ?? [])
    .filter((b) => !b.archived_at)
    .map((b) => ({
      benefitType: (b.custom_benefit_type_label as string | null) ||
        (b.benefit_type as string),
      metric: (b.metric_name as string) || "",
      unit: (b.unit_of_measure as string) || "",
      baseline: b.baseline_value === null || b.baseline_value === undefined
        ? null
        : Number(b.baseline_value),
      target: b.target_value === null || b.target_value === undefined
        ? null
        : Number(b.target_value),
      actual: b.actual_value === null || b.actual_value === undefined
        ? null
        : Number(b.actual_value),
      status: (b.realization_status as string | null) ?? null,
      owner: (b.benefit_owner_display_name as string | null) ||
        (b.benefit_owner_email as string | null) || null,
      expectedDate: (b.expected_realization_date as string | null) ?? null,
      actualDate: (b.actual_realization_date as string | null) ?? null,
    }));

  // 11) KPIs.
  const { data: kpiJson } = await supabase.rpc("list_decrypted_kpi_definitions", {
    _project_id: projectId,
  });
  const kpis = ((kpiJson as any[] | null) ?? [])
    .filter((k) => !k.is_archived)
    .map((k) => ({
      name: (k.name as string) || "",
      unit: (k.unit as string | null) ?? null,
      targetValue: k.target_value === null || k.target_value === undefined
        ? null
        : Number(k.target_value),
      currentValue: k.current_value === null || k.current_value === undefined
        ? null
        : Number(k.current_value),
      lastUpdated: (k.updated_at as string | null) ?? null,
    }));

  // 12) Risks / Blockers.
  const { data: risksJson } = await supabase.rpc("list_project_all_risks", {
    _project_id: projectId,
  });
  const risksAll: any[] = (risksJson as any) ?? [];
  const risksOpen = risksAll.filter((r) => String(r.status || "").toLowerCase() !== "closed");
  const risksClosed = risksAll.length - risksOpen.length;
  const openRisks = risksOpen.slice(0, 15).map((r) => ({
    title: (r.title as string) || "",
    status: (r.status as string | null) ?? null,
    severity: (r.impact as string | null) ?? null,
  }));

  const { data: blockersJson } = await supabase.rpc("list_project_all_blockers", {
    _project_id: projectId,
  });
  const blockersAll: any[] = (blockersJson as any) ?? [];
  const blockersOpen = blockersAll.filter(
    (b) => String(b.status || "").toLowerCase() !== "resolved" &&
      String(b.status || "").toLowerCase() !== "closed",
  );
  const blockersClosed = blockersAll.length - blockersOpen.length;
  const openBlockers = blockersOpen.slice(0, 15).map((b) => ({
    title: (b.title as string) || "",
    status: (b.status as string | null) ?? null,
    severity: (b.severity as string | null) ?? null,
  }));

  // 13) Lessons Learned reference metadata.
  const { data: llJson } = await supabase.rpc(
    "get_decrypted_project_lessons_learned_document",
    { _project_id: projectId },
  );
  const llRows = (llJson as any[] | null) ?? [];
  const llRow = llRows.length > 0 ? llRows[0] : null;
  const lessonsLearned = llRow
    ? {
      documentName: (llRow.document_name as string | null) ?? null,
      status: (llRow.status as string | null) ?? null,
      lastModified:
        (llRow.last_modified_at as string | null) ??
          (llRow.updated_at as string | null) ?? null,
      sharepointWebUrl: (llRow.sharepoint_web_url as string | null) ?? null,
    }
    : null;

  const data: ClosureReportData = {
    generatedAt: snapshotAt,
    generatedByLabel,
    organizationName,
    project: {
      name: projectName,
      workspaceName,
      programName,
      statusLabel: project.status ? String(project.status) : null,
      stageLabel: project.project_stage ? String(project.project_stage) : null,
      healthLabel: project.health ? String(project.health) : null,
      completionPct: project.completion_pct === null || project.completion_pct === undefined
        ? null
        : Number(project.completion_pct),
      startDate: (project.start_date as string | null) ?? null,
      targetEndDate: (project.target_end_date as string | null) ?? null,
      description: (project.description as string | null) ?? null,
      goals: (project.goals as string | null) ?? null,
      scopeIn: (project.scope_in as string | null) ?? null,
      scopeOut: (project.scope_out as string | null) ?? null,
      successCriteria: (project.success_criteria as string | null) ?? null,
      portfolioItemId: (project as any).portfolio_item_id ?? null,
      portfolioName: (project as any).portfolio_name ?? null,
      portfolioCode: (project as any).portfolio_code ?? null,
      portfolioLifecycleState: (project as any).portfolio_lifecycle_state ?? null,
      portfolioIsArchived: (project as any).portfolio_is_archived ?? null,
      portfolioLabel: formatPortfolioLabelFromProject(project),
    },
    projectManagerNames,
    projectSponsorNames,
    teamMemberNames,
    stakeholders: activeStakeholders,
    raciSummary,
    phases: phaseSummaries,
    taskCounts: {
      total: activeTasks.length,
      completed,
      open,
      overdue,
    },
    closureSummary: closure
      ? {
        outcome: (closure.outcome_summary as string | null) ?? null,
        benefits: (closure.benefits_summary as string | null) ?? null,
        achievements: (closure.achievements_summary as string | null) ?? null,
        openItems: (closure.open_items_summary as string | null) ?? null,
        transitionNotes: (closure.transition_notes as string | null) ?? null,
      }
      : null,
    benefits,
    kpis,
    riskCounts: {
      total: risksAll.length,
      open: risksOpen.length,
      closed: risksClosed,
    },
    openRisks,
    blockerCounts: {
      total: blockersAll.length,
      open: blockersOpen.length,
      closed: blockersClosed,
    },
    openBlockers,
    lessonsLearned,
  };

  return { data, snapshotAt, workspaceId, organizationId: orgId };
}
