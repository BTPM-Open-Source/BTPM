/**
 * Phase 6B.4b — Roadmap Story Pack SharePoint file picker wrapper.
 *
 * Thin wrapper around the canonical `SharePointFilePicker`. Story Pack is
 * roadmap-wide (not bound to a single project), so this wrapper lets the
 * user pick which project's connected SharePoint folder to browse, then
 * persists each chosen file reference via the controlled Story Pack RPC
 * (`add_roadmap_story_pack_external_file`) through `roadmapStoryPackService`.
 *
 * No file bytes / base64 are ever fetched, stored, or sent to AI. Only the
 * SharePoint metadata reference (drive id, item id, name, web url, mime
 * type, size) is captured.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

import { useWorkspaces, useWorkspaceProjects } from "@/hooks/useProjectOverview";
import { useProjectBinding } from "@/hooks/useSharepointBindings";
import { listChildren, type SpItem } from "@/lib/sharepointFileService";
import {
  SharePointFilePicker,
  type SharePointFilePickerLoadResult,
  type SharePointFilePickerPick,
} from "@/components/sharepoint/SharePointFilePicker";
import { addRoadmapStoryPackExternalFile } from "@/lib/roadmapStoryPackService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storyPackId: string;
  /** Optional defaults from the Roadmap filters (workspace_ids[], project_ids[]). */
  defaultWorkspaceId?: string | null;
  defaultProjectId?: string | null;
  onLinked?: () => void;
}

