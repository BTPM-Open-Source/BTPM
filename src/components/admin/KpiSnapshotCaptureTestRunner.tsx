// BTPM — Wave C3, Step C3.9d
// Admin Snapshot Capture Test Runner UX.
//
// Controlled admin-only validation UI that invokes the existing
// `run-kpi-snapshot-capture-scheduler` Edge Function in user mode
// (dry_run | execute) for the selected workspace, with optional
// project / KPI filters and an as-of date.
//
// Hard rules (do NOT relax):
//   - Workspace-scoped only (mirrors C2.7b/C3.9 pattern).
//   - Reuses authority gates already enforced by the scheduler
//     (org admin or workspace admin).
//   - Does NOT call MuleSoft / KPI App / submit-kpi-app-payload.
//   - Does NOT touch kpi_app_submission_outbox / _attempts.
//   - Does NOT write kpi_updates.
//   - Does NOT activate cron / scheduler cadence.
//   - Does NOT change KPI calculation formulas.
//   - Does NOT show raw calculation inputs, generated comments, or
//     other sensitive payload fields — only audit-style outcomes.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { FlaskConical, Info, PlayCircle } from "lucide-react";
import { useAdminAccessibleProjects } from "@/hooks/useKpiAppIntegration";

type Mode = "dry_run" | "execute";

type RunnerAction =
  | "would_create_snapshot"
  | "created_snapshot"
  | "skipped_existing_snapshot"
  | "skipped_not_eligible"
  | "calculation_not_ready"
  | "failed";

interface RunnerItem {
  organization_id: string;
  workspace_id: string;
  project_id: string;
  project_name: string | null;
  kpi_definition_id: string;
  kpi_name: string | null;
  calculation_key: string | null;
  cadence: string;
  period_start: string | null;
  period_end: string | null;
  action: RunnerAction;
  reason?: string | null;
  snapshot_id?: string | null;
  existing_snapshot_id?: string | null;
}

interface RunnerResponse {
  ok: boolean;
  request_id?: string;
  mode?: Mode;
  as_of_date?: string;
  run_id?: string | null;
  candidate_count?: number;
  created_count?: number;
  skipped_existing_snapshot_count?: number;
  calculation_not_ready_count?: number;
  failed_count?: number;
  items?: RunnerItem[];
  error?: string;
}

