/**
 * WPP.3 — Save current Project People as a Workspace People Preset.
 *
 * Compact dialog rendered from the Project People page. Delegates all
 * mutation logic to the protected RPC `save_project_people_preset_from_project`
 * via `useSaveProjectPeoplePresetFromProject`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field-label";
import { useSaveProjectPeoplePresetFromProject } from "@/hooks/useProjectPeoplePresets";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workspaceId: string;
  activeTeamCount: number;
  activeStakeholderCount: number;
}

export function SaveProjectPeoplePresetDialog({
  open, onOpenChange, projectId, workspaceId,
  activeTeamCount, activeStakeholderCount,
}: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Stable idempotency key per open-cycle so accidental double-submits don't
  // create two presets.
  const idemKeyRef = useRef<string>("");

  useEffect(() => {
    if (open) {
      idemKeyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `wpp3-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setName("");
      setDescription("");
    }
  }, [open]);

  const save = useSaveProjectPeoplePresetFromProject(workspaceId);

  const hasAnyActive = activeTeamCount + activeStakeholderCount > 0;
  const nameTrimmed = name.trim();
  const canSave = useMemo(
    () => hasAnyActive && nameTrimmed.length > 0 && !save.isPending,
    [hasAnyActive, nameTrimmed, save.isPending],
  );

  const handleSave = () => {
    if (!canSave) return;
    save.mutate(
      {
        project_id: projectId,
        name: nameTrimmed,
        description: description.trim() || null,
        idempotency_key: idemKeyRef.current,
      },
      {
        onSuccess: (result) => {
          if (result.status === "applied" || result.status === "no_change") {
            const teamCount = Number(result.data?.team_count ?? activeTeamCount);
            const stakeholderCount = Number(
              result.data?.stakeholder_count ?? activeStakeholderCount,
            );
            toast.success("Preset saved", {
              description: `Captured ${teamCount} team member${teamCount === 1 ? "" : "s"} and ${stakeholderCount} stakeholder${stakeholderCount === 1 ? "" : "s"}.`,
            });
            onOpenChange(false);
            return;
          }
          if (result.status === "invalid") {
            const reason = String(result.data?.reason ?? "invalid");
            const map: Record<string, string> = {
              name_required: "Please enter a preset name.",
              duplicate_name: "A preset with this name already exists in this workspace.",
              empty_source: "This project has no active team members or stakeholders to save.",
              source_invalid: "One or more source members could not be saved.",
            };
            toast.error(map[reason] ?? "Could not save preset.");
            return;
          }
          if (result.status === "not_authorized") {
            toast.error("You are not authorized to save a preset for this project.");
            return;
          }
          toast.error("Could not save preset.");
        },
        onError: (err: unknown) => {
          const message = err instanceof Error ? err.message : "Unknown error";
          toast.error(`Could not save preset: ${message}`);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save people as workspace preset</DialogTitle>
          <DialogDescription>
            Capture the current project's active team members and stakeholders as a
            reusable workspace preset.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <FieldLabel htmlFor="wpp3-name" required>Preset name</FieldLabel>
            <Input
              id="wpp3-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Core delivery squad"
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <FieldLabel htmlFor="wpp3-description">Description</FieldLabel>
            <Textarea
              id="wpp3-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              rows={2}
              maxLength={1000}
            />
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span>Active team members</span>
              <span className="font-medium text-foreground">{activeTeamCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Active stakeholders</span>
              <span className="font-medium text-foreground">{activeStakeholderCount}</span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Roles are saved. RACI, task assignments, notes, dates, history and permissions
            are not saved.
          </p>

          {!hasAnyActive && (
            <p className="text-xs text-destructive">
              Add at least one active team member or stakeholder before saving a preset.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {save.isPending ? "Saving…" : "Save preset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