export function RoadmapStoryPackSharePointFilePickerDialog({
  open,
  onOpenChange,
  storyPackId,
  defaultWorkspaceId,
  defaultProjectId,
  onLinked,
}: Props) {
  const qc = useQueryClient();
  const workspaces = useWorkspaces();
  const [workspaceId, setWorkspaceId] = useState<string | null>(defaultWorkspaceId ?? null);
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setWorkspaceId(defaultWorkspaceId ?? null);
    setProjectId(defaultProjectId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-pick the only workspace if user has just one.
  useEffect(() => {
    if (!open) return;
    if (workspaceId) return;
    const list = workspaces.data ?? [];
    if (list.length === 1) setWorkspaceId(list[0].id);
  }, [open, workspaces.data, workspaceId]);

  const projects = useWorkspaceProjects(workspaceId ?? undefined);
  const binding = useProjectBinding(projectId ?? undefined);

  const bindingId = binding.data?.id ?? null;
  const bindingValidated = binding.data?.binding_status === "validated";
  const bindingResolved = binding.isFetched && !binding.isFetching;

  const loadFolder = async (args: {
    folderDriveId?: string;
    folderItemId?: string;
  }): Promise<SharePointFilePickerLoadResult> => {
    if (!projectId) {
      return {
        ok: false,
        error: "no_project_selected",
        note: "Select a workspace and project to browse its SharePoint folder.",
        unavailable: true,
      };
    }
    if (!bindingResolved) {
      return {
        ok: false,
        error: "binding_loading",
        note: "Checking this project's SharePoint folder…",
        unavailable: true,
      };
    }
    if (!bindingId) {
      return {
        ok: false,
        error: "no_binding",
        note: "This project does not have a connected SharePoint folder yet.",
        unavailable: true,
      };
    }
    if (!bindingValidated) {
      return {
        ok: false,
        error: "binding_not_validated",
        note: "This project's SharePoint folder is not validated yet.",
        unavailable: true,
      };
    }
    try {
      const listing = await listChildren(bindingId, args.folderItemId);
      return {
        ok: true,
        driveId: listing.drive_id,
        siteId: null,
        root: { id: listing.root.id, name: listing.root.name, webUrl: listing.root.web_url },
        current: { id: listing.current.id, name: listing.current.name, webUrl: listing.current.web_url },
        breadcrumbs: listing.breadcrumbs,
        items: listing.items.map((it: SpItem) => ({
          id: it.id,
          driveId: it.drive_id || listing.drive_id,
          siteId: null,
          name: it.name,
          isFolder: it.type === "folder",
          size: it.size,
          mimeType: it.mime_type,
          webUrl: it.web_url ?? null,
          childCount: it.child_count,
        })),
      };
    } catch (e) {
      return {
        ok: false,
        error: "browse_failed",
        note: (e as Error)?.message ?? "Could not browse SharePoint folder.",
      };
    }
  };

  // Fallback drive ID resolved from the project binding row, used only when
  // the canonical picker did not surface a per-item drive id (it normally
  // does after Phase 6B.4c). We NEVER persist a placeholder like "unknown".
  const driveIdForBinding = useMemo(() => {
    return binding.data?.resolved_library_id_or_drive_id ?? "";
  }, [binding.data]);

  const onConfirm = async (picks: SharePointFilePickerPick[]) => {
    setConfirming(true);
    let added = 0;
    let failed = 0;
    let missingDrive = 0;
    for (const p of picks) {
      const driveId = (p.driveId || driveIdForBinding || "").trim();
      if (!driveId) {
        missingDrive += 1;
        continue;
      }
      try {
        await addRoadmapStoryPackExternalFile(storyPackId, {
          driveId,
          itemId: p.itemId,
          displayName: p.name,
          webUrl: p.webUrl ?? null,
          mimeType: p.mimeType ?? null,
          sizeBytes: p.size,
          includeInStory: true,
          provider: "sharepoint",
        });
        added += 1;
      } catch {
        failed += 1;
      }
    }
    setConfirming(false);
    if (added > 0) {
      const extras: string[] = [];
      if (failed > 0) extras.push(`${failed} failed`);
      if (missingDrive > 0) extras.push(`${missingDrive} skipped (no SharePoint drive ID)`);
      toast({
        title: `${added} file${added === 1 ? "" : "s"} linked`,
        description: extras.length > 0 ? extras.join(" · ") : undefined,
      });
      qc.invalidateQueries({ queryKey: ["roadmap-story-pack-config", storyPackId] });
      qc.invalidateQueries({ queryKey: ["roadmap-story-packs"] });
      onLinked?.();
      onOpenChange(false);
    } else if (missingDrive > 0 && failed === 0) {
      toast({
        title: "Could not link files",
        description:
          "SharePoint did not return a drive ID for the selected file(s). Please retry, or open the folder again.",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Could not link files",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const workspaceList = workspaces.data ?? [];
  const projectList = projects.data ?? [];

  // When projectId is unselected, render an emptyState in the dialog body.
  const emptyState =
    !projectId
      ? "Select a workspace and project above to browse its connected SharePoint folder."
      : null;

  return (
    <SharePointFilePicker
      open={open}
      onOpenChange={onOpenChange}
      resetKey={`${storyPackId}:${projectId ?? ""}:${bindingResolved ? bindingId ?? "none" : "loading"}`}
      title="Link SharePoint files"
      description="Select SharePoint files to reference as context for this Story Pack. Included files may be read server-side during Story Draft generation, subject to type and size limits."
      multiSelect
      loadFolder={loadFolder}
      onConfirm={onConfirm}
      isConfirming={confirming}
      confirmLabel={(n) => (confirming ? "Linking…" : `Link ${n} file${n === 1 ? "" : "s"}`)}
      confirmDisabled={!projectId || !bindingValidated}
      emptyState={emptyState}
      headerSlot={
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Workspace</Label>
            <Select
              value={workspaceId ?? ""}
              onValueChange={(v) => {
                setWorkspaceId(v || null);
                setProjectId(null);
              }}
              disabled={workspaces.isLoading || workspaceList.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={workspaces.isLoading ? "Loading…" : "Pick a workspace"} />
              </SelectTrigger>
              <SelectContent>
                {workspaceList.map((w: { id: string; name: string }) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Project</Label>
            <Select
              value={projectId ?? ""}
              onValueChange={(v) => setProjectId(v || null)}
              disabled={!workspaceId || projects.isLoading || projectList.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !workspaceId
                      ? "Pick a workspace first"
                      : projects.isLoading
                      ? "Loading…"
                      : projectList.length === 0
                      ? "No projects"
                      : "Pick a project"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {projectList.map((p: { id: string; name: string }) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      }
    />
  );
}
