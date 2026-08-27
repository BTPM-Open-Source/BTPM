/**
 * DC.5 — Decision Case BTPM Context editor.
 *
 * Reuses the existing same-project link model (`governance_record_links` via
 * `set_governance_record_links`) to let users attach canonical BTPM objects
 * (phases, tasks, risks, blockers, KPI definitions) to a Decision Case.
 *
 * No new backend, no new RPC, no snapshots. Reads come from the protected
 * governance record detail; writes go through `useSetGovernanceRecordLinks`,
 * which already invalidates the record detail query.
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FieldLabel } from "@/components/ui/field-label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  GOVERNANCE_LINK_TYPES,
  mapGovernanceMutationError,
  useSetGovernanceRecordLinks,
  type GovernanceLinkType,
  type GovernanceRecordLink,
  type LinkInput,
} from "@/hooks/useProjectGovernance";
import { useProjectPhases, usePhaseTasks } from "@/hooks/useProjectPlanning";
import { useProjectAllRisks, useProjectAllBlockers } from "@/hooks/useProjectRisksBlockers";
import { useKpiDefinitions } from "@/hooks/useProjectKpis";

type Draft = { type: GovernanceLinkType; id: string };

function toDraft(l: GovernanceRecordLink): Draft {
  return {
    type: (l.linked_object_type as GovernanceLinkType) ?? "task",
    id: l.linked_object_id,
  };
}

function draftsEqual(a: Draft[], b: Draft[]) {
  if (a.length !== b.length) return false;
  const key = (d: Draft) => `${d.type}::${d.id}`;
  const sa = [...a].map(key).sort();
  const sb = [...b].map(key).sort();
  return sa.every((v, i) => v === sb[i]);
}

export function GovernanceLinkedObjectsEditor({
  recordId,
  projectId,
  links,
  canEdit,
}: {
  recordId: string;
  projectId: string;
  links: GovernanceRecordLink[];
  canEdit: boolean;
}) {
  const initial = useMemo(() => links.map(toDraft), [links]);
  const [drafts, setDrafts] = useState<Draft[]>(initial);

  // Re-hydrate when server state changes (after save / refresh).
  useEffect(() => {
    setDrafts(initial);
  }, [initial]);

  const { data: phases } = useProjectPhases(projectId);
  const { data: tasks } = usePhaseTasks(projectId);
  const { data: risks } = useProjectAllRisks(projectId);
  const { data: blockers } = useProjectAllBlockers(projectId);
  const { data: kpis } = useKpiDefinitions(projectId);

  const setLinks = useSetGovernanceRecordLinks(projectId);

  const nameLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of phases ?? []) m.set(`phase:${p.id}`, p.name ?? p.id);
    for (const t of (tasks ?? []) as any[])
      m.set(`task:${t.id}`, t.title ?? t.name ?? t.id);
    for (const r of (risks ?? []) as any[])
      m.set(`risk:${r.id}`, r.title ?? r.id);
    for (const b of (blockers ?? []) as any[])
      m.set(`blocker:${b.id}`, b.title ?? b.id);
    for (const k of (kpis ?? []) as any[])
      m.set(`kpi_definition:${k.id}`, k.name ?? k.id);
    return m;
  }, [phases, tasks, risks, blockers, kpis]);

  const typeLabel = (t: string) =>
    GOVERNANCE_LINK_TYPES.find((x) => x.value === t)?.label ?? t;

  // ─── Read-only display ───
  if (!canEdit) {
    if (links.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">No BTPM objects linked yet.</p>
      );
    }
    return (
      <ul className="space-y-2">
        {links.map((l) => {
          const k = `${l.linked_object_type}:${l.linked_object_id}`;
          const name = nameLookup.get(k) ?? l.linked_object_id;
          return (
            <li
              key={l.id}
              className="flex items-center gap-2 rounded-md border p-2 text-sm"
            >
              <Badge variant="outline">{typeLabel(l.linked_object_type)}</Badge>
              <span className="truncate">{name}</span>
            </li>
          );
        })}
      </ul>
    );
  }

  // ─── Editable ───
  const add = () => setDrafts((d) => [...d, { type: "task", id: "" }]);
  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((d) => d.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const remove = (i: number) =>
    setDrafts((d) => d.filter((_, idx) => idx !== i));
  const reset = () => setDrafts(initial);

  const dirty = !draftsEqual(drafts, initial);
  const hasInvalid = drafts.some((d) => !d.id);

  const save = async () => {
    if (hasInvalid) {
      toast.error("Each link must have an object selected.");
      return;
    }
    // Dedupe on (type,id) before sending.
    const seen = new Set<string>();
    const payload: LinkInput[] = [];
    for (const d of drafts) {
      const k = `${d.type}::${d.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      payload.push({ linked_object_type: d.type, linked_object_id: d.id });
    }
    try {
      await setLinks.mutateAsync({ record_id: recordId, links: payload });
      toast.success("BTPM context updated.");
    } catch (e) {
      toast.error(mapGovernanceMutationError(e, "Could not update BTPM context."));
    }
  };

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
        for (const t of (tasks ?? []) as any[]) {
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
        const sorted = [...((risks ?? []) as any[])].sort((a, b) =>
          String(a.title ?? "").localeCompare(String(b.title ?? "")),
        );
        return [
          {
            groupLabel: "",
            options: sorted.map((r: any) => ({
              value: r.id,
              label: r.title ?? r.id,
            })),
          },
        ];
      }
      case "blocker": {
        const sorted = [...((blockers ?? []) as any[])].sort((a, b) =>
          String(a.title ?? "").localeCompare(String(b.title ?? "")),
        );
        return [
          {
            groupLabel: "",
            options: sorted.map((b: any) => ({
              value: b.id,
              label: b.title ?? b.id,
            })),
          },
        ];
      }
      case "kpi_definition": {
        const sorted = [...((kpis ?? []) as any[])].sort((a, b) =>
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-3 w-3 mr-1" /> Add link
        </Button>
        {dirty && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={setLinks.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={setLinks.isPending}
            >
              {setLinks.isPending ? "Saving…" : "Save links"}
            </Button>
          </div>
        )}
      </div>

      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No BTPM objects linked yet.</p>
      ) : (
        <div className="space-y-2">
          {drafts.map((l, i) => {
            const groups = groupedOptionsFor(l.type);
            const totalCount = groups.reduce((n, g) => n + g.options.length, 0);
            return (
              <div
                key={i}
                className="flex flex-wrap items-end gap-2 rounded-md border p-2"
              >
                <div className="min-w-[160px]">
                  <FieldLabel>Type</FieldLabel>
                  <Select
                    value={l.type}
                    onValueChange={(v) =>
                      update(i, { type: v as GovernanceLinkType, id: "" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GOVERNANCE_LINK_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 min-w-[220px]">
                  <FieldLabel>Object</FieldLabel>
                  <Select
                    value={l.id || "__none__"}
                    onValueChange={(v) =>
                      update(i, { id: v === "__none__" ? "" : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[320px]">
                      {totalCount === 0 ? (
                        <SelectItem value="__none__" disabled>
                          No items available
                        </SelectItem>
                      ) : (
                        groups.map((g, gi) => (
                          <SelectGroup key={`${gi}-${g.groupLabel}`}>
                            {g.groupLabel ? (
                              <SelectLabel>{g.groupLabel}</SelectLabel>
                            ) : null}
                            {g.options.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(i)}
                  aria-label="Remove link"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
