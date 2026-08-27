// Roadmap Status Deck — BTPM-branded PPTX builder.
// Reuses the Weekly Project Status Deck theme/assets.

import PptxGenJS from "npm:pptxgenjs@3.12.0";
import type { RoadmapDeckData, RoadmapDeckProject, RoadmapDeckProgramBucket } from "./roadmapDeckDataMapper.ts";
import {
  THEME, SLIDE_W, SLIDE_H,
  ragColor, fmtDate, clip,
  addTitle, card, pill, uppercaseLabel, progressBar, metricCard,
} from "./deckTheme.ts";
import {
  getPmWorkflowStatusReportHex,
  getPmHealthReportHex,
} from "./btpmSemanticsMirror.ts";
import { BTPM_LOGO_B64, BTPM_FAVICON_B64 } from "./deckAssets.ts";

// ===== Safe-area constants (DOD §1) =====
// All slide content (cards, rows, labels) must end no lower than CONTENT_BOTTOM.
// Footer band lives below FOOTER_TOP and must remain unobstructed.
const TITLE_TOP = 0.28;
const CONTENT_TOP = 1.15;
const CONTENT_BOTTOM = 6.75;
const FOOTER_TOP = 7.05;
const DASHBOARD_CARDS_PER_SLIDE = 9; // 3×3 grid
const TIMELINE_MAX_PROJECTS_PER_SLIDE = 12;
const CALENDAR_YEAR_EVENTS_PER_MONTH = 4;
const CALENDAR_MONTH_EVENTS_PER_DAY = 3;

