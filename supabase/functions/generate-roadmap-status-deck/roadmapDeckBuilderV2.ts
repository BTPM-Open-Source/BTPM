// Roadmap Status Deck v2 — PPTX builder.
//
// Reuses v1 visual language (BTPM navy/red theme, fonts, footer, safe-area
// constants). Differences vs. v1:
//   - Removed Executive Portfolio Summary slide.
//   - Restored Portfolio Control Board slide (after Cover).
//   - Empty group slides (Needs Attention / Current / Upcoming / Completed /
//     Program Timelines) are skipped.
//   - Current / Upcoming / Completed each get their own adaptive paginated
//     project-card slides (no oversized half-slide panels).
//   - Slide order: Cover → Portfolio Control Board → Dashboard pages →
//     Needs Attention → Current → Upcoming → Completed/Closed/Cancelled →
//     Program Timelines → Calendar → Annex divider → Project Detail slides
//     → Scope & Notes.
//
// Internal PPT navigation links are RE-ENABLED using PptxGenJS official
// internal-slide hyperlink syntax (`hyperlink: { slide: <1-based number> }`).
// A deterministic SlidePlan is computed BEFORE any slide is emitted, so
// hyperlink targets match the final generated deck order exactly. Targets
// are validated (integer, >=1, <= finalSlideCount, project id present in
// registry); if validation fails the deck is emitted WITHOUT internal links
// rather than producing a corrupted PPTX. No custom XML relationships are
// hand-crafted; no URL-style links are used for internal navigation.
//
// v1 file is left untouched so the old template can still be reactivated
// via ROADMAP_DECK_VERSION=v1.


import PptxGenJS from "npm:pptxgenjs@3.12.0";
import type { RoadmapDeckData, RoadmapDeckProject } from "./roadmapDeckDataMapper.ts";
import type { AnnexProjectData } from "./roadmapDeckAnnexMapper.ts";
import {
  THEME, SLIDE_W, SLIDE_H,
  ragColor, fmtDate, clip,
  addTitle, card, pill, uppercaseLabel, progressBar,
} from "./deckTheme.ts";
import {
  getPmWorkflowStatusLabel,
  getPmWorkflowStatusReportHex,
  getPmHealthReportHex,
} from "./btpmSemanticsMirror.ts";
import {
  buildCover, buildDashboardSlide,
  buildNeedsAttention,
  buildProgramTimelinePaginated, buildEmptyTimelineSlide,
  buildYearCalendar, buildMonthCalendar, buildNotesScope,
  sortByMgmtRelevance, drawCompactProjectCard, drawEmptyState,
  humanSchedule, projectBarColor, shortHealthLabel,
  addRoadmapFooter, deliveryModelLabel, addInternalSlideLinkText,
} from "./roadmapDeckBuilder.ts";

const CONTENT_BOTTOM = 6.75;
const DASHBOARD_CARDS_PER_SLIDE = 9;
const TIMELINE_MAX_PROJECTS_PER_SLIDE = 12;
// Category list slides (Current / Upcoming / Completed-Closed-Cancelled):
// clean full-width paginated lists. Rows include both project rows and
// sub-section header rows; paginate uniformly.
const LIST_ROWS_PER_SLIDE = 14;

