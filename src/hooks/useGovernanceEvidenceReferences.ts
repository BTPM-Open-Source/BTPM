/**
 * DC.4 — Governance Record Evidence References (Decision Cases).
 *
 * All reads/writes go through protected SECURITY DEFINER RPCs:
 *   list_governance_record_evidence_references
 *   create_governance_record_evidence_reference
 *   update_governance_record_evidence_reference
 *   archive_governance_record_evidence_reference
 *   restore_governance_record_evidence_reference
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const GOVERNANCE_EVIDENCE_TYPES = [
  { value: "sharepoint_file", label: "SharePoint file" },
  { value: "onenote_page", label: "OneNote page" },
  { value: "outlook_reference", label: "Outlook reference" },
  { value: "teams_reference", label: "Teams reference" },
  { value: "meeting_minutes", label: "Meeting minutes (MoM)" },
  { value: "other_link", label: "Other link" },
] as const;
export type GovernanceEvidenceType =
  (typeof GOVERNANCE_EVIDENCE_TYPES)[number]["value"];

export function evidenceTypeLabel(v: string): string {
  return GOVERNANCE_EVIDENCE_TYPES.find((t) => t.value === v)?.label ?? v;
}

export const GOVERNANCE_EVIDENCE_RELEVANCE = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;
export type GovernanceEvidenceRelevanceLevel =
  (typeof GOVERNANCE_EVIDENCE_RELEVANCE)[number]["value"];

export function relevanceLabel(v: string): string {
  return GOVERNANCE_EVIDENCE_RELEVANCE.find((t) => t.value === v)?.label ?? v;
}

export type GovernanceRecordEvidenceReference = {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  governance_record_id: string;
  evidence_type: GovernanceEvidenceType | string;
  title: string;
  external_url: string;
  summary: string | null;
  evidence_date: string | null;
  owner_stakeholder_id: string | null;
  relevance_level: GovernanceEvidenceRelevanceLevel | string;
  included_in_package: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  archived_at: string | null;
  archived_by: string | null;
};

const keyList = (recordId: string, includeArchived: boolean) =>
  ["governance-record-evidence-references", recordId, includeArchived] as const;

function invalidate(qc: ReturnType<typeof useQueryClient>, recordId: string) {
  qc.invalidateQueries({ queryKey: ["governance-record-evidence-references", recordId] });
  qc.invalidateQueries({ queryKey: ["governance-record-detail", recordId] });
}

export function useGovernanceRecordEvidenceReferences(
  recordId: string | null | undefined,
  includeArchived: boolean,
) {
  return useQuery({
    queryKey: keyList(recordId ?? "", includeArchived),
    enabled: !!recordId,
    queryFn: async (): Promise<GovernanceRecordEvidenceReference[]> => {
      if (!recordId) return [];
      const { data, error } = await supabase.rpc(
        "list_governance_record_evidence_references",
        { _record_id: recordId, _include_archived: includeArchived },
      );
      if (error) throw error;
      return (data as unknown as GovernanceRecordEvidenceReference[] | null) ?? [];
    },
  });
}

export type EvidenceCreateInput = {
  evidence_type: GovernanceEvidenceType;
  title: string;
  external_url: string;
  summary?: string | null;
  evidence_date?: string | null;
  owner_stakeholder_id?: string | null;
  relevance_level: GovernanceEvidenceRelevanceLevel;
  included_in_package: boolean;
};

export function useCreateGovernanceRecordEvidenceReference(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: EvidenceCreateInput) => {
      const { data, error } = await supabase.rpc(
        "create_governance_record_evidence_reference",
        {
          _record_id: recordId,
          _evidence_type: input.evidence_type,
          _title: input.title,
          _external_url: input.external_url,
          _summary: input.summary ?? undefined,
          _evidence_date: input.evidence_date ?? undefined,
          _owner_stakeholder_id: input.owner_stakeholder_id ?? undefined,
          _relevance_level: input.relevance_level,
          _included_in_package: input.included_in_package,
        },
      );
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export type EvidenceUpdateInput = {
  evidence_id: string;
  evidence_type?: GovernanceEvidenceType;
  title?: string;
  external_url?: string;
  summary?: string | null;
  evidence_date?: string | null;
  owner_stakeholder_id?: string | null;
  relevance_level?: GovernanceEvidenceRelevanceLevel;
  included_in_package?: boolean;
  clear_summary?: boolean;
  clear_evidence_date?: boolean;
  clear_owner_stakeholder_id?: boolean;
};

export function useUpdateGovernanceRecordEvidenceReference(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: EvidenceUpdateInput) => {
      const { error } = await supabase.rpc(
        "update_governance_record_evidence_reference",
        {
          _evidence_id: input.evidence_id,
          _evidence_type: input.evidence_type ?? undefined,
          _title: input.title ?? undefined,
          _external_url: input.external_url ?? undefined,
          _summary: input.summary ?? undefined,
          _evidence_date: input.evidence_date ?? undefined,
          _owner_stakeholder_id: input.owner_stakeholder_id ?? undefined,
          _relevance_level: input.relevance_level ?? undefined,
          _included_in_package: input.included_in_package ?? undefined,
          _clear_summary: input.clear_summary ?? false,
          _clear_evidence_date: input.clear_evidence_date ?? false,
          _clear_owner_stakeholder_id: input.clear_owner_stakeholder_id ?? false,
        },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function useArchiveGovernanceRecordEvidenceReference(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (evidenceId: string) => {
      const { error } = await supabase.rpc(
        "archive_governance_record_evidence_reference",
        { _evidence_id: evidenceId },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function useRestoreGovernanceRecordEvidenceReference(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (evidenceId: string) => {
      const { error } = await supabase.rpc(
        "restore_governance_record_evidence_reference",
        { _evidence_id: evidenceId },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function mapEvidenceMutationError(e: unknown, fallback: string): string {
  const msg = String((e as any)?.message ?? e ?? "");
  if (msg.toLowerCase().includes("forbidden") || msg.includes("42501")) {
    return "You do not have permission to manage evidence on this decision case.";
  }
  if (msg.toLowerCase().includes("does not belong to this project")) {
    return "Selected owner is not a stakeholder on this project.";
  }
  if (msg.toLowerCase().includes("http://") || msg.toLowerCase().includes("https://")) {
    return "External URL must start with http:// or https://.";
  }
  return msg || fallback;
}