// Eligible automatic KPIs for a project (auto_snapshot_enabled & not manual-only).
function useEligibleAutomaticKpis(projectId: string | null) {
  return useQuery({
    queryKey: ["c3-9d-eligible-auto-kpis", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_definitions")
        .select(
          "id, name, calculation_key, cadence, source_mode, auto_snapshot_enabled, is_archived, target_type, target_id",
        )
        .eq("target_type", "project")
        .eq("target_id", projectId!)
        .eq("is_archived", false)
        .eq("auto_snapshot_enabled", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []).filter(
        (k) =>
          k.source_mode !== "manual" &&
          k.cadence !== "manual_only" &&
          k.calculation_key !== "schedule_signal",
      );
    },
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function actionBadge(a: RunnerAction) {
  switch (a) {
    case "would_create_snapshot":
      return <Badge variant="secondary">Would create</Badge>;
    case "created_snapshot":
      return <Badge variant="default">Created</Badge>;
    case "skipped_existing_snapshot":
      return <Badge variant="secondary">Skipped (exists)</Badge>;
    case "skipped_not_eligible":
      return <Badge variant="outline">Not eligible</Badge>;
    case "calculation_not_ready":
      return <Badge variant="outline">Calc not ready</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
  }
}

interface Props {
  organizationId: string;
  workspaceId: string | null;
  workspaceName?: string | null;
}

export function KpiSnapshotCaptureTestRunner({
  organizationId,
  workspaceId,
  workspaceName,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [mode, setMode] = useState<Mode>("dry_run");
  const [asOfDate, setAsOfDate] = useState<string>(todayIso());
  const [projectId, setProjectId] = useState<string | "all">("all");
  const [kpiId, setKpiId] = useState<string | "all">("all");
  const [running, setRunning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<RunnerResponse | null>(null);

  const { data: projects = [], isLoading: projectsLoading } =
    useAdminAccessibleProjects(organizationId, workspaceId);

  const effectiveProjectId = projectId === "all" ? null : projectId;
  const { data: kpis = [], isLoading: kpisLoading } =
    useEligibleAutomaticKpis(effectiveProjectId);

  const canRun = !!workspaceId && !running;

  const summary = useMemo(() => {
    if (!result?.items) return null;
    const items = result.items;
    return {
      total: items.length,
      created: items.filter((i) => i.action === "created_snapshot").length,
      would: items.filter((i) => i.action === "would_create_snapshot").length,
      skippedExisting: items.filter(
        (i) => i.action === "skipped_existing_snapshot",
      ).length,
      notEligible: items.filter((i) => i.action === "skipped_not_eligible")
        .length,
      notReady: items.filter((i) => i.action === "calculation_not_ready")
        .length,
      failed: items.filter((i) => i.action === "failed").length,
    };
  }, [result]);

  async function invokeScheduler(actualMode: Mode): Promise<void> {
    if (!workspaceId) return;
    setRunning(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        mode: actualMode,
        as_of_date: asOfDate,
        workspace_id: workspaceId,
      };
      if (projectId !== "all") body.project_id = projectId;
      if (kpiId !== "all") body.kpi_definition_id = kpiId;

      const { data, error } = await supabase.functions.invoke(
        "run-kpi-snapshot-capture-scheduler",
        { body },
      );
      if (error) {
        const msg =
          (data && typeof data === "object" && (data as RunnerResponse).error) ||
          error.message ||
          "Scheduler invocation failed";
        throw new Error(msg);
      }
      const r = (data ?? {}) as RunnerResponse;
      if (r.ok === false) {
        throw new Error(r.error ?? "Scheduler returned an error");
      }
      setResult(r);

      if (actualMode === "execute") {
        // Refresh capture monitor + project KPI caches.
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["kpi-snapshot-capture-runs"] }),
          qc.invalidateQueries({
            queryKey: ["kpi-snapshot-capture-run-items"],
          }),
          qc.invalidateQueries({ queryKey: ["kpi-snapshots"] }),
          qc.invalidateQueries({ queryKey: ["project-kpis"] }),
        ]);
        toast({
          title: "Snapshot capture executed",
          description: `Created ${r.created_count ?? 0} · Skipped (exists) ${
            r.skipped_existing_snapshot_count ?? 0
          } · Not ready ${r.calculation_not_ready_count ?? 0} · Failed ${
            r.failed_count ?? 0
          }`,
        });
      } else {
        toast({
          title: "Dry run complete",
          description: `Candidates: ${r.candidate_count ?? r.items?.length ?? 0}`,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast({
        title: "Test run failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  }

  function onPrimaryClick() {
    if (!canRun) return;
    if (mode === "execute") {
      setConfirmOpen(true);
    } else {
      void invokeScheduler("dry_run");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4 mr-1 text-primary" />
          Test snapshot capture
          {workspaceName ? (
            <span className="font-normal text-muted-foreground">
              · {workspaceName}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Use this to test automatic snapshot capture without waiting for the
            scheduled run. The selected as-of date simulates the scheduler date
            and resolves the most recently completed reporting period. This
            does <strong>not</strong> change KPI cadence and does{" "}
            <strong>not</strong> submit to the KPI App.
          </AlertDescription>
        </Alert>

        {!workspaceId ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Select a workspace above to enable the test runner.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Mode</label>
                <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dry_run">Dry run</SelectItem>
                    <SelectItem value="execute">Execute</SelectItem>
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
              <div>
                <label className="text-xs text-muted-foreground">Project</label>
                <Select
                  value={projectId}
                  onValueChange={(v) => {
                    setProjectId(v);
                    setKpiId("all");
                  }}
                  disabled={projectsLoading}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        projectsLoading ? "Loading…" : "All projects"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All projects</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">KPI</label>
                <Select
                  value={kpiId}
                  onValueChange={setKpiId}
                  disabled={projectId === "all" || kpisLoading}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        projectId === "all"
                          ? "Pick a project first"
                          : kpisLoading
                            ? "Loading…"
                            : "All eligible KPIs"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All eligible KPIs</SelectItem>
                    {kpis.map((k) => (
                      <SelectItem key={k.id} value={k.id}>
                        {k.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  onClick={onPrimaryClick}
                  disabled={!canRun}
                >
                  <PlayCircle className="h-4 w-4 mr-1" />
                  {running
                    ? "Running…"
                    : mode === "dry_run"
                      ? "Run dry run"
                      : "Run execute"}
                </Button>
              </div>
            </div>

            {result?.items ? (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                  <span>
                    Mode:{" "}
                    <strong className="text-foreground">{result.mode}</strong>
                  </span>
                  <span>As-of: {result.as_of_date}</span>
                  {result.run_id ? (
                    <span className="font-mono">
                      run: {result.run_id.slice(0, 8)}
                    </span>
                  ) : null}
                  {summary ? (
                    <>
                      <span>Candidates: {summary.total}</span>
                      {summary.would > 0 && <span>Would create: {summary.would}</span>}
                      {summary.created > 0 && <span>Created: {summary.created}</span>}
                      {summary.skippedExisting > 0 && (
                        <span>Skipped (exists): {summary.skippedExisting}</span>
                      )}
                      {summary.notEligible > 0 && (
                        <span>Not eligible: {summary.notEligible}</span>
                      )}
                      {summary.notReady > 0 && (
                        <span>Calc not ready: {summary.notReady}</span>
                      )}
                      {summary.failed > 0 && <span>Failed: {summary.failed}</span>}
                    </>
                  ) : null}
                </div>
                {result.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No candidates returned for this scope and as-of date.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Project</TableHead>
                          <TableHead>KPI</TableHead>
                          <TableHead>Cadence</TableHead>
                          <TableHead>Period</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead>Snapshot</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.items.map((it, i) => (
                          <TableRow key={`${it.kpi_definition_id}-${i}`}>
                            <TableCell>{it.project_name ?? "—"}</TableCell>
                            <TableCell>{it.kpi_name ?? "—"}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {it.cadence}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {it.period_start && it.period_end
                                ? `${it.period_start} → ${it.period_end}`
                                : "—"}
                            </TableCell>
                            <TableCell>{actionBadge(it.action)}</TableCell>
                            <TableCell
                              className="max-w-[280px] truncate"
                              title={it.reason ?? ""}
                            >
                              {it.reason ?? "—"}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {it.snapshot_id
                                ? it.snapshot_id.slice(0, 8)
                                : it.existing_snapshot_id
                                  ? `${it.existing_snapshot_id.slice(0, 8)} (existing)`
                                  : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Execute snapshot capture?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create official KPI snapshots for eligible automatic
              KPIs for the completed reporting period resolved from the
              selected as-of date. It will <strong>not</strong> submit anything
              to the KPI App.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void invokeScheduler("execute");
              }}
            >
              Execute
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
