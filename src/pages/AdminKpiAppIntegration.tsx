// BTPM — Wave C2, Step C2.7
// Admin → KPI App Integration page.
// Configuration UX only:
//   - Read-only external KPI catalog (kpi_app_external_kpis)
//   - Mapping list with create / edit / deactivate / reactivate
//   - Optional read-only latest non-sensitive outbox metadata per mapping
//
// Hard rules:
//   - Does NOT call build-kpi-app-payload or submit-kpi-app-payload.
//   - Does NOT write to kpi_app_submission_outbox / kpi_app_submission_attempts.
//   - Does NOT show decrypted comments / action plans / string values / upstream body.
//   - Does NOT expose MuleSoft credentials or environment variables.
//   - Backend C2.3 validation trigger and RLS remain authoritative.

import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Info, Plug, Plus, Search, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useKpiAppExternalCatalog,
  useKpiAppMappings,
  useToggleKpiAppMappingActive,
  useAdminKpiAppWorkspaces,
  type KpiAppMapping,
  type MappingWithJoin,
} from "@/hooks/useKpiAppIntegration";
import { KpiAppMappingDialog } from "@/components/admin/KpiAppMappingDialog";
import { KpiAppReportNowDialog } from "@/components/admin/KpiAppReportNowDialog";
import { KpiAppRetryButton } from "@/components/admin/KpiAppRetryButton";
import { KpiAppResetButton } from "@/components/admin/KpiAppResetButton";
import { KpiAppSubmissionMonitor } from "@/components/admin/KpiAppSubmissionMonitor";
import { KpiAppAutoSubmitTestRunner } from "@/components/admin/KpiAppAutoSubmitTestRunner";
import { KpiSnapshotCaptureMonitor } from "@/components/admin/KpiSnapshotCaptureMonitor";
import { KpiSnapshotCaptureTestRunner } from "@/components/admin/KpiSnapshotCaptureTestRunner";
import { KpiSchedulingTab } from "@/components/admin/KpiSchedulingTab";
import { KpiAutomationProtocolPanel } from "@/components/admin/KpiAutomationProtocolPanel";
import { KpiAppCatalogFetchPanel } from "@/components/admin/KpiAppCatalogFetchPanel";
import { KpiAppDimensionsPanel } from "@/components/admin/KpiAppDimensionsPanel";
import { KpiAppValuesReadbackPlaceholder } from "@/components/admin/KpiAppValuesReadbackPlaceholder";

interface OutletCtx {
  organizationId: string;
}

