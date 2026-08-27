// PPT v3 — Weekly Project Status Deck builder (BTPM-branded).
// Native PowerPoint shapes/text/tables only. No screenshots.

import PptxGenJS from "npm:pptxgenjs@3.12.0";
import type {
  StatusDeckData, KpiView,
  PeriodDigestItem,
} from "./statusDeckDataMapper.ts";
import {
  THEME, SLIDE_W, SLIDE_H,
  ragColor, fmtDate, clip,
  addTitle, addFooter,
  card, pill, uppercaseLabel, progressBar, metricCard,
} from "./statusDeckTheme.ts";
import {
  getPmWorkflowStatusLabel,
  getPmWorkflowStatusReportHex,
  getPmHealthReportHex,
} from "./btpmSemanticsMirror.ts";
import { BTPM_LOGO_B64, BTPM_FAVICON_B64 } from "./deckAssets.ts";

function fmtMonth(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function deckFilenameFor(projectName: string, periodStart: string, periodEnd: string): string {
  const safe = (projectName || "Project").replace(/[\\/:*?"<>|#%]/g, "").trim().slice(0, 80);
  return `BTPM Weekly Status Deck - ${safe} - ${periodStart} to ${periodEnd}.pptx`;
}

export async function buildStatusDeckBuffer(d: StatusDeckData): Promise<{
  bytes: Uint8Array; slideCount: number;
}> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  const footerOpts = {
    projectName: d.project.name, periodStart: d.period.start,
    periodEnd: d.period.end, generatedAt: d.generatedAt,
    faviconB64: BTPM_FAVICON_B64,
  };

  buildCoverSlide(pres, d);
  buildExecutiveSummarySlide(pres, d, footerOpts);
  buildDashboardSlide(pres, d, footerOpts);
  buildTimelineSlide(pres, d, footerOpts);
  buildProgressSlide(pres, d, footerOpts);
  buildRisksBlockersSlide(pres, d, footerOpts);
  buildKpiSlide(pres, d, footerOpts);
  buildDecisionsSlide(pres, d, footerOpts);

  const out = (await pres.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return { bytes: new Uint8Array(out), slideCount: 8 };
}

// =============================================================== Cover ====

function buildCoverSlide(pres: any, d: StatusDeckData) {
  const s = pres.addSlide();
  s.background = { color: THEME.navy };

  // BTPM logo (top-left)
  s.addImage({
    data: BTPM_LOGO_B64,
    x: 0.5, y: 0.45, w: 1.6, h: 0.55,
  });
  // BTPM red accent line under the logo
  s.addShape("rect", {
    x: 0.5, y: 1.05, w: 0.6, h: 0.05,
    fill: { color: THEME.red }, line: { type: "none" },
  });

  s.addText("Weekly Project Status Deck", {
    x: 0.6, y: 1.4, w: 12, h: 0.5,
    fontSize: 16, color: "C8D1E8", fontFace: THEME.font,
    bold: true, charSpacing: 3, margin: 0,
  });

  // Project name — focal point
  s.addText(clip(d.project.name, 80), {
    x: 0.6, y: 2.0, w: 12, h: 1.8,
    fontSize: 50, color: THEME.white, fontFace: THEME.font, bold: true, margin: 0,
  });

  // Thin red accent line
  s.addShape("rect", {
    x: 0.6, y: 3.9, w: 1.6, h: 0.06,
    fill: { color: THEME.red }, line: { type: "none" },
  });

  const sub: string[] = [];
  if (d.project.workspaceName) sub.push(d.project.workspaceName);
  if (d.project.programName) sub.push(`Program: ${d.project.programName}`);
  if (d.project.portfolioLabel) sub.push(`Portfolio: ${d.project.portfolioLabel}`);
  if (d.organizationName) sub.push(d.organizationName);
  s.addText(sub.join("   ·   ") || " ", {
    x: 0.6, y: 4.1, w: 12, h: 0.45,
    fontSize: 16, color: "C8D1E8", fontFace: THEME.font, margin: 0,
  });

  // Reporting period block
  s.addText("REPORTING PERIOD", {
    x: 0.6, y: 5.2, w: 6, h: 0.3,
    fontSize: 10, color: "9CA8C7", fontFace: THEME.font, bold: true, charSpacing: 3, margin: 0,
  });
  s.addText(`${d.period.start}   →   ${d.period.end}`, {
    x: 0.6, y: 5.5, w: 6, h: 0.55,
    fontSize: 24, color: THEME.white, fontFace: THEME.font, bold: true, margin: 0,
  });

  // Generated block
  s.addText("GENERATED", {
    x: 7.0, y: 5.2, w: 6, h: 0.3,
    fontSize: 10, color: "9CA8C7", fontFace: THEME.font, bold: true, charSpacing: 3, margin: 0,
  });
  s.addText(`${fmtDate(d.generatedAt)}   ·   by ${d.generatedByLabel}`, {
    x: 7.0, y: 5.5, w: 6, h: 0.55,
    fontSize: 16, color: THEME.white, fontFace: THEME.font, margin: 0,
  });

  // Bottom branding strip
  s.addShape("rect", {
    x: 0, y: SLIDE_H - 0.4, w: SLIDE_W, h: 0.4,
    fill: { color: THEME.darkBlue }, line: { type: "none" },
  });
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

// ================================================== Executive Summary ====

function buildExecutiveSummarySlide(pres: any, d: StatusDeckData, footer: any) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  addTitle(s, "Executive Summary", `${d.period.start} → ${d.period.end}`);

  // ---- Left: 3-5 management signals ----
  const signals = buildManagementSignals(d);
  const leftX = 0.5, leftW = 7.6;
  let yy = 1.25;
  for (const sig of signals) {
    card(s, leftX, yy, leftW, 0.85, sig.color);
    uppercaseLabel(s, leftX + 0.25, yy + 0.13, 2.5, 0.25, sig.label, sig.color, 9);
    s.addText(sig.value, {
      x: leftX + 0.25, y: yy + 0.36, w: leftW - 0.4, h: 0.45,
      fontSize: 14, color: THEME.navy, fontFace: THEME.font, bold: true, margin: 0,
    });
    yy += 0.95;
  }

  // ---- Decisions & Asks (small, bottom-left) ----
  const decY = Math.max(yy + 0.1, 5.7);
  card(s, leftX, decY, leftW, SLIDE_H - decY - 0.5, null);
  uppercaseLabel(s, leftX + 0.25, decY + 0.12, 6, 0.28, "Decisions & Asks", THEME.navy, 10);
  const decCount = d.periodDigest.counts.decisions;
  const attnCount = d.periodDigest.counts.sponsorAttention;
  const decLine = (decCount === 0 && attnCount === 0)
    ? "No explicit decisions or sponsor-attention items recorded for this period."
    : `${decCount} decision${decCount === 1 ? "" : "s"} · ${attnCount} sponsor-attention item${attnCount === 1 ? "" : "s"} — see Decisions slide.`;
  s.addText(decLine, {
    x: leftX + 0.25, y: decY + 0.42, w: leftW - 0.4, h: SLIDE_H - decY - 1.0,
    fontSize: 10, color: THEME.mutedText, fontFace: THEME.font, italic: (decCount === 0 && attnCount === 0), margin: 0,
  });

  // ---- Right: Roadmap-style project card ----
  buildRoadmapProjectCard(s, d, 8.4, 1.25, 4.4, 5.95);

  addFooter(s, footer);
}

function buildRoadmapProjectCard(s: any, d: StatusDeckData, x: number, y: number, w: number, h: number) {
  // Top colored accent line
  const accent = ragColor(d.reporting?.healthRag);
  card(s, x, y, w, h, accent);

  // Status / stage pills
  // Status / stage pills — canonical workflow color/label when key is known.
  const rawStatus = d.project.statusLabel;
  const statusLabel = rawStatus ? getPmWorkflowStatusLabel(rawStatus) : "—";
  const statusColor = rawStatus ? getPmWorkflowStatusReportHex(rawStatus) : THEME.neutralGrey;
  pill(s, x + 0.25, y + 0.22, 1.7, 0.32, statusLabel, statusColor);
  if (d.project.stageLabel) {
    pill(s, x + 2.05, y + 0.22, 2.0, 0.32, `Stage: ${clip(d.project.stageLabel, 14)}`,
      THEME.darkBlue);
  }

  // Project name
  s.addText(clip(d.project.name, 60), {
    x: x + 0.25, y: y + 0.7, w: w - 0.4, h: 0.9,
    fontSize: 18, bold: true, color: THEME.navy, fontFace: THEME.font, valign: "top", margin: 0,
  });

  // Health + schedule badges
  const badgeY = y + 1.7;
  pill(s, x + 0.25, badgeY, 1.9, 0.32,
    `Health: ${d.reporting?.healthLabel || "—"}`, ragColor(d.reporting?.healthRag));
  pill(s, x + 2.25, badgeY, 1.9, 0.32,
    `Schedule: ${humanScheduleSignal(d.reporting?.scheduleSignal)}`,
    scheduleColor(d.reporting?.scheduleSignal));

  // Dates
  const datesY = badgeY + 0.55;
  uppercaseLabel(s, x + 0.25, datesY, 2, 0.22, "Start", THEME.mutedText, 9);
  s.addText(fmtDate(d.project.startDate), {
    x: x + 0.25, y: datesY + 0.22, w: 2, h: 0.3,
    fontSize: 12, color: THEME.navy, fontFace: THEME.font, bold: true, margin: 0,
  });
  uppercaseLabel(s, x + 2.25, datesY, 2, 0.22, "Target end", THEME.mutedText, 9);
  s.addText(fmtDate(d.project.targetEndDate), {
    x: x + 2.25, y: datesY + 0.22, w: 2, h: 0.3,
    fontSize: 12, color: THEME.navy, fontFace: THEME.font, bold: true, margin: 0,
  });

  // Progress
  const completion = d.reporting?.completionPercent ?? 0;
  const progY = datesY + 0.85;
  uppercaseLabel(s, x + 0.25, progY, 3, 0.25, "Progress", THEME.mutedText, 9);
  s.addText(`${Math.round(completion)}%`, {
    x: x + w - 1.0, y: progY, w: 0.75, h: 0.25,
    fontSize: 12, bold: true, color: THEME.navy, fontFace: THEME.font, align: "right", margin: 0,
  });
  progressBar(s, x + 0.25, progY + 0.32, w - 0.5, 0.22,
    completion, accent);

  // Task summary
  if (d.reporting?.taskTotal != null) {
    s.addText(
      `${d.reporting.taskCompleted ?? 0} of ${d.reporting.taskTotal} tasks completed`,
      {
        x: x + 0.25, y: progY + 0.62, w: w - 0.5, h: 0.3,
        fontSize: 10, color: THEME.mutedText, fontFace: THEME.font, margin: 0,
      },
    );
  }

  // PM / Sponsor line at bottom
  const pmLine: string[] = [];
  if (d.project.pmNames.length) pmLine.push(`PM: ${d.project.pmNames.join(", ")}`);
  if (d.project.sponsorNames.length) pmLine.push(`Sponsor: ${d.project.sponsorNames.join(", ")}`);
  if (pmLine.length) {
    s.addText(clip(pmLine.join("  ·  "), 80), {
      x: x + 0.25, y: y + h - 0.5, w: w - 0.5, h: 0.35,
      fontSize: 9, color: THEME.mutedText, fontFace: THEME.font, italic: true, margin: 0,
    });
  }
}

function buildManagementSignals(d: StatusDeckData): Array<{ label: string; value: string; color: string }> {
  const out: Array<{ label: string; value: string; color: string }> = [];
  if (d.reporting?.completionPercent != null) {
    out.push({
      label: "Completion / delivery",
      value: `${Math.round(d.reporting.completionPercent)}% complete · ${d.reporting.taskCompleted ?? 0}/${d.reporting.taskTotal ?? 0} tasks`,
      color: THEME.navy,
    });
  }
  if (d.reporting?.healthLabel) {
    const reasons = (d.reporting.healthReasonLines ?? []).slice(0, 1).join("; ");
    out.push({
      label: "Health / risk",
      value: `${d.reporting.healthLabel}${reasons ? ` — ${clip(reasons, 90)}` : ""}`,
      color: ragColor(d.reporting.healthRag),
    });
  }
  if (d.reporting?.scheduleSignal) {
    const reasons = (d.reporting.scheduleReasonLines ?? []).slice(0, 1).join("; ");
    out.push({
      label: "Schedule",
      value: `${humanScheduleSignal(d.reporting.scheduleSignal)}${reasons ? ` — ${clip(reasons, 90)}` : ""}`,
      color: scheduleColor(d.reporting.scheduleSignal),
    });
  }
  // Period activity
  if (d.progress.events.length > 0) {
    const parts: string[] = [];
    if (d.progress.counts.completed) parts.push(`${d.progress.counts.completed} completed`);
    if (d.progress.counts.kpi_snapshot) parts.push(`${d.progress.counts.kpi_snapshot} KPI snapshot(s)`);
    if (d.progress.counts.other_update) parts.push(`${d.progress.counts.other_update} update(s)`);
    if (d.progress.counts.risk_blocker) parts.push(`${d.progress.counts.risk_blocker} risk/blocker change(s)`);
    out.push({
      label: "Period activity",
      value: parts.join(" · ") || "—",
      color: THEME.darkBlue,
    });
  } else {
    out.push({
      label: "Period activity",
      value: "No execution updates, KPI snapshots, or risk/blocker activity logged.",
      color: THEME.mutedText,
    });
  }
  if (d.consistency.allTasksCompleteButStatusActive) {
    out.push({
      label: "Attention",
      value: "All tasks complete — but project workflow status is still Active.",
      color: THEME.amber,
    });
  }
  return out.slice(0, 5);
}

// =========================================================== Dashboard ====

function buildDashboardSlide(pres: any, d: StatusDeckData, footer: any) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  addTitle(s, "Dashboard");

  const completion = d.reporting?.completionPercent ?? null;
  const cardW = 6.05, cardH = 2.55;
  const col1 = 0.5, col2 = 6.78;
  const row1 = 1.15, row2 = 3.85;

  // Completion card (large % + progress bar)
  card(s, col1, row1, cardW, cardH, THEME.navy);
  uppercaseLabel(s, col1 + 0.25, row1 + 0.22, cardW - 0.4, 0.28, "Completion");
  s.addText(completion != null ? `${Math.round(completion)}%` : "—", {
    x: col1 + 0.25, y: row1 + 0.55, w: cardW - 0.4, h: 1.0,
    fontSize: 56, bold: true, color: THEME.navy, fontFace: THEME.font, margin: 0,
  });
  progressBar(s, col1 + 0.25, row1 + 1.7, cardW - 0.5, 0.28,
    completion ?? 0, THEME.navy);
  s.addText(
    d.reporting?.taskTotal != null
      ? `${d.reporting.taskCompleted ?? 0} of ${d.reporting.taskTotal} tasks completed`
      : "No task data",
    {
      x: col1 + 0.25, y: row1 + 2.05, w: cardW - 0.4, h: 0.4,
      fontSize: 11, color: THEME.mutedText, fontFace: THEME.font, margin: 0,
    },
  );

  // Health card
  metricCard(s, col2, row1, cardW, cardH, "Health",
    d.reporting?.healthLabel || "—",
    (d.reporting?.healthReasonLines ?? []).slice(0, 2).join(" · ") || "No issues detected",
    ragColor(d.reporting?.healthRag));

  // Schedule card
  metricCard(s, col1, row2, cardW, cardH, "Schedule",
    humanScheduleSignal(d.reporting?.scheduleSignal),
    (d.reporting?.scheduleReasonLines ?? []).slice(0, 2).join(" · ") || "No schedule issues detected",
    scheduleColor(d.reporting?.scheduleSignal));

  // Task status card with horizontal bars
  drawTaskStatusCard(s, col2, row2, cardW, cardH, d);

  if (d.consistency.allTasksCompleteButStatusActive) {
    s.addShape("roundRect", {
      x: 0.5, y: SLIDE_H - 0.78, w: SLIDE_W - 1.0, h: 0.36,
      fill: { color: "FEF3C7" }, line: { color: THEME.amber, width: 0.5 }, rectRadius: 0.04,
    });
    s.addText("⚠  All tasks complete; project workflow status is still Active.", {
      x: 0.65, y: SLIDE_H - 0.78, w: SLIDE_W - 1.3, h: 0.36,
      fontSize: 10, color: "92400E", fontFace: THEME.font, bold: true, valign: "middle", margin: 0,
    });
  }
  addFooter(s, footer);
}

function drawTaskStatusCard(s: any, x: number, y: number, w: number, h: number, d: StatusDeckData) {
  card(s, x, y, w, h, THEME.darkBlue);
  uppercaseLabel(s, x + 0.25, y + 0.22, w - 0.4, 0.28, "Task status");
  const counts = d.reporting?.statusCounts ?? {};
  const order = ["planned", "active", "on_hold", "completed", "cancelled"];
  const total = (counts.total as number) ?? order.reduce((a, k) => a + ((counts[k] as number) || 0), 0);
  const rowH = (h - 0.7) / order.length;
  let yy = y + 0.6;
  for (const k of order) {
    const v = (counts[k] as number) || 0;
    const pct = total > 0 ? Math.round((v / total) * 100) : 0;
    s.addText(getPmWorkflowStatusLabel(k), {
      x: x + 0.25, y: yy, w: 1.4, h: rowH,
      fontSize: 10, color: THEME.navy, fontFace: THEME.font, valign: "middle", margin: 0,
    });
    progressBar(s, x + 1.7, yy + rowH * 0.32, w - 3.0, rowH * 0.36, pct, getPmWorkflowStatusReportHex(k));
    s.addText(`${v} (${pct}%)`, {
      x: x + w - 1.2, y: yy, w: 0.95, h: rowH,
      fontSize: 10, color: THEME.navy, fontFace: THEME.font,
      align: "right", valign: "middle", bold: true, margin: 0,
    });
    yy += rowH;
  }
}

// ============================================================ Timeline ====

function buildTimelineSlide(pres: any, d: StatusDeckData, footer: any) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  addTitle(s, "Timeline · Project Phases");
  drawPhaseTimeline(s, d);
  addFooter(s, footer);
}

function drawPhaseTimeline(s: any, d: StatusDeckData) {
  // PHASE LEVEL ONLY — strictly filter out tasks/milestones
  const items = d.timeline
    .filter((t) => t.kind === "phase")
    .filter((t) => t.start || t.end)
    .map((t) => ({
      ...t,
      _start: t.start ? new Date(t.start) : (t.end ? new Date(t.end) : null),
      _end: t.end ? new Date(t.end) : (t.start ? new Date(t.start) : null),
    }))
    .filter((t) => t._start && t._end);

  if (items.length === 0) {
    drawEmptyState(s, "No phases with dates available for this project.");
    return;
  }

  let minMs = Math.min(...items.map((i) => i._start!.getTime()));
  let maxMs = Math.max(...items.map((i) => i._end!.getTime()));
  const projStart = d.project.startDate ? new Date(d.project.startDate).getTime() : null;
  const projEnd = d.project.targetEndDate ? new Date(d.project.targetEndDate).getTime() : null;
  if (projStart != null) minMs = Math.min(minMs, projStart);
  if (projEnd != null) maxMs = Math.max(maxMs, projEnd);
  if (minMs === maxMs) maxMs = minMs + 86_400_000;
  const span = maxMs - minMs;
  minMs -= span * 0.03;
  maxMs += span * 0.03;
  const today = Date.now();

  const left = 3.4;
  const right = SLIDE_W - 0.6;
  const trackW = right - left;
  const headerY = 1.25;
  const gridTopY = 1.6;
  const rowsTopY = 1.75;
  const legendY = SLIDE_H - 0.85;
  const maxRows = Math.min(items.length, 12);
  const rowH = Math.min(0.42, (legendY - rowsTopY - 0.2) / Math.max(maxRows, 1));
  const gridBottomY = rowsTopY + rowH * maxRows + 0.05;

  const tsX = (ms: number) => left + ((ms - minMs) / (maxMs - minMs)) * trackW;

  // Reporting-period band
  const periodStartMs = new Date(d.period.start).getTime();
  const periodEndMs = new Date(d.period.end).getTime() + 86_400_000;
  if (periodEndMs >= minMs && periodStartMs <= maxMs) {
    const bx = tsX(Math.max(periodStartMs, minMs));
    const bxEnd = tsX(Math.min(periodEndMs, maxMs));
    s.addShape("rect", {
      x: bx, y: gridTopY, w: Math.max(0.04, bxEnd - bx), h: gridBottomY - gridTopY,
      fill: { color: THEME.periodBand, transparency: 30 }, line: { type: "none" },
    });
  }

  // Month labels + subtle gridlines
  const monthStarts = listMonthStarts(minMs, maxMs);
  for (const m of monthStarts) {
    const x = tsX(m.getTime());
    s.addShape("rect", {
      x, y: gridTopY, w: 0.005, h: gridBottomY - gridTopY,
      fill: { color: THEME.cardBorder }, line: { type: "none" },
    });
    s.addText(fmtMonth(m), {
      x: x - 0.5, y: headerY, w: 1.0, h: 0.3,
      fontSize: 9, color: THEME.mutedText, fontFace: THEME.font, align: "center", margin: 0,
    });
  }
  // axis line
  s.addShape("rect", { x: left, y: gridBottomY, w: trackW, h: 0.01,
    fill: { color: THEME.neutralGrey }, line: { type: "none" } });

  // Project bounds markers
  if (projStart != null) {
    s.addShape("rect", { x: tsX(projStart), y: gridTopY, w: 0.015, h: gridBottomY - gridTopY,
      fill: { color: THEME.darkBlue }, line: { type: "none" } });
  }
  if (projEnd != null) {
    s.addShape("rect", { x: tsX(projEnd), y: gridTopY, w: 0.015, h: gridBottomY - gridTopY,
      fill: { color: THEME.darkBlue }, line: { type: "none" } });
  }

  // Phase rows
  const shown = items.slice(0, maxRows);
  for (let i = 0; i < shown.length; i++) {
    const t = shown[i];
    const y = rowsTopY + i * rowH;
    // alternating row band
    if (i % 2 === 0) {
      s.addShape("rect", { x: left, y, w: trackW, h: rowH,
        fill: { color: THEME.white, transparency: 60 }, line: { type: "none" } });
    }
    s.addText(clip(t.name, 32), {
      x: 0.5, y, w: left - 0.6, h: rowH,
      fontSize: 11, color: THEME.navy, fontFace: THEME.font,
      valign: "middle", bold: true, margin: 0,
    });
    const sMs = t._start!.getTime();
    const eMs = Math.max(t._end!.getTime(), sMs + 86_400_000);
    const bx = tsX(sMs);
    const bw = Math.max(0.08, tsX(eMs) - bx);
    const color = phaseColor(t.status);
    s.addShape("roundRect", {
      x: bx, y: y + rowH * 0.18,
      w: bw, h: rowH * 0.64,
      fill: { color }, line: { color: THEME.navy, width: 0.5 }, rectRadius: 0.08,
    });
    // Status label inside bar if it fits
    if (bw > 1.0) {
      s.addText((t.status || "").replace(/_/g, " ").toUpperCase(), {
        x: bx + 0.05, y: y + rowH * 0.18, w: bw - 0.1, h: rowH * 0.64,
        fontSize: 8, color: THEME.white, fontFace: THEME.font, bold: true,
        valign: "middle", align: "center", charSpacing: 1, margin: 0,
      });
    }
  }
  if (items.length > maxRows) {
    s.addText(`+${items.length - maxRows} more phase(s) not plotted.`, {
      x: 0.5, y: legendY - 0.3, w: 6, h: 0.25,
      fontSize: 9, color: THEME.mutedText, italic: true, fontFace: THEME.font, margin: 0,
    });
  }

  // Today marker
  if (today >= minMs && today <= maxMs) {
    const tx = tsX(today);
    s.addShape("rect", {
      x: tx, y: gridTopY, w: 0.02, h: gridBottomY - gridTopY,
      fill: { color: THEME.red }, line: { type: "none" },
    });
    const labelW = 0.8;
    const labelX = Math.min(Math.max(tx - labelW / 2, left), right - labelW);
    pill(s, labelX, 1.0, labelW, 0.24, "TODAY", THEME.red, THEME.white, { fontSize: 8, bold: true });
  }

  // Legend
  drawTimelineLegend(s, 0.5, legendY, SLIDE_W - 1.0, 0.3, items);
}

function listMonthStarts(minMs: number, maxMs: number): Date[] {
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

function drawTimelineLegend(s: any, x: number, y: number, w: number, h: number,
  items: Array<{ status: string | null }>) {
  const statuses = items.map((i) => (i.status || "").toLowerCase());
  const hasAtRisk = statuses.some((st) => st === "at_risk");
  const hasOnHold = statuses.some((st) => st === "on_hold");
  const legendItems: Array<{ label: string; color: string; shape: "rect" | "line" | "band" }> = [
    { label: "Phase", color: THEME.navy, shape: "rect" },
    { label: "Reporting period", color: THEME.periodBand, shape: "band" },
    { label: "Today", color: THEME.red, shape: "line" },
  ];
  if (hasAtRisk) {
    legendItems.push({
      label: "At Risk",
      color: getPmHealthReportHex("at_risk"),
      shape: "rect",
    });
  }
  if (hasOnHold) {
    legendItems.push({
      label: "On Hold",
      color: getPmWorkflowStatusReportHex("on_hold"),
      shape: "rect",
    });
  }

  let cx = x;
  for (const it of legendItems) {
    if (it.shape === "line") {
      s.addShape("rect", { x: cx, y: y + 0.06, w: 0.02, h: 0.18,
        fill: { color: it.color }, line: { type: "none" } });
    } else if (it.shape === "band") {
      s.addShape("rect", { x: cx, y: y + 0.06, w: 0.28, h: 0.18,
        fill: { color: it.color, transparency: 30 }, line: { type: "none" } });
    } else {
      s.addShape("roundRect", { x: cx, y: y + 0.06, w: 0.28, h: 0.18,
        fill: { color: it.color }, line: { type: "none" }, rectRadius: 0.04 });
    }
    s.addText(it.label, { x: cx + 0.35, y, w: 1.8, h: 0.3,
      fontSize: 9, color: THEME.mutedText, fontFace: THEME.font, valign: "middle", margin: 0 });
    cx += 2.2;
    if (cx > x + w - 0.5) break;
  }
}

function phaseColor(status: string | null | undefined): string {
  const v = (status || "").toLowerCase();
  // at_risk is not a PM workflow status — it is a health/risk signal, preserve red.
  if (v === "at_risk") return getPmHealthReportHex("at_risk");
  return getPmWorkflowStatusReportHex(v);
}

// ============================================================ Progress ====

function buildProgressSlide(pres: any, d: StatusDeckData, footer: any) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  addTitle(s, "Progress This Period", `${d.period.start} → ${d.period.end}`);

  const dig = d.periodDigest;
  const totalEvidence =
    dig.counts.completedDelivered + dig.counts.materialChanges +
    dig.counts.governanceRecords + dig.counts.kpiSnapshots +
    dig.counts.riskBlockerMovements;

  if (totalEvidence === 0) {
    drawEmptyState(s, "No project activity, governance, or KPI evidence recorded for this period.");
    addFooter(s, footer);
    return;
  }

  // 4-card layout: Completed | Material changes | Governance | Risks/KPIs
  const completedItems: PeriodDigestItem[] = dig.completedDelivered;
  const materialItems: PeriodDigestItem[] = dig.materialChanges;
  const governanceItems: PeriodDigestItem[] = dig.governanceEvidence.map((g) => ({
    date: g.date,
    kind: g.eventType ?? "governance_record",
    title: g.eventName,
    detail: `${g.decisionCount} decision${g.decisionCount === 1 ? "" : "s"}` +
      (g.hasSharepointEvidence ? " · SharePoint evidence" : ""),
  }));
  const riskKpiItems: PeriodDigestItem[] = [
    ...dig.riskBlockerMovements,
    ...dig.kpiSnapshots,
  ].sort((a, b) => (a.date && b.date ? (a.date < b.date ? 1 : -1) : 0));

  const sections: Array<{
    title: string; accent: string; count: number; items: PeriodDigestItem[];
  }> = [
    { title: "Completed / delivered", accent: getPmWorkflowStatusReportHex("completed"),
      count: dig.counts.completedDelivered, items: completedItems },
    { title: "Material changes", accent: THEME.darkBlue,
      count: dig.counts.materialChanges, items: materialItems },
    { title: "Governance / decisions", accent: THEME.navy,
      count: dig.counts.governanceRecords, items: governanceItems },
    { title: "Risks / blockers / KPIs", accent: THEME.amber,
      count: dig.counts.riskBlockerMovements + dig.counts.kpiSnapshots,
      items: riskKpiItems },
  ];

  const startY = 1.15;
  const cardW = 6.05;
  const cardH = 2.75;
  const gapX = 0.18, gapY = 0.18;
  const positions = [
    [0.5, startY],
    [0.5 + cardW + gapX, startY],
    [0.5, startY + cardH + gapY],
    [0.5 + cardW + gapX, startY + cardH + gapY],
  ];

  sections.forEach((sec, idx) => {
    const [x, y] = positions[idx];
    drawProgressSectionCard(s, x, y, cardW, cardH, sec);
  });
  addFooter(s, footer);
}

function drawProgressSectionCard(
  s: any, x: number, y: number, w: number, h: number,
  sec: { title: string; accent: string; count: number; items: PeriodDigestItem[] },
) {
  card(s, x, y, w, h, sec.accent);
  s.addText(sec.title, {
    x: x + 0.25, y: y + 0.18, w: w - 1.5, h: 0.32,
    fontSize: 13, bold: true, color: THEME.navy, fontFace: THEME.font, valign: "middle", margin: 0,
  });
  pill(s, x + w - 1.05, y + 0.2, 0.8, 0.3, String(sec.count), sec.accent, THEME.white,
    { fontSize: 11, bold: true });

  if (sec.items.length === 0) {
    s.addText("No activity in this category.", {
      x: x + 0.25, y: y + 0.7, w: w - 0.5, h: h - 0.9,
      fontSize: 11, color: THEME.mutedText, fontFace: THEME.font, italic: true, valign: "top", margin: 0,
    });
    return;
  }
  const TOP = 3;
  const top = sec.items.slice(0, TOP);
  let yy = y + 0.6;
  const itemH = (h - 0.95) / TOP;
  for (const ev of top) {
    s.addText(ev.date ? fmtDate(ev.date) : "—", {
      x: x + 0.25, y: yy + 0.02, w: 0.9, h: 0.25,
      fontSize: 9, color: THEME.mutedText, fontFace: THEME.font, bold: true, margin: 0,
    });
    s.addText(clip(ev.title, 60), {
      x: x + 1.1, y: yy, w: w - 1.3, h: 0.3,
      fontSize: 11, color: THEME.navy, fontFace: THEME.font, bold: true, margin: 0,
    });
    if (ev.detail) {
      s.addText(clip(ev.detail, 110), {
        x: x + 1.1, y: yy + 0.3, w: w - 1.3, h: itemH - 0.32,
        fontSize: 9, color: THEME.mutedText, fontFace: THEME.font, valign: "top", margin: 0,
      });
    }
    yy += itemH;
  }
  if (sec.items.length > TOP) {
    s.addText(`+${sec.items.length - TOP} more`, {
      x: x + 0.25, y: y + h - 0.32, w: w - 0.5, h: 0.25,
      fontSize: 9, color: sec.accent, fontFace: THEME.font, italic: true, bold: true, margin: 0,
    });
  }
}

// ================================================= Risks & Blockers =====

function buildRisksBlockersSlide(pres: any, d: StatusDeckData, footer: any) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  addTitle(s, "Risks & Blockers");

  const leftX = 0.5, rightX = 6.92, panelW = 5.9, panelH = 5.6, panelY = 1.15;

  // Blockers panel
  drawRiskBlockerPanel(s, leftX, panelY, panelW, panelH, {
    title: "Open Blockers",
    accent: THEME.alertRed,
    countLabel: `${d.blockers.open.length} open`,
    meta: `Created in period: ${d.blockers.createdInPeriod}  ·  Resolved: ${d.blockers.resolvedInPeriod}`,
    emptyText: "No open blockers",
    items: d.blockers.open.slice(0, 6).map((b) => ({
      badge: (b.severity || "—").toUpperCase(),
      badgeColor: ragColor(severityRag(b.severity)),
      title: b.title,
      sub: `Status: ${(b.status || "—").replace(/_/g, " ")}`,
    })),
    moreCount: Math.max(0, d.blockers.open.length - 6),
  });

  // Risks panel
  drawRiskBlockerPanel(s, rightX, panelY, panelW, panelH, {
    title: "High-impact Risks (open)",
    accent: getPmHealthReportHex("at_risk"),
    countLabel: `${d.risks.highImpactOpen.length} active`,
    meta: `Created in period: ${d.risks.createdInPeriod}  ·  Updated: ${d.risks.updatedInPeriod}`,
    emptyText: "No high-impact open risks",
    items: d.risks.highImpactOpen.slice(0, 6).map((r) => ({
      badge: (r.impact || "—").toUpperCase(),
      badgeColor: ragColor(severityRag(r.impact)),
      title: r.title,
      sub: `Likelihood: ${r.likelihood || "—"}  ·  Status: ${(r.status || "—").replace(/_/g, " ")}`,
    })),
    moreCount: Math.max(0, d.risks.highImpactOpen.length - 6),
  });

  addFooter(s, footer);
}

