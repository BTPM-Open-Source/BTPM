/**
 * Roadmap Status Pack — Preview Data Resolver (Phase 6A.3).
 *
 * Pure, side-effect-free derivation helpers used by the in-app preview shell
 * (and, later, by the PPT export builder — same manifest, same resolver).
 *
 * RULES (do not violate):
 *  - Inputs are already-loaded canonical Roadmap project rows + B.2 reporting
 *    summaries. NO network I/O here.
 *  - The manifest stays configuration-only. Nothing in these helpers writes
 *    anything back into the manifest.
 *  - Nothing is persisted. Returned values are derived at render time.
 *  - Only Cover & Scope + Executive Summary are wired in 6A.3. Other future
 *    metrics (Team Work / KPI / risks / blockers / governance / dependencies)
 *    are NOT invented as fake zeros.
 */
import type { RoadmapProject } from "@/hooks/useRoadmapData";
import {
  getPmWorkflowStatusLabel,
  getPmPriorityLabel,
} from "@/lib/btpmVisualSemantics";
import type {
  ProjectBlockerRow,
  ProjectRiskRow,
} from "@/lib/entityLinks";
import type {
  ProjectReportingSummary,
  ReportingHealthRag,
  ReportingScheduleSignal,
} from "@/lib/reportingSummary";
import type {
  RoadmapFilterSnapshot,
  RoadmapStatusPackManifest,
  StatusPackResolverStatus,
  StatusPackSectionId,
  StatusPackSectionRegistryEntry,
} from "./statusPackTypes";

export type RoadmapStatusPackDataStatus = "ok" | "partial" | "empty";

export interface RoadmapStatusPackBreakdownItem {
  key: string;
  label: string;
  count: number;
}

export interface RoadmapStatusPackFilterDisplayItem {
  label: string;
  value: string;
}

export interface RoadmapStatusPackScopeSummary {
  packTitle: string;
  sourceSurface: "Roadmap";
  scopeKind: "Roadmap";
  generatedAt: string; // ISO timestamp (live render time)
  totalAccessibleProjects: number;
  totalProjectsInScope: number;
  workspaceCountInScope: number;
  programCountInScope: number;
  projectCountInScope: number;
  workspaceLabels: string[];
  programLabels: string[];
  projectLabels: string[];
  /** Phase 6D.7A — Portfolio scope context, derived from scopedProjects. */
  portfolioCountInScope: number;
  portfolioLabels: string[];
  noPortfolioProjectCount: number;
  appliedFilters: RoadmapStatusPackFilterDisplayItem[];
  reportingSummariesAvailable: number;
  reportingSummariesMissing: number;
  reportingAvailable: boolean;
  note: string;
}

export interface RoadmapStatusPackExecutiveSummary {
  totalProjects: number;
  averageCompletionPercent: number | null;
  averageCompletionBasis: number; // # of projects with reporting summary
  statusDistribution: RoadmapStatusPackBreakdownItem[];
  priorityDistribution: RoadmapStatusPackBreakdownItem[];
  healthDistribution: RoadmapStatusPackBreakdownItem[];
  scheduleDistribution: RoadmapStatusPackBreakdownItem[];
  behindScheduleCount: number;
  noScheduleBasisCount: number;
  reportingSummariesAvailable: number;
  reportingSummariesMissing: number;
  latestComputedAt: string | null;
  dataStatus: RoadmapStatusPackDataStatus;
}

export type RoadmapStatusPackControlBoardAttentionSignal =
  | "red_health"
  | "behind_schedule"
  | "amber_health"
  | "missing_reporting"
  | "no_schedule_basis"
  | "high_priority";

export interface RoadmapStatusPackControlBoardProject {
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  programId: string | null;
  programName: string | null;
  status: string;
  statusLabel: string;
  priority: string;
  priorityLabel: string;
  projectStage: string | null;
  startDate: string | null;
  targetEndDate: string | null;
  hasReportingSummary: boolean;
  /** null when reporting is missing/unavailable. */
  healthRag: ReportingHealthRag | null;
  healthLabel: string | null;
  /** null when reporting is missing/unavailable. */
  scheduleSignal: ReportingScheduleSignal | null;
  scheduleLabel: string | null;
  /** null when reporting is missing/unavailable. */
  completionPercent: number | null;
  computedAt: string | null;
  attentionSignals: RoadmapStatusPackControlBoardAttentionSignal[];
  /** Phase 6D.7A — Portfolio context from authorized project row. */
  portfolioItemId: string | null;
  portfolioName: string | null;
  portfolioCode: string | null;
  portfolioLifecycleState: string | null;
  portfolioIsArchived: boolean | null;
}

export interface RoadmapStatusPackControlBoard {
  totalProjects: number;
  projectsWithReporting: number;
  projectsMissingReporting: number;
  redHealthCount: number;
  amberHealthCount: number;
  greenHealthCount: number;
  unknownHealthCount: number;
  behindScheduleCount: number;
  attentionCount: number;
  reportingAvailable: boolean;
  rows: RoadmapStatusPackControlBoardProject[];
  dataStatus: RoadmapStatusPackDataStatus;
}

export type RoadmapStatusPackTimelineScheduleBucket =
  | "on_track"
  | "behind_schedule"
  | "complete"
  | "no_schedule_basis"
  | "unknown";

export interface RoadmapStatusPackTimelineItem {
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  programId: string | null;
  programName: string | null;
  status: string;
  statusLabel: string;
  priority: string;
  priorityLabel: string;
  projectStage: string | null;
  startDate: string | null;
  endDate: string | null;
  hasDateRange: boolean;
  hasStartOnly: boolean;
  hasEndOnly: boolean;
  durationDays: number | null;
  hasReportingSummary: boolean;
  healthRag: ReportingHealthRag | null;
  healthLabel: string | null;
  scheduleSignal: ReportingScheduleSignal | null;
  scheduleLabel: string | null;
  scheduleBucket: RoadmapStatusPackTimelineScheduleBucket;
  completionPercent: number | null;
  isAttention: boolean;
}

export interface RoadmapStatusPackTimelinePeriodSummary {
  earliestStart: string | null;
  latestEnd: string | null;
  spanDays: number | null;
}

export interface RoadmapStatusPackTimeline {
  totalProjects: number;
  withDateRange: number;
  missingDateRange: number;
  partialDateRange: number;
  behindScheduleCount: number;
  unknownScheduleCount: number;
  reportingAvailable: boolean;
  dated: RoadmapStatusPackTimelineItem[];
  undated: RoadmapStatusPackTimelineItem[];
  period: RoadmapStatusPackTimelinePeriodSummary;
  dataStatus: RoadmapStatusPackDataStatus;
}

export type RoadmapStatusPackCalendarItemType =
  | "project_start"
  | "project_target_end";

export type RoadmapStatusPackCalendarBucketKey =
  | "overdue"
  | "next_30"
  | "next_31_90"
  | "later"
  | "missing";

export interface RoadmapStatusPackCalendarItem {
  itemId: string;
  itemType: RoadmapStatusPackCalendarItemType;
  itemTypeLabel: string;
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  programId: string | null;
  programName: string | null;
  date: string;
  dateLabel: string;
  daysFromToday: number;
  isOverdue: boolean;
  isUpcoming: boolean;
  isCurrent: boolean;
  isFuture: boolean;
  status: string;
  statusLabel: string;
  priority: string;
  priorityLabel: string;
  hasReportingSummary: boolean;
  healthRag: ReportingHealthRag | null;
  healthLabel: string | null;
  scheduleSignal: ReportingScheduleSignal | null;
  scheduleLabel: string | null;
  completionPercent: number | null;
  bucket: RoadmapStatusPackCalendarBucketKey;
}

export interface RoadmapStatusPackCalendarMissingProject {
  projectId: string;
  projectName: string;
  workspaceName: string;
  programName: string | null;
  status: string;
  statusLabel: string;
  priority: string;
  priorityLabel: string;
  hasReportingSummary: boolean;
  healthLabel: string | null;
  scheduleLabel: string | null;
}

export interface RoadmapStatusPackCalendarBucket {
  key: RoadmapStatusPackCalendarBucketKey;
  label: string;
  items: RoadmapStatusPackCalendarItem[];
}

export interface RoadmapStatusPackCalendarMilestones {
  referenceDate: string;
  totalProjects: number;
  totalItems: number;
  upcomingNext30Count: number;
  upcomingNext90Count: number;
  overdueCount: number;
  behindScheduleCount: number;
  missingDateProjectsCount: number;
  reportingAvailable: boolean;
  buckets: RoadmapStatusPackCalendarBucket[];
  missingProjects: RoadmapStatusPackCalendarMissingProject[];
  dataStatus: RoadmapStatusPackDataStatus;
}

/* ────────────── Risks & Blockers presentation types (Phase 6A.7) ────────────── */

export type RoadmapStatusPackRiskBlockerDataStatus =
  | "ok"
  | "partial"
  | "empty"
  | "unavailable";

export type RoadmapStatusPackRiskSeverityBucket =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "unknown";

export type RoadmapStatusPackBlockerStatusBucket =
  | "open"
  | "in_progress"
  | "resolved"
  | "unknown";

export interface RoadmapStatusPackRiskItem {
  riskId: string;
  title: string;
  projectId: string;
  projectName: string;
  workspaceName: string;
  programName: string | null;
  targetType: string;
  status: string;
  statusLabel: string;
  /** Stored DB value (e.g. "high", "medium"). May be empty. */
  likelihood: string;
  impact: string;
  /** Derived for sort/tile bucketing — never invented. */
  severityBucket: RoadmapStatusPackRiskSeverityBucket;
  severityLabel: string;
  mitigationSummary: string | null;
  /**
   * 6B.6a — Server-decrypted risk description text (untruncated at this
   * derivation layer). Source-package snapshots truncate to a bounded
   * length and mark `detailTruncated` accordingly.
   */
  description: string | null;
  createdAt: string;
  updatedAt: string;
  ageDays: number;
  isStale: boolean;
  isActive: boolean;
  isRealized: boolean;
  isClosed: boolean;
}

export interface RoadmapStatusPackBlockerItem {
  blockerId: string;
  title: string;
  projectId: string;
  projectName: string;
  workspaceName: string;
  programName: string | null;
  targetType: string;
  status: string;
  statusLabel: string;
  statusBucket: RoadmapStatusPackBlockerStatusBucket;
  severity: string;
  severityBucket: RoadmapStatusPackRiskSeverityBucket;
  severityLabel: string;
  descriptionSummary: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  ageDays: number;
  isStale: boolean;
  isOpen: boolean;
  isResolved: boolean;
}

export interface RoadmapStatusPackRisksBlockers {
  /** True only if data is available for at least one project in scope. */
  available: boolean;
  /** True if at least one project failed to return data. */
  partial: boolean;
  /** Aggregate failure: every scoped project errored. */
  errored: boolean;
  projectsInScope: number;
  projectsWithData: number;
  projectsFailed: number;

  // Risks
  totalRisks: number;
  openRisksCount: number;
  highCriticalRisksCount: number;
  realizedRisksCount: number;
  staleRisksCount: number;
  topRisks: RoadmapStatusPackRiskItem[];

  // Blockers
  totalBlockers: number;
  openBlockersCount: number;
  highCriticalBlockersCount: number;
  staleBlockersCount: number;
  topBlockers: RoadmapStatusPackBlockerItem[];

  dataStatus: RoadmapStatusPackRiskBlockerDataStatus;
  /** When dataStatus === "unavailable" this carries the reason for UI. */
  unavailableReason: string | null;
}

/* ────────────── Dependencies & Coordination presentation types (Phase 6A.8) ────────────── */

export type RoadmapStatusPackDependencyLevel = "project" | "phase" | "task";

export type RoadmapStatusPackDependencyDirection =
  | "inbound"
  | "outbound"
  | "internal";

export type RoadmapStatusPackDependencyDataStatus =
  | "ok"
  | "partial"
  | "empty"
  | "unavailable";

export interface RoadmapStatusPackDependencyEndpoint {
  /** Project ID of the predecessor/source or successor/target project. */
  projectId: string;
  /** Project name when authorized + in-scope, else "External / out of scope". */
  projectName: string;
  workspaceName: string | null;
  programName: string | null;
  /** True when this endpoint is within the current Roadmap Status Pack scope. */
  inScope: boolean;
}

export interface RoadmapStatusPackDependencyItem {
  dependencyId: string;
  /** Same-level only. Roadmap Status Pack surfaces project-level here. */
  level: RoadmapStatusPackDependencyLevel;
  /** Predecessor / source side. */
  source: RoadmapStatusPackDependencyEndpoint;
  /** Successor / target side. */
  target: RoadmapStatusPackDependencyEndpoint;
  /** Direction relative to the current Roadmap scope. */
  direction: RoadmapStatusPackDependencyDirection;
  dependencyType: string | null;
  dependencyTypeLabel: string;
  /** Project IDs in scope that this dependency affects (1 or 2). */
  affectedScopedProjectIds: readonly string[];
  /**
   * True when any in-scope side carries an attention signal (red health,
   * behind schedule, etc.). Derived from reporting only — never invented.
   */
  isAttention: boolean;
  /** 6B.6a — Dependency rationale / description text (plain). */
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoadmapStatusPackDependencies {
  /** True when the underlying read path is available (loaded without aggregate error). */
  available: boolean;
  /** True for resolver-blocked unavailable state (kept for future phase/task levels). */
  errored: boolean;
  projectsInScope: number;

  totalDependencies: number;
  projectLevelCount: number;
  phaseLevelCount: number;
  taskLevelCount: number;

  inboundCount: number;
  outboundCount: number;
  internalCount: number;
  attentionCount: number;

  attentionItems: readonly RoadmapStatusPackDependencyItem[];
  inboundItems: readonly RoadmapStatusPackDependencyItem[];
  outboundItems: readonly RoadmapStatusPackDependencyItem[];
  internalItems: readonly RoadmapStatusPackDependencyItem[];

  dataStatus: RoadmapStatusPackDependencyDataStatus;
  unavailableReason: string | null;
  /**
   * Notes about coverage limits — e.g. phase/task-level dependencies are
   * not surfaced at Roadmap scope yet.
   */
  coverageNotes: readonly string[];
}

/* ────────────── KPI presentation types (Phase 6A.9) ────────────── */

export type RoadmapStatusPackKpiDataStatus =
  | "ok"
  | "partial"
  | "empty"
  | "unavailable";

export type RoadmapStatusPackKpiStatus =
  | "on_target"
  | "off_target"
  | "no_target"
  | "no_value"
  | "unknown";

export type RoadmapStatusPackKpiTrend =
  | "improving"
  | "declining"
  | "flat"
  | "insufficient_history"
  | "no_history";

export type RoadmapStatusPackKpiFreshness =
  | "fresh"
  | "stale"
  | "no_history";

/**
 * Where a KPI's latest reading was sourced (6A.17). Mirrors the same
 * precedence the project KPI surface applies: official snapshot is the
 * canonical latest reading when present, manual update history is the
 * fallback, and `kpi_definitions.current_value` is the final fallback.
 */
export type RoadmapStatusPackKpiValueSource =
  | "official_snapshot"
  | "official_snapshot_unavailable"
  | "manual_update"
  | "definition_current_value"
  | "none";


export interface RoadmapStatusPackKpiItem {
  definitionId: string;
  name: string;
  /** 6B.6a — Plain-text KPI description from `kpi_definitions.description`. */
  description: string | null;
  unit: string | null;
  targetValue: number | null;
  targetDirection: string | null;
  /** Raw kpi_definitions.current_value — kept for reference / fallback. */
  currentValue: number | null;
  /** Project ID this KPI is attached to (target_type='project'). */
  projectId: string;
  projectName: string;
  workspaceName: string | null;
  programName: string | null;
  /** Project-level attention signal from canonical reporting (never invented). */
  projectAttention: boolean;
  /**
   * ISO date of the latest authorized reading (snapshot OR manual update),
   * whichever is most recent. Null only when no snapshot AND no update.
   */
  lastUpdateDate: string | null;
  /** Days since latest reading; null when no history is visible. */
  daysSinceLastUpdate: number | null;
  freshness: RoadmapStatusPackKpiFreshness;
  /**
   * Latest numeric value chosen by the same precedence as project KPI
   * detail: latest reportable official snapshot, else latest manual update,
   * else `kpi_definitions.current_value`. Null when none exist.
   */
  latestValue: number | null;
  /** Where `latestValue` came from. */
  latestValueSource: RoadmapStatusPackKpiValueSource;
  /** ISO date of the chosen latest reading (matches `latestValueSource`). */
  latestValueDate: string | null;
  /** True if at least one official snapshot row is visible (any status). */
  hasOfficialSnapshot: boolean;
  /**
   * True when the most-recent official snapshot exists but is not
   * reportable (non-reportable calculation_status or null value). When
   * true, `latestValue` is null and no silent fallback to an older
   * snapshot or to a manual update is performed — mirrors the project
   * KPI surface (`evaluateKpiReadiness`).
   */
  latestSnapshotNonReportable: boolean;
  /** `calculation_status` of the most-recent snapshot, when one exists. */
  latestSnapshotCalculationStatus: string | null;
  /** True if at least one manual update row is visible. */
  hasManualUpdateHistory: boolean;
  /** Legacy alias of `latestValue` for any consumers still reading it. */
  latestUpdateValue: number | null;
  /** Previous value used for trend, from the same source as `latestValue`. */
  previousUpdateValue: number | null;
  status: RoadmapStatusPackKpiStatus;
  trend: RoadmapStatusPackKpiTrend;
  /**
   * True only when NEITHER an official snapshot NOR a manual update row is
   * visible. Snapshot-only KPIs are no longer flagged as "No history",
   * and a non-reportable latest snapshot still counts as a visible
   * snapshot (so this stays false).
   */
  missingUpdateHistory: boolean;
}


export interface RoadmapStatusPackKpis {
  /** True when the KPI definitions read path returned without error. */
  available: boolean;
  /** True when KPI update history could not be loaded (definitions still shown). */
  updatesPartial: boolean;
  /** True when the definitions read path itself failed. */
  errored: boolean;
  projectsInScope: number;

  totalKpis: number;
  withLatestUpdate: number;
  missingUpdateHistory: number;
  staleCount: number;
  onTargetCount: number;
  offTargetCount: number;
  unknownStatusCount: number;

  attentionItems: readonly RoadmapStatusPackKpiItem[];
  recentlyUpdatedItems: readonly RoadmapStatusPackKpiItem[];
  staleItems: readonly RoadmapStatusPackKpiItem[];
  missingHistoryItems: readonly RoadmapStatusPackKpiItem[];
  allItems: readonly RoadmapStatusPackKpiItem[];

  dataStatus: RoadmapStatusPackKpiDataStatus;
  unavailableReason: string | null;
  coverageNotes: readonly string[];
}

/* ────────────── Governance / Decisions / Asks types (Phase 6A.10) ────────────── */

export type RoadmapStatusPackGovernanceDataStatus =
  | "ok"
  | "partial"
  | "empty"
  | "unavailable";

export type RoadmapStatusPackGovernanceCategory =
  | "decision_required"
  | "decision_made"
  | "evidence_record";

export type RoadmapStatusPackGovernanceDecisionStatus =
  | "not_started"
  | "in_progress"
  | "pending_decision"
  | "decided"
  | "closed"
  | "not_applicable";

export interface RoadmapStatusPackGovernanceItem {
  recordId: string;
  projectId: string;
  projectName: string;
  workspaceName: string | null;
  programName: string | null;
  /** From canonical `record_kind`. */
  recordKind: "evidence_record" | "decision_case";
  category: RoadmapStatusPackGovernanceCategory;
  /** Best-effort title from event_name → cadence_event_name → event_type. */
  title: string;
  eventType: string;
  /** Cadence event label when row was attached to a cadence; else null. */
  cadenceEventTypeLabel: string | null;
  cadenceEventName: string | null;
  /** Truncated summary (≤180 chars) for preview. */
  summary: string | null;
  /** Truncated decision question for preview. */
  decisionQuestion: string | null;
  decisionStage: string | null;
  decisionStatus: RoadmapStatusPackGovernanceDecisionStatus;
  decisionCount: number;
  linkCount: number;
  hasSharepointEvidence: boolean;
  actualDateHeld: string;
  targetDecisionDate: string | null;
  createdAt: string;
  updatedAt: string;
  /** True when target_decision_date is in the past and not decided/closed. */
  isOverdue: boolean;
  /** True when updated_at is older than 60 days and not decided/closed. */
  isStale: boolean;
  /** True when canonical reporting flags the project red / behind schedule. */
  projectAttention: boolean;
}

export interface RoadmapStatusPackGovernance {
  /** True when the underlying read path returned at least one project resolved. */
  available: boolean;
  /** True when at least one scoped project failed to return data. */
  partial: boolean;
  /** Aggregate failure: every scoped project errored. */
  errored: boolean;
  projectsInScope: number;
  projectsWithData: number;
  projectsFailed: number;

