/**
 * SP UX reset — Project Shared Files tab (SharePoint linker/launcher).
 *
 * BTPM is intentionally NOT a full SharePoint browser. This page only:
 *   - shows the connected project folder (simple state language)
 *   - launches it in SharePoint
 *   - lets authorized users change or disconnect the folder
 *   - shows a lightweight read-only listing of items inside the folder,
 *     each opening in SharePoint
 *
 * No upload, create, rename, delete, move, search, or in-app browsing.
 * No project-level admin diagnostics — those live in Admin → SharePoint.
 */

import { useEffect, useRef, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  Info,
  Link2,
  Unlink,
} from "lucide-react";
import {
  useProjectBinding,
  useWorkspaceBinding,
} from "@/hooks/useSharepointBindings";
import { useProjectPlanningAuthority } from "@/hooks/useProjectPlanningAuthority";
import { LightweightFolderPicker } from "@/components/sharepoint/LightweightFolderPicker";
import { useValidateProjectBinding } from "@/hooks/useSharepointValidation";
import { useDisableProjectBinding as useDisableProjectBindingMut } from "@/hooks/useSharepointBindingMutations";
import { SharepointFolderContents } from "@/components/sharepoint/SharepointFolderContents";
import { KnowledgeLink } from "@/components/knowledge/KnowledgeLink";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface OutletCtx {
  project: { id: string; workspace_id: string; name: string };
  workspace: { id: string; name: string } | null;
}

