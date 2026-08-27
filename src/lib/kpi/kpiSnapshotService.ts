/**
 * BTPM — Wave C1, Step C1.6a
 * KPI snapshot capture — client wrapper around the server-authoritative
 * `capture-kpi-snapshot` Edge Function.
 *
 * THIS FILE NO LONGER PERFORMS A CLIENT-SIDE INSERT INTO kpi_snapshots.
 * Direct authenticated INSERT into kpi_snapshots is blocked at the DB layer
 * (the prior kpi_snap_insert_pm policy was dropped in the C1.6a migration).
 *
 * The client may only request a capture. The Edge Function:
 *   - verifies authority (can_capture_kpi_snapshot RPC),
 *   - loads the kpi_definition server-side,
 *   - sources the value (manual: kpi_updates RPC; automatic: C1.4 engine),
 *   - inserts the official kpi_snapshots row with service-role.
 */

import { supabase } from "@/integrations/supabase/client";

export interface CaptureKpiSnapshotInput {
  kpiDefinitionId: string;
  /** ISO YYYY-MM-DD; if omitted, server defaults to today (UTC). */
  snapshotDate?: string;
  comment?: string | null;
  actionPlan?: string | null;
}

export interface CaptureKpiSnapshotResult {
  snapshotId: string;
  calculationStatus: string;
  valueAmount: number | null;
  stringValue: string | null;
  message: string | null;
}

export async function captureKpiSnapshot(
  input: CaptureKpiSnapshotInput,
): Promise<CaptureKpiSnapshotResult> {
  const { data, error } = await supabase.functions.invoke("capture-kpi-snapshot", {
    body: {
      kpi_definition_id: input.kpiDefinitionId,
      snapshot_date: input.snapshotDate ?? null,
      comment: input.comment ?? null,
      action_plan: input.actionPlan ?? null,
    },
  });
  if (error) {
    // supabase.functions.invoke surfaces non-2xx as `error`; try to read the body.
    const msg =
      (data && typeof data === "object" && (data as any).error) ||
      error.message ||
      "Failed to capture snapshot";
    throw new Error(msg);
  }
  if (!data || typeof data !== "object") {
    throw new Error("Capture failed: empty response");
  }
  const d = data as any;
  if (d.error) throw new Error(d.error);
  return {
    snapshotId: d.snapshot_id,
    calculationStatus: d.calculation_status,
    valueAmount: d.value_amount ?? null,
    stringValue: d.string_value ?? null,
    message: d.message ?? null,
  };
}
