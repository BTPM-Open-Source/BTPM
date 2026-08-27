/**
 * DC.3 — Decision Case Workspace Shell + Setup Tab.
 *
 * Dedicated full-page workspace for a canonical Governance Decision Case.
 * Only the Setup tab is functional in this step; the remaining tabs render
 * lightweight placeholders that will be implemented in DC.4 → DC.8.
 *
 * All reads/writes go through existing protected RPCs:
 *   - get_governance_record_detail (via useGovernanceRecordDetail)
 *   - update_governance_record    (via useUpdateGovernanceRecord)
 *
 * No direct table access. No new RPC. No schema change.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, Pencil, Archive, RotateCcw, Plus } from "lucide-react";
import { DecisionCaseEvidenceFileDialog } from "@/components/project/governance/DecisionCaseEvidenceFileDialog";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getDecisionStageBadgeClass } from "@/lib/decisionStageVisuals";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import {
  DECISION_STAGES,
  GOVERNANCE_EVENT_TYPES,
  eventTypeLabel,
  useGovernanceRecordDetail,
  useUpdateGovernanceRecord,
  type DecisionStage,
  type GovernanceEventType,
} from "@/hooks/useProjectGovernance";
import {
  evidenceTypeLabel,
  relevanceLabel,
  mapEvidenceMutationError,
  useArchiveGovernanceRecordEvidenceReference,
  useGovernanceRecordEvidenceReferences,
  useRestoreGovernanceRecordEvidenceReference,
  type GovernanceRecordEvidenceReference,
} from "@/hooks/useGovernanceEvidenceReferences";
import { DecisionCaseEvidenceDialog } from "@/components/project/governance/DecisionCaseEvidenceDialog";
import { DecisionCaseSharePointEvidenceFilePicker } from "@/components/project/governance/DecisionCaseSharePointEvidenceFilePicker";
import {
  useGovernanceRecordEvidenceFiles,
  useArchiveGovernanceRecordEvidenceFile,
  useRestoreGovernanceRecordEvidenceFile,
  mapEvidenceFileError,
  type GovernanceRecordEvidenceFile,
} from "@/hooks/useGovernanceEvidenceFiles";
import { DecisionCaseBtpmContextDialog } from "@/components/project/governance/DecisionCaseBtpmContextDialog";
import {
  btpmContextObjectTypeLabel,
  btpmContextRelationshipLabel,
  btpmContextRelevanceLabel,
  mapBtpmContextMutationError,
  useArchiveGovernanceRecordBtpmContextLink,
  useGovernanceRecordBtpmContextLinks,
  useRestoreGovernanceRecordBtpmContextLink,
  type GovernanceRecordBtpmContextLink as BtpmContextLink,
} from "@/hooks/useGovernanceBtpmContextLinks";
import { DecisionCaseBriefTab } from "@/components/project/governance/DecisionCaseBriefTab";
import { DecisionCaseDataPackageTab } from "@/components/project/governance/DecisionCaseDataPackageTab";
import { DecisionCaseClosureTab } from "@/components/project/governance/DecisionCaseClosureTab";
import { DecisionCaseStakeholderPackageTab } from "@/components/project/governance/DecisionCaseStakeholderPackageTab";
import { DecisionCaseLifecyclePanel } from "@/components/project/governance/DecisionCaseLifecyclePanel";
import { DecisionCaseWorkflowGuide } from "@/components/project/governance/DecisionCaseWorkflowGuide";
import { useProjectStakeholders } from "@/hooks/useProjectStakeholders";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";

const DECISION_STAGE_LABELS: Record<DecisionStage, string> = {
  initiated: "Initiated",
  evidence_collection: "Evidence Collection",
  brief_prepared: "Brief Prepared",
  provided_to_stakeholders: "Provided to Stakeholders",
  pending_decision: "Pending Decision",
  decision_taken: "Decision Taken",
  closed: "Closed",
};

const NO_OWNER = "__none__";

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

function decisionStageLabel(stage: DecisionStage | null | undefined): string {
  if (!stage) return DECISION_STAGE_LABELS.initiated;
  return DECISION_STAGE_LABELS[stage] ?? stage;
}

export default function ProjectDecisionCase() {
  const { workspaceId, projectId, recordId } = useParams<{
    workspaceId: string;
    projectId: string;
    recordId: string;
  }>();
  // (no navigation needed inside this page — Back link is a <Link>)
  const { project } = useOutletContext<{ project: any }>();
  const { canEdit } = useProjectPlanningAuthority(projectId);

  const detailQ = useGovernanceRecordDetail(recordId);
  const update = useUpdateGovernanceRecord(projectId ?? "");
  const { data: stakeholders = [] } = useProjectStakeholders(projectId);

  const backToGovernance = `/workspace/${workspaceId}/project/${projectId}/governance`;

  const record = detailQ.data;
  const recordKindOk = !!record && record.record_kind === "decision_case";

  // Setup form state
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [eventType, setEventType] = useState<GovernanceEventType>("steerco");
  const [initiationDate, setInitiationDate] = useState<string>("");
  const [ownerId, setOwnerId] = useState<string>(NO_OWNER);
  const [targetDate, setTargetDate] = useState<string>("");
  const [summary, setSummary] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("setup");
  const [lifecycleOpen, setLifecycleOpen] = useState(false);

  // Hydrate form when record loads/changes
  useEffect(() => {
    if (!record || record.record_kind !== "decision_case") return;
    setTitle(record.event_name ?? "");
    setQuestion(record.decision_question ?? "");
    setEventType((record.event_type as GovernanceEventType) ?? "steerco");
    setInitiationDate(record.actual_date_held ?? "");
    setOwnerId(record.decision_owner_stakeholder_id ?? NO_OWNER);
    setTargetDate(record.target_decision_date ?? "");
    setSummary(record.summary ?? "");
  }, [record?.id, record?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeStakeholders = useMemo(
    () => stakeholders.filter((s) => !s.removed_at),
    [stakeholders],
  );

  // Project-scoped check: when stakeholder selection has been hydrated from a
  // value that no longer matches a project stakeholder, clamp to "none" so the
  // UI never shows a phantom owner. Backend remains the authority on save.
  const ownerOptionAvailable = useMemo(() => {
    if (ownerId === NO_OWNER) return true;
    return activeStakeholders.some((s) => s.id === ownerId);
  }, [ownerId, activeStakeholders]);

  const ownerName = useMemo(() => {
    if (!record?.decision_owner_stakeholder_id) return null;
    return (
      stakeholders.find((s) => s.id === record.decision_owner_stakeholder_id)
        ?.display_name ?? null
    );
  }, [record?.decision_owner_stakeholder_id, stakeholders]);

  const handleSave = async () => {
    if (!recordId) return;
    if (!recordKindOk) {
      toast.error("This governance record is not a decision case.");
      return;
    }
    const t = title.trim();
    const q = question.trim();
    if (!t) {
      toast.error("Case title is required.");
      return;
    }
    if (!q) {
      toast.error("Decision question is required.");
      return;
    }
    if (!initiationDate) {
      toast.error("Initiation date is required.");
      return;
    }
    try {
      const ownerValue = ownerId === NO_OWNER ? null : ownerId;
      await update.mutateAsync({
        record_id: recordId,
        expected_updated_at: record!.updated_at,
        event_type: eventType,

        event_name: t,
        actual_date_held: initiationDate,
        summary: summary.trim() ? summary.trim() : null,
        clear_summary: summary.trim() ? false : true,
        decision_question: q,
        decision_owner_stakeholder_id: ownerValue ?? undefined,
        clear_decision_owner_stakeholder_id: ownerValue === null,
        target_decision_date: targetDate || undefined,
        clear_target_decision_date: !targetDate,
      });
      toast.success("Decision case updated.");
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (msg.toLowerCase().includes("forbidden") || msg.includes("42501")) {
        toast.error("You do not have permission to update this decision case.");
      } else if (msg.toLowerCase().includes("does not belong to this project")) {
        toast.error("Selected decision owner is not a stakeholder on this project.");
      } else {
        toast.error(msg || "Could not save decision case.");
      }
    }
  };

  // ─── Render guards ───

  if (!projectId || !recordId) return null;

  if (detailQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (detailQ.error) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          <p className="text-sm text-destructive">
            Could not load decision case: {String((detailQ.error as Error).message)}
          </p>
          <Button variant="outline" asChild>
            <Link to={backToGovernance}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Governance
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!record) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          <p className="text-sm text-muted-foreground">
            This decision case could not be found, or you do not have access to it.
          </p>
          <Button variant="outline" asChild>
            <Link to={backToGovernance}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Governance
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!recordKindOk) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          <h2 className="text-lg font-semibold">Not a decision case</h2>
          <p className="text-sm text-muted-foreground">
            This governance record is not a Decision Case. Open it from the Evidence Records
            section of Governance instead.
          </p>
          <Button variant="outline" asChild>
            <Link to={backToGovernance}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Governance
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const headerTitle = record.event_name?.trim() || "Untitled decision case";
  const stageLabel = decisionStageLabel(record.decision_stage);
  const submitting = update.isPending;
  const canSave = canEdit && !submitting;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to={backToGovernance}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Governance
          </Link>
        </Button>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold truncate">{headerTitle}</h1>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={getDecisionStageBadgeClass(record.decision_stage)}>
                {stageLabel}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Forum: {eventTypeLabel(record.event_type)}
              </span>
              <span className="text-xs text-muted-foreground">
                Target: {formatDate(record.target_decision_date)}
              </span>
              {ownerName && (
                <span className="text-xs text-muted-foreground">Owner: {ownerName}</span>
              )}
              {project?.name && (
                <span className="text-xs text-muted-foreground">Project: {project.name}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Lifecycle panel — hidden from UI per request; underlying functionality retained.
          To re-enable, restore the <details> wrapper around <DecisionCaseLifecyclePanel />. */}
      {false && (
        <details
          className="rounded-md border bg-card"
          open={lifecycleOpen}
          onToggle={(e) => setLifecycleOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium select-none text-muted-foreground">
            Lifecycle &amp; stage controls (advanced)
          </summary>
          <div className="p-4 pt-2">
            <DecisionCaseLifecyclePanel
              recordId={recordId}
              projectId={projectId}
              currentStage={record.decision_stage}
              canEdit={canEdit}
            />
          </div>
        </details>
      )}

      {/* Workflow guidance — derived, read-only, navigation-only */}
      <DecisionCaseWorkflowGuide
        recordId={recordId}
        decisionStage={record.decision_stage}
        onNavigate={setActiveTab}
        hasDataPackageTab
      />

      {/* Internal tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="evidence">Evidence &amp; Context</TabsTrigger>
          <TabsTrigger value="brief">Decision Brief</TabsTrigger>
          <TabsTrigger value="package">Stakeholder Package</TabsTrigger>
          <TabsTrigger value="closure">Decision Taken &amp; Closure</TabsTrigger>
          <TabsTrigger value="data-package">Case Package</TabsTrigger>
        </TabsList>

        {/* Setup */}
        <TabsContent value="setup" className="space-y-4">
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="grid gap-1.5">
                <Label htmlFor="dc-title">
                  Case title <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="dc-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={!canEdit}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="dc-question">
                  Decision question <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="dc-question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={3}
                  disabled={!canEdit}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="dc-forum">Forum / event type</Label>
                  <Select
                    value={eventType}
                    onValueChange={(v) => setEventType(v as GovernanceEventType)}
                    disabled={!canEdit}
                  >
                    <SelectTrigger id="dc-forum">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GOVERNANCE_EVENT_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Stage</Label>
                  <div className="flex h-10 items-center">
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                      {stageLabel}
                    </Badge>
                    <span className="ml-2 text-xs text-muted-foreground">
                      Advance the stage from the lifecycle panel above.
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="dc-init">
                    Initiation date <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="dc-init"
                    type="date"
                    value={initiationDate}
                    onChange={(e) => setInitiationDate(e.target.value)}
                    disabled={!canEdit}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="dc-target">Target decision date</Label>
                  <Input
                    id="dc-target"
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    disabled={!canEdit}
                  />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="dc-owner">Decision owner</Label>
                <Select
                  value={ownerOptionAvailable ? ownerId : NO_OWNER}
                  onValueChange={setOwnerId}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="dc-owner">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_OWNER}>Unassigned</SelectItem>
                    {activeStakeholders.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!ownerOptionAvailable && (
                  <p className="text-xs text-muted-foreground">
                    The previously selected owner is no longer an active project stakeholder.
                  </p>
                )}
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="dc-summary">Background / short summary</Label>
                <Textarea
                  id="dc-summary"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  rows={4}
                  disabled={!canEdit}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-muted-foreground pt-2">
                <div>Created: {formatDate(record.created_at?.slice(0, 10))}</div>
                <div>Last updated: {formatDate(record.updated_at?.slice(0, 10))}</div>
              </div>

              {canEdit && (
                <div className="flex justify-end pt-2">
                  <Button onClick={handleSave} disabled={!canSave}>
                    {submitting ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              )}

              {!canEdit && (
                <p className="text-xs text-muted-foreground">
                  You do not have permission to edit this decision case.
                </p>
              )}
            </CardContent>
          </Card>
          {/* Validate _ to keep static analysis happy on DECISION_STAGES export */}
          <span className="hidden">{DECISION_STAGES.length}</span>
        </TabsContent>

        <TabsContent value="evidence" className="space-y-4">
          <EvidenceAndContextTab
            recordId={recordId!}
            projectId={projectId!}
            workspaceId={workspaceId!}
            canEdit={canEdit}
            links={record.links ?? []}
          />
        </TabsContent>
        <TabsContent value="data-package">
          {recordId ? (
            <DecisionCaseDataPackageTab recordId={recordId} canEdit={canEdit} />
          ) : null}
        </TabsContent>
        <TabsContent value="brief">
          {recordId ? (
            <DecisionCaseBriefTab
              recordId={recordId}
              projectId={projectId}
              canEdit={canEdit}
              onContinueToStakeholderPackage={() => setActiveTab("package")}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="package">
          {recordId && projectId ? (
            <DecisionCaseStakeholderPackageTab
              recordId={recordId}
              projectId={projectId}
              canEdit={canEdit}
              onContinueToClosure={() => setActiveTab("closure")}
              onNavigateToBrief={() => setActiveTab("brief")}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="closure">
          {recordId && projectId ? (
            <DecisionCaseClosureTab
              recordId={recordId}
              projectId={projectId}
              canEdit={canEdit}
            />
          ) : null}
        </TabsContent>
      </Tabs>

    </div>
  );
}

function PlaceholderCard({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <CardContent className="p-6 space-y-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}

function EvidenceAndContextTab({
  recordId,
  projectId,
  workspaceId,
  canEdit,
  links,
}: {
  recordId: string;
  projectId: string;
  workspaceId: string;
  canEdit: boolean;
  links: import("@/hooks/useProjectGovernance").GovernanceRecordLink[];
}) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GovernanceRecordEvidenceReference | null>(null);

  const listQ = useGovernanceRecordEvidenceReferences(recordId, includeArchived);
  const archive = useArchiveGovernanceRecordEvidenceReference(recordId);
  const restore = useRestoreGovernanceRecordEvidenceReference(recordId);
  const { data: stakeholders = [] } = useProjectStakeholders(projectId);

  const stakeholderNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stakeholders) m.set(s.id, s.display_name);
    return m;
  }, [stakeholders]);

  const items = listQ.data ?? [];

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (e: GovernanceRecordEvidenceReference) => {
    setEditing(e);
    setDialogOpen(true);
  };

  const onArchive = async (id: string) => {
    try {
      await archive.mutateAsync(id);
      toast.success("Evidence reference archived.");
    } catch (e) {
      toast.error(mapEvidenceMutationError(e, "Could not archive."));
    }
  };
  const onRestore = async (id: string) => {
    try {
      await restore.mutateAsync(id);
      toast.success("Evidence reference restored.");
    } catch (e) {
      toast.error(mapEvidenceMutationError(e, "Could not restore."));
    }
  };

  return (
    <>
      <SharePointEvidenceFilesCard recordId={recordId} canEdit={canEdit} />

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-base font-semibold">Manual references</h3>
              <p className="text-sm text-muted-foreground max-w-2xl mt-1">
                Use this only for metadata-only references that are not selectable
                as SharePoint files. These references may appear in the manifest,
                but they will not be physically included in the ZIP bundle unless
                converted into a SharePoint file.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={includeArchived}
                  onCheckedChange={(v) => setIncludeArchived(!!v)}
                />
                Show archived
              </label>
              {canEdit && (
                <Button size="sm" onClick={openAdd}>
                  <Plus className="h-4 w-4 mr-1" /> Add evidence
                </Button>
              )}
            </div>
          </div>

          {listQ.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : listQ.error ? (
            <p className="text-sm text-destructive">
              Could not load evidence references: {String((listQ.error as Error).message)}
            </p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No external evidence references yet.
            </p>
          ) : (
            <ul className="divide-y border rounded-md">
              {items.map((e) => {
                const ownerName = e.owner_stakeholder_id
                  ? stakeholderNameById.get(e.owner_stakeholder_id) ?? null
                  : null;
                const archived = !!e.archived_at;
                return (
                  <li key={e.id} className="p-3 flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{e.title}</span>
                        <Badge variant="outline">{evidenceTypeLabel(e.evidence_type)}</Badge>
                        <Badge
                          variant="outline"
                          className={
                            e.relevance_level === "high"
                              ? "bg-primary/10 text-primary border-primary/30"
                              : ""
                          }
                        >
                          {relevanceLabel(e.relevance_level)}
                        </Badge>
                        {!e.included_in_package && (
                          <Badge variant="secondary">Excluded from package</Badge>
                        )}
                        {archived && <Badge variant="secondary">Archived</Badge>}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                        {ownerName && <span>Owner: {ownerName}</span>}
                        {e.evidence_date && <span>Date: {e.evidence_date}</span>}
                      </div>
                      {e.summary && (
                        <p className="mt-2 text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                          {e.summary}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="outline" asChild>
                        <a href={e.external_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4 mr-1" /> Open source
                        </a>
                      </Button>
                      {canEdit && !archived && (
                        <>
                          <Button size="icon" variant="ghost" onClick={() => openEdit(e)} title="Edit">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => onArchive(e.id)}
                            title="Archive"
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      {canEdit && archived && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => onRestore(e.id)}
                          title="Restore"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <BtpmContextCard
        recordId={recordId}
        currentProjectId={projectId}
        currentWorkspaceId={workspaceId ?? ""}
        canEdit={canEdit}
      />

      <DecisionCaseEvidenceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        recordId={recordId}
        projectId={projectId}
        existing={editing}
      />
    </>
  );
}

function BtpmContextCard({
  recordId,
  currentProjectId,
  currentWorkspaceId,
  canEdit,
}: {
  recordId: string;
  currentProjectId: string;
  currentWorkspaceId: string;
  canEdit: boolean;
}) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BtpmContextLink | null>(null);

  const listQ = useGovernanceRecordBtpmContextLinks(recordId, includeArchived);
  const archive = useArchiveGovernanceRecordBtpmContextLink(recordId);
  const restore = useRestoreGovernanceRecordBtpmContextLink(recordId);

  const items = (listQ.data ?? []) as BtpmContextLink[];

  // Group by source project
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; rows: BtpmContextLink[] }>();
    for (const l of items) {
      const key = l.source_project_id;
      const cur = map.get(key);
      if (cur) cur.rows.push(l);
      else
        map.set(key, {
          name: l.source_project_name ?? "(unknown project)",
          rows: [l],
        });
    }
    return Array.from(map.entries()).map(([id, v]) => ({
      sourceProjectId: id,
      sourceProjectName: v.name,
      rows: v.rows,
    }));
  }, [items]);

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (l: BtpmContextLink) => {
    setEditing(l);
    setDialogOpen(true);
  };
  const onArchive = async (id: string) => {
    try {
      await archive.mutateAsync(id);
      toast.success("BTPM context archived.");
    } catch (e) {
      toast.error(mapBtpmContextMutationError(e, "Could not archive."));
    }
  };
  const onRestore = async (id: string) => {
    try {
      await restore.mutateAsync(id);
      toast.success("BTPM context restored.");
    } catch (e) {
      toast.error(mapBtpmContextMutationError(e, "Could not restore."));
    }
  };

  return (
    <>
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-base font-semibold">BTPM context</h3>
              <p className="text-sm text-muted-foreground max-w-2xl mt-1">
                Select the BTPM objects that are directly relevant to this
                decision. You can link objects from this project or from other
                authorized projects. BTPM does not include other project data
                automatically.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={includeArchived}
                  onCheckedChange={(v) => setIncludeArchived(!!v)}
                />
                Show archived
              </label>
              {canEdit && (
                <Button size="sm" onClick={openAdd}>
                  <Plus className="h-4 w-4 mr-1" /> Add BTPM context
                </Button>
              )}
            </div>
          </div>

          {listQ.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : listQ.error ? (
            <p className="text-sm text-destructive">
              Could not load BTPM context:{" "}
              {String((listQ.error as Error).message)}
            </p>
          ) : grouped.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No BTPM context yet. Add tasks, phases, risks, blockers, or KPIs
              relevant to this decision.
            </p>
          ) : (
            <div className="space-y-4">
              {grouped.map((g) => (
                <div key={g.sourceProjectId} className="space-y-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Source project ·{" "}
                    <span className="font-medium text-foreground normal-case">
                      {g.sourceProjectName}
                    </span>
                    {g.sourceProjectId === currentProjectId && (
                      <Badge variant="outline" className="ml-2">
                        Current project
                      </Badge>
                    )}
                  </div>
                  <ul className="divide-y border rounded-md">
                    {g.rows.map((l) => {
                      const archived = !!l.archived_at;
                      return (
                        <li
                          key={l.id}
                          className="p-3 flex items-start justify-between gap-3 flex-wrap"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline">
                                {btpmContextObjectTypeLabel(l.object_type)}
                              </Badge>
                              <span className="font-medium truncate">
                                {l.object_name ?? l.object_id}
                              </span>
                              <Badge variant="outline">
                                {btpmContextRelationshipLabel(l.relationship_type)}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={
                                  l.relevance_level === "high"
                                    ? "bg-primary/10 text-primary border-primary/30"
                                    : ""
                                }
                              >
                                {btpmContextRelevanceLabel(l.relevance_level)}
                              </Badge>
                              {!l.included_in_package && (
                                <Badge variant="secondary">
                                  Excluded from package
                                </Badge>
                              )}
                              {archived && (
                                <Badge variant="secondary">Archived</Badge>
                              )}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                              {l.object_status && (
                                <span>Status: {l.object_status}</span>
                              )}
                              {l.source_program_name && (
                                <span>Program: {l.source_program_name}</span>
                              )}
                              {l.source_workspace_name && (
                                <span>
                                  Workspace: {l.source_workspace_name}
                                </span>
                              )}
                            </div>
                            {l.context_reason && (
                              <p className="mt-2 text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                                {l.context_reason}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {canEdit && !archived && (
                              <>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => openEdit(l)}
                                  title="Edit"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => onArchive(l.id)}
                                  title="Archive"
                                >
                                  <Archive className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            {canEdit && archived && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => onRestore(l.id)}
                                title="Restore"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <DecisionCaseBtpmContextDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        recordId={recordId}
        currentProjectId={currentProjectId}
        currentWorkspaceId={currentWorkspaceId}
        existing={editing}
      />
    </>
  );
}

function SharePointEvidenceFilesCard({
  recordId,
  canEdit,
}: {
  recordId: string;
  canEdit: boolean;
}) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<GovernanceRecordEvidenceFile | null>(null);
  const listQ = useGovernanceRecordEvidenceFiles(recordId, includeArchived);
  const archive = useArchiveGovernanceRecordEvidenceFile(recordId);
  const restore = useRestoreGovernanceRecordEvidenceFile(recordId);
  const items = (listQ.data ?? []) as GovernanceRecordEvidenceFile[];

  const onArchive = async (id: string) => {
    try { await archive.mutateAsync(id); toast.success("Evidence file archived."); }
    catch (e) { toast.error(mapEvidenceFileError(e, "Could not archive.")); }
  };
  const onRestore = async (id: string) => {
    try { await restore.mutateAsync(id); toast.success("Evidence file restored."); }
    catch (e) { toast.error(mapEvidenceFileError(e, "Could not restore.")); }
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">SharePoint evidence files</h3>
            <p className="text-sm text-muted-foreground max-w-2xl mt-1">
              Select real files from the project SharePoint folder. BTPM stores
              secure file references and uses them as evidence for AI Decision
              Brief generation and in the optional Case Package export.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={includeArchived} onCheckedChange={(v) => setIncludeArchived(!!v)} />
              Show archived
            </label>
            {canEdit && (
              <Button size="sm" onClick={() => setPickerOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add files from SharePoint
              </Button>
            )}
          </div>
        </div>

        {listQ.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : listQ.error ? (
          <p className="text-sm text-destructive">
            Could not load evidence files: {String((listQ.error as Error).message)}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No SharePoint evidence files attached yet.
          </p>
        ) : (
          <ul className="divide-y border rounded-md">
            {items.map((e) => {
              const archived = !!e.archived_at;
              return (
                <li key={e.id} className="p-3 flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{e.evidence_title}</span>
                      <Badge variant="outline">{e.file_name}</Badge>
                      <Badge
                        variant="outline"
                        className={
                          e.relevance_level === "high"
                            ? "bg-primary/10 text-primary border-primary/30"
                            : ""
                        }
                      >
                        {e.relevance_level}
                      </Badge>
                      {!e.included_in_package && (
                        <Badge variant="secondary">Excluded from package</Badge>
                      )}
                      {archived && <Badge variant="secondary">Archived</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                      {typeof e.size_bytes === "number" && (
                        <span>Size: {(e.size_bytes / 1024).toFixed(1)} KB</span>
                      )}
                      {e.sharepoint_last_modified_at && (
                        <span>SP modified: {formatDate(e.sharepoint_last_modified_at.slice(0, 10))}</span>
                      )}
                      <span>Selected: {formatDate(e.selected_at.slice(0, 10))}</span>
                    </div>
                    {e.evidence_summary && (
                      <p className="mt-2 text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
                        {e.evidence_summary}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {e.sharepoint_web_url && (
                      <Button size="sm" variant="outline" asChild>
                        <a href={e.sharepoint_web_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4 mr-1" /> Open in SharePoint
                        </a>
                      </Button>
                    )}
                    {canEdit && !archived && (
                      <Button size="icon" variant="ghost" onClick={() => setEditing(e)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canEdit && !archived && (
                      <Button size="icon" variant="ghost" onClick={() => onArchive(e.id)} title="Archive">
                        <Archive className="h-4 w-4" />
                      </Button>
                    )}
                    {canEdit && archived && (
                      <Button size="icon" variant="ghost" onClick={() => onRestore(e.id)} title="Restore">
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <DecisionCaseSharePointEvidenceFilePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        recordId={recordId}
      />
      <DecisionCaseEvidenceFileDialog
        open={!!editing}
        onOpenChange={(o) => { if (!o) setEditing(null); }}
        recordId={recordId}
        evidenceFile={editing}
      />
    </Card>
  );
}
