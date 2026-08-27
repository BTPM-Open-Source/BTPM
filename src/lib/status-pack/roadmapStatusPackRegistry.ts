/**
 * Canonical Roadmap Status Pack Section Registry.
 *
 * Closed list — new sections require an explicit contract change and regression
 * review. Entries describe configuration, placement, and empty-state text.
 */

import type {
  StatusPackSectionId,
  StatusPackSectionRegistryEntry,
} from "./statusPackTypes";

const PLACEHOLDER_NOTE =
  "Live data is not yet connected for this section.";

export const ROADMAP_STATUS_PACK_SECTION_REGISTRY: readonly StatusPackSectionRegistryEntry[] = [
  {
    id: "cover_scope",
    title: "Cover & Scope",
    shortDescription:
      "Pack title, generated-on date, applied Roadmap scope and filters.",
    mandatory: true,
    defaultIncluded: true,
    category: "core",
    placement: "executive",
    supportedScope: ["roadmap"],
    resolverStatus: "connected",
    order: 10,
    emptyStateText: `Cover slide with scope summary. ${PLACEHOLDER_NOTE}`,
  },
  {
    id: "exec_summary",
    title: "Executive Summary",
    shortDescription:
      "Portfolio health, status, completion, key blockers, overdue, top risks.",
    mandatory: true,
    defaultIncluded: true,
    category: "core",
    placement: "executive",
    supportedScope: ["roadmap"],
    resolverStatus: "connected",
    order: 20,
    emptyStateText: `Executive summary derived from canonical project data. ${PLACEHOLDER_NOTE}`,
  },
  {
    id: "control_board",
    title: "Roadmap Control Board",
    shortDescription:
      "Per-project health, status, completion, schedule signal, owner, stage.",
    mandatory: false,
    defaultIncluded: true,
    category: "operational",
    placement: "executive",
    supportedScope: ["roadmap"],
    resolverStatus: "connected",
    order: 30,
    emptyStateText: `Roadmap control board table. ${PLACEHOLDER_NOTE}`,
  },
  {
    id: "timeline",
    title: "Timeline",
    shortDescription:
      "Project / phase / task date positioning for the current scope.",
    mandatory: false,
    defaultIncluded: true,
    category: "operational",
    placement: "executive",
    supportedScope: ["roadmap"],
    resolverStatus: "connected",
    order: 40,
    emptyStateText: `Timeline view of selected projects and phases. ${PLACEHOLDER_NOTE}`,
  },
  {
    id: "calendar_milestones",
    title: "Calendar / Upcoming Milestones",
    shortDescription: "Upcoming milestones and due items in the period.",
    mandatory: false,
    defaultIncluded: false,
    category: "operational",
    placement: "executive",
    supportedScope: ["roadmap"],
    resolverStatus: "connected",
    order: 50,
    emptyStateText: `Upcoming milestones and due items. ${PLACEHOLDER_NOTE}`,
  },
  {
    id: "team_work_summary",
    title: "Team Work Summary",
    shortDescription:
      "Team workload, overdue work, and upcoming work for the selected Roadmap scope.",
    mandatory: false,
    defaultIncluded: false,
    category: "operational",
    placement: "executive",
    supportedScope: ["roadmap"],
    resolverStatus: "connected",
    order: 60,
    emptyStateText:
      "No open Team Work items for the selected Roadmap scope.",
  },
  {
    id: "risks_blockers",
    title: "Risks & Blockers",
    shortDescription:
      "Active risks and blockers (kept as separate concepts).",
    mandatory: false,
    defaultIncluded: true,
    category: "governance",
    placement: "executive",
    supportedScope: ["roadmap"],
    resolverStatus: "connected",
    order: 70,
    emptyStateText: `Risks and blockers (separate concepts). ${PLACEHOLDER_NOTE}`,
  },
  {
    id: "dependencies",
    title: "Dependencies & Coordination",
    shortDescription:
      "Project-to-project dependencies relevant to the selected Roadmap scope. Phase/task dependencies are not surfaced here yet.",
    mandatory: false,
    defaultIncluded: false,
    category: "governance",
    placement: "executive",
    supportedScope: ["roadmap"],
    resolverStatus: "connected",
    order: 80,
    emptyStateText:
      "No project-to-project dependencies are visible for the selected Roadmap scope.",
  },
  {
    id: "kpis",
    title: "KPIs",
    shortDescription:
      "Current KPI snapshot and update freshness for the selected Roadmap scope. Project-level KPIs only.",
    mandatory: false,
    defaultIncluded: false,
    category: "operational",
    placement: "executive",
    supportedScope: ["roadmap"],
    resolverStatus: "connected",
    order: 90,
    emptyStateText:
      "No project-level KPIs are defined for the selected Roadmap scope.",
  },
  {
    id: "governance",
    title: "Governance / Decisions / Asks",
    shortDescription:
      "Governance records and decision items for the selected Roadmap scope. Asks are not separately classified yet.",
    mandatory: false,
    defaultIncluded: false,
    category: "governance",
    placement: "executive",
    supportedScope: ["roadmap"],
    resolverStatus: "connected",
    order: 100,
    emptyStateText:
      "No governance records are visible for the selected Roadmap scope.",
  },
  {
    id: "progress_since_last",
    title: "Progress Since Last Period",
    shortDescription:
      "Recent progress, changes, and updates for the selected Roadmap scope (default lookback: last 7 days). Derives from canonical BTPM activity events. Execution updates are not separately surfaced in this view yet.",
    mandatory: false,
    defaultIncluded: false,
    category: "operational",
    placement: "executive",
    supportedScope: ["roadmap"],
    resolverStatus: "connected",
    order: 110,
    emptyStateText:
      "No progress events recorded in the last 7 days for the selected Roadmap scope.",
  },
  {
    id: "project_detail_annex",
    title: "Project Detail Annex",
    shortDescription:
      "Bounded per-project canonical detail for the selected Roadmap scope.",
    mandatory: false,
    defaultIncluded: false,
    category: "appendix",
    placement: "appendix",
    supportedScope: ["roadmap"],
    resolverStatus: "connected",
    order: 200,
    emptyStateText:
      "No projects match the current Roadmap filters for the Project Detail Annex.",
  },
  {
    id: "team_work_detail_annex",
    title: "Team Work Detail Annex",
    shortDescription:
      "Detailed work items for the selected Roadmap scope (appendix-only by default).",
    mandatory: false,
    defaultIncluded: false,
    category: "appendix",
    placement: "appendix",
    supportedScope: ["roadmap"],
    resolverStatus: "connected",
    order: 210,
    emptyStateText:
      "No open Team Work items for the selected Roadmap scope.",
  },
  {
    id: "scope_data_notes",
    title: "Scope & Data Notes",
    shortDescription:
      "Scope, source coverage, assumptions, and known limitations for this Status Pack.",
    mandatory: true,
    defaultIncluded: true,
    category: "appendix",
    placement: "appendix",
    supportedScope: ["roadmap"],
    resolverStatus: "connected",
    order: 220,
    emptyStateText:
      "Scope, included sections, connected data sources, period assumptions, caps, and deferred capabilities are listed here.",
  },
];

