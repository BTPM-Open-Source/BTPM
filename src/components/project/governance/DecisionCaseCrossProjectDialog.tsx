/**
 * DC.6 — Cross-project context dialog for Decision Cases.
 *
 * Lets users add or edit a controlled cross-project reference from a
 * Decision Case. Uses only protected RPCs via hooks; never touches tables
 * directly. The linked-project picker reuses existing protected listings
 * (list_user_workspaces + list_workspace_projects).
 *
 * source_dependency_id is intentionally NOT exposed in the UI in this step;
 * the backend stays ready for it but no safe dependency picker exists yet.
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  GOVERNANCE_CROSS_PROJECT_RELATIONSHIPS,
  mapCrossProjectMutationError,
  useCreateGovernanceRecordCrossProjectLink,
  useUpdateGovernanceRecordCrossProjectLink,
  type GovernanceCrossProjectRelationshipType,
  type GovernanceRecordCrossProjectLink,
} from "@/hooks/useGovernanceCrossProjectLinks";
import { useWorkspaces, useWorkspaceProjects } from "@/hooks/useProjectOverview";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recordId: string;
  /** Current Decision Case project id — must be excluded from picker. */
  currentProjectId: string;
  /** Existing link being edited, or null for create. */
  existing: GovernanceRecordCrossProjectLink | null;
};

export function DecisionCaseCrossProjectDialog({
  open,
  onOpenChange,
  recordId,
  currentProjectId,
  existing,
}: Props) {
  const editing = !!existing;

  const create = useCreateGovernanceRecordCrossProjectLink(recordId);
  const update = useUpdateGovernanceRecordCrossProjectLink(recordId);

  // Workspace + project pickers
  const workspacesQ = useWorkspaces();
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const projectsQ = useWorkspaceProjects(workspaceId || undefined);

  // Form fields
  const [linkedProjectId, setLinkedProjectId] = useState<string>("");
  const [relationshipType, setRelationshipType] =
    useState<GovernanceCrossProjectRelationshipType>("manual_related");
  const [reason, setReason] = useState<string>("");
  const [includedInPackage, setIncludedInPackage] = useState<boolean>(true);

  // Hydrate on open / when editing
  useEffect(() => {
    if (!open) return;
    if (existing) {
      setWorkspaceId(existing.linked_project_workspace_id);
      setLinkedProjectId(existing.linked_project_id);
      setRelationshipType(
        existing.relationship_type as GovernanceCrossProjectRelationshipType,
      );
      setReason(existing.relationship_reason ?? "");
      setIncludedInPackage(existing.included_in_package);
    } else {
      setWorkspaceId("");
      setLinkedProjectId("");
      setRelationshipType("manual_related");
      setReason("");
      setIncludedInPackage(true);
    }
  }, [open, existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectableProjects = useMemo(() => {
    const list = (projectsQ.data ?? []) as Array<{
      id: string;
      name: string;
      programs?: { name?: string | null } | null;
    }>;
    return list.filter((p) => p.id !== currentProjectId);
  }, [projectsQ.data, currentProjectId]);

  // If workspace changes and current linkedProjectId not in list, clear it
  useEffect(() => {
    if (!linkedProjectId) return;
    if (!projectsQ.data) return;
    if (!selectableProjects.some((p) => p.id === linkedProjectId)) {
      setLinkedProjectId("");
    }
  }, [workspaceId, selectableProjects, projectsQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitting = create.isPending || update.isPending;

  const handleSave = async () => {
    if (!linkedProjectId) {
      toast.error("Linked project is required.");
      return;
    }
    if (linkedProjectId === currentProjectId) {
      toast.error("Cannot link the current project to itself.");
      return;
    }
    try {
      if (editing && existing) {
        await update.mutateAsync({
          cross_project_link_id: existing.id,
          linked_project_id:
            linkedProjectId !== existing.linked_project_id
              ? linkedProjectId
              : undefined,
          relationship_type: relationshipType,
          relationship_reason: reason.trim() ? reason.trim() : null,
          clear_relationship_reason: !reason.trim(),
          included_in_package: includedInPackage,
        });
        toast.success("Cross-project link updated.");
      } else {
        await create.mutateAsync({
          linked_project_id: linkedProjectId,
          relationship_type: relationshipType,
          relationship_reason: reason.trim() ? reason.trim() : null,
          included_in_package: includedInPackage,
        });
        toast.success("Cross-project link added.");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(mapCrossProjectMutationError(e, "Could not save cross-project link."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit cross-project link" : "Add cross-project link"}
          </DialogTitle>
          <DialogDescription>
            Reference another authorized project only when it materially affects
            this decision. BTPM does not auto-include same-program projects.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="cpl-workspace">Workspace</Label>
            <Select value={workspaceId} onValueChange={setWorkspaceId}>
              <SelectTrigger id="cpl-workspace">
                <SelectValue placeholder="Select workspace" />
              </SelectTrigger>
              <SelectContent>
                {(workspacesQ.data ?? []).map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cpl-project">
              Linked project <span className="text-destructive">*</span>
            </Label>
            <Select
              value={linkedProjectId}
              onValueChange={setLinkedProjectId}
              disabled={!workspaceId || projectsQ.isLoading}
            >
              <SelectTrigger id="cpl-project">
                <SelectValue
                  placeholder={
                    !workspaceId
                      ? "Select a workspace first"
                      : projectsQ.isLoading
                        ? "Loading projects…"
                        : "Select project"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {selectableProjects.length === 0 && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No other projects available.
                  </div>
                )}
                {selectableProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.programs?.name ? ` — ${p.programs.name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Only projects you can access are listed. The current project is excluded.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cpl-rel">
              Relationship <span className="text-destructive">*</span>
            </Label>
            <Select
              value={relationshipType}
              onValueChange={(v) =>
                setRelationshipType(v as GovernanceCrossProjectRelationshipType)
              }
            >
              <SelectTrigger id="cpl-rel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GOVERNANCE_CROSS_PROJECT_RELATIONSHIPS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cpl-reason">Why is this project relevant?</Label>
            <Textarea
              id="cpl-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Short reason (encrypted at rest)"
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="cpl-pkg" className="text-sm">
              Include in stakeholder package
            </Label>
            <Switch
              id="cpl-pkg"
              checked={includedInPackage}
              onCheckedChange={(v) => setIncludedInPackage(!!v)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? "Saving…" : editing ? "Save changes" : "Add link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
