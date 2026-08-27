/**
 * SP.4 — React Query hooks for the in-app SharePoint file manager.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSubfolder,
  listChildren,
  uploadFile,
  type SpListing,
} from "@/lib/sharepointFileService";

const KEY = (bindingId: string | undefined, itemId: string | null) =>
  ["sharepoint-files", bindingId ?? "none", itemId ?? "root"];

export function useSharepointListing(
  bindingId: string | undefined,
  itemId: string | null,
  enabled: boolean,
) {
  return useQuery<SpListing>({
    queryKey: KEY(bindingId, itemId),
    queryFn: () => listChildren(bindingId as string, itemId ?? undefined),
    enabled: !!bindingId && enabled,
    // Retry only transient Edge Runtime blips (503/cold-start), not real errors.
    retry: (failureCount, error: any) =>
      Boolean(error?.transient) && failureCount < 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    staleTime: 15_000,
  });
}

export function useCreateSubfolder(bindingId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { parentItemId: string; name: string }) =>
      createSubfolder(bindingId as string, input.parentItemId, input.name),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: KEY(bindingId, vars.parentItemId) });
    },
  });
}

export function useUploadFile(bindingId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { parentItemId: string; file: File }) =>
      uploadFile(bindingId as string, input.parentItemId, input.file),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: KEY(bindingId, vars.parentItemId) });
    },
  });
}
