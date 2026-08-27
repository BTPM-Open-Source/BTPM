/**
 * Phase 6B.7b — AI Presentation Blueprint output schema.
 *
 * This is the ONLY shape the LLM is allowed to return. BTPM validates
 * every payload against this contract and rejects anything else
 * (HTML/CSS/SVG, URLs, unknown template ids, oversized narratives, etc).
 *
 * BTPM still owns rendering: the LLM never returns pixel layout, chart
 * data, or object URLs. It picks templates, orders them, sets narrative
 * copy, and references evidence via short strings.
 */

import type { RoadmapStoryPresentationTemplateKey } from "./roadmapStoryPresentationTemplates";

export const AI_BLUEPRINT_SCHEMA_VERSION = "roadmap_story_presentation_v1" as const;
export const AI_BLUEPRINT_TEMPLATE_ID = "steerco_briefing_v1" as const;

export type AiBlueprintTone = "neutral" | "positive" | "attention" | "risk";
export type AiBlueprintDensity = "compact" | "standard" | "detailed";
export type AiBlueprintPriority = "critical" | "high" | "medium" | "low";
export type AiBlueprintDisplayMode = "full" | "compact" | "collapsed";

export interface AiRoadmapStoryPresentationBlockNarrative {
  takeaway?: string;
  summary?: string[];
  implication?: string;
  action?: string;
  tone?: AiBlueprintTone;
  evidenceRefs?: string[];
}

export interface AiRoadmapStoryPresentationBlock {
  blockId: string;
  slotId: string;
  blockType: RoadmapStoryPresentationTemplateKey;
  title: string;
  narrative?: AiRoadmapStoryPresentationBlockNarrative;
  evidenceRefs?: string[];
  priority?: AiBlueprintPriority;
  displayMode?: AiBlueprintDisplayMode;
  /**
   * Optional lightweight emphasis / filter / prioritisation hints. Values
   * here MUST be simple strings — no HTML, no URLs, no code. BTPM may
   * ignore any hint it does not recognise.
   */
  focusHints?: string[];
}

export interface AiRoadmapStoryPresentationBlueprint {
  schemaVersion: typeof AI_BLUEPRINT_SCHEMA_VERSION;
  templateId: typeof AI_BLUEPRINT_TEMPLATE_ID;
  title: string;
  subtitle?: string;
  density: AiBlueprintDensity;
  executiveTakeaway: string;
  blocks: AiRoadmapStoryPresentationBlock[];
  sourceLimitations: string[];
  validationNotes?: string[];
}

export interface AiBlueprintValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** The sanitised blueprint safe to render. Null if `ok` is false. */
  blueprint: AiRoadmapStoryPresentationBlueprint | null;
}