export function roadmapDeckFilenameForV2(scopeLabel: string, generatedAtIso: string): string {
  const safe = (scopeLabel || "Roadmap").replace(/[\\/:*?"<>|#%]/g, "").trim().slice(0, 80);
  const d = generatedAtIso.slice(0, 10);
  return `BTPM Roadmap Status Deck v2 - ${safe} - ${d}.pptx`;
}

interface SlidePlan {
  total: number;
  dashboardFirst: number; // 1-based
  dashboardPages: number;
  needsAttention: number | null;
  current: number | null;
  currentFirst: number | null;
  currentPages: number;
  upcomingFirst: number | null;
  upcomingPages: number;
  completedFirst: number | null;
  completedPages: number;
  programTimelineFirst: number | null;
  programTimelinePagesPerBucket: number[];
  calendar: number;
  annexDivider: number | null;
  detailFirst: number | null;
  detailByProjectId: Map<string, number>;
  scopeNotes: number;
}

function planSlides(d: RoadmapDeckData, sortedProjects: RoadmapDeckProject[]): SlidePlan {
  const totalProjects = sortedProjects.length;
  const dashboardPages = totalProjects === 0
    ? 1 // we still render a single dashboard slide showing "no projects"
    : Math.ceil(totalProjects / DASHBOARD_CARDS_PER_SLIDE);

  const pagesFor = (n: number) => n <= 0 ? 0 : Math.ceil(n / LIST_ROWS_PER_SLIDE);

  const currentPages = pagesFor(d.current.length);
  const upcomingPages = pagesFor(d.upcoming.length);
  const completedPages = pagesFor(completedListRowCount(d.completed));

  const programTimelinePagesPerBucket: number[] = d.programBuckets.length === 0
    ? [1] // mirrors v1 behaviour: shows one "no programs" slide
    : d.programBuckets.map((b) =>
        Math.max(1, Math.ceil(b.projects.length / TIMELINE_MAX_PROJECTS_PER_SLIDE)));

  let cur = 1;
  cur++; // Cover
  cur++; // Portfolio Control Board
  const dashboardFirst = cur;
  cur += dashboardPages;

  const needsAttention = d.needsAttention.length > 0 ? cur++ : null;

  const currentFirst = currentPages > 0 ? cur : null;
  cur += currentPages;
  const upcomingFirst = upcomingPages > 0 ? cur : null;
  cur += upcomingPages;
  const completedFirst = completedPages > 0 ? cur : null;
  cur += completedPages;

  const programTimelineFirst = programTimelinePagesPerBucket.length > 0 ? cur : null;
  for (const p of programTimelinePagesPerBucket) cur += p;

  const calendar = cur++;

  const detailByProjectId = new Map<string, number>();
  let annexDivider: number | null = null;
  let detailFirst: number | null = null;
  if (sortedProjects.length > 0) {
    annexDivider = cur++;
    detailFirst = cur;
    for (let i = 0; i < sortedProjects.length; i++) {
      detailByProjectId.set(sortedProjects[i].id, cur);
      cur++;
    }
  }
  const scopeNotes = cur++;

  return {
    total: cur - 1,
    dashboardFirst, dashboardPages,
    needsAttention,
    current: null,
    currentFirst, currentPages,
    upcomingFirst, upcomingPages,
    completedFirst, completedPages,
    programTimelineFirst, programTimelinePagesPerBucket,
    calendar, annexDivider, detailFirst, detailByProjectId, scopeNotes,
  };
}

export async function buildRoadmapDeckBufferV2(
  d: RoadmapDeckData,
  annexByProject: Map<string, AnnexProjectData>,
): Promise<{ bytes: Uint8Array; slideCount: number }> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";

  const sortedProjects = sortByMgmtRelevance(d.projects);
  const plan = planSlides(d, sortedProjects);

  // --- Internal link registry (built BEFORE any slide is emitted) ---
  const dashboardFirstSlideNumber = plan.dashboardFirst;
  const needsAttentionSlideNumber = plan.needsAttention; // may be null
  const projectDetailSlideByProjectId = plan.detailByProjectId;
  const finalSlideCount = plan.total;

  // Validate all candidate hyperlink targets up-front. If any check fails,
  // disable internal links for the whole deck (do not emit a broken PPTX).
  const registryLinksEnabled = validateLinkRegistry({
    finalSlideCount,
    dashboardFirstSlideNumber,
    needsAttentionSlideNumber,
    projectDetailSlideByProjectId,
    projectIds: sortedProjects.map((p) => p.id),
  });

  let { slideCount, linksActive } = emitRoadmapSlides(pres, d, annexByProject, sortedProjects, plan, registryLinksEnabled);
  let deck = pres;
  if (linksActive && slideCount !== finalSlideCount) {
    console.warn(`[roadmap-deck-v2] slide count mismatch with links: planned=${finalSlideCount} actual=${slideCount}; regenerating without links`);
    deck = new PptxGenJS();
    deck.layout = "LAYOUT_WIDE";
    ({ slideCount, linksActive } = emitRoadmapSlides(deck, d, annexByProject, sortedProjects, plan, false));
  }

  if (slideCount !== finalSlideCount) {
    console.warn(`[roadmap-deck-v2] slide count mismatch: planned=${finalSlideCount} actual=${slideCount}`);
  }

  const out = (await deck.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return { bytes: new Uint8Array(out), slideCount };
}

function emitRoadmapSlides(
  pres: any,
  d: RoadmapDeckData,
  annexByProject: Map<string, AnnexProjectData>,
  sortedProjects: RoadmapDeckProject[],
  plan: SlidePlan,
  linksEnabled: boolean,
): { slideCount: number; linksActive: boolean } {
  const finalSlideCount = plan.total;
  const dashboardFirstSlideNumber = plan.dashboardFirst;
  const projectDetailSlideByProjectId = plan.detailByProjectId;

  const linkForProject = (id: string): number | undefined => {
    if (!linksEnabled) return undefined;
    const t = projectDetailSlideByProjectId.get(id);
    if (!isValidTarget(t, finalSlideCount)) return undefined;
    return t;
  };
  const backToDashboardSlide = linksEnabled && isValidTarget(dashboardFirstSlideNumber, finalSlideCount)
    ? dashboardFirstSlideNumber : undefined;

  let n = 0;
  buildCover(pres, d); n++;
  buildPortfolioControlBoard(pres, d); n++;

  if (sortedProjects.length === 0) {
    buildDashboardSlide(pres, d, [], 1, 1, 0, 0);
    n++;
  } else {
    for (let p = 0; p < plan.dashboardPages; p++) {
      const startIdx = p * DASHBOARD_CARDS_PER_SLIDE;
      const slice = sortedProjects.slice(startIdx, startIdx + DASHBOARD_CARDS_PER_SLIDE);
      buildDashboardSlide(
        pres, d, slice, p + 1, plan.dashboardPages, startIdx, sortedProjects.length,
        { linkSlideForProject: linkForProject },
      );
      n++;
    }
  }

  if (plan.needsAttention !== null) {
    buildNeedsAttention(pres, d, { linkSlideForProject: linkForProject });
    n++;
  }

  if (plan.currentPages > 0) {
    n += buildCurrentListSlides(pres, d, sortByMgmtRelevance(d.current), linkForProject);
  }
  if (plan.upcomingPages > 0) {
    n += buildUpcomingListSlides(pres, d, d.upcoming, linkForProject);
  }
  if (plan.completedPages > 0) {
    n += buildCompletedGroupedListSlides(pres, d, d.completed, linkForProject);
  }

  if (d.programBuckets.length === 0) {
    buildEmptyTimelineSlide(pres, d); n++;
  } else {
    for (const b of d.programBuckets) {
      n += buildProgramTimelinePaginated(pres, d, b);
    }
  }

  if (d.scope.calendarMode === "year") {
    buildYearCalendar(pres, d); n++;
  } else {
    buildMonthCalendar(pres, d); n++;
  }

  if (plan.annexDivider !== null) {
    buildAnnexDivider(pres, d, sortedProjects.length); n++;
    for (const p of sortedProjects) {
      const ax = annexByProject.get(p.id);
      buildProjectAnnexSlide(pres, d, p, ax, backToDashboardSlide); n++;
    }
  }

  // Scope & notes is always the final slide.
  buildNotesScope(pres, d); n++;

  return { slideCount: n, linksActive: linksEnabled };
}

// ------------------------- Link registry validation -------------------------

function isValidTarget(t: number | undefined | null, finalSlideCount: number): t is number {
  return typeof t === "number" && Number.isInteger(t) && t >= 1 && t <= finalSlideCount;
}

function validateLinkRegistry(args: {
  finalSlideCount: number;
  dashboardFirstSlideNumber: number;
  needsAttentionSlideNumber: number | null;
  projectDetailSlideByProjectId: Map<string, number>;
  projectIds: string[];
}): boolean {
  const { finalSlideCount, dashboardFirstSlideNumber,
    needsAttentionSlideNumber, projectDetailSlideByProjectId, projectIds } = args;
  try {
    if (!isValidTarget(dashboardFirstSlideNumber, finalSlideCount)) {
      console.warn("[roadmap-deck-v2] link disabled: dashboardFirst invalid");
      return false;
    }
    if (needsAttentionSlideNumber !== null
      && !isValidTarget(needsAttentionSlideNumber, finalSlideCount)) {
      console.warn("[roadmap-deck-v2] link disabled: needsAttention invalid");
      return false;
    }
    for (const id of projectIds) {
      const t = projectDetailSlideByProjectId.get(id);
      if (!isValidTarget(t, finalSlideCount)) {
        console.warn(`[roadmap-deck-v2] link disabled: project ${id} has invalid target ${t}`);
        return false;
      }
    }
    return true;
  } catch (e) {
    console.warn(`[roadmap-deck-v2] link validation threw: ${(e as Error).message}`);
    return false;
  }
}


// =================================== Category list slide builders ============
//
// Current Execution / Upcoming / Completed-Closed-Cancelled render as clean
// paginated full-width project lists (NOT dashboard tiles). No status, health,
// schedule, or progress chips appear — those live on Dashboard + Project Detail
// slides. Sub-section headers (Completed / Closed / Cancelled) flow inline.

type ListColumn = {
  header: string;
  x: number;
  w: number;
  align?: "left" | "right" | "center";
};

type ListRow =
  | { kind: "project"; index: number; project: RoadmapDeckProject }
  | { kind: "subheader"; label: string };

const LIST_LEFT = 0.5;
const LIST_RIGHT = SLIDE_W - 0.5;
const LIST_WIDTH = LIST_RIGHT - LIST_LEFT; // 12.333
const LIST_TOP = 1.15;
const LIST_HEADER_H = 0.34;
const LIST_ROW_H = 0.36;

function dmCell(p: RoadmapDeckProject): string {
  // delivery_model shown only when populated; otherwise blank.
  return deliveryModelLabel(p.deliveryModel) ?? "";
}
function wsProgCell(p: RoadmapDeckProject): string {
  return p.programName ? `${p.workspaceName} · ${p.programName}` : (p.workspaceName || "—");
}

function currentColumns(): ListColumn[] {
  // # | Project | Workspace · Program | Delivery model | Target end
  const x0 = LIST_LEFT;
  return [
    { header: "#",                   x: x0,        w: 0.45 },
    { header: "Project",             x: x0 + 0.45, w: 5.4 },
    { header: "Workspace · Program", x: x0 + 5.85, w: 3.6 },
    { header: "Delivery model",      x: x0 + 9.45, w: 1.7 },
    { header: "Target end",          x: x0 + 11.15, w: LIST_WIDTH - 11.15, align: "right" },
  ];
}
function upcomingColumns(): ListColumn[] {
  // # | Project | Workspace · Program | Delivery model | Planned start | Target end
  const x0 = LIST_LEFT;
  return [
    { header: "#",                   x: x0,         w: 0.45 },
    { header: "Project",             x: x0 + 0.45, w: 4.7 },
    { header: "Workspace · Program", x: x0 + 5.15, w: 3.3 },
    { header: "Delivery model",      x: x0 + 8.45, w: 1.65 },
    { header: "Planned start",       x: x0 + 10.10, w: 1.1, align: "right" },
    { header: "Target end",          x: x0 + 11.20, w: LIST_WIDTH - 11.20, align: "right" },
  ];
}
function completedColumns(lastLabel: string): ListColumn[] {
  // # | Project | Workspace · Program | Delivery model | End date (or Target end)
  const x0 = LIST_LEFT;
  return [
    { header: "#",                   x: x0,         w: 0.45 },
    { header: "Project",             x: x0 + 0.45, w: 5.4 },
    { header: "Workspace · Program", x: x0 + 5.85, w: 3.6 },
    { header: "Delivery model",      x: x0 + 9.45, w: 1.7 },
    { header: lastLabel,             x: x0 + 11.15, w: LIST_WIDTH - 11.15, align: "right" },
  ];
}

function cellsForCurrent(p: RoadmapDeckProject, n: number): string[] {
  return [String(n), p.name, wsProgCell(p), dmCell(p), fmtDate(p.targetEndDate)];
}
function cellsForUpcoming(p: RoadmapDeckProject, n: number): string[] {
  return [String(n), p.name, wsProgCell(p), dmCell(p), fmtDate(p.startDate), fmtDate(p.targetEndDate)];
}
function cellsForCompleted(p: RoadmapDeckProject, n: number): string[] {
  return [String(n), p.name, wsProgCell(p), dmCell(p), fmtDate(p.targetEndDate)];
}

// --- Completed/Closed/Cancelled grouping ---

function completedSubGroup(p: RoadmapDeckProject): "Completed" | "Closed" | "Cancelled" {
  const s = (p.status || "").toLowerCase();
  if (s === "cancelled" || s === "canceled") return "Cancelled";
  if (s === "closed") return "Closed";
  return "Completed";
}

function buildCompletedRows(items: RoadmapDeckProject[]): ListRow[] {
  const buckets: Array<{ label: "Completed" | "Closed" | "Cancelled"; items: RoadmapDeckProject[] }> = [
    { label: "Completed", items: [] },
    { label: "Closed",    items: [] },
    { label: "Cancelled", items: [] },
  ];
  for (const p of items) {
    const g = completedSubGroup(p);
    buckets.find((b) => b.label === g)!.items.push(p);
  }
  const rows: ListRow[] = [];
  let n = 1;
  for (const b of buckets) {
    if (b.items.length === 0) continue;
    rows.push({ kind: "subheader", label: b.label });
    for (const p of b.items) {
      rows.push({ kind: "project", index: n++, project: p });
    }
  }
  return rows;
}

function completedListRowCount(items: RoadmapDeckProject[]): number {
  if (items.length === 0) return 0;
  return buildCompletedRows(items).length;
}

// --- Builders ---

function buildCurrentListSlides(
  pres: any, d: RoadmapDeckData, items: RoadmapDeckProject[],
  linkForProject?: (id: string) => number | undefined,
): number {
  if (items.length === 0) return 0;
  const rows: ListRow[] = items.map((p, i) => ({ kind: "project", index: i + 1, project: p }));
  return renderListSlides(pres, d, "Current Execution", rows, items.length, (p, n) => cellsForCurrent(p, n), currentColumns(), false, linkForProject);
}

function buildUpcomingListSlides(
  pres: any, d: RoadmapDeckData, items: RoadmapDeckProject[],
  linkForProject?: (id: string) => number | undefined,
): number {
  if (items.length === 0) return 0;
  const rows: ListRow[] = items.map((p, i) => ({ kind: "project", index: i + 1, project: p }));
  return renderListSlides(pres, d, "Upcoming", rows, items.length, (p, n) => cellsForUpcoming(p, n), upcomingColumns(), false, linkForProject);
}

function buildCompletedGroupedListSlides(
  pres: any, d: RoadmapDeckData, items: RoadmapDeckProject[],
  linkForProject?: (id: string) => number | undefined,
): number {
  if (items.length === 0) return 0;
  const rows = buildCompletedRows(items);
  if (rows.length === 0) return 0;
  const cols = completedColumns("End / target date");
  return renderListSlides(
    pres, d, "Completed / Closed / Cancelled",
    rows, items.length,
    (p, n) => cellsForCompleted(p, n),
    cols,
    /* perSlideTitle */ true,
    linkForProject,
  );
}

function renderListSlides(
  pres: any, d: RoadmapDeckData, groupTitle: string,
  rows: ListRow[], totalProjects: number,
  rowCells: (p: RoadmapDeckProject, n: number) => string[],
  cols: ListColumn[],
  perSlideTitle = false,
  linkForProject?: (id: string) => number | undefined,
): number {
  const pages: ListRow[][] = [];
  for (let i = 0; i < rows.length; i += LIST_ROWS_PER_SLIDE) {
    pages.push(rows.slice(i, i + LIST_ROWS_PER_SLIDE));
  }

  for (let p = 0; p < pages.length; p++) {
    const slice = pages[p];
    const projRows = slice.filter((r) => r.kind === "project") as Array<{ kind: "project"; index: number; project: RoadmapDeckProject }>;
    const firstIdx = projRows[0]?.index ?? 0;
    const lastIdx = projRows[projRows.length - 1]?.index ?? 0;

    const title = pages.length > 1 ? `${groupTitle} · ${p + 1}` : groupTitle;
    const subtitle = pages.length > 1 && projRows.length > 0
      ? `Projects ${firstIdx}–${lastIdx} of ${totalProjects}`
      : `${totalProjects} project${totalProjects === 1 ? "" : "s"}`;
    drawListSlide(pres, d, title, subtitle, slice, rowCells, cols, perSlideTitle, linkForProject);
  }
  return pages.length;
}

function drawListSlide(
  pres: any, d: RoadmapDeckData,
  title: string, subtitle: string,
  rows: ListRow[],
  rowCells: (p: RoadmapDeckProject, n: number) => string[],
  cols: ListColumn[],
  _perSlideTitle: boolean,
  linkForProject?: (id: string) => number | undefined,
) {
  const s = pres.addSlide();
  s.background = { color: THEME.white };
  addTitle(s, title, subtitle);

  const headerY = LIST_TOP;
  s.addShape("rect", {
    x: LIST_LEFT, y: headerY, w: LIST_WIDTH, h: LIST_HEADER_H,
    fill: { color: THEME.lightBg }, line: { type: "none" },
  });
  for (const c of cols) {
    s.addText(c.header, {
      x: c.x + 0.08, y: headerY, w: c.w - 0.16, h: LIST_HEADER_H,
      fontSize: 9, bold: true, color: THEME.mutedText, fontFace: THEME.font,
      charSpacing: 2, valign: "middle", align: c.align ?? "left", margin: 0,
    });
  }

  let y = headerY + LIST_HEADER_H;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind === "subheader") {
      s.addShape("rect", {
        x: LIST_LEFT, y, w: LIST_WIDTH, h: LIST_ROW_H,
        fill: { color: "EDEFF4" }, line: { type: "none" },
      });
      s.addShape("rect", {
        x: LIST_LEFT, y, w: 0.06, h: LIST_ROW_H,
        fill: { color: THEME.red }, line: { type: "none" },
      });
      s.addText(row.label, {
        x: LIST_LEFT + 0.18, y, w: LIST_WIDTH - 0.36, h: LIST_ROW_H,
        fontSize: 11, bold: true, color: THEME.navy, fontFace: THEME.font,
        valign: "middle", margin: 0, charSpacing: 1,
      });
    } else {
      if (row.index % 2 === 0) {
        s.addShape("rect", {
          x: LIST_LEFT, y, w: LIST_WIDTH, h: LIST_ROW_H,
          fill: { color: "F7F8FB" }, line: { type: "none" },
        });
      }
      const cells = rowCells(row.project, row.index);
      for (let ci = 0; ci < cols.length; ci++) {
        const c = cols[ci];
        const isProject = ci === 1;
        const targetSlide = isProject ? linkForProject?.(row.project.id) : undefined;
        addInternalSlideLinkText(s, cells[ci] ?? "", {
          x: c.x + 0.08, y, w: c.w - 0.16, h: LIST_ROW_H,
          valign: "middle", align: c.align ?? "left", margin: 0,
          fit: "shrink",
        }, {
          fontSize: isProject ? 11 : 10,
          bold: isProject,
          color: THEME.navy, fontFace: THEME.font,
        }, targetSlide, "Open project detail");
      }
      s.addShape("line", {
        x: LIST_LEFT, y: y + LIST_ROW_H, w: LIST_WIDTH, h: 0,
        line: { color: "E5E7EB", width: 0.5 },
      });
    }
    y += LIST_ROW_H;
  }

  addRoadmapFooter(s, d);
}



