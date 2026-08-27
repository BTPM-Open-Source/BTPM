/**
 * DC.8 / AI.8.3 — Decision Taken & Closure tab.
 *
 * Auto-prepares an editable Decision Outcome draft from the current/provided
 * Stakeholder Package (priority 1: provided, 2: ready/draft current,
 * 3: Current Decision Brief fallback, 4: blank manual). User must explicitly
 * choose decision result, save the outcome, and (separately) close the case.
 *
 * No automatic save, no automatic decision-result inference, no automatic
 * closure. Writes go through protected RPCs only.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Lock, AlertTriangle, Info, RefreshCw, X, ChevronsUpDown, Check, Plus } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import {
  GOVERNANCE_DECISION_RESULTS,
  GOVERNANCE_SIGNOFF_STATUSES,
  mapDecisionOutcomeError,
  useCloseGovernanceDecisionCase,
  useGovernanceRecordDecisionOutcome,
  useUpsertGovernanceRecordDecisionOutcome,
  type GovernanceDecisionResult,
  type GovernanceRecordDecisionOutcome,
  type GovernanceSignoffStatus,
} from "@/hooks/useGovernanceDecisionOutcome";
import { useGovernanceRecordBriefVersions } from "@/hooks/useGovernanceBriefVersions";
import {
  useGovernanceRecordStakeholderPackages,
  type GovernanceRecordStakeholderPackage,
} from "@/hooks/useGovernanceStakeholderPackages";
import { useProjectStakeholders } from "@/hooks/useProjectStakeholders";

type Props = {
  recordId: string;
  projectId: string;
  canEdit: boolean;
};

type FormState = {
  decision_result: GovernanceDecisionResult | "";
  final_decision_text: string;
  decision_date: string;
  decided_by_text: string;
  approval_forum: string;
  decision_rationale: string;
  conditions_guardrails: string;
  residual_risks: string;
  follow_up_actions: string;
  implementation_owner_stakeholder_id: string; // "" or "__none__" => null
  implementation_target_date: string;
  signoff_status: GovernanceSignoffStatus;
  signoff_evidence_url: string;
};

type SourceKind = "package" | "brief" | "none";
type SourceInfo = {
  kind: SourceKind;
  pkg?: GovernanceRecordStakeholderPackage | null;
  brief?: ReturnType<typeof useGovernanceRecordBriefVersions>["data"] extends
    | readonly (infer T)[]
    | undefined
    ? T | null
    : any;
  status?: string;
  versionNumber?: number;
  updatedAt?: string | null;
};

const NO_OWNER = "__none__";

const EMPTY: FormState = {
  decision_result: "",
  final_decision_text: "",
  decision_date: "",
  decided_by_text: "",
  approval_forum: "",
  decision_rationale: "",
  conditions_guardrails: "",
  residual_risks: "",
  follow_up_actions: "",
  implementation_owner_stakeholder_id: NO_OWNER,
  implementation_target_date: "",
  signoff_status: "draft",
  signoff_evidence_url: "",
};

function fromOutcome(o: GovernanceRecordDecisionOutcome | null): FormState {
  if (!o) return EMPTY;
  return {
    decision_result: (o.decision_result as GovernanceDecisionResult) ?? "",
    final_decision_text: o.final_decision_text ?? "",
    decision_date: o.decision_date ?? "",
    decided_by_text: o.decided_by_text ?? "",
    approval_forum: o.approval_forum ?? "",
    decision_rationale: o.decision_rationale ?? "",
    conditions_guardrails: o.conditions_guardrails ?? "",
    residual_risks: o.residual_risks ?? "",
    follow_up_actions: o.follow_up_actions ?? "",
    implementation_owner_stakeholder_id:
      o.implementation_owner_stakeholder_id ?? NO_OWNER,
    implementation_target_date: o.implementation_target_date ?? "",
    signoff_status: (o.signoff_status as GovernanceSignoffStatus) ?? "draft",
    signoff_evidence_url: o.signoff_evidence_url ?? "",
  };
}

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function isValidUrl(u: string): boolean {
  return /^https?:\/\//i.test(u.trim());
}

function fromPackage(pkg: GovernanceRecordStakeholderPackage): FormState {
  const url = (pkg.distribution_evidence_url ?? "").trim();
  return {
    ...EMPTY,
    final_decision_text: pkg.decision_ask_text ?? "",
    decision_date: todayIso(),
    decision_rationale: pkg.recommendation_text ?? "",
    conditions_guardrails: pkg.guardrails_text ?? "",
    residual_risks: pkg.residual_risks_text ?? "",
    follow_up_actions: pkg.next_steps_text ?? "",
    signoff_evidence_url: isValidUrl(url) ? url : "",
  };
}

/** Split saved `decided_by_text` into discrete tokens. */
function parseDecidedBy(raw: string): string[] {
  return raw
    .split(/\s*,\s*/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinDecidedBy(tokens: string[]): string {
  // De-dup preserving order, case-insensitive.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.join(", ");
}

function stakeholderLabel(s: {
  display_name: string;
  role_label: string | null;
}): string {
  return s.role_label ? `${s.display_name} (${s.role_label})` : s.display_name;
}

type DecidedByMultiSelectProps = {
  value: string;
  onChange: (next: string) => void;
  stakeholders: Array<{
    id: string;
    display_name: string;
    role_label: string | null;
    removed_at: string | null;
  }>;
  disabled?: boolean;
};

function DecidedByMultiSelect({
  value,
  onChange,
  stakeholders,
  disabled,
}: DecidedByMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const tokens = useMemo(() => parseDecidedBy(value), [value]);
  const tokenSet = useMemo(
    () => new Set(tokens.map((t) => t.toLowerCase())),
    [tokens],
  );

  const active = stakeholders.filter((s) => !s.removed_at);

  function toggle(label: string) {
    if (tokenSet.has(label.toLowerCase())) {
      onChange(
        joinDecidedBy(tokens.filter((t) => t.toLowerCase() !== label.toLowerCase())),
      );
    } else {
      onChange(joinDecidedBy([...tokens, label]));
    }
  }

  function removeToken(label: string) {
    onChange(
      joinDecidedBy(tokens.filter((t) => t.toLowerCase() !== label.toLowerCase())),
    );
  }

  function addCustom() {
    const v = custom.trim();
    if (!v) return;
    onChange(joinDecidedBy([...tokens, v]));
    setCustom("");
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5 min-h-[2.25rem] rounded-md border border-input bg-background p-1.5">
        {tokens.length === 0 && (
          <span className="text-sm text-muted-foreground px-1.5 py-0.5">
            No decision makers selected
          </span>
        )}
        {tokens.map((t) => (
          <Badge key={t} variant="secondary" className="gap-1 pr-1">
            <span>{t}</span>
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${t}`}
                onClick={() => removeToken(t)}
                className="rounded-sm hover:bg-muted-foreground/20"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              className="justify-between gap-2"
            >
              Select from stakeholders
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[320px]" align="start">
            <Command>
              <CommandInput placeholder="Search stakeholders..." />
              <CommandList>
                <CommandEmpty>
                  {active.length === 0
                    ? "No stakeholders on this project yet."
                    : "No matches."}
                </CommandEmpty>
                <CommandGroup>
                  {active.map((s) => {
                    const label = stakeholderLabel(s);
                    const checked = tokenSet.has(label.toLowerCase());
                    return (
                      <CommandItem
                        key={s.id}
                        value={label}
                        onSelect={() => toggle(label)}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            checked ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {label}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <div className="flex gap-1 flex-1 min-w-[200px]">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            disabled={disabled}
            placeholder="Add other person or role"
            className="h-9"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addCustom}
            disabled={disabled || !custom.trim()}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function fromBrief(b: any): FormState {
  return {
    ...EMPTY,
    final_decision_text: b?.requested_decision_text ?? "",
    decision_date: todayIso(),
    decision_rationale: b?.recommendation_text ?? "",
    conditions_guardrails: b?.guardrails_text ?? "",
    residual_risks: b?.residual_risks_text ?? "",
    follow_up_actions: b?.open_questions_text ?? "",
  };
}

export function DecisionCaseClosureTab({ recordId, projectId, canEdit }: Props) {
  const outcomeQ = useGovernanceRecordDecisionOutcome(recordId);
  const briefQ = useGovernanceRecordBriefVersions(recordId);
  const packagesQ = useGovernanceRecordStakeholderPackages(recordId);
  const { data: stakeholders = [] } = useProjectStakeholders(projectId);
  const upsert = useUpsertGovernanceRecordDecisionOutcome(recordId);
  const close = useCloseGovernanceDecisionCase(recordId);

  const outcome = outcomeQ.data ?? null;
  const currentBrief = useMemo(
    () => (briefQ.data ?? []).find((v) => v.is_current) ?? null,
    [briefQ.data],
  );
  const currentPackage = useMemo(
    () => (packagesQ.data ?? []).find((p) => p.is_current) ?? null,
    [packagesQ.data],
  );

  const source: SourceInfo = useMemo(() => {
    if (currentPackage) {
      return {
        kind: "package",
        pkg: currentPackage,
        status: currentPackage.package_status,
        versionNumber: currentPackage.version_number,
        updatedAt: currentPackage.updated_at,
      };
    }
    if (currentBrief) {
      return {
        kind: "brief",
        brief: currentBrief,
        status: "current_brief",
        versionNumber: currentBrief.version_number,
        updatedAt: (currentBrief as any).updated_at ?? null,
      };
    }
    return { kind: "none" };
  }, [currentPackage, currentBrief]);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [hydrationKey, setHydrationKey] = useState<string | null>(null);
  const [closureNote, setClosureNote] = useState("");
  const [autoPrepared, setAutoPrepared] = useState(false);

  const loadingSources =
    outcomeQ.isLoading || briefQ.isLoading || packagesQ.isLoading;

  // Hydration: if outcome exists -> load it; else if source available -> auto-prepare
  useEffect(() => {
    if (loadingSources) return;
    let nextKey: string;
    if (outcome) {
      nextKey = `outcome:${outcome.id}:${outcome.updated_at}`;
    } else if (source.kind === "package" && source.pkg) {
      nextKey = `pkg:${source.pkg.id}:${source.pkg.updated_at}`;
    } else if (source.kind === "brief" && source.brief) {
      nextKey = `brief:${source.brief.id}:${(source.brief as any).updated_at ?? ""}`;
    } else {
      nextKey = "empty";
    }
    if (hydrationKey === nextKey) return;

    if (outcome) {
      setForm(fromOutcome(outcome));
      setAutoPrepared(false);
    } else if (source.kind === "package" && source.pkg) {
      setForm(fromPackage(source.pkg));
      setAutoPrepared(true);
    } else if (source.kind === "brief" && source.brief) {
      setForm(fromBrief(source.brief));
      setAutoPrepared(true);
    } else {
      setForm(EMPTY);
      setAutoPrepared(false);
    }
    setHydrationKey(nextKey);
  }, [outcome, source, hydrationKey, loadingSources]);

  function f<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  const closed = !!outcome?.closed_at;
  const disabled = !canEdit || upsert.isPending || closed;

  // Source freshness: source.updatedAt > outcome.updated_at
  const sourceNewer = useMemo(() => {
    if (!outcome || !source.updatedAt) return false;
    return new Date(source.updatedAt).getTime() > new Date(outcome.updated_at).getTime();
  }, [outcome, source.updatedAt]);

  function doRefresh() {
    if (source.kind === "package" && source.pkg) {
      setForm(fromPackage(source.pkg));
      setAutoPrepared(true);
      toast.success(`Draft refreshed from Stakeholder Package v${source.versionNumber}`);
    } else if (source.kind === "brief" && source.brief) {
      setForm(fromBrief(source.brief));
      setAutoPrepared(true);
      toast.success(`Draft refreshed from Current Decision Brief v${source.versionNumber}`);
    } else {
      toast.error("No source available to refresh from.");
    }
  }

  async function handleSave() {
    if (!canEdit) return;
    if (!form.decision_result) {
      toast.error("Decision result is required — select one explicitly.");
      return;
    }
    if (!form.final_decision_text.trim()) {
      toast.error("Final decision text is required.");
      return;
    }
    if (!form.decision_date) {
      toast.error("Decision date is required.");
      return;
    }
    if (form.signoff_evidence_url.trim() && !isValidUrl(form.signoff_evidence_url)) {
      toast.error("Sign-off evidence URL must start with http:// or https://");
      return;
    }
    try {
      await upsert.mutateAsync({
        decision_result: form.decision_result as GovernanceDecisionResult,
        final_decision_text: form.final_decision_text.trim(),
        decision_date: form.decision_date,
        decided_by_text: form.decided_by_text.trim() || null,
        approval_forum: form.approval_forum.trim() || null,
        decision_rationale: form.decision_rationale.trim() || null,
        conditions_guardrails: form.conditions_guardrails.trim() || null,
        residual_risks: form.residual_risks.trim() || null,
        follow_up_actions: form.follow_up_actions.trim() || null,
        implementation_owner_stakeholder_id:
          form.implementation_owner_stakeholder_id === NO_OWNER
            ? null
            : form.implementation_owner_stakeholder_id,
        implementation_target_date: form.implementation_target_date || null,
        signoff_status: form.signoff_status,
        signoff_evidence_url: form.signoff_evidence_url.trim() || null,
      });
      toast.success("Decision outcome saved");
      setAutoPrepared(false);
      setHydrationKey(null);
    } catch (e) {
      toast.error(mapDecisionOutcomeError(e, "Could not save decision outcome"));
    }
  }

  async function handleClose() {
    if (!canEdit) return;
    try {
      await close.mutateAsync(closureNote.trim() || null);
      toast.success("Decision case closed");
      setClosureNote("");
      setHydrationKey(null);
    } catch (e) {
      toast.error(mapDecisionOutcomeError(e, "Could not close decision case"));
    }
  }

  if (outcomeQ.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Status badge for header
  const headerBadge = (() => {
    if (closed) {
      return <Badge variant="secondary" className="flex items-center gap-1"><Lock className="h-3 w-3" /> Closed</Badge>;
    }
    if (outcome) {
      return <Badge variant="secondary">Outcome saved</Badge>;
    }
    if (autoPrepared && source.kind === "package") {
      return <Badge variant="outline">Draft prepared from Stakeholder Package v{source.versionNumber}</Badge>;
    }
    if (autoPrepared && source.kind === "brief") {
      return <Badge variant="outline">Draft prepared from Current Decision Brief v{source.versionNumber}</Badge>;
    }
    return <Badge variant="outline">Manual draft</Badge>;
  })();

  const pkgUnprovidedWarning =
    source.kind === "package" && source.status !== "provided";
  const briefFallbackWarning = source.kind === "brief";
  const noSourceNotice = source.kind === "none" && !outcome;

  return (
    <div className="space-y-4">
      {/* Header card */}
      <Card>
        <CardContent className="pt-6 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">Decision Taken & Closure</h2>
            {headerBadge}
          </div>
          <p className="text-sm text-muted-foreground">
            Record the formal decision outcome. This becomes the governance source of truth.
          </p>

          {pkgUnprovidedWarning && (
            <div className="flex gap-2 rounded-md border border-amber-300/40 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Stakeholder Package has not been marked as provided yet. You can
                still record the decision if it has already been taken, but the
                normal flow is to provide the package first.
              </span>
            </div>
          )}
          {briefFallbackWarning && (
            <div className="flex gap-2 rounded-md border border-amber-300/40 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                No Stakeholder Package exists. Prepare the Stakeholder Package
                first unless this decision was taken outside the package flow.
              </span>
            </div>
          )}
          {noSourceNotice && (
            <div className="flex gap-2 rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                No prepared source is available. Record the decision outcome
                manually or return to the Stakeholder Package.
              </span>
            </div>
          )}
          {outcome && sourceNewer && (
            <div className="flex gap-2 rounded-md border border-amber-300/40 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                The source {source.kind === "package" ? "package" : "brief"} is
                newer than this decision outcome. Refresh only if you want to
                replace the working draft from the latest source.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Source summary card */}
      {source.kind !== "none" && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold">Source</h3>
              {source.kind === "package" ? (
                <>
                  <Badge variant="outline">
                    Stakeholder Package v{source.versionNumber}
                  </Badge>
                  <Badge variant={source.status === "provided" ? "default" : "secondary"}>
                    {source.status === "provided"
                      ? "Provided"
                      : source.status === "ready"
                        ? "Ready"
                        : "Draft"}
                  </Badge>
                </>
              ) : (
                <>
                  <Badge variant="outline">
                    Current Decision Brief v{source.versionNumber}
                  </Badge>
                  <Badge variant="secondary">Current Brief</Badge>
                </>
              )}
              {canEdit && !closed && (
                <div className="ml-auto">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="outline" size="sm">
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Refresh from source
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Refresh draft from source?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Refresh this decision outcome draft from the latest
                          source? Unsaved edits will be replaced. This does not
                          change any saved outcome until you click Save.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={doRefresh}>
                          Refresh
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Requested decision
                </div>
                <div className="whitespace-pre-wrap text-foreground/90">
                  {(source.kind === "package"
                    ? source.pkg?.decision_ask_text
                    : source.brief?.requested_decision_text)?.trim() || "—"}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Recommendation
                </div>
                <div className="whitespace-pre-wrap text-foreground/90">
                  {(source.kind === "package"
                    ? source.pkg?.recommendation_text
                    : source.brief?.recommendation_text)?.trim() || "—"}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Guardrails
                </div>
                <div className="whitespace-pre-wrap text-foreground/90">
                  {(source.kind === "package"
                    ? source.pkg?.guardrails_text
                    : source.brief?.guardrails_text)?.trim() || "—"}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Residual risks
                </div>
                <div className="whitespace-pre-wrap text-foreground/90">
                  {(source.kind === "package"
                    ? source.pkg?.residual_risks_text
                    : source.brief?.residual_risks_text)?.trim() || "—"}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Decision outcome form */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold">Decision outcome</h3>
            {closed && (
              <Badge variant="secondary" className="flex items-center gap-1">
                <Lock className="h-3 w-3" /> Closed
              </Badge>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="dc-result">Decision result *</Label>
              <Select
                value={form.decision_result || undefined}
                onValueChange={(v) =>
                  f("decision_result", v as GovernanceDecisionResult)
                }
                disabled={disabled}
              >
                <SelectTrigger id="dc-result">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {GOVERNANCE_DECISION_RESULTS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dc-date">Decision date *</Label>
              <Input
                id="dc-date"
                type="date"
                value={form.decision_date}
                onChange={(e) => f("decision_date", e.target.value)}
                disabled={disabled}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="dc-final">Final decision text *</Label>
            <Textarea
              id="dc-final"
              rows={4}
              value={form.final_decision_text}
              onChange={(e) => f("final_decision_text", e.target.value)}
              disabled={disabled}
              placeholder="State the formal decision exactly as taken."
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="dc-by">Decided by</Label>
              <DecidedByMultiSelect
                value={form.decided_by_text}
                onChange={(v) => f("decided_by_text", v)}
                stakeholders={stakeholders as any}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                Pick one or more decision makers from project stakeholders. Add
                others as free text if needed.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dc-forum">Approval forum</Label>
              <Input
                id="dc-forum"
                value={form.approval_forum}
                onChange={(e) => f("approval_forum", e.target.value)}
                disabled={disabled}
                placeholder="Steering Committee, etc."
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="dc-rat">Decision rationale</Label>
              <Textarea
                id="dc-rat"
                rows={3}
                value={form.decision_rationale}
                onChange={(e) => f("decision_rationale", e.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dc-cond">Conditions / guardrails</Label>
              <Textarea
                id="dc-cond"
                rows={3}
                value={form.conditions_guardrails}
                onChange={(e) => f("conditions_guardrails", e.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dc-risks">Residual risks</Label>
              <Textarea
                id="dc-risks"
                rows={3}
                value={form.residual_risks}
                onChange={(e) => f("residual_risks", e.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="dc-follow">Follow-up actions</Label>
              <Textarea
                id="dc-follow"
                rows={3}
                value={form.follow_up_actions}
                onChange={(e) => f("follow_up_actions", e.target.value)}
                disabled={disabled}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dc-owner">Implementation owner</Label>
              <Select
                value={form.implementation_owner_stakeholder_id || NO_OWNER}
                onValueChange={(v) =>
                  f("implementation_owner_stakeholder_id", v)
                }
                disabled={disabled}
              >
                <SelectTrigger id="dc-owner">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OWNER}>Unassigned</SelectItem>
                  {stakeholders.map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.display_name ?? s.external_name ?? s.name ?? s.full_name ?? s.email ?? s.id}
                      {s.role_label ? ` (${s.role_label})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dc-target">Implementation target date</Label>
              <Input
                id="dc-target"
                type="date"
                value={form.implementation_target_date}
                onChange={(e) =>
                  f("implementation_target_date", e.target.value)
                }
                disabled={disabled}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dc-signoff">Sign-off status *</Label>
              <Select
                value={form.signoff_status}
                onValueChange={(v) =>
                  f("signoff_status", v as GovernanceSignoffStatus)
                }
                disabled={disabled}
              >
                <SelectTrigger id="dc-signoff">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GOVERNANCE_SIGNOFF_STATUSES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="dc-url">Sign-off evidence URL</Label>
              <Input
                id="dc-url"
                type="url"
                value={form.signoff_evidence_url}
                onChange={(e) => f("signoff_evidence_url", e.target.value)}
                disabled={disabled}
                placeholder="https://…"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            {!canEdit && (
              <p className="text-xs text-muted-foreground">
                You have view-only access on this project.
              </p>
            )}
            {closed && (
              <p className="text-xs text-muted-foreground">
                This decision case is closed and cannot be edited.
              </p>
            )}
            <div className="ml-auto flex gap-2">
              <Button type="button" onClick={handleSave} disabled={disabled}>
                Save decision outcome
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Closure card — only when outcome exists */}
      {outcome ? (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold">Closure</h3>
                <p className="text-xs text-muted-foreground">
                  Closing the decision case freezes the governance record stage.
                </p>
              </div>
              {closed ? (
                <Badge variant="secondary">
                  Closed {new Date(outcome.closed_at!).toLocaleDateString()}
                </Badge>
              ) : canEdit ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="default">
                      Close decision case
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Close decision case?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The decision case stage will be set to Closed. You can
                        add an optional closure note below.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="grid gap-2 py-2">
                      <Label htmlFor="dc-closure-note">Closure note (optional)</Label>
                      <Textarea
                        id="dc-closure-note"
                        rows={3}
                        value={closureNote}
                        onChange={(e) => setClosureNote(e.target.value)}
                      />
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleClose}>
                        Close
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
            {outcome.closure_note && (
              <div className="text-sm">
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Closure note
                </div>
                <div className="whitespace-pre-wrap">{outcome.closure_note}</div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">
              Save the decision outcome before closing the case.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
