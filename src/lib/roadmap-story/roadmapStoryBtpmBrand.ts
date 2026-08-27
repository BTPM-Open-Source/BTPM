/**
 * Phase 6B.7a.2 — BTPM-inspired brand tokens for the Roadmap Story Pack
 * Presentation Preview and Visual Library.
 *
 * SCOPE: local to the Story Pack presentation surfaces only. This is NOT a
 * global app redesign and these tokens MUST NOT be promoted into
 * `index.css` / `tailwind.config.ts` semantic tokens without an explicit
 * design-system decision. Use the exported classes via Tailwind arbitrary
 * value syntax so JIT picks them up.
 *
 * Inspired by BTPM's executive deck visual language:
 *  - white / light-grey canvas
 *  - deep navy headings
 *  - BTPM red accent rails, dividers, and active indicators
 *  - generous whitespace, compact uppercase section labels
 *  - large numeric counters
 */

// Raw hex tokens — kept here so future visual blocks can reference them.
export const BTPM_STORY_COLORS = {
  red: "#ED1C38",
  redDeep: "#ED1C24",
  navy: "#1C1F3F",
  blue: "#00204E",
  white: "#FFFFFF",
  greySoft: "#F2F2F2",
  greyWarm: "#E1E1DC",
  blueMuted: "#516490",
  teal: "#B5CAC5",
  gold: "#EAC16D",
  rose: "#995B5A",
} as const;

// Reusable Tailwind class fragments. Centralized so block components stay
// visually consistent without each one repeating the same hex literals.
export const btpmStory = {
  // Page / shell
  pageCanvas: "bg-[#F8F8F6]",
  cardSurface: "bg-white",
  cardSubtle: "bg-[#F2F2F2]",
  borderSoft: "border-[#E1E1DC]",
  divider: "bg-[#ED1C38]",

  // Headings / text
  heading: "text-[#1C1F3F]",
  headingMuted: "text-[#516490]",
  body: "text-[#1C1F3F]/85",
  muted: "text-[#516490]",

  // Accents
  accentRailRed: "bg-[#ED1C38]",
  accentRailNavy: "bg-[#1C1F3F]",
  accentRailGold: "bg-[#EAC16D]",
  accentRailTeal: "bg-[#B5CAC5]",
  accentRailRose: "bg-[#995B5A]",

  // Status accents (mapped to BTPM palette for executive feel)
  statusOverdue: "bg-[#ED1C38]/10 text-[#ED1C24] border-[#ED1C38]/40",
  statusAtRisk: "bg-[#EAC16D]/15 text-[#7A5512] border-[#EAC16D]/60",
  statusDueSoon: "bg-[#516490]/10 text-[#1C1F3F] border-[#516490]/40",
  statusOk: "bg-[#B5CAC5]/25 text-[#1C1F3F] border-[#B5CAC5]/70",
  statusNeutral: "bg-white text-[#1C1F3F] border-[#E1E1DC]",

  // Compact section label, like the deck's small uppercase eyebrows.
  eyebrow:
    "text-[10px] uppercase tracking-[0.14em] font-semibold text-[#516490]",
} as const;

/**
 * Map a free-form tone string ("risk" / "attention" / "positive" / "neutral")
 * to BTPM-palette hero styling. Used by `hero_takeaway`.
 */
export function btpmStoryHeroTone(tone: string | undefined) {
  switch (tone) {
    case "risk":
      return {
        wrap: "bg-gradient-to-br from-[#ED1C38]/8 via-white to-white border-[#ED1C38]/30",
        rail: "bg-[#ED1C38]",
        chip: "border-[#ED1C38]/50 text-[#ED1C24]",
        eyebrow: "text-[#ED1C24]",
      };
    case "attention":
      return {
        wrap: "bg-gradient-to-br from-[#EAC16D]/15 via-white to-white border-[#EAC16D]/40",
        rail: "bg-[#EAC16D]",
        chip: "border-[#EAC16D]/60 text-[#7A5512]",
        eyebrow: "text-[#7A5512]",
      };
    case "positive":
      return {
        wrap: "bg-gradient-to-br from-[#B5CAC5]/25 via-white to-white border-[#B5CAC5]/60",
        rail: "bg-[#1C1F3F]",
        chip: "border-[#1C1F3F]/30 text-[#1C1F3F]",
        eyebrow: "text-[#1C1F3F]",
      };
    default:
      return {
        wrap: "bg-gradient-to-br from-[#1C1F3F]/5 via-white to-white border-[#1C1F3F]/15",
        rail: "bg-[#1C1F3F]",
        chip: "border-[#1C1F3F]/30 text-[#1C1F3F]",
        eyebrow: "text-[#516490]",
      };
  }
}

/** Map signal metric status to BTPM tile styling. */
export function btpmStoryMetricTone(status: string | undefined) {
  switch (status) {
    case "critical":
      return { wrap: "border-[#ED1C38]/40 bg-white", value: "text-[#ED1C24]", rail: "bg-[#ED1C38]" };
    case "warning":
      return { wrap: "border-[#EAC16D]/60 bg-white", value: "text-[#7A5512]", rail: "bg-[#EAC16D]" };
    case "good":
      return { wrap: "border-[#B5CAC5] bg-white", value: "text-[#1C1F3F]", rail: "bg-[#1C1F3F]" };
    default:
      return { wrap: "border-[#E1E1DC] bg-white", value: "text-[#1C1F3F]", rail: "bg-[#516490]" };
  }
}

/** Map risk severity to BTPM card side-rail styling. */
export function btpmStorySeverityAccent(severity: string | undefined) {
  switch (severity) {
    case "critical":
      return "border-l-[3px] border-l-[#ED1C38] bg-[#ED1C38]/[0.04]";
    case "high":
      return "border-l-[3px] border-l-[#EAC16D] bg-[#EAC16D]/[0.06]";
    case "medium":
      return "border-l-[3px] border-l-[#516490] bg-[#516490]/[0.04]";
    default:
      return "border-l-[3px] border-l-[#E1E1DC]";
  }
}

/** Map risk severity to badge styling. */
export function btpmStorySeverityBadge(severity: string | undefined) {
  switch (severity) {
    case "critical":
      return "border-[#ED1C38]/60 text-[#ED1C24] bg-white";
    case "high":
      return "border-[#EAC16D]/70 text-[#7A5512] bg-white";
    case "medium":
      return "border-[#516490]/50 text-[#1C1F3F] bg-white";
    default:
      return "border-[#E1E1DC] text-[#516490] bg-white";
  }
}

/** Map delivery-pressure status to BTPM chip styling. */
export function btpmStoryPressureChip(status: string | undefined) {
  if (status === "overdue") return btpmStory.statusOverdue;
  if (status === "at_risk" || status === "blocked") return btpmStory.statusAtRisk;
  if (status === "due_soon") return btpmStory.statusDueSoon;
  if (status === "ok" || status === "on_track") return btpmStory.statusOk;
  return btpmStory.statusNeutral;
}
