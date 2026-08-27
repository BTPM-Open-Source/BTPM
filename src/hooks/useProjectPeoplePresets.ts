/**
 * WPP.2 — React Query hooks for Workspace Project People Presets.
 *
 * Thin wrappers around the protected RPC service in
 * `@/lib/projectPeoplePresets`. No UI is provided in this step.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addProjectPeoplePresetMember,
  applyProjectPeoplePreset,
  archiveProjectPeoplePreset,
  getProjectPeoplePreset,
  listProjectPeoplePresets,
  previewProjectPeoplePresetApplication,
  removeProjectPeoplePresetMember,
  renameProjectPeoplePreset,
  restoreProjectPeoplePreset,
  saveProjectPeoplePresetFromProject,
  updateProjectPeoplePresetMember,
} from "@/lib/projectPeoplePresets";

export const projectPeoplePresetKeys = {
  list: (workspaceId: string | undefined, includeArchived: boolean) =>
    ["project-people-presets", workspaceId ?? null, { includeArchived }] as const,
  detail: (presetId: string | undefined) =>
    ["project-people-preset", presetId ?? null] as const,
};

export function useProjectPeoplePresets(
  workspaceId: string | undefined,
  options?: { includeArchived?: boolean },
) {
  const includeArchived = options?.includeArchived ?? false;
  return useQuery({
    queryKey: projectPeoplePresetKeys.list(workspaceId, includeArchived),
    enabled: !!workspaceId,
    queryFn: () => listProjectPeoplePresets(workspaceId!, includeArchived),
  });
}

export function useProjectPeoplePreset(presetId: string | undefined) {
  return useQuery({
    queryKey: projectPeoplePresetKeys.detail(presetId),
    enabled: !!presetId,
    queryFn: () => getProjectPeoplePreset(presetId!),
  });
}

function invalidatePresetCaches(
  qc: ReturnType<typeof useQueryClient>,
  workspaceId: string | undefined,
  presetId: string | undefined,
) {
  qc.invalidateQueries({ queryKey: ["project-people-presets", workspaceId ?? null] });
  if (presetId) {
    qc.invalidateQueries({ queryKey: projectPeoplePresetKeys.detail(presetId) });
  }
}

export function useRenameProjectPeoplePreset(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: renameProjectPeoplePreset,
    onSuccess: (_r, vars) => invalidatePresetCaches(qc, workspaceId, vars.preset_id),
  });
}

export function useArchiveProjectPeoplePreset(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: archiveProjectPeoplePreset,
    onSuccess: (_r, vars) => invalidatePresetCaches(qc, workspaceId, vars.preset_id),
  });
}

export function useRestoreProjectPeoplePreset(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: restoreProjectPeoplePreset,
    onSuccess: (_r, vars) => invalidatePresetCaches(qc, workspaceId, vars.preset_id),
  });
}

export function useAddProjectPeoplePresetMember(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addProjectPeoplePresetMember,
    onSuccess: (_r, vars) => invalidatePresetCaches(qc, workspaceId, vars.preset_id),
  });
}

/**
 * WPP.6A — `update` receives `member_id`, not `preset_id`. To invalidate
 * the exact preset detail after success, pass the currently loaded
 * `presetId` from the caller. List invalidation is unconditional.
 */
export function useUpdateProjectPeoplePresetMember(
  workspaceId: string | undefined,
  presetId?: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateProjectPeoplePresetMember,
    onSuccess: () => invalidatePresetCaches(qc, workspaceId, presetId),
  });
}

/**
 * WPP.6A — `remove` receives `member_id`, not `preset_id`. To invalidate
 * the exact preset detail after success, pass the currently loaded
 * `presetId` from the caller. List invalidation is unconditional.
 */
export function useRemoveProjectPeoplePresetMember(
  workspaceId: string | undefined,
  presetId?: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeProjectPeoplePresetMember,
    onSuccess: () => invalidatePresetCaches(qc, workspaceId, presetId),
  });
}

/**
 * WPP.3 — Save current Project people as a new Workspace People Preset.
 * On success, invalidates Workspace preset lists so the (future) library
 * refreshes. Does not navigate away.
 */
export function useSaveProjectPeoplePresetFromProject(workspaceId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveProjectPeoplePresetFromProject,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-people-presets", workspaceId ?? null] });
    },
  });
}

// ==========================================================================
// WPP.4 — Preview & apply preset to project
// ==========================================================================

export const projectPeoplePresetApplicationKeys = {
  preview: (presetId: string | undefined, projectId: string | undefined) =>
    ["project-people-preset-application-preview", presetId ?? null, projectId ?? null] as const,
};

/**
 * WPP.4 — Query hook for the read-only apply preview. Enabled only when
 * both a preset id and a project id are provided.
 */
export function useProjectPeoplePresetApplicationPreview(
  presetId: string | undefined,
  projectId: string | undefined,
) {
  return useQuery({
    queryKey: projectPeoplePresetApplicationKeys.preview(presetId, projectId),
    enabled: !!presetId && !!projectId,
    queryFn: () =>
      previewProjectPeoplePresetApplication({
        preset_id: presetId!,
        project_id: projectId!,
      }),
  });
}

/**
 * WPP.4 — Mutation hook for applying a preset. On success, invalidates
 * every project-scoped surface whose data may have changed (team, RACI,
 * stakeholders, activity log) plus the workspace preset list and the
 * preview key.
 */
export function useApplyProjectPeoplePreset(
  workspaceId: string | undefined,
  projectId: string | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: applyProjectPeoplePreset,
    onSuccess: (_res, vars) => {
      // Project people surfaces
      qc.invalidateQueries({ queryKey: ["project-team-decrypted", projectId ?? vars.project_id] });
      qc.invalidateQueries({ queryKey: ["project-team", projectId ?? vars.project_id] });
      qc.invalidateQueries({ queryKey: ["project-stakeholders", projectId ?? vars.project_id] });
      qc.invalidateQueries({ queryKey: ["project-raci", projectId ?? vars.project_id] });
      qc.invalidateQueries({ queryKey: ["project-activity-events", projectId ?? vars.project_id] });
      // Preset library + preview
      qc.invalidateQueries({ queryKey: ["project-people-presets", workspaceId ?? null] });
      qc.invalidateQueries({
        queryKey: projectPeoplePresetApplicationKeys.preview(vars.preset_id, vars.project_id),
      });
    },
  });
}
