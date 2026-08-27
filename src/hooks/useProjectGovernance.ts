/**
 * Project Governance — read + mutation hooks (GT.3).
 *
 * All reads/writes go through SECURITY DEFINER RPCs from GT.1/GT.2:
 *   - list_project_governance_cadences
 *   - get_project_governance_summary
 *   - create_governance_cadence / update_governance_cadence
 *   - archive_governance_cadence / restore_governance_cadence
 *   - adjust_governance_cadence_next_expected_date
 *
 * No direct table access. No client-derived status. No persisted summary.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parsePmgCommandResult } from "@/lib/pmg/pmgContract";

// ─── Vocabulary (mirrors GT.1 CHECK enums + GT.2 derived status) ───

export const GOVERNANCE_EVENT_TYPES = [
  { value: "steerco", label: "SteerCo" },
  { value: "project_team_meeting", label: "Project Team Meeting" },
  { value: "sme_review", label: "SME Review" },
  { value: "risk_review", label: "Risk Review" },
  { value: "kpi_review", label: "KPI Review" },
  { value: "sponsor_check_in", label: "Sponsor Check-in" },
  { value: "vendor_review", label: "Vendor Review" },
  { value: "custom", label: "Custom" },
] as const;
export type GovernanceEventType = (typeof GOVERNANCE_EVENT_TYPES)[number]["value"];

export const GOVERNANCE_FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "ad_hoc", label: "Ad hoc / manual" },
] as const;
export type GovernanceFrequency = (typeof GOVERNANCE_FREQUENCIES)[number]["value"];

export type GovernanceDerivedStatus =
  | "inactive"
  | "ad_hoc"
  | "no_next_date"
  | "overdue"
  | "due_soon"
  | "on_track";

export function eventTypeLabel(v: string): string {
  return GOVERNANCE_EVENT_TYPES.find((t) => t.value === v)?.label ?? v;
}
export function frequencyLabel(v: string): string {
  return GOVERNANCE_FREQUENCIES.find((t) => t.value === v)?.label ?? v;
}

// ─── Types from RPCs ───

export type GovernanceCadenceRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  event_type: string;
  event_name: string | null;
  frequency_type: string;
  owner_id: string | null;
  owner_stakeholder_id: string | null;
  owner_display_name: string | null;
  next_expected_date: string | null;
  expected_evidence_type: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  archived_at: string | null;
  archived_by: string | null;
  // Derived (GT.2)
  last_completed_date: string | null;
  last_record_id: string | null;
  record_count: number;
  decision_count: number;
  link_count: number;
  derived_status: GovernanceDerivedStatus;
  is_overdue: boolean;
  is_due_soon: boolean;
};

export type ProjectGovernanceSummary = {
  project_id: string;
  active_cadence_count: number;
  archived_cadence_count: number;
  overdue_cadence_count: number;
  due_soon_cadence_count: number;
  ad_hoc_cadence_count: number;
  last_completed_governance_date: string | null;
  last_completed_record_id: string | null;
  next_expected_governance_date: string | null;
  next_expected_cadence_id: string | null;
  total_record_count: number;
  records_last_30_days: number;
  records_last_90_days: number;
  records_missing_sharepoint_evidence_count: number;
};

// ─── Reads ───

export function useProjectGovernanceCadences(
  projectId: string | undefined,
  includeArchived: boolean,
) {
  return useQuery({
    queryKey: ["project-governance-cadences", projectId, includeArchived],
    enabled: !!projectId,
    queryFn: async (): Promise<GovernanceCadenceRow[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc("list_project_governance_cadences", {
        _project_id: projectId,
        _include_archived: includeArchived,
      });
      if (error) throw error;
      return (data as unknown as GovernanceCadenceRow[] | null) ?? [];
    },
  });
}

export function useProjectGovernanceSummary(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-governance-summary", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectGovernanceSummary | null> => {
      if (!projectId) return null;
      const { data, error } = await supabase.rpc("get_project_governance_summary", {
        _project_id: projectId,
      });
      if (error) throw error;
      return (data as unknown as ProjectGovernanceSummary | null) ?? null;
    },
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>, projectId: string) {
  qc.invalidateQueries({ queryKey: ["project-governance-cadences", projectId] });
  qc.invalidateQueries({ queryKey: ["project-governance-summary", projectId] });
  qc.invalidateQueries({ queryKey: ["project-governance-records", projectId] });
  qc.invalidateQueries({ queryKey: ["project-activity-events", projectId] });
}

// ─── Mutations ───

export type CadenceCreateInput = {
  event_type: GovernanceEventType;
  frequency_type: GovernanceFrequency;
  event_name?: string | null;
  owner_id?: string | null;
  owner_stakeholder_id?: string | null;
  next_expected_date?: string | null;
  expected_evidence_type?: string | null;
};

export function useCreateGovernanceCadence(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CadenceCreateInput) => {
      const { data, error } = await supabase.rpc("create_governance_cadence", {
        _project_id: projectId,
        _event_type: input.event_type,
        _frequency_type: input.frequency_type,
        _event_name: input.event_name ?? null,
        _owner_id: input.owner_id ?? null,
        _owner_stakeholder_id: input.owner_stakeholder_id ?? null,
        _next_expected_date: input.next_expected_date ?? null,
        _expected_evidence_type: input.expected_evidence_type ?? null,
      } as any);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => invalidate(qc, projectId),
  });
}

export type CadenceUpdateInput = {
  cadence_id: string;
  event_type?: GovernanceEventType | null;
  frequency_type?: GovernanceFrequency | null;
  event_name?: string | null;
  owner_id?: string | null;
  owner_stakeholder_id?: string | null;
  next_expected_date?: string | null;
  expected_evidence_type?: string | null;
  clear_event_name?: boolean;
  clear_owner?: boolean;
  clear_owner_stakeholder?: boolean;
  clear_next_expected_date?: boolean;
  clear_expected_evidence_type?: boolean;
};

export function useUpdateGovernanceCadence(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CadenceUpdateInput) => {
      const { error } = await supabase.rpc("update_governance_cadence", {
        _cadence_id: input.cadence_id,
        _event_type: input.event_type ?? null,
        _frequency_type: input.frequency_type ?? null,
        _event_name: input.event_name ?? null,
        _owner_id: input.owner_id ?? null,
        _owner_stakeholder_id: input.owner_stakeholder_id ?? null,
        _next_expected_date: input.next_expected_date ?? null,
        _expected_evidence_type: input.expected_evidence_type ?? null,
        _clear_event_name: input.clear_event_name ?? false,
        _clear_owner: input.clear_owner ?? false,
        _clear_owner_stakeholder: input.clear_owner_stakeholder ?? false,
        _clear_next_expected_date: input.clear_next_expected_date ?? false,
        _clear_expected_evidence_type: input.clear_expected_evidence_type ?? false,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, projectId),
  });
}

export function useArchiveGovernanceCadence(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cadenceId: string) => {
      const { error } = await supabase.rpc("archive_governance_cadence", {
        _cadence_id: cadenceId,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, projectId),
  });
}

export function useRestoreGovernanceCadence(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cadenceId: string) => {
      const { error } = await supabase.rpc("restore_governance_cadence", {
        _cadence_id: cadenceId,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, projectId),
  });
}

export function useAdjustGovernanceCadenceNextDate(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { cadence_id: string; next_expected_date: string | null }) => {
      const { error } = await supabase.rpc("adjust_governance_cadence_next_expected_date", {
        _cadence_id: input.cadence_id,
        _next_expected_date: input.next_expected_date,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, projectId),
  });
}

// ─── Status badge helper (presentation only — not derived truth) ───

export function statusBadgeMeta(status: GovernanceDerivedStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case "overdue":
      return { label: "Overdue", className: "bg-destructive/15 text-destructive border-destructive/30" };
    case "due_soon":
      return { label: "Due soon", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" };
    case "on_track":
      return { label: "On track", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30" };
    case "ad_hoc":
      return { label: "Ad hoc", className: "bg-muted text-muted-foreground border-border" };
    case "no_next_date":
      return { label: "No next date", className: "bg-muted text-muted-foreground border-border" };
    case "inactive":
      return { label: "Inactive", className: "bg-muted text-muted-foreground border-border" };
    default:
      return { label: status, className: "bg-muted text-muted-foreground border-border" };
  }
}

// ─── Governance Records (GT.4) ───

export const GOVERNANCE_LINK_TYPES = [
  { value: "phase", label: "Phase (referenced)" },
  { value: "task", label: "Task" },
  { value: "risk", label: "Risk" },
  { value: "blocker", label: "Blocker" },
  { value: "kpi_definition", label: "KPI" },
] as const;
export type GovernanceLinkType = (typeof GOVERNANCE_LINK_TYPES)[number]["value"];

export const DECISION_STAGES = [
  "initiated",
  "evidence_collection",
  "brief_prepared",
  "provided_to_stakeholders",
  "pending_decision",
  "decision_taken",
  "closed",
] as const;
export type DecisionStage = (typeof DECISION_STAGES)[number];
export type GovernanceRecordKind = "evidence_record" | "decision_case";

export type GovernanceRecordRow = {
  id: string;
  project_id: string;
  organization_id: string;
  workspace_id: string;
  cadence_id: string | null;
  cadence_event_type: string | null;
  cadence_event_name: string | null;
  cadence_frequency_type: string | null;
  event_type: string;
  event_name: string | null;
  expected_date_snapshot: string | null;
  actual_date_held: string;
  summary: string | null;
  decisions_summary: string | null;
  external_reference_url: string | null;
  sharepoint_evidence_reference: string | null;
  record_kind: GovernanceRecordKind;
  decision_stage: DecisionStage | null;
  decision_question: string | null;
  decision_owner_stakeholder_id: string | null;
  target_decision_date: string | null;
  decision_count: number;
  link_count: number;
  has_sharepoint_evidence: boolean;
  archived_at: string | null;
  archived_by: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
};

export type GovernanceRecordDecision = {
  id: string;
  decision_text: string;
  decision_owner_id: string | null;
  decision_owner_stakeholder_id: string | null;
  target_date: string | null;
};

export type GovernanceRecordLink = {
  id: string;
  linked_object_type: GovernanceLinkType | string;
  linked_object_id: string;
};

export type GovernanceRecordDetail = GovernanceRecordRow & {
  decisions: GovernanceRecordDecision[];
  links: GovernanceRecordLink[];
};

export function useProjectGovernanceRecords(projectId: string | undefined, includeArchived: boolean) {
  return useQuery({
    queryKey: ["project-governance-records", projectId, includeArchived],
    enabled: !!projectId,
    queryFn: async (): Promise<GovernanceRecordRow[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc("list_project_governance_records", {
        _project_id: projectId,
        _include_archived: includeArchived,
      });
      if (error) throw error;
      return (data as unknown as GovernanceRecordRow[] | null) ?? [];
    },
  });
}

export function useGovernanceRecordDetail(recordId: string | null | undefined) {
  return useQuery({
    queryKey: ["governance-record-detail", recordId],
    enabled: !!recordId,
    queryFn: async (): Promise<GovernanceRecordDetail | null> => {
      if (!recordId) return null;
      const { data, error } = await supabase.rpc("get_governance_record_detail", {
        _record_id: recordId,
      });
      if (error) throw error;
      return (data as unknown as GovernanceRecordDetail | null) ?? null;
    },
  });
}

export type RecordCreateInput = {
  cadence_id?: string | null;
  event_type: GovernanceEventType;
  event_name?: string | null;
  actual_date_held: string;
  expected_date_snapshot?: string | null;
  summary?: string | null;
  decisions_summary?: string | null;
  external_reference_url?: string | null;
  sharepoint_evidence_reference?: string | null;
  record_kind?: GovernanceRecordKind | null;
  decision_stage?: DecisionStage | null;
  decision_question?: string | null;
  decision_owner_stakeholder_id?: string | null;
  target_decision_date?: string | null;
  /**
   * PMG.5C — Composite create. When provided (even as empty array), the
   * server replaces the record's structured decisions in the same
   * transaction as the record insert. Omit to skip the decisions setter.
   */
  decisions?: DecisionInput[] | null;
  /**
   * PMG.5C — Composite create. When provided (even as empty array), the
   * server replaces the record's linked objects in the same transaction.
   * Omit to skip the links setter.
   */
  links?: LinkInput[] | null;
};