// =========================================================== Annex divider ====

function buildAnnexDivider(pres: any, d: RoadmapDeckData, projectCount: number) {
  const s = pres.addSlide();
  s.background = { color: THEME.navy };
  s.addShape("rect", { x: 0.5, y: 2.6, w: 0.6, h: 0.08,
    fill: { color: THEME.red }, line: { type: "none" } });
  s.addText("Annex — Project Details", {
    x: 0.5, y: 2.75, w: SLIDE_W - 1.0, h: 1.0,
    fontSize: 44, bold: true, color: THEME.white, fontFace: THEME.font, margin: 0,
  });
  s.addText(
    `Supporting detail for ${projectCount} project(s) included in this Roadmap deck`,
    {
      x: 0.5, y: 3.75, w: SLIDE_W - 1.0, h: 0.5,
      fontSize: 16, color: "C8D1E8", fontFace: THEME.font, margin: 0,
    },
  );
  s.addText("BTPM remains the source of truth. Open each project in BTPM for full detail.", {
    x: 0.5, y: 4.35, w: SLIDE_W - 1.0, h: 0.4,
    fontSize: 11, color: "9CA8C7", fontFace: THEME.font, italic: true, margin: 0,
  });
  s.addShape("rect", { x: 0, y: SLIDE_H - 0.4, w: SLIDE_W, h: 0.4,
    fill: { color: THEME.darkBlue }, line: { type: "none" } });
  s.addText("BTPM", {
    x: SLIDE_W - 4.2, y: SLIDE_H - 0.4, w: 3.9, h: 0.4,
    fontSize: 9, color: "9CA8C7", fontFace: THEME.font,
    charSpacing: 2, align: "right", valign: "middle", margin: 0,
  });
}