export function roadmapDeckFilenameFor(scopeLabel: string, generatedAtIso: string): string {
  const safe = (scopeLabel || "Roadmap").replace(/[\\/:*?"<>|#%]/g, "").trim().slice(0, 80);
  const d = generatedAtIso.slice(0, 10);
  return `BTPM Roadmap Status Deck - ${safe} - ${d}.pptx`;
}

// Local footer variant — generic Roadmap footer, no per-project context.
export function addRoadmapFooter(slide: any, d: RoadmapDeckData) {
  slide.addImage({
    data: BTPM_FAVICON_B64,
    x: 0.3, y: FOOTER_TOP + 0.08, w: 0.24, h: 0.24,
  });
  slide.addText(
    `BTPM · Roadmap Status · ${clip(d.scope.scopeLabel, 70)} · Generated ${fmtDate(d.generatedAt)}`,
    {
      x: 0.6, y: FOOTER_TOP + 0.1, w: 8.5, h: 0.22,
      fontSize: 8, color: THEME.mutedText, fontFace: THEME.font, align: "left", margin: 0,
    },
  );
  slide.addText("BTPM", {
    x: SLIDE_W - 4.2, y: FOOTER_TOP + 0.1, w: 3.9, h: 0.22,
    fontSize: 8, color: THEME.mutedText, fontFace: THEME.font, align: "right",
    charSpacing: 1, margin: 0,
  });
}

export function addInternalSlideLinkText(
  slide: any,
  text: string,
  shapeOptions: Record<string, unknown>,
  textOptions: Record<string, unknown>,
  targetSlide?: number,
  tooltip?: string,
) {
  if (typeof targetSlide === "number" && Number.isInteger(targetSlide)) {
    slide.addText([
      {
        text,
        options: {
          ...textOptions,
          hyperlink: { slide: targetSlide, tooltip },
        },
      },
    ], shapeOptions);
    return;
  }
  slide.addText(text, { ...shapeOptions, ...textOptions });
}

// ===== Management-relevance sorter (DOD §3) =====
// Order: Behind → At risk/Needs Attention → In progress → Upcoming → Completed.
// Within a group, nearest target end date first (nulls last).
export function sortByMgmtRelevance(arr: RoadmapDeckProject[]): RoadmapDeckProject[] {
  const rank = (p: RoadmapDeckProject): number => {
    const status = (p.status || "").toLowerCase();
    const completed = status === "completed" || p.scheduleSignal === "complete";
    if (completed) return 4;
    if (p.scheduleSignal === "behind_schedule") return 0;
    if (p.healthRag === "red" || p.healthRag === "amber") return 1;
    if (status === "planned" || status === "not_started" || status === "upcoming") return 3;
    return 2;
  };
  const ts = (iso: string | null): number => {
    if (!iso) return Number.POSITIVE_INFINITY;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  return [...arr].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return ts(a.targetEndDate) - ts(b.targetEndDate);
  });
}

// Shorten verbose status/schedule labels for tight badges (DOD §4).
export function shortHealthLabel(p: RoadmapDeckProject): string {
  const raw = (p.healthLabel || "").trim();
  const map: Record<string, string> = {
    "needs attention": "Attention",
    "behind schedule": "Behind",
    "at risk": "At Risk",
    "on track": "On Track",
  };
  const k = raw.toLowerCase();
  return map[k] || raw || "—";
}

// Delivery model display label. Returns null when unset — callers must
// skip rendering rather than showing "Unclassified".
export function deliveryModelLabel(v: string | null | undefined): string | null {
  if (!v) return null;
  switch (v) {
    case "internal_delivery": return "Internal Delivery";
    case "vendor_delivery": return "Vendor Delivery";
    case "co_delivery": return "Co-delivery";
    default: return null;
  }
}

export async function buildRoadmapDeckBuffer(d: RoadmapDeckData): Promise<{
  bytes: Uint8Array; slideCount: number;
}> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";

  let n = 0;
  buildCover(pres, d); n++;
  buildExecPortfolio(pres, d); n++;

  // Dashboard pagination (DOD §2) — sort all in-scope projects by management
  // relevance, then chunk into 9-card slides.
  const sortedProjects = sortByMgmtRelevance(d.projects);
  const totalProjects = sortedProjects.length;
  if (totalProjects === 0) {
    buildDashboardSlide(pres, d, [], 1, 1, 0, 0); n++;
  } else {
    const pages = Math.ceil(totalProjects / DASHBOARD_CARDS_PER_SLIDE);
    for (let p = 0; p < pages; p++) {
      const startIdx = p * DASHBOARD_CARDS_PER_SLIDE;
      const slice = sortedProjects.slice(startIdx, startIdx + DASHBOARD_CARDS_PER_SLIDE);
      buildDashboardSlide(pres, d, slice, p + 1, pages, startIdx, totalProjects); n++;
    }
  }

  buildNeedsAttention(pres, d); n++;
  buildCurrentUpcoming(pres, d); n++;

  // One or more slides per program bucket (DOD §5 pagination)
  if (d.programBuckets.length === 0) {
    buildEmptyTimelineSlide(pres, d); n++;
  } else {
    for (const b of d.programBuckets) {
      n += buildProgramTimelinePaginated(pres, d, b);
    }
  }

  // Calendar
  if (d.scope.calendarMode === "year") {
    buildYearCalendar(pres, d); n++;
  } else {
    buildMonthCalendar(pres, d); n++;
  }

  // Final notes / scope
  buildNotesScope(pres, d); n++;

  const out = (await pres.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return { bytes: new Uint8Array(out), slideCount: n };
}

// ============================================================== Cover ====

export function buildCover(pres: any, d: RoadmapDeckData) {
  const s = pres.addSlide();
  s.background = { color: THEME.navy };

  s.addImage({ data: BTPM_LOGO_B64, x: 0.5, y: 0.45, w: 1.6, h: 0.55 });
  s.addShape("rect", { x: 0.5, y: 1.05, w: 0.6, h: 0.05,
    fill: { color: THEME.red }, line: { type: "none" } });

  s.addText("Roadmap Status Deck", {
    x: 0.6, y: 1.4, w: 12, h: 0.5,
    fontSize: 16, color: "C8D1E8", fontFace: THEME.font,
    bold: true, charSpacing: 3, margin: 0,
  });
  s.addText(clip(d.scope.scopeLabel, 80), {
    x: 0.6, y: 2.0, w: 12, h: 1.8,
    fontSize: 46, color: THEME.white, fontFace: THEME.font, bold: true, margin: 0,
  });
  s.addShape("rect", { x: 0.6, y: 3.9, w: 1.6, h: 0.06,
    fill: { color: THEME.red }, line: { type: "none" } });

  const scopeSub: string[] = [];
  if (d.scope.workspaces.length === 1) scopeSub.push(d.scope.workspaces[0].name);
  else scopeSub.push(`${d.scope.workspaces.length} workspaces`);
  if (d.scope.programs.length > 0) scopeSub.push(`${d.scope.programs.length} program(s)`);
  scopeSub.push(`${d.scope.projectCount} project(s)`);
  // Phase 6D.7B — Portfolio scope provenance on the cover.
  if (d.scope.portfolioFilterExplicit) {
    scopeSub.push(d.scope.portfolioScopeLabel);
  } else if (d.scope.portfolioCount > 0 || d.scope.noPortfolioProjectCount > 0) {
    scopeSub.push(`${d.scope.portfolioCount} Portfolio(s)`);
  }
  s.addText(scopeSub.join("   ·   "), {
    x: 0.6, y: 4.1, w: 12, h: 0.45,
    fontSize: 16, color: "C8D1E8", fontFace: THEME.font, margin: 0,
  });

  s.addText("CALENDAR", {
    x: 0.6, y: 5.2, w: 6, h: 0.3,
    fontSize: 10, color: "9CA8C7", fontFace: THEME.font, bold: true, charSpacing: 3, margin: 0,
  });
  s.addText(
    `${d.scope.calendarMode.toUpperCase()}   ·   ${d.scope.calendarStart} → ${d.scope.calendarEnd}`,
    {
      x: 0.6, y: 5.5, w: 6, h: 0.55,
      fontSize: 20, color: THEME.white, fontFace: THEME.font, bold: true, margin: 0,
    },
  );
  s.addText("GENERATED", {
    x: 7.0, y: 5.2, w: 6, h: 0.3,
    fontSize: 10, color: "9CA8C7", fontFace: THEME.font, bold: true, charSpacing: 3, margin: 0,
  });
  s.addText(`${fmtDate(d.generatedAt)}   ·   by ${d.generatedByLabel}`, {
    x: 7.0, y: 5.5, w: 6, h: 0.55,
    fontSize: 16, color: THEME.white, fontFace: THEME.font, margin: 0,
  });

  s.addShape("rect", { x: 0, y: SLIDE_H - 0.4, w: SLIDE_W, h: 0.4,
    fill: { color: THEME.darkBlue }, line: { type: "none" } });
  s.addText("BTPM · Project Management", {
    x: 0.5, y: SLIDE_H - 0.4, w: 6, h: 0.4,
    fontSize: 9, color: "C8D1E8", fontFace: THEME.font, bold: true,
    charSpacing: 3, valign: "middle", margin: 0,
  });
  s.addText("BTPM", {
    x: SLIDE_W - 4.2, y: SLIDE_H - 0.4, w: 3.9, h: 0.4,
    fontSize: 9, color: "9CA8C7", fontFace: THEME.font,
    charSpacing: 2, align: "right", valign: "middle", margin: 0,
  });
}

// ============================================== Executive Portfolio ====

export function buildExecPortfolio(pres: any, d: RoadmapDeckData) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  addTitle(s, "Executive Portfolio Summary", d.scope.scopeLabel);

  // 6 KPI tiles
  const tiles: Array<{ label: string; value: string; sub: string; accent: string }> = [
    { label: "Total projects", value: String(d.portfolio.total), sub: "in scope", accent: THEME.navy },
    { label: "Completed", value: `${d.portfolio.completedPercent}%`, sub: `${d.portfolio.completed} of ${d.portfolio.total}`, accent: getPmWorkflowStatusReportHex("completed") },
    { label: "In progress", value: String(d.portfolio.inProgress), sub: "active execution", accent: getPmWorkflowStatusReportHex("active") },
    { label: "Upcoming", value: String(d.portfolio.upcoming), sub: "planned / not started", accent: getPmWorkflowStatusReportHex("planned") },
    { label: "At risk", value: `${d.portfolio.atRiskPercent}%`, sub: `${d.portfolio.atRiskCount} amber/red`, accent: getPmHealthReportHex("at_risk") },
    { label: "Behind schedule", value: String(d.portfolio.behindSchedule), sub: "schedule slipped", accent: getPmHealthReportHex("behind") },
  ];
  const tileW = 2.05, tileH = 1.7;
  const startX = 0.5, startY = 1.15;
  const gap = 0.1;
  for (let i = 0; i < tiles.length; i++) {
    const col = i % 6;
    const x = startX + col * (tileW + gap);
    metricCardSmall(s, x, startY, tileW, tileH, tiles[i]);
  }

  // Signals — sized to fit safely above the footer (DOD §1)
  const sigY = startY + tileH + 0.35;
  uppercaseLabel(s, 0.5, sigY, 6, 0.28, "Management signals", THEME.navy, 11);
  const sigListTop = sigY + 0.35;
  const sigW = SLIDE_W - 1.0;
  const signals = d.portfolio.signals;
  const available = CONTENT_BOTTOM - sigListTop;
  const sigGap = 0.08;
  const rawH = signals.length > 0 ? (available - sigGap * (signals.length - 1)) / signals.length : 0.7;
  const rowH = Math.max(0.46, Math.min(0.78, rawH));
  let yy = sigListTop;
  for (const sig of signals) {
    if (yy + rowH > CONTENT_BOTTOM + 0.01) break;
    const color = portfolioSignalColor(sig);
    card(s, 0.5, yy, sigW, rowH, color);
    uppercaseLabel(s, 0.7, yy + 0.08, 2.5, 0.2, sig.label, color, 9);
    s.addText(sig.value, {
      x: 0.7, y: yy + 0.26, w: sigW - 0.4, h: rowH - 0.3,
      fontSize: 13, color: THEME.navy, fontFace: THEME.font, bold: true, valign: "middle", margin: 0,
    });
    yy += rowH + sigGap;
  }
  addRoadmapFooter(s, d);
}

