/**
 * API-G.5.9D — My Account Connected Apps UX.
 *
 * Lists every application for which the signed-in user retains a
 * non-revoked BTPM policy acknowledgement, and allows revoking that
 * BTPM authorization. No feature flag, no OAuth-provider token
 * operations, no direct table access.
 */
import { useEffect, useRef, useState } from "react";
import { Plug } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { buildApiDConsentReturnPath, sanitizePolicyUri } from "@/lib/apiDConsent";
import {
  MY_CONNECTED_APPS_PAGE_SIZE,
  useDisconnectMyConnectedApp,
  useMyConnectedApps,
  type MyConnectedApp,
  type MyConnectedAppScopeLevel,
} from "@/hooks/useMyConnectedApps";

interface ConnectedAppsCardProps {
  userId: string | null;
}

const SCOPE_LABELS: Record<MyConnectedAppScopeLevel, string> = {
  organization: "Organization level",
  workspace: "Workspace level",
  project: "Project level",
};

const DISCONNECT_SAFE_ERROR =
  "Could not disconnect this application. Please try again.";

function formatDate(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString();
}

export function ConnectedAppsCard({ userId }: ConnectedAppsCardProps) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<{ clientKey: string; displayName: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [safeError, setSafeError] = useState<string | null>(null);

  const previousUserId = useRef<string | null>(userId);
  useEffect(() => {
    if (previousUserId.current !== userId) {
      previousUserId.current = userId;
      setPage(0);
      setSelected(null);
      setConfirmOpen(false);
      setSafeError(null);
    }
  }, [userId]);

  const { rows, totalCount, isLoading, isError, refetch } = useMyConnectedApps(userId, page);
  const disconnect = useDisconnectMyConnectedApp(userId);
  const pending = disconnect.isPending;

  const openConfirm = (app: MyConnectedApp) => {
    setSelected({ clientKey: app.client_key, displayName: app.display_name });
    setSafeError(null);
    setConfirmOpen(true);
  };

  const closeConfirm = () => {
    setConfirmOpen(false);
    setSelected(null);
    setSafeError(null);
  };

  const handleConfirm = () => {
    if (pending) return;
    const target = selected;
    if (!userId || !confirmOpen || !target || !target.clientKey) {
      closeConfirm();
      return;
    }
    disconnect.mutate(target.clientKey, {
      onSuccess: () => {
        const wasOnlyRowOnPage = rows.length <= 1 && page > 0;
        if (wasOnlyRowOnPage) setPage((p) => Math.max(0, p - 1));
        closeConfirm();
      },
      onError: () => {
        setSafeError(DISCONNECT_SAFE_ERROR);
      },
    });
  };

  const rangeStart = totalCount === 0 ? 0 : page * MY_CONNECTED_APPS_PAGE_SIZE + 1;
  const rangeEnd = Math.min(totalCount, page * MY_CONNECTED_APPS_PAGE_SIZE + rows.length);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-lg">Connected Apps</CardTitle>
        </div>
        <CardDescription>
          Applications you have authorized to use BTPM on your behalf.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3" data-testid="connected-apps-loading">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : isError ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connected Apps are unavailable right now.
            </p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">No connected applications</p>
            <p className="text-sm text-muted-foreground">
              Applications you authorize will appear here.
            </p>
          </div>
        ) : (
          <>
            <ul className="space-y-4">
              {rows.map((app) => {
                const policyUri = app.policy ? sanitizePolicyUri(app.policy.policy_uri) : null;
                return (
                  <li key={app.client_key} className="rounded-md border p-4 space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{app.display_name}</span>
                          <Badge
                            variant={app.connection_status === "active" ? "secondary" : "outline"}
                          >
                            {app.connection_status === "active" ? "Active" : "Access unavailable"}
                          </Badge>
                        </div>
                        {app.description ? (
                          <p className="text-sm text-muted-foreground">{app.description}</p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          Authorized {formatDate(app.latest_acknowledged_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {app.connection_status === "active" && app.policy ? (
                          <Button size="sm" variant="outline" asChild>
                            <Link
                              to={buildApiDConsentReturnPath({
                                clientKey: app.client_key,
                                returnTo: "/account",
                              }) ?? "/consent/api-d"}
                            >
                              Policy & consent
                            </Link>
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => openConfirm(app)}
                        >
                          Disconnect
                        </Button>
                      </div>
                    </div>

                    {app.connection_status === "active" && app.policy ? (
                      <div className="space-y-3">
                        <div className="text-sm">
                          {policyUri ? (
                            <a
                              href={policyUri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2"
                            >
                              Policy {app.policy.version}
                            </a>
                          ) : (
                            <span>Policy {app.policy.version}</span>
                          )}
                          <span className="text-muted-foreground">
                            {" "}
                            · Effective {formatDate(app.policy.effective_at)}
                          </span>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <p className="text-sm">Organizations: {app.organizations.count}</p>
                            {app.organizations.display_names.length > 0 ? (
                              <ul className="text-xs text-muted-foreground">
                                {app.organizations.display_names.map((n) => (
                                  <li key={n}>{n}</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                          <div>
                            <p className="text-sm">Workspaces: {app.workspaces.count}</p>
                            {app.workspaces.display_names.length > 0 ? (
                              <ul className="text-xs text-muted-foreground">
                                {app.workspaces.display_names.map((n) => (
                                  <li key={n}>{n}</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-sm font-medium">Capabilities</p>
                          {app.capabilities.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              No API capabilities are currently enabled for your accessible scope.
                            </p>
                          ) : (
                            <ul className="space-y-2">
                              {app.capabilities.map((cap, idx) => (
                                <li
                                  key={`${cap.api_version}-${cap.scope_level}-${cap.display_name}-${idx}`}
                                  className="rounded-sm bg-muted/40 p-2"
                                >
                                  <p className="text-sm font-medium">{cap.display_name}</p>
                                  <p className="text-xs text-muted-foreground">{cap.description}</p>
                                  <p className="text-xs text-muted-foreground">
                                    API {cap.api_version} · {SCOPE_LABELS[cap.scope_level]}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Current policy and access details are unavailable. You can still disconnect
                        this application.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Showing {rangeStart}–{rangeEnd} of {totalCount}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={rangeEnd >= totalCount}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !pending) closeConfirm();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect {selected?.displayName ?? ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This revokes your BTPM authorization for this application. It does not change your
              BTPM account or ordinary BTPM access. BTPM does not delete provider-issued tokens
              through this action.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {safeError ? (
            <p className="text-sm text-destructive">{safeError}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
            >
              {pending ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default ConnectedAppsCard;