// =================================================== Per-project annex slide ====

function buildProjectAnnexSlide(
  pres: any, d: RoadmapDeckData, p: RoadmapDeckProject, ax: AnnexProjectData | undefined,
  backToDashboardSlide?: number,
) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  addTitle(s, `Project Detail · ${clip(p.name, 60)}`,
    `${p.workspaceName}${p.programName ? " · " + p.programName : ""}`);

  // Small "Back to Dashboard" text link in the top-right of the title band.
  // Uses official PptxGenJS rich-text internal slide hyperlink syntax; only
  // emitted when a validated target slide number is provided.
  if (backToDashboardSlide) {
    addInternalSlideLinkText(s, "← Back to Dashboard", {
      x: SLIDE_W - 2.4, y: 0.32, w: 1.9, h: 0.32,
      align: "right", valign: "middle", margin: 0,
    }, {
      fontSize: 10, color: THEME.darkBlue, fontFace: THEME.font,
      italic: true,
    }, backToDashboardSlide, "Back to Roadmap Dashboard");
  }



  // ---- A. Identity card (left column, top) ----
  const leftX = 0.5;
  const colW = 4.2;
  const idTop = 1.15;
  const idH = 3.0;
  card(s, leftX, idTop, colW, idH, ragColor(p.healthRag));
  uppercaseLabel(s, leftX + 0.18, idTop + 0.14, colW - 0.36, 0.22, "Project identity", THEME.navy, 9);

  const dmLabel = deliveryModelLabel(p.deliveryModel); // null when unset → row omitted
  const rows: Array<[string, string]> = [
    ["Workspace", p.workspaceName || "—"],
    ["Program", p.programName || "—"],
    ["Owner / PM", ((ax?.pmNames ?? []).concat(ax?.ownerNames ?? p.ownerNames ?? []).filter(Boolean).join(", ")) || "—"],
    ["Status", p.status ? getPmWorkflowStatusLabel(p.status) : "—"],
    ["Health", p.healthLabel || "—"],
    ["Schedule", humanScheduleLocal(p.scheduleSignal)],
    ["Target end", fmtDate(p.targetEndDate)],
  ];
  if (dmLabel) rows.push(["Delivery model", dmLabel]);
  const rowTop = idTop + 0.42;
  const rowH = 0.24;
  for (let i = 0; i < rows.length; i++) {
    const yy = rowTop + i * rowH;
    s.addText(rows[i][0], {
      x: leftX + 0.2, y: yy, w: 1.4, h: rowH,
      fontSize: 9, bold: true, color: THEME.mutedText, fontFace: THEME.font,
      valign: "middle", margin: 0,
    });
    s.addText(clip(rows[i][1], 40), {
      x: leftX + 1.65, y: yy, w: colW - 1.85, h: rowH,
      fontSize: 9, color: THEME.navy, fontFace: THEME.font, valign: "middle", margin: 0,
    });
  }
  const pct = Math.round(p.completionPercent ?? 0);
  const barY = idTop + idH - 0.5;
  uppercaseLabel(s, leftX + 0.2, barY - 0.22, colW - 0.4, 0.2, `Progress · ${pct}%`, THEME.navy, 8);
  progressBar(s, leftX + 0.2, barY, colW - 0.4, 0.16, pct, ragColor(p.healthRag));

  // ---- D. Risks & Blockers (left column, bottom) ----
  const rbTop = idTop + idH + 0.2;
  const rbH = CONTENT_BOTTOM - rbTop;
  card(s, leftX, rbTop, colW, rbH, THEME.alertRed);
  uppercaseLabel(s, leftX + 0.18, rbTop + 0.14, colW - 0.36, 0.22, "Risks & blockers", THEME.navy, 9);
  const openBl = ax?.openBlockersCount ?? 0;
  const highRk = ax?.highImpactRisksCount ?? 0;
  pill(s, leftX + 0.2, rbTop + 0.42, 1.95, 0.26,
    `${openBl} open blocker${openBl === 1 ? "" : "s"}`,
    openBl > 0 ? THEME.alertRed : THEME.neutralGrey, THEME.white, { fontSize: 9, bold: true });
  pill(s, leftX + 0.2 + 1.95 + 0.1, rbTop + 0.42, 1.85, 0.26,
    `${highRk} high-impact risk${highRk === 1 ? "" : "s"}`,
    highRk > 0 ? getPmHealthReportHex("at_risk") : THEME.neutralGrey, THEME.white, { fontSize: 9, bold: true });

  const listTop = rbTop + 0.85;
  const halfH = (rbH - 1.0) / 2;
  uppercaseLabel(s, leftX + 0.2, listTop, colW - 0.4, 0.2, "Top blockers", THEME.alertRed, 8);
  drawTinyList(s, leftX + 0.2, listTop + 0.22, colW - 0.4, halfH - 0.22,
    (ax?.topBlockers ?? []).map((b) => ({
      title: b.title, badge: b.severity || b.status || "Open", color: THEME.alertRed,
    })), "No blockers recorded.");
  uppercaseLabel(s, leftX + 0.2, listTop + halfH + 0.1, colW - 0.4, 0.2, "Top risks", getPmHealthReportHex("at_risk"), 8);
  drawTinyList(s, leftX + 0.2, listTop + halfH + 0.32, colW - 0.4, halfH - 0.22,
    (ax?.topRisks ?? []).map((r) => ({
      title: r.title, badge: r.severity || r.status || "Open", color: getPmHealthReportHex("at_risk"),
    })), "No risks recorded.");

  // ---- Right column: Progress, Governance, Timeline ----
  const rightX = leftX + colW + 0.25;
  const rightW = SLIDE_W - 0.5 - rightX;

  const progTop = 1.15;
  const progH = 2.4;
  card(s, rightX, progTop, rightW, progH, THEME.darkBlue);
  uppercaseLabel(s, rightX + 0.18, progTop + 0.14, rightW - 0.36, 0.22,
    "Progress narrative · latest updates", THEME.navy, 9);
  drawProgressList(s, rightX + 0.18, progTop + 0.42, rightW - 0.36, progH - 0.5,
    ax?.progressEntries ?? [], ax?.progressMore ?? 0);

  const govTop = progTop + progH + 0.15;
  const govH = 1.85;
  card(s, rightX, govTop, rightW, govH, THEME.green);
  uppercaseLabel(s, rightX + 0.18, govTop + 0.14, rightW - 0.36, 0.22,
    "Governance summary", THEME.navy, 9);
  const cad = ax?.governanceCadence || null;
  const nx = ax?.governanceNextExpected || null;
  if (cad || nx) {
    s.addText(
      `${cad ? "Cadence: " + cad : ""}${cad && nx ? "   ·   " : ""}${nx ? "Next expected: " + nx : ""}`,
      {
        x: rightX + 0.18, y: govTop + 0.38, w: rightW - 0.36, h: 0.22,
        fontSize: 9, color: THEME.navy, fontFace: THEME.font, italic: true, margin: 0,
      });
  }
  drawGovernanceList(s, rightX + 0.18,
    govTop + (cad || nx ? 0.66 : 0.42), rightW - 0.36,
    govH - (cad || nx ? 0.78 : 0.5),
    ax?.governanceEntries ?? [], ax?.governanceMore ?? 0);

  const tlTop = govTop + govH + 0.15;
  const tlH = CONTENT_BOTTOM - tlTop;
  card(s, rightX, tlTop, rightW, tlH, THEME.navy);
  uppercaseLabel(s, rightX + 0.18, tlTop + 0.14, rightW - 0.36, 0.22,
    "Key dates", THEME.navy, 9);
  drawProjectMiniStrip(s, rightX + 0.18, tlTop + 0.42, rightW - 0.36, tlH - 0.55, p);

  addRoadmapFooter(s, d);
}

