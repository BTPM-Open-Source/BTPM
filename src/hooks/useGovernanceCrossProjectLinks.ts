/**
 * DC.6 — Governance Record Cross-Project Links (Decision Cases).
 *
 * Controlled project-level cross-project context. All reads/writes go through
 * protected SECURITY DEFINER RPCs:
 *   list_governance_record_cross_project_links
 *   create_governance_record_cross_project_link
 *   update_governance_record_cross_project_link
 *   archive_governance_record_cross_project_link
 *   restore_governance_record_cross_project_link
 *
 * No direct table access.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const GOVERNANCE_CROSS_PROJECT_RELATIONSHIPS = [
  { value: "formal_dependency", label: "Formal dependency" },
  { value: "shared_risk", label: "Shared risk" },
  { value: "shared_blocker", label: "Shared blocker" },
  { value: "shared_milestone", label: "Shared milestone" },
  { value: "manual_related", label: "Manually related" },
  { value: "other", label: "Other" },
] as const;
export type GovernanceCrossProjectRelationshipType =
  (typeof GOVERNANCE_CROSS_PROJECT_RELATIONSHIPS)[number]["value"];

export function crossProjectRelationshipLabel(v: string): string {
  return (
    GOVERNANCE_CROSS_PROJECT_RELATIONSHIPS.find((t) => t.value === v)?.label ?? v
  );
}

export type GovernanceRecordCrossProjectLink = {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  governance_record_id: string;
  linked_project_id: string;
  linked_project_workspace_id: string;
  relationship_type: GovernanceCrossProjectRelationshipType | string;
  relationship_reason: string | null;
  source_dependency_id: string | null;
  included_in_package: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  archived_at: string | null;
  archived_by: string | null;
  linked_project_name: string;
  linked_project_status: string | null;
  linked_project_priority: string | null;
  linked_project_workspace_name: string | null;
  linked_project_program_id: string | null;
  linked_project_program_name: string | null;
};

const keyList = (recordId: string, includeArchived: boolean) =>
  ["governance-record-cross-project-links", recordId, includeArchived] as const;

function invalidate(qc: ReturnType<typeof useQueryClient>, recordId: string) {
  qc.invalidateQueries({
    queryKey: ["governance-record-cross-project-links", recordId],
  });
}

export function useGovernanceRecordCrossProjectLinks(
  recordId: string | null | undefined,
  includeArchived: boolean,
) {
  return useQuery({
    queryKey: keyList(recordId ?? "", includeArchived),
    enabled: !!recordId,
    queryFn: async (): Promise<GovernanceRecordCrossProjectLink[]> => {
      if (!recordId) return [];
      const { data, error } = await supabase.rpc(
        "list_governance_record_cross_project_links",
        { _record_id: recordId, _include_archived: includeArchived },
      );
      if (error) throw error;
      return (
        (data as unknown as GovernanceRecordCrossProjectLink[] | null) ?? []
      );
    },
  });
}

export type CrossProjectCreateInput = {
  linked_project_id: string;
  relationship_type: GovernanceCrossProjectRelationshipType;
  relationship_reason?: string | null;
  source_dependency_id?: string | null;
  included_in_package: boolean;
};

export function useCreateGovernanceRecordCrossProjectLink(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CrossProjectCreateInput) => {
      const { data, error } = await supabase.rpc(
        "create_governance_record_cross_project_link",
        {
          _record_id: recordId,
          _linked_project_id: input.linked_project_id,
          _relationship_type: input.relationship_type,
          _relationship_reason: input.relationship_reason ?? undefined,
          _source_dependency_id: input.source_dependency_id ?? undefined,
          _included_in_package: input.included_in_package,
        },
      );
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export type CrossProjectUpdateInput = {
  cross_project_link_id: string;
  linked_project_id?: string;
  relationship_type?: GovernanceCrossProjectRelationshipType;
  relationship_reason?: string | null;
  source_dependency_id?: string | null;
  included_in_package?: boolean;
  clear_relationship_reason?: boolean;
  clear_source_dependency_id?: boolean;
};

export function useUpdateGovernanceRecordCrossProjectLink(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CrossProjectUpdateInput) => {
      const { error } = await supabase.rpc(
        "update_governance_record_cross_project_link",
        {
          _cross_project_link_id: input.cross_project_link_id,
          _linked_project_id: input.linked_project_id ?? undefined,
          _relationship_type: input.relationship_type ?? undefined,
          _relationship_reason: input.relationship_reason ?? undefined,
          _source_dependency_id: input.source_dependency_id ?? undefined,
          _included_in_package: input.included_in_package ?? undefined,
          _clear_relationship_reason: input.clear_relationship_reason ?? false,
          _clear_source_dependency_id:
            input.clear_source_dependency_id ?? false,
        },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function useArchiveGovernanceRecordCrossProjectLink(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc(
        "archive_governance_record_cross_project_link",
        { _cross_project_link_id: id },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function useRestoreGovernanceRecordCrossProjectLink(recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc(
        "restore_governance_record_cross_project_link",
        { _cross_project_link_id: id },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, recordId),
  });
}

export function mapCrossProjectMutationError(
  e: unknown,
  fallback: string,
): string {
  const msg = String((e as any)?.message ?? e ?? "");
  const lower = msg.toLowerCase();
  if (lower.includes("forbidden") || msg.includes("42501")) {
    return "You do not have permission to manage cross-project links on this decision case.";
  }
  if (lower.includes("same organization")) {
    return "Linked project must belong to the same organization.";
  }
  if (lower.includes("parent project itself")) {
    return "Cross-project link cannot reference the current project.";
  }
  if (lower.includes("do not have access")) {
    return "You do not have access to the linked project.";
  }
  if (lower.includes("invalid relationship_type")) {
    return "Invalid relationship type.";
  }
  if (lower.includes("project-to-project dependency")) {
    return "Source dependency must be a project-to-project dependency.";
  }
  return msg || fallback;
}