function drawRiskBlockerPanel(s: any, x: number, y: number, w: number, h: number, opts: {
  title: string; accent: string; countLabel: string; meta: string; emptyText: string;
  items: Array<{ badge: string; badgeColor: string; title: string; sub: string }>;
  moreCount: number;
}) {
  card(s, x, y, w, h, opts.accent);
  s.addText(opts.title, {
    x: x + 0.25, y: y + 0.2, w: w - 1.8, h: 0.35,
    fontSize: 14, bold: true, color: THEME.navy, fontFace: THEME.font, valign: "middle", margin: 0,
  });
  pill(s, x + w - 1.55, y + 0.22, 1.3, 0.3, opts.countLabel, opts.accent, THEME.white,
    { fontSize: 10, bold: true });
  s.addText(opts.meta, {
    x: x + 0.25, y: y + 0.58, w: w - 0.5, h: 0.28,
    fontSize: 10, color: THEME.mutedText, fontFace: THEME.font, margin: 0,
  });

  if (opts.items.length === 0) {
    // Positive empty-state
    s.addShape("roundRect", {
      x: x + 0.25, y: y + 1.0, w: w - 0.5, h: h - 1.25,
      fill: { color: "ECFDF5" }, line: { color: "BBF7D0", width: 0.5 }, rectRadius: 0.08,
    });
    s.addText("✓", {
      x: x + 0.25, y: y + 1.5, w: w - 0.5, h: 0.8,
      fontSize: 42, color: THEME.green, fontFace: THEME.font, bold: true, align: "center", margin: 0,
    });
    s.addText(opts.emptyText, {
      x: x + 0.25, y: y + 2.35, w: w - 0.5, h: 0.5,
      fontSize: 14, color: THEME.green, fontFace: THEME.font, bold: true, align: "center", margin: 0,
    });
    return;
  }

  const listY = y + 0.95;
  const listH = h - 1.1;
  const itemH = Math.min(0.85, listH / Math.max(opts.items.length, 1));
  for (let i = 0; i < opts.items.length; i++) {
    const it = opts.items[i];
    const yy = listY + i * itemH;
    // separator
    if (i > 0) {
      s.addShape("rect", { x: x + 0.25, y: yy, w: w - 0.5, h: 0.005,
        fill: { color: THEME.cardBorder }, line: { type: "none" } });
    }
    // badge
    pill(s, x + 0.25, yy + 0.1, 0.9, 0.26, clip(it.badge, 8), it.badgeColor, THEME.white,
      { fontSize: 8, bold: true });
    // title
    s.addText(clip(it.title, 70), {
      x: x + 1.25, y: yy + 0.05, w: w - 1.45, h: 0.32,
      fontSize: 11, bold: true, color: THEME.navy, fontFace: THEME.font, margin: 0,
    });
    s.addText(it.sub, {
      x: x + 1.25, y: yy + 0.37, w: w - 1.45, h: 0.28,
      fontSize: 9, color: THEME.mutedText, fontFace: THEME.font, margin: 0,
    });
  }
  if (opts.moreCount > 0) {
    s.addText(`+${opts.moreCount} more`, {
      x: x + 0.25, y: y + h - 0.4, w: w - 0.5, h: 0.28,
      fontSize: 9, color: opts.accent, fontFace: THEME.font, italic: true, bold: true,
      align: "right", margin: 0,
    });
  }
}