function humanScheduleLocal(sig: string | null | undefined): string {
  switch ((sig || "").toLowerCase()) {
    case "on_track": return "On track";
    case "behind_schedule": return "Behind";
    case "complete": return "Complete";
    case "no_schedule_basis": return "No basis";
    default: return "—";
  }
}

function drawTinyList(
  s: any, x: number, y: number, w: number, h: number,
  items: Array<{ title: string; badge: string; color: string }>,
  emptyMsg: string,
) {
  if (items.length === 0) {
    s.addText(emptyMsg, {
      x, y, w, h,
      fontSize: 9, color: THEME.mutedText, fontFace: THEME.font, italic: true, margin: 0,
    });
    return;
  }
  const rowH = Math.min(0.4, h / items.length);
  for (let i = 0; i < items.length; i++) {
    const yy = y + i * rowH;
    s.addText(`• ${clip(items[i].title, 48)}`, {
      x, y: yy, w: w - 1.0, h: rowH,
      fontSize: 9, color: THEME.navy, fontFace: THEME.font, valign: "middle", margin: 0,
    });
    pill(s, x + w - 0.95, yy + (rowH - 0.22) / 2, 0.95, 0.22,
      clip(items[i].badge, 10), items[i].color, THEME.white, { fontSize: 7, bold: true });
  }
}

