// BTPM theme for the Weekly Project Status Deck.
// Narrow, local helper module. Not a general template engine.

export const THEME = {
  // Presentation palette
  navy: "1C1F3F",
  darkBlue: "00204E",
  red: "ED1C38",
  lightBg: "F2F2F2",
  white: "FFFFFF",
  mutedText: "5E6472",
  cardBorder: "D9DEE8",
  cardBg: "FFFFFF",
  // Operational RAG values mirror the canonical BTPM semantic palette.
  // Kept as literal strings here (no-hash uppercase) because pptxgenjs needs
  // synchronous literals at import time.
  green: "059669",      // on_track / completed
  amber: "F59E0B",      // needs_attention / on_hold
  alertRed: "E11D48",   // at_risk / blocked / overdue / critical
  neutralGrey: "94A3B8",// planned / unset
  periodBand: "FEF3C7",
  // Typography
  font: "Aptos",
  fontFallback: "Calibri",
};

export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;

import { getPmHealthReportHex } from "./btpmSemanticsMirror.ts";

export function ragColor(rag: string | null | undefined): string {
  switch ((rag || "").toLowerCase()) {
    case "green": return getPmHealthReportHex("on_track");
    case "amber": return getPmHealthReportHex("needs_attention");
    case "red": return getPmHealthReportHex("at_risk");
    default: return THEME.neutralGrey;
  }
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toISOString().slice(0, 10); } catch { return iso; }
}

export function clip(s: string, max: number): string {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

// ---- Slide chrome ---------------------------------------------------------

export function addTitle(slide: any, title: string, subtitle?: string) {
  slide.addText(title, {
    x: 0.5, y: 0.28, w: 12.3, h: 0.55,
    fontSize: 26, bold: true, color: THEME.navy, fontFace: THEME.font, margin: 0,
  });
  slide.addShape("rect", {
    x: 0.5, y: 0.88, w: 0.6, h: 0.06,
    fill: { color: THEME.red }, line: { type: "none" },
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 1.2, y: 0.85, w: 11.5, h: 0.3,
      fontSize: 11, color: THEME.mutedText, fontFace: THEME.font, margin: 0,
    });
  }
}

export function addFooter(slide: any, opts: {
  projectName: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  faviconB64?: string;
}) {
  if (opts.faviconB64) {
    slide.addImage({
      data: opts.faviconB64,
      x: 0.3, y: SLIDE_H - 0.36, w: 0.26, h: 0.26,
    });
  }
  const textX = opts.faviconB64 ? 0.62 : 0.3;
  slide.addText(
    `BTPM · ${clip(opts.projectName, 60)} · ${opts.periodStart} → ${opts.periodEnd} · Generated ${fmtDate(opts.generatedAt)}`,
    {
      x: textX, y: SLIDE_H - 0.32, w: 8.5, h: 0.22,
      fontSize: 8, color: THEME.mutedText, fontFace: THEME.font, align: "left", margin: 0,
    },
  );
}

// ---- Atoms ----------------------------------------------------------------

export function pill(slide: any, x: number, y: number, w: number, h: number,
  text: string, fillColor: string, textColor = THEME.white, opts: { fontSize?: number; bold?: boolean } = {}) {
  slide.addShape("roundRect", {
    x, y, w, h, fill: { color: fillColor }, line: { type: "none" }, rectRadius: h / 2,
  });
  slide.addText(text, {
    x, y, w, h, fontSize: opts.fontSize ?? 10, color: textColor,
    fontFace: THEME.font, bold: opts.bold ?? true, align: "center", valign: "middle", margin: 0,
  });
}

export function card(slide: any, x: number, y: number, w: number, h: number,
  accent: string | null = null) {
  slide.addShape("roundRect", {
    x, y, w, h,
    fill: { color: THEME.cardBg },
    line: { color: THEME.cardBorder, width: 0.75 },
    rectRadius: 0.08,
  });
  if (accent) {
    slide.addShape("rect", {
      x, y, w, h: 0.08,
      fill: { color: accent }, line: { type: "none" },
    });
  }
}

export function uppercaseLabel(slide: any, x: number, y: number, w: number, h: number, text: string,
  color: string = THEME.mutedText, fontSize = 9) {
  slide.addText(text, {
    x, y, w, h, fontSize, bold: true, color, fontFace: THEME.font,
    charSpacing: 3, valign: "middle", margin: 0,
  });
}

export function progressBar(slide: any, x: number, y: number, w: number, h: number,
  pct: number, color: string = THEME.navy, bg: string = "E5E7EB") {
  const clamped = Math.max(0, Math.min(100, pct));
  slide.addShape("roundRect", {
    x, y, w, h, fill: { color: bg }, line: { type: "none" }, rectRadius: h / 2,
  });
  if (clamped > 0) {
    const fw = Math.max(h, (w * clamped) / 100);
    slide.addShape("roundRect", {
      x, y, w: fw, h, fill: { color }, line: { type: "none" }, rectRadius: h / 2,
    });
  }
}

export function metricCard(slide: any, x: number, y: number, w: number, h: number,
  label: string, value: string, sub: string, accent: string) {
  card(slide, x, y, w, h, accent);
  uppercaseLabel(slide, x + 0.25, y + 0.22, w - 0.4, 0.28, label);
  slide.addText(value, {
    x: x + 0.25, y: y + 0.55, w: w - 0.4, h: h - 1.1,
    fontSize: 40, bold: true, color: accent, fontFace: THEME.font, valign: "middle", margin: 0,
  });
  slide.addText(sub, {
    x: x + 0.25, y: y + h - 0.55, w: w - 0.4, h: 0.45,
    fontSize: 10, color: THEME.mutedText, fontFace: THEME.font, valign: "top", margin: 0,
  });
}
