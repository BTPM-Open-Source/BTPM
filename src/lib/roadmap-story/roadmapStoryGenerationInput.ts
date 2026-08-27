/**
 * Phase 6B.6 — Generation-input builder for Roadmap Story Pack.
 *
 * Takes the in-memory `RoadmapStorySourceSnapshot` produced by
 * `useRoadmapStorySourceSnapshot` and prepares the bounded JSON payload
 * sent to the `generate-roadmap-story` Edge Function.
 *
 * Responsibilities:
 *   - Strip UI-only fields (none currently; placeholder for future use).
 *   - Append explicit source limitations the prompt must honor.
 *   - Enforce a payload size limit before the network call.
 *   - Produce a compact `sourceManifest` used for AI-run audit.
 *
 * Does NOT call AI, does NOT call SharePoint, does NOT touch comments.
 */
import type { RoadmapStorySourceSnapshot } from "@/lib/roadmap-story/roadmapStorySourceSnapshot";

// Defensive secondary bound — primary bounding happens in the snapshot
// composer (`STORY_SNAPSHOT_LIMITS`). Edge Function enforces ~1.5MB.
export const ROADMAP_STORY_GENERATION_MAX_BYTES = 1_200_000;

export interface RoadmapStoryGenerationInput {
  sourceSnapshot: RoadmapStorySourceSnapshot & {
    fixedSourceLimitations: string[];
  };
  sourceManifest: Record<string, unknown>;
  payloadBytes: number;
}

export type BuildResult =
  | { ok: true; input: RoadmapStoryGenerationInput }
  | {
      ok: false;
      error: "source_package_too_large" | "no_usable_sources";
      payloadBytes?: number;
    };

const FIXED_LIMITATIONS: string[] = [
  "discussions_comments are not connected — do NOT claim that comments or chat were analyzed.",
  // 6B.6e — File-content availability is decided server-side at run time
  // and reflected in the run's `file_context` manifest. The model must
  // rely on the manifest, not on a blanket metadata-only claim.
  "SharePoint file contents are available ONLY for files listed as `sent` in the run's `file_context` manifest. For files with status other than `sent`, treat them as metadata-only and do NOT claim their contents were read.",
  "progress_updates may be a partial fallback derived from activity signals — treat with care.",
  // 6B.6a — Detail enrichment policy the model must honor.
  "Each source item carries semantic detail fields (description/mitigation/summary/decisionQuestion). When `detail.available` is false there is no description for that object — do NOT invent context from the title.",
  "When `detail.truncated` is true the description was cut to keep the package bounded — do NOT assume hidden content beyond the truncation.",
];

export function buildRoadmapStoryGenerationInput(
  snapshot: RoadmapStorySourceSnapshot,
): BuildResult {
  // Reject if no source category produced any items at all.
  const counts = snapshot.counts ?? {};
  const totalItems = Object.values(counts).reduce<number>((s, n) => s + (typeof n === "number" ? n : 0), 0);
  if (totalItems === 0 && (snapshot.selectedCategories?.length ?? 0) === 0) {
    return { ok: false, error: "no_usable_sources" };
  }

  const enriched = {
    ...snapshot,
    fixedSourceLimitations: FIXED_LIMITATIONS,
  };

  const sourceManifest: Record<string, unknown> = {
    schema_version: "roadmap_story_v1",
    generated_at: snapshot.generatedAt,
    selected_categories: snapshot.selectedCategories,
    disabled_categories: snapshot.disabledCategories,
    counts: snapshot.counts,
    effective_scope: snapshot.scope.effective,
    coverage_notes_count: snapshot.coverageNotes?.length ?? 0,
    warnings_count: snapshot.warnings?.length ?? 0,
    fixed_source_limitations: FIXED_LIMITATIONS,
  };

  const serialized = JSON.stringify(enriched);
  if (serialized.length > ROADMAP_STORY_GENERATION_MAX_BYTES) {
    return { ok: false, error: "source_package_too_large", payloadBytes: serialized.length };
  }

  return {
    ok: true,
    input: {
      sourceSnapshot: enriched,
      sourceManifest,
      payloadBytes: serialized.length,
    },
  };
}