// ================================================================ KPI ====

function buildKpiSlide(pres: any, d: StatusDeckData, footer: any) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  addTitle(s, "KPIs");

  if (d.kpis.length === 0) {
    drawEmptyState(s, "No project-level KPI definitions found.");
    addFooter(s, footer);
    return;
  }

  const kpis = d.kpis.slice(0, 6);
  if (kpis.length === 1) {
    drawKpiCard(s, kpis[0], 1.5, 1.3, 10.3, 5.4, true);
  } else {
    const cols = 2;
    const cardW = 6.05;
    const cardH = kpis.length <= 2 ? 2.55 : kpis.length <= 4 ? 2.55 : 1.75;
    const gapX = 0.18, gapY = 0.2;
    const startY = 1.15;
    for (let i = 0; i < kpis.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = 0.5 + col * (cardW + gapX);
      const y = startY + row * (cardH + gapY);
      drawKpiCard(s, kpis[i], x, y, cardW, cardH, false);
    }
  }
  if (d.kpis.length > 6) {
    s.addText(`+${d.kpis.length - 6} more KPI(s) not shown.`, {
      x: 0.5, y: SLIDE_H - 0.55, w: 12, h: 0.25,
      fontSize: 10, color: THEME.mutedText, italic: true, fontFace: THEME.font, margin: 0,
    });
  }
  addFooter(s, footer);
}

