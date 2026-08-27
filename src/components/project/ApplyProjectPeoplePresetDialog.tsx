/**
 * WPP.5 — Apply Workspace People Preset to the current Project.
 *
 * UX only. All authorization, encryption, classification and mutation
 * logic lives in the protected RPCs behind
 *   `useProjectPeoplePresetApplicationPreview` (WPP.4 preview) and
 *   `useApplyProjectPeoplePreset` (WPP.4 apply).
 *
 * The dialog:
 *  - lists ACTIVE presets from the current Project's workspace only;
 *  - previews the effect of the selected preset (loading / error / summary);
 *  - disables Apply when preview is pending, errored, blocking, or nothing
 *    is eligible to be added;
 *  - confirms with a fresh idempotency key and reports an honest toast.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FieldLabel } from "@/components/ui/field-label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  useProjectPeoplePresets,
  useProjectPeoplePresetApplicationPreview,
  useApplyProjectPeoplePreset,
} from "@/hooks/useProjectPeoplePresets";
import type {
  PresetApplicationClassification,
  PresetApplicationPreviewItem,
} from "@/lib/projectPeoplePresets";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workspaceId: string;
}

const INELIGIBLE_CLASSIFICATIONS: PresetApplicationClassification[] = [
  "inactive_user",
  "no_longer_workspace_member",
  "invalid_external",
  "otherwise_ineligible",
];

const CLASSIFICATION_LABELS: Record<PresetApplicationClassification, string> = {
  will_add: "Will add",
  already_exists: "Already on project",
  inactive_user: "Inactive user",
  no_longer_workspace_member: "No longer a workspace member",
  invalid_external: "Invalid external entry",
  otherwise_ineligible: "Cannot be added",
};

function memberTypeLabel(item: PresetApplicationPreviewItem): string {
  if (item.member_kind === "team_member") return "Team member";
  if (item.stakeholder_type === "external") return "Stakeholder · External";
  if (item.stakeholder_type === "workspace_member") return "Stakeholder · Workspace member";
  return "Stakeholder";
}

function displayNameOf(item: PresetApplicationPreviewItem): string {
  return item.display_name?.trim() || "Unnamed";
}

function ItemRow({ item }: { item: PresetApplicationPreviewItem }) {
  const role = item.role_label?.trim();
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{displayNameOf(item)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {memberTypeLabel(item)}
          {role ? ` · ${role}` : ""}
          {item.reason ? ` · ${item.reason}` : ""}
        </p>
      </div>
    </div>
  );
}

export function ApplyProjectPeoplePresetDialog({
  open, onOpenChange, projectId, workspaceId,
}: Props) {
  const [presetId, setPresetId] = useState<string>("");
  const idemKeyRef = useRef<string>("");

  const presetsQuery = useProjectPeoplePresets(workspaceId, { includeArchived: false });
  // Belt-and-braces: RPC excludes archived, but never surface any archived
  // preset even if the cache is stale.
  const activePresets = useMemo(
    () => (presetsQuery.data ?? []).filter((p) => p.archived_at === null),
    [presetsQuery.data],
  );

  const previewQuery = useProjectPeoplePresetApplicationPreview(
    presetId || undefined,
    projectId,
  );
  const apply = useApplyProjectPeoplePreset(workspaceId, projectId);

  useEffect(() => {
    if (open) {
      setPresetId("");
      idemKeyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `wpp5-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }, [open]);

  const grouped = useMemo(() => {
    const items = previewQuery.data?.items ?? [];
    return {
      willAdd: items.filter((i) => i.classification === "will_add"),
      alreadyExists: items.filter((i) => i.classification === "already_exists"),
      ineligible: items.filter((i) =>
        INELIGIBLE_CLASSIFICATIONS.includes(i.classification),
      ),
    };
  }, [previewQuery.data]);

  const summary = previewQuery.data?.summary;
  const previewErrors = previewQuery.data?.errors ?? [];
  const hasBlockingErrors = summary?.has_blocking_errors === true;
  const nothingToAdd =
    !!summary &&
    !hasBlockingErrors &&
    summary.will_add_team_members + summary.will_add_stakeholders === 0;

  const canApply =
    !!presetId &&
    previewQuery.isSuccess &&
    !previewQuery.isFetching &&
    !hasBlockingErrors &&
    !nothingToAdd &&
    !apply.isPending;

  const handleApply = () => {
    if (!canApply) return;
    apply.mutate(
      {
        preset_id: presetId,
        project_id: projectId,
        idempotency_key: idemKeyRef.current,
      },
      {
        onSuccess: (result) => {
          if (result.status === "no_change") {
            const data = result.data as Record<string, unknown> | undefined;
            const isReplay = data?.reason === "idempotent_replay";
            toast.success("Preset applied — no changes", {
              description: isReplay
                ? "This preset apply was already processed."
                : "Every eligible person from the preset was already on this project or could not be added.",
            });
            onOpenChange(false);
            return;
          }
          if (result.status === "applied") {
            const data = result.data as Record<string, unknown> | undefined;
            const added =
              Number(data?.added_team_members ?? 0) +
              Number(data?.added_stakeholders ?? 0);
            const skipped =
              Number(data?.skipped_existing ?? 0) +
              Number(data?.skipped_ineligible ?? 0);
            toast.success("Preset applied", {
              description: `Added ${added} ${added === 1 ? "person" : "people"}${
                skipped > 0
                  ? `, skipped ${skipped} ${skipped === 1 ? "entry" : "entries"}`
                  : ""
              }.`,
            });
            onOpenChange(false);
            return;
          }

          if (result.status === "not_authorized") {
            toast.error("You are not authorized to apply this preset.");
            return;
          }
          if (result.status === "invalid") {
            const reason = String(
              (result.data as Record<string, unknown> | undefined)?.reason ??
                "invalid",
            );
            const map: Record<string, string> = {
              preset_archived: "This preset has been archived.",
              workspace_mismatch:
                "This preset belongs to a different workspace.",
              invalid_scope: "This preset is not a workspace preset.",
              empty_preset: "This preset has no members to apply.",
              nothing_to_add:
                "Every eligible person from the preset is already on this project.",
            };
            toast.error(map[reason] ?? "Could not apply preset.");
            return;
          }
          toast.error("Could not apply preset.");
        },
        onError: (err: unknown) => {
          const message = err instanceof Error ? err.message : "Unknown error";
          toast.error(`Could not apply preset: ${message}`);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply people preset</DialogTitle>
          <DialogDescription>
            Add team members and stakeholders from a saved workspace preset.
            Existing project people are never modified.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <FieldLabel htmlFor="wpp5-preset" required>Preset</FieldLabel>
            {presetsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading presets…</p>
            ) : presetsQuery.isError ? (
              <p className="text-sm text-destructive">Could not load presets.</p>
            ) : activePresets.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-md border bg-muted/40 p-3">
                No active presets in this workspace. Save one from a project first.
              </p>
            ) : (
              <Select value={presetId} onValueChange={setPresetId}>
                <SelectTrigger id="wpp5-preset">
                  <SelectValue placeholder="Select a preset" />
                </SelectTrigger>
                <SelectContent>
                  {activePresets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name ?? "Untitled preset"}
                      <span className="text-xs text-muted-foreground ml-2">
                        · {p.team_count} team · {p.stakeholder_count} stakeholders
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {presetId && (
            <div className="rounded-md border">
              {previewQuery.isLoading || previewQuery.isFetching ? (
                <p className="p-3 text-sm text-muted-foreground">Previewing…</p>
              ) : previewQuery.isError ? (
                <p className="p-3 text-sm text-destructive">
                  Could not preview this preset.
                </p>
              ) : summary ? (
                <div className="divide-y">
                  <div className="grid grid-cols-2 gap-2 p-3 text-sm sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Team to add</p>
                      <p className="font-semibold">{summary.will_add_team_members}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Stakeholders to add</p>
                      <p className="font-semibold">{summary.will_add_stakeholders}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Already on project</p>
                      <p className="font-semibold">{summary.already_exists}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Skipped</p>
                      <p className="font-semibold">{summary.skipped_ineligible}</p>
                    </div>
                  </div>

                  {hasBlockingErrors && (
                    <div className="p-3 text-sm text-destructive space-y-1">
                      {previewErrors.length === 0 ? (
                        <p>This preset cannot be applied to this project.</p>
                      ) : (
                        previewErrors.map((e, i) => (
                          <p key={`${e.code}-${i}`}>{e.message}</p>
                        ))
                      )}
                    </div>
                  )}

                  {!hasBlockingErrors && nothingToAdd && (
                    <p className="p-3 text-sm text-muted-foreground">
                      Every eligible person from the preset is already on this project.
                    </p>
                  )}

                  {!hasBlockingErrors && grouped.willAdd.length > 0 && (
                    <div className="p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge variant="secondary">{CLASSIFICATION_LABELS.will_add}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {grouped.willAdd.length}
                        </span>
                      </div>
                      <div className="max-h-40 overflow-y-auto">
                        {grouped.willAdd.map((it) => (
                          <ItemRow key={it.member_id} item={it} />
                        ))}
                      </div>
                    </div>
                  )}

                  {!hasBlockingErrors && grouped.alreadyExists.length > 0 && (
                    <div className="p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge variant="outline">
                          {CLASSIFICATION_LABELS.already_exists}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {grouped.alreadyExists.length}
                        </span>
                      </div>
                      <div className="max-h-32 overflow-y-auto">
                        {grouped.alreadyExists.map((it) => (
                          <ItemRow key={it.member_id} item={it} />
                        ))}
                      </div>
                    </div>
                  )}

                  {!hasBlockingErrors && grouped.ineligible.length > 0 && (
                    <div className="p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge variant="outline">Ineligible / skipped</Badge>
                        <span className="text-xs text-muted-foreground">
                          {grouped.ineligible.length}
                        </span>
                      </div>
                      <div className="max-h-32 overflow-y-auto">
                        {grouped.ineligible.map((it) => (
                          <ItemRow key={it.member_id} item={it} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={apply.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!canApply}>
            {apply.isPending ? "Applying…" : "Apply preset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
