/**
 * Phase 6B.7a / 6B.7a.2 — Roadmap Story Presentation blueprint model.
 *
 * Deterministic in-memory adapter. No AI call. No HTML/CSS comes from the
 * LLM — BTPM renderers own layout and rendering.
 *
 * 6B.7a.2 extends the blueprint with portfolio, timeline, chart, KPI, and
 * file-evidence block types ported (conceptually only) from the existing
 * BTPM PPT decks. The adapter accepts an optional structured
 * `sourceSnapshot` (from the controlled debug RPC) and emits data-rich
 * visual instances when it is available. When it is not, those blocks are
 * either omitted or rendered with a truthful empty state — never with
 * fabricated values.
 */

import type { RoadmapStoryDraftStructured } from "@/lib/roadmapStoryPackService";
import type {
  RoadmapStorySourceSnapshot,
  StoryProjectOverviewItem,
  StoryPlanningItem,
  StoryRiskItem,
  StoryBlockerItem,
  StoryKpiItem,
  StoryGovernanceItem,
  StoryFileItem,
} from "@/lib/roadmap-story/roadmapStorySourceSnapshot";
import type { RoadmapStoryObjectRef } from "@/lib/roadmap-story/roadmapStoryObjectLinks";

// ───────────────────────────────────────────── types

export type RoadmapStoryPresentationTemplateId = "steerco_briefing_v1";
export type RoadmapStoryPresentationDensity = "compact" | "standard" | "detailed";

export type RoadmapStoryPresentationSlotId =
  | "opening"
  | "signals"
  | "portfolio"
  | "timeline"
  | "charts"
  | "movement"
  | "delivery"
  | "attention"
  | "kpi"
  | "evidence"
  | "limitations";

export type RoadmapStoryPresentationBlockType =
  | "hero_takeaway"
  | "executive_signal_strip"
  | "portfolio_control_board"
  | "project_card_grid"
  | "gantt_timeline"
  | "milestone_rail"
  | "status_composition_chart"
  | "delivery_progress_chart"
  | "risk_severity_chart"
  | "risk_matrix"
  | "what_changed_timeline"
  | "delivery_pressure_panel"
  | "risk_blocker_focus"
  | "kpi_card_grid"
  | "decision_required_cards"
  | "file_evidence_panel"
  | "source_limitations_footer";

export interface PresentationDisplayHint {
  initialVisibleItems?: number;
  allowExpand?: boolean;
}

/**
 * Phase 6B.7a.4 — In-block narrative structure.
 *
 * Populated deterministically today from the current Story Draft + source
 * snapshot. Designed so a future compressed-narrative LLM pass can return
 * the same shape (takeaway / summary / implication / action / tone /
 * evidenceRefs) without visual-block rework.
 *
 * Not every block will populate every field — renderers must gracefully
 * omit missing pieces rather than reserve empty space.
 */
export interface BlockNarrative {
  /** Single short executive sentence — the “so what” of this visual. */
  takeaway?: string;
  /** 1–3 short interpretive lines — “what this means”. */
  summary?: string[];
  /** Optional consequence / implication line. */
  implication?: string;
  /** Optional action / next-step line. */
  action?: string;
  /** Optional narrative tone used by renderers for accent styling. */
  tone?: "neutral" | "positive" | "attention" | "risk";
  /** Optional evidence references backing the narrative claims. */
  evidenceRefs?: string[];
}

export interface HeroTakeawayBlock {
  slotId: "opening";
  blockType: "hero_takeaway";
  headline: string;
  subheadline?: string;
  supportingFacts: string[];
  evidenceRefs: string[];
  tone?: "neutral" | "attention" | "positive" | "risk";
}

export interface SignalMetric {
  label: string;
  value: string;
  valueRef?: string;
  status?: "neutral" | "good" | "warning" | "critical";
  helperText?: string;
  evidenceRefs: string[];
}

export interface ExecutiveSignalStripBlock {
  slotId: "signals";
  blockType: "executive_signal_strip";
  metrics: SignalMetric[];
}

export interface PortfolioMiniRoadmapItem {
  label: string;
  date?: string | null;
  projectName?: string;
  tone?: "overdue" | "due_soon" | "neutral";
}

/**
 * 6B.7a.5d — Presentation-specific project item. Wraps a snapshot row and
 * carries a pre-resolved `objectRef` (built at blueprint time using the
 * blueprint's project→workspace resolution, including single-workspace
 * fallback for legacy persisted snapshots that lack row-level workspaceId).
 */
export interface ProjectPresentationItem extends StoryProjectOverviewItem {
  /** Resolved BTPM object ref for the "Open" project action. Null when unsafe to link. */
  objectRef?: RoadmapStoryObjectRef | null;
  /** Workspace id actually used to build the objectRef (may be a fallback). */
  resolvedWorkspaceId?: string | null;
}

export interface PortfolioControlBoardBlock {
  slotId: "portfolio";
  blockType: "portfolio_control_board";
  title: string;
  summary: SignalMetric[];
  needsAttention: ProjectPresentationItem[];
  current: ProjectPresentationItem[];
  upcoming: ProjectPresentationItem[];
  miniRoadmap: PortfolioMiniRoadmapItem[];
  display: PresentationDisplayHint;
  narrative?: BlockNarrative;
}

export interface ProjectCardGridBlock {
  slotId: "portfolio";
  blockType: "project_card_grid";
  title: string;
  items: ProjectPresentationItem[];
  display: PresentationDisplayHint;
  narrative?: BlockNarrative;
}


export interface GanttTimelineRow {
  id: string;
  label: string;
  itemType: "project" | "phase" | "task" | "governance_milestone";
  groupLabel: string;
  startDate: string | null;
  endDate: string | null;
  /** Single-date milestone marker (used when start==end or only one date). */
  milestoneDate?: string | null;
  status: string | null;
  tone: "overdue" | "at_risk" | "in_progress" | "completed" | "planned" | "milestone";
  completionPercent: number | null;
  /** 6B.7a.5 — Structured deep-link ref (project / phase / task / governance). Null when route not resolvable. */
  objectRef?: RoadmapStoryObjectRef | null;
}

export interface GanttTimelineBlock {
  slotId: "timeline";
  blockType: "gantt_timeline";
  title: string;
  rows: GanttTimelineRow[];
  rangeStart: string;
  rangeEnd: string;
  display: PresentationDisplayHint;
  evidenceRefs: string[];
  narrative?: BlockNarrative;
}

export interface MilestoneRailItem {
  id: string;
  label: string;
  date: string;
  projectName?: string;
  tone: "overdue" | "at_risk" | "due_soon" | "future" | "completed";
  evidenceRefs: string[];
}

export interface MilestoneRailBlock {
  slotId: "timeline";
  blockType: "milestone_rail";
  title: string;
  items: MilestoneRailItem[];
  display: PresentationDisplayHint;
  narrative?: BlockNarrative;
}

export interface ChartCategoryDatum {
  label: string;
  value: number;
  tone?: "good" | "warning" | "critical" | "neutral";
}

export interface StatusCompositionChartBlock {
  slotId: "charts";
  blockType: "status_composition_chart";
  title: string;
  health: ChartCategoryDatum[];
  schedule: ChartCategoryDatum[];
  total: number;
  evidenceRefs: string[];
  narrative?: BlockNarrative;
}

export interface DeliveryProgressChartBlock {
  slotId: "charts";
  blockType: "delivery_progress_chart";
  title: string;
  data: ChartCategoryDatum[];
  total: number;
  evidenceRefs: string[];
  narrative?: BlockNarrative;
}

export interface RiskSeverityChartBlock {
  slotId: "charts";
  blockType: "risk_severity_chart";
  title: string;
  risks: ChartCategoryDatum[];
  blockers: ChartCategoryDatum[];
  totalRisks: number;
  totalBlockers: number;
  evidenceRefs: string[];
  narrative?: BlockNarrative;
}

export interface RiskMatrixCellItem {
  id: string;
  title: string;
  severity: string;
  /** 6B.7a.5 — Deep-link ref for the risk. Null when project scope missing. */
  objectRef?: RoadmapStoryObjectRef | null;
}

export interface RiskMatrixBlock {
  slotId: "charts";
  blockType: "risk_matrix";
  title: string;
  /** Row = likelihood (5..1 high→low). Column = impact (1..5 low→high). */
  cells: Array<{
    likelihood: string;
    impact: string;
    count: number;
    items: RiskMatrixCellItem[];
  }>;
  axesLabels: { likelihood: string[]; impact: string[] };
  emptyAxesNote?: string;
  /** Risks with unknown likelihood or unknown impact — not placed on the matrix. */
  unclassifiedCount?: number;
  totalRisks: number;
  evidenceRefs: string[];
  narrative?: BlockNarrative;
}

