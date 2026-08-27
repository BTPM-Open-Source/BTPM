import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveContext } from "@/context/ActiveContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SaasAdminShell, AdminLoadingCards, AdminEmptyState } from "./SaasAdminShell";
import { ManageAdminsDialog } from "@/components/admin/ManageAdminsDialog";
import { TenantOrganizationDetailDialog } from "@/components/admin/TenantOrganizationDetailDialog";
import { Eye, ShieldCheck } from "lucide-react";

interface OrgRow {
  organization_id: string;
  name: string;
  slug: string;
  organization_kind: string;
  environment_role: "production" | "non_production";
  is_default: boolean;
  active_member_count: number;
  created_at: string;
}

function environmentLabel(kind: string, role: string): string {
  if (role === "production") return "Production";
  switch (kind) {
    case "qas": return "QAS";
    case "test": return "Test";
    case "sandbox": return "Sandbox";
    default: return "Non-production";
  }
}

export default function AdminTenantOrganizations() {
  const ctx = useActiveContext();
  const tenantId = ctx.activeTenant?.id ?? null;
  const [manageOrg, setManageOrg] = useState<{ id: string; name: string } | null>(null);
  const [detailOrg, setDetailOrg] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["tenant-admin-organizations", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("tenant_admin_list_organizations", {
        _tenant_id: tenantId,
      });
      if (error) throw error;
      return (data ?? []) as OrgRow[];
    },
    enabled: !!tenantId,
    staleTime: 30_000,
  });

  return (
    <SaasAdminShell
      title="Organizations / Environments"
      scope="tenant"
      contextLabel={ctx.activeTenant?.name ?? null}
      crumbs={[{ label: "Tenant", to: "/admin/tenant" }, { label: "Organizations" }]}
    >
      <div className="flex justify-end">
        <Button size="sm" disabled variant="outline">Create environment — coming later</Button>
      </div>
      {isLoading && <AdminLoadingCards count={2} />}
      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">Failed to load organizations.</CardContent>
        </Card>
      )}
      {data && data.length === 0 && (
        <AdminEmptyState title="No organizations available" description="This tenant has no organizations yet." />
      )}
      {data && data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Organizations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((o) => {
                  const isProd = o.environment_role === "production";
                  return (
                    <TableRow key={o.organization_id}>
                      <TableCell className="font-medium">
                        {o.name}
                        {o.is_default && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">Default</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{o.slug}</TableCell>
                      <TableCell className="capitalize">{o.organization_kind.replace(/_/g, " ")}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            isProd
                              ? "border-green-500/50 text-green-700 dark:text-green-400"
                              : "border-amber-500/50 text-amber-700 dark:text-amber-400"
                          }
                        >
                          {environmentLabel(o.organization_kind, o.environment_role)}
                        </Badge>
                        {!isProd && (
                          <div className="mt-1 text-[11px] leading-tight text-muted-foreground">
                            Email · real integrations · external API writes: blocked. Exports: watermark required.
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{o.active_member_count}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDetailOrg(o.organization_id)}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" /> View details
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setManageOrg({ id: o.organization_id, name: o.name })}
                        >
                          <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Manage Org Admins
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {manageOrg && (
        <ManageAdminsDialog
          open={!!manageOrg}
          onOpenChange={(v) => !v && setManageOrg(null)}
          scope="tenant_org_admin"
          scopeId={manageOrg.id}
          contextLabel={manageOrg.name}
        />
      )}
      <TenantOrganizationDetailDialog
        open={!!detailOrg}
        onOpenChange={(v) => !v && setDetailOrg(null)}
        organizationId={detailOrg}
      />
    </SaasAdminShell>
  );
}
