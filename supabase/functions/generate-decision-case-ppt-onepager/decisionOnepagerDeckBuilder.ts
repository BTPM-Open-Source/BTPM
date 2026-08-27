// DC.11 — Single-slide Decision Brief one-pager (.pptx) builder.
// Native PowerPoint shapes/text only. Reuses BTPM-style palette
// consistent with the Weekly Status Deck.

import PptxGenJS from "npm:pptxgenjs@3.12.0";
import type { DecisionOnepagerData } from "./dataMapper.ts";

const THEME = {
  navy: "1C1F3F",
  darkBlue: "00204E",
  red: "ED1C38",
  lightBg: "F2F2F2",
  white: "FFFFFF",
  mutedText: "5E6472",
  cardBorder: "D9DEE8",
  cardBg: "FFFFFF",
  // Operational semantics — mirrors canonical BTPM operational palette
  // (src/lib/btpmVisualSemantics.ts, getPmHealthHex / getPmWorkflowStatusHex).
  green: "059669",
  amber: "F59E0B",
  neutralGrey: "94A3B8",
  font: "Aptos",
};

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return String(s);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(s);
  }
}

function clip(s: string | null | undefined, max: number): string {
  if (!s) return "";
  const t = String(s).trim();
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

function statusColor(status: string | null | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "approved":
    case "decided":
    case "provided":
      return THEME.green;
    case "rejected":
    case "blocked":
      return THEME.red;
    case "deferred":
    case "pending":
      return THEME.amber;
    default:
      return THEME.neutralGrey;
  }
}

function addLabel(slide: any, x: number, y: number, w: number, h: number, text: string,
  color = THEME.mutedText, fontSize = 9) {
  slide.addText(text, {
    x, y, w, h, fontSize, bold: true, color, fontFace: THEME.font,
    charSpacing: 3, valign: "middle", margin: 0,
  });
}

function addCard(slide: any, x: number, y: number, w: number, h: number, accent: string | null = null) {
  slide.addShape("roundRect", {
    x, y, w, h,
    fill: { color: THEME.cardBg },
    line: { color: THEME.cardBorder, width: 0.75 },
    rectRadius: 0.08,
  });
  if (accent) {
    slide.addShape("rect", {
      x, y, w, h: 0.06,
      fill: { color: accent }, line: { type: "none" },
    });
  }
}

function pill(slide: any, x: number, y: number, w: number, h: number,
  text: string, fillColor: string, textColor = THEME.white) {
  slide.addShape("roundRect", {
    x, y, w, h, fill: { color: fillColor }, line: { type: "none" }, rectRadius: h / 2,
  });
  slide.addText(text, {
    x, y, w, h, fontSize: 9, color: textColor,
    fontFace: THEME.font, bold: true, align: "center", valign: "middle", margin: 0,
  });
}

function sectionBlock(
  slide: any,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  body: string | null | undefined,
  bodyMax = 380,
  bodyFontSize = 10,
) {
  addLabel(slide, x, y, w, 0.22, label);
  slide.addText(clip(body, bodyMax) || "—", {
    x, y: y + 0.24, w, h: h - 0.24,
    fontSize: bodyFontSize, color: THEME.darkBlue, fontFace: THEME.font,
    valign: "top", margin: 0,
  });
}

