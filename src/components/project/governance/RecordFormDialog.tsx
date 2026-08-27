/**
 * GT.4 — Governance Record evidence form (create + edit).
 *
 * Backend authority is the source of truth. This form only assembles
 * inputs for protected RPCs. Cadence advancement and expected-date
 * snapshot are handled by `create_governance_record`; the UI never
 * derives or persists those values.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FieldLabel } from "@/components/ui/field-label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Plus, Trash2, Info, Link2, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import {
  GOVERNANCE_EVENT_TYPES,
  GOVERNANCE_LINK_TYPES,
  eventTypeLabel,
  frequencyLabel,
  mapGovernanceMutationError,
  useCreateGovernanceRecord,
  useUpdateGovernanceRecord,
  useGovernanceRecordDetail,
  useProjectGovernanceCadences,
  type DecisionInput,
  type GovernanceEventType,
  type GovernanceLinkType,
  type GovernanceRecordRow,
  type LinkInput,
} from "@/hooks/useProjectGovernance";
import { useProjectStakeholders, type ProjectStakeholder } from "@/hooks/useProjectStakeholders";
import { useProjectPhases, usePhaseTasks } from "@/hooks/useProjectPlanning";
import { useProjectAllRisks, useProjectAllBlockers } from "@/hooks/useProjectRisksBlockers";
import { useKpiDefinitions } from "@/hooks/useProjectKpis";
import { useProjectBinding } from "@/hooks/useSharepointBindings";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";
import { ConceptHelp } from "@/components/knowledge/ConceptHelp";
import { KC_SLUGS, KC_CONCEPTS } from "@/components/knowledge/kc-concepts";

const NO_CADENCE = "__none__";

type Mode = "create" | "edit";

export function RecordFormDialog({
  open,
  onOpenChange,
  projectId,
  record,
  preselectedCadenceId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  record?: GovernanceRecordRow | null;
  preselectedCadenceId?: string | null;
}) {
  const mode: Mode = record ? "edit" : "create";

  const cadencesQ = useProjectGovernanceCadences(projectId, false);
  const detailQ = useGovernanceRecordDetail(record?.id ?? null);
  const { data: stakeholders } = useProjectStakeholders(projectId);
  const { data: binding } = useProjectBinding(projectId);

  // Data sources for linked-object selection (Project-only).
  const { data: phases } = useProjectPhases(projectId);
  const { data: tasks } = usePhaseTasks(projectId);
  const { data: risks } = useProjectAllRisks(projectId);
  const { data: blockers } = useProjectAllBlockers(projectId);
  const { data: kpis } = useKpiDefinitions(projectId);

  const create = useCreateGovernanceRecord(projectId);
  const update = useUpdateGovernanceRecord(projectId);

  // Form state
  const [cadenceId, setCadenceId] = useState<string>(NO_CADENCE);
  const [eventType, setEventType] = useState<GovernanceEventType>("project_team_meeting");
  const [eventName, setEventName] = useState("");
  const [actualDate, setActualDate] = useState<string>(today());
  const [summary, setSummary] = useState("");
  const [decisionsSummary, setDecisionsSummary] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [sharepointRef, setSharepointRef] = useState("");

  const [decisions, setDecisionsState] = useState<DecisionDraft[]>([]);
  const [links, setLinksState] = useState<LinkDraft[]>([]);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    if (record) {
      setCadenceId(record.cadence_id ?? NO_CADENCE);
      setEventType((record.event_type as GovernanceEventType) ?? "project_team_meeting");
      setEventName(record.event_name ?? "");
      setActualDate(record.actual_date_held ?? today());
      setSummary(record.summary ?? "");
      setDecisionsSummary(record.decisions_summary ?? "");
      setExternalUrl(record.external_reference_url ?? "");
      setSharepointRef(record.sharepoint_evidence_reference ?? "");
    } else {
      setCadenceId(preselectedCadenceId ?? NO_CADENCE);
      setEventType("project_team_meeting");
      setEventName("");
      setActualDate(today());
      setSummary("");
      setDecisionsSummary("");
      setExternalUrl("");
      setSharepointRef("");
      setDecisionsState([]);
      setLinksState([]);
    }
  }, [open, record, preselectedCadenceId]);

  // When cadence changes (create mode), default event type/name from cadence.
  useEffect(() => {
    if (!open || mode !== "create" || cadenceId === NO_CADENCE) return;
    const c = (cadencesQ.data ?? []).find((x) => x.id === cadenceId);
    if (!c) return;
    setEventType(c.event_type as GovernanceEventType);
    if (c.event_name) setEventName(c.event_name);
  }, [open, mode, cadenceId, cadencesQ.data]);

  // UUID regex for defensive label rendering. We must never show a raw UUID as a label.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const safeLabel = (raw: string | null | undefined, fallback = "Unknown stakeholder") => {
    const v = (raw ?? "").trim();
    if (!v || UUID_RE.test(v)) return fallback;
    return v;
  };

  // Active project stakeholders (read via SECURITY DEFINER list_project_stakeholders).
  const activeStakeholders: ProjectStakeholder[] = useMemo(
    () => (stakeholders ?? []).filter((s) => !s.removed_at),
    [stakeholders],
  );

  // Resolve a legacy decision_owner_id (user_id) to a stakeholder id by matching
  // the workspace_member stakeholder whose user_id equals the stored owner id.
  const resolveStakeholderIdFromLegacyOwner = (ownerUserId: string | null | undefined) => {
    if (!ownerUserId) return "";
    const match = activeStakeholders.find(
      (s) => s.stakeholder_type === "workspace_member" && s.user_id === ownerUserId,
    );
    return match ? match.id : "";
  };

  // When detail loads in edit mode, hydrate decisions + links.
  useEffect(() => {
    if (!open || mode !== "edit" || !detailQ.data) return;
    setDecisionsState(
      (detailQ.data.decisions ?? []).map((d: any) => ({
        text: d.decision_text,
        ownerId:
          (d.decision_owner_stakeholder_id as string | null) ??
          resolveStakeholderIdFromLegacyOwner(d.decision_owner_id as string | null) ??
          "",
        targetDate: d.target_date ?? "",
      })),
    );
    setLinksState(
      (detailQ.data.links ?? []).map((l) => ({
        type: l.linked_object_type as GovernanceLinkType,
        id: l.linked_object_id,
      })),
    );
    // resolveStakeholderIdFromLegacyOwner closes over activeStakeholders; re-run if it changes.
  }, [open, mode, detailQ.data, activeStakeholders]);

  const cadenceOptions = useMemo(
    () => (cadencesQ.data ?? []).filter((c) => !c.archived_at),
    [cadencesQ.data],
  );

  // Owner options grouped by internal / external, sourced from project stakeholders only.
  type OwnerOption = { value: string; label: string; group: "internal" | "external" };
  const ownerOptions: OwnerOption[] = useMemo(() => {
    const opts: OwnerOption[] = activeStakeholders.map((s) => ({
      value: s.id,
      label: safeLabel(
        s.display_name,
        s.stakeholder_type === "external" ? "Unnamed external stakeholder" : "Unknown stakeholder",
      ),
      group: s.stakeholder_type === "external" ? "external" : "internal",
    }));
    opts.sort((a, b) => {
      if (a.group !== b.group) return a.group === "internal" ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return opts;
  }, [activeStakeholders]);

  const sharepointConnected =
    !!binding && binding.binding_status !== "disabled";

  const isCustom = eventType === "custom";
  const requiresEventName = isCustom;
  const titleText = mode === "create" ? "Record governance evidence" : "Edit governance record";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actualDate) return toast.error("Actual date held is required.");
    if (requiresEventName && !eventName.trim())
      return toast.error("Event name is required for custom events.");
    // Validate decisions
    for (const d of decisions) {
      if (!d.text.trim()) return toast.error("Each decision needs decision text.");
    }
    for (const l of links) {
      if (!l.id) return toast.error("Each linked object must be selected.");
    }

    try {
      const decisionsPayload = decisions.map((d) => ({
        decision_text: d.text.trim(),
        // Owner is now a project stakeholder reference. The RPC mirrors user_id
        // for internal stakeholders for back-compat; we send null on user-id.
        decision_owner_id: null,
        decision_owner_stakeholder_id: d.ownerId || null,
        target_date: d.targetDate || null,
      }));
      const linksPayload = links.map((l) => ({
        linked_object_type: l.type,
        linked_object_id: l.id,
      }));

      let recordId = record?.id;
      if (mode === "create") {
        // PMG.5C — Atomic composite. The record + decisions + links are
        // written in a single server transaction; a failure in any step
        // rolls back the record itself so no orphan is left behind.
        recordId = await create.mutateAsync({
          cadence_id: cadenceId === NO_CADENCE ? null : cadenceId,
          event_type: eventType,
          event_name: eventName.trim() || null,
          actual_date_held: actualDate,
          summary: summary.trim() || null,
          decisions_summary: decisionsSummary.trim() || null,
          external_reference_url: externalUrl.trim() || null,
          sharepoint_evidence_reference: sharepointRef.trim() || null,
          decisions: decisionsPayload,
          links: linksPayload,
        });
      } else if (record) {
        const cadenceChanged = (record.cadence_id ?? null) !== (cadenceId === NO_CADENCE ? null : cadenceId);
        // PMG.5D — Atomic composite. Record fields + decisions + links are
        // written in one server transaction; a failure in any step rolls
        // back the record update so the record and its child sets never
        // end up partially applied.
        await update.mutateAsync({
          record_id: record.id,
          expected_updated_at: record.updated_at,
          cadence_id: cadenceId === NO_CADENCE ? null : cadenceId,

          clear_cadence: cadenceChanged && cadenceId === NO_CADENCE,
          event_type: eventType,
          event_name: eventName.trim() || null,
          clear_event_name: !eventName.trim(),
          actual_date_held: actualDate,
          summary: summary.trim() || null,
          clear_summary: !summary.trim(),
          decisions_summary: decisionsSummary.trim() || null,
          clear_decisions_summary: !decisionsSummary.trim(),
          external_reference_url: externalUrl.trim() || null,
          clear_external_reference_url: !externalUrl.trim(),
          sharepoint_evidence_reference: sharepointRef.trim() || null,
          clear_sharepoint_evidence_reference: !sharepointRef.trim(),
          decisions: decisionsPayload,
          links: linksPayload,
        });
      }


      toast.success(mode === "create" ? "Governance record created." : "Governance record updated.");
      onOpenChange(false);
    } catch (e) {
      toast.error(mapGovernanceMutationError(e, "Could not save governance record."));
    }
  };

  const isSaving = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titleText}</DialogTitle>
          <DialogDescription>
            Capture evidence that governance happened. Decisions, linked objects, and SharePoint
            evidence are optional but recommended.
          </DialogDescription>
          <div className="pt-1 flex items-center gap-3 flex-wrap">
            <KnowledgeLink slug={KC_SLUGS.howToRecordGovernanceEvidence} label="How to record evidence" />
            <ConceptHelp
              term={KC_CONCEPTS.governanceRecord.term}
              shortText={KC_CONCEPTS.governanceRecord.shortText}
              articleSlug={KC_CONCEPTS.governanceRecord.slug}
            />
          </div>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5">
          {/* Cadence */}
          <div>
            <FieldLabel>Cadence</FieldLabel>
            <Select value={cadenceId} onValueChange={setCadenceId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CADENCE}>No cadence / ad hoc record</SelectItem>
                {cadenceOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {(c.event_name?.trim() || eventTypeLabel(c.event_type))} · {frequencyLabel(c.frequency_type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Event type + name + date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <FieldLabel>Event type <span className="text-destructive">*</span></FieldLabel>
              <Select value={eventType} onValueChange={(v) => setEventType(v as GovernanceEventType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GOVERNANCE_EVENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <FieldLabel>
                Event name {requiresEventName && <span className="text-destructive">*</span>}
              </FieldLabel>
              <Input
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                placeholder={isCustom ? "Required for custom events" : "Optional display name"}
              />
            </div>
          </div>

          <div>
            <FieldLabel>Actual date held <span className="text-destructive">*</span></FieldLabel>
            <Input type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} required />
          </div>

          <div>
            <FieldLabel>Summary</FieldLabel>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              placeholder="Briefly state what happened."
            />
          </div>

          <div>
            <FieldLabel>Decisions summary</FieldLabel>
            <Textarea
              value={decisionsSummary}
              onChange={(e) => setDecisionsSummary(e.target.value)}
              rows={2}
              placeholder="Optional free-text summary of decisions."
            />
          </div>

          <Separator />

          {/* Structured decisions */}
          <DecisionsEditor
            decisions={decisions}
            onChange={setDecisionsState}
            ownerOptions={ownerOptions}
          />

          <Separator />

          {/* Linked objects */}
          <LinksEditor
            links={links}
            onChange={setLinksState}
            phases={phases ?? []}
            tasks={tasks ?? []}
            risks={risks ?? []}
            blockers={blockers ?? []}
            kpis={kpis ?? []}
          />

          <Separator />

          {/* SharePoint evidence */}
          <div className="space-y-2">
            <FieldLabel>SharePoint evidence reference</FieldLabel>
            {!sharepointConnected ? (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>SharePoint is not connected for this project yet.</AlertTitle>
                <AlertDescription>
                  You can still save the governance record and add evidence later.
                </AlertDescription>
              </Alert>
            ) : binding?.folder_web_url ? (
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Link2 className="h-3 w-3" />
                Project folder:&nbsp;
                <a href={binding.folder_web_url} target="_blank" rel="noreferrer" className="underline">
                  open in SharePoint <ExternalLink className="h-3 w-3 inline" />
                </a>
              </div>
            ) : null}
            <Input
              value={sharepointRef}
              onChange={(e) => setSharepointRef(e.target.value)}
              placeholder="Paste a SharePoint URL or reference"
            />
            <p className="text-xs text-muted-foreground">
              Upload directly in SharePoint, then paste the link here. Evidence is stored as a
              reference only — BTPM does not host governance files.
            </p>
            <KnowledgeLink slug={KC_SLUGS.howToRecordGovernanceEvidence} label="Evidence guidance" />
          </div>

          <div>
            <FieldLabel>Outlook / Teams reference URL</FieldLabel>
            <Input
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="Optional pointer to the meeting/chat"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Read-only pointer. BTPM does not create calendar events or Teams meetings.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving…" : mode === "create" ? "Save record" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Decisions sub-editor ───

type DecisionDraft = { text: string; ownerId: string; targetDate: string };

function DecisionsEditor({
  decisions,
  onChange,
  ownerOptions,
}: {
  decisions: DecisionDraft[];
  onChange: (next: DecisionDraft[]) => void;
  ownerOptions: { value: string; label: string; group: "internal" | "external" }[];
}) {
  const add = () => onChange([...decisions, { text: "", ownerId: "", targetDate: "" }]);
  const update = (i: number, patch: Partial<DecisionDraft>) =>
    onChange(decisions.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const remove = (i: number) => onChange(decisions.filter((_, idx) => idx !== i));

  const internal = ownerOptions.filter((o) => o.group === "internal");
  const external = ownerOptions.filter((o) => o.group === "external");

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Structured decisions</h3>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-3 w-3 mr-1" /> Add decision
        </Button>
      </div>
      {decisions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No structured decisions added.</p>
      ) : (
        <div className="space-y-3">
          {decisions.map((d, i) => {
            const knownIds = new Set(ownerOptions.map((o) => o.value));
            const hasStaleOwner = d.ownerId && !knownIds.has(d.ownerId);
            return (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex items-start gap-2">
                <Textarea
                  value={d.text}
                  onChange={(e) => update(i, { text: e.target.value })}
                  rows={2}
                  placeholder="Decision text"
                  className="flex-1"
                />
                <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} aria-label="Remove decision">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <FieldLabel>Owner (project stakeholder)</FieldLabel>
                  <Select
                    value={hasStaleOwner ? "__none__" : (d.ownerId || "__none__")}
                    onValueChange={(v) => update(i, { ownerId: v === "__none__" ? "" : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Unassigned</SelectItem>
                      {internal.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>Internal stakeholders</SelectLabel>
                          {internal.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {external.length > 0 && (
                        <SelectGroup>
                          <SelectLabel>External stakeholders</SelectLabel>
                          {external.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                      {ownerOptions.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          No project stakeholders yet. Add stakeholders to assign decision owners.
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                  {hasStaleOwner && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Previous owner is no longer a project stakeholder. Choose a new owner or leave Unassigned.
                    </p>
                  )}
                </div>
                <div>
                  <FieldLabel>Target date</FieldLabel>
                  <Input type="date" value={d.targetDate} onChange={(e) => update(i, { targetDate: e.target.value })} />
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Links sub-editor ───

type LinkDraft = { type: GovernanceLinkType; id: string };

function LinksEditor({
  links,
  onChange,
  phases,
  tasks,
  risks,
  blockers,
  kpis,
}: {
  links: LinkDraft[];
  onChange: (next: LinkDraft[]) => void;
  phases: any[];
  tasks: any[];
  risks: any[];
  blockers: any[];
  kpis: any[];
}) {
  const add = () => onChange([...links, { type: "task", id: "" }]);
  const update = (i: number, patch: Partial<LinkDraft>) =>
    onChange(links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => onChange(links.filter((_, idx) => idx !== i));

  // KPI updates intentionally omitted: no project-scoped selector is safely
  // available without first picking a KPI definition. Documented as intentional
  // non-work in GT.4 memory.

  // Grouped option model. Flat lists use a single group with empty label.
  type GroupedOption = { value: string; label: string };
  type OptionGroup = { groupLabel: string; options: GroupedOption[] };

  const groupedOptionsFor = (type: GovernanceLinkType): OptionGroup[] => {
    switch (type) {
      case "phase": {
        const sorted = [...(phases ?? [])].sort(
          (a: any, b: any) =>
            (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
            String(a.name ?? "").localeCompare(String(b.name ?? "")),
        );
        return [
          {
            groupLabel: "",
            options: sorted.map((p: any) => ({ value: p.id, label: p.name ?? p.id })),
          },
        ];
      }
      case "task": {
        const phaseList = [...(phases ?? [])].sort(
          (a: any, b: any) =>
            (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
            String(a.name ?? "").localeCompare(String(b.name ?? "")),
        );
        const tasksByPhase = new Map<string | null, any[]>();
        for (const t of tasks ?? []) {
          const key = (t.phase_id ?? null) as string | null;
          if (!tasksByPhase.has(key)) tasksByPhase.set(key, []);
          tasksByPhase.get(key)!.push(t);
        }
        const sortTasks = (arr: any[]) =>
          [...arr].sort(
            (a, b) =>
              (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
              String(a.title ?? a.name ?? "").localeCompare(
                String(b.title ?? b.name ?? ""),
              ),
          );
        const groups: OptionGroup[] = [];
        for (const p of phaseList) {
          const items = tasksByPhase.get(p.id) ?? [];
          if (items.length === 0) continue;
          groups.push({
            groupLabel: p.name ?? "Phase",
            options: sortTasks(items).map((t: any) => ({
              value: t.id,
              label: t.title ?? t.name ?? t.id,
            })),
          });
        }
        // Tasks with no/unknown phase
        const orphanKeys = [...tasksByPhase.keys()].filter(
          (k) => k === null || !phaseList.find((p: any) => p.id === k),
        );
        const orphans = orphanKeys.flatMap((k) => tasksByPhase.get(k) ?? []);
        if (orphans.length > 0) {
          groups.push({
            groupLabel: "Unassigned / Unknown phase",
            options: sortTasks(orphans).map((t: any) => ({
              value: t.id,
              label: t.title ?? t.name ?? t.id,
            })),
          });
        }
        return groups;
      }
      case "risk": {
        const isOpen = (s: string) => {
          const v = (s ?? "").toLowerCase();
          return v !== "closed" && v !== "resolved" && v !== "archived" && v !== "mitigated";
        };
        const fmt = (r: any): GroupedOption => ({
          value: r.id,
          label: [r.likelihood, r.status, r.title ?? r.id]
            .filter(Boolean)
            .map((x) => String(x))
            .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
            .join(" · "),
        });
        const open: any[] = [];
        const closed: any[] = [];
        for (const r of risks ?? []) (isOpen(r.status) ? open : closed).push(r);
        const sortByTitle = (arr: any[]) =>
          [...arr].sort((a, b) =>
            String(a.title ?? "").localeCompare(String(b.title ?? "")),
          );
        const groups: OptionGroup[] = [];
        if (open.length) groups.push({ groupLabel: "Open", options: sortByTitle(open).map(fmt) });
        if (closed.length)
          groups.push({ groupLabel: "Resolved / Closed / Archived", options: sortByTitle(closed).map(fmt) });
        return groups;
      }
      case "blocker": {
        const isOpen = (s: string) => {
          const v = (s ?? "").toLowerCase();
          return v !== "closed" && v !== "resolved" && v !== "archived";
        };
        const fmt = (b: any): GroupedOption => ({
          value: b.id,
          label: [b.severity, b.status, b.title ?? b.id]
            .filter(Boolean)
            .map((x) => String(x))
            .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
            .join(" · "),
        });
        const open: any[] = [];
        const closed: any[] = [];
        for (const b of blockers ?? []) (isOpen(b.status) ? open : closed).push(b);
        const sortByTitle = (arr: any[]) =>
          [...arr].sort((a, b) =>
            String(a.title ?? "").localeCompare(String(b.title ?? "")),
          );
        const groups: OptionGroup[] = [];
        if (open.length) groups.push({ groupLabel: "Open", options: sortByTitle(open).map(fmt) });
        if (closed.length)
          groups.push({ groupLabel: "Resolved / Closed / Archived", options: sortByTitle(closed).map(fmt) });
        return groups;
      }
      case "kpi_definition": {
        const sorted = [...(kpis ?? [])].sort((a: any, b: any) =>
          String(a.name ?? "").localeCompare(String(b.name ?? "")),
        );
        return [
          {
            groupLabel: "",
            options: sorted.map((k: any) => {
              const unit = k.unit ? ` (${k.unit})` : "";
              return { value: k.id, label: `${k.name ?? k.id}${unit}` };
            }),
          },
        ];
      }
      default:
        return [];
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Linked project objects</h3>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-3 w-3 mr-1" /> Add link
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Phase links are referenced only — they do not create phase-level governance.
      </p>
      {links.length === 0 ? (
        <p className="text-xs text-muted-foreground">No linked objects.</p>
      ) : (
        <div className="space-y-2">
          {links.map((l, i) => {
            const groups = groupedOptionsFor(l.type);
            const totalCount = groups.reduce((n, g) => n + g.options.length, 0);
            return (
              <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                <div className="min-w-[160px]">
                  <FieldLabel>Type</FieldLabel>
                  <Select
                    value={l.type}
                    onValueChange={(v) => update(i, { type: v as GovernanceLinkType, id: "" })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {GOVERNANCE_LINK_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 min-w-[220px]">
                  <FieldLabel>Object</FieldLabel>
                  <Select value={l.id || "__none__"} onValueChange={(v) => update(i, { id: v === "__none__" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent className="max-h-[320px]">
                      {totalCount === 0 ? (
                        <SelectItem value="__none__" disabled>No items available</SelectItem>
                      ) : (
                        groups.map((g, gi) => (
                          <SelectGroup key={`${gi}-${g.groupLabel}`}>
                            {g.groupLabel ? <SelectLabel>{g.groupLabel}</SelectLabel> : null}
                            {g.options.map((o) => (
                              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                          </SelectGroup>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} aria-label="Remove link">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {links.filter((l) => l.id).map((l, i) => (
            <Badge key={i} variant="outline" className="text-xs">
              {GOVERNANCE_LINK_TYPES.find((t) => t.value === l.type)?.label ?? l.type}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
