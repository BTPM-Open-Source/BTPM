/**
 * Phase 6B.7b — AI Presentation Blueprint validation.
 *
 * BTPM runs every AI-produced payload through this before rendering.
 * Anything unsafe is rejected. Nothing unsafe reaches the DOM.
 *
 * Rejects: unknown/unsupported templates, HTML tags, `<script>`,
 * inline styles, javascript:/data: URIs, http(s):// or file:// URLs in
 * any string field, oversized narratives, oversized block counts,
 * unknown tones, non-string evidence refs.
 */

import {
  ROADMAP_STORY_PRESENTATION_TEMPLATES,
  type RoadmapStoryPresentationTemplateKey,
} from "./roadmapStoryPresentationTemplates";
import {
  AI_BLUEPRINT_SCHEMA_VERSION,
  AI_BLUEPRINT_TEMPLATE_ID,
  type AiBlueprintDensity,
  type AiBlueprintTone,
  type AiBlueprintPriority,
  type AiBlueprintDisplayMode,
  type AiRoadmapStoryPresentationBlock,
  type AiRoadmapStoryPresentationBlockNarrative,
  type AiRoadmapStoryPresentationBlueprint,
  type AiBlueprintValidationResult,
} from "./roadmapStoryPresentationBlueprintSchema";

const IMPLEMENTED_TEMPLATE_IDS = new Set<RoadmapStoryPresentationTemplateKey>(
  ROADMAP_STORY_PRESENTATION_TEMPLATES.map((t) => t.id),
);

const ALLOWED_TONES: ReadonlySet<AiBlueprintTone> = new Set([
  "neutral", "positive", "attention", "risk",
]);
const ALLOWED_DENSITIES: ReadonlySet<AiBlueprintDensity> = new Set([
  "compact", "standard", "detailed",
]);
const ALLOWED_PRIORITY: ReadonlySet<AiBlueprintPriority> = new Set([
  "critical", "high", "medium", "low",
]);
const ALLOWED_DISPLAY_MODE: ReadonlySet<AiBlueprintDisplayMode> = new Set([
  "full", "compact", "collapsed",
]);

const MAX_BLOCKS = 24;
const MAX_TITLE_LEN = 240;
const MAX_TAKEAWAY_LEN = 400;
const MAX_SUMMARY_ITEMS = 4;
const MAX_SUMMARY_LEN = 320;
const MAX_IMPLICATION_LEN = 320;
const MAX_ACTION_LEN = 320;
const MAX_EVIDENCE_REFS = 8;
const MAX_EVIDENCE_REF_LEN = 200;
const MAX_FOCUS_HINTS = 8;
const MAX_FOCUS_HINT_LEN = 160;
const MAX_SOURCE_LIMITATIONS = 12;
const MAX_SOURCE_LIMITATION_LEN = 400;
const MAX_EXEC_TAKEAWAY_LEN = 800;
const MAX_SUBTITLE_LEN = 400;
const MAX_VALIDATION_NOTES = 8;

