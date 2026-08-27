/**
 * DC.7 — Governance Record Brief Versions (Decision Cases).
 *
 * Versioned Copilot brief drafts. Reads/writes go through protected RPCs:
 *   list_governance_record_brief_versions
 *   create_governance_record_brief_version
 *   set_current_governance_record_brief_version
 *
 * No direct table access.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Full set of brief source types known to the backend. Kept for display and
 * for backward compatibility with previously-saved versions.
 */
export const GOVERNANCE_BRIEF_SOURCE_TYPES = [
  { value: "copilot_paste", label: "Pasted from Copilot" },
  { value: "manual_edit", label: "Written manually" },
  { value: "btpm_generated", label: "BTPM generated draft" },
] as const;

/**
 * Source types that users may currently choose from in the draft form.
 * `btpm_generated` is intentionally excluded — BTPM does not yet generate
 * briefs, so users must not be able to claim that source manually. Existing
 * versions stored with that value are still displayed read-only.
 */
export const GOVERNANCE_BRIEF_USER_SELECTABLE_SOURCE_TYPES =
  GOVERNANCE_BRIEF_SOURCE_TYPES.filter(
    (t) => t.value !== "btpm_generated",
  );

export type GovernanceBriefSourceType =
  (typeof GOVERNANCE_BRIEF_SOURCE_TYPES)[number]["value"];

export function briefSourceLabel(v: string): string {
  return (
    GOVERNANCE_BRIEF_SOURCE_TYPES.find((t) => t.value === v)?.label ?? v
  );
}

export type GovernanceRecordBriefVersion = {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  governance_record_id: string;
  version_number: number;
  source_type: GovernanceBriefSourceType | string;
  is_current: boolean;
  raw_copilot_output: string | null;
  edited_brief_text: string | null;
  executive_intro_text: string | null;
  options_summary: string | null;
  recommendation_text: string | null;
  guardrails_text: string | null;
  residual_risks_text: string | null;
  requested_decision_text: string | null;
  open_questions_text: string | null;
  confidence_level: "high" | "medium" | "low" | null;
  decision_readiness:
    | "ready_for_decision"
    | "needs_clarification"
    | "not_ready"
    | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
};

const key = (recordId: string) =>
  ["governance-record-brief-versions", recordId] as const;

function invalidate(qc: ReturnType<typeof useQueryClient>, recordId: string) {
  qc.invalidateQueries({ queryKey: key(recordId) });
}

export function useGovernanceRecordBriefVersions(
  recordId: string | null | undefined,
) {
  return useQuery({
    queryKey: key(recordId ?? ""),
    enabled: !!recordId,
    queryFn: async (): Promise<GovernanceRecordBriefVersion[]> => {
      if (!recordId) return [];
      const { data, error } = await supabase.rpc(
        "list_governance_record_brief_versions",
        { _record_id: recordId },
      );
      if (error) throw error;
      return (data as unknown as GovernanceRecordBriefVersion[] | null) ?? [];
    },
  });
}

export type CreateBriefVersionInput = {
  source_type?: GovernanceBriefSourceType;
  raw_copilot_output?: string | null;
  edited_brief_text?: string | null;
  executive_intro_text?: string | null;
  options_summary?: string | null;
  recommendation_text?: string | null;
  guardrails_text?: string | null;
  residual_risks_text?: string | null;
  requested_decision_text?: string | null;
  make_current?: boolean;
};

export function useCreateGovernanceRecordBriefVersion(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBriefVersionInput) => {
      const { data, error } = await supabase.rpc(
        "create_governance_record_brief_version",
        {
          _record_id: recordId,
          _source_type: input.source_type ?? "copilot_paste",
          _raw_copilot_output: input.raw_copilot_output ?? undefined,
          _edited_brief_text: input.edited_brief_text ?? undefined,
          _executive_intro_text: input.executive_intro_text ?? undefined,
          _options_summary: input.options_summary ?? undefined,
          _recommendation_text: input.recommendation_text ?? undefined,
          _guardrails_text: input.guardrails_text ?? undefined,
          _residual_risks_text: input.residual_risks_text ?? undefined,
          _requested_decision_text:
            input.requested_decision_text ?? undefined,
          _make_current: input.make_current ?? true,
        },
      );
      if (error) throw error;
      return data as unknown as { id: string; version_number: number };
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function useSetCurrentGovernanceRecordBriefVersion(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc(
        "set_current_governance_record_brief_version",
        { _brief_version_id: id },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function mapBriefMutationError(e: unknown, fallback: string): string {
  const msg = String((e as any)?.message ?? e ?? "");
  const lower = msg.toLowerCase();
  if (lower.includes("forbidden") || msg.includes("42501")) {
    return "You do not have permission to manage Decision Brief versions on this decision case.";
  }
  if (lower.includes("at least one brief field")) {
    return "Add at least one brief field before saving.";
  }
  if (lower.includes("invalid source_type")) {
    return "Invalid source type.";
  }
  if (lower.includes("decision_case")) {
    return "Brief versions are only available for decision cases.";
  }
  return msg || fallback;
}
