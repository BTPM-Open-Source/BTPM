import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  useKpiDefinitions,
  useKpiUpdates,
  useUpdateKpiDefinition,
  useAddKpiUpdate,
} from "@/hooks/useProjectKpis";
import {
  useKpiSnapshots,
  useCaptureKpiSnapshot,
  type KpiSnapshotRow,
} from "@/hooks/useKpiSnapshots";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { useCanHardDeleteBusinessObject } from "@/hooks/useCanHardDeleteBusinessObject";
import { LifecycleActions } from "@/components/lifecycle/LifecycleActions";
import { HARD_DELETE_CASCADE_COPY } from "@/lib/lifecycleVocabulary";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldLabel } from "@/components/ui/field-label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, TrendingUp, TrendingDown, Minus, Target, Archive, ChevronRight, ArrowLeft, Cpu, Hand, MessageSquare, ClipboardList, Camera } from "lucide-react";
import { KpiDefinitionDialog } from "@/components/project/KpiDefinitionDialog";
import type { Tables } from "@/integrations/supabase/types";
import { ConceptHelp } from "@/components/knowledge/ConceptHelp";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";
import { KC_CONCEPTS } from "@/components/knowledge/kc-concepts";
// Wave C1.8 — KPI readiness helper (pure)
import {
  evaluateKpiReadiness,
  evaluateProjectKpiReadiness,
  formatKpiSnapshotValue,
  summarizeReadiness,
  type KpiReadinessResult,
  type KpiReadinessStatus,
} from "@/lib/kpi/kpiReadiness";
// Wave C2.8 — read-only Project KPI ↔ External KPI App linkage visibility
import { useProjectKpiAppLinkage } from "@/hooks/useProjectKpiAppLinkage";
import { useCanReadKpiAppOutboxMetadata } from "@/hooks/useCanReadKpiAppOutboxMetadata";
import { ProjectKpiAppLinkage } from "@/components/project/ProjectKpiAppLinkage";
import { useIsOrgAdmin } from "@/hooks/useIsOrgAdmin";
// Wave C3.6 — read-only automatic snapshot capture visibility
import { AutoSnapshotCaptureStatus } from "@/components/project/AutoSnapshotCaptureStatus";
import { resolveKpiPeriod } from "@/lib/kpi/kpiPeriod";
// CM.7C — Adoption link badges in canonical KPI view
import { useProjectAdoptionLinkBadges } from "@/hooks/useProjectAdoptionLinkBadges";
import { AdoptionLinkBadge } from "@/components/adoption/AdoptionLinkBadge";

type KpiDef = Tables<"kpi_definitions">;

const DIRECTIONS = [
  { value: "increase", label: "Increase ↑", icon: TrendingUp },
  { value: "decrease", label: "Decrease ↓", icon: TrendingDown },
  { value: "maintain", label: "Maintain →", icon: Minus },
  { value: "target_exact", label: "Exact =", icon: Target },
];

function directionIcon(d: string) {
  const found = DIRECTIONS.find((x) => x.value === d);
  if (!found) return null;
  const Icon = found.icon;
  return <Icon className="h-4 w-4" />;
}