export function useCreateGovernanceRecord(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordCreateInput) => {
      const { data, error } = await supabase.rpc(
        "apply_governance_record_create" as never,
        {
          _project_id: projectId,
          _event_type: input.event_type,
          _actual_date_held: input.actual_date_held,
          _cadence_id: input.cadence_id ?? undefined,
          _event_name: input.event_name ?? undefined,
          _expected_date_snapshot: input.expected_date_snapshot ?? undefined,
          _summary: input.summary ?? undefined,
          _decisions_summary: input.decisions_summary ?? undefined,
          _external_reference_url: input.external_reference_url ?? undefined,
          _sharepoint_evidence_reference: input.sharepoint_evidence_reference ?? undefined,
          _record_kind: input.record_kind ?? undefined,
          _decision_stage: input.decision_stage ?? undefined,
          _decision_question: input.decision_question ?? undefined,
          _decision_owner_stakeholder_id: input.decision_owner_stakeholder_id ?? undefined,
          _target_decision_date: input.target_decision_date ?? undefined,
          _decisions: input.decisions == null ? undefined : (input.decisions as unknown as never),
          _links: input.links == null ? undefined : (input.links as unknown as never),
        } as never,
      );
      if (error) throw error;
      const parsed = parsePmgCommandResult(data);
      if (parsed.status === "applied") {
        const id = (parsed.data as { id?: unknown } | null)?.id;
        if (typeof id !== "string") {
          throw new Error("apply_governance_record_create returned no id");
        }
        return id;
      }
      const reason =
        (parsed.data as { reason?: unknown } | null)?.reason;
      const message = typeof reason === "string" && reason.trim() !== ""
        ? reason
        : `Governance record create ${parsed.status}`;
      if (parsed.status === "not_authorized") {
        throw new Error(`forbidden: ${message}`);
      }
      throw new Error(message);
    },
    onSuccess: () => invalidate(qc, projectId),
  });
}

