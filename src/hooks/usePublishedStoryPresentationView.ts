/**
 * Phase 6B.8c — Published Story Presentation viewer hook.
 *
 * Fetches a single published Story version via the controlled RPC service
 * `getPublishedStoryVersionForView`. All access enforcement lives in the
 * backend RPC `get_roadmap_story_presentation_version_for_view` (which in
 * turn calls `can_view_roadmap_story_presentation_version`). This hook
 * never reads the `roadmap_story_presentations*` tables directly.
 *
 * Known backend error tokens are mapped to stable UI states so the viewer
 * page can render safe, non-technical messages without disclosing project
 * ids, workspace ids, or decrypted scope internals.
 */

import { useQuery } from "@tanstack/react-query";
import {
  getPublishedStoryVersionForView,
  type PublishedStoryPresentationViewDto,
} from "@/lib/roadmap-story/roadmapStoryPublishedPresentationTypes";

export type PublishedStoryViewErrorKind =
  | "forbidden"
  | "archived"
  | "not_found"
  | "invalid_snapshot"
  | "generic";

export interface PublishedStoryViewError {
  kind: PublishedStoryViewErrorKind;
}

function classifyBackendError(err: unknown): PublishedStoryViewErrorKind {
  const raw =
    (err as { message?: string; code?: string; details?: string } | null | undefined)
      ?.message ??
    (err as { code?: string } | null | undefined)?.code ??
    "";
  const s = String(raw).toLowerCase();
  if (
    s.includes("forbidden") ||
    s.includes("permission") ||
    s.includes("not authorized") ||
    s.includes("not_authorized") ||
    s.includes("access_denied") ||
    s.includes("no access") ||
    s.includes("no_access")
  ) {
    return "forbidden";
  }
  if (s.includes("archived") || s.includes("unavailable")) return "archived";
  if (s.includes("not_found") || s.includes("not found") || s.includes("no rows")) {
    return "not_found";
  }
  return "generic";
}

export function usePublishedStoryPresentationView(versionId: string | undefined) {
  return useQuery<PublishedStoryPresentationViewDto, PublishedStoryViewError>({
    queryKey: ["published-story-presentation-view", versionId ?? null],
    enabled: Boolean(versionId),
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const dto = await getPublishedStoryVersionForView(versionId as string);
        if (!dto || !dto.versionId) {
          throw { kind: "not_found" } as PublishedStoryViewError;
        }
        return dto;
      } catch (err) {
        const kind = classifyBackendError(err);
        throw { kind } as PublishedStoryViewError;
      }
    },
  });
}
