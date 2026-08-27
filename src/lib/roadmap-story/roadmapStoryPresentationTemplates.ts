/**
 * Phase 6B.7a.2 — Roadmap Story Pack Presentation Visual Template registry.
 *
 * VISUAL TEMPLATE vs VISUAL INSTANCE
 *  - A "visual template" is an implemented React renderer with a typed data
 *    contract, listed in the Visual Library and available whenever the Story
 *    Pack source package supports its required data categories.
 *  - A "visual instance" is the actual block rendered into the current Story
 *    Preview, built from the deterministic adapter using the current Story
 *    Draft, source snapshot, and source manifest.
 *
 * RULES
 *  - Only IMPLEMENTED templates may appear here. There is no "candidate" or
 *    "planned" tier shown to users.
 *  - Template availability is based on what the Story Pack source package
 *    contract can provide, NOT on whether the current sample Story happens
 *    to have rows for that block.
 *  - BTPM owns rendering; the AI never returns HTML/CSS/SVG/chart code.
 *  - Source package data categories listed below correspond exactly to the
 *    canonical `RoadmapStorySourceCategory` set in `roadmapStoryPackService`.
 */

import type { RoadmapStorySourceCategory } from "@/lib/roadmapStoryPackService";

/** Template identifiers — keep stable across releases. */
export type RoadmapStoryPresentationTemplateKey =
  | "hero_takeaway"
  | "executive_signal_strip"
  | "portfolio_control_board"
  | "project_card_grid"
  | "gantt_timeline"
  | "milestone_rail"
  | "what_changed_timeline"
  | "delivery_pressure_panel"
  | "status_composition_chart"
  | "delivery_progress_chart"
  | "risk_severity_chart"
  | "risk_matrix"
  | "risk_blocker_focus"
  | "kpi_card_grid"
  | "decision_required_cards"
  | "file_evidence_panel"
  | "source_limitations_footer";

export interface RoadmapStoryPresentationTemplate {
  id: RoadmapStoryPresentationTemplateKey;
  name: string;
  purpose: string;
  /** Source categories this template draws structured data from. */
  dataCategories: RoadmapStorySourceCategory[];
  /** Always 'available' — candidate templates are not listed. */
  availability: "available";
  /** Visual family tag for grouping in the Library. */
  family:
    | "executive_message"
    | "metrics_signals"
    | "portfolio"
    | "timeline"
    | "charts"
    | "risk_decision"
    | "kpi"
    | "evidence";
}

export const ROADMAP_STORY_PRESENTATION_TEMPLATES: ReadonlyArray<RoadmapStoryPresentationTemplate> = [
  {
    id: "hero_takeaway",
    name: "Hero takeaway",
    purpose: "Headline, sub-headline, and supporting facts for the opening.",
    dataCategories: ["program_project_overview"],
    availability: "available",
    family: "executive_message",
  },
  {
    id: "executive_signal_strip",
    name: "Executive signal strip",
    purpose: "Counter tiles for projects, risks, blockers, planning, files.",
    dataCategories: [
      "program_project_overview",
      "risks",
      "blockers",
      "planning_phases_tasks",
      "documents_metadata",
    ],
    availability: "available",
    family: "metrics_signals",
  },
  {
    id: "portfolio_control_board",
    name: "Portfolio control board",
    purpose: "Needs Attention / Current / Upcoming project columns with a top metric strip.",
    dataCategories: ["program_project_overview"],
    availability: "available",
    family: "portfolio",
  },
  {
    id: "project_card_grid",
    name: "Project card grid",
    purpose: "Compact project cards with status, health, schedule, completion.",
    dataCategories: ["program_project_overview"],
    availability: "available",
    family: "portfolio",
  },
  {
    id: "gantt_timeline",
    name: "Gantt timeline",
    purpose: "Project / phase / task / governance milestone timing with today marker.",
    dataCategories: [
      "program_project_overview",
      "planning_phases_tasks",
      "governance_decisions",
    ],
    availability: "available",
    family: "timeline",
  },
  {
    id: "milestone_rail",
    name: "Milestone rail",
    purpose: "Compact rail of key upcoming dates and gates.",
    dataCategories: [
      "program_project_overview",
      "planning_phases_tasks",
      "governance_decisions",
    ],
    availability: "available",
    family: "timeline",
  },
  {
    id: "what_changed_timeline",
    name: "What changed timeline",
    purpose: "Recent movement, changes, and updates surfaced from the Story Draft.",
    dataCategories: ["program_project_overview", "planning_phases_tasks"],
    availability: "available",
    family: "timeline",
  },
  {
    id: "delivery_pressure_panel",
    name: "Delivery pressure",
    purpose: "Delivery position with overdue and due-soon signals from planning.",
    dataCategories: ["planning_phases_tasks"],
    availability: "available",
    family: "timeline",
  },
  {
    id: "status_composition_chart",
    name: "Status composition",
    purpose: "Project health / status distribution across the portfolio.",
    dataCategories: ["program_project_overview"],
    availability: "available",
    family: "charts",
  },
  {
    id: "delivery_progress_chart",
    name: "Delivery progress",
    purpose: "Completed / in-progress / overdue / planned task distribution.",
    dataCategories: ["planning_phases_tasks", "team_work"],
    availability: "available",
    family: "charts",
  },
  {
    id: "risk_severity_chart",
    name: "Risk severity",
    purpose: "Risk and blocker counts by severity.",
    dataCategories: ["risks", "blockers"],
    availability: "available",
    family: "charts",
  },
  {
    id: "risk_matrix",
    name: "Risk matrix",
    purpose: "Likelihood × impact matrix with risk counts per cell.",
    dataCategories: ["risks"],
    availability: "available",
    family: "risk_decision",
  },
  {
    id: "risk_blocker_focus",
    name: "Risk / blocker focus",
    purpose: "Ranked risk and blocker cards with severity and mitigation.",
    dataCategories: ["risks", "blockers"],
    availability: "available",
    family: "risk_decision",
  },
  {
    id: "kpi_card_grid",
    name: "KPI card grid",
    purpose: "KPI tiles with latest value, target, status, and trend.",
    dataCategories: ["kpis_snapshots"],
    availability: "available",
    family: "kpi",
  },
  {
    id: "decision_required_cards",
    name: "Decisions required",
    purpose: "Decision callouts with question, due date, impact, recommendation.",
    dataCategories: ["governance_decisions"],
    availability: "available",
    family: "risk_decision",
  },
  {
    id: "file_evidence_panel",
    name: "File evidence",
    purpose: "Linked SharePoint files sent to or skipped by generation.",
    dataCategories: ["documents_metadata", "external_context"],
    availability: "available",
    family: "evidence",
  },
  {
    id: "source_limitations_footer",
    name: "Source limitations",
    purpose: "What was and was not read for the story.",
    dataCategories: [],
    availability: "available",
    family: "evidence",
  },
];

export const TEMPLATE_FAMILY_LABELS: Record<RoadmapStoryPresentationTemplate["family"], string> = {
  executive_message: "Executive message",
  metrics_signals: "Metrics & signals",
  portfolio: "Portfolio",
  timeline: "Timeline",
  charts: "Charts",
  risk_decision: "Risks & decisions",
  kpi: "KPIs",
  evidence: "Evidence & limitations",
};