export default function AdminKpiAppIntegration() {
  const { organizationId } = useOutletContext<OutletCtx>();
  const { toast } = useToast();

  // C2.7b — Admin KPI App Integration is workspace-scoped. AdminLayout does not
  // currently expose a shared workspace selector, so this page provides its own
  // local scope selector. All mapping/project queries below are filtered by it.
  const { data: workspaces = [], isLoading: workspacesLoading } =
    useAdminKpiAppWorkspaces(organizationId);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );

  const { data: catalog, isLoading: catalogLoading } = useKpiAppExternalCatalog(organizationId);
  const { data: mappings, isLoading: mappingsLoading } = useKpiAppMappings(
    organizationId,
    workspaceId,
  );
  const toggleActive = useToggleKpiAppMappingActive(organizationId);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [autoSubmitFilter, setAutoSubmitFilter] = useState<"all" | "yes" | "no">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<KpiAppMapping | null>(null);
  const [reportNowOpen, setReportNowOpen] = useState(false);
  const [reportNowMapping, setReportNowMapping] = useState<MappingWithJoin | null>(null);

  // C2.7b — close any open dialog if the workspace scope changes, to avoid
  // saving against stale workspace-filtered options.
  // The dialog itself also enforces this; this is a belt-and-braces guard.
  // (Nothing to do if dialog is already closed.)

  const filteredMappings: MappingWithJoin[] = useMemo(() => {
    const list = mappings ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((m) => {
      if (statusFilter === "active" && !m.is_active) return false;
      if (statusFilter === "inactive" && m.is_active) return false;
      if (autoSubmitFilter === "yes" && !m.auto_submit_enabled) return false;
      if (autoSubmitFilter === "no" && m.auto_submit_enabled) return false;
      if (!q) return true;
      const hay = [
        m.project_name ?? "",
        m.kpi_name ?? "",
        m.external_kpi_name ?? "",
        String(m.external_kpi_id),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [mappings, search, statusFilter, autoSubmitFilter]);

  async function handleToggle(m: MappingWithJoin) {
    try {
      await toggleActive.mutateAsync({ id: m.id, is_active: !m.is_active });
      toast({
        title: m.is_active ? "Mapping deactivated" : "Mapping reactivated",
      });
    } catch (e: any) {
      toast({
        title: "Action failed",
        description: e?.message ?? "Could not update mapping.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Plug className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-semibold text-foreground">
          KPI App Integration
          {selectedWorkspace ? (
            <span className="text-muted-foreground font-normal"> — {selectedWorkspace.name}</span>
          ) : null}
        </h2>
      </div>

      <Card>
        <CardContent className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            KPI App mappings are <strong>workspace-scoped</strong>. Choose a workspace to manage its
            mappings; the External KPI Catalog tab remains organization-level reference data.
          </div>
          <Select
            value={workspaceId ?? ""}
            onValueChange={(v) => {
              setWorkspaceId(v || null);
              // Close any open mapping dialog when scope changes.
              setDialogOpen(false);
              setEditing(null);
            }}
            disabled={workspacesLoading}
          >
            <SelectTrigger className="w-72">
              <SelectValue
                placeholder={workspacesLoading ? "Loading workspaces…" : "Select a workspace"}
              />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          This page configures KPI App mappings between BTPM project KPIs and the external KPI App catalog.
          Saving a mapping does <strong>not</strong> submit anything. KPIs based on <code>schedule_signal</code>
          are excluded from external mapping.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="mappings">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="mappings">Mappings</TabsTrigger>
          <TabsTrigger value="catalog">External KPI Catalog</TabsTrigger>
          <TabsTrigger value="api-read-test">API Read Test</TabsTrigger>
          <TabsTrigger value="monitor">Submission Monitor</TabsTrigger>
          <TabsTrigger value="capture-monitor">Snapshot Capture Monitor</TabsTrigger>
          <TabsTrigger value="scheduling">KPI Scheduling</TabsTrigger>
          <TabsTrigger value="protocol">Automation Protocol</TabsTrigger>
          <TabsTrigger value="values-readback">KPI DB Values Readback</TabsTrigger>
        </TabsList>

        <TabsContent value="mappings" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">KPI App Mappings</CardTitle>
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
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={autoSubmitFilter} onValueChange={(v: any) => setAutoSubmitFilter(v)}>
                  <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Auto-submit official snapshots (any)</SelectItem>
                    <SelectItem value="yes">Auto-submit official snapshots: on</SelectItem>
                    <SelectItem value="no">Auto-submit official snapshots: off</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => {
                    setEditing(null);
                    setDialogOpen(true);
                  }}
                  disabled={!workspaceId}
                >
                  <Plus className="h-4 w-4 mr-1" /> New mapping
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!workspaceId ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Select a workspace to manage KPI App mappings.
                </p>
              ) : mappingsLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : filteredMappings.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No mappings yet in <strong>{selectedWorkspace?.name ?? "this workspace"}</strong>.
                  Use <strong>New mapping</strong> to connect a project KPI from this workspace to an
                  external KPI.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>BTPM KPI</TableHead>
                        <TableHead>External KPI</TableHead>
                        <TableHead>Scenario / Currency</TableHead>
                        <TableHead>Frequency</TableHead>
                        <TableHead>Sources</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead>Latest submission</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMappings.map((m) => (
                        <TableRow key={m.id} className={!m.is_active ? "opacity-60" : ""}>
                          <TableCell>{m.project_name ?? "—"}</TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span>{m.kpi_name ?? "—"}</span>
                              <span className="text-xs text-muted-foreground">{m.kpi_value_type ?? ""}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span>#{m.external_kpi_id} {m.external_kpi_name ? `· ${m.external_kpi_name}` : ""}</span>
                              <span className="text-xs text-muted-foreground">{m.external_value_type ?? ""}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs">
                              s={m.scenario_id} / c={m.currency_id}
                            </span>
                          </TableCell>
                          <TableCell>{m.reporting_frequency}</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-0.5 text-xs">
                              <span>email: {m.entered_by_email_source}</span>
                              {m.auto_submit_enabled && (
                                <span className="text-muted-foreground italic">
                                  scheduled uses system email
                                </span>
                              )}
                              <span>comment: {m.comment_source}</span>
                              <span>action: {m.action_plan_source}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <Badge variant={m.is_active ? "default" : "secondary"}>
                                {m.is_active ? "Active" : "Inactive"}
                              </Badge>
                              {m.auto_submit_enabled && (
                                <Badge variant="outline" className="text-xs">Auto-submit official snapshots</Badge>
                              )}
                              {m.carry_forward_allowed && (
                                <Badge variant="outline" className="text-xs">carry-forward</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {m.latest_outbox ? (
                              m.latest_outbox.superseded_at ? (
                                <div className="flex flex-col text-xs">
                                  <span className="text-muted-foreground">
                                    <strong className="text-foreground">Reset</strong> · ready for a new Report Now
                                  </span>
                                  <span className="text-muted-foreground">
                                    previous attempt ({m.latest_outbox.status}
                                    {m.latest_outbox.last_http_status != null
                                      ? ` ${m.latest_outbox.last_http_status}`
                                      : ""}) superseded {new Date(m.latest_outbox.superseded_at).toLocaleString()}
                                  </span>
                                  <span className="text-muted-foreground">
                                    period {m.latest_outbox.reporting_period_start} → {m.latest_outbox.reporting_period_end}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex flex-col text-xs">
                                  <span>
                                    <strong>{m.latest_outbox.status}</strong>
                                    {m.latest_outbox.last_http_status != null
                                      ? ` (${m.latest_outbox.last_http_status})`
                                      : ""}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {m.latest_outbox.reporting_period_start} → {m.latest_outbox.reporting_period_end}
                                  </span>
                                  <span className="text-muted-foreground">
                                    rows: {m.latest_outbox.payload_row_count ?? "—"}
                                    {m.latest_outbox.carry_forward_used ? " · carry-fwd" : ""}
                                  </span>
                                  {m.latest_outbox.submitted_at && (
                                    <span className="text-muted-foreground">
                                      submitted: {new Date(m.latest_outbox.submitted_at).toLocaleString()}
                                    </span>
                                  )}
                                </div>
                              )
                            ) : (
                              <span className="text-xs text-muted-foreground">No submission history yet</span>
                            )}
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2 flex-wrap">
                              {m.is_active && m.kpi_calculation_key !== "schedule_signal" && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => {
                                    setReportNowMapping(m);
                                    setReportNowOpen(true);
                                  }}
                                >
                                  <Send className="h-3.5 w-3.5 mr-1" />
                                  Report Now
                                </Button>
                              )}
                              {m.latest_outbox?.id && (
                                <KpiAppRetryButton
                                  outboxId={m.latest_outbox.id}
                                  organizationId={organizationId}
                                  latestStatus={m.latest_outbox.status}
                                  supersededAt={m.latest_outbox.superseded_at}
                                />
                              )}
                              {m.latest_outbox?.id && (
                                <KpiAppResetButton
                                  outboxId={m.latest_outbox.id}
                                  organizationId={organizationId}
                                  latestStatus={m.latest_outbox.status}
                                  supersededAt={m.latest_outbox.superseded_at}
                                  lastAttemptAt={m.latest_outbox.last_attempt_at}
                                />
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditing(m);
                                  setDialogOpen(true);
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleToggle(m)}
                                disabled={toggleActive.isPending}
                              >
                                {m.is_active ? "Deactivate" : "Reactivate"}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="catalog" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">External KPI Catalog (read-only)</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Organization-level reference data, shared by all workspace mappings. Catalog rows
                are not workspace-specific and are not editable here.
              </p>
            </CardHeader>
            <CardContent>
              {catalogLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : !catalog || catalog.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No catalog rows visible.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>External KPI ID</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Value type</TableHead>
                        <TableHead>Default scenario</TableHead>
                        <TableHead>Default currency</TableHead>
                        <TableHead>State</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {catalog.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-mono">#{c.external_kpi_id}</TableCell>
                          <TableCell>{c.external_kpi_name}</TableCell>
                          <TableCell>{c.value_type}</TableCell>
                          <TableCell className="font-mono">{c.default_scenario_id}</TableCell>
                          <TableCell className="font-mono">{c.default_currency_id}</TableCell>
                          <TableCell>
                            <Badge variant={c.is_active ? "default" : "secondary"}>
                              {c.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              To call the KPI App API directly (live <code>/kpis</code> and{" "}
              <code>/dimensions</code> endpoints), use the <strong>API Read Test</strong> tab.
            </AlertDescription>
          </Alert>
        </TabsContent>

        <TabsContent value="api-read-test" className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Live read calls against the KPI App API. These tests are organization-level and do
              not require a workspace selection. No data is written to BTPM.
            </AlertDescription>
          </Alert>
          <KpiAppCatalogFetchPanel organizationId={organizationId} />
          <KpiAppDimensionsPanel organizationId={organizationId} />
        </TabsContent>

        <TabsContent value="values-readback" className="space-y-4">
          <KpiAppValuesReadbackPlaceholder />
        </TabsContent>

        <TabsContent value="monitor" className="space-y-4">
          <KpiAppAutoSubmitTestRunner
            organizationId={organizationId}
            workspaceId={workspaceId}
            workspaceName={selectedWorkspace?.name ?? null}
          />
          <KpiAppSubmissionMonitor
            organizationId={organizationId}
            workspaceId={workspaceId}
          />
        </TabsContent>

        <TabsContent value="capture-monitor" className="space-y-4">
          <KpiSnapshotCaptureTestRunner
            organizationId={organizationId}
            workspaceId={workspaceId}
            workspaceName={selectedWorkspace?.name ?? null}
          />
          <KpiSnapshotCaptureMonitor
            organizationId={organizationId}
            workspaceId={workspaceId}
          />
        </TabsContent>

        <TabsContent value="scheduling" className="space-y-4">
          <KpiSchedulingTab
            organizationId={organizationId}
            workspaceId={workspaceId}
            workspaceName={selectedWorkspace?.name ?? null}
          />
        </TabsContent>

        <TabsContent value="protocol" className="space-y-4">
          <KpiAutomationProtocolPanel
            organizationId={organizationId}
            workspaceId={workspaceId}
          />
        </TabsContent>
      </Tabs>


      <KpiAppMappingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        organizationId={organizationId}
        workspaceId={workspaceId}
        mapping={editing}
      />

      <KpiAppReportNowDialog
        open={reportNowOpen}
        onOpenChange={setReportNowOpen}
        organizationId={organizationId}
        mapping={reportNowMapping}
      />
    </div>
  );
}
