// BTPM — Wave C3, Step C3.9
// Automatic Snapshot Capture Monitor — admin-only, read-only audit
// view of run-kpi-snapshot-capture-scheduler execute runs.
//
// This is intentionally separate from the C2 KPI App Submission
// Monitor. It answers: "Did BTPM create the automatic snapshots it
// was supposed to create?" — NOT "Did BTPM submit them to the KPI
// App?".
//
// Hard rules:
//   - Read-only. Never creates snapshots, kpi_updates, outbox rows,
//     or attempt rows.
//   - Never calls MuleSoft / KPI App.
//   - Never displays raw calculation inputs, snapshot values,
//     comments, action plans, or upstream payloads.
//   - Never exposes secrets or operator activation toggles.

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
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
import { Info } from "lucide-react";
import {
  useKpiSnapshotCaptureRuns,
  useKpiSnapshotCaptureRunItems,
  type CaptureRun,
  type CaptureRunItemAction,
  type CaptureRunStatus,
} from "@/hooks/useKpiSnapshotCaptureMonitor";

type Props = {
  organizationId: string;
  workspaceId: string | null;
};

function fmtDt(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function statusBadge(s: CaptureRunStatus) {
  switch (s) {
    case "running":
      return <Badge variant="secondary">Running</Badge>;
    case "completed":
      return <Badge variant="default">Completed</Badge>;
    case "completed_with_errors":
      return <Badge variant="destructive">Completed with errors</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
  }
}

function actionBadge(a: CaptureRunItemAction) {
  switch (a) {
    case "created_snapshot":
      return <Badge variant="default">Created</Badge>;
    case "skipped_existing_snapshot":
      return <Badge variant="secondary">Skipped (exists)</Badge>;
    case "calculation_not_ready":
      return <Badge variant="outline">Calc not ready</Badge>;
    case "skipped_not_eligible":
      return <Badge variant="outline">Not eligible</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
  }
}

export function KpiSnapshotCaptureMonitor({
  organizationId,
  workspaceId,
}: Props) {
  const [invocationFilter, setInvocationFilter] = useState<"all" | "user" | "system">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | CaptureRunStatus>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<"all" | CaptureRunItemAction>("all");
  const [projectQuery, setProjectQuery] = useState("");

  const { data: runs, isLoading: runsLoading } = useKpiSnapshotCaptureRuns({
    organizationId,
    workspaceId,
    invocationSource: invocationFilter,
    status: statusFilter,
    fromDate: fromDate || null,
    toDate: toDate || null,
    limit: 50,
  });

  const selectedRun: CaptureRun | null = useMemo(() => {
    if (!selectedRunId) return runs?.[0] ?? null;
    return runs?.find((r) => r.id === selectedRunId) ?? null;
  }, [runs, selectedRunId]);

  const { data: items, isLoading: itemsLoading } = useKpiSnapshotCaptureRunItems(
    selectedRun?.id ?? null,
    { actionFilter },
  );

  const filteredItems = useMemo(() => {
    const list = items ?? [];
    const q = projectQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (it) =>
        (it.project_name ?? "").toLowerCase().includes(q) ||
        (it.kpi_name ?? "").toLowerCase().includes(q),
    );
  }, [items, projectQuery]);

  return (
    <div className="space-y-4">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <span className="font-medium">Automatic Snapshot Capture Monitor.</span>{" "}
          Shows recorded execute runs of the automatic snapshot capture
          scheduler. <strong>Automatic Snapshot Capture creates official
          snapshots. KPI App Auto-submit submits existing official snapshots —
          they are separate scheduled processes.</strong> The schedule policy
          (when each cadence is considered due) is configured in{" "}
          <em>Admin → KPI App Integration → KPI Scheduling</em>. Scheduler
          activation is configured through operations. Dry-run executions are
          not recorded here.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-xs text-muted-foreground">Invocation</label>
              <Select
                value={invocationFilter}
                onValueChange={(v) => setInvocationFilter(v as typeof invocationFilter)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Status</label>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="completed_with_errors">Completed w/ errors</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">From</label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">To</label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-[160px]"
              />
            </div>
          </div>

          {runsLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !runs || runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No automatic snapshot capture runs recorded yet for this scope.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>As-of</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Cand.</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                  <TableHead className="text-right">Skipped*</TableHead>
                  <TableHead className="text-right">Not ready</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => {
                  const isSelected = (selectedRun?.id ?? runs[0]?.id) === r.id;
                  return (
                    <TableRow
                      key={r.id}
                      className={
                        isSelected
                          ? "bg-muted/50 cursor-pointer"
                          : "cursor-pointer"
                      }
                      onClick={() => setSelectedRunId(r.id)}
                    >
                      <TableCell className="font-mono text-xs">{fmtDt(r.started_at)}</TableCell>
                      <TableCell className="font-mono text-xs">{fmtDt(r.completed_at)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.invocation_source}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.as_of_date}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell className="text-right">{r.candidate_count}</TableCell>
                      <TableCell className="text-right">{r.created_count}</TableCell>
                      <TableCell className="text-right">
                        {r.skipped_existing_snapshot_count}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.calculation_not_ready_count}
                      </TableCell>
                      <TableCell className="text-right">{r.failed_count}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground">
            * Skipped because an official snapshot already exists for that period.
            "Not eligible" candidates are counted separately and visible per item below.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Run items
            {selectedRun ? (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                · run started {fmtDt(selectedRun.started_at)}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-xs text-muted-foreground">Action</label>
              <Select
                value={actionFilter}
                onValueChange={(v) => setActionFilter(v as typeof actionFilter)}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="created_snapshot">Created snapshot</SelectItem>
                  <SelectItem value="skipped_existing_snapshot">Skipped (existing)</SelectItem>
                  <SelectItem value="calculation_not_ready">Calculation not ready</SelectItem>
                  <SelectItem value="skipped_not_eligible">Not eligible</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground">Search project / KPI</label>
              <Input
                value={projectQuery}
                onChange={(e) => setProjectQuery(e.target.value)}
                placeholder="Filter by project or KPI name…"
              />
            </div>
          </div>

          {!selectedRun ? (
            <p className="text-sm text-muted-foreground">
              Select a run to view its items.
            </p>
          ) : itemsLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : filteredItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No items match the current filters.
            </p>
          ) : (
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
                {filteredItems.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell>{it.project_name ?? "—"}</TableCell>
                    <TableCell>{it.kpi_name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{it.cadence}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {it.period_start && it.period_end
                        ? `${it.period_start} → ${it.period_end}`
                        : "—"}
                    </TableCell>
                    <TableCell>{actionBadge(it.action)}</TableCell>
                    <TableCell className="max-w-[320px] truncate" title={it.reason ?? ""}>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
