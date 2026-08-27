/**
 * Phase 6B.7b — AI Blueprint overlay onto deterministic blueprint.
 * Phase 6B.7b.2 — Enforces per-Story Visual Settings after AI output:
 *   • Include Off  → block removed (even if AI included it).
 *   • Include On   → deterministic block restored if AI omitted it.
 *   • Narrative On → AI/deterministic narrative preserved.
 *   • Narrative Off → all narrative payload stripped.
 * These enforcements are deterministic and cannot be bypassed by the AI.
 */

import type {
  RoadmapStoryPresentationBlueprint,
  RoadmapStoryPresentationBlock,
  BlockNarrative,
  SourceLimitationsFooterBlock,
} from "./roadmapStoryPresentationBlueprint";
import type {
  AiRoadmapStoryPresentationBlueprint,
  AiRoadmapStoryPresentationBlock,
} from "./roadmapStoryPresentationBlueprintSchema";
import {
  buildDefaultRoadmapStoryVisualSettings,
  isNarrativeCapableBlockType,
  NARRATIVE_CAPABLE_BLOCK_TYPES,
  type RoadmapStoryVisualSettings,
} from "./roadmapStoryVisualSettings";
// Kept in sync with `PRESENTATION_BLOCK_SLOT_ORDER` in the Preview
// renderer. Inlined here to avoid pulling a UI component into the lib
// layer and creating a circular import.
const PRESENTATION_BLOCK_SLOT_ORDER: readonly string[] = [
  "opening", "signals", "portfolio", "timeline", "charts",
  "movement", "delivery", "attention", "kpi", "evidence", "limitations",
];

function toDeterministicNarrative(
  n?: AiRoadmapStoryPresentationBlock["narrative"],
): BlockNarrative | undefined {
  if (!n) return undefined;
  const out: BlockNarrative = {};
  if (n.takeaway) out.takeaway = n.takeaway;
  if (n.summary && n.summary.length) out.summary = n.summary;
  if (n.implication) out.implication = n.implication;
  if (n.action) out.action = n.action;
  if (n.tone) out.tone = n.tone;
  if (n.evidenceRefs && n.evidenceRefs.length) out.evidenceRefs = n.evidenceRefs;
  return Object.keys(out).length ? out : undefined;
}

function stripNarrative(block: RoadmapStoryPresentationBlock): RoadmapStoryPresentationBlock {
  if ("narrative" in block && (block as { narrative?: unknown }).narrative) {
    const clone = { ...block } as RoadmapStoryPresentationBlock & { narrative?: BlockNarrative };
    delete clone.narrative;
    return clone;
  }
  return block;
}

/**
 * Overlay AI blueprint onto deterministic blueprint and enforce
 * per-Story Visual Settings. If `settings` is null/undefined the
 * recommended defaults are used (all visuals on, narratives on for
 * narrative-capable blocks).
 */
