/**
 * DC.14 + DC.16 — Decision Case Data Package hooks.
 *
 * Reads via SECURITY DEFINER RPCs; writes via Edge Functions. No direct
 * table access. DC.16 extends the package shape with ZIP bundle metadata
 * and adds bundle generation + signed-URL download mutations.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  generateDecisionCaseDataPackage,
  generateDecisionCaseDataPackageBundle,
  getDecisionCaseDataPackageBundleDownloadUrl,
} from "@/lib/decisionCaseDataPackageService";

export type GovernanceRecordCopilotDataPackage = {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  governance_record_id: string;
  version_number: number;
  is_current: boolean;
  package_status: "prepared" | "shared_externally" | "superseded" | string;
  package_filename: string;
  package_json: string;
  package_hash: string | null;
  source_project_ids: string[];
  source_snapshot_at: string;
  downloaded_at: string | null;
  downloaded_by: string | null;
  created_at: string;
  created_by: string | null;
  // DC.16
  package_format: "json_only" | "zip_bundle" | string;
  bundle_status: "not_generated" | "generated" | "partial" | "failed" | string;
  bundle_filename: string | null;
  bundle_mime_type: string | null;
  bundle_size_bytes: number | null;
  bundle_hash: string | null;
  bundle_generated_at: string | null;
  bundle_file_count: number | null;
  bundle_packaged_file_count: number | null;
  bundle_failed_file_count: number | null;
  bundle_metadata_only_count: number | null;
  bundle_downloaded_at: string | null;
  bundle_downloaded_by: string | null;
};

const key = (recordId: string) =>
  ["governance-record-copilot-data-packages", recordId] as const;

function invalidate(qc: ReturnType<typeof useQueryClient>, recordId: string) {
  qc.invalidateQueries({ queryKey: key(recordId) });
}

export function useGovernanceRecordCopilotDataPackages(
  recordId: string | null | undefined,
) {
  return useQuery({
    queryKey: key(recordId ?? ""),
    enabled: !!recordId,
    queryFn: async (): Promise<GovernanceRecordCopilotDataPackage[]> => {
      if (!recordId) return [];
      const { data, error } = await supabase.rpc(
        "list_governance_record_copilot_data_packages" as any,
        { _record_id: recordId },
      );
      if (error) throw error;
      return (data as unknown as GovernanceRecordCopilotDataPackage[] | null) ?? [];
    },
  });
}

export function useGenerateGovernanceRecordCopilotDataPackage(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => generateDecisionCaseDataPackage(recordId),
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function useGenerateGovernanceRecordCopilotDataPackageBundle(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => generateDecisionCaseDataPackageBundle(recordId),
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function useGetGovernanceRecordCopilotDataPackageBundleDownloadUrl(
  recordId: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (packageId: string) =>
      getDecisionCaseDataPackageBundleDownloadUrl(recordId, packageId),
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function useMarkGovernanceRecordCopilotDataPackageDownloaded(
  recordId: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (packageId: string) => {
      const { error } = await supabase.rpc(
        "mark_governance_record_copilot_data_package_downloaded" as any,
        { _package_id: packageId },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function useSetCurrentGovernanceRecordCopilotDataPackage(
  recordId: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (packageId: string) => {
      const { error } = await supabase.rpc(
        "set_current_governance_record_copilot_data_package" as any,
        { _package_id: packageId },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function mapCopilotDataPackageError(e: unknown, fallback: string): string {
  const msg = String((e as any)?.message ?? e ?? "");
  const lower = msg.toLowerCase();
  if (lower.includes("forbidden") || msg.includes("42501") || lower.includes("not_authorized")) {
    return "You do not have permission to manage data packages on this decision case.";
  }
  if (lower.includes("do not have access to source project")) {
    return "You no longer have access to one of the source projects in this package.";
  }
  if (lower.includes("not_decision_case") || lower.includes("decision_case")) {
    return "Data packages are only available for decision cases.";
  }
  return msg || fallback;
}
