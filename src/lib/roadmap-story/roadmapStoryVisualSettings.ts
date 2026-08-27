/**
 * Phase 6B.7b.2 — Roadmap Story Pack Visual Settings (per-Story).
 *
 * User-controlled Include / Narrative toggles for every implemented
 * visual template. Persisted per Story Pack via SECURITY DEFINER RPCs
 * (`get_roadmap_story_pack_visual_settings` /
 *  `update_roadmap_story_pack_visual_settings`).
 *
 * BTPM never trusts these settings coming from the AI response — they
 * are applied deterministically in the overlay/validation pass.
 */

import {
  ROADMAP_STORY_PRESENTATION_TEMPLATES,
  type RoadmapStoryPresentationTemplateKey,
} from "./roadmapStoryPresentationTemplates";
import type { RoadmapStoryPresentationBlockType } from "./roadmapStoryPresentationBlueprint";

export const ROADMAP_STORY_VISUAL_SETTINGS_SCHEMA_VERSION =
  "roadmap_story_visual_settings_v1" as const;

export interface RoadmapStoryVisualBlockSetting {
  include: boolean;
  narrative: boolean;
}

export interface RoadmapStoryVisualSettings {
  schemaVersion: typeof ROADMAP_STORY_VISUAL_SETTINGS_SCHEMA_VERSION;
  blocks: Record<RoadmapStoryPresentationTemplateKey, RoadmapStoryVisualBlockSetting>;
  updatedAt: string;
}

/**
 * Templates that render an explanatory narrative section
 * (`BlockNarrative` / "What this means" / implication / action). Blocks
 * that are inherently narrative in shape (hero) or purely metadata
 * (source limitations footer) do not expose a Narrative toggle.
 */
export const NARRATIVE_CAPABLE_BLOCK_TYPES: ReadonlySet<RoadmapStoryPresentationTemplateKey> =
  new Set<RoadmapStoryPresentationTemplateKey>([
    "executive_signal_strip",
    "portfolio_control_board",
    "project_card_grid",
    "gantt_timeline",
    "milestone_rail",
    "what_changed_timeline",
    "delivery_pressure_panel",
    "status_composition_chart",
    "delivery_progress_chart",
    "risk_severity_chart",
    "risk_matrix",
    "risk_blocker_focus",
    "kpi_card_grid",
    "decision_required_cards",
    "file_evidence_panel",
  ]);

export function isNarrativeCapableBlockType(
  blockType: RoadmapStoryPresentationBlockType | string,
): boolean {
  return NARRATIVE_CAPABLE_BLOCK_TYPES.has(
    blockType as RoadmapStoryPresentationTemplateKey,
  );
}

/**
 * Recommended default: every implemented visual on, narrative on for
 * narrative-capable visuals. Guarantees a previously-available core
 * visual (e.g. `gantt_timeline`) does not silently disappear because
 * the AI omitted it.
 */
export function buildDefaultRoadmapStoryVisualSettings(): RoadmapStoryVisualSettings {
  const blocks = {} as Record<
    RoadmapStoryPresentationTemplateKey,
    RoadmapStoryVisualBlockSetting
  >;
  for (const t of ROADMAP_STORY_PRESENTATION_TEMPLATES) {
    blocks[t.id] = {
      include: true,
      narrative: NARRATIVE_CAPABLE_BLOCK_TYPES.has(t.id),
    };
  }
  return {
    schemaVersion: ROADMAP_STORY_VISUAL_SETTINGS_SCHEMA_VERSION,
    blocks,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Coerce whatever the RPC returns (unknown / partial / from older
 * schema) into a fully-populated settings object. Missing blocks fall
 * back to Recommended defaults, unknown block ids are dropped, and
 * narrative flags on non-narrative-capable templates are forced false.
 */
export function resolveRoadmapStoryVisualSettings(
  raw: unknown,
): RoadmapStoryVisualSettings {
  const base = buildDefaultRoadmapStoryVisualSettings();
  if (!raw || typeof raw !== "object") return base;
  const src = raw as Record<string, unknown>;
  const savedBlocks = (src.blocks && typeof src.blocks === "object")
    ? (src.blocks as Record<string, unknown>)
    : {};
  const blocks = { ...base.blocks };
  for (const t of ROADMAP_STORY_PRESENTATION_TEMPLATES) {
    const s = savedBlocks[t.id];
    if (s && typeof s === "object") {
      const so = s as Record<string, unknown>;
      const include = typeof so.include === "boolean" ? so.include : blocks[t.id].include;
      const narrativeRaw = typeof so.narrative === "boolean" ? so.narrative : blocks[t.id].narrative;
      const narrative =
        NARRATIVE_CAPABLE_BLOCK_TYPES.has(t.id) && include ? narrativeRaw : false;
      blocks[t.id] = { include, narrative };
    } else {
      // Not saved — keep default but respect narrative capability rule.
      if (!NARRATIVE_CAPABLE_BLOCK_TYPES.has(t.id)) {
        blocks[t.id] = { ...blocks[t.id], narrative: false };
      }
    }
  }
  const updatedAt =
    typeof src.updatedAt === "string" ? src.updatedAt : new Date().toISOString();
  return {
    schemaVersion: ROADMAP_STORY_VISUAL_SETTINGS_SCHEMA_VERSION,
    blocks,
    updatedAt,
  };
}

/**
 * Convenience filter used by the input-package builder + overlay/validation.
 */
export interface RoadmapStoryVisualEnforcementLists {
  requiredBlockTypes: RoadmapStoryPresentationTemplateKey[];
  excludedBlockTypes: RoadmapStoryPresentationTemplateKey[];
  narrativeEnabledBlockTypes: RoadmapStoryPresentationTemplateKey[];
  narrativeDisabledBlockTypes: RoadmapStoryPresentationTemplateKey[];
}

export function toVisualEnforcementLists(
  settings: RoadmapStoryVisualSettings,
): RoadmapStoryVisualEnforcementLists {
  const requiredBlockTypes: RoadmapStoryPresentationTemplateKey[] = [];
  const excludedBlockTypes: RoadmapStoryPresentationTemplateKey[] = [];
  const narrativeEnabledBlockTypes: RoadmapStoryPresentationTemplateKey[] = [];
  const narrativeDisabledBlockTypes: RoadmapStoryPresentationTemplateKey[] = [];
  for (const t of ROADMAP_STORY_PRESENTATION_TEMPLATES) {
    const s = settings.blocks[t.id];
    if (!s) continue;
    if (s.include) requiredBlockTypes.push(t.id);
    else excludedBlockTypes.push(t.id);
    if (NARRATIVE_CAPABLE_BLOCK_TYPES.has(t.id)) {
      if (s.include && s.narrative) narrativeEnabledBlockTypes.push(t.id);
      else narrativeDisabledBlockTypes.push(t.id);
    }
  }
  return {
    requiredBlockTypes,
    excludedBlockTypes,
    narrativeEnabledBlockTypes,
    narrativeDisabledBlockTypes,
  };
}