function drawKpiCard(s: any, k: KpiView, x: number, y: number, w: number, h: number, large: boolean) {
  const accent = kpiStatusColor(k.status);
  card(s, x, y, w, h, accent);

  // KPI name
  s.addText(clip(k.name, 60), {
    x: x + 0.25, y: y + 0.2, w: w - 1.7, h: 0.4,
    fontSize: large ? 18 : 13, bold: true, color: THEME.navy, fontFace: THEME.font,
    valign: "middle", margin: 0,
  });
  // Status pill
  pill(s, x + w - 1.55, y + 0.22, 1.3, 0.3, humanKpiStatus(k.status), accent, THEME.white,
    { fontSize: 9, bold: true });

  // Current value (big)
  const snap = k.latestSnapshot;
  const valueText = snap
    ? (snap.valueAmount != null
      ? `${snap.valueAmount}${k.unit ? ` ${k.unit}` : ""}`
      : (snap.stringValue ?? "—"))
    : "—";
  const valueColor = kpiComparisonColor(k.targetComparison);
  s.addText(valueText, {
    x: x + 0.25, y: y + 0.65, w: w * 0.55, h: large ? 1.6 : 0.9,
    fontSize: large ? 64 : 32, bold: true, color: valueColor, fontFace: THEME.font,
    valign: "middle", margin: 0,
  });

  // Right column: Target + Snapshot date + Period
  const rcX = x + w * 0.55 + 0.1;
  const rcW = w - (w * 0.55) - 0.35;
  let ry = y + 0.7;
  uppercaseLabel(s, rcX, ry, rcW, 0.22, "Target", THEME.mutedText, 9);
  s.addText(
    k.targetValue != null ? `${k.targetValue}${k.unit ? ` ${k.unit}` : ""}` : "—",
    {
      x: rcX, y: ry + 0.22, w: rcW, h: 0.3,
      fontSize: large ? 16 : 12, bold: true, color: THEME.navy, fontFace: THEME.font, margin: 0,
    },
  );
  ry += 0.62;
  uppercaseLabel(s, rcX, ry, rcW, 0.22, "Snapshot", THEME.mutedText, 9);
  s.addText(snap ? fmtDate(snap.snapshotDate) : "—", {
    x: rcX, y: ry + 0.22, w: rcW, h: 0.3,
    fontSize: 11, color: THEME.navy, fontFace: THEME.font, bold: true, margin: 0,
  });
  ry += 0.62;
  if (snap?.periodStart && snap?.periodEnd) {
    uppercaseLabel(s, rcX, ry, rcW, 0.22, "Period", THEME.mutedText, 9);
    s.addText(`${fmtDate(snap.periodStart)} → ${fmtDate(snap.periodEnd)}`, {
      x: rcX, y: ry + 0.22, w: rcW, h: 0.3,
      fontSize: 10, color: THEME.navy, fontFace: THEME.font, margin: 0,
    });
  }

  // Commentary / basis (bottom)
  const comment = kpiCommentary(k);
  if (comment && comment !== "—") {
    s.addText(comment, {
      x: x + 0.25, y: y + h - 0.6, w: w - 0.5, h: 0.5,
      fontSize: large ? 12 : 9, color: THEME.mutedText, fontFace: THEME.font,
      italic: true, valign: "top", margin: 0,
    });
  }
}

