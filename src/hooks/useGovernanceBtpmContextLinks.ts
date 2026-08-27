/**
 * DC.13 — Unified BTPM Context links for Decision Cases.
 *
 * All reads/writes go through protected SECURITY DEFINER RPCs:
 *   list_governance_record_btpm_context_links
 *   create_governance_record_btpm_context_link
 *   update_governance_record_btpm_context_link
 *   archive_governance_record_btpm_context_link
 *   restore_governance_record_btpm_context_link
 *
 * No direct table access.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const GOVERNANCE_BTPM_CONTEXT_OBJECT_TYPES = [
  { value: "project", label: "Project" },
  { value: "phase", label: "Phase" },
  { value: "task", label: "Task" },
  { value: "risk", label: "Risk" },
  { value: "blocker", label: "Blocker" },
  { value: "kpi_definition", label: "KPI definition" },
  { value: "kpi_update", label: "KPI update" },
] as const;
export type GovernanceBtpmContextObjectType =
  (typeof GOVERNANCE_BTPM_CONTEXT_OBJECT_TYPES)[number]["value"];

export const GOVERNANCE_BTPM_CONTEXT_RELATIONSHIPS = [
  { value: "directly_relevant", label: "Directly relevant" },
  { value: "dependency", label: "Dependency" },
  { value: "shared_risk", label: "Shared risk" },
  { value: "shared_blocker", label: "Shared blocker" },
  { value: "shared_milestone", label: "Shared milestone" },
  { value: "implementation_source", label: "Implementation source" },
  { value: "other", label: "Other" },
] as const;
export type GovernanceBtpmContextRelationshipType =
  (typeof GOVERNANCE_BTPM_CONTEXT_RELATIONSHIPS)[number]["value"];

export const GOVERNANCE_BTPM_CONTEXT_RELEVANCE_LEVELS = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;
export type GovernanceBtpmContextRelevanceLevel =
  (typeof GOVERNANCE_BTPM_CONTEXT_RELEVANCE_LEVELS)[number]["value"];

export function btpmContextObjectTypeLabel(v: string): string {
  return (
    GOVERNANCE_BTPM_CONTEXT_OBJECT_TYPES.find((t) => t.value === v)?.label ?? v
  );
}
export function btpmContextRelationshipLabel(v: string): string {
  return (
    GOVERNANCE_BTPM_CONTEXT_RELATIONSHIPS.find((t) => t.value === v)?.label ?? v
  );
}
export function btpmContextRelevanceLabel(v: string): string {
  return (
    GOVERNANCE_BTPM_CONTEXT_RELEVANCE_LEVELS.find((t) => t.value === v)?.label ??
    v
  );
}

export type GovernanceRecordBtpmContextLink = {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  governance_record_id: string;
  source_project_id: string;
  source_workspace_id: string;
  object_type: GovernanceBtpmContextObjectType | string;
  object_id: string;
  relationship_type: GovernanceBtpmContextRelationshipType | string;
  context_reason: string | null;
  relevance_level: GovernanceBtpmContextRelevanceLevel | string;
  included_in_package: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  archived_at: string | null;
  archived_by: string | null;
  source_project_name: string | null;
  source_workspace_name: string | null;
  source_program_id: string | null;
  source_program_name: string | null;
  source_project_status: string | null;
  source_project_priority: string | null;
  object_name: string | null;
  object_status: string | null;
};

const keyList = (recordId: string, includeArchived: boolean) =>
  ["governance-record-btpm-context-links", recordId, includeArchived] as const;

function invalidate(qc: ReturnType<typeof useQueryClient>, recordId: string) {
  qc.invalidateQueries({
    queryKey: ["governance-record-btpm-context-links", recordId],
  });
}

export function useGovernanceRecordBtpmContextLinks(
  recordId: string | null | undefined,
  includeArchived: boolean,
) {
  return useQuery({
    queryKey: keyList(recordId ?? "", includeArchived),
    enabled: !!recordId,
    queryFn: async (): Promise<GovernanceRecordBtpmContextLink[]> => {
      if (!recordId) return [];
      const { data, error } = await supabase.rpc(
        "list_governance_record_btpm_context_links" as any,
        { _record_id: recordId, _include_archived: includeArchived },
      );
      if (error) throw error;
      return (
        (data as unknown as GovernanceRecordBtpmContextLink[] | null) ?? []
      );
    },
  });
}

export type BtpmContextCreateInput = {
  source_project_id: string;
  object_type: GovernanceBtpmContextObjectType;
  object_id: string;
  relationship_type?: GovernanceBtpmContextRelationshipType;
  context_reason?: string | null;
  relevance_level?: GovernanceBtpmContextRelevanceLevel;
  included_in_package?: boolean;
};

export function useCreateGovernanceRecordBtpmContextLink(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BtpmContextCreateInput) => {
      const { data, error } = await supabase.rpc(
        "create_governance_record_btpm_context_link" as any,
        {
          _record_id: recordId,
          _source_project_id: input.source_project_id,
          _object_type: input.object_type,
          _object_id: input.object_id,
          _relationship_type: input.relationship_type ?? "directly_relevant",
          _context_reason: input.context_reason ?? undefined,
          _relevance_level: input.relevance_level ?? "medium",
          _included_in_package: input.included_in_package ?? true,
        },
      );
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export type BtpmContextUpdateInput = {
  context_link_id: string;
  source_project_id?: string;
  object_type?: GovernanceBtpmContextObjectType;
  object_id?: string;
  relationship_type?: GovernanceBtpmContextRelationshipType;
  context_reason?: string | null;
  relevance_level?: GovernanceBtpmContextRelevanceLevel;
  included_in_package?: boolean;
  clear_context_reason?: boolean;
};

export function useUpdateGovernanceRecordBtpmContextLink(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BtpmContextUpdateInput) => {
      const { error } = await supabase.rpc(
        "update_governance_record_btpm_context_link" as any,
        {
          _context_link_id: input.context_link_id,
          _source_project_id: input.source_project_id ?? undefined,
          _object_type: input.object_type ?? undefined,
          _object_id: input.object_id ?? undefined,
          _relationship_type: input.relationship_type ?? undefined,
          _context_reason: input.context_reason ?? undefined,
          _relevance_level: input.relevance_level ?? undefined,
          _included_in_package: input.included_in_package ?? undefined,
          _clear_context_reason: input.clear_context_reason ?? false,
        },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function useArchiveGovernanceRecordBtpmContextLink(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc(
        "archive_governance_record_btpm_context_link" as any,
        { _context_link_id: id },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function useRestoreGovernanceRecordBtpmContextLink(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc(
        "restore_governance_record_btpm_context_link" as any,
        { _context_link_id: id },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function mapBtpmContextMutationError(
  e: unknown,
  fallback: string,
): string {
  const msg = String((e as any)?.message ?? e ?? "");
  const lower = msg.toLowerCase();
  if (lower.includes("forbidden") || msg.includes("42501")) {
    return "You do not have permission to manage BTPM context on this decision case.";
  }
  if (lower.includes("same organization")) {
    return "Source project must belong to the same organization.";
  }
  if (lower.includes("does not have access") || lower.includes("do not have access")) {
    return "You do not have access to the source project.";
  }
  if (lower.includes("does not belong to source project")) {
    return "Selected item does not belong to that source project.";
  }
  if (lower.includes("invalid object_type")) return "Invalid object type.";
  if (lower.includes("invalid relationship_type")) return "Invalid relationship type.";
  if (lower.includes("invalid relevance_level")) return "Invalid relevance level.";
  return msg || fallback;
}
