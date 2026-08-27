/**
 * Hierarchical browse hooks for the # reference picker / shared work-object
 * picker. Reuses existing protected/decrypted RPCs — no new SQL surface:
 *   - list_workspace_projects(_workspace_id)         -> Project[]
 *   - list_decrypted_project_phases(_project_id)     -> Phase[]
 *   - list_decrypted_project_tasks(_project_id)      -> Task[] (incl. phase_id)
 *
 * All names returned are decrypted server-side via btpm_decrypt.
 * Same-workspace authorization is enforced inside each RPC.
 */
import { useQuery } from "@tanstack/react-query";
import { rpcTyped } from "@/lib/entityLinks";

export type ReferenceProjectNode = {
  id: string;
  name: string;
  workspace_id: string;
};

export type ReferencePhaseNode = {
  id: string;
  name: string;
  project_id: string;
  workspace_id: string;
  sort_order: number;
};

export type ReferenceTaskNode = {
  id: string;
  name: string;
  project_id: string;
  phase_id: string | null;
  workspace_id: string;
};

interface RawProjectRow { id: string; name?: string | null }
interface RawPhaseRow { id: string; name?: string | null; sort_order?: number | null }
interface RawTaskRow { id: string; name?: string | null; phase_id?: string | null }

export function useBrowseReferenceProjects(workspaceId: string | undefined, enabled: boolean) {
  return useQuery<ReferenceProjectNode[]>({
    queryKey: ["ref-browse-projects", workspaceId],
    queryFn: async () => {
      if (!workspaceId) return [];
      const { data, error } = await rpcTyped<RawProjectRow[]>("list_workspace_projects", {
        _workspace_id: workspaceId,
      });
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        id: r.id,
        name: r.name ?? "Project",
        workspace_id: workspaceId,
      }));
    },
    enabled: !!workspaceId && enabled,
    staleTime: 60_000,
  });
}

export function useBrowseProjectPhases(
  projectId: string | undefined,
  workspaceId: string | undefined,
  enabled: boolean,
) {
  return useQuery<ReferencePhaseNode[]>({
    queryKey: ["ref-browse-phases", projectId],
    queryFn: async () => {
      if (!projectId || !workspaceId) return [];
      const { data, error } = await rpcTyped<RawPhaseRow[]>("list_decrypted_project_phases", {
        _project_id: projectId,
      });
      if (error) throw new Error(error.message);
      return (data ?? [])
        .map((r) => ({
          id: r.id,
          name: r.name ?? "Phase",
          project_id: projectId,
          workspace_id: workspaceId,
          sort_order: r.sort_order ?? 0,
        }))
        .sort((a, b) => a.sort_order - b.sort_order);
    },
    enabled: !!projectId && !!workspaceId && enabled,
    staleTime: 60_000,
  });
}

/**
 * Loads project tasks (decrypted) and filters to the requested phase
 * client-side. The underlying RPC is project-scoped so multiple phase
 * expansions reuse the same cache entry — no extra round-trips per phase.
 */
export function useBrowsePhaseTasks(
  projectId: string | undefined,
  phaseId: string | undefined,
  workspaceId: string | undefined,
  enabled: boolean,
) {
  return useQuery<ReferenceTaskNode[]>({
    queryKey: ["ref-browse-tasks", projectId, phaseId],
    queryFn: async () => {
      if (!projectId || !phaseId || !workspaceId) return [];
      const { data, error } = await rpcTyped<RawTaskRow[]>("list_decrypted_project_tasks", {
        _project_id: projectId,
      });
      if (error) throw new Error(error.message);
      return (data ?? [])
        .filter((r) => r.phase_id === phaseId)
        .map((r) => ({
          id: r.id,
          name: r.name ?? "Task",
          project_id: projectId,
          phase_id: r.phase_id ?? null,
          workspace_id: workspaceId,
        }));
    },
    enabled: !!projectId && !!phaseId && !!workspaceId && enabled,
    staleTime: 60_000,
  });
}