  totalRecords: number;
  decisionCasesCount: number;
  decisionsRequiredCount: number;
  decisionsMadeCount: number;
  evidenceRecordsCount: number;
  overdueCount: number;
  staleCount: number;

  decisionsRequired: readonly RoadmapStatusPackGovernanceItem[];
  recentDecisions: readonly RoadmapStatusPackGovernanceItem[];
  recentGovernanceRecords: readonly RoadmapStatusPackGovernanceItem[];
  overdueOrStaleItems: readonly RoadmapStatusPackGovernanceItem[];
  otherRecords: readonly RoadmapStatusPackGovernanceItem[];

  dataStatus: RoadmapStatusPackGovernanceDataStatus;
  unavailableReason: string | null;
  coverageNotes: readonly string[];
}

export type RoadmapStatusPackProgressDataStatus =
  | "ok"
  | "partial"
  | "empty"
  | "unavailable";

export type RoadmapStatusPackProgressCategory =
  | "completed_delivered"
  | "schedule_movement"
  | "governance_decision"
  | "risk_blocker_kpi"
  | "ownership_metadata"
  | "lifecycle_stage"
  | "other";

export interface RoadmapStatusPackProgressPeriod {
  label: string;
  startIso: string;
  endIso: string;
  lookbackDays: number;
  /**
   * Honest disclosure: this is the default lookback, not a "since last
   * presentation" comparison. Saved presentation views do not exist yet.
   */
  isDefaultLookback: true;
}

export interface RoadmapStatusPackProgressItem {
  /** Activity event id. */
  eventId: string;
  /** Source type — currently only canonical activity events. */
  sourceType: "activity_event";
  projectId: string;
  projectName: string;
  workspaceName: string | null;
  programName: string | null;
  targetType: string;
  targetId: string;
  /** Raw canonical event_type from activity_events. */
  eventType: string;
  /** Bucketed presentation category derived from event_type. */
  category: RoadmapStatusPackProgressCategory;
  /** True for high-attention categories (completion / schedule / governance). */
  important: boolean;
  /** ISO timestamp the event was recorded. */
  occurredAt: string;
  actorId: string | null;
}

export interface RoadmapStatusPackProgressSinceLast {
  period: RoadmapStatusPackProgressPeriod;

  /** True when at least one project resolved (data path available). */
  available: boolean;
  /** True when some scoped projects failed to load. */
  partial: boolean;
  /** True when every scoped project failed. */
  errored: boolean;

  projectsInScope: number;
  projectsWithData: number;
  projectsFailed: number;

  totalEventsInPeriod: number;
  completedDeliveredCount: number;
  scheduleMovementCount: number;
  governanceDecisionCount: number;
  riskBlockerKpiCount: number;
  ownershipMetadataCount: number;
  lifecycleStageCount: number;
  otherCount: number;

  completedDelivered: readonly RoadmapStatusPackProgressItem[];
  scheduleMovements: readonly RoadmapStatusPackProgressItem[];
  governanceDecisionUpdates: readonly RoadmapStatusPackProgressItem[];
  riskBlockerKpiChanges: readonly RoadmapStatusPackProgressItem[];
  otherRecentActivity: readonly RoadmapStatusPackProgressItem[];

  /**
   * Execution updates are NOT separately surfaced in this step — no safe
   * Roadmap-level aggregate read path exists yet. Flag is informational so
   * the UI can label this honestly.
   */
  executionUpdatesAvailable: false;
  executionUpdatesNote: string;

  dataStatus: RoadmapStatusPackProgressDataStatus;
  unavailableReason: string | null;
  coverageNotes: readonly string[];
}

export interface RoadmapStatusPackPreviewData {
  scopeSummary: RoadmapStatusPackScopeSummary;
  executiveSummary: RoadmapStatusPackExecutiveSummary;
  controlBoard: RoadmapStatusPackControlBoard;
  timeline: RoadmapStatusPackTimeline;
  calendarMilestones: RoadmapStatusPackCalendarMilestones;
  risksBlockers: RoadmapStatusPackRisksBlockers;
  dependencies: RoadmapStatusPackDependencies;
  kpis: RoadmapStatusPackKpis;
  governance: RoadmapStatusPackGovernance;
  progressSinceLast: RoadmapStatusPackProgressSinceLast;
  teamWorkSummary: RoadmapStatusPackTeamWorkSummary;
  teamWorkDetailAnnex: RoadmapStatusPackTeamWorkDetailAnnex;
  projectDetailAnnex: RoadmapStatusPackProjectDetailAnnex;
  scopeDataNotes: RoadmapStatusPackScopeDataNotes;
}





/* ────────────── filter application (mirrors Roadmap semantics) ────────────── */

// Workflow status and priority labels are sourced from the canonical BTPM
// visual-semantics module (getPmWorkflowStatusLabel / getPmPriorityLabel).


const HEALTH_LABELS: Record<ReportingHealthRag | "unknown", string> = {
  green: "Green",
  amber: "Amber",
  red: "Red",
  unknown: "Unknown",
};

const SCHEDULE_LABELS: Record<ReportingScheduleSignal | "unknown", string> = {
  on_track: "On track",
  behind_schedule: "Behind schedule",
  complete: "Complete",
  no_schedule_basis: "No schedule basis",
  unknown: "Unknown",
};

function isAll(v: string | undefined): boolean {
  return !v || v === "all";
}

/**
 * Apply a Roadmap filter snapshot to a list of accessible projects.
 * Mirrors Roadmap filtering semantics:
 *  - empty workspace selection => all accessible workspaces
 *  - empty program selection => all programs/standalone
 *  - program ID `__none__` => standalone (no program)
 *  - empty project selection => all projects after parent filters
 *  - status/priority "all" or empty => no filtering
 *  - health/schedule "all" or empty => no filtering (requires reporting summary)
 */
export function applyRoadmapFilterSnapshot(
  projects: readonly RoadmapProject[],
  filters: RoadmapFilterSnapshot | undefined,
  reportingByProjectId: ReadonlyMap<string, ProjectReportingSummary>,
): RoadmapProject[] {
  const f = filters ?? {};
  const wsIds = f.workspace_ids ?? [];
  const progIds = f.program_ids ?? [];
  const projIds = f.project_ids ?? [];
  const portfolioIds = f.portfolio_item_ids ?? [];
  const includeNoPortfolio = f.include_no_portfolio === true;
  const wsSet = new Set(wsIds);
  const progSet = new Set(progIds);
  const projSet = new Set(projIds);
  const portfolioSet = new Set(portfolioIds);
  const includeStandalone = progSet.has("__none__");
  const hasPortfolioFilter = portfolioIds.length > 0;

  return projects.filter((p) => {
    // Phase 6D.7A — Portfolio scope evaluated first. Uses safe optional
    // access because some cached project shapes may temporarily lack
    // portfolio_item_id.
    if (hasPortfolioFilter || includeNoPortfolio) {
      const pid = (p as { portfolio_item_id?: string | null }).portfolio_item_id ?? null;
      if (hasPortfolioFilter && includeNoPortfolio) {
        if (!(pid === null || portfolioSet.has(pid))) return false;
      } else if (hasPortfolioFilter) {
        if (!(pid && portfolioSet.has(pid))) return false;
      } else if (includeNoPortfolio) {
        if (pid !== null) return false;
      }
    }
    if (wsIds.length > 0 && !wsSet.has(p.workspace_id)) return false;
    if (progIds.length > 0) {
      if (!p.program_id) {
        if (!includeStandalone) return false;
      } else if (!progSet.has(p.program_id)) {
        return false;
      }
    }
    if (projIds.length > 0 && !projSet.has(p.id)) return false;
    if (!isAll(f.status_filter) && p.status !== f.status_filter) return false;
    if (!isAll(f.priority_filter) && p.priority !== f.priority_filter) return false;
    if (!isAll(f.health_filter)) {
      const s = reportingByProjectId.get(p.id);
      if (!s || s.health_rag !== f.health_filter) return false;
    }
    if (!isAll(f.schedule_filter)) {
      const s = reportingByProjectId.get(p.id);
      if (!s || s.schedule_signal !== f.schedule_filter) return false;
    }
    return true;
  });
}

/* ────────────── breakdown helpers ────────────── */

function bumpCount(
  map: Map<string, { label: string; count: number }>,
  key: string,
  label: string,
): void {
  const existing = map.get(key);
  if (existing) existing.count += 1;
  else map.set(key, { label, count: 1 });
}

function toBreakdown(
  map: Map<string, { label: string; count: number }>,
): RoadmapStatusPackBreakdownItem[] {
  return Array.from(map, ([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/* ────────────── Cover & Scope derivation ────────────── */

function summarizeAppliedFilters(
  f: RoadmapFilterSnapshot | undefined,
): RoadmapStatusPackFilterDisplayItem[] {
  const items: RoadmapStatusPackFilterDisplayItem[] = [];
  const fs = f ?? {};
  items.push({
    label: "Workspaces",
    value: fs.workspace_ids && fs.workspace_ids.length > 0 ? `${fs.workspace_ids.length} selected` : "All accessible",
  });
  items.push({
    label: "Programs",
    value: fs.program_ids && fs.program_ids.length > 0 ? `${fs.program_ids.length} selected` : "All",
  });
  items.push({
    label: "Projects",
    value: fs.project_ids && fs.project_ids.length > 0 ? `${fs.project_ids.length} selected` : "All",
  });
  items.push({
    label: "Status",
    value: isAll(fs.status_filter) ? "All" : getPmWorkflowStatusLabel(fs.status_filter!),
  });
  items.push({
    label: "Priority",
    value: isAll(fs.priority_filter) ? "All" : getPmPriorityLabel(fs.priority_filter!),
  });
  items.push({
    label: "Health",
    value: isAll(fs.health_filter)
      ? "All"
      : HEALTH_LABELS[(fs.health_filter as ReportingHealthRag) ?? "unknown"] ?? fs.health_filter!,
  });
  items.push({
    label: "Schedule",
    value: isAll(fs.schedule_filter)
      ? "All"
      : SCHEDULE_LABELS[(fs.schedule_filter as ReportingScheduleSignal) ?? "unknown"] ?? fs.schedule_filter!,
  });
  // Phase 6D.7A — Portfolio filter display.
  const portfolioIds = fs.portfolio_item_ids ?? [];
  const includeNoPortfolio = fs.include_no_portfolio === true;
  let portfolioValue: string;
  if (portfolioIds.length === 0 && !includeNoPortfolio) portfolioValue = "All";
  else if (portfolioIds.length === 0 && includeNoPortfolio) portfolioValue = "No Portfolio";
  else if (portfolioIds.length > 0 && includeNoPortfolio)
    portfolioValue = `${portfolioIds.length} selected + No Portfolio`;
  else portfolioValue = `${portfolioIds.length} selected`;
  items.push({ label: "Portfolio", value: portfolioValue });
  return items;
}

export function deriveRoadmapStatusPackScopeSummary(args: {
  manifest: RoadmapStatusPackManifest;
  accessibleProjects: readonly RoadmapProject[];
  scopedProjects: readonly RoadmapProject[];
  reportingByProjectId: ReadonlyMap<string, ProjectReportingSummary>;
  reportingAvailable: boolean;
  generatedAt?: string;
}): RoadmapStatusPackScopeSummary {
  const { manifest, accessibleProjects, scopedProjects, reportingByProjectId, reportingAvailable } = args;
  const filters = manifest.scope.roadmap_filters;

  const wsLabels = new Map<string, string>();
  const progLabels = new Map<string, string>();
  const projLabels: string[] = [];
  const portfolioLabelMap = new Map<string, string>();
  let noPortfolioProjectCount = 0;

  for (const p of scopedProjects) {
    if (!wsLabels.has(p.workspace_id)) wsLabels.set(p.workspace_id, p.workspace_name);
    if (p.program_id && p.program_name && !progLabels.has(p.program_id)) {
      progLabels.set(p.program_id, p.program_name);
    }
    projLabels.push(p.name);
    // Phase 6D.7A — Portfolio counts/labels from authorized project rows.
    const pAny = p as {
      portfolio_item_id?: string | null;
      portfolio_name?: string | null;
      portfolio_code?: string | null;
      portfolio_is_archived?: boolean | null;
    };
    if (!pAny.portfolio_item_id) {
      noPortfolioProjectCount += 1;
    } else if (!portfolioLabelMap.has(pAny.portfolio_item_id)) {
      const name = pAny.portfolio_name || "Unnamed Portfolio";
      const base = pAny.portfolio_code ? `${pAny.portfolio_code} — ${name}` : name;
      const label = pAny.portfolio_is_archived ? `${base} (archived)` : base;
      portfolioLabelMap.set(pAny.portfolio_item_id, label);
    }
  }

  let available = 0;
  let missing = 0;
  for (const p of scopedProjects) {
    if (reportingByProjectId.has(p.id)) available += 1;
    else missing += 1;
  }

  return {
    packTitle: "Roadmap Status Pack",
    sourceSurface: "Roadmap",
    scopeKind: "Roadmap",
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    totalAccessibleProjects: accessibleProjects.length,
    totalProjectsInScope: scopedProjects.length,
    workspaceCountInScope: wsLabels.size,
    programCountInScope: progLabels.size,
    projectCountInScope: scopedProjects.length,
    workspaceLabels: Array.from(wsLabels.values()).sort((a, b) => a.localeCompare(b)),
    programLabels: Array.from(progLabels.values()).sort((a, b) => a.localeCompare(b)),
    projectLabels: projLabels.sort((a, b) => a.localeCompare(b)),
    portfolioCountInScope: portfolioLabelMap.size,
    portfolioLabels: Array.from(portfolioLabelMap.values()).sort((a, b) => a.localeCompare(b)),
    noPortfolioProjectCount,
    appliedFilters: summarizeAppliedFilters(filters),
    reportingSummariesAvailable: available,
    reportingSummariesMissing: missing,
    reportingAvailable,
    note:
      "BTPM is the source of truth. This is a live preview — PPT export from Status Pack is not yet enabled.",
  };
}

/* ────────────── Executive Summary derivation ────────────── */

export function deriveRoadmapStatusPackExecutiveSummary(args: {
  scopedProjects: readonly RoadmapProject[];
  reportingByProjectId: ReadonlyMap<string, ProjectReportingSummary>;
}): RoadmapStatusPackExecutiveSummary {
  const { scopedProjects, reportingByProjectId } = args;

  const status = new Map<string, { label: string; count: number }>();
  const priority = new Map<string, { label: string; count: number }>();
  const health = new Map<string, { label: string; count: number }>();
  const schedule = new Map<string, { label: string; count: number }>();

  let completionSum = 0;
  let completionBasis = 0;
  let behindScheduleCount = 0;
  let noScheduleBasisCount = 0;
  let reportingAvailable = 0;
  let latestComputedAt: string | null = null;

  for (const p of scopedProjects) {
    bumpCount(status, p.status, getPmWorkflowStatusLabel(p.status));
    bumpCount(priority, p.priority, getPmPriorityLabel(p.priority));

    const s = reportingByProjectId.get(p.id);
    if (s) {
      reportingAvailable += 1;
      completionSum += s.completion_percent;
      completionBasis += 1;
      bumpCount(health, s.health_rag, HEALTH_LABELS[s.health_rag]);
      bumpCount(schedule, s.schedule_signal, SCHEDULE_LABELS[s.schedule_signal]);
      if (s.schedule_signal === "behind_schedule") behindScheduleCount += 1;
      if (s.schedule_signal === "no_schedule_basis") noScheduleBasisCount += 1;
      if (s.computed_at && (!latestComputedAt || s.computed_at > latestComputedAt)) {
        latestComputedAt = s.computed_at;
      }
    } else {
      bumpCount(health, "unknown", HEALTH_LABELS.unknown);
      bumpCount(schedule, "unknown", SCHEDULE_LABELS.unknown);
    }
  }

  const reportingMissing = scopedProjects.length - reportingAvailable;
  const dataStatus: RoadmapStatusPackDataStatus =
    scopedProjects.length === 0
      ? "empty"
      : reportingMissing === 0
      ? "ok"
      : reportingAvailable === 0
      ? "partial"
      : "partial";

  return {
    totalProjects: scopedProjects.length,
    averageCompletionPercent:
      completionBasis > 0 ? Math.round((completionSum / completionBasis) * 10) / 10 : null,
    averageCompletionBasis: completionBasis,
    statusDistribution: toBreakdown(status),
    priorityDistribution: toBreakdown(priority),
    healthDistribution: toBreakdown(health),
    scheduleDistribution: toBreakdown(schedule),
    behindScheduleCount,
    noScheduleBasisCount,
    reportingSummariesAvailable: reportingAvailable,
    reportingSummariesMissing: reportingMissing,
    latestComputedAt,
    dataStatus,
  };
}

/* ────────────── Control Board derivation (Phase 6A.4) ────────────── */

const ATTENTION_RANK: Record<RoadmapStatusPackControlBoardAttentionSignal, number> = {
  red_health: 0,
  behind_schedule: 1,
  amber_health: 2,
  missing_reporting: 3,
  no_schedule_basis: 4,
  high_priority: 5,
};

function deriveAttention(
  p: RoadmapProject,
  s: ProjectReportingSummary | undefined,
): RoadmapStatusPackControlBoardAttentionSignal[] {
  const out: RoadmapStatusPackControlBoardAttentionSignal[] = [];
  if (s) {
    if (s.health_rag === "red") out.push("red_health");
    if (s.schedule_signal === "behind_schedule") out.push("behind_schedule");
    if (s.health_rag === "amber") out.push("amber_health");
    if (s.schedule_signal === "no_schedule_basis") out.push("no_schedule_basis");
  } else {
    out.push("missing_reporting");
  }
  if (p.priority === "critical" || p.priority === "high") out.push("high_priority");
  return out;
}

function attentionScore(signals: readonly RoadmapStatusPackControlBoardAttentionSignal[]): number {
  if (signals.length === 0) return 100;
  let min = 100;
  for (const sig of signals) {
    const r = ATTENTION_RANK[sig];
    if (r < min) min = r;
  }
  return min;
}

export function deriveRoadmapStatusPackControlBoard(args: {
  scopedProjects: readonly RoadmapProject[];
  reportingByProjectId: ReadonlyMap<string, ProjectReportingSummary>;
  reportingAvailable: boolean;
}): RoadmapStatusPackControlBoard {
  const { scopedProjects, reportingByProjectId, reportingAvailable } = args;

  let projectsWithReporting = 0;
  let red = 0;
  let amber = 0;
  let green = 0;
  let unknown = 0;
  let behind = 0;

  const rows: RoadmapStatusPackControlBoardProject[] = scopedProjects.map((p) => {
    const s = reportingByProjectId.get(p.id);
    const has = !!s;
    if (has) {
      projectsWithReporting += 1;
      if (s!.health_rag === "red") red += 1;
      else if (s!.health_rag === "amber") amber += 1;
      else if (s!.health_rag === "green") green += 1;
      if (s!.schedule_signal === "behind_schedule") behind += 1;
    } else {
      unknown += 1;
    }
    const attentionSignals = deriveAttention(p, s);
    return {
      projectId: p.id,
      projectName: p.name,
      workspaceId: p.workspace_id,
      workspaceName: p.workspace_name,
      programId: p.program_id,
      programName: p.program_name,
      status: p.status,
      statusLabel: getPmWorkflowStatusLabel(p.status),
      priority: p.priority,
      priorityLabel: getPmPriorityLabel(p.priority),
      projectStage: p.project_stage,
      startDate: p.start_date,
      targetEndDate: p.target_end_date,
      hasReportingSummary: has,
      healthRag: has ? s!.health_rag : null,
      healthLabel: has ? HEALTH_LABELS[s!.health_rag] : null,
      scheduleSignal: has ? s!.schedule_signal : null,
      scheduleLabel: has ? SCHEDULE_LABELS[s!.schedule_signal] : null,
      completionPercent: has ? s!.completion_percent : null,
      computedAt: has ? s!.computed_at : null,
      attentionSignals,
      // Phase 6D.7A — Portfolio context from authorized RoadmapProject row.
      portfolioItemId: (p as { portfolio_item_id?: string | null }).portfolio_item_id ?? null,
      portfolioName: (p as { portfolio_name?: string | null }).portfolio_name ?? null,
      portfolioCode: (p as { portfolio_code?: string | null }).portfolio_code ?? null,
      portfolioLifecycleState:
        (p as { portfolio_lifecycle_state?: string | null }).portfolio_lifecycle_state ?? null,
      portfolioIsArchived:
        (p as { portfolio_is_archived?: boolean | null }).portfolio_is_archived ?? null,
    };
  });

  const sortedRows = rows.slice().sort((a, b) => {
    const sa = attentionScore(a.attentionSignals);
    const sb = attentionScore(b.attentionSignals);
    if (sa !== sb) return sa - sb;
    return a.projectName.localeCompare(b.projectName);
  });

  const attentionCount = sortedRows.filter(
    (r) =>
      r.attentionSignals.length > 0 &&
      !(r.attentionSignals.length === 1 && r.attentionSignals[0] === "high_priority"),
  ).length;

  const dataStatus: RoadmapStatusPackDataStatus =
    scopedProjects.length === 0
      ? "empty"
      : projectsWithReporting === scopedProjects.length
      ? "ok"
      : "partial";

  return {
    totalProjects: scopedProjects.length,
    projectsWithReporting,
    projectsMissingReporting: scopedProjects.length - projectsWithReporting,
    redHealthCount: red,
    amberHealthCount: amber,
    greenHealthCount: green,
    unknownHealthCount: unknown,
    behindScheduleCount: behind,
    attentionCount,
    reportingAvailable,
    rows: sortedRows,
    dataStatus,
  };
}

/* ────────────── Timeline derivation (Phase 6A.5) ────────────── */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function diffDays(startISO: string, endISO: string): number | null {
  const a = Date.parse(startISO);
  const b = Date.parse(endISO);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / MS_PER_DAY));
}

function minIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}
function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function scheduleBucketFor(
  s: ProjectReportingSummary | undefined,
): RoadmapStatusPackTimelineScheduleBucket {
  if (!s) return "unknown";
  switch (s.schedule_signal) {
    case "on_track":
      return "on_track";
    case "behind_schedule":
      return "behind_schedule";
    case "complete":
      return "complete";
    case "no_schedule_basis":
      return "no_schedule_basis";
    default:
      return "unknown";
  }
}

export function deriveRoadmapStatusPackTimeline(args: {
  scopedProjects: readonly RoadmapProject[];
  reportingByProjectId: ReadonlyMap<string, ProjectReportingSummary>;
  reportingAvailable: boolean;
}): RoadmapStatusPackTimeline {
  const { scopedProjects, reportingByProjectId, reportingAvailable } = args;

  let withRange = 0;
  let missingRange = 0;
  let partialRange = 0;
  let behind = 0;
  let unknownSched = 0;
  let earliest: string | null = null;
  let latest: string | null = null;

  const items: RoadmapStatusPackTimelineItem[] = scopedProjects.map((p) => {
    const s = reportingByProjectId.get(p.id);
    const has = !!s;
    const start = p.start_date ?? null;
    const end = p.target_end_date ?? null;
    const hasBoth = !!start && !!end;
    const hasStartOnly = !!start && !end;
    const hasEndOnly = !start && !!end;
    if (hasBoth) {
      withRange += 1;
      earliest = minIso(earliest, start);
      latest = maxIso(latest, end);
    } else if (hasStartOnly || hasEndOnly) {
      partialRange += 1;
      if (start) earliest = minIso(earliest, start);
      if (end) latest = maxIso(latest, end);
    } else {
      missingRange += 1;
    }
    const bucket = scheduleBucketFor(s);
    if (bucket === "behind_schedule") behind += 1;
    if (bucket === "unknown") unknownSched += 1;

    const isAttention =
      (has && (s!.health_rag === "red" || s!.schedule_signal === "behind_schedule")) ||
      (!hasBoth && !hasStartOnly && !hasEndOnly);

    return {
      projectId: p.id,
      projectName: p.name,
      workspaceId: p.workspace_id,
      workspaceName: p.workspace_name,
      programId: p.program_id,
      programName: p.program_name,
      status: p.status,
      statusLabel: getPmWorkflowStatusLabel(p.status),
      priority: p.priority,
      priorityLabel: getPmPriorityLabel(p.priority),
      projectStage: p.project_stage,
      startDate: start,
      endDate: end,
      hasDateRange: hasBoth,
      hasStartOnly,
      hasEndOnly,
      durationDays: hasBoth ? diffDays(start!, end!) : null,
      hasReportingSummary: has,
      healthRag: has ? s!.health_rag : null,
      healthLabel: has ? HEALTH_LABELS[s!.health_rag] : null,
      scheduleSignal: has ? s!.schedule_signal : null,
      scheduleLabel: has ? SCHEDULE_LABELS[s!.schedule_signal] : null,
      scheduleBucket: bucket,
      completionPercent: has ? s!.completion_percent : null,
      isAttention,
    };
  });

  const dated = items
    .filter((it) => it.hasDateRange || it.hasStartOnly || it.hasEndOnly)
    .slice()
    .sort((a, b) => {
      // attention first within dated bucket
      if (a.isAttention !== b.isAttention) return a.isAttention ? -1 : 1;
      const as = a.startDate ?? a.endDate ?? "";
      const bs = b.startDate ?? b.endDate ?? "";
      if (as !== bs) return as < bs ? -1 : 1;
      const ae = a.endDate ?? a.startDate ?? "";
      const be = b.endDate ?? b.startDate ?? "";
      if (ae !== be) return ae < be ? -1 : 1;
      return a.projectName.localeCompare(b.projectName);
    });

  const undated = items
    .filter((it) => !it.hasDateRange && !it.hasStartOnly && !it.hasEndOnly)
    .slice()
    .sort((a, b) => a.projectName.localeCompare(b.projectName));

  const spanDays =
    earliest && latest ? diffDays(earliest, latest) : null;

  const dataStatus: RoadmapStatusPackDataStatus =
    scopedProjects.length === 0
      ? "empty"
      : missingRange === 0 && partialRange === 0
      ? "ok"
      : "partial";

  return {
    totalProjects: scopedProjects.length,
    withDateRange: withRange,
    missingDateRange: missingRange,
    partialDateRange: partialRange,
    behindScheduleCount: behind,
    unknownScheduleCount: unknownSched,
    reportingAvailable,
    dated,
    undated,
    period: {
      earliestStart: earliest,
      latestEnd: latest,
      spanDays,
    },
    dataStatus,
  };
}

/* ────────────── Calendar / Upcoming Milestones derivation (Phase 6A.6) ────────────── */

const CALENDAR_ITEM_TYPE_LABELS: Record<RoadmapStatusPackCalendarItemType, string> = {
  project_start: "Project start",
  project_target_end: "Project target end",
};

const CALENDAR_BUCKET_LABELS: Record<RoadmapStatusPackCalendarBucketKey, string> = {
  overdue: "Overdue / past target",
  next_30: "Next 30 days",
  next_31_90: "Next 31–90 days",
  later: "Later",
  missing: "Missing date basis",
};

function toLocalDateOnlyISO(input: Date): string {
  const y = input.getFullYear();
  const m = String(input.getMonth() + 1).padStart(2, "0");
  const d = String(input.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateOnly(iso: string): Date | null {
  // Accepts "YYYY-MM-DD" or full ISO. We use only the date portion.
  if (!iso) return null;
  const datePart = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function daysBetweenLocal(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / MS_PER_DAY);
}

function bucketForDays(days: number, itemType: RoadmapStatusPackCalendarItemType): RoadmapStatusPackCalendarBucketKey {
  // Overdue: target end in past. Project start in past is not "overdue" — bucket as next_30 if recent, else later.
  if (itemType === "project_target_end" && days < 0) return "overdue";
  if (days < 0) {
    // past project_start: treat as informational "later"-style — surface within recent window
    if (days >= -30) return "next_30";
    return "later";
  }
  if (days <= 30) return "next_30";
  if (days <= 90) return "next_31_90";
  return "later";
}

export function deriveRoadmapStatusPackCalendarMilestones(args: {
  scopedProjects: readonly RoadmapProject[];
  reportingByProjectId: ReadonlyMap<string, ProjectReportingSummary>;
  reportingAvailable: boolean;
  now?: Date;
}): RoadmapStatusPackCalendarMilestones {
  const { scopedProjects, reportingByProjectId, reportingAvailable } = args;
  const now = args.now ?? new Date();
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const referenceDate = toLocalDateOnlyISO(todayLocal);

  const items: RoadmapStatusPackCalendarItem[] = [];
  const missingProjects: RoadmapStatusPackCalendarMissingProject[] = [];

  let upcoming30 = 0;
  let upcoming90 = 0;
  let overdue = 0;
  let behind = 0;
  let missingCount = 0;

  for (const p of scopedProjects) {
    const s = reportingByProjectId.get(p.id);
    const has = !!s;
    if (has && s!.schedule_signal === "behind_schedule") behind += 1;

    const startDt = p.start_date ? parseDateOnly(p.start_date) : null;
    const endDt = p.target_end_date ? parseDateOnly(p.target_end_date) : null;

    if (!startDt && !endDt) {
      missingCount += 1;
      missingProjects.push({
        projectId: p.id,
        projectName: p.name,
        workspaceName: p.workspace_name,
        programName: p.program_name,
        status: p.status,
        statusLabel: getPmWorkflowStatusLabel(p.status),
        priority: p.priority,
        priorityLabel: getPmPriorityLabel(p.priority),
        hasReportingSummary: has,
        healthLabel: has ? HEALTH_LABELS[s!.health_rag] : null,
        scheduleLabel: has ? SCHEDULE_LABELS[s!.schedule_signal] : null,
      });
      continue;
    }

    const pushItem = (dt: Date, type: RoadmapStatusPackCalendarItemType, iso: string) => {
      const days = daysBetweenLocal(todayLocal, dt);
      const bucket = bucketForDays(days, type);
      const isOverdueItem = type === "project_target_end" && days < 0;
      const isCurrent = days === 0;
      const isUpcoming = days > 0 && days <= 30;
      const isFuture = days > 30;
      if (isOverdueItem) overdue += 1;
      if (days >= 0 && days <= 30) upcoming30 += 1;
      if (days >= 0 && days <= 90) upcoming90 += 1;

      items.push({
        itemId: `${p.id}:${type}`,
        itemType: type,
        itemTypeLabel: CALENDAR_ITEM_TYPE_LABELS[type],
        projectId: p.id,
        projectName: p.name,
        workspaceId: p.workspace_id,
        workspaceName: p.workspace_name,
        programId: p.program_id,
        programName: p.program_name,
        date: iso.slice(0, 10),
        dateLabel: dt.toLocaleDateString(),
        daysFromToday: days,
        isOverdue: isOverdueItem,
        isUpcoming,
        isCurrent,
        isFuture,
        status: p.status,
        statusLabel: getPmWorkflowStatusLabel(p.status),
        priority: p.priority,
        priorityLabel: getPmPriorityLabel(p.priority),
        hasReportingSummary: has,
        healthRag: has ? s!.health_rag : null,
        healthLabel: has ? HEALTH_LABELS[s!.health_rag] : null,
        scheduleSignal: has ? s!.schedule_signal : null,
        scheduleLabel: has ? SCHEDULE_LABELS[s!.schedule_signal] : null,
        completionPercent: has ? s!.completion_percent : null,
        bucket,
      });
    };

    if (startDt && p.start_date) pushItem(startDt, "project_start", p.start_date);
    if (endDt && p.target_end_date) pushItem(endDt, "project_target_end", p.target_end_date);
  }

  // Sort items chronologically by date, then by overdue severity, then name.
  items.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.itemType !== b.itemType) return a.itemType < b.itemType ? -1 : 1;
    return a.projectName.localeCompare(b.projectName);
  });

  const bucketOrder: RoadmapStatusPackCalendarBucketKey[] = [
    "overdue",
    "next_30",
    "next_31_90",
    "later",
  ];
  const bucketMap = new Map<RoadmapStatusPackCalendarBucketKey, RoadmapStatusPackCalendarItem[]>();
  for (const k of bucketOrder) bucketMap.set(k, []);
  for (const it of items) {
    const arr = bucketMap.get(it.bucket);
    if (arr) arr.push(it);
  }

  const buckets: RoadmapStatusPackCalendarBucket[] = bucketOrder.map((k) => ({
    key: k,
    label: CALENDAR_BUCKET_LABELS[k],
    items: bucketMap.get(k) ?? [],
  }));

  if (missingProjects.length > 0) {
    buckets.push({
      key: "missing",
      label: CALENDAR_BUCKET_LABELS.missing,
      items: [],
    });
  }

  const dataStatus: RoadmapStatusPackDataStatus =
    scopedProjects.length === 0
      ? "empty"
      : missingCount === 0
      ? "ok"
      : "partial";

  return {
    referenceDate,
    totalProjects: scopedProjects.length,
    totalItems: items.length,
    upcomingNext30Count: upcoming30,
    upcomingNext90Count: upcoming90,
    overdueCount: overdue,
    behindScheduleCount: behind,
    missingDateProjectsCount: missingCount,
    reportingAvailable,
    buckets,
    missingProjects: missingProjects.sort((a, b) => a.projectName.localeCompare(b.projectName)),
    dataStatus,
  };
}

/* ────────────── Risks & Blockers derivation (Phase 6A.7) ────────────── */


const RISK_SEVERITY_LABEL: Record<RoadmapStatusPackRiskSeverityBucket, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  unknown: "Unknown",
};