export default function ProjectSharedFiles() {
  const { project } = useOutletContext<OutletCtx>();
  const { projectId } = useParams<{ projectId: string }>();

  const { canEdit } = useProjectPlanningAuthority(projectId);
  const { data: workspaceBinding, isLoading: wbLoading } = useWorkspaceBinding(project?.workspace_id);
  const { data: projectBinding, isLoading: pbLoading } = useProjectBinding(projectId);
  const validateMutation = useValidateProjectBinding(projectId);
  const disableMutation = useDisableProjectBindingMut(projectId);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Silent validation: whenever a binding becomes "linked_unvalidated"
  // (typical right after picker save) trigger a one-shot validation.
  const lastAutoValidatedId = useRef<string | null>(null);
  useEffect(() => {
    if (!projectBinding) return;
    if (
      projectBinding.binding_status === "linked_unvalidated" &&
      lastAutoValidatedId.current !== projectBinding.id
    ) {
      lastAutoValidatedId.current = projectBinding.id;
      validateMutation.mutate(projectBinding.id);
    }
  }, [projectBinding, validateMutation]);

  const isLoading = wbLoading || pbLoading;
  const workspaceValidated =
    !!workspaceBinding && workspaceBinding.binding_status === "validated";
  const isLinked = !!projectBinding && projectBinding.binding_status !== "disabled";
  const canPickFolder = canEdit && workspaceValidated;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Shared Files</h2>
          <p className="text-sm text-muted-foreground mt-1">
            This project's files live in SharePoint. Use the link below to open
            them. Manage files directly in SharePoint.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <KnowledgeLink slug="how-to-connect-project-to-sharepoint-folder" label="How to connect a project folder" />
            <KnowledgeLink slug="why-cant-i-open-sharepoint-folder-or-file" label="Can't open a folder or file?" />
          </div>
        </div>
      </div>

      {/* Workspace not validated → blocking message, no folder selection */}
      {!workspaceValidated && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>SharePoint not set up for this workspace yet</AlertTitle>
          <AlertDescription>
            A workspace admin needs to connect this workspace's SharePoint
            library before you can pick a project folder.
          </AlertDescription>
        </Alert>
      )}

      {/* Workspace OK, project not linked yet */}
      {workspaceValidated && !isLinked && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <FolderOpen className="h-10 w-10 text-muted-foreground mx-auto" />
            <div>
              <p className="font-medium text-foreground">No folder connected yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                {canEdit
                  ? "Choose this project's folder from SharePoint."
                  : "An admin or project manager has not connected a SharePoint folder for this project yet."}
              </p>
            </div>
            {canEdit && (
              <Button onClick={() => setPickerOpen(true)} size="sm">
                <Link2 className="h-4 w-4 mr-1" /> Choose folder
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Project linked — simplified card */}
      {isLinked && projectBinding && (
        <>
          <ConnectedFolderCard
            binding={projectBinding}
            workspaceName={workspaceBinding?.library_web_url}
            canEdit={canEdit}
            onChange={() => setPickerOpen(true)}
            onDisconnect={() => setConfirmDisconnect(true)}
            changeDisabled={!canPickFolder}
          />
          {projectBinding.binding_status === "validated" && (
            <SharepointFolderContents bindingId={projectBinding.id} />
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Permissions are managed in SharePoint. If you can't open a folder,
        contact your SharePoint administrator.
      </p>

      {pickerOpen && projectId && workspaceBinding && workspaceValidated && (
        <LightweightFolderPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          projectId={projectId}
          workspaceBindingId={workspaceBinding.id}
        />
      )}

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect this folder?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the link between this project and its SharePoint
              folder. The folder itself, and all files in SharePoint, are not
              changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (projectBinding) disableMutation.mutate(projectBinding.id);
                setConfirmDisconnect(false);
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConnectedFolderCard({
  binding,
  workspaceName,
  canEdit,
  onChange,
  onDisconnect,
  changeDisabled,
}: {
  binding: any;
  workspaceName?: string | null;
  canEdit: boolean;
  onChange: () => void;
  onDisconnect: () => void;
  changeDisabled: boolean;
}) {
  const status = binding.binding_status as string;
  // Derive a friendly folder name from the URL (final path segment).
  const friendlyName = (() => {
    try {
      const url = new URL(binding.folder_web_url);
      const seg = url.pathname.split("/").filter(Boolean).pop();
      return seg ? decodeURIComponent(seg) : "Project folder";
    } catch {
      return "Project folder";
    }
  })();
  const libraryName = (() => {
    if (!workspaceName) return null;
    try {
      const url = new URL(workspaceName);
      const seg = url.pathname.split("/").filter(Boolean).pop();
      return seg ? decodeURIComponent(seg) : null;
    } catch {
      return null;
    }
  })();

  const isHealthy = status === "validated";
  const isPending = status === "linked_unvalidated";
  const needsAttention = status === "invalid";

  return (
    <Card>
      <CardContent className="py-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="rounded-md bg-primary/10 p-2 shrink-0">
              <FolderOpen className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-foreground truncate" title={friendlyName}>
                {friendlyName}
              </div>
              {libraryName && (
                <div className="text-xs text-muted-foreground truncate">
                  in {libraryName}
                </div>
              )}
              <div className="mt-1">
                {isHealthy && (
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
                  </Badge>
                )}
                {isPending && (
                  <Badge variant="outline" className="bg-muted text-muted-foreground">
                    Connecting…
                  </Badge>
                )}
                {needsAttention && (
                  <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                    <AlertTriangle className="h-3 w-3 mr-1" /> Needs attention
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <a href={binding.folder_web_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-1" /> Open in SharePoint
              </a>
            </Button>
            {canEdit && (
              <>
                <Button size="sm" variant="outline" onClick={onChange} disabled={changeDisabled}>
                  <FolderOpen className="h-4 w-4 mr-1" /> Change folder
                </Button>
                <Button size="sm" variant="ghost" onClick={onDisconnect}>
                  <Unlink className="h-4 w-4 mr-1" /> Disconnect
                </Button>
              </>
            )}
          </div>
        </div>

        {needsAttention && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>This folder needs attention</AlertTitle>
            <AlertDescription className="text-xs">
              The connection to SharePoint isn't working right now.
              {canEdit
                ? " Try choosing the folder again, or contact your administrator."
                : " Ask a project manager or admin to reconnect it."}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
