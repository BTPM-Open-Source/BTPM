/**
 * Phase 6B.7a / 6B.7a.2 — Roadmap Story Presentation preview renderer.
 *
 * Digital-first, auto-height visual page rendered from a deterministic
 * blueprint. No AI call. No HTML/CSS comes from the LLM — BTPM owns
 * layout, spacing, and behavior.
 *
 * 6B.7a.2 polish: stronger hero, accent rails per block family, presentation
 * metric tiles, vertical timeline rail, severity-accented risk cards,
 * decision callouts, quieter source-limitations footer, and capped
 * evidence chips with overflow reveal.
 */

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sparkles,
  AlertTriangle,
  Info,
  CheckCircle2,
  Clock,
  ShieldAlert,
  Megaphone,
  Activity,
  ChevronDown,
  ChevronUp,
  FileText,
} from "lucide-react";
import { StoryObjectLink } from "@/components/roadmap-story-pack/presentation/StoryObjectLink";
import type {
  RoadmapStoryPresentationBlueprint,
  RoadmapStoryPresentationBlock,
  HeroTakeawayBlock,
  ExecutiveSignalStripBlock,
  WhatChangedTimelineBlock,
  DeliveryPressurePanelBlock,
  RiskBlockerFocusBlock,
  DecisionRequiredCardsBlock,
  SourceLimitationsFooterBlock,
} from "@/lib/roadmap-story/roadmapStoryPresentationBlueprint";
import {
  btpmStory,
  btpmStoryHeroTone,
  btpmStoryMetricTone,
  btpmStorySeverityAccent,
  btpmStorySeverityBadge,
  btpmStoryPressureChip,
} from "@/lib/roadmap-story/roadmapStoryBtpmBrand";
import {
  PortfolioControlBoardView,
  ProjectCardGridView,
  GanttTimelineView,
  MilestoneRailView,
  StatusCompositionChartView,
  DeliveryProgressChartView,
  RiskSeverityChartView,
  RiskMatrixView,
  KpiCardGridView,
  FileEvidencePanelView,
  BlockNarrativeView,
} from "./RoadmapStoryVisualBlocks";

interface Props {
  blueprint: RoadmapStoryPresentationBlueprint;
}