const REGISTRY_BY_ID: ReadonlyMap<StatusPackSectionId, StatusPackSectionRegistryEntry> =
  new Map(ROADMAP_STATUS_PACK_SECTION_REGISTRY.map((e) => [e.id, e]));

export function getRoadmapStatusPackRegistryEntry(
  id: StatusPackSectionId,
): StatusPackSectionRegistryEntry | undefined {
  return REGISTRY_BY_ID.get(id);
}

export function isKnownRoadmapStatusPackSectionId(
  id: string,
): id is StatusPackSectionId {
  return REGISTRY_BY_ID.has(id as StatusPackSectionId);
}

export function isMandatoryStatusPackSection(id: StatusPackSectionId): boolean {
  return REGISTRY_BY_ID.get(id)?.mandatory === true;
}

export const MANDATORY_ROADMAP_STATUS_PACK_SECTION_IDS: readonly StatusPackSectionId[] =
  ROADMAP_STATUS_PACK_SECTION_REGISTRY.filter((e) => e.mandatory).map((e) => e.id);

export const DEFAULT_INCLUDED_ROADMAP_SECTION_IDS: readonly StatusPackSectionId[] =
  ROADMAP_STATUS_PACK_SECTION_REGISTRY.filter((e) => e.defaultIncluded).map((e) => e.id);