export function applyAiBlueprintOverlay(
  ai: AiRoadmapStoryPresentationBlueprint,
  deterministic: RoadmapStoryPresentationBlueprint,
  settings?: RoadmapStoryVisualSettings | null,
): RoadmapStoryPresentationBlueprint {
  const resolvedSettings = settings ?? buildDefaultRoadmapStoryVisualSettings();
  const warnings: string[] = [...deterministic.validation.warnings];

  // Deterministic blocks pool, keyed by blockType.
  const detByType = new Map<string, RoadmapStoryPresentationBlock[]>();
  for (const b of deterministic.blocks) {
    const arr = detByType.get(b.blockType) ?? [];
    arr.push(b);
    detByType.set(b.blockType, arr);
  }

  const usedTypes = new Set<string>();
  const out: RoadmapStoryPresentationBlock[] = [];

  for (const aiBlock of ai.blocks) {
    const setting = resolvedSettings.blocks[
      aiBlock.blockType as keyof typeof resolvedSettings.blocks
    ];
    // Include Off — remove regardless of AI selection.
    if (setting && !setting.include) {
      warnings.push(`Excluded ${aiBlock.blockType} — visual setting Include is Off`);
      continue;
    }

    const pool = detByType.get(aiBlock.blockType) ?? [];
    const match = pool.shift();

    if (!match) {
      if (aiBlock.blockType === "source_limitations_footer") {
        const footer: SourceLimitationsFooterBlock = {
          slotId: "limitations",
          blockType: "source_limitations_footer",
          items: ai.sourceLimitations ?? [],
          evidenceRefs: [],
        };
        out.push(footer);
        usedTypes.add("source_limitations_footer");
        continue;
      }
      warnings.push(
        `Visual ${aiBlock.blockType} was requested but no source data was available.`,
      );
      continue;
    }

    let overlaid: RoadmapStoryPresentationBlock = { ...match };
    if (aiBlock.title && "title" in overlaid) {
      (overlaid as { title: string }).title = aiBlock.title;
    }
    const narrative = toDeterministicNarrative(aiBlock.narrative);
    if (narrative && "narrative" in overlaid) {
      (overlaid as { narrative?: BlockNarrative }).narrative = narrative;
    } else if (narrative && overlaid.blockType === "hero_takeaway") {
      if (narrative.tone) {
        (overlaid as { tone?: BlockNarrative["tone"] }).tone = narrative.tone;
      }
    }

    // Narrative Off enforcement.
    if (
      setting &&
      isNarrativeCapableBlockType(overlaid.blockType) &&
      !setting.narrative
    ) {
      overlaid = stripNarrative(overlaid);
    }

    out.push(overlaid);
    usedTypes.add(overlaid.blockType);
  }

  // Restore included-but-omitted deterministic blocks in canonical slot order.
  const restoreCandidates: RoadmapStoryPresentationBlock[] = [];
  for (const b of deterministic.blocks) {
    const setting = resolvedSettings.blocks[
      b.blockType as keyof typeof resolvedSettings.blocks
    ];
    if (setting && !setting.include) continue;
    if (usedTypes.has(b.blockType)) continue;
    if (b.blockType === "source_limitations_footer") continue; // handled below
    // If the same blockType appears multiple times deterministically, keep one.
    if (restoreCandidates.some((c) => c.blockType === b.blockType)) continue;
    restoreCandidates.push(b);
    usedTypes.add(b.blockType);
  }
  for (let i = 0; i < restoreCandidates.length; i++) {
    let block = restoreCandidates[i];
    const setting = resolvedSettings.blocks[
      block.blockType as keyof typeof resolvedSettings.blocks
    ];
    if (
      setting &&
      isNarrativeCapableBlockType(block.blockType) &&
      !setting.narrative
    ) {
      block = stripNarrative(block);
    }
    warnings.push(`Restored ${block.blockType} — required by Include settings but omitted by AI`);
    out.push(block);
  }

  // Ensure a source_limitations_footer exists unless Include Off.
  const footerSetting = resolvedSettings.blocks.source_limitations_footer;
  const hasFooter = out.some((b) => b.blockType === "source_limitations_footer");
  if (!hasFooter && (!footerSetting || footerSetting.include)) {
    out.push({
      slotId: "limitations",
      blockType: "source_limitations_footer",
      items: ai.sourceLimitations ?? [],
      evidenceRefs: [],
    });
  } else if (hasFooter && footerSetting && !footerSetting.include) {
    // If AI included footer but user turned it off, remove it. Internal
    // sourceLimitations metadata is preserved on the blueprint itself.
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].blockType === "source_limitations_footer") out.splice(i, 1);
    }
  }

  // Stable order: honour AI ordering among allowed blocks; restored
  // blocks land at the end of their canonical slot band.
  const ordered = [...out].sort((a, b) => {
    const ai = PRESENTATION_BLOCK_SLOT_ORDER.indexOf(a.slotId);
    const bi = PRESENTATION_BLOCK_SLOT_ORDER.indexOf(b.slotId);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return {
    ...deterministic,
    title: ai.title || deterministic.title,
    subtitle: ai.subtitle ?? deterministic.subtitle,
    density: ai.density,
    blocks: ordered,
    validation: { valid: true, warnings },
  };
}

// Re-export the narrative-capable set so downstream can consume it without
// importing the settings module directly.
export { NARRATIVE_CAPABLE_BLOCK_TYPES };
