// SP.6b — Data-mapping layer for the Project Charter template.
//
// Pulls canonical BTPM data via decryption-aware SECURITY DEFINER RPCs so
// encrypted columns (project narrative, role labels, profile names, risk
// titles, workspace/org/program names) are returned as plaintext. Direct
// table reads of encrypted columns are forbidden here — they would render
// raw ciphertext into the generated Word document.
//
// 4D.4 update:
// - PM and Sponsor are derived from project_team_members.canonical_role_key
//   (with a conservative exact-label fallback for legacy rows).
// - New 4D.2 narrative fields (business_case, success_criteria,
//   completion_criteria, budget_narrative, assumptions, constraints) are
//   sourced from get_decrypted_project.
// - RACI is grouped by role from list_project_raci.
// - Key deliverables are derived from tasks where task_type = 'deliverable'.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { CharterData } from "./charterTemplate.ts";

function splitLines(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(/\r?\n/).map((x) => x.trim()).filter((x) => x.length > 0);
}

function pickName(p: { display_name?: string | null; email?: string | null } | null | undefined): string | null {
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

export interface MapResult {
  data: CharterData;
  snapshotAt: string;
  workspaceId: string;
  organizationId: string;
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

// Conservative legacy fallback (only exact, unambiguous labels).
const LEGACY_PM_LABELS = new Set(["project manager", "pm", "pm lead"]);
const LEGACY_SPONSOR_LABELS = new Set(["project sponsor", "sponsor"]);

export async function mapProjectToCharterData(
  supabase: SupabaseClient,
  projectId: string,
  callerUserId: string,
): Promise<MapResult> {
  const snapshotAt = new Date().toISOString();

  // 1) Decrypted project (RLS-safe SECURITY DEFINER).
  const { data: projectJson, error: pErr } = await supabase.rpc("get_decrypted_project", {
    _project_id: projectId,
  });
  if (pErr || !projectJson) {
    throw new Error("Project not accessible");
  }
  const project = projectJson as any;
  const orgId: string = project.organization_id;
  const workspaceId: string = project.workspace_id;

  // Project name itself is encrypted at rest; decrypt with fallback.
  const projectName: string =
    (await decrypt(supabase, project.name, orgId)) || (project.name as string);

  // 2) Workspace / organization / program names
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

  // 3) Generated-by label
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

  // 4) Project team — derive PM / Sponsor by canonical_role_key with
  // conservative legacy exact-label fallback.
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

  function namesByCanonical(key: string, legacyExact: Set<string>): string[] {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const t of teamRows) {
      const ck = (t.canonical_role_key || "").trim();
      const labelLc = (t.role_label || "").trim().toLowerCase();
      const isMatch =
        ck === key ||
        // Legacy fallback: only when canonical_role_key is missing AND label
        // is one of the conservative exact strings.
        (!ck && legacyExact.has(labelLc));
      if (!isMatch) continue;
      const n = pickName(t);
      if (!n) continue;
      if (seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      names.push(n);
    }
    return names;
  }

  const projectManagerNames = namesByCanonical("project_manager", LEGACY_PM_LABELS);
  const teamSponsorNames = namesByCanonical("project_sponsor", LEGACY_SPONSOR_LABELS);

  // 4D.4R — Sponsor primarily comes from project Stakeholders.
  // Match exact role labels: "Executive Sponsor" or "Project Sponsor".
  const stakeholderSponsorNames: string[] = [];
  {
    const { data: shJson } = await supabase.rpc("list_project_stakeholders", {
      _project_id: projectId,
    });
    const sh: Array<{
      role_label: string | null;
      display_name: string | null;
      removed_at: string | null;
    }> = (shJson as any) ?? [];
    const SPONSOR_LABELS = new Set(["executive sponsor", "project sponsor"]);
    for (const s of sh) {
      if (s.removed_at) continue;
      const labelLc = (s.role_label || "").trim().toLowerCase();
      if (!SPONSOR_LABELS.has(labelLc)) continue;
      const n = (s.display_name || "").trim();
      if (!n) continue;
      stakeholderSponsorNames.push(n);
    }
  }

  // De-duplicate: stakeholders first, then team-derived fallbacks.
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

  // 5) Phases → milestones.
  const { data: phasesJson } = await supabase.rpc("list_decrypted_project_phases", {
    _project_id: projectId,
  });
  const phases: any[] = (phasesJson as any) ?? [];
  const milestones = phases
    .filter((ph) => !ph.is_archived)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((ph) => ({
      name: ph.name as string,
      targetDate: (ph.target_end_date as string | null) ?? null,
    }));

  // 6) High-level risks
  const { data: risksJson } = await supabase.rpc("list_decrypted_risks", {
    _target_id: projectId,
    _target_type: "project",
  });
  const risksAll: any[] = (risksJson as any) ?? [];
  const highLevelRisks = risksAll
    .filter((r) => r.status !== "closed")
    .slice(0, 8)
    .map((r) => r.title as string)
    .filter(Boolean);

  // 7) RACI — grouped by role
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

  // 8) Key deliverables — tasks with task_type='deliverable'
  const { data: tasksJson } = await supabase.rpc("list_decrypted_project_tasks", {
    _project_id: projectId,
  });
  const allTasks: any[] = (tasksJson as any) ?? [];
  const keyDeliverables = allTasks
    .filter((t) => t.task_type === "deliverable" && !t.is_archived)
    .map((t) => ({
      name: String(t.name || "").trim(),
      dueDate: (t.due_date as string | null) ?? null,
      status: (t.status as string | null) ?? null,
    }))
    .filter((d) => d.name.length > 0);

  // 9) Narrative fields
  const purpose: string | null = (project.charter as string | null) || (project.description as string | null) || null;
  const goal: string | null = (project.goals as string | null) ?? null;
  const businessCase: string | null = (project.business_case as string | null) ?? null;
  const successCriteria: string | null = (project.success_criteria as string | null) ?? null;
  const completionCriteria: string | null = (project.completion_criteria as string | null) ?? null;
  const budgetNarrative: string | null = (project.budget_narrative as string | null) ?? null;
  const assumptionsLines: string[] = splitLines(project.assumptions as string | null);
  const constraintsLines: string[] = splitLines(project.constraints as string | null);

  const data: CharterData = {
    generatedAt: snapshotAt,
    generatedByLabel,
    organizationName,
    project: {
      name: projectName,
      workspaceName,
      programName,
      statusLabel: project.status ? String(project.status) : null,
      stageLabel: project.project_stage ? String(project.project_stage) : null,
      startDate: (project.start_date as string | null) ?? null,
      targetEndDate: (project.target_end_date as string | null) ?? null,
      purpose,
      goal,
      businessCase,
      successCriteria,
      completionCriteria,
      budgetNarrative,
      scopeIn: (project.scope_in as string | null) ?? null,
      scopeOut: (project.scope_out as string | null) ?? null,
      keyDeliverables,
      assumptions: assumptionsLines,
      constraints: constraintsLines,
      highLevelRisks,
      portfolioItemId: (project as any).portfolio_item_id ?? null,
      portfolioName: (project as any).portfolio_name ?? null,
      portfolioCode: (project as any).portfolio_code ?? null,
      portfolioLifecycleState: (project as any).portfolio_lifecycle_state ?? null,
      portfolioIsArchived: (project as any).portfolio_is_archived ?? null,
      portfolioLabel: formatPortfolioLabelFromProject(project),
    },
    projectManagerNames,
    projectSponsorNames,
    milestones,
    raciSummary,
    glossary: [],
  };

  return {
    data,
    snapshotAt,
    workspaceId,
    organizationId: orgId,
  };
}