const CADENCE_LABELS: Record<string, string> = {
  manual_only: "Manual only",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

function KpiMetaBadges({ kpi }: { kpi: KpiDef }) {
  const isAutomatic = kpi.source_mode === "automatic";
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1">
      <Badge variant={isAutomatic ? "default" : "secondary"} className="gap-1 text-[10px] py-0 h-5">
        {isAutomatic ? <Cpu className="h-3 w-3" /> : <Hand className="h-3 w-3" />}
        {isAutomatic ? "Automatic" : "Manual"}
      </Badge>
      {kpi.value_type && (
        <Badge variant="outline" className="text-[10px] py-0 h-5">{kpi.value_type}</Badge>
      )}
      {kpi.cadence && (
        <Badge variant="outline" className="text-[10px] py-0 h-5">
          {CADENCE_LABELS[kpi.cadence] ?? kpi.cadence}
        </Badge>
      )}
      {isAutomatic && kpi.calculation_key && (
        <Badge variant="outline" className="text-[10px] py-0 h-5 font-mono">{kpi.calculation_key}</Badge>
      )}
      {kpi.comment_required && (
        <Badge variant="outline" className="gap-1 text-[10px] py-0 h-5">
          <MessageSquare className="h-3 w-3" /> Comment
        </Badge>
      )}
      {kpi.action_plan_required && (
        <Badge variant="outline" className="gap-1 text-[10px] py-0 h-5">
          <ClipboardList className="h-3 w-3" /> Action plan
        </Badge>
      )}
    </div>
  );
}

/* KPI Definition Form Dialog is extracted to src/components/project/KpiDefinitionDialog.tsx */

const STATUS_LABELS: Record<string, string> = {
  manual_entry: "Manual entry",
  calculated: "Calculated",
  no_source_data: "No source data",
  insufficient_date_basis: "Insufficient dates",
  not_applicable: "Not applicable",
  error: "Error",
};

/* ─── Wave C1.8 — Readiness UI helpers ─── */

const READINESS_BADGE_CLASS: Record<KpiReadinessStatus, string> = {
  up_to_date: "bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]",
  due: "bg-amber-500 text-white",
  overdue: "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]",
  no_snapshot: "bg-muted text-muted-foreground",
  manual_only: "bg-secondary text-secondary-foreground",
  not_configured: "bg-muted text-muted-foreground",
  archived: "bg-muted text-muted-foreground",
};

function ReadinessBadge({ readiness }: { readiness: KpiReadinessResult }) {
  return (
    <Badge
      className={`text-[10px] py-0 h-5 ${READINESS_BADGE_CLASS[readiness.readinessStatus]}`}
      title={readiness.staleReason ?? readiness.readinessLabel}
    >
      {readiness.readinessLabel}
    </Badge>
  );
}

/** Today's reference date as ISO YYYY-MM-DD (UTC). Pure helper; module load only. */
function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}



