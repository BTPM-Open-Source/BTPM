import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveContext } from "@/context/ActiveContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SaasAdminShell, AdminLoadingCards } from "./SaasAdminShell";
import { Building2, Users, Plug, HardDrive, ShieldCheck, AppWindow } from "lucide-react";

interface Overview {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    default_organization_name: string | null;
  };
  counts: Record<string, number>;
}

function useTenantOverview(tenantId: string | null) {
  return useQuery({
    queryKey: ["tenant-admin-overview", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("tenant_admin_get_overview", {
        _tenant_id: tenantId,
      });
      if (error) throw error;
      return data as Overview;
    },
    enabled: !!tenantId,
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

export default function AdminTenant() {
  const ctx = useActiveContext();
  const tenantId = ctx.activeTenant?.id ?? null;
  const { data, isLoading, error } = useTenantOverview(tenantId);

  return (
    <SaasAdminShell
      title="Tenant Admin"
      scope="tenant"
      contextLabel={ctx.activeTenant?.name ?? null}
      crumbs={[{ label: "Tenant" }]}
    >
      <p className="text-xs text-muted-foreground">
        Tenant-level administration for Organizations, Environments, tenant members, and tenant integrations.
      </p>
      {isLoading && <AdminLoadingCards count={3} />}
      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Failed to load tenant overview.
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{data.tenant.name}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4">
              <Stat label="Status" value={data.tenant.status} />
              <Stat label="Default organization" value={data.tenant.default_organization_name ?? "—"} />
              <Stat label="Organizations" value={data.counts.organizations ?? 0} />
              <Stat label="Active members" value={data.counts.active_members ?? 0} />
              <Stat label="Admins" value={data.counts.admins ?? 0} />
              <Stat label="Integrations" value={data.counts.integrations ?? 0} />
              <Stat label="Storage objects" value={data.counts.storage_objects ?? 0} />
              <Stat label="Export packages" value={data.counts.export_packages ?? 0} />
              <Stat label="Jobs queued" value={data.counts.jobs_queued ?? 0} />
              <Stat label="Jobs running" value={data.counts.jobs_running ?? 0} />
              <Stat label="Jobs failed" value={data.counts.jobs_failed ?? 0} />
            </CardContent>
          </Card>

          <div className="grid gap-3 md:grid-cols-2">
            <NavCard
              to="/admin/tenant/organizations"
              icon={Building2}
              title="Organizations / Environments"
              desc="Browse tenant organizations. Environment creation coming later."
            />
            <NavCard
              to="/admin/tenant/members"
              icon={Users}
              title="Members"
              desc="View tenant members and roles. Editing coming later."
            />
            <NavCard
              to="/admin/tenant/integrations"
              icon={Plug}
              title="Integrations"
              desc="See integration metadata. Secret values are never shown."
            />
            <NavCard
              to="/admin/tenant/connected-apps"
              icon={AppWindow}
              title="Connected Apps"
              desc="Manage Connected Apps across Organizations in this Tenant."
            />

            <NavCard
              to="/admin/tenant/encryption"
              icon={ShieldCheck}
              title="Encryption"
              desc="View tenant encryption posture, Organization isolation, and readiness. No keys or Vault data are shown."
            />
            <NavCard
              to="/admin/tenant/files-exports-jobs"
              icon={HardDrive}
              title="Files, exports, jobs"
              desc="Counts and status only. No payloads."
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Invite member — coming later</Badge>
            <Badge variant="outline">Create environment — coming later</Badge>
            <Badge variant="outline">Configure integration — coming later</Badge>
          </div>
        </>
      )}
    </SaasAdminShell>
  );
}

function NavCard({
  to,
  icon: Icon,
  title,
  desc,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <Link to={to} className="block">
      <Card className="h-full hover:border-primary/60 transition-colors">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            <CardTitle className="text-sm">{title}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">{desc}</CardContent>
      </Card>
    </Link>
  );
}
