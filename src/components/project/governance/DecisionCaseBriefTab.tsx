/**
 * AI.8.1a — Structured Decision Brief UX and persistence correction.
 *
 * - All core fields (Executive summary, Options summary, Requested decision,
 *   Recommendation, Conditions, Residual risks, Open questions, Readiness,
 *   Confidence) are visible in the main form.
 * - AI generation populates every field and saves as the new current version
 *   via save_decision_brief_version_v3 (executive_intro_text and
 *   options_summary persisted).
 * - Manual edits save through the same RPC so readiness/confidence/open
 *   questions also persist.
 * - Raw AI output, previous brief versions, and AI run history are kept
 *   behind secondary drawers.
 * - Failed / interrupted generation surfaces as a persistent alert with
 *   "Try again" / "Check status" actions instead of a fleeting toast.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  History,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import {
  briefSourceLabel,
  mapBriefMutationError,
  useGovernanceRecordBriefVersions,
  useSetCurrentGovernanceRecordBriefVersion,
  type GovernanceRecordBriefVersion,
} from "@/hooks/useGovernanceBriefVersions";
import {
  runDecisionCaseAiBriefWithPolling,
  pollDecisionCaseAiBrief,
  mapDecisionCaseAiBriefError,
  saveManualDecisionBriefVersion,
  EMPTY_STRUCTURED_BRIEF,
  type DecisionCaseAiBriefFileResult,
  type DecisionCaseAiBriefStructuredFields,
  type DecisionCaseAiRun,
} from "@/lib/decisionCaseAiBriefService";
import {
  useDecisionCaseAiRuns,
  useSaveAiDecisionBriefVersion,
} from "@/hooks/useDecisionCaseAiRuns";
import {
  getEvidenceHandlingCategory,
  getEvidenceInputHandlingLabel,
  getEvidenceDisplayName,
  isEmailTextResult,
  isImageInputResult,
  formatEvidenceBytes,
} from "@/lib/decisionCaseAiEvidenceLabels";
import {
  extractBriefFieldsFromMarkdown,
  mergeStructuredBriefFieldsWithMarkdownFallback,
} from "@/lib/decisionBriefFieldExtraction";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const CONFIDENCE_OPTIONS: { value: "high" | "medium" | "low"; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
const READINESS_OPTIONS: {
  value: "ready_for_decision" | "needs_clarification" | "not_ready";
  label: string;
}[] = [
  { value: "ready_for_decision", label: "Ready for decision" },
  { value: "needs_clarification", label: "Needs clarification" },
  { value: "not_ready", label: "Not ready" },
];

type Props = {
  recordId: string;
  projectId?: string;
  canEdit: boolean;
  onContinueToStakeholderPackage?: () => void;
};

type FieldState = {
  executive_intro_text: string;
  options_summary: string;
  requested_decision_text: string;
  recommendation_text: string;
  guardrails_text: string;
  residual_risks_text: string;
  open_questions_text: string;
  decision_readiness:
    | "ready_for_decision"
    | "needs_clarification"
    | "not_ready"
    | null;
  confidence_level: "high" | "medium" | "low" | null;
};

const EMPTY_FIELDS: FieldState = {
  executive_intro_text: "",
  options_summary: "",
  requested_decision_text: "",
  recommendation_text: "",
  guardrails_text: "",
  residual_risks_text: "",
  open_questions_text: "",
  decision_readiness: null,
  confidence_level: null,
};

function fieldsFromVersion(v: GovernanceRecordBriefVersion | null): FieldState {
  if (!v) return EMPTY_FIELDS;
  return {
    executive_intro_text: v.executive_intro_text ?? "",
    options_summary: v.options_summary ?? "",
    requested_decision_text: v.requested_decision_text ?? "",
    recommendation_text: v.recommendation_text ?? "",
    guardrails_text: v.guardrails_text ?? "",
    residual_risks_text: v.residual_risks_text ?? "",
    open_questions_text: v.open_questions_text ?? "",
    decision_readiness: v.decision_readiness ?? null,
    confidence_level: v.confidence_level ?? null,
  };
}

function fieldsFromStructured(
  s: DecisionCaseAiBriefStructuredFields,
  base: FieldState,
): FieldState {
  return {
    executive_intro_text: s.executive_intro_text ?? base.executive_intro_text ?? "",
    options_summary: s.options_summary ?? base.options_summary ?? "",
    requested_decision_text:
      s.requested_decision_text ?? base.requested_decision_text ?? "",
    recommendation_text: s.recommendation_text ?? base.recommendation_text ?? "",
    guardrails_text: s.guardrails_text ?? base.guardrails_text ?? "",
    residual_risks_text: s.residual_risks_text ?? base.residual_risks_text ?? "",
    open_questions_text: s.open_questions_text ?? base.open_questions_text ?? "",
    decision_readiness: s.decision_readiness ?? base.decision_readiness ?? null,
    confidence_level: s.confidence_level ?? base.confidence_level ?? null,
  };
}

function formatDateTime(s: string | null | undefined) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

type AiDraftState = {
  rawMarkdown: string;
  aiRunId: string | null;
  structured: DecisionCaseAiBriefStructuredFields;
  parseFailed: boolean;
  meta: {
    model: string;
    template_version: number;
    files_sent_count: number;
    files_skipped_count: number;
    file_results: DecisionCaseAiBriefFileResult[];
    generated_at: string;
  };
};

type AiFailureState = {
  message: string;
  detail?: string;
  aiRunId?: string | null;
  resumable: boolean;
} | null;

export function DecisionCaseBriefTab({
  recordId,
  canEdit,
  onContinueToStakeholderPackage,
}: Props) {
  const qc = useQueryClient();
  const versionsQ = useGovernanceRecordBriefVersions(recordId);
  const setCurrent = useSetCurrentGovernanceRecordBriefVersion(recordId);
  const aiRunsQ = useDecisionCaseAiRuns(recordId);
  const saveAi = useSaveAiDecisionBriefVersion(recordId);

  const versions = versionsQ.data ?? [];
  const current = useMemo(
    () => versions.find((v) => v.is_current) ?? null,
    [versions],
  );

  const [fields, setFields] = useState<FieldState>(EMPTY_FIELDS);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<FieldState>(EMPTY_FIELDS);
  const [lastAi, setLastAi] = useState<AiDraftState | null>(null);
  const [aiFailure, setAiFailure] = useState<AiFailureState>(null);
  const [extractedNotice, setExtractedNotice] = useState(false);

  const [aiGenerating, setAiGenerating] = useState(false);
  const [savingManual, setSavingManual] = useState(false);
  const [confirmRegenOpen, setConfirmRegenOpen] = useState(false);
  const [rawSheetOpen, setRawSheetOpen] = useState(false);
  const [historySheetOpen, setHistorySheetOpen] = useState(false);

  // Hydrate form from current version.
  useEffect(() => {
    const key = current?.id ?? "__empty__";
    if (hydratedFor === key) return;
    let next = fieldsFromVersion(current);
    let derivedAny = false;
    if (current?.edited_brief_text) {
      const derived = extractBriefFieldsFromMarkdown(current.edited_brief_text);
      const merged = { ...next };
      (Object.keys(derived) as (keyof typeof derived)[]).forEach((k) => {
        if (!(merged as any)[k] && derived[k]) {
          (merged as any)[k] = derived[k];
          derivedAny = true;
        }
      });
      next = merged;
    }
    setFields(next);
    setBaseline(fieldsFromVersion(current));
    setHydratedFor(key);
    setExtractedNotice(derivedAny);

    if (current?.source_type === "btpm_generated" && current.edited_brief_text) {
      setLastAi((prev) =>
        prev ?? {
          rawMarkdown: current.edited_brief_text ?? "",
          aiRunId: null,
          structured: {
            executive_intro_text: current.executive_intro_text,
            options_summary: current.options_summary,
            recommendation_text: current.recommendation_text,
            requested_decision_text: current.requested_decision_text,
            guardrails_text: current.guardrails_text,
            residual_risks_text: current.residual_risks_text,
            open_questions_text: current.open_questions_text,
            decision_readiness: current.decision_readiness,
            confidence_level: current.confidence_level,
          },
          parseFailed: false,
          meta: {
            model: "—",
            template_version: 0,
            files_sent_count: 0,
            files_skipped_count: 0,
            file_results: [],
            generated_at: current.created_at,
          },
        },
      );
    }
  }, [current, hydratedFor]);

  // AI.8.1b — do NOT latch a red main-tab warning from old orphaned `started`
  // runs in `decision_case_ai_runs`. Those rows can exist from previous
  // interrupted sessions and would create a false "AI generation status
  // unclear" warning after a brand-new successful generation. Old unfinished
  // attempts remain visible inside the AI run history drawer only.
  //
  // `aiFailure` is now set strictly from:
  //   - the active generation request failing (runAiGeneration catch / !ok),
  //   - explicit Check status polling failing,
  //   - an explicit failed/timeout response for the active run.

  const isDirty = useMemo(
    () => JSON.stringify(fields) !== JSON.stringify(baseline),
    [fields, baseline],
  );

  const hasRequired =
    !!fields.requested_decision_text.trim() &&
    !!fields.recommendation_text.trim();

  function setField<K extends keyof FieldState>(k: K, v: FieldState[K]) {
    setFields((f) => ({ ...f, [k]: v }));
  }

  async function runAiGeneration() {
    setAiGenerating(true);
    setAiFailure(null);
    try {
      const res = await runDecisionCaseAiBriefWithPolling(recordId, {
        onQueued: () => {
          toast.message("AI decision brief queued", {
            description:
              "The model is working on it — this can take a few minutes for large evidence sets.",
          });
        },
      });
      if (res.ok !== true) {
        const msg = mapDecisionCaseAiBriefError(res.error);
        setAiFailure({
          message: msg,
          detail: res.note ?? undefined,
          aiRunId: (res as any).ai_run_id ?? null,
          resumable: !!(res as any).ai_run_id,
        });
        aiRunsQ.refetch();
        return;
      }
      handleCompletedAi(res);
    } catch (e: any) {
      setAiFailure({
        message: "Could not generate the AI decision brief.",
        detail: String(e?.message ?? e),
        resumable: false,
      });
    } finally {
      setAiGenerating(false);
    }
  }

  async function handleCompletedAi(res: {
    draft_markdown: string;
    ai_run_id?: string | null;
    structured_fields?: DecisionCaseAiBriefStructuredFields;
    structured_parse_failed?: boolean;
    model: string;
    template_version: number;
    files_sent_count: number;
    files_skipped_count: number;
    file_results: DecisionCaseAiBriefFileResult[];
    generated_at: string;
  }) {
    const rawStructured = res.structured_fields ?? EMPTY_STRUCTURED_BRIEF;

    // AI.8.1b — always run deterministic markdown fallback, even when JSON
    // parse succeeded, so individual missing fields (e.g. executive_intro_text
    // null while markdown contains "## Executive summary") are filled.
    const merged = mergeStructuredBriefFieldsWithMarkdownFallback(
      rawStructured,
      res.draft_markdown,
    );
    const finalStructured: DecisionCaseAiBriefStructuredFields = {
      executive_intro_text: merged.fields.executive_intro_text,
      options_summary: merged.fields.options_summary,
      requested_decision_text: merged.fields.requested_decision_text,
      recommendation_text: merged.fields.recommendation_text,
      guardrails_text: merged.fields.guardrails_text,
      residual_risks_text: merged.fields.residual_risks_text,
      open_questions_text: merged.fields.open_questions_text,
      confidence_level: merged.fields.confidence_level,
      decision_readiness: merged.fields.decision_readiness,
    };

    const draft: AiDraftState = {
      rawMarkdown: res.draft_markdown,
      aiRunId: res.ai_run_id ?? null,
      structured: finalStructured,
      parseFailed: res.structured_parse_failed === true,
      meta: {
        model: res.model,
        template_version: res.template_version,
        files_sent_count: res.files_sent_count,
        files_skipped_count: res.files_skipped_count,
        file_results: res.file_results,
        generated_at: res.generated_at,
      },
    };
    setLastAi(draft);

    const nextFields: FieldState = {
      executive_intro_text: finalStructured.executive_intro_text ?? "",
      options_summary: finalStructured.options_summary ?? "",
      requested_decision_text: finalStructured.requested_decision_text ?? "",
      recommendation_text: finalStructured.recommendation_text ?? "",
      guardrails_text: finalStructured.guardrails_text ?? "",
      residual_risks_text: finalStructured.residual_risks_text ?? "",
      open_questions_text: finalStructured.open_questions_text ?? "",
      decision_readiness: finalStructured.decision_readiness ?? null,
      confidence_level: finalStructured.confidence_level ?? null,
    };
    setFields(nextFields);
    setExtractedNotice(merged.usedMarkdownFallback);

    if (draft.aiRunId) {
      try {
        // AI.8.1b — persist the FINAL populated fields (including markdown
        // fallback), not the raw structured object from the model.
        const saved = await saveAi.mutateAsync({
          aiRunId: draft.aiRunId,
          editedBriefText: draft.rawMarkdown,
          makeCurrent: true,
          structuredFields: finalStructured,
        });
        toast.success(
          `AI brief generated and saved as current (v${saved?.version_number ?? ""}).`.trim(),
        );
        setBaseline(nextFields);
        // Clear any prior failure / "status unclear" UI now that we have a
        // confirmed saved current version.
        setAiFailure(null);
        versionsQ.refetch();
      } catch (e) {
        toast.warning(
          "AI brief generated but could not auto-save. Click 'Save changes' to keep edits.",
          { description: mapBriefMutationError(e, "Auto-save failed") },
        );
      }
    } else {
      toast.success(
        "AI brief generated. Review the fields and click 'Save changes' to keep them.",
      );
    }
    aiRunsQ.refetch();
  }

  async function handleCheckStatus(aiRunId: string) {
    setAiGenerating(true);
    try {
      const poll = await pollDecisionCaseAiBrief(aiRunId);
      if (poll.ok !== true) {
        setAiFailure({
          message: mapDecisionCaseAiBriefError(poll.error),
          detail: (poll as any).note ?? undefined,
          aiRunId,
          resumable: false,
        });
        aiRunsQ.refetch();
        return;
      }
      if (poll.status === "in_progress") {
        toast.info("AI generation still in progress.", {
          description: "Try again in a few moments.",
        });
        return;
      }
      setAiFailure(null);
      await handleCompletedAi(poll);
    } catch (e: any) {
      setAiFailure({
        message: "Could not check AI generation status.",
        detail: String(e?.message ?? e),
        aiRunId,
        resumable: true,
      });
    } finally {
      setAiGenerating(false);
    }
  }

  function handleGenerateClick() {
    if (current) setConfirmRegenOpen(true);
    else void runAiGeneration();
  }

  async function handleSaveChanges() {
    if (!canEdit || !isDirty) return;
    setSavingManual(true);
    try {
      const res = await saveManualDecisionBriefVersion({
        recordId,
        editedBriefText: lastAi?.rawMarkdown ?? current?.edited_brief_text ?? null,
        makeCurrent: true,
        fields: {
          executive_intro_text: fields.executive_intro_text || null,
          options_summary: fields.options_summary || null,
          requested_decision_text: fields.requested_decision_text || null,
          recommendation_text: fields.recommendation_text || null,
          guardrails_text: fields.guardrails_text || null,
          residual_risks_text: fields.residual_risks_text || null,
          open_questions_text: fields.open_questions_text || null,
          confidence_level: fields.confidence_level,
          decision_readiness: fields.decision_readiness,
        },
      });
      toast.success(
        `Saved changes as current brief (v${res?.version_number ?? ""}).`.trim(),
      );
      setBaseline(fields);
      setExtractedNotice(false);
      setHydratedFor(null);
      qc.invalidateQueries({ queryKey: ["governance-record-brief-versions", recordId] });
    } catch (e) {
      toast.error(mapBriefMutationError(e, "Could not save brief changes"));
    } finally {
      setSavingManual(false);
    }
  }

  async function handleUseVersion(v: GovernanceRecordBriefVersion) {
    if (!canEdit) return;
    try {
      await setCurrent.mutateAsync(v.id);
      toast.success(`Version v${v.version_number} set as current.`);
      setHydratedFor(null);
      setLastAi(null);
    } catch (e) {
      toast.error(mapBriefMutationError(e, "Could not change current version"));
    }
  }

  function handleContinue() {
    if (!hasRequired) {
      toast.error(
        "Complete Requested decision and Recommendation before preparing the Stakeholder Package.",
      );
      return;
    }
    onContinueToStakeholderPackage?.();
  }

  const aiRuns = aiRunsQ.data ?? [];

  // Per-field "AI did not return this field" hint — only after an AI run, only when empty.
  function emptyAiHint(fieldKey: keyof DecisionCaseAiBriefStructuredFields, value: string) {
    if (!lastAi) return null;
    if (value.trim().length > 0) return null;
    if (lastAi.structured[fieldKey] != null && lastAi.structured[fieldKey] !== "") return null;
    return (
      <p className="text-[11px] text-muted-foreground italic">
        AI did not return this field. You can complete it manually.
      </p>
    );
  }

  const statusLabel = !current
    ? "No brief yet"
    : isDirty
      ? "Unsaved changes"
      : hasRequired
        ? `Ready for Stakeholder Package · Current v${current.version_number}`
        : `Current v${current.version_number}`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Decision Brief</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Generate a structured decision brief from the selected evidence
                and BTPM context, review and edit the fields, then continue to
                the Stakeholder Package.
              </p>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <Badge variant={current ? "default" : "outline"}>{statusLabel}</Badge>
                {current && (
                  <Badge variant="secondary" className="text-xs">
                    {sourceUserLabel(current.source_type)}
                  </Badge>
                )}
                {aiGenerating && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    AI generation in progress…
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={handleGenerateClick}
                disabled={!canEdit || aiGenerating}
              >
                {aiGenerating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                {current ? "Regenerate with AI" : "Generate with AI"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveChanges}
                disabled={!canEdit || !isDirty || savingManual}
              >
                {savingManual && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save changes
              </Button>
              <Button
                type="button"
                variant="default"
                onClick={handleContinue}
                disabled={!current || !hasRequired}
              >
                Continue to Stakeholder Package
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
          {!hasRequired && current && (
            <p className="text-xs text-muted-foreground">
              Complete <span className="font-medium">Requested decision</span> and
              <span className="font-medium"> Recommendation</span> before preparing the Stakeholder Package.
            </p>
          )}
          {!canEdit && (
            <p className="text-xs text-muted-foreground">
              You have view-only access on this project.
            </p>
          )}
          {extractedNotice && (
            <Alert>
              <AlertDescription className="text-xs">
                Some fields were suggested from the draft text. Review and save to keep them.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Persistent AI generation failure / resume card */}
      {aiFailure && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {aiFailure.resumable
              ? "AI generation status unclear"
              : "AI generation did not complete"}
          </AlertTitle>
          <AlertDescription className="space-y-2">
            <div>{aiFailure.message}</div>
            {aiFailure.detail && (
              <div className="text-xs opacity-90">{aiFailure.detail}</div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runAiGeneration()}
                disabled={aiGenerating}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Try again
              </Button>
              {aiFailure.aiRunId && aiFailure.resumable && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCheckStatus(aiFailure.aiRunId!)}
                  disabled={aiGenerating}
                >
                  Check status
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setHistorySheetOpen(true)}
              >
                View AI run history
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAiFailure(null)}
              >
                Dismiss
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Structured fields form (primary UI) */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          {versionsQ.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-1.5 md:col-span-2">
                <Label htmlFor="f-intro">Executive summary</Label>
                <Textarea
                  id="f-intro"
                  rows={4}
                  value={fields.executive_intro_text}
                  onChange={(e) => setField("executive_intro_text", e.target.value)}
                  disabled={!canEdit}
                  placeholder="High-level summary of the situation and what's being asked."
                />
                {emptyAiHint("executive_intro_text", fields.executive_intro_text)}
              </div>
              <div className="grid gap-1.5 md:col-span-2">
                <Label htmlFor="f-opts">Options summary</Label>
                <Textarea
                  id="f-opts"
                  rows={4}
                  value={fields.options_summary}
                  onChange={(e) => setField("options_summary", e.target.value)}
                  disabled={!canEdit}
                  placeholder="Concise comparison of the options considered."
                />
                {emptyAiHint("options_summary", fields.options_summary)}
              </div>
              <div className="grid gap-1.5 md:col-span-2">
                <Label htmlFor="f-req">
                  Requested decision <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="f-req"
                  rows={3}
                  value={fields.requested_decision_text}
                  onChange={(e) => setField("requested_decision_text", e.target.value)}
                  disabled={!canEdit}
                  placeholder="What decision is being requested?"
                />
                {emptyAiHint("requested_decision_text", fields.requested_decision_text)}
              </div>
              <div className="grid gap-1.5 md:col-span-2">
                <Label htmlFor="f-rec">
                  Recommendation <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="f-rec"
                  rows={3}
                  value={fields.recommendation_text}
                  onChange={(e) => setField("recommendation_text", e.target.value)}
                  disabled={!canEdit}
                  placeholder="What does BTPM recommend?"
                />
                {emptyAiHint("recommendation_text", fields.recommendation_text)}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="f-guard">Conditions / guardrails</Label>
                <Textarea
                  id="f-guard"
                  rows={4}
                  value={fields.guardrails_text}
                  onChange={(e) => setField("guardrails_text", e.target.value)}
                  disabled={!canEdit}
                />
                {emptyAiHint("guardrails_text", fields.guardrails_text)}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="f-risks">Residual risks</Label>
                <Textarea
                  id="f-risks"
                  rows={4}
                  value={fields.residual_risks_text}
                  onChange={(e) => setField("residual_risks_text", e.target.value)}
                  disabled={!canEdit}
                />
                {emptyAiHint("residual_risks_text", fields.residual_risks_text)}
              </div>
              <div className="grid gap-1.5 md:col-span-2">
                <Label htmlFor="f-open">Open questions / missing information</Label>
                <Textarea
                  id="f-open"
                  rows={3}
                  value={fields.open_questions_text}
                  onChange={(e) => setField("open_questions_text", e.target.value)}
                  disabled={!canEdit}
                />
                {emptyAiHint("open_questions_text", fields.open_questions_text)}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="f-ready">Decision readiness</Label>
                <Select
                  value={fields.decision_readiness ?? "__none__"}
                  onValueChange={(v) =>
                    setField(
                      "decision_readiness",
                      v === "__none__" ? null : (v as FieldState["decision_readiness"]),
                    )
                  }
                  disabled={!canEdit}
                >
                  <SelectTrigger id="f-ready">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not set</SelectItem>
                    {READINESS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="f-conf">Confidence</Label>
                <Select
                  value={fields.confidence_level ?? "__none__"}
                  onValueChange={(v) =>
                    setField(
                      "confidence_level",
                      v === "__none__" ? null : (v as FieldState["confidence_level"]),
                    )
                  }
                  disabled={!canEdit}
                >
                  <SelectTrigger id="f-conf">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not set</SelectItem>
                    {CONFIDENCE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Secondary actions */}
      <div className="flex flex-wrap gap-2 justify-end text-sm">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setRawSheetOpen(true)}
          disabled={!lastAi && !current?.edited_brief_text}
        >
          View raw AI output
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setHistorySheetOpen(true)}
        >
          <History className="h-3.5 w-3.5 mr-1.5" />
          View previous briefs &amp; AI run history
        </Button>
      </div>

      {/* Regenerate confirmation */}
      <AlertDialog open={confirmRegenOpen} onOpenChange={setConfirmRegenOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate a new Decision Brief?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a new current version. The existing current
              brief will remain in history and can be restored from
              "View previous briefs".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRegenOpen(false);
                void runAiGeneration();
              }}
            >
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Raw AI output */}
      <Sheet open={rawSheetOpen} onOpenChange={setRawSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Raw AI output</SheetTitle>
            <SheetDescription>
              Full Markdown returned by the model. The structured fields are
              the source of truth for the Stakeholder Package handoff.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {lastAi ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">
                    {lastAi.meta.model} · template v{lastAi.meta.template_version}
                  </Badge>
                  <span>Generated {formatDateTime(lastAi.meta.generated_at)}</span>
                </div>
                <Textarea
                  readOnly
                  rows={20}
                  value={lastAi.rawMarkdown}
                  className="font-mono text-xs"
                />
                <EvidenceProcessingSummary
                  files={lastAi.meta.file_results}
                  sentCount={lastAi.meta.files_sent_count}
                  skippedCount={lastAi.meta.files_skipped_count}
                />
              </>
            ) : current?.edited_brief_text ? (
              <Textarea
                readOnly
                rows={20}
                value={current.edited_brief_text}
                className="font-mono text-xs"
              />
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No AI output available for this brief yet.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Previous briefs + AI history */}
      <Sheet open={historySheetOpen} onOpenChange={setHistorySheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Previous briefs &amp; AI run history</SheetTitle>
            <SheetDescription>
              Brief versions are the drafts used in the workflow. AI run history
              records generation attempts for audit.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Previous briefs</h4>
              {versions.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No brief versions yet.
                </p>
              ) : (
                <div className="divide-y rounded-md border">
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <Badge variant={v.is_current ? "default" : "outline"}>
                          v{v.version_number}
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                          {sourceUserLabel(v.source_type)}
                        </span>
                        <span className="text-muted-foreground text-xs">·</span>
                        <span className="text-muted-foreground text-xs">
                          {formatDateTime(v.created_at)}
                        </span>
                        {v.is_current && (
                          <Badge variant="secondary" className="text-[10px]">
                            Current
                          </Badge>
                        )}
                      </div>
                      {canEdit && !v.is_current && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleUseVersion(v)}
                          disabled={setCurrent.isPending}
                        >
                          Use this version
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-semibold">AI run history</h4>
              {aiRunsQ.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : aiRuns.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No AI generation runs yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {aiRuns.map((r) => (
                    <AiRunRow key={r.id} run={r} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Internal source_type → user-facing label. */
function sourceUserLabel(source: string | null | undefined): string {
  switch (source) {
    case "btpm_generated":
      return "AI generated";
    case "manual_edit":
      return "Manual edit";
    case "copilot_paste":
      return "Pasted external draft";
    default:
      return briefSourceLabel(String(source ?? ""));
  }
}

function EvidenceProcessingSummary({
  files,
  sentCount,
  skippedCount,
}: {
  files: DecisionCaseAiBriefFileResult[];
  sentCount: number;
  skippedCount: number;
}) {
  const total = files.length;
  const imageCount = files.filter((f) => f.status === "sent" && isImageInputResult(f)).length;
  const emailCount = files.filter((f) => f.status === "sent" && isEmailTextResult(f)).length;
  const fileInputCount = files.filter(
    (f) => f.status === "sent" && !isImageInputResult(f) && !isEmailTextResult(f),
  ).length;

  return (
    <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-medium text-foreground">Evidence processing summary</div>
        <div className="text-muted-foreground">
          {total} included · {sentCount} sent
          {skippedCount > 0 ? ` · ${skippedCount} skipped` : ""}
        </div>
      </div>
      {sentCount > 0 && (
        <div className="text-muted-foreground">
          {fileInputCount > 0 && <span>{fileInputCount} file input{fileInputCount === 1 ? "" : "s"}</span>}
          {fileInputCount > 0 && (imageCount > 0 || emailCount > 0) && " · "}
          {imageCount > 0 && <span>{imageCount} image input{imageCount === 1 ? "" : "s"}</span>}
          {imageCount > 0 && emailCount > 0 && " · "}
          {emailCount > 0 && <span>{emailCount} email text input{emailCount === 1 ? "" : "s"}</span>}
        </div>
      )}
      {total > 0 && (
        <div className="rounded-md border bg-background divide-y">
          {files.map((r) => {
            const category = getEvidenceHandlingCategory(r);
            return (
              <div
                key={r.evidence_file_id}
                className="flex items-center justify-between gap-2 px-2 py-1"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono" title={getEvidenceDisplayName(r)}>
                    {getEvidenceDisplayName(r)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {(r.file_extension ?? r.mime_type ?? "—")}
                    {r.bytes_sent != null ? ` · ${formatEvidenceBytes(r.bytes_sent)}` : ""}
                    {r.status !== "sent" && r.detail ? ` · ${r.detail}` : ""}
                  </div>
                </div>
                <Badge
                  variant={category === "skipped" ? "outline" : "secondary"}
                  className="text-[10px] shrink-0"
                >
                  {getEvidenceInputHandlingLabel(r)}
                </Badge>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AiRunRow({ run: r }: { run: DecisionCaseAiRun }) {
  const statusBadge: Record<
    DecisionCaseAiRun["status"],
    { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
  > = {
    started: { label: "Started", variant: "outline" },
    completed: { label: "Completed", variant: "secondary" },
    saved: { label: "Saved as version", variant: "default" },
    discarded: { label: "Discarded", variant: "outline" },
    failed: { label: "Failed", variant: "destructive" },
  };
  const s = statusBadge[r.status] ?? { label: r.status, variant: "outline" as const };
  return (
    <div className="border rounded p-3 text-xs flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={s.variant}>{s.label}</Badge>
        <span className="font-medium">{r.model_id}</span>
        {r.template_version != null && (
          <span className="text-muted-foreground">· template v{r.template_version}</span>
        )}
      </div>
      <div className="text-muted-foreground">
        Generated by {r.started_by_display ?? "user"} on {formatDateTime(r.started_at)}
      </div>
      <div className="text-muted-foreground">
        Files: {r.files_sent_count} sent
        {r.files_skipped_count > 0 ? ` · ${r.files_skipped_count} skipped` : ""} ·{" "}
        {(r.total_bytes_sent / 1024).toFixed(1)} KB
      </div>
      {r.status === "failed" && r.error_code && (
        <div className="text-destructive">Error: {r.error_code}</div>
      )}
    </div>
  );
}

// suppress unused-import warning for supabase (kept available for future direct use)
void supabase;
