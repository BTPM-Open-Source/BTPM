/**
 * DC.9 — Stakeholder Package tab.
 *
 * Assemble a stakeholder-ready decision package from setup, brief, and
 * decision outcome material. Versioned. No Word/PPT generation.
 *
 * All reads/writes through protected RPCs via useGovernanceStakeholderPackages.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, FileText, Loader2, Presentation, RefreshCw } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  GOVERNANCE_STAKEHOLDER_PACKAGE_STATUSES,
  mapStakeholderPackageError,
  stakeholderPackageStatusLabel,
  useCreateGovernanceRecordStakeholderPackage,
  useGovernanceRecordStakeholderPackages,
  useMarkGovernanceRecordStakeholderPackageProvided,
  useSetCurrentGovernanceRecordStakeholderPackage,
  type GovernanceRecordStakeholderPackage,
  type GovernanceStakeholderPackageStatus,
} from "@/hooks/useGovernanceStakeholderPackages";
import { useGovernanceRecordBriefVersions } from "@/hooks/useGovernanceBriefVersions";
import { useGovernanceRecordDecisionOutcome } from "@/hooks/useGovernanceDecisionOutcome";
import { useGovernanceRecordEvidenceReferences } from "@/hooks/useGovernanceEvidenceReferences";
import { useGovernanceRecordCrossProjectLinks } from "@/hooks/useGovernanceCrossProjectLinks";
import { useGovernanceRecordDetail } from "@/hooks/useProjectGovernance";
import {
  useGeneratedDecisionCaseDocuments,
  type GeneratedDecisionCaseDocument,
} from "@/hooks/useGeneratedDecisionCaseDocuments";
import {
  generateDecisionCaseWordBrief,
  type GenerateDecisionBriefError,
} from "@/lib/decisionCaseWordBriefService";
import {
  generateDecisionCasePptOnepager,
  type GenerateOnepagerError,
} from "@/lib/decisionCasePptOnepagerService";
import { isFileLockedCode } from "@/lib/generatedFileErrorMessages";
import { GeneratedFilePublishIssueDialog } from "@/components/generated-docs/GeneratedFilePublishIssueDialog";

type Props = {
  recordId: string;
  projectId: string;
  canEdit: boolean;
  onContinueToClosure?: () => void;
  onNavigateToBrief?: () => void;
};

type FormState = {
  package_status: GovernanceStakeholderPackageStatus;
  audience_text: string;
  package_title: string;
  executive_summary: string;
  decision_question_text: string;
  background_context: string;
  options_summary: string;
  recommendation_text: string;
  decision_ask_text: string;
  evidence_summary: string;
  guardrails_text: string;
  residual_risks_text: string;
  next_steps_text: string;
  distribution_note: string;
  distribution_evidence_url: string;
};

const EMPTY: FormState = {
  package_status: "draft",
  audience_text: "",
  package_title: "",
  executive_summary: "",
  decision_question_text: "",
  background_context: "",
  options_summary: "",
  recommendation_text: "",
  decision_ask_text: "",
  evidence_summary: "",
  guardrails_text: "",
  residual_risks_text: "",
  next_steps_text: "",
  distribution_note: "",
  distribution_evidence_url: "",
};

function fromPackage(p: GovernanceRecordStakeholderPackage | null): FormState {
  if (!p) return EMPTY;
  return {
    package_status:
      (p.package_status as GovernanceStakeholderPackageStatus) ?? "draft",
    audience_text: p.audience_text ?? "",
    package_title: p.package_title ?? "",
    executive_summary: p.executive_summary ?? "",
    decision_question_text: p.decision_question_text ?? "",
    background_context: p.background_context ?? "",
    options_summary: p.options_summary ?? "",
    recommendation_text: p.recommendation_text ?? "",
    decision_ask_text: p.decision_ask_text ?? "",
    evidence_summary: p.evidence_summary ?? "",
    guardrails_text: p.guardrails_text ?? "",
    residual_risks_text: p.residual_risks_text ?? "",
    next_steps_text: p.next_steps_text ?? "",
    distribution_note: p.distribution_note ?? "",
    distribution_evidence_url: p.distribution_evidence_url ?? "",
  };
}

type BriefForAutofill = {
  id: string;
  version_number: number;
  executive_intro_text: string | null;
  options_summary: string | null;
  recommendation_text: string | null;
  guardrails_text: string | null;
  residual_risks_text: string | null;
  requested_decision_text: string | null;
  open_questions_text: string | null;
};

type DetailForAutofill = {
  title?: string | null;
  decision_question?: string | null;
};

function fromBrief(
  brief: BriefForAutofill,
  detail: DetailForAutofill | null | undefined,
): FormState {
  const titleBase =
    (detail?.title ?? "").toString().trim() || "Stakeholder Package";
  return {
    package_status: "draft",
    audience_text: "",
    package_title: `${titleBase} — Stakeholder Package`,
    executive_summary: brief.executive_intro_text ?? "",
    decision_question_text: (detail?.decision_question ?? "").toString(),
    background_context: "",
    options_summary: brief.options_summary ?? "",
    recommendation_text: brief.recommendation_text ?? "",
    decision_ask_text: brief.requested_decision_text ?? "",
    evidence_summary: "",
    guardrails_text: brief.guardrails_text ?? "",
    residual_risks_text: brief.residual_risks_text ?? "",
    next_steps_text: brief.open_questions_text ?? "",
    distribution_note: "",
    distribution_evidence_url: "",
  };
}

function isValidUrl(u: string): boolean {
  return /^https?:\/\//i.test(u.trim());
}

function formatDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

export function DecisionCaseStakeholderPackageTab({
  recordId,
  projectId,
  canEdit,
  onContinueToClosure,
  onNavigateToBrief,
}: Props) {
  const listQ = useGovernanceRecordStakeholderPackages(recordId);
  const detailQ = useGovernanceRecordDetail(recordId);
  const briefQ = useGovernanceRecordBriefVersions(recordId);
  const outcomeQ = useGovernanceRecordDecisionOutcome(recordId);
  const evidenceQ = useGovernanceRecordEvidenceReferences(recordId, false);
  const crossQ = useGovernanceRecordCrossProjectLinks(recordId, false);

  const create = useCreateGovernanceRecordStakeholderPackage(recordId);
  const setCurrent = useSetCurrentGovernanceRecordStakeholderPackage(recordId);
  const markProvided =
    useMarkGovernanceRecordStakeholderPackageProvided(recordId);

  const packages = listQ.data ?? [];
  const current = useMemo(
    () => packages.find((p) => p.is_current) ?? null,
    [packages],
  );

  const detail = detailQ.data;
  const currentBrief = useMemo(
    () => (briefQ.data ?? []).find((v) => v.is_current) ?? null,
    [briefQ.data],
  );
  const outcome = outcomeQ.data ?? null;

  const evidenceCount = (evidenceQ.data ?? []).filter(
    (e) => !e.archived_at,
  ).length;
  const crossCount = (crossQ.data ?? []).filter((l) => !l.archived_at).length;
  const btpmLinkCount = (detail?.links ?? []).length;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  // Tracks whether the form was auto-prepared from the brief (vs. loaded
  // from a saved package). Used for header status + "Prepared from…" banner.
  const [preparedFromBriefId, setPreparedFromBriefId] = useState<string | null>(
    null,
  );
  // Refresh-from-brief confirmation dialog (only relevant when a saved
  // package already exists).
  const [refreshOpen, setRefreshOpen] = useState(false);
  // Collapsed source-reference panel.
  const [sourceRefsOpen, setSourceRefsOpen] = useState(false);

  useEffect(() => {
    // Wait until package list, brief versions, AND Decision Case detail have
    // resolved at least once. AI.8.2a — do not hydrate the auto-prepared
    // package before detail is available, otherwise decision_question_text
    // and package_title fall back to blanks and the hydration key locks the
    // detail-less draft in place.
    if (listQ.isLoading || briefQ.isLoading || detailQ.isLoading) return;
    if (current) {
      const k = `pkg:${current.id}`;
      if (hydratedFor !== k) {
        setForm(fromPackage(current));
        setHydratedFor(k);
        setPreparedFromBriefId(null);
      }
      return;
    }
    if (currentBrief) {
      const k = `brief:${currentBrief.id}:detail:loaded`;
      if (hydratedFor !== k) {
        setForm(fromBrief(currentBrief, detail ?? null));
        setHydratedFor(k);
        setPreparedFromBriefId(currentBrief.id);
      }
      return;
    }
    if (hydratedFor !== "__empty__") {
      setForm(EMPTY);
      setHydratedFor("__empty__");
      setPreparedFromBriefId(null);
    }
  }, [
    current,
    currentBrief,
    detail,
    hydratedFor,
    listQ.isLoading,
    briefQ.isLoading,
    detailQ.isLoading,
  ]);

  function f<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  function refreshFromBrief() {
    if (!currentBrief) return;
    setForm(fromBrief(currentBrief, detail ?? null));
    setPreparedFromBriefId(currentBrief.id);
    setRefreshOpen(false);
    toast.success(
      `Form refreshed from Decision Brief v${currentBrief.version_number}.`,
    );
  }

  // Has the current brief been updated after the current package was last saved?
  const briefIsNewerThanPackage = useMemo(() => {
    if (!current || !currentBrief) return false;
    try {
      return (
        new Date(currentBrief.updated_at).getTime() >
        new Date(current.updated_at).getTime()
      );
    } catch {
      return false;
    }
  }, [current, currentBrief]);

  // Provided dialog state
  const [providedOpen, setProvidedOpen] = useState(false);
  const [providedNote, setProvidedNote] = useState("");
  const [providedUrl, setProvidedUrl] = useState("");

  const saving = create.isPending;

  // ---- DC.10 — Word brief generation state ----
  const qc = useQueryClient();
  const briefDocsQ = useGeneratedDecisionCaseDocuments(
    recordId,
    "decision_case_word_brief",
  );
  const latestBrief: GeneratedDecisionCaseDocument | null = useMemo(() => {
    const list = (briefDocsQ.data ?? []).filter(
      (d) => d.generation_status === "generated_local",
    );
    return list[0] ?? null;
  }, [briefDocsQ.data]);
  // DC.11a — independent "latest published" lookup so a newer failed publish
  // row cannot bypass the overwrite confirmation when an older published file
  // still exists in SharePoint.
  const latestPublishedBrief: GeneratedDecisionCaseDocument | null = useMemo(() => {
    const list = (briefDocsQ.data ?? []).filter(
      (d) =>
        d.generation_status === "generated_local" &&
        d.sharepoint_publish_status === "published",
    );
    return list[0] ?? null;
  }, [briefDocsQ.data]);
  const [briefBusy, setBriefBusy] = useState(false);
  const [briefConfirmOpen, setBriefConfirmOpen] = useState(false);
  const [briefConflictExisting, setBriefConflictExisting] = useState<
    GenerateDecisionBriefError["existing"]
  >(null);
  const [briefLockOpen, setBriefLockOpen] = useState(false);
  const [briefLockUrl, setBriefLockUrl] = useState<string | null>(null);

  async function runGenerateBrief(overwrite: boolean) {
    setBriefBusy(true);
    try {
      const res = await generateDecisionCaseWordBrief(recordId, {
        overwriteExisting: overwrite,
      });
      toast.success(`Decision Brief generated (v${res.packageVersionNumber}).`);
      setBriefConfirmOpen(false);
      setBriefLockOpen(false);
      setBriefConflictExisting(null);
      qc.invalidateQueries({
        queryKey: ["generated-decision-case-documents", recordId],
      });
    } catch (e) {
      const err = e as GenerateDecisionBriefError;
      if (err?.code === "existing_brief_conflict") {
        setBriefConflictExisting(err.existing ?? null);
        setBriefConfirmOpen(true);
      } else if (isFileLockedCode(err?.code)) {
        setBriefLockUrl(err?.existing?.sharepoint_web_url ?? latestBrief?.sharepoint_web_url ?? null);
        setBriefLockOpen(true);
      } else {
        toast.error(err?.message || "Could not generate Decision Brief.");
      }
    } finally {
      setBriefBusy(false);
    }
  }

  function handleGenerateBriefClick() {
    if (latestPublishedBrief) {
      setBriefConflictExisting({
        generated_at: latestPublishedBrief.generated_at,
        output_filename: latestPublishedBrief.output_filename,
        sharepoint_web_url: latestPublishedBrief.sharepoint_web_url,
      });
      setBriefConfirmOpen(true);
      return;
    }
    runGenerateBrief(false);
  }

  // ---- DC.11 — PPT one-pager generation state ----
  const onepagerDocsQ = useGeneratedDecisionCaseDocuments(
    recordId,
    "decision_case_ppt_onepager",
  );
  const latestOnepager: GeneratedDecisionCaseDocument | null = useMemo(() => {
    const list = (onepagerDocsQ.data ?? []).filter(
      (d) => d.generation_status === "generated_local",
    );
    return list[0] ?? null;
  }, [onepagerDocsQ.data]);
  // DC.11a — independent "latest published" lookup (see brief equivalent).
  const latestPublishedOnepager: GeneratedDecisionCaseDocument | null = useMemo(() => {
    const list = (onepagerDocsQ.data ?? []).filter(
      (d) =>
        d.generation_status === "generated_local" &&
        d.sharepoint_publish_status === "published",
    );
    return list[0] ?? null;
  }, [onepagerDocsQ.data]);
  const [onepagerBusy, setOnepagerBusy] = useState(false);
  const [onepagerConfirmOpen, setOnepagerConfirmOpen] = useState(false);
  const [onepagerConflictExisting, setOnepagerConflictExisting] = useState<
    GenerateOnepagerError["existing"]
  >(null);
  const [onepagerLockOpen, setOnepagerLockOpen] = useState(false);
  const [onepagerLockUrl, setOnepagerLockUrl] = useState<string | null>(null);

  async function runGenerateOnepager(overwrite: boolean) {
    setOnepagerBusy(true);
    try {
      const res = await generateDecisionCasePptOnepager(recordId, {
        overwriteExisting: overwrite,
      });
      toast.success(
        `Decision Brief one-pager generated (v${res.packageVersionNumber}).`,
      );
      setOnepagerConfirmOpen(false);
      setOnepagerLockOpen(false);
      setOnepagerConflictExisting(null);
      qc.invalidateQueries({
        queryKey: ["generated-decision-case-documents", recordId],
      });
    } catch (e) {
      const err = e as GenerateOnepagerError;
      if (err?.code === "existing_onepager_conflict") {
        setOnepagerConflictExisting(err.existing ?? null);
        setOnepagerConfirmOpen(true);
      } else if (isFileLockedCode(err?.code)) {
        setOnepagerLockUrl(
          err?.existing?.sharepoint_web_url ??
            latestOnepager?.sharepoint_web_url ??
            null,
        );
        setOnepagerLockOpen(true);
      } else {
        toast.error(err?.message || "Could not generate Decision Brief one-pager.");
      }
    } finally {
      setOnepagerBusy(false);
    }
  }

  function handleGenerateOnepagerClick() {
    if (latestPublishedOnepager) {
      setOnepagerConflictExisting({
        generated_at: latestPublishedOnepager.generated_at,
        output_filename: latestPublishedOnepager.output_filename,
        sharepoint_web_url: latestPublishedOnepager.sharepoint_web_url,
      });
      setOnepagerConfirmOpen(true);
      return;
    }
    runGenerateOnepager(false);
  }




  async function handleSave() {
    if (!canEdit) return;
    if (!form.package_title.trim()) {
      toast.error("Package title is required.");
      return;
    }
    // AI.8.2a — ordinary save must never mark the package as provided.
    // The explicit "Mark as provided" action is the only normal transition
    // to provided.
    if (form.package_status === "provided") {
      toast.error(
        "Use Mark as provided to provide the package to stakeholders.",
      );
      return;
    }
    if (
      form.distribution_evidence_url.trim() &&
      !isValidUrl(form.distribution_evidence_url)
    ) {
      toast.error(
        "Distribution evidence URL must start with http:// or https://",
      );
      return;
    }
    try {
      const res = await create.mutateAsync({
        package_title: form.package_title.trim(),
        package_status: form.package_status,
        audience_text: form.audience_text.trim() || null,
        executive_summary: form.executive_summary.trim() || null,
        decision_question_text: form.decision_question_text.trim() || null,
        background_context: form.background_context.trim() || null,
        options_summary: form.options_summary.trim() || null,
        recommendation_text: form.recommendation_text.trim() || null,
        decision_ask_text: form.decision_ask_text.trim() || null,
        evidence_summary: form.evidence_summary.trim() || null,
        guardrails_text: form.guardrails_text.trim() || null,
        residual_risks_text: form.residual_risks_text.trim() || null,
        next_steps_text: form.next_steps_text.trim() || null,
        distribution_note: form.distribution_note.trim() || null,
        distribution_evidence_url:
          form.distribution_evidence_url.trim() || null,
        make_current: true,
      });
      toast.success(`Saved as version ${res.version_number}.`);
      setHydratedFor(null);
    } catch (e) {
      toast.error(mapStakeholderPackageError(e, "Could not save package."));
    }
  }

  async function handleSetCurrent(id: string) {
    if (!canEdit) return;
    try {
      await setCurrent.mutateAsync(id);
      toast.success("Package version made current.");
      setHydratedFor(null);
    } catch (e) {
      toast.error(mapStakeholderPackageError(e, "Could not change current."));
    }
  }

  async function handleMarkProvided() {
    if (!canEdit || !current) return;
    if (providedUrl.trim() && !isValidUrl(providedUrl)) {
      toast.error(
        "Distribution evidence URL must start with http:// or https://",
      );
      return;
    }
    try {
      await markProvided.mutateAsync({
        package_id: current.id,
        distribution_note: providedNote.trim() || null,
        distribution_evidence_url: providedUrl.trim() || null,
      });
      toast.success("Package marked as provided.");
      setProvidedOpen(false);
      setProvidedNote("");
      setProvidedUrl("");
      setHydratedFor(null);
    } catch (e) {
      toast.error(
        mapStakeholderPackageError(e, "Could not mark package as provided."),
      );
    }
  }

  if (listQ.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Blocking empty state: no saved package and no current brief.
  if (!current && !currentBrief) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6 space-y-3">
            <h2 className="text-lg font-semibold">Stakeholder Package</h2>
            <p className="text-sm text-muted-foreground">
              Create and save a Current Decision Brief before preparing the
              Stakeholder Package.
            </p>
            {onNavigateToBrief && (
              <div>
                <Button type="button" onClick={onNavigateToBrief}>
                  Go to Decision Brief
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const isProvided = current?.package_status === "provided";
  const headerStatusLabel = current
    ? isProvided
      ? "Provided to stakeholders"
      : `Saved package v${current.version_number}`
    : currentBrief
      ? `Draft prepared from Decision Brief v${currentBrief.version_number}`
      : "No current Decision Brief";

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Stakeholder Package</h2>
              <p className="text-sm text-muted-foreground">
                Review and edit the stakeholder-ready package prepared from the
                current Decision Brief.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {current && (
                <Badge variant="outline">v{current.version_number}</Badge>
              )}
              <Badge
                variant={isProvided ? "default" : "secondary"}
                className={
                  isProvided
                    ? "bg-primary/10 text-primary border-primary/30"
                    : ""
                }
              >
                {headerStatusLabel}
              </Badge>
            </div>
          </div>

          {/* Status / context banner */}
          {!current && currentBrief && (
            <p className="text-xs rounded-md border bg-muted/40 px-3 py-2">
              Prepared from Current Decision Brief v
              {currentBrief.version_number}. Review and save.
            </p>
          )}
          {current && briefIsNewerThanPackage && currentBrief && (
            <p className="text-xs rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200 px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Current Decision Brief (v{currentBrief.version_number}) is
                newer than this Stakeholder Package. Refresh if you want to
                update the package from the latest brief.
              </span>
            </p>
          )}

          {/* Primary actions */}
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save Stakeholder Package"}
              </Button>
              {currentBrief && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (current) {
                      setRefreshOpen(true);
                    } else {
                      refreshFromBrief();
                    }
                  }}
                  disabled={saving || detailQ.isLoading}
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Refresh from Current Brief
                </Button>
              )}
              {current && !isProvided && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setProvidedOpen(true)}
                  disabled={markProvided.isPending}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Mark as provided
                </Button>
              )}
              {isProvided && onContinueToClosure && (
                <Button type="button" onClick={onContinueToClosure}>
                  Continue to Decision Taken
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              )}
            </div>
          )}
          {!canEdit && (
            <p className="text-xs text-muted-foreground">
              You have view-only access on this project.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Source summary (compact) */}
      <Card>
        <CardContent className="pt-6 space-y-2">
          <h3 className="text-sm font-semibold">Source summary</h3>
          {currentBrief ? (
            <div className="grid gap-2 md:grid-cols-2 text-sm">
              <div>
                <span className="text-muted-foreground">Decision Brief: </span>
                v{currentBrief.version_number}
                <span className="text-muted-foreground">
                  {" "}· saved {formatDateTime(currentBrief.updated_at)}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {currentBrief.decision_readiness && (
                  <Badge variant="outline">
                    Readiness:{" "}
                    {currentBrief.decision_readiness.replace(/_/g, " ")}
                  </Badge>
                )}
                {currentBrief.confidence_level && (
                  <Badge variant="outline">
                    Confidence: {currentBrief.confidence_level}
                  </Badge>
                )}
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-muted-foreground">
                  Requested decision
                </div>
                <div className="whitespace-pre-wrap text-foreground/90">
                  {currentBrief.requested_decision_text?.trim() || "—"}
                </div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-muted-foreground">
                  Recommendation
                </div>
                <div className="whitespace-pre-wrap text-foreground/90">
                  {currentBrief.recommendation_text?.trim() || "—"}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No current Decision Brief.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Stakeholder-facing package form */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold">Stakeholder Package</h3>
            {preparedFromBriefId && !current && (
              <span className="text-xs text-muted-foreground">
                Review and edit before sharing.
              </span>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="pk-status">Package status *</Label>
              {isProvided ? (
                <Input
                  id="pk-status"
                  value="Provided to stakeholders"
                  readOnly
                  disabled
                />
              ) : (
                <Select
                  value={
                    form.package_status === "provided"
                      ? "draft"
                      : form.package_status
                  }
                  onValueChange={(v) =>
                    f(
                      "package_status",
                      v as GovernanceStakeholderPackageStatus,
                    )
                  }
                  disabled={!canEdit}
                >
                  <SelectTrigger id="pk-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {/* AI.8.2a — exclude `provided` from the editable
                        dropdown. Mark as provided is the only normal path. */}
                    {GOVERNANCE_STAKEHOLDER_PACKAGE_STATUSES.filter(
                      (o) => o.value !== "provided",
                    ).map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pk-aud">Audience</Label>
              <Input
                id="pk-aud"
                value={form.audience_text}
                onChange={(e) => f("audience_text", e.target.value)}
                disabled={!canEdit}
                placeholder="e.g. Steering Committee"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pk-title">Package title *</Label>
            <Input
              id="pk-title"
              value={form.package_title}
              onChange={(e) => f("package_title", e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pk-exec">Executive summary</Label>
            <Textarea
              id="pk-exec"
              rows={3}
              value={form.executive_summary}
              onChange={(e) => f("executive_summary", e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pk-q">Decision question</Label>
            <Textarea
              id="pk-q"
              rows={2}
              value={form.decision_question_text}
              onChange={(e) => f("decision_question_text", e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="pk-ask">Requested decision</Label>
              <Textarea
                id="pk-ask"
                rows={3}
                value={form.decision_ask_text}
                onChange={(e) => f("decision_ask_text", e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pk-rec">Recommendation</Label>
              <Textarea
                id="pk-rec"
                rows={3}
                value={form.recommendation_text}
                onChange={(e) => f("recommendation_text", e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pk-grd">Conditions / guardrails</Label>
              <Textarea
                id="pk-grd"
                rows={3}
                value={form.guardrails_text}
                onChange={(e) => f("guardrails_text", e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pk-rsk">Residual risks</Label>
              <Textarea
                id="pk-rsk"
                rows={3}
                value={form.residual_risks_text}
                onChange={(e) => f("residual_risks_text", e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="pk-nx">Open questions / follow-ups</Label>
              <Textarea
                id="pk-nx"
                rows={3}
                value={form.next_steps_text}
                onChange={(e) => f("next_steps_text", e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="pk-opts">Options summary</Label>
              <Textarea
                id="pk-opts"
                rows={4}
                value={form.options_summary}
                onChange={(e) => f("options_summary", e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="pk-bg">Background / context</Label>
              <Textarea
                id="pk-bg"
                rows={3}
                value={form.background_context}
                onChange={(e) => f("background_context", e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="pk-ev">Evidence summary</Label>
              <Textarea
                id="pk-ev"
                rows={3}
                value={form.evidence_summary}
                onChange={(e) => f("evidence_summary", e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pk-dn">Distribution note</Label>
              <Textarea
                id="pk-dn"
                rows={2}
                value={form.distribution_note}
                onChange={(e) => f("distribution_note", e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pk-url">Distribution evidence URL</Label>
              <Input
                id="pk-url"
                type="url"
                value={form.distribution_evidence_url}
                onChange={(e) =>
                  f("distribution_evidence_url", e.target.value)
                }
                disabled={!canEdit}
                placeholder="https://…"
              />
            </div>
          </div>

          {canEdit && (
            <div className="flex items-center justify-end gap-2 flex-wrap">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save Stakeholder Package"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Source references (collapsed) */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <button
            type="button"
            className="flex items-center gap-1 text-sm font-semibold hover:underline"
            onClick={() => setSourceRefsOpen((v) => !v)}
            aria-expanded={sourceRefsOpen}
          >
            {sourceRefsOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Source references
          </button>
          {sourceRefsOpen && (
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-xs font-medium text-muted-foreground">
                  Setup
                </div>
                <div className="text-foreground/90 whitespace-pre-wrap">
                  <div>
                    <span className="text-muted-foreground">Question: </span>
                    {detail?.decision_question?.trim() || "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Target date: </span>
                    {detail?.target_decision_date ?? "—"}
                  </div>
                </div>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-xs font-medium text-muted-foreground">
                  Current Decision Brief
                </div>
                <div className="text-foreground/90 whitespace-pre-wrap">
                  {currentBrief ? (
                    <>
                      <div>
                        <span className="text-muted-foreground">v: </span>
                        {currentBrief.version_number}
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Requested decision:{" "}
                        </span>
                        {currentBrief.requested_decision_text?.trim() || "—"}
                      </div>
                    </>
                  ) : (
                    "No current brief."
                  )}
                </div>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-xs font-medium text-muted-foreground">
                  Decision outcome
                </div>
                <div className="text-foreground/90 whitespace-pre-wrap">
                  {outcome ? (
                    <>
                      <div>
                        <span className="text-muted-foreground">Result: </span>
                        {outcome.decision_result}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Decision: </span>
                        {outcome.final_decision_text?.trim() || "—"}
                      </div>
                    </>
                  ) : (
                    "Not recorded yet."
                  )}
                </div>
              </div>
              <div className="rounded-md border p-3 space-y-1">
                <div className="text-xs font-medium text-muted-foreground">
                  Evidence &amp; context
                </div>
                <div className="text-foreground/90 flex flex-wrap gap-2">
                  <Badge variant="outline">
                    External evidence: {evidenceCount}
                  </Badge>
                  <Badge variant="outline">
                    BTPM context links: {btpmLinkCount}
                  </Badge>
                  <Badge variant="outline">
                    Cross-project: {crossCount}
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Refresh-from-brief confirmation */}
      <AlertDialog open={refreshOpen} onOpenChange={setRefreshOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Refresh from Current Decision Brief?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {currentBrief
                ? `Refresh this draft from Current Decision Brief v${currentBrief.version_number}? Unsaved package edits will be replaced.`
                : "Refresh this draft from the Current Decision Brief? Unsaved package edits will be replaced."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                refreshFromBrief();
              }}
            >
              Refresh
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>



      {/* Version history */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <h3 className="text-sm font-semibold">Version history</h3>
          {packages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No package versions yet.
            </p>
          ) : (
            <ul className="divide-y border rounded-md">
              {packages.map((p) => (
                <li
                  key={p.id}
                  className="p-3 flex items-start justify-between gap-3 flex-wrap"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">
                        v{p.version_number} — {p.package_title || "Untitled"}
                      </span>
                      <Badge variant="secondary">
                        {stakeholderPackageStatusLabel(p.package_status)}
                      </Badge>
                      {p.is_current && (
                        <Badge className="bg-primary/10 text-primary border-primary/30">
                          Current
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                      <span>Created: {formatDateTime(p.created_at)}</span>
                      {p.provided_to_stakeholders_at && (
                        <span>
                          Provided:{" "}
                          {formatDateTime(p.provided_to_stakeholders_at)}
                        </span>
                      )}
                      {p.distribution_evidence_url && (
                        <a
                          className="inline-flex items-center text-primary hover:underline"
                          href={p.distribution_evidence_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="h-3 w-3 mr-1" /> Evidence
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {canEdit && !p.is_current && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSetCurrent(p.id)}
                        disabled={setCurrent.isPending}
                      >
                        Make current
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* DC.10 — Word Decision Brief output card */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Word Decision Brief</h3>
            </div>
            {canEdit && (
              <Button
                size="sm"
                onClick={handleGenerateBriefClick}
                disabled={briefBusy || !current}
                title={!current ? "Create a stakeholder package first." : undefined}
              >
                {briefBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Generating…
                  </>
                ) : latestBrief ? (
                  "Regenerate Word brief"
                ) : (
                  "Generate Word brief"
                )}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Generates a Word .docx from the current stakeholder package and
            related Decision Case data, and publishes it to the linked project
            SharePoint folder. The Decision Case in BTPM remains the source of
            truth.
          </p>
          {briefDocsQ.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : latestBrief ? (
            <div className="rounded-md border p-3 text-sm space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">
                  {latestBrief.output_filename}
                </span>
                <Badge variant="secondary">
                  {latestBrief.sharepoint_publish_status === "published"
                    ? "Published"
                    : latestBrief.sharepoint_publish_status === "publish_failed"
                    ? "Publish failed"
                    : "Not published"}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                <span>Generated: {formatDateTime(latestBrief.generated_at)}</span>
                {latestBrief.sharepoint_web_url && (
                  <a
                    className="inline-flex items-center text-primary hover:underline"
                    href={latestBrief.sharepoint_web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Open in SharePoint
                  </a>
                )}
              </div>
              {latestBrief.error_note && (
                <p className="text-xs text-destructive">
                  {latestBrief.error_note}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No Word brief generated yet for this decision case.
            </p>
          )}
          {!current && (
            <p className="text-xs text-muted-foreground">
              Create a stakeholder package before generating the Word brief.
            </p>
          )}
        </CardContent>
      </Card>

      {/* DC.11 — PowerPoint one-pager output card */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Presentation className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">
                PowerPoint Decision One-pager
              </h3>
            </div>
            {canEdit && (
              <Button
                size="sm"
                onClick={handleGenerateOnepagerClick}
                disabled={onepagerBusy || !current}
                title={!current ? "Create a stakeholder package first." : undefined}
              >
                {onepagerBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    Generating…
                  </>
                ) : latestOnepager ? (
                  "Regenerate PPT one-pager"
                ) : (
                  "Generate PPT one-pager"
                )}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Generates a single-slide PowerPoint summary from the current
            stakeholder package and related Decision Case data, and publishes
            it to the linked project SharePoint folder. The Decision Case in
            BTPM remains the source of truth.
          </p>
          {onepagerDocsQ.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : latestOnepager ? (
            <div className="rounded-md border p-3 text-sm space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium truncate">
                  {latestOnepager.output_filename}
                </span>
                <Badge variant="secondary">
                  {latestOnepager.sharepoint_publish_status === "published"
                    ? "Published"
                    : latestOnepager.sharepoint_publish_status === "publish_failed"
                    ? "Publish failed"
                    : "Not published"}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                <span>
                  Generated: {formatDateTime(latestOnepager.generated_at)}
                </span>
                {latestOnepager.sharepoint_web_url && (
                  <a
                    className="inline-flex items-center text-primary hover:underline"
                    href={latestOnepager.sharepoint_web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    Open in SharePoint
                  </a>
                )}
              </div>
              {latestOnepager.error_note && (
                <p className="text-xs text-destructive">
                  {latestOnepager.error_note}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No PowerPoint one-pager generated yet for this decision case.
            </p>
          )}
          {!current && (
            <p className="text-xs text-muted-foreground">
              Create a stakeholder package before generating the one-pager.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Overwrite confirmation for PPT one-pager regeneration */}
      <AlertDialog
        open={onepagerConfirmOpen}
        onOpenChange={setOnepagerConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Regenerate PowerPoint Decision One-pager?
            </AlertDialogTitle>
            <AlertDialogDescription>
              A Decision Brief one-pager already exists for this decision case
              {onepagerConflictExisting?.output_filename
                ? ` (${onepagerConflictExisting.output_filename})`
                : ""}
              . Regenerating will overwrite the existing file in SharePoint
              using the current stakeholder package and Decision Case data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={onepagerBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                runGenerateOnepager(true);
              }}
              disabled={onepagerBusy}
            >
              {onepagerBusy ? "Regenerating…" : "Regenerate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <GeneratedFilePublishIssueDialog
        open={onepagerLockOpen}
        onOpenChange={setOnepagerLockOpen}
        existingFileUrl={onepagerLockUrl}
        onRetry={() => runGenerateOnepager(true)}
        busy={onepagerBusy}
      />

      {/* Overwrite confirmation for Word brief regeneration */}
      <AlertDialog open={briefConfirmOpen} onOpenChange={setBriefConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate Word Decision Brief?</AlertDialogTitle>
            <AlertDialogDescription>
              A Decision Brief already exists for this decision case
              {briefConflictExisting?.output_filename
                ? ` (${briefConflictExisting.output_filename})`
                : ""}
              . Regenerating will overwrite the existing file in SharePoint
              using the current stakeholder package and Decision Case data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={briefBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                runGenerateBrief(true);
              }}
              disabled={briefBusy}
            >
              {briefBusy ? "Regenerating…" : "Regenerate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <GeneratedFilePublishIssueDialog
        open={briefLockOpen}
        onOpenChange={setBriefLockOpen}
        existingFileUrl={briefLockUrl}
        onRetry={() => runGenerateBrief(true)}
        busy={briefBusy}
      />



      <AlertDialog open={providedOpen} onOpenChange={setProvidedOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark package as provided</AlertDialogTitle>
            <AlertDialogDescription>
              Confirms the current package was provided to stakeholders. This
              advances the decision case stage to Provided to Stakeholders
              unless it has already moved to Decision Taken or Closed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="pk-prov-note">Distribution note (optional)</Label>
              <Textarea
                id="pk-prov-note"
                rows={2}
                value={providedNote}
                onChange={(e) => setProvidedNote(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pk-prov-url">
                Distribution evidence URL (optional)
              </Label>
              <Input
                id="pk-prov-url"
                type="url"
                value={providedUrl}
                onChange={(e) => setProvidedUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleMarkProvided();
              }}
              disabled={markProvided.isPending}
            >
              Mark as provided
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
