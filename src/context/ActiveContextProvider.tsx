import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const ACTIVE_ORG_HINT_KEY = "btpm:active-context-org:v1";

/**
 * Phase 4D.3 — Active Tenant / Organization / Workspace Context.
 *
 * Backend-authoritative context selection. This provider does NOT grant access.
 * Values are resolved by `public.get_my_active_context()` and mutated only via
 * `public.set_my_active_context()`, both of which validate memberships.
 */

export type EnvironmentRole = "production" | "non_production";
export type OrganizationKind =
  | "production"
  | "qas"
  | "test"
  | "sandbox"
  | "business_unit"
  | "legal_entity"
  | "other";

export interface ActiveTenant {
  id: string;
  name: string;
  slug: string;
}
export interface ActiveOrganization {
  id: string;
  name: string;
  slug: string;
  kind: OrganizationKind;
  environmentRole: EnvironmentRole;
}
export interface ActiveWorkspaceLite {
  id: string;
  name: string;
}

export interface AvailableTenant {
  tenant_id: string;
  name: string;
  slug: string;
  role: string;
}
export interface AvailableOrganization {
  organization_id: string;
  name: string;
  slug: string;
  organization_kind: OrganizationKind;
  environment_role: EnvironmentRole;
  role: string;
}
export interface AvailableWorkspace {
  workspace_id: string;
  name: string;
}

interface ActiveContextValue {
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  errorMessage: string | null;
  hasAccess: boolean;
  requiresTenantSelection: boolean;
  requiresOrganizationSelection: boolean;
  activeTenant: ActiveTenant | null;
  activeOrganization: ActiveOrganization | null;
  activeWorkspace: ActiveWorkspaceLite | null;
  isAllWorkspaces: boolean;
  availableTenantCount: number;
  availableOrganizationCount: number;
  availableWorkspaceCount: number;
  refresh: () => Promise<void>;
  setActiveContext: (args: {
    tenantId: string;
    organizationId: string;
    workspaceId?: string | null;
    isAllWorkspaces?: boolean;
  }) => Promise<void>;
}

const Ctx = createContext<ActiveContextValue | null>(null);

async function fetchActiveContext() {
  const { data, error } = await supabase.rpc("get_my_active_context");
  if (error) throw error;
  return (data as any) ?? {};
}

export function ActiveContextProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading, refetch, error, isError } = useQuery({
    queryKey: ["active-context", user?.id],
    queryFn: fetchActiveContext,
    enabled: !!user,
    staleTime: 60_000,
    retry: 1,
  });

  if (isError && typeof window !== "undefined" && import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn("[ActiveContext] get_my_active_context failed:", error);
  }

  const setMutation = useMutation({
    mutationFn: async (args: {
      tenantId: string;
      organizationId: string;
      workspaceId?: string | null;
      isAllWorkspaces?: boolean;
    }) => {
      const { data: res, error } = await supabase.rpc("set_my_active_context", {
        _tenant_id: args.tenantId,
        _organization_id: args.organizationId,
        _workspace_id: args.workspaceId ?? undefined,
        _is_all_workspaces: args.isAllWorkspaces ?? false,
      });
      if (error) throw error;
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["active-context"] });
    },
  });

  const value = useMemo<ActiveContextValue>(() => {
    const d: any = data ?? {};
    const activeTenant: ActiveTenant | null = d.tenant_id
      ? { id: d.tenant_id, name: d.tenant_name, slug: d.tenant_slug }
      : null;
    const activeOrganization: ActiveOrganization | null = d.organization_id
      ? {
          id: d.organization_id,
          name: d.organization_name,
          slug: d.organization_slug,
          kind: d.organization_kind,
          environmentRole: d.environment_role,
        }
      : null;
    const activeWorkspace: ActiveWorkspaceLite | null = d.workspace_id
      ? { id: d.workspace_id, name: d.workspace_name }
      : null;
    return {
      isLoading,
      isError,
      error: (error as Error | null) ?? null,
      errorMessage: error ? (error as Error).message ?? String(error) : null,
      hasAccess: d.has_access !== false,
      requiresTenantSelection: !!d.requires_tenant_selection,
      requiresOrganizationSelection: !!d.requires_organization_selection,
      activeTenant,
      activeOrganization,
      activeWorkspace,
      isAllWorkspaces: !!d.is_all_workspaces,
      availableTenantCount: d.available_tenant_count ?? 0,
      availableOrganizationCount: d.available_organization_count ?? 0,
      availableWorkspaceCount: d.available_workspace_count ?? 0,
      refresh: async () => {
        await refetch();
      },
      setActiveContext: async (args) => {
        await setMutation.mutateAsync(args);
      },
    };
  }, [data, isLoading, isError, error, refetch, setMutation]);

  // Phase 4D.7 — Sync active org hint + invalidate workspace-scoped queries
  // whenever the resolved active organization changes.
  const prevOrgIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentOrgId = value.activeOrganization?.id ?? null;
    try {
      if (typeof window !== "undefined") {
        if (currentOrgId) window.localStorage.setItem(ACTIVE_ORG_HINT_KEY, currentOrgId);
        else window.localStorage.removeItem(ACTIVE_ORG_HINT_KEY);
      }
    } catch { /* ignore */ }
    if (prevOrgIdRef.current !== currentOrgId) {
      prevOrgIdRef.current = currentOrgId;
      qc.invalidateQueries({ queryKey: ["workspaces"] });
    }
  }, [value.activeOrganization?.id, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useActiveContext() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useActiveContext must be used inside ActiveContextProvider");
  return ctx;
}

export function useAvailableTenants() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["active-context", "tenants", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_my_tenants");
      if (error) throw error;
      return (data ?? []) as AvailableTenant[];
    },
  });
}

export function useAvailableOrganizations(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: ["active-context", "orgs", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_my_organizations_for_tenant", {
        _tenant_id: tenantId!,
      });
      if (error) throw error;
      return (data ?? []) as AvailableOrganization[];
    },
  });
}

export function useAvailableWorkspacesForOrg(organizationId: string | null | undefined) {
  return useQuery({
    queryKey: ["active-context", "workspaces", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_my_workspaces_for_organization", {
        _organization_id: organizationId!,
      });
      if (error) throw error;
      return (data ?? []) as AvailableWorkspace[];
    },
  });
}
