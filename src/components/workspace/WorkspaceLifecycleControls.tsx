// Wave 5 Step 5.9 — Workspace lifecycle controls (boundary object).
//
// Renders the canonical Active/Inactive badge plus an Org-Admin-only
// Deactivate/Reactivate control. There is NO Permanent Delete affordance —
// workspaces are boundary objects, not business objects.

import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import { Power, PowerOff, Loader2 } from "lucide-react";
import {
  LifecycleBadge,
  BOUNDARY_LIFECYCLE_LABELS,
  WORKSPACE_DEACTIVATE_COPY,
  WORKSPACE_REACTIVATE_COPY,
} from "@/lib/lifecycleVocabulary";
import {
  useDeactivateWorkspace,
  useReactivateWorkspace,
} from "@/hooks/useWorkspaceLifecycle";

interface Props {
  workspaceId: string;
  workspaceName: string;
  isActive: boolean;
  /** Org-Admin only — controls Deactivate/Reactivate visibility. */
  canManageLifecycle: boolean;
}

export function WorkspaceLifecycleControls({
  workspaceId,
  workspaceName,
  isActive,
  canManageLifecycle,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const deactivate = useDeactivateWorkspace();
  const reactivate = useReactivateWorkspace();
  const isPending = deactivate.isPending || reactivate.isPending;

  const handleConfirm = () => {
    if (isActive) {
      deactivate.mutate(workspaceId, {
        onSuccess: () => setConfirmOpen(false),
      });
    } else {
      reactivate.mutate(workspaceId, {
        onSuccess: () => setConfirmOpen(false),
      });
    }
  };

  return (
    <div className="flex items-center gap-2">
      <LifecycleBadge kind="boundary" isActive={isActive} />
      {canManageLifecycle && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => setConfirmOpen(true)}
        >
          {isActive ? (
            <>
              <PowerOff className="h-4 w-4 mr-1" />
              {BOUNDARY_LIFECYCLE_LABELS.deactivate}
            </>
          ) : (
            <>
              <Power className="h-4 w-4 mr-1" />
              {BOUNDARY_LIFECYCLE_LABELS.activate}
            </>
          )}
        </Button>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isActive ? "Deactivate" : "Reactivate"} this workspace?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  <strong>{workspaceName}</strong> will be{" "}
                  {isActive ? "deactivated" : "reactivated"}.
                </p>
                <p className="text-muted-foreground">
                  {isActive
                    ? WORKSPACE_DEACTIVATE_COPY
                    : WORKSPACE_REACTIVATE_COPY}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
            >
              {isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {isActive
                ? BOUNDARY_LIFECYCLE_LABELS.deactivate
                : BOUNDARY_LIFECYCLE_LABELS.activate}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface BannerProps {
  isActive: boolean;
}

export function WorkspaceInactiveBanner({ isActive }: BannerProps) {
  if (isActive) return null;
  return (
    <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm flex items-start gap-2">
      <PowerOff className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div>
        <p className="font-medium text-foreground">Workspace is Inactive</p>
        <p className="text-xs text-muted-foreground">
          This workspace is currently read-only. Projects, phases, and tasks
          cannot be edited until an Org Admin reactivates the workspace. All
          data and history are preserved.
        </p>
      </div>
    </div>
  );
}
