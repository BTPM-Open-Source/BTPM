/**
 * DC.15 / Phase 6B.4b — SharePoint evidence file picker for Decision Cases.
 *
 * Thin wrapper around the canonical `SharePointFilePicker` shell. Browse +
 * select UX is provided by the canonical component; this wrapper still owns
 * Decision-Case-specific concerns:
 *   - browse via `browse-governance-decision-sharepoint-files` (record-scoped).
 *   - default relevance level and "include in stakeholder package" toggle.
 *   - commit via `select-governance-decision-sharepoint-evidence-files`.
 *
 * No file contents are downloaded. No pasted URLs are accepted.
 */
import { useState } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  useBrowseGovernanceDecisionSharePointFiles,
  useSelectGovernanceDecisionSharePointEvidenceFiles,
  type EvidenceFileRelevance,
} from "@/hooks/useGovernanceEvidenceFiles";
import {
  SharePointFilePicker,
  type SharePointFilePickerLoadResult,
  type SharePointFilePickerPick,
} from "@/components/sharepoint/SharePointFilePicker";

export function DecisionCaseSharePointEvidenceFilePicker({
  open,
  onOpenChange,
  recordId,
  onSelected,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  recordId: string;
  onSelected?: () => void;
}) {
  const browseMutation = useBrowseGovernanceDecisionSharePointFiles(recordId);
  const selectMutation = useSelectGovernanceDecisionSharePointEvidenceFiles(recordId);
  const [relevance, setRelevance] = useState<EvidenceFileRelevance>("medium");
  const [included, setIncluded] = useState(true);

  const loadFolder = async (args: {
    folderDriveId?: string;
    folderItemId?: string;
  }): Promise<SharePointFilePickerLoadResult> => {
    const res = await browseMutation.mutateAsync({
      folderItemId: args.folderItemId,
      folderDriveId: args.folderDriveId,
    });
    if (res.ok === true) {
      return {
        ok: true,
        driveId: res.drive_id,
        siteId: res.site_id,
        root: { id: res.root.id, name: res.root.name, webUrl: res.root.web_url },
        current: { id: res.current.id, name: res.current.name, webUrl: res.current.web_url },
        breadcrumbs: res.breadcrumbs,
        items: res.items.map((it) => ({
          id: it.id,
          driveId: it.drive_id,
          siteId: it.site_id,
          name: it.name,
          isFolder: it.is_folder,
          size: it.size,
          mimeType: it.mime_type,
          webUrl: it.web_url,
          childCount: it.child_count,
        })),
      };
    }
    const unavailable =
      res.error === "project_sharepoint_folder_not_configured";
    return {
      ok: false,
      error: res.error,
      note: unavailable
        ? "This project does not have a connected SharePoint folder yet. Connect the project folder before selecting evidence files."
        : res.note,
      unavailable,
    };
  };

  const onConfirm = async (picks: SharePointFilePickerPick[]) => {
    const res = await selectMutation.mutateAsync(
      picks.map((p) => ({
        siteId: p.siteId ?? "",
        driveId: p.driveId,
        itemId: p.itemId,
        relevanceLevel: relevance,
        includedInPackage: included,
      })),
    );
    if (!res.ok) {
      toast.error(res.note ?? res.error ?? "Could not add files.");
      return;
    }
    const parts: string[] = [];
    if (res.inserted) parts.push(`${res.inserted} added`);
    if (res.duplicates) parts.push(`${res.duplicates} already attached`);
    if (res.failed) parts.push(`${res.failed} failed`);
    toast.success(parts.join(" • ") || "Files added.");
    onSelected?.();
    onOpenChange(false);
  };

  return (
    <SharePointFilePicker
      open={open}
      onOpenChange={onOpenChange}
      resetKey={recordId}
      title="Add SharePoint evidence files"
      description="Browse the project SharePoint folder and select files to attach as evidence. BTPM stores secure references — file contents stay in SharePoint and follow SharePoint permissions."
      multiSelect
      loadFolder={loadFolder}
      onConfirm={onConfirm}
      isConfirming={selectMutation.isPending}
      confirmLabel={(n) => (selectMutation.isPending ? "Adding…" : `Add ${n} file${n === 1 ? "" : "s"}`)}
      extraControls={
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Default relevance</Label>
              <Select
                value={relevance}
                onValueChange={(v) => setRelevance(v as EvidenceFileRelevance)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm self-end">
              <Checkbox
                checked={included}
                onCheckedChange={(v) => setIncluded(v === true)}
              />
              Include in stakeholder package
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            OneNote page links cannot currently be packaged directly. Export
            OneNote pages as PDF/Word/TXT into this project folder, then
            select the exported file here.
          </p>
        </>
      }
    />
  );
}
