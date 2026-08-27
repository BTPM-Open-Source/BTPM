// BTPM — Wave C2, Step C2.12a
// Submission Monitor — workspace-scoped, read-only operational view of
// KPI App submissions, with stale-submitting reconciliation actions.
//
// Hard rules:
//   - Reads only non-sensitive outbox/attempt fields.
//   - Never displays decrypted comments / action plans / string values
//     / upstream body / error message details.
//   - Stale submitting = status='submitting' AND timestamp older than 30 min.
//   - Reconciliation goes through reconcile-kpi-app-submission only.
//   - Does not call MuleSoft. Does not retry. Does not insert attempts.

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { AlertTriangle, History, Info, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  isStaleSubmitting,
  useKpiAppAttemptAudit,
  useKpiAppOutboxMonitor,
  useReconcileKpiAppSubmission,
  type OutboxMonitorRow,
  type ReconcileAction,
} from "@/hooks/useKpiAppMonitor";
import { useLatestScheduledAutoSubmitRow } from "@/hooks/useKpiScheduleMonitor";

const STATUS_VALUES = [
  "queued",
  "payload_ready",
  "submitting",
  "submitted",
  "failed",
  "retry_pending",
  "skipped",
  "cancelled",
] as const;

type StatusKey = typeof STATUS_VALUES[number];

interface Props {
  organizationId: string;
  workspaceId: string | null;
}

