/**
 * Step API-ADM.5B — Workspace access administration for one Connected App,
 * rendered inside the unified Access & permissions experience, plus a
 * right-side Sheet for managing one Workspace's permissions.
 *
 * Reuses exactly the accepted API-G.5.8B contract:
 *   read:  public.api_g_5_7_admin_list_organization_client_workspaces
 *   write: public.api_g_5_7_admin_transition_workspace_client
 *
 * Explicit context props only: no global Organization selection, no frontend
 * role inference, no direct table access, no Project administration, and no
 * browser persistence APIs.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  ORGANIZATION_BLOCK_REASON,
  WORKSPACE_SCOPE_PAGE_SIZE,
  accessLabel,
  accessVariant,
  resolveWorkspaceRowAction,
  type OrganizationClientWorkspaceRow,
  type WorkspaceTargetLifecycle,
} from "./connectedAppWorkspaceAccessModel";
import ConnectedAppWorkspacePermissions from "./ConnectedAppWorkspacePermissions";
import ConnectedAppProjectAccess from "./ConnectedAppProjectAccess";

const WORKSPACE_LIST_RPC = "api_g_5_7_admin_list_organization_client_workspaces";
const WORKSPACE_TRANSITION_RPC = "api_g_5_7_admin_transition_workspace_client";

export const WORKSPACE_ACCESS_DESCRIPTION =
  "Choose where the application can operate within this Organization.";

export interface ConnectedAppWorkspaceAccessProps {
  readonly organizationId: string;
  readonly apiClientId: string;
  readonly clientLifecycleStatus: string;
  readonly organizationEnablementStatus: string | null;
  /**
   * API-ADM.7 — optional caller-owned parent summary query key. Callers that
   * render this surface under their own Connected Apps list (Organization Admin
   * or Tenant Admin) pass their list key so summary counts refresh after a
   * successful mutation. No role inference happens here.
   */
  readonly parentSummaryQueryKey?: readonly unknown[];
}

interface PendingWorkspaceAccessAction {
  organizationId: string;
  apiClientId: string;
  workspaceId: string;
  workspaceName: string;
  previousWorkspaceEnablementStatus: string | null;
  targetLifecycleStatus: WorkspaceTargetLifecycle;
}

interface ManagedWorkspace {
  organizationId: string;
  apiClientId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceEnablementStatus: string | null;
  workspaceIsArchived: boolean;
  
}

