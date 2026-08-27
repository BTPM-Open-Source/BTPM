/**
 * Phase 6B.5 — Roadmap Story Pack bounded source snapshot composer.
 *
 * Pure, side-effect-free assembly of a bounded "source package" for a Story
 * Pack. This is the material that the future AI generation step will see —
 * AI is NOT called here, no Story versions are created, no SharePoint file
 * content is read, and this snapshot is NEVER persisted.
 *
 * Composition rules:
 *  - Reuse already-authorized BTPM read paths through the existing Status
 *    Pack preview hooks (`useRoadmapStatusPackPreviewData`).
 *  - Story Pack config (intent, notes, linked files) flows in through the
 *    controlled `roadmapStoryPackService` RPCs only.
 *  - Disabled source categories are marked `disabled` and contribute no
 *    items.
 *  - Categories without a safe Roadmap-scope read path yet are marked
 *    `unavailable` with an explicit coverage note.
 *  - Every item array is bounded by an explicit constant — no unbounded
 *    JSON dump.
 */

import type {
  RoadmapStatusPackPreviewData,
} from "@/lib/status-pack/roadmapStatusPackData";
import type {
  RoadmapStoryPackConfig,
  RoadmapStorySourceCategory,
} from "@/lib/roadmapStoryPackService";
import type {
  StoryPlanningPhaseRow,
  StoryPlanningTaskRow,
} from "@/hooks/useRoadmapStoryPlanningSource";

// ---------------------------------------------------------------------------
// Bounded limits — explicit constants. Do not hardcode magic numbers in UI.
// ---------------------------------------------------------------------------
export const STORY_SNAPSHOT_LIMITS = Object.freeze({
  projects: 50,
  phases: 100,
  tasks: 200,
  risks: 100,
  blockers: 100,
  dependencies: 100,
  kpis: 100,
  governance: 100,
  activity: 100,
  teamWork: 100,
  notes: 50,
  files: 50,
  textChars: 6000,
  /**
   * 6B.6a — Per-object semantic detail text cap (description / mitigation /
   * notes / summary). Long enough to carry meaningful business context,
   * short enough to keep the package bounded. Truncation is marked on the
   * item itself via `detailTruncated`.
   */
  objectDetailChars: 1500,
});

export type StorySourceBlockStatus =
  | "ready"
  | "partial"
  | "empty"
  | "unavailable"
  | "disabled";

export interface StorySourceEvidenceRef {
  kind: string; // e.g. "project", "risk", "kpi_definition", "governance_record"
  id: string;
  label?: string;
}

export interface StorySourceBlock<TItem = unknown> {
  category: RoadmapStorySourceCategory;
  enabled: boolean;
  status: StorySourceBlockStatus;
  count: number;
  limit: number;
  items: readonly TItem[];
  coverageNotes: readonly string[];
  evidenceRefs: readonly StorySourceEvidenceRef[];
}

// ---------------------------------------------------------------------------
// Snapshot item shapes — intentionally compact and stable.
// ---------------------------------------------------------------------------
/**
 * 6B.6a — Semantic detail attached to every item carrying business meaning.
 * `text` is the bounded detail string (null when not available). `available`
 * is false only when no source field exists; `truncated` indicates that
 * the source text was longer than `objectDetailChars`.
 */
export interface StoryItemDetail {
  text: string | null;
  available: boolean;
  truncated: boolean;
}

export interface StoryProjectOverviewItem {
  projectId: string;
  projectName: string;
  /** 6B.7a.5 — Required for building `/workspace/:workspaceId/project/:projectId` links. */
  workspaceId: string;
  workspaceName: string;
  /** 6B.7a.5 — Required for optional program deep links. */
  programId: string | null;
  programName: string | null;
  status: string;
  health: string | null;
  scheduleSignal: string | null;
  completionPercent: number | null;
  startDate: string | null;
  targetEndDate: string | null;
  /** 6B.6a — Plain-text project description (not currently exposed; placeholder). */
  detail: StoryItemDetail;
  /** 6D.7A — Portfolio context from authorized control-board rows. */
  portfolioItemId: string | null;
  portfolioName: string | null;
  portfolioCode: string | null;
  portfolioLifecycleState: string | null;
  portfolioIsArchived: boolean | null;
}

export interface StoryRiskItem {
  id: string;
  title: string;
  /** 6B.7a.5 — Project this risk is scoped to, for deep-link routing. */
  projectId: string;
  projectName: string;
  status: string;
  severity: string;
  /** Stored DB value (e.g. "high"); empty when not set. */
  likelihood: string;
  /** Stored DB value (e.g. "high"); empty when not set. */
  impact: string;
  /** 6B.6a — Plan / response text from `risks.mitigation_plan`. */
  mitigation: StoryItemDetail;
  /** 6B.6a — Risk description. */
  detail: StoryItemDetail;
  updatedAt: string;
  isStale: boolean;
}

export interface StoryBlockerItem {
  id: string;
  title: string;
  /** 6B.7a.5 — Project this blocker is scoped to. */
  projectId: string;
  projectName: string;
  status: string;
  severity: string;
  /** 6B.6a — Blocker description / impact text. */
  detail: StoryItemDetail;
  updatedAt: string;
  isStale: boolean;
}

export interface StoryDependencyItem {
  id: string;
  type: string;
  direction: string;
  sourceProject: string;
  targetProject: string;
  isAttention: boolean;
  /** 6B.6a — Dependency description / rationale (plain). */
  detail: StoryItemDetail;
  updatedAt: string;
}

export interface StoryKpiItem {
  id: string;
  name: string;
  /** 6B.7a.5 — Project this KPI is attached to. */
  projectId: string;
  projectName: string;
  unit: string | null;
  target: number | null;
  latestValue: number | null;
  latestValueSource: string;
  latestValueDate: string | null;
  status: string;
  trend: string;
  /** 6B.6a — KPI definition description. */
  detail: StoryItemDetail;
}

export interface StoryGovernanceItem {
  id: string;
  title: string;
  /** 6B.7a.5 — Project this governance record belongs to. */
  projectId: string;
  projectName: string;
  /** `evidence_record` | `decision_case` — controls deep-link destination. */
  kind: string;
  category: string;
  decisionStatus: string;
  decisionStage: string | null;
  occurredAt: string;
  targetDecisionDate: string | null;
  isOverdue: boolean;
  isStale: boolean;
  /** 6B.6a — Governance record summary. */
  detail: StoryItemDetail;
  /** 6B.6a — Decision question / ask text (when classified as such). */
  decisionQuestion: StoryItemDetail;
}