const RISK_STATUS_LABEL_FALLBACK: Record<string, string> = {
  open: "Open",
  under_mitigation: "Under mitigation",
  monitoring: "Monitoring",
  realized: "Realized",
  closed: "Closed",
  // legacy back-compat
  identified: "Open",
  mitigating: "Under mitigation",
  accepted: "Monitoring",
};

const BLOCKER_STATUS_LABEL_FALLBACK: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Resolved",
};

const SEVERITY_RANK: Record<RoadmapStatusPackRiskSeverityBucket, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};

function severityBucketFromString(
  value: string | null | undefined,
): RoadmapStatusPackRiskSeverityBucket {
  if (!value) return "unknown";
  const v = String(value).trim().toLowerCase();
  if (v === "critical" || v === "very_high" || v === "severe") return "critical";
  if (v === "high") return "high";
  if (v === "medium" || v === "moderate") return "medium";
  if (v === "low" || v === "minor" || v === "very_low") return "low";
  return "unknown";
}

function combineRiskSeverity(
  impact: string | null | undefined,
  likelihood: string | null | undefined,
): RoadmapStatusPackRiskSeverityBucket {
  const i = severityBucketFromString(impact);
  const l = severityBucketFromString(likelihood);
  if (i === "unknown" && l === "unknown") return "unknown";
  // worst of the two ranks wins; unknown treated as worst-of-other when only one known
  if (i === "unknown") return l;
  if (l === "unknown") return i;
  return SEVERITY_RANK[i] <= SEVERITY_RANK[l] ? i : l;
}

function blockerStatusBucket(
  status: string | null | undefined,
): RoadmapStatusPackBlockerStatusBucket {
  if (!status) return "unknown";
  const v = String(status).trim().toLowerCase();
  if (v === "open") return "open";
  if (v === "in_progress" || v === "in-progress" || v === "active") return "in_progress";
  if (v === "resolved" || v === "closed" || v === "done") return "resolved";
  return "unknown";
}

function titleizeFallback(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function ageDaysFrom(iso: string, now: number): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / MS_PER_DAY));
}

function isActiveRiskBucket(status: string): boolean {
  const v = status.toLowerCase();
  return (
    v === "open" ||
    v === "under_mitigation" ||
    v === "monitoring" ||
    v === "identified" ||
    v === "mitigating"
  );
}

function isRealizedRisk(status: string): boolean {
  return status.toLowerCase() === "realized";
}

function isClosedRisk(status: string): boolean {
  const v = status.toLowerCase();
  return v === "closed";
}

const STALE_DAYS = 30;

