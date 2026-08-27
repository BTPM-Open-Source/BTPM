import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveContext } from "@/context/ActiveContextProvider";
import { SaasAdminShell, AdminLoadingCards, AdminEmptyState } from "./SaasAdminShell";
import ConnectedAppsOrganizationSurface from "./ConnectedAppsOrganizationSurface";

/**
 * Step API-ADM.7 / API-ADM.8 — Tenant-native Connected Apps administration.
 *
 * Tenant-specific responsibility only: choose which Organization inside the
 * active Tenant is administered. The application-wide active Organization
 * selection is deliberately never used as the administration target.
 *
 * All Connected Apps list / connection / management orchestration is delegated
 * to the shared `ConnectedAppsOrganizationSurface`, which executes the canonical
 * Organization RPCs under the caller's Tenant Admin authority.
 *
 * Reads only `public.tenant_admin_list_organizations` here. No direct table
 * access, no Tenant-level enablement or grant model, no new backend surface.
 */

interface TenantOrganizationOption {
  organization_id: string;
  name: string;
  organization_kind: string;
  environment_role: "production" | "non_production";
}

/** Safe selector label; only fields already returned by the Tenant reader. */
export function tenantOrganizationOptionLabel(option: {
  name: string;
  environment_role: string;
}): string {
  return option.environment_role === "production"
    ? option.name
    : `${option.name} · Non-production`;
}

export default function AdminTenantConnectedApps() {
  const ctx = useActiveContext();
  const tenantId = ctx.activeTenant?.id ?? null;
  const tenantName = ctx.activeTenant?.name ?? null;

  // Tenant administration target — explicitly chosen, never inherited.
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  const organizations = useQuery({
    queryKey: ["tenant-connected-app-organizations", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("tenant_admin_list_organizations", {
        _tenant_id: tenantId,
      });
      if (error) throw error;
      return (data ?? []) as TenantOrganizationOption[];
    },
    staleTime: 30_000,
  });

  const organizationOptions = useMemo(
    () => (tenantId ? organizations.data ?? [] : []),
    [tenantId, organizations.data],
  );

  const selectedOrganization = useMemo(
    () =>
      organizationId
        ? organizationOptions.find((o) => o.organization_id === organizationId) ?? null
        : null,
    [organizationId, organizationOptions],
  );

  // Tenant switch clears the explicitly chosen administration target.
  useEffect(() => {
    setOrganizationId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Deterministic initial selection: auto-select only a single Organization.
  // Multiple Organizations always require an explicit choice.
  useEffect(() => {
    if (organizations.isLoading || organizations.isFetching) return;
    if (organizationId) {
      // Fail-safe: a selection that disappeared from the authorized result is cleared.
      if (!organizationOptions.some((o) => o.organization_id === organizationId)) {
        setOrganizationId(null);
      }
      return;
    }
    if (organizationOptions.length === 1) {
      setOrganizationId(organizationOptions[0].organization_id);
    }
  }, [organizationOptions, organizationId, organizations.isLoading, organizations.isFetching]);

  /** Caller-owned parent summary key; the shared surface derives its list key from it. */
  const parentSummaryQueryKey = useMemo(
    () => ["tenant-connected-apps", tenantId, organizationId] as const,
    [tenantId, organizationId],
  );

  const organizationSelector = (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Organization</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-sm">
          <Select
            value={organizationId ?? undefined}
            onValueChange={(next) => setOrganizationId(next)}
          >
            <SelectTrigger aria-label="Organization">
              <SelectValue placeholder="Select an Organization" />
            </SelectTrigger>
            <SelectContent>
              {organizationOptions.map((option) => (
                <SelectItem key={option.organization_id} value={option.organization_id}>
                  {tenantOrganizationOptionLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedOrganization ? (
          <Badge variant="outline" className="font-normal">
            Administering {selectedOrganization.name}
          </Badge>
        ) : (
          <p className="text-xs text-muted-foreground">
            Select an Organization to administer its Connected Apps.
          </p>
        )}
      </CardContent>
    </Card>
  );

  // ------------------------------------------------------- Zero Organizations
  if (!organizations.isLoading && organizationOptions.length === 0) {
    return (
      <SaasAdminShell
        title="Connected Apps"
        scope="tenant"
        contextLabel={tenantName}
        crumbs={[{ label: "Tenant", to: "/admin/tenant" }, { label: "Connected Apps" }]}
      >
        {organizations.error ? (
          <Card>
            <CardContent className="py-6 text-sm text-destructive">
              Failed to load Organizations for this Tenant.
            </CardContent>
          </Card>
        ) : (
          <AdminEmptyState
            title="No Organizations are available in this Tenant."
            description="Connected Apps are administered per Organization."
          />
        )}
      </SaasAdminShell>
    );
  }

  return (
    <SaasAdminShell
      title="Connected Apps"
      scope="tenant"
      contextLabel={tenantName}
      crumbs={[{ label: "Tenant", to: "/admin/tenant" }, { label: "Connected Apps" }]}
    >
      <p className="text-xs text-muted-foreground">
        Manage Connected Apps across Organizations in this Tenant. Choose the Organization you want
        to administer.
      </p>

      {organizationSelector}

      {organizations.isLoading && <AdminLoadingCards count={2} />}

      {!organizationId && !organizations.isLoading && (
        <AdminEmptyState
          title="Select an Organization"
          description="Connected Apps are administered per Organization inside this Tenant."
        />
      )}

      {organizationId && selectedOrganization && (
        <ConnectedAppsOrganizationSurface
          context="tenant"
          organizationId={organizationId}
          organizationName={selectedOrganization.name}
          parentSummaryQueryKey={parentSummaryQueryKey}
        />
      )}
    </SaasAdminShell>
  );
}
