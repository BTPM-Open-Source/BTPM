// BTPM — Wave C3, Step C3.9m
// Read-only "last run" summaries for the KPI Scheduling Monitor enhancement.
//
// These hooks aggregate already-existing audit tables to answer:
//   - When did automatic snapshot capture last run for this workspace?
//   - When did the KPI App auto-submit last run for this workspace?
//
// Hard rules:
//   - Read-only. RLS gates visibility (admin-only on both tables).
//   - Never reads sensitive fields (no comments, action_plan, payload bodies,
//     decrypted values, secrets).
//   - Never triggers any scheduler / submission / snapshot / MuleSoft work.
//   - Never writes outbox/attempt/snapshot/kpi_updates rows.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LastSnapshotCaptureRun = {
  id: string;
  started_at: string;
  completed_at: string | null;
  invocation_source: "user" | "system";
  status: "running" | "completed" | "completed_with_errors" | "failed";
  candidate_count: number;
  created_count: number;
  skipped_existing_snapshot_count: number;
  calculation_not_ready_count: number;
  failed_count: number;
  as_of_date: string;
};

/**
 * Latest automatic snapshot capture run for a workspace, optionally
 * filtered by invocation_source. Returns null when there are no recorded
 * runs yet.
 */
export function useLatestSnapshotCaptureRun(
  organizationId: string | null | undefined,
  workspaceId: string | null | undefined,
  invocationSource: "all" | "user" | "system" = "system",
) {
  return useQuery({
    queryKey: [
      "kpi-snapshot-capture-runs-latest",
      organizationId,
      workspaceId,
      invocationSource,
    ],
    enabled: !!organizationId && !!workspaceId,
    queryFn: async (): Promise<LastSnapshotCaptureRun | null> => {
      let q = supabase
        .from("kpi_snapshot_capture_runs")
        .select(
          "id, started_at, completed_at, invocation_source, status, candidate_count, created_count, skipped_existing_snapshot_count, calculation_not_ready_count, failed_count, as_of_date",
        )
        .eq("organization_id", organizationId!)
        .eq("workspace_id", workspaceId!)
        .order("started_at", { ascending: false })
        .limit(1);
      if (invocationSource !== "all") {
        q = q.eq("invocation_source", invocationSource);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data?.[0] ?? null) as LastSnapshotCaptureRun | null;
    },
  });
}

export type LatestScheduledOutboxRow = {
  id: string;
  status: string;
  submission_mode: string;
  reporting_period_start: string;
  reporting_period_end: string;
  payload_row_count: number | null;
  retry_count: number;
  last_attempt_at: string | null;
  submitted_at: string | null;
  last_http_status: number | null;
  created_at: string;
  updated_at: string;
};

/**
 * Latest scheduled (system) auto-submit outbox row for a workspace. Returns
 * null when no scheduled submissions have been recorded yet. Sensitive
 * fields are never selected.
 */
export function useLatestScheduledAutoSubmitRow(
  organizationId: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return useQuery({
    queryKey: [
      "kpi-app-outbox-latest-scheduled",
      organizationId,
      workspaceId,
    ],
    enabled: !!organizationId && !!workspaceId,
    queryFn: async (): Promise<LatestScheduledOutboxRow | null> => {
      const { data, error } = await supabase
        .from("kpi_app_submission_outbox")
        .select(
          "id, status, submission_mode, reporting_period_start, reporting_period_end, payload_row_count, retry_count, last_attempt_at, submitted_at, last_http_status, created_at, updated_at",
        )
        .eq("organization_id", organizationId!)
        .eq("workspace_id", workspaceId!)
        .eq("submission_mode", "scheduled")
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] ?? null) as LatestScheduledOutboxRow | null;
    },
  });
}