function CaptureSnapshotDialog({
  open,
  onOpenChange,
  kpi,
  isSubmitting,
  existingSnapshots,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kpi: KpiDef;
  isSubmitting: boolean;
  /**
   * Wave C3.6 — used only to display a non-blocking warning when a
   * manual capture targets a KPI/period that already has any
   * official snapshot. Manual capture is NEVER blocked.
   */
  existingSnapshots: KpiSnapshotRow[];
  onSubmit: (data: { snapshotDate: string; comment: string; actionPlan: string }) => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [comment, setComment] = useState("");
  const [actionPlan, setActionPlan] = useState("");
  const isAuto = kpi.source_mode === "automatic";

  // Wave C3.6 — non-blocking warning. Compute the would-be period
  // for this KPI/date using the canonical client helper and check if
  // any existing snapshot already covers that period. Pure read.
  const existingForPeriod = useMemo(() => {
    try {
      const period = resolveKpiPeriod(kpi.cadence ?? "manual_only", date);
      if (!period) return null;
      return (
        existingSnapshots.find(
          (s) =>
            s.kpi_definition_id === kpi.id &&
            s.period_start === period.periodStart &&
            s.period_end === period.periodEnd,
        ) ?? null
      );
    } catch {
      return null;
    }
  }, [existingSnapshots, kpi.id, kpi.cadence, date]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ snapshotDate: date, comment, actionPlan });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Capture snapshot — {kpi.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {isAuto
              ? "Automatic KPI: value will be computed from current project data using the configured calculation key."
              : "Manual KPI: value will be sourced from the latest recorded update."}
          </p>
          <div className="space-y-1">
            <FieldLabel hint="Date the snapshot is anchored to. Period is derived from the KPI cadence." required>
              Snapshot date
            </FieldLabel>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          {existingForPeriod && (
            <div
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
              role="status"
            >
              An official snapshot already exists for this KPI and period
              ({existingForPeriod.period_start} → {existingForPeriod.period_end}).
              Manual capture is still allowed, but it will create an additional
              official snapshot.
            </div>
          )}
          <div className="space-y-1">
            <FieldLabel
              hint="Optional context recorded alongside this official snapshot."
              required={!!kpi.comment_required}
            >
              Comment{kpi.comment_required ? "" : " (optional)"}
            </FieldLabel>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1">
            <FieldLabel
              hint="Optional action plan recorded alongside this official snapshot."
              required={!!kpi.action_plan_required}
            >
              Action plan{kpi.action_plan_required ? "" : " (optional)"}
            </FieldLabel>
            <Textarea value={actionPlan} onChange={(e) => setActionPlan(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              type="submit"
              disabled={
                isSubmitting ||
                (!!kpi.comment_required && !comment.trim()) ||
                (!!kpi.action_plan_required && !actionPlan.trim())
              }
            >
              Capture
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function KpiSnapshotsPanel({ kpi, projectId }: { kpi: KpiDef; projectId: string }) {
  const { data: snapshots = [], isLoading } = useKpiSnapshots(projectId, kpi.id);
  if (isLoading) {
    return <Skeleton className="h-16 w-full" />;
  }
  if (snapshots.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">No official snapshots captured yet.</p>;
  }
  return (
    <div className="space-y-2">
      {snapshots.map((s: KpiSnapshotRow) => (
        <Card key={s.id}>
          <CardContent className="py-3 px-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-semibold tabular-nums">
                  {s.value_amount ?? s.string_value ?? "—"}
                </span>
                {kpi.unit && s.value_amount != null && (
                  <span className="text-sm text-muted-foreground">{kpi.unit}</span>
                )}
                <Badge variant="outline" className="text-[10px] py-0 h-5">
                  {STATUS_LABELS[s.calculation_status] ?? s.calculation_status}
                </Badge>
                <Badge variant="secondary" className="text-[10px] py-0 h-5">
                  {s.generated_by === "system" ? "Auto" : "User"}
                </Badge>
              </div>
              {s.comment && <p className="text-sm text-muted-foreground mt-1">{s.comment}</p>}
              {s.action_plan && (
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="font-medium">Action:</span> {s.action_plan}
                </p>
              )}
            </div>
            <div className="text-right text-xs text-muted-foreground shrink-0">
              <div>{s.snapshot_date}</div>
              {s.period_start && s.period_end && (
                <div className="mt-0.5">{s.period_start} → {s.period_end}</div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ─── KPI Update Form Dialog ─── */
function KpiUpdateDialog({
  open,
  onOpenChange,
  kpiName,
  unit,
  onSubmit,
  isSubmitting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kpiName: string;
  unit: string | null;
  onSubmit: (data: { value: string; update_date: string; note: string }) => void;
  isSubmitting: boolean;
}) {
  const [value, setValue] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [note, setNote] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value) return;
    onSubmit({ value, update_date: date, note });
    setValue("");
    setNote("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Update — {kpiName}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <FieldLabel hint="The measured value of this KPI for the chosen date." required>
                {`Value${unit ? ` (${unit})` : ""}`}
              </FieldLabel>
              <Input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <FieldLabel hint="Date this measurement applies to. Defaults to today." required>
                Date
              </FieldLabel>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-1">
            <FieldLabel hint="Optional comment giving context for this measurement (e.g. data source, anomaly explanation).">
              Note
            </FieldLabel>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional context" rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting || !value}>Record</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─── KPI History Panel ─── */
function KpiHistoryPanel({
  kpi,
  canEdit,
  project,
  readiness,
  linkage,
  outboxAccessible,
  isAdmin,
  onBack,
}: {
  kpi: KpiDef;
  canEdit: boolean;
  project: any;
  readiness: KpiReadinessResult | null;
  linkage: ReturnType<typeof useProjectKpiAppLinkage>["data"] extends infer T
    ? T extends { byKpiId: Map<string, infer V> } ? V | undefined : undefined
    : undefined;
  outboxAccessible: boolean;
  isAdmin: boolean;
  onBack: () => void;
}) {
  const { data: updates = [], isLoading } = useKpiUpdates(kpi.id);
  const addUpdate = useAddKpiUpdate(project.id);
  const capture = useCaptureKpiSnapshot(project.id);
  // Wave C3.6 — used for the non-blocking "snapshot already exists
  // for this period" warning in the manual capture dialog. Read-only.
  const { data: kpiSnapshots = [] } = useKpiSnapshots(project.id, kpi.id);
  const [addOpen, setAddOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h3 className="text-lg font-semibold">{kpi.name}</h3>
        {kpi.unit && <Badge variant="outline">{kpi.unit}</Badge>}
        {readiness && <ReadinessBadge readiness={readiness} />}
      </div>

      <ProjectKpiAppLinkage
        calculationKey={kpi.calculation_key}
        linkage={linkage}
        outboxAccessible={outboxAccessible}
        isAdmin={isAdmin}
      />

      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          {directionIcon(kpi.target_direction)} {DIRECTIONS.find((d) => d.value === kpi.target_direction)?.label}
        </span>
        {kpi.target_value != null && <span>Target: {kpi.target_value}{kpi.unit ? ` ${kpi.unit}` : ""}</span>}
        <span>Current: <span className="font-medium text-foreground">{kpi.current_value ?? "—"}</span></span>
        {readiness?.latestSnapshotDate && (
          <span>
            Latest official snapshot:{" "}
            <span className="font-medium text-foreground">{readiness.latestSnapshotDate}</span>
            {readiness.latestValueDisplay && (
              <> · <span className="font-medium text-foreground">{readiness.latestValueDisplay}</span></>
            )}
          </span>
        )}
        {readiness && !readiness.reportable && readiness.reportableReason && (
          <span className="text-amber-600" title={readiness.reportableReason}>
            Not reportable
          </span>
        )}
      </div>

      {kpi.description && <p className="text-sm text-muted-foreground">{kpi.description}</p>}

      {/* Wave C3.6 — read-only automatic snapshot capture status. */}
      <AutoSnapshotCaptureStatus kpi={kpi} />


      {/* Official Snapshots */}
      <div className="flex items-center justify-between pt-2">
        <h4 className="text-sm font-semibold">Official Snapshots</h4>
        {canEdit && !kpi.is_archived && (
          <Button size="sm" variant="default" onClick={() => setCaptureOpen(true)}>
            <Camera className="h-4 w-4 mr-1" /> Capture snapshot
          </Button>
        )}
      </div>
      <KpiSnapshotsPanel kpi={kpi} projectId={project.id} />

      {/* Manual update history (manual KPIs only) */}
      <div className="flex items-center justify-between pt-4">
        <h4 className="text-sm font-semibold">Update History (manual)</h4>
        {canEdit && !kpi.is_archived && kpi.source_mode !== "automatic" && (
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Record Update
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
        </div>
      ) : updates.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No manual updates recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {updates.map((u: any) => (
            <Card key={u.id}>
              <CardContent className="py-3 px-4 flex items-start justify-between">
                <div>
                  <span className="text-lg font-semibold tabular-nums">{u.value}</span>
                  {kpi.unit && <span className="text-sm text-muted-foreground ml-1">{kpi.unit}</span>}
                  {u.note && <p className="text-sm text-muted-foreground mt-1">{u.note}</p>}
                  {(u.author_name || u.author_email) && (
                    <p className="text-xs text-muted-foreground mt-1">by {u.author_name || u.author_email}</p>
                  )}
                </div>
                <div className="text-right text-xs text-muted-foreground shrink-0">
                  <div>{u.update_date}</div>
                  <div className="mt-0.5">{new Date(u.created_at).toLocaleString()}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <KpiUpdateDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        kpiName={kpi.name}
        unit={kpi.unit}
        isSubmitting={addUpdate.isPending}
        onSubmit={(data) => {
          addUpdate.mutate(
            {
              kpi_definition_id: kpi.id,
              value: parseFloat(data.value),
              update_date: data.update_date,
              note: data.note || undefined,
              workspace_id: project.workspace_id,
              organization_id: project.organization_id,
            },
            { onSuccess: () => setAddOpen(false) },
          );
        }}
      />

      <CaptureSnapshotDialog
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        kpi={kpi}
        isSubmitting={capture.isPending}
        existingSnapshots={kpiSnapshots}
        onSubmit={(data) => {
          capture.mutate(
            {
              kpiDefinitionId: kpi.id,
              snapshotDate: data.snapshotDate,
              comment: data.comment || null,
              actionPlan: data.actionPlan || null,
            },
            { onSuccess: () => setCaptureOpen(false) },
          );
        }}
      />
    </div>
  );
}

/* ─── Main Page ─── */
export default function ProjectKpis() {
  const { project } = useOutletContext<{ project: any }>();
  const { canEdit } = useProjectPlanningAuthority(project.id);
  const { data: canHardDelete = false } = useCanHardDeleteBusinessObject(project?.workspace_id);

  const { data: kpis = [], isLoading } = useKpiDefinitions(project.id);
  // Wave C1.8 — single project-level snapshot fetch; readiness is then
  // computed in-memory per KPI (no per-KPI N+1 calls on the list view).
  const { data: projectSnapshots = [] } = useKpiSnapshots(project.id);
  const adoptionBadges = useProjectAdoptionLinkBadges(project.id);
  const addUpdate = useAddKpiUpdate(project.id);

  // Wave C2.8 — read-only KPI App linkage (mappings + non-sensitive outbox).
  // Wave C2.8a — explicit outbox-read authority (org admin OR ws admin+).
  const { data: canReadOutboxMetadata = false } = useCanReadKpiAppOutboxMetadata(
    project.workspace_id,
    project.organization_id,
  );
  const { data: linkageData } = useProjectKpiAppLinkage(
    project.id,
    project.organization_id,
    canReadOutboxMetadata,
  );
  const linkageByKpi = linkageData?.byKpiId ?? new Map();
  const outboxAccessible = linkageData?.outboxAccessible ?? false;
  const { data: adminData } = useIsOrgAdmin();
  const isAdmin = !!adminData?.isAdmin;

  const [createOpen, setCreateOpen] = useState(false);
  const [editKpi, setEditKpi] = useState<KpiDef | null>(null);
  const [selectedKpi, setSelectedKpi] = useState<KpiDef | null>(null);
  const [updateKpiTarget, setUpdateKpiTarget] = useState<KpiDef | null>(null);

  const activeKpis = kpis.filter((k) => !k.is_archived);
  const archivedKpis = kpis.filter((k) => k.is_archived);

  // Compute readiness for ALL KPIs (active + archived) once.
  const referenceDate = useMemo(() => todayIso(), []);
  const readinessByKpiId = useMemo(() => {
    const results = evaluateProjectKpiReadiness(
      kpis as any,
      projectSnapshots as any,
      referenceDate,
    );
    const map = new Map<string, KpiReadinessResult>();
    for (const r of results) map.set(r.kpiDefinitionId, r);
    return map;
  }, [kpis, projectSnapshots, referenceDate]);

  // Roll-up summary across active KPIs only (archived shown separately).
  const summary = useMemo(
    () =>
      summarizeReadiness(
        activeKpis
          .map((k) => readinessByKpiId.get(k.id))
          .filter((r): r is KpiReadinessResult => !!r),
      ),
    [activeKpis, readinessByKpiId],
  );

  if (selectedKpi) {
    // Refresh reference from latest data
    const fresh = kpis.find((k) => k.id === selectedKpi.id) || selectedKpi;
    return (
      <KpiHistoryPanel
        kpi={fresh}
        canEdit={canEdit}
        project={project}
        readiness={readinessByKpiId.get(fresh.id) ?? null}
        linkage={linkageByKpi.get(fresh.id)}
        outboxAccessible={outboxAccessible}
        isAdmin={isAdmin}
        onBack={() => setSelectedKpi(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          Project KPIs
          <ConceptHelp
            term={KC_CONCEPTS.kpi.term}
            shortText={KC_CONCEPTS.kpi.shortText}
            articleSlug={KC_CONCEPTS.kpi.slug}
          />
        </h2>
        <div className="flex items-center gap-2">
          <KnowledgeLink slug="how-to-update-kpis" label="How to update KPIs" />
          {canEdit && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Define KPI
            </Button>
          )}
        </div>
      </div>

      {/* Wave C1.8 — Readiness summary strip (active KPIs only). */}
      {!isLoading && activeKpis.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
          <div className="rounded border bg-card px-3 py-2"><div className="text-muted-foreground">Total</div><div className="text-base font-semibold">{summary.total}</div></div>
          <div className="rounded border bg-card px-3 py-2"><div className="text-muted-foreground">Up to date</div><div className="text-base font-semibold text-[hsl(var(--success))]">{summary.upToDate}</div></div>
          <div className="rounded border bg-card px-3 py-2"><div className="text-muted-foreground">Due</div><div className="text-base font-semibold text-amber-600">{summary.due + summary.overdue}</div></div>
          <div className="rounded border bg-card px-3 py-2"><div className="text-muted-foreground">No snapshot</div><div className="text-base font-semibold">{summary.noSnapshot}</div></div>
          <div className="rounded border bg-card px-3 py-2"><div className="text-muted-foreground">Manual only</div><div className="text-base font-semibold">{summary.manualOnly}</div></div>
          <div className="rounded border bg-card px-3 py-2"><div className="text-muted-foreground">Not reportable</div><div className="text-base font-semibold text-[hsl(var(--destructive))]">{summary.notReportable}</div></div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : activeKpis.length === 0 && archivedKpis.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No KPIs defined for this project.</p>
            {canEdit && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Define your first KPI
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Active KPIs */}
          <div className="space-y-2">
            {activeKpis.map((kpi) => (
              <Card
                key={kpi.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => setSelectedKpi(kpi)}
              >
                <CardContent className="py-3 px-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-muted-foreground">{directionIcon(kpi.target_direction)}</span>
                    <div className="min-w-0">
                      <span className="font-medium truncate block">{kpi.name}</span>
                      {kpi.description && (
                        <span className="text-xs text-muted-foreground truncate block">{kpi.description}</span>
                      )}
                      <KpiMetaBadges kpi={kpi} />
                      {adoptionBadges.byType.kpi.get(kpi.id) && (
                        <div className="mt-1">
                          <AdoptionLinkBadge badge={adoptionBadges.byType.kpi.get(kpi.id)!} />
                        </div>
                      )}
                      {(() => {
                        const r = readinessByKpiId.get(kpi.id);
                        if (!r) return null;
                        return (
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground flex-wrap">
                            <ReadinessBadge readiness={r} />
                            {r.latestSnapshotDate ? (
                              <span>
                                Latest snapshot: <span className="text-foreground">{r.latestSnapshotDate}</span>
                                {r.latestValueDisplay && (
                                  <> · <span className="text-foreground">{r.latestValueDisplay}</span></>
                                )}
                                {!r.latestValueDisplay && r.calculationStatus && (
                                  <> · <span className="text-foreground">{STATUS_LABELS[r.calculationStatus] ?? r.calculationStatus}</span></>
                                )}
                              </span>
                            ) : (
                              <span>No official snapshot yet</span>
                            )}
                          </div>
                        );
                      })()}
                      {/* Wave C3.6 — compact automatic snapshot capture status. */}
                      <div className="mt-1">
                        <AutoSnapshotCaptureStatus kpi={kpi} compact />
                      </div>
                      <ProjectKpiAppLinkage
                        calculationKey={kpi.calculation_key}
                        linkage={linkageByKpi.get(kpi.id)}
                        outboxAccessible={outboxAccessible}
                        isAdmin={isAdmin}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <span className="text-lg font-semibold tabular-nums">
                        {kpi.current_value != null ? kpi.current_value : "—"}
                      </span>
                      {kpi.unit && <span className="text-xs text-muted-foreground ml-1">{kpi.unit}</span>}
                      {kpi.target_value != null && (
                        <div className="text-xs text-muted-foreground">
                          Target: {kpi.target_value}
                        </div>
                      )}
                    </div>
                    {canEdit && kpi.source_mode !== "automatic" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          setUpdateKpiTarget(kpi);
                        }}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" /> Update
                      </Button>
                    )}
                    {(canEdit || canHardDelete) && (
                      <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditKpi(kpi)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <LifecycleActions
                          target="kpi_definition"
                          id={kpi.id}
                          name={kpi.name}
                          isArchived={false}
                          canArchive={canEdit}
                          canHardDelete={canHardDelete}
                          cascadeDescription={HARD_DELETE_CASCADE_COPY.kpi_definition}
                          invalidate={[["kpi-definitions", project.id], ["project-kpis", project.id]]}
                          iconOnly
                        />
                      </div>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Archived */}
          {archivedKpis.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Archived ({archivedKpis.length})</h3>
              <div className="space-y-2 opacity-60">
                {archivedKpis.map((kpi) => (
                  <Card key={kpi.id} className="cursor-pointer" onClick={() => setSelectedKpi(kpi)}>
                    <CardContent className="py-3 px-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Archive className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{kpi.name}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm tabular-nums">{kpi.current_value ?? "—"}</span>
                        {(canEdit || canHardDelete) && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <LifecycleActions
                              target="kpi_definition"
                              id={kpi.id}
                              name={kpi.name}
                              isArchived={true}
                              canArchive={canEdit}
                              canHardDelete={canHardDelete}
                              cascadeDescription={HARD_DELETE_CASCADE_COPY.kpi_definition}
                              invalidate={[["kpi-definitions", project.id], ["project-kpis", project.id]]}
                            />
                          </div>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Create Dialog */}
      <KpiDefinitionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={project.id}
        workspaceId={project.workspace_id}
        organizationId={project.organization_id}
      />

      {/* Edit Dialog */}
      {editKpi && (
        <KpiDefinitionDialog
          open={!!editKpi}
          onOpenChange={(v) => !v && setEditKpi(null)}
          projectId={project.id}
          workspaceId={project.workspace_id}
          organizationId={project.organization_id}
          initial={editKpi}
        />
      )}

      {/* Quick Update Dialog (reuses canonical update path) */}
      {updateKpiTarget && (
        <KpiUpdateDialog
          open={!!updateKpiTarget}
          onOpenChange={(v) => !v && setUpdateKpiTarget(null)}
          kpiName={updateKpiTarget.name}
          unit={updateKpiTarget.unit}
          isSubmitting={addUpdate.isPending}
          onSubmit={(data) => {
            addUpdate.mutate(
              {
                kpi_definition_id: updateKpiTarget.id,
                value: parseFloat(data.value),
                update_date: data.update_date,
                note: data.note || undefined,
                workspace_id: project.workspace_id,
                organization_id: project.organization_id,
              },
              { onSuccess: () => setUpdateKpiTarget(null) },
            );
          }}
        />
      )}
    </div>
  );
}
