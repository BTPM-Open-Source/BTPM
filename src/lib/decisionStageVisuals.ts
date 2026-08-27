/**
 * Semantic badge classes for governance decision-case stages.
 *
 * Decision stages are a lifecycle (not workflow status), so they do not map
 * 1:1 onto the PM_WORKFLOW_STATUS palette. We reuse the BTPM-aligned hex
 * tokens so the visuals stay consistent with the rest of BTPM and never use
 * the brand red (`primary`), which is reserved for CTAs.
 *
 * Tone mapping:
 *   initiated / evidence_collection / brief_prepared → neutral grey (in flight)
 *   provided_to_stakeholders / pending_decision      → amber (awaiting)
 *   decision_taken                                    → green (resolved)
 *   closed                                            → navy (completed)
 */
import type { DecisionStage } from "@/hooks/useProjectGovernance";

const DECISION_STAGE_BADGE_CLASS: Record<DecisionStage, string> = {
  initiated: "bg-[#94A3B8]/10 text-[#94A3B8] border-[#94A3B8]/20",
  evidence_collection: "bg-[#0EA5E9]/10 text-[#0EA5E9] border-[#0EA5E9]/20",
  brief_prepared: "bg-[#0EA5E9]/10 text-[#0EA5E9] border-[#0EA5E9]/20",
  provided_to_stakeholders: "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20",
  pending_decision: "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20",
  decision_taken: "bg-[#059669]/10 text-[#059669] border-[#059669]/20",
  closed: "bg-[#2563EB]/10 text-[#2563EB] border-[#2563EB]/20",
};

export function getDecisionStageBadgeClass(
  stage: DecisionStage | string | null | undefined,
): string {
  if (!stage) return DECISION_STAGE_BADGE_CLASS.initiated;
  return (
    DECISION_STAGE_BADGE_CLASS[stage as DecisionStage] ??
    "bg-[#94A3B8]/10 text-[#94A3B8] border-[#94A3B8]/20"
  );
}
