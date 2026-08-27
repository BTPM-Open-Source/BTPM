/**
 * DC.8 — Governance Record Decision Outcome (formal Decision Taken & Closure).
 *
 * All reads/writes go through protected RPCs:
 *   get_governance_record_decision_outcome
 *   upsert_governance_record_decision_outcome
 *   close_governance_decision_case
 *
 * No direct table access.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const GOVERNANCE_DECISION_RESULTS = [
  { value: "approved", label: "Approved" },
  { value: "approved_with_conditions", label: "Approved with conditions" },
  { value: "rejected", label: "Rejected" },
  { value: "deferred", label: "Deferred" },
] as const;
export type GovernanceDecisionResult =
  (typeof GOVERNANCE_DECISION_RESULTS)[number]["value"];

export const GOVERNANCE_SIGNOFF_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "ready_for_signoff", label: "Ready for sign-off" },
  { value: "signed_off", label: "Signed off" },
] as const;
export type GovernanceSignoffStatus =
  (typeof GOVERNANCE_SIGNOFF_STATUSES)[number]["value"];

export function decisionResultLabel(v: string): string {
  return GOVERNANCE_DECISION_RESULTS.find((o) => o.value === v)?.label ?? v;
}
export function signoffStatusLabel(v: string): string {
  return GOVERNANCE_SIGNOFF_STATUSES.find((o) => o.value === v)?.label ?? v;
}

export type GovernanceRecordDecisionOutcome = {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  governance_record_id: string;
  decision_result: GovernanceDecisionResult | string;
  final_decision_text: string;
  decision_date: string;
  decided_by_text: string | null;
  approval_forum: string | null;
  decision_rationale: string | null;
  conditions_guardrails: string | null;
  residual_risks: string | null;
  follow_up_actions: string | null;
  implementation_owner_stakeholder_id: string | null;
  implementation_target_date: string | null;
  signoff_status: GovernanceSignoffStatus | string;
  signoff_evidence_url: string | null;
  closure_note: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
};

const key = (recordId: string) =>
  ["governance-record-decision-outcome", recordId] as const;

function invalidate(qc: ReturnType<typeof useQueryClient>, recordId: string) {
  qc.invalidateQueries({ queryKey: key(recordId) });
  qc.invalidateQueries({ queryKey: ["governance-record-detail", recordId] });
  qc.invalidateQueries({ queryKey: ["governance-records"] });
  qc.invalidateQueries({ queryKey: ["project-governance"] });
}

export function useGovernanceRecordDecisionOutcome(
  recordId: string | null | undefined,
) {
  return useQuery({
    queryKey: key(recordId ?? ""),
    enabled: !!recordId,
    queryFn: async (): Promise<GovernanceRecordDecisionOutcome | null> => {
      if (!recordId) return null;
      const { data, error } = await supabase.rpc(
        "get_governance_record_decision_outcome",
        { _record_id: recordId },
      );
      if (error) throw error;
      return (data as unknown as GovernanceRecordDecisionOutcome | null) ?? null;
    },
  });
}

export type UpsertDecisionOutcomeInput = {
  decision_result: GovernanceDecisionResult;
  final_decision_text: string;
  decision_date: string;
  decided_by_text?: string | null;
  approval_forum?: string | null;
  decision_rationale?: string | null;
  conditions_guardrails?: string | null;
  residual_risks?: string | null;
  follow_up_actions?: string | null;
  implementation_owner_stakeholder_id?: string | null;
  implementation_target_date?: string | null;
  signoff_status?: GovernanceSignoffStatus;
  signoff_evidence_url?: string | null;
};

export function useUpsertGovernanceRecordDecisionOutcome(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertDecisionOutcomeInput) => {
      const { data, error } = await supabase.rpc(
        "upsert_governance_record_decision_outcome",
        {
          _record_id: recordId,
          _decision_result: input.decision_result,
          _final_decision_text: input.final_decision_text,
          _decision_date: input.decision_date,
          _decided_by_text: input.decided_by_text ?? undefined,
          _approval_forum: input.approval_forum ?? undefined,
          _decision_rationale: input.decision_rationale ?? undefined,
          _conditions_guardrails: input.conditions_guardrails ?? undefined,
          _residual_risks: input.residual_risks ?? undefined,
          _follow_up_actions: input.follow_up_actions ?? undefined,
          _implementation_owner_stakeholder_id:
            input.implementation_owner_stakeholder_id ?? undefined,
          _implementation_target_date:
            input.implementation_target_date ?? undefined,
          _signoff_status: input.signoff_status ?? "draft",
          _signoff_evidence_url: input.signoff_evidence_url ?? undefined,
        },
      );
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function useCloseGovernanceDecisionCase(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (closure_note?: string | null) => {
      const { error } = await supabase.rpc("close_governance_decision_case", {
        _record_id: recordId,
        _closure_note: closure_note ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function mapDecisionOutcomeError(
  e: unknown,
  fallback: string,
): string {
  const msg = String((e as any)?.message ?? e ?? "");
  const lower = msg.toLowerCase();
  if (lower.includes("forbidden") || msg.includes("42501")) {
    return "You do not have permission to record the decision outcome on this decision case.";
  }
  if (lower.includes("closed decision cases cannot be edited")) {
    return "This decision case is closed and can no longer be edited.";
  }
  if (lower.includes("decision case is already closed")) {
    return "This decision case is already closed.";
  }
  if (lower.includes("signoff_evidence_url must start with")) {
    return "Sign-off evidence URL must start with http:// or https://.";
  }
  if (lower.includes("final_decision_text is required")) {
    return "Final decision text is required.";
  }
  if (lower.includes("decision_date is required")) {
    return "Decision date is required.";
  }
  if (lower.includes("invalid decision_result")) {
    return "Invalid decision result.";
  }
  if (lower.includes("invalid signoff_status")) {
    return "Invalid sign-off status.";
  }
  if (lower.includes("does not belong to this project")) {
    return "Implementation owner must belong to this project.";
  }
  if (lower.includes("must be recorded before closing")) {
    return "Save a decision outcome before closing the decision case.";
  }
  if (lower.includes("decision_case")) {
    return "This action is only available for decision cases.";
  }
  return msg || fallback;
}
