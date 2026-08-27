/**
 * Phase 6B.8b.2 — Published Story Presentation snapshot builder.
 *
 * Produces the consumer-facing frozen snapshot from an already-rendered
 * BTPM presentation blueprint. Preserves the full block-specific render
 * data (project cards, portfolio rows, Gantt rows, chart series, KPI
 * items, risk matrix cells, file evidence, etc.) so the future viewer
 * can render every block without a second data fetch.
 *
 * When the owner has a valid AI Presentation Blueprint, the caller MUST
 * first overlay the AI blueprint onto the deterministic blueprint
 * (`applyAiBlueprintOverlay`) and pass the OVERLAID blueprint here — the
 * raw AI blueprint is not renderable on its own and the publish Edge
 * Function will reject `roadmap_story_presentation_v1` shapes with
 * `invalid_rendered_snapshot`.
 *
 * This helper is the single approved wrapper for producing the
 * `btpm_published_story_v1` envelope required by the publish flow.
 *
 * The Edge Function performs an additional recursive sanitisation pass
 * so no prompt / input package / raw response / parsed AI debug / source
 * package / provider metadata / `_encrypted` fields / file bytes can
 * accidentally survive into a published snapshot.
 */

import type { RoadmapStoryPresentationBlueprint } from "./roadmapStoryPresentationBlueprint";
import type { PublishedStoryPresentationSnapshot } from "./roadmapStoryPublishedPresentationTypes";

export interface BuildRenderedPublishedSnapshotInput {
  /** Overlaid (AI-on-deterministic) or plain deterministic blueprint. */
  blueprint: RoadmapStoryPresentationBlueprint;
  titleOverride?: string | null;
  storyPackVersionId?: string | null;
  presentationBlueprintRunId?: string | null;
  /** Marks the origin. AI-derived overlays => "ai_blueprint". */
  sourceMode?: "ai_blueprint" | "deterministic";
}

/**
 * Structural clone without carrying non-JSON references. Uses the
 * platform's `structuredClone` when available, otherwise a JSON round-trip.
 */
function safeClone<T>(value: T): T {
  const g = globalThis as unknown as { structuredClone?: <U>(v: U) => U };
  if (typeof g.structuredClone === "function") {
    try {
      return g.structuredClone(value);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Deep clone the blueprint into a published snapshot envelope. Debug and
 * protected keys are stripped again server-side, but we drop the obvious
 * ones here too so payload size stays reasonable during transport.
 */
export function buildRenderedPublishedSnapshot(
  input: BuildRenderedPublishedSnapshotInput,
): PublishedStoryPresentationSnapshot {
  const bp = input.blueprint as unknown as {
    title?: string | null;
    subtitle?: string | null;
    executiveTakeaway?: string | null;
    density?: string | null;
    templateId?: string | null;
    blocks?: unknown[];
    sourceLimitations?: unknown;
    validation?: unknown;
  };

  const clonedBlocks = Array.isArray(bp.blocks) ? safeClone(bp.blocks) : [];
  const sourceLimitations = Array.isArray(bp.sourceLimitations)
    ? (bp.sourceLimitations as unknown[])
        .filter((v): v is string => typeof v === "string")
        .slice(0, 40)
    : [];

  const title = (input.titleOverride?.trim() ||
    (typeof bp.title === "string" ? bp.title.trim() : "") ||
    "Roadmap Story").slice(0, 300);

  const sourceMode = input.sourceMode ?? "deterministic";

  return {
    schemaVersion: "btpm_published_story_v1",
    presentationSchemaVersion: "roadmap_story_presentation_v1",
    templateId: typeof bp.templateId === "string" ? bp.templateId : "steerco_briefing_v1",
    title,
    subtitle: typeof bp.subtitle === "string" ? bp.subtitle : null,
    executiveTakeaway:
      typeof bp.executiveTakeaway === "string" ? bp.executiveTakeaway : null,
    density: typeof bp.density === "string" ? bp.density : "standard",
    blocks: clonedBlocks,
    sourceLimitations,
    objectLinkMode: "btpm_protected_routes",
    publishedFrom: {
      sourceMode,
      storyPackVersionId: input.storyPackVersionId ?? null,
      presentationBlueprintRunId: input.presentationBlueprintRunId ?? null,
    },
  };
}

/**
 * Legacy alias — kept so any 6B.8b caller written against the previous
 * builder name still compiles. Prefer `buildRenderedPublishedSnapshot`.
 */
export const buildDeterministicPublishedSnapshot = (
  input: BuildRenderedPublishedSnapshotInput,
): PublishedStoryPresentationSnapshot =>
  buildRenderedPublishedSnapshot({ ...input, sourceMode: input.sourceMode ?? "deterministic" });