function kpiCommentary(k: KpiView): string {
  const s = k.latestSnapshot;
  if (!s) return "—";
  const parts: string[] = [];
  if (s.comment) parts.push(s.comment);
  if (s.sourceMode) parts.push(`source: ${s.sourceMode}`);
  if (s.calculationStatus && s.calculationStatus !== "ok") parts.push(`calc: ${s.calculationStatus}`);
  return clip(parts.join(" · ") || "—", 180);
}
function humanKpiStatus(s: KpiView["status"]): string {
  switch (s) {
    case "up_to_date": return "Up to date";
    case "due": return "Due";
    case "no_snapshot": return "No snapshot";
    case "manual_only": return "Manual only";
    case "not_reportable": return "Not reportable";
  }
}
function kpiStatusColor(s: KpiView["status"]): string {
  switch (s) {
    case "up_to_date": return THEME.green;
    case "due": return THEME.amber;
    case "no_snapshot": return THEME.alertRed;
    case "manual_only": return THEME.darkBlue;
    default: return THEME.neutralGrey;
  }
}
function kpiComparisonColor(c: KpiView["targetComparison"]): string {
  switch (c) {
    case "on_target": return THEME.green;
    case "below_target": return THEME.alertRed;
    case "above_target": return THEME.amber;
    default: return THEME.navy;
  }
}

