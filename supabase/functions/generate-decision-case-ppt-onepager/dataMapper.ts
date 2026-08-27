// DC.11 — Decision Case PowerPoint one-pager data mapper.
//
// Pulls canonical Decision Case data through SECURITY DEFINER RPCs so that
// encrypted fields are returned as plaintext. Same source-of-truth rules
// as the Word brief mapper: current stakeholder package is the primary
// content source; formal decision outcome (if any) is included as an
// optional element. Raw Copilot output is NOT used as final truth.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface DecisionOnepagerData {
  generatedAt: string;
  generatedByLabel: string;
  organizationName: string | null;
  projectName: string;

  decisionCase: {
    title: string;
    decisionQuestion: string | null;
    stage: string | null;
    targetDecisionDate: string | null;
    eventType: string | null;
    background: string | null;
    ownerLabel: string | null;
  };

  package: {
    versionNumber: number;
    title: string | null;
    status: string | null;
    audience: string | null;
    executiveSummary: string | null;
    decisionQuestion: string | null;
    background: string | null;
    options: string | null;
    recommendation: string | null;
    decisionAsk: string | null;
    evidenceSummary: string | null;
    guardrails: string | null;
    residualRisks: string | null;
    nextSteps: string | null;
    providedAt: string | null;
  };

  outcome: null | {
    decisionResult: string | null;
    finalDecisionText: string | null;
    decisionDate: string | null;
    signoffStatus: string | null;
    residualRisks: string | null;
    followUpActions: string | null;
  };

  counts: {
    externalReferences: number;
    btpmContextLinks: number;
    crossProjectLinks: number;
  };

  hasOutcome: boolean;
}

export interface MapResult {
  data: DecisionOnepagerData;
  snapshotAt: string;
  projectId: string;
  organizationId: string;
  workspaceId: string;
  governanceRecordId: string;
  packageVersionNumber: number;
}

export class MapError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
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

