/**
 * Phase 6B.4 — React Query hooks for Roadmap Story Pack Configure UI.
 *
 * Thin wrappers around the controlled `roadmapStoryPackService` (SECURITY
 * DEFINER RPCs). No direct table reads; no AI runtime; no Story rendering.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addRoadmapStoryPackExternalFile,
  addRoadmapStoryPackNote,
  archiveRoadmapStoryPack,
  createRoadmapStoryPack,
  deleteRoadmapStoryPackNote,
  getRoadmapStoryPackConfig,
  listRoadmapStoryPacks,
  removeRoadmapStoryPackExternalFile,
  setRoadmapStoryPackSources,
  unarchiveRoadmapStoryPack,
  updateRoadmapStoryPackConfig,
  updateRoadmapStoryPackExternalFile,
  updateRoadmapStoryPackNote,
  type AddExternalFileInput,
  type AddNoteInput,
  type CreateRoadmapStoryPackInput,
  type RoadmapStoryPackConfig,
  type RoadmapStoryPackSummary,
  type SetSourceInput,
  type UpdateExternalFileInput,
  type UpdateNoteInput,
  type UpdateRoadmapStoryPackConfigInput,
} from "@/lib/roadmapStoryPackService";

const LIST_KEY = ["roadmap-story-packs"] as const;
const CONFIG_KEY = (id: string | null | undefined) =>
  ["roadmap-story-pack-config", id ?? "none"] as const;

export function useRoadmapStoryPacks(includeArchived = true) {
  return useQuery<RoadmapStoryPackSummary[]>({
    queryKey: [...LIST_KEY, includeArchived],
    queryFn: () => listRoadmapStoryPacks(includeArchived),
    staleTime: 15_000,
  });
}

export function useRoadmapStoryPackConfig(storyPackId: string | null | undefined) {
  return useQuery<RoadmapStoryPackConfig>({
    queryKey: CONFIG_KEY(storyPackId),
    queryFn: () => getRoadmapStoryPackConfig(storyPackId as string),
    enabled: !!storyPackId,
    staleTime: 5_000,
  });
}

export function useCreateRoadmapStoryPack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoadmapStoryPackInput) => createRoadmapStoryPack(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useUpdateRoadmapStoryPackConfig(storyPackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateRoadmapStoryPackConfigInput) =>
      updateRoadmapStoryPackConfig(storyPackId, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONFIG_KEY(storyPackId) });
      qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useArchiveRoadmapStoryPack(storyPackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => archiveRoadmapStoryPack(storyPackId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONFIG_KEY(storyPackId) });
      qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useUnarchiveRoadmapStoryPack(storyPackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unarchiveRoadmapStoryPack(storyPackId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CONFIG_KEY(storyPackId) });
      qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useSetRoadmapStoryPackSources(storyPackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sources: SetSourceInput[]) =>
      setRoadmapStoryPackSources(storyPackId, sources),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONFIG_KEY(storyPackId) }),
  });
}

export function useAddRoadmapStoryPackNote(storyPackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddNoteInput) => addRoadmapStoryPackNote(storyPackId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONFIG_KEY(storyPackId) }),
  });
}

export function useUpdateRoadmapStoryPackNote(storyPackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { noteId: string; patch: UpdateNoteInput }) =>
      updateRoadmapStoryPackNote(vars.noteId, vars.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONFIG_KEY(storyPackId) }),
  });
}

export function useDeleteRoadmapStoryPackNote(storyPackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => deleteRoadmapStoryPackNote(noteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONFIG_KEY(storyPackId) }),
  });
}

export function useAddRoadmapStoryPackExternalFile(storyPackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddExternalFileInput) =>
      addRoadmapStoryPackExternalFile(storyPackId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONFIG_KEY(storyPackId) }),
  });
}

export function useUpdateRoadmapStoryPackExternalFile(storyPackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { fileId: string; patch: UpdateExternalFileInput }) =>
      updateRoadmapStoryPackExternalFile(vars.fileId, vars.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONFIG_KEY(storyPackId) }),
  });
}

export function useRemoveRoadmapStoryPackExternalFile(storyPackId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => removeRoadmapStoryPackExternalFile(fileId),
    onSuccess: () => qc.invalidateQueries({ queryKey: CONFIG_KEY(storyPackId) }),
  });
}
