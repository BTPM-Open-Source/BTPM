/**
 * Phase 6B.7a.2 — Roadmap Story Pack Presentation block renderers.
 *
 * Pure presentation components for the visual templates that were added in
 * 6B.7a.2 (portfolio control board, project card grid, gantt timeline,
 * milestone rail, status composition, delivery progress, risk severity,
 * risk matrix, KPI card grid, file evidence). BTPM owns layout. No
 * HTML/CSS/SVG comes from the AI.
 *
 * Visual patterns are conceptually ported from the existing PPT decks
 * (`generate-roadmap-status-deck`, `generate-project-status-deck`,
 * `generate-decision-case-ppt-onepager`). No `pptxgenjs` is imported.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
// Recharts was previously used for delivery-progress and risk-severity
// charts. Phase 6B.7a.3 replaced those with brand-native capsule/lollipop
// renderers, so no chart library import is needed here.
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Flag,
  Gauge,
  Layers,
  PieChart as PieIcon,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { format, parseISO, differenceInDays } from "date-fns";

import { btpmStory } from "@/lib/roadmap-story/roadmapStoryBtpmBrand";
import {
  StoryObjectLink,
  StoryBlockSourceLinks,
  type StoryBlockSourceLinksGroup,
} from "@/components/roadmap-story-pack/presentation/StoryObjectLink";
import { resolveRoadmapStoryObjectHref } from "@/lib/roadmap-story/roadmapStoryObjectLinks";
import {
  getPmHealthHex,
  getPmWorkflowStatusHex,
  getPmWorkflowStatusLabel,
  getPmWorkflowStatusBadgeClass,
} from "@/lib/btpmVisualSemantics";
import type {
  PortfolioControlBoardBlock,
  ProjectCardGridBlock,
  GanttTimelineBlock,
  GanttTimelineRow,
  MilestoneRailBlock,
  StatusCompositionChartBlock,
  DeliveryProgressChartBlock,
  RiskSeverityChartBlock,
  RiskMatrixBlock,
  KpiCardGridBlock,
  FileEvidencePanelBlock,
  ChartCategoryDatum,
  BlockNarrative,
  ProjectPresentationItem,
} from "@/lib/roadmap-story/roadmapStoryPresentationBlueprint";

import type { RoadmapStoryObjectRef } from "@/lib/roadmap-story/roadmapStoryObjectLinks";


// ─── narrative renderer (6B.7a.4) ─────────────────────────────────────────
/**
 * Shared "story-within-visual" narrative slot. Rendered as a compact
 * side/bottom panel next to the visual, so blocks read as mini briefing
 * panels rather than raw charts.
 *
 * Contract intentionally matches the future compressed-narrative LLM pass
 * (takeaway / summary / implication / action / tone). When a block passes
 * no narrative or an empty one, nothing renders — no reserved space.
 */
