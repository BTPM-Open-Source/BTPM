/**
 * DC.9 — Governance Record Stakeholder Packages (Decision Cases).
 *
 * Versioned stakeholder-ready package drafts. Reads/writes go through
 * protected RPCs:
 *   list_governance_record_stakeholder_packages
 *   create_governance_record_stakeholder_package
 *   set_current_governance_record_stakeholder_package
 *   mark_governance_record_stakeholder_package_provided
 *
 * No direct table access.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const GOVERNANCE_STAKEHOLDER_PACKAGE_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "ready", label: "Ready" },
  { value: "provided", label: "Provided to stakeholders" },
] as const;

export type GovernanceStakeholderPackageStatus =
  (typeof GOVERNANCE_STAKEHOLDER_PACKAGE_STATUSES)[number]["value"];

export function stakeholderPackageStatusLabel(v: string): string {
  return (
    GOVERNANCE_STAKEHOLDER_PACKAGE_STATUSES.find((o) => o.value === v)?.label ??
    v
  );
}

export type GovernanceRecordStakeholderPackage = {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  governance_record_id: string;
  version_number: number;
  is_current: boolean;
  package_status: GovernanceStakeholderPackageStatus | string;
  audience_text: string | null;
  package_title: string | null;
  executive_summary: string | null;
  decision_question_text: string | null;
  background_context: string | null;
  options_summary: string | null;
  recommendation_text: string | null;
  decision_ask_text: string | null;
  evidence_summary: string | null;
  guardrails_text: string | null;
  residual_risks_text: string | null;
  next_steps_text: string | null;
  distribution_note: string | null;
  distribution_evidence_url: string | null;
  provided_to_stakeholders_at: string | null;
  provided_to_stakeholders_by: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
};

const key = (recordId: string) =>
  ["governance-record-stakeholder-packages", recordId] as const;

function invalidate(qc: ReturnType<typeof useQueryClient>, recordId: string) {
  qc.invalidateQueries({ queryKey: key(recordId) });
  qc.invalidateQueries({ queryKey: ["governance-record-detail", recordId] });
  qc.invalidateQueries({ queryKey: ["governance-records"] });
  qc.invalidateQueries({ queryKey: ["project-governance"] });
}

export function useGovernanceRecordStakeholderPackages(
  recordId: string | null | undefined,
) {
  return useQuery({
    queryKey: key(recordId ?? ""),
    enabled: !!recordId,
    queryFn: async (): Promise<GovernanceRecordStakeholderPackage[]> => {
      if (!recordId) return [];
      const { data, error } = await supabase.rpc(
        "list_governance_record_stakeholder_packages" as any,
        { _record_id: recordId } as any,
      );
      if (error) throw error;
      return (
        (data as unknown as GovernanceRecordStakeholderPackage[] | null) ?? []
      );
    },
  });
}

export type CreateStakeholderPackageInput = {
  package_title: string;
  package_status?: GovernanceStakeholderPackageStatus;
  audience_text?: string | null;
  executive_summary?: string | null;
  decision_question_text?: string | null;
  background_context?: string | null;
  options_summary?: string | null;
  recommendation_text?: string | null;
  decision_ask_text?: string | null;
  evidence_summary?: string | null;
  guardrails_text?: string | null;
  residual_risks_text?: string | null;
  next_steps_text?: string | null;
  distribution_note?: string | null;
  distribution_evidence_url?: string | null;
  make_current?: boolean;
};

export function useCreateGovernanceRecordStakeholderPackage(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateStakeholderPackageInput) => {
      const { data, error } = await supabase.rpc(
        "create_governance_record_stakeholder_package" as any,
        {
          _record_id: recordId,
          _package_title: input.package_title,
          _package_status: input.package_status ?? "draft",
          _audience_text: input.audience_text ?? undefined,
          _executive_summary: input.executive_summary ?? undefined,
          _decision_question_text: input.decision_question_text ?? undefined,
          _background_context: input.background_context ?? undefined,
          _options_summary: input.options_summary ?? undefined,
          _recommendation_text: input.recommendation_text ?? undefined,
          _decision_ask_text: input.decision_ask_text ?? undefined,
          _evidence_summary: input.evidence_summary ?? undefined,
          _guardrails_text: input.guardrails_text ?? undefined,
          _residual_risks_text: input.residual_risks_text ?? undefined,
          _next_steps_text: input.next_steps_text ?? undefined,
          _distribution_note: input.distribution_note ?? undefined,
          _distribution_evidence_url:
            input.distribution_evidence_url ?? undefined,
          _make_current: input.make_current ?? true,
        } as any,
      );
      if (error) throw error;
      return data as unknown as { id: string; version_number: number };
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function useSetCurrentGovernanceRecordStakeholderPackage(
  recordId: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc(
        "set_current_governance_record_stakeholder_package" as any,
        { _package_id: id } as any,
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export type MarkProvidedInput = {
  package_id: string;
  distribution_note?: string | null;
  distribution_evidence_url?: string | null;
};

export function useMarkGovernanceRecordStakeholderPackageProvided(
  recordId: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MarkProvidedInput) => {
      const { error } = await supabase.rpc(
        "mark_governance_record_stakeholder_package_provided" as any,
        {
          _package_id: input.package_id,
          _distribution_note: input.distribution_note ?? undefined,
          _distribution_evidence_url:
            input.distribution_evidence_url ?? undefined,
        } as any,
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function mapStakeholderPackageError(
  e: unknown,
  fallback: string,
): string {
  const msg = String((e as any)?.message ?? e ?? "");
  const lower = msg.toLowerCase();
  if (lower.includes("forbidden") || msg.includes("42501")) {
    return "You do not have permission to manage stakeholder packages on this decision case.";
  }
  if (lower.includes("package_title is required")) {
    return "Package title is required.";
  }
  if (lower.includes("invalid package_status")) {
    return "Invalid package status.";
  }
  if (lower.includes("distribution_evidence_url must start with")) {
    return "Distribution evidence URL must start with http:// or https://.";
  }
  if (lower.includes("decision_case")) {
    return "Stakeholder packages are only available for decision cases.";
  }
  return msg || fallback;
}
