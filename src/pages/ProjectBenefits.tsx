/**
 * Phase 6C — Step 6C.3 — Project Benefits Realization page.
 *
 * Project-level UI for creating, viewing, editing, and archiving benefit
 * records. All data access flows through the Step 6C.2 hook layer
 * (`useProjectBenefits` + mutation hooks), which wraps the SECURITY DEFINER
 * RPCs. No raw table selects; no stored totals; page-level indicators are
 * derived in-memory from the loaded rows only.
 */
import { useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Plus, Archive, Pencil, Target } from "lucide-react";
import {
  useProjectBenefits,
  useCreateProjectBenefit,
  useUpdateProjectBenefit,
  useArchiveProjectBenefit,
  PROJECT_BENEFIT_TYPE_OPTIONS,
  PROJECT_BENEFIT_REALIZATION_STATUS_OPTIONS,
  type ProjectBenefit,
  type ProjectBenefitType,
  type ProjectBenefitRealizationStatus,
} from "@/hooks/useProjectBenefits";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { useProjectStakeholders } from "@/hooks/useProjectStakeholders";

const UNIT_PRESETS = ["EUR", "USD", "FTE", "hours", "days", "count", "percent"] as const;
const CUSTOM_UNIT_TOKEN = "__custom__";

const BENEFIT_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  PROJECT_BENEFIT_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);
const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  PROJECT_BENEFIT_REALIZATION_STATUS_OPTIONS.map((o) => [o.value, o.label]),
);

function statusBadgeVariant(status: ProjectBenefitRealizationStatus) {
  // Use existing semantic badge variants only; no hardcoded colors.
  switch (status) {
    case "realized":
      return "default" as const;
    case "in_progress":
    case "partially_realized":
      return "secondary" as const;
    case "not_realized":
      return "destructive" as const;
    case "not_applicable":
    case "planned":
    default:
      return "outline" as const;
  }
}

function formatDate(v: string | null) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return v;
  }
}

function formatNumberWithUnit(n: number | null, unit: string) {
  if (n === null || n === undefined) return "Pending";
  return `${Number(n).toLocaleString()} ${unit}`.trim();
}

function achievementDisplay(target: number, actual: number | null) {
  if (actual === null || actual === undefined) return "Pending";
  if (!target || target <= 0) return "—";
  const pct = (actual / target) * 100;
  return `${pct.toFixed(pct >= 100 || pct < 10 ? 0 : 1)}%`;
}

function isPostClosure(project: any): boolean {
  if (!project) return false;
  if (project.project_stage === "closure") return true;
  const s = project.status;
  return s === "completed" || s === "cancelled";
}

// ---------------------------------------------------------------------------
// Form dialog
// ---------------------------------------------------------------------------

type OwnerOption = { id: string; label: string };

interface BenefitFormValues {
  benefit_type: ProjectBenefitType;
  custom_benefit_type_label: string;
  metric_name: string;
  description: string;
  unit_of_measure: string;
  unit_preset: string; // preset token or CUSTOM_UNIT_TOKEN
  baseline_value: string;
  target_value: string;
  actual_value: string;
  realization_status: ProjectBenefitRealizationStatus;
  benefit_owner_id: string; // "" = unassigned
  expected_realization_date: string;
  actual_realization_date: string;
  evidence_note: string;
}

const EMPTY_FORM: BenefitFormValues = {
  benefit_type: "financial_value",
  custom_benefit_type_label: "",
  metric_name: "",
  description: "",
  unit_of_measure: "EUR",
  unit_preset: "EUR",
  baseline_value: "",
  target_value: "",
  actual_value: "",
  realization_status: "planned",
  benefit_owner_id: "",
  expected_realization_date: "",
  actual_realization_date: "",
  evidence_note: "",
};

function benefitToForm(b: ProjectBenefit): BenefitFormValues {
  const unitIsPreset = (UNIT_PRESETS as readonly string[]).includes(b.unit_of_measure);
  return {
    benefit_type: b.benefit_type,
    custom_benefit_type_label: b.custom_benefit_type_label ?? "",
    metric_name: b.metric_name,
    description: b.description ?? "",
    unit_of_measure: b.unit_of_measure,
    unit_preset: unitIsPreset ? b.unit_of_measure : CUSTOM_UNIT_TOKEN,
    baseline_value: b.baseline_value === null ? "" : String(b.baseline_value),
    target_value: String(b.target_value),
    actual_value: b.actual_value === null ? "" : String(b.actual_value),
    realization_status: b.realization_status,
    benefit_owner_id: b.benefit_owner_id ?? "",
    expected_realization_date: b.expected_realization_date ?? "",
    actual_realization_date: b.actual_realization_date ?? "",
    evidence_note: b.evidence_note ?? "",
  };
}

