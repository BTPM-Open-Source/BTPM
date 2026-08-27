/**
 * Step API-ADM.5B — direct Workspace-level permission administration for one
 * Connected App and one Workspace, rendered inside the unified Access &
 * permissions experience.
 *
 * Reuses exactly the accepted API-G.5.8D-2 Workspace capability contract:
 *   read:  public.api_g_5_7_admin_list_workspace_client_capabilities
 *   write: public.api_g_5_7_admin_transition_workspace_client_capability
 *
 * Explicit context props only: no global Organization selection, no frontend
 * role inference, no direct table access, no Project calls, and no browser
 * persistence APIs. Effective access is always backend-provided.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AdminEmptyState } from "./SaasAdminShell";
import { groupCapabilitiesByDomain } from "./apiCapabilityDomains";
import {
  WORKSPACE_CAPABILITY_PAGE_SIZE,
  WS_CAP_DISABLE_ERROR,
  WS_CAP_ENABLE_ERROR,
  WS_CAP_SCOPE_NOTICE,
  WS_PROJECT_SCOPE_DISABLE_CONFIRMATION,
  WS_PROJECT_SCOPE_ENABLE_CONFIRMATION,
  WS_PROJECT_SCOPE_EXPLANATION,
  WS_WORKSPACE_SCOPE_DISABLE_CONFIRMATION,
  WS_WORKSPACE_SCOPE_ENABLE_CONFIRMATION,
  WS_DIRECT_SECTION_TITLE,
  WS_INHERITED_SECTION_DESCRIPTION,
  WS_INHERITED_SECTION_TITLE,
  WS_LOWER_SCOPE_SECTION_DESCRIPTION,
  WS_LOWER_SCOPE_SECTION_TITLE,
  effectiveAccessLabel,
  effectiveSourceLabel,
  inheritedOrganizationStateLabel,
  partitionWorkspaceCapabilityRows,
  resolveWorkspaceCapabilityRowAction,
  workspaceGrantLabel,
  workspaceGrantVariant,
  workspaceLowerScopeBadgeLabel,
  workspaceLowerScopeManagedAtLabel,
  workspaceRuntimeScopeBadgeLabel,
  type WorkspaceCapabilityTargetLifecycle,
  type WorkspaceClientCapabilityRow,
} from "./connectedAppWorkspacePermissionsModel";

const WORKSPACE_PERMISSION_LIST_RPC = "api_g_5_7_admin_list_workspace_client_capabilities";
const WORKSPACE_PERMISSION_TRANSITION_RPC =
  "api_g_5_7_admin_transition_workspace_client_capability";

export const WORKSPACE_PERMISSIONS_EMPTY_DESCRIPTION =
  "No Workspace-level permissions are available for this application.";

export interface ConnectedAppWorkspacePermissionsProps {
  readonly organizationId: string;
  readonly apiClientId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly clientLifecycleStatus: string;
  readonly organizationEnablementStatus: string | null;
  readonly workspaceEnablementStatus: string | null;
  readonly workspaceIsArchived: boolean;
  /**
   * API-ADM.7 — optional caller-owned parent summary query key. Callers that
   * render this surface under their own Connected Apps list (Organization Admin
   * or Tenant Admin) pass their list key so summary counts refresh after a
   * successful mutation. No role inference happens here.
   */
  readonly parentSummaryQueryKey?: readonly unknown[];
}

interface PendingWorkspacePermissionAction {
  organizationId: string;
  apiClientId: string;
  workspaceId: string;
  apiVersion: string;
  capabilityKey: string;
  capabilityDisplayName: string;
  previousWorkspaceGrantStatus: string | null;
  /** API-ADM-UX2.3 — backend-authoritative runtime scope for scope-aware copy. */
  scopeLevel: string;
  targetLifecycleStatus: WorkspaceCapabilityTargetLifecycle;
}

