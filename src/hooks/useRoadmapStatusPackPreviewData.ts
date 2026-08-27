/**
 * Roadmap Status Pack — Preview data hook (Phase 6A.3 + 6A.7).
 *
 * Composes existing canonical Roadmap/reporting hooks plus the protected
 * per-project risks/blockers RPC fan-out:
 *  - useRoadmapProjects        (accessible cross-workspace project rows)
 *  - useProjectAccessMap       (PA-3 visibility map; mirrors Roadmap)
 *  - useRoadmapReportingSummaries (Wave B.2/B.4 canonical reporting)
 *  - useRoadmapStatusPackRisksBlockers (per-project SECURITY DEFINER RPC fan-out)
 *
 * NO new RPCs, NO new Edge Functions, NO schema. Pure composition + pure
 * derivation. The manifest is read-only here — never written back.
 */
import { useMemo } from "react";
import { useRoadmapProjects } from "@/hooks/useRoadmapData";
import { useProjectAccessMap } from "@/hooks/useProjectAccessMap";
import { useRoadmapReportingSummaries } from "@/hooks/useRoadmapReportingSummaries";
import { useRoadmapStatusPackRisksBlockers } from "@/hooks/useRoadmapStatusPackRisksBlockers";
import { useRoadmapStatusPackDependencies } from "@/hooks/useRoadmapStatusPackDependencies";
import { useRoadmapStatusPackKpis } from "@/hooks/useRoadmapStatusPackKpis";
import { useRoadmapStatusPackGovernance } from "@/hooks/useRoadmapStatusPackGovernance";
import { useRoadmapStatusPackProgress } from "@/hooks/useRoadmapStatusPackProgress";
import { useRoadmapStatusPackTeamWork } from "@/hooks/useRoadmapStatusPackTeamWork";
import {
  applyRoadmapFilterSnapshot,
  deriveRoadmapStatusPackCalendarMilestones,
  deriveRoadmapStatusPackControlBoard,
  deriveRoadmapStatusPackDependencies,
  deriveRoadmapStatusPackExecutiveSummary,
  deriveRoadmapStatusPackGovernance,
  deriveRoadmapStatusPackKpis,
  deriveRoadmapStatusPackProgressSinceLast,
  deriveRoadmapStatusPackProjectDetailAnnex,
  deriveRoadmapStatusPackRisksBlockers,
  deriveRoadmapStatusPackScopeDataNotes,
  deriveRoadmapStatusPackScopeSummary,
  deriveRoadmapStatusPackTeamWorkDetailAnnex,
  deriveRoadmapStatusPackTeamWorkSummary,
  deriveRoadmapStatusPackTimeline,
  type RoadmapStatusPackPreviewData,
} from "@/lib/status-pack/roadmapStatusPackData";
import { ROADMAP_STATUS_PACK_SECTION_REGISTRY } from "@/lib/status-pack/roadmapStatusPackRegistry";
import type { RoadmapStatusPackManifest } from "@/lib/status-pack/statusPackTypes";

export interface UseRoadmapStatusPackPreviewDataResult {
  data: RoadmapStatusPackPreviewData | null;
  isLoading: boolean;
  isError: boolean;
  reportingAvailable: boolean;
  reportingError: boolean;
  risksBlockersLoading: boolean;
  dependenciesLoading: boolean;
  kpisLoading: boolean;
  governanceLoading: boolean;
  progressLoading: boolean;
  teamWorkLoading: boolean;
  teamWorkDetailAnnexLoading: boolean;
  projectDetailAnnexLoading: boolean;
}


