/**
 * SP.3a — Manual link/edit dialog for a project SharePoint folder binding.
 *
 * Non-live: this dialog ONLY captures metadata. It does not call Microsoft
 * Graph and does not verify that the folder exists or that the current user
 * has access. The resulting binding is saved as `linked_unvalidated`.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { useUpsertProjectBinding } from "@/hooks/useSharepointBindingMutations";
import { useValidateProjectBinding } from "@/hooks/useSharepointValidation";
import type {
  SharepointProjectBinding,
  SharepointProjectBindingMode,
} from "@/lib/sharepointBindingTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workspaceHasBinding: boolean;
  existing?: SharepointProjectBinding | null;
}

export function LinkProjectFolderDialog({
  open,
  onOpenChange,
  projectId,
  workspaceHasBinding,
  existing,
}: Props) {
  const upsert = useUpsertProjectBinding(projectId);
  const validate = useValidateProjectBinding(projectId);

  const [mode, setMode] = useState<SharepointProjectBindingMode>("workspace_library_default");
  const [folderWebUrl, setFolderWebUrl] = useState("");
  const [folderRelativePath, setFolderRelativePath] = useState("");
  const [resolvedSiteWebUrl, setResolvedSiteWebUrl] = useState("");
  const [resolvedLibraryWebUrl, setResolvedLibraryWebUrl] = useState("");

  useEffect(() => {
    if (!open) return;
    setMode(existing?.binding_mode ?? "workspace_library_default");
    setFolderWebUrl(existing?.folder_web_url ?? "");
    setFolderRelativePath(existing?.folder_relative_path ?? "");
    setResolvedSiteWebUrl(existing?.resolved_site_web_url ?? "");
    setResolvedLibraryWebUrl(existing?.resolved_library_web_url ?? "");
  }, [open, existing]);

  const isOverride = mode !== "workspace_library_default";
  const canSubmit =
    folderWebUrl.trim().length > 0 &&
    (!isOverride || (resolvedSiteWebUrl.trim().length > 0 && resolvedLibraryWebUrl.trim().length > 0)) &&
    (mode !== "workspace_library_default" || workspaceHasBinding);

  const handleSubmit = async () => {
    const saved = await upsert.mutateAsync({
      projectId,
      bindingMode: mode,
      folderWebUrl: folderWebUrl.trim(),
      folderRelativePath: folderRelativePath.trim() || null,
      resolvedSiteWebUrl: isOverride ? resolvedSiteWebUrl.trim() : null,
      resolvedLibraryWebUrl: isOverride ? resolvedLibraryWebUrl.trim() : null,
    });
    onOpenChange(false);
    // Auto-trigger live validation against Microsoft Graph
    if (saved?.id) {
      validate.mutate(saved.id);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit linked folder" : "Link existing folder"}</DialogTitle>
          <DialogDescription>
            Capture the SharePoint folder for this project. After saving, BTPM
            will run a live validation against Microsoft Graph to confirm the
            folder exists under the expected library.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <FieldLabel>Binding mode</FieldLabel>
            <Select value={mode} onValueChange={(v) => setMode(v as SharepointProjectBindingMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace_library_default" disabled={!workspaceHasBinding}>
                  Workspace library (default)
                </SelectItem>
                <SelectItem value="restricted_library_override">
                  Restricted library override
                </SelectItem>
                <SelectItem value="restricted_site_override">
                  Restricted site override
                </SelectItem>
              </SelectContent>
            </Select>
            {!workspaceHasBinding && mode === "workspace_library_default" && (
              <p className="text-xs text-muted-foreground">
                This workspace has no SharePoint library binding yet. Pick an override
                mode to link a folder anyway.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <FieldLabel required>Folder URL</FieldLabel>
            <Input
              value={folderWebUrl}
              onChange={(e) => setFolderWebUrl(e.target.value)}
              placeholder="https://contoso.sharepoint.com/sites/BTPM/Shared%20Documents/..."
            />
          </div>

          <div className="space-y-2">
            <FieldLabel>Folder server-relative path (optional)</FieldLabel>
            <Input
              value={folderRelativePath}
              onChange={(e) => setFolderRelativePath(e.target.value)}
              placeholder="/sites/BTPM/Shared Documents/Project Alpha"
            />
          </div>

          {isOverride && (
            <>
              <div className="space-y-2">
                <FieldLabel required>Override site URL</FieldLabel>
                <Input
                  value={resolvedSiteWebUrl}
                  onChange={(e) => setResolvedSiteWebUrl(e.target.value)}
                  placeholder="https://contoso.sharepoint.com/sites/RestrictedSite"
                />
              </div>
              <div className="space-y-2">
                <FieldLabel required>Override library URL</FieldLabel>
                <Input
                  value={resolvedLibraryWebUrl}
                  onChange={(e) => setResolvedLibraryWebUrl(e.target.value)}
                  placeholder="https://contoso.sharepoint.com/sites/RestrictedSite/RestrictedLibrary"
                />
              </div>
            </>
          )}

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              SharePoint access rights are managed outside BTPM. Saving this link
              does not grant anyone access to the folder.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || upsert.isPending}>
            {existing ? "Save changes" : "Link folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