export function metricCardSmall(s: any, x: number, y: number, w: number, h: number,
  t: { label: string; value: string; sub: string; accent: string }) {
  card(s, x, y, w, h, t.accent);
  uppercaseLabel(s, x + 0.18, y + 0.18, w - 0.3, 0.24, t.label, t.accent, 8);
  s.addText(t.value, {
    x: x + 0.18, y: y + 0.42, w: w - 0.3, h: 0.85,
    fontSize: 30, bold: true, color: t.accent, fontFace: THEME.font, valign: "middle", margin: 0,
  });
  s.addText(t.sub, {
    x: x + 0.18, y: y + h - 0.4, w: w - 0.3, h: 0.32,
    fontSize: 8, color: THEME.mutedText, fontFace: THEME.font, margin: 0,
  });
}

export function signalColor(t: "good" | "warn" | "bad" | "info"): string {
  switch (t) {
    case "good": return getPmHealthReportHex("on_track");
    case "warn": return getPmHealthReportHex("needs_attention");
    case "bad": return getPmHealthReportHex("at_risk");
    default: return THEME.darkBlue;
  }
}

function portfolioSignalColor(sig: RoadmapDeckData["portfolio"]["signals"][number]): string {
  const label = (sig.label || "").toLowerCase();
  const value = (sig.value || "").toLowerCase();
  if (label === "schedule" && value.includes("behind")) {
    return getPmHealthReportHex("behind");
  }
  return signalColor(sig.tone);
}

// ========================================================== Dashboard ====

export interface DashboardSlideOpts {
  linkSlideForProject?: (projectId: string) => number | undefined;
}

export function buildDashboardSlide(
  pres: any, d: RoadmapDeckData, cards: RoadmapDeckProject[],
  pageNum: number, totalPages: number, startIdx: number, totalProjects: number,
  opts: DashboardSlideOpts = {},
) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  const title = totalPages > 1 ? `Roadmap Dashboard · ${pageNum}` : "Roadmap Dashboard";
  const endIdx = startIdx + cards.length;
  const subtitle = totalProjects > 0
    ? `Projects ${startIdx + 1}–${endIdx} of ${totalProjects}`
    : undefined;
  addTitle(s, title, subtitle);

  // Compact metric strip (DOD §2 — keep main grid safe)
  const stripY = 1.05;
  const stripH = 0.62;
  const stripItems = [
    { label: "TOTAL", value: String(d.portfolio.total), accent: THEME.navy },
    { label: "COMPLETED", value: `${d.portfolio.completed} (${d.portfolio.completedPercent}%)`, accent: getPmWorkflowStatusReportHex("completed") },
    { label: "IN PROGRESS", value: String(d.portfolio.inProgress), accent: getPmWorkflowStatusReportHex("active") },
    { label: "UPCOMING", value: String(d.portfolio.upcoming), accent: getPmWorkflowStatusReportHex("planned") },
    { label: "AT RISK", value: `${d.portfolio.atRiskCount} (${d.portfolio.atRiskPercent}%)`, accent: getPmHealthReportHex("at_risk") },
    { label: "BEHIND", value: String(d.portfolio.behindSchedule), accent: getPmHealthReportHex("behind") },
  ];
  const stripW = SLIDE_W - 1.0;
  const cellW = stripW / stripItems.length;
  card(s, 0.5, stripY, stripW, stripH, null);
  for (let i = 0; i < stripItems.length; i++) {
    const cx = 0.5 + i * cellW;
    if (i > 0) {
      s.addShape("rect", {
        x: cx, y: stripY + 0.1, w: 0.008, h: stripH - 0.2,
        fill: { color: THEME.cardBorder }, line: { type: "none" },
      });
    }
    s.addText(stripItems[i].label, {
      x: cx + 0.12, y: stripY + 0.06, w: cellW - 0.2, h: 0.2,
      fontSize: 7, bold: true, color: THEME.mutedText, fontFace: THEME.font,
      charSpacing: 2, margin: 0,
    });
    s.addText(stripItems[i].value, {
      x: cx + 0.12, y: stripY + 0.26, w: cellW - 0.2, h: 0.32,
      fontSize: 15, bold: true, color: stripItems[i].accent, fontFace: THEME.font,
      valign: "middle", margin: 0,
    });
  }

  if (cards.length === 0) {
    drawEmptyState(s, "No projects in current scope.");
    addRoadmapFooter(s, d);
    return;
  }

  // 3×3 card grid sized to the safe content area (DOD §1)
  const cols = 3, rows = 3;
  const gridTop = stripY + stripH + 0.25;
  const gridBottom = CONTENT_BOTTOM;
  const gap = 0.14;
  const gridW = SLIDE_W - 1.0;
  const cw = (gridW - gap * (cols - 1)) / cols;
  const ch = (gridBottom - gridTop - gap * (rows - 1)) / rows;
  for (let i = 0; i < cards.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 0.5 + col * (cw + gap);
    const y = gridTop + row * (ch + gap);
    const linkSlide = opts.linkSlideForProject?.(cards[i].id);
    drawCompactProjectCard(s, x, y, cw, ch, cards[i], { linkSlide });
  }
  addRoadmapFooter(s, d);
}

