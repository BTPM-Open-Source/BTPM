import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminLoadingCards, AdminEmptyState } from "./SaasAdminShell";
import ConnectedAppManagementView, {
  DEFAULT_CONNECTED_APP_MANAGEMENT_TAB,
  type ConnectedAppAdminContext,
  type ConnectedAppManagementTab,
} from "./ConnectedAppManagementView";
import {
  CONNECTED_APPS_PAGE_SIZE as PAGE_SIZE,
  actionKindOf,
  buildConnectedAppsListQueryKey,
  connectionLabel,
  connectionVariant,
  lifecycleVariant,
  mapRowToManagementApp,
  resolveConnectedAppsPlaceholder,
  resolveRowAction,
  type OrganizationClientRow,
  type PendingConnectionAction,
  type TargetLifecycle,
} from "./connectedAppsOrganizationModel";

/**
 * Step API-ADM.8 — the single Organization Connected Apps administration
 * surface, shared by the Organization Admin caller (`AdminConnectedApps`) and
 * the Tenant Admin caller (`AdminTenantConnectedApps`).
 *
 * The Organization is supplied explicitly by the caller and is already
 * authorized. This component deliberately never reads ActiveContext.
 *
 * Reads only `public.api_g_5_7_admin_list_organization_clients`.
 * Mutates only via `public.api_g_5_7_admin_transition_organization_client`.
 * No direct table access, no secrets, no OAuth credentials.
 */

export interface ConnectedAppsOrganizationSurfaceProps {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly context: ConnectedAppAdminContext;
  readonly parentSummaryQueryKey: readonly unknown[];
}

