/**
 * Phase 6B.5 / 6B.5b — In-memory Roadmap Story Pack source snapshot.
 *
 * Composes the Story Pack config (controlled RPC) with a bounded, authorized
 * Roadmap source preview (`useRoadmapStatusPackPreviewData`) plus, since
 * 6B.5b, a bounded planning source (`useRoadmapStoryPlanningSource`) for
 * scoped projects, and builds a `RoadmapStorySourceSnapshot`. The snapshot
 * is computed on demand and never persisted.
 */

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRoadmapStoryPackConfig } from "@/hooks/useRoadmapStoryPacks";
import { useRoadmapStatusPackPreviewData } from "@/hooks/useRoadmapStatusPackPreviewData";
import { useRoadmapStoryPlanningSource } from "@/hooks/useRoadmapStoryPlanningSource";
import { createDefaultRoadmapStatusPackManifest } from "@/lib/status-pack/roadmapStatusPackManifest";
import {
  composeRoadmapStorySourceSnapshot,
  type RoadmapStorySourceSnapshot,
} from "@/lib/roadmap-story/roadmapStorySourceSnapshot";

export interface UseRoadmapStorySourceSnapshotResult {
  snapshot: RoadmapStorySourceSnapshot | null;
  isComposing: boolean;
  isAvailable: boolean;
  refresh: () => void;
  /** True when underlying source fetches are still loading any contributing block. */
  sourcesLoading: boolean;
  sourcesError: boolean;
}

export function useRoadmapStorySourceSnapshot(
  storyPackId: string | null | undefined,
): UseRoadmapStorySourceSnapshotResult {
  const cfg = useRoadmapStoryPackConfig(storyPackId);

  // Build a synthetic manifest from the Story Pack's captured roadmap filters
  // so the existing authorized Status Pack preview hook drives all source
  // reads through its established, RLS-protected paths.
  const manifest = useMemo(() => {
    const filters = (cfg.data?.pack.scope_config as Record<string, unknown> | undefined)
      ?.roadmap_filters as Record<string, unknown> | undefined;
    return createDefaultRoadmapStatusPackManifest({
      filters: filters as never,
      sourceSurface: "roadmap",
    });
  }, [cfg.data?.pack.scope_config]);

  const preview = useRoadmapStatusPackPreviewData(manifest);

  // Planning is opt-in via the Story Pack source category toggle.
  const planningEnabled = useMemo(() => {
    if (!cfg.data) return false;
    const row = cfg.data.sources.find((s) => s.source_category === "planning_phases_tasks");
    return row ? row.is_enabled : true; // default-enabled mirror of Configure UI
  }, [cfg.data]);

  const scopedProjectIds = useMemo(
    () => preview.data?.controlBoard.rows.map((r) => r.projectId) ?? [],
    [preview.data?.controlBoard.rows],
  );

  const planning = useRoadmapStoryPlanningSource(scopedProjectIds, planningEnabled);

  // Manual refresh trigger — bumps state AND invalidates underlying source
  // queries so the fan-out hooks refetch (not just recompose from cache).
  const [refreshVersion, setRefreshVersion] = useState(0);
  const qc = useQueryClient();
  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["roadmap-story-pack-config"] });
    qc.invalidateQueries({ queryKey: ["status-pack"] });
    qc.invalidateQueries({ queryKey: ["roadmap-status-pack-deps"] });
    qc.invalidateQueries({ queryKey: ["roadmap-status-pack-kpis-defs"] });
    qc.invalidateQueries({ queryKey: ["roadmap-status-pack-kpis-updates"] });
    qc.invalidateQueries({ queryKey: ["roadmap-status-pack-kpi-snapshots"] });
    qc.invalidateQueries({ queryKey: ["story-pack", "planning"] });
    qc.invalidateQueries({ queryKey: ["project-reporting-summaries"] });
    qc.invalidateQueries({ queryKey: ["roadmap-projects"] });
    qc.invalidateQueries({ queryKey: ["project-access-map"] });
    setRefreshVersion((v) => v + 1);
  }, [qc]);

  const sourcesLoading =
    preview.isLoading ||
    preview.risksBlockersLoading ||
    preview.dependenciesLoading ||
    preview.kpisLoading ||
    preview.governanceLoading ||
    preview.progressLoading ||
    preview.teamWorkLoading ||
    planning.isLoading ||
    planning.hasPartialLoading;

  const snapshot = useMemo<RoadmapStorySourceSnapshot | null>(() => {
    if (!storyPackId || !cfg.data) return null;
    return composeRoadmapStorySourceSnapshot({
      storyPackId,
      config: cfg.data,
      preview: preview.data,
      previewWarnings: {
        reportingError: preview.reportingError,
      },
      planning: planningEnabled
        ? {
            phasesByProjectId: planning.phasesByProjectId,
            tasksByProjectId: planning.tasksByProjectId,
            isLoading: planning.isLoading,
            isError: planning.isError,
            failedProjectIds: planning.failedProjectIds,
            hasPartialLoading: planning.hasPartialLoading,
            resolvedProjectCount: planning.resolvedProjectCount,
          }
        : undefined,
    });
    // refreshVersion is in deps so explicit Refresh clicks recompute the
    // snapshot (and bump `generatedAt`) even when no upstream input changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    storyPackId,
    cfg.data,
    preview.data,
    preview.reportingError,
    planningEnabled,
    planning.phasesByProjectId,
    planning.tasksByProjectId,
    planning.isLoading,
    planning.isError,
    planning.failedProjectIds,
    planning.hasPartialLoading,
    planning.resolvedProjectCount,
    refreshVersion,
  ]);

  return {
    snapshot,
    isComposing: cfg.isLoading,
    isAvailable: !!snapshot,
    refresh,
    sourcesLoading,
    sourcesError: preview.isError || planning.isError,
  };
}