export interface TimelineItem {
  date?: string;
  label: string;
  detail?: string;
  evidenceRefs: string[];
}

export interface WhatChangedTimelineBlock {
  slotId: "movement";
  blockType: "what_changed_timeline";
  title: string;
  items: TimelineItem[];
  display: PresentationDisplayHint;
  narrative?: BlockNarrative;
}

export interface PressureItem {
  label: string;
  status?: "overdue" | "due_soon" | "blocked" | "at_risk" | "neutral";
  detail?: string;
  evidenceRefs: string[];
}

export interface DeliveryPressurePanelBlock {
  slotId: "delivery";
  blockType: "delivery_pressure_panel";
  title: string;
  message: string;
  pressureItems: PressureItem[];
  nextMilestones: TimelineItem[];
  evidenceRefs: string[];
  display: PresentationDisplayHint;
  narrative?: BlockNarrative;
}

export interface RiskBlockerItem {
  title: string;
  severity?: "critical" | "high" | "medium" | "low" | "unknown";
  status?: string;
  message: string;
  action?: string;
  evidenceRefs: string[];
  /** 6B.7a.5 — Structured deep-link ref (risk or blocker). */
  objectRef?: RoadmapStoryObjectRef | null;
}

export interface RiskBlockerFocusBlock {
  slotId: "attention";
  blockType: "risk_blocker_focus";
  variant: "cards" | "grouped" | "ranked_list";
  title: string;
  summary?: string;
  items: RiskBlockerItem[];
  evidenceRefs: string[];
  display: PresentationDisplayHint;
  narrative?: BlockNarrative;
}

export interface KpiCardItem {
  id: string;
  name: string;
  projectName: string;
  unit: string | null;
  latestValue: number | null;
  target: number | null;
  status: string;
  trend: string;
  latestValueDate: string | null;
  detail?: string | null;
  /** 6B.7a.5 — Deep-link to the project KPI section. */
  objectRef?: RoadmapStoryObjectRef | null;
}

export interface KpiCardGridBlock {
  slotId: "kpi";
  blockType: "kpi_card_grid";
  title: string;
  items: KpiCardItem[];
  display: PresentationDisplayHint;
  evidenceRefs: string[];
  narrative?: BlockNarrative;
}

export interface DecisionRequiredItem {
  title: string;
  decisionQuestion?: string;
  message: string;
  dueDate?: string;
  impact?: string;
  recommendedAction?: string;
  evidenceRefs: string[];
  /** 6B.7a.5 — Deep-link to governance record / decision case. */
  objectRef?: RoadmapStoryObjectRef | null;
}

export interface DecisionRequiredCardsBlock {
  slotId: "attention";
  blockType: "decision_required_cards";
  title: string;
  items: DecisionRequiredItem[];
  evidenceRefs: string[];
  display: PresentationDisplayHint;
  narrative?: BlockNarrative;
}

export interface FileEvidenceItem {
  alias: string;
  displayName: string | null;
  status: string;
  inputKind: string;
  mimeType: string | null;
  sizeBytes: number | null;
  skipReason: string | null;
  /**
   * 6B.7a.5 — Optional SharePoint webUrl. Only populated for structured file
   * references that already carry a safe webUrl; never synthesized.
   */
  objectRef?: RoadmapStoryObjectRef | null;
}

export interface FileEvidencePanelBlock {
  slotId: "evidence";
  blockType: "file_evidence_panel";
  title: string;
  files: FileEvidenceItem[];
  totals: { included: number; sent: number; skipped: number; totalBytesSent: number };
  display: PresentationDisplayHint;
  evidenceRefs: string[];
  narrative?: BlockNarrative;
}

export interface SourceLimitationsFooterBlock {
  slotId: "limitations";
  blockType: "source_limitations_footer";
  items: string[];
  fileContextSummary?: string;
  evidenceRefs: string[];
}

export type RoadmapStoryPresentationBlock =
  | HeroTakeawayBlock
  | ExecutiveSignalStripBlock
  | PortfolioControlBoardBlock
  | ProjectCardGridBlock
  | GanttTimelineBlock
  | MilestoneRailBlock
  | StatusCompositionChartBlock
  | DeliveryProgressChartBlock
  | RiskSeverityChartBlock
  | RiskMatrixBlock
  | WhatChangedTimelineBlock
  | DeliveryPressurePanelBlock
  | RiskBlockerFocusBlock
  | KpiCardGridBlock
  | DecisionRequiredCardsBlock
  | FileEvidencePanelBlock
  | SourceLimitationsFooterBlock;

export interface RoadmapStoryPresentationBlueprint {
  schemaVersion: "roadmap_story_presentation_v1";
  templateId: RoadmapStoryPresentationTemplateId;
  title: string;
  subtitle?: string;
  density: RoadmapStoryPresentationDensity;
  generatedFrom: {
    versionId?: string;
    aiRunId?: string;
    source: "deterministic_story_adapter";
  };
  blocks: RoadmapStoryPresentationBlock[];
  validation: {
    valid: boolean;
    warnings: string[];
  };
}

// ───────────────────────────────────────────── template rules

const TEMPLATE_SLOT_RULES: Record<
  RoadmapStoryPresentationTemplateId,
  Record<RoadmapStoryPresentationSlotId, RoadmapStoryPresentationBlockType[]>
> = {
  steerco_briefing_v1: {
    opening: ["hero_takeaway"],
    signals: ["executive_signal_strip"],
    portfolio: ["portfolio_control_board", "project_card_grid"],
    timeline: ["gantt_timeline", "milestone_rail"],
    charts: [
      "status_composition_chart",
      "delivery_progress_chart",
      "risk_severity_chart",
      "risk_matrix",
    ],
    movement: ["what_changed_timeline"],
    delivery: ["delivery_pressure_panel"],
    attention: ["risk_blocker_focus", "decision_required_cards"],
    kpi: ["kpi_card_grid"],
    evidence: ["file_evidence_panel"],
    limitations: ["source_limitations_footer"],
  },
};

// ───────────────────────────────────────────── helpers

const MAX_HEADLINE = 140;
const MAX_TEXT = 600;

function truncate(s: string | null | undefined, max = MAX_TEXT): string {
  if (!s) return "";
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function matchSection(
  sections: RoadmapStoryDraftStructured["sections"] | undefined,
  keywords: string[],
): { heading: string; body: string; evidenceRefs: string[] } | null {
  if (!Array.isArray(sections)) return null;
  for (const s of sections) {
    const h = (s?.heading ?? "").toLowerCase();
    if (keywords.some((k) => h.includes(k))) {
      return {
        heading: s?.heading ?? "",
        body: s?.body ?? "",
        evidenceRefs: Array.isArray(s?.evidenceRefs) ? s!.evidenceRefs! : [],
      };
    }
  }
  return null;
}

function splitConservatively(body: string, max = 4): string[] {
  if (!body) return [];
  const lines = body
    .split(/\n+/)
    .map((l) => l.replace(/^[\-\*•\d\.\)]+\s*/, "").trim())
    .filter((l) => l.length > 0);
  if (lines.length >= 2) return lines.slice(0, max);
  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return sentences.slice(0, max);
}

function sourceItemCount<T>(block: { items?: readonly T[] } | null | undefined): number {
  return Array.isArray(block?.items) ? block.items.length : 0;
}

// ───────────────────────────────────────────── tone / classifiers

const OVERDUE_HEALTH = new Set(["red", "critical", "off_track"]);
const AT_RISK_HEALTH = new Set(["amber", "yellow", "at_risk", "warning"]);
const GOOD_HEALTH = new Set(["green", "on_track", "good"]);

function projectTone(p: StoryProjectOverviewItem): "overdue" | "at_risk" | "completed" | "in_progress" | "planned" {
  const h = (p.health ?? "").toLowerCase();
  const s = (p.status ?? "").toLowerCase();
  const sched = (p.scheduleSignal ?? "").toLowerCase();
  if (OVERDUE_HEALTH.has(h) || sched.includes("overdue")) return "overdue";
  if (s.includes("complete")) return "completed";
  if (AT_RISK_HEALTH.has(h) || sched.includes("at_risk") || sched.includes("at risk")) return "at_risk";
  if (s.includes("progress") || s.includes("active") || s.includes("execution")) return "in_progress";
  return "planned";
}

function severityKey(s: string | undefined | null): "critical" | "high" | "medium" | "low" | "unknown" {
  const v = (s ?? "").toLowerCase();
  if (v.includes("critical")) return "critical";
  if (v.includes("high")) return "high";
  if (v.includes("medium") || v.includes("moderate")) return "medium";
  if (v.includes("low")) return "low";
  return "unknown";
}

