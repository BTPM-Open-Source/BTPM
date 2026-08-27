/**
 * Step API-ADM.5C — direct Project access administration for one Connected App
 * within one selected Workspace, rendered inside the unified Workspace Manage
 * Sheet.
 *
 * Reuses exactly the accepted API-G.5.8C Project contract:
 *   read:  public.api_g_5_7_admin_list_workspace_client_projects
 *   write: public.api_g_5_7_admin_transition_project_client
 *
 * Explicit context props only: no global Organization selection, no frontend
 * role inference, no direct table access, no permission-grant calls, no browser
 * persistence APIs, and no client-only row filtering. Project identity comes
 * only from an authorized list row.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminEmptyState } from "./SaasAdminShell";
import {
  PROJECT_DISABLE_ERROR,
  PROJECT_ENABLE_ERROR,
  PROJECT_SCOPE_PAGE_SIZE,
  projectAccessLabel,
  projectAccessVariant,
  resolveProjectParentNotice,
  resolveProjectRowAction,
  type ProjectTargetLifecycle,
  type WorkspaceClientProjectRow,
} from "./connectedAppProjectAccessModel";

const PROJECT_LIST_RPC = "api_g_5_7_admin_list_workspace_client_projects";
const PROJECT_TRANSITION_RPC = "api_g_5_7_admin_transition_project_client";

export const PROJECT_ACCESS_DESCRIPTION =
  "Choose which Projects this application can access in this Workspace.";

export interface ConnectedAppProjectAccessProps {
  readonly organizationId: string;
  readonly apiClientId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly organizationEnablementStatus: string | null;
  readonly workspaceEnablementStatus: string | null;
  /**
   * API-ADM.7 — optional caller-owned parent summary query key. Callers that
   * render this surface under their own Connected Apps list (Organization Admin
   * or Tenant Admin) pass their list key so summary counts refresh after a
   * successful mutation. No role inference happens here.
   */
  readonly parentSummaryQueryKey?: readonly unknown[];
}

interface PendingProjectAccessAction {
  organizationId: string;
  apiClientId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  previousProjectEnablementStatus: string | null;
  targetLifecycleStatus: ProjectTargetLifecycle;
}

