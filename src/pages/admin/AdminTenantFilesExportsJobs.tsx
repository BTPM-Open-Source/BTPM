import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveContext } from "@/context/ActiveContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SaasAdminShell, AdminLoadingCards, AdminEmptyState } from "./SaasAdminShell";

interface OpsSummary {
  storage_object_count: number;
  export_packages_by_status: Record<string, number>;
  import_temp_by_status: Record<string, number>;
  background_jobs_by_status: Record<string, number>;
  scheduler_runs_by_status: Record<string, number>;
}

function StatusBreakdown({
  title,
  counts,
  emptyLabel,
}: {
  title: string;
  counts: Record<string, number>;
  emptyLabel: string;
}) {
  const entries = Object.entries(counts ?? {});
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">{emptyLabel}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {entries.map(([status, count]) => (
              <Badge key={status} variant="outline" className="capitalize">
                {status.replace(/_/g, " ")} · {count}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminTenantFilesExportsJobs() {
  const ctx = useActiveContext();
  const tenantId = ctx.activeTenant?.id ?? null;
  const { data, isLoading, error } = useQuery({
    queryKey: ["tenant-admin-ops-summary", tenantId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("tenant_admin_get_operations_summary", {
        _tenant_id: tenantId,
      });
      if (error) throw error;
      return data as OpsSummary;
    },
    enabled: !!tenantId,
    staleTime: 30_000,
  });

  return (
    <SaasAdminShell
      title="Files, exports & jobs"
      scope="tenant"
      contextLabel={ctx.activeTenant?.name ?? null}
      crumbs={[{ label: "Tenant", to: "/admin/tenant" }, { label: "Files / Exports / Jobs" }]}
    >
      <p className="text-xs text-muted-foreground">
        Counts and status only. Storage paths, job payloads, and secrets are not shown.
      </p>
      {isLoading && <AdminLoadingCards count={3} />}
      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">Failed to load operations summary.</CardContent>
        </Card>
      )}
      {data && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Storage objects</CardTitle>
            </CardHeader>
            <CardContent>
              {data.storage_object_count === 0 ? (
                <AdminEmptyState title="No storage objects yet" />
              ) : (
                <p className="text-2xl font-semibold">{data.storage_object_count}</p>
              )}
            </CardContent>
          </Card>
          <div className="grid gap-3 md:grid-cols-2">
            <StatusBreakdown
              title="Export packages"
              counts={data.export_packages_by_status}
              emptyLabel="No exports yet"
            />
            <StatusBreakdown
              title="Import temp objects"
              counts={data.import_temp_by_status}
              emptyLabel="No imports yet"
            />
            <StatusBreakdown
              title="Background jobs"
              counts={data.background_jobs_by_status}
              emptyLabel="No jobs yet"
            />
            <StatusBreakdown
              title="Scheduler runs"
              counts={data.scheduler_runs_by_status}
              emptyLabel="No scheduler runs yet"
            />
          </div>
        </>
      )}
    </SaasAdminShell>
  );
}