export async function buildDecisionOnepagerBuffer(d: DecisionOnepagerData): Promise<Uint8Array> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";

  const s = pres.addSlide();
  s.background = { color: THEME.lightBg };

  // --- Header band ---
  s.addShape("rect", {
    x: 0, y: 0, w: SLIDE_W, h: 1.0,
    fill: { color: THEME.navy }, line: { type: "none" },
  });
  s.addShape("rect", {
    x: 0, y: 1.0, w: SLIDE_W, h: 0.05,
    fill: { color: THEME.red }, line: { type: "none" },
  });

  s.addText("DECISION BRIEF", {
    x: 0.4, y: 0.12, w: 7, h: 0.32,
    fontSize: 11, color: "C8D1E8", fontFace: THEME.font,
    bold: true, charSpacing: 4, margin: 0,
  });
  s.addText(clip(d.decisionCase.title, 90), {
    x: 0.4, y: 0.40, w: 9.2, h: 0.55,
    fontSize: 22, color: THEME.white, fontFace: THEME.font, bold: true, margin: 0,
  });

  // Header right meta
  s.addText(clip(d.projectName, 60), {
    x: SLIDE_W - 4.0, y: 0.12, w: 3.7, h: 0.28,
    fontSize: 11, color: THEME.white, fontFace: THEME.font,
    bold: true, align: "right", margin: 0,
  });
  s.addText(
    `Package v${d.package.versionNumber}  •  Generated ${fmtDate(d.generatedAt)}`,
    {
      x: SLIDE_W - 4.0, y: 0.42, w: 3.7, h: 0.24,
      fontSize: 10, color: "C8D1E8", fontFace: THEME.font, align: "right", margin: 0,
    },
  );
  // Stage / status pills
  const stagePillW = 1.5;
  if (d.decisionCase.stage) {
    pill(s, SLIDE_W - 4.0, 0.70, stagePillW, 0.26,
      clip(d.decisionCase.stage, 18), THEME.red);
  }
  if (d.package.status) {
    pill(s, SLIDE_W - 4.0 + stagePillW + 0.15, 0.70, 1.8, 0.26,
      clip(`Package: ${d.package.status}`, 24), statusColor(d.package.status));
  }

  // --- Sub-header row (decision question + target date + owner) ---
  s.addShape("roundRect", {
    x: 0.4, y: 1.20, w: SLIDE_W - 0.8, h: 0.70,
    fill: { color: THEME.white },
    line: { color: THEME.cardBorder, width: 0.75 },
    rectRadius: 0.08,
  });
  addLabel(s, 0.6, 1.28, 2.0, 0.22, "DECISION QUESTION");
  s.addText(clip(d.decisionCase.decisionQuestion || d.package.decisionQuestion, 240) || "—", {
    x: 0.6, y: 1.48, w: SLIDE_W - 4.4, h: 0.40,
    fontSize: 11, color: THEME.darkBlue, fontFace: THEME.font,
    bold: true, valign: "top", margin: 0,
  });
  s.addText(
    `Target: ${fmtDate(d.decisionCase.targetDecisionDate)}` +
      (d.decisionCase.ownerLabel ? `   •   Owner: ${clip(d.decisionCase.ownerLabel, 32)}` : "") +
      (d.decisionCase.eventType ? `   •   Forum: ${clip(d.decisionCase.eventType, 24)}` : ""),
    {
      x: SLIDE_W - 4.4, y: 1.30, w: 3.9, h: 0.55,
      fontSize: 10, color: THEME.mutedText, fontFace: THEME.font,
      align: "right", valign: "middle", margin: 0,
    },
  );

  // --- 3-column body region ---
  const bodyTop = 2.05;
  const bodyH = 4.7;
  const gutter = 0.2;
  const colW = (SLIDE_W - 0.8 - gutter * 2) / 3;
  const col1X = 0.4;
  const col2X = col1X + colW + gutter;
  const col3X = col2X + colW + gutter;

  // Column 1 — Context & options
  addCard(s, col1X, bodyTop, colW, bodyH, THEME.navy);
  sectionBlock(s, col1X + 0.2, bodyTop + 0.2, colW - 0.4, 1.2,
    "BACKGROUND / CONTEXT",
    d.package.background || d.decisionCase.background, 360);
  sectionBlock(s, col1X + 0.2, bodyTop + 1.5, colW - 0.4, 1.5,
    "OPTIONS CONSIDERED",
    d.package.options, 420);
  sectionBlock(s, col1X + 0.2, bodyTop + 3.1, colW - 0.4, 1.5,
    "EVIDENCE SUMMARY",
    d.package.evidenceSummary, 360);

  // Column 2 — Recommendation & ask (focal point)
  addCard(s, col2X, bodyTop, colW, bodyH, THEME.red);
  addLabel(s, col2X + 0.2, bodyTop + 0.2, colW - 0.4, 0.22, "RECOMMENDATION", THEME.red, 10);
  s.addText(clip(d.package.recommendation, 600) || "—", {
    x: col2X + 0.2, y: bodyTop + 0.45, w: colW - 0.4, h: 2.3,
    fontSize: 12, color: THEME.darkBlue, fontFace: THEME.font,
    bold: true, valign: "top", margin: 0,
  });
  addLabel(s, col2X + 0.2, bodyTop + 2.85, colW - 0.4, 0.22, "DECISION ASK", THEME.navy, 10);
  s.addText(clip(d.package.decisionAsk, 500) || "—", {
    x: col2X + 0.2, y: bodyTop + 3.10, w: colW - 0.4, h: 1.5,
    fontSize: 11, color: THEME.darkBlue, fontFace: THEME.font,
    valign: "top", margin: 0,
  });

  // Column 3 — Guardrails / residual risks / next steps (or outcome)
  addCard(s, col3X, bodyTop, colW, bodyH, THEME.green);

  if (d.hasOutcome && d.outcome) {
    addLabel(s, col3X + 0.2, bodyTop + 0.2, colW - 0.4, 0.22, "DECISION OUTCOME", THEME.green, 10);
    s.addText(
      `${(d.outcome.decisionResult || "Recorded").toUpperCase()}  •  ${fmtDate(d.outcome.decisionDate)}`,
      {
        x: col3X + 0.2, y: bodyTop + 0.42, w: colW - 0.4, h: 0.26,
        fontSize: 10, color: THEME.green, fontFace: THEME.font, bold: true, margin: 0,
      },
    );
    s.addText(clip(d.outcome.finalDecisionText, 320) || "—", {
      x: col3X + 0.2, y: bodyTop + 0.72, w: colW - 0.4, h: 1.0,
      fontSize: 10, color: THEME.darkBlue, fontFace: THEME.font, valign: "top", margin: 0,
    });
    sectionBlock(s, col3X + 0.2, bodyTop + 1.85, colW - 0.4, 1.3,
      "GUARDRAILS / CONDITIONS",
      d.package.guardrails, 280);
    sectionBlock(s, col3X + 0.2, bodyTop + 3.25, colW - 0.4, 0.7,
      "RESIDUAL RISKS",
      d.outcome.residualRisks || d.package.residualRisks, 180, 9);
    sectionBlock(s, col3X + 0.2, bodyTop + 4.00, colW - 0.4, 0.6,
      "NEXT STEPS",
      d.outcome.followUpActions || d.package.nextSteps, 180, 9);
  } else {
    sectionBlock(s, col3X + 0.2, bodyTop + 0.2, colW - 0.4, 1.6,
      "GUARDRAILS / CONDITIONS",
      d.package.guardrails, 360);
    sectionBlock(s, col3X + 0.2, bodyTop + 1.9, colW - 0.4, 1.4,
      "RESIDUAL RISKS",
      d.package.residualRisks, 320);
    sectionBlock(s, col3X + 0.2, bodyTop + 3.4, colW - 0.4, 1.2,
      "NEXT STEPS",
      d.package.nextSteps, 320);
  }

  // --- Footer strip ---
  const footY = SLIDE_H - 0.45;
  s.addShape("rect", {
    x: 0, y: footY, w: SLIDE_W, h: 0.45,
    fill: { color: THEME.navy }, line: { type: "none" },
  });
  const outcomeStatus = d.hasOutcome
    ? `Outcome: ${d.outcome?.decisionResult || "recorded"}`
    : "Outcome: pre-decision";
  s.addText(
    `External evidence: ${d.counts.externalReferences}  •  BTPM context: ${d.counts.btpmContextLinks}` +
      `  •  Cross-project: ${d.counts.crossProjectLinks}  •  ${outcomeStatus}` +
      (d.package.status ? `  •  Package: ${d.package.status}` : ""),
    {
      x: 0.4, y: footY + 0.05, w: 8.5, h: 0.35,
      fontSize: 9, color: "C8D1E8", fontFace: THEME.font,
      valign: "middle", margin: 0,
    },
  );
  s.addText(
    "Generated snapshot from BTPM; source of truth remains the Decision Case.",
    {
      x: SLIDE_W - 5.5, y: footY + 0.05, w: 5.1, h: 0.35,
      fontSize: 8, color: "C8D1E8", fontFace: THEME.font,
      align: "right", valign: "middle", italic: true, margin: 0,
    },
  );

  const out = (await pres.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return new Uint8Array(out);
}