export type RecordUpdateInput = {
  record_id: string;
  /**
   * PMG.5D.1 — Governance-record `updated_at` value the client loaded.
   * Required. The server compares it against the locked row and returns
   * a `conflict` PMG result on mismatch (stale-write protection).
   */
  expected_updated_at: string;
  cadence_id?: string | null;
  event_type?: GovernanceEventType | null;
  event_name?: string | null;
  actual_date_held?: string | null;
  expected_date_snapshot?: string | null;
  summary?: string | null;
  decisions_summary?: string | null;
  external_reference_url?: string | null;
  sharepoint_evidence_reference?: string | null;
  clear_cadence?: boolean;
  clear_event_name?: boolean;
  clear_expected_date_snapshot?: boolean;
  clear_summary?: boolean;
  clear_decisions_summary?: boolean;
  clear_external_reference_url?: boolean;
  clear_sharepoint_evidence_reference?: boolean;
  decision_stage?: DecisionStage | null;
  decision_question?: string | null;
  decision_owner_stakeholder_id?: string | null;
  target_decision_date?: string | null;
  clear_decision_question?: boolean;
  clear_decision_owner_stakeholder_id?: boolean;
  clear_target_decision_date?: boolean;
};


export function useUpdateGovernanceRecord(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: RecordUpdateInput & {
        /**
         * PMG.5D — Composite update. When provided (even empty), the server
         * replaces the record's structured decisions in the same
         * transaction as the record update. Omit to skip the decisions setter.
         */
        decisions?: DecisionInput[] | null;
        /**
         * PMG.5D — Composite update. When provided (even empty), the server
         * replaces the record's linked objects in the same transaction.
         * Omit to skip the links setter.
         */
        links?: LinkInput[] | null;
      },
    ) => {
      const { data, error } = await supabase.rpc(
        "apply_governance_record_update" as never,
        {
          _record_id: input.record_id,
          _expected_updated_at: input.expected_updated_at,
          _cadence_id: input.cadence_id ?? undefined,

          _event_type: input.event_type ?? undefined,
          _event_name: input.event_name ?? undefined,
          _actual_date_held: input.actual_date_held ?? undefined,
          _expected_date_snapshot: input.expected_date_snapshot ?? undefined,
          _summary: input.summary ?? undefined,
          _decisions_summary: input.decisions_summary ?? undefined,
          _external_reference_url: input.external_reference_url ?? undefined,
          _sharepoint_evidence_reference: input.sharepoint_evidence_reference ?? undefined,
          _clear_cadence: input.clear_cadence ?? false,
          _clear_event_name: input.clear_event_name ?? false,
          _clear_expected_date_snapshot: input.clear_expected_date_snapshot ?? false,
          _clear_summary: input.clear_summary ?? false,
          _clear_decisions_summary: input.clear_decisions_summary ?? false,
          _clear_external_reference_url: input.clear_external_reference_url ?? false,
          _clear_sharepoint_evidence_reference: input.clear_sharepoint_evidence_reference ?? false,
          _decision_stage: input.decision_stage ?? undefined,
          _decision_question: input.decision_question ?? undefined,
          _decision_owner_stakeholder_id: input.decision_owner_stakeholder_id ?? undefined,
          _target_decision_date: input.target_decision_date ?? undefined,
          _clear_decision_question: input.clear_decision_question ?? false,
          _clear_decision_owner_stakeholder_id: input.clear_decision_owner_stakeholder_id ?? false,
          _clear_target_decision_date: input.clear_target_decision_date ?? false,
          _decisions: input.decisions == null ? undefined : (input.decisions as unknown as never),
          _links: input.links == null ? undefined : (input.links as unknown as never),
        } as never,
      );
      if (error) throw error;
      const parsed = parsePmgCommandResult(data);
      if (parsed.status === "applied") return;
      const reason = (parsed.data as { reason?: unknown } | null)?.reason;
      const message = typeof reason === "string" && reason.trim() !== ""
        ? reason
        : `Governance record update ${parsed.status}`;
      if (parsed.status === "not_authorized") {
        throw new Error(`forbidden: ${message}`);
      }
      if (parsed.status === "conflict") {
        // PMG.5D.1 — stale-write; surface a stable, mappable message.
        throw new Error("stale_governance_record");
      }
      throw new Error(message);

    },
    onSuccess: (_d, vars) => {
      invalidate(qc, projectId);
      qc.invalidateQueries({ queryKey: ["governance-record-detail", vars.record_id] });
    },
  });
}

