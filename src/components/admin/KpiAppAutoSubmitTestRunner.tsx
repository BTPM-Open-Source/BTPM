// BTPM — Wave C3, Step C3.9e
// Admin KPI App Auto-Submit Test Runner UX.
//
// Controlled admin-only validation UI that invokes the existing
// `run-kpi-app-scheduler` Edge Function in the human-admin path
// (mode=execute, mapping_id=<selected>) for the selected workspace.
//
// Hard rules (do NOT relax):
//   - Workspace-scoped only (mirrors C2.7b/C3.9d pattern).
//   - Reuses authority gates already enforced by the scheduler.
//   - Does NOT call MuleSoft directly from the frontend.
//   - Does NOT build payload client-side.
//   - Does NOT write kpi_app_submission_outbox / _attempts directly.
//   - Does NOT create KPI snapshots.
//   - Does NOT activate cron / scheduler cadence.
//   - Does NOT show decrypted comments / action plans / upstream body
//     / credentials / full payload.
//   - Blocks execute when auto_submit_enabled = false on the mapping.
//   - Blocks execute when entered_by_email_source = submitted_by_user
//     (no human submitter exists in the scheduler path).

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { FlaskConical, Info, PlayCircle, AlertTriangle } from "lucide-react";
import {
  useKpiAppMappings,
  type MappingWithJoin,
} from "@/hooks/useKpiAppIntegration";

type ExecuteAction =
  | "submitted"
  | "failed"
  | "skipped"
  | "not_reportable"
  | "concurrency_conflict"
  | "error";

interface ExecuteItem {
  mapping_id: string;
  outbox_id?: string | null;
  action_taken: ExecuteAction;
  final_status?: string | null;
  reason?: string;
  request_id?: string | null;
  upstream_status?: number | null;
  upstream_status_text?: string | null;
  carry_forward_used?: boolean | null;
  source_snapshot_id?: string | null;
}