// ========================================================= Decisions ====

function buildDecisionsSlide(pres: any, d: StatusDeckData, footer: any) {
  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };
  addTitle(s, "Decisions & Sponsor Attention", `${d.period.start} → ${d.period.end}`);

  const decisions = d.periodDigest.decisions;
  const attention = d.periodDigest.sponsorAttention;

  // Truly empty → keep the historical empty-state panel.
  if (decisions.length === 0 && attention.length === 0) {
    const panelW = 8.0, panelH = 3.6;
    const px = (SLIDE_W - panelW) / 2;
    const py = (SLIDE_H - panelH) / 2 - 0.2;
    card(s, px, py, panelW, panelH, THEME.darkBlue);
    s.addText("◇", {
      x: px, y: py + 0.4, w: panelW, h: 0.8,
      fontSize: 38, color: THEME.darkBlue, fontFace: THEME.font, align: "center", margin: 0,
    });
    s.addText("No explicit decisions or sponsor-attention items recorded for this period.", {
      x: px + 0.4, y: py + 1.25, w: panelW - 0.8, h: 0.7,
      fontSize: 16, color: THEME.navy, fontFace: THEME.font, bold: true,
      align: "center", valign: "middle", margin: 0,
    });
    s.addText(
      "Capture decisions on Governance records and surface high-impact open Risks/Blockers for sponsor visibility.",
      {
        x: px + 0.4, y: py + 2.0, w: panelW - 0.8, h: 0.6,
        fontSize: 12, color: THEME.mutedText, fontFace: THEME.font, italic: true,
        align: "center", valign: "top", margin: 0,
      },
    );
    s.addShape("rect", {
      x: px + panelW / 2 - 0.4, y: py + panelH - 0.45, w: 0.8, h: 0.05,
      fill: { color: THEME.red }, line: { type: "none" },
    });
    addFooter(s, footer);
    return;
  }

  const leftX = 0.5, rightX = 6.92, panelW = 5.9, panelY = 1.15, panelH = 5.6;

  // ----- Decisions panel (left) -----
  card(s, leftX, panelY, panelW, panelH, THEME.navy);
  s.addText("Decisions Recorded", {
    x: leftX + 0.25, y: panelY + 0.2, w: panelW - 1.8, h: 0.35,
    fontSize: 14, bold: true, color: THEME.navy, fontFace: THEME.font, valign: "middle", margin: 0,
  });
  pill(s, leftX + panelW - 1.55, panelY + 0.22, 1.3, 0.3,
    `${decisions.length} decision${decisions.length === 1 ? "" : "s"}`,
    THEME.navy, THEME.white, { fontSize: 10, bold: true });

  if (decisions.length === 0) {
    s.addText("No governance decisions logged for this period.", {
      x: leftX + 0.25, y: panelY + 0.95, w: panelW - 0.5, h: 1.0,
      fontSize: 11, color: THEME.mutedText, fontFace: THEME.font, italic: true,
      valign: "top", margin: 0,
    });
  } else {
    const TOP = 6;
    const items = decisions.slice(0, TOP);
    const listY = panelY + 0.95;
    const listH = panelH - 1.15;
    const itemH = Math.min(0.78, listH / Math.max(items.length, 1));
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const yy = listY + i * itemH;
      if (i > 0) {
        s.addShape("rect", {
          x: leftX + 0.25, y: yy, w: panelW - 0.5, h: 0.005,
          fill: { color: THEME.cardBorder }, line: { type: "none" },
        });
      }
      s.addText(it.date ? fmtDate(it.date) : "—", {
        x: leftX + 0.25, y: yy + 0.06, w: 0.95, h: 0.22,
        fontSize: 9, color: THEME.mutedText, fontFace: THEME.font, bold: true, margin: 0,
      });
      s.addText(clip(it.recordTitle, 60), {
        x: leftX + 1.2, y: yy + 0.04, w: panelW - 1.4, h: 0.26,
        fontSize: 9, color: THEME.mutedText, fontFace: THEME.font, italic: true, margin: 0,
      });
      s.addText(clip(it.decisionText, 140), {
        x: leftX + 0.25, y: yy + 0.3, w: panelW - 0.5, h: itemH - 0.34,
        fontSize: 11, color: THEME.navy, fontFace: THEME.font, bold: true,
        valign: "top", margin: 0,
      });
    }
    if (decisions.length > TOP) {
      s.addText(`+${decisions.length - TOP} more decision(s)`, {
        x: leftX + 0.25, y: panelY + panelH - 0.4, w: panelW - 0.5, h: 0.28,
        fontSize: 9, color: THEME.navy, fontFace: THEME.font, italic: true, bold: true,
        align: "right", margin: 0,
      });
    }
  }

  // ----- Sponsor attention panel (right) -----
  card(s, rightX, panelY, panelW, panelH, THEME.alertRed);
  s.addText("Sponsor Attention", {
    x: rightX + 0.25, y: panelY + 0.2, w: panelW - 1.8, h: 0.35,
    fontSize: 14, bold: true, color: THEME.navy, fontFace: THEME.font, valign: "middle", margin: 0,
  });
  pill(s, rightX + panelW - 1.55, panelY + 0.22, 1.3, 0.3,
    `${attention.length} item${attention.length === 1 ? "" : "s"}`,
    THEME.alertRed, THEME.white, { fontSize: 10, bold: true });
  s.addText("High-impact open risks and high-severity open blockers.", {
    x: rightX + 0.25, y: panelY + 0.58, w: panelW - 0.5, h: 0.28,
    fontSize: 10, color: THEME.mutedText, fontFace: THEME.font, margin: 0,
  });

  if (attention.length === 0) {
    s.addText("No high-impact open risks or blockers requiring sponsor attention.", {
      x: rightX + 0.25, y: panelY + 0.95, w: panelW - 0.5, h: 1.0,
      fontSize: 11, color: THEME.mutedText, fontFace: THEME.font, italic: true,
      valign: "top", margin: 0,
    });
  } else {
    const TOP = 6;
    const items = attention.slice(0, TOP);
    const listY = panelY + 1.0;
    const listH = panelH - 1.2;
    const itemH = Math.min(0.78, listH / Math.max(items.length, 1));
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const yy = listY + i * itemH;
      if (i > 0) {
        s.addShape("rect", {
          x: rightX + 0.25, y: yy, w: panelW - 0.5, h: 0.005,
          fill: { color: THEME.cardBorder }, line: { type: "none" },
        });
      }
      const badge = (it.kind === "risk" ? "RISK" : "BLOCKER");
      pill(s, rightX + 0.25, yy + 0.1, 0.95, 0.26, badge,
        ragColor(severityRag(it.severity)), THEME.white, { fontSize: 8, bold: true });
      s.addText(clip(it.title, 60), {
        x: rightX + 1.3, y: yy + 0.05, w: panelW - 1.5, h: 0.32,
        fontSize: 11, bold: true, color: THEME.navy, fontFace: THEME.font, margin: 0,
      });
      const subParts: string[] = [];
      subParts.push(`Severity: ${(it.severity || "—").toString().toUpperCase()}`);
      if (it.status) subParts.push(`Status: ${it.status.replace(/_/g, " ")}`);
      if (it.detail) subParts.push(it.detail);
      s.addText(clip(subParts.join("  ·  "), 110), {
        x: rightX + 1.3, y: yy + 0.37, w: panelW - 1.5, h: itemH - 0.4,
        fontSize: 9, color: THEME.mutedText, fontFace: THEME.font, valign: "top", margin: 0,
      });
    }
    if (attention.length > TOP) {
      s.addText(`+${attention.length - TOP} more`, {
        x: rightX + 0.25, y: panelY + panelH - 0.4, w: panelW - 0.5, h: 0.28,
        fontSize: 9, color: THEME.alertRed, fontFace: THEME.font, italic: true, bold: true,
        align: "right", margin: 0,
      });
    }
  }

  addFooter(s, footer);
}