function drawProgressList(
  s: any, x: number, y: number, w: number, h: number,
  items: Array<{ date: string | null; title: string; detail: string | null }>,
  more: number,
) {
  if (items.length === 0) {
    s.addText("No progress updates recorded.", {
      x, y, w, h,
      fontSize: 10, color: THEME.mutedText, fontFace: THEME.font, italic: true, margin: 0,
    });
    return;
  }
  const moreLineH = more > 0 ? 0.22 : 0;
  const rowH = (h - moreLineH) / items.length;
  for (let i = 0; i < items.length; i++) {
    const yy = y + i * rowH;
    if (i > 0) {
      s.addShape("rect", { x, y: yy, w, h: 0.005,
        fill: { color: THEME.cardBorder }, line: { type: "none" } });
    }
    s.addText(items[i].date || "—", {
      x, y: yy + 0.04, w: 0.95, h: 0.22,
      fontSize: 8, bold: true, color: THEME.mutedText, fontFace: THEME.font, margin: 0,
    });
    s.addText(clip(items[i].title, 70), {
      x: x + 1.0, y: yy + 0.04, w: w - 1.0, h: 0.24,
      fontSize: 10, bold: true, color: THEME.navy, fontFace: THEME.font, margin: 0,
    });
    if (items[i].detail) {
      s.addText(clip(items[i].detail!, 130), {
        x: x + 1.0, y: yy + 0.28, w: w - 1.0, h: rowH - 0.3,
        fontSize: 8, color: THEME.mutedText, fontFace: THEME.font, valign: "top", margin: 0,
      });
    }
  }
  if (more > 0) {
    s.addText(`+${more} more updates in BTPM`, {
      x, y: y + h - moreLineH, w, h: moreLineH,
      fontSize: 8, color: THEME.darkBlue, fontFace: THEME.font,
      italic: true, align: "right", margin: 0,
    });
  }
}

function drawGovernanceList(
  s: any, x: number, y: number, w: number, h: number,
  items: Array<{ date: string | null; title: string; status: string | null }>,
  more: number,
) {
  if (items.length === 0) {
    s.addText("No governance records captured.", {
      x, y, w, h,
      fontSize: 10, color: THEME.mutedText, fontFace: THEME.font, italic: true, margin: 0,
    });
    return;
  }
  const moreLineH = more > 0 ? 0.22 : 0;
  const rowH = (h - moreLineH) / items.length;
  for (let i = 0; i < items.length; i++) {
    const yy = y + i * rowH;
    s.addText(items[i].date || "—", {
      x, y: yy + 0.04, w: 0.95, h: rowH - 0.08,
      fontSize: 8, bold: true, color: THEME.mutedText, fontFace: THEME.font,
      valign: "middle", margin: 0,
    });
    s.addText(clip(items[i].title, 60), {
      x: x + 1.0, y: yy + 0.04, w: w - 2.2, h: rowH - 0.08,
      fontSize: 9, color: THEME.navy, fontFace: THEME.font, valign: "middle", margin: 0,
    });
    if (items[i].status) {
      pill(s, x + w - 1.15, yy + (rowH - 0.22) / 2, 1.1, 0.22,
        clip(items[i].status!, 14), THEME.green, THEME.white, { fontSize: 7, bold: true });
    }
  }
  if (more > 0) {
    s.addText(`+${more} more governance records in BTPM`, {
      x, y: y + h - moreLineH, w, h: moreLineH,
      fontSize: 8, color: THEME.green, fontFace: THEME.font,
      italic: true, align: "right", margin: 0,
    });
  }
}

