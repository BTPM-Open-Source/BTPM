// BTPM — Wave C2, Step C2.7
// KPI App Mapping create/edit dialog. Configuration only. No submission.

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useAdminAccessibleProjects,
  useKpiAppExternalCatalog,
  useProjectMappableKpis,
  useWorkspaceMembersForSelect,
  useCreateKpiAppMapping,
  useUpdateKpiAppMapping,
  type KpiAppMapping,
} from "@/hooks/useKpiAppIntegration";
import { useKpiAppSystemEmail } from "@/hooks/useKpiAppSystemEmail";

interface KpiAppMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** Currently selected workspace scope. Required — dialog is workspace-scoped (C2.7b). */
  workspaceId: string | null;
  /** Existing mapping when editing; undefined when creating. */
  mapping?: KpiAppMapping | null;
}

const FREQUENCY_OPTIONS = [
  { value: "manual_only", label: "Manual only" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
] as const;
const ENTERED_BY_OPTIONS = [
  { value: "submitted_by_user", label: "Submitting user" },
  { value: "snapshot_created_by", label: "Snapshot creator" },
  { value: "configured_user", label: "Configured user" },
] as const;
const COMMENT_OPTIONS = [
  { value: "snapshot", label: "From snapshot" },
  { value: "empty", label: "Empty" },
] as const;
const ACTION_PLAN_OPTIONS = COMMENT_OPTIONS;

export function KpiAppMappingDialog({
  open,
  onOpenChange,
  organizationId,
  workspaceId,
  mapping,
}: KpiAppMappingDialogProps) {
  const isEdit = !!mapping;
  const { toast } = useToast();

  const [projectId, setProjectId] = useState<string>(mapping?.project_id ?? "");
  const [kpiDefinitionId, setKpiDefinitionId] = useState<string>(mapping?.kpi_definition_id ?? "");
  const [externalKpiId, setExternalKpiId] = useState<number | null>(mapping?.external_kpi_id ?? null);
  const [scenarioId, setScenarioId] = useState<number>(mapping?.scenario_id ?? 1);
  const [currencyId, setCurrencyId] = useState<number>(mapping?.currency_id ?? 1);
  const [frequency, setFrequency] = useState<string>(mapping?.reporting_frequency ?? "monthly");
  const [autoSubmit, setAutoSubmit] = useState<boolean>(mapping?.auto_submit_enabled ?? false);
  const [carryForward, setCarryForward] = useState<boolean>(mapping?.carry_forward_allowed ?? false);
  const [enteredBySource, setEnteredBySource] = useState<string>(mapping?.entered_by_email_source ?? "submitted_by_user");
  const [enteredByUserId, setEnteredByUserId] = useState<string | null>(mapping?.entered_by_user_id ?? null);
  const [commentSource, setCommentSource] = useState<string>(mapping?.comment_source ?? "snapshot");
  const [actionPlanSource, setActionPlanSource] = useState<string>(mapping?.action_plan_source ?? "snapshot");
  const [isActive, setIsActive] = useState<boolean>(mapping?.is_active ?? true);

  // Reset state when opening for a different mapping.
  useEffect(() => {
    if (!open) return;
    setProjectId(mapping?.project_id ?? "");
    setKpiDefinitionId(mapping?.kpi_definition_id ?? "");
    setExternalKpiId(mapping?.external_kpi_id ?? null);
    setScenarioId(mapping?.scenario_id ?? 1);
    setCurrencyId(mapping?.currency_id ?? 1);
    setFrequency(mapping?.reporting_frequency ?? "monthly");
    setAutoSubmit(mapping?.auto_submit_enabled ?? false);
    setCarryForward(mapping?.carry_forward_allowed ?? false);
    setEnteredBySource(mapping?.entered_by_email_source ?? "submitted_by_user");
    setEnteredByUserId(mapping?.entered_by_user_id ?? null);
    setCommentSource(mapping?.comment_source ?? "snapshot");
    setActionPlanSource(mapping?.action_plan_source ?? "snapshot");
    setIsActive(mapping?.is_active ?? true);
  }, [open, mapping]);

  const { data: projects = [] } = useAdminAccessibleProjects(organizationId, workspaceId);
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );
  const { data: projectKpis = [] } = useProjectMappableKpis(projectId || null);
  const selectedKpi = useMemo(
    () => projectKpis.find((k) => k.id === kpiDefinitionId) ?? null,
    [projectKpis, kpiDefinitionId],
  );
  const { data: catalog = [] } = useKpiAppExternalCatalog(organizationId);
  const filteredCatalog = useMemo(() => {
    const active = catalog.filter((c) => c.is_active);
    if (!selectedKpi) return active;
    return active.filter((c) => c.value_type === selectedKpi.value_type);
  }, [catalog, selectedKpi]);
  const selectedExternal = useMemo(
    () => catalog.find((c) => c.external_kpi_id === externalKpiId) ?? null,
    [catalog, externalKpiId],
  );
  const { data: wsMembers = [] } = useWorkspaceMembersForSelect(workspaceId ?? null);

  // C3.10d — Resolve the configured scheduled-auto-submit system email via
  // the admin-gated Edge Function. Only fetched when the auto-submit toggle
  // is on (which is when this section is visible).
  const { data: systemEmail, isLoading: systemEmailLoading } =
    useKpiAppSystemEmail(organizationId, workspaceId, autoSubmit);

  // C2.7b — if the selected workspace changes while the dialog is open, close
  // it so the user cannot save against stale workspace-filtered options.
  useEffect(() => {
    if (!open) return;
    if (isEdit && mapping && mapping.workspace_id !== workspaceId) {
      onOpenChange(false);
      return;
    }
    if (!isEdit && !workspaceId) {
      onOpenChange(false);
    }
  }, [open, workspaceId, isEdit, mapping, onOpenChange]);

  // When user picks an external KPI, prefill its defaults (only on create or when changed).
  useEffect(() => {
    if (!selectedExternal) return;
    if (!isEdit) {
      setScenarioId(selectedExternal.default_scenario_id);
      setCurrencyId(selectedExternal.default_currency_id);
    }
  }, [selectedExternal?.external_kpi_id]);

  // If user changes BTPM KPI to one with a different value_type, clear external.
  useEffect(() => {
    if (!selectedKpi || !selectedExternal) return;
    if (selectedExternal.value_type !== selectedKpi.value_type) {
      setExternalKpiId(null);
    }
  }, [selectedKpi?.value_type]);

  const createMutation = useCreateKpiAppMapping(organizationId);
  const updateMutation = useUpdateKpiAppMapping(organizationId);
  const submitting = createMutation.isPending || updateMutation.isPending;

  const valueTypeMismatch =
    !!selectedKpi && !!selectedExternal && selectedKpi.value_type !== selectedExternal.value_type;

  // C3.10c — Scheduled (auto-submit) submissions now always use the BTPM
  // system email identity (resolved server-side from
  // KPI_APP_SYSTEM_ENTERED_BY_EMAIL). The mapping's entered_by_email_source
  // therefore only governs manual Report Now flows; submitted_by_user is
  // valid alongside auto-submit and no longer needs to be blocked.
  const canSave =
    !!selectedProject &&
    !!selectedKpi &&
    !!selectedExternal &&
    !valueTypeMismatch &&
    (enteredBySource !== "configured_user" || !!enteredByUserId);

  async function handleSave() {
    if (!selectedProject || !selectedKpi || !selectedExternal) return;
    if (!isEdit && !workspaceId) {
      toast({
        title: "Workspace required",
        description: "Select a workspace before creating a mapping.",
        variant: "destructive",
      });
      return;
    }
    try {
      if (isEdit && mapping) {
        await updateMutation.mutateAsync({
          id: mapping.id,
          patch: {
            external_kpi_id: selectedExternal.external_kpi_id,
            scenario_id: scenarioId,
            currency_id: currencyId,
            reporting_frequency: frequency,
            auto_submit_enabled: autoSubmit,
            carry_forward_allowed: carryForward,
            entered_by_email_source: enteredBySource,
            entered_by_user_id: enteredBySource === "configured_user" ? enteredByUserId : null,
            comment_source: commentSource,
            action_plan_source: actionPlanSource,
            is_active: isActive,
          },
        });
        toast({ title: "Mapping updated" });
      } else {
        await createMutation.mutateAsync({
          organization_id: organizationId,
          workspace_id: workspaceId!,
          project_id: selectedProject.id,
          kpi_definition_id: selectedKpi.id,
          external_kpi_id: selectedExternal.external_kpi_id,
          scenario_id: scenarioId,
          currency_id: currencyId,
          reporting_frequency: frequency,
          auto_submit_enabled: autoSubmit,
          carry_forward_allowed: carryForward,
          entered_by_email_source: enteredBySource,
          entered_by_user_id: enteredBySource === "configured_user" ? enteredByUserId : null,
          comment_source: commentSource,
          action_plan_source: actionPlanSource,
          is_active: isActive,
        });
        toast({ title: "Mapping created" });
      }
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Save failed",
        description: e?.message ?? "Could not save the mapping.",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit KPI App mapping" : "Create KPI App mapping"}</DialogTitle>
          <DialogDescription>
            Mappings are configuration only. Saving here does not submit anything to the external KPI App.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              KPIs whose calculation is <code>schedule_signal</code> are excluded from external mapping.
              Manual <em>Report Now</em> arrives in C2.9; scheduled reporting in C2.11. Mappings do not
              submit anything by themselves.
            </AlertDescription>
          </Alert>

          {/* Project */}
          <div className="space-y-2">
            <Label>Project</Label>
            <Select
              value={projectId}
              onValueChange={(v) => {
                setProjectId(v);
                setKpiDefinitionId("");
                setExternalKpiId(null);
              }}
              disabled={isEdit}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    No projects are available in the selected workspace.
                  </div>
                )}
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit && (
              <p className="text-xs text-muted-foreground">
                To change project or BTPM KPI, deactivate this mapping and create a new one.
              </p>
            )}
          </div>

          {/* BTPM KPI */}
          <div className="space-y-2">
            <Label>BTPM KPI</Label>
            <Select
              value={kpiDefinitionId}
              onValueChange={(v) => {
                setKpiDefinitionId(v);
                setExternalKpiId(null);
              }}
              disabled={!projectId || isEdit}
            >
              <SelectTrigger>
                <SelectValue placeholder={projectId ? "Select a KPI" : "Pick a project first"} />
              </SelectTrigger>
              <SelectContent>
                {projectKpis.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    No eligible KPIs are available for this project.
                  </div>
                )}
                {projectKpis.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.name} <span className="text-muted-foreground">· {k.value_type}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* External KPI */}
          <div className="space-y-2">
            <Label>External KPI</Label>
            <Select
              value={externalKpiId != null ? String(externalKpiId) : ""}
              onValueChange={(v) => setExternalKpiId(Number(v))}
              disabled={!selectedKpi}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={selectedKpi ? "Select an external KPI" : "Pick a BTPM KPI first"}
                />
              </SelectTrigger>
              <SelectContent>
                {filteredCatalog.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    No matching external KPIs (filtered by value type).
                  </div>
                )}
                {filteredCatalog.map((c) => (
                  <SelectItem key={c.external_kpi_id} value={String(c.external_kpi_id)}>
                    #{c.external_kpi_id} — {c.external_kpi_name}{" "}
                    <span className="text-muted-foreground">· {c.value_type}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {valueTypeMismatch && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Value type mismatch — backend will reject this. Pick an external KPI that matches the BTPM KPI's value type.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Scenario ID</Label>
              <Input
                type="number"
                min={1}
                value={scenarioId}
                onChange={(e) => setScenarioId(Number(e.target.value) || 1)}
              />
            </div>
            <div className="space-y-2">
              <Label>Currency ID</Label>
              <Input
                type="number"
                min={1}
                value={currencyId}
                onChange={(e) => setCurrencyId(Number(e.target.value) || 1)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Reporting frequency</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Active</Label>
              <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-input">
                <Switch checked={isActive} onCheckedChange={setIsActive} />
                <span className="text-sm text-muted-foreground">
                  {isActive ? "Mapping is active" : "Mapping is inactive"}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Auto-submit official snapshots</Label>
              <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-input">
                <Switch checked={autoSubmit} onCheckedChange={setAutoSubmit} />
                <span className="text-xs text-muted-foreground">
                  {autoSubmit ? "On" : "Off"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-snug">
                Automatically submits existing official snapshots to the KPI
                App. It does not create snapshots. Enable automatic snapshot
                capture separately if you want BTPM to create official
                snapshots on schedule.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Carry-forward allowed</Label>
              <div className="flex items-center gap-2 h-10 px-3 rounded-md border border-input">
                <Switch checked={carryForward} onCheckedChange={setCarryForward} />
                <span className="text-xs text-muted-foreground">
                  Reuse previous snapshot when current is missing.
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Comment source</Label>
              <Select value={commentSource} onValueChange={setCommentSource}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMENT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Action plan source</Label>
              <Select value={actionPlanSource} onValueChange={setActionPlanSource}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_PLAN_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* C3.10d — Manual Report Now entered-by source */}
          <div className="space-y-2 rounded-md border border-input p-3">
            <div className="space-y-1">
              <Label className="text-sm font-semibold">
                Manual Report Now entered-by source
              </Label>
              <p className="text-xs text-muted-foreground">
                Applies only when a user clicks <em>Report Now</em>. Does not
                affect scheduled auto-submit.
              </p>
            </div>
            <Select value={enteredBySource} onValueChange={setEnteredBySource}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTERED_BY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {enteredBySource === "configured_user" && (
              <div className="space-y-2 pt-2">
                <Label>Configured user</Label>
                <Select
                  value={enteredByUserId ?? ""}
                  onValueChange={setEnteredByUserId}
                  disabled={!selectedProject}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a workspace member" />
                  </SelectTrigger>
                  <SelectContent>
                    {wsMembers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!enteredByUserId && (
                  <p className="text-xs text-destructive">
                    A configured user is required when entered-by source is &quot;Configured user&quot;.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* C3.10d — Scheduled auto-submit entered-by source (read-only) */}
          {autoSubmit && (
            <div className="space-y-2 rounded-md border border-input p-3 bg-muted/30">
              <div className="space-y-1">
                <Label className="text-sm font-semibold">
                  Scheduled auto-submit entered-by source
                </Label>
                <p className="text-xs text-muted-foreground">
                  Scheduled auto-submit always uses the BTPM system email. It
                  never acts on behalf of a real user. This value is configured
                  by operations and cannot be changed from this dialog.
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  System email
                </Label>
                <Input
                  readOnly
                  disabled
                  value={
                    systemEmailLoading
                      ? "Loading…"
                      : systemEmail?.configured && systemEmail.system_entered_by_email
                        ? systemEmail.system_entered_by_email
                        : "Not configured"
                  }
                />
                {!systemEmailLoading && systemEmail && !systemEmail.configured && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      System email is not configured. Scheduled auto-submit
                      will fail until operations configures it.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || submitting}>
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Create mapping"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