function severityTone(s: string | undefined | null): "good" | "warning" | "critical" | "neutral" {
  const k = severityKey(s);
  if (k === "critical") return "critical";
  if (k === "high") return "warning";
  if (k === "medium") return "neutral";
  return "neutral";
}

function parseISO(d: string | null | undefined): Date | null {
  if (!d) return null;
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ───────────────────────────────────────────── narrative helpers (6B.7a.4)
//
// Deterministic composers of BlockNarrative from current Story Draft +
// source snapshot. Shape matches the future compressed-narrative LLM
// contract (takeaway / summary / implication / action / tone /
// evidenceRefs) so visual blocks won't need rework when that pass lands.

function pickFromSectionsAsTakeaway(
  sections: RoadmapStoryDraftStructured["sections"] | undefined,
  keywords: string[],
  maxLen = 200,
): string | undefined {
  const sec = matchSection(sections, keywords);
  if (!sec) return undefined;
  const first = splitConservatively(sec.body, 1)[0];
  const t = truncate(first || sec.body, maxLen);
  return t || undefined;
}

function trimNarrative(n: BlockNarrative): BlockNarrative | undefined {
  const cleaned: BlockNarrative = {};
  if (n.takeaway) cleaned.takeaway = truncate(n.takeaway, 220);
  if (n.summary && n.summary.length > 0) {
    cleaned.summary = n.summary
      .map((s) => truncate(s, 200))
      .filter((s) => s.length > 0)
      .slice(0, 3);
    if (cleaned.summary.length === 0) delete cleaned.summary;
  }
  if (n.implication) cleaned.implication = truncate(n.implication, 220);
  if (n.action) cleaned.action = truncate(n.action, 220);
  if (n.tone) cleaned.tone = n.tone;
  if (n.evidenceRefs && n.evidenceRefs.length > 0) cleaned.evidenceRefs = n.evidenceRefs.slice(0, 6);
  const hasAny =
    !!cleaned.takeaway ||
    (cleaned.summary && cleaned.summary.length > 0) ||
    !!cleaned.implication ||
    !!cleaned.action;
  return hasAny ? cleaned : undefined;
}

// ───────────────────────────────────────────── adapter

export interface BuildBlueprintMetadata {
  versionId?: string;
  aiRunId?: string;
  sourceManifest?: Record<string, unknown> | null;
  fileManifestSummary?: {
    included_count?: number;
    sent_count?: number;
    skipped_count?: number;
    total_bytes_sent?: number;
    files?: Array<{
      attachment_alias?: string;
      display_name?: string | null;
      status?: string;
      input_kind?: string;
      mime_type?: string | null;
      size_bytes?: number | null;
      skip_reason?: string | null;
      /** Safe SharePoint webUrl when available. Never synthesized. */
      webUrl?: string | null;
    }>;
  } | null;
  density?: RoadmapStoryPresentationDensity;
  /**
   * 6B.7a.2 — Optional decrypted source snapshot from the latest version
   * (via the controlled debug RPC). When provided, the adapter emits
   * data-rich visual instances (portfolio, gantt, charts, KPIs, etc).
   * When absent, those blocks are either omitted or rendered with a
   * truthful empty state.
   */
  sourceSnapshot?: RoadmapStorySourceSnapshot | null;
}

export function buildDeterministicRoadmapStoryPresentationBlueprint(
  parsedStory: RoadmapStoryDraftStructured | null | undefined,
  metadata?: BuildBlueprintMetadata,
): RoadmapStoryPresentationBlueprint {
  const warnings: string[] = [];
  const blocks: RoadmapStoryPresentationBlock[] = [];
  const density: RoadmapStoryPresentationDensity = metadata?.density ?? "standard";
  const snap = metadata?.sourceSnapshot ?? null;
  // 6B.7a.5 — projectId → workspaceId lookup shared across visual blocks for
  // deep-link resolution. Empty when no snapshot is available.
  const projectWorkspaceMap = new Map<string, string>();
  const capturedWorkspaceIds = Array.isArray(snap?.scope?.captured?.workspaceIds)
    ? snap.scope.captured.workspaceIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  const legacyWorkspaceIds = Array.isArray(snap?.scope?.workspaceIds)
    ? snap.scope.workspaceIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
  const singleScopedWorkspaceId = capturedWorkspaceIds.length === 1
    ? capturedWorkspaceIds[0]
    : legacyWorkspaceIds.length === 1
      ? legacyWorkspaceIds[0]
      : null;
  const workspaceForProject = (projectId: string | null | undefined): string | null => {
    if (!projectId) return null;
    return projectWorkspaceMap.get(projectId) ?? singleScopedWorkspaceId;
  };
  if (snap) {
    for (const p of (snap.sources.program_project_overview?.items ?? []) as StoryProjectOverviewItem[]) {
      if (p.workspaceId) projectWorkspaceMap.set(p.projectId, p.workspaceId);
    }
  }

  if (!snap) {
    warnings.push(
      "Structured source snapshot not loaded — portfolio, timeline, chart, and KPI visuals fall back to truthful empty states until the latest version's snapshot can be read.",
    );
  }

  const title = truncate(parsedStory?.title || "Roadmap Story — Presentation preview", MAX_HEADLINE);
  const subtitle = "Deterministic BTPM rendering of the current Story Draft";

  // 1) hero_takeaway
  const execSummary = truncate(parsedStory?.executiveSummary ?? "", MAX_TEXT);
  const supportingFacts: string[] = [];
  if (Array.isArray(parsedStory?.sections)) {
    for (const s of parsedStory!.sections!.slice(0, 3)) {
      const first = splitConservatively(s?.body ?? "", 1)[0];
      if (first) supportingFacts.push(truncate(first, 180));
      if (supportingFacts.length >= 3) break;
    }
  }
  if (!execSummary && supportingFacts.length === 0) {
    warnings.push("Hero block: no executive summary or supporting facts available.");
  }
  blocks.push({
    slotId: "opening",
    blockType: "hero_takeaway",
    headline: truncate(parsedStory?.title || "Roadmap Story", MAX_HEADLINE),
    subheadline: execSummary || undefined,
    supportingFacts: supportingFacts.slice(0, 3),
    evidenceRefs: [],
    tone: "neutral",
  });

  // 2) executive_signal_strip — presentation metrics must match the concrete
  // source rows available to the rendered story. Do not use manifest `count`
  // values here: those are broader source totals and can exceed the bounded
  // items actually included in the Story Pack preview (for example 31 total
  // portfolio risks vs 8 story-included risks).
  const signalMetrics: SignalMetric[] = [];
  if (snap) {
    const projects = snap.sources.program_project_overview?.items ?? [];
    const risksBlock = snap.sources.risks;
    const blockersBlock = snap.sources.blockers;
    const planning = snap.sources.planning_phases_tasks;
    const files = metadata?.fileManifestSummary ?? null;
    signalMetrics.push({
      label: "Projects in scope",
      value: String(snap.scope.effective.projectCount || projects.length),
      status: "neutral",
      evidenceRefs: [],
    });
    if (risksBlock) {
      const risks = risksBlock.items as StoryRiskItem[];
      const open = sourceItemCount(risksBlock);
      const critical = risks.filter((r) => severityKey(r.severity) === "critical").length;
      signalMetrics.push({
        label: "Risks",
        value: String(open),
        helperText: critical > 0 ? `${critical} critical` : undefined,
        status: critical > 0 ? "critical" : open > 0 ? "warning" : "neutral",
        evidenceRefs: [],
      });
    }
    if (blockersBlock) {
      const blockers = sourceItemCount(blockersBlock);
      signalMetrics.push({
        label: "Blockers",
        value: String(blockers),
        status: blockers > 0 ? "warning" : "good",
        evidenceRefs: [],
      });
    }
    if (planning) {
      const planningItems = planning.items as StoryPlanningItem[];
      const overdue = planningItems.filter((p) => p.isOverdue).length;
      signalMetrics.push({
        label: "Planning items",
        value: String(planningItems.length),
        helperText: overdue > 0 ? `${overdue} overdue` : undefined,
        status: overdue > 0 ? "warning" : "neutral",
        evidenceRefs: [],
      });
    }
    if (files && (files.included_count || files.sent_count)) {
      const included = files.included_count ?? 0;
      const sent = files.sent_count ?? 0;
      const skipped = files.skipped_count ?? 0;
      signalMetrics.push({
        label: "Files read",
        value: included > 0 ? `${sent}/${included}` : String(sent),
        helperText: skipped > 0 ? `${skipped} skipped` : "all readable",
        status: skipped > 0 ? "warning" : "neutral",
        evidenceRefs: [],
      });
    }
  }
  if (signalMetrics.length > 0) {
    blocks.push({ slotId: "signals", blockType: "executive_signal_strip", metrics: signalMetrics });
  } else {
    warnings.push("Signal strip: no structured counts available — block omitted.");
  }

  // 3) portfolio_control_board + project_card_grid (require snapshot)
  if (snap?.sources.program_project_overview && snap.sources.program_project_overview.items.length > 0) {
    const rawProjects = snap.sources.program_project_overview.items as StoryProjectOverviewItem[];
    // 6B.7a.5d — Attach a pre-resolved objectRef to every project row using
    // the blueprint's workspace resolver. This lets the presentation open
    // pill work for legacy persisted snapshots where p.workspaceId is
    // missing but a single workspace is safely scoped.
    const decorate = (p: StoryProjectOverviewItem): ProjectPresentationItem => {
      const wsId = p.workspaceId ?? workspaceForProject(p.projectId) ?? null;
      const objectRef: RoadmapStoryObjectRef | null = wsId
        ? { type: "project", id: p.projectId, projectId: p.projectId, workspaceId: wsId, label: p.projectName }
        : null;
      return { ...p, resolvedWorkspaceId: wsId, objectRef };
    };
    const projects = rawProjects.map(decorate);
    const needsAttention: ProjectPresentationItem[] = [];
    const current: ProjectPresentationItem[] = [];
    const upcoming: ProjectPresentationItem[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const p of projects) {
      const tone = projectTone(p);
      const start = parseISO(p.startDate);
      if (tone === "overdue" || tone === "at_risk") needsAttention.push(p);
      else if (start && start > today) upcoming.push(p);
      else current.push(p);
    }
    const totalProjects = projects.length;
    const summary: SignalMetric[] = [
      { label: "In portfolio", value: String(totalProjects), evidenceRefs: [] },
      {
        label: "Needs attention",
        value: String(needsAttention.length),
        status: needsAttention.length > 0 ? "warning" : "good",
        evidenceRefs: [],
      },
      { label: "Currently active", value: String(current.length), evidenceRefs: [] },
      { label: "Upcoming", value: String(upcoming.length), evidenceRefs: [] },
    ];
    const miniRoadmap: PortfolioMiniRoadmapItem[] = projects
      .filter((p) => !!p.targetEndDate)
      .sort((a, b) => (a.targetEndDate ?? "9999").localeCompare(b.targetEndDate ?? "9999"))
      .slice(0, 8)
      .map((p) => {
        const end = parseISO(p.targetEndDate);
        const tone: PortfolioMiniRoadmapItem["tone"] = end && end < today ? "overdue"
          : end && (end.getTime() - today.getTime()) < 14 * 86400000 ? "due_soon"
          : "neutral";
        return {
          label: p.projectName,
          date: p.targetEndDate,
          projectName: p.projectName,
          tone,
        };
      });
    const attnPct = totalProjects > 0 ? Math.round((needsAttention.length / totalProjects) * 100) : 0;
    const portfolioTakeaway = needsAttention.length === 0
      ? `All ${totalProjects} in-scope project${totalProjects === 1 ? "" : "s"} are tracking without red or amber signals.`
      : `${needsAttention.length} of ${totalProjects} project${totalProjects === 1 ? "" : "s"} (${attnPct}%) need attention right now.`;
    const portfolioSummary: string[] = [];
    if (current.length > 0) portfolioSummary.push(`${current.length} actively in delivery, ${upcoming.length} still upcoming.`);
    if (miniRoadmap.filter((m) => m.tone === "overdue").length > 0) {
      portfolioSummary.push(`${miniRoadmap.filter((m) => m.tone === "overdue").length} target date${miniRoadmap.filter((m) => m.tone === "overdue").length === 1 ? "" : "s"} already past due.`);
    } else if (miniRoadmap.filter((m) => m.tone === "due_soon").length > 0) {
      portfolioSummary.push(`${miniRoadmap.filter((m) => m.tone === "due_soon").length} target date${miniRoadmap.filter((m) => m.tone === "due_soon").length === 1 ? "" : "s"} due within 14 days.`);
    }
    const portfolioAction = needsAttention.length > 0
      ? `Focus SteerCo time on the ${Math.min(3, needsAttention.length)} highest-signal project${needsAttention.length === 1 ? "" : "s"} in the Needs-attention column.`
      : undefined;
    blocks.push({
      slotId: "portfolio",
      blockType: "portfolio_control_board",
      title: "Portfolio control board",
      summary,
      needsAttention: needsAttention.slice(0, 6),
      current: current.slice(0, 6),
      upcoming: upcoming.slice(0, 6),
      miniRoadmap,
      display: { initialVisibleItems: 6, allowExpand: true },
      narrative: trimNarrative({
        takeaway: portfolioTakeaway,
        summary: portfolioSummary,
        action: portfolioAction,
        tone: needsAttention.length > 0 ? (attnPct >= 50 ? "risk" : "attention") : "positive",
      }),
    });
    blocks.push({
      slotId: "portfolio",
      blockType: "project_card_grid",
      title: "Projects at a glance",
      items: projects.slice(0, 9),
      display: { initialVisibleItems: 9, allowExpand: true },
      narrative: trimNarrative({
        takeaway: `${totalProjects} project${totalProjects === 1 ? "" : "s"} at a glance — health and completion shown per card.`,
        summary: needsAttention.length > 0
          ? [`${needsAttention.length} card${needsAttention.length === 1 ? "" : "s"} carry amber or red health.`]
          : undefined,
        tone: needsAttention.length > 0 ? "attention" : "neutral",
      }),
    });
  } else if (snap) {
    warnings.push("Portfolio: no projects in scope — control board and project grid omitted.");
  }


  // 4) gantt_timeline (project + phase + task + governance milestone)
  if (snap) {
    const rows: GanttTimelineRow[] = [];
    const projects = (snap.sources.program_project_overview?.items ?? []) as StoryProjectOverviewItem[];
    // 6B.7a.5 — Shared projectId → workspaceId lookup.
    const projectWorkspace = projectWorkspaceMap;
    for (const p of projects) {
      if (!p.startDate && !p.targetEndDate) continue;
      const tone = projectTone(p);
      rows.push({
        id: `project:${p.projectId}`,
        label: p.projectName,
        itemType: "project",
        groupLabel: p.programName ?? p.workspaceName ?? "Projects",
        startDate: p.startDate,
        endDate: p.targetEndDate,
        status: p.status,
        tone: tone === "in_progress" ? "in_progress" : tone === "overdue" ? "overdue" : tone === "at_risk" ? "at_risk" : tone === "completed" ? "completed" : "planned",
        completionPercent: p.completionPercent,
        objectRef: {
          type: "project",
          id: p.projectId,
          projectId: p.projectId,
          workspaceId: p.workspaceId,
          label: p.projectName,
        },
      });
    }
    const planning = (snap.sources.planning_phases_tasks?.items ?? []) as StoryPlanningItem[];
    for (const ph of planning) {
      if (!ph.startDate && !ph.endDate) continue;
      const tone: GanttTimelineRow["tone"] = ph.isOverdue ? "overdue" : ph.isCompleted ? "completed" : ph.isInProgress ? "in_progress" : "planned";
      const wsId = projectWorkspace.get(ph.projectId) ?? singleScopedWorkspaceId;
      rows.push({
        id: `${ph.itemType}:${ph.itemId}`,
        label: ph.name,
        itemType: ph.itemType,
        groupLabel: `${ph.projectName} · ${ph.itemType === "phase" ? "Phases" : "Tasks"}`,
        startDate: ph.startDate,
        endDate: ph.endDate,
        status: ph.status,
        tone,
        completionPercent: null,
        objectRef: wsId
          ? {
              type: ph.itemType,
              id: ph.itemId,
              projectId: ph.projectId,
              workspaceId: wsId,
              label: ph.name,
            }
          : null,
      });
    }
    const governance = (snap.sources.governance_decisions?.items ?? []) as StoryGovernanceItem[];
    for (const g of governance) {
      const d = g.targetDecisionDate || g.occurredAt;
      if (!d) continue;
      const wsId = projectWorkspace.get(g.projectId) ?? singleScopedWorkspaceId;
      rows.push({
        id: `gov:${g.id}`,
        label: g.title,
        itemType: "governance_milestone",
        groupLabel: `${g.projectName} · Governance`,
        startDate: d,
        endDate: d,
        milestoneDate: d,
        status: g.decisionStatus,
        tone: g.isOverdue ? "overdue" : "milestone",
        completionPercent: null,
        objectRef: wsId
          ? {
              type: "governance_record",
              id: g.id,
              projectId: g.projectId,
              workspaceId: wsId,
              governanceKind: g.kind === "decision_case" ? "decision_case" : "evidence_record",
              label: g.title,
            }
          : null,
      });
    }
    if (rows.length > 0) {
      const dates = rows.flatMap((r) => [r.startDate, r.endDate].filter(Boolean) as string[]);
      const sorted = [...dates].sort();
      const rangeStart = sorted[0];
      const rangeEnd = sorted[sorted.length - 1];
      // Pad range by 7 days each side.
      const s = parseISO(rangeStart);
      const e = parseISO(rangeEnd);
      const pad = 7 * 86400000;
      const startISO = s ? isoDay(new Date(s.getTime() - pad)) : rangeStart;
      const endISO = e ? isoDay(new Date(e.getTime() + pad)) : rangeEnd;
      const overdueRows = rows.filter((r) => r.tone === "overdue").length;
      const nowTs = new Date(); nowTs.setHours(0,0,0,0);
      const soonRows = rows.filter((r) => {
        if (r.tone === "overdue" || r.tone === "completed") return false;
        const d = parseISO(r.endDate ?? r.startDate ?? "");
        return !Number.isNaN(d.getTime()) && (d.getTime() - nowTs.getTime()) < 30 * 86400000 && d.getTime() >= nowTs.getTime();
      }).length;
      const spanDays = Math.max(1, Math.round((parseISO(endISO)!.getTime() - parseISO(startISO)!.getTime()) / 86400000));
      const ganttSummary: string[] = [];
      if (soonRows > 0) ganttSummary.push(`${soonRows} row${soonRows === 1 ? "" : "s"} land within the next 30 days.`);
      if (overdueRows > 0) ganttSummary.push(`${overdueRows} row${overdueRows === 1 ? "" : "s"} already past due.`);
      blocks.push({
        slotId: "timeline",
        blockType: "gantt_timeline",
        title: "Timeline",
        rows,
        rangeStart: startISO,
        rangeEnd: endISO,
        display: { initialVisibleItems: 12, allowExpand: true },
        evidenceRefs: [],
        narrative: trimNarrative({
          takeaway: `Portfolio timeline spans roughly ${Math.round(spanDays / 30)} month${Math.round(spanDays / 30) === 1 ? "" : "s"} across ${rows.length} tracked item${rows.length === 1 ? "" : "s"}.`,
          summary: ganttSummary,
          action: overdueRows > 0 ? "Rebaseline or explicitly re-plan overdue rows before the next SteerCo." : undefined,
          tone: overdueRows > 0 ? "risk" : soonRows > 0 ? "attention" : "neutral",
        }),
      });
    } else {
      warnings.push("Gantt timeline: no project, phase, task, or governance dates available — block omitted.");
    }

    // 5) milestone_rail
    const milestones: MilestoneRailItem[] = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (const p of projects) {
      if (!p.targetEndDate) continue;
      const end = parseISO(p.targetEndDate);
      const tone: MilestoneRailItem["tone"] = !end ? "future"
        : end < today ? "overdue"
        : end.getTime() - today.getTime() < 14 * 86400000 ? "due_soon"
        : "future";
      milestones.push({
        id: `pm:${p.projectId}`,
        label: `${p.projectName} target`,
        date: p.targetEndDate,
        projectName: p.projectName,
        tone,
        evidenceRefs: [`project:${p.projectId}`],
      });
    }
    for (const g of governance) {
      const d = g.targetDecisionDate || g.occurredAt;
      if (!d) continue;
      const dt = parseISO(d);
      const tone: MilestoneRailItem["tone"] = g.isOverdue ? "overdue"
        : dt && dt.getTime() - today.getTime() < 14 * 86400000 ? "due_soon"
        : "future";
      milestones.push({
        id: `gm:${g.id}`,
        label: g.title,
        date: d,
        projectName: g.projectName,
        tone,
        evidenceRefs: [`governance_record:${g.id}`],
      });
    }
    milestones.sort((a, b) => a.date.localeCompare(b.date));
    if (milestones.length > 0) {
      const overdueMs = milestones.filter((m) => m.tone === "overdue").length;
      const soonMs = milestones.filter((m) => m.tone === "due_soon").length;
      const nearest = milestones.find((m) => m.tone !== "overdue" && m.tone !== "completed");
      blocks.push({
        slotId: "timeline",
        blockType: "milestone_rail",
        title: "Key dates",
        items: milestones.slice(0, 8),
        display: { initialVisibleItems: 8, allowExpand: false },
        narrative: trimNarrative({
          takeaway: overdueMs > 0
            ? `${overdueMs} key date${overdueMs === 1 ? " is" : "s are"} already past due.`
            : nearest
              ? `Next key date: ${nearest.label}${nearest.projectName ? ` (${nearest.projectName})` : ""}.`
              : `${milestones.length} key date${milestones.length === 1 ? "" : "s"} tracked.`,
          summary: soonMs > 0 ? [`${soonMs} milestone${soonMs === 1 ? "" : "s"} land within 14 days.`] : undefined,
          tone: overdueMs > 0 ? "risk" : soonMs > 0 ? "attention" : "neutral",
        }),
      });
    }
  }

  // 6) status_composition_chart
  if (snap?.sources.program_project_overview && snap.sources.program_project_overview.items.length > 0) {
    const projects = snap.sources.program_project_overview.items as StoryProjectOverviewItem[];
    const healthBuckets = new Map<string, ChartCategoryDatum>();
    const schedBuckets = new Map<string, ChartCategoryDatum>();
    const bump = (m: Map<string, ChartCategoryDatum>, k: string, tone: ChartCategoryDatum["tone"]) => {
      const key = k || "Unknown";
      const cur = m.get(key);
      if (cur) cur.value += 1;
      else m.set(key, { label: key, value: 1, tone });
    };
    for (const p of projects) {
      const h = (p.health ?? "unknown").toLowerCase();
      const tone: ChartCategoryDatum["tone"] = OVERDUE_HEALTH.has(h) ? "critical"
        : AT_RISK_HEALTH.has(h) ? "warning"
        : GOOD_HEALTH.has(h) ? "good"
        : "neutral";
      bump(healthBuckets, p.health ?? "Unknown", tone);
      bump(schedBuckets, p.scheduleSignal ?? "Unknown", "neutral");
    }
    const criticalHealth = Array.from(healthBuckets.values()).filter((v) => v.tone === "critical").reduce((s, v) => s + v.value, 0);
    const warnHealth = Array.from(healthBuckets.values()).filter((v) => v.tone === "warning").reduce((s, v) => s + v.value, 0);
    const goodHealth = Array.from(healthBuckets.values()).filter((v) => v.tone === "good").reduce((s, v) => s + v.value, 0);
    blocks.push({
      slotId: "charts",
      blockType: "status_composition_chart",
      title: "Status composition",
      health: Array.from(healthBuckets.values()),
      schedule: Array.from(schedBuckets.values()),
      total: projects.length,
      evidenceRefs: [],
      narrative: trimNarrative({
        takeaway: criticalHealth > 0
          ? `${criticalHealth} project${criticalHealth === 1 ? " is" : "s are"} red on health; ${warnHealth} amber.`
          : warnHealth > 0
            ? `${warnHealth} project${warnHealth === 1 ? "" : "s"} amber on health, ${goodHealth} on track.`
            : `Portfolio health is currently on track across all ${projects.length} project${projects.length === 1 ? "" : "s"}.`,
        tone: criticalHealth > 0 ? "risk" : warnHealth > 0 ? "attention" : "positive",
      }),
    });
  }

  // 7) delivery_progress_chart from planning items
  if (snap?.sources.planning_phases_tasks && snap.sources.planning_phases_tasks.items.length > 0) {
    const items = snap.sources.planning_phases_tasks.items as StoryPlanningItem[];
    let completed = 0, inProgress = 0, overdue = 0, planned = 0;
    for (const it of items) {
      if (it.isOverdue) overdue += 1;
      else if (it.isCompleted) completed += 1;
      else if (it.isInProgress) inProgress += 1;
      else planned += 1;
    }
    const totalItems = items.length || 1;
    const pct = (n: number) => Math.round((n / totalItems) * 100);
    const dominant = [
      { label: "planned", n: planned },
      { label: "in progress", n: inProgress },
      { label: "overdue", n: overdue },
      { label: "completed", n: completed },
    ].sort((a, b) => b.n - a.n)[0];
    const dpTakeaway = overdue > 0
      ? `${overdue} of ${totalItems} item${totalItems === 1 ? "" : "s"} (${pct(overdue)}%) are overdue — delivery is under pressure.`
      : `Delivery is dominated by ${dominant.label} work (${pct(dominant.n)}%).`;
    const dpSummary: string[] = [];
    if (completed > 0) dpSummary.push(`${pct(completed)}% completed, ${pct(inProgress)}% in progress.`);
    if (planned > inProgress + completed) dpSummary.push(`Execution is back-loaded — planned work still exceeds active + completed.`);
    blocks.push({
      slotId: "charts",
      blockType: "delivery_progress_chart",
      title: "Delivery progress",
      total: items.length,
      data: [
        { label: "Completed", value: completed, tone: "good" },
        { label: "In progress", value: inProgress, tone: "neutral" },
        { label: "Overdue", value: overdue, tone: "critical" },
        { label: "Planned", value: planned, tone: "neutral" },
      ],
      evidenceRefs: [],
      narrative: trimNarrative({
        takeaway: dpTakeaway,
        summary: dpSummary,
        action: overdue > 0 ? "Triage overdue items with owners before the next SteerCo." : undefined,
        tone: overdue > 0 ? "risk" : planned > inProgress + completed ? "attention" : "neutral",
      }),
    });
  }

  // 8) risk_severity_chart
  if (snap && (snap.sources.risks || snap.sources.blockers)) {
    const sevBuckets = (
      items: Array<{ severity: string }>,
    ): ChartCategoryDatum[] => {
      const order: Array<"critical" | "high" | "medium" | "low" | "unknown"> = ["critical", "high", "medium", "low", "unknown"];
      const counts = new Map<string, number>();
      for (const it of items) {
        const k = severityKey(it.severity);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      return order
        .filter((k) => (counts.get(k) ?? 0) > 0)
        .map((k) => ({ label: k, value: counts.get(k) ?? 0, tone: severityTone(k) }));
    };
    const risks = (snap.sources.risks?.items ?? []) as StoryRiskItem[];
    const blockers = (snap.sources.blockers?.items ?? []) as StoryBlockerItem[];
    if (risks.length > 0 || blockers.length > 0) {
      const critRisks = risks.filter((r) => severityKey(r.severity) === "critical").length;
      const highRisks = risks.filter((r) => severityKey(r.severity) === "high").length;
      const critBlockers = blockers.filter((b) => severityKey(b.severity) === "critical").length;
      const sevTakeaway = critRisks > 0 || critBlockers > 0
        ? `${critRisks} critical risk${critRisks === 1 ? "" : "s"}${critBlockers > 0 ? ` and ${critBlockers} critical blocker${critBlockers === 1 ? "" : "s"}` : ""} — top of the severity distribution.`
        : highRisks > 0
          ? `Severity concentration sits at the "high" band (${highRisks} high risk${highRisks === 1 ? "" : "s"}).`
          : `Severity distribution is skewed to medium/low — no critical items open.`;
      blocks.push({
        slotId: "charts",
        blockType: "risk_severity_chart",
        title: "Risk & blocker severity",
        risks: sevBuckets(risks),
        blockers: sevBuckets(blockers),
        // Totals must match the risks/blockers actually included in the story
        // (same rule as the risk matrix), not the broader portfolio count.
        totalRisks: risks.length,
        totalBlockers: blockers.length,
        evidenceRefs: [],
        narrative: trimNarrative({
          takeaway: sevTakeaway,
          tone: critRisks + critBlockers > 0 ? "risk" : highRisks > 0 ? "attention" : "neutral",
        }),
      });
    }
  }

  // 9) risk_matrix — uses likelihood × impact when present
  if (snap?.sources.risks && snap.sources.risks.items.length > 0) {
    const risks = snap.sources.risks.items as StoryRiskItem[];
    const norm = (v: string) => {
      const x = (v ?? "").toLowerCase().trim();
      if (!x) return "unknown";
      if (x.includes("very high") || x.includes("critical")) return "very_high";
      if (x.includes("high")) return "high";
      if (x.includes("medium") || x.includes("moderate")) return "medium";
      if (x.includes("low") && !x.includes("very")) return "low";
      if (x.includes("very low")) return "very_low";
      return "unknown";
    };
    const order = ["very_high", "high", "medium", "low", "very_low"] as const;
    const cellMap = new Map<string, { count: number; items: RiskMatrixCellItem[] }>();
    let hasAxes = false;
    let unclassifiedCount = 0;
    for (const r of risks) {
      const l = norm(r.likelihood);
      const i = norm(r.impact);
      // Do not silently force unknown values into the matrix — count separately.
      if (l === "unknown" || i === "unknown") {
        unclassifiedCount += 1;
        continue;
      }
      hasAxes = true;
      const key = `${l}|${i}`;
      const cur = cellMap.get(key) ?? { count: 0, items: [] };
      cur.count += 1;
      cur.items.push({
        id: r.id,
        title: r.title,
        severity: r.severity,
        objectRef: workspaceForProject(r.projectId)
          ? {
              type: "risk",
              id: r.id,
              projectId: r.projectId,
              workspaceId: workspaceForProject(r.projectId)!,
              label: r.title,
            }
          : null,
      });
      cellMap.set(key, cur);
    }
    const cells: RiskMatrixBlock["cells"] = [];
    for (const l of order) {
      for (const i of order) {
        const k = `${l}|${i}`;
        const c = cellMap.get(k);
        if (c) cells.push({ likelihood: l, impact: i, count: c.count, items: c.items });
        else cells.push({ likelihood: l, impact: i, count: 0, items: [] });
      }
    }
    const classified = risks.length - unclassifiedCount;
    const highLike = new Set(["very_high", "high", "medium"]);
    const hotCount = risks.filter((r) => {
      const l = norm(r.likelihood); const i = norm(r.impact);
      return l !== "unknown" && i !== "unknown" && highLike.has(l) && highLike.has(i);
    }).length;
    const matrixTakeaway = !hasAxes
      ? unclassifiedCount > 0
        ? `${unclassifiedCount} risk${unclassifiedCount === 1 ? "" : "s"} lack likelihood/impact — the matrix cannot rank them until values are set.`
        : `No risks are currently classified by likelihood × impact.`
      : hotCount > 0
        ? `${hotCount} of ${classified} classified risk${classified === 1 ? "" : "s"} sit in the high-likelihood × high-impact quadrant.`
        : `Classified risks are spread across the matrix — no concentration in the high×high quadrant.`;
    blocks.push({
      slotId: "charts",
      blockType: "risk_matrix",
      title: "Risk matrix",
      cells,
      axesLabels: {
        likelihood: ["Very high", "High", "Medium", "Low", "Very low"],
        impact: ["Very low", "Low", "Medium", "High", "Very high"],
      },
      emptyAxesNote: hasAxes
        ? unclassifiedCount > 0
          ? `${unclassifiedCount} risk${unclassifiedCount === 1 ? "" : "s"} not shown — likelihood or impact is unset.`
          : undefined
        : "Risk likelihood and impact values are not set on any in-scope risks. Showing structural matrix only.",
      unclassifiedCount,
      totalRisks: risks.length,
      evidenceRefs: risks.map((r) => `risk:${r.id}`).slice(0, 12),
      narrative: trimNarrative({
        takeaway: matrixTakeaway,
        summary: hotCount > 0
          ? [`Priority mitigation should focus on the top-right quadrant items first.`]
          : undefined,
        implication: unclassifiedCount > 0
          ? `${unclassifiedCount} unclassified risk${unclassifiedCount === 1 ? "" : "s"} sit outside the matrix and could shift the picture once graded.`
          : undefined,
        action: hotCount > 0 ? `Review mitigation ownership for the ${hotCount} top-quadrant risk${hotCount === 1 ? "" : "s"} before the next SteerCo.` : undefined,
        tone: hotCount > 0 ? "risk" : unclassifiedCount > 0 ? "attention" : "neutral",
      }),
    });
  }

  // 10) what_changed_timeline (kept text-based, from draft)
  const changedSec = matchSection(parsedStory?.sections, [
    "what changed", "changes", "progress", "movement", "since last",
  ]);
  if (changedSec) {
    const items = splitConservatively(changedSec.body, 4).map<TimelineItem>((label) => ({
      label: truncate(label, 220),
      evidenceRefs: changedSec.evidenceRefs ?? [],
    }));
    if (items.length === 0 && changedSec.body) {
      items.push({ label: truncate(changedSec.body, 220), evidenceRefs: changedSec.evidenceRefs });
    }
    blocks.push({
      slotId: "movement",
      blockType: "what_changed_timeline",
      title: changedSec.heading || "What changed",
      items,
      display: { initialVisibleItems: 4, allowExpand: true },
      narrative: trimNarrative({
        takeaway: items.length > 0
          ? truncate(items[0].label, 200)
          : truncate(changedSec.body, 200),
        summary: items.length > 1
          ? items.slice(1, 3).map((it) => truncate(it.label, 180))
          : undefined,
        tone: "neutral",
      }),
    });
  }

  // 11) delivery_pressure_panel
  const deliverySec = matchSection(parsedStory?.sections, ["delivery", "planning", "schedule", "execution"]);
  if (deliverySec) {
    // Reuse planning signals from snapshot when available for a data-grounded takeaway.
    let dpTakeaway: string | undefined;
    let dpTone: BlockNarrative["tone"] = "neutral";
    if (snap?.sources.planning_phases_tasks && snap.sources.planning_phases_tasks.items.length > 0) {
      const items = snap.sources.planning_phases_tasks.items as StoryPlanningItem[];
      const overdue = items.filter((p) => p.isOverdue).length;
      const nowTs = Date.now();
      const dueSoon = items.filter((p) => {
        const d = parseISO(p.endDate ?? "");
        return d && !p.isOverdue && !p.isCompleted && d.getTime() - nowTs < 14 * 86400000 && d.getTime() >= nowTs;
      }).length;
      if (overdue > 0) {
        dpTakeaway = `${overdue} planning item${overdue === 1 ? " is" : "s are"} overdue${dueSoon > 0 ? ` and ${dueSoon} more due within 14 days` : ""}.`;
        dpTone = "risk";
      } else if (dueSoon > 0) {
        dpTakeaway = `${dueSoon} planning item${dueSoon === 1 ? "" : "s"} due within 14 days — delivery is loading up.`;
        dpTone = "attention";
      }
    }
    if (!dpTakeaway) {
      dpTakeaway = pickFromSectionsAsTakeaway(parsedStory?.sections, ["delivery", "planning", "schedule"], 200);
    }
    blocks.push({
      slotId: "delivery",
      blockType: "delivery_pressure_panel",
      title: deliverySec.heading || "Delivery / planning position",
      message: truncate(deliverySec.body, 500),
      pressureItems: [],
      nextMilestones: [],
      evidenceRefs: deliverySec.evidenceRefs ?? [],
      display: { initialVisibleItems: 5, allowExpand: true },
      narrative: trimNarrative({
        takeaway: dpTakeaway,
        tone: dpTone,
      }),
    });
  }

  // 12) risk_blocker_focus — prefer snapshot structured rows
  const riskItems: RiskBlockerItem[] = [];
  if (snap?.sources.risks && snap.sources.risks.items.length > 0) {
    for (const r of (snap.sources.risks.items as StoryRiskItem[]).slice(0, 8)) {
      const wsId = workspaceForProject(r.projectId);
      riskItems.push({
        title: truncate(`${r.title} · ${r.projectName}`, 140),
        severity: severityKey(r.severity),
        status: r.status,
        message: r.detail.text ? truncate(r.detail.text, 240) : truncate(`Risk in ${r.projectName}`, 240),
        action: r.mitigation.text ? truncate(r.mitigation.text, 200) : undefined,
        evidenceRefs: [`risk:${r.id}`],
        objectRef: wsId
          ? { type: "risk", id: r.id, projectId: r.projectId, workspaceId: wsId, label: r.title }
          : null,
      });
    }
  }
  if (snap?.sources.blockers && snap.sources.blockers.items.length > 0) {
    for (const b of (snap.sources.blockers.items as StoryBlockerItem[]).slice(0, 4)) {
      const wsId = workspaceForProject(b.projectId);
      riskItems.push({
        title: truncate(`Blocker · ${b.title} · ${b.projectName}`, 140),
        severity: severityKey(b.severity),
        status: b.status,
        message: b.detail.text ? truncate(b.detail.text, 240) : `Blocker in ${b.projectName}`,
        evidenceRefs: [`blocker:${b.id}`],
        objectRef: wsId
          ? { type: "blocker", id: b.id, projectId: b.projectId, workspaceId: wsId, label: b.title }
          : null,
      });
    }
  }
  if (riskItems.length === 0) {
    const riskSec = matchSection(parsedStory?.sections, ["risk", "blocker", "dependency", "dependencies"]);
    if (riskSec) {
      for (const line of splitConservatively(riskSec.body, 6)) {
        riskItems.push({
          title: truncate(line, 120),
          severity: "unknown",
          message: truncate(line, 240),
          evidenceRefs: riskSec.evidenceRefs ?? [],
        });
      }
    }
  }
  if (riskItems.length > 0) {
    const critCount = riskItems.filter((i) => i.severity === "critical").length;
    const highCount = riskItems.filter((i) => i.severity === "high").length;
    const rbTakeaway =
      critCount > 0 ? `${critCount} critical item${critCount === 1 ? "" : "s"} lead the risk & blocker set.`
      : highCount > 0 ? `Attention set led by ${highCount} high-severity item${highCount === 1 ? "" : "s"}.`
      : `${riskItems.length} risk/blocker item${riskItems.length === 1 ? "" : "s"} in focus.`;
    const rbNarrativeAction = pickFromSectionsAsTakeaway(parsedStory?.sections, ["mitigation", "action", "next"], 200);
    blocks.push({
      slotId: "attention",
      blockType: "risk_blocker_focus",
      variant: riskItems.length <= 3 ? "cards" : "ranked_list",
      title: "Risks, blockers, and dependencies",
      summary: riskItems.length > 8 ? `${riskItems.length} items surfaced.` : undefined,
      items: riskItems,
      evidenceRefs: [],
      display: { initialVisibleItems: riskItems.length <= 3 ? riskItems.length : 5, allowExpand: true },
      narrative: trimNarrative({
        takeaway: rbTakeaway,
        action: rbNarrativeAction,
        tone: critCount > 0 ? "risk" : highCount > 0 ? "attention" : "neutral",
      }),
    });
  }

  // 13) kpi_card_grid (snapshot only)
  if (snap?.sources.kpis_snapshots && snap.sources.kpis_snapshots.items.length > 0) {
    const kpis = snap.sources.kpis_snapshots.items as StoryKpiItem[];
    const kpiStatus = (k: StoryKpiItem) => (k.status ?? "").toLowerCase();
    const redKpis = kpis.filter((k) => /red|off/.test(kpiStatus(k))).length;
    const amberKpis = kpis.filter((k) => /amber|at/.test(kpiStatus(k))).length;
    const worst = kpis.find((k) => /red|off/.test(kpiStatus(k))) ?? kpis.find((k) => /amber|at/.test(kpiStatus(k)));
    const kpiTakeaway = redKpis + amberKpis === 0
      ? `All ${kpis.length} KPI${kpis.length === 1 ? "" : "s"} are on-track.`
      : worst
        ? `Weakest signal: ${worst.name}${worst.projectName ? ` (${worst.projectName})` : ""} — ${redKpis} red, ${amberKpis} amber.`
        : `${redKpis} red / ${amberKpis} amber KPI signal${redKpis + amberKpis === 1 ? "" : "s"} across ${kpis.length} tracked.`;
    blocks.push({
      slotId: "kpi",
      blockType: "kpi_card_grid",
      title: "KPI signals",
      items: kpis.slice(0, 12).map((k) => {
        const wsId = workspaceForProject(k.projectId);
        return {
          id: k.id,
          name: k.name,
          projectName: k.projectName,
          unit: k.unit,
          latestValue: k.latestValue,
          target: k.target,
          status: k.status,
          trend: k.trend,
          latestValueDate: k.latestValueDate,
          detail: k.detail.text ?? null,
          objectRef: wsId
            ? { type: "kpi", id: k.id, projectId: k.projectId, workspaceId: wsId, label: k.name }
            : null,
        };
      }),
      display: { initialVisibleItems: 8, allowExpand: true },
      evidenceRefs: kpis.map((k) => `kpi_definition:${k.id}`).slice(0, 12),
      narrative: trimNarrative({
        takeaway: kpiTakeaway,
        tone: redKpis > 0 ? "risk" : amberKpis > 0 ? "attention" : "positive",
      }),
    });
  }

  // 14) decision_required_cards — prefer governance snapshot
  const decisionItems: DecisionRequiredItem[] = [];
  if (snap?.sources.governance_decisions && snap.sources.governance_decisions.items.length > 0) {
    const govs = snap.sources.governance_decisions.items as StoryGovernanceItem[];
    for (const g of govs.filter((x) => x.kind === "decision" || /ask|decision/i.test(x.category)).slice(0, 6)) {
      const wsId = workspaceForProject(g.projectId);
      decisionItems.push({
        title: truncate(`${g.title} · ${g.projectName}`, 140),
        decisionQuestion: g.decisionQuestion.text ?? undefined,
        message: g.detail.text ?? `Decision needed in ${g.projectName}`,
        dueDate: g.targetDecisionDate ?? undefined,
        impact: g.decisionStage ?? undefined,
        evidenceRefs: [`governance_record:${g.id}`],
        objectRef: wsId
          ? {
              type: "governance_record",
              id: g.id,
              projectId: g.projectId,
              workspaceId: wsId,
              governanceKind: g.kind === "decision_case" ? "decision_case" : "evidence_record",
              label: g.title,
            }
          : null,
      });
    }
  }
  if (decisionItems.length === 0) {
    const attention = Array.isArray(parsedStory?.attentionItems) ? parsedStory!.attentionItems! : [];
    const decisionAttn = attention.filter((a) => {
      const t = `${a?.title ?? ""} ${a?.detail ?? ""}`.toLowerCase();
      return /decision|ask|govern|approve|escalat/.test(t);
    });
    for (const a of decisionAttn) {
      decisionItems.push({
        title: truncate(a?.title ?? "Decision required", 120),
        message: truncate(a?.detail ?? a?.title ?? "", 280),
        evidenceRefs: Array.isArray(a?.evidenceRefs) ? a!.evidenceRefs! : [],
      });
    }
  }
  if (decisionItems.length > 0) {
    const overdueDecisions = decisionItems.filter((d) => {
      if (!d.dueDate) return false;
      const dt = parseISO(d.dueDate);
      return dt && dt.getTime() < Date.now();
    }).length;
    blocks.push({
      slotId: "attention",
      blockType: "decision_required_cards",
      title: "Decisions / asks",
      items: decisionItems,
      evidenceRefs: [],
      display: { initialVisibleItems: 3, allowExpand: true },
      narrative: trimNarrative({
        takeaway: `${decisionItems.length} decision${decisionItems.length === 1 ? "" : "s"} or ask${decisionItems.length === 1 ? "" : "s"} require executive attention now.`,
        summary: overdueDecisions > 0
          ? [`${overdueDecisions} decision${overdueDecisions === 1 ? " is" : "s are"} already past its target date.`]
          : undefined,
        action: `Assign owners and target dates before the next SteerCo.`,
        tone: overdueDecisions > 0 ? "risk" : "attention",
      }),
    });
  }

  // 15) file_evidence_panel — from file manifest (sent to AI)
  const fm = metadata?.fileManifestSummary;
  if (fm && Array.isArray(fm.files) && fm.files.length > 0) {
    blocks.push({
      slotId: "evidence",
      blockType: "file_evidence_panel",
      title: "File evidence",
      files: fm.files.map((f) => ({
        alias: f.attachment_alias ?? "",
        displayName: f.display_name ?? null,
        status: f.status ?? "unknown",
        inputKind: f.input_kind ?? "none",
        mimeType: f.mime_type ?? null,
        sizeBytes: f.size_bytes ?? null,
        skipReason: f.skip_reason ?? null,
        objectRef: f.webUrl
          ? {
              type: "file",
              id: f.attachment_alias ?? f.display_name ?? "",
              label: f.display_name ?? f.attachment_alias ?? "Linked file",
              webUrl: f.webUrl,
            }
          : null,
      })),
      totals: {
        included: fm.included_count ?? 0,
        sent: fm.sent_count ?? 0,
        skipped: fm.skipped_count ?? 0,
        totalBytesSent: fm.total_bytes_sent ?? 0,
      },
      display: { initialVisibleItems: 6, allowExpand: true },
      evidenceRefs: [],
      narrative: trimNarrative({
        takeaway: (fm.skipped_count ?? 0) > 0
          ? `${fm.sent_count ?? 0} of ${fm.included_count ?? 0} linked file${(fm.included_count ?? 0) === 1 ? "" : "s"} reached AI; ${fm.skipped_count} skipped.`
          : `${fm.sent_count ?? 0} linked file${(fm.sent_count ?? 0) === 1 ? "" : "s"} were read as evidence for this story.`,
        tone: (fm.skipped_count ?? 0) > 0 ? "attention" : "neutral",
      }),
    });
  } else if (snap?.sources.documents_metadata && snap.sources.documents_metadata.items.length > 0) {
    const docs = snap.sources.documents_metadata.items as StoryFileItem[];
    blocks.push({
      slotId: "evidence",
      blockType: "file_evidence_panel",
      title: "Linked files",
      files: docs.map((d) => ({
        alias: d.id,
        displayName: d.displayName,
        status: "not_included",
        inputKind: "none",
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        skipReason: null,
        objectRef: d.webUrl
          ? {
              type: "file",
              id: d.id,
              label: d.displayName ?? d.id,
              webUrl: d.webUrl,
            }
          : null,
      })),
      totals: { included: docs.length, sent: 0, skipped: 0, totalBytesSent: 0 },
      display: { initialVisibleItems: 6, allowExpand: true },
      evidenceRefs: [],
      narrative: trimNarrative({
        takeaway: `${docs.length} linked file${docs.length === 1 ? " is" : "s are"} referenced on the pack but were not sent to AI in this run.`,
        tone: "neutral",
      }),
    });
  }

  // 16) source_limitations_footer — mandatory
  const limitationItems = Array.isArray(parsedStory?.sourceLimitations)
    ? parsedStory!.sourceLimitations!.map((l) => truncate(l, 280))
    : [];
  if (snap) {
    for (const note of snap.coverageNotes ?? []) {
      const t = truncate(note, 280);
      if (t && !limitationItems.includes(t)) limitationItems.push(t);
    }
  }
  if (limitationItems.length === 0) {
    limitationItems.push(
      "Discussions / comments are not ingested.",
      "Some planning rows may be truncated by source caps.",
    );
    warnings.push("Source limitations: synthesized defaults; no explicit list in draft.");
  }
  let fileContextSummary: string | undefined;
  if (fm) {
    fileContextSummary = `Files: ${fm.sent_count ?? 0} sent, ${fm.skipped_count ?? 0} skipped, of ${fm.included_count ?? 0} included.`;
  }
  blocks.push({
    slotId: "limitations",
    blockType: "source_limitations_footer",
    items: limitationItems,
    fileContextSummary,
    evidenceRefs: [],
  });

  const v = validateRoadmapStoryPresentationBlueprint({
    schemaVersion: "roadmap_story_presentation_v1",
    templateId: "steerco_briefing_v1",
    title,
    subtitle,
    density,
    generatedFrom: {
      versionId: metadata?.versionId,
      aiRunId: metadata?.aiRunId,
      source: "deterministic_story_adapter",
    },
    blocks,
    validation: { valid: true, warnings: [] },
  });
  warnings.push(...v.warnings);

  return {
    schemaVersion: "roadmap_story_presentation_v1",
    templateId: "steerco_briefing_v1",
    title,
    subtitle,
    density,
    generatedFrom: {
      versionId: metadata?.versionId,
      aiRunId: metadata?.aiRunId,
      source: "deterministic_story_adapter",
    },
    blocks,
    validation: { valid: v.valid, warnings },
  };
}

// ───────────────────────────────────────────── validation

export function validateRoadmapStoryPresentationBlueprint(
  bp: RoadmapStoryPresentationBlueprint,
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const rules = TEMPLATE_SLOT_RULES[bp.templateId];
  if (!rules) return { valid: false, warnings: [`Unknown template: ${bp.templateId}`] };

  for (const b of bp.blocks) {
    const allowed = rules[b.slotId];
    if (!allowed) {
      warnings.push(`Block ${b.blockType} uses unknown slot ${b.slotId}.`);
      continue;
    }
    if (!allowed.includes(b.blockType)) {
      warnings.push(`Block ${b.blockType} is not allowed in slot ${b.slotId}.`);
    }
  }

  const hasOpening = bp.blocks.some((b) => b.slotId === "opening");
  if (!hasOpening) warnings.push("Required slot missing: opening (hero_takeaway).");
  const hasLimits = bp.blocks.some((b) => b.slotId === "limitations");
  if (!hasLimits) warnings.push("Required slot missing: limitations (source_limitations_footer).");

  return { valid: warnings.length === 0, warnings };
}

// 6B.7a.2 — Helper for the Preview tab to parse a debug-RPC source snapshot
// JSON string into a typed snapshot. Returns null when malformed.
export function parseRoadmapStorySourceSnapshotJson(
  raw: string | null | undefined,
): RoadmapStorySourceSnapshot | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && (obj as { sources?: unknown }).sources) {
      return obj as RoadmapStorySourceSnapshot;
    }
    return null;
  } catch {
    return null;
  }
}
