import { ReactNode, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ShieldAlert, ArrowRightLeft, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useActiveContext } from "@/context/ActiveContextProvider";
import {
  RouteBoundaryInput,
  useRouteContextBoundary,
} from "@/hooks/useRouteContextBoundary";

/**
 * Phase 4D.8 — Route Context Boundary Guard.
 *
 * Compares the URL object's Tenant/Organization boundary to the caller's
 * active Organization. Never silently switches context. On mismatch shows a
 * safe explanation and offers the user an explicit action.
 */

interface Props extends RouteBoundaryInput {
  children: ReactNode;
}

export function RouteContextBoundaryGuard({ children, ...input }: Props) {
  const navigate = useNavigate();
  const { setActiveContext } = useActiveContext();
  const {
    status,
    boundary,
    activeOrganizationName,
    activeTenantName,
    error,
    refetch,
  } = useRouteContextBoundary(input);

  const canSwitch = useMemo(
    () => status === "mismatch" && !!boundary?.has_access && !!boundary.tenant_id && !!boundary.organization_id,
    [status, boundary],
  );

  if (status === "ok") return <>{children}</>;

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-muted-foreground">
        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
        Verifying context…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="max-w-xl mx-auto py-10">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Could not verify route context</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{error?.message ?? "Unknown error resolving route boundary."}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
              <Button size="sm" variant="outline" onClick={() => navigate("/")}>Go home</Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (status === "not_found") {
    return (
      <div className="max-w-xl mx-auto py-10">
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Item not found</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>This link points to an item that no longer exists or you cannot see it in any of your organizations.</p>
            <Button size="sm" variant="outline" onClick={() => navigate("/")}>Go home</Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (status === "inconsistent") {
    return (
      <div className="max-w-xl mx-auto py-10">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Inconsistent URL</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{boundary?.reason ?? "The IDs in this URL do not point to the same item."}</p>
            <Button size="sm" variant="outline" onClick={() => navigate("/")}>Go home</Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (status === "access_denied") {
    return (
      <div className="max-w-xl mx-auto py-10">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>You do not have access to this item.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => navigate("/")}>
                <Home className="h-4 w-4 mr-1" /> Go home
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate("/select-context")}>
                Open context selector
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // mismatch
  return (
    <div className="max-w-xl mx-auto py-10">
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>This item belongs to another organization</AlertTitle>
        <AlertDescription className="space-y-3">
          <div className="text-sm space-y-1">
            <p>
              <span className="text-muted-foreground">Current context:</span>{" "}
              <strong>{activeTenantName ?? "—"} / {activeOrganizationName ?? "—"}</strong>
            </p>
            <p>
              <span className="text-muted-foreground">This item belongs to:</span>{" "}
              <strong>{boundary?.tenant_name} / {boundary?.organization_name}</strong>
              {boundary?.environment_role === "non_production" && (
                <span className="ml-2 inline-flex items-center rounded bg-amber-100 text-amber-900 text-xs px-1.5 py-0.5">
                  non-production
                </span>
              )}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Switch organization to continue, or go back to your current workspace list.
            We will not silently switch environments for you.
          </p>
          <div className="flex flex-wrap gap-2">
            {canSwitch && (
              <Button
                size="sm"
                onClick={async () => {
                  await setActiveContext({
                    tenantId: boundary!.tenant_id!,
                    organizationId: boundary!.organization_id!,
                    isAllWorkspaces: true,
                  });
                  await refetch();
                }}
              >
                <ArrowRightLeft className="h-4 w-4 mr-1" />
                Switch to {boundary?.organization_name}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => navigate("/")}>
              <Home className="h-4 w-4 mr-1" /> Go to current workspaces
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate("/select-context")}>
              Open context selector
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
