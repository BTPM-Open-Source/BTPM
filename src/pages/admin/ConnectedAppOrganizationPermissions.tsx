/**
 * Step API-ADM.5A — Organization-level permission administration for one
 * Connected App, rendered inside the reusable Connected App management shell.
 *
 * Reuses exactly the accepted API-G.5.8D-1 Organization capability contract:
 *   read:  public.api_g_5_7_admin_list_organization_client_capabilities
 *   write: public.api_g_5_7_admin_transition_organization_client_capability
 *
 * Explicit context props only: no global Organization selection, no frontend
 * role inference, no direct table access, no Workspace / Project capability or
 * enablement calls, and no browser persistence APIs.
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminEmptyState } from "./SaasAdminShell";
import { groupCapabilitiesByDomain } from "./apiCapabilityDomains";
import {
  CAPABILITY_DISABLE_ERROR,
  CAPABILITY_ENABLE_ERROR,
  ORGANIZATION_CAPABILITY_PAGE_SIZE,
  ORGANIZATION_LOWER_SCOPE_SECTION_DESCRIPTION,
  ORGANIZATION_LOWER_SCOPE_SECTION_TITLE,
  capabilityGrantLabel,
  capabilityGrantVariant,
  lowerScopeBadgeLabel,
  lowerScopeManagedAtLabel,
  partitionOrganizationCapabilityRows,
  resolveCapabilityRowAction,
  type CapabilityTargetLifecycle,
  type OrganizationClientCapabilityRow,
} from "./connectedAppOrganizationPermissionsModel";

const ORGANIZATION_PERMISSION_LIST_RPC =
  "api_g_5_7_admin_list_organization_client_capabilities";
const ORGANIZATION_PERMISSION_TRANSITION_RPC =
  "api_g_5_7_admin_transition_organization_client_capability";

export const ORGANIZATION_PERMISSIONS_EMPTY_DESCRIPTION =
  "No Organization-level permissions are available for this application.";

export interface ConnectedAppOrganizationPermissionsProps {
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

interface PendingPermissionAction {
  organizationId: string;
  apiClientId: string;
  apiVersion: string;
  capabilityKey: string;
  capabilityDisplayName: string;
  previousGrantStatus: string | null;
  targetLifecycleStatus: CapabilityTargetLifecycle;
}

export default function ConnectedAppOrganizationPermissions({
  organizationId,
  apiClientId,
  clientLifecycleStatus,
  organizationEnablementStatus,
  parentSummaryQueryKey,
}: ConnectedAppOrganizationPermissionsProps) {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<PendingPermissionAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setPendingAction(null);
    setActionError(null);
  }, [organizationId, apiClientId]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["connected-app-organization-permissions", organizationId, apiClientId],
    enabled: !!organizationId && !!apiClientId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(ORGANIZATION_PERMISSION_LIST_RPC, {
        _organization_id: organizationId,
        _api_client_id: apiClientId,
        _limit: ORGANIZATION_CAPABILITY_PAGE_SIZE,
        _offset: 0,
      });
      if (error) throw error;
      return (data ?? []) as OrganizationClientCapabilityRow[];
    },
  });

  const transition = useMutation({
    mutationFn: async (action: PendingPermissionAction) => {
      if (!organizationId || !apiClientId) throw new Error("context_mismatch");
      if (action.organizationId !== organizationId) throw new Error("context_mismatch");
      if (action.apiClientId !== apiClientId) throw new Error("context_mismatch");
      if (!action.apiVersion || !action.capabilityKey) throw new Error("context_mismatch");
      const { error } = await (supabase.rpc as any)(ORGANIZATION_PERMISSION_TRANSITION_RPC, {
        _organization_id: action.organizationId,
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
          "connected-app-organization-permissions",
          action.organizationId,
          action.apiClientId,
        ],
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
          ? CAPABILITY_DISABLE_ERROR
          : CAPABILITY_ENABLE_ERROR,
      );
    },
  });

  const isPending = transition.isPending;
  const rows = data ?? [];
  // API-ADM-UX1 — authoritative scope_level decides what this screen can manage.
  const { managed: managedRows, lowerScope: lowerScopeRows } =
    partitionOrganizationCapabilityRows(rows);

  const openPermissionAction = (
    row: OrganizationClientCapabilityRow,
    target: CapabilityTargetLifecycle,
  ) => {
    if (!organizationId || !apiClientId || isPending) return;
    setActionError(null);
    setPendingAction({
      organizationId,
      apiClientId,
      apiVersion: row.api_version,
      capabilityKey: row.capability_key,
      capabilityDisplayName: row.display_name,
      previousGrantStatus: row.grant_status,
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
    pendingAction?.previousGrantStatus === "disabled";
  const confirmVerb = pendingIsDisable ? "Disable" : pendingIsReenable ? "Re-enable" : "Enable";
  const confirmPendingLabel = pendingIsDisable
    ? "Disabling…"
    : pendingIsReenable
      ? "Re-enabling…"
      : "Enabling…";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Organization permissions</CardTitle>
        <CardDescription>Permissions granted at the Organization level.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive">Failed to load Organization permissions.</p>
        )}

        {!isLoading && !error && rows.length === 0 && (
          <AdminEmptyState
            title="No Organization permissions"
            description={ORGANIZATION_PERMISSIONS_EMPTY_DESCRIPTION}
          />
        )}

        {!error &&
          managedRows.length > 0 &&
          groupCapabilitiesByDomain(managedRows).map((group) => (
            <section
              key={group.domain.id}
              className="space-y-3"
              aria-labelledby={`org-cap-domain-${group.domain.id}`}
            >
              <h4
                id={`org-cap-domain-${group.domain.id}`}
                data-testid="org-cap-domain-heading"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {group.domain.label}
              </h4>
              {group.capabilities.map((row) => {
                const action = resolveCapabilityRowAction(
                  row,
                  clientLifecycleStatus,
                  organizationEnablementStatus,
                );
                return (
                  <div
                    key={`${row.api_version}:${row.capability_key}`}
                    className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{row.display_name}</p>
                      {row.description && (
                        <p className="text-xs text-muted-foreground">{row.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground font-mono">
                        {row.capability_key}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={capabilityGrantVariant(row.grant_status)}
                        className="font-normal"
                      >
                        {capabilityGrantLabel(row.grant_status)}
                      </Badge>
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

        {/* API-ADM-UX1 — read-only reference: never grantable on this screen. */}
        {!error && lowerScopeRows.length > 0 && (
          <section
            className="space-y-2 rounded-md border border-border bg-muted/30 p-3"
            aria-labelledby="org-cap-lower-scope"
            data-testid="org-cap-lower-scope-section"
          >
            <h4
              id="org-cap-lower-scope"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {ORGANIZATION_LOWER_SCOPE_SECTION_TITLE}
            </h4>
            <p className="text-xs text-muted-foreground">
              {ORGANIZATION_LOWER_SCOPE_SECTION_DESCRIPTION}
            </p>
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
                    <Badge
                      variant="outline"
                      className="font-normal"
                      data-testid="org-cap-scope-badge"
                    >
                      {lowerScopeBadgeLabel(row.scope_level)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {lowerScopeManagedAtLabel(row.scope_level)}
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
                {confirmVerb} {pendingAction?.capabilityDisplayName}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pendingIsDisable
                  ? "This disables the Organization permission. The retained grant can be restored by re-enabling it."
                  : "This grants the permission to the application at Organization level. Runtime access still requires every other applicable authorization check."}
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
      </CardContent>
    </Card>
  );
}
