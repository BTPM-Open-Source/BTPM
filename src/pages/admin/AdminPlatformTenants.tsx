import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SaasAdminShell, AdminLoadingCards, AdminEmptyState } from "./SaasAdminShell";
import { ManageAdminsDialog } from "@/components/admin/ManageAdminsDialog";
import { ShieldCheck } from "lucide-react";


interface TenantRow {
  tenant_id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  default_organization_id: string | null;
  default_organization_name: string | null;
  organization_count: number;
  active_member_count: number;
  admin_count: number;
}

export default function AdminPlatformTenants() {
  const [manageTenant, setManageTenant] = useState<{ id: string; name: string } | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["platform-admin-list-tenants"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("platform_admin_list_tenants", {
        _reason: null,
      });
      if (error) throw error;
      return (data ?? []) as TenantRow[];
    },
    staleTime: 30_000,
  });

  return (
    <SaasAdminShell
      title="Tenants"
      scope="platform"
      crumbs={[{ label: "Platform", to: "/admin/platform" }, { label: "Tenants" }]}
    >
      {isLoading && <AdminLoadingCards count={3} />}
      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">Failed to load tenants.</CardContent>
        </Card>
      )}
      {data && data.length === 0 && (
        <AdminEmptyState title="No tenants found" description="No tenants have been provisioned yet." />
      )}
      {data && data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All tenants</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Default org</TableHead>
                  <TableHead className="text-right">Orgs</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead className="text-right">Admins</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>

                </TableRow>

              </TableHeader>
              <TableBody>
                {data.map((t) => (
                  <TableRow key={t.tenant_id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{t.slug}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{t.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.default_organization_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">{t.organization_count}</TableCell>
                    <TableCell className="text-right">{t.active_member_count}</TableCell>
                    <TableCell className="text-right">{t.admin_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setManageTenant({ id: t.tenant_id, name: t.name })}
                      >
                        <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Manage
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {manageTenant && (
        <ManageAdminsDialog
          open={!!manageTenant}
          onOpenChange={(v) => !v && setManageTenant(null)}
          scope="platform_tenant_admin"
          scopeId={manageTenant.id}
          contextLabel={manageTenant.name}
        />
      )}
    </SaasAdminShell>
  );
}