export default function ConnectedAppProjectAccess({
  organizationId,
  apiClientId,
  workspaceId,
  workspaceName,
  organizationEnablementStatus,
  workspaceEnablementStatus,
  parentSummaryQueryKey,
}: ConnectedAppProjectAccessProps) {
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingProjectAccessAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Organization / application / Workspace change resets pagination, filter,
  // pending action and bounded action error.
  useEffect(() => {
    setPage(0);
    setIncludeArchived(false);
    setPendingAction(null);
    setActionError(null);
  }, [organizationId, apiClientId, workspaceId]);

  const { data, isLoading, error } = useQuery({
    queryKey: [
      "connected-app-project-access",
      organizationId,
      apiClientId,
      workspaceId,
      includeArchived,
      page,
    ],
    enabled: !!organizationId && !!apiClientId && !!workspaceId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(PROJECT_LIST_RPC, {
        _organization_id: organizationId,
        _workspace_id: workspaceId,
        _api_client_id: apiClientId,
        _include_archived: includeArchived,
        _limit: PROJECT_SCOPE_PAGE_SIZE,
        _offset: page * PROJECT_SCOPE_PAGE_SIZE,
      });
      if (error) throw error;
      return (data ?? []) as WorkspaceClientProjectRow[];
    },
  });

  const transition = useMutation({
    mutationFn: async (action: PendingProjectAccessAction) => {
      if (!organizationId || !apiClientId || !workspaceId) throw new Error("context_mismatch");
      if (action.organizationId !== organizationId) throw new Error("context_mismatch");
      if (action.apiClientId !== apiClientId) throw new Error("context_mismatch");
      if (action.workspaceId !== workspaceId) throw new Error("context_mismatch");
      if (!action.projectId) throw new Error("context_mismatch");
      const { error } = await (supabase.rpc as any)(PROJECT_TRANSITION_RPC, {
        _organization_id: action.organizationId,
        _workspace_id: action.workspaceId,
        _project_id: action.projectId,
        _api_client_id: action.apiClientId,
        _target_lifecycle_status: action.targetLifecycleStatus,
      });
      if (error) throw error;
      return action;
    },
    onSuccess: async (action) => {
      await queryClient.invalidateQueries({
        queryKey: [
          "connected-app-project-access",
          action.organizationId,
          action.apiClientId,
          action.workspaceId,
        ],
      });
      await queryClient.invalidateQueries({
        queryKey: ["connected-app-workspace-access", action.organizationId, action.apiClientId],
      });
      // API-ADM.6A — refresh parent Connected Apps summary counts.
      await queryClient.invalidateQueries({
        queryKey: ["connected-apps", action.organizationId],
      });
      if (parentSummaryQueryKey) {
        await queryClient.invalidateQueries({ queryKey: parentSummaryQueryKey });
      }
      setPendingAction(null);
      setActionError(null);
    },
    onError: (err: any, action) => {
      if (err?.message === "context_mismatch") {
        setPendingAction(null);
        setActionError(null);
        return;
      }
      setActionError(
        action.targetLifecycleStatus === "disabled"
          ? PROJECT_DISABLE_ERROR
          : PROJECT_ENABLE_ERROR,
      );
    },
  });

  const isPending = transition.isPending;
  const rows = data ?? [];
  const totalCount = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
  const rangeEnd = page * PROJECT_SCOPE_PAGE_SIZE + rows.length;
  const canPrev = page > 0;
  const canNext = rangeEnd < totalCount;

  const parentNotice = resolveProjectParentNotice(
    organizationEnablementStatus,
    workspaceEnablementStatus,
  );

  // Project identity comes only from an authorized list row.
  const openProjectAction = (
    row: WorkspaceClientProjectRow,
    target: ProjectTargetLifecycle,
  ) => {
    if (!organizationId || !apiClientId || !workspaceId || isPending) return;
    setActionError(null);
    setPendingAction({
      organizationId,
      apiClientId,
      workspaceId,
      projectId: row.project_id,
      projectName: row.project_name,
      previousProjectEnablementStatus: row.project_enablement_status,
      targetLifecycleStatus: target,
    });
  };

  const closeConfirmation = () => {
    if (isPending) return;
    setPendingAction(null);
    setActionError(null);
  };

  const pendingIsDisable = pendingAction?.targetLifecycleStatus === "disabled";
  const pendingIsReenable =
    pendingAction?.targetLifecycleStatus === "enabled" &&
    pendingAction?.previousProjectEnablementStatus === "disabled";
  const confirmVerb = pendingIsDisable ? "Disable" : pendingIsReenable ? "Re-enable" : "Enable";
  const confirmPendingLabel = pendingIsDisable
    ? "Disabling…"
    : pendingIsReenable
      ? "Re-enabling…"
      : "Enabling…";

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-foreground">Project access</h4>
        <p className="text-xs text-muted-foreground">{PROJECT_ACCESS_DESCRIPTION}</p>
      </div>

      {parentNotice && <p className="text-xs text-muted-foreground">{parentNotice}</p>}

      <div className="flex items-center gap-2">
        <Switch
          id="project-access-show-archived"
          checked={includeArchived}
          onCheckedChange={(checked) => {
            setIncludeArchived(checked);
            setPage(0);
          }}
        />
        <Label
          htmlFor="project-access-show-archived"
          className="text-xs font-normal text-muted-foreground"
        >
          Show archived
        </Label>
      </div>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}

      {error && <p className="text-sm text-destructive">Failed to load Project access.</p>}

      {!isLoading && !error && rows.length === 0 && (
        <AdminEmptyState
          title="No Projects found"
          description="No Projects are available for this Workspace and current filter."
        />
      )}

      {!error && rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Project</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const action = resolveProjectRowAction(
                row.project_enablement_status,
                organizationEnablementStatus,
                workspaceEnablementStatus,
                row.project_is_archived,
              );
              return (
                <TableRow key={row.project_id}>
                  <TableCell className="text-sm font-medium text-foreground">
                    <span>{row.project_name}</span>
                    {row.project_is_archived && (
                      <Badge variant="outline" className="ml-2 font-normal">
                        Archived
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={projectAccessVariant(row.project_enablement_status)}
                      className="font-normal"
                    >
                      {projectAccessLabel(row.project_enablement_status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {action.target === null ? (
                      <div className="flex flex-col items-start gap-1">
                        <Button variant="outline" size="sm" disabled>
                          {action.label}
                        </Button>
                        <span className="text-xs text-muted-foreground">{action.reason}</span>
                      </div>
                    ) : (
                      <Button
                        variant={action.kind === "disable" ? "outline" : "default"}
                        size="sm"
                        disabled={isPending}
                        onClick={() => openProjectAction(row, action.target!)}
                      >
                        {action.label}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {!error && rows.length > 0 && (canPrev || canNext) && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canPrev}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canNext}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <AlertDialog
        open={!!pendingAction}
        onOpenChange={(next) => {
          if (!next) closeConfirmation();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmVerb} {pendingAction?.projectName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingIsDisable
                ? `This removes application access to this Project in ${workspaceName}. Existing configuration is retained and can be re-enabled.`
                : `This allows the application to access this Project in ${workspaceName}. Runtime access still requires every other applicable authorization check.`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {actionError && <p className="text-sm text-destructive">{actionError}</p>}

          <AlertDialogFooter>
            <Button variant="outline" onClick={closeConfirmation} disabled={isPending}>
              Cancel
            </Button>
            <Button
              disabled={isPending}
              onClick={() => {
                if (!pendingAction || isPending) return;
                transition.mutate(pendingAction);
              }}
            >
              {isPending ? confirmPendingLabel : confirmVerb}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
