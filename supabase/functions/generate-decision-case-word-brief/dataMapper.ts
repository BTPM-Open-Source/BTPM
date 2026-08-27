// DC.10 — Decision Case Word Brief data mapper.
//
// Pulls canonical Decision Case data through SECURITY DEFINER RPCs so that
// encrypted fields (decision case, brief, stakeholder package, outcome,
// evidence references, project name) are returned as plaintext. Direct
// reads of encrypted columns are forbidden — they would render ciphertext
// into the Word document.
//
// The current stakeholder package is the primary content source for the
// brief. The formal decision outcome (if any) is included as a separate
// optional section.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface EvidenceRef {
  title: string | null;
  url: string | null;
}

export interface CrossProjectRef {
  label: string | null;
  reason: string | null;
}

export interface BtpmContextLink {
  linked_object_type: string;
  linked_object_id: string;
}

export interface DecisionBriefData {
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
    decisionsSummary: string | null;
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
    distributionNote: string | null;
    distributionUrl: string | null;
    providedAt: string | null;
  };

  outcome: null | {
    decisionResult: string | null;
    finalDecisionText: string | null;
    decisionDate: string | null;
    decidedBy: string | null;
    approvalForum: string | null;
    rationale: string | null;
    conditionsGuardrails: string | null;
    residualRisks: string | null;
    followUpActions: string | null;
    implementationTargetDate: string | null;
    signoffStatus: string | null;
    signoffEvidenceUrl: string | null;
    closureNote: string | null;
    closedAt: string | null;
  };

  evidence: {
    externalReferences: EvidenceRef[];
    btpmContextLinks: BtpmContextLink[];
    crossProjectLinks: CrossProjectRef[];
    counts: {
      externalReferences: number;
      btpmContextLinks: number;
      crossProjectLinks: number;
    };
  };

  hasOutcome: boolean;
}

export interface MapResult {
  data: DecisionBriefData;
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
export async function mapDecisionCaseToBriefData(
  callerClient: SupabaseClient,
  adminClient: SupabaseClient,
  recordId: string,
  callerUserId: string,
): Promise<MapResult> {
  const snapshotAt = new Date().toISOString();

  // 1) Decision case detail (asserts read access, kind check below)
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

  // 2) Stakeholder packages — pick current
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
      "Create a stakeholder package before generating the Word Decision Brief.",
      412,
    );
  }

  // 3) Outcome (optional)
  const { data: outcomeJson } = await callerClient.rpc(
    "get_governance_record_decision_outcome",
    { _record_id: recordId },
  );
  const outcomeRow = (outcomeJson as any) ?? null;

  // 4) Evidence references (current/unarchived)
  const { data: evRefsJson } = await callerClient.rpc(
    "list_governance_record_evidence_references",
    { _record_id: recordId, _include_archived: false },
  );
  const evidenceRows: any[] = (evRefsJson as any) ?? [];

  // 5) Cross project links (current/unarchived)
  const { data: crossJson } = await callerClient.rpc(
    "list_governance_record_cross_project_links",
    { _record_id: recordId, _include_archived: false },
  );
  const crossRows: any[] = (crossJson as any) ?? [];

  // 6) Project name + org name
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

  // 7) Generated-by label
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


  const evidenceRefs: EvidenceRef[] = evidenceRows
    .filter((e) => e.included_in_package !== false)
    .map((e) => ({
      title: e.title ?? null,
      url: e.external_url ?? null,
    }));

  const crossRefs: CrossProjectRef[] = crossRows
    .filter((c) => c.included_in_package !== false)
    .map((c) => ({
      label: c.linked_project_name ?? null,
      reason: c.relationship_reason ?? c.relationship_type ?? null,
    }));

  const btpmLinks: BtpmContextLink[] = ((detail.links as any[]) ?? []).map((l) => ({
    linked_object_type: l.linked_object_type,
    linked_object_id: l.linked_object_id,
  }));

  const data: DecisionBriefData = {
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
      decisionsSummary: detail.decisions_summary ?? null,
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
      distributionNote: current.distribution_note ?? null,
      distributionUrl: current.distribution_evidence_url ?? null,
      providedAt: current.provided_to_stakeholders_at ?? null,
    },
    outcome: outcomeRow
      ? {
          decisionResult: outcomeRow.decision_result ?? null,
          finalDecisionText: outcomeRow.final_decision_text ?? null,
          decisionDate: outcomeRow.decision_date ?? null,
          decidedBy: outcomeRow.decided_by_text ?? null,
          approvalForum: outcomeRow.approval_forum ?? null,
          rationale: outcomeRow.decision_rationale ?? null,
          conditionsGuardrails: outcomeRow.conditions_guardrails ?? null,
          residualRisks: outcomeRow.residual_risks ?? null,
          followUpActions: outcomeRow.follow_up_actions ?? null,
          implementationTargetDate: outcomeRow.implementation_target_date ?? null,
          signoffStatus: outcomeRow.signoff_status ?? null,
          signoffEvidenceUrl: outcomeRow.signoff_evidence_url ?? null,
          closureNote: outcomeRow.closure_note ?? null,
          closedAt: outcomeRow.closed_at ?? null,
        }
      : null,
    evidence: {
      externalReferences: evidenceRefs,
      btpmContextLinks: btpmLinks,
      crossProjectLinks: crossRefs,
      counts: {
        externalReferences: evidenceRefs.length,
        btpmContextLinks: btpmLinks.length,
        crossProjectLinks: crossRefs.length,
      },
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
export function decisionBriefFilenameFor(projectName: string, caseTitle: string): string {
  const p = (projectName || "Project").replace(FILENAME_BAD, "").trim() || "Project";
  const t = (caseTitle || "Decision Case").replace(FILENAME_BAD, "").trim() || "Decision Case";
  return `Decision Brief - ${p} - ${t}.docx`;
}