export interface CompactCardOpts {
  linkSlide?: number;
}

export function drawCompactProjectCard(
  s: any, x: number, y: number, w: number, h: number, p: RoadmapDeckProject,
  opts: CompactCardOpts = {},
) {
  const accent = ragColor(p.healthRag);
  card(s, x, y, w, h, accent);
  // Delivery model — neutral small label top-right, only when set.
  const dm = deliveryModelLabel(p.deliveryModel);
  const dmW = 1.35;
  const nameW = (w - 0.36) - (dm ? dmW + 0.1 : 0);
  if (dm) {
    s.addText(dm, {
      x: x + w - 0.18 - dmW, y: y + 0.16, w: dmW, h: 0.24,
      fontSize: 8, color: THEME.mutedText, fontFace: THEME.font,
      align: "right", valign: "middle", margin: 0,
    });
  }
  addInternalSlideLinkText(s, clip(p.name, 48), {
    x: x + 0.18, y: y + 0.16, w: nameW, h: 0.32,
    margin: 0,
  }, {
    fontSize: 11, bold: true, color: THEME.navy, fontFace: THEME.font,
  }, opts.linkSlide, "Open project detail");
  s.addText(clip(`${p.workspaceName}${p.programName ? " · " + p.programName : ""}`, 60), {
    x: x + 0.18, y: y + 0.46, w: w - 0.36, h: 0.22,
    fontSize: 8, color: THEME.mutedText, fontFace: THEME.font, margin: 0,
  });
  const pct = Math.round(p.completionPercent ?? 0);
  const barY = y + 0.74;
  progressBar(s, x + 0.18, barY, w - 0.86, 0.14, pct, accent);
  s.addText(`${pct}%`, {
    x: x + w - 0.62, y: barY - 0.04, w: 0.46, h: 0.22,
    fontSize: 9, bold: true, color: THEME.navy, fontFace: THEME.font, align: "right", margin: 0,
  });
  const padBottom = 0.16;
  const pillH = 0.22;
  const pillY = y + h - padBottom - pillH;
  pill(s, x + 0.18, pillY, 1.05, pillH,
    clip(shortHealthLabel(p), 12), accent, THEME.white, { fontSize: 8, bold: true });
  const sched = humanSchedule(p.scheduleSignal);
  pill(s, x + 0.18 + 1.05 + 0.08, pillY, 0.95, pillH,
    clip(sched, 12), scheduleColor(p.scheduleSignal), THEME.white, { fontSize: 8, bold: true });
  s.addText(`Target ${fmtDate(p.targetEndDate)}`, {
    x: x + 0.18 + 2.12, y: pillY, w: w - 0.36 - 2.12, h: pillH,
    fontSize: 8, color: THEME.mutedText, fontFace: THEME.font,
    align: "right", valign: "middle", margin: 0,
  });
}

// ===================================================== Needs Attention ====

export function buildNeedsAttention(
  pres: any, d: RoadmapDeckData,
  opts: { linkSlideForProject?: (id: string) => number | undefined } = {},
) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  addTitle(s, "Needs Attention", `${d.needsAttention.length} project(s)`);

  if (d.needsAttention.length === 0) {
    drawEmptyState(s, "No projects flagged as behind schedule, at risk, or past target.");
    addRoadmapFooter(s, d);
    return;
  }
  drawProjectList(s, d.needsAttention, 1.15, true, opts.linkSlideForProject);
  addRoadmapFooter(s, d);
}

// ===================================================== Current/Upcoming ====

export function buildCurrentUpcoming(pres: any, d: RoadmapDeckData) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  addTitle(s, "Current & Upcoming");

  const leftX = 0.5, rightX = 6.92, panelW = 5.9, panelH = 5.6, panelY = 1.15;

  drawGroupedListPanel(s, leftX, panelY, panelW, panelH, "Current Execution",
    THEME.darkBlue, d.current);
  drawGroupedListPanel(s, rightX, panelY, panelW, panelH, "Upcoming",
    THEME.neutralGrey, d.upcoming);

  addRoadmapFooter(s, d);
}

