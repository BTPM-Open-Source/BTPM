/**
 * SP.2 — Hooks for SharePoint bindings.
 *
 * Read hooks only at this step (the UI shell lands in SP.3a).
 * Mutations are exposed as service functions in `sharepointBindingService`
 * and can be wrapped in React Query mutations by SP.3a.
 */

import { useQuery } from "@tanstack/react-query";
import {
  getProjectBinding,
  getWorkspaceBinding,
  listWorkspaceBindings,
  resolveProjectBinding,
} from "@/lib/sharepointBindingService";

export function useWorkspaceBinding(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["sharepoint-workspace-binding", workspaceId],
    queryFn: () => getWorkspaceBinding(workspaceId as string),
    enabled: !!workspaceId,
  });
}

export function useWorkspaceBindingsList(organizationId: string | undefined) {
  return useQuery({
    queryKey: ["sharepoint-workspace-bindings", organizationId],
    queryFn: () => listWorkspaceBindings(organizationId as string),
    enabled: !!organizationId,
  });
}

export function useProjectBinding(projectId: string | undefined) {
  return useQuery({
    queryKey: ["sharepoint-project-binding", projectId],
    queryFn: () => getProjectBinding(projectId as string),
    enabled: !!projectId,
  });
}

export function useEffectiveProjectBinding(projectId: string | undefined) {
  return useQuery({
    queryKey: ["sharepoint-project-binding-effective", projectId],
    queryFn: () => resolveProjectBinding(projectId as string),
    enabled: !!projectId,
  });
}