export interface StoryActivityItem {
  id: string;
  projectName: string;
  category: string;
  eventType: string;
  /** 6B.6a — Activity event title / payload summary (bounded). */
  title: string | null;
  /** 6B.6a — Optional event description / payload narrative (bounded). */
  detail: StoryItemDetail;
  /** 6B.6a — Actor display name when available. */
  actorName: string | null;
  occurredAt: string;
  important: boolean;
}

/**
 * 6B.5d — Progress / execution-update item.
 *
 * Currently derived from canonical BTPM activity events filtered to delivery
 * and schedule-movement signals (no dedicated Roadmap-scope execution-update
 * RPC exists yet). The shape is forward-compatible with a future
 * `list_roadmap_story_progress_updates` RPC that would emit real execution
 * update records.
 */
export interface StoryProgressUpdateItem extends StoryActivityItem {
  /**
   * `activity_progress_signal` — derived from canonical activity events.
   * Future values: `execution_update`, `project_update`, `phase_update`,
   * `task_update` once a dedicated authorized source is connected.
   */
  sourceType:
    | "activity_progress_signal"
    | "execution_update"
    | "project_update"
    | "phase_update"
    | "task_update";
  isCompletion: boolean;
  isDelivery: boolean;
  isScheduleMovement: boolean;
  isStatusChange: boolean;
}


export interface StoryTeamWorkItem {
  id: string;
  taskName: string;
  projectName: string;
  assigneeName: string | null;
  status: string;
  dueDate: string | null;
  isOverdue: boolean;
  isBlocked: boolean;
  isHighPriority: boolean;
  /**
   * 6B.6a — Task description, enriched by ID match against the authorized
   * planning source (`list_decrypted_project_tasks`). Marked unavailable
   * when no enrichment match exists.
   */
  detail: StoryItemDetail;
}

export interface StoryNoteItem {
  id: string;
  label: string | null;
  body: string;
  includeInStory: boolean;
}

export interface StoryFileItem {
  id: string;
  displayName: string | null;
  webUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  userNote: string | null;
  includeInStory: boolean;
}

export interface RoadmapStorySourceSnapshot {
  storyPackId: string;
  generatedAt: string; // ISO
  /**
   * 6B.5d — Scope distinguishes captured filter scope (what the Story Pack
   * explicitly recorded) from effective resolved scope (what authorized
   * source rows actually cover after filters are applied).
   *
   * Legacy fields `workspaceIds` / `programIds` / `projectIds` are retained
   * as aliases of `captured.*` for backwards compatibility with earlier
   * snapshot consumers.
   */
  scope: {
    source: "roadmap_filters" | "story_pack_scope";
    captured: {
      workspaceIds: string[];
      programIds: string[];
      projectIds: string[];
      /** 6D.7A — Captured Portfolio scope from Story Pack config. */
      portfolioItemIds: string[];
      includeNoPortfolio: boolean;
    };
    effective: {
      workspaceCount: number;
      programCount: number;
      projectCount: number;
      /**
       * False when the available source rows do not carry program identity
       * — in that case `programCount` is 0 but should be displayed as
       * "not available", not "zero".
       */
      programCountAvailable: boolean;
      projectIds: string[];
      /** 6D.7A — Effective Portfolio scope from authorized preview rows. */
      portfolioCount: number;
      portfolioIds: string[];
      noPortfolioProjectCount: number;
    };
    // Legacy aliases (= captured.*)
    workspaceIds: string[];
    programIds: string[];
    projectIds: string[];
  };
  intent: {
    title: string | null;
    audience: string | null;
    focus: string | null;
    guidance: string | null;
  };
  selectedCategories: RoadmapStorySourceCategory[];
  disabledCategories: RoadmapStorySourceCategory[];
  counts: Partial<Record<RoadmapStorySourceCategory, number>>;
  coverageNotes: string[];
  warnings: string[];
  sources: {
    program_project_overview?: StorySourceBlock<StoryProjectOverviewItem>;
    planning_phases_tasks?: StorySourceBlock<StoryPlanningItem>;
    progress_updates?: StorySourceBlock<StoryProgressUpdateItem>;
    activity_history?: StorySourceBlock<StoryActivityItem>;
    discussions_comments?: StorySourceBlock<never>;
    risks?: StorySourceBlock<StoryRiskItem>;
    blockers?: StorySourceBlock<StoryBlockerItem>;
    dependencies?: StorySourceBlock<StoryDependencyItem>;
    kpis_snapshots?: StorySourceBlock<StoryKpiItem>;
    governance_decisions?: StorySourceBlock<StoryGovernanceItem>;
    team_work?: StorySourceBlock<StoryTeamWorkItem>;
    documents_metadata?: StorySourceBlock<StoryFileItem>;
    external_context?: StorySourceBlock<StoryNoteItem | StoryFileItem>;
  };
}


