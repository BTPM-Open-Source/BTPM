import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { parsePmgCommandResult } from "@/lib/pmg/pmgContract";

export type KpiDefinition = Tables<"kpi_definitions">;
export type KpiUpdate = Tables<"kpi_updates">;

export function useKpiDefinitions(projectId: string | undefined) {
  return useQuery({
    queryKey: ["kpi-definitions", projectId],
    queryFn: async () => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await supabase.rpc("list_decrypted_kpi_definitions", {
        _project_id: projectId,
      });
      if (error) throw error;
      return ((data as any[]) || []) as KpiDefinition[];
    },
    enabled: !!projectId,
  });
}

export function useKpiUpdates(kpiDefinitionId: string | undefined) {
  return useQuery({
    queryKey: ["kpi-updates", kpiDefinitionId],
    queryFn: async () => {
      if (!kpiDefinitionId) throw new Error("No KPI definition ID");
      const { data, error } = await supabase.rpc("list_decrypted_kpi_updates", {
        _kpi_definition_id: kpiDefinitionId,
      });
      if (error) throw error;
      return ((data as any[]) || []) as (KpiUpdate & { author_name?: string; author_email?: string })[];
    },
    enabled: !!kpiDefinitionId,
  });
}

export function useCreateKpiDefinition(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      description?: string;
      unit?: string;
      target_value?: number;
      target_direction: string;
      // Server derives workspace_id / organization_id from projectId.
      // These optional fields are accepted for hook input compatibility
      // but never forwarded to the server.
      workspace_id?: string;
      organization_id?: string;
      // Wave C1.5 — KPI Engine substrate fields
      source_mode?: string;
      value_type?: string;
      cadence?: string;
      calculation_key?: string | null;
      formula_version?: number | null;
      completion_method?: string | null;
      comment_required?: boolean;
      action_plan_required?: boolean;
      // Wave C3 — Step C3.7: editable automatic snapshot capture flag.
      auto_snapshot_enabled?: boolean;
    }) => {
      const description = input.description?.trim() ? input.description.trim() : null;
      const unit = input.unit?.trim() ? input.unit.trim() : null;

      const { data, error } = await supabase.rpc("apply_kpi_definition_create", {
        _project_id: projectId,
        _name: input.name,
        _description: description,
        _unit: unit,
        _target_value: input.target_value ?? null,
        _target_direction: input.target_direction as any,
        _source_mode: input.source_mode ?? "manual",
        _value_type: input.value_type ?? "number",
        _cadence: input.cadence ?? "manual_only",
        _calculation_key: input.calculation_key ?? null,
        _formula_version: input.formula_version ?? null,
        _completion_method: input.completion_method ?? null,
        _comment_required: input.comment_required ?? false,
        _action_plan_required: input.action_plan_required ?? false,
        _auto_snapshot_enabled: input.auto_snapshot_enabled ?? false,
      });
      if (error) throw error;

      const result = parsePmgCommandResult(data);
      if (result.status === "applied") return result;

      const reason =
        typeof (result.data as any)?.reason === "string"
          ? (result.data as any).reason
          : null;
      if (result.status === "invalid") {
        throw new Error(reason ?? "KPI creation failed (invalid)");
      }
      if (result.status === "not_authorized") {
        throw new Error(reason ?? "You are not allowed to create this KPI");
      }
      throw new Error(`KPI creation failed (${result.status})`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-definitions", projectId] });
      qc.invalidateQueries({ queryKey: ["project-kpis", projectId] });
      toast.success("KPI created");
    },
    onError: (e: any) => toast.error(e.message),
  });
}