export function drawGroupedListPanel(s: any, x: number, y: number, w: number, h: number,
  title: string, accent: string, items: RoadmapDeckProject[]) {
  card(s, x, y, w, h, accent);
  s.addText(title, {
    x: x + 0.25, y: y + 0.2, w: w - 1.8, h: 0.35,
    fontSize: 14, bold: true, color: THEME.navy, fontFace: THEME.font, valign: "middle", margin: 0,
  });
  pill(s, x + w - 1.05, y + 0.22, 0.8, 0.3, String(items.length), accent, THEME.white,
    { fontSize: 10, bold: true });

  if (items.length === 0) {
    s.addText("No projects in this group.", {
      x: x + 0.25, y: y + 1.0, w: w - 0.5, h: 0.5,
      fontSize: 11, color: THEME.mutedText, fontFace: THEME.font, italic: true, margin: 0,
    });
    return;
  }
  const top = items.slice(0, 8);
  const itemH = (h - 1.0) / top.length;
  for (let i = 0; i < top.length; i++) {
    const p = top[i];
    const yy = y + 0.85 + i * itemH;
    if (i > 0) {
      s.addShape("rect", { x: x + 0.25, y: yy, w: w - 0.5, h: 0.005,
        fill: { color: THEME.cardBorder }, line: { type: "none" } });
    }
    s.addText(clip(p.name, 40), {
      x: x + 0.25, y: yy + 0.08, w: w - 2.4, h: 0.3,
      fontSize: 11, bold: true, color: THEME.navy, fontFace: THEME.font, margin: 0,
    });
    s.addText(clip(`${p.workspaceName}${p.programName ? " · " + p.programName : ""}`, 50), {
      x: x + 0.25, y: yy + 0.36, w: w - 2.4, h: 0.24,
      fontSize: 8, color: THEME.mutedText, fontFace: THEME.font, margin: 0,
    });
    pill(s, x + w - 2.05, yy + 0.12, 1.8, 0.24,
      `Target: ${fmtDate(p.targetEndDate)}`, THEME.cardBorder, THEME.navy,
      { fontSize: 8, bold: true });
  }
  if (items.length > top.length) {
    s.addText(`+${items.length - top.length} more`, {
      x: x + 0.25, y: y + h - 0.32, w: w - 0.5, h: 0.22,
      fontSize: 9, color: accent, fontFace: THEME.font, italic: true, bold: true, align: "right", margin: 0,
    });
  }
}

export function drawProjectList(
  s: any, items: RoadmapDeckProject[], topY: number, withReason: boolean,
  linkSlideForProject?: (id: string) => number | undefined,
) {
  const headerY = topY;
  const colX = [0.5, 5.2, 7.5, 9.5, 11.3];
  const headers = ["Project", "Workspace · Program", "Owner / Target", "Health", "Reason"];
  for (let i = 0; i < headers.length; i++) {
    uppercaseLabel(s, colX[i], headerY, (colX[i + 1] ?? SLIDE_W - 0.5) - colX[i], 0.25,
      headers[i], THEME.mutedText, 9);
  }
  const startY = headerY + 0.35;
  const rowH = Math.min(0.5, (SLIDE_H - startY - 0.7) / Math.max(items.length, 1));
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    const yy = startY + i * rowH;
    if (i % 2 === 0) {
      s.addShape("rect", { x: 0.5, y: yy, w: SLIDE_W - 1.0, h: rowH,
        fill: { color: THEME.white, transparency: 50 }, line: { type: "none" } });
    }
    const linkSlide = linkSlideForProject?.(p.id);
    addInternalSlideLinkText(s, clip(p.name, 36), {
      x: colX[0], y: yy + 0.06, w: colX[1] - colX[0] - 0.1, h: rowH - 0.1,
      valign: "middle", margin: 0,
    }, {
      fontSize: 10, bold: true, color: THEME.navy, fontFace: THEME.font,
    }, linkSlide, "Open project detail");
    s.addText(clip(`${p.workspaceName}${p.programName ? " · " + p.programName : ""}`, 28), {
      x: colX[1], y: yy + 0.06, w: colX[2] - colX[1] - 0.1, h: rowH - 0.1,
      fontSize: 9, color: THEME.mutedText, fontFace: THEME.font, valign: "middle", margin: 0,
    });
    s.addText(clip(`Target: ${fmtDate(p.targetEndDate)}`, 24), {
      x: colX[2], y: yy + 0.06, w: colX[3] - colX[2] - 0.1, h: rowH - 0.1,
      fontSize: 9, color: THEME.navy, fontFace: THEME.font, valign: "middle", margin: 0,
    });
    pill(s, colX[3], yy + (rowH - 0.26) / 2, 1.6, 0.26,
      clip(p.healthLabel || "—", 12), ragColor(p.healthRag), THEME.white, { fontSize: 8, bold: true });
    if (withReason) {
      const reason = (p.scheduleReasonLines[0] || p.healthReasonLines[0] || humanSchedule(p.scheduleSignal));
      s.addText(clip(reason, 28), {
        x: colX[4], y: yy + 0.06, w: SLIDE_W - 0.5 - colX[4], h: rowH - 0.1,
        fontSize: 9, color: THEME.mutedText, fontFace: THEME.font, italic: true, valign: "middle", margin: 0,
      });
    }
  }
}

// ===================================================== Program Timeline ====

export function buildProgramTimelinePaginated(
  pres: any, d: RoadmapDeckData, b: RoadmapDeckProgramBucket,
): number {
  // Project-level only (DOD §5/§6). Sort by management relevance so the
  // first slide carries the most important rows. Include ALL projects in
  // the program — projects without dates render as labelled rows with a
  // "No dates" marker so they're never silently dropped.
  const sorted = sortByMgmtRelevance(b.projects);
  const items = sorted.map((p) => ({
    p,
    _start: p.startDate ? new Date(p.startDate) : null,
    _end: p.targetEndDate ? new Date(p.targetEndDate) : null,
  }));

  if (items.length === 0) {
    const s = pres.addSlide();
    s.background = { color: THEME.lightBg };
    addTitle(s, `Program Timeline · ${clip(b.programName, 50)}`,
      `${b.workspaceName} · ${b.projects.length} project(s)`);
    drawEmptyState(s, "No projects in this program.");
    addRoadmapFooter(s, d);
    return 1;
  }

  // Shared time window from datable items only; if none have dates, use a
  // synthetic window around today so axis still renders.
  const datable = items.filter((x) => x._start || x._end);
  let minMs: number, maxMs: number;
  if (datable.length > 0) {
    minMs = Math.min(...datable.map((i) => (i._start ?? i._end)!.getTime()));
    maxMs = Math.max(...datable.map((i) => (i._end ?? i._start)!.getTime()));
    if (minMs === maxMs) maxMs = minMs + 86_400_000;
    const span = maxMs - minMs;
    minMs -= span * 0.03; maxMs += span * 0.03;
  } else {
    const now = Date.now();
    minMs = now - 90 * 86_400_000;
    maxMs = now + 90 * 86_400_000;
  }

  const perPage = TIMELINE_MAX_PROJECTS_PER_SLIDE;
  const total = items.length;
  const pages = Math.ceil(total / perPage);

  let made = 0;
  for (let p = 0; p < pages; p++) {
    const startIdx = p * perPage;
    const slice = items.slice(startIdx, startIdx + perPage);
    drawTimelinePage(pres, d, b, slice, minMs, maxMs, p + 1, pages,
      startIdx, total);
    made++;
  }
  return made;
}