export default function ConnectedAppWorkspacePermissions({
  organizationId,
  apiClientId,
  workspaceId,
  workspaceName,
  clientLifecycleStatus,
  organizationEnablementStatus,
  workspaceEnablementStatus,
  workspaceIsArchived,
  parentSummaryQueryKey,
}: ConnectedAppWorkspacePermissionsProps) {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] =
    useState<PendingWorkspacePermissionAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setPendingAction(null);
    setActionError(null);
  }, [organizationId, apiClientId, workspaceId]);

  const { data, isLoading, error } = useQuery({
    queryKey: [
      "connected-app-workspace-permissions",
      organizationId,
      apiClientId,
      workspaceId,
    ],
    enabled: !!organizationId && !!apiClientId && !!workspaceId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(WORKSPACE_PERMISSION_LIST_RPC, {
        _organization_id: organizationId,
        _workspace_id: workspaceId,
        _api_client_id: apiClientId,
        _limit: WORKSPACE_CAPABILITY_PAGE_SIZE,
        _offset: 0,
      });
      if (error) throw error;
      return (data ?? []) as WorkspaceClientCapabilityRow[];
    },
  });

  const transition = useMutation({
    mutationFn: async (action: PendingWorkspacePermissionAction) => {
      if (!organizationId || !apiClientId || !workspaceId) throw new Error("context_mismatch");
      if (action.organizationId !== organizationId) throw new Error("context_mismatch");
      if (action.apiClientId !== apiClientId) throw new Error("context_mismatch");
      if (action.workspaceId !== workspaceId) throw new Error("context_mismatch");
      if (!action.apiVersion || !action.capabilityKey) throw new Error("context_mismatch");
      const { error } = await (supabase.rpc as any)(WORKSPACE_PERMISSION_TRANSITION_RPC, {
        _organization_id: action.organizationId,
        _workspace_id: action.workspaceId,
        _api_client_id: action.apiClientId,
        _api_version: action.apiVersion,
        _capability_key: action.capabilityKey,
        _target_lifecycle_status: action.targetLifecycleStatus,
      });
      if (error) throw error;
      return action;
    },
    onSuccess: async (action) => {
      await queryClient.invalidateQueries({
        queryKey: [
          "connected-app-workspace-permissions",
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
          ? WS_CAP_DISABLE_ERROR
          : WS_CAP_ENABLE_ERROR,
      );
    },
  });

  const isPending = transition.isPending;
  const rows = data ?? [];
  // API-ADM-UX1 — authoritative scope_level separates direct from inherited.
  const {
    direct: directRows,
    inherited: inheritedRows,
    lowerScope: lowerScopeRows,
  } = partitionWorkspaceCapabilityRows(rows);

  const openPermissionAction = (
    row: WorkspaceClientCapabilityRow,
    target: WorkspaceCapabilityTargetLifecycle,
  ) => {
    if (!organizationId || !apiClientId || !workspaceId || isPending) return;
    setActionError(null);
    setPendingAction({
      organizationId,
      apiClientId,
      workspaceId,
      apiVersion: row.api_version,
      capabilityKey: row.capability_key,
      capabilityDisplayName: row.display_name,
      previousWorkspaceGrantStatus: row.workspace_grant_status,
      scopeLevel: row.scope_level,
      targetLifecycleStatus: target,
    });
  };

  const closeConfirmation = () => {
    if (isPending) return;
    setPendingAction(null);
    setActionError(null);
  };

  const pendingIsDisable = pendingAction?.targetLifecycleStatus === "disabled";
  const pendingIsProjectScope = pendingAction?.scopeLevel === "project";
  const pendingIsReenable =
    pendingAction?.targetLifecycleStatus === "enabled" &&
    pendingAction?.previousWorkspaceGrantStatus === "disabled";
  const confirmVerb = pendingIsDisable ? "Disable" : pendingIsReenable ? "Re-enable" : "Enable";
  const confirmPendingLabel = pendingIsDisable
    ? "Disabling…"
    : pendingIsReenable
      ? "Re-enabling…"
      : "Enabling…";

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-foreground">{WS_DIRECT_SECTION_TITLE}</h4>
        <p className="text-xs text-muted-foreground">{WS_CAP_SCOPE_NOTICE}</p>
      </div>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">Failed to load Workspace permissions.</p>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <AdminEmptyState
          title="No Workspace permissions"
          description={WORKSPACE_PERMISSIONS_EMPTY_DESCRIPTION}
        />
      )}

      {!error &&
        directRows.length > 0 &&
        groupCapabilitiesByDomain(directRows).map((group) => (
          <section
            key={group.domain.id}
            className="space-y-3"
            aria-labelledby={`ws-cap-domain-${group.domain.id}`}
          >
            <h5
              id={`ws-cap-domain-${group.domain.id}`}
              data-testid="ws-cap-domain-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {group.domain.label}
            </h5>
            {group.capabilities.map((row) => {
              const action = resolveWorkspaceCapabilityRowAction(
                row,
                clientLifecycleStatus,
                organizationEnablementStatus,
                workspaceEnablementStatus,
                workspaceIsArchived,
              );
              return (
                <div
                  key={`${row.api_version}:${row.capability_key}`}
                  className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{row.display_name}</p>
                      <Badge
                        variant="outline"
                        className="font-normal"
                        data-testid="ws-cap-runtime-scope-badge"
                      >
                        {workspaceRuntimeScopeBadgeLabel(row.scope_level)}
                      </Badge>
                    </div>
                    {row.description && (
                      <p className="text-xs text-muted-foreground">{row.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground font-mono">{row.capability_key}</p>
                    {row.scope_level === "project" && (
                      <p
                        className="text-xs text-muted-foreground"
                        data-testid="ws-cap-project-scope-explanation"
                      >
                        {WS_PROJECT_SCOPE_EXPLANATION}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Direct Workspace permission</p>
                      <Badge
                        variant={workspaceGrantVariant(row.workspace_grant_status)}
                        className="font-normal"
                      >
                        {workspaceGrantLabel(row.workspace_grant_status)}
                      </Badge>
                    </div>
                    {/* API-ADM-UX2.3 — presentation only: legacy effective
                        fields may report an Organization source, which never
                        satisfies a Project-scoped capability at runtime. */}
                    {row.scope_level === "workspace" && (
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Effective permission</p>
                        <Badge variant="outline" className="font-normal">
                          {effectiveAccessLabel(row.effective_grant_status)} ·{" "}
                          {effectiveSourceLabel(row.effective_grant_source)}
                        </Badge>
                      </div>
                    )}
                    {action.target === null ? (
                      <div className="flex flex-col items-end gap-1">
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
                        onClick={() => openPermissionAction(row, action.target!)}
                      >
                        {action.label}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        ))}

      {/* API-ADM-UX1 — Organization-scoped capabilities: read-only reference. */}
      {!error && inheritedRows.length > 0 && (
        <section
          className="space-y-2 rounded-md border border-border bg-muted/30 p-3"
          aria-labelledby="ws-cap-inherited"
          data-testid="ws-cap-inherited-section"
        >
          <h5
            id="ws-cap-inherited"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {WS_INHERITED_SECTION_TITLE}
          </h5>
          <p className="text-xs text-muted-foreground">{WS_INHERITED_SECTION_DESCRIPTION}</p>
          <ul className="space-y-2">
            {inheritedRows.map((row) => (
              <li
                key={`inherited:${row.api_version}:${row.capability_key}`}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{row.display_name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{row.capability_key}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-normal">
                    {inheritedOrganizationStateLabel(row.organization_grant_status)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {effectiveAccessLabel(row.effective_grant_status)} ·{" "}
                    {effectiveSourceLabel(row.effective_grant_source)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* API-ADM-UX2.3 — unknown/unsupported scopes only: read-only reference. */}
      {!error && lowerScopeRows.length > 0 && (
        <section
          className="space-y-2 rounded-md border border-border bg-muted/30 p-3"
          aria-labelledby="ws-cap-lower-scope"
          data-testid="ws-cap-lower-scope-section"
        >
          <h5
            id="ws-cap-lower-scope"
            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {WS_LOWER_SCOPE_SECTION_TITLE}
          </h5>
          <p className="text-xs text-muted-foreground">{WS_LOWER_SCOPE_SECTION_DESCRIPTION}</p>
          <ul className="space-y-2">
            {lowerScopeRows.map((row) => (
              <li
                key={`lower:${row.api_version}:${row.capability_key}`}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{row.display_name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{row.capability_key}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-normal">
                    {workspaceLowerScopeBadgeLabel(row.scope_level)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {workspaceLowerScopeManagedAtLabel(row.scope_level)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
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
              {confirmVerb} {pendingAction?.capabilityDisplayName} for {workspaceName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingIsProjectScope
                ? pendingIsDisable
                  ? WS_PROJECT_SCOPE_DISABLE_CONFIRMATION
                  : WS_PROJECT_SCOPE_ENABLE_CONFIRMATION
                : pendingIsDisable
                  ? WS_WORKSPACE_SCOPE_DISABLE_CONFIRMATION
                  : WS_WORKSPACE_SCOPE_ENABLE_CONFIRMATION}
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
