import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Info } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  integrationId: string | null;
}

interface Detail {
  integration: {
    id: string;
    kind: string;
    name: string;
    status: string;
    is_enabled: boolean;
    has_config_metadata: boolean;
    config_metadata_key_count: number;
    last_tested_at: string | null;
    last_success_at: string | null;
    last_error_at: string | null;
    last_error_message: string | null;
    created_at: string;
    updated_at: string;
    tenant_active_secret_count: number;
  };
  secrets: Array<{
    secret_name: string;
    secret_kind: string;
    secret_scope: "tenant" | "organization_override";
    status: string;
    organization_id: string | null;
    organization_name: string | null;
    updated_at: string | null;
    rotated_at: string | null;
    disabled_at: string | null;
    revoked_at: string | null;
  }>;
  organization_matrix: Array<{
    organization_id: string;
    organization_name: string;
    organization_slug: string;
    organization_kind: string;
    environment_role: string;
    is_production: boolean;
    override_count: number;
    disabled_override_count: number;
    effective_source: "tenant_default" | "organization_override" | "disabled" | "missing";
  }>;
}

function effectiveBadge(src: Detail["organization_matrix"][number]["effective_source"]) {
  switch (src) {
    case "tenant_default":
      return <Badge variant="secondary">Tenant default</Badge>;
    case "organization_override":
      return <Badge variant="outline" className="border-blue-500/50 text-blue-700 dark:text-blue-400">Org override</Badge>;
    case "disabled":
      return <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">Disabled</Badge>;
    case "missing":
      return <Badge variant="outline" className="border-destructive/60 text-destructive">Missing</Badge>;
  }
}

export function TenantIntegrationDetailDialog({ open, onOpenChange, integrationId }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["tenant-admin-integration-detail", integrationId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("tenant_admin_get_integration_detail", {
        _integration_id: integrationId,
      });
      if (error) throw error;
      return data as Detail;
    },
    enabled: !!open && !!integrationId,
    staleTime: 15_000,
  });

  const i = data?.integration;
  const isSmtp = i?.kind === "smtp";
  const isDisabled = i?.status === "disabled" || i?.is_enabled === false;
  const missingTenantConfig = (i?.tenant_active_secret_count ?? 0) === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="capitalize">
            {i ? i.kind.replace(/_/g, " ") : "Integration detail"}
          </DialogTitle>
          <DialogDescription>
            Read-only metadata. Secret values, Vault IDs, tokens, connection strings and
            passwords are never displayed.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {error && <p className="text-sm text-destructive">Failed to load integration detail.</p>}

        {data && i && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Overview</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Name:</span> {i.name}</div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge variant="outline" className="capitalize">{i.status.replace(/_/g, " ")}</Badge>
                </div>
                <div><span className="text-muted-foreground">Enabled:</span> {i.is_enabled ? "Yes" : "No"}</div>
                <div>
                  <span className="text-muted-foreground">Tenant-level secrets active:</span>{" "}
                  {i.tenant_active_secret_count}
                </div>
                <div>
                  <span className="text-muted-foreground">Last tested:</span>{" "}
                  {i.last_tested_at ? new Date(i.last_tested_at).toLocaleString() : "—"}
                </div>
                <div>
                  <span className="text-muted-foreground">Last success:</span>{" "}
                  {i.last_success_at ? new Date(i.last_success_at).toLocaleString() : "—"}
                </div>
              </CardContent>
            </Card>

            {isDisabled && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                <Info className="h-4 w-4 shrink-0 text-amber-600" />
                <div>This integration is disabled.</div>
              </div>
            )}
            {missingTenantConfig && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
                <Info className="h-4 w-4 shrink-0 text-destructive" />
                <div>Tenant-level configuration is missing. Use Configure secrets to add it.</div>
              </div>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Required secrets (metadata only)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {data.secrets.length === 0 ? (
                  <p className="p-4 text-xs text-muted-foreground">No secret references configured.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Secret name</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead>Scope</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Organization</TableHead>
                        <TableHead>Updated</TableHead>
                        <TableHead>Rotated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.secrets.map((s) => (
                        <TableRow key={`${s.secret_scope}:${s.organization_id ?? "tenant"}:${s.secret_name}`}>
                          <TableCell className="font-mono text-xs">{s.secret_name}</TableCell>
                          <TableCell className="text-xs">{s.secret_kind}</TableCell>
                          <TableCell className="text-xs capitalize">
                            {s.secret_scope === "tenant" ? "Tenant" : "Org override"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize text-[10px]">{s.status}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{s.organization_name ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {s.updated_at ? new Date(s.updated_at).toLocaleDateString() : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {s.rotated_at ? new Date(s.rotated_at).toLocaleDateString() : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Organization override matrix</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {data.organization_matrix.length === 0 ? (
                  <p className="p-4 text-xs text-muted-foreground">No organizations in this tenant.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Organization</TableHead>
                        <TableHead>Environment</TableHead>
                        <TableHead>Effective source</TableHead>
                        <TableHead>Real integrations</TableHead>
                        {isSmtp && <TableHead>Outbound email</TableHead>}
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.organization_matrix.map((r) => (
                        <TableRow key={r.organization_id}>
                          <TableCell className="text-sm">
                            <div className="font-medium">{r.organization_name}</div>
                            <div className="text-[10px] text-muted-foreground">{r.organization_slug}</div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                r.is_production
                                  ? "border-green-500/50 text-green-700 dark:text-green-400"
                                  : "border-amber-500/50 text-amber-700 dark:text-amber-400"
                              }
                            >
                              {r.is_production ? "Production" : "Non-production"}
                            </Badge>
                          </TableCell>
                          <TableCell>{effectiveBadge(r.effective_source)}</TableCell>
                          <TableCell className="text-xs">
                            {r.is_production ? "Allowed" : (
                              <span className="text-amber-700 dark:text-amber-400">Blocked</span>
                            )}
                          </TableCell>
                          {isSmtp && (
                            <TableCell className="text-xs">
                              {r.is_production ? "Allowed" : (
                                <span className="text-amber-700 dark:text-amber-400">Blocked</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" disabled>Configure later</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs">
              <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                Secret setup is available from Configure secrets. Runtime connection
                testing will be enabled in a later phase. This screen never renders
                secret values or Vault IDs.
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