export function drawTimelinePage(
  pres: any, d: RoadmapDeckData, b: RoadmapDeckProgramBucket,
  rows: Array<{ p: RoadmapDeckProject; _start: Date | null; _end: Date | null }>,
  minMs: number, maxMs: number,
  pageNum: number, totalPages: number, startIdx: number, total: number,
) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  const titleSuffix = totalPages > 1 ? ` · ${pageNum}` : "";
  const subtitle = totalPages > 1
    ? `${b.workspaceName} · Projects ${startIdx + 1}–${startIdx + rows.length} of ${total}`
    : `${b.workspaceName} · ${b.projects.length} project(s)`;
  addTitle(s, `Program Timeline · ${clip(b.programName, 50)}${titleSuffix}`, subtitle);

  const today = Date.now();
  const left = 3.4;
  const right = SLIDE_W - 0.6;
  const trackW = right - left;
  const headerY = 1.25;
  const gridTopY = 1.6;
  const rowsTopY = 1.78;
  const legendY = CONTENT_BOTTOM - 0.05; // legend lives just inside safe area
  const rowsBottom = legendY - 0.25;
  const rowH = Math.min(0.36, (rowsBottom - rowsTopY) / Math.max(rows.length, 1));
  const gridBottomY = rowsTopY + rowH * rows.length + 0.05;
  const tsX = (ms: number) => left + ((ms - minMs) / (maxMs - minMs)) * trackW;

  // Month headers + gridlines
  const monthStarts = listMonthStarts(minMs, maxMs);
  for (const m of monthStarts) {
    const x = tsX(m.getTime());
    s.addShape("rect", { x, y: gridTopY, w: 0.005, h: gridBottomY - gridTopY,
      fill: { color: THEME.cardBorder }, line: { type: "none" } });
    s.addText(fmtMonth(m), {
      x: x - 0.5, y: headerY, w: 1.0, h: 0.3,
      fontSize: 9, color: THEME.mutedText, fontFace: THEME.font, align: "center", margin: 0,
    });
  }
  s.addShape("rect", { x: left, y: gridBottomY, w: trackW, h: 0.01,
    fill: { color: THEME.neutralGrey }, line: { type: "none" } });

  for (let i = 0; i < rows.length; i++) {
    const t = rows[i];
    const y = rowsTopY + i * rowH;
    if (i % 2 === 0) {
      s.addShape("rect", { x: left, y, w: trackW, h: rowH,
        fill: { color: THEME.white, transparency: 60 }, line: { type: "none" } });
    }
    s.addText(clip(t.p.name, 36), {
      x: 0.5, y, w: left - 0.6, h: rowH,
      fontSize: 10, color: THEME.navy, fontFace: THEME.font,
      valign: "middle", bold: true, margin: 0,
    });

    // Projects without any date — render a "No dates" marker so the row
    // still tells the audience the project is in scope.
    if (!t._start && !t._end) {
      const markerW = 1.2;
      const mx = left + 0.12;
      pill(s, mx, y + (rowH - 0.24) / 2, markerW, 0.24,
        "No dates set", THEME.neutralGrey, THEME.white,
        { fontSize: 8, bold: true });
      continue;
    }

    const sMs = (t._start ?? t._end)!.getTime();
    const eMsRaw = (t._end ?? t._start)!.getTime();
    const eMs = Math.max(eMsRaw, sMs + 86_400_000);
    const bx = tsX(sMs);
    const bw = Math.max(0.08, tsX(eMs) - bx);
    const color = projectBarColor(t.p);
    s.addShape("roundRect", {
      x: bx, y: y + rowH * 0.18, w: bw, h: rowH * 0.64,
      fill: { color }, line: { color: THEME.navy, width: 0.5 }, rectRadius: 0.08,
    });
    if (bw > 1.2) {
      const pct = Math.round(t.p.completionPercent ?? 0);
      s.addText(`${pct}% · ${humanSchedule(t.p.scheduleSignal)}`, {
        x: bx + 0.05, y: y + rowH * 0.18, w: bw - 0.1, h: rowH * 0.64,
        fontSize: 7, color: THEME.white, fontFace: THEME.font, bold: true,
        valign: "middle", align: "center", margin: 0,
      });
    }
  }

  // Today marker inside plot area
  if (today >= minMs && today <= maxMs) {
    const tx = tsX(today);
    s.addShape("rect", { x: tx, y: gridTopY, w: 0.02, h: gridBottomY - gridTopY,
      fill: { color: THEME.red }, line: { type: "none" } });
    const labelW = 0.8;
    const labelX = Math.min(Math.max(tx - labelW / 2, left), right - labelW);
    pill(s, labelX, 1.0, labelW, 0.24, "TODAY", THEME.red, THEME.white, { fontSize: 8, bold: true });
  }

  drawLegend(s, 0.5, legendY);
  addRoadmapFooter(s, d);
}

export function buildEmptyTimelineSlide(pres: any, d: RoadmapDeckData) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  addTitle(s, "Program Timeline");
  drawEmptyState(s, "No programs in the selected scope.");
  addRoadmapFooter(s, d);
}


