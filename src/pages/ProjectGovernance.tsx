import { useMemo, useState } from "react";
import { useOutletContext, useNavigate, useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getDecisionStageBadgeClass } from "@/lib/decisionStageVisuals";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Plus,
  MoreHorizontal,
  Pencil,
  Archive,
  RotateCcw,
  CalendarClock,
  ShieldAlert,
  FileText,
  Link2,
  ExternalLink,
  Gavel,
} from "lucide-react";
import { toast } from "sonner";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import {
  eventTypeLabel,
  frequencyLabel,
  mapGovernanceMutationError,
  statusBadgeMeta,
  useArchiveGovernanceCadence,
  useArchiveGovernanceRecord,
  useProjectGovernanceCadences,
  useProjectGovernanceRecords,
  useProjectGovernanceSummary,
  useRestoreGovernanceCadence,
  useRestoreGovernanceRecord,
  type DecisionStage,
  type GovernanceCadenceRow,
  type GovernanceRecordRow,
} from "@/hooks/useProjectGovernance";
import { useProjectStakeholders } from "@/hooks/useProjectStakeholders";
import { useProjectTeam } from "@/hooks/useProjectTeamRaci";
import { CadenceFormDialog } from "@/components/project/governance/CadenceFormDialog";
import { AdjustNextDateDialog } from "@/components/project/governance/AdjustNextDateDialog";
import { RecordFormDialog } from "@/components/project/governance/RecordFormDialog";
import { RecordDetailDialog } from "@/components/project/governance/RecordDetailDialog";
import { CreateDecisionCaseDialog } from "@/components/project/governance/CreateDecisionCaseDialog";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";
import { ConceptHelp } from "@/components/knowledge/ConceptHelp";
import { KC_SLUGS, KC_CONCEPTS } from "@/components/knowledge/kc-concepts";

const DECISION_STAGE_LABELS: Record<DecisionStage, string> = {
  initiated: "Initiated",
  evidence_collection: "Evidence Collection",
  brief_prepared: "Brief Prepared",
  provided_to_stakeholders: "Provided to Stakeholders",
  pending_decision: "Pending Decision",
  decision_taken: "Decision Taken",
  closed: "Closed",
};

function decisionStageLabel(stage: DecisionStage | null | undefined): string {
  if (!stage) return "Initiated";
  return DECISION_STAGE_LABELS[stage] ?? stage;
}


function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return new Date(d + "T00:00:00").toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return d;
  }
}

function SummaryCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default function ProjectGovernance() {
  const { project } = useOutletContext<{ project: any }>();
  const projectId: string | undefined = project?.id;
  const { canEdit } = useProjectPlanningAuthority(project?.id);
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId: string }>();

  const decisionCaseHref = (recordId: string) =>
    `/workspace/${workspaceId}/project/${projectId}/governance/decision-cases/${recordId}`;

  const [activeTab, setActiveTab] = useState<"decision_cases" | "evidence_records" | "cadences">("decision_cases");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [includeArchivedRecords, setIncludeArchivedRecords] = useState(false);
  const [includeArchivedDecisions, setIncludeArchivedDecisions] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<GovernanceCadenceRow | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<GovernanceCadenceRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<GovernanceCadenceRow | null>(null);

  // Records dialog state
  const [recordFormOpen, setRecordFormOpen] = useState(false);
  const [recordEditTarget, setRecordEditTarget] = useState<GovernanceRecordRow | null>(null);
  const [preselectedCadenceId, setPreselectedCadenceId] = useState<string | null>(null);
  const [recordDetailId, setRecordDetailId] = useState<string | null>(null);
  const [recordArchiveTarget, setRecordArchiveTarget] = useState<GovernanceRecordRow | null>(null);
  const [decisionCaseOpen, setDecisionCaseOpen] = useState(false);

  const summaryQ = useProjectGovernanceSummary(projectId);
  const cadencesQ = useProjectGovernanceCadences(projectId, includeArchived);
  // Records list returns both record_kind variants; we split client-side.
  // Use the broader include-archived flag so each tab can filter its own list.
  const recordsIncludeArchived = includeArchivedRecords || includeArchivedDecisions;
  const recordsQ = useProjectGovernanceRecords(projectId, recordsIncludeArchived);
  // Pre-fetch team and stakeholders so child forms are ready
  useProjectTeam(projectId);
  const { data: stakeholders = [] } = useProjectStakeholders(projectId);

  const archive = useArchiveGovernanceCadence(projectId ?? "");
  const restore = useRestoreGovernanceCadence(projectId ?? "");
  const archiveRecord = useArchiveGovernanceRecord(projectId ?? "");
  const restoreRecord = useRestoreGovernanceRecord(projectId ?? "");

  const teamMap = useTeamMap(projectId);
  const stakeholderNameMap = useMemo(() => {
    const m = new Map<string, string>();
    stakeholders.forEach((s) => m.set(s.id, s.display_name));
    return m;
  }, [stakeholders]);

  const cadences = cadencesQ.data ?? [];
  const records = recordsQ.data ?? [];
  const summary = summaryQ.data;

  const sorted = useMemo(() => {
    return [...cadences].sort((a, b) => {
      if (!!a.archived_at !== !!b.archived_at) return a.archived_at ? 1 : -1;
      const an = a.next_expected_date ?? "9999-12-31";
      const bn = b.next_expected_date ?? "9999-12-31";
      if (an !== bn) return an < bn ? -1 : 1;
      return a.created_at < b.created_at ? 1 : -1;
    });
  }, [cadences]);

  // Split records by canonical record_kind. Missing/legacy values fall back to evidence_record.
  const evidenceRecords = useMemo(
    () =>
      records.filter((r) => (r.record_kind ?? "evidence_record") !== "decision_case"),
    [records],
  );
  const decisionCases = useMemo(
    () => records.filter((r) => r.record_kind === "decision_case"),
    [records],
  );

  // Derived hub counters (display-only; not persisted).
  const activeDecisionCount = useMemo(
    () => decisionCases.filter((r) => !r.archived_at && r.decision_stage !== "closed").length,
    [decisionCases],
  );
  const pendingDecisionCount = useMemo(
    () =>
      decisionCases.filter(
        (r) => !r.archived_at && r.decision_stage === "pending_decision",
      ).length,
    [decisionCases],
  );
  const evidenceRecordCount = useMemo(
    () => evidenceRecords.filter((r) => !r.archived_at).length,
    [evidenceRecords],
  );
  const evidenceRecordsMissingEvidence = useMemo(
    () => evidenceRecords.filter((r) => !r.archived_at && !r.has_sharepoint_evidence).length,
    [evidenceRecords],
  );
  const activeCadencesCount = summary?.active_cadence_count ?? 0;

  const handleOpenCreate = () => {
    if (!canEdit) {
      toast.error("You do not have permission to manage governance cadences for this project.");
      return;
    }
    setEditTarget(null);
    setFormOpen(true);
  };

  const handleEdit = (c: GovernanceCadenceRow) => {
    setEditTarget(c);
    setFormOpen(true);
  };

  const handleOpenDecisionCase = () => {
    if (!canEdit) {
      toast.error("You do not have permission to create decision cases for this project.");
      return;
    }
    setDecisionCaseOpen(true);
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget) return;
    try {
      await archive.mutateAsync(archiveTarget.id);
      toast.success("Cadence archived.");
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.toLowerCase().includes("forbidden") || msg.includes("42501")) {
        toast.error("You do not have permission to manage governance cadences for this project.");
      } else {
        toast.error(msg || "Could not archive cadence.");
      }
    } finally {
      setArchiveTarget(null);
    }
  };

  const handleRestore = async (c: GovernanceCadenceRow) => {
    try {
      await restore.mutateAsync(c.id);
      toast.success("Cadence restored.");
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.toLowerCase().includes("forbidden") || msg.includes("42501")) {
        toast.error("You do not have permission to manage governance cadences for this project.");
      } else {
        toast.error(msg || "Could not restore cadence.");
      }
    }
  };

  const sortedEvidenceRecords = useMemo(() => {
    const base = includeArchivedRecords
      ? evidenceRecords
      : evidenceRecords.filter((r) => !r.archived_at);
    return [...base].sort((a, b) => {
      if (!!a.archived_at !== !!b.archived_at) return a.archived_at ? 1 : -1;
      if (a.actual_date_held !== b.actual_date_held)
        return a.actual_date_held > b.actual_date_held ? -1 : 1;
      return a.created_at > b.created_at ? -1 : 1;
    });
  }, [evidenceRecords, includeArchivedRecords]);

  const sortedDecisionCases = useMemo(() => {
    const base = includeArchivedDecisions
      ? decisionCases
      : decisionCases.filter((r) => !r.archived_at);
    return [...base].sort((a, b) => {
      if (!!a.archived_at !== !!b.archived_at) return a.archived_at ? 1 : -1;
      const at = a.target_decision_date ?? "9999-12-31";
      const bt = b.target_decision_date ?? "9999-12-31";
      if (at !== bt) return at < bt ? -1 : 1;
      return a.created_at > b.created_at ? -1 : 1;
    });
  }, [decisionCases, includeArchivedDecisions]);

  const handleOpenRecordCreate = (cadenceId: string | null = null) => {
    if (!canEdit) {
      toast.error("You do not have permission to record governance evidence for this project.");
      return;
    }
    setRecordEditTarget(null);
    setPreselectedCadenceId(cadenceId);
    setRecordFormOpen(true);
  };

  const handleEditRecord = (r: GovernanceRecordRow) => {
    // Decision cases must not be edited via RecordFormDialog.
    if (r.record_kind === "decision_case") {
      toast.info("Decision case editing will move into the decision case workspace.");
      return;
    }
    setRecordDetailId(null);
    setPreselectedCadenceId(null);
    setRecordEditTarget(r);
    setRecordFormOpen(true);
  };

  const handleConfirmArchiveRecord = async () => {
    if (!recordArchiveTarget) return;
    try {
      await archiveRecord.mutateAsync(recordArchiveTarget.id);
      toast.success(recordArchiveTarget.record_kind === "decision_case" ? "Decision case archived." : "Record archived.");
    } catch (e) {
      toast.error(mapGovernanceMutationError(e, "Could not archive record."));
    } finally {
      setRecordArchiveTarget(null);
    }
  };

  const handleRestoreRecord = async (r: GovernanceRecordRow) => {
    try {
      await restoreRecord.mutateAsync(r.id);
      toast.success(r.record_kind === "decision_case" ? "Decision case restored." : "Record restored.");
    } catch (e) {
      toast.error(mapGovernanceMutationError(e, "Could not restore record."));
    }
  };

  if (!projectId) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold">Governance</h1>
            <ConceptHelp
              term={KC_CONCEPTS.governanceTraceability.term}
              shortText={KC_CONCEPTS.governanceTraceability.shortText}
              articleSlug={KC_CONCEPTS.governanceTraceability.slug}
            />
            <KnowledgeLink slug={KC_SLUGS.governanceTraceability} label="Governance guide" />
          </div>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Manage decision cases, capture evidence that governance events happened, and track the
            expected governance rhythm for this project.
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={handleOpenDecisionCase}>
              <Gavel className="h-4 w-4 mr-2" /> Create decision case
            </Button>
            <Button variant="outline" onClick={() => handleOpenRecordCreate(null)}>
              <FileText className="h-4 w-4 mr-2" /> Record evidence
            </Button>
            <Button variant="outline" onClick={handleOpenCreate}>
              <Plus className="h-4 w-4 mr-2" /> Create cadence
            </Button>
          </div>
        )}
      </header>

      {/* Hub summary cards (derived; not persisted) */}
      <section>
        {summaryQ.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : summaryQ.error ? (
          <Card><CardContent className="p-4 text-sm text-destructive">
            <ShieldAlert className="h-4 w-4 inline mr-2" />
            Could not load governance summary.
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard
              label="Active decision cases"
              value={activeDecisionCount}
              hint="Not yet closed"
            />
            <SummaryCard
              label="Pending decisions"
              value={pendingDecisionCount}
              hint="Awaiting decision"
            />
            <SummaryCard
              label="Evidence records"
              value={evidenceRecordCount}
              hint={
                evidenceRecordsMissingEvidence > 0
                  ? `${evidenceRecordsMissingEvidence} missing evidence`
                  : undefined
              }
            />
            <SummaryCard
              label="Active cadences"
              value={activeCadencesCount}
              hint={summary?.next_expected_governance_date
                ? `Next: ${formatDate(summary.next_expected_governance_date)}`
                : undefined}
            />
          </div>
        )}
      </section>

      {/* Governance Hub internal tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList>
          <TabsTrigger value="decision_cases">
            Decision Cases
            <span className="ml-2 text-xs text-muted-foreground tabular-nums">
              {decisionCases.filter((r) => !r.archived_at).length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="evidence_records">
            Evidence Records
            <span className="ml-2 text-xs text-muted-foreground tabular-nums">
              {evidenceRecordCount}
            </span>
          </TabsTrigger>
          <TabsTrigger value="cadences">
            Cadences
            <span className="ml-2 text-xs text-muted-foreground tabular-nums">
              {activeCadencesCount}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* Decision Cases */}
        <TabsContent value="decision_cases" className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Decision cases</h2>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <Switch checked={includeArchivedDecisions} onCheckedChange={setIncludeArchivedDecisions} />
              Show archived
            </label>
          </div>

          {recordsQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : recordsQ.error ? (
            <Card><CardContent className="p-4 text-sm text-destructive">
              Could not load decision cases.
            </CardContent></Card>
          ) : sortedDecisionCases.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No decision cases yet. Use “Create decision case” to initiate one.
                </p>
                {canEdit && (
                  <Button className="mt-4" onClick={handleOpenDecisionCase}>
                    <Gavel className="h-4 w-4 mr-2" /> Create decision case
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {sortedDecisionCases.map((r) => (
                <DecisionCaseRow
                  key={r.id}
                  record={r}
                  canEdit={canEdit}
                  ownerName={
                    r.decision_owner_stakeholder_id
                      ? stakeholderNameMap.get(r.decision_owner_stakeholder_id) ?? null
                      : null
                  }
                  onView={() => navigate(decisionCaseHref(r.id))}
                  onArchive={() => setRecordArchiveTarget(r)}
                  onRestore={() => handleRestoreRecord(r)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Evidence Records */}
        <TabsContent value="evidence_records" className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Evidence records</h2>
              <KnowledgeLink slug={KC_SLUGS.howToRecordGovernanceEvidence} label="How to record evidence" />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <Switch checked={includeArchivedRecords} onCheckedChange={setIncludeArchivedRecords} />
              Show archived records
            </label>
          </div>

          {recordsQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : recordsQ.error ? (
            <Card><CardContent className="p-4 text-sm text-destructive">
              Could not load governance records.
            </CardContent></Card>
          ) : sortedEvidenceRecords.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  {includeArchivedRecords
                    ? "No evidence records exist for this project."
                    : "No governance evidence has been recorded yet."}
                </p>
                {canEdit && !includeArchivedRecords && (
                  <Button className="mt-4" onClick={() => handleOpenRecordCreate(null)}>
                    <FileText className="h-4 w-4 mr-2" /> Record first evidence
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {sortedEvidenceRecords.map((r) => (
                <RecordRow
                  key={r.id}
                  record={r}
                  canEdit={canEdit}
                  onView={() => setRecordDetailId(r.id)}
                  onEdit={() => handleEditRecord(r)}
                  onArchive={() => setRecordArchiveTarget(r)}
                  onRestore={() => handleRestoreRecord(r)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Cadences */}
        <TabsContent value="cadences" className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">Cadences</h2>
              <KnowledgeLink slug={KC_SLUGS.howToSetUpGovernanceCadence} label="How to set up cadence" />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <Switch checked={includeArchived} onCheckedChange={setIncludeArchived} />
              Show archived
            </label>
          </div>

          {cadencesQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : cadencesQ.error ? (
            <Card><CardContent className="p-4 text-sm text-destructive">
              Could not load cadences.
            </CardContent></Card>
          ) : sorted.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  {includeArchived
                    ? "No governance cadences exist for this project."
                    : "No governance cadence has been defined for this project yet."}
                </p>
                {canEdit && !includeArchived && (
                  <Button className="mt-4" onClick={handleOpenCreate}>
                    <Plus className="h-4 w-4 mr-2" /> Create first cadence
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {sorted.map((c) => (
                <CadenceRow
                  key={c.id}
                  cadence={c}
                  ownerName={c.owner_id ? teamMap.get(c.owner_id) ?? null : null}
                  canEdit={canEdit}
                  onEdit={() => handleEdit(c)}
                  onAdjust={() => setAdjustTarget(c)}
                  onArchive={() => setArchiveTarget(c)}
                  onRestore={() => handleRestore(c)}
                  onRecordEvidence={() => handleOpenRecordCreate(c.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <CadenceFormDialog
        open={formOpen}
        onOpenChange={(v) => { setFormOpen(v); if (!v) setEditTarget(null); }}
        projectId={projectId}
        cadence={editTarget}
      />
      <AdjustNextDateDialog
        open={!!adjustTarget}
        onOpenChange={(v) => { if (!v) setAdjustTarget(null); }}
        projectId={projectId}
        cadence={adjustTarget}
      />
      <AlertDialog open={!!archiveTarget} onOpenChange={(v) => { if (!v) setArchiveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this governance cadence?</AlertDialogTitle>
            <AlertDialogDescription>
              It will become inactive but historical records remain available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RecordFormDialog
        open={recordFormOpen}
        onOpenChange={(v) => {
          setRecordFormOpen(v);
          if (!v) { setRecordEditTarget(null); setPreselectedCadenceId(null); }
        }}
        projectId={projectId}
        record={recordEditTarget}
        preselectedCadenceId={preselectedCadenceId}
      />
      <RecordDetailDialog
        open={!!recordDetailId}
        onOpenChange={(v) => { if (!v) setRecordDetailId(null); }}
        recordId={recordDetailId}
        onEdit={() => {
          const r = records.find((x) => x.id === recordDetailId) ?? null;
          if (r) handleEditRecord(r);
        }}
      />
      <AlertDialog open={!!recordArchiveTarget} onOpenChange={(v) => { if (!v) setRecordArchiveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {recordArchiveTarget?.record_kind === "decision_case"
                ? "Archive this decision case?"
                : "Archive this governance record?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              It stays available under "Show archived" and can be restored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmArchiveRecord}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateDecisionCaseDialog
        open={decisionCaseOpen}
        onOpenChange={setDecisionCaseOpen}
        projectId={projectId}
        onCreated={(id) => {
          setActiveTab("decision_cases");
          navigate(decisionCaseHref(id));
        }}
      />
    </div>
  );
}


function CadenceRow({
  cadence,
  ownerName,
  canEdit,
  onEdit,
  onAdjust,
  onArchive,
  onRestore,
  onRecordEvidence,
}: {
  cadence: GovernanceCadenceRow;
  ownerName: string | null;
  canEdit: boolean;
  onEdit: () => void;
  onAdjust: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onRecordEvidence: () => void;
}) {
  const meta = statusBadgeMeta(cadence.derived_status);
  const isArchived = !!cadence.archived_at;

  return (
    <Card className={isArchived ? "opacity-70" : undefined}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">
                {cadence.event_name?.trim() || eventTypeLabel(cadence.event_type)}
              </span>
              {cadence.event_name?.trim() && (
                <span className="text-xs text-muted-foreground">
                  · {eventTypeLabel(cadence.event_type)}
                </span>
              )}
              <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {frequencyLabel(cadence.frequency_type)}
              {ownerName ? ` · Owner: ${ownerName}` : ""}
            </div>
            {cadence.expected_evidence_type && (
              <div className="mt-1 text-xs text-muted-foreground">
                Evidence: {cadence.expected_evidence_type}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm min-w-[260px]">
            <span className="text-muted-foreground">Next expected</span>
            <span className="tabular-nums">{formatDate(cadence.next_expected_date)}</span>
            <span className="text-muted-foreground">Last completed</span>
            <span className="tabular-nums">{formatDate(cadence.last_completed_date)}</span>
            <span className="text-muted-foreground">Records</span>
            <span className="tabular-nums">{cadence.record_count}</span>
            <span className="text-muted-foreground">Decisions</span>
            <span className="tabular-nums">{cadence.decision_count}</span>
          </div>

          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Cadence actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!isArchived && (
                  <>
                    <DropdownMenuItem onClick={onRecordEvidence}>
                      <FileText className="h-4 w-4 mr-2" /> Record evidence
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onEdit}>
                      <Pencil className="h-4 w-4 mr-2" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onAdjust}>
                      <CalendarClock className="h-4 w-4 mr-2" /> Adjust next date
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onArchive} className="text-destructive focus:text-destructive">
                      <Archive className="h-4 w-4 mr-2" /> Archive
                    </DropdownMenuItem>
                  </>
                )}
                {isArchived && (
                  <DropdownMenuItem onClick={onRestore}>
                    <RotateCcw className="h-4 w-4 mr-2" /> Restore
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function useTeamMap(projectId: string | undefined) {
  const { data } = useProjectTeam(projectId);
  return useMemo(() => {
    const m = new Map<string, string>();
    (data ?? []).forEach((t: any) => {
      if (t?.user_id) m.set(t.user_id, t.display_name ?? t.user_id);
    });
    return m;
  }, [data]);
}

function RecordRow({
  record,
  canEdit,
  onView,
  onEdit,
  onArchive,
  onRestore,
}: {
  record: GovernanceRecordRow;
  canEdit: boolean;
  onView: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const isArchived = !!record.archived_at;
  const titleLabel = record.event_name?.trim() || eventTypeLabel(record.event_type);
  const cadenceLabel = record.cadence_id
    ? (record.cadence_event_name?.trim() ||
        (record.cadence_event_type ? eventTypeLabel(record.cadence_event_type) : "Cadence"))
    : null;

  return (
    <Card className={isArchived ? "opacity-70" : undefined}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4 flex-wrap">
          <button
            type="button"
            onClick={onView}
            className="flex-1 min-w-[260px] text-left hover:underline"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{titleLabel}</span>
              {record.event_name?.trim() && (
                <span className="text-xs text-muted-foreground">
                  · {eventTypeLabel(record.event_type)}
                </span>
              )}
              {isArchived && <Badge variant="outline">Archived</Badge>}
              {record.has_sharepoint_evidence ? (
                <Badge variant="outline" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                  <Link2 className="h-3 w-3 mr-1" /> Evidence attached
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
                  Evidence missing
                </Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Held: {formatDate(record.actual_date_held)}
              {cadenceLabel ? ` · Cadence: ${cadenceLabel}` : " · Ad hoc"}
            </div>
            {record.summary && (
              <div className="mt-1 text-sm line-clamp-2">{record.summary}</div>
            )}
          </button>

          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm min-w-[180px]">
            <span className="text-muted-foreground">Decisions</span>
            <span className="tabular-nums">{record.decision_count}</span>
            <span className="text-muted-foreground">Linked objects</span>
            <span className="tabular-nums">{record.link_count}</span>
            {record.external_reference_url && (
              <>
                <span className="text-muted-foreground">External</span>
                <a
                  href={record.external_reference_url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline inline-flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              </>
            )}
          </div>

          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Record actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onView}>
                  <FileText className="h-4 w-4 mr-2" /> View
                </DropdownMenuItem>
                {!isArchived && (
                  <>
                    <DropdownMenuItem onClick={onEdit}>
                      <Pencil className="h-4 w-4 mr-2" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onArchive} className="text-destructive focus:text-destructive">
                      <Archive className="h-4 w-4 mr-2" /> Archive
                    </DropdownMenuItem>
                  </>
                )}
                {isArchived && (
                  <DropdownMenuItem onClick={onRestore}>
                    <RotateCcw className="h-4 w-4 mr-2" /> Restore
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DecisionCaseRow({
  record,
  canEdit,
  ownerName,
  onView,
  onArchive,
  onRestore,
}: {
  record: GovernanceRecordRow;
  canEdit: boolean;
  ownerName: string | null;
  onView: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const isArchived = !!record.archived_at;
  const title = record.event_name?.trim() || "Untitled decision case";
  const stageLabel = decisionStageLabel(record.decision_stage);

  return (
    <Card className={isArchived ? "opacity-70" : undefined}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4 flex-wrap">
          <button
            type="button"
            onClick={onView}
            className="flex-1 min-w-[260px] text-left hover:underline"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <Gavel className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{title}</span>
              <Badge variant="outline" className={getDecisionStageBadgeClass(record.decision_stage)}>
                {stageLabel}
              </Badge>
              {isArchived && <Badge variant="outline">Archived</Badge>}
            </div>
            {record.decision_question && (
              <div className="mt-1 text-sm text-muted-foreground line-clamp-2">
                {record.decision_question}
              </div>
            )}
            <div className="mt-1 text-xs text-muted-foreground">
              Initiated: {formatDate(record.actual_date_held)}
              {ownerName ? ` · Owner: ${ownerName}` : ""}
            </div>
          </button>

          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm min-w-[200px]">
            <span className="text-muted-foreground">Target decision</span>
            <span className="tabular-nums">{formatDate(record.target_decision_date)}</span>
            <span className="text-muted-foreground">Forum</span>
            <span>{eventTypeLabel(record.event_type)}</span>
          </div>

          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Decision case actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onView}>
                  <FileText className="h-4 w-4 mr-2" /> View details
                </DropdownMenuItem>
                {!isArchived && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onArchive} className="text-destructive focus:text-destructive">
                      <Archive className="h-4 w-4 mr-2" /> Archive
                    </DropdownMenuItem>
                  </>
                )}
                {isArchived && (
                  <DropdownMenuItem onClick={onRestore}>
                    <RotateCcw className="h-4 w-4 mr-2" /> Restore
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