// Wave 5 Step 5.5 — `is_archived` removed from this mutation payload.
// KPI lifecycle (archive/unarchive/hard-delete) goes through
// useLifecycleActions which calls the canonical Step 5.3 RPCs.
export function useUpdateKpiDefinition(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      description?: string;
      unit?: string;
      target_value?: number | null;
      target_direction?: string;
      // Accepted for hook input compatibility; not forwarded to the server.
      organization_id?: string;
      // Wave C1.5 — KPI Engine substrate fields
      source_mode?: string;
      value_type?: string;
      cadence?: string;
      calculation_key?: string | null;
      formula_version?: number | null;
      completion_method?: string | null;
      comment_required?: boolean;
      action_plan_required?: boolean;
      // Wave C3 — Step C3.7: editable automatic snapshot capture flag.
      auto_snapshot_enabled?: boolean;
    }) => {
      // Obtain expected_updated_at from the canonical decrypted KPI cache.
      const cached = qc.getQueryData<KpiDefinition[]>([
        "kpi-definitions",
        projectId,
      ]);
      let current = cached?.find((k) => k.id === input.id);
      if (!current) {
        const { data, error } = await supabase.rpc(
          "list_decrypted_kpi_definitions",
          { _project_id: projectId },
        );
        if (error) throw error;
        current = ((data as any[]) || []).find((k) => k.id === input.id) as
          | KpiDefinition
          | undefined;
      }
      if (!current) {
        throw new Error("KPI definition not found in cache; refresh and retry.");
      }

      const set_name = input.name !== undefined;
      const set_description = input.description !== undefined;
      const set_unit = input.unit !== undefined;
      const set_target_value = input.target_value !== undefined;
      const set_target_direction = input.target_direction !== undefined;
      const set_source_mode = input.source_mode !== undefined;
      const set_value_type = input.value_type !== undefined;
      const set_cadence = input.cadence !== undefined;
      const set_calculation_key = input.calculation_key !== undefined;
      const set_formula_version = input.formula_version !== undefined;
      const set_completion_method = input.completion_method !== undefined;
      const set_comment_required = input.comment_required !== undefined;
      const set_action_plan_required = input.action_plan_required !== undefined;
      const set_auto_snapshot_enabled = input.auto_snapshot_enabled !== undefined;

      const { data, error } = await supabase.rpc(
        "apply_kpi_definition_update",
        {
          _kpi_definition_id: input.id,
          _expected_updated_at: current.updated_at,
          _name: set_name ? input.name! : null,
          _description: set_description
            ? input.description?.trim()
              ? input.description.trim()
              : null
            : null,
          _unit: set_unit ? (input.unit ? input.unit : null) : null,
          _target_value: set_target_value ? (input.target_value ?? null) : null,
          _target_direction: set_target_direction
            ? (input.target_direction as any)
            : null,
          _source_mode: set_source_mode ? input.source_mode! : null,
          _value_type: set_value_type ? input.value_type! : null,
          _cadence: set_cadence ? input.cadence! : null,
          _calculation_key: set_calculation_key
            ? (input.calculation_key ?? null)
            : null,
          _formula_version: set_formula_version
            ? (input.formula_version ?? null)
            : null,
          _completion_method: set_completion_method
            ? (input.completion_method ?? null)
            : null,
          _comment_required: set_comment_required
            ? !!input.comment_required
            : null,
          _action_plan_required: set_action_plan_required
            ? !!input.action_plan_required
            : null,
          _auto_snapshot_enabled: set_auto_snapshot_enabled
            ? !!input.auto_snapshot_enabled
            : null,
          _set_name: set_name,
          _set_description: set_description,
          _set_unit: set_unit,
          _set_target_value: set_target_value,
          _set_target_direction: set_target_direction,
          _set_source_mode: set_source_mode,
          _set_value_type: set_value_type,
          _set_cadence: set_cadence,
          _set_calculation_key: set_calculation_key,
          _set_formula_version: set_formula_version,
          _set_completion_method: set_completion_method,
          _set_comment_required: set_comment_required,
          _set_action_plan_required: set_action_plan_required,
          _set_auto_snapshot_enabled: set_auto_snapshot_enabled,
        },
      );
      if (error) throw error;

      const result = parsePmgCommandResult(data);
      if (result.status === "applied" || result.status === "no_change") {
        return result;
      }

      const reason =
        typeof (result.data as any)?.reason === "string"
          ? (result.data as any).reason
          : null;
      if (result.status === "conflict") {
        throw new Error(
          "This KPI was modified by someone else. Refresh and try again.",
        );
      }
      if (result.status === "invalid") {
        throw new Error(reason ?? "KPI update failed (invalid)");
      }
      if (result.status === "not_authorized") {
        throw new Error(reason ?? "You are not allowed to update this KPI");
      }
      throw new Error(`KPI update failed (${result.status})`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-definitions", projectId] });
      qc.invalidateQueries({ queryKey: ["project-kpis", projectId] });
      toast.success("KPI updated");
    },
    onError: (e: any) => toast.error(e.message),
  });
}


export function useAddKpiUpdate(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      kpi_definition_id: string;
      value: number;
      update_date: string;
      note?: string;
      // Accepted for hook input compatibility; not forwarded to the server.
      workspace_id?: string;
      organization_id?: string;
    }) => {
      const note = input.note?.trim() ? input.note.trim() : null;

      const { data, error } = await supabase.rpc("append_kpi_update", {
        _kpi_definition_id: input.kpi_definition_id,
        _value: input.value,
        _update_date: input.update_date,
        _note: note,
      });
      if (error) throw error;

      const result = parsePmgCommandResult(data);
      if (result.status === "applied") return result;

      const reason =
        typeof (result.data as any)?.reason === "string"
          ? (result.data as any).reason
          : null;
      if (result.status === "invalid") {
        throw new Error(reason ?? "KPI update failed (invalid)");
      }
      if (result.status === "not_authorized") {
        throw new Error(
          reason ?? "You are not allowed to record this KPI update",
        );
      }
      throw new Error(`KPI update failed (${result.status})`);
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["kpi-updates", vars.kpi_definition_id] });
      qc.invalidateQueries({ queryKey: ["kpi-definitions", projectId] });
      qc.invalidateQueries({ queryKey: ["project-kpis", projectId] });
      toast.success("KPI update recorded");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