interface SchedulerResponse {
  ok: boolean;
  request_id?: string;
  mode?: string;
  as_of_date?: string;
  items?: ExecuteItem[];
  error?: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function actionBadge(a: ExecuteAction | string | undefined) {
  switch (a) {
    case "submitted":
      return <Badge variant="default">Submitted</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "skipped":
      return <Badge variant="secondary">Skipped</Badge>;
    case "not_reportable":
      return <Badge variant="outline">Not reportable</Badge>;
    case "concurrency_conflict":
      return <Badge variant="outline">Concurrency</Badge>;
    case "error":
      return <Badge variant="destructive">Error</Badge>;
    default:
      return <Badge variant="outline">{a ?? "—"}</Badge>;
  }
}

interface Props {
  organizationId: string;
  workspaceId: string | null;
  workspaceName?: string | null;
}

export function KpiAppAutoSubmitTestRunner({
  organizationId,
  workspaceId,
  workspaceName,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: mappings = [], isLoading: mappingsLoading } = useKpiAppMappings(
    organizationId,
    workspaceId,
  );

  const [mappingId, setMappingId] = useState<string>("");
  const [asOfDate, setAsOfDate] = useState<string>(todayIso());
  const [running, setRunning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<SchedulerResponse | null>(null);

  // Show only active mappings — inactive mappings are not eligible regardless
  // of auto-submit state, and the scheduler skips them anyway.
  const activeMappings = useMemo(
    () => mappings.filter((m) => m.is_active && m.kpi_calculation_key !== "schedule_signal"),
    [mappings],
  );

  const selected: MappingWithJoin | null = useMemo(
    () => activeMappings.find((m) => m.id === mappingId) ?? null,
    [activeMappings, mappingId],
  );

  const blockedReason: string | null = useMemo(() => {
    if (!selected) return null;
    if (!selected.auto_submit_enabled) {
      return "Enable Auto-submit official snapshots on this mapping before testing scheduled submission.";
    }
    if (selected.entered_by_email_source === "submitted_by_user") {
      return "Scheduler auto-submit cannot use submitted_by_user because there is no human submitter. Use Snapshot creator or Configured user.";
    }
    return null;
  }, [selected]);

  const canRun = !!workspaceId && !!selected && !blockedReason && !running;

  async function invokeScheduler(): Promise<void> {
    if (!workspaceId || !selected) return;
    setRunning(true);
    setResult(null);
    try {
      const body = {
        mode: "execute" as const,
        as_of_date: asOfDate,
        mapping_id: selected.id,
      };

      const { data, error } = await supabase.functions.invoke(
        "run-kpi-app-scheduler",
        { body },
      );
      if (error) {
        const msg =
          (data && typeof data === "object" && (data as SchedulerResponse).error) ||
          error.message ||
          "Scheduler invocation failed";
        throw new Error(msg);
      }
      const r = (data ?? {}) as SchedulerResponse;
      if (r.ok === false) {
        throw new Error(r.error ?? "Scheduler returned an error");
      }
      setResult(r);

      // Refresh submission monitor + mapping list latest submission badges.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["kpi-app-mappings", organizationId] }),
        qc.invalidateQueries({
          queryKey: ["kpi-app-outbox-monitor", organizationId, workspaceId],
        }),
        qc.invalidateQueries({ queryKey: ["kpi-app-outbox-monitor"] }),
        qc.invalidateQueries({ queryKey: ["kpi-app-attempt-audit"] }),
      ]);

      const item = r.items?.[0];
      const action = item?.action_taken ?? "—";
      toast({
        title: "Auto-submit test executed",
        description: `Action: ${action}${item?.upstream_status ? ` · HTTP ${item.upstream_status}` : ""}${item?.final_status ? ` · ${item.final_status}` : ""}`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({
        title: "Auto-submit test failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  }

  function onPrimaryClick() {
    if (!canRun) return;
    setConfirmOpen(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4 mr-1 text-primary" />
          Test auto-submit official snapshots
          {workspaceName ? (
            <span className="font-normal text-muted-foreground">· {workspaceName}</span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            This tests the KPI App auto-submit scheduler path for an existing mapping. It submits
            existing official snapshots only. It does <strong>not</strong> create KPI snapshots and
            does <strong>not</strong> activate cron. Confirming Execute creates an external
            side effect by submitting through the protected MuleSoft connector.
          </AlertDescription>
        </Alert>

        {!workspaceId ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Select a workspace above to enable the test runner.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs text-muted-foreground">Mapping</label>
                <Select
                  value={mappingId}
                  onValueChange={setMappingId}
                  disabled={mappingsLoading || activeMappings.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        mappingsLoading
                          ? "Loading mappings…"
                          : activeMappings.length === 0
                            ? "No active mappings in this workspace"
                            : "Select a mapping"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {activeMappings.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {(m.project_name ?? "—") + " · " + (m.kpi_name ?? "—") +
                          " → #" + m.external_kpi_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">As-of date</label>
                <Input
                  type="date"
                  value={asOfDate}
                  onChange={(e) => setAsOfDate(e.target.value)}
                />
              </div>
            </div>

            {selected ? (
              <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
                <div className="font-medium text-sm text-foreground">Mapping readiness</div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={selected.is_active ? "default" : "secondary"}>
                    {selected.is_active ? "Active" : "Inactive"}
                  </Badge>
                  <Badge
                    variant={selected.auto_submit_enabled ? "default" : "destructive"}
                  >
                    Auto-submit:{" "}
                    {selected.auto_submit_enabled ? "on" : "off"}
                  </Badge>
                  <Badge variant="outline">
                    Frequency: {selected.reporting_frequency}
                  </Badge>
                  <Badge
                    variant={
                      selected.entered_by_email_source === "submitted_by_user"
                        ? "destructive"
                        : "outline"
                    }
                  >
                    Entered-by: {selected.entered_by_email_source}
                  </Badge>
                  {selected.carry_forward_allowed && (
                    <Badge variant="outline">carry-forward allowed</Badge>
                  )}
                </div>
                <p className="text-muted-foreground">
                  As-of <strong className="font-mono">{asOfDate}</strong> resolves the most
                  recently completed reporting period for this mapping&rsquo;s frequency. The
                  scheduler will look for an existing official snapshot covering that period.
                </p>
              </div>
            ) : null}

            {blockedReason ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">{blockedReason}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex justify-end">
              <Button onClick={onPrimaryClick} disabled={!canRun}>
                <PlayCircle className="h-4 w-4 mr-1" />
                {running ? "Running…" : "Execute auto-submit test"}
              </Button>
            </div>

            {result?.items && result.items.length > 0 ? (
              <div className="rounded-md border p-3 text-xs space-y-2">
                <div className="text-muted-foreground flex flex-wrap gap-3">
                  <span>
                    Mode: <strong className="text-foreground">{result.mode}</strong>
                  </span>
                  <span>As-of: {result.as_of_date}</span>
                  {result.request_id ? (
                    <span className="font-mono">
                      req: {result.request_id.slice(0, 8)}
                    </span>
                  ) : null}
                </div>
                {result.items.map((it, i) => (
                  <div
                    key={`${it.mapping_id}-${i}`}
                    className="flex flex-col gap-1 border-t pt-2 first:border-t-0 first:pt-0"
                  >
                    <div className="flex flex-wrap gap-2 items-center">
                      {actionBadge(it.action_taken)}
                      {it.final_status && (
                        <Badge variant="outline">final: {it.final_status}</Badge>
                      )}
                      {typeof it.upstream_status === "number" && (
                        <Badge variant="outline">HTTP {it.upstream_status}</Badge>
                      )}
                      {it.carry_forward_used ? (
                        <Badge variant="outline">carry-fwd</Badge>
                      ) : null}
                    </div>
                    <div className="font-mono text-muted-foreground">
                      mapping: {it.mapping_id.slice(0, 8)}
                      {it.outbox_id ? ` · outbox: ${it.outbox_id.slice(0, 8)}` : ""}
                      {it.source_snapshot_id
                        ? ` · snapshot: ${it.source_snapshot_id.slice(0, 8)}`
                        : ""}
                    </div>
                    {it.reason ? (
                      <div className="text-muted-foreground">reason: {it.reason}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : result && (!result.items || result.items.length === 0) ? (
              <p className="text-sm text-muted-foreground py-2">
                Scheduler returned no candidate items for this mapping and as-of date.
              </p>
            ) : null}
          </>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit official snapshot to KPI App?</AlertDialogTitle>
            <AlertDialogDescription>
              This will submit the selected official KPI snapshot to the external KPI App through
              the protected MuleSoft connector. This creates an external side effect. The
              submission is recorded in the outbox and attempt audit. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void invokeScheduler();
              }}
            >
              Confirm execute
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
