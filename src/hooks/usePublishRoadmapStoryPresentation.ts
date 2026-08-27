/**
 * Phase 6B.8b — React Query mutation hook for the publish operation.
 *
 * Thin wrapper around `publishStoryPresentation`. Invalidates the owner's
 * Published Story version list on success so future 6B.8d Published-tab
 * UI immediately reflects the new immutable version. No visible UI is
 * added in this step; this hook exists so 6B.8c/6B.8d can wire the
 * publish button without further backend churn.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  publishStoryPresentation,
  type PublishStoryPresentationRequest,
  type PublishStoryPresentationResult,
} from "@/lib/roadmap-story/roadmapStoryPublishedPresentationTypes";

export function usePublishRoadmapStoryPresentation() {
  const qc = useQueryClient();
  return useMutation<PublishStoryPresentationResult, Error, PublishStoryPresentationRequest>({
    mutationFn: (req) => publishStoryPresentation(req),
    onSuccess: (result) => {
      qc.invalidateQueries({
        queryKey: ["roadmap-story-published-versions", result.storyPackId],
      });
    },
  });
}