// ========================================================== Shared ======

function drawEmptyState(s: any, message: string) {
  s.addShape("roundRect", {
    x: 1.5, y: 2.0, w: SLIDE_W - 3.0, h: 3.5,
    fill: { color: THEME.cardBg }, line: { color: THEME.cardBorder, width: 0.75 }, rectRadius: 0.1,
  });
  s.addText(message, {
    x: 1.7, y: 2.0, w: SLIDE_W - 3.4, h: 3.5,
    fontSize: 14, color: THEME.mutedText, fontFace: THEME.font, italic: true,
    align: "center", valign: "middle", margin: 0,
  });
}

function severityRag(sev: string | null | undefined): string {
  switch ((sev || "").toLowerCase()) {
    case "critical":
    case "high": return "red";
    case "medium": return "amber";
    case "low": return "green";
    default: return "neutral";
  }
}

function humanScheduleSignal(sig: string | null | undefined): string {
  switch ((sig || "").toLowerCase()) {
    case "on_track": return "On track";
    case "at_risk": return "At risk";
    case "behind": return "Behind";
    case "complete": return "Complete";
    case "unknown":
    default: return sig ? sig.replace(/_/g, " ") : "—";
  }
}
function scheduleColor(sig: string | null | undefined): string {
  switch ((sig || "").toLowerCase()) {
    case "on_track": return getPmHealthReportHex("on_track");
    case "complete": return getPmWorkflowStatusReportHex("completed");
    case "at_risk": return getPmHealthReportHex("at_risk");
    case "behind": return getPmHealthReportHex("behind");
    default: return THEME.neutralGrey;
  }
}
