import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Circle } from "lucide-react";
import { SaasAdminShell, AdminLoadingCards } from "./SaasAdminShell";

const SUBSTRATE_KEYS: Array<{ key: string; label: string }> = [
  { key: "tenant_memberships", label: "Tenant memberships" },
  { key: "organization_memberships", label: "Organization memberships" },
  { key: "tenant_integrations", label: "Tenant integrations" },
  { key: "tenant_storage_objects", label: "Tenant storage object registry" },
  { key: "tenant_export_packages", label: "Tenant export package registry" },
  { key: "tenant_background_jobs", label: "Tenant background jobs" },
  { key: "tenant_scheduler_runs", label: "Tenant scheduler runs" },
];

export default function AdminPlatformSystem() {
  const { data, isLoading } = useQuery({
    queryKey: ["platform-admin-overview"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("platform_admin_get_overview", {
        _reason: null,
      });
      if (error) throw error;
      return data as { substrate: Record<string, number> };
    },
    staleTime: 30_000,
  });

  return (
    <SaasAdminShell
      title="System readiness"
      scope="platform"
      crumbs={[{ label: "Platform", to: "/admin/platform" }, { label: "System" }]}
    >
      {isLoading ? (
        <AdminLoadingCards count={3} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Substrate presence</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {SUBSTRATE_KEYS.map(({ key, label }) => {
              const count = data?.substrate?.[key] ?? 0;
              const present = count > 0;
              return (
                <div key={key} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2">
                    {present ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-sm">{label}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {present ? `${count} rows` : "empty"}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </SaasAdminShell>
  );
}