export function deriveRoadmapStatusPackRisksBlockers(args: {
  scopedProjects: readonly RoadmapProject[];
  risksByProjectId: ReadonlyMap<string, readonly ProjectRiskRow[]>;
  blockersByProjectId: ReadonlyMap<string, readonly ProjectBlockerRow[]>;
  failedProjectIds: readonly string[];
  isLoading: boolean;
  isError: boolean;
  now?: Date;
  topN?: number;
}): RoadmapStatusPackRisksBlockers {
  const {
    scopedProjects,
    risksByProjectId,
    blockersByProjectId,
    failedProjectIds,
    isLoading,
    isError,
  } = args;
  const nowMs = (args.now ?? new Date()).getTime();
  const topN = args.topN ?? 8;

  const projectsInScope = scopedProjects.length;
  const projectMeta = new Map<
    string,
    { name: string; workspaceName: string; programName: string | null }
  >();
  for (const p of scopedProjects) {
    projectMeta.set(p.id, {
      name: p.name,
      workspaceName: p.workspace_name,
      programName: p.program_name,
    });
  }

  const failedSet = new Set(failedProjectIds);
  let projectsWithData = 0;
  for (const p of scopedProjects) {
    if (failedSet.has(p.id)) continue;
    if (risksByProjectId.has(p.id) || blockersByProjectId.has(p.id)) {
      projectsWithData += 1;
    }
  }

  // Unavailable: aggregate error OR (not loading, scope > 0, nothing resolved).
  const noneResolved = projectsWithData === 0;
  if (isError || (!isLoading && projectsInScope > 0 && noneResolved && failedSet.size > 0)) {
    return {
      available: false,
      partial: false,
      errored: true,
      projectsInScope,
      projectsWithData: 0,
      projectsFailed: failedSet.size,
      totalRisks: 0,
      openRisksCount: 0,
      highCriticalRisksCount: 0,
      realizedRisksCount: 0,
      staleRisksCount: 0,
      topRisks: [],
      totalBlockers: 0,
      openBlockersCount: 0,
      highCriticalBlockersCount: 0,
      staleBlockersCount: 0,
      topBlockers: [],
      dataStatus: "unavailable",
      unavailableReason:
        "Risks & Blockers could not be read for any project in scope. The protected RPC may be temporarily unavailable.",
    };
  }

  // Flatten and project-scope filter risks
  const risks: RoadmapStatusPackRiskItem[] = [];
  let openRisks = 0;
  let highCritRisks = 0;
  let realizedRisks = 0;
  let staleRisks = 0;
  let totalRisks = 0;

  for (const [pid, rows] of risksByProjectId.entries()) {
    const meta = projectMeta.get(pid);
    if (!meta) continue; // outside current scope — never display
    for (const r of rows) {
      totalRisks += 1;
      const severityBucket = combineRiskSeverity(r.impact, r.likelihood);
      const status = String(r.status ?? "").toLowerCase();
      const active = isActiveRiskBucket(status);
      const realized = isRealizedRisk(status);
      const closed = isClosedRisk(status);
      const updatedAt = r.updated_at || r.created_at;
      const age = ageDaysFrom(updatedAt, nowMs);
      const stale = active && age >= STALE_DAYS;
      if (active) openRisks += 1;
      if (realized) realizedRisks += 1;
      if ((active || realized) && (severityBucket === "critical" || severityBucket === "high")) {
        highCritRisks += 1;
      }
      if (stale) staleRisks += 1;

      const statusLabel =
        RISK_STATUS_LABEL_FALLBACK[status] ?? titleizeFallback(r.status || "—");

      risks.push({
        riskId: r.id,
        title: r.title || "(Untitled risk)",
        projectId: pid,
        projectName: meta.name,
        workspaceName: meta.workspaceName,
        programName: meta.programName,
        targetType: r.target_type,
        status,
        statusLabel,
        likelihood: r.likelihood ?? "",
        impact: r.impact ?? "",
        severityBucket,
        severityLabel: RISK_SEVERITY_LABEL[severityBucket],
        mitigationSummary: r.mitigation_plan ?? null,
        description: r.description ?? null,
        createdAt: r.created_at,
        updatedAt,
        ageDays: age,
        isStale: stale,
        isActive: active,
        isRealized: realized,
        isClosed: closed,
      });
    }
  }

  // Flatten and project-scope filter blockers
  const blockers: RoadmapStatusPackBlockerItem[] = [];
  let openBlockers = 0;
  let highCritBlockers = 0;
  let staleBlockers = 0;
  let totalBlockers = 0;

  for (const [pid, rows] of blockersByProjectId.entries()) {
    const meta = projectMeta.get(pid);
    if (!meta) continue;
    for (const b of rows) {
      totalBlockers += 1;
      const statusBucket = blockerStatusBucket(b.status);
      const severityBucket = severityBucketFromString(b.severity);
      const updatedAt = b.updated_at || b.created_at;
      const age = ageDaysFrom(updatedAt, nowMs);
      const isOpen = statusBucket === "open" || statusBucket === "in_progress";
      const isResolved = statusBucket === "resolved";
      const stale = isOpen && age >= STALE_DAYS;
      if (isOpen) openBlockers += 1;
      if (isOpen && (severityBucket === "critical" || severityBucket === "high")) {
        highCritBlockers += 1;
      }
      if (stale) staleBlockers += 1;

      const statusLabel =
        BLOCKER_STATUS_LABEL_FALLBACK[String(b.status ?? "").toLowerCase()] ??
        titleizeFallback(b.status || "—");

      blockers.push({
        blockerId: b.id,
        title: b.title || "(Untitled blocker)",
        projectId: pid,
        projectName: meta.name,
        workspaceName: meta.workspaceName,
        programName: meta.programName,
        targetType: b.target_type,
        status: String(b.status ?? "").toLowerCase(),
        statusLabel,
        statusBucket,
        severity: b.severity ?? "",
        severityBucket,
        severityLabel: RISK_SEVERITY_LABEL[severityBucket],
        descriptionSummary: b.description ?? null,
        createdAt: b.created_at,
        updatedAt,
        resolvedAt: b.resolved_at ?? null,
        ageDays: age,
        isStale: stale,
        isOpen,
        isResolved,
      });
    }
  }

  // Attention-first sort:
  //   risks: severity rank → active first → realized → stale → recently updated
  //   blockers: severity rank → open first → stale → recently updated
  const sortedRisks = risks.slice().sort((a, b) => {
    const sa = SEVERITY_RANK[a.severityBucket];
    const sb = SEVERITY_RANK[b.severityBucket];
    if (sa !== sb) return sa - sb;
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    if (a.isRealized !== b.isRealized) return a.isRealized ? -1 : 1;
    if (a.isStale !== b.isStale) return a.isStale ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  const sortedBlockers = blockers.slice().sort((a, b) => {
    const sa = SEVERITY_RANK[a.severityBucket];
    const sb = SEVERITY_RANK[b.severityBucket];
    if (sa !== sb) return sa - sb;
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
    if (a.isStale !== b.isStale) return a.isStale ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
    return a.title.localeCompare(b.title);
  });

  const partial = failedSet.size > 0 && projectsWithData > 0;
  const dataStatus: RoadmapStatusPackRiskBlockerDataStatus =
    projectsInScope === 0
      ? "empty"
      : partial
      ? "partial"
      : totalRisks === 0 && totalBlockers === 0
      ? "empty"
      : "ok";

  return {
    available: projectsWithData > 0,
    partial,
    errored: false,
    projectsInScope,
    projectsWithData,
    projectsFailed: failedSet.size,
    totalRisks,
    openRisksCount: openRisks,
    highCriticalRisksCount: highCritRisks,
    realizedRisksCount: realizedRisks,
    staleRisksCount: staleRisks,
    topRisks: sortedRisks.slice(0, topN),
    totalBlockers,
    openBlockersCount: openBlockers,
    highCriticalBlockersCount: highCritBlockers,
    staleBlockersCount: staleBlockers,
    topBlockers: sortedBlockers.slice(0, topN),
    dataStatus,
    unavailableReason: null,
  };
}

/* ────────────── Dependencies & Coordination derivation (Phase 6A.8) ────────────── */

const DEPENDENCY_TYPE_LABELS: Record<string, string> = {
  finish_to_start: "Finish → Start",
  start_to_start: "Start → Start",
  finish_to_finish: "Finish → Finish",
  start_to_finish: "Start → Finish",
  blocks: "Blocks",
  related: "Related",
};

function dependencyTypeLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const v = String(value).toLowerCase();
  return DEPENDENCY_TYPE_LABELS[v] ?? titleizeFallback(v);
}

export interface DependencyRowInput {
  id: string;
  source_id: string;
  target_id: string;
  dependency_type: string | null;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

const DIRECTION_RANK: Record<RoadmapStatusPackDependencyDirection, number> = {
  inbound: 0,
  outbound: 1,
  internal: 2,
};

export function deriveRoadmapStatusPackDependencies(args: {
  scopedProjects: readonly RoadmapProject[];
  /** All accessible projects (used only to label out-of-scope but visible endpoints). */
  accessibleProjects: readonly RoadmapProject[];
  rows: readonly DependencyRowInput[];
  reportingByProjectId: ReadonlyMap<string, ProjectReportingSummary>;
  isLoading: boolean;
  isError: boolean;
}): RoadmapStatusPackDependencies {
  const {
    scopedProjects,
    accessibleProjects,
    rows,
    reportingByProjectId,
    isLoading,
    isError,
  } = args;

  const projectsInScope = scopedProjects.length;
  const scopedSet = new Set(scopedProjects.map((p) => p.id));
  const accessibleById = new Map<string, RoadmapProject>();
  for (const p of accessibleProjects) accessibleById.set(p.id, p);

  const coverageNotes: string[] = [
    "Same-level only: project-to-project dependencies. Phase- and task-level dependencies are not surfaced at Roadmap scope in this view.",
  ];

  if (isError) {
    return {
      available: false,
      errored: true,
      projectsInScope,
      totalDependencies: 0,
      projectLevelCount: 0,
      phaseLevelCount: 0,
      taskLevelCount: 0,
      inboundCount: 0,
      outboundCount: 0,
      internalCount: 0,
      attentionCount: 0,
      attentionItems: [],
      inboundItems: [],
      outboundItems: [],
      internalItems: [],
      dataStatus: "unavailable",
      unavailableReason:
        "Project-level dependencies could not be read for the current Roadmap scope.",
      coverageNotes,
    };
  }

  const buildEndpoint = (
    projectId: string,
  ): RoadmapStatusPackDependencyEndpoint => {
    const proj = accessibleById.get(projectId);
    const inScope = scopedSet.has(projectId);
    if (proj) {
      return {
        projectId,
        projectName: proj.name,
        workspaceName: proj.workspace_name,
        programName: proj.program_name,
        inScope,
      };
    }
    return {
      projectId,
      projectName: "External / out of scope",
      workspaceName: null,
      programName: null,
      inScope: false,
    };
  };

  const isProjectAttention = (projectId: string): boolean => {
    if (!scopedSet.has(projectId)) return false;
    const s = reportingByProjectId.get(projectId);
    if (!s) return false;
    return s.health_rag === "red" || s.schedule_signal === "behind_schedule";
  };

  const items: RoadmapStatusPackDependencyItem[] = [];
  for (const r of rows) {
    const sourceInScope = scopedSet.has(r.source_id);
    const targetInScope = scopedSet.has(r.target_id);
    // Defensive: skip rows that touch neither side of the current scope
    // (the protected SELECT should already filter, but we re-verify).
    if (!sourceInScope && !targetInScope) continue;
    const direction: RoadmapStatusPackDependencyDirection =
      sourceInScope && targetInScope
        ? "internal"
        : targetInScope
        ? "inbound"
        : "outbound";

    const affected: string[] = [];
    if (sourceInScope) affected.push(r.source_id);
    if (targetInScope && r.target_id !== r.source_id) affected.push(r.target_id);

    items.push({
      dependencyId: r.id,
      level: "project",
      source: buildEndpoint(r.source_id),
      target: buildEndpoint(r.target_id),
      direction,
      dependencyType: r.dependency_type ?? null,
      dependencyTypeLabel: dependencyTypeLabel(r.dependency_type),
      affectedScopedProjectIds: affected,
      isAttention:
        isProjectAttention(r.source_id) || isProjectAttention(r.target_id),
      description: r.description ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
  }

  const sortFn = (
    a: RoadmapStatusPackDependencyItem,
    b: RoadmapStatusPackDependencyItem,
  ): number => {
    if (a.isAttention !== b.isAttention) return a.isAttention ? -1 : 1;
    const da = DIRECTION_RANK[a.direction];
    const db = DIRECTION_RANK[b.direction];
    if (da !== db) return da - db;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
    return a.source.projectName.localeCompare(b.source.projectName);
  };

  const sorted = items.slice().sort(sortFn);
  const inboundItems = sorted.filter((i) => i.direction === "inbound");
  const outboundItems = sorted.filter((i) => i.direction === "outbound");
  const internalItems = sorted.filter((i) => i.direction === "internal");
  const attentionItems = sorted.filter((i) => i.isAttention);

  const totalDependencies = items.length;
  const dataStatus: RoadmapStatusPackDependencyDataStatus =
    projectsInScope === 0
      ? "empty"
      : totalDependencies === 0
      ? "empty"
      : "ok";

  return {
    available: true,
    errored: false,
    projectsInScope,
    totalDependencies,
    projectLevelCount: totalDependencies,
    phaseLevelCount: 0,
    taskLevelCount: 0,
    inboundCount: inboundItems.length,
    outboundCount: outboundItems.length,
    internalCount: internalItems.length,
    attentionCount: attentionItems.length,
    attentionItems,
    inboundItems,
    outboundItems,
    internalItems,
    dataStatus,
    unavailableReason: null,
    coverageNotes,
  };
}

/* ────────────── KPI deriver (Phase 6A.9) ────────────── */

const KPI_STALE_DAYS = 30;
const KPI_TARGET_EXACT_TOLERANCE = 0.05; // ±5% considered on-target for exact/maintain

interface KpiDefinitionInput {
  id: string;
  name: string;
  unit: string | null;
  target_value: number | null;
  target_direction: string | null;
  current_value: number | null;
  target_type: string;
  target_id: string;
  workspace_id: string;
  updated_at: string;
}

interface KpiUpdateInput {
  kpi_definition_id: string;
  value: number;
  update_date: string;
  author_id: string | null;
  created_at: string;
}

function daysBetween(fromIso: string, nowMs: number): number {
  const t = new Date(fromIso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((nowMs - t) / (1000 * 60 * 60 * 24)));
}

function deriveKpiStatus(
  current: number | null,
  target: number | null,
  direction: string | null,
): RoadmapStatusPackKpiStatus {
  if (target === null || target === undefined) return "no_target";
  if (current === null || current === undefined) return "no_value";
  switch (direction) {
    case "increase":
      return current >= target ? "on_target" : "off_target";
    case "decrease":
      return current <= target ? "on_target" : "off_target";
    case "maintain":
    case "target_exact": {
      if (target === 0) {
        return current === 0 ? "on_target" : "off_target";
      }
      const diffRatio = Math.abs(current - target) / Math.abs(target);
      return diffRatio <= KPI_TARGET_EXACT_TOLERANCE ? "on_target" : "off_target";
    }
    default:
      return "unknown";
  }
}

function deriveKpiTrend(
  latest: number | null,
  previous: number | null,
  direction: string | null,
): RoadmapStatusPackKpiTrend {
  if (latest === null) return "no_history";
  if (previous === null) return "insufficient_history";
  if (latest === previous) return "flat";
  const movedUp = latest > previous;
  switch (direction) {
    case "increase":
      return movedUp ? "improving" : "declining";
    case "decrease":
      return movedUp ? "declining" : "improving";
    case "maintain":
    case "target_exact":
      // Closer-to-target is improving; further-from-target is declining.
      // Without a target reference we cannot judge, so fall back to flat-vs-moved.
      return "flat";
    default:
      return "flat";
  }
}

/**
 * Snapshot calculation_status values that the project KPI surface
 * (`evaluateKpiReadiness` / `formatKpiSnapshotValue`) treats as
 * non-reportable. Mirrored here so the Status Pack stays in lockstep.
 */
const NON_REPORTABLE_SNAPSHOT_STATUS_SET: ReadonlySet<string> = new Set([
  "no_source_data",
  "insufficient_date_basis",
  "not_applicable",
  "error",
]);

/** Subset of snapshot rows the deriver consumes (6A.17, extended in 6A.17a). */

interface KpiSnapshotInput {
  kpi_definition_id: string;
  snapshot_date: string;
  value_amount: number | null;
  value_type: string;
  /**
   * `calculation_status` is required so the deriver can evaluate
   * reportability AFTER selecting the latest snapshot, matching
   * `evaluateKpiReadiness` on the project KPI surface.
   */
  calculation_status: string;
  created_at: string;
}



export function deriveRoadmapStatusPackKpis(args: {
  scopedProjects: readonly RoadmapProject[];
  definitions: readonly KpiDefinitionInput[];
  recentUpdatesByDefinitionId: ReadonlyMap<string, readonly KpiUpdateInput[]>;
  /**
   * 6A.17 — up to two most-recent reportable official snapshots per KPI
   * definition. Sourced from `list_decrypted_kpi_snapshots` (per-project
   * SECURITY DEFINER fan-out), mirroring the project KPI detail surface.
   */
  recentSnapshotsByDefinitionId?: ReadonlyMap<
    string,
    readonly KpiSnapshotInput[]
  >;
  reportingByProjectId: ReadonlyMap<string, ProjectReportingSummary>;
  isLoading: boolean;
  isError: boolean;
  updatesPartial: boolean;
  /** Optional: true when the KPI update-history fetch itself errored. */
  updatesErrored?: boolean;
  /** Optional: true when the KPI update-history fetch hit the preview cap. */
  updatesLimitReached?: boolean;
  /** Optional: true when at least one per-project snapshot fan-out failed. */
  snapshotsPartial?: boolean;
  /** Current time (ms) — pass Date.now() in app; allow injection for tests. */
  now?: number;
}): RoadmapStatusPackKpis {
  const {
    scopedProjects,
    definitions,
    recentUpdatesByDefinitionId,
    reportingByProjectId,
    isError,
    updatesPartial,
  } = args;
  const recentSnapshotsByDefinitionId =
    args.recentSnapshotsByDefinitionId ??
    (new Map() as ReadonlyMap<string, readonly KpiSnapshotInput[]>);
  const updatesErrored = args.updatesErrored ?? false;
  const updatesLimitReached = args.updatesLimitReached ?? false;
  const snapshotsPartial = args.snapshotsPartial ?? false;
  const nowMs = args.now ?? Date.now();

  const projectsInScope = scopedProjects.length;
  const projectById = new Map<string, RoadmapProject>();
  for (const p of scopedProjects) projectById.set(p.id, p);

  const coverageNotes: string[] = [
    "Project-level KPIs only. Program-level KPIs are not surfaced at Roadmap scope in this view.",
    "Current KPI value uses the same precedence as the project KPI detail surface: latest reportable official snapshot, then latest manual update, then the KPI definition's current value.",
  ];
  if (updatesErrored) {
    coverageNotes.push("KPI manual update history could not be fully loaded.");
  } else if (updatesLimitReached) {
    coverageNotes.push(
      "KPI manual update history reached the preview query limit; trend and freshness from manual updates may be incomplete for this scope.",
    );
  } else if (updatesPartial && !snapshotsPartial) {
    coverageNotes.push(
      "Recent KPI manual update history could not be loaded for this scope. Trend and freshness from manual updates may be missing.",
    );
  }
  if (snapshotsPartial) {
    coverageNotes.push(
      "Official KPI snapshots could not be loaded for every project in scope. Latest values may be partial.",
    );
  }

  if (isError) {
    return {
      available: false,
      updatesPartial: false,
      errored: true,
      projectsInScope,
      totalKpis: 0,
      withLatestUpdate: 0,
      missingUpdateHistory: 0,
      staleCount: 0,
      onTargetCount: 0,
      offTargetCount: 0,
      unknownStatusCount: 0,
      attentionItems: [],
      recentlyUpdatedItems: [],
      staleItems: [],
      missingHistoryItems: [],
      allItems: [],
      dataStatus: "unavailable",
      unavailableReason:
        "Project KPIs could not be read for the current Roadmap scope.",
      coverageNotes,
    };
  }

  const items: RoadmapStatusPackKpiItem[] = [];
  for (const def of definitions) {
    const proj = projectById.get(def.target_id);
    if (!proj) continue; // safety: only surface KPIs whose project is in scope
    const updates = recentUpdatesByDefinitionId.get(def.id) ?? [];
    const snapshots = recentSnapshotsByDefinitionId.get(def.id) ?? [];
    const latestSnapshot = snapshots[0] ?? null;
    const previousSnapshot = snapshots[1] ?? null;
    const latestUpdate = updates[0] ?? null;
    const previousUpdate = updates[1] ?? null;
    const hasOfficialSnapshot = latestSnapshot !== null;
    const hasManualUpdateHistory = latestUpdate !== null;

    // 6A.17a — Latest-value precedence mirrors `evaluateKpiReadiness` on
    // the project KPI surface:
    //   1) If a latest official snapshot exists:
    //        a) If it is reportable (status not in non-reportable set AND
    //           value_amount is not null) → use it.
    //        b) Otherwise → expose "latest snapshot not reportable" state.
    //           Do NOT silently fall back to an older snapshot, a manual
    //           update, or kpi_definitions.current_value (the project KPI
    //           surface does not bypass the latest snapshot either).
    //   2) Else if a manual update exists → use latest manual update.
    //   3) Else if kpi_definitions.current_value is set → use it.
    //   4) Else → no value.
    const NON_REPORTABLE_SNAPSHOT_STATUSES = NON_REPORTABLE_SNAPSHOT_STATUS_SET;
    const latestSnapshotCalculationStatus =
      latestSnapshot?.calculation_status ?? null;
    const latestSnapshotReportable =
      !!latestSnapshot &&
      !NON_REPORTABLE_SNAPSHOT_STATUSES.has(latestSnapshot.calculation_status) &&
      latestSnapshot.value_amount !== null &&
      latestSnapshot.value_amount !== undefined;
    const latestSnapshotNonReportable =
      !!latestSnapshot && !latestSnapshotReportable;

    let latestValue: number | null;
    let latestValueDate: string | null;
    let latestValueSource: RoadmapStatusPackKpiValueSource;
    let previousValue: number | null;
    if (latestSnapshot && latestSnapshotReportable) {
      latestValue = latestSnapshot.value_amount;
      latestValueDate = latestSnapshot.snapshot_date;
      latestValueSource = "official_snapshot";
      // Previous trend point: only use the prior snapshot if it is also
      // reportable; otherwise leave previous unset rather than mix
      // reportable and non-reportable values into a trend.
      const previousReportable =
        previousSnapshot &&
        !NON_REPORTABLE_SNAPSHOT_STATUSES.has(
          previousSnapshot.calculation_status,
        ) &&
        previousSnapshot.value_amount !== null &&
        previousSnapshot.value_amount !== undefined;
      previousValue = previousReportable ? previousSnapshot!.value_amount : null;
    } else if (latestSnapshot) {
      // Latest official snapshot exists but is not reportable.
      // Truthful: no current value; surface the snapshot date for context.
      latestValue = null;
      latestValueDate = latestSnapshot.snapshot_date;
      latestValueSource = "official_snapshot_unavailable";
      previousValue = null;
    } else if (latestUpdate) {
      latestValue = latestUpdate.value;
      latestValueDate = latestUpdate.update_date;
      latestValueSource = "manual_update";
      previousValue = previousUpdate ? previousUpdate.value : null;
    } else if (def.current_value !== null && def.current_value !== undefined) {
      latestValue = def.current_value;
      latestValueDate = null;
      latestValueSource = "definition_current_value";
      previousValue = null;
    } else {
      latestValue = null;
      latestValueDate = null;
      latestValueSource = "none";
      previousValue = null;
    }

    const lastUpdateDate = latestValueDate;
    const daysSince = lastUpdateDate
      ? daysBetween(lastUpdateDate, nowMs)
      : null;
    const freshness: RoadmapStatusPackKpiFreshness = lastUpdateDate
      ? daysSince !== null && daysSince > KPI_STALE_DAYS
        ? "stale"
        : "fresh"
      : "no_history";

    // When the latest official snapshot is non-reportable we must NOT
    // fall back to `def.current_value` for status — that would imply a
    // current reading the canonical source has refused to provide.
    const valueForStatus =
      latestValueSource === "official_snapshot_unavailable"
        ? null
        : latestValue ?? def.current_value;
    const status = deriveKpiStatus(
      valueForStatus,
      def.target_value,
      def.target_direction,
    );
    const trend = deriveKpiTrend(
      latestValue,
      previousValue,
      def.target_direction,
    );
    const reporting = reportingByProjectId.get(proj.id);
    const projectAttention =
      !!reporting &&
      (reporting.health_rag === "red" ||
        reporting.schedule_signal === "behind_schedule");

    // Snapshot-only KPIs must NOT be flagged "No history" — an official
    // snapshot is a canonical reading by the same standard the project KPI
    // surface uses. A non-reportable latest snapshot still counts as a
    // visible snapshot here (so this stays false in that case too).
    const missingUpdateHistory =
      !hasOfficialSnapshot && !hasManualUpdateHistory;

    items.push({
      definitionId: def.id,
      name: def.name,
      description: (def as KpiDefinitionInput & { description?: string | null }).description ?? null,
      unit: def.unit,
      targetValue: def.target_value,
      targetDirection: def.target_direction,
      currentValue: def.current_value,
      projectId: proj.id,
      projectName: proj.name,
      workspaceName: proj.workspace_name ?? null,
      programName: proj.program_name ?? null,
      projectAttention,
      lastUpdateDate,
      daysSinceLastUpdate: daysSince,
      freshness,
      latestValue,
      latestValueSource,
      latestValueDate,
      hasOfficialSnapshot,
      latestSnapshotNonReportable,
      latestSnapshotCalculationStatus,
      hasManualUpdateHistory,
      latestUpdateValue: latestValue,
      previousUpdateValue: previousValue,
      status,
      trend,
      missingUpdateHistory,
    });
  }



  const totalKpis = items.length;
  const withLatestUpdate = items.filter((i) => !i.missingUpdateHistory).length;
  const missingUpdateHistory = items.filter((i) => i.missingUpdateHistory).length;
  const staleCount = items.filter((i) => i.freshness === "stale").length;
  const onTargetCount = items.filter((i) => i.status === "on_target").length;
  const offTargetCount = items.filter((i) => i.status === "off_target").length;
  const unknownStatusCount = items.filter(
    (i) =>
      i.status === "no_target" ||
      i.status === "no_value" ||
      i.status === "unknown",
  ).length;

  const attentionRank = (i: RoadmapStatusPackKpiItem): number => {
    let r = 0;
    if (i.status === "off_target") r += 4;
    if (i.freshness === "stale") r += 2;
    if (i.missingUpdateHistory) r += 1;
    if (i.projectAttention) r += 1;
    return r;
  };

  const sortAttentionFirst = (
    a: RoadmapStatusPackKpiItem,
    b: RoadmapStatusPackKpiItem,
  ): number => {
    const ra = attentionRank(a);
    const rb = attentionRank(b);
    if (ra !== rb) return rb - ra;
    if (!!a.lastUpdateDate !== !!b.lastUpdateDate)
      return a.lastUpdateDate ? -1 : 1;
    if (a.lastUpdateDate && b.lastUpdateDate && a.lastUpdateDate !== b.lastUpdateDate) {
      return a.lastUpdateDate > b.lastUpdateDate ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  };

  const allItems = items.slice().sort(sortAttentionFirst);
  const attentionItems = allItems.filter(
    (i) =>
      i.status === "off_target" ||
      i.freshness === "stale" ||
      i.missingUpdateHistory ||
      i.projectAttention,
  );
  const recentlyUpdatedItems = allItems
    .filter((i) => i.lastUpdateDate)
    .slice()
    .sort((a, b) => {
      const ad = a.lastUpdateDate ?? "";
      const bd = b.lastUpdateDate ?? "";
      if (ad !== bd) return ad > bd ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  const staleItems = allItems.filter((i) => i.freshness === "stale");
  const missingHistoryItems = allItems.filter((i) => i.missingUpdateHistory);

  const dataStatus: RoadmapStatusPackKpiDataStatus =
    projectsInScope === 0
      ? "empty"
      : totalKpis === 0
      ? "empty"
      : updatesPartial
      ? "partial"
      : "ok";

  return {
    available: true,
    updatesPartial,
    errored: false,
    projectsInScope,
    totalKpis,
    withLatestUpdate,
    missingUpdateHistory,
    staleCount,
    onTargetCount,
    offTargetCount,
    unknownStatusCount,
    attentionItems,
    recentlyUpdatedItems,
    staleItems,
    missingHistoryItems,
    allItems,
    dataStatus,
    unavailableReason: null,
    coverageNotes,
  };
}

/* ────────────── Governance / Decisions / Asks deriver (Phase 6A.10) ────────────── */

const GOVERNANCE_STALE_DAYS = 60;
const GOVERNANCE_DECISION_RECENT_LIMIT = 6;
const GOVERNANCE_RECORDS_RECENT_LIMIT = 8;
const GOVERNANCE_SUMMARY_MAX = 180;

const GOVERNANCE_EVENT_LABELS: Record<string, string> = {
  steerco: "SteerCo",
  project_team_meeting: "Project Team Meeting",
  sme_review: "SME Review",
  risk_review: "Risk Review",
  kpi_review: "KPI Review",
  sponsor_check_in: "Sponsor Check-in",
  vendor_review: "Vendor Review",
  custom: "Custom",
};

function governanceEventLabel(v: string | null | undefined): string | null {
  if (!v) return null;
  return GOVERNANCE_EVENT_LABELS[v] ?? v;
}

function truncateSummary(s: string | null): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  return trimmed.length > GOVERNANCE_SUMMARY_MAX
    ? trimmed.slice(0, GOVERNANCE_SUMMARY_MAX - 1) + "…"
    : trimmed;
}

interface GovernanceDeriveInputRow {
  id: string;
  project_id: string;
  cadence_event_type: string | null;
  cadence_event_name: string | null;
  event_type: string;
  event_name: string | null;
  actual_date_held: string;
  expected_date_snapshot: string | null;
  summary: string | null;
  decisions_summary: string | null;
  external_reference_url: string | null;
  record_kind: "evidence_record" | "decision_case";
  decision_stage: string | null;
  decision_question: string | null;
  target_decision_date: string | null;
  decision_count: number;
  link_count: number;
  has_sharepoint_evidence: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

function classifyDecisionStatus(
  recordKind: "evidence_record" | "decision_case",
  stage: string | null,
): RoadmapStatusPackGovernanceDecisionStatus {
  if (recordKind !== "decision_case") return "not_applicable";
  switch (stage) {
    case "initiated":
      return "not_started";
    case "evidence_collection":
    case "brief_prepared":
    case "provided_to_stakeholders":
      return "in_progress";
    case "pending_decision":
      return "pending_decision";
    case "decision_taken":
      return "decided";
    case "closed":
      return "closed";
    default:
      return "in_progress";
  }
}

function categoryOf(
  recordKind: "evidence_record" | "decision_case",
  status: RoadmapStatusPackGovernanceDecisionStatus,
): RoadmapStatusPackGovernanceCategory {
  if (recordKind !== "decision_case") return "evidence_record";
  if (status === "decided" || status === "closed") return "decision_made";
  return "decision_required";
}

export function deriveRoadmapStatusPackGovernance(args: {
  scopedProjects: readonly RoadmapProject[];
  rowsByProjectId: ReadonlyMap<string, readonly GovernanceDeriveInputRow[]>;
  reportingByProjectId: ReadonlyMap<string, ProjectReportingSummary>;
  failedProjectIds: readonly string[];
  isLoading: boolean;
  isError: boolean;
  now?: number;
}): RoadmapStatusPackGovernance {
  const {
    scopedProjects,
    rowsByProjectId,
    reportingByProjectId,
    failedProjectIds,
    isError,
  } = args;
  const nowMs = args.now ?? Date.now();
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);
  const projectsInScope = scopedProjects.length;
  const projectsFailed = failedProjectIds.length;

  const coverageNotes: string[] = [
    "Decisions and general governance records derive from canonical BTPM governance records.",
    'There is no separate "ask" object in the current model — open asks are not separately classified yet. Decision-classified records are surfaced under Decisions Required.',
    "Per-project authorized read (list_project_governance_records); no roadmap-level aggregate resolver is used in this step.",
  ];

  if (isError) {
    return {
      available: false,
      partial: false,
      errored: true,
      projectsInScope,
      projectsWithData: 0,
      projectsFailed,
      totalRecords: 0,
      decisionCasesCount: 0,
      decisionsRequiredCount: 0,
      decisionsMadeCount: 0,
      evidenceRecordsCount: 0,
      overdueCount: 0,
      staleCount: 0,
      decisionsRequired: [],
      recentDecisions: [],
      recentGovernanceRecords: [],
      overdueOrStaleItems: [],
      otherRecords: [],
      dataStatus: "unavailable",
      unavailableReason:
        "Governance records could not be read for the current Roadmap scope.",
      coverageNotes,
    };
  }

  const projectById = new Map<string, RoadmapProject>();
  for (const p of scopedProjects) projectById.set(p.id, p);

  const items: RoadmapStatusPackGovernanceItem[] = [];
  let projectsWithData = 0;

  for (const p of scopedProjects) {
    const rows = rowsByProjectId.get(p.id);
    if (!rows) continue;
    projectsWithData += 1;
    const reporting = reportingByProjectId.get(p.id);
    const projectAttention =
      !!reporting &&
      (reporting.health_rag === "red" ||
        reporting.schedule_signal === "behind_schedule");

    for (const r of rows) {
      if (r.archived_at) continue;
      const status = classifyDecisionStatus(r.record_kind, r.decision_stage);
      const category = categoryOf(r.record_kind, status);
      const overdue =
        r.record_kind === "decision_case" &&
        !!r.target_decision_date &&
        r.target_decision_date < todayIso &&
        status !== "decided" &&
        status !== "closed";
      const ageMs = nowMs - new Date(r.updated_at).getTime();
      const stale =
        !Number.isNaN(ageMs) &&
        ageMs > GOVERNANCE_STALE_DAYS * 24 * 60 * 60 * 1000 &&
        status !== "decided" &&
        status !== "closed";
      const title =
        (r.event_name && r.event_name.trim()) ||
        (r.cadence_event_name && r.cadence_event_name.trim()) ||
        governanceEventLabel(r.event_type) ||
        "Governance record";

      items.push({
        recordId: r.id,
        projectId: p.id,
        projectName: p.name,
        workspaceName: p.workspace_name ?? null,
        programName: p.program_name ?? null,
        recordKind: r.record_kind,
        category,
        title: title.length > 100 ? title.slice(0, 99) + "…" : title,
        eventType: r.event_type,
        cadenceEventTypeLabel: governanceEventLabel(r.cadence_event_type),
        cadenceEventName: r.cadence_event_name,
        summary: truncateSummary(r.summary),
        decisionQuestion: truncateSummary(r.decision_question),
        decisionStage: r.decision_stage,
        decisionStatus: status,
        decisionCount: r.decision_count,
        linkCount: r.link_count,
        hasSharepointEvidence: r.has_sharepoint_evidence,
        actualDateHeld: r.actual_date_held,
        targetDecisionDate: r.target_decision_date,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        isOverdue: overdue,
        isStale: stale,
        projectAttention,
      });
    }
  }

  const totalRecords = items.length;
  const decisionCases = items.filter((i) => i.recordKind === "decision_case");
  const decisionsRequiredAll = decisionCases.filter(
    (i) => i.category === "decision_required",
  );
  const decisionsMadeAll = decisionCases.filter(
    (i) => i.category === "decision_made",
  );
  const evidenceRecords = items.filter(
    (i) => i.recordKind === "evidence_record",
  );

  const sortAttentionFirst = (
    a: RoadmapStatusPackGovernanceItem,
    b: RoadmapStatusPackGovernanceItem,
  ): number => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    if (a.projectAttention !== b.projectAttention)
      return a.projectAttention ? -1 : 1;
    if (a.isStale !== b.isStale) return a.isStale ? -1 : 1;
    // Earlier target decision date first (for decisions required), else most recent updated.
    if (a.targetDecisionDate && b.targetDecisionDate) {
      if (a.targetDecisionDate !== b.targetDecisionDate) {
        return a.targetDecisionDate < b.targetDecisionDate ? -1 : 1;
      }
    } else if (a.targetDecisionDate || b.targetDecisionDate) {
      return a.targetDecisionDate ? -1 : 1;
    }
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
    return a.projectName.localeCompare(b.projectName);
  };

  const sortRecent = (
    a: RoadmapStatusPackGovernanceItem,
    b: RoadmapStatusPackGovernanceItem,
  ): number => {
    if (a.actualDateHeld !== b.actualDateHeld) {
      return a.actualDateHeld > b.actualDateHeld ? -1 : 1;
    }
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
    return a.projectName.localeCompare(b.projectName);
  };

  const decisionsRequired = decisionsRequiredAll.slice().sort(sortAttentionFirst);
  const recentDecisions = decisionsMadeAll.slice().sort(sortRecent);
  const recentGovernanceRecords = evidenceRecords.slice().sort(sortRecent);
  const overdueOrStaleItems = items
    .filter((i) => i.isOverdue || i.isStale)
    .slice()
    .sort(sortAttentionFirst);
  // "Other records": evidence rows beyond the recent slice, kept for completeness.
  const otherRecords = recentGovernanceRecords.slice(
    GOVERNANCE_RECORDS_RECENT_LIMIT,
  );

  const overdueCount = items.filter((i) => i.isOverdue).length;
  const staleCount = items.filter((i) => i.isStale).length;

  const partial = projectsFailed > 0;
  if (partial) {
    coverageNotes.push(
      `Governance data could not be loaded for ${projectsFailed} project(s) in scope. Counts below reflect the authorized, available subset only.`,
    );
  }

  const dataStatus: RoadmapStatusPackGovernanceDataStatus =
    projectsInScope === 0
      ? "empty"
      : projectsWithData === 0
      ? "unavailable"
      : partial
      ? "partial"
      : totalRecords === 0
      ? "empty"
      : "ok";

  return {
    available: projectsWithData > 0,
    partial,
    errored: false,
    projectsInScope,
    projectsWithData,
    projectsFailed,
    totalRecords,
    decisionCasesCount: decisionCases.length,
    decisionsRequiredCount: decisionsRequiredAll.length,
    decisionsMadeCount: decisionsMadeAll.length,
    evidenceRecordsCount: evidenceRecords.length,
    overdueCount,
    staleCount,
    decisionsRequired,
    recentDecisions: recentDecisions.slice(0, GOVERNANCE_DECISION_RECENT_LIMIT),
    recentGovernanceRecords: recentGovernanceRecords.slice(
      0,
      GOVERNANCE_RECORDS_RECENT_LIMIT,
    ),
    overdueOrStaleItems,
    otherRecords,
    dataStatus,
    unavailableReason:
      dataStatus === "unavailable"
        ? "Governance records could not be read for any project in the current Roadmap scope."
        : null,
    coverageNotes,
  };
}

/* ────────────── Progress Since Last Period (Phase 6A.11) ────────────── */

/**
 * Minimal input shape — mirrors `ProjectActivityEvent`. Kept local so the
 * pure helper does not depend on hook code.
 */
export interface RoadmapProgressActivityEventInput {
  id: string;
  event_type: string;
  target_type: string;
  target_id: string;
  actor_id: string | null;
  created_at: string;
}

const PROGRESS_DEFAULT_LOOKBACK_DAYS = 7;
const PROGRESS_LIST_LIMIT = 25;

/**
 * Bucket a canonical event_type into a presentation category. Uses ONLY the
 * explicit event-type prefixes already defined by BTPM activity events — no
 * narrative-text inference.
 */
export function classifyRoadmapProgressEventType(
  eventType: string,
): {
  category: RoadmapStatusPackProgressCategory;
  important: boolean;
} {
  const t = eventType.toLowerCase();

  // Completed / delivered — explicit terminal state events.
  if (
    t === "task_completed" ||
    t === "phase_completed" ||
    t === "project_completed" ||
    t === "task_closed" ||
    t === "phase_closed" ||
    t === "project_closed"
  ) {
    return { category: "completed_delivered", important: true };
  }

  // Schedule movements — explicit schedule/plan events only.
  if (
    t === "schedule_changed" ||
    t === "phase_plan_moved" ||
    t === "phase_remaining_work_shifted" ||
    t === "phase_resized" ||
    t === "parent_extended_for_child_edit" ||
    t.startsWith("baseline_")
  ) {
    return { category: "schedule_movement", important: true };
  }

  // Governance / decision events.
  if (t.startsWith("governance_")) {
    return { category: "governance_decision", important: true };
  }

  // Risk / blocker / KPI movements.
  if (
    t.startsWith("risk_") ||
    t.startsWith("blocker_") ||
    t.startsWith("kpi_")
  ) {
    return { category: "risk_blocker_kpi", important: false };
  }

  // Ownership / assignment / metadata edits.
  if (
    t === "task_assignee_changed" ||
    t === "raci_assignment_added" ||
    t === "raci_assignment_removed" ||
    t.endsWith("_metadata_updated") ||
    t === "task_moved" ||
    t.startsWith("stakeholder_")
  ) {
    return { category: "ownership_metadata", important: false };
  }

  // Lifecycle / stage transitions.
  if (
    t === "project_stage_transitioned" ||
    t === "status_changed" ||
    t === "project_status_changed" ||
    t.startsWith("lifecycle.") ||
    t.endsWith("_archived") ||
    t.endsWith("_unarchived") ||
    t.endsWith("_restored") ||
    t === "task_reopened"
  ) {
    return { category: "lifecycle_stage", important: false };
  }

  return { category: "other", important: false };
}

export function deriveRoadmapStatusPackProgressSinceLast(args: {
  scopedProjects: readonly RoadmapProject[];
  rowsByProjectId: ReadonlyMap<
    string,
    readonly RoadmapProgressActivityEventInput[]
  >;
  failedProjectIds: readonly string[];
  isError: boolean;
  lookbackDays?: number;
  now?: number;
}): RoadmapStatusPackProgressSinceLast {
  const {
    scopedProjects,
    rowsByProjectId,
    failedProjectIds,
    isError,
  } = args;
  const lookbackDays = args.lookbackDays ?? PROGRESS_DEFAULT_LOOKBACK_DAYS;
  const nowMs = args.now ?? Date.now();
  const endIso = new Date(nowMs).toISOString();
  const startMs = nowMs - lookbackDays * 24 * 60 * 60 * 1000;
  const startIso = new Date(startMs).toISOString();
  const period: RoadmapStatusPackProgressPeriod = {
    label: `Last ${lookbackDays} days`,
    startIso,
    endIso,
    lookbackDays,
    isDefaultLookback: true,
  };

  const projectsInScope = scopedProjects.length;
  const projectsFailed = failedProjectIds.length;
  const executionUpdatesNote =
    "Execution updates are not separately surfaced in this view yet — no authorized Roadmap-level aggregate read path exists. They remain visible on each project's Execution surface.";

  const coverageNotes: string[] = [
    "Progress derives from canonical BTPM activity events (project tree: project, phases, tasks, blockers, risks, KPIs).",
    "Period is a fixed default lookback. Saved presentation views do not exist yet, so this is NOT a comparison against a previously generated pack.",
    "Per-project authorized read (list_project_activity_events); no roadmap-level aggregate resolver is used.",
    executionUpdatesNote,
  ];

  if (isError) {
    return {
      period,
      available: false,
      partial: false,
      errored: true,
      projectsInScope,
      projectsWithData: 0,
      projectsFailed,
      totalEventsInPeriod: 0,
      completedDeliveredCount: 0,
      scheduleMovementCount: 0,
      governanceDecisionCount: 0,
      riskBlockerKpiCount: 0,
      ownershipMetadataCount: 0,
      lifecycleStageCount: 0,
      otherCount: 0,
      completedDelivered: [],
      scheduleMovements: [],
      governanceDecisionUpdates: [],
      riskBlockerKpiChanges: [],
      otherRecentActivity: [],
      executionUpdatesAvailable: false,
      executionUpdatesNote,
      dataStatus: "unavailable",
      unavailableReason:
        "Progress activity could not be read for the current Roadmap scope.",
      coverageNotes,
    };
  }

  const items: RoadmapStatusPackProgressItem[] = [];
  let projectsWithData = 0;

  for (const p of scopedProjects) {
    const rows = rowsByProjectId.get(p.id);
    if (!rows) continue;
    projectsWithData += 1;
    for (const r of rows) {
      const occurredMs = new Date(r.created_at).getTime();
      if (Number.isNaN(occurredMs)) continue;
      if (occurredMs < startMs || occurredMs > nowMs) continue;
      const { category, important } = classifyRoadmapProgressEventType(
        r.event_type,
      );
      items.push({
        eventId: r.id,
        sourceType: "activity_event",
        projectId: p.id,
        projectName: p.name,
        workspaceName: p.workspace_name ?? null,
        programName: p.program_name ?? null,
        targetType: r.target_type,
        targetId: r.target_id,
        eventType: r.event_type,
        category,
        important,
        occurredAt: r.created_at,
        actorId: r.actor_id,
      });
    }
  }

  // Attention-first ordering rule shared by all sub-lists.
  const categoryRank: Record<RoadmapStatusPackProgressCategory, number> = {
    completed_delivered: 1,
    schedule_movement: 2,
    governance_decision: 3,
    risk_blocker_kpi: 4,
    lifecycle_stage: 5,
    ownership_metadata: 6,
    other: 7,
  };
  const sortAttentionFirst = (
    a: RoadmapStatusPackProgressItem,
    b: RoadmapStatusPackProgressItem,
  ): number => {
    if (a.important !== b.important) return a.important ? -1 : 1;
    const ca = categoryRank[a.category];
    const cb = categoryRank[b.category];
    if (ca !== cb) return ca - cb;
    if (a.occurredAt !== b.occurredAt)
      return a.occurredAt > b.occurredAt ? -1 : 1;
    return a.projectName.localeCompare(b.projectName);
  };

  const filterCat = (c: RoadmapStatusPackProgressCategory) =>
    items.filter((i) => i.category === c).sort(sortAttentionFirst);

  const completedDelivered = filterCat("completed_delivered");
  const scheduleMovements = filterCat("schedule_movement");
  const governanceDecisionUpdates = filterCat("governance_decision");
  const riskBlockerKpiChanges = filterCat("risk_blocker_kpi");
  // Other: everything not surfaced in a dedicated list above.
  const otherRecentActivity = items
    .filter(
      (i) =>
        i.category === "lifecycle_stage" ||
        i.category === "ownership_metadata" ||
        i.category === "other",
    )
    .sort(sortAttentionFirst);

  const partial = projectsFailed > 0;
  if (partial) {
    coverageNotes.push(
      `Progress activity could not be loaded for ${projectsFailed} project(s) in scope. Counts below reflect the authorized, available subset only.`,
    );
  }

  const totalEventsInPeriod = items.length;
  const dataStatus: RoadmapStatusPackProgressDataStatus =
    projectsInScope === 0
      ? "empty"
      : projectsWithData === 0
      ? "unavailable"
      : partial
      ? "partial"
      : totalEventsInPeriod === 0
      ? "empty"
      : "ok";

  return {
    period,
    available: projectsWithData > 0,
    partial,
    errored: false,
    projectsInScope,
    projectsWithData,
    projectsFailed,
    totalEventsInPeriod,
    completedDeliveredCount: completedDelivered.length,
    scheduleMovementCount: scheduleMovements.length,
    governanceDecisionCount: governanceDecisionUpdates.length,
    riskBlockerKpiCount: riskBlockerKpiChanges.length,
    ownershipMetadataCount: items.filter(
      (i) => i.category === "ownership_metadata",
    ).length,
    lifecycleStageCount: items.filter((i) => i.category === "lifecycle_stage")
      .length,
    otherCount: items.filter((i) => i.category === "other").length,
    completedDelivered: completedDelivered.slice(0, PROGRESS_LIST_LIMIT),
    scheduleMovements: scheduleMovements.slice(0, PROGRESS_LIST_LIMIT),
    governanceDecisionUpdates: governanceDecisionUpdates.slice(
      0,
      PROGRESS_LIST_LIMIT,
    ),
    riskBlockerKpiChanges: riskBlockerKpiChanges.slice(0, PROGRESS_LIST_LIMIT),
    otherRecentActivity: otherRecentActivity.slice(0, PROGRESS_LIST_LIMIT),
    executionUpdatesAvailable: false,
    executionUpdatesNote,
    dataStatus,
    unavailableReason:
      dataStatus === "unavailable"
        ? "Progress activity could not be read for any project in the current Roadmap scope."
        : null,
    coverageNotes,
  };
}

/* ────────────── Team Work Summary (Phase 6A.12) ────────────── */

export type RoadmapStatusPackTeamWorkDataStatus =
  | "ok"
  | "partial"
  | "empty"
  | "unavailable";

export type RoadmapStatusPackTeamWorkPriorityBucket =
  | "high"
  | "medium"
  | "low"
  | "unset";

export type RoadmapStatusPackTeamWorkReasonFlag =
  | "overdue"
  | "due_today"
  | "due_soon"
  | "blocked"
  | "unassigned"
  | "high_priority"
  | "unestimated";

/**
 * Minimal input shape mirroring `TeamWorkItem`. Kept local so the pure
 * helper does not depend on hook code.
 *
 * TAE.10 — extended with optional Requester/Executor stakeholder refs (already
 * resolved by `get_team_work_overview`). Fields are IDs + display context only:
 * NO email, NO user_id, NO organization_id, NO workspace_id.
 */
export interface RoadmapStatusPackStakeholderRefInput {
  id: string;
  display_name: string;
  stakeholder_type: string | null;
  role_label: string | null;
  is_removed: boolean | null;
}

export interface RoadmapTeamWorkItemInput {
  task_id: string;
  task_name: string | null;
  task_status: string;
  task_priority: string | null;
  start_date: string | null;
  due_date: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  phase_id: string | null;
  phase_name: string | null;
  project_id: string;
  project_name: string | null;
  workspace_id: string;
  workspace_name: string | null;
  program_id: string | null;
  program_name: string | null;
  is_overdue: boolean;
  is_due_today: boolean;
  is_upcoming: boolean;
  is_blocked: boolean;
  is_unassigned: boolean;
  is_high_priority: boolean;
  is_unestimated: boolean;
  days_overdue: number;
  days_until_due: number | null;
  open_blocker_count: number;
  /** TAE.10 — optional; older callers may omit. */
  requested_by_stakeholder?: RoadmapStatusPackStakeholderRefInput | null;
  /** TAE.10 — optional; older callers may omit. */
  executed_by_stakeholders?: readonly RoadmapStatusPackStakeholderRefInput[] | null;
}

export interface RoadmapTeamWorkOverviewInput {
  items: readonly RoadmapTeamWorkItemInput[];
  summary?: {
    total_open?: number;
    overdue?: number;
    due_today?: number;
    upcoming?: number;
    blocked?: number;
    unassigned?: number;
    high_priority_open?: number;
    unestimated?: number;
    estimated_open_hours?: number;
  } | null;
}

/**
 * TAE.10 — Normalize a single Stakeholder ref for Status Pack detail rows.
 * Returns `null` when the id is missing so callers can fail closed.
 */
function normalizeStatusPackStakeholderRef(
  ref: RoadmapStatusPackStakeholderRefInput | null | undefined,
): RoadmapStatusPackStakeholderRefInput | null {
  if (!ref || typeof ref.id !== "string" || ref.id.length === 0) return null;
  const displayName =
    typeof ref.display_name === "string" && ref.display_name.length > 0
      ? ref.display_name
      : "Stakeholder";
  return {
    id: ref.id,
    display_name: displayName,
    stakeholder_type:
      typeof ref.stakeholder_type === "string" ? ref.stakeholder_type : null,
    role_label:
      typeof ref.role_label === "string" && ref.role_label.length > 0
        ? ref.role_label
        : null,
    is_removed: ref.is_removed === true ? true : ref.is_removed === false ? false : null,
  };
}

/**
 * TAE.10 — Normalize + stably sort the Executors list for a Task.
 */
function normalizeStatusPackExecutedByList(
  refs: readonly RoadmapStatusPackStakeholderRefInput[] | null | undefined,
): readonly RoadmapStatusPackStakeholderRefInput[] {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const seen = new Set<string>();
  const out: RoadmapStatusPackStakeholderRefInput[] = [];
  for (const ref of refs) {
    const norm = normalizeStatusPackStakeholderRef(ref);
    if (!norm) continue;
    if (seen.has(norm.id)) continue;
    seen.add(norm.id);
    out.push(norm);
  }
  out.sort((a, b) => {
    const an = a.display_name.toLocaleLowerCase();
    const bn = b.display_name.toLocaleLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}


export interface RoadmapStatusPackTeamWorkItem {
  taskId: string;
  taskName: string;
  taskStatus: string;
  priorityBucket: RoadmapStatusPackTeamWorkPriorityBucket;
  rawPriority: string | null;
  projectId: string;
  projectName: string;
  workspaceName: string | null;
  programName: string | null;
  phaseName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  daysOverdue: number;
  daysUntilDue: number | null;
  isOverdue: boolean;
  isDueToday: boolean;
  isDueSoon: boolean;
  isBlocked: boolean;
  isUnassigned: boolean;
  isHighPriority: boolean;
  openBlockerCount: number;
  reasonFlags: readonly RoadmapStatusPackTeamWorkReasonFlag[];
  /**
   * TAE.10 — resolved Requester for this Task. `null` when unset. IDs +
   * display context only; no email/user_id/organization_id/workspace_id.
   */
  requestedByStakeholder: RoadmapStatusPackStakeholderRefInput | null;
  /**
   * TAE.10 — resolved Executors for this Task. Empty array when unset.
   * Ordered by resolved `display_name` (case-insensitive), then Stakeholder
   * `id` as a stable tie-breaker.
   */
  executedByStakeholders: readonly RoadmapStatusPackStakeholderRefInput[];
}

export interface RoadmapStatusPackTeamWorkOwnerSummary {
  assigneeId: string | null;
  assigneeName: string;
  openTasks: number;
  overdueTasks: number;
  dueSoonTasks: number;
  blockedTasks: number;
  highPriorityTasks: number;
}

export interface RoadmapStatusPackTeamWorkSummary {
  available: boolean;
  partial: boolean;
  errored: boolean;
  projectsInScope: number;
  projectsWithData: number;
  projectsFailed: number;

  /** Default non-persistent "due soon" window (days from today). */
  dueSoonWindowDays: number;

  // Aggregate counters (derived from authorized rows only).
  totalOpen: number;
  overdueCount: number;
  dueTodayCount: number;
  dueSoonCount: number;
  highPriorityCount: number;
  unassignedCount: number;
  blockedCount: number;
  unestimatedCount: number;
  estimatedOpenHours: number;
  ownersRepresented: number;

  // Presentation lists (attention-first; capped).
  overdueWork: readonly RoadmapStatusPackTeamWorkItem[];
  dueSoonWork: readonly RoadmapStatusPackTeamWorkItem[];
  highPriorityOpenWork: readonly RoadmapStatusPackTeamWorkItem[];
  unassignedWork: readonly RoadmapStatusPackTeamWorkItem[];
  ownerWorkload: readonly RoadmapStatusPackTeamWorkOwnerSummary[];

  dataStatus: RoadmapStatusPackTeamWorkDataStatus;
  unavailableReason: string | null;
  coverageNotes: readonly string[];
  /**
   * Honest disclosure: recently-completed work is NOT surfaced in this
   * summary. The authorized read path returns `completed_in_window`
   * scoped to the requested time window; this section uses `all_open`.
   */
  recentlyCompletedAvailable: false;
  recentlyCompletedNote: string;
}

const TEAM_WORK_LIST_LIMIT = 25;
const TEAM_WORK_DUE_SOON_DAYS = 7;

function teamWorkPriorityBucket(
  raw: string | null,
): RoadmapStatusPackTeamWorkPriorityBucket {
  if (!raw) return "unset";
  const v = raw.toLowerCase().trim();
  if (v === "high" || v === "critical" || v === "urgent" || v === "p0" || v === "p1") {
    return "high";
  }
  if (v === "medium" || v === "med" || v === "normal" || v === "p2") return "medium";
  if (v === "low" || v === "p3" || v === "p4") return "low";
  return "unset";
}

function teamWorkReasonFlags(
  item: RoadmapTeamWorkItemInput,
  isDueSoon: boolean,
): RoadmapStatusPackTeamWorkReasonFlag[] {
  const flags: RoadmapStatusPackTeamWorkReasonFlag[] = [];
  if (item.is_overdue) flags.push("overdue");
  if (item.is_due_today) flags.push("due_today");
  if (isDueSoon && !item.is_overdue && !item.is_due_today) flags.push("due_soon");
  if (item.is_blocked) flags.push("blocked");
  if (item.is_unassigned) flags.push("unassigned");
  if (item.is_high_priority) flags.push("high_priority");
  if (item.is_unestimated) flags.push("unestimated");
  return flags;
}

export function deriveRoadmapStatusPackTeamWorkSummary(args: {
  scopedProjects: readonly RoadmapProject[];
  overviewByProjectId: ReadonlyMap<string, RoadmapTeamWorkOverviewInput>;
  failedProjectIds: readonly string[];
  isError: boolean;
  dueSoonWindowDays?: number;
}): RoadmapStatusPackTeamWorkSummary {
  const {
    scopedProjects,
    overviewByProjectId,
    failedProjectIds,
    isError,
  } = args;
  const dueSoonWindowDays = args.dueSoonWindowDays ?? TEAM_WORK_DUE_SOON_DAYS;

  const projectsInScope = scopedProjects.length;
  const projectsFailed = failedProjectIds.length;
  const recentlyCompletedNote =
    "Recently completed work is not separately surfaced in this summary view — the authorized Team Work read path scopes completion counts to a single time window. Completion activity remains visible on each project's surface and in 'Progress Since Last Period'.";

  const coverageNotes: string[] = [
    "Team Work derives from canonical BTPM project / phase / task / assignment / blocker data via the authorized Team Work overview RPC.",
    "Open work only: items returned with `time_window=all_open`, completed items excluded. Counts and rows reflect what the current user is authorized to see.",
    `Due-soon window is a fixed default (${dueSoonWindowDays} days). Saved presentation views do not exist yet.`,
    recentlyCompletedNote,
  ];

  if (isError) {
    return {
      available: false,
      partial: false,
      errored: true,
      projectsInScope,
      projectsWithData: 0,
      projectsFailed,
      dueSoonWindowDays,
      totalOpen: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      dueSoonCount: 0,
      highPriorityCount: 0,
      unassignedCount: 0,
      blockedCount: 0,
      unestimatedCount: 0,
      estimatedOpenHours: 0,
      ownersRepresented: 0,
      overdueWork: [],
      dueSoonWork: [],
      highPriorityOpenWork: [],
      unassignedWork: [],
      ownerWorkload: [],
      dataStatus: "unavailable",
      unavailableReason:
        "Team Work could not be read for the current Roadmap scope.",
      coverageNotes,
      recentlyCompletedAvailable: false,
      recentlyCompletedNote,
    };
  }

  const items: RoadmapStatusPackTeamWorkItem[] = [];
  let totalOpen = 0;
  let overdueCount = 0;
  let dueTodayCount = 0;
  let dueSoonCount = 0;
  let highPriorityCount = 0;
  let unassignedCount = 0;
  let blockedCount = 0;
  let unestimatedCount = 0;
  let estimatedOpenHours = 0;
  let projectsWithData = 0;
  const ownerMap = new Map<string, RoadmapStatusPackTeamWorkOwnerSummary>();

  for (const p of scopedProjects) {
    const ov = overviewByProjectId.get(p.id);
    if (!ov) continue;
    projectsWithData += 1;
    const s = ov.summary ?? null;
    if (s) {
      totalOpen += s.total_open ?? 0;
      overdueCount += s.overdue ?? 0;
      dueTodayCount += s.due_today ?? 0;
      highPriorityCount += s.high_priority_open ?? 0;
      unassignedCount += s.unassigned ?? 0;
      blockedCount += s.blocked ?? 0;
      unestimatedCount += s.unestimated ?? 0;
      estimatedOpenHours += s.estimated_open_hours ?? 0;
    }

    for (const r of ov.items) {
      const isDueSoon =
        !r.is_overdue &&
        !r.is_due_today &&
        r.days_until_due !== null &&
        r.days_until_due >= 0 &&
        r.days_until_due <= dueSoonWindowDays;
      if (isDueSoon) dueSoonCount += 1;

      const flags = teamWorkReasonFlags(r, isDueSoon);

      const projectName = r.project_name ?? p.name ?? "Unnamed project";
      const ownerKey = r.assignee_id ?? "__unassigned__";
      const ownerName =
        r.assignee_name ??
        (r.is_unassigned || !r.assignee_id ? "Unassigned" : "Unknown owner");
      let bucket = ownerMap.get(ownerKey);
      if (!bucket) {
        bucket = {
          assigneeId: r.assignee_id,
          assigneeName: ownerName,
          openTasks: 0,
          overdueTasks: 0,
          dueSoonTasks: 0,
          blockedTasks: 0,
          highPriorityTasks: 0,
        };
        ownerMap.set(ownerKey, bucket);
      }
      bucket.openTasks += 1;
      if (r.is_overdue) bucket.overdueTasks += 1;
      if (isDueSoon) bucket.dueSoonTasks += 1;
      if (r.is_blocked) bucket.blockedTasks += 1;
      if (r.is_high_priority) bucket.highPriorityTasks += 1;

      items.push({
        taskId: r.task_id,
        taskName: r.task_name ?? "Untitled task",
        taskStatus: r.task_status,
        priorityBucket: teamWorkPriorityBucket(r.task_priority),
        rawPriority: r.task_priority,
        projectId: r.project_id,
        projectName,
        workspaceName: r.workspace_name ?? null,
        programName: r.program_name ?? null,
        phaseName: r.phase_name ?? null,
        assigneeId: r.assignee_id,
        assigneeName: r.assignee_name,
        dueDate: r.due_date,
        daysOverdue: r.days_overdue,
        daysUntilDue: r.days_until_due,
        isOverdue: r.is_overdue,
        isDueToday: r.is_due_today,
        isDueSoon,
        isBlocked: r.is_blocked,
        isUnassigned: r.is_unassigned,
        isHighPriority: r.is_high_priority,
        openBlockerCount: r.open_blocker_count,
        reasonFlags: flags,
        requestedByStakeholder: normalizeStatusPackStakeholderRef(
          r.requested_by_stakeholder ?? null,
        ),
        executedByStakeholders: normalizeStatusPackExecutedByList(
          r.executed_by_stakeholders ?? null,
        ),
      });
    }
  }

  // Attention-first ordering for sub-lists.
  const sortAttention = (
    a: RoadmapStatusPackTeamWorkItem,
    b: RoadmapStatusPackTeamWorkItem,
  ): number => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    if (a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue;
    if (a.isDueToday !== b.isDueToday) return a.isDueToday ? -1 : 1;
    if (a.isHighPriority !== b.isHighPriority) return a.isHighPriority ? -1 : 1;
    if (a.isBlocked !== b.isBlocked) return a.isBlocked ? -1 : 1;
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? -1 : 1;
    const ad = a.daysUntilDue ?? Number.POSITIVE_INFINITY;
    const bd = b.daysUntilDue ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    return a.projectName.localeCompare(b.projectName);
  };

  const overdueWork = items
    .filter((i) => i.isOverdue)
    .slice()
    .sort(sortAttention)
    .slice(0, TEAM_WORK_LIST_LIMIT);
  const dueSoonWork = items
    .filter((i) => i.isDueToday || i.isDueSoon)
    .slice()
    .sort(sortAttention)
    .slice(0, TEAM_WORK_LIST_LIMIT);
  const highPriorityOpenWork = items
    .filter((i) => i.isHighPriority)
    .slice()
    .sort(sortAttention)
    .slice(0, TEAM_WORK_LIST_LIMIT);
  const unassignedWork = items
    .filter((i) => i.isUnassigned)
    .slice()
    .sort(sortAttention)
    .slice(0, TEAM_WORK_LIST_LIMIT);

  const ownerWorkload = Array.from(ownerMap.values())
    .slice()
    .sort((a, b) => {
      if (b.overdueTasks !== a.overdueTasks) return b.overdueTasks - a.overdueTasks;
      if (b.dueSoonTasks !== a.dueSoonTasks) return b.dueSoonTasks - a.dueSoonTasks;
      if (b.openTasks !== a.openTasks) return b.openTasks - a.openTasks;
      return a.assigneeName.localeCompare(b.assigneeName);
    })
    .slice(0, TEAM_WORK_LIST_LIMIT);

  const ownersRepresented = Array.from(ownerMap.keys()).filter(
    (k) => k !== "__unassigned__",
  ).length;

  const partial = projectsFailed > 0;
  if (partial) {
    coverageNotes.push(
      `Team Work could not be loaded for ${projectsFailed} project(s) in scope. Counts below reflect the authorized, available subset only.`,
    );
  }

  const dataStatus: RoadmapStatusPackTeamWorkDataStatus =
    projectsInScope === 0
      ? "empty"
      : projectsWithData === 0
      ? "unavailable"
      : partial
      ? "partial"
      : totalOpen === 0
      ? "empty"
      : "ok";

  return {
    available: projectsWithData > 0,
    partial,
    errored: false,
    projectsInScope,
    projectsWithData,
    projectsFailed,
    dueSoonWindowDays,
    totalOpen,
    overdueCount,
    dueTodayCount,
    dueSoonCount,
    highPriorityCount,
    unassignedCount,
    blockedCount,
    unestimatedCount,
    estimatedOpenHours,
    ownersRepresented,
    overdueWork,
    dueSoonWork,
    highPriorityOpenWork,
    unassignedWork,
    ownerWorkload,
    dataStatus,
    unavailableReason:
      dataStatus === "unavailable"
        ? "Team Work could not be read for any project in the current Roadmap scope."
        : null,
    coverageNotes,
    recentlyCompletedAvailable: false,
    recentlyCompletedNote,
  };
}


/* ────────────── Team Work Detail Annex (Phase 6A.14) ────────────── */

export type RoadmapStatusPackTeamWorkDetailDataStatus =
  | "ok"
  | "partial"
  | "empty"
  | "unavailable";

export type RoadmapStatusPackTeamWorkDetailReasonFlag =
  RoadmapStatusPackTeamWorkReasonFlag;

export interface RoadmapStatusPackTeamWorkDetailItem
  extends RoadmapStatusPackTeamWorkItem {}

export interface RoadmapStatusPackTeamWorkDetailAnnex {
  available: boolean;
  partial: boolean;
  errored: boolean;
  projectsInScope: number;
  projectsWithData: number;
  projectsFailed: number;

  /** Total authorized work items available before the display cap. */
  totalAvailable: number;
  /** Rows actually displayed (capped). */
  rowsShown: number;
  /** Display cap applied. */
  displayCap: number;

  /** Aggregate attention counters across ALL authorized rows (pre-cap). */
  overdueCount: number;
  dueTodayCount: number;
  dueSoonCount: number;
  highPriorityCount: number;
  unassignedCount: number;
  blockedCount: number;

  dueSoonWindowDays: number;

  /** Capped, attention-first detail rows. */
  items: readonly RoadmapStatusPackTeamWorkDetailItem[];

  dataStatus: RoadmapStatusPackTeamWorkDetailDataStatus;
  unavailableReason: string | null;
  coverageNotes: readonly string[];
  /** Honest disclosure: recently-completed work is not in this annex. */
  recentlyCompletedAvailable: false;
  recentlyCompletedNote: string;
}

const TEAM_WORK_DETAIL_DISPLAY_CAP = 50;

export function deriveRoadmapStatusPackTeamWorkDetailAnnex(args: {
  scopedProjects: readonly RoadmapProject[];
  overviewByProjectId: ReadonlyMap<string, RoadmapTeamWorkOverviewInput>;
  failedProjectIds: readonly string[];
  isError: boolean;
  dueSoonWindowDays?: number;
  displayCap?: number;
}): RoadmapStatusPackTeamWorkDetailAnnex {
  const {
    scopedProjects,
    overviewByProjectId,
    failedProjectIds,
    isError,
  } = args;
  const dueSoonWindowDays = args.dueSoonWindowDays ?? TEAM_WORK_DUE_SOON_DAYS;
  const displayCap = args.displayCap ?? TEAM_WORK_DETAIL_DISPLAY_CAP;

  const projectsInScope = scopedProjects.length;
  const projectsFailed = failedProjectIds.length;
  const recentlyCompletedNote =
    "Recently completed work is not included in this detail annex — the authorized Team Work read path is requested with `time_window=all_open`, which excludes completed items.";

  const coverageNotes: string[] = [
    "Team Work Detail Annex derives from canonical BTPM project / phase / task / assignment / blocker data via the authorized Team Work overview RPC.",
    "Open work only: items returned with `time_window=all_open`, completed items excluded. Rows reflect what the current user is authorized to see.",
    recentlyCompletedNote,
  ];

  if (isError) {
    return {
      available: false,
      partial: false,
      errored: true,
      projectsInScope,
      projectsWithData: 0,
      projectsFailed,
      totalAvailable: 0,
      rowsShown: 0,
      displayCap,
      overdueCount: 0,
      dueTodayCount: 0,
      dueSoonCount: 0,
      highPriorityCount: 0,
      unassignedCount: 0,
      blockedCount: 0,
      dueSoonWindowDays,
      items: [],
      dataStatus: "unavailable",
      unavailableReason:
        "Team Work detail could not be read for the current Roadmap scope.",
      coverageNotes,
      recentlyCompletedAvailable: false,
      recentlyCompletedNote,
    };
  }

  const items: RoadmapStatusPackTeamWorkDetailItem[] = [];
  let projectsWithData = 0;
  let overdueCount = 0;
  let dueTodayCount = 0;
  let dueSoonCount = 0;
  let highPriorityCount = 0;
  let unassignedCount = 0;
  let blockedCount = 0;

  for (const p of scopedProjects) {
    const ov = overviewByProjectId.get(p.id);
    if (!ov) continue;
    projectsWithData += 1;
    for (const r of ov.items) {
      const isDueSoon =
        !r.is_overdue &&
        !r.is_due_today &&
        r.days_until_due !== null &&
        r.days_until_due >= 0 &&
        r.days_until_due <= dueSoonWindowDays;
      if (r.is_overdue) overdueCount += 1;
      if (r.is_due_today) dueTodayCount += 1;
      if (isDueSoon) dueSoonCount += 1;
      if (r.is_high_priority) highPriorityCount += 1;
      if (r.is_unassigned) unassignedCount += 1;
      if (r.is_blocked) blockedCount += 1;

      const flags = teamWorkReasonFlags(r, isDueSoon);
      const projectName = r.project_name ?? p.name ?? "Unnamed project";
      items.push({
        taskId: r.task_id,
        taskName: r.task_name ?? "Untitled task",
        taskStatus: r.task_status,
        priorityBucket: teamWorkPriorityBucket(r.task_priority),
        rawPriority: r.task_priority,
        projectId: r.project_id,
        projectName,
        workspaceName: r.workspace_name ?? null,
        programName: r.program_name ?? null,
        phaseName: r.phase_name ?? null,
        assigneeId: r.assignee_id,
        assigneeName: r.assignee_name,
        dueDate: r.due_date,
        daysOverdue: r.days_overdue,
        daysUntilDue: r.days_until_due,
        isOverdue: r.is_overdue,
        isDueToday: r.is_due_today,
        isDueSoon,
        isBlocked: r.is_blocked,
        isUnassigned: r.is_unassigned,
        isHighPriority: r.is_high_priority,
        openBlockerCount: r.open_blocker_count,
        reasonFlags: flags,
        requestedByStakeholder: normalizeStatusPackStakeholderRef(
          r.requested_by_stakeholder ?? null,
        ),
        executedByStakeholders: normalizeStatusPackExecutedByList(
          r.executed_by_stakeholders ?? null,
        ),
      });
    }
  }

  const sortAttention = (
    a: RoadmapStatusPackTeamWorkDetailItem,
    b: RoadmapStatusPackTeamWorkDetailItem,
  ): number => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    if (a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue;
    if (a.isDueToday !== b.isDueToday) return a.isDueToday ? -1 : 1;
    if (a.isDueSoon !== b.isDueSoon) return a.isDueSoon ? -1 : 1;
    if (a.isHighPriority !== b.isHighPriority) return a.isHighPriority ? -1 : 1;
    if (a.isBlocked !== b.isBlocked) return a.isBlocked ? -1 : 1;
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? -1 : 1;
    const ad = a.daysUntilDue ?? Number.POSITIVE_INFINITY;
    const bd = b.daysUntilDue ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    const an = a.projectName.localeCompare(b.projectName);
    if (an !== 0) return an;
    return a.taskName.localeCompare(b.taskName);
  };

  const sorted = items.slice().sort(sortAttention);
  const capped = sorted.slice(0, displayCap);

  const partial = projectsFailed > 0;
  if (partial) {
    coverageNotes.push(
      `Team Work could not be loaded for ${projectsFailed} project(s) in scope. Rows below reflect the authorized, available subset only.`,
    );
  }
  if (sorted.length > capped.length) {
    coverageNotes.push(
      `Showing the top ${displayCap} work items by attention priority. ${sorted.length - capped.length} additional work item(s) are not shown in this preview.`,
    );
  }

  const dataStatus: RoadmapStatusPackTeamWorkDetailDataStatus =
    projectsInScope === 0
      ? "empty"
      : projectsWithData === 0
      ? "unavailable"
      : partial
      ? "partial"
      : sorted.length === 0
      ? "empty"
      : "ok";

  return {
    available: projectsWithData > 0,
    partial,
    errored: false,
    projectsInScope,
    projectsWithData,
    projectsFailed,
    totalAvailable: sorted.length,
    rowsShown: capped.length,
    displayCap,
    overdueCount,
    dueTodayCount,
    dueSoonCount,
    highPriorityCount,
    unassignedCount,
    blockedCount,
    dueSoonWindowDays,
    items: capped,
    dataStatus,
    unavailableReason:
      dataStatus === "unavailable"
        ? "Team Work detail could not be read for any project in the current Roadmap scope."
        : null,
    coverageNotes,
    recentlyCompletedAvailable: false,
    recentlyCompletedNote,
  };
}


/* ────────────── Project Detail Annex (Phase 6A.13) ────────────── */

export type RoadmapStatusPackProjectDetailAnnexDataStatus =
  | "ok"
  | "partial"
  | "empty"
  | "unavailable";

export type RoadmapStatusPackProjectDetailAttentionFlag =
  | "red_health"
  | "amber_health"
  | "behind_schedule"
  | "overdue_target"
  | "no_schedule_basis"
  | "missing_reporting"
  | "open_risks"
  | "open_blockers"
  // NOTE: KPI attention is intentionally NOT a flag here. The annex currently
  // exposes KPI as a count only and does not derive KPI attention status.
  | "governance_attention"
  | "work_overdue"
  | "work_due_soon"
  | "high_priority";

/** Minimal local input shape for governance rows (mirrors hook row). */
export interface RoadmapProjectAnnexGovernanceInput {
  id: string;
  record_kind: string | null;
  decision_stage: string | null;
  target_decision_date: string | null;
  updated_at: string;
}

/** Minimal local input shape for KPI definitions (mirrors hook row). */
export interface RoadmapProjectAnnexKpiInput {
  id: string;
  target_type: string;
  target_id: string;
}

export interface RoadmapStatusPackProjectDetailItem {
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string | null;
  programId: string | null;
  programName: string | null;
  status: string;
  statusLabel: string;
  priority: string;
  priorityLabel: string;
  projectStage: string | null;
  startDate: string | null;
  targetEndDate: string | null;

  hasReportingSummary: boolean;
  healthRag: ReportingHealthRag | null;
  healthLabel: string | null;
  scheduleSignal: ReportingScheduleSignal | null;
  scheduleLabel: string | null;
  completionPercent: number | null;
  computedAt: string | null;
  isOverdueTarget: boolean;

  /** True when the risks/blockers read path succeeded for this project. */
  risksBlockersAvailable: boolean;
  openRisksCount: number | null;
  openBlockersCount: number | null;

  /** True when KPI definitions loaded successfully (project-level KPIs only). */
  kpisAvailable: boolean;
  kpiCount: number | null;

  /** True when governance read path succeeded for this project. */
  governanceAvailable: boolean;
  governanceTotalCount: number | null;
  governanceAttentionCount: number | null;

  /** True when team work overview loaded successfully for this project. */
  teamWorkAvailable: boolean;
  openWorkCount: number | null;
  overdueWorkCount: number | null;
  dueSoonWorkCount: number | null;

  /** True when activity event read path succeeded for this project. */
  recentActivityAvailable: boolean;
  recentActivityCount: number | null;
  latestActivityAt: string | null;

  attentionFlags: readonly RoadmapStatusPackProjectDetailAttentionFlag[];
  coverageNotes: readonly string[];
}

export interface RoadmapStatusPackProjectDetailAnnex {
  available: boolean;
  partial: boolean;
  errored: boolean;
  projectsInScope: number;
  projectsInAnnex: number;
  projectsNeedingAttention: number;
  scheduleAttentionCount: number;
  riskBlockerAttentionCount: number;
  kpiGovernanceWorkAttentionCount: number;
  projectsMissingReporting: number;
  /** Default activity lookback used for "recent activity" count per project. */
  recentActivityLookbackDays: number;
  items: readonly RoadmapStatusPackProjectDetailItem[];
  dataStatus: RoadmapStatusPackProjectDetailAnnexDataStatus;
  unavailableReason: string | null;
  coverageNotes: readonly string[];
}

const ANNEX_RECENT_ACTIVITY_LOOKBACK_DAYS = 7;

function annexAttentionScore(
  flags: readonly RoadmapStatusPackProjectDetailAttentionFlag[],
): number {
  // Lower score = higher attention. Mirrors sorting style used by other sections.
  let score = 100;
  if (flags.includes("red_health")) score -= 50;
  if (flags.includes("behind_schedule")) score -= 30;
  if (flags.includes("overdue_target")) score -= 25;
  if (flags.includes("open_blockers")) score -= 15;
  if (flags.includes("open_risks")) score -= 10;
  if (flags.includes("work_overdue")) score -= 10;
  if (flags.includes("governance_attention")) score -= 8;
  // kpi_attention intentionally omitted: no KPI attention is derived here.
  if (flags.includes("amber_health")) score -= 5;
  if (flags.includes("work_due_soon")) score -= 4;
  if (flags.includes("no_schedule_basis")) score -= 2;
  if (flags.includes("missing_reporting")) score -= 1;
  return score;
}

export function deriveRoadmapStatusPackProjectDetailAnnex(args: {
  scopedProjects: readonly RoadmapProject[];
  reportingByProjectId: ReadonlyMap<string, ProjectReportingSummary>;
  reportingAvailable: boolean;

  risksByProjectId: ReadonlyMap<string, readonly ProjectRiskRow[]>;
  blockersByProjectId: ReadonlyMap<string, readonly ProjectBlockerRow[]>;
  risksBlockersFailedProjectIds: readonly string[];
  risksBlockersErrored: boolean;

  kpiDefinitions: readonly RoadmapProjectAnnexKpiInput[];
  kpisErrored: boolean;

  governanceRowsByProjectId: ReadonlyMap<
    string,
    readonly RoadmapProjectAnnexGovernanceInput[]
  >;
  governanceFailedProjectIds: readonly string[];
  governanceErrored: boolean;

  teamWorkOverviewByProjectId: ReadonlyMap<string, RoadmapTeamWorkOverviewInput>;
  teamWorkFailedProjectIds: readonly string[];
  teamWorkErrored: boolean;

  progressRowsByProjectId: ReadonlyMap<
    string,
    readonly RoadmapProgressActivityEventInput[]
  >;
  progressFailedProjectIds: readonly string[];
  progressErrored: boolean;

  now?: Date;
  recentActivityLookbackDays?: number;
}): RoadmapStatusPackProjectDetailAnnex {
  const {
    scopedProjects,
    reportingByProjectId,
    reportingAvailable,
    risksByProjectId,
    blockersByProjectId,
    risksBlockersFailedProjectIds,
    risksBlockersErrored,
    kpiDefinitions,
    kpisErrored,
    governanceRowsByProjectId,
    governanceFailedProjectIds,
    governanceErrored,
    teamWorkOverviewByProjectId,
    teamWorkFailedProjectIds,
    teamWorkErrored,
    progressRowsByProjectId,
    progressFailedProjectIds,
    progressErrored,
  } = args;
  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  const lookbackDays =
    args.recentActivityLookbackDays ?? ANNEX_RECENT_ACTIVITY_LOOKBACK_DAYS;
  const lookbackCutoffMs = nowMs - lookbackDays * MS_PER_DAY;

  const risksFailedSet = new Set(risksBlockersFailedProjectIds);
  const governanceFailedSet = new Set(governanceFailedProjectIds);
  const teamWorkFailedSet = new Set(teamWorkFailedProjectIds);
  const progressFailedSet = new Set(progressFailedProjectIds);

  // Group project-level KPI definitions by project (target_type === 'project').
  const kpisByProjectId = new Map<string, number>();
  if (!kpisErrored) {
    for (const k of kpiDefinitions) {
      if (k.target_type !== "project") continue;
      kpisByProjectId.set(k.target_id, (kpisByProjectId.get(k.target_id) ?? 0) + 1);
    }
  }

  let scheduleAttentionCount = 0;
  let riskBlockerAttentionCount = 0;
  let kpiGovernanceWorkAttentionCount = 0;
  let projectsNeedingAttention = 0;
  let projectsMissingReporting = 0;

  const items: RoadmapStatusPackProjectDetailItem[] = scopedProjects.map((p) => {
    const reporting = reportingByProjectId.get(p.id);
    const hasReporting = !!reporting;
    if (!hasReporting) projectsMissingReporting += 1;

    const coverageNotes: string[] = [];
    const flags: RoadmapStatusPackProjectDetailAttentionFlag[] = [];

    // Reporting-derived signals.
    let isOverdueTarget = false;
    if (reporting) {
      if (reporting.health_rag === "red") flags.push("red_health");
      else if (reporting.health_rag === "amber") flags.push("amber_health");
      if (reporting.schedule_signal === "behind_schedule") flags.push("behind_schedule");
      if (reporting.schedule_signal === "no_schedule_basis")
        flags.push("no_schedule_basis");
    } else {
      flags.push("missing_reporting");
    }
    if (p.target_end_date) {
      const t = Date.parse(p.target_end_date);
      if (!Number.isNaN(t) && t < nowMs && p.status !== "completed" && p.status !== "cancelled") {
        isOverdueTarget = true;
        flags.push("overdue_target");
      }
    }
    if (p.priority === "critical" || p.priority === "high") {
      flags.push("high_priority");
    }

    // Risks & Blockers — open counts only when read path succeeded for project.
    const risksAvailable =
      !risksBlockersErrored && !risksFailedSet.has(p.id) && risksByProjectId.has(p.id);
    const blockersAvailableForProj =
      !risksBlockersErrored && !risksFailedSet.has(p.id) && blockersByProjectId.has(p.id);
    let openRisksCount: number | null = null;
    let openBlockersCount: number | null = null;
    if (risksAvailable) {
      const rows = risksByProjectId.get(p.id) ?? [];
      openRisksCount = rows.filter((r) => isActiveRiskBucket(r.status)).length;
      if (openRisksCount > 0) flags.push("open_risks");
    } else {
      coverageNotes.push("Risks not loaded for this project.");
    }
    if (blockersAvailableForProj) {
      const rows = blockersByProjectId.get(p.id) ?? [];
      openBlockersCount = rows.filter(
        (b) => blockerStatusBucket(b.status) !== "resolved",
      ).length;
      if (openBlockersCount > 0) flags.push("open_blockers");
    } else if (!risksAvailable) {
      // already noted above
    } else {
      coverageNotes.push("Blockers not loaded for this project.");
    }
    const risksBlockersAvailable = risksAvailable || blockersAvailableForProj;

    // KPIs — definitions are loaded globally (one query). If errored, unavailable.
    const kpisAvailable = !kpisErrored;
    const kpiCount = kpisAvailable ? kpisByProjectId.get(p.id) ?? 0 : null;
    if (!kpisAvailable) coverageNotes.push("KPI definitions not available.");

    // Governance — per-project fan-out.
    const governanceAvailableForProj =
      !governanceErrored &&
      !governanceFailedSet.has(p.id) &&
      governanceRowsByProjectId.has(p.id);
    let governanceTotalCount: number | null = null;
    let governanceAttentionCount: number | null = null;
    if (governanceAvailableForProj) {
      const rows = governanceRowsByProjectId.get(p.id) ?? [];
      governanceTotalCount = rows.length;
      let attn = 0;
      for (const r of rows) {
        const stage = (r.decision_stage ?? "").toLowerCase();
        const isClosedDecision = stage === "decided" || stage === "closed";
        if (isClosedDecision) continue;
        // overdue target decision date
        if (r.target_decision_date) {
          const t = Date.parse(r.target_decision_date);
          if (!Number.isNaN(t) && t < nowMs) {
            attn += 1;
            continue;
          }
        }
        // stale (>60d) decision case
        const u = Date.parse(r.updated_at);
        if (
          (r.record_kind ?? "").toLowerCase() === "decision_case" &&
          !Number.isNaN(u) &&
          nowMs - u > 60 * MS_PER_DAY
        ) {
          attn += 1;
        }
      }
      governanceAttentionCount = attn;
      if (attn > 0) flags.push("governance_attention");
    } else {
      coverageNotes.push("Governance records not loaded for this project.");
    }

    // Team Work — overview per project.
    const teamWorkAvailableForProj =
      !teamWorkErrored &&
      !teamWorkFailedSet.has(p.id) &&
      teamWorkOverviewByProjectId.has(p.id);
    let openWorkCount: number | null = null;
    let overdueWorkCount: number | null = null;
    let dueSoonWorkCount: number | null = null;
    if (teamWorkAvailableForProj) {
      const ov = teamWorkOverviewByProjectId.get(p.id)!;
      const items = ov.items ?? [];
      openWorkCount = ov.summary?.total_open ?? items.length;
      overdueWorkCount =
        ov.summary?.overdue ?? items.filter((i) => i.is_overdue).length;
      const dueToday =
        ov.summary?.due_today ?? items.filter((i) => i.is_due_today).length;
      const upcoming =
        ov.summary?.upcoming ?? items.filter((i) => i.is_upcoming).length;
      dueSoonWorkCount = dueToday + upcoming;
      if (overdueWorkCount > 0) flags.push("work_overdue");
      if (dueSoonWorkCount > 0) flags.push("work_due_soon");
    } else {
      coverageNotes.push("Team Work not loaded for this project.");
    }

    // Recent activity — only count when the read path succeeded.
    const recentActivityAvailable =
      !progressErrored && !progressFailedSet.has(p.id) && progressRowsByProjectId.has(p.id);
    let recentActivityCount: number | null = null;
    let latestActivityAt: string | null = null;
    if (recentActivityAvailable) {
      const events = progressRowsByProjectId.get(p.id) ?? [];
      let cnt = 0;
      for (const e of events) {
        const t = Date.parse(e.created_at);
        if (Number.isNaN(t)) continue;
        if (t >= lookbackCutoffMs) cnt += 1;
        if (latestActivityAt === null || e.created_at > latestActivityAt) {
          latestActivityAt = e.created_at;
        }
      }
      recentActivityCount = cnt;
    }

    // Section-level attention buckets.
    const hasScheduleAttn =
      flags.includes("red_health") ||
      flags.includes("behind_schedule") ||
      flags.includes("overdue_target");
    if (hasScheduleAttn) scheduleAttentionCount += 1;

    const hasRiskBlockerAttn =
      flags.includes("open_risks") || flags.includes("open_blockers");
    if (hasRiskBlockerAttn) riskBlockerAttentionCount += 1;

    // KPI is intentionally NOT part of this attention bucket — the annex does
    // not derive KPI attention status, only KPI counts.
    const hasKgwAttn =
      flags.includes("governance_attention") ||
      flags.includes("work_overdue") ||
      flags.includes("work_due_soon");
    if (hasKgwAttn) kpiGovernanceWorkAttentionCount += 1;

    // Project needs attention if any flag beyond just "high_priority" is present.
    const meaningfulFlags = flags.filter((f) => f !== "high_priority");
    if (meaningfulFlags.length > 0) projectsNeedingAttention += 1;

    return {
      projectId: p.id,
      projectName: p.name,
      workspaceId: p.workspace_id,
      workspaceName: p.workspace_name,
      programId: p.program_id,
      programName: p.program_name,
      status: p.status,
      statusLabel: getPmWorkflowStatusLabel(p.status),
      priority: p.priority,
      priorityLabel: getPmPriorityLabel(p.priority),
      projectStage: p.project_stage,
      startDate: p.start_date,
      targetEndDate: p.target_end_date,
      hasReportingSummary: hasReporting,
      healthRag: reporting ? reporting.health_rag : null,
      healthLabel: reporting ? HEALTH_LABELS[reporting.health_rag] : null,
      scheduleSignal: reporting ? reporting.schedule_signal : null,
      scheduleLabel: reporting ? SCHEDULE_LABELS[reporting.schedule_signal] : null,
      completionPercent: reporting ? reporting.completion_percent : null,
      computedAt: reporting ? reporting.computed_at : null,
      isOverdueTarget,
      risksBlockersAvailable,
      openRisksCount,
      openBlockersCount,
      kpisAvailable,
      kpiCount,
      governanceAvailable: governanceAvailableForProj,
      governanceTotalCount,
      governanceAttentionCount,
      teamWorkAvailable: teamWorkAvailableForProj,
      openWorkCount,
      overdueWorkCount,
      dueSoonWorkCount,
      recentActivityAvailable,
      recentActivityCount,
      latestActivityAt,
      attentionFlags: flags,
      coverageNotes,
    };
  });

  const sortedItems = items.slice().sort((a, b) => {
    const sa = annexAttentionScore(a.attentionFlags);
    const sb = annexAttentionScore(b.attentionFlags);
    if (sa !== sb) return sa - sb;
    // Then by nearest upcoming target end date.
    const ad = a.targetEndDate ? Date.parse(a.targetEndDate) : Number.POSITIVE_INFINITY;
    const bd = b.targetEndDate ? Date.parse(b.targetEndDate) : Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    return a.projectName.localeCompare(b.projectName);
  });

  const sectionCoverageNotes: string[] = [];
  if (!reportingAvailable) {
    sectionCoverageNotes.push(
      "Reporting summaries are unavailable — health, schedule, and completion are not shown.",
    );
  }
  if (risksBlockersErrored) {
    sectionCoverageNotes.push("Risks & Blockers could not be loaded for any project.");
  } else if (risksBlockersFailedProjectIds.length > 0) {
    sectionCoverageNotes.push(
      `Risks & Blockers could not be loaded for ${risksBlockersFailedProjectIds.length} project(s).`,
    );
  }
  if (kpisErrored) {
    sectionCoverageNotes.push("Project-level KPI definitions could not be loaded.");
  }
  if (governanceErrored) {
    sectionCoverageNotes.push("Governance records could not be loaded for any project.");
  } else if (governanceFailedProjectIds.length > 0) {
    sectionCoverageNotes.push(
      `Governance records could not be loaded for ${governanceFailedProjectIds.length} project(s).`,
    );
  }
  if (teamWorkErrored) {
    sectionCoverageNotes.push("Team Work could not be loaded for any project.");
  } else if (teamWorkFailedProjectIds.length > 0) {
    sectionCoverageNotes.push(
      `Team Work could not be loaded for ${teamWorkFailedProjectIds.length} project(s).`,
    );
  }
  if (progressErrored) {
    sectionCoverageNotes.push("Recent activity could not be loaded for any project.");
  } else if (progressFailedProjectIds.length > 0) {
    sectionCoverageNotes.push(
      `Recent activity could not be loaded for ${progressFailedProjectIds.length} project(s).`,
    );
  }

  const projectsInScope = scopedProjects.length;
  const partial =
    risksBlockersFailedProjectIds.length > 0 ||
    governanceFailedProjectIds.length > 0 ||
    teamWorkFailedProjectIds.length > 0 ||
    progressFailedProjectIds.length > 0 ||
    !reportingAvailable;
  const fullyErrored =
    projectsInScope === 0
      ? false
      : risksBlockersErrored &&
        kpisErrored &&
        governanceErrored &&
        teamWorkErrored &&
        progressErrored &&
        !reportingAvailable;

  const dataStatus: RoadmapStatusPackProjectDetailAnnexDataStatus =
    projectsInScope === 0
      ? "empty"
      : fullyErrored
      ? "unavailable"
      : partial
      ? "partial"
      : "ok";

  return {
    available: projectsInScope > 0 && !fullyErrored,
    partial,
    errored: fullyErrored,
    projectsInScope,
    projectsInAnnex: sortedItems.length,
    projectsNeedingAttention,
    scheduleAttentionCount,
    riskBlockerAttentionCount,
    kpiGovernanceWorkAttentionCount,
    projectsMissingReporting,
    recentActivityLookbackDays: lookbackDays,
    items: sortedItems,
    dataStatus,
    unavailableReason:
      dataStatus === "unavailable"
        ? "Project Detail Annex could not be safely derived for any project in the current Roadmap scope."
        : null,
    coverageNotes: sectionCoverageNotes,
  };
}


/* ────────────── Scope & Data Notes (Phase 6A.15) ────────────── */

export type RoadmapStatusPackScopeDataNotesDataStatus =
  | "ok"
  | "partial"
  | "unavailable";

export type RoadmapStatusPackScopeDataNoteCategory =
  | "scope"
  | "included_sections"
  | "connected_sources"
  | "partial_unavailable"
  | "period_caps"
  | "deferred"
  | "general";

export type RoadmapStatusPackScopeDataSourceStatus =
  | "connected"
  | "partial"
  | "unavailable"
  | "not_connected_yet";

export interface RoadmapStatusPackScopeDataNote {
  id: string;
  category: RoadmapStatusPackScopeDataNoteCategory;
  text: string;
  relatedSectionId?: StatusPackSectionId;
}

export interface RoadmapStatusPackScopeDataIncludedSection {
  sectionId: StatusPackSectionId;
  title: string;
  mandatory: boolean;
  included: boolean;
  placement: "executive" | "appendix";
  resolverStatus: StatusPackResolverStatus;
}

export interface RoadmapStatusPackScopeDataSourceNote {
  sectionId: StatusPackSectionId;
  sectionTitle: string;
  sourceLabel: string;
  status: RoadmapStatusPackScopeDataSourceStatus;
}

export interface RoadmapStatusPackScopeDataNotes {
  generatedAt: string;
  scopeBasis: {
    sourceSurface: "Roadmap";
    workspaceCount: number;
    programCount: number;
    projectCount: number;
    accessibleProjectCount: number;
    workspaceLabels: readonly string[];
    programLabels: readonly string[];
    appliedFilters: readonly RoadmapStatusPackFilterDisplayItem[];
    /** Honest disclosure for archived inclusion. Not currently a user control. */
    archivedNote: string;
  };
  includedSections: readonly RoadmapStatusPackScopeDataIncludedSection[];
  excludedOptionalSections: readonly RoadmapStatusPackScopeDataIncludedSection[];
  connectedSources: readonly RoadmapStatusPackScopeDataSourceNote[];
  partialOrUnavailableNotes: readonly RoadmapStatusPackScopeDataNote[];
  periodAndCapNotes: readonly RoadmapStatusPackScopeDataNote[];
  deferredCapabilityNotes: readonly RoadmapStatusPackScopeDataNote[];
  generalCoverageNotes: readonly RoadmapStatusPackScopeDataNote[];
  dataStatus: RoadmapStatusPackScopeDataNotesDataStatus;
}

const SCOPE_NOTES_SOURCE_LABELS: Partial<Record<StatusPackSectionId, string>> = {
  cover_scope: "Roadmap projects and access map",
  exec_summary: "Roadmap projects and reporting summaries",
  control_board: "Roadmap projects and reporting summaries",
  timeline: "Roadmap projects and reporting summaries",
  calendar_milestones: "Roadmap projects and reporting summaries",
  risks_blockers: "Per-project risks and blockers",
  dependencies: "Project-to-project dependencies",
  kpis: "Project-level KPI definitions, official KPI snapshots, and recent KPI updates",
  governance: "Project governance records",
  progress_since_last: "Project activity events",
  team_work_summary: "Team Work overview (open work)",
  team_work_detail_annex: "Team Work overview (open work)",
  project_detail_annex: "Composed from connected sections above",
  scope_data_notes: "Derived from this Status Pack manifest and section coverage",
};

type SectionWithCoverage = {
  dataStatus?: string;
  unavailableReason?: string | null;
  coverageNotes?: readonly string[];
  partial?: boolean;
  errored?: boolean;
};

function uniquePush(arr: string[], v: string): void {
  if (!arr.includes(v)) arr.push(v);
}

export function deriveRoadmapStatusPackScopeDataNotes(args: {
  manifest: RoadmapStatusPackManifest;
  registry: readonly StatusPackSectionRegistryEntry[];
  scopeSummary: RoadmapStatusPackScopeSummary;
  /**
   * Already-derived section data keyed by section id. The helper only reads
   * shared coverage fields (`dataStatus`, `coverageNotes`,
   * `unavailableReason`, `partial`, `errored`); it does not require every
   * section to provide them.
   */
  sectionData: Partial<Record<StatusPackSectionId, SectionWithCoverage>>;
  /** Whether the reporting summary read path is currently available. */
  reportingAvailable: boolean;
  now?: Date;
}): RoadmapStatusPackScopeDataNotes {
  const { manifest, registry, scopeSummary, sectionData, reportingAvailable } = args;
  const now = args.now ?? new Date();
  const selected = new Set<StatusPackSectionId>(manifest.selectedSectionIds);

  const includedSections: RoadmapStatusPackScopeDataIncludedSection[] = [];
  const excludedOptionalSections: RoadmapStatusPackScopeDataIncludedSection[] = [];
  for (const e of registry) {
    const included = e.mandatory || selected.has(e.id);
    const entry: RoadmapStatusPackScopeDataIncludedSection = {
      sectionId: e.id,
      title: e.title,
      mandatory: e.mandatory,
      included,
      placement: e.placement,
      resolverStatus: e.resolverStatus,
    };
    if (included) includedSections.push(entry);
    else excludedOptionalSections.push(entry);
  }

  const connectedSources: RoadmapStatusPackScopeDataSourceNote[] = [];
  for (const e of includedSections) {
    if (e.sectionId === "scope_data_notes") continue;
    const sourceLabel = SCOPE_NOTES_SOURCE_LABELS[e.sectionId] ?? "Canonical BTPM data";
    let status: RoadmapStatusPackScopeDataSourceStatus;
    if (e.resolverStatus !== "connected") {
      status = "not_connected_yet";
    } else {
      const sd = sectionData[e.sectionId];
      const ds = sd?.dataStatus;
      if (ds === "unavailable" || sd?.errored === true) status = "unavailable";
      else if (ds === "partial" || sd?.partial === true) status = "partial";
      else status = "connected";
    }
    connectedSources.push({
      sectionId: e.sectionId,
      sectionTitle: e.title,
      sourceLabel,
      status,
    });
  }

  const partialOrUnavailableNotes: RoadmapStatusPackScopeDataNote[] = [];
  const seenNoteTexts: string[] = [];
  const addNote = (
    bucket: RoadmapStatusPackScopeDataNote[],
    note: RoadmapStatusPackScopeDataNote,
  ) => {
    if (seenNoteTexts.includes(note.text)) return;
    seenNoteTexts.push(note.text);
    bucket.push(note);
  };

  if (!reportingAvailable) {
    addNote(partialOrUnavailableNotes, {
      id: "reporting-unavailable",
      category: "partial_unavailable",
      text:
        "Reporting summaries are currently unavailable — project health, schedule signal, and completion are not shown.",
    });
  }

  for (const e of includedSections) {
    if (e.sectionId === "scope_data_notes") continue;
    if (e.resolverStatus !== "connected") {
      addNote(partialOrUnavailableNotes, {
        id: `not-connected-${e.sectionId}`,
        category: "partial_unavailable",
        text: `${e.title}: live data wiring is not connected yet in this preview.`,
        relatedSectionId: e.sectionId,
      });
      continue;
    }
    const sd = sectionData[e.sectionId];
    if (!sd) continue;
    if (sd.dataStatus === "unavailable" || sd.errored === true) {
      addNote(partialOrUnavailableNotes, {
        id: `unavailable-${e.sectionId}`,
        category: "partial_unavailable",
        text:
          sd.unavailableReason && sd.unavailableReason.length > 0
            ? `${e.title}: ${sd.unavailableReason}`
            : `${e.title}: data is currently unavailable for the selected Roadmap scope.`,
        relatedSectionId: e.sectionId,
      });
    } else if (sd.dataStatus === "partial" || sd.partial === true) {
      addNote(partialOrUnavailableNotes, {
        id: `partial-${e.sectionId}`,
        category: "partial_unavailable",
        text: `${e.title}: coverage is partial for the selected Roadmap scope.`,
        relatedSectionId: e.sectionId,
      });
    }
    if (sd.coverageNotes) {
      for (const cn of sd.coverageNotes) {
        addNote(partialOrUnavailableNotes, {
          id: `coverage-${e.sectionId}-${cn.slice(0, 40)}`,
          category: "partial_unavailable",
          text: `${e.title}: ${cn}`,
          relatedSectionId: e.sectionId,
        });
      }
    }
  }

  // Static, presentation-safe disclosures for dimensions intentionally not
  // shown in this Status Pack (only when their parent section is included).
  const generalCoverageNotes: RoadmapStatusPackScopeDataNote[] = [];
  if (selected.has("dependencies") || true) {
    // Dependencies is informational regardless because the section title
    // already covers the limitation; only emit when included.
  }
  const generalCandidates: Array<{
    when: boolean;
    note: RoadmapStatusPackScopeDataNote;
  }> = [
    {
      when: selected.has("dependencies"),
      note: {
        id: "general-dependencies-project-only",
        category: "general",
        text:
          "Dependencies: only project-to-project dependencies are surfaced. Phase-level and task-level dependencies are not yet included.",
        relatedSectionId: "dependencies",
      },
    },
    {
      when: selected.has("kpis"),
      note: {
        id: "general-kpis-project-only",
        category: "general",
        text:
          "KPIs: only project-level KPIs are surfaced. Program-level and phase/task-level KPIs are not yet included.",
        relatedSectionId: "kpis",
      },
    },
    {
      when: selected.has("governance"),
      note: {
        id: "general-governance-asks-not-classified",
        category: "general",
        text:
          "Governance: open Asks are not separately classified — the canonical governance model currently has decisions and records, not a dedicated Ask object.",
        relatedSectionId: "governance",
      },
    },
    {
      when: selected.has("progress_since_last"),
      note: {
        id: "general-progress-execution-updates",
        category: "general",
        text:
          "Progress Since Last Period: derived from canonical activity events. Execution Updates are not separately surfaced in this view yet.",
        relatedSectionId: "progress_since_last",
      },
    },
    {
      when: selected.has("team_work_summary") || selected.has("team_work_detail_annex"),
      note: {
        id: "general-team-work-open-only",
        category: "general",
        text:
          "Team Work: reflects open work for the selected Roadmap scope. Recently completed work is not surfaced in this view.",
      },
    },
    {
      when: selected.has("project_detail_annex"),
      note: {
        id: "general-annex-kpi-count-only",
        category: "general",
        text:
          "Project Detail Annex: KPI is shown as a count only — KPI attention status is not derived in the annex.",
        relatedSectionId: "project_detail_annex",
      },
    },
  ];
  for (const c of generalCandidates) {
    if (c.when) addNote(generalCoverageNotes, c.note);
  }

  // Period & cap assumptions — only emit when a related section is included.
  const periodAndCapNotes: RoadmapStatusPackScopeDataNote[] = [];
  if (selected.has("progress_since_last")) {
    addNote(periodAndCapNotes, {
      id: "period-progress-last-7-days",
      category: "period_caps",
      text:
        "Progress Since Last Period uses a default lookback of the last 7 days. It is not a comparison against a previously saved presentation view.",
      relatedSectionId: "progress_since_last",
    });
  }
  if (selected.has("kpis")) {
    addNote(periodAndCapNotes, {
      id: "cap-kpi-update-preview-limit",
      category: "period_caps",
      text: `KPI current values use the same latest-reading precedence as the project KPI surface (official snapshot, then manual update, then definition current value). Manual KPI update history is read with a preview limit of ${KPI_UPDATE_PREVIEW_LIMIT} rows; trend and freshness from manual updates may be partial when the cap is reached for a wide scope.`,
      relatedSectionId: "kpis",
    });
  }
  if (selected.has("team_work_detail_annex")) {
    addNote(periodAndCapNotes, {
      id: "cap-team-work-detail-rows",
      category: "period_caps",
      text: `Team Work Detail Annex is capped at ${TEAM_WORK_DETAIL_DISPLAY_CAP} rows in this preview. Lower-priority items beyond the cap are not listed.`,
      relatedSectionId: "team_work_detail_annex",
    });
  }
  if (selected.has("project_detail_annex")) {
    addNote(periodAndCapNotes, {
      id: "period-annex-recent-activity-7-days",
      category: "period_caps",
      text: "Project Detail Annex 'recent activity' counts use a 7-day lookback per project.",
      relatedSectionId: "project_detail_annex",
    });
  }

  // Deferred capabilities — static, always disclosed.
  const deferredCapabilityNotes: RoadmapStatusPackScopeDataNote[] = [
    {
      id: "deferred-save-view",
      category: "deferred",
      text: "Save Presentation View is not implemented yet.",
    },
    {
      id: "deferred-pptx-export",
      category: "deferred",
      text:
        "PPT export from the Status Pack is not implemented yet. The existing Roadmap 'Generate PPT' action remains the active export path and is unchanged.",
    },
    {
      id: "deferred-legacy-ppt-replacement",
      category: "deferred",
      text:
        "Replacement or removal of the legacy Roadmap 'Generate PPT' action is intentionally deferred until the new preview and export flow are accepted.",
    },
    {
      id: "deferred-live-controls",
      category: "deferred",
      text: "Live presentation controls (presenter mode, slide navigation, etc.) are not implemented yet.",
    },
    {
      id: "deferred-server-aggregates",
      category: "deferred",
      text:
        "Per-project fan-out reads are used today. Server-side aggregate read paths are deferred and not yet wired.",
    },
  ];

  // Overall status.
  const projectsInScope = scopeSummary.totalProjectsInScope;
  const anyUnavailable = partialOrUnavailableNotes.some((n) =>
    n.id.startsWith("unavailable-"),
  ) || !reportingAvailable;
  const anyPartial = partialOrUnavailableNotes.length > 0;
  const dataStatus: RoadmapStatusPackScopeDataNotesDataStatus =
    projectsInScope === 0
      ? "partial"
      : anyUnavailable
      ? "partial"
      : anyPartial
      ? "partial"
      : "ok";

  return {
    generatedAt: now.toISOString(),
    scopeBasis: {
      sourceSurface: "Roadmap",
      workspaceCount: scopeSummary.workspaceCountInScope,
      programCount: scopeSummary.programCountInScope,
      projectCount: scopeSummary.projectCountInScope,
      accessibleProjectCount: scopeSummary.totalAccessibleProjects,
      workspaceLabels: scopeSummary.workspaceLabels,
      programLabels: scopeSummary.programLabels,
      appliedFilters: scopeSummary.appliedFilters,
      archivedNote:
        "Archived items inclusion follows the underlying Roadmap read path; this Status Pack does not add a separate archived toggle.",
    },
    includedSections,
    excludedOptionalSections,
    connectedSources,
    partialOrUnavailableNotes,
    periodAndCapNotes,
    deferredCapabilityNotes,
    generalCoverageNotes,
    dataStatus,
  };
}

// Re-import-safe references — these symbols live in other hook modules so we
// re-declare lightweight constants here only for note text. Keeping a single
// source of truth would require a circular import; the values are duplicated
// deliberately and kept in sync with the hook/derivation modules.
const KPI_UPDATE_PREVIEW_LIMIT = 2000;
