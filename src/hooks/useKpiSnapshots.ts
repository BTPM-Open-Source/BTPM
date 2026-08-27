/**
 * BTPM — Wave C1, Step C1.6
 * Hooks for KPI snapshot read + capture.
 *
 * Kept separate from useProjectKpis (manual update flow) so snapshot
 * semantics never leak into kpi_updates handling.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  captureKpiSnapshot,
  type CaptureKpiSnapshotInput,
} from "@/lib/kpi/kpiSnapshotService";
import { resolveKpiPeriod, snapshotCoversDate, type KpiCadence } from "@/lib/kpi/kpiPeriod";

export interface KpiSnapshotRow {
  id: string;
  kpi_definition_id: string;
  project_id: string;
  workspace_id: string;
  organization_id: string;
  snapshot_date: string;
  period_start: string | null;
  period_end: string | null;
  source_mode: string;
  value_type: string;
  value_amount: number | null;
  string_value: string | null;
  comment: string | null;
  action_plan: string | null;
  calculation_key: string | null;
  formula_version: number | null;
  calculation_status: string;
  generated_by: string;
  created_at: string;
  created_by: string | null;
}

/** All snapshots for a project (newest first), optionally filtered by KPI. */
export function useKpiSnapshots(projectId: string | undefined, kpiDefinitionId?: string) {
  return useQuery({
    queryKey: ["kpi-snapshots", projectId, kpiDefinitionId ?? null],
    queryFn: async () => {
      if (!projectId) return [] as KpiSnapshotRow[];
      const { data, error } = await supabase.rpc("list_decrypted_kpi_snapshots", {
        _project_id: projectId,
        _kpi_definition_id: kpiDefinitionId ?? null,
      });
      if (error) throw error;
      return ((data as any[]) ?? []) as KpiSnapshotRow[];
    },
    enabled: !!projectId,
  });
}

export function useCaptureKpiSnapshot(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CaptureKpiSnapshotInput) => captureKpiSnapshot(input),
    onSuccess: (result, vars) => {
      qc.invalidateQueries({ queryKey: ["kpi-snapshots", projectId] });
      qc.invalidateQueries({ queryKey: ["kpi-snapshots", projectId, vars.kpiDefinitionId] });
      if (result.calculationStatus === "calculated" || result.calculationStatus === "manual_entry") {
        toast.success("KPI snapshot captured");
      } else {
        toast.warning(`Snapshot captured (${result.calculationStatus})`, {
          description: result.message ?? undefined,
        });
      }
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to capture snapshot"),
  });
}

export type KpiCaptureStatus =
  | "not_configured"
  | "manual_only"
  | "up_to_date"
  | "due"
  | "no_snapshot";

/** Lightweight status tag for a single KPI given its latest snapshot. */
export function deriveKpiCaptureStatus(
  cadence: string | null | undefined,
  latest: KpiSnapshotRow | undefined,
  asOfDate: string,
): KpiCaptureStatus {
  if (!cadence) return "not_configured";
  if (cadence === "manual_only") {
    return latest ? "up_to_date" : "manual_only";
  }
  if (!latest) return "no_snapshot";
  return snapshotCoversDate(latest, cadence as KpiCadence, asOfDate) ? "up_to_date" : "due";
}

/** Convenience: compute current expected period for a KPI cadence. */
export function currentExpectedPeriod(cadence: string | null | undefined, asOfDate: string) {
  return resolveKpiPeriod((cadence ?? "manual_only") as KpiCadence, asOfDate);
}