export function drawLegend(s: any, x: number, y: number) {
  const items = [
    { label: "On track / Green", color: getPmHealthReportHex("on_track") },
    { label: "Needs Attention", color: getPmHealthReportHex("needs_attention") },
    { label: "At Risk / Critical", color: getPmHealthReportHex("at_risk") },
    { label: "Planned / Neutral", color: THEME.neutralGrey },
    { label: "Today", color: THEME.red, line: true },
  ];
  let cx = x;
  for (const it of items) {
    if (it.line) {
      s.addShape("rect", { x: cx, y: y + 0.06, w: 0.02, h: 0.18,
        fill: { color: it.color }, line: { type: "none" } });
    } else {
      s.addShape("roundRect", { x: cx, y: y + 0.06, w: 0.28, h: 0.18,
        fill: { color: it.color }, line: { type: "none" }, rectRadius: 0.04 });
    }
    s.addText(it.label, {
      x: cx + 0.35, y, w: 1.9, h: 0.3,
      fontSize: 9, color: THEME.mutedText, fontFace: THEME.font, valign: "middle", margin: 0,
    });
    cx += 2.3;
  }
}

export function projectBarColor(p: RoadmapDeckProject): string {
  if (p.healthRag === "red") return getPmHealthReportHex("at_risk");
  if (p.healthRag === "amber") return getPmHealthReportHex("needs_attention");
  if (p.healthRag === "green") return getPmHealthReportHex("on_track");
  return THEME.neutralGrey;
}

// ============================================================ Calendar ====