interface BenefitFormDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  editing: ProjectBenefit | null;
  ownerOptions: OwnerOption[];
}

function BenefitFormDialog({
  open,
  onClose,
  projectId,
  editing,
  ownerOptions,
}: BenefitFormDialogProps) {
  const [values, setValues] = useState<BenefitFormValues>(() =>
    editing ? benefitToForm(editing) : EMPTY_FORM,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useCreateProjectBenefit();
  const update = useUpdateProjectBenefit();
  const submitting = create.isPending || update.isPending;

  // Reset when opening
  const key = editing?.id ?? "new";
  const [lastKey, setLastKey] = useState(key);
  if (open && lastKey !== key) {
    setLastKey(key);
    setValues(editing ? benefitToForm(editing) : EMPTY_FORM);
    setErrors({});
  }

  function setField<K extends keyof BenefitFormValues>(k: K, v: BenefitFormValues[K]) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  const needsActual =
    values.realization_status === "realized" ||
    values.realization_status === "partially_realized";

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!values.metric_name.trim()) e.metric_name = "Metric name is required";
    if (!values.unit_of_measure.trim()) e.unit_of_measure = "Unit is required";
    if (values.target_value === "" || Number.isNaN(Number(values.target_value)))
      e.target_value = "Target value is required";
    else if (Number(values.target_value) < 0) e.target_value = "Must be non-negative";
    if (values.baseline_value !== "" && Number(values.baseline_value) < 0)
      e.baseline_value = "Must be non-negative";
    if (values.actual_value !== "" && Number(values.actual_value) < 0)
      e.actual_value = "Must be non-negative";
    if (values.benefit_type === "other" && !values.custom_benefit_type_label.trim())
      e.custom_benefit_type_label = "Required when type is Other";
    if (needsActual && values.actual_value === "")
      e.actual_value = "Actual value required for realized / partially realized";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    const numOrNull = (s: string) => (s === "" ? null : Number(s));
    const commonPayload = {
      benefit_type: values.benefit_type,
      metric_name: values.metric_name,
      unit_of_measure: values.unit_of_measure,
      target_value: Number(values.target_value),
      realization_status: values.realization_status,
      custom_benefit_type_label:
        values.benefit_type === "other" ? values.custom_benefit_type_label : null,
      description: values.description || null,
      baseline_value: numOrNull(values.baseline_value),
      actual_value: numOrNull(values.actual_value),
      benefit_owner_id: values.benefit_owner_id || null,
      expected_realization_date: values.expected_realization_date || null,
      actual_realization_date: values.actual_realization_date || null,
      evidence_note: values.evidence_note || null,
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, project_id: projectId, ...commonPayload });
      } else {
        await create.mutateAsync({ project_id: projectId, ...commonPayload });
      }
      onClose();
    } catch {
      // toast handled in hook
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit benefit" : "Add benefit"}</DialogTitle>
          <DialogDescription>
            Capture expected and realized business value for this project. Benefits are
            separate from KPIs and feed closure reporting and portfolio visibility.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Benefit type *</Label>
              <Select
                value={values.benefit_type}
                onValueChange={(v) => setField("benefit_type", v as ProjectBenefitType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_BENEFIT_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Realization status *</Label>
              <Select
                value={values.realization_status}
                onValueChange={(v) =>
                  setField("realization_status", v as ProjectBenefitRealizationStatus)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_BENEFIT_REALIZATION_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {values.benefit_type === "other" && (
            <div className="space-y-1.5">
              <Label>Custom benefit type label *</Label>
              <Input
                value={values.custom_benefit_type_label}
                onChange={(e) => setField("custom_benefit_type_label", e.target.value)}
              />
              {errors.custom_benefit_type_label && (
                <p className="text-xs text-destructive">{errors.custom_benefit_type_label}</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Metric name *</Label>
            <Input
              value={values.metric_name}
              onChange={(e) => setField("metric_name", e.target.value)}
              placeholder="e.g. Annual licensing spend reduction"
            />
            {errors.metric_name && (
              <p className="text-xs text-destructive">{errors.metric_name}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={values.description}
              onChange={(e) => setField("description", e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Unit of measure *</Label>
              <Select
                value={values.unit_preset}
                onValueChange={(v) => {
                  if (v === CUSTOM_UNIT_TOKEN) {
                    setField("unit_preset", v);
                    setField("unit_of_measure", "");
                  } else {
                    setField("unit_preset", v);
                    setField("unit_of_measure", v);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_PRESETS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_UNIT_TOKEN}>Other / custom…</SelectItem>
                </SelectContent>
              </Select>
              {values.unit_preset === CUSTOM_UNIT_TOKEN && (
                <Input
                  value={values.unit_of_measure}
                  onChange={(e) => setField("unit_of_measure", e.target.value)}
                  placeholder="Custom unit"
                />
              )}
              {errors.unit_of_measure && (
                <p className="text-xs text-destructive">{errors.unit_of_measure}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Benefit owner</Label>
              <Select
                value={values.benefit_owner_id || "__none__"}
                onValueChange={(v) =>
                  setField("benefit_owner_id", v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {ownerOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Baseline value</Label>
              <Input
                type="number"
                value={values.baseline_value}
                onChange={(e) => setField("baseline_value", e.target.value)}
              />
              {errors.baseline_value && (
                <p className="text-xs text-destructive">{errors.baseline_value}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Target value *</Label>
              <Input
                type="number"
                value={values.target_value}
                onChange={(e) => setField("target_value", e.target.value)}
              />
              {errors.target_value && (
                <p className="text-xs text-destructive">{errors.target_value}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Actual value{needsActual ? " *" : ""}</Label>
              <Input
                type="number"
                value={values.actual_value}
                onChange={(e) => setField("actual_value", e.target.value)}
              />
              {errors.actual_value && (
                <p className="text-xs text-destructive">{errors.actual_value}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Expected realization date</Label>
              <Input
                type="date"
                value={values.expected_realization_date}
                onChange={(e) => setField("expected_realization_date", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Actual realization date</Label>
              <Input
                type="date"
                value={values.actual_realization_date}
                onChange={(e) => setField("actual_realization_date", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Evidence note</Label>
            <Textarea
              value={values.evidence_note}
              onChange={(e) => setField("evidence_note", e.target.value)}
              rows={2}
              placeholder="How was this value measured or evidenced?"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Saving…" : editing ? "Save changes" : "Add benefit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ProjectBenefits() {
  const { projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const { project } = (useOutletContext<{ project: any; workspace: any }>() ?? {
    project: null,
  }) as { project: any };

  const { canEdit } = useProjectPlanningAuthority(projectId);
  const [showArchived, setShowArchived] = useState(false);

  const {
    data: benefits = [],
    isLoading,
    isError,
    error,
  } = useProjectBenefits(projectId, { includeArchived: showArchived });

  const { data: stakeholders = [] } = useProjectStakeholders(projectId);
  const ownerOptions = useMemo<OwnerOption[]>(
    () =>
      stakeholders
        .filter(
          (s) =>
            !s.removed_at &&
            s.stakeholder_type === "workspace_member" &&
            !!s.user_id,
        )
        .map((s) => ({
          id: s.user_id as string,
          label: s.display_name || "Unknown stakeholder",
        })),
    [stakeholders],
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectBenefit | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ProjectBenefit | null>(null);
  const archive = useArchiveProjectBenefit();

  const active = useMemo(() => benefits.filter((b) => !b.archived_at), [benefits]);
  const archived = useMemo(() => benefits.filter((b) => !!b.archived_at), [benefits]);

  const indicators = useMemo(() => {
    const tracked = active.length;
    const actualsPending = active.filter((b) => b.actual_value === null).length;
    const realizedOrPartial = active.filter(
      (b) =>
        b.realization_status === "realized" || b.realization_status === "partially_realized",
    ).length;
    const today = new Date().toISOString().slice(0, 10);
    const overdue = active.filter((b) => {
      if (!b.expected_realization_date) return false;
      if (b.actual_value !== null) return false;
      if (
        b.realization_status === "realized" ||
        b.realization_status === "not_applicable"
      )
        return false;
      return b.expected_realization_date < today;
    }).length;
    return { tracked, actualsPending, realizedOrPartial, overdue };
  }, [active]);

  const postClosure = isPostClosure(project);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }
  function openEdit(b: ProjectBenefit) {
    setEditing(b);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Benefits Realization
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Track expected and realized business value for this project. Benefits are separate
            from KPIs and are used later for closure reporting and portfolio visibility.
          </p>
        </div>
        {canEdit && (
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Add benefit
          </Button>
        )}
      </div>

      {!canEdit && !isLoading && (
        <p className="text-xs text-muted-foreground italic">
          You can view benefits for this project, but you do not have authority to edit them.
        </p>
      )}

      {postClosure && canEdit && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          This project appears closed/completed. Benefit updates are still allowed and will be
          logged as post-closure updates.
        </div>
      )}

      {/* Indicators */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Benefits tracked", value: indicators.tracked },
          { label: "Actuals pending", value: indicators.actualsPending },
          { label: "Realized / partial", value: indicators.realizedOrPartial },
          { label: "Overdue updates", value: indicators.overdue },
        ].map((i) => (
          <Card key={i.label}>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{i.label}</div>
              <div className="text-2xl font-semibold text-foreground mt-1">{i.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Archived toggle */}
      <div className="flex items-center gap-2">
        <Switch
          id="show-archived"
          checked={showArchived}
          onCheckedChange={(v) => setShowArchived(!!v)}
        />
        <Label htmlFor="show-archived" className="text-sm text-muted-foreground">
          Show archived
        </Label>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Failed to load benefits: {(error as any)?.message ?? "Unknown error"}
          </CardContent>
        </Card>
      ) : benefits.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Benefits capture the expected and realized business value of this project — such
              as FTE savings, financial value, or reduced manual work. They are separate from
              KPIs and feed closure reporting and portfolio visibility.
            </p>
            {canEdit ? (
              <Button onClick={openCreate} size="sm">
                <Plus className="h-4 w-4 mr-1" /> Add first benefit
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                No benefits have been added for this project yet.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Type</th>
                  <th className="text-left font-medium px-3 py-2">Metric</th>
                  <th className="text-left font-medium px-3 py-2">Unit</th>
                  <th className="text-right font-medium px-3 py-2">Target</th>
                  <th className="text-right font-medium px-3 py-2">Actual</th>
                  <th className="text-right font-medium px-3 py-2">Achievement</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                  <th className="text-left font-medium px-3 py-2">Owner</th>
                  <th className="text-left font-medium px-3 py-2">Expected</th>
                  <th className="text-left font-medium px-3 py-2">Actual date</th>
                  {canEdit && <th className="px-3 py-2 w-10" />}
                </tr>
              </thead>
              <tbody>
                {[...active, ...(showArchived ? archived : [])].map((b) => {
                  const isArchived = !!b.archived_at;
                  const typeLabel =
                    b.benefit_type === "other" && b.custom_benefit_type_label
                      ? b.custom_benefit_type_label
                      : BENEFIT_TYPE_LABEL[b.benefit_type] ?? b.benefit_type;
                  const ownerLabel =
                    b.benefit_owner_display_name ||
                    b.benefit_owner_email ||
                    (b.benefit_owner_id ? "Unknown" : "Unassigned");
                  return (
                    <tr
                      key={b.id}
                      className={`border-t border-border ${
                        isArchived ? "opacity-60" : ""
                      }`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span>{typeLabel}</span>
                          {isArchived && (
                            <Badge variant="outline" className="text-[10px]">
                              Archived
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{b.metric_name}</div>
                        {b.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {b.description}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{b.unit_of_measure}</td>
                      <td className="px-3 py-2 text-right">
                        {formatNumberWithUnit(b.target_value, b.unit_of_measure)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatNumberWithUnit(b.actual_value, b.unit_of_measure)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {achievementDisplay(b.target_value, b.actual_value)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={statusBadgeVariant(b.realization_status)}>
                          {STATUS_LABEL[b.realization_status] ?? b.realization_status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{ownerLabel}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDate(b.expected_realization_date)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDate(b.actual_realization_date)}
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2 text-right">
                          {!isArchived && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEdit(b)}>
                                  <Pencil className="h-4 w-4 mr-2" /> Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setArchiveTarget(b)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Archive className="h-4 w-4 mr-2" /> Archive
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {dialogOpen && projectId && (
        <BenefitFormDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          projectId={projectId}
          editing={editing}
          ownerOptions={ownerOptions}
        />
      )}

      <AlertDialog
        open={!!archiveTarget}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive benefit?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the benefit from the active project benefits list. It will not
              delete history or generated report snapshots.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archive.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={archive.isPending}
              onClick={async (e) => {
                e.preventDefault();
                if (!archiveTarget || !projectId) return;
                try {
                  await archive.mutateAsync({
                    id: archiveTarget.id,
                    project_id: projectId,
                  });
                  setArchiveTarget(null);
                } catch {
                  /* toast in hook */
                }
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
