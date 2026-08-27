/**
 * DC.15 — React hooks for SharePoint evidence files.
 *
 * Reads/updates via protected RPCs; browse/select via Edge Functions.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  browseGovernanceDecisionSharePointFiles,
  selectGovernanceDecisionSharePointEvidenceFiles,
  type BrowseResult,
  type SelectFileInput,
  type SelectResult,
} from "@/lib/governanceEvidenceFileService";

export type EvidenceFileRelevance = "high" | "medium" | "low";

export interface GovernanceRecordEvidenceFile {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  governance_record_id: string;
  source_system: string;
  site_id: string;
  drive_id: string;
  item_id: string;
  item_reference_hash: string;
  file_name: string;
  file_extension: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  etag: string | null;
  ctag: string | null;
  sharepoint_last_modified_at: string | null;
  sharepoint_created_at: string | null;
  parent_path: string | null;
  sharepoint_web_url: string | null;
  evidence_title: string;
  evidence_summary: string | null;
  evidence_date: string | null;
  relevance_level: EvidenceFileRelevance | string;
  included_in_package: boolean;
  selected_at: string;
  selected_by: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  archived_at: string | null;
  archived_by: string | null;
}

const keyList = (recordId: string, includeArchived: boolean) =>
  ["governance-record-evidence-files", recordId, includeArchived] as const;

function invalidate(qc: ReturnType<typeof useQueryClient>, recordId: string) {
  qc.invalidateQueries({ queryKey: ["governance-record-evidence-files", recordId] });
}

export function useGovernanceRecordEvidenceFiles(
  recordId: string | null | undefined,
  includeArchived: boolean,
) {
  return useQuery({
    queryKey: keyList(recordId ?? "", includeArchived),
    enabled: !!recordId,
    queryFn: async (): Promise<GovernanceRecordEvidenceFile[]> => {
      if (!recordId) return [];
      const { data, error } = await supabase.rpc(
        "list_governance_record_evidence_files",
        { _record_id: recordId, _include_archived: includeArchived },
      );
      if (error) throw error;
      return (data as unknown as GovernanceRecordEvidenceFile[] | null) ?? [];
    },
  });
}

export function useBrowseGovernanceDecisionSharePointFiles(recordId: string) {
  return useMutation<
    BrowseResult,
    Error,
    { folderDriveId?: string; folderItemId?: string }
  >({
    mutationFn: (args) =>
      browseGovernanceDecisionSharePointFiles(recordId, args.folderDriveId, args.folderItemId),
  });
}

export function useSelectGovernanceDecisionSharePointEvidenceFiles(recordId: string) {
  const qc = useQueryClient();
  return useMutation<SelectResult, Error, SelectFileInput[]>({
    mutationFn: (items) => selectGovernanceDecisionSharePointEvidenceFiles(recordId, items),
    onSuccess: () => invalidate(qc, recordId),
  });
}

export type EvidenceFileUpdateInput = {
  evidence_file_id: string;
  evidence_title?: string;
  evidence_summary?: string | null;
  evidence_date?: string | null;
  relevance_level?: EvidenceFileRelevance;
  included_in_package?: boolean;
  clear_evidence_summary?: boolean;
};

export function useUpdateGovernanceRecordEvidenceFile(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: EvidenceFileUpdateInput) => {
      const { error } = await supabase.rpc("update_governance_record_evidence_file", {
        _evidence_file_id: input.evidence_file_id,
        _evidence_title: input.evidence_title ?? undefined,
        _evidence_summary: input.evidence_summary ?? undefined,
        _evidence_date: input.evidence_date ?? undefined,
        _relevance_level: input.relevance_level ?? undefined,
        _included_in_package: input.included_in_package ?? undefined,
        _clear_evidence_summary: input.clear_evidence_summary ?? false,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function useArchiveGovernanceRecordEvidenceFile(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (evidenceFileId: string) => {
      const { error } = await supabase.rpc("archive_governance_record_evidence_file", {
        _evidence_file_id: evidenceFileId,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function useRestoreGovernanceRecordEvidenceFile(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (evidenceFileId: string) => {
      const { error } = await supabase.rpc("restore_governance_record_evidence_file", {
        _evidence_file_id: evidenceFileId,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function mapEvidenceFileError(e: unknown, fallback: string): string {
  const msg = String((e as any)?.message ?? e ?? "");
  if (msg.toLowerCase().includes("forbidden") || msg.includes("42501")) {
    return "You do not have permission to manage evidence files on this decision case.";
  }
  return msg || fallback;
}