export function useArchiveGovernanceRecord(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (recordId: string) => {
      const { error } = await supabase.rpc("archive_governance_record", { _record_id: recordId });
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, projectId),
  });
}

export function useRestoreGovernanceRecord(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (recordId: string) => {
      const { error } = await supabase.rpc("restore_governance_record", { _record_id: recordId });
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc, projectId),
  });
}

export type DecisionInput = {
  decision_text: string;
  decision_owner_id?: string | null;
  decision_owner_stakeholder_id?: string | null;
  target_date?: string | null;
};

export function useSetGovernanceRecordDecisions(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { record_id: string; decisions: DecisionInput[] }) => {
      const { error } = await supabase.rpc("set_governance_record_decisions", {
        _record_id: input.record_id,
        _decisions: input.decisions as unknown as any,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidate(qc, projectId);
      qc.invalidateQueries({ queryKey: ["governance-record-detail", vars.record_id] });
    },
  });
}

export type LinkInput = {
  linked_object_type: GovernanceLinkType;
  linked_object_id: string;
};

export function useSetGovernanceRecordLinks(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { record_id: string; links: LinkInput[] }) => {
      const { error } = await supabase.rpc("set_governance_record_links", {
        _record_id: input.record_id,
        _links: input.links as unknown as any,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidate(qc, projectId);
      qc.invalidateQueries({ queryKey: ["governance-record-detail", vars.record_id] });
    },
  });
}

export function mapGovernanceMutationError(e: unknown, fallback: string): string {
  const msg = String((e as any)?.message ?? e ?? "");
  if (msg.toLowerCase().includes("forbidden") || msg.includes("42501")) {
    return "You do not have permission to record governance evidence for this project.";
  }
  if (msg.includes("stale_governance_record")) {
    return "This governance record was updated by someone else. Reload it and try again.";
  }
  return msg || fallback;
}

