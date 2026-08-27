/**
 * Phase 6B.8d — Shared builder hook for the current reviewed
 * `btpm_published_story_v1` snapshot.
 *
 * Mirrors the exact pipeline used by `RoadmapStoryPreviewTab`:
 *   1. Load latest Story Draft + debug (source snapshot + file manifest).
 *   2. Build the deterministic BTPM presentation blueprint.
 *   3. If a valid AI Presentation Blueprint exists, overlay it.
 *   4. Wrap the overlaid/rendered blueprint with
 *      `buildRenderedPublishedSnapshot` — the only approved envelope
 *      accepted by the publish Edge Function.
 *
 * The raw AI blueprint is NEVER returned as the publish snapshot; the
 * client always sends the final BTPM-renderable presentation.
 */

import { useMemo } from "react";
import {
  useRoadmapStoryLatestVersion,
  useRoadmapStoryVersionDebug,
} from "@/hooks/useRoadmapStoryGeneration";
import { useLatestAiPresentationBlueprint } from "@/hooks/useRoadmapStoryPresentationBlueprint";
import { useRoadmapStoryVisualSettings } from "@/hooks/useRoadmapStoryVisualSettings";
import {
  buildDeterministicRoadmapStoryPresentationBlueprint,
  parseRoadmapStorySourceSnapshotJson,
} from "@/lib/roadmap-story/roadmapStoryPresentationBlueprint";
import { applyAiBlueprintOverlay } from "@/lib/roadmap-story/roadmapStoryPresentationBlueprintOverlay";
import { buildRenderedPublishedSnapshot } from "@/lib/roadmap-story/roadmapStoryPublishedPresentationSnapshot";
import type { PublishedStoryPresentationSnapshot } from "@/lib/roadmap-story/roadmapStoryPublishedPresentationTypes";

export interface CurrentPublishSnapshotState {
  loading: boolean;
  hasDraft: boolean;
  hasPreview: boolean;
  storyPackVersionId: string | null;
  presentationBlueprintRunId: string | null;
  sourceMode: "ai_blueprint" | "deterministic";
  aiValid: boolean;
  defaultTitle: string;
  buildSnapshot: (titleOverride?: string | null) => PublishedStoryPresentationSnapshot | null;
}

export function useCurrentPublishSnapshot(
  storyPackId: string | null | undefined,
): CurrentPublishSnapshotState {
  const latest = useRoadmapStoryLatestVersion(storyPackId ?? "");
  const draft = latest.data?.story ?? null;
  const versionId = latest.data?.id ?? null;

  const debug = useRoadmapStoryVersionDebug(versionId, !!versionId);
  const sourceSnapshot = parseRoadmapStorySourceSnapshotJson(
    debug.data?.version.source_snapshot ?? null,
  );

  const fileManifest =
    (debug.data?.ai_run?.input_manifest as Record<string, unknown> | undefined)
      ?.file_context as
      | {
          included_count?: number;
          sent_count?: number;
          skipped_count?: number;
          total_bytes_sent?: number;
          files?: Array<Record<string, unknown>>;
        }
      | undefined;

  const deterministic = useMemo(
    () =>
      draft
        ? buildDeterministicRoadmapStoryPresentationBlueprint(draft, {
            versionId: latest.data?.id,
            sourceManifest:
              (latest.data?.source_manifest ?? null) as Record<string, unknown> | null,
            sourceSnapshot,
            fileManifestSummary: fileManifest ?? null,
          })
        : null,
    [
      draft,
      latest.data?.id,
      latest.data?.source_manifest,
      sourceSnapshot,
      fileManifest,
    ],
  );

  const latestAi = useLatestAiPresentationBlueprint(storyPackId ?? "");
  const visualSettings = useRoadmapStoryVisualSettings(storyPackId ?? "");
  const aiValid = !!latestAi.data?.validation.ok && !!latestAi.data?.blueprint;

  const overlaid = useMemo(() => {
    if (!deterministic) return null;
    const settings = visualSettings.data?.resolved ?? null;
    if (!aiValid || !latestAi.data?.blueprint) {
      // Even without an AI overlay, enforce Include Off / Narrative Off
      // so the deterministic preview mirrors the user's Visual Settings.
      if (!settings) return deterministic;
      return applyAiBlueprintOverlay(
        {
          schemaVersion: "roadmap_story_presentation_v1",
          templateId: "steerco_briefing_v1",
          title: deterministic.title,
          subtitle: deterministic.subtitle,
          density: deterministic.density,
          executiveTakeaway: "",
          blocks: deterministic.blocks.map((b, i) => ({
            blockId: `det_${i}`,
            slotId: b.slotId,
            blockType: b.blockType,
            title: (b as { title?: string }).title ?? "",
          })),
          sourceLimitations: [],
        },
        deterministic,
        settings,
      );
    }
    return applyAiBlueprintOverlay(latestAi.data.blueprint, deterministic, settings);
  }, [deterministic, aiValid, latestAi.data, visualSettings.data?.resolved]);

  const loading =
    latest.isLoading ||
    (!!versionId && debug.isLoading) ||
    latestAi.isLoading ||
    visualSettings.isLoading;

  const defaultTitle =
    (overlaid as { title?: string | null } | null)?.title?.trim() ||
    (draft as { headline?: string | null } | null)?.headline?.trim() ||
    "Roadmap Story";

  const buildSnapshot = (titleOverride?: string | null) => {
    if (!overlaid) return null;
    return buildRenderedPublishedSnapshot({
      blueprint: overlaid,
      titleOverride: titleOverride ?? null,
      storyPackVersionId: versionId,
      presentationBlueprintRunId: aiValid ? latestAi.data?.runId ?? null : null,
      sourceMode: aiValid ? "ai_blueprint" : "deterministic",
    });
  };

  return {
    loading,
    hasDraft: !!draft,
    hasPreview: !!overlaid,
    storyPackVersionId: versionId,
    presentationBlueprintRunId: aiValid ? latestAi.data?.runId ?? null : null,
    sourceMode: aiValid ? "ai_blueprint" : "deterministic",
    aiValid,
    defaultTitle,
    buildSnapshot,
  };
}
