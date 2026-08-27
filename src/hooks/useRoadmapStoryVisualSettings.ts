/**
 * Phase 6B.7b.2 — React hook for per-Story Visual Settings.
 *
 * Reads via `get_roadmap_story_pack_visual_settings`, writes via
 * `update_roadmap_story_pack_visual_settings`. The hook always returns
 * a fully-resolved settings object (defaults filled in) so consumers
 * never have to branch on "no saved settings yet".
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  buildDefaultRoadmapStoryVisualSettings,
  resolveRoadmapStoryVisualSettings,
  type RoadmapStoryVisualSettings,
} from "@/lib/roadmap-story/roadmapStoryVisualSettings";

const KEY = (id: string | null | undefined) =>
  ["roadmap-story-visual-settings", id ?? "none"] as const;

export function useRoadmapStoryVisualSettings(storyPackId: string | null | undefined) {
  return useQuery<{
    resolved: RoadmapStoryVisualSettings;
    hasSaved: boolean;
  }>({
    queryKey: KEY(storyPackId),
    enabled: !!storyPackId,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_roadmap_story_pack_visual_settings" as never,
        { _story_pack_id: storyPackId as string } as never,
      );
      if (error) throw error;
      const hasSaved = data != null && typeof data === "object";
      return {
        resolved: hasSaved
          ? resolveRoadmapStoryVisualSettings(data)
          : buildDefaultRoadmapStoryVisualSettings(),
        hasSaved,
      };
    },
  });
}

export function useUpdateRoadmapStoryVisualSettings(storyPackId: string) {
  const qc = useQueryClient();
  return useMutation<RoadmapStoryVisualSettings, Error, RoadmapStoryVisualSettings>({
    mutationFn: async (settings) => {
      const { error } = await supabase.rpc(
        "update_roadmap_story_pack_visual_settings" as never,
        {
          _story_pack_id: storyPackId,
          _settings: settings as unknown as Record<string, unknown>,
        } as never,
      );
      if (error) throw error;
      return settings;
    },
    onSuccess: (settings) => {
      qc.setQueryData(KEY(storyPackId), { resolved: settings, hasSaved: true });
      qc.invalidateQueries({ queryKey: KEY(storyPackId) });
    },
  });
}
