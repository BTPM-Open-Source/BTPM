import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FieldLabel } from "@/components/ui/field-label";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, Target, Info } from "lucide-react";
import { useCreateKpiDefinition, useUpdateKpiDefinition } from "@/hooks/useProjectKpis";
import {
  listAutomaticKpiDefinitions,
  getAutomaticKpiDefinition,
  isAutomaticKpiCalculationKey,
  type AutomaticKpiCalculationKey,
} from "@/lib/kpi/automaticKpiLibrary";
import { evaluateAutoSnapshotEligibility } from "@/lib/kpi/autoSnapshotEligibility";
import type { Tables } from "@/integrations/supabase/types";

type KpiDef = Tables<"kpi_definitions">;

const DIRECTIONS = [
  { value: "increase", label: "Increase ↑", icon: TrendingUp },
  { value: "decrease", label: "Decrease ↓", icon: TrendingDown },
  { value: "maintain", label: "Maintain →", icon: Minus },
  { value: "target_exact", label: "Exact =", icon: Target },
];

const VALUE_TYPES = [
  { value: "percent", label: "Percent (%)" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "text", label: "Text" },
];

const CADENCES = [
  { value: "manual_only", label: "Manual only" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const COMPLETION_METHODS = [
  { value: "task_count", label: "Task count" },
  { value: "duration_weighted", label: "Duration-weighted" },
];

type SourceMode = "manual" | "automatic";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  workspaceId: string;
  organizationId: string;
  initial?: KpiDef;
}

export function KpiDefinitionDialog({ open, onOpenChange, projectId, workspaceId, organizationId, initial }: Props) {
  const createKpi = useCreateKpiDefinition(projectId);
  const updateKpi = useUpdateKpiDefinition(projectId);
  const isEdit = !!initial;

  const automaticLibrary = useMemo(() => listAutomaticKpiDefinitions(), []);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [targetDirection, setTargetDirection] = useState<string>("target_exact");

  // C1.5 new fields
  const [sourceMode, setSourceMode] = useState<SourceMode>("manual");
  const [valueType, setValueType] = useState<string>("number");
  const [cadence, setCadence] = useState<string>("manual_only");
  const [calculationKey, setCalculationKey] = useState<string>("");
  const [formulaVersion, setFormulaVersion] = useState<number | null>(null);
  const [completionMethod, setCompletionMethod] = useState<string | null>(null);
  const [commentRequired, setCommentRequired] = useState(false);
  const [actionPlanRequired, setActionPlanRequired] = useState(false);
  // Wave C3 — Step C3.7: editable automatic snapshot capture flag.
  const [autoSnapshotEnabled, setAutoSnapshotEnabled] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name || "");
    setDescription(initial?.description || "");
    setUnit(initial?.unit || "");
    setTargetValue(initial?.target_value?.toString() || "");
    setTargetDirection(initial?.target_direction || "target_exact");
    const mode = (initial?.source_mode as SourceMode) || "manual";
    setSourceMode(mode);
    setValueType(initial?.value_type || "number");
    setCadence(initial?.cadence || "manual_only");
    setCalculationKey(initial?.calculation_key || "");
    setFormulaVersion(initial?.formula_version ?? null);
    setCompletionMethod(initial?.completion_method ?? null);
    setCommentRequired(!!initial?.comment_required);
    setActionPlanRequired(!!initial?.action_plan_required);
    // C3.7: hydrate from existing record (default false for create).
    setAutoSnapshotEnabled(
      !!(initial as (KpiDef & { auto_snapshot_enabled?: boolean }) | undefined)
        ?.auto_snapshot_enabled,
    );
  }, [open, initial]);

  const selectedAutoDef = useMemo(() => {
    return isAutomaticKpiCalculationKey(calculationKey)
      ? getAutomaticKpiDefinition(calculationKey as AutomaticKpiCalculationKey)
      : null;
  }, [calculationKey]);

  // Wave C3 — Step C3.7: eligibility for automatic snapshot capture.
  // The KPI is being edited (not yet saved) so archived state comes
  // from `initial` only — archive transitions are handled elsewhere
  // (lifecycle RPC) and the DB trigger auto-disables on archive.
  const autoSnapshotEligibility = useMemo(
    () =>
      evaluateAutoSnapshotEligibility({
        source_mode: sourceMode,
        cadence,
        calculation_key: sourceMode === "automatic" ? calculationKey : null,
        is_archived: initial?.is_archived ?? false,
      }),
    [sourceMode, cadence, calculationKey, initial?.is_archived],
  );

  // Coerce the toggle to false whenever the KPI becomes ineligible
  // in the form. DB trigger remains the final authority on save.
  useEffect(() => {
    if (!autoSnapshotEligibility.eligible && autoSnapshotEnabled) {
      setAutoSnapshotEnabled(false);
    }
  }, [autoSnapshotEligibility, autoSnapshotEnabled]);

  // When user picks an automatic KPI from the library, auto-populate dependent fields
  const handleAutomaticKpiPick = (key: string) => {
    if (!isAutomaticKpiCalculationKey(key)) return;
    const def = getAutomaticKpiDefinition(key as AutomaticKpiCalculationKey);
    setCalculationKey(key);
    setValueType(def.valueType);
    setFormulaVersion(def.defaultFormulaVersion);
    if (!name.trim() || !isEdit) setName(def.name);
    if (def.completionMethodRequirement === "selector") {
      setCompletionMethod((prev) => prev ?? "task_count");
    } else {
      setCompletionMethod(null);
    }
  };

  // Switching mode resets automatic-only fields
  const handleSourceModeChange = (mode: SourceMode) => {
    setSourceMode(mode);
    if (mode === "manual") {
      setCalculationKey("");
      setFormulaVersion(null);
      setCompletionMethod(null);
    }
  };

  const validationError = useMemo<string | null>(() => {
    if (!name.trim()) return "Name is required";
    if (sourceMode === "automatic") {
      if (!isAutomaticKpiCalculationKey(calculationKey)) {
        return "Pick an automatic KPI from the library";
      }
      const def = getAutomaticKpiDefinition(calculationKey as AutomaticKpiCalculationKey);
      if (def.completionMethodRequirement === "selector") {
        if (completionMethod && !["task_count", "duration_weighted"].includes(completionMethod)) {
          return "Invalid completion method";
        }
      }
    }
    if (!VALUE_TYPES.some((v) => v.value === valueType)) return "Invalid value type";
    if (!CADENCES.some((c) => c.value === cadence)) return "Invalid update cadence";
    return null;
  }, [name, sourceMode, calculationKey, completionMethod, valueType, cadence]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError) return;

    const parsedTarget = targetValue ? parseFloat(targetValue) : undefined;

    const sharedExtra = {
      source_mode: sourceMode,
      value_type: valueType,
      cadence,
      calculation_key: sourceMode === "automatic" ? calculationKey : null,
      formula_version: sourceMode === "automatic" ? (formulaVersion ?? null) : null,
      completion_method:
        sourceMode === "automatic" && selectedAutoDef?.completionMethodRequirement === "selector"
          ? (completionMethod ?? "task_count")
          : null,
      comment_required: commentRequired,
      action_plan_required: actionPlanRequired,
      // C3.7 — only persist true when eligibility holds at submit time.
      // DB trigger remains final authority.
      auto_snapshot_enabled:
        autoSnapshotEligibility.eligible && autoSnapshotEnabled,
    };

    if (isEdit && initial) {
      updateKpi.mutate(
        {
          id: initial.id,
          name: name.trim(),
          description,
          unit,
          target_value: targetValue ? parseFloat(targetValue) : null,
          target_direction: targetDirection as any,
          organization_id: organizationId,
          ...sharedExtra,
        },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      createKpi.mutate(
        {
          name: name.trim(),
          description: description || undefined,
          unit: unit || undefined,
          target_value: parsedTarget,
          target_direction: targetDirection as any,
          workspace_id: workspaceId,
          organization_id: organizationId,
          ...sharedExtra,
        },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  };

  const isSubmitting = createKpi.isPending || updateKpi.isPending;
  const isAutomatic = sourceMode === "automatic";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit KPI" : "Create KPI"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* ── Section 1 — KPI basics ── */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">KPI basics</h3>

            <div className="space-y-1">
              <FieldLabel hint="Short, recognisable name for this KPI as it appears in dashboards and reports." required>
                Name
              </FieldLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sprint Velocity" required />
            </div>

            <div className="space-y-1">
              <FieldLabel hint="Optional explanation of what this KPI measures and how it should be interpreted.">
                Description
              </FieldLabel>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this KPI measures" rows={2} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <FieldLabel hint="Manual KPIs are entered by users. Automatic KPIs are calculated from project data using a controlled library.">
                  KPI type
                </FieldLabel>
                <Select value={sourceMode} onValueChange={(v) => handleSourceModeChange(v as SourceMode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual KPI</SelectItem>
                    <SelectItem value="automatic">Automatic KPI</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <FieldLabel hint="What kind of value this KPI carries. For automatic KPIs this is set by the chosen library entry.">
                  Value type
                </FieldLabel>
                <Select value={valueType} onValueChange={setValueType} disabled={isAutomatic}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VALUE_TYPES.map((v) => (
                      <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <FieldLabel hint="How often this KPI is expected to be updated or captured.">
                  Update cadence
                </FieldLabel>
                <Select value={cadence} onValueChange={setCadence}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CADENCES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* ── Section 2 — Automatic calculation ── */}
          {isAutomatic && (
            <section className="space-y-4 rounded-md border border-border bg-muted/30 p-4">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Automatic KPIs are configured here. Official captured values will be available once KPI capture is enabled.
                </p>
              </div>

              <div className="space-y-1">
                <FieldLabel hint="Choose a KPI from the controlled library. Each entry has a fixed formula governed by the platform." required>
                  Automatic KPI
                </FieldLabel>
                <Select value={calculationKey} onValueChange={handleAutomaticKpiPick}>
                  <SelectTrigger><SelectValue placeholder="Select an automatic KPI…" /></SelectTrigger>
                  <SelectContent>
                    {automaticLibrary.map((def) => (
                      <SelectItem key={def.calculationKey} value={def.calculationKey}>
                        {def.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedAutoDef && (
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="font-medium">{selectedAutoDef.name}</p>
                    <p className="text-muted-foreground">{selectedAutoDef.description}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">Value: {selectedAutoDef.valueType}</Badge>
                    <Badge variant="outline">Formula v{selectedAutoDef.defaultFormulaVersion}</Badge>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">How it's calculated</p>
                    <p className="text-muted-foreground">{selectedAutoDef.formulaDescription}</p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">How to read the result</p>
                    <p className="text-muted-foreground">{selectedAutoDef.resultInterpretation}</p>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">When data is missing</p>
                    <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                      {selectedAutoDef.noBasisBehavior.map((b, i) => (
                        <li key={i}>
                          <span className="font-medium">{b.status}</span> — {b.description}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Source data</p>
                    <p className="text-muted-foreground">{selectedAutoDef.sourceObjects.join(", ")}</p>
                  </div>

                  {selectedAutoDef.completionMethodRequirement === "selector" && (
                    <div className="space-y-1 pt-2 border-t border-border">
                      <FieldLabel hint="Choose how completion is measured for this KPI. Defaults to task count.">
                        Completion method
                      </FieldLabel>
                      <Select
                        value={completionMethod ?? "task_count"}
                        onValueChange={(v) => setCompletionMethod(v)}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {COMPLETION_METHODS.map((m) => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ── Section 2b — Automatic snapshot capture (C3.7) ──
              Only shown for automatic KPIs. Manual KPIs do not have
              automatic snapshot capture; the read-only C3.6 status
              badge shows "Not applicable" elsewhere. */}
          {isAutomatic && (
            <section className="space-y-3 rounded-md border border-border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Automatic snapshot capture</p>
                  <p className="text-xs text-muted-foreground">
                    Automatically creates official KPI snapshots for completed
                    reporting periods. This does not submit anything to the KPI
                    App. KPI App submission uses Auto-submit official snapshots
                    separately.
                  </p>
                </div>
                <Switch
                  checked={autoSnapshotEligibility.eligible && autoSnapshotEnabled}
                  onCheckedChange={(v) => setAutoSnapshotEnabled(v)}
                  disabled={!autoSnapshotEligibility.eligible}
                  aria-label="Automatic snapshot capture"
                />
              </div>
              {!autoSnapshotEligibility.eligible && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Not eligible:</span>{" "}
                  {(autoSnapshotEligibility as { eligible: false; reason: string }).reason}
                </p>
              )}
              {autoSnapshotEligibility.eligible && (
                <p className="text-xs text-muted-foreground">
                  Default for new KPIs is Off. The database validates this
                  setting on save.
                </p>
              )}
            </section>
          )}

          {/* ── Section 3 — Reporting discipline ── */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Reporting discipline</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <FieldLabel hint="Unit of measurement (e.g. %, pts, hrs, $). Shown next to values for clarity.">
                  Unit
                </FieldLabel>
                <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. %, pts, hrs" />
              </div>
              <div className="space-y-1">
                <FieldLabel hint="Numeric goal for this KPI. Combined with Target Direction to determine on/off track.">
                  Target value
                </FieldLabel>
                <Input type="number" step="any" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} placeholder="e.g. 95" />
              </div>
            </div>

            <div className="space-y-1">
              <FieldLabel hint="Whether higher is better (Increase), lower is better (Decrease), staying close to target is best (Maintain), or hitting an exact value (Exact).">
                Target direction
              </FieldLabel>
              <Select value={targetDirection} onValueChange={setTargetDirection}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DIRECTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <label className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer">
                <Switch checked={commentRequired} onCheckedChange={setCommentRequired} />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Comment required</p>
                  <p className="text-xs text-muted-foreground">A comment must accompany each captured value.</p>
                </div>
              </label>
              <label className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer">
                <Switch checked={actionPlanRequired} onCheckedChange={setActionPlanRequired} />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Action plan required</p>
                  <p className="text-xs text-muted-foreground">An action plan must be recorded when the KPI is off-track.</p>
                </div>
              </label>
            </div>
          </section>

          {validationError && (
            <p className="text-sm text-destructive">{validationError}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting || !!validationError}>
              {isEdit ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
