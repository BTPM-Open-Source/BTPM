// BTPM — Wave C3, Step C3.10a
// Read-only hook surfacing the operational state of the two scheduled
// KPI cron jobs. Backed by public.kpi_scheduler_diagnostics (org-admin
// only, security definer, never returns secret values).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type KpiSchedulerDiagnosticsRow = {
  expected_jobname: string;
  job_configured: boolean;
  jobid: number | null;
  schedule: string | null;
  active: boolean | null;
  last_run_started_at: string | null;
  last_run_finished_at: string | null;
  last_run_status: string | null;
  last_run_return_message: string | null;
};

export function useKpiSchedulerDiagnostics() {
  return useQuery({
    queryKey: ["kpi-scheduler-diagnostics"],
    queryFn: async (): Promise<KpiSchedulerDiagnosticsRow[]> => {
      const { data, error } = await supabase.rpc(
        "kpi_scheduler_diagnostics" as never,
      );
      if (error) throw error;
      return (data ?? []) as KpiSchedulerDiagnosticsRow[];
    },
    refetchInterval: 60_000,
  });
}