// Patterns that we refuse to render regardless of context.
const UNSAFE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /<\s*script/i, label: "script tag" },
  { re: /<\s*style/i, label: "style tag" },
  { re: /<\s*iframe/i, label: "iframe tag" },
  { re: /<\s*svg/i, label: "svg tag" },
  { re: /<\/?\s*[a-z][^>]*>/i, label: "html tag" },
  { re: /\bstyle\s*=\s*["']/i, label: "inline style attribute" },
  { re: /\bon[a-z]+\s*=\s*["']/i, label: "inline event handler" },
  { re: /javascript\s*:/i, label: "javascript: uri" },
  { re: /\bdata\s*:\s*[a-z]+\//i, label: "data: uri" },
  { re: /\bhttps?:\/\//i, label: "url" },
  { re: /\bfile:\/\//i, label: "file uri" },
  { re: /```[a-z]*\n/i, label: "code fence" },
];

function scrubString(input: unknown, maxLen: number): { text: string | undefined; issues: string[] } {
  if (input === null || input === undefined) return { text: undefined, issues: [] };
  if (typeof input !== "string") return { text: undefined, issues: ["non-string value dropped"] };
  const t = input.trim();
  if (!t) return { text: undefined, issues: [] };
  const issues: string[] = [];
  for (const p of UNSAFE_PATTERNS) {
    if (p.re.test(t)) issues.push(`removed content containing ${p.label}`);
  }
  if (issues.length) return { text: undefined, issues };
  const clipped = t.length > maxLen ? t.slice(0, maxLen).trimEnd() + "…" : t;
  return { text: clipped, issues: [] };
}

function scrubStringArray(input: unknown, maxItems: number, maxLen: number): { list: string[]; issues: string[] } {
  if (!Array.isArray(input)) return { list: [], issues: [] };
  const list: string[] = [];
  const issues: string[] = [];
  for (const raw of input.slice(0, maxItems)) {
    const s = scrubString(raw, maxLen);
    if (s.text) list.push(s.text);
    if (s.issues.length) issues.push(...s.issues);
  }
  return { list, issues };
}

function scrubEvidenceRefs(input: unknown): { list: string[]; issues: string[] } {
  const { list, issues } = scrubStringArray(input, MAX_EVIDENCE_REFS, MAX_EVIDENCE_REF_LEN);
  return { list, issues };
}

function validateNarrative(
  input: unknown,
  warnings: string[],
): AiRoadmapStoryPresentationBlockNarrative | undefined {
  if (!input || typeof input !== "object") return undefined;
  const src = input as Record<string, unknown>;
  const out: AiRoadmapStoryPresentationBlockNarrative = {};

  const takeaway = scrubString(src.takeaway, MAX_TAKEAWAY_LEN);
  warnings.push(...takeaway.issues);
  if (takeaway.text) out.takeaway = takeaway.text;

  const summary = scrubStringArray(src.summary, MAX_SUMMARY_ITEMS, MAX_SUMMARY_LEN);
  warnings.push(...summary.issues);
  if (summary.list.length) out.summary = summary.list;

  const implication = scrubString(src.implication, MAX_IMPLICATION_LEN);
  warnings.push(...implication.issues);
  if (implication.text) out.implication = implication.text;

  const action = scrubString(src.action, MAX_ACTION_LEN);
  warnings.push(...action.issues);
  if (action.text) out.action = action.text;

  const tone = typeof src.tone === "string" && ALLOWED_TONES.has(src.tone as AiBlueprintTone)
    ? (src.tone as AiBlueprintTone)
    : undefined;
  if (tone) out.tone = tone;
  else if (typeof src.tone === "string") warnings.push(`unknown narrative tone "${src.tone}" dropped`);

  const refs = scrubEvidenceRefs(src.evidenceRefs);
  warnings.push(...refs.issues);
  if (refs.list.length) out.evidenceRefs = refs.list;

  return Object.keys(out).length ? out : undefined;
}

function validateBlock(
  input: unknown,
  index: number,
  errors: string[],
  warnings: string[],
): AiRoadmapStoryPresentationBlock | null {
  if (!input || typeof input !== "object") {
    errors.push(`block[${index}] is not an object`);
    return null;
  }
  const src = input as Record<string, unknown>;
  const blockType = src.blockType;
  if (typeof blockType !== "string" || !IMPLEMENTED_TEMPLATE_IDS.has(blockType as RoadmapStoryPresentationTemplateKey)) {
    errors.push(`block[${index}] uses unsupported blockType "${String(blockType)}"`);
    return null;
  }
  const title = scrubString(src.title, MAX_TITLE_LEN);
  warnings.push(...title.issues);
  const blockId = typeof src.blockId === "string" && src.blockId.trim()
    ? src.blockId.trim().slice(0, 80)
    : `blk_${index + 1}`;
  const slotId = typeof src.slotId === "string" && src.slotId.trim()
    ? src.slotId.trim().slice(0, 40)
    : "opening";

  const evidence = scrubEvidenceRefs(src.evidenceRefs);
  warnings.push(...evidence.issues);
  const priority = typeof src.priority === "string" && ALLOWED_PRIORITY.has(src.priority as AiBlueprintPriority)
    ? (src.priority as AiBlueprintPriority) : undefined;
  const displayMode = typeof src.displayMode === "string" && ALLOWED_DISPLAY_MODE.has(src.displayMode as AiBlueprintDisplayMode)
    ? (src.displayMode as AiBlueprintDisplayMode) : undefined;

  const focusHints = scrubStringArray(src.focusHints, MAX_FOCUS_HINTS, MAX_FOCUS_HINT_LEN);
  warnings.push(...focusHints.issues);

  return {
    blockId,
    slotId,
    blockType: blockType as RoadmapStoryPresentationTemplateKey,
    title: title.text ?? "Untitled",
    narrative: validateNarrative(src.narrative, warnings),
    evidenceRefs: evidence.list.length ? evidence.list : undefined,
    priority,
    displayMode,
    focusHints: focusHints.list.length ? focusHints.list : undefined,
  };
}

export function tryParseAiBlueprintJson(text: string | null | undefined): unknown | null {
  if (!text) return null;
  let t = text.trim();
  if (!t) return null;
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```$/m, "").trim();
  }
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export function validateAiRoadmapStoryPresentationBlueprint(
  raw: unknown,
): AiBlueprintValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!raw || typeof raw !== "object") {
    return { ok: false, errors: ["blueprint payload is not an object"], warnings, blueprint: null };
  }
  const src = raw as Record<string, unknown>;

  if (src.schemaVersion !== AI_BLUEPRINT_SCHEMA_VERSION) {
    errors.push(`unsupported schemaVersion "${String(src.schemaVersion)}"`);
  }
  if (src.templateId !== AI_BLUEPRINT_TEMPLATE_ID) {
    errors.push(`unsupported templateId "${String(src.templateId)}"`);
  }

  const title = scrubString(src.title, MAX_TITLE_LEN);
  warnings.push(...title.issues);
  const subtitle = scrubString(src.subtitle, MAX_SUBTITLE_LEN);
  warnings.push(...subtitle.issues);
  const density: AiBlueprintDensity =
    typeof src.density === "string" && ALLOWED_DENSITIES.has(src.density as AiBlueprintDensity)
      ? (src.density as AiBlueprintDensity)
      : "standard";
  const execTakeaway = scrubString(src.executiveTakeaway, MAX_EXEC_TAKEAWAY_LEN);
  warnings.push(...execTakeaway.issues);

  const rawBlocks = Array.isArray(src.blocks) ? src.blocks : [];
  if (!rawBlocks.length) errors.push("blueprint has no blocks");
  if (rawBlocks.length > MAX_BLOCKS) {
    warnings.push(`truncated ${rawBlocks.length - MAX_BLOCKS} extra blocks (max ${MAX_BLOCKS})`);
  }
  const blocks: AiRoadmapStoryPresentationBlock[] = [];
  rawBlocks.slice(0, MAX_BLOCKS).forEach((b, i) => {
    const validated = validateBlock(b, i, errors, warnings);
    if (validated) blocks.push(validated);
  });

  // Deduplicate stable blockIds — the AI sometimes reuses ids.
  const seenIds = new Set<string>();
  const dedupedBlocks: AiRoadmapStoryPresentationBlock[] = [];
  for (const b of blocks) {
    if (seenIds.has(b.blockId)) {
      warnings.push(`duplicate blockId "${b.blockId}" reassigned`);
      b.blockId = `${b.blockId}_${dedupedBlocks.length + 1}`;
    }
    seenIds.add(b.blockId);
    dedupedBlocks.push(b);
  }

  // Ensure source_limitations_footer exists.
  const hasFooter = dedupedBlocks.some((b) => b.blockType === "source_limitations_footer");
  if (!hasFooter) {
    warnings.push("source_limitations_footer missing — appended by BTPM");
    dedupedBlocks.push({
      blockId: "footer_source_limitations",
      slotId: "limitations",
      blockType: "source_limitations_footer",
      title: "Source limitations",
    });
  }

  const sourceLimitations = scrubStringArray(
    src.sourceLimitations, MAX_SOURCE_LIMITATIONS, MAX_SOURCE_LIMITATION_LEN,
  );
  warnings.push(...sourceLimitations.issues);

  const validationNotes = scrubStringArray(
    src.validationNotes, MAX_VALIDATION_NOTES, MAX_SOURCE_LIMITATION_LEN,
  );
  warnings.push(...validationNotes.issues);

  const ok = errors.length === 0 && dedupedBlocks.length > 0;
  const blueprint: AiRoadmapStoryPresentationBlueprint | null = ok
    ? {
        schemaVersion: AI_BLUEPRINT_SCHEMA_VERSION,
        templateId: AI_BLUEPRINT_TEMPLATE_ID,
        title: title.text ?? "Roadmap presentation",
        subtitle: subtitle.text,
        density,
        executiveTakeaway: execTakeaway.text ?? "",
        blocks: dedupedBlocks,
        sourceLimitations: sourceLimitations.list,
        validationNotes: validationNotes.list.length ? validationNotes.list : undefined,
      }
    : null;

  return { ok, errors, warnings, blueprint };
}
