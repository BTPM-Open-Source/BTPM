/**
 * Phase 6B.8e — React Query hook for the Stories Library
 * "Published Stories" lens.
 */
import { useQuery } from "@tanstack/react-query";
import {
  getAccessibleRoadmapStoryPublishedVersions,
  type AccessibleRoadmapStoryPublishedVersion,
} from "@/lib/roadmap-story/roadmapStoriesLibraryService";

export const ACCESSIBLE_PUBLISHED_STORIES_KEY = (query: string | null) =>
  ["roadmap-story-published-accessible", query ?? ""] as const;

export function useAccessibleRoadmapStoryPublishedVersions(
  query: string | null = null,
) {
  return useQuery<AccessibleRoadmapStoryPublishedVersion[]>({
    queryKey: ACCESSIBLE_PUBLISHED_STORIES_KEY(query),
    queryFn: () =>
      getAccessibleRoadmapStoryPublishedVersions({
        query: query && query.trim() ? query.trim() : null,
        limit: 100,
      }),
    staleTime: 10_000,
  });
}
