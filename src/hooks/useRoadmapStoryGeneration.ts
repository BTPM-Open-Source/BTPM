/**
 * Phase 6B.6 — Roadmap Story Pack draft generation hooks.
 *
 * - `useRoadmapStoryLatestVersion`: fetches the latest decrypted version
 *   for a Story Pack via the controlled SECURITY DEFINER RPC.
 * - `useGenerateRoadmapStoryDraft`: orchestrates the long-running
 *   background generation via the `generate-roadmap-story` and
 *   `poll-roadmap-story` Edge Functions (Phase 6B.6d). The browser
 *   never contacts an AI provider directly.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  runRoadmapStoryWithPolling,
  getLatestRoadmapStoryPackVersionContent,
  getRoadmapStoryPackVersionDebug,
  type GenerateRoadmapStoryDraftInput,
  type RunRoadmapStoryResult,
  type RoadmapStoryPackLatestVersionContent,
  type RoadmapStoryPackVersionDebug,
  type GenerateRoadmapStoryDraftQueued,
  type PollRoadmapStoryRunResponse,
} from "@/lib/roadmapStoryPackService";

const LATEST_KEY = (id: string | null | undefined) =>
  ["roadmap-story-pack-latest-version", id ?? "none"] as const;

const CONFIG_KEY = (id: string | null | undefined) =>
  ["roadmap-story-pack-config", id ?? "none"] as const;

export function useRoadmapStoryLatestVersion(storyPackId: string | null | undefined) {
  return useQuery<RoadmapStoryPackLatestVersionContent | null>({
    queryKey: LATEST_KEY(storyPackId),
    queryFn: () => getLatestRoadmapStoryPackVersionContent(storyPackId as string),
    enabled: !!storyPackId,
    staleTime: 5_000,
  });
}

export interface UseGenerateRoadmapStoryDraftOptions {
  onQueued?: (q: GenerateRoadmapStoryDraftQueued) => void;
  onProgress?: (p: PollRoadmapStoryRunResponse) => void;
}

export function useGenerateRoadmapStoryDraft(
  storyPackId: string,
  options?: UseGenerateRoadmapStoryDraftOptions,
) {
  const qc = useQueryClient();
  return useMutation<RunRoadmapStoryResult, Error, GenerateRoadmapStoryDraftInput>({
    mutationFn: (input) =>
      runRoadmapStoryWithPolling(input, {
        onQueued: options?.onQueued,
        onProgress: options?.onProgress,
      }),
    onSettled: (result) => {
      // A failed run still creates an AI run audit row, so refresh config.
      qc.invalidateQueries({ queryKey: CONFIG_KEY(storyPackId) });
      if (result?.ok) {
        qc.invalidateQueries({ queryKey: LATEST_KEY(storyPackId) });
      }
    },
  });
}

// 6B.6c — Per-version generation transparency (prompt, input package,
// raw response, parsed JSON, AI run metadata, file audit). Owner-only.
const DEBUG_KEY = (versionId: string | null | undefined) =>
  ["roadmap-story-pack-version-debug", versionId ?? "none"] as const;

export function useRoadmapStoryVersionDebug(
  versionId: string | null | undefined,
  enabled: boolean = true,
) {
  return useQuery<RoadmapStoryPackVersionDebug | null>({
    queryKey: DEBUG_KEY(versionId),
    queryFn: () => getRoadmapStoryPackVersionDebug(versionId as string),
    enabled: !!versionId && enabled,
    staleTime: 10_000,
  });
}