function drawProjectMiniStrip(
  s: any, x: number, y: number, w: number, h: number, p: RoadmapDeckProject,
) {
  const labelY = y + 0.05;
  s.addText(`Planned start: ${fmtDate(p.startDate)}`, {
    x, y: labelY, w: w / 2, h: 0.24,
    fontSize: 9, color: THEME.navy, fontFace: THEME.font, margin: 0,
  });
  s.addText(`Target end: ${fmtDate(p.targetEndDate)}`, {
    x: x + w / 2, y: labelY, w: w / 2, h: 0.24,
    fontSize: 9, color: THEME.navy, fontFace: THEME.font, align: "right", margin: 0,
  });

  const trackY = y + 0.5;
  const trackH = Math.min(0.5, h - 0.7);
  const today = Date.now();
  if (!p.startDate && !p.targetEndDate) {
    s.addText("No dates set in BTPM.", {
      x, y: trackY, w, h: trackH,
      fontSize: 10, color: THEME.mutedText, fontFace: THEME.font,
      italic: true, align: "center", valign: "middle", margin: 0,
    });
    return;
  }
  const sMs = new Date((p.startDate ?? p.targetEndDate)!).getTime();
  const eMsRaw = new Date((p.targetEndDate ?? p.startDate)!).getTime();
  const eMs = Math.max(eMsRaw, sMs + 86_400_000);
  let minMs = sMs, maxMs = eMs;
  if (today < minMs) minMs = today - 7 * 86_400_000;
  if (today > maxMs) maxMs = today + 7 * 86_400_000;
  const span = maxMs - minMs;
  minMs -= span * 0.05; maxMs += span * 0.05;
  const tsX = (ms: number) => x + ((ms - minMs) / (maxMs - minMs)) * w;

  s.addShape("roundRect", {
    x, y: trackY + trackH * 0.4, w, h: trackH * 0.2,
    fill: { color: "E5E7EB" }, line: { type: "none" }, rectRadius: 0.05,
  });
  const bx = tsX(sMs), bw = Math.max(0.1, tsX(eMs) - bx);
  s.addShape("roundRect", {
    x: bx, y: trackY + trackH * 0.2, w: bw, h: trackH * 0.6,
    fill: { color: projectBarColor(p) },
    line: { color: THEME.navy, width: 0.5 }, rectRadius: 0.06,
  });
  if (today >= minMs && today <= maxMs) {
    const tx = tsX(today);
    s.addShape("rect", { x: tx, y: trackY, w: 0.02, h: trackH,
      fill: { color: THEME.red }, line: { type: "none" } });
    pill(s, Math.max(x, Math.min(tx - 0.35, x + w - 0.7)),
      trackY + trackH + 0.04, 0.7, 0.2,
      "TODAY", THEME.red, THEME.white, { fontSize: 7, bold: true });
  }
}

// =============================================== Portfolio Control Board ====
//
// Restored after user feedback. One-page live executive snapshot rendered
// directly after the Cover slide.

function buildPortfolioControlBoard(pres: any, d: RoadmapDeckData) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  addTitle(s, "Portfolio Control Board",
    "One-page live view of the selected Roadmap scope");

  s.addText(`Live as of ${fmtDate(d.generatedAt)}`, {
    x: SLIDE_W - 3.2, y: 0.32, w: 2.7, h: 0.32,
    fontSize: 10, color: THEME.mutedText, fontFace: THEME.font,
    align: "right", bold: true, margin: 0,
  });

  const openBlockers = (d as any).openBlockersTotal ?? null;
  const highRisks = (d as any).highImpactRisksTotal ?? null;
  const tiles: Array<{ label: string; value: string; accent: string }> = [
    { label: "TOTAL", value: String(d.portfolio.total), accent: THEME.navy },
    { label: "COMPLETED %", value: `${d.portfolio.completedPercent}%`, accent: getPmWorkflowStatusReportHex("completed") },
    { label: "IN PROGRESS", value: String(d.portfolio.inProgress), accent: getPmWorkflowStatusReportHex("active") },
    { label: "UPCOMING", value: String(d.portfolio.upcoming), accent: THEME.neutralGrey },
    { label: "AT RISK", value: String(d.portfolio.atRiskCount), accent: getPmHealthReportHex("at_risk") },
    { label: "BEHIND", value: String(d.portfolio.behindSchedule), accent: getPmHealthReportHex("behind") },
    { label: "OPEN BLOCKERS", value: openBlockers == null ? "—" : String(openBlockers), accent: THEME.alertRed },
    { label: "HIGH RISKS", value: highRisks == null ? "—" : String(highRisks), accent: getPmHealthReportHex("at_risk") },
  ];
  const stripY = 1.05;
  const stripH = 0.78;
  const stripW = SLIDE_W - 1.0;
  const cellW = stripW / tiles.length;
  card(s, 0.5, stripY, stripW, stripH, null);
  for (let i = 0; i < tiles.length; i++) {
    const cx = 0.5 + i * cellW;
    if (i > 0) {
      s.addShape("rect", {
        x: cx, y: stripY + 0.1, w: 0.008, h: stripH - 0.2,
        fill: { color: THEME.cardBorder }, line: { type: "none" },
      });
    }
    s.addText(tiles[i].label, {
      x: cx + 0.08, y: stripY + 0.06, w: cellW - 0.16, h: 0.22,
      fontSize: 7, bold: true, color: THEME.mutedText, fontFace: THEME.font,
      charSpacing: 2, margin: 0,
    });
    s.addText(tiles[i].value, {
      x: cx + 0.08, y: stripY + 0.28, w: cellW - 0.16, h: 0.46,
      fontSize: 18, bold: true, color: tiles[i].accent, fontFace: THEME.font,
      valign: "middle", margin: 0,
    });
  }

  const colTop = stripY + stripH + 0.25;
  const colH = 2.85;
  const colW = (SLIDE_W - 1.0 - 0.3) / 3;
  const colsData: Array<{ title: string; accent: string; items: RoadmapDeckProject[] }> = [
    { title: "Needs Attention", accent: getPmHealthReportHex("needs_attention"), items: d.needsAttention.slice(0, 5) },
    { title: "Current", accent: THEME.darkBlue, items: sortByMgmtRelevance(d.current).slice(0, 5) },
    { title: "Upcoming", accent: THEME.neutralGrey, items: d.upcoming.slice(0, 5) },
  ];
  const moreCounts = [
    Math.max(0, d.needsAttention.length - 5),
    Math.max(0, d.current.length - 5),
    Math.max(0, d.upcoming.length - 5),
  ];
  for (let c = 0; c < 3; c++) {
    const x = 0.5 + c * (colW + 0.15);
    drawControlColumn(s, x, colTop, colW, colH,
      colsData[c].title, colsData[c].accent, colsData[c].items, moreCounts[c]);
  }

  const miniTop = colTop + colH + 0.2;
  const miniH = CONTENT_BOTTOM - miniTop;
  const miniItems = pickMiniTimelineProjects(d);
  drawMiniRoadmap(s, 0.5, miniTop, SLIDE_W - 1.0, miniH, miniItems);

  addRoadmapFooter(s, d);
}