export function KpiAppSubmissionMonitor({ organizationId, workspaceId }: Props) {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useKpiAppOutboxMonitor(organizationId, workspaceId);
  const reconcile = useReconcileKpiAppSubmission(organizationId, workspaceId);

  const [statusFilter, setStatusFilter] = useState<"all" | StatusKey>("all");
  const [modeFilter, setModeFilter] = useState<"all" | "manual" | "scheduled">("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [carryFilter, setCarryFilter] = useState<"all" | "yes" | "no">("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [search, setSearch] = useState("");

  const [auditOpen, setAuditOpen] = useState(false);
  const [auditOutboxId, setAuditOutboxId] = useState<string | null>(null);

  const [confirmRow, setConfirmRow] = useState<OutboxMonitorRow | null>(null);
  const [confirmAction, setConfirmAction] = useState<ReconcileAction | null>(null);

  const rows = data ?? [];

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => {
      if (r.project_id) map.set(r.project_id, r.project_name ?? r.project_id);
    });
    return Array.from(map.entries()).sort(([, a], [, b]) => a.localeCompare(b));
  }, [rows]);

  const counts = useMemo(() => {
    const c: Record<StatusKey, number> = {
      queued: 0,
      payload_ready: 0,
      submitting: 0,
      submitted: 0,
      failed: 0,
      retry_pending: 0,
      skipped: 0,
      cancelled: 0,
    };
    rows.forEach((r) => {
      if ((STATUS_VALUES as readonly string[]).includes(r.status)) {
        c[r.status as StatusKey] += 1;
      }
    });
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (modeFilter !== "all" && r.submission_mode !== modeFilter) return false;
      if (projectFilter !== "all" && r.project_id !== projectFilter) return false;
      if (carryFilter === "yes" && !r.carry_forward_used) return false;
      if (carryFilter === "no" && r.carry_forward_used) return false;
      if (dateFrom && r.reporting_period_start < dateFrom) return false;
      if (dateTo && r.reporting_period_end > dateTo) return false;
      if (!q) return true;
      const hay = [
        r.project_name ?? "",
        r.kpi_name ?? "",
        r.external_kpi_name ?? "",
        r.external_kpi_id != null ? `#${r.external_kpi_id}` : "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, statusFilter, modeFilter, projectFilter, carryFilter, dateFrom, dateTo, search]);

  function openAudit(id: string) {
    setAuditOutboxId(id);
    setAuditOpen(true);
  }

  async function runReconcile() {
    if (!confirmRow || !confirmAction) return;
    const res = await reconcile.mutateAsync({
      outbox_id: confirmRow.id,
      action: confirmAction,
    });
    setConfirmRow(null);
    setConfirmAction(null);
    if (res.ok) {
      toast({
        title: "Reconciliation applied",
        description:
          confirmAction === "mark_retry_pending"
            ? "Outbox row marked retry_pending. Use Retry from the Mappings tab when ready."
            : "Outbox row marked failed. No further automatic action will occur.",
      });
      refetch();
    } else {
      toast({
        title: "Reconciliation failed",
        description: res.error ?? "Could not reconcile this outbox row.",
        variant: "destructive",
      });
    }
  }

  if (!workspaceId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Select a workspace to view its submission monitor.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Operational monitor only. Submissions remain authoritative in{" "}
          <code>kpi_app_submission_outbox</code> and attempts are append-only. Retry of failed or
          retry_pending rows is performed from the Mappings tab. Reconciliation does not resubmit to
          the KPI App.
          <span className="block mt-1">
            <strong>Manual</strong> submissions come from Report Now.{" "}
            <strong>Scheduled</strong> submissions come from the KPI App
            Auto-submit scheduler driven by the policy in{" "}
            <em>Admin → KPI App Integration → KPI Scheduling</em>. Automatic
            Snapshot Capture is a separate scheduled process and is monitored in
            its own tab.
          </span>
        </AlertDescription>
      </Alert>

      <ScheduledAutoSubmitPanel organizationId={organizationId} workspaceId={workspaceId} />

      {/* Status summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {STATUS_VALUES.map((s) => (
          <Card key={s}>
            <CardContent className="py-3">
              <div className="text-xs text-muted-foreground">{s}</div>
              <div className="text-2xl font-semibold">{counts[s]}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <CardTitle className="text-base">Submissions</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 w-64"
                placeholder="Search project / KPI / external"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_VALUES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={modeFilter} onValueChange={(v: any) => setModeFilter(v)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All modes</SelectItem>
                <SelectItem value="manual">manual</SelectItem>
                <SelectItem value="scheduled">scheduled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Project" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projectOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={carryFilter} onValueChange={(v: any) => setCarryFilter(v)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Carry-forward (any)</SelectItem>
                <SelectItem value="yes">Carry-forward used</SelectItem>
                <SelectItem value="no">Carry-forward not used</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Period from</span>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-40"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No submissions match the current filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>BTPM KPI</TableHead>
                    <TableHead>External KPI</TableHead>
                    <TableHead>Reporting period</TableHead>
                    <TableHead>Validity</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Retries</TableHead>
                    <TableHead>HTTP</TableHead>
                    <TableHead>Last attempt</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const stale = isStaleSubmitting(r);
                    return (
                      <TableRow key={r.id}>
                        <TableCell>{r.project_name ?? "—"}</TableCell>
                        <TableCell>{r.kpi_name ?? "—"}</TableCell>
                        <TableCell>
                          {r.external_kpi_id != null
                            ? `#${r.external_kpi_id}${r.external_kpi_name ? ` · ${r.external_kpi_name}` : ""}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.reporting_period_start} → {r.reporting_period_end}
                        </TableCell>
                        <TableCell className="text-xs">{r.validity_date}</TableCell>
                        <TableCell>{r.submission_mode}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge
                              variant={
                                r.status === "submitted"
                                  ? "default"
                                  : r.status === "failed"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {r.status}
                            </Badge>
                            {r.carry_forward_used && (
                              <Badge variant="outline" className="text-xs">carry-fwd</Badge>
                            )}
                            {stale && (
                              <Badge variant="destructive" className="text-xs gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                Stale submitting — reconciliation required
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{r.payload_row_count ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.retry_count}</TableCell>
                        <TableCell className="text-xs">{r.last_http_status ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.last_attempt_at
                            ? new Date(r.last_attempt_at).toLocaleString()
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.submitted_at
                            ? new Date(r.submitted_at).toLocaleString()
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2 flex-wrap">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openAudit(r.id)}
                            >
                              <History className="h-3.5 w-3.5 mr-1" /> Attempts
                            </Button>
                            {stale && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setConfirmRow(r);
                                    setConfirmAction("mark_retry_pending");
                                  }}
                                  disabled={reconcile.isPending}
                                >
                                  Mark retry pending
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => {
                                    setConfirmRow(r);
                                    setConfirmAction("mark_failed");
                                  }}
                                  disabled={reconcile.isPending}
                                >
                                  Mark failed
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scheduler readiness — operational copy only */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduler readiness</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p>Scheduler wrapper is configured separately through operations.</p>
          <p>Only mappings with Auto-submit official snapshots enabled are processed.</p>
          <p>Failed and retry_pending rows require manual retry from the Mappings tab.</p>
          <p>Stale submitting rows require explicit reconciliation here.</p>
        </CardContent>
      </Card>

      {/* Attempt audit dialog */}
      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Attempt history</DialogTitle>
            <DialogDescription>
              Append-only audit. Sensitive upstream body and error details are not displayed.
            </DialogDescription>
          </DialogHeader>
          <AttemptAuditTable outboxId={auditOutboxId} />
        </DialogContent>
      </Dialog>

      {/* Reconciliation confirm dialog */}
      <AlertDialog
        open={!!confirmRow && !!confirmAction}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmRow(null);
            setConfirmAction(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "mark_retry_pending"
                ? "Mark this row retry_pending?"
                : "Mark this row failed?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              This does not resubmit to the KPI App. It only reconciles a stale submitting state so
              the record can be handled manually.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reconcile.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runReconcile} disabled={reconcile.isPending}>
              {reconcile.isPending ? "Working…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AttemptAuditTable({ outboxId }: { outboxId: string | null }) {
  const { data, isLoading, error } = useKpiAppAttemptAudit(outboxId);
  if (!outboxId) return null;
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Attempt history is only available to organization or workspace admins.
        </AlertDescription>
      </Alert>
    );
  }
  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No attempts recorded for this outbox row.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>When</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>HTTP</TableHead>
            <TableHead>Upstream status</TableHead>
            <TableHead>Elapsed (ms)</TableHead>
            <TableHead>Rows</TableHead>
            <TableHead>Request id</TableHead>
            <TableHead>Correlation id</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell>{a.attempt_number}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {new Date(a.attempted_at).toLocaleString()}
              </TableCell>
              <TableCell>{a.status}</TableCell>
              <TableCell>{a.http_status ?? "—"}</TableCell>
              <TableCell className="text-xs">{a.upstream_status_text ?? "—"}</TableCell>
              <TableCell className="text-xs">{a.elapsed_ms ?? "—"}</TableCell>
              <TableCell className="text-xs">{a.payload_row_count ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">{a.request_id ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">
                {a.external_correlation_id ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// C3.9m — Scheduled auto-submit context panel.
//
// Read-only highlight of the latest scheduled (system) auto-submit outbox
// row. Manual Report Now submissions remain visible in the table below; this
// panel separately surfaces scheduled-mode activity so admins can see whether
// the policy-driven scheduler has produced anything yet.
//
// Hard rules:
//   - No scheduler invocation, no MuleSoft call, no writes.
//   - Only non-sensitive metadata fields read (no decrypted comments,
//     action plans, payload bodies, error messages, secrets).
// ---------------------------------------------------------------------------
function ScheduledAutoSubmitPanel({
  organizationId,
  workspaceId,
}: {
  organizationId: string;
  workspaceId: string | null;
}) {
  const { data, isLoading } = useLatestScheduledAutoSubmitRow(
    organizationId,
    workspaceId,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Latest scheduled auto-submit</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        {!workspaceId ? (
          <p>Select a workspace to view scheduled auto-submit status.</p>
        ) : isLoading ? (
          <Skeleton className="h-5 w-64" />
        ) : !data ? (
          <p>
            No scheduled auto-submit runs recorded yet for this workspace.
            Manual Report Now submissions remain visible below.
          </p>
        ) : (
          <div className="space-y-1">
            <div>
              <Badge variant="outline" className="mr-2">
                scheduled
              </Badge>
              Status: <Badge variant="outline">{data.status}</Badge>
            </div>
            <div>
              Reporting period: {data.reporting_period_start} →{" "}
              {data.reporting_period_end}
            </div>
            <div>
              Submitted:{" "}
              {data.submitted_at
                ? new Date(data.submitted_at).toLocaleString()
                : "—"}{" "}
              · Last attempt:{" "}
              {data.last_attempt_at
                ? new Date(data.last_attempt_at).toLocaleString()
                : "—"}{" "}
              · HTTP: {data.last_http_status ?? "—"} · Rows:{" "}
              {data.payload_row_count ?? "—"} · Retries: {data.retry_count}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
