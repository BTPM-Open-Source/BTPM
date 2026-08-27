/**
 * Phase 6B.8c — Published Story Presentation renderer (consumer/read-only).
 *
 * Renders the frozen `btpm_published_story_v1` snapshot the publisher
 * reviewed in Preview. Reuses the exact same block renderer as the
 * authoring Preview so visuals stay identical, but strips authoring
 * chrome: no adapter/validation warnings, no template library, no
 * generation debug, no density/template chips, no "Preview" language.
 *
 * The renderer accepts already-validated snapshot data. Snapshot
 * validation lives in the page component so the "invalid snapshot"
 * safe-error state can render without any block markup.
 */

import { useMemo } from "react";
import {
  PresentationBlockRenderer,
  PRESENTATION_BLOCK_SLOT_ORDER,
} from "./RoadmapStoryPresentationPreview";
import type { RoadmapStoryPresentationBlock } from "@/lib/roadmap-story/roadmapStoryPresentationBlueprint";

export interface PublishedStoryPresentationRendererProps {
  title: string;
  subtitle?: string | null;
  executiveTakeaway?: string | null;
  blocks: RoadmapStoryPresentationBlock[];
}

export function PublishedStoryPresentationRenderer(
  props: PublishedStoryPresentationRendererProps,
) {
  const ordered = useMemo(() => {
    return [...props.blocks].sort((a, b) => {
      const ai = PRESENTATION_BLOCK_SLOT_ORDER.indexOf(a.slotId);
      const bi = PRESENTATION_BLOCK_SLOT_ORDER.indexOf(b.slotId);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [props.blocks]);

  return (
    <div className="space-y-5">
      {ordered.map((b, i) => (
        <PresentationBlockRenderer
          key={`${b.slotId ?? "slot"}-${b.blockType}-${i}`}
          block={b}
        />
      ))}
    </div>
  );
}
