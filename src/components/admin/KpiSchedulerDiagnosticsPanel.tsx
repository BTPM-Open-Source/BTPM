// BTPM — Wave C3, Step C3.10a
// Operational diagnostics panel for the two KPI scheduler wrappers.
// Read-only; never displays secret values, command bodies, or tokens.
// Renders one card per expected wrapper showing:
//   - cron job configured (yes/no)
//   - cron schedule + active flag (if configured)
//   - last run started/finished/status (if available)
//   - operational state derived from the above
//
// Hard rules:
//   - Does not invoke any scheduler / orchestrator / function.
//   - Does not write anything.
//   - Hides everything but the diagnostic summary fields.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2, Info, RefreshCw, ServerCog, XCircle } from "lucide-react";
import {
  useKpiSchedulerDiagnostics,
  type KpiSchedulerDiagnosticsRow,
} from "@/hooks/useKpiSchedulerDiagnostics";

const EXPECTED: Array<{
  jobname: string;
  label: string;
  expectedSchedule: string;
  helper: string;
}> = [
  {
    jobname: "run-kpi-snapshot-capture-scheduler-cron",
    label: "Automatic Snapshot Capture",
    expectedSchedule: "0 5 * * * (daily 05:00 UTC)",
    helper:
      "Daily wrapper that asks the canonical orchestrator to create official snapshots for KPIs whose schedule policy is due.",
  },
  {
    jobname: "run-kpi-app-scheduler-cron",
    label: "KPI App Auto-submit",
    expectedSchedule: "0 6 * * * (daily 06:00 UTC)",
    helper:
      "Daily wrapper that submits existing official snapshots to the external KPI App for mappings whose schedule policy is due. Runs after snapshot capture.",
  },
];

function operationalState(
  row: KpiSchedulerDiagnosticsRow | undefined,
): { label: string; tone: "ok" | "warn" | "err" | "muted" } {
  if (!row || !row.job_configured) {
    return { label: "Not configured", tone: "err" };
  }
  if (row.active === false) {
    return { label: "Disabled (cron inactive)", tone: "warn" };
  }
  if (!row.last_run_started_at) {
    return { label: "Configured — no run recorded yet", tone: "muted" };
  }
  const status = (row.last_run_status ?? "").toLowerCase();
  if (status === "succeeded") return { label: "Last run succeeded", tone: "ok" };
  if (status === "failed") return { label: "Last run failed", tone: "err" };
  return { label: `Last run: ${row.last_run_status ?? "unknown"}`, tone: "muted" };
}

function toneIcon(tone: "ok" | "warn" | "err" | "muted") {
  switch (tone) {
    case "ok":
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case "warn":
      return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    case "err":
      return <XCircle className="h-4 w-4 text-destructive" />;
    default:
      return <Info className="h-4 w-4 text-muted-foreground" />;
  }
}

function fmtTs(ts: string | null) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export function KpiSchedulerDiagnosticsPanel() {
  const { data, isLoading, error, refetch, isFetching } =
    useKpiSchedulerDiagnostics();

  const rowsByJob = new Map<string, KpiSchedulerDiagnosticsRow>();
  for (const r of data ?? []) rowsByJob.set(r.expected_jobname, r);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ServerCog className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Scheduler diagnostics</CardTitle>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Shows whether the two KPI scheduler cron jobs are configured and
            their last run summary. Schedule policies (per workspace + cadence)
            decide which KPIs are due; the cron jobs only invoke the wrappers
            on a daily cadence. Secret values and request bodies are never
            displayed here.
          </AlertDescription>
        </Alert>

        {error ? (() => {
          const msg = (error as { message?: string })?.message ?? "";
          const isAuthError =
            /authority|permission|denied|42501/i.test(msg);
          return (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                {isAuthError
                  ? "Failed to load scheduler diagnostics. Org-admin authority is required."
                  : `Failed to load scheduler diagnostics: ${msg || "unknown error"}.`}
              </AlertDescription>
            </Alert>
          );
        })() : null}

        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          EXPECTED.map((e) => {
            const row = rowsByJob.get(e.jobname);
            const state = operationalState(row);
            return (
              <div
                key={e.jobname}
                className="rounded-md border bg-muted/20 p-3 text-sm space-y-2"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-foreground">{e.label}</span>
                  <code className="text-xs text-muted-foreground">{e.jobname}</code>
                  <span className="ml-auto inline-flex items-center gap-1 text-xs">
                    {toneIcon(state.tone)} <span>{state.label}</span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{e.helper}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Configured:</span>{" "}
                    {row?.job_configured ? (
                      <Badge variant="outline">yes</Badge>
                    ) : (
                      <Badge variant="destructive">no</Badge>
                    )}
                    {row?.job_configured ? (
                      <>
                        <span className="ml-2 text-muted-foreground">Active:</span>{" "}
                        <Badge variant={row.active ? "default" : "secondary"}>
                          {row.active ? "yes" : "no"}
                        </Badge>
                      </>
                    ) : null}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Schedule:</span>{" "}
                    <code className="font-mono">
                      {row?.schedule ?? e.expectedSchedule + " (expected)"}
                    </code>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last run start:</span>{" "}
                    {fmtTs(row?.last_run_started_at ?? null)}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last run end:</span>{" "}
                    {fmtTs(row?.last_run_finished_at ?? null)}
                  </div>
                  <div className="md:col-span-2">
                    <span className="text-muted-foreground">Last run status:</span>{" "}
                    {row?.last_run_status ? (
                      <Badge variant="outline">{row.last_run_status}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {row?.last_run_return_message ? (
                      <span className="ml-2 text-muted-foreground">
                        ({row.last_run_return_message})
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>Activation</strong> requires (1) the four Edge Function
            secrets to be set, (2) matching values stored in Supabase Vault,
            and (3) the two cron jobs scheduled. See{" "}
            <code className="font-mono">
              docs/operations/KPI_SCHEDULER.md
            </code>{" "}
            for the operator runbook. Until the wrappers' ENABLED flags equal
            <code className="font-mono"> "true"</code>, they short-circuit and
            never invoke the orchestrator.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}