export function useRoadmapStatusPackPreviewData(
  manifest: RoadmapStatusPackManifest,
): UseRoadmapStatusPackPreviewDataResult {
  const { data: projectsRaw, isLoading: projectsLoading, isError: projectsError } =
    useRoadmapProjects();
  const access = useProjectAccessMap();

  // Restrict to projects the user is allowed to see (PA-3 mirror of Roadmap).
  const accessibleProjects = useMemo(
    () =>
      (projectsRaw || []).filter((p) =>
        access.canSeeProject({ id: p.id, workspace_id: p.workspace_id }),
      ),
    [projectsRaw, access],
  );

  // Workspaces to ask reporting RPCs for — derived strictly from accessible rows.
  const workspaceIdsForReporting = useMemo(() => {
    const set = new Set<string>();
    for (const p of accessibleProjects) set.add(p.workspace_id);
    return Array.from(set);
  }, [accessibleProjects]);

  const reporting = useRoadmapReportingSummaries(workspaceIdsForReporting);

  const scopedProjects = useMemo(
    () =>
      applyRoadmapFilterSnapshot(
        accessibleProjects,
        manifest.scope.roadmap_filters,
        reporting.byProjectId,
      ),
    [accessibleProjects, manifest.scope.roadmap_filters, reporting.byProjectId],
  );

  const reportingAvailable = !reporting.isError;

  // Risks & Blockers — per-project protected RPC fan-out, scoped to current
  // Roadmap filter set only.
  const risksBlockersFetch = useRoadmapStatusPackRisksBlockers(
    useMemo(() => scopedProjects.map((p) => ({ id: p.id })), [scopedProjects]),
  );

  // Dependencies — RLS-protected SELECT on project-to-project rows touching scope.
  const dependenciesFetch = useRoadmapStatusPackDependencies(
    useMemo(() => scopedProjects.map((p) => p.id), [scopedProjects]),
  );

  // KPIs — RLS-protected SELECT on project-level kpi_definitions + kpi_updates.
  const kpisFetch = useRoadmapStatusPackKpis(
    useMemo(() => scopedProjects.map((p) => p.id), [scopedProjects]),
  );

  // Governance — per-project SECURITY DEFINER RPC fan-out
  // (`list_project_governance_records`). Same authorized path used by the
  // project governance surface and the legacy roadmap deck Edge Function.
  const governanceFetch = useRoadmapStatusPackGovernance(
    useMemo(() => scopedProjects.map((p) => p.id), [scopedProjects]),
  );

  // Progress Since Last Period — per-project SECURITY DEFINER RPC fan-out
  // (`list_project_activity_events`). Same authorized path used by the
  // Project Traceability surface. Period filter applied in the pure helper.
  const progressFetch = useRoadmapStatusPackProgress(
    useMemo(() => scopedProjects.map((p) => p.id), [scopedProjects]),
  );

  // Team Work Summary — per-project authorized RPC fan-out
  // (`get_team_work_overview`). Same path used by Team Work / Work Hub.
  const teamWorkFetch = useRoadmapStatusPackTeamWork(
    useMemo(() => scopedProjects.map((p) => p.id), [scopedProjects]),
  );

  const data = useMemo<RoadmapStatusPackPreviewData | null>(() => {
    if (projectsLoading || access.isLoading) return null;
    const scopeSummary = deriveRoadmapStatusPackScopeSummary({
      manifest,
      accessibleProjects,
      scopedProjects,
      reportingByProjectId: reporting.byProjectId,
      reportingAvailable,
    });
    const executiveSummary = deriveRoadmapStatusPackExecutiveSummary({
      scopedProjects,
      reportingByProjectId: reporting.byProjectId,
    });
    const controlBoard = deriveRoadmapStatusPackControlBoard({
      scopedProjects,
      reportingByProjectId: reporting.byProjectId,
      reportingAvailable,
    });
    const timeline = deriveRoadmapStatusPackTimeline({
      scopedProjects,
      reportingByProjectId: reporting.byProjectId,
      reportingAvailable,
    });
    const calendarMilestones = deriveRoadmapStatusPackCalendarMilestones({
      scopedProjects,
      reportingByProjectId: reporting.byProjectId,
      reportingAvailable,
    });
    const risksBlockers = deriveRoadmapStatusPackRisksBlockers({
      scopedProjects,
      risksByProjectId: risksBlockersFetch.risksByProjectId,
      blockersByProjectId: risksBlockersFetch.blockersByProjectId,
      failedProjectIds: risksBlockersFetch.failedProjectIds,
      isLoading: risksBlockersFetch.isLoading,
      isError: risksBlockersFetch.isError,
    });
    const dependencies = deriveRoadmapStatusPackDependencies({
      scopedProjects,
      accessibleProjects,
      rows: dependenciesFetch.rows,
      reportingByProjectId: reporting.byProjectId,
      isLoading: dependenciesFetch.isLoading,
      isError: dependenciesFetch.isError,
    });
    const kpis = deriveRoadmapStatusPackKpis({
      scopedProjects,
      definitions: kpisFetch.definitions,
      recentUpdatesByDefinitionId: kpisFetch.recentUpdatesByDefinitionId,
      recentSnapshotsByDefinitionId: kpisFetch.recentSnapshotsByDefinitionId,
      reportingByProjectId: reporting.byProjectId,
      isLoading: kpisFetch.isLoading,
      isError: kpisFetch.isError,
      updatesPartial: kpisFetch.updatesPartial,
      updatesErrored: kpisFetch.updatesErrored,
      updatesLimitReached: kpisFetch.updatesLimitReached,
      snapshotsPartial: kpisFetch.snapshotsPartial,
    });
    const governance = deriveRoadmapStatusPackGovernance({
      scopedProjects,
      rowsByProjectId: governanceFetch.rowsByProjectId,
      reportingByProjectId: reporting.byProjectId,
      failedProjectIds: governanceFetch.failedProjectIds,
      isLoading: governanceFetch.isLoading,
      isError: governanceFetch.isError,
    });
    const progressSinceLast = deriveRoadmapStatusPackProgressSinceLast({
      scopedProjects,
      rowsByProjectId: progressFetch.rowsByProjectId,
      failedProjectIds: progressFetch.failedProjectIds,
      isError: progressFetch.isError,
    });
    const teamWorkSummary = deriveRoadmapStatusPackTeamWorkSummary({
      scopedProjects,
      overviewByProjectId: teamWorkFetch.overviewByProjectId,
      failedProjectIds: teamWorkFetch.failedProjectIds,
      isError: teamWorkFetch.isError,
    });
    const teamWorkDetailAnnex = deriveRoadmapStatusPackTeamWorkDetailAnnex({
      scopedProjects,
      overviewByProjectId: teamWorkFetch.overviewByProjectId,
      failedProjectIds: teamWorkFetch.failedProjectIds,
      isError: teamWorkFetch.isError,
    });
    const projectDetailAnnex = deriveRoadmapStatusPackProjectDetailAnnex({
      scopedProjects,
      reportingByProjectId: reporting.byProjectId,
      reportingAvailable,
      risksByProjectId: risksBlockersFetch.risksByProjectId,
      blockersByProjectId: risksBlockersFetch.blockersByProjectId,
      risksBlockersFailedProjectIds: risksBlockersFetch.failedProjectIds,
      risksBlockersErrored: risksBlockersFetch.isError,
      kpiDefinitions: kpisFetch.definitions,
      kpisErrored: kpisFetch.isError,
      governanceRowsByProjectId: governanceFetch.rowsByProjectId,
      governanceFailedProjectIds: governanceFetch.failedProjectIds,
      governanceErrored: governanceFetch.isError,
      teamWorkOverviewByProjectId: teamWorkFetch.overviewByProjectId,
      teamWorkFailedProjectIds: teamWorkFetch.failedProjectIds,
      teamWorkErrored: teamWorkFetch.isError,
      progressRowsByProjectId: progressFetch.rowsByProjectId,
      progressFailedProjectIds: progressFetch.failedProjectIds,
      progressErrored: progressFetch.isError,
    });
    const scopeDataNotes = deriveRoadmapStatusPackScopeDataNotes({
      manifest,
      registry: ROADMAP_STATUS_PACK_SECTION_REGISTRY,
      scopeSummary,
      reportingAvailable,
      sectionData: {
        risks_blockers: risksBlockers,
        dependencies,
        kpis,
        governance,
        progress_since_last: progressSinceLast,
        team_work_summary: teamWorkSummary,
        team_work_detail_annex: teamWorkDetailAnnex,
        project_detail_annex: projectDetailAnnex,
      },
    });
    return {
      scopeSummary,
      executiveSummary,
      controlBoard,
      timeline,
      calendarMilestones,
      risksBlockers,
      dependencies,
      kpis,
      governance,
      progressSinceLast,
      teamWorkSummary,
      teamWorkDetailAnnex,
      projectDetailAnnex,
      scopeDataNotes,
    };
  }, [
    projectsLoading,
    access.isLoading,
    manifest,
    accessibleProjects,
    scopedProjects,
    reporting.byProjectId,
    reportingAvailable,
    risksBlockersFetch.risksByProjectId,
    risksBlockersFetch.blockersByProjectId,
    risksBlockersFetch.failedProjectIds,
    risksBlockersFetch.isLoading,
    risksBlockersFetch.isError,
    dependenciesFetch.rows,
    dependenciesFetch.isLoading,
    dependenciesFetch.isError,
    kpisFetch.definitions,
    kpisFetch.recentUpdatesByDefinitionId,
    kpisFetch.recentSnapshotsByDefinitionId,
    kpisFetch.isLoading,
    kpisFetch.isError,
    kpisFetch.updatesPartial,
    kpisFetch.updatesErrored,
    kpisFetch.updatesLimitReached,
    kpisFetch.snapshotsPartial,
    governanceFetch.rowsByProjectId,
    governanceFetch.failedProjectIds,
    governanceFetch.isLoading,
    governanceFetch.isError,
    progressFetch.rowsByProjectId,
    progressFetch.failedProjectIds,
    progressFetch.isError,
    teamWorkFetch.overviewByProjectId,
    teamWorkFetch.failedProjectIds,
    teamWorkFetch.isError,
  ]);

  return {
    data,
    isLoading: projectsLoading || access.isLoading,
    isError: projectsError,
    reportingAvailable,
    reportingError: reporting.isError,
    risksBlockersLoading: risksBlockersFetch.isLoading,
    dependenciesLoading: dependenciesFetch.isLoading,
    kpisLoading: kpisFetch.isLoading,
    // Truthful loading state: stay in loading while ANY per-project governance
    // RPC is still loading, not only while none have resolved. Otherwise the
    // Governance section briefly renders partial counts as if complete.
    governanceLoading: governanceFetch.hasPartialLoading || governanceFetch.isLoading,
    // Same truthful-loading rule for per-project progress activity fan-out.
    progressLoading: progressFetch.hasPartialLoading || progressFetch.isLoading,
    // Same truthful-loading rule for per-project Team Work overview fan-out.
    teamWorkLoading: teamWorkFetch.hasPartialLoading || teamWorkFetch.isLoading,
    // Detail annex derives from the SAME authorized Team Work fan-out as the
    // summary section (no duplicate fan-out). Stay in loading while ANY
    // per-project Team Work query is still in flight.
    teamWorkDetailAnnexLoading:
      teamWorkFetch.hasPartialLoading || teamWorkFetch.isLoading,
    // Project Detail Annex composes from risks/blockers, KPIs, governance,
    // team work, and progress — stay in loading while ANY contributing
    // per-project fan-out is still in flight, so per-project counts never
    // render as complete while sources are still resolving.
    projectDetailAnnexLoading:
      risksBlockersFetch.hasPartialLoading ||
      risksBlockersFetch.isLoading ||
      kpisFetch.isLoading ||
      governanceFetch.hasPartialLoading ||
      governanceFetch.isLoading ||
      progressFetch.hasPartialLoading ||
      progressFetch.isLoading ||
      teamWorkFetch.hasPartialLoading ||
      teamWorkFetch.isLoading,
  };
}

