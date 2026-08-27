import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Phase 4D.6 — Admin capability detection.
 *
 * Backend-authoritative via `public.get_my_admin_access_summary`. This hook
 * does NOT grant access; it only reports what the caller may open.
 */

export interface TenantAdminMembership {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  tenant_status: string;
  role: "tenant_owner" | "tenant_admin";
}

export interface AdminAccess {
  isPlatformSuperAdmin: boolean;
  tenantAdminMemberships: TenantAdminMembership[];
  tenantAdminTenantIds: string[];
  hasTenantAdminAccess: boolean;
  canOpenPlatformAdmin: boolean;
  canOpenTenantAdmin: boolean;
  isTenantAdminForTenant: (tenantId: string | null | undefined) => boolean;
  isLoading: boolean;
  error: unknown;
}

const EMPTY: AdminAccess = {
  isPlatformSuperAdmin: false,
  tenantAdminMemberships: [],
  tenantAdminTenantIds: [],
  hasTenantAdminAccess: false,
  canOpenPlatformAdmin: false,
  canOpenTenantAdmin: false,
  isTenantAdminForTenant: () => false,
  isLoading: false,
  error: null,
};

export function useAdminAccess(): AdminAccess {
  const { user, loading: authLoading } = useAuth();

  const query = useQuery({
    queryKey: ["admin-access-summary", user?.id ?? null],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_my_admin_access_summary");
      if (error) throw error;
      const payload = (data ?? {}) as {
        is_platform_super_admin?: boolean;
        tenant_admin_memberships?: TenantAdminMembership[];
      };
      return {
        isPlatformSuperAdmin: !!payload.is_platform_super_admin,
        tenantAdminMemberships: payload.tenant_admin_memberships ?? [],
      };
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  if (!user) return { ...EMPTY, isLoading: authLoading };

  const isPlatformSuperAdmin = !!query.data?.isPlatformSuperAdmin;
  const memberships = query.data?.tenantAdminMemberships ?? [];
  const tenantIds = memberships.map((m) => m.tenant_id);
  const set = new Set(tenantIds);

  return {
    isPlatformSuperAdmin,
    tenantAdminMemberships: memberships,
    tenantAdminTenantIds: tenantIds,
    hasTenantAdminAccess: memberships.length > 0,
    canOpenPlatformAdmin: isPlatformSuperAdmin,
    canOpenTenantAdmin: memberships.length > 0,
    isTenantAdminForTenant: (tenantId) => (tenantId ? set.has(tenantId) : false),
    isLoading: authLoading || query.isLoading,
    error: query.error,
  };
}
