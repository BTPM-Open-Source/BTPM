/**
 * DC.12 — Decision Case Lifecycle Progression.
 *
 * Thin React Query wrapper over protected RPC
 *   transition_governance_decision_case_stage(_record_id, _target_stage)
 *
 * No direct table access. Server enforces:
 *   - decision_case kind
 *   - project write authority
 *   - blocked when current stage is decision_taken or closed
 *   - target restricted to evidence_collection | brief_prepared | pending_decision
 *   - forward-only
 *   - brief_prepared requires a current brief version
 *   - pending_decision requires a current stakeholder package marked provided
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DecisionStageTransitionTarget =
  | "evidence_collection"
  | "brief_prepared"
  | "pending_decision";

export function useTransitionGovernanceDecisionCaseStage(
  recordId: string,
  projectId?: string | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (target: DecisionStageTransitionTarget) => {
      const { error } = await supabase.rpc(
        "transition_governance_decision_case_stage" as any,
        { _record_id: recordId, _target_stage: target } as any,
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["governance-record-detail", recordId] });
      if (projectId) {
        qc.invalidateQueries({ queryKey: ["project-governance-records", projectId] });
        qc.invalidateQueries({ queryKey: ["project-governance-summary", projectId] });
        qc.invalidateQueries({ queryKey: ["project-activity-events", projectId] });
      }
    },
  });
}

export function mapDecisionStageTransitionError(
  e: unknown,
  fallback: string,
): string {
  const msg = String((e as any)?.message ?? e ?? "");
  const lower = msg.toLowerCase();
  if (lower.includes("forbidden") || msg.includes("42501")) {
    return "You do not have permission to change the lifecycle stage on this decision case.";
  }
  if (lower.includes("create a copilot brief version")) {
    return "Save a current Decision Brief version before marking the brief as prepared.";
  }
  if (lower.includes("mark a stakeholder package as provided")) {
    return "Mark a stakeholder package as provided before moving to pending decision.";
  }
  if (lower.includes("forward-only")) {
    return "Stage transitions are forward-only.";
  }
  if (lower.includes("closed")) {
    return "This decision case is closed and cannot be transitioned.";
  }
  if (lower.includes("decision has been taken")) {
    return "A decision has been taken; further progression is handled by the closure flow.";
  }
  if (lower.includes("not allowed via lifecycle transition")) {
    return "That stage is not user-controllable from the lifecycle panel.";
  }
  if (lower.includes("decision_case")) {
    return "Lifecycle transitions are only available for decision cases.";
  }
  return msg || fallback;
}
