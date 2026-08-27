/**
 * Status Pack — typed manifest contract.
 *
 * Configuration-only. A manifest MUST NOT store calculated totals, KPI values,
 * statuses, task/risk/blocker lists, rendered slide content, prose, or any
 * duplicated downstream report state.
 */

/** Canonical Status Pack section IDs. IDs match the shared section registry. */
export type StatusPackSectionId =
  // mandatory (core)
  | "cover_scope"
  | "exec_summary"
  | "scope_data_notes"
  // optional (executive)
  | "control_board"
  | "timeline"
  | "calendar_milestones"
  | "team_work_summary"
  | "risks_blockers"
  | "dependencies"
  | "kpis"
  | "governance"
  | "progress_since_last"
  // optional (appendix)
  | "project_detail_annex"
  | "team_work_detail_annex";

export type StatusPackSectionCategory = "core" | "operational" | "governance" | "appendix";

export type StatusPackResolverStatus = "not_connected_yet" | "placeholder" | "connected";

export type StatusPackScopeKind = "roadmap";

/** Snapshot of currently-applied Roadmap filters (configuration only).
 *  6A.3 — extended with the simple Roadmap filters (status/priority/health/
 *  schedule). These remain configuration-only — never computed totals. */
export interface RoadmapFilterSnapshot {
  workspace_ids?: string[];
  program_ids?: string[];
  project_ids?: string[];
  status_filter?: string;
  priority_filter?: string;
  health_filter?: string;
  schedule_filter?: string;
  /** Phase 6D.7A — canonical Portfolio scope (org-level).
   *  Both optional; older snapshots without these fields default to
   *  All Portfolios. Store real UUIDs only — never the UI sentinel. */
  portfolio_item_ids?: string[];
  include_no_portfolio?: boolean;
}

export type StatusPackPeriodMode = "current" | "previous" | "range";

export interface StatusPackPeriod {
  mode: StatusPackPeriodMode;
  from?: string; // ISO date
  to?: string;   // ISO date
}

export interface RoadmapStatusPackScope {
  kind: "roadmap";
  workspace_ids?: string[];
  program_ids?: string[];
  project_ids?: string[];
  roadmap_filters?: RoadmapFilterSnapshot;
  period?: StatusPackPeriod;
}

export type StatusPackScope = RoadmapStatusPackScope; // only roadmap supported in 6A.2

export interface StatusPackDisplay {
  density?: "comfortable" | "compact";
}

export interface StatusPackAppendix {
  include_detail_annex?: boolean;
  include_team_work_annex?: boolean;
}

export interface RoadmapStatusPackManifest {
  manifest_version: "1";
  scope: RoadmapStatusPackScope;
  selectedSectionIds: StatusPackSectionId[];
  sectionOrder: StatusPackSectionId[];
  display?: StatusPackDisplay;
  appendix?: StatusPackAppendix;
  createdFrom?: "default" | "saved_view" | "import";
  sourceSurface?: "roadmap" | "program" | "project" | "workspace" | "user";
}

export interface StatusPackSectionRegistryEntry {
  id: StatusPackSectionId;
  title: string;
  shortDescription: string;
  mandatory: boolean;
  defaultIncluded: boolean;
  category: StatusPackSectionCategory;
  /** Where this section sits in the presentation flow. */
  placement: "executive" | "appendix";
  /** Supported scopes (first wave: roadmap only). */
  supportedScope: StatusPackScopeKind[];
  /** Real data wiring state — purely informational in 6A.2. */
  resolverStatus: StatusPackResolverStatus;
  /** Order index used to sort sections deterministically. */
  order: number;
  /** Empty-state preview text shown in the preview shell. */
  emptyStateText: string;
}
