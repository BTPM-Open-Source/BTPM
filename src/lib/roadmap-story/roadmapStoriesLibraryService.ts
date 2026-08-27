/**
 * Phase 6B.8e — Roadmap Stories Library service layer.
 *
 * Controlled RPC access for:
 *   - accessible Published Story Presentation versions the current user
 *     can open (owned by anyone, all-source-projects rule enforced
 *     server-side via `can_view_roadmap_story_presentation_version`).
 *
 * No direct `.from(...)` access to any Story Pack or Published Story
 * table. No encrypted fields, snapshots, prompts, or debug internals
 * are ever surfaced to the frontend.
 */

import { supabase } from "@/integrations/supabase/client";
import type { PublishedStoryPresentationStatus } from "./roadmapStoryPublishedPresentationTypes";

export interface AccessibleRoadmapStoryPublishedVersion {
  versionId: string;
  presentationId: string;
  storyPackId: string;
  versionNumber: number;
  title: string;
  status: PublishedStoryPresentationStatus;
  publishedBy: string;
  publishedAt: string;
  sourceProjectCount: number;
  isOwner: boolean;
}

export async function getAccessibleRoadmapStoryPublishedVersions(input?: {
  query?: string | null;
  limit?: number | null;
}): Promise<AccessibleRoadmapStoryPublishedVersion[]> {
  const { data, error } = await supabase.rpc(
    "get_accessible_roadmap_story_published_versions" as never,
    {
      _query: input?.query ?? null,
      _limit: input?.limit ?? 50,
    } as never,
  );
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    versionId: r.version_id as string,
    presentationId: r.presentation_id as string,
    storyPackId: r.story_pack_id as string,
    versionNumber: r.version_number as number,
    title: (r.title as string) ?? "",
    status: (r.status as PublishedStoryPresentationStatus) ?? "active",
    publishedBy: r.published_by as string,
    publishedAt: r.published_at as string,
    sourceProjectCount: (r.source_project_count as number) ?? 0,
    isOwner: Boolean(r.is_owner),
  }));
}
