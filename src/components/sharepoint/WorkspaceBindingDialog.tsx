/**
 * Workspace SharePoint library assignment dialog (Org Admin only).
 *
 * Assumes the organization SharePoint site is already connected. This dialog
 * captures only the library that lives under that site for this workspace.
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, ExternalLink } from "lucide-react";
import { useUpsertWorkspaceBinding } from "@/hooks/useSharepointWorkspaceBindingMutations";
import type { SharepointWorkspaceBinding } from "@/lib/sharepointBindingTypes";
import type { SharepointOrgSiteConnection } from "@/lib/sharepointOrgSiteService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceName?: string;
  orgSite: SharepointOrgSiteConnection;
  existing?: SharepointWorkspaceBinding | null;
  onSaved?: (binding: SharepointWorkspaceBinding) => void;
}

function isLibraryUnderSite(libraryUrl: string, siteUrl: string): boolean {
  if (!libraryUrl || !siteUrl) return false;
  const lib = libraryUrl.trim().toLowerCase();
  const site = siteUrl.trim().toLowerCase().replace(/\/+$/, "");
  return lib.startsWith(site);
}

export function WorkspaceBindingDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  orgSite,
  existing,
  onSaved,
}: Props) {
  const upsert = useUpsertWorkspaceBinding(workspaceId);

  const [libraryWebUrl, setLibraryWebUrl] = useState("");
  const [libraryLabel, setLibraryLabel] = useState("");

  useEffect(() => {
    if (!open) return;
    setLibraryWebUrl(existing?.library_web_url ?? "");
    setLibraryLabel(existing?.library_label_or_name ?? "");
  }, [open, existing]);

  const trimmed = libraryWebUrl.trim();
  const underSite = trimmed.length === 0 || isLibraryUnderSite(trimmed, orgSite.site_web_url);
  const canSubmit = trimmed.length > 0 && underSite;

  const handleSubmit = async () => {
    const result = await upsert.mutateAsync({
      workspaceId,
      // Site fields are derived server-side from the org site connection.
      // We pass them as null; the RPC ignores client-provided site values.
      siteWebUrl: orgSite.site_web_url,
      libraryWebUrl: trimmed,
      libraryLabelOrName: libraryLabel.trim() || null,
      managedOutsideBtpm: true,
    });
    onSaved?.(result);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Change library assignment" : "Assign library"}
            {workspaceName ? ` — ${workspaceName}` : ""}
          </DialogTitle>
          <DialogDescription>
            Pick the SharePoint document library on the organization site for this
            workspace. Libraries are created in SharePoint outside BTPM.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs flex items-center gap-1 flex-wrap">
              <span>Organization site:</span>
              <a
                href={orgSite.site_web_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1 break-all"
              >
                {orgSite.site_label_or_name || orgSite.site_web_url}
                <ExternalLink className="h-3 w-3" />
              </a>
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <FieldLabel required>Library URL</FieldLabel>
            <Input
              value={libraryWebUrl}
              onChange={(e) => setLibraryWebUrl(e.target.value)}
              placeholder={`${orgSite.site_web_url.replace(/\/+$/, "")}/WorkspaceXLibrary`}
            />
            <p className="text-xs text-muted-foreground">
              Must live under the organization SharePoint site above.
            </p>
            {trimmed.length > 0 && !underSite && (
              <p className="text-xs text-destructive">
                This URL is not under the organization site.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <FieldLabel>Library label (optional)</FieldLabel>
            <Input
              value={libraryLabel}
              onChange={(e) => setLibraryLabel(e.target.value)}
              placeholder="Workspace X documents"
            />
          </div>

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Saving captures the link only. Run "Validate" to verify it via
              Microsoft Graph.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || upsert.isPending}>
            {existing ? "Save changes" : "Assign library"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
