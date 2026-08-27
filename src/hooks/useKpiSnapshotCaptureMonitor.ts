// BTPM — Wave C3, Step C3.9
// Read-only hooks for the Automatic KPI Snapshot Capture Monitor.
//
// Hard rules:
//   - Reads only non-sensitive audit fields from
//     kpi_snapshot_capture_runs and kpi_snapshot_capture_run_items.
//   - Never reads kpi_snapshots value payloads, comments, action
//     plans, calculation inputs, or KPI App / outbox / attempt data.
//   - Never writes — RLS already prevents writes for normal users.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CaptureRunStatus =
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed";

export type CaptureRunItemAction =
  | "created_snapshot"
  | "skipped_existing_snapshot"
  | "calculation_not_ready"
  | "skipped_not_eligible"
  | "failed";

export type CaptureRun = {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  requested_by: string | null;
  invocation_source: "user" | "system";
  mode: "execute";
  as_of_date: string;
  started_at: string;
  completed_at: string | null;
  status: CaptureRunStatus;
  candidate_count: number;
  created_count: number;
  skipped_existing_snapshot_count: number;
  skipped_not_eligible_count: number;
  calculation_not_ready_count: number;
  failed_count: number;
  error_message: string | null;
};

export type CaptureRunItem = {
  id: string;
  run_id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  kpi_definition_id: string;
  snapshot_id: string | null;
  existing_snapshot_id: string | null;
  kpi_name: string | null;
  project_name: string | null;
  calculation_key: string | null;
  cadence: string;
  period_start: string | null;
  period_end: string | null;
  validity_date: string | null;
  action: CaptureRunItemAction;
  reason: string | null;
  calculation_status: string | null;
  created_at: string;
};

export type CaptureRunFilters = {
  organizationId: string;
  workspaceId: string | null;
  invocationSource?: "all" | "user" | "system";
  status?: "all" | CaptureRunStatus;
  fromDate?: string | null;
  toDate?: string | null;
  limit?: number;
};

export function useKpiSnapshotCaptureRuns(filters: CaptureRunFilters) {
  const {
    organizationId,
    workspaceId,
    invocationSource = "all",
    status = "all",
    fromDate = null,
    toDate = null,
    limit = 50,
  } = filters;

  return useQuery({
    queryKey: [
      "kpi-snapshot-capture-runs",
      organizationId,
      workspaceId,
      invocationSource,
      status,
      fromDate,
      toDate,
      limit,
    ],
    enabled: !!organizationId,
    queryFn: async (): Promise<CaptureRun[]> => {
      let q = supabase
        .from("kpi_snapshot_capture_runs")
        .select(
          "id, organization_id, workspace_id, requested_by, invocation_source, mode, as_of_date, started_at, completed_at, status, candidate_count, created_count, skipped_existing_snapshot_count, skipped_not_eligible_count, calculation_not_ready_count, failed_count, error_message",
        )
        .eq("organization_id", organizationId)
        .order("started_at", { ascending: false })
        .limit(limit);

      if (workspaceId) q = q.eq("workspace_id", workspaceId);
      if (invocationSource !== "all") q = q.eq("invocation_source", invocationSource);
      if (status !== "all") q = q.eq("status", status);
      if (fromDate) q = q.gte("started_at", `${fromDate}T00:00:00Z`);
      if (toDate) q = q.lte("started_at", `${toDate}T23:59:59Z`);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CaptureRun[];
    },
  });
}

export function useKpiSnapshotCaptureRunItems(
  runId: string | null,
  options: { actionFilter?: "all" | CaptureRunItemAction; projectId?: string | null } = {},
) {
  const { actionFilter = "all", projectId = null } = options;
  return useQuery({
    queryKey: ["kpi-snapshot-capture-run-items", runId, actionFilter, projectId],
    enabled: !!runId,
    queryFn: async (): Promise<CaptureRunItem[]> => {
      let q = supabase
        .from("kpi_snapshot_capture_run_items")
        .select(
          "id, run_id, organization_id, workspace_id, project_id, kpi_definition_id, snapshot_id, existing_snapshot_id, kpi_name, project_name, calculation_key, cadence, period_start, period_end, validity_date, action, reason, calculation_status, created_at",
        )
        .eq("run_id", runId as string)
        .order("created_at", { ascending: true })
        .limit(2000);
      if (actionFilter !== "all") q = q.eq("action", actionFilter);
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CaptureRunItem[];
    },
  });
}