function safeCount(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

export default function ConnectedAppWorkspaceAccess({
  organizationId,
  apiClientId,
  clientLifecycleStatus,
  organizationEnablementStatus,
  parentSummaryQueryKey,
}: ConnectedAppWorkspaceAccessProps) {
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingWorkspaceAccessAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [managed, setManaged] = useState<ManagedWorkspace | null>(null);

  // Context change resets pagination, filter, pending action and Sheet context.
  useEffect(() => {
    setPage(0);
    setIncludeArchived(false);
    setPendingAction(null);
    setActionError(null);
    setManaged(null);
  }, [organizationId, apiClientId]);

  const { data, isLoading, error } = useQuery({
    queryKey: [
      "connected-app-workspace-access",
      organizationId,
      apiClientId,
      includeArchived,
      page,
    ],
    enabled: !!organizationId && !!apiClientId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(WORKSPACE_LIST_RPC, {
        _organization_id: organizationId,
        _api_client_id: apiClientId,
        _include_archived: includeArchived,
        _limit: WORKSPACE_SCOPE_PAGE_SIZE,
        _offset: page * WORKSPACE_SCOPE_PAGE_SIZE,
      });
      if (error) throw error;
      return (data ?? []) as OrganizationClientWorkspaceRow[];
    },
  });

  const transition = useMutation({
    mutationFn: async (action: PendingWorkspaceAccessAction) => {
      if (!organizationId || !apiClientId) throw new Error("context_mismatch");
      if (action.organizationId !== organizationId) throw new Error("context_mismatch");
      if (action.apiClientId !== apiClientId) throw new Error("context_mismatch");
      if (!action.workspaceId) throw new Error("context_mismatch");
      const { error } = await (supabase.rpc as any)(WORKSPACE_TRANSITION_RPC, {
        _organization_id: action.organizationId,
        _workspace_id: action.workspaceId,
        _api_client_id: action.apiClientId,
        _target_lifecycle_status: action.targetLifecycleStatus,
      });
      if (error) throw error;
      return action;
    },
    onSuccess: async (action) => {
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
          ? "Could not disable this Workspace. Refresh the list and try again."
          : "Could not enable this Workspace. The application and Organization connection must be active, and the Workspace must be active and not archived.",
      );
    },
  });

  const isPending = transition.isPending;
  const rows = data ?? [];
  const totalCount = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
  const rangeEnd = page * WORKSPACE_SCOPE_PAGE_SIZE + rows.length;
  const canPrev = page > 0;
  const canNext = rangeEnd < totalCount;

  // Workspace identity comes only from an authorized list row.
  const openWorkspaceAction = (
    row: OrganizationClientWorkspaceRow,
    target: WorkspaceTargetLifecycle,
  ) => {
    if (!organizationId || !apiClientId || isPending) return;
    setActionError(null);
    setPendingAction({
      organizationId,
      apiClientId,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      previousWorkspaceEnablementStatus: row.workspace_enablement_status,
      targetLifecycleStatus: target,
    });
  };

  const openManage = (row: OrganizationClientWorkspaceRow) => {
    if (!organizationId || !apiClientId || isPending) return;
    setManaged({
      organizationId,
      apiClientId,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      workspaceEnablementStatus: row.workspace_enablement_status,
      workspaceIsArchived: !!row.workspace_is_archived,
      
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
    pendingAction?.previousWorkspaceEnablementStatus === "disabled";
  const confirmVerb = pendingIsDisable ? "Disable" : pendingIsReenable ? "Re-enable" : "Enable";
  const confirmPendingLabel = pendingIsDisable
    ? "Disabling…"
    : pendingIsReenable
      ? "Re-enabling…"
      : "Enabling…";

  const sheetOpen =
    !!managed &&
    managed.organizationId === organizationId &&
    managed.apiClientId === apiClientId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Workspace access</CardTitle>
        <CardDescription>{WORKSPACE_ACCESS_DESCRIPTION}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {organizationEnablementStatus !== "enabled" && (
          <p className="text-xs text-muted-foreground">{ORGANIZATION_BLOCK_REASON}</p>
        )}

        <div className="flex items-center gap-2">
          <Switch
            id="workspace-access-show-archived"
            checked={includeArchived}
            onCheckedChange={(checked) => {
              setIncludeArchived(checked);
              setPage(0);
            }}
          />
          <Label
            htmlFor="workspace-access-show-archived"
            className="text-xs font-normal text-muted-foreground"
          >
            Show archived
          </Label>
        </div>

        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {error && <p className="text-sm text-destructive">Failed to load Workspace access.</p>}

        {!isLoading && !error && rows.length === 0 && (
          <AdminEmptyState
            title="No Workspaces found"
            description="No Workspaces are available for this application and current filter."
          />
        )}

        {!error && rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Projects</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const action = resolveWorkspaceRowAction(
                  row.workspace_enablement_status,
                  organizationEnablementStatus,
                  row.workspace_is_archived,
                );
                const canManage = row.workspace_enablement_status !== null;
                return (
                  <TableRow key={row.workspace_id}>
                    <TableCell className="text-sm font-medium text-foreground">
                      <span>{row.workspace_name}</span>
                      {row.workspace_is_archived && (
                        <Badge variant="outline" className="ml-2 font-normal">
                          Archived
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={accessVariant(row.workspace_enablement_status)}
                        className="font-normal"
                      >
                        {accessLabel(row.workspace_enablement_status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {safeCount(row.enabled_project_count)} Project
                      {safeCount(row.enabled_project_count) === 1 ? "" : "s"}

                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {safeCount(row.enabled_capability_grant_count)} permission
                      {safeCount(row.enabled_capability_grant_count) === 1 ? "" : "s"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        {canManage && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() => openManage(row)}
                          >
                            Manage
                          </Button>
                        )}
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
                            onClick={() => openWorkspaceAction(row, action.target!)}
                          >
                            {action.label}
                          </Button>
                        )}
                      </div>
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
                {confirmVerb} {pendingAction?.workspaceName}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pendingIsDisable
                  ? "This disables application access for this Workspace. Existing configuration is retained and can be re-enabled."
                  : "This allows the application to operate in this Workspace. Runtime access still requires every other applicable authorization check."}
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

        <Sheet
          open={sheetOpen}
          onOpenChange={(next) => {
            if (!next) setManaged(null);
          }}
        >
          <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
            <SheetHeader>
              <SheetTitle>{managed?.workspaceName}</SheetTitle>
              <SheetDescription>Workspace access &amp; permissions</SheetDescription>
            </SheetHeader>

            {managed && (
              <div className="mt-4 space-y-6">
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-foreground">Workspace access</h4>
                  <p className="text-sm text-muted-foreground">
                    {accessLabel(managed.workspaceEnablementStatus)}
                  </p>
                </div>

                <ConnectedAppProjectAccess
                  organizationId={managed.organizationId}
                  apiClientId={managed.apiClientId}
                  workspaceId={managed.workspaceId}
                  workspaceName={managed.workspaceName}
                  organizationEnablementStatus={organizationEnablementStatus}
                  workspaceEnablementStatus={managed.workspaceEnablementStatus}
                  parentSummaryQueryKey={parentSummaryQueryKey}
                />


                <ConnectedAppWorkspacePermissions
                  organizationId={managed.organizationId}
                  apiClientId={managed.apiClientId}
                  workspaceId={managed.workspaceId}
                  workspaceName={managed.workspaceName}
                  clientLifecycleStatus={clientLifecycleStatus}
                  organizationEnablementStatus={organizationEnablementStatus}
                  workspaceEnablementStatus={managed.workspaceEnablementStatus}
                  workspaceIsArchived={managed.workspaceIsArchived}
                  parentSummaryQueryKey={parentSummaryQueryKey}
                />
              </div>
            )}
          </SheetContent>
        </Sheet>
      </CardContent>
    </Card>
  );
}
