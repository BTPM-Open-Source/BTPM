import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { SaasAdminShell, AdminLoadingCards } from "./SaasAdminShell";

interface Overview {
  tenants: Record<string, number>;
  organizations: Record<string, number>;
  substrate: Record<string, number>;
}

function usePlatformOverview() {
  return useQuery({
    queryKey: ["platform-admin-overview"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("platform_admin_get_overview", {
        _reason: null,
      });
      if (error) throw error;
      return data as Overview;
    },
    staleTime: 30_000,
  });
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold text-foreground mt-1">{value}</p>
    </div>
  );
}

export default function AdminPlatform() {
  const { data, isLoading, error } = usePlatformOverview();
  return (
    <SaasAdminShell title="Platform Admin" scope="platform" crumbs={[{ label: "Platform" }]}>
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Platform Admin does not grant tenant workspace access. Tenant operational access
          requires tenant and organization membership.
        </AlertDescription>
      </Alert>

      {isLoading && <AdminLoadingCards count={3} />}
      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Failed to load platform overview.
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Tenants</CardTitle>
                <Link to="/admin/platform/tenants" className="text-xs text-primary hover:underline">
                  View all →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-5">
              <Stat label="Total" value={data.tenants.total ?? 0} />
              <Stat label="Active" value={data.tenants.active ?? 0} />
              <Stat label="Provisioning" value={data.tenants.provisioning ?? 0} />
              <Stat label="Suspended" value={data.tenants.suspended ?? 0} />
              <Stat label="Archived / Deletion" value={data.tenants.archived ?? 0} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Organizations / Environments</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <Stat label="Total" value={data.organizations.total ?? 0} />
              <Stat label="Production" value={data.organizations.production ?? 0} />
              <Stat label="Non-production" value={data.organizations.non_production ?? 0} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Substrate readiness</CardTitle>
                <Link to="/admin/platform/system" className="text-xs text-primary hover:underline">
                  System details →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
              <Stat label="Tenant memberships" value={data.substrate.tenant_memberships ?? 0} />
              <Stat label="Organization memberships" value={data.substrate.organization_memberships ?? 0} />
              <Stat label="Tenant integrations" value={data.substrate.tenant_integrations ?? 0} />
              <Stat label="Storage objects" value={data.substrate.tenant_storage_objects ?? 0} />
              <Stat label="Export packages" value={data.substrate.tenant_export_packages ?? 0} />
              <Stat label="Background jobs" value={data.substrate.tenant_background_jobs ?? 0} />
              <Stat label="Scheduler runs" value={data.substrate.tenant_scheduler_runs ?? 0} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">API clients</CardTitle>
                <Link to="/admin/platform/api-clients" className="text-xs text-primary hover:underline">
                  View all →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Registered API clients, redirects, policy versions and enabled capabilities.
            </CardContent>
          </Card>


          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Create tenant — coming later</Badge>
            <Badge variant="outline">Suspend tenant — coming later</Badge>
            <Badge variant="outline">Support impersonation — coming later</Badge>
          </div>
        </>
      )}
    </SaasAdminShell>
  );
}
