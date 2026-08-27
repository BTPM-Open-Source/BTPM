import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, Info } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  organizationId: string | null;
}

interface OrgDetail {
  organization: {
    id: string;
    tenant_id: string;
    tenant_name: string;
    name: string;
    slug: string;
    organization_kind: string;
    environment_role: string;
    is_default: boolean;
    created_at: string;
    updated_at: string;
  };
  environment_safety: Record<string, boolean>;
  workspace_count: number;
  org_admin_count: number;
  integrations: Array<{
    integration_id: string;
    kind: string;
    name: string;
    status: string;
    is_enabled: boolean;
    tenant_active_secret_count: number;
    override_count: number;
    disabled_override_count: number;
    active_override_count: number;
  }>;
}

function SafetyRow({ label, allowed }: { label: string; allowed: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
      <span>{label}</span>
      {allowed ? (
        <span className="flex items-center gap-1 text-green-700 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" /> Allowed
        </span>
      ) : (
        <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
          <XCircle className="h-4 w-4" /> Blocked
        </span>
      )}
    </div>
  );
}

export function TenantOrganizationDetailDialog({ open, onOpenChange, organizationId }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["tenant-admin-org-detail", organizationId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("tenant_admin_get_organization_detail", {
        _organization_id: organizationId,
      });
      if (error) throw error;
      return data as OrgDetail;
    },
    enabled: !!open && !!organizationId,
    staleTime: 15_000,
  });

  const o = data?.organization;
  const s = data?.environment_safety;
  const isProd = o?.environment_role === "production";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{o ? o.name : "Organization detail"}</DialogTitle>
          <DialogDescription>
            Read-only view. Secret values and Vault IDs are never shown here.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {error && <p className="text-sm text-destructive">Failed to load organization detail.</p>}

        {data && o && s && (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Overview</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Tenant:</span> {o.tenant_name}</div>
                <div><span className="text-muted-foreground">Slug:</span> {o.slug}</div>
                <div className="capitalize"><span className="text-muted-foreground normal-case">Kind:</span> {o.organization_kind.replace(/_/g, " ")}</div>
                <div>
                  <span className="text-muted-foreground">Environment:</span>{" "}
                  <Badge
                    variant="outline"
                    className={
                      isProd
                        ? "border-green-500/50 text-green-700 dark:text-green-400"
                        : "border-amber-500/50 text-amber-700 dark:text-amber-400"
                    }
                  >
                    {isProd ? "Production" : "Non-production"}
                  </Badge>
                  {o.is_default && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">Default</Badge>
                  )}
                </div>
                <div><span className="text-muted-foreground">Created:</span> {new Date(o.created_at).toLocaleString()}</div>
                <div><span className="text-muted-foreground">Updated:</span> {new Date(o.updated_at).toLocaleString()}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Environment safety</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <SafetyRow label="Outbound email" allowed={!!s.outbound_email} />
                <SafetyRow label="Real integrations" allowed={!!s.real_integration} />
                <SafetyRow label="External API writes" allowed={!!s.external_api_write} />
                <SafetyRow label="Export without watermark" allowed={!!s.export_without_watermark} />
                <SafetyRow label="Export" allowed={!!s.export} />
                <SafetyRow label="Storage writes" allowed={!!s.storage_write} />
                <SafetyRow label="Background jobs" allowed={!!s.background_job_enqueue} />
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Workspaces</CardTitle></CardHeader>
                <CardContent className="text-2xl font-semibold">{data.workspace_count}</CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Org admins</CardTitle></CardHeader>
                <CardContent className="text-2xl font-semibold">{data.org_admin_count}</CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Integration overrides</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.integrations.length === 0 && (
                  <p className="text-xs text-muted-foreground">No tenant integrations configured yet.</p>
                )}
                {data.integrations.map((i) => (
                  <div key={i.integration_id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <div>
                      <div className="font-medium capitalize">{i.kind.replace(/_/g, " ")}</div>
                      <div className="text-xs text-muted-foreground">{i.name}</div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="capitalize">{i.status.replace(/_/g, " ")}</Badge>
                      {i.disabled_override_count > 0 && (
                        <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                          {i.disabled_override_count} disabled here
                        </Badge>
                      )}
                      {i.active_override_count > 0 && (
                        <Badge variant="secondary">{i.active_override_count} override</Badge>
                      )}
                      {i.active_override_count === 0 && i.disabled_override_count === 0 && (
                        <span className="text-muted-foreground">Inherits tenant default</span>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {!isProd && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                <Info className="h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  This is a non-production environment. Outbound email, real integrations and
                  external API writes are blocked. Exports must carry a non-production watermark.
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