export function BlockNarrativeView({
  narrative,
  variant = "aside",
}: {
  narrative?: BlockNarrative;
  variant?: "aside" | "footer";
}) {
  if (!narrative) return null;
  const { takeaway, summary, implication, action, tone } = narrative;
  const hasAny = !!(takeaway || (summary && summary.length > 0) || implication || action);
  if (!hasAny) return null;

  // Phase 6B.7a.6 — tone must carry meaning. Red is reserved for genuine
  // risk/warning/critical/overdue/escalation. Neutral is navy/grey so
  // explanatory panels don't read as alarms.
  const toneClasses = (() => {
    switch (tone) {
      case "risk":
        return {
          wrap: "bg-[#ED1C38]/[0.04] border-[#ED1C38]/25",
          rail: "bg-[#ED1C38]",
          eyebrow: "text-[#ED1C24]",
          bullet: "text-[#ED1C38]",
          actionLabel: "text-[#ED1C24]",
        };
      case "attention":
        return {
          wrap: "bg-[#EAC16D]/[0.08] border-[#EAC16D]/40",
          rail: "bg-[#EAC16D]",
          eyebrow: "text-[#7A5512]",
          bullet: "text-[#B58324]",
          actionLabel: "text-[#7A5512]",
        };
      case "positive":
        return {
          wrap: "bg-[#B5CAC5]/[0.18] border-[#B5CAC5]/60",
          rail: "bg-[#2E7D5B]",
          eyebrow: "text-[#1F5A44]",
          bullet: "text-[#2E7D5B]",
          actionLabel: "text-[#1F5A44]",
        };
      default:
        return {
          wrap: "bg-white border-[#E1E1DC]",
          rail: "bg-[#1C1F3F]",
          eyebrow: "text-[#1C1F3F]",
          bullet: "text-[#516490]",
          actionLabel: "text-[#1C1F3F]",
        };
    }
  })();

  const isFooter = variant === "footer";
  return (
    <aside
      className={`relative overflow-hidden rounded-md border ${toneClasses.wrap} ${isFooter ? "mt-4 p-4" : "p-4"}`}
      aria-label="Block narrative"
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${toneClasses.rail}`} aria-hidden />
      <div className="pl-2 space-y-2">
        <div className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${toneClasses.eyebrow}`}>
          What this means
        </div>
        {takeaway && (
          <p className="text-[15px] font-semibold leading-snug text-[#1C1F3F]">
            {takeaway}
          </p>
        )}
        {summary && summary.length > 0 && (
          <ul className="space-y-1 text-[13px] leading-relaxed text-[#1C1F3F]/85">
            {summary.map((s, i) => (
              <li key={i} className="flex gap-1.5">
                <span className={`${toneClasses.bullet} mt-0.5`}>•</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        )}
        {implication && (
          <p className="text-[13px] leading-relaxed text-[#1C1F3F]/85">
            <span className="font-semibold text-[#1C1F3F]">Implication: </span>
            {implication}
          </p>
        )}
        {action && (
          <p className="text-[13px] leading-relaxed text-[#1C1F3F]">
            <span className={`font-semibold ${toneClasses.actionLabel}`}>Action: </span>
            {action}
          </p>
        )}
      </div>
    </aside>
  );
}

// ─── tone palette ─────────────────────────────────────────────────────────
const COLOR = {
  red: "#ED1C38",
  navy: "#1C1F3F",
  muted: "#516490",
  gold: "#EAC16D",
  teal: "#B5CAC5",
  rose: "#995B5A",
  grey: "#E1E1DC",
} as const;

function toneColor(t: ChartCategoryDatum["tone"]): string {
  switch (t) {
    case "critical": return COLOR.red;
    case "warning": return COLOR.gold;
    case "good": return "#1F8A4C";
    default: return COLOR.muted;
  }
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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return format(parseISO(iso), "MMM d, yyyy"); } catch { return iso; }
}

function fmtMonth(d: Date): string {
  return format(d, "MMM yyyy");
}

/**
 * Format a KPI value for display. Percentages (unit === "%") are rounded
 * to whole numbers per Phase 6B.7a.3. Underlying numeric data is not
 * mutated — this is presentation-only.
 */
function formatKpiValue(
  value: number | string | null | undefined,
  unit: string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return String(value);
  const isPercent = (unit ?? "").trim() === "%";
  if (isPercent) return String(Math.round(num));
  // For non-percent numeric values, avoid scientific noise but keep detail.
  if (Number.isInteger(num)) return String(num);
  return String(Math.round(num * 100) / 100);
}

// ═══ Portfolio control board ═════════════════════════════════════════════
export function PortfolioControlBoardView({ block }: { block: PortfolioControlBoardBlock }) {
  return (
    <div className="rounded-lg border border-[#E1E1DC] bg-white p-5 shadow-[0_1px_0_rgba(28,31,63,0.04)]">
      <SectionHeader icon={Layers} label={block.title} accentClass="bg-[#ED1C38]" />

      <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-4 mb-5">
        {block.summary.map((m, i) => (
          <div key={i} className="rounded-md border border-[#E1E1DC] bg-[#F8F8F6] px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[#516490]">{m.label}</div>
            <div
              className={`mt-0.5 text-[26px] font-bold leading-none tracking-tight ${
                m.status === "critical" ? "text-[#ED1C24]"
                : m.status === "warning" ? "text-[#7A5512]"
                : "text-[#1C1F3F]"
              }`}
            >
              {m.value}
            </div>
            {m.helperText && (
              <div className="mt-1 text-[10px] text-[#516490]">{m.helperText}</div>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <ControlBoardColumn title="Needs attention" tone="critical" projects={block.needsAttention} />
        <ControlBoardColumn title="Currently active" tone="neutral" projects={block.current} />
        <ControlBoardColumn title="Upcoming" tone="muted" projects={block.upcoming} />
      </div>

      {block.miniRoadmap.length > 0 && (
        <div className="mt-5">
          <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[#516490] mb-1.5">Mini roadmap</div>
          <div className="flex flex-wrap gap-1.5">
            {block.miniRoadmap.map((m, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
                  m.tone === "overdue" ? "border-[#ED1C38]/50 text-[#ED1C24] bg-white"
                  : m.tone === "due_soon" ? "border-[#EAC16D]/60 text-[#7A5512] bg-white"
                  : "border-[#E1E1DC] text-[#1C1F3F] bg-white"
                }`}
              >
                <CalendarClock className="h-3 w-3" />
                {m.label}
                {m.date && <span className="text-[10px] text-[#516490] ml-1">· {fmtDate(m.date)}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
      <BlockNarrativeView narrative={block.narrative} variant="footer" />
    </div>
  );
}

function ControlBoardColumn({
  title,
  tone,
  projects,
}: {
  title: string;
  tone: "critical" | "neutral" | "muted";
  projects: ProjectPresentationItem[];
}) {
  const accent =
    tone === "critical" ? "border-l-[3px] border-l-[#ED1C38]"
    : tone === "muted" ? "border-l-[3px] border-l-[#516490]"
    : "border-l-[3px] border-l-[#1C1F3F]";
  return (
    <div className={`rounded-md border border-[#E1E1DC] bg-[#F8F8F6] ${accent} p-3`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.10em] text-[#1C1F3F]">{title}</span>
        <Badge variant="outline" className="text-[10px] border-[#1C1F3F]/30 text-[#1C1F3F] bg-white">
          {projects.length}
        </Badge>
      </div>
      {projects.length === 0 ? (
        <div className="text-[11px] text-[#516490] italic">None</div>
      ) : (
        <ul className="space-y-1.5">
          {projects.map((p) => (
            <li key={p.projectId} className="rounded-sm bg-white border border-[#E1E1DC] px-2 py-1.5">
              <div className="flex items-start gap-1.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold text-[#1C1F3F] truncate" title={p.projectName}>
                    {p.projectName}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[#516490] flex-wrap">
                    {p.programName && <span className="truncate">{p.programName}</span>}
                    {p.health && (
                      <ChipBadge tone={healthChipTone(p.health)} title={`Health: ${p.health}`}>
                        {p.health}
                      </ChipBadge>
                    )}
                    {p.scheduleSignal && (
                      <ChipBadge tone={scheduleChipTone(p.scheduleSignal)} title={`Schedule: ${p.scheduleSignal}`}>
                        {p.scheduleSignal}
                      </ChipBadge>
                    )}
                  </div>
                </div>
                <ProjectOpenAction
                  objectRef={p.objectRef}
                  projectName={p.projectName}
                  size="sm"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ═══ Project card grid ════════════════════════════════════════════════════
export function ProjectCardGridView({ block }: { block: ProjectCardGridBlock }) {
  return (
    <div className="rounded-lg border border-[#E1E1DC] bg-white p-5 shadow-[0_1px_0_rgba(28,31,63,0.04)]">
      <SectionHeader icon={Layers} label={block.title} accentClass="bg-[#1C1F3F]" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {block.items.map((p) => <ProjectCard key={p.projectId} project={p} />)}

      </div>
      <BlockNarrativeView narrative={block.narrative} variant="footer" />
    </div>
  );
}

/**
 * Map a project's health label (from the canonical roadmap reporting
 * summary, via `HEALTH_LABELS` in `HealthScheduleIndicators`) into an
 * BTPM brand traffic-light color. Also accepts raw rag values
 * (`green`/`amber`/`red`) defensively.
 */
function projectHealthColor(healthLabel: string | null | undefined): string {
  const v = (healthLabel ?? "").trim().toLowerCase();
  if (!v) return COLOR.muted;
  if (v === "at risk" || v === "red" || v === "critical" || v.includes("risk"))
    return COLOR.red;
  if (v === "needs attention" || v === "amber" || v === "yellow" || v.includes("attention"))
    return COLOR.gold;
  if (v === "on track" || v === "green" || v === "on_track" || v.includes("track"))
    return "#1F8A4C";
  return COLOR.navy;
}

// ─── traffic-light chip helpers (6B.7a.5c) ────────────────────────────────
// Mirror the semantic mapping used by `HealthScheduleIndicators` on the
// Roadmap Dashboard so project cards read consistently across surfaces.
// Each chip reflects its own dimension — one dimension being red must not
// force the others to red.
type ChipTone = "success" | "warning" | "danger" | "info" | "neutral" | "muted";

const CHIP_TONE_CLASS: Record<ChipTone, string> = {
  // 6B.7a.5d — Strengthened backgrounds/borders + a colored leading dot so
  // traffic-light chips read distinctly at normal (non-hover) size.
  success: "bg-[#DCF1E3] text-[#0F5A2E] border border-[#1F8A4C]",
  warning: "bg-[#FCE7B0] text-[#6B3F00] border border-[#D89A18]",
  danger: "bg-[#FBD3D9] text-[#8C0C1E] border border-[#ED1C38]",
  info: "bg-[#D9E2F5] text-[#0B2A66] border border-[#1C4BBF]",
  neutral: "bg-[#EEF0F5] text-[#1C1F3F] border border-[#1C1F3F]/40",
  muted: "bg-[#F2F2F2] text-[#516490] border border-[#C9CBD1]",
};

const CHIP_DOT_CLASS: Record<ChipTone, string> = {
  success: "bg-[#1F8A4C]",
  warning: "bg-[#D89A18]",
  danger: "bg-[#ED1C38]",
  info: "bg-[#1C4BBF]",
  neutral: "bg-[#1C1F3F]",
  muted: "bg-[#9AA0A8]",
};

function ChipBadge({ tone, children, title }: { tone: ChipTone; children: React.ReactNode; title?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-[2px] text-[10px] font-semibold leading-tight ${CHIP_TONE_CLASS[tone]}`}
      title={title}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${CHIP_DOT_CLASS[tone]}`} aria-hidden />
      {children}
    </span>
  );
}


/**
 * Compatibility fallback for non-PM-workflow status strings. PM workflow
 * statuses (planned/active/completed/on_hold/cancelled) are rendered via the
 * canonical helpers below — never through this tone map.
 */
function statusChipTone(status: string | null | undefined): ChipTone {
  const v = (status ?? "").trim().toLowerCase();
  if (!v) return "muted";
  if (v === "blocked") return "danger";
  return "neutral";
}

const PM_WORKFLOW_KEYS = new Set([
  "planned",
  "active",
  "completed",
  "on_hold",
  "cancelled",
]);

function normalizeWorkflowKey(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (PM_WORKFLOW_KEYS.has(s)) return s;
  // Common aliases produced upstream — map to canonical keys.
  if (s === "in progress" || s === "in_progress") return "active";
  if (s === "complete" || s === "closed") return "completed";
  if (s === "canceled") return "cancelled";
  if (s === "on hold") return "on_hold";
  if (s === "not started") return "planned";
  return null;
}

function WorkflowStatusChip({ status }: { status: string }) {
  const key = normalizeWorkflowKey(status);
  if (!key) {
    return (
      <ChipBadge tone={statusChipTone(status)} title={`Status: ${status}`}>
        {status}
      </ChipBadge>
    );
  }
  const label = getPmWorkflowStatusLabel(key);
  const dot = getPmWorkflowStatusHex(key);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-[2px] text-[10px] font-semibold leading-tight ${getPmWorkflowStatusBadgeClass(key)}`}
      title={`Status: ${label}`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: dot }}
        aria-hidden
      />
      {label}
    </span>
  );
}

function healthChipTone(health: string | null | undefined): ChipTone {
  const v = (health ?? "").trim().toLowerCase();
  if (!v) return "muted";
  if (v === "at risk" || v === "red" || v === "critical" || v.includes("risk")) return "danger";
  if (v === "needs attention" || v === "amber" || v === "yellow" || v.includes("attention")) return "warning";
  if (v === "on track" || v === "green" || v === "healthy" || v === "on_track" || v.includes("track")) return "success";
  return "muted";
}

function scheduleChipTone(sched: string | null | undefined): ChipTone {
  const v = (sched ?? "").trim().toLowerCase();
  if (!v) return "muted";
  if (v.includes("behind")) return "danger";
  if (v === "complete" || v === "completed") return "success";
  if (v === "on track" || v === "on target" || v === "on_track") return "success";
  if (v === "no basis" || v === "no_schedule_basis" || v.includes("no basis")) return "muted";
  return "neutral";
}

/**
 * Compact top-right "Open" pill for a project card. Renders only when a
 * BTPM project route resolves from the structured ref. Never fabricates
 * routes from names.
 */
function ProjectOpenAction({
  objectRef,
  projectName,
  size = "md",
}: {
  objectRef?: RoadmapStoryObjectRef | null;
  projectName: string;
  size?: "sm" | "md";
}) {
  const href = resolveRoadmapStoryObjectHref(objectRef ?? undefined);
  if (!href) return null;
  const cls =
    size === "sm"
      ? "inline-flex items-center gap-1 rounded-full border border-[#0057B8] bg-[#E7ECF7] px-1.5 py-[1px] text-[10px] font-semibold text-[#0057B8] hover:bg-[#0057B8] hover:text-white transition-colors no-underline"
      : "inline-flex items-center gap-1 rounded-full border border-[#0057B8] bg-[#E7ECF7] px-2 py-0.5 text-[11px] font-semibold text-[#0057B8] shadow-[0_1px_0_rgba(28,31,63,0.04)] hover:bg-[#0057B8] hover:text-white transition-colors no-underline";
  return (
    <Link to={href} className={cls} title={`Open ${projectName}`} aria-label={`Open ${projectName}`}>
      Open
      <ExternalLink className="h-3 w-3" aria-hidden />
    </Link>
  );
}

function ProjectCard({ project: p }: { project: ProjectPresentationItem }) {
  const pct = typeof p.completionPercent === "number" ? Math.max(0, Math.min(100, p.completionPercent)) : null;
  const healthColor = projectHealthColor(p.health);
  return (
    <div className="relative rounded-md border border-[#E1E1DC] bg-white p-3 overflow-hidden">
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: healthColor }} aria-hidden />
      <div className="absolute top-2 right-2 z-10">
        <ProjectOpenAction
          objectRef={p.objectRef}
          projectName={p.projectName}
        />
      </div>

      <div className="pl-1.5 pr-16">
        <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[#516490]">
          {p.programName ?? p.workspaceName}
        </div>
        <div className="text-[13px] font-bold text-[#1C1F3F] leading-snug truncate" title={p.projectName}>
          {p.projectName}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {p.status && <WorkflowStatusChip status={p.status} />}
          {p.health && (
            <ChipBadge tone={healthChipTone(p.health)} title={`Health: ${p.health}`}>
              {p.health}
            </ChipBadge>
          )}
          {p.scheduleSignal && (
            <ChipBadge tone={scheduleChipTone(p.scheduleSignal)} title={`Schedule: ${p.scheduleSignal}`}>
              {p.scheduleSignal}
            </ChipBadge>
          )}
        </div>
        {pct !== null && (
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-[10px] text-[#516490]">
              <span>Completion</span>
              <span
                className="font-mono font-semibold"
                style={{ color: healthColor }}
                title={p.health ? `Health: ${p.health}` : undefined}
              >
                {Math.round(pct)}%
              </span>
            </div>
            <div
              className="mt-1 h-2.5 rounded-full overflow-hidden ring-1 ring-inset ring-[#E1E1DC]"
              style={{ background: "#F2F2F2" }}
              role="progressbar"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Completion ${Math.round(pct)}%${p.health ? `, health ${p.health}` : ""}`}
            >
              <div
                className="h-full rounded-full transition-[width]"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${healthColor} 0%, ${healthColor} 100%)`,
                  boxShadow: `0 0 0 1px ${healthColor}22 inset`,
                }}
              />
            </div>
          </div>
        )}
        {p.targetEndDate && (
          <div className="mt-2 text-[10px] text-[#516490]">
            Target end: <span className="text-[#1C1F3F]">{fmtDate(p.targetEndDate)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ Gantt timeline ═══════════════════════════════════════════════════════
/**
 * Collect deep-link entries from Gantt rows for the block-level source-links
 * accordion. Dense timeline rows themselves render as plain text (6B.7a.5b);
 * traceability lives in the accordion instead.
 */
function buildGanttSourceGroups(rows: GanttTimelineRow[]): StoryBlockSourceLinksGroup[] {
  const projects: { label: string; objectRef?: any }[] = [];
  const phases: { label: string; objectRef?: any }[] = [];
  const tasks: { label: string; objectRef?: any }[] = [];
  const decisions: { label: string; objectRef?: any }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.objectRef) continue;
    const dedupeKey = `${r.itemType}:${r.id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const entry = { label: r.label, objectRef: r.objectRef };
    if (r.itemType === "project") projects.push(entry);
    else if (r.itemType === "phase") phases.push(entry);
    else if (r.itemType === "task") tasks.push(entry);
    else if (r.itemType === "governance_milestone") decisions.push(entry);
  }
  const out: StoryBlockSourceLinksGroup[] = [];
  if (projects.length) out.push({ key: "projects", title: "Projects", entries: projects });
  if (phases.length) out.push({ key: "phases", title: "Phases", entries: phases });
  if (tasks.length) out.push({ key: "tasks", title: "Tasks", entries: tasks });
  if (decisions.length) out.push({ key: "decisions", title: "Decisions / Governance", entries: decisions });
  return out;
}

export function GanttTimelineView({ block }: { block: GanttTimelineBlock }) {
  const [expanded, setExpanded] = useState(false);
  const initial = block.display.initialVisibleItems ?? 12;
  const allowExpand = block.display.allowExpand !== false;

  // Group rows by groupLabel preserving insertion order
  const groups = useMemo(() => {
    const map = new Map<string, GanttTimelineRow[]>();
    for (const r of block.rows) {
      const arr = map.get(r.groupLabel) ?? [];
      arr.push(r);
      map.set(r.groupLabel, arr);
    }
    return Array.from(map.entries());
  }, [block.rows]);

  const visibleGroups = useMemo(() => {
    if (expanded || !allowExpand) return groups;
    let used = 0;
    const out: typeof groups = [];
    for (const [g, rows] of groups) {
      if (used >= initial) break;
      const take = rows.slice(0, Math.max(1, initial - used));
      out.push([g, take]);
      used += take.length;
    }
    return out;
  }, [groups, expanded, allowExpand, initial]);

  const rangeStart = parseISO(block.rangeStart);
  const rangeEnd = parseISO(block.rangeEnd);
  const totalDays = Math.max(1, differenceInDays(rangeEnd, rangeStart));
  const today = new Date();
  const todayPct =
    today >= rangeStart && today <= rangeEnd
      ? (differenceInDays(today, rangeStart) / totalDays) * 100
      : null;

  // Build month tick positions (first of each month in range)
  const months: { date: Date; pct: number }[] = useMemo(() => {
    const arr: { date: Date; pct: number }[] = [];
    const cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    while (cur <= rangeEnd) {
      const pct = (differenceInDays(cur, rangeStart) / totalDays) * 100;
      if (pct >= 0 && pct <= 100) arr.push({ date: new Date(cur), pct });
      cur.setMonth(cur.getMonth() + 1);
    }
    return arr;
  }, [rangeStart, rangeEnd, totalDays]);

  const totalRows = block.rows.length;
  const shownRows = visibleGroups.reduce((acc, [, rs]) => acc + rs.length, 0);

  return (
    <div className="rounded-lg border border-[#E1E1DC] bg-white p-5 shadow-[0_1px_0_rgba(28,31,63,0.04)]">
      <SectionHeader
        icon={CalendarClock}
        label={block.title}
        accentClass="bg-[#ED1C38]"
        right={
          <span className="text-[10px] text-[#516490]">
            {fmtDate(block.rangeStart)} → {fmtDate(block.rangeEnd)}
          </span>
        }
      />

      {/* Month axis */}
      <div className="relative ml-[180px] mb-2 h-5 border-b border-[#E1E1DC]">
        {months.map((m, i) => (
          <div
            key={i}
            className="absolute top-0 h-full border-l border-[#E1E1DC]"
            style={{ left: `${m.pct}%` }}
          >
            <span className="absolute -top-0.5 left-1 text-[9px] uppercase tracking-wide text-[#516490]">
              {fmtMonth(m.date)}
            </span>
          </div>
        ))}
        {todayPct !== null && (
          <div
            className="absolute top-0 h-full border-l-2 border-[#ED1C38]"
            style={{ left: `${todayPct}%` }}
            title={`Today · ${format(today, "MMM d, yyyy")}`}
          />
        )}
      </div>

      {/* Rows by group */}
      <div className="space-y-3">
        {visibleGroups.map(([group, rows]) => (
          <div key={group}>
            <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[#516490] mb-1">{group}</div>
            <div className="space-y-1">
              {rows.map((r) => (
                <GanttRow
                  key={r.id}
                  row={r}
                  rangeStart={rangeStart}
                  totalDays={totalDays}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {allowExpand && totalRows > shownRows && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 h-7 text-[11px] text-[#516490] hover:text-[#1C1F3F]"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
          {expanded ? "Show less" : `Show ${totalRows - shownRows} more`}
        </Button>
      )}
      <StoryBlockSourceLinks groups={buildGanttSourceGroups(block.rows)} />
      <BlockNarrativeView narrative={block.narrative} variant="footer" />
    </div>
  );
}

function GanttRow({
  row,
  rangeStart,
  totalDays,
}: {
  row: GanttTimelineRow;
  rangeStart: Date;
  totalDays: number;
}) {
  const start = parseISO(row.startDate ?? "");
  const end = parseISO(row.endDate ?? row.startDate ?? "");
  const valid = !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime());
  const startPct = valid ? Math.max(0, (differenceInDays(start, rangeStart) / totalDays) * 100) : 0;
  const endPct = valid ? Math.min(100, (differenceInDays(end, rangeStart) / totalDays) * 100) : 0;
  const widthPct = Math.max(0.5, endPct - startPct);

  const color =
    row.tone === "overdue" ? getPmHealthHex("overdue")
    : row.tone === "at_risk" ? getPmHealthHex("at_risk")
    : row.tone === "completed" ? getPmWorkflowStatusHex("completed")
    : row.tone === "milestone" ? COLOR.navy
    : row.tone === "in_progress" ? getPmWorkflowStatusHex("active")
    : COLOR.muted;

  const isMilestone = !!row.milestoneDate || row.itemType === "governance_milestone";

  return (
    <div className="flex items-center gap-2 h-6">
      <div className="w-[170px] shrink-0 pr-2 overflow-hidden">
        <div className="text-[11px] font-medium text-[#1C1F3F] leading-[1.15] pb-0.5 truncate" title={row.label}>
          {row.label}
        </div>
        <div className="text-[9px] text-[#516490] uppercase tracking-wide">{row.itemType}</div>
      </div>
      <div className="relative flex-1 h-4 bg-[#F8F8F6] rounded-sm">
        {valid && (
          isMilestone ? (
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `${startPct}%` }}
              title={`${row.label} · ${fmtDate(row.startDate)}`}
            >
              <div
                className="h-3 w-3 rotate-45 border-[1.5px] border-white"
                style={{ background: color }}
              />
            </div>
          ) : (
            <div
              className="absolute top-1/2 -translate-y-1/2 h-2.5 rounded-sm"
              style={{ left: `${startPct}%`, width: `${widthPct}%`, background: color }}
              title={`${row.label} · ${fmtDate(row.startDate)} → ${fmtDate(row.endDate)}`}
            >
              {typeof row.completionPercent === "number" && row.completionPercent > 0 && (
                <div
                  className="h-full rounded-sm"
                  style={{ width: `${Math.min(100, row.completionPercent)}%`, background: "rgba(0,0,0,0.35)" }}
                />
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ═══ Milestone rail ═══════════════════════════════════════════════════════
export function MilestoneRailView({ block }: { block: MilestoneRailBlock }) {
  return (
    <div className="rounded-lg border border-[#E1E1DC] bg-white p-5 shadow-[0_1px_0_rgba(28,31,63,0.04)]">
      <SectionHeader icon={Flag} label={block.title} accentClass="bg-[#1C1F3F]" />
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {block.items.map((m) => {
          const tone =
            m.tone === "overdue" ? "border-[#ED1C38] bg-[#ED1C38]/[0.06] text-[#ED1C24]"
            : m.tone === "due_soon" ? "border-[#EAC16D] bg-[#EAC16D]/[0.08] text-[#7A5512]"
            : m.tone === "completed" ? "border-[#B5CAC5] bg-white text-[#1C1F3F]"
            : "border-[#E1E1DC] bg-white text-[#1C1F3F]";
          return (
            <li key={m.id} className={`rounded-md border p-2.5 ${tone}`}>
              <div className="text-[10px] uppercase tracking-[0.12em] font-semibold opacity-75">
                {fmtDate(m.date)}
              </div>
              <div className="text-[12px] font-semibold leading-snug">{m.label}</div>
              {m.projectName && (
                <div className="text-[10px] text-[#516490] truncate">{m.projectName}</div>
              )}
            </li>
          );
        })}
      </ol>
      <BlockNarrativeView narrative={block.narrative} variant="footer" />
    </div>
  );
}

// ═══ Status composition (Recharts) ════════════════════════════════════════
export function StatusCompositionChartView({ block }: { block: StatusCompositionChartBlock }) {
  return (
    <div className="rounded-lg border border-[#E1E1DC] bg-white p-5 shadow-[0_1px_0_rgba(28,31,63,0.04)]">
      <SectionHeader
        icon={PieIcon}
        label={block.title}
        accentClass="bg-[#ED1C38]"
        right={
          <span className="text-[10px] text-[#516490]">{block.total} projects</span>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        <SegmentedBar title="Health" data={block.health} />
        <SegmentedBar title="Schedule" data={block.schedule} />
      </div>
      <BlockNarrativeView narrative={block.narrative} variant="footer" />
    </div>
  );
}

function SegmentedBar({ title, data }: { title: string; data: ChartCategoryDatum[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[#516490] mb-1">{title}</div>
      <div className="flex h-3 rounded-full overflow-hidden border border-[#E1E1DC]">
        {data.map((d, i) => (
          <div
            key={i}
            style={{ width: `${(d.value / total) * 100}%`, background: toneColor(d.tone) }}
            title={`${d.label}: ${d.value}`}
          />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
        {data.map((d, i) => (
          <li key={i} className="flex items-center gap-1.5 text-[11px] text-[#1C1F3F]">
            <span className="h-2 w-2 rounded-sm" style={{ background: toneColor(d.tone) }} />
            <span className="truncate">{d.label}</span>
            <span className="ml-auto font-mono text-[#516490]">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ═══ Delivery progress (horizontal capsule bars + distribution strip) ════
export function DeliveryProgressChartView({ block }: { block: DeliveryProgressChartBlock }) {
  const total = block.total || block.data.reduce((s, d) => s + d.value, 0) || 0;
  const max = block.data.reduce((m, d) => (d.value > m ? d.value : m), 0) || 1;
  return (
    <div className="rounded-lg border border-[#E1E1DC] bg-white p-5 shadow-[0_1px_0_rgba(28,31,63,0.04)]">
      <SectionHeader
        icon={TrendingUp}
        label={block.title}
        accentClass="bg-[#1C1F3F]"
        right={<span className="text-[10px] text-[#516490]">{total} items</span>}
      />

      {/* Distribution strip (segmented composition) */}
      {total > 0 && (
        <div className="mb-4">
          <div className="flex h-2.5 rounded-full overflow-hidden border border-[#E1E1DC]">
            {block.data.map((d, i) => {
              const w = (d.value / total) * 100;
              if (w <= 0) return null;
              return (
                <div
                  key={i}
                  style={{ width: `${w}%`, background: toneColor(d.tone) }}
                  title={`${d.label}: ${d.value} (${Math.round(w)}%)`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Capsule rows */}
      <ul className="space-y-2.5">
        {block.data.map((d, i) => {
          const share = total > 0 ? (d.value / total) * 100 : 0;
          const fill = Math.max(2, (d.value / max) * 100);
          const color = toneColor(d.tone);
          return (
            <li key={i} className="grid grid-cols-[110px_1fr_auto] items-center gap-3">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: color }} />
                <span className="text-[11px] font-semibold text-[#1C1F3F] truncate uppercase tracking-wide">
                  {d.label}
                </span>
              </div>
              <div className="relative h-3 rounded-full bg-[#F2F2F2] overflow-hidden ring-1 ring-inset ring-[#E1E1DC]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${fill}%`,
                    background: `linear-gradient(90deg, ${color} 0%, ${color}CC 100%)`,
                  }}
                  title={`${d.label}: ${d.value}`}
                />
              </div>
              <div className="text-right whitespace-nowrap">
                <span className="text-[13px] font-bold text-[#1C1F3F] font-mono tabular-nums">{d.value}</span>
                {total > 0 && (
                  <span className="ml-1.5 text-[10px] text-[#516490] font-mono">
                    {Math.round(share)}%
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <BlockNarrativeView narrative={block.narrative} variant="footer" />
    </div>
  );
}

// ═══ Risk & blocker severity (horizontal grouped capsule bars) ═══════════
const SEVERITY_LABELS: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  unknown: "Unknown",
};
const SEVERITY_COLORS: Record<string, string> = {
  critical: COLOR.red,
  high: "#D97706", // strong amber
  medium: COLOR.gold,
  low: COLOR.teal,
  unknown: COLOR.muted,
};

export function RiskSeverityChartView({ block }: { block: RiskSeverityChartBlock }) {
  const merged = useMemo(() => {
    const order = ["critical", "high", "medium", "low", "unknown"];
    const map = new Map<string, { key: string; risks: number; blockers: number }>();
    for (const r of block.risks) map.set(r.label, { key: r.label, risks: r.value, blockers: 0 });
    for (const b of block.blockers) {
      const cur = map.get(b.label) ?? { key: b.label, risks: 0, blockers: 0 };
      cur.blockers = b.value;
      map.set(b.label, cur);
    }
    return order.filter((k) => map.has(k)).map((k) => map.get(k)!);
  }, [block.risks, block.blockers]);

  const maxVal = merged.reduce((m, r) => Math.max(m, r.risks, r.blockers), 0) || 1;

  return (
    <div className="rounded-lg border border-[#E1E1DC] bg-white p-5 shadow-[0_1px_0_rgba(28,31,63,0.04)]">
      <SectionHeader
        icon={ShieldAlert}
        label={block.title}
        accentClass="bg-[#ED1C38]"
        right={
          <span className="text-[10px] text-[#516490]">
            {block.totalRisks} risks · {block.totalBlockers} blockers
          </span>
        }
      />
      <div className="mb-2 flex items-center gap-3 text-[10px] text-[#516490]">
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm" style={{ background: COLOR.red }} /> Risks
        </span>
        <span className="flex items-center gap-1">
          <span
            className="h-2 w-3 rounded-sm border"
            style={{ background: "white", borderColor: COLOR.navy }}
          />{" "}
          Blockers
        </span>
      </div>
      <ul className="space-y-2.5">
        {merged.map((row) => {
          const color = SEVERITY_COLORS[row.key] ?? COLOR.muted;
          const riskW = Math.max(row.risks > 0 ? 2 : 0, (row.risks / maxVal) * 100);
          const blockW = Math.max(row.blockers > 0 ? 2 : 0, (row.blockers / maxVal) * 100);
          return (
            <li key={row.key} className="grid grid-cols-[100px_1fr_auto] items-center gap-3">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: color }} />
                <span className="text-[11px] font-semibold text-[#1C1F3F] truncate uppercase tracking-wide">
                  {SEVERITY_LABELS[row.key] ?? row.key}
                </span>
              </div>
              <div className="space-y-1">
                <div className="relative h-2.5 rounded-full bg-[#F2F2F2] overflow-hidden ring-1 ring-inset ring-[#E1E1DC]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${riskW}%`,
                      background: `linear-gradient(90deg, ${color} 0%, ${color}CC 100%)`,
                    }}
                    title={`Risks · ${SEVERITY_LABELS[row.key] ?? row.key}: ${row.risks}`}
                  />
                </div>
                <div className="relative h-2.5 rounded-full bg-[#F2F2F2] overflow-hidden ring-1 ring-inset ring-[#E1E1DC]">
                  <div
                    className="h-full rounded-full border"
                    style={{
                      width: `${blockW}%`,
                      background: "white",
                      borderColor: color,
                    }}
                    title={`Blockers · ${SEVERITY_LABELS[row.key] ?? row.key}: ${row.blockers}`}
                  />
                </div>
              </div>
              <div className="text-right whitespace-nowrap text-[11px] font-mono tabular-nums">
                <div className="text-[#1C1F3F] font-semibold">{row.risks}</div>
                <div className="text-[#516490]">{row.blockers}</div>
              </div>
            </li>
          );
        })}
      </ul>
      <BlockNarrativeView narrative={block.narrative} variant="footer" />
    </div>
  );
}

// ═══ Risk matrix (2x2 BCG-style quadrants) ════════════════════════════════
export function RiskMatrixView({ block }: { block: RiskMatrixBlock }) {
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set());
  // Executive 2x2 quadrant matrix: Low vs High on both axes. Medium+ collapses
  // to High. Rows = likelihood (High on top → Low on bottom); columns = impact
  // (Low on left → High on right). Unknown values are NOT forced into a cell —
  // they are surfaced separately via block.unclassifiedCount.
  const AXIS_KEYS = ["high", "low"] as const;
  type AxisKey = (typeof AXIS_KEYS)[number];
  const collapse = (k: string): AxisKey | null => {
    if (k === "very_high" || k === "high" || k === "medium") return "high";
    if (k === "low" || k === "very_low") return "low";
    return null;
  };
  const AXIS_LABELS: Record<AxisKey, string> = { high: "High", low: "Low" };
  // Subtle quadrant labels — one per cell — for executive readability.
  const QUADRANT_LABELS: Record<`${AxisKey}-${AxisKey}`, string> = {
    "high-high": "Immediate focus",
    "high-low": "Monitor",
    "low-high": "Prepare",
    "low-low": "Watch",
  };

  const cellAt = (l: AxisKey, i: AxisKey) => {
    const bucket: { count: number; items: typeof block.cells[number]["items"] } = { count: 0, items: [] };
    for (const c of block.cells) {
      const cl = collapse(c.likelihood);
      const ci = collapse(c.impact);
      if (cl === l && ci === i) {
        bucket.count += c.count;
        for (const it of c.items) bucket.items.push(it);
      }
    }
    return bucket;
  };

  // Executive heat: top-right (high × high) is strongest.
  const cellClass = (count: number, l: AxisKey, i: AxisKey) => {
    if (l === "high" && i === "high") {
      return count > 0
        ? "bg-[#ED1C38]/20 ring-1 ring-inset ring-[#ED1C38]/45"
        : "bg-[#ED1C38]/[0.06] ring-1 ring-inset ring-[#ED1C38]/20";
    }
    if (l === "high" || i === "high") {
      return count > 0 ? "bg-[#EAC16D]/35" : "bg-[#EAC16D]/10";
    }
    return count > 0 ? "bg-[#B5CAC5]/45" : "bg-[#F8F8F6]";
  };

  const classifiedCount = Math.max(0, block.totalRisks - (block.unclassifiedCount ?? 0));

  return (
    <div className="rounded-lg border border-[#E1E1DC] bg-white p-5 shadow-[0_1px_0_rgba(28,31,63,0.04)]">
      <SectionHeader
        icon={Gauge}
        label={block.title}
        accentClass="bg-[#ED1C38]"
        right={
          <span className="text-[13px] font-semibold text-[#1C1F3F]">
            {classifiedCount} of {block.totalRisks} classified
          </span>
        }
      />
      {block.emptyAxesNote && (
        <div className="mb-3 rounded-md border border-dashed border-[#EAC16D]/60 bg-[#EAC16D]/10 px-3 py-1.5 text-[12px] text-[#7A5512]">
          {block.emptyAxesNote}
        </div>
      )}
      <div className="mx-auto flex w-full max-w-[640px] gap-3">
        {/* Y axis */}
        <div className="flex flex-col items-end justify-between py-1 pr-1">
          <div className="text-[9px] uppercase tracking-wider text-[#516490]">↑ Likelihood</div>
          <div className="flex flex-1 flex-col justify-between py-2 text-right">
            {AXIS_KEYS.map((k) => (
              <div
                key={k}
                className="flex flex-1 items-center justify-end text-[11px] font-semibold uppercase tracking-wider text-[#1C1F3F] whitespace-nowrap"
              >
                {AXIS_LABELS[k]}
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1">
          <div className="grid aspect-square grid-cols-2 gap-2">
            {AXIS_KEYS.map((l) =>
              AXIS_KEYS.slice().reverse().map((i) => {
                const c = cellAt(l, i);
                const cellKey = `${l}-${i}`;
                const isExpanded = expandedCells.has(cellKey);
                const MAX_VISIBLE = 5;
                const visible = isExpanded ? c.items : c.items.slice(0, MAX_VISIBLE);
                const remaining = c.items.length - visible.length;
                const quadrantLabel = QUADRANT_LABELS[`${l}-${i}` as `${AxisKey}-${AxisKey}`];
                const isHot = l === "high" && i === "high";
                return (
                  <div
                    key={cellKey}
                    className={`relative min-h-0 overflow-hidden rounded-md border border-[#D8D8D2] ${cellClass(c.count, l, i)} p-3 flex flex-col`}
                    title={
                      c.count > 0
                        ? `${AXIS_LABELS[l]} likelihood × ${AXIS_LABELS[i]} impact — ${c.count} risk${c.count === 1 ? "" : "s"}`
                        : `${AXIS_LABELS[l]} likelihood × ${AXIS_LABELS[i]} impact`
                    }
                  >
                    <div className="mb-1.5 flex items-baseline justify-between gap-2">
                      <span
                        className={`text-[10px] uppercase tracking-[0.12em] font-semibold ${
                          isHot ? "text-[#ED1C24]" : "text-[#516490]"
                        }`}
                      >
                        {quadrantLabel}
                      </span>
                      {c.count > 0 && (
                        <span
                          className={`text-[13px] font-bold tabular-nums ${
                            isHot ? "text-[#ED1C24]" : "text-[#1C1F3F]"
                          }`}
                        >
                          {c.count}
                        </span>
                      )}
                    </div>
                    {c.items.length > 0 ? (
                      <ul
                        className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 text-[13px] leading-snug text-[#1C1F3F]"
                        title={c.items.map((x) => x.title).join(", ")}
                      >
                        {visible.map((it, idx) => (
                          <li key={idx} className="flex gap-1.5">
                            <span className={isHot ? "text-[#ED1C38]" : "text-[#516490]"}>•</span>
                            <span className="break-words" title={it.title}>{it.title}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="flex-1" />
                    )}
                    {(remaining > 0 || (isExpanded && c.items.length > MAX_VISIBLE)) && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedCells((prev) => {
                            const next = new Set(prev);
                            if (next.has(cellKey)) next.delete(cellKey);
                            else next.add(cellKey);
                            return next;
                          })
                        }
                        className="mt-2 self-start rounded-md border border-[#1C1F3F]/25 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-[#1C1F3F] hover:bg-white"
                      >
                        {isExpanded ? "Show less" : `Show ${remaining} more`}
                      </button>
                    )}
                  </div>
                );
              }),
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {AXIS_KEYS.slice().reverse().map((k) => (
              <div
                key={k}
                className="text-[11px] font-semibold uppercase tracking-wider text-[#1C1F3F] text-center"
              >
                {AXIS_LABELS[k]}
              </div>
            ))}
          </div>
          <div className="text-center text-[9px] uppercase tracking-wider text-[#516490] mt-1">
            Impact →
          </div>
        </div>
      </div>
      {(block.unclassifiedCount ?? 0) > 0 && (
        <div className="mt-3 text-[11px] text-[#516490]">
          {block.unclassifiedCount} unclassified risk{block.unclassifiedCount === 1 ? "" : "s"} not placed on the matrix (likelihood or impact unset).
        </div>
      )}
      <StoryBlockSourceLinks
        groups={[
          {
            key: "risks",
            title: "Risks & Blockers",
            entries: block.cells.flatMap((c) =>
              c.items.map((it) => ({ label: it.title, objectRef: it.objectRef })),
            ),
          },
        ]}
      />
      <BlockNarrativeView narrative={block.narrative} variant="footer" />
    </div>
  );
}

// ═══ KPI card grid ════════════════════════════════════════════════════════
export function KpiCardGridView({ block }: { block: KpiCardGridBlock }) {
  const [expanded, setExpanded] = useState(false);
  const initial = block.display.initialVisibleItems ?? 8;
  const visible = expanded ? block.items : block.items.slice(0, initial);
  const canExpand = block.items.length > initial;
  return (
    <div className="rounded-lg border border-[#E1E1DC] bg-white p-5 shadow-[0_1px_0_rgba(28,31,63,0.04)]">
      <SectionHeader icon={Gauge} label={block.title} accentClass="bg-[#1C1F3F]" />
      <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {visible.map((k) => {
          const status = (k.status ?? "").toLowerCase();
          const color =
            status.includes("red") || status.includes("off") ? COLOR.red
            : status.includes("amber") || status.includes("at") ? COLOR.gold
            : status.includes("green") || status.includes("on_track") ? "#1F8A4C"
            : COLOR.navy;
          const trend = (k.trend ?? "").toLowerCase();
          const trendArrow = trend.includes("up") ? "▲" : trend.includes("down") ? "▼" : "•";
          return (
            <div key={k.id} className="relative rounded-md border border-[#E1E1DC] bg-white p-3 overflow-hidden">
              <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} aria-hidden />
              <div className="absolute top-2 right-2">
                <StoryObjectLink variant="icon" objectRef={k.objectRef} title={`Open ${k.name}`}>
                  {k.name}
                </StoryObjectLink>
              </div>
              <div className="pl-1.5 pr-6">
                <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[#516490] truncate" title={k.projectName}>
                  {k.projectName}
                </div>
                <div className="text-[12px] font-semibold text-[#1C1F3F] leading-snug truncate" title={k.name}>
                  {k.name}
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-[24px] font-bold leading-none" style={{ color }}>
                    {formatKpiValue(k.latestValue, k.unit)}
                  </span>
                  {k.unit && <span className="text-[12px] text-[#516490]">{k.unit}</span>}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-[#516490]">
                  {k.target !== null && k.target !== undefined && (
                    <span>Target {formatKpiValue(k.target, k.unit)}</span>
                  )}
                  <span>{trendArrow} {k.trend || "—"}</span>
                </div>
              </div>
            </div>
          );
        })}
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

// ═══ File evidence panel ══════════════════════════════════════════════════
export function FileEvidencePanelView({ block }: { block: FileEvidencePanelBlock }) {
  const [expanded, setExpanded] = useState(false);
  const initial = block.display.initialVisibleItems ?? 6;
  const visible = expanded ? block.files : block.files.slice(0, initial);
  const canExpand = block.files.length > initial;
  return (
    <div className="rounded-lg border border-[#E1E1DC] bg-white p-5 shadow-[0_1px_0_rgba(28,31,63,0.04)]">
      <SectionHeader
        icon={FileText}
        label={block.title}
        accentClass="bg-[#516490]"
        right={
          <span className="text-[10px] text-[#516490]">
            sent {block.totals.sent} / included {block.totals.included}
            {block.totals.skipped > 0 ? ` · ${block.totals.skipped} skipped` : ""}
          </span>
        }
      />
      <ul className="space-y-1.5">
        {visible.map((f, i) => {
          const sent = f.status === "sent";
          return (
            <li key={i} className="flex items-start gap-2 rounded-sm border border-[#E1E1DC] bg-white px-2.5 py-1.5">
              {sent
                ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-[#1F8A4C] shrink-0" />
                : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-[#516490] shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium text-[#1C1F3F] truncate">
                  <StoryObjectLink objectRef={f.objectRef} variant="subtle">
                    {f.displayName || f.alias}
                  </StoryObjectLink>
                </div>
                <div className="text-[10px] text-[#516490] truncate">
                  {f.mimeType ?? "—"}
                  {typeof f.sizeBytes === "number" ? ` · ${formatBytes(f.sizeBytes)}` : ""}
                  {f.skipReason ? ` · ${f.skipReason}` : ""}
                </div>
              </div>
              <Badge
                variant="outline"
                className={`shrink-0 text-[9px] uppercase tracking-wide ${
                  sent ? "border-[#1F8A4C]/40 text-[#1F8A4C] bg-white"
                  : "border-[#E1E1DC] text-[#516490] bg-white"
                }`}
              >
                {f.status}
              </Badge>
            </li>
          );
        })}
      </ul>
      {canExpand && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 text-[11px] text-[#516490] hover:text-[#1C1F3F]"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : `Show ${block.files.length - visible.length} more`}
        </Button>
      )}
      <BlockNarrativeView narrative={block.narrative} variant="footer" />
    </div>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