// C20B1-C1 — dual-client contract:
//   callerClient : anon-key client carrying the authenticated browser session.
//                  ALL protected native-browser Governance/Project read RPCs
//                  must execute here so auth.uid() is preserved.
//   adminClient  : service-role client, used only for already-authorized
//                  server-side direct reads / decryption helpers.
export async function mapDecisionCaseToOnepagerData(
  callerClient: SupabaseClient,
  adminClient: SupabaseClient,
  recordId: string,
  callerUserId: string,
): Promise<MapResult> {
  const snapshotAt = new Date().toISOString();

  const { data: detailJson, error: dErr } = await callerClient.rpc(
    "get_governance_record_detail",
    { _record_id: recordId },
  );
  if (dErr || !detailJson) {
    throw new MapError("record_not_accessible", dErr?.message || "Decision case not accessible", 404);
  }
  const detail = detailJson as any;
  if (detail.record_kind !== "decision_case") {
    throw new MapError("not_decision_case", "Record is not a decision case", 400);
  }
  const orgId: string = detail.organization_id;
  const workspaceId: string = detail.workspace_id;
  const projectId: string = detail.project_id;

  const { data: packagesJson, error: pkgErr } = await callerClient.rpc(
    "list_governance_record_stakeholder_packages",
    { _record_id: recordId },
  );
  if (pkgErr) {
    throw new MapError("package_list_failed", pkgErr.message, 500);
  }
  const packages: any[] = (packagesJson as any) ?? [];
  const current = packages.find((p) => p.is_current) ?? null;
  if (!current) {
    throw new MapError(
      "stakeholder_package_missing",
      "Create a stakeholder package before generating the PowerPoint Decision Brief.",
      412,
    );
  }

  const { data: outcomeJson } = await callerClient.rpc(
    "get_governance_record_decision_outcome",
    { _record_id: recordId },
  );
  const outcomeRow = (outcomeJson as any) ?? null;

  const { data: evRefsJson } = await callerClient.rpc(
    "list_governance_record_evidence_references",
    { _record_id: recordId, _include_archived: false },
  );
  const evidenceRows: any[] = (evRefsJson as any) ?? [];

  const { data: crossJson } = await callerClient.rpc(
    "list_governance_record_cross_project_links",
    { _record_id: recordId, _include_archived: false },
  );
  const crossRows: any[] = (crossJson as any) ?? [];

  const { data: projectJson } = await callerClient.rpc("get_decrypted_project", {
    _project_id: projectId,
  });
  const project = (projectJson as any) ?? {};
  const projectName: string =
    (await decrypt(adminClient, project?.name, orgId)) || (project?.name as string) || "Project";

  let organizationName: string | null = null;
  {
    const { data: orgRow } = await adminClient
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    organizationName = await decrypt(adminClient, (orgRow as any)?.name ?? null, orgId);
  }

  let generatedByLabel = "BTPM";
  {
    const { data: profile } = await adminClient
      .from("profiles")
      .select("display_name, email, organization_id")
      .eq("id", callerUserId)
      .maybeSingle();
    if (profile) {
      const pOrg = (profile as any).organization_id ?? orgId;
      const dn = await decrypt(adminClient, (profile as any).display_name, pOrg);
      const em = await decrypt(adminClient, (profile as any).email, pOrg);
      generatedByLabel = (dn && dn.trim()) || em || "BTPM";
    }
  }


  const externalCount = evidenceRows.filter((e) => e.included_in_package !== false).length;
  const crossCount = crossRows.filter((c) => c.included_in_package !== false).length;
  const btpmCount = ((detail.links as any[]) ?? []).length;

  const data: DecisionOnepagerData = {
    generatedAt: snapshotAt,
    generatedByLabel,
    organizationName,
    projectName,
    decisionCase: {
      title: (detail.event_name && String(detail.event_name).trim()) || "Decision Case",
      decisionQuestion: detail.decision_question ?? null,
      stage: detail.decision_stage ?? null,
      targetDecisionDate: detail.target_decision_date ?? null,
      eventType: detail.event_type ?? null,
      background: detail.summary ?? null,
      ownerLabel: detail.owner_name ?? detail.owner_email ?? null,
    },
    package: {
      versionNumber: Number(current.version_number ?? 1),
      title: current.package_title ?? null,
      status: current.package_status ?? null,
      audience: current.audience_text ?? null,
      executiveSummary: current.executive_summary ?? null,
      decisionQuestion: current.decision_question_text ?? null,
      background: current.background_context ?? null,
      options: current.options_summary ?? null,
      recommendation: current.recommendation_text ?? null,
      decisionAsk: current.decision_ask_text ?? null,
      evidenceSummary: current.evidence_summary ?? null,
      guardrails: current.guardrails_text ?? null,
      residualRisks: current.residual_risks_text ?? null,
      nextSteps: current.next_steps_text ?? null,
      providedAt: current.provided_to_stakeholders_at ?? null,
    },
    outcome: outcomeRow
      ? {
          decisionResult: outcomeRow.decision_result ?? null,
          finalDecisionText: outcomeRow.final_decision_text ?? null,
          decisionDate: outcomeRow.decision_date ?? null,
          signoffStatus: outcomeRow.signoff_status ?? null,
          residualRisks: outcomeRow.residual_risks ?? null,
          followUpActions: outcomeRow.follow_up_actions ?? null,
        }
      : null,
    counts: {
      externalReferences: externalCount,
      btpmContextLinks: btpmCount,
      crossProjectLinks: crossCount,
    },
    hasOutcome: !!outcomeRow,
  };

  return {
    data,
    snapshotAt,
    projectId,
    organizationId: orgId,
    workspaceId,
    governanceRecordId: recordId,
    packageVersionNumber: data.package.versionNumber,
  };
}

const FILENAME_BAD = /[\\/:*?"<>|#%]+/g;
export function onepagerFilenameFor(projectName: string, caseTitle: string): string {
  const p = (projectName || "Project").replace(FILENAME_BAD, "").trim() || "Project";
  const t = (caseTitle || "Decision Case").replace(FILENAME_BAD, "").trim() || "Decision Case";
  return `Decision Brief One-pager - ${p} - ${t}.pptx`;
}
