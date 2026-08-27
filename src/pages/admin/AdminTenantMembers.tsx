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
import { ShieldCheck } from "lucide-react";


// 4D.8B — user-facing tenant role labels. tenant_owner and tenant_admin
// are both surfaced as "Tenant Admin"; tenant_owner remains a backend-only
// protected variant. Other backend roles are humanized generically.
function tenantRoleLabel(role: string): string {
  if (role === "tenant_owner" || role === "tenant_admin") return "Tenant Admin";
  if (role === "tenant_member") return "Tenant Member";
  return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface MemberRow {
  membership_id: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  role: string;
  status: string;
  created_at: string;
  deactivated_at: string | null;
}

export default function AdminTenantMembers() {
  const ctx = useActiveContext();
  const tenantId = ctx.activeTenant?.id ?? null;
  const [manageOpen, setManageOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["tenant-admin-members", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("tenant_admin_list_members", {
        _tenant_id: tenantId,
      });
      if (error) throw error;
      return (data ?? []) as MemberRow[];
    },
    enabled: !!tenantId,
    staleTime: 30_000,
  });

  return (
    <SaasAdminShell
      title="Members"
      scope="tenant"
      contextLabel={ctx.activeTenant?.name ?? null}
      crumbs={[{ label: "Tenant", to: "/admin/tenant" }, { label: "Members" }]}
    >
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setManageOpen(true)} disabled={!tenantId}>
          <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Manage Tenant Admins
        </Button>
        <Button size="sm" disabled variant="outline">Invite member — coming later</Button>
      </div>
      {tenantId && (
        <ManageAdminsDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          scope="tenant_tenant_admin"
          scopeId={tenantId}
          contextLabel={ctx.activeTenant?.name ?? null}
        />
      )}

      {isLoading && <AdminLoadingCards count={2} />}
      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">Failed to load members.</CardContent>
        </Card>
      )}
      {data && data.length === 0 && (
        <AdminEmptyState title="No members yet" />
      )}
      {data && data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tenant members</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((m) => {
                  const isPending = m.status === "pending";
                  const isActive = m.status === "active";
                  return (
                    <TableRow key={m.membership_id}>
                      <TableCell className="font-medium">
                        {m.display_name ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{m.email ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {tenantRoleLabel(m.role)}
                        </Badge>
                        {m.role === "tenant_owner" && (
                          <Badge variant="outline" className="ml-1 text-[10px]">Protected</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            isActive
                              ? "border-green-500/50 text-green-700 dark:text-green-400"
                              : isPending
                                ? "border-amber-500/50 text-amber-700 dark:text-amber-400"
                                : "border-muted-foreground/40 text-muted-foreground"
                          }
                        >
                          {m.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {isPending
                          ? `invited ${new Date(m.created_at).toLocaleDateString()}`
                          : new Date(m.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </SaasAdminShell>
  );
}
