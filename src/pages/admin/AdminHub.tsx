import { Link, Navigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe, Building2, Shield } from "lucide-react";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { useActiveOrgAdminAccess } from "@/hooks/useActiveOrgAdminAccess";
import { useActiveContext } from "@/context/ActiveContextProvider";
import { AdminLoadingCards, AdminNoAccess, SaasAdminShell } from "./SaasAdminShell";

export default function AdminHub() {
  const access = useAdminAccess();
  const orgAdmin = useActiveOrgAdminAccess();
  const ctx = useActiveContext();

  if (access.isLoading || orgAdmin.isLoading || ctx.isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <AdminLoadingCards count={3} />
      </div>
    );
  }

  const activeTenantId = ctx.activeTenant?.id ?? null;
  const showPlatform = access.canOpenPlatformAdmin;
  const showTenant = !!activeTenantId && access.isTenantAdminForTenant(activeTenantId);
  const showOrg = orgAdmin.isOrgAdmin;

  const accessCount = [showPlatform, showTenant, showOrg].filter(Boolean).length;

  if (accessCount === 0) {
    return <AdminNoAccess message="You do not have Platform, Tenant, or Org Admin access." />;
  }
  if (accessCount === 1) {
    if (showPlatform) return <Navigate to="/admin/platform" replace />;
    if (showTenant) return <Navigate to="/admin/tenant" replace />;
    if (showOrg) return <Navigate to="/admin" replace />;
  }

  return (
    <SaasAdminShell title="Admin" scope="platform">
      <p className="text-sm text-muted-foreground">
        Choose the admin surface you want to open.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {showPlatform && (
          <Link to="/admin/platform" className="block">
            <Card className="h-full hover:border-primary/60 transition-colors">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Globe className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">Platform Admin</CardTitle>
                </div>
                <CardDescription>
                  Platform-level administration for tenants and platform readiness.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Requires Platform Super Admin.
              </CardContent>
            </Card>
          </Link>
        )}
        {showTenant && (
          <Link to="/admin/tenant" className="block">
            <Card className="h-full hover:border-primary/60 transition-colors">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">Tenant Admin</CardTitle>
                </div>
                <CardDescription>
                  Tenant-level administration for organizations, environments, tenant members, and tenant integrations.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Scoped to the active Tenant.
              </CardContent>
            </Card>
          </Link>
        )}
        {showOrg && (
          <Link to="/admin" className="block">
            <Card className="h-full hover:border-primary/60 transition-colors">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">Org Admin</CardTitle>
                </div>
                <CardDescription>
                  Organization-level administration for workspaces and organization settings.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Scoped to the active Organization
                {orgAdmin.organizationName ? ` · ${orgAdmin.organizationName}` : ""}.
              </CardContent>
            </Card>
          </Link>
        )}
      </div>
    </SaasAdminShell>
  );
}