function drawControlColumn(
  s: any, x: number, y: number, w: number, h: number,
  title: string, accent: string, items: RoadmapDeckProject[], more: number,
) {
  card(s, x, y, w, h, accent);
  s.addText(title, {
    x: x + 0.18, y: y + 0.14, w: w - 0.9, h: 0.3,
    fontSize: 12, bold: true, color: THEME.navy, fontFace: THEME.font, margin: 0,
  });
  pill(s, x + w - 0.78, y + 0.16, 0.6, 0.26,
    String(items.length + more), accent, THEME.white, { fontSize: 9, bold: true });

  if (items.length === 0) {
    s.addText("No projects.", {
      x: x + 0.18, y: y + 0.6, w: w - 0.36, h: 0.3,
      fontSize: 10, color: THEME.mutedText, fontFace: THEME.font, italic: true, margin: 0,
    });
    return;
  }
  const rowTop = y + 0.5;
  const rowH = (h - 0.75) / 5;
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    const yy = rowTop + i * rowH;
    if (i > 0) {
      s.addShape("rect", { x: x + 0.18, y: yy, w: w - 0.36, h: 0.005,
        fill: { color: THEME.cardBorder }, line: { type: "none" } });
    }
    s.addText(clip(p.name, 38), {
      x: x + 0.18, y: yy + 0.05, w: w - 1.4, h: 0.24,
      fontSize: 10, bold: true, color: THEME.navy, fontFace: THEME.font, margin: 0,
    });
    const pct = Math.round(p.completionPercent ?? 0);
    progressBar(s, x + 0.18, yy + rowH - 0.16, w - 1.4, 0.08, pct, ragColor(p.healthRag));
    pill(s, x + w - 1.18, yy + 0.06, 1.0, 0.22,
      clip(shortHealthLabel(p), 12), ragColor(p.healthRag), THEME.white,
      { fontSize: 7, bold: true });
    s.addText(`Target ${fmtDate(p.targetEndDate)}`, {
      x: x + w - 1.18, y: yy + 0.3, w: 1.0, h: 0.18,
      fontSize: 7, color: THEME.mutedText, fontFace: THEME.font,
      align: "right", margin: 0,
    });
  }
  if (more > 0) {
    s.addText(`+${more} more`, {
      x: x + 0.18, y: y + h - 0.25, w: w - 0.36, h: 0.2,
      fontSize: 8, color: accent, fontFace: THEME.font,
      italic: true, bold: true, align: "right", margin: 0,
    });
  }
}

function pickMiniTimelineProjects(d: RoadmapDeckData): RoadmapDeckProject[] {
  const seen = new Set<string>();
  const out: RoadmapDeckProject[] = [];
  const push = (p: RoadmapDeckProject) => {
    if (seen.has(p.id)) return;
    seen.add(p.id); out.push(p);
  };
  for (const p of d.needsAttention) { if (out.length >= 5) break; push(p); }
  for (const p of sortByMgmtRelevance(d.current)) { if (out.length >= 5) break; push(p); }
  return out.slice(0, 5);
}

function drawMiniRoadmap(
  s: any, x: number, y: number, w: number, h: number,
  items: RoadmapDeckProject[],
) {
  card(s, x, y, w, h, THEME.navy);
  uppercaseLabel(s, x + 0.18, y + 0.1, w - 0.36, 0.22,
    "Mini Roadmap · Needs Attention then Current", THEME.navy, 9);

  if (items.length === 0) {
    s.addText("No relevant projects to plot.", {
      x: x + 0.18, y: y + h / 2 - 0.15, w: w - 0.36, h: 0.3,
      fontSize: 10, color: THEME.mutedText, fontFace: THEME.font,
      italic: true, align: "center", margin: 0,
    });
    return;
  }

  const datable = items.filter((p) => p.startDate || p.targetEndDate);
  const today = Date.now();
  let minMs: number, maxMs: number;
  if (datable.length > 0) {
    minMs = Math.min(...datable.map((p) =>
      new Date((p.startDate ?? p.targetEndDate)!).getTime()));
    maxMs = Math.max(...datable.map((p) =>
      new Date((p.targetEndDate ?? p.startDate)!).getTime()));
    if (minMs === maxMs) maxMs = minMs + 86_400_000;
    const span = maxMs - minMs;
    minMs -= span * 0.05; maxMs += span * 0.05;
    minMs = Math.min(minMs, today - 7 * 86_400_000);
    maxMs = Math.max(maxMs, today + 7 * 86_400_000);
  } else {
    minMs = today - 90 * 86_400_000;
    maxMs = today + 90 * 86_400_000;
  }

  const labelW = 2.2;
  const left = x + 0.18 + labelW;
  const right = x + w - 0.2;
  const trackW = right - left;
  const headerY = y + 0.4;
  const rowsTop = y + 0.78;
  const rowsBottom = y + h - 0.2;
  const rowH = (rowsBottom - rowsTop) / Math.max(items.length, 1);
  const tsX = (ms: number) => left + ((ms - minMs) / (maxMs - minMs)) * trackW;

  const monthStarts: Date[] = [];
  const sd = new Date(minMs);
  let cur = new Date(Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth(), 1));
  if (cur.getTime() < minMs) cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  while (cur.getTime() <= maxMs && monthStarts.length < 18) {
    monthStarts.push(cur);
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  for (const m of monthStarts) {
    const mx = tsX(m.getTime());
    s.addShape("rect", { x: mx, y: rowsTop, w: 0.005, h: rowsBottom - rowsTop,
      fill: { color: THEME.cardBorder }, line: { type: "none" } });
    s.addText(m.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }), {
      x: mx - 0.4, y: headerY, w: 0.8, h: 0.22,
      fontSize: 7, color: THEME.mutedText, fontFace: THEME.font,
      align: "center", margin: 0,
    });
  }

  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    const yy = rowsTop + i * rowH;
    s.addText(clip(p.name, 30), {
      x: x + 0.18, y: yy, w: labelW - 0.1, h: rowH,
      fontSize: 8, color: THEME.navy, fontFace: THEME.font,
      valign: "middle", bold: true, margin: 0,
    });
    if (!p.startDate && !p.targetEndDate) {
      pill(s, left + 0.05, yy + (rowH - 0.18) / 2, 1.0, 0.18,
        "No dates", THEME.neutralGrey, THEME.white, { fontSize: 6, bold: true });
      continue;
    }
    const sMs = new Date((p.startDate ?? p.targetEndDate)!).getTime();
    const eMsRaw = new Date((p.targetEndDate ?? p.startDate)!).getTime();
    const eMs = Math.max(eMsRaw, sMs + 86_400_000);
    const bx = tsX(sMs);
    const bw = Math.max(0.08, tsX(eMs) - bx);
    s.addShape("roundRect", {
      x: bx, y: yy + rowH * 0.22, w: bw, h: rowH * 0.56,
      fill: { color: projectBarColor(p) },
      line: { color: THEME.navy, width: 0.4 }, rectRadius: 0.06,
    });
  }
  if (today >= minMs && today <= maxMs) {
    const tx = tsX(today);
    s.addShape("rect", { x: tx, y: rowsTop, w: 0.018, h: rowsBottom - rowsTop,
      fill: { color: THEME.red }, line: { type: "none" } });
  }
}
