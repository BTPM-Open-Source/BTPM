/**
 * DC.13 — Unified BTPM Context dialog for Decision Cases.
 *
 * Lets users link a specific BTPM object from any authorized project
 * (current project or any other project they can access) as Decision Case
 * context. All reads/writes go through protected RPC-backed hooks.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
  GOVERNANCE_BTPM_CONTEXT_OBJECT_TYPES,
  GOVERNANCE_BTPM_CONTEXT_RELATIONSHIPS,
  GOVERNANCE_BTPM_CONTEXT_RELEVANCE_LEVELS,
  mapBtpmContextMutationError,
  useCreateGovernanceRecordBtpmContextLink,
  useUpdateGovernanceRecordBtpmContextLink,
  type GovernanceBtpmContextObjectType,
  type GovernanceBtpmContextRelationshipType,
  type GovernanceBtpmContextRelevanceLevel,
  type GovernanceRecordBtpmContextLink,
} from "@/hooks/useGovernanceBtpmContextLinks";
import { useWorkspaces, useWorkspaceProjects } from "@/hooks/useProjectOverview";
import { useProjectPhases, usePhaseTasks } from "@/hooks/useProjectPlanning";
import {
  useProjectAllRisks,
  useProjectAllBlockers,
} from "@/hooks/useProjectRisksBlockers";
import { useKpiDefinitions } from "@/hooks/useProjectKpis";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recordId: string;
  currentProjectId: string;
  currentWorkspaceId: string;
  existing: GovernanceRecordBtpmContextLink | null;
};

export function DecisionCaseBtpmContextDialog({
  open,
  onOpenChange,
  recordId,
  currentProjectId,
  currentWorkspaceId,
  existing,
}: Props) {
  const editing = !!existing;
  const create = useCreateGovernanceRecordBtpmContextLink(recordId);
  const update = useUpdateGovernanceRecordBtpmContextLink(recordId);

  // Workspace + project pickers
  const workspacesQ = useWorkspaces();
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const projectsQ = useWorkspaceProjects(workspaceId || undefined);

  const [sourceProjectId, setSourceProjectId] = useState<string>("");
  const [objectType, setObjectType] =
    useState<GovernanceBtpmContextObjectType>("task");
  const [objectId, setObjectId] = useState<string>("");
  const [relationship, setRelationship] =
    useState<GovernanceBtpmContextRelationshipType>("directly_relevant");
  const [relevance, setRelevance] =
    useState<GovernanceBtpmContextRelevanceLevel>("medium");
  const [includedInPackage, setIncludedInPackage] = useState<boolean>(true);
  const [reason, setReason] = useState<string>("");

  // Hydrate on open
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setWorkspaceId(existing.source_workspace_id);
      setSourceProjectId(existing.source_project_id);
      setObjectType(
        (existing.object_type as GovernanceBtpmContextObjectType) ?? "task",
      );
      setObjectId(existing.object_id);
      setRelationship(
        (existing.relationship_type as GovernanceBtpmContextRelationshipType) ??
          "directly_relevant",
      );
      setRelevance(
        (existing.relevance_level as GovernanceBtpmContextRelevanceLevel) ??
          "medium",
      );
      setIncludedInPackage(existing.included_in_package);
      setReason(existing.context_reason ?? "");
    } else {
      setWorkspaceId(currentWorkspaceId);
      setSourceProjectId(currentProjectId);
      setObjectType("task");
      setObjectId("");
      setRelationship("directly_relevant");
      setRelevance("medium");
      setIncludedInPackage(true);
      setReason("");
    }
  }, [open, existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Explicit handler: only clears when the user manually picks a different
  // workspace from the dropdown. We do NOT use a reactive effect on
  // workspaceId because that would clobber the create-mode defaults during
  // initial hydration (current workspace + current project).
  const handleWorkspaceChange = (next: string) => {
    if (next === workspaceId) return;
    setWorkspaceId(next);
    setSourceProjectId("");
    setObjectId("");
  };

  // Reset object id when project or type changes (unless editing initial load)
  useEffect(() => {
    if (!open) return;
    if (editing && existing &&
        sourceProjectId === existing.source_project_id &&
        objectType === existing.object_type) return;
    setObjectId("");
  }, [sourceProjectId, objectType]); // eslint-disable-line react-hooks/exhaustive-deps

  const workspaces = workspacesQ.data ?? [];
  const projects = (projectsQ.data ?? []) as Array<{
    id: string;
    name: string;
    status?: string | null;
    programs?: { name: string } | null;
  }>;

  // Object lookups for the selected source project
  const enabledProj = !!sourceProjectId;
  const phasesQ = useProjectPhases(enabledProj ? sourceProjectId : undefined);
  const tasksQ = usePhaseTasks(enabledProj ? sourceProjectId : undefined);
  const risksQ = useProjectAllRisks(enabledProj ? sourceProjectId : undefined);
  const blockersQ = useProjectAllBlockers(
    enabledProj ? sourceProjectId : undefined,
  );
  const kpisQ = useKpiDefinitions(enabledProj ? sourceProjectId : undefined);

  const objectOptions: Array<{ id: string; label: string; hint?: string }> =
    useMemo(() => {
      if (!sourceProjectId) return [];
      if (objectType === "project") {
        const p = projects.find((x) => x.id === sourceProjectId);
        return [
          {
            id: sourceProjectId,
            label: p?.name ?? "(this project)",
            hint: p?.status ?? undefined,
          },
        ];
      }
      if (objectType === "phase") {
        return (phasesQ.data ?? []).map((p: any) => ({
          id: p.id,
          label: p.name ?? "Phase",
          hint: p.status,
        }));
      }
      if (objectType === "task") {
        return (tasksQ.data ?? []).map((t: any) => ({
          id: t.id,
          label: t.name ?? "Task",
          hint: t.status,
        }));
      }
      if (objectType === "risk") {
        return ((risksQ.data ?? []) as any[]).map((r) => ({
          id: r.id,
          label: r.title ?? "Risk",
          hint: r.status,
        }));
      }
      if (objectType === "blocker") {
        return ((blockersQ.data ?? []) as any[]).map((b) => ({
          id: b.id,
          label: b.title ?? "Blocker",
          hint: b.status,
        }));
      }
      if (objectType === "kpi_definition") {
        return ((kpisQ.data ?? []) as any[]).map((k) => ({
          id: k.id,
          label: k.name ?? "KPI",
        }));
      }
      // kpi_update — not surfaced in picker (no protected list hook available
      // at the project level). Edits to existing kpi_update links remain
      // possible via direct id.
      return [];
    }, [
      sourceProjectId,
      objectType,
      projects,
      phasesQ.data,
      tasksQ.data,
      risksQ.data,
      blockersQ.data,
      kpisQ.data,
    ]);

  // For "project" type, auto-set the objectId
  useEffect(() => {
    if (objectType === "project" && sourceProjectId) {
      setObjectId(sourceProjectId);
    }
  }, [objectType, sourceProjectId]);

  const submitting = create.isPending || update.isPending;
  const canSave =
    !!sourceProjectId && !!objectType && !!objectId && !submitting;

  const onSubmit = async () => {
    try {
      const trimmed = reason.trim();
      if (editing && existing) {
        await update.mutateAsync({
          context_link_id: existing.id,
          source_project_id:
            sourceProjectId !== existing.source_project_id
              ? sourceProjectId
              : undefined,
          object_type:
            objectType !== existing.object_type ? objectType : undefined,
          object_id: objectId !== existing.object_id ? objectId : undefined,
          relationship_type:
            relationship !== existing.relationship_type
              ? relationship
              : undefined,
          relevance_level:
            relevance !== existing.relevance_level ? relevance : undefined,
          included_in_package:
            includedInPackage !== existing.included_in_package
              ? includedInPackage
              : undefined,
          context_reason: trimmed ? trimmed : undefined,
          clear_context_reason: trimmed.length === 0,
        });
        toast.success("BTPM context updated.");
      } else {
        await create.mutateAsync({
          source_project_id: sourceProjectId,
          object_type: objectType,
          object_id: objectId,
          relationship_type: relationship,
          relevance_level: relevance,
          included_in_package: includedInPackage,
          context_reason: trimmed ? trimmed : null,
        });
        toast.success("BTPM context added.");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(mapBtpmContextMutationError(e, "Could not save context."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit BTPM context" : "Add BTPM context"}</DialogTitle>
          <DialogDescription>
            Link a specific BTPM object from this project or any other
            authorized project as decision context.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Source workspace</Label>
            <Select value={workspaceId} onValueChange={handleWorkspaceChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select workspace…" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Source project</Label>
            <Select
              value={sourceProjectId}
              onValueChange={setSourceProjectId}
              disabled={!workspaceId || projectsQ.isLoading}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    workspaceId ? "Select project…" : "Pick a workspace first"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.programs?.name ? ` · ${p.programs.name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Object type</Label>
              <Select
                value={objectType}
                onValueChange={(v) =>
                  setObjectType(v as GovernanceBtpmContextObjectType)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GOVERNANCE_BTPM_CONTEXT_OBJECT_TYPES.filter((t) => {
                    // Hide kpi_update from the create flow: no safe project-wide
                    // picker exists yet. Keep it visible only when editing an
                    // existing link that already has this type so users can
                    // still see/modify it.
                    if (t.value !== "kpi_update") return true;
                    return editing && existing?.object_type === "kpi_update";
                  }).map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Relevance</Label>
              <Select
                value={relevance}
                onValueChange={(v) =>
                  setRelevance(v as GovernanceBtpmContextRelevanceLevel)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GOVERNANCE_BTPM_CONTEXT_RELEVANCE_LEVELS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Object</Label>
            <Select
              value={objectId}
              onValueChange={setObjectId}
              disabled={!sourceProjectId || objectType === "project"}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !sourceProjectId
                      ? "Pick a source project first"
                      : objectOptions.length === 0
                        ? "No items available"
                        : "Select an item…"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {objectOptions.length === 0 ? (
                  <SelectGroup>
                    <SelectLabel>No items available</SelectLabel>
                  </SelectGroup>
                ) : (
                  objectOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                      {o.hint ? ` · ${o.hint}` : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Relationship</Label>
            <Select
              value={relationship}
              onValueChange={(v) =>
                setRelationship(v as GovernanceBtpmContextRelationshipType)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GOVERNANCE_BTPM_CONTEXT_RELATIONSHIPS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Why this matters (optional)</Label>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Short reason this object is relevant to the decision…"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={includedInPackage}
              onCheckedChange={(v) => setIncludedInPackage(!!v)}
            />
            Include in stakeholder package
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!canSave}>
            {submitting ? "Saving…" : editing ? "Save changes" : "Add context"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