export function RoadmapStoryPresentationPreview({ blueprint }: Props) {
  const orderedBlocks = useMemo(() => {
    const slotOrder: string[] = [
      "opening", "signals", "portfolio", "timeline", "charts",
      "movement", "delivery", "attention", "kpi", "evidence", "limitations",
    ];
    return [...blueprint.blocks].sort(
      (a, b) => slotOrder.indexOf(a.slotId) - slotOrder.indexOf(b.slotId),
    );
  }, [blueprint.blocks]);

  return (
    <Card className="overflow-hidden border-[#E1E1DC] bg-[#F8F8F6] shadow-none">
      <CardHeader className="pb-3 border-b border-[#E1E1DC] bg-white">
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="h-3 w-1 rounded-full bg-[#ED1C38]" aria-hidden />
              <span className={btpmStory.eyebrow}>Executive Briefing</span>
            </div>
            <CardTitle className="text-lg font-semibold tracking-tight text-[#1C1F3F] flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#ED1C38]" />
              Presentation preview
            </CardTitle>
            <p className="text-[12px] text-[#516490] max-w-2xl leading-relaxed">
              Rendered from the current Story Draft via a deterministic BTPM
              template using BTPM-inspired executive styling. The AI step
              that picks approved visual blocks is not wired yet — BTPM still
              owns all layout and rendering.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <Badge variant="outline" className="text-[10px] border-[#1C1F3F]/30 text-[#1C1F3F] bg-white">
              {blueprint.templateId}
            </Badge>
            <Badge variant="outline" className="text-[10px] border-[#516490]/40 text-[#516490] bg-white">
              density · {blueprint.density}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-5 bg-[#F8F8F6]">
        {blueprint.validation.warnings.length > 0 && (
          <Alert className="border-[#EAC16D]/50 bg-[#EAC16D]/10">
            <Info className="h-4 w-4 text-[#7A5512]" />
            <AlertDescription className="text-[11px] space-y-0.5 text-[#1C1F3F]">
              <div className="font-medium">Adapter notes</div>
              <ul className="list-disc list-inside">
                {blueprint.validation.warnings.slice(0, 5).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {blueprint.validation.warnings.length > 5 && (
                  <li>+{blueprint.validation.warnings.length - 5} more…</li>
                )}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-5">
          {orderedBlocks.map((b, i) => (
            <PresentationBlockRenderer key={`${b.slotId}-${b.blockType}-${i}`} block={b} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function PresentationBlockRenderer({ block }: { block: RoadmapStoryPresentationBlock }) {
  // Phase 6B.7a.4a — narrative is rendered INSIDE each visual card by the
  // block view itself. No external wrapper here; blocks that don't have a
  // narrative simply render their visual.
  // Phase 6B.8c — exported so the read-only Published Story viewer can
  // reuse the exact same block rendering without pulling in Preview
  // header, adapter warnings, or generation debug controls.
  return renderBlockInner(block);
}

export const PRESENTATION_BLOCK_SLOT_ORDER: string[] = [
  "opening", "signals", "portfolio", "timeline", "charts",
  "movement", "delivery", "attention", "kpi", "evidence", "limitations",
];

function renderBlockInner(block: RoadmapStoryPresentationBlock) {
  switch (block.blockType) {
    case "hero_takeaway":
      return <HeroTakeawayBlockView block={block} />;
    case "executive_signal_strip":
      return <ExecutiveSignalStripBlockView block={block} />;
    case "portfolio_control_board":
      return <PortfolioControlBoardView block={block} />;
    case "project_card_grid":
      return <ProjectCardGridView block={block} />;
    case "gantt_timeline":
      return <GanttTimelineView block={block} />;
    case "milestone_rail":
      return <MilestoneRailView block={block} />;
    case "status_composition_chart":
      return <StatusCompositionChartView block={block} />;
    case "delivery_progress_chart":
      return <DeliveryProgressChartView block={block} />;
    case "risk_severity_chart":
      return <RiskSeverityChartView block={block} />;
    case "risk_matrix":
      return <RiskMatrixView block={block} />;
    case "what_changed_timeline":
      return <WhatChangedTimelineBlockView block={block} />;
    case "delivery_pressure_panel":
      return <DeliveryPressurePanelBlockView block={block} />;
    case "risk_blocker_focus":
      return <RiskBlockerFocusBlockView block={block} />;
    case "kpi_card_grid":
      return <KpiCardGridView block={block} />;
    case "decision_required_cards":
      return <DecisionRequiredCardsBlockView block={block} />;
    case "file_evidence_panel":
      return <FileEvidencePanelView block={block} />;
    case "source_limitations_footer":
      return <SourceLimitationsFooterBlockView block={block} />;
    default:
      return null;
  }
}

// ─── Shared visual helpers ────────────────────────────────────────────────

/**
 * Capped evidence chip strip with overflow reveal. Keeps inline noise low
 * while preserving access to every reference on demand.
 */
function EvidenceRefs({ refs, max = 2 }: { refs: string[]; max?: number }) {
  const [open, setOpen] = useState(false);
  if (!refs || refs.length === 0) return null;
  const head = refs.slice(0, max);
  const overflow = refs.length - head.length;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {head.map((r, i) => (
        <EvidenceChip key={`h-${i}`} label={r} />
      ))}
      {overflow > 0 && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          +{overflow} evidence
        </button>
      )}
      {open && refs.slice(max).map((r, i) => (
        <EvidenceChip key={`o-${i}`} label={r} />
      ))}
      {open && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          collapse
        </button>
      )}
    </div>
  );
}

function EvidenceChip({ label }: { label: string }) {
  const isFile = label.startsWith("file:") || label.startsWith("sharepoint:") || /\.[a-z0-9]{2,4}$/i.test(label);
  return (
    <span className="inline-flex max-w-[200px] items-center gap-1 truncate rounded border bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {isFile && <FileText className="h-2.5 w-2.5 shrink-0" />}
      <span className="truncate">{label}</span>
    </span>
  );
}

function useShowMore<T>(items: T[], initial: number, allow: boolean) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded || !allow ? items : items.slice(0, initial);
  const canExpand = allow && items.length > initial;
  return { visible, expanded, setExpanded, canExpand };
}

function SectionHeader({
  icon: Icon,
  label,
  right,
  accentClass = "bg-[#ED1C38]",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  right?: React.ReactNode;
  accentClass?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className={`h-3.5 w-[3px] rounded-sm ${accentClass}`} aria-hidden />
      <Icon className="h-3.5 w-3.5 text-[#516490]" />
      <span className={btpmStory.eyebrow}>{label}</span>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────
const HERO_SUB_MAX = 320;

function HeroTakeawayBlockView({ block }: { block: HeroTakeawayBlock }) {
  const [expanded, setExpanded] = useState(false);
  const tone = block.tone ?? "neutral";
  const t = btpmStoryHeroTone(tone);

  const sub = block.subheadline ?? "";
  const subOverflow = sub.length > HERO_SUB_MAX;
  const displayedSub = expanded || !subOverflow ? sub : sub.slice(0, HERO_SUB_MAX).trimEnd() + "…";

  return (
    <div className={`relative overflow-hidden rounded-xl border ${t.wrap} p-7`}>
      <div className={`absolute inset-y-0 left-0 w-[3px] ${t.rail}`} aria-hidden />
      <div className="absolute top-0 left-0 right-0 h-px bg-[#ED1C38]/40" aria-hidden />
      <div className={`flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] font-semibold ${t.eyebrow}`}>
        <Sparkles className="h-3 w-3" />
        Headline takeaway
        <span className={`ml-1 rounded-sm border px-1.5 py-0 text-[9px] font-semibold uppercase ${t.chip}`}>
          {tone}
        </span>
      </div>
      <h2 className="mt-3 text-[26px] font-bold leading-[1.15] tracking-tight text-[#1C1F3F]">
        {block.headline}
      </h2>
      {sub && (
        <>
          <p className="mt-3 text-[13px] text-[#1C1F3F]/75 whitespace-pre-wrap leading-relaxed max-w-3xl">
            {displayedSub}
          </p>
          {subOverflow && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-6 px-1 text-[11px] text-[#516490] hover:text-[#1C1F3F]"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show less" : "Show more"}
            </Button>
          )}
        </>
      )}
      {block.supportingFacts.length > 0 && (
        <ul className="mt-5 grid gap-2 sm:grid-cols-3">
          {block.supportingFacts.slice(0, 3).map((f, i) => (
            <li
              key={i}
              className="relative rounded-md border border-[#E1E1DC] bg-white px-3 py-2.5 text-[12px] leading-snug shadow-[0_1px_0_rgba(28,31,63,0.04)]"
            >
              <span className="absolute top-0 left-0 h-full w-[2px] bg-[#ED1C38]/70" aria-hidden />
              <div className="text-[9px] uppercase tracking-[0.14em] font-semibold text-[#516490] mb-0.5">
                Fact {i + 1}
              </div>
              <div className="text-[#1C1F3F]">{f}</div>
            </li>
          ))}
        </ul>
      )}
      <EvidenceRefs refs={block.evidenceRefs} max={3} />
    </div>
  );
}

// ─── Signals ─────────────────────────────────────────────────────────────
function ExecutiveSignalStripBlockView({ block }: { block: ExecutiveSignalStripBlock }) {
  if (!block.metrics.length) return null;
  return (
    <div className="rounded-lg border border-[#E1E1DC] bg-white p-5 shadow-[0_1px_0_rgba(28,31,63,0.04)]">
      <SectionHeader icon={Activity} label="Our numbers" accentClass="bg-[#ED1C38]" />
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {block.metrics.map((m, i) => {
          const t = btpmStoryMetricTone(m.status);
          const display = m.value ?? "—";
          return (
            <div key={i} className={`relative rounded-md border px-4 py-3.5 ${t.wrap}`}>
              <span className={`absolute top-0 left-0 h-full w-[2px] ${t.rail}`} aria-hidden />
              <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[#516490]">
                {m.label}
              </div>
              <div className={`mt-1 text-[34px] font-bold leading-none tracking-tight ${t.value}`}>
                {display}
              </div>
              {m.helperText && (
                <div className="mt-1.5 text-[10px] text-[#516490] leading-snug">{m.helperText}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Movement timeline ───────────────────────────────────────────────────
function WhatChangedTimelineBlockView({ block }: { block: WhatChangedTimelineBlock }) {
  const { visible, expanded, setExpanded, canExpand } = useShowMore(
    block.items,
    block.display.initialVisibleItems ?? 4,
    block.display.allowExpand !== false,
  );
  return (
    <div className="rounded-lg border border-[#E1E1DC] bg-white p-5 shadow-[0_1px_0_rgba(28,31,63,0.04)]">
      <SectionHeader icon={Clock} label={block.title} accentClass="bg-[#1C1F3F]" />
      <ol className="relative ml-2 space-y-4 border-l-2 border-[#E1E1DC] pl-5">
        {visible.map((it, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[28px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[#ED1C38] bg-white">
              <span className="h-1.5 w-1.5 rounded-full bg-[#ED1C38]" />
            </span>
            <div className="text-[13px] font-semibold leading-snug text-[#1C1F3F]">{it.label}</div>
            {it.date && (
              <div className="text-[10px] text-[#516490] font-mono uppercase tracking-wide">{it.date}</div>
            )}
            {it.detail && (
              <div className="mt-0.5 text-[12px] text-[#1C1F3F]/70 whitespace-pre-wrap line-clamp-2">
                {it.detail}
              </div>
            )}
            <EvidenceRefs refs={it.evidenceRefs} />
          </li>
        ))}
      </ol>
      {canExpand && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 text-[11px] text-[#516490] hover:text-[#1C1F3F]"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
          {expanded ? "Show less" : `Show ${block.items.length - visible.length} more`}
        </Button>
      )}
      <BlockNarrativeView narrative={block.narrative} variant="footer" />
    </div>
  );
}

// ─── Delivery ────────────────────────────────────────────────────────────
function DeliveryPressurePanelBlockView({ block }: { block: DeliveryPressurePanelBlock }) {
  const { visible, expanded, setExpanded, canExpand } = useShowMore(
    block.pressureItems,
    block.display.initialVisibleItems ?? 6,
    block.display.allowExpand !== false,
  );
  return (
    <div className="rounded-lg border border-[#E1E1DC] bg-white p-5 shadow-[0_1px_0_rgba(28,31,63,0.04)]">
      <SectionHeader icon={CheckCircle2} label={block.title} accentClass="bg-[#516490]" />
      {block.message && (
        <p className="text-[13px] text-[#1C1F3F]/80 whitespace-pre-wrap leading-relaxed line-clamp-3">
          {block.message}
        </p>
      )}
      {visible.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {visible.map((p, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium ${btpmStoryPressureChip(p.status)}`}
            >
              <span>{p.label}</span>
              {p.status && (
                <span className="opacity-70 font-normal">· {p.status.replace("_", " ")}</span>
              )}
            </span>
          ))}
        </div>
      )}
      {canExpand && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 text-[11px] text-[#516490] hover:text-[#1C1F3F]"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : `Show ${block.pressureItems.length - visible.length} more`}
        </Button>
      )}
      <EvidenceRefs refs={block.evidenceRefs} />
      <BlockNarrativeView narrative={block.narrative} variant="footer" />
    </div>
  );
}

// ─── Risks / blockers ────────────────────────────────────────────────────
function RiskBlockerFocusBlockView({ block }: { block: RiskBlockerFocusBlock }) {
  const { visible, expanded, setExpanded, canExpand } = useShowMore(
    block.items,
    block.display.initialVisibleItems ?? 6,
    block.display.allowExpand !== false,
  );
  return (
    <div className="rounded-lg border border-[#E1E1DC] bg-white p-5 shadow-[0_1px_0_rgba(28,31,63,0.04)]">
      <SectionHeader
        icon={ShieldAlert}
        label={block.title}
        accentClass="bg-[#ED1C38]"
        right={
          <Badge variant="outline" className="text-[10px] border-[#1C1F3F]/30 text-[#1C1F3F] bg-white">
            {block.variant}
          </Badge>
        }
      />
      {block.summary && (
        <p className="mb-3 text-[12px] text-[#516490]">{block.summary}</p>
      )}
      <div
        className={
          block.variant === "cards"
            ? "grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
            : "space-y-2"
        }
      >
        {visible.map((it, i) => (
          <div
            key={i}
            className={`rounded-md border border-[#E1E1DC] bg-white p-3 ${btpmStorySeverityAccent(it.severity)}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-[12px] font-semibold leading-snug text-[#1C1F3F]">
                <StoryObjectLink objectRef={it.objectRef}>{it.title}</StoryObjectLink>
              </div>
              {it.severity && it.severity !== "unknown" && (
                <Badge
                  variant="outline"
                  className={`shrink-0 text-[10px] uppercase tracking-wide ${btpmStorySeverityBadge(it.severity)}`}
                >
                  {it.severity}
                </Badge>
              )}
            </div>
            {it.message && (
              <div className="mt-1 text-[11px] text-[#1C1F3F]/70 whitespace-pre-wrap line-clamp-3">
                {it.message}
              </div>
            )}
            {it.action && (
              <div className="mt-1.5 text-[11px] text-[#1C1F3F]">
                <span className="font-semibold">Action:</span> {it.action}
              </div>
            )}
            <EvidenceRefs refs={it.evidenceRefs} />
          </div>
        ))}
      </div>
      {canExpand && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 text-[11px] text-[#516490] hover:text-[#1C1F3F]"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : `Show ${block.items.length - visible.length} more`}
        </Button>
      )}
      <BlockNarrativeView narrative={block.narrative} variant="footer" />
    </div>
  );
}

// ─── Decisions ───────────────────────────────────────────────────────────
function DecisionRequiredCardsBlockView({ block }: { block: DecisionRequiredCardsBlock }) {
  const { visible, expanded, setExpanded, canExpand } = useShowMore(
    block.items,
    block.display.initialVisibleItems ?? 4,
    block.display.allowExpand !== false,
  );
  return (
    <div className="rounded-lg border border-[#E1E1DC] bg-white p-5 shadow-[0_1px_0_rgba(28,31,63,0.04)]">
      <SectionHeader icon={Megaphone} label={block.title} accentClass="bg-[#1C1F3F]" />
      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((it, i) => (
          <div
            key={i}
            className="relative rounded-md border border-[#1C1F3F]/20 bg-gradient-to-br from-[#1C1F3F]/[0.04] to-white p-4 shadow-[0_1px_0_rgba(28,31,63,0.04)]"
          >
            <div className="absolute inset-y-0 left-0 w-[3px] rounded-l-md bg-[#1C1F3F]" aria-hidden />
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="text-[9px] uppercase tracking-[0.14em] font-semibold border-[#ED1C38]/50 text-[#ED1C24] bg-white"
              >
                Decision needed
              </Badge>
            </div>
            <div className="mt-2 text-[13px] font-bold leading-snug text-[#1C1F3F]">
              <StoryObjectLink objectRef={it.objectRef}>{it.title}</StoryObjectLink>
            </div>
            {it.decisionQuestion && (
              <div className="mt-1 text-[11px] italic text-[#516490]">
                “{it.decisionQuestion}”
              </div>
            )}
            <div className="mt-1.5 text-[11px] text-[#1C1F3F]/70 whitespace-pre-wrap line-clamp-3">
              {it.message}
            </div>
            {(it.dueDate || it.impact) && (
              <div className="mt-2 flex flex-wrap gap-1">
                {it.dueDate && (
                  <Badge variant="outline" className="text-[10px] border-[#ED1C38]/50 text-[#ED1C24] bg-white">
                    due {it.dueDate}
                  </Badge>
                )}
                {it.impact && (
                  <Badge variant="outline" className="text-[10px] border-[#516490]/50 text-[#516490] bg-white">
                    impact: {it.impact}
                  </Badge>
                )}
              </div>
            )}
            {it.recommendedAction && (
              <div className="mt-2 rounded-md border border-[#E1E1DC] bg-[#F2F2F2] px-2.5 py-1.5 text-[11px] text-[#1C1F3F]">
                <span className="font-semibold">Recommended:</span> {it.recommendedAction}
              </div>
            )}
            <EvidenceRefs refs={it.evidenceRefs} />
          </div>
        ))}
      </div>
      {canExpand && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 text-[11px] text-[#516490] hover:text-[#1C1F3F]"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : `Show ${block.items.length - visible.length} more`}
        </Button>
      )}
      <BlockNarrativeView narrative={block.narrative} variant="footer" />
    </div>
  );
}

// ─── Limitations footer (mandatory, quiet) ───────────────────────────────
function SourceLimitationsFooterBlockView({ block }: { block: SourceLimitationsFooterBlock }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-dashed border-[#E1E1DC] bg-[#F2F2F2] px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#516490] hover:text-[#1C1F3F]"
      >
        <AlertTriangle className="h-3.5 w-3.5 text-[#516490]" />
        Source limitations
        <Badge variant="outline" className="ml-1 text-[10px] border-[#516490]/40 text-[#516490] bg-white">
          {block.items.length}
        </Badge>
        {block.fileContextSummary && (
          <span className="ml-2 text-[10px] font-normal normal-case tracking-normal text-[#516490]">
            · {block.fileContextSummary}
          </span>
        )}
        <span className="ml-auto">
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </span>
      </button>
      {open && (
        <ul className="mt-2 list-disc list-inside text-[11px] text-[#1C1F3F]/70 space-y-0.5">
          {block.items.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
    </div>
  );
}

