/**
 * Phase 6B.8e.1 — Shared Roadmap Story creation defaults.
 *
 * Extracted so Create Story flows in both:
 *   - RoadmapStoryPackConfigure (detail/configure page)
 *   - RoadmapStoriesLibrary (My Stories quick-create)
 * apply the same default-disabled source categories.
 */

import type { RoadmapStorySourceCategory } from "@/lib/roadmapStoryPackService";

/** Categories disabled by default when a new Story Pack is created. */
export const DEFAULT_DISABLED_ROADMAP_STORY_SOURCE_CATEGORIES: RoadmapStorySourceCategory[] = [
  "discussions_comments",
  "documents_metadata",
  "external_context",
];
