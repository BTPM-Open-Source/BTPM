// BTPM — Wave C3, Step C3.9j
// Hooks for the Admin KPI Scheduling UX.
//
// Hard rules:
//   - Reads kpi_schedule_policies (RLS-scoped to Org Admin / Workspace Admin-or-higher).
//   - Updates ONLY allowed editable fields: is_active, delay_days_after_period_close,
//     run_time_utc (and updated_by). Never edits organization_id, workspace_id,
//     process_type, cadence, created_by, created_at.
//   - Optionally invokes the read-only dry_run Edge Function `evaluate-kpi-schedule-policies`
//     for due preview. Never invokes any scheduler / Report Now / build / submit functions.
//   - Never writes to kpi_app_submission_outbox / attempts / kpi_snapshots /
//     kpi_updates / kpi_definitions / kpi_app_external_kpis.
//   - Never calls MuleSoft / KPI App. Never enables cron.
//
// Backend RLS + DB validation trigger remain authoritative.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type PolicyRow = Database["public"]["Tables"]["kpi_schedule_policies"]["Row"];

export type SchedulePolicyProcessType =
  | "automatic_snapshot_capture"
  | "kpi_app_auto_submit";

export type SchedulePolicyCadence = "weekly" | "monthly" | "quarterly" | "yearly";

export type KpiSchedulePolicy = PolicyRow;

export const POLICY_PROCESS_TYPES: SchedulePolicyProcessType[] = [
  "automatic_snapshot_capture",
  "kpi_app_auto_submit",
];

export const POLICY_CADENCES: SchedulePolicyCadence[] = [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
];

export function useKpiSchedulePolicies(
  organizationId: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["kpi-schedule-policies", organizationId, workspaceId],
    enabled: !!organizationId && !!workspaceId,
    queryFn: async (): Promise<KpiSchedulePolicy[]> => {
      const { data, error } = await supabase
        .from("kpi_schedule_policies")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("workspace_id", workspaceId!);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface UpdateSchedulePolicyInput {
  id: string;
  is_active?: boolean;
  delay_days_after_period_close?: number;
  run_time_utc?: string; // HH:MM or HH:MM:SS
}

export function useUpdateKpiSchedulePolicy(
  organizationId: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSchedulePolicyInput) => {
      const patch: Database["public"]["Tables"]["kpi_schedule_policies"]["Update"] = {};
      if (typeof input.is_active === "boolean") patch.is_active = input.is_active;
      if (typeof input.delay_days_after_period_close === "number") {
        patch.delay_days_after_period_close = input.delay_days_after_period_close;
      }
      if (typeof input.run_time_utc === "string") {
        // Normalize HH:MM -> HH:MM:00 for time column.
        const t = input.run_time_utc.length === 5
          ? `${input.run_time_utc}:00`
          : input.run_time_utc;
        patch.run_time_utc = t;
      }

      // Best-effort updated_by; backend RLS + trigger remain authoritative.
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user?.id) {
        patch.updated_by = userData.user.id;
      }

      const { data, error } = await supabase
        .from("kpi_schedule_policies")
        .update(patch)
        .eq("id", input.id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["kpi-schedule-policies", organizationId, workspaceId],
      });
      qc.invalidateQueries({
        queryKey: ["kpi-schedule-policies-due-preview", organizationId, workspaceId],
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Due preview via the read-only dry_run Edge Function from C3.9i.
// ---------------------------------------------------------------------------

export interface DuePreviewItem {
  policy_id: string;
  organization_id: string;
  workspace_id: string;
  workspace_name: string | null;
  process_type: string;
  cadence: string;
  is_active: boolean;
  delay_days_after_period_close: number;
  run_time_utc: string;
  period_start: string | null;
  period_end: string | null;
  scheduled_run_at: string | null;
  is_due: boolean;
  due_status: string;
  reason: string | null;
}

export interface DuePreviewResponse {
  ok: boolean;
  request_id?: string;
  mode?: "dry_run";
  as_of_datetime_utc?: string;
  policy_count?: number;
  due_count?: number;
  items?: DuePreviewItem[];
  error?: string;
}

export function useKpiSchedulePoliciesDuePreview(
  organizationId: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["kpi-schedule-policies-due-preview", organizationId, workspaceId],
    enabled: !!organizationId && !!workspaceId,
    // Snapshot at mount; user can refresh manually.
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: async (): Promise<DuePreviewResponse> => {
      const { data, error } = await supabase.functions.invoke(
        "evaluate-kpi-schedule-policies",
        {
          body: {
            mode: "dry_run",
            workspace_id: workspaceId,
          },
        },
      );
      if (error) {
        return { ok: false, error: error.message };
      }
      return (data ?? { ok: false, error: "Empty response" }) as DuePreviewResponse;
    },
  });
}
