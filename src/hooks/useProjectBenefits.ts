/**
 * Phase 6C — Step 6C.2 — Project Benefits data access hooks.
 *
 * Backend contract: `project_benefits` (see migration 20260701_6c2).
 * All narrative fields are encrypted at rest; reads flow through the
 * SECURITY DEFINER RPC `list_decrypted_project_benefits`, and writes flow
 * through `create_project_benefit` / `update_project_benefit` /
 * `archive_project_benefit` (each enforces project-edit authority via
 * `has_project_pm_authority`).
 *
 * No UI, route, or navigation is introduced by this step — only the
 * non-visual contract needed by Step 6C.3.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// ---- Canonical value sets -------------------------------------------------

export const PROJECT_BENEFIT_TYPES = [
  "fte_savings",
  "manual_work_reduction",
  "visibility_improvement",
  "rework_reduction",
  "financial_value",
  "other",
] as const;
export type ProjectBenefitType = (typeof PROJECT_BENEFIT_TYPES)[number];

export const PROJECT_BENEFIT_TYPE_OPTIONS: { value: ProjectBenefitType; label: string }[] = [
  { value: "fte_savings", label: "FTE savings" },
  { value: "manual_work_reduction", label: "Manual work reduction" },
  { value: "visibility_improvement", label: "Visibility improvement" },
  { value: "rework_reduction", label: "Rework reduction" },
  { value: "financial_value", label: "Financial value" },
  { value: "other", label: "Other" },
];

export const PROJECT_BENEFIT_REALIZATION_STATUSES = [
  "planned",
  "in_progress",
  "realized",
  "partially_realized",
  "not_realized",
  "not_applicable",
] as const;
export type ProjectBenefitRealizationStatus =
  (typeof PROJECT_BENEFIT_REALIZATION_STATUSES)[number];

export const PROJECT_BENEFIT_REALIZATION_STATUS_OPTIONS: {
  value: ProjectBenefitRealizationStatus;
  label: string;
}[] = [
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In progress" },
  { value: "realized", label: "Realized" },
  { value: "partially_realized", label: "Partially realized" },
  { value: "not_realized", label: "Not realized" },
  { value: "not_applicable", label: "Not applicable" },
];

// ---- Types ----------------------------------------------------------------

export interface ProjectBenefit {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  benefit_type: ProjectBenefitType;
  custom_benefit_type_label: string | null;
  metric_name: string;
  description: string | null;
  unit_of_measure: string;
  baseline_value: number | null;
  target_value: number;
  actual_value: number | null;
  benefit_owner_id: string | null;
  benefit_owner_display_name: string | null;
  benefit_owner_email: string | null;
  realization_status: ProjectBenefitRealizationStatus;
  expected_realization_date: string | null;
  actual_realization_date: string | null;
  evidence_note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface CreateProjectBenefitInput {
  project_id: string;
  benefit_type: ProjectBenefitType;
  metric_name: string;
  unit_of_measure: string;
  target_value: number;
  realization_status?: ProjectBenefitRealizationStatus;
  custom_benefit_type_label?: string | null;
  description?: string | null;
  baseline_value?: number | null;
  actual_value?: number | null;
  benefit_owner_id?: string | null;
  expected_realization_date?: string | null;
  actual_realization_date?: string | null;
  evidence_note?: string | null;
}

export interface UpdateProjectBenefitInput {
  id: string;
  project_id: string;
  benefit_type?: ProjectBenefitType;
  metric_name?: string;
  unit_of_measure?: string;
  target_value?: number;
  realization_status?: ProjectBenefitRealizationStatus;
  custom_benefit_type_label?: string | null;
  description?: string | null;
  baseline_value?: number | null;
  actual_value?: number | null;
  benefit_owner_id?: string | null;
  expected_realization_date?: string | null;
  actual_realization_date?: string | null;
  evidence_note?: string | null;
}

// ---- Query hook -----------------------------------------------------------

export function useProjectBenefits(
  projectId: string | undefined,
  options: { includeArchived?: boolean; enabled?: boolean } = {},
) {
  const includeArchived = options.includeArchived ?? false;
  const enabled = (options.enabled ?? true) && !!projectId;
  return useQuery({
    queryKey: ["project-benefits", projectId, { includeArchived }],
    enabled,
    queryFn: async (): Promise<ProjectBenefit[]> => {
      if (!projectId) return [];
      const { data, error } = await (supabase.rpc as any)(
        "list_decrypted_project_benefits",
        { _project_id: projectId, _include_archived: includeArchived },
      );
      if (error) throw error;
      return ((data as ProjectBenefit[] | null) ?? []).map((row) => ({
        ...row,
        target_value: Number(row.target_value),
        baseline_value: row.baseline_value === null ? null : Number(row.baseline_value),
        actual_value: row.actual_value === null ? null : Number(row.actual_value),
      }));
    },
  });
}

// ---- Mutation hooks -------------------------------------------------------

function invalidate(qc: ReturnType<typeof useQueryClient>, projectId: string) {
  qc.invalidateQueries({ queryKey: ["project-benefits", projectId] });
}

function nullableText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const t = value.trim();
  return t.length ? t : null;
}

export function useCreateProjectBenefit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProjectBenefitInput) => {
      const { data, error } = await (supabase.rpc as any)("create_project_benefit", {
        _project_id: input.project_id,
        _benefit_type: input.benefit_type,
        _metric_name: input.metric_name.trim(),
        _unit_of_measure: input.unit_of_measure.trim(),
        _target_value: input.target_value,
        _realization_status: input.realization_status ?? "planned",
        _custom_benefit_type_label: nullableText(input.custom_benefit_type_label ?? null),
        _description: nullableText(input.description ?? null),
        _baseline_value: input.baseline_value ?? null,
        _actual_value: input.actual_value ?? null,
        _benefit_owner_id: input.benefit_owner_id ?? null,
        _expected_realization_date: input.expected_realization_date ?? null,
        _actual_realization_date: input.actual_realization_date ?? null,
        _evidence_note: nullableText(input.evidence_note ?? null),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_id, vars) => {
      invalidate(qc, vars.project_id);
      toast.success("Benefit created");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create benefit"),
  });
}

export function useUpdateProjectBenefit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateProjectBenefitInput) => {
      const params: Record<string, unknown> = { _benefit_id: input.id };

      if (input.benefit_type !== undefined) params._benefit_type = input.benefit_type;
      if (input.metric_name !== undefined) params._metric_name = input.metric_name.trim();
      if (input.unit_of_measure !== undefined)
        params._unit_of_measure = input.unit_of_measure.trim();
      if (input.target_value !== undefined) params._target_value = input.target_value;
      if (input.realization_status !== undefined)
        params._realization_status = input.realization_status;

      const setNullableText = (
        key: string,
        clearKey: string,
        value: string | null | undefined,
      ) => {
        if (value === undefined) return;
        if (value === null) {
          params[clearKey] = true;
        } else {
          const t = value.trim();
          if (t.length === 0) params[clearKey] = true;
          else params[key] = t;
        }
      };
      const setNullable = <T,>(key: string, clearKey: string, value: T | null | undefined) => {
        if (value === undefined) return;
        if (value === null) params[clearKey] = true;
        else params[key] = value;
      };

      setNullableText(
        "_custom_benefit_type_label",
        "_clear_custom_benefit_type_label",
        input.custom_benefit_type_label,
      );
      setNullableText("_description", "_clear_description", input.description);
      setNullable("_baseline_value", "_clear_baseline_value", input.baseline_value);
      setNullable("_actual_value", "_clear_actual_value", input.actual_value);
      setNullable("_benefit_owner_id", "_clear_benefit_owner_id", input.benefit_owner_id);
      setNullable(
        "_expected_realization_date",
        "_clear_expected_realization_date",
        input.expected_realization_date,
      );
      setNullable(
        "_actual_realization_date",
        "_clear_actual_realization_date",
        input.actual_realization_date,
      );
      setNullableText("_evidence_note", "_clear_evidence_note", input.evidence_note);

      const { error } = await (supabase.rpc as any)("update_project_benefit", params);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidate(qc, vars.project_id);
      toast.success("Benefit updated");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update benefit"),
  });
}

export function useArchiveProjectBenefit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; project_id: string }) => {
      const { error } = await (supabase.rpc as any)("archive_project_benefit", {
        _benefit_id: input.id,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidate(qc, vars.project_id);
      toast.success("Benefit archived");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to archive benefit"),
  });
}
