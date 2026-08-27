import { ReactNode } from "react";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { useActiveContext } from "@/context/ActiveContextProvider";
import { useActiveOrgAdminAccess } from "@/hooks/useActiveOrgAdminAccess";
import { AdminNoAccess, AdminLoadingCards } from "./SaasAdminShell";

function LoadingShell() {
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <AdminLoadingCards count={3} />
    </div>
  );
}

export function PlatformAdminGuard({ children }: { children: ReactNode }) {
  const access = useAdminAccess();
  if (access.isLoading) return <LoadingShell />;
  if (!access.canOpenPlatformAdmin) {
    return (
      <AdminNoAccess message="Platform Admin is available only to Platform Super Admins. Ask your platform administrator if you need access." />
    );
  }
  return <>{children}</>;
}

export function TenantAdminGuard({ children }: { children: ReactNode }) {
  const access = useAdminAccess();
  const ctx = useActiveContext();
  if (access.isLoading || ctx.isLoading) return <LoadingShell />;
  const tenantId = ctx.activeTenant?.id ?? null;
  if (!tenantId) {
    return (
      <AdminNoAccess message="Tenant Admin needs an active tenant. Pick a tenant from the context selector first." />
    );
  }
  if (!access.isTenantAdminForTenant(tenantId)) {
    return (
      <AdminNoAccess message="Tenant Admin is available only to Tenant Admins for the active tenant. Platform Super Admin access does not grant tenant operational access." />
    );
  }
  return <>{children}</>;
}

/**
 * Phase 4D.8D — Admin Hub gate.
 * Allows any of:
 *   - Platform Super Admin
 *   - Tenant Admin for the active tenant
 *   - Org Admin for the active organization
 * Org Admin-only users can reach /admin/hub and open the Org Admin card there.
 */
export function AnyAdminGuard({ children }: { children: ReactNode }) {
  const access = useAdminAccess();
  const ctx = useActiveContext();
  const orgAdmin = useActiveOrgAdminAccess();
  if (access.isLoading || ctx.isLoading || orgAdmin.isLoading) return <LoadingShell />;
  const tenantId = ctx.activeTenant?.id ?? null;
  const isActiveTenantAdmin = tenantId ? access.isTenantAdminForTenant(tenantId) : false;
  if (
    access.canOpenPlatformAdmin ||
    isActiveTenantAdmin ||
    orgAdmin.isOrgAdmin
  ) {
    return <>{children}</>;
  }
  return (
    <AdminNoAccess message="You do not have Platform, Tenant, or Org Admin access for the active context." />
  );
}

/**
 * Step API-ADM.8 — Organization-context Connected Apps gate.
 *
 * `/admin/connected-apps` is an Organization Admin UX. Tenant Admins use the
 * Tenant-native `/admin/tenant/connected-apps` route instead.
 *
 * Requires an active Organization and Org Admin authority for it:
 *   - Org Admin for the active Organization  -> allowed
 *   - Tenant Admin alone                     -> NOT sufficient here
 *   - Platform Super Admin alone             -> NOT sufficient here
 *
 * The backend Organization RPCs deliberately continue to accept Tenant Admin
 * authority as well; this guard only separates the frontend route roles.
 */
export function OrganizationConnectedAppsAdminGuard({ children }: { children: ReactNode }) {
  const ctx = useActiveContext();
  const orgAdmin = useActiveOrgAdminAccess();
  if (ctx.isLoading || orgAdmin.isLoading) return <LoadingShell />;

  const organizationId = ctx.activeOrganization?.id ?? null;
  if (!organizationId) {
    return (
      <AdminNoAccess message="Connected Apps needs an active Organization. Select an Organization from the context selector first." />
    );
  }
  if (orgAdmin.isOrgAdmin) {
    return <>{children}</>;
  }
  return (
    <AdminNoAccess message="Connected Apps is available only to Org Admins for the active Organization. Tenant Admins administer Connected Apps from Tenant Admin, and Platform Super Admin access does not grant organization operational access." />
  );
}