// ---------------------------------------------------------------------------
// Planning item shape — covers both phases and tasks in a single bounded list.
// ---------------------------------------------------------------------------
export interface StoryPlanningItem {
  itemType: "phase" | "task";
  itemId: string;
  projectId: string;
  projectName: string;
  parentPhaseId: string | null;
  parentPhaseName: string | null;
  name: string;
  status: string;
  priority: string | null;
  startDate: string | null;
  endDate: string | null; // target_end_date for phases, due_date for tasks
  actualStartDate: string | null;
  actualEndDate: string | null;
  sortOrder: number | null;
  updatedAt: string;
  isOverdue: boolean;
  isCompleted: boolean;
  isInProgress: boolean;
  /** 6B.6a — Server-decrypted phase/task description. */
  detail: StoryItemDetail;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function truncateText(s: string | null | undefined, max = STORY_SNAPSHOT_LIMITS.textChars): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

function cap<T>(rows: readonly T[] | undefined | null, limit: number): T[] {
  if (!rows || rows.length === 0) return [];
  return rows.slice(0, limit) as T[];
}

/**
 * 6B.6a — Build a bounded semantic-detail block for an item.
 *
 * - When the source text is null/empty -> `available=false`, text=null.
 * - When the source text exceeds `objectDetailChars` -> truncated with marker.
 * - Whitespace is trimmed.
 */
function makeDetail(
  src: string | null | undefined,
  max: number = STORY_SNAPSHOT_LIMITS.objectDetailChars,
): StoryItemDetail {
  if (src === null || src === undefined) {
    return { text: null, available: false, truncated: false };
  }
  const trimmed = String(src).trim();
  if (trimmed.length === 0) {
    return { text: null, available: false, truncated: false };
  }
  if (trimmed.length <= max) {
    return { text: trimmed, available: true, truncated: false };
  }
  return { text: trimmed.slice(0, max) + "…", available: true, truncated: true };
}

function isCategoryEnabled(
  config: RoadmapStoryPackConfig,
  category: RoadmapStorySourceCategory,
): boolean {
  const row = config.sources.find((s) => s.source_category === category);
  // Default-enabled mirror of Configure UI semantics.
  return row ? row.is_enabled : true;
}

const EMPTY_ITEMS = Object.freeze([]) as readonly never[];
const EMPTY_REFS = Object.freeze([]) as readonly StorySourceEvidenceRef[];

function disabledBlock(category: RoadmapStorySourceCategory, limit: number): StorySourceBlock<never> {
  return {
    category,
    enabled: false,
    status: "disabled",
    count: 0,
    limit,
    items: EMPTY_ITEMS,
    coverageNotes: ["This source category is turned off for this Story Pack."],
    evidenceRefs: EMPTY_REFS,
  };
}

function unavailableBlock(
  category: RoadmapStorySourceCategory,
  limit: number,
  note: string,
): StorySourceBlock<never> {
  return {
    category,
    enabled: true,
    status: "unavailable",
    count: 0,
    limit,
    items: EMPTY_ITEMS,
    coverageNotes: [note],
    evidenceRefs: EMPTY_REFS,
  };
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------
export interface ComposeRoadmapStorySourceSnapshotInput {
  storyPackId: string;
  config: RoadmapStoryPackConfig;
  preview: RoadmapStatusPackPreviewData | null;
  previewWarnings: {
    reportingError?: boolean;
    risksBlockersErrored?: boolean;
    dependenciesErrored?: boolean;
    kpisErrored?: boolean;
    governanceErrored?: boolean;
    progressErrored?: boolean;
    teamWorkErrored?: boolean;
  };
  /** Phase 6B.5b — bounded Roadmap-scope planning source, opt-in. */
  planning?: {
    phasesByProjectId: Map<string, StoryPlanningPhaseRow[]>;
    tasksByProjectId: Map<string, StoryPlanningTaskRow[]>;
    isLoading: boolean;
    isError: boolean;
    failedProjectIds: string[];
    hasPartialLoading: boolean;
    resolvedProjectCount: number;
  };
}

export function composeRoadmapStorySourceSnapshot(
  input: ComposeRoadmapStorySourceSnapshotInput,
): RoadmapStorySourceSnapshot {
  const { storyPackId, config, preview, previewWarnings, planning } = input;
  const L = STORY_SNAPSHOT_LIMITS;

  // ---- Scope -----------------------------------------------------------
  const filters = (config.pack.scope_config as Record<string, unknown> | null)?.roadmap_filters as
    | {
        workspace_ids?: string[];
        program_ids?: string[];
        project_ids?: string[];
        portfolio_item_ids?: string[];
        include_no_portfolio?: boolean;
      }
    | undefined;
  const capturedWorkspaceIds = filters?.workspace_ids ?? [];
  const capturedProgramIds = filters?.program_ids ?? [];
  const capturedProjectIds = filters?.project_ids ?? [];
  // 6D.7A — Canonical Portfolio scope from Story Pack config. Defaults treat
  // missing values as "All Portfolios" to keep older Story Packs valid.
  const capturedPortfolioItemIds = Array.isArray(filters?.portfolio_item_ids)
    ? filters!.portfolio_item_ids!.filter((id) => typeof id === "string" && id.length > 0)
    : [];
  const capturedIncludeNoPortfolio = filters?.include_no_portfolio === true;

  // 6B.5d — Effective scope is derived from the authorized control-board rows
  // actually returned for this scope (which already enforce RLS). Falls back
  // to captured filter sizes when no preview rows have resolved yet.
  const effectiveProjectIdSet = new Set<string>();
  const effectiveWorkspaceIdSet = new Set<string>();
  const effectiveProgramIdSet = new Set<string>();
  const effectivePortfolioIdSet = new Set<string>();
  let effectiveNoPortfolioProjectCount = 0;
  let programCountAvailable = false;
  if (preview) {
    for (const r of preview.controlBoard.rows) {
      effectiveProjectIdSet.add(r.projectId);
      if (r.workspaceId) effectiveWorkspaceIdSet.add(r.workspaceId);
      if (r.programId) {
        effectiveProgramIdSet.add(r.programId);
        programCountAvailable = true;
      }
      // 6D.7A — Portfolio counts from authorized preview rows only.
      if (r.portfolioItemId) effectivePortfolioIdSet.add(r.portfolioItemId);
      else effectiveNoPortfolioProjectCount += 1;
    }
    // Even when no programs are present, we know whether program identity is
    // available on the source rows — control-board rows always carry
    // `programId` (nullable), so a 0 count here is a truthful 0.
    programCountAvailable = true;
  }
  const scope: RoadmapStorySourceSnapshot["scope"] = {
    source: (filters ? "roadmap_filters" : "story_pack_scope"),
    captured: {
      workspaceIds: capturedWorkspaceIds,
      programIds: capturedProgramIds,
      projectIds: capturedProjectIds,
      portfolioItemIds: capturedPortfolioItemIds,
      includeNoPortfolio: capturedIncludeNoPortfolio,
    },
    effective: {
      workspaceCount: preview ? effectiveWorkspaceIdSet.size : capturedWorkspaceIds.length,
      programCount: preview ? effectiveProgramIdSet.size : capturedProgramIds.length,
      projectCount: preview ? effectiveProjectIdSet.size : capturedProjectIds.length,
      programCountAvailable,
      projectIds: Array.from(effectiveProjectIdSet),
      portfolioCount: effectivePortfolioIdSet.size,
      portfolioIds: Array.from(effectivePortfolioIdSet),
      noPortfolioProjectCount: effectiveNoPortfolioProjectCount,
    },
    // Legacy aliases — preserved for snapshot consumers that pre-date 6B.5d.
    workspaceIds: capturedWorkspaceIds,
    programIds: capturedProgramIds,
    projectIds: capturedProjectIds,
  };


  // ---- Intent ----------------------------------------------------------
  const intent = {
    title: config.pack.title,
    audience: config.pack.audience,
    focus: config.pack.focus,
    guidance: config.pack.guidance ? truncateText(config.pack.guidance) : null,
  };

  // ---- Category selection ---------------------------------------------
  const allCats: RoadmapStorySourceCategory[] = [
    "program_project_overview",
    "planning_phases_tasks",
    "progress_updates",
    "activity_history",
    "discussions_comments",
    "risks",
    "blockers",
    "dependencies",
    "kpis_snapshots",
    "governance_decisions",
    "team_work",
    "documents_metadata",
    "external_context",
  ];
  const selectedCategories: RoadmapStorySourceCategory[] = [];
  const disabledCategories: RoadmapStorySourceCategory[] = [];
  for (const c of allCats) {
    if (isCategoryEnabled(config, c)) selectedCategories.push(c);
    else disabledCategories.push(c);
  }

  const warnings: string[] = [];
  const coverageNotes: string[] = [];
  const sources: RoadmapStorySourceSnapshot["sources"] = {};

  if (!preview) {
    warnings.push(
      "Source data is still loading. The snapshot below shows only the Story Pack configuration.",
    );
  }
  if (previewWarnings.reportingError) {
    warnings.push("Reporting summaries could not be loaded for all workspaces in scope.");
  }

  // ---- program_project_overview ---------------------------------------
  if (!selectedCategories.includes("program_project_overview")) {
    sources.program_project_overview = disabledBlock("program_project_overview", L.projects);
  } else if (!preview) {
    sources.program_project_overview = unavailableBlock(
      "program_project_overview",
      L.projects,
      "Roadmap reporting is still loading.",
    );
  } else {
    const rows = preview.controlBoard.rows;
    const items: StoryProjectOverviewItem[] = cap(rows, L.projects).map((r) => ({
      projectId: r.projectId,
      projectName: r.projectName,
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName,
      programId: r.programId,
      programName: r.programName,
      status: r.statusLabel,
      health: r.healthLabel,
      scheduleSignal: r.scheduleLabel,
      completionPercent: r.completionPercent,
      startDate: r.startDate,
      targetEndDate: r.targetEndDate,
      // 6B.6a — Project description is not currently exposed by the
      // control-board source rows; mark detail as unavailable rather than
      // inventing text. A dedicated authorized fetch would be required to
      // surface `projects.description` here in the future.
      detail: makeDetail(null),
      // 6D.7A — Portfolio context from authorized control-board rows.
      portfolioItemId: r.portfolioItemId ?? null,
      portfolioName: r.portfolioName ?? null,
      portfolioCode: r.portfolioCode ?? null,
      portfolioLifecycleState: r.portfolioLifecycleState ?? null,
      portfolioIsArchived: r.portfolioIsArchived ?? null,
    }));
    const truncated = rows.length > L.projects;
    sources.program_project_overview = {
      category: "program_project_overview",
      enabled: true,
      status: items.length === 0 ? "empty" : truncated ? "partial" : "ready",
      count: rows.length,
      limit: L.projects,
      items,
      coverageNotes: truncated
        ? [`Only the first ${L.projects} of ${rows.length} projects are included.`]
        : [],
      evidenceRefs: items.map((i) => ({ kind: "project", id: i.projectId, label: i.projectName })),
    };
  }

  // ---- planning_phases_tasks (6B.5b) ---------------------------------
  // Bounded planning view assembled from the existing authorized
  // `list_decrypted_project_phases` / `list_decrypted_project_tasks` RPCs,
  // fanned out per scoped project. Story-useful prioritization is applied
  // before truncation; raw planning dumps are not produced.
  if (!selectedCategories.includes("planning_phases_tasks")) {
    sources.planning_phases_tasks = disabledBlock("planning_phases_tasks", L.phases + L.tasks);
  } else if (!preview) {
    sources.planning_phases_tasks = unavailableBlock(
      "planning_phases_tasks",
      L.phases + L.tasks,
      "Roadmap reporting is still loading — planning data will appear once the scope resolves.",
    );
  } else if (!planning) {
    sources.planning_phases_tasks = unavailableBlock(
      "planning_phases_tasks",
      L.phases + L.tasks,
      "Planning source is enabled but the planning hook has not been wired into this composer call.",
    );
  } else {
    const projectNameById = new Map<string, string>();
    for (const r of preview.controlBoard.rows) projectNameById.set(r.projectId, r.projectName);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const phaseNameById = new Map<string, string>();
    const allPhases: StoryPlanningItem[] = [];
    const allTasks: StoryPlanningItem[] = [];

    const isPhaseDone = (s: string) => s === "completed" || s === "done";
    const isTaskDone = (s: string) =>
      s === "completed" || s === "done" || s === "closed";
    const isCancelled = (s: string) =>
      s === "cancelled" || s === "canceled" || s === "archived";
    const isInProgress = (s: string) =>
      s === "in_progress" || s === "active" || s === "in-progress";

    const parseDate = (d: string | null): Date | null => {
      if (!d) return null;
      const dt = new Date(d);
      return Number.isNaN(dt.getTime()) ? null : dt;
    };

    for (const [pid, phases] of planning.phasesByProjectId) {
      const pname = projectNameById.get(pid) ?? "Project";
      for (const ph of phases) {
        phaseNameById.set(ph.id, ph.name);
        const end = parseDate(ph.target_end_date);
        const done = isPhaseDone(ph.status);
        const cancelled = isCancelled(ph.status);
        const overdue = !done && !cancelled && !!end && end < today;
        allPhases.push({
          itemType: "phase",
          itemId: ph.id,
          projectId: pid,
          projectName: pname,
          parentPhaseId: null,
          parentPhaseName: null,
          name: ph.name,
          status: ph.status,
          priority: null,
          startDate: ph.start_date,
          endDate: ph.target_end_date,
          actualStartDate: ph.actual_start_date,
          actualEndDate: ph.actual_end_date,
          sortOrder: ph.sort_order,
          updatedAt: ph.updated_at,
          isOverdue: overdue,
          isCompleted: done,
          isInProgress: isInProgress(ph.status),
          detail: makeDetail(ph.description),
        });
      }
    }

    for (const [pid, tasks] of planning.tasksByProjectId) {
      const pname = projectNameById.get(pid) ?? "Project";
      for (const t of tasks) {
        const due = parseDate(t.due_date);
        const done = isTaskDone(t.status);
        const cancelled = isCancelled(t.status);
        const overdue = !done && !cancelled && !!due && due < today;
        allTasks.push({
          itemType: "task",
          itemId: t.id,
          projectId: pid,
          projectName: pname,
          parentPhaseId: t.phase_id,
          parentPhaseName: t.phase_id ? phaseNameById.get(t.phase_id) ?? null : null,
          name: t.name,
          status: t.status,
          priority: t.priority,
          startDate: t.start_date,
          endDate: t.due_date,
          actualStartDate: t.actual_start_date,
          actualEndDate: t.actual_end_date,
          sortOrder: t.sort_order,
          updatedAt: t.updated_at,
          isOverdue: overdue,
          isCompleted: done,
          isInProgress: isInProgress(t.status),
          detail: makeDetail(t.description),
        });
      }
    }

    // Story-useful ordering: attention first, then deterministic.
    const taskScore = (i: StoryPlanningItem): number => {
      if (i.isOverdue) return 0;
      if (!i.isCompleted && (i.priority === "high" || i.priority === "critical" || i.priority === "urgent"))
        return 1;
      if (!i.isCompleted && i.endDate) return 2;
      if (i.isInProgress) return 3;
      if (i.isCompleted) return 5;
      return 4;
    };
    const phaseScore = (i: StoryPlanningItem): number => {
      if (i.isOverdue) return 0;
      if (i.isInProgress) return 1;
      if (!i.isCompleted) return 2;
      return 4;
    };
    const cmpDateAsc = (a: string | null, b: string | null) =>
      (a ?? "9999").localeCompare(b ?? "9999");

    allPhases.sort((a, b) => {
      const sa = phaseScore(a);
      const sb = phaseScore(b);
      if (sa !== sb) return sa - sb;
      const d = cmpDateAsc(a.endDate, b.endDate);
      if (d !== 0) return d;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });
    allTasks.sort((a, b) => {
      const sa = taskScore(a);
      const sb = taskScore(b);
      if (sa !== sb) return sa - sb;
      const d = cmpDateAsc(a.endDate, b.endDate);
      if (d !== 0) return d;
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    });

    const phaseItems = allPhases.slice(0, L.phases);
    const taskItems = allTasks.slice(0, L.tasks);
    const items: StoryPlanningItem[] = [...phaseItems, ...taskItems];

    const totalPhases = allPhases.length;
    const totalTasks = allTasks.length;
    const overdueTasks = allTasks.filter((t) => t.isOverdue).length;
    const overduePhases = allPhases.filter((p) => p.isOverdue).length;
    const inProgressTasks = allTasks.filter((t) => t.isInProgress).length;
    const completedTasks = allTasks.filter((t) => t.isCompleted).length;

    const truncatedPhases = totalPhases > L.phases;
    const truncatedTasks = totalTasks > L.tasks;
    const truncated = truncatedPhases || truncatedTasks;

    const status: StorySourceBlockStatus = planning.isError
      ? "unavailable"
      : items.length === 0
        ? "empty"
        : planning.failedProjectIds.length > 0 || truncated
          ? "partial"
          : "ready";

    const notes: string[] = [
      `Planning covers ${planning.resolvedProjectCount} project(s) in scope · ${totalPhases} phase(s), ${totalTasks} task(s) loaded (open + completed).`,
      `Attention: ${overduePhases} overdue phase(s), ${overdueTasks} overdue task(s), ${inProgressTasks} task(s) in progress, ${completedTasks} task(s) completed.`,
    ];
    if (truncated) {
      notes.push(
        `Planning source reached the preview limit; only the first ${L.phases} of ${totalPhases} phases and ${L.tasks} of ${totalTasks} tasks are included after attention-first ordering.`,
      );
    }
    if (planning.failedProjectIds.length > 0) {
      notes.push(
        `Planning could not be loaded for ${planning.failedProjectIds.length} project(s); coverage is partial.`,
      );
    }
    notes.push(
      "Archived phases/tasks are excluded. Names are decrypted server-side through existing authorized RPCs.",
    );

    sources.planning_phases_tasks = {
      category: "planning_phases_tasks",
      enabled: true,
      status,
      count: totalPhases + totalTasks,
      limit: L.phases + L.tasks,
      items,
      coverageNotes: notes,
      evidenceRefs: items.map((i) => ({
        kind: i.itemType,
        id: i.itemId,
        label: i.name,
      })),
    };
  }

  // ---- progress_updates (only activity events are available — partial) ----
  if (!selectedCategories.includes("progress_updates")) {
    sources.progress_updates = disabledBlock("progress_updates", L.activity);
  } else if (!preview) {
    sources.progress_updates = unavailableBlock(
      "progress_updates",
      L.activity,
      "Progress activity is still loading.",
    );
  } else {
    const p = preview.progressSinceLast;
    // 6B.5d — Real progress / execution-update signals only. Generic audit
    // events stay in `activity_history`. Heuristics use raw `event_type` and
    // the bucketed `category` already classified by the Status Pack derivation.
    const classify = (
      e: (typeof p.completedDelivered)[number],
    ): StoryProgressUpdateItem => {
      const et = (e.eventType || "").toLowerCase();
      const isCompletion =
        e.category === "completed_delivered" ||
        et.includes("complete") ||
        et.includes("done") ||
        et.includes("closed") ||
        et.includes("delivered");
      const isDelivery =
        et.includes("deliver") ||
        et.includes("released") ||
        et.includes("shipped");
      const isScheduleMovement =
        e.category === "schedule_movement" ||
        et.includes("schedule") ||
        et.includes("rescheduled") ||
        et.includes("date_changed") ||
        et.includes("moved");
      const isStatusChange =
        et.includes("status") ||
        et.includes("transition") ||
        et.includes("changed_status");
      return {
        id: e.eventId,
        projectName: e.projectName,
        category: e.category,
        eventType: e.eventType,
        // 6B.6a — Roadmap progress events don't currently expose payload
        // title/description fields. Falling back to event type as the title;
        // detail is marked unavailable rather than invented.
        title: e.eventType || null,
        detail: makeDetail(null),
        actorName: null,
        occurredAt: e.occurredAt,
        important: e.important,
        sourceType: "activity_progress_signal",
        isCompletion,
        isDelivery,
        isScheduleMovement,
        isStatusChange,
      };
    };

    // Prioritization: completion/delivery first, then schedule movement,
    // then any other status-change signals already classified in the
    // upstream activity_event stream. Generic governance, risk, and
    // ownership/metadata events are intentionally excluded — they belong
    // in `activity_history`.
    const progressCandidates = [
      ...p.completedDelivered.map(classify),
      ...p.scheduleMovements.map(classify),
    ];
    // Prefer completion / delivery items first, then most recent.
    progressCandidates.sort((a, b) => {
      const ra = a.isCompletion || a.isDelivery ? 0 : a.isScheduleMovement ? 1 : 2;
      const rb = b.isCompletion || b.isDelivery ? 0 : b.isScheduleMovement ? 1 : 2;
      if (ra !== rb) return ra - rb;
      return b.occurredAt.localeCompare(a.occurredAt);
    });
    const totalCandidates = progressCandidates.length;
    const items: StoryProgressUpdateItem[] = cap(progressCandidates, L.activity);
    const truncated = totalCandidates > L.activity;

    const status: StorySourceBlockStatus = p.errored
      ? "unavailable"
      : items.length === 0
        ? "empty"
        : "partial"; // always partial: no dedicated execution-update source yet

    sources.progress_updates = {
      category: "progress_updates",
      enabled: true,
      status,
      count: totalCandidates,
      limit: L.activity,
      items,
      coverageNotes: [
        "No dedicated Roadmap-scope execution update source is connected yet; this block uses progress-like activity signals only (completed / delivered work and schedule movements).",
        "Generic audit events (ownership, metadata, governance, risk/blocker churn) are excluded here and remain in Activity history.",
        ...(truncated
          ? [`Only the first ${L.activity} of ${totalCandidates} progress signals are included after attention-first ordering.`]
          : []),
        p.executionUpdatesNote,
      ],
      evidenceRefs: items.map((i) => ({ kind: "activity_event", id: i.id })),
    };
  }


  // ---- activity_history -----------------------------------------------
  if (!selectedCategories.includes("activity_history")) {
    sources.activity_history = disabledBlock("activity_history", L.activity);
  } else if (!preview) {
    sources.activity_history = unavailableBlock(
      "activity_history",
      L.activity,
      "Activity history is still loading.",
    );
  } else {
    const p = preview.progressSinceLast;
    // 6B.5d — Exclude event IDs already surfaced in progress_updates so the
    // same item is not double-counted across blocks.
    const progressIds = new Set(
      (sources.progress_updates?.items ?? []).map((it) => it.id),
    );
    const all = [
      ...p.completedDelivered,
      ...p.scheduleMovements,
      ...p.governanceDecisionUpdates,
      ...p.riskBlockerKpiChanges,
      ...p.otherRecentActivity,
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const deduped = all.filter((e) => !progressIds.has(e.eventId));
    const items: StoryActivityItem[] = cap(deduped, L.activity).map((e) => ({
      id: e.eventId,
      projectName: e.projectName,
      category: e.category,
      eventType: e.eventType,
      title: e.eventType || null,
      detail: makeDetail(null),
      actorName: null,
      occurredAt: e.occurredAt,
      important: e.important,
    }));
    const truncated = deduped.length > L.activity;
    sources.activity_history = {
      category: "activity_history",
      enabled: true,
      status: items.length === 0 ? "empty" : truncated ? "partial" : "ready",
      count: deduped.length,
      limit: L.activity,
      items,
      coverageNotes: [
        `Lookback: last ${p.period.lookbackDays} days (${p.period.label}).`,
        progressIds.size > 0
          ? `Excludes ${progressIds.size} event(s) already shown under Progress updates to avoid duplication.`
          : "Progress updates and activity history are kept as separate blocks.",
        ...(truncated ? [`Only the first ${L.activity} of ${deduped.length} events are included.`] : []),
      ],
      evidenceRefs: items.map((i) => ({ kind: "activity_event", id: i.id })),
    };
  }


  // ---- discussions_comments (assessed in 6B.5e — kept unavailable) ----
  // Existing comments substrate is per-object only: `list_decrypted_comments`
  // requires a (target_type, target_id) pair and decrypts a single object's
  // thread. There is no roadmap- or project-scope aggregator RPC today.
  // Composing a roadmap-wide comments block from the per-object path would
  // require fanning out one authorized RPC call per project + phase + task +
  // risk + blocker + governance record in scope — excessive fan-out and
  // unsafe to introduce from the frontend. A dedicated SECURITY DEFINER
  // aggregator (e.g. `list_roadmap_story_comments`) with project-access
  // enforcement and server-side decryption would be needed to connect this
  // category safely; see 6B.5e assessment in architecture docs.
  if (!selectedCategories.includes("discussions_comments")) {
    sources.discussions_comments = disabledBlock("discussions_comments", 0);
  } else {
    sources.discussions_comments = unavailableBlock(
      "discussions_comments",
      0,
      "Discussions and comments are not connected. BTPM only exposes a per-object decrypting RPC (list_decrypted_comments); a project/roadmap-scope authorized aggregator is required before this category can safely contribute to the source package.",
    );
  }


  // ---- risks ----------------------------------------------------------
  if (!selectedCategories.includes("risks")) {
    sources.risks = disabledBlock("risks", L.risks);
  } else if (!preview) {
    sources.risks = unavailableBlock("risks", L.risks, "Risks are still loading.");
  } else {
    const rb = preview.risksBlockers;
    const items: StoryRiskItem[] = cap(rb.topRisks, L.risks).map((r) => ({
      id: r.riskId,
      title: r.title,
      projectId: r.projectId,
      projectName: r.projectName,
      status: r.statusLabel,
      severity: r.severityLabel,
      likelihood: r.likelihood ?? "",
      impact: r.impact ?? "",
      mitigation: makeDetail(r.mitigationSummary),
      detail: makeDetail(r.description),
      updatedAt: r.updatedAt,
      isStale: r.isStale,
    }));
    const status: StorySourceBlockStatus = rb.errored
      ? "unavailable"
      : rb.partial
        ? "partial"
        : items.length === 0
          ? "empty"
          : "ready";
    sources.risks = {
      category: "risks",
      enabled: true,
      status,
      count: rb.totalRisks,
      limit: L.risks,
      items,
      coverageNotes: [
        ...(rb.partial ? ["Some scoped projects did not return risks."] : []),
        ...(rb.totalRisks > L.risks
          ? [`Only the top ${L.risks} of ${rb.totalRisks} risks are included.`]
          : []),
      ],
      evidenceRefs: items.map((i) => ({ kind: "risk", id: i.id, label: i.title })),
    };
  }

  // ---- blockers -------------------------------------------------------
  if (!selectedCategories.includes("blockers")) {
    sources.blockers = disabledBlock("blockers", L.blockers);
  } else if (!preview) {
    sources.blockers = unavailableBlock("blockers", L.blockers, "Blockers are still loading.");
  } else {
    const rb = preview.risksBlockers;
    const items: StoryBlockerItem[] = cap(rb.topBlockers, L.blockers).map((b) => ({
      id: b.blockerId,
      title: b.title,
      projectId: b.projectId,
      projectName: b.projectName,
      status: b.statusLabel,
      severity: b.severityLabel,
      detail: makeDetail(b.descriptionSummary),
      updatedAt: b.updatedAt,
      isStale: b.isStale,
    }));
    const status: StorySourceBlockStatus = rb.errored
      ? "unavailable"
      : rb.partial
        ? "partial"
        : items.length === 0
          ? "empty"
          : "ready";
    sources.blockers = {
      category: "blockers",
      enabled: true,
      status,
      count: rb.totalBlockers,
      limit: L.blockers,
      items,
      coverageNotes:
        rb.totalBlockers > L.blockers
          ? [`Only the top ${L.blockers} of ${rb.totalBlockers} blockers are included.`]
          : [],
      evidenceRefs: items.map((i) => ({ kind: "blocker", id: i.id, label: i.title })),
    };
  }

  // ---- dependencies ---------------------------------------------------
  if (!selectedCategories.includes("dependencies")) {
    sources.dependencies = disabledBlock("dependencies", L.dependencies);
  } else if (!preview) {
    sources.dependencies = unavailableBlock(
      "dependencies",
      L.dependencies,
      "Dependencies are still loading.",
    );
  } else {
    const d = preview.dependencies;
    const all = [...d.attentionItems, ...d.inboundItems, ...d.outboundItems, ...d.internalItems];
    const seen = new Set<string>();
    const unique = all.filter((x) => (seen.has(x.dependencyId) ? false : (seen.add(x.dependencyId), true)));
    const items: StoryDependencyItem[] = cap(unique, L.dependencies).map((dep) => ({
      id: dep.dependencyId,
      type: dep.dependencyTypeLabel,
      direction: dep.direction,
      sourceProject: dep.source.projectName,
      targetProject: dep.target.projectName,
      isAttention: dep.isAttention,
      detail: makeDetail(dep.description),
      updatedAt: dep.updatedAt,
    }));
    sources.dependencies = {
      category: "dependencies",
      enabled: true,
      status: d.errored
        ? "unavailable"
        : items.length === 0
          ? "empty"
          : unique.length > L.dependencies
            ? "partial"
            : "ready",
      count: d.totalDependencies,
      limit: L.dependencies,
      items,
      coverageNotes: [
        ...d.coverageNotes,
        "Only project-to-project dependencies are included. Phase- and task-level dependencies are not surfaced at Roadmap scope yet.",
      ],
      evidenceRefs: items.map((i) => ({ kind: "dependency", id: i.id })),
    };
  }

  // ---- kpis_snapshots -------------------------------------------------
  if (!selectedCategories.includes("kpis_snapshots")) {
    sources.kpis_snapshots = disabledBlock("kpis_snapshots", L.kpis);
  } else if (!preview) {
    sources.kpis_snapshots = unavailableBlock("kpis_snapshots", L.kpis, "KPIs are still loading.");
  } else {
    const k = preview.kpis;
    const items: StoryKpiItem[] = cap(k.allItems, L.kpis).map((kpi) => ({
      id: kpi.definitionId,
      name: kpi.name,
      projectId: kpi.projectId,
      projectName: kpi.projectName,
      unit: kpi.unit,
      target: kpi.targetValue,
      latestValue: kpi.latestValue,
      latestValueSource: kpi.latestValueSource,
      latestValueDate: kpi.latestValueDate,
      status: kpi.status,
      trend: kpi.trend,
      detail: makeDetail(kpi.description),
    }));
    sources.kpis_snapshots = {
      category: "kpis_snapshots",
      enabled: true,
      status: k.errored
        ? "unavailable"
        : k.updatesPartial
          ? "partial"
          : items.length === 0
            ? "empty"
            : k.totalKpis > L.kpis
              ? "partial"
              : "ready",
      count: k.totalKpis,
      limit: L.kpis,
      items,
      coverageNotes: [
        ...k.coverageNotes,
        "Latest value follows the corrected KPI precedence: reportable official snapshot → manual update → definition current value. No silent fallback to older snapshots.",
        ...(k.totalKpis > L.kpis
          ? [`Only the first ${L.kpis} of ${k.totalKpis} KPIs are included.`]
          : []),
      ],
      evidenceRefs: items.map((i) => ({ kind: "kpi_definition", id: i.id, label: i.name })),
    };
  }

  // ---- governance_decisions -------------------------------------------
  if (!selectedCategories.includes("governance_decisions")) {
    sources.governance_decisions = disabledBlock("governance_decisions", L.governance);
  } else if (!preview) {
    sources.governance_decisions = unavailableBlock(
      "governance_decisions",
      L.governance,
      "Governance records are still loading.",
    );
  } else {
    const g = preview.governance;
    const all = [
      ...g.decisionsRequired,
      ...g.recentDecisions,
      ...g.recentGovernanceRecords,
      ...g.overdueOrStaleItems,
      ...g.otherRecords,
    ];
    const seen = new Set<string>();
    const unique = all.filter((x) => (seen.has(x.recordId) ? false : (seen.add(x.recordId), true)));
    const items: StoryGovernanceItem[] = cap(unique, L.governance).map((r) => ({
      id: r.recordId,
      title: r.title,
      projectId: r.projectId,
      projectName: r.projectName,
      kind: r.recordKind,
      category: r.category,
      decisionStatus: r.decisionStatus,
      decisionStage: r.decisionStage,
      occurredAt: r.actualDateHeld,
      targetDecisionDate: r.targetDecisionDate,
      isOverdue: r.isOverdue,
      isStale: r.isStale,
      detail: makeDetail(r.summary),
      decisionQuestion: makeDetail(r.decisionQuestion),
    }));
    sources.governance_decisions = {
      category: "governance_decisions",
      enabled: true,
      status: g.errored
        ? "unavailable"
        : g.partial
          ? "partial"
          : items.length === 0
            ? "empty"
            : g.totalRecords > L.governance
              ? "partial"
              : "ready",
      count: g.totalRecords,
      limit: L.governance,
      items,
      coverageNotes: [
        ...g.coverageNotes,
        "Asks are not inferred from free text — only classified governance records are included.",
      ],
      evidenceRefs: items.map((i) => ({ kind: "governance_record", id: i.id, label: i.title })),
    };
  }

  // ---- team_work ------------------------------------------------------
  if (!selectedCategories.includes("team_work")) {
    sources.team_work = disabledBlock("team_work", L.teamWork);
  } else if (!preview) {
    sources.team_work = unavailableBlock("team_work", L.teamWork, "Team work is still loading.");
  } else {
    const tw = preview.teamWorkSummary;
    const all = [...tw.overdueWork, ...tw.dueSoonWork, ...tw.highPriorityOpenWork];
    const seen = new Set<string>();
    const unique = all.filter((x) => (seen.has(x.taskId) ? false : (seen.add(x.taskId), true)));
    // 6B.6a — Enrich team-work tasks with descriptions from the authorized
    // planning source (`list_decrypted_project_tasks`) by ID match. No new
    // reads; uses data the user is already authorized to see.
    const taskDescById = new Map<string, string | null>();
    if (planning) {
      for (const tasks of planning.tasksByProjectId.values()) {
        for (const t of tasks) {
          taskDescById.set(t.id, t.description ?? null);
        }
      }
    }
    const items: StoryTeamWorkItem[] = cap(unique, L.teamWork).map((t) => ({
      id: t.taskId,
      taskName: t.taskName,
      projectName: t.projectName,
      assigneeName: t.assigneeName,
      status: t.taskStatus,
      dueDate: t.dueDate,
      isOverdue: t.isOverdue,
      isBlocked: t.isBlocked,
      isHighPriority: t.isHighPriority,
      detail: makeDetail(taskDescById.get(t.taskId) ?? null),
    }));
    sources.team_work = {
      category: "team_work",
      enabled: true,
      status: tw.errored
        ? "unavailable"
        : tw.partial
          ? "partial"
          : items.length === 0
            ? "empty"
            : "ready",
      count: tw.totalOpen,
      limit: L.teamWork,
      items,
      coverageNotes: [
        `Aggregate open: ${tw.totalOpen} · overdue: ${tw.overdueCount} · due soon (${tw.dueSoonWindowDays}d): ${tw.dueSoonCount}.`,
        ...(unique.length > L.teamWork
          ? [`Only the first ${L.teamWork} attention-first work items are included.`]
          : []),
      ],
      evidenceRefs: items.map((i) => ({ kind: "task", id: i.id, label: i.taskName })),
    };
  }

  // ---- documents_metadata --------------------------------------------
  // For now this category maps to the Story Pack linked SharePoint file
  // references. Project-bound SharePoint document metadata outside Story
  // Pack linked files is not connected to this composer yet.
  if (!selectedCategories.includes("documents_metadata")) {
    sources.documents_metadata = disabledBlock("documents_metadata", L.files);
  } else {
    const files = config.external_files.filter((f) => f.include_in_story);
    const items: StoryFileItem[] = cap(files, L.files).map((f) => ({
      id: f.id,
      displayName: f.display_name,
      webUrl: f.web_url,
      mimeType: f.mime_type,
      sizeBytes: f.size_bytes,
      userNote: f.user_note ? truncateText(f.user_note) : null,
      includeInStory: f.include_in_story,
    }));
    sources.documents_metadata = {
      category: "documents_metadata",
      enabled: true,
      status: items.length === 0 ? "empty" : "ready",
      count: files.length,
      limit: L.files,
      items,
      coverageNotes: [
        "Includes Story Pack linked SharePoint files (metadata only — no file bytes are read).",
        "Project-bound SharePoint document metadata outside Story Pack linked files is not connected to this composer yet.",
      ],
      evidenceRefs: items.map((i) => ({
        kind: "sharepoint_file",
        id: i.id,
        label: i.displayName ?? undefined,
      })),
    };
  }

  // ---- external_context (Story Pack notes + linked files) -------------
  if (!selectedCategories.includes("external_context")) {
    sources.external_context = disabledBlock("external_context", L.notes + L.files);
  } else {
    const includedNotes = config.notes.filter((n) => n.include_in_story);
    const includedFiles = config.external_files.filter((f) => f.include_in_story);
    const noteItems: StoryNoteItem[] = cap(includedNotes, L.notes).map((n) => ({
      id: n.id,
      label: n.label,
      body: truncateText(n.body),
      includeInStory: n.include_in_story,
    }));
    const fileItems: StoryFileItem[] = cap(includedFiles, L.files).map((f) => ({
      id: f.id,
      displayName: f.display_name,
      webUrl: f.web_url,
      mimeType: f.mime_type,
      sizeBytes: f.size_bytes,
      userNote: f.user_note ? truncateText(f.user_note) : null,
      includeInStory: f.include_in_story,
    }));
    const combined = [...noteItems, ...fileItems];
    sources.external_context = {
      category: "external_context",
      enabled: true,
      status: combined.length === 0 ? "empty" : "ready",
      count: includedNotes.length + includedFiles.length,
      limit: L.notes + L.files,
      items: combined,
      coverageNotes: [
        `User guidance: ${intent.guidance ? "included" : "none"}.`,
        `User notes: ${noteItems.length} of ${includedNotes.length} included (limit ${L.notes}).`,
        `Linked files: ${fileItems.length} of ${includedFiles.length} included (limit ${L.files}, metadata only).`,
      ],
      evidenceRefs: [
        ...noteItems.map((n) => ({ kind: "story_note", id: n.id, label: n.label ?? undefined })),
        ...fileItems.map((f) => ({
          kind: "sharepoint_file",
          id: f.id,
          label: f.displayName ?? undefined,
        })),
      ],
    };
  }

  // ---- Counts, coverage rollup ----------------------------------------
  const counts: Partial<Record<RoadmapStorySourceCategory, number>> = {};
  // 6B.6a — Detail truncation rollup: when any item in a block carries a
  // truncated detail/mitigation/decisionQuestion, append a single coverage
  // note so the user (and the LLM prompt) knows detail was bounded.
  const TRUNC_NOTE =
    "Some object details were truncated to keep the source package bounded.";
  for (const cat of allCats) {
    const b = (sources as Record<string, StorySourceBlock | undefined>)[cat];
    counts[cat] = b?.count ?? 0;
    if (b?.status === "unavailable" && b.enabled) {
      coverageNotes.push(`${cat}: ${b.coverageNotes[0] ?? "Not connected yet."}`);
    }
    if (b && Array.isArray(b.items) && b.items.length > 0) {
      const anyTruncated = (b.items as unknown[]).some((it) => {
        if (!it || typeof it !== "object") return false;
        const o = it as Record<string, unknown>;
        const fields = ["detail", "mitigation", "decisionQuestion"];
        return fields.some((f) => {
          const v = o[f] as { truncated?: boolean } | undefined;
          return !!(v && v.truncated);
        });
      });
      if (anyTruncated && !b.coverageNotes.includes(TRUNC_NOTE)) {
        (b as unknown as { coverageNotes: string[] }).coverageNotes = [
          ...b.coverageNotes,
          TRUNC_NOTE,
        ];
      }
    }
  }

  return {
    storyPackId,
    generatedAt: new Date().toISOString(),
    scope,
    intent,
    selectedCategories,
    disabledCategories,
    counts,
    coverageNotes,
    warnings,
    sources,
  };
}