export function buildYearCalendar(pres: any, d: RoadmapDeckData) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  const yearStart = new Date(d.scope.calendarStart);
  const year = yearStart.getUTCFullYear();
  addTitle(s, `Calendar · ${year}`,
    `Project starts and target ends across the year`);

  // 4x3 month grid sized to the content safe area (DOD §1/§7)
  const cols = 4, rows = 3;
  const startX = 0.5, startY = 1.2;
  const gridW = SLIDE_W - 1.0;
  const gridH = CONTENT_BOTTOM - startY;
  const cellW = gridW / cols, cellH = gridH / rows;

  // Prioritise behind/at-risk projects when capping per-month events.
  const prioritisedProjects = sortByMgmtRelevance(d.projects);

  for (let m = 0; m < 12; m++) {
    const col = m % cols, row = Math.floor(m / cols);
    const x = startX + col * cellW + 0.05;
    const y = startY + row * cellH + 0.05;
    const w = cellW - 0.1, h = cellH - 0.1;
    card(s, x, y, w, h, THEME.darkBlue);
    const monthLabel = new Date(Date.UTC(year, m, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
    uppercaseLabel(s, x + 0.15, y + 0.12, w - 0.3, 0.22, monthLabel, THEME.navy, 9);
    const startsInMonth = prioritisedProjects.filter((p) => p.startDate && inMonth(p.startDate, year, m));
    const endsInMonth = prioritisedProjects.filter((p) => p.targetEndDate && inMonth(p.targetEndDate, year, m));
    s.addText(`▶ ${startsInMonth.length} start(s)`, {
      x: x + 0.15, y: y + 0.42, w: w - 0.3, h: 0.22,
      fontSize: 8, color: THEME.green, fontFace: THEME.font, bold: true, margin: 0,
    });
    s.addText(`◼ ${endsInMonth.length} target end(s)`, {
      x: x + 0.15, y: y + 0.64, w: w - 0.3, h: 0.22,
      fontSize: 8, color: THEME.alertRed, fontFace: THEME.font, bold: true, margin: 0,
    });
    const cap = CALENDAR_YEAR_EVENTS_PER_MONTH;
    const halfCap = Math.ceil(cap / 2);
    const sample = [
      ...startsInMonth.slice(0, halfCap).map((p) => `▶ ${clip(p.name, 22)}`),
      ...endsInMonth.slice(0, cap - Math.min(halfCap, startsInMonth.length))
        .map((p) => `◼ ${clip(p.name, 22)}`),
    ].slice(0, cap);
    const more = (startsInMonth.length + endsInMonth.length) - sample.length;
    const sampleText = sample.join("\n") + (more > 0 ? `\n+${more} more` : "");
    s.addText(sampleText, {
      x: x + 0.15, y: y + 0.88, w: w - 0.3, h: h - 0.98,
      fontSize: 7, color: THEME.mutedText, fontFace: THEME.font, valign: "top", margin: 0,
    });
  }
  addRoadmapFooter(s, d);
}

export function buildMonthCalendar(pres: any, d: RoadmapDeckData) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  const start = new Date(d.scope.calendarStart);
  const y = start.getUTCFullYear(), m = start.getUTCMonth();
  const monthLabel = new Date(Date.UTC(y, m, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  addTitle(s, `Calendar · ${monthLabel}`, "Project starts and target ends this month");

  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const cols = 7;
  const rowsNeeded = Math.ceil((firstDow + daysInMonth) / 7);
  const gridX = 0.5, gridY = 1.2;
  const gridW = SLIDE_W - 1.0;
  const gridH = CONTENT_BOTTOM - gridY; // safe area (DOD §1/§7)
  const cellW = gridW / cols, cellH = gridH / rowsNeeded;
  const prioritised = sortByMgmtRelevance(d.projects);
  const cap = CALENDAR_MONTH_EVENTS_PER_DAY;

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (let c = 0; c < cols; c++) {
    uppercaseLabel(s, gridX + c * cellW, gridY - 0.3, cellW, 0.25, dayLabels[c], THEME.mutedText, 9);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const idx = firstDow + day - 1;
    const col = idx % 7, row = Math.floor(idx / 7);
    const x = gridX + col * cellW + 0.04;
    const yy = gridY + row * cellH + 0.04;
    const w = cellW - 0.08, h = cellH - 0.08;
    s.addShape("roundRect", {
      x, y: yy, w, h,
      fill: { color: THEME.white },
      line: { color: THEME.cardBorder, width: 0.5 },
      rectRadius: 0.04,
    });
    s.addText(String(day), {
      x: x + 0.08, y: yy + 0.05, w: w - 0.16, h: 0.22,
      fontSize: 9, color: THEME.navy, fontFace: THEME.font, bold: true, margin: 0,
    });
    const starts = prioritised.filter((p) => p.startDate && sameDay(p.startDate, y, m, day));
    const ends = prioritised.filter((p) => p.targetEndDate && sameDay(p.targetEndDate, y, m, day));
    const halfCap = Math.ceil(cap / 2);
    const lines: string[] = [
      ...starts.slice(0, halfCap).map((p) => `▶ ${clip(p.name, 14)}`),
      ...ends.slice(0, cap - Math.min(halfCap, starts.length)).map((p) => `◼ ${clip(p.name, 14)}`),
    ].slice(0, cap);
    const more = (starts.length + ends.length) - lines.length;
    if (more > 0) lines.push(`+${more} more`);
    if (lines.length > 0) {
      s.addText(lines.join("\n"), {
        x: x + 0.08, y: yy + 0.3, w: w - 0.16, h: h - 0.35,
        fontSize: 7, color: THEME.mutedText, fontFace: THEME.font, valign: "top", margin: 0,
      });
    }
  }
  addRoadmapFooter(s, d);
}

export function inMonth(iso: string, year: number, m: number): boolean {
  const d = new Date(iso);
  return d.getUTCFullYear() === year && d.getUTCMonth() === m;
}
export function sameDay(iso: string, y: number, m: number, day: number): boolean {
  const d = new Date(iso);
  return d.getUTCFullYear() === y && d.getUTCMonth() === m && d.getUTCDate() === day;
}

// ===================================================== Notes / Scope ====

export function buildNotesScope(pres: any, d: RoadmapDeckData) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  addTitle(s, "Scope & Notes");

  const lines: string[] = [
    `Workspaces (${d.scope.workspaces.length}): ${d.scope.workspaces.map((w) => w.name).join(", ") || "—"}`,
    `Programs (${d.scope.programs.length}): ${d.scope.programs.map((p) => p.name).join(", ") || "All"}`,
    d.scope.projectsExplicit ? `Projects: ${d.scope.projectCount} explicitly selected` : `Projects: All accessible (${d.scope.projectCount})`,
    `Calendar mode: ${d.scope.calendarMode.toUpperCase()} (${d.scope.calendarStart} → ${d.scope.calendarEnd})`,
    `Generated at: ${d.generatedAt}`,
    `Generated by: ${d.generatedByLabel}`,
  ];
  let yy = 1.3;
  for (const line of lines) {
    s.addText(line, {
      x: 0.6, y: yy, w: SLIDE_W - 1.2, h: 0.4,
      fontSize: 12, color: THEME.navy, fontFace: THEME.font, margin: 0,
    });
    yy += 0.45;
  }
  yy += 0.3;
  card(s, 0.6, yy, SLIDE_W - 1.2, 1.5, THEME.darkBlue);
  s.addText(
    "BTPM remains the canonical source of truth. This deck is an output artifact generated from canonical BTPM data at the time stamped above. Re-generate to refresh.",
    {
      x: 0.85, y: yy + 0.2, w: SLIDE_W - 1.7, h: 1.1,
      fontSize: 12, color: THEME.navy, fontFace: THEME.font, italic: true, valign: "middle", margin: 0,
    },
  );
  if (d.warnings.length > 0) {
    const wy = yy + 1.7;
    uppercaseLabel(s, 0.6, wy, SLIDE_W - 1.2, 0.25, "Warnings", THEME.amber, 10);
    s.addText(d.warnings.join("  ·  "), {
      x: 0.6, y: wy + 0.3, w: SLIDE_W - 1.2, h: 0.6,
      fontSize: 9, color: THEME.mutedText, fontFace: THEME.font, margin: 0,
    });
  }
  addRoadmapFooter(s, d);
}

// =============================================================== util ====

export function drawEmptyState(s: any, msg: string) {
  s.addShape("roundRect", {
    x: 0.5, y: 1.4, w: SLIDE_W - 1.0, h: SLIDE_H - 2.2,
    fill: { color: THEME.white }, line: { color: THEME.cardBorder, width: 0.5 }, rectRadius: 0.08,
  });
  s.addText(msg, {
    x: 0.5, y: SLIDE_H / 2 - 0.4, w: SLIDE_W - 1.0, h: 0.8,
    fontSize: 16, color: THEME.mutedText, fontFace: THEME.font, align: "center", italic: true, margin: 0,
  });
}

export function listMonthStarts(minMs: number, maxMs: number): Date[] {
  const out: Date[] = [];
  const start = new Date(minMs);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  let cur = new Date(Date.UTC(y, m, 1));
  if (cur.getTime() < minMs) { m++; cur = new Date(Date.UTC(y, m, 1)); }
  const span = maxMs - minMs;
  const months = Math.max(1, Math.ceil(span / (30 * 86_400_000)));
  const step = months > 18 ? 3 : months > 9 ? 2 : 1;
  while (cur.getTime() <= maxMs && out.length < 24) {
    out.push(cur);
    m += step;
    cur = new Date(Date.UTC(y, m, 1));
  }
  return out;
}

export function fmtMonth(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function humanSchedule(sig: string | null | undefined): string {
  switch ((sig || "").toLowerCase()) {
    case "on_track": return "On track";
    case "behind_schedule": return "Behind";
    case "complete": return "Complete";
    case "no_schedule_basis": return "No basis";
    default: return "—";
  }
}
export function scheduleColor(sig: string | null | undefined): string {
  switch ((sig || "").toLowerCase()) {
    case "on_track": return getPmHealthReportHex("on_track");
    case "needs_attention": return getPmHealthReportHex("needs_attention");
    case "behind_schedule": return getPmHealthReportHex("behind");
    case "at_risk": return getPmHealthReportHex("at_risk");
    case "blocked": return getPmHealthReportHex("blocked");
    case "overdue": return getPmHealthReportHex("overdue");
    case "complete": return getPmWorkflowStatusReportHex("completed");
    default: return THEME.neutralGrey;
  }
}
