/**
 * Phase 6B.8d — React Query hooks for the Story Pack Published tab.
 *
 * Thin wrappers around the controlled RPCs from 6B.8a. No direct
 * `.from()` access to any of the three published-story tables is
 * permitted from the frontend; all reads/mutations flow through
 * `getPublishedStoryVersions` and `archivePublishedStoryVersion`.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archivePublishedStoryVersion,
  getPublishedStoryVersions,
  type PublishedStoryPresentationVersionListItem,
} from "@/lib/roadmap-story/roadmapStoryPublishedPresentationTypes";

export const PUBLISHED_VERSIONS_KEY = (storyPackId: string | null | undefined) =>
  ["roadmap-story-published-versions", storyPackId ?? "none"] as const;

export function usePublishedStoryVersions(storyPackId: string | null | undefined) {
  return useQuery<PublishedStoryPresentationVersionListItem[]>({
    queryKey: PUBLISHED_VERSIONS_KEY(storyPackId),
    queryFn: () => getPublishedStoryVersions(storyPackId as string),
    enabled: !!storyPackId,
    staleTime: 10_000,
  });
}

export function useArchivePublishedStoryPresentationVersion(
  storyPackId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (versionId: string) => archivePublishedStoryVersion(versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PUBLISHED_VERSIONS_KEY(storyPackId) });
    },
  });
}
