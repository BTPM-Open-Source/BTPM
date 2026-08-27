import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveContext } from "@/context/ActiveContextProvider";

/**
 * Phase 4D.8 — Route Context Boundary
 *
 * Resolves the Tenant / Organization / Workspace that a route-level object
 * (workspace, program, project, phase, task) belongs to and compares it to
 * the caller's currently active Organization.
 *
 * Backend-authoritative: uses `public.resolve_route_context_boundary` which
 * only returns safe boundary metadata (never business payload).
 */

export type RouteObjectType = "workspace" | "program" | "project" | "phase" | "task";

export interface RouteBoundary {
  has_access: boolean;
  not_found?: boolean;
  inconsistent?: boolean;
  reason?: string;
  object_type: RouteObjectType;
  object_id: string;
  tenant_id?: string;
  tenant_name?: string;
  tenant_slug?: string;
  organization_id?: string;
  organization_name?: string;
  organization_slug?: string;
  environment_role?: "production" | "non_production";
  organization_kind?: string;
  workspace_id?: string;
  workspace_name?: string;
}

export interface RouteBoundaryInput {
  workspaceId?: string | null;
  projectId?: string | null;
  programId?: string | null;
  phaseId?: string | null;
  taskId?: string | null;
}

export type BoundaryStatus =
  | "loading"
  | "error"
  | "not_found"
  | "inconsistent"
  | "access_denied"
  | "mismatch"
  | "ok";

export interface UseRouteContextBoundaryResult {
  status: BoundaryStatus;
  boundary: RouteBoundary | null;
  activeOrganizationId: string | null;
  activeOrganizationName: string | null;
  activeTenantName: string | null;
  error: Error | null;
  refetch: () => Promise<unknown>;
}

export function useRouteContextBoundary(input: RouteBoundaryInput): UseRouteContextBoundaryResult {
  const { activeOrganization, activeTenant, isLoading: ctxLoading } = useActiveContext();

  const anyId = input.workspaceId || input.projectId || input.programId || input.phaseId || input.taskId;
  const query = useQuery({
    queryKey: [
      "route-boundary",
      input.workspaceId ?? null,
      input.projectId ?? null,
      input.programId ?? null,
      input.phaseId ?? null,
      input.taskId ?? null,
    ],
    enabled: !!anyId,
    staleTime: 30_000,
    queryFn: async (): Promise<RouteBoundary> => {
      const { data, error } = await supabase.rpc("resolve_route_context_boundary", {
        _workspace_id: input.workspaceId ?? undefined,
        _project_id: input.projectId ?? undefined,
        _program_id: input.programId ?? undefined,
        _phase_id: input.phaseId ?? undefined,
        _task_id: input.taskId ?? undefined,
      });
      if (error) throw error;
      return data as unknown as RouteBoundary;
    },
  });

  let status: BoundaryStatus;
  const boundary = (query.data as RouteBoundary | undefined) ?? null;
  if (!anyId) {
    status = "ok";
  } else if (ctxLoading || query.isLoading) {
    status = "loading";
  } else if (query.isError) {
    status = "error";
  } else if (!boundary) {
    status = "loading";
  } else if (boundary.not_found) {
    status = "not_found";
  } else if (boundary.inconsistent) {
    status = "inconsistent";
  } else if (!boundary.has_access) {
    status = "access_denied";
  } else if (
    activeOrganization?.id &&
    boundary.organization_id &&
    boundary.organization_id !== activeOrganization.id
  ) {
    status = "mismatch";
  } else {
    status = "ok";
  }

  return {
    status,
    boundary,
    activeOrganizationId: activeOrganization?.id ?? null,
    activeOrganizationName: activeOrganization?.name ?? null,
    activeTenantName: activeTenant?.name ?? null,
    error: (query.error as Error | null) ?? null,
    refetch: query.refetch,
  };
}