export default function ConnectedAppsOrganizationSurface({
  organizationId,
  organizationName,
  context,
  parentSummaryQueryKey,
}: ConnectedAppsOrganizationSurfaceProps) {
  const queryClient = useQueryClient();
  const isTenantContext = context === "tenant";

  const [includeRetired, setIncludeRetired] = useState(false);
  const [page, setPage] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingConnectionAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // In-page list/detail model; only the client ID is retained as selection identity.
  const [managedApiClientId, setManagedApiClientId] = useState<string | null>(null);
  const [managementTab, setManagementTab] = useState<ConnectedAppManagementTab>(
    DEFAULT_CONNECTED_APP_MANAGEMENT_TAB,
  );

  // An Organization change is an identity boundary: no filter, page, pending
  // action, error or application selection may survive it.
  useEffect(() => {
    setPage(0);
    setIncludeRetired(false);
    setPendingAction(null);
    setActionError(null);
    setManagedApiClientId(null);
    setManagementTab(DEFAULT_CONNECTED_APP_MANAGEMENT_TAB);
  }, [organizationId]);

  const listQueryKey = useMemo(
    () => buildConnectedAppsListQueryKey(parentSummaryQueryKey, includeRetired, page),
    [parentSummaryQueryKey, includeRetired, page],
  );

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: listQueryKey,
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(
        "api_g_5_7_admin_list_organization_clients",
        {
          _organization_id: organizationId,
          _include_retired: includeRetired,
          _limit: PAGE_SIZE,
          _offset: page * PAGE_SIZE,
        },
      );
      if (error) throw error;
      return (data ?? []) as OrganizationClientRow[];
    },
    staleTime: 30_000,
    // Organization-aware placeholder: never render another Organization's rows.
    placeholderData: (previousData: OrganizationClientRow[] | undefined, previousQuery: any) =>
      resolveConnectedAppsPlaceholder(
        previousData,
        previousQuery?.queryKey,
        parentSummaryQueryKey,
        organizationId,
      ),
  });

  const transition = useMutation({
    mutationFn: async (action: PendingConnectionAction) => {
      // Organization containment: never execute a stale Organization action.
      if (!organizationId || action.organizationId !== organizationId) {
        throw new Error("context_mismatch");
      }
      const { error } = await (supabase.rpc as any)(
        "api_g_5_7_admin_transition_organization_client",
        {
          _organization_id: organizationId,
          _api_client_id: action.apiClientId,
          _target_lifecycle_status: action.targetLifecycleStatus,
        },
      );
      if (error) throw error;
      return action;
    },
    onSuccess: async (action) => {
      await queryClient.invalidateQueries({ queryKey: parentSummaryQueryKey });
      setPendingAction(null);
      setActionError(null);
      // A disconnected application must not stay open as "Connected".
      if (action.targetLifecycleStatus === "disabled") {
        setManagedApiClientId(null);
        setManagementTab(DEFAULT_CONNECTED_APP_MANAGEMENT_TAB);
      }
    },
    onError: (err: any, action) => {
      if (err?.message === "context_mismatch") {
        setPendingAction(null);
        setActionError(null);
        return;
      }
      setActionError(
        action.targetLifecycleStatus === "disabled"
          ? "Could not disconnect this application. Refresh the list and try again."
          : isTenantContext
            ? "Could not connect this application. It must be active and available for the selected Organization."
            : "Could not connect this application. It must be active and available for the current Organization.",
      );
    },
  });

  const isPending = transition.isPending;

  const rows = organizationId ? data ?? [] : [];
  const totalCount = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
  const rangeStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = page * PAGE_SIZE + rows.length;
  const canPrev = page > 0;
  const canNext = rangeEnd < totalCount;

  // Derive the managed application from the current authorized query data only.
  const managedRow = useMemo(
    () =>
      managedApiClientId
        ? rows.find((row) => row.api_client_id === managedApiClientId) ?? null
        : null,
    [managedApiClientId, rows],
  );

  const exitManageMode = () => {
    setManagedApiClientId(null);
    setManagementTab(DEFAULT_CONNECTED_APP_MANAGEMENT_TAB);
  };

  // Fail safely when the selected application is no longer authorized/available.
  useEffect(() => {
    if (!managedApiClientId) return;
    if (isLoading || isFetching) return;
    if (managedRow) return;
    exitManageMode();
  }, [managedApiClientId, managedRow, isLoading, isFetching]);

  const openAction = (row: OrganizationClientRow, target: TargetLifecycle) => {
    if (!organizationId || isPending) return;
    setActionError(null);
    setPendingAction({
      organizationId,
      apiClientId: row.api_client_id,
      displayName: row.display_name,
      previousStatus: row.organization_enablement_status,
      targetLifecycleStatus: target,
    });
  };

  // Selection identity is only the api_client_id.
  const openManage = (row: OrganizationClientRow) => {
    if (!organizationId) return;
    setManagedApiClientId(row.api_client_id);
    setManagementTab(DEFAULT_CONNECTED_APP_MANAGEMENT_TAB);
  };

  const closeDialog = () => {
    if (isPending) return;
    setPendingAction(null);
    setActionError(null);
  };

  const kind = pendingAction ? actionKindOf(pendingAction) : null;
  const dialogVerb =
    kind === "disconnect" ? "Disconnect" : kind === "reconnect" ? "Reconnect" : "Connect";
  const dialogPendingLabel =
    kind === "disconnect" ? "Disconnecting…" : kind === "reconnect" ? "Reconnecting…" : "Connecting…";

  const disconnectCopy = isTenantContext
    ? `This blocks the application for ${organizationName}. Existing Workspace, Project, and capability selections are retained and can be restored by reconnecting.`
    : "This blocks the application for the active Organization. Existing Workspace, Project, and capability selections are retained and can be restored by reconnecting.";
  const connectCopy = isTenantContext
    ? `This makes the application available to ${organizationName}. Workspace, Project, and capability access remain disabled until configured.`
    : "This makes the application available to the active Organization. Workspace, Project, and capability access remain disabled until configured.";

  const confirmationDialog = (
    <Dialog open={!!pendingAction} onOpenChange={(open) => !open && closeDialog()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {dialogVerb} {pendingAction?.displayName}?
          </DialogTitle>
          <DialogDescription>
            {kind === "disconnect" ? disconnectCopy : connectCopy}
          </DialogDescription>
        </DialogHeader>

        {actionError && <p className="text-sm text-destructive">{actionError}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={closeDialog} disabled={isPending}>
            Cancel
          </Button>
          <Button
            disabled={isPending}
            onClick={() => {
              if (!pendingAction || isPending) return;
              transition.mutate(pendingAction);
            }}
          >
            {isPending ? dialogPendingLabel : dialogVerb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  // ---------------------------------------------------------------- Manage mode
  if (managedRow) {
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={exitManageMode}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to Connected Apps
          </Button>
          {isTenantContext && (
            <Badge variant="outline" className="font-normal">
              Organization: {organizationName}
            </Badge>
          )}
        </div>

        <ConnectedAppManagementView
          context={context}
          organizationId={organizationId}
          organizationName={organizationName}
          app={mapRowToManagementApp(managedRow)}
          activeTab={managementTab}
          onTabChange={setManagementTab}
          connectionActionPending={isPending}
          parentSummaryQueryKey={parentSummaryQueryKey}
          onRequestDisconnect={() => {
            if (isPending) return;
            setActionError(null);
            setPendingAction({
              organizationId,
              apiClientId: managedRow.api_client_id,
              displayName: managedRow.display_name,
              previousStatus: managedRow.organization_enablement_status,
              targetLifecycleStatus: "disabled",
            });
          }}
        />

        {confirmationDialog}
      </>
    );
  }

  // ------------------------------------------------------------------ List mode
  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">
              {isTenantContext ? `Applications · ${organizationName}` : "Applications"}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Switch
                id="connected-apps-show-retired"
                checked={includeRetired}
                onCheckedChange={(checked) => {
                  setIncludeRetired(checked);
                  setPage(0);
                }}
              />
              <Label
                htmlFor="connected-apps-show-retired"
                className="text-xs font-normal text-muted-foreground"
              >
                Show retired
              </Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <div className="p-4">
              <AdminLoadingCards count={3} />
            </div>
          )}
          {error && (
            <div className="py-6 px-4 text-sm text-destructive">Failed to load Connected Apps.</div>
          )}
          {!isLoading && !error && rows.length === 0 && (
            <div className="p-4">
              <AdminEmptyState
                title="No connected applications found"
                description={
                  isTenantContext
                    ? "No registered applications are available for the selected Organization and current filter."
                    : "No registered applications are available for the active Organization and current filter."
                }
              />
            </div>
          )}
          {!error && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Application</TableHead>
                  <TableHead>Application status</TableHead>
                  <TableHead>Organization connection</TableHead>
                  <TableHead>Active policy</TableHead>
                  {/* API-ADM-UX1 — Workspace / Project / permission summaries are
                      Organization-scope information only. */}
                  {!isTenantContext && <TableHead>Access</TableHead>}
                  {!isTenantContext && <TableHead>Permissions</TableHead>}
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const action = resolveRowAction(row);
                  return (
                    <TableRow key={row.api_client_id}>
                      <TableCell>
                        <p className="text-sm font-medium text-foreground">{row.display_name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{row.client_key}</p>
                        {row.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{row.description}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={lifecycleVariant(row.client_lifecycle_status)}
                          className="font-normal"
                        >
                          {row.client_lifecycle_status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={connectionVariant(row.organization_enablement_status)}
                          className="font-normal"
                        >
                          {connectionLabel(row.organization_enablement_status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {row.active_policy_version ?? "—"}
                      </TableCell>
                      {!isTenantContext && (
                        <TableCell className="text-sm text-muted-foreground">
                          {Number(row.enabled_workspace_count ?? 0)} workspaces /{" "}
                          {Number(row.enabled_project_count ?? 0)} projects
                        </TableCell>
                      )}
                      {!isTenantContext && (
                        <TableCell className="text-sm text-muted-foreground">
                          {Number(row.enabled_capability_grant_count ?? 0)}
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          {action.kind === "unavailable" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled
                              title="Only active applications can be connected."
                            >
                              Unavailable
                            </Button>
                          ) : action.kind === "manage" ? (
                            isTenantContext ? (
                              /* API-ADM-UX1 — Tenant administration acts on the
                                 Organization connection directly. */
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isPending}
                                  onClick={() => openAction(row, "disabled")}
                                >
                                  Disconnect
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => openManage(row)}>
                                  View details
                                </Button>
                              </>
                            ) : (
                              <Button variant="outline" size="sm" onClick={() => openManage(row)}>
                                Manage
                              </Button>
                            )
                          ) : (
                            <Button
                              variant="default"
                              size="sm"
                              disabled={isPending}
                              onClick={() => openAction(row, action.target)}
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
        </CardContent>
      </Card>

      {!error && rows.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-muted-foreground">
            Showing {rangeStart}–{rangeEnd} of {totalCount}
          </p>
          <div className="flex items-center gap-2">
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
        </div>
      )}

      {confirmationDialog}
    </>
  );
}
