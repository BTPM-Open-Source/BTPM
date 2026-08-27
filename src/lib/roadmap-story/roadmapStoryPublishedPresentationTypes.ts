/**
 * Phase 6B.8a — Published Story Presentation TypeScript contracts.
 *
 * Consumer-facing DTOs returned by the controlled Published Story RPCs.
 * These types MUST NOT include prompts, input packages, raw AI responses,
 * parsed blueprint debug, source snapshot JSON, or any `_encrypted` fields.
 *
 * The publish flow, viewer route, and Published tab UI are OUT OF SCOPE for
 * this step (6B.8a) and will be added in 6B.8b / 6B.8c / 6B.8d.
 */

import { supabase } from "@/integrations/supabase/client";

export type PublishedStoryPresentationStatus = "active" | "archived";

/**
 * Row shape for the owner's Published tab version list.
 * Returned by `get_roadmap_story_presentation_versions`.
 */
export interface PublishedStoryPresentationVersionListItem {
  versionId: string;
  presentationId: string;
  versionNumber: number;
  title: string;
  status: PublishedStoryPresentationStatus;
  publishedBy: string;
  publishedAt: string;
  archivedAt: string | null;
  sourceProjectCount: number;
  viewerCanOpen: boolean;
}

/**
 * Consumer-facing snapshot payload embedded inside a viewable published
 * version. The frozen renderable presentation ONLY. No debug internals.
 *
 * The exact block shape is intentionally loose here — the future publish
 * flow (6B.8b) will populate this from the validated presentation
 * blueprint. Renderers should treat unknown block types as no-ops.
 */
export interface PublishedStoryPresentationSnapshot {
  schemaVersion: string;
  presentationSchemaVersion?: string;
  templateId?: string;
  title: string;
  subtitle?: string | null;
  executiveTakeaway?: string | null;
  density?: string | null;
  /**
   * Renderable BTPM presentation blocks. Kept intentionally loose so the
   * viewer can render every block-type in `RoadmapStoryPresentationBlueprint`
   * without a second data-fetch. Publish-time sanitisation removes debug /
   * protected keys anywhere in the tree.
   */
  blocks: unknown[];
  sourceLimitations?: string[];
  objectLinkMode?: string;
  publishedFrom?: {
    sourceMode: PublishedStorySourceMode;
    storyPackVersionId?: string | null;
    presentationBlueprintRunId?: string | null;
  };
}

/**
 * Legacy generic block shape retained for callers that still consume the
 * lightweight view. New viewers should treat
 * `PublishedStoryPresentationSnapshot['blocks']` as the full
 * `RoadmapStoryPresentationBlock` union from the BTPM blueprint.
 */
export interface PublishedStoryPresentationBlock {
  blockId: string;
  slotId?: string | null;
  blockType: string;
  title?: string | null;
  narrative?: {
    takeaway?: string | null;
    summary?: string | null;
    implication?: string | null;
    action?: string | null;
    tone?: string | null;
    evidenceRefs?: string[];
  } | null;
  priority?: number | null;
  displayMode?: string | null;
  renderPayload?: unknown;
}

/**
 * DTO returned by `get_roadmap_story_presentation_version_for_view`.
 * Only exposed after `can_view_roadmap_story_presentation_version` passes.
 */
export interface PublishedStoryPresentationViewDto {
  versionId: string;
  presentationId: string;
  storyPackId: string;
  versionNumber: number;
  title: string;
  snapshot: PublishedStoryPresentationSnapshot;
  sourceLimitations: string[] | null;
  publishedBy: string;
  publishedAt: string;
  status: PublishedStoryPresentationStatus;
}

/**
 * Access-scope row returned by
 * `get_roadmap_story_presentation_version_access_scope` (owner/publisher only).
 * Safe to display in the future Published tab as ids only.
 */
export interface PublishedStoryPresentationAccessScopeProject {
  workspaceId: string;
  projectId: string;
}

// ---------------------------------------------------------------------------
// Service methods — RPC only. No direct .from() access permitted for any of
// the three published-story tables. UI wiring is intentionally deferred.
// ---------------------------------------------------------------------------

export async function getPublishedStoryVersions(
  storyPackId: string,
): Promise<PublishedStoryPresentationVersionListItem[]> {
  const { data, error } = await supabase.rpc(
    "get_roadmap_story_presentation_versions" as never,
    { _story_pack_id: storyPackId } as never,
  );
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    versionId: r.version_id as string,
    presentationId: r.presentation_id as string,
    versionNumber: r.version_number as number,
    title: (r.title as string) ?? "",
    status: (r.status as PublishedStoryPresentationStatus) ?? "active",
    publishedBy: r.published_by as string,
    publishedAt: r.published_at as string,
    archivedAt: (r.archived_at as string | null) ?? null,
    sourceProjectCount: (r.source_project_count as number) ?? 0,
    viewerCanOpen: Boolean(r.viewer_can_open),
  }));
}

export async function getPublishedStoryVersionForView(
  versionId: string,
): Promise<PublishedStoryPresentationViewDto> {
  const { data, error } = await supabase.rpc(
    "get_roadmap_story_presentation_version_for_view" as never,
    { _version_id: versionId } as never,
  );
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  const snapshot = (row.snapshot as PublishedStoryPresentationSnapshot | null) ?? {
    schemaVersion: "roadmap_story_presentation_v1",
    title: "",
    blocks: [],
  };
  return {
    versionId: row.version_id as string,
    presentationId: row.presentation_id as string,
    storyPackId: row.story_pack_id as string,
    versionNumber: row.version_number as number,
    title: (row.title as string) ?? "",
    snapshot,
    sourceLimitations: (row.source_limitations as string[] | null) ?? null,
    publishedBy: row.published_by as string,
    publishedAt: row.published_at as string,
    status: (row.status as PublishedStoryPresentationStatus) ?? "active",
  };
}

export async function archivePublishedStoryVersion(versionId: string): Promise<void> {
  const { error } = await supabase.rpc(
    "archive_roadmap_story_presentation_version" as never,
    { _version_id: versionId } as never,
  );
  if (error) throw error;
}

export async function getPublishedStoryVersionAccessScope(
  versionId: string,
): Promise<PublishedStoryPresentationAccessScopeProject[]> {
  const { data, error } = await supabase.rpc(
    "get_roadmap_story_presentation_version_access_scope" as never,
    { _version_id: versionId } as never,
  );
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    workspaceId: r.workspace_id as string,
    projectId: r.project_id as string,
  }));
}

// ---------------------------------------------------------------------------
// Phase 6B.8b — Publish contracts
// ---------------------------------------------------------------------------

export type PublishedStorySourceMode = "ai_blueprint" | "deterministic";

/**
 * Structured `(workspaceId, projectId)` reference. Access-scope rows in
 * `roadmap_story_presentation_version_projects` use exactly this shape.
 */
export interface PublishedStorySourceProjectRef {
  workspaceId: string;
  projectId: string;
}

export type PublishedStoryPublishWarning = string;

/**
 * Client request to publish the current reviewed presentation as a new
 * immutable version.
 *
 * `renderedPresentationSnapshot` is REQUIRED for normal publishing. It is
 * the final overlaid BTPM-renderable presentation the owner just reviewed
 * in the Preview tab (deterministic blueprint + optional AI blueprint
 * overlay applied client-side). It is the report content itself.
 *
 * When an AI Presentation Blueprint is active, the caller MUST first
 * apply `applyAiBlueprintOverlay(aiBlueprint, deterministicBlueprint)`
 * and then wrap the result with `buildRenderedPublishedSnapshot(...)`.
 * The Edge Function will NOT publish raw AI blueprint JSON — snapshots
 * must be `btpm_published_story_v1` envelopes.
 *
 * `deterministicSnapshot` is retained only as a legacy compatibility
 * fallback and must also be a `btpm_published_story_v1` envelope.
 *
 * The client MUST NOT send project scope; access-scope is derived
 * server-side (source snapshot -> filter fallback).
 */
export interface PublishStoryPresentationRequest {
  storyPackId: string;
  storyPackVersionId?: string | null;
  presentationBlueprintRunId?: string | null;
  titleOverride?: string | null;
  renderedPresentationSnapshot?: PublishedStoryPresentationSnapshot | null;
  deterministicSnapshot?: PublishedStoryPresentationSnapshot | null;
}

/**
 * Safe DTO returned by the publish operation. Never contains prompt /
 * input package / raw response / parsed AI debug / snapshot ciphertext.
 */
export interface PublishStoryPresentationResult {
  presentationId: string;
  versionId: string;
  storyPackId: string;
  storyPackVersionId: string | null;
  versionNumber: number;
  title: string;
  status: PublishedStoryPresentationStatus;
  publishedAt: string;
  sourceProjectCount: number;
  sourceMode: PublishedStorySourceMode;
  scopeSource: "source_snapshot" | "scope_config_fallback" | "none";
  warnings: PublishedStoryPublishWarning[];
  /**
   * Path where the published viewer route WILL live in 6B.8c. Returned
   * for readiness; the route itself is not implemented in 6B.8b.
   */
  futurePath: string;
}

/**
 * Invoke the `publish-roadmap-story-presentation` Edge Function. Uses the
 * Supabase JS client; no direct `.from(...)` access to any of the three
 * 6B.8a published tables is permitted from the frontend.
 */
export async function publishStoryPresentation(
  request: PublishStoryPresentationRequest,
): Promise<PublishStoryPresentationResult> {
  const { data, error } = await supabase.functions.invoke(
    "publish-roadmap-story-presentation",
    { body: request },
  );
  if (error) throw error;
  const row = (data ?? {}) as Record<string, unknown>;
  if (row.ok === false) {
    const code = typeof row.error === "string" ? row.error : "publish_failed";
    const note = typeof row.note === "string" ? `: ${row.note}` : "";
    throw new Error(`${code}${note}`);
  }
  return {
    presentationId: String(row.presentationId ?? ""),
    versionId: String(row.versionId ?? ""),
    storyPackId: String(row.storyPackId ?? ""),
    storyPackVersionId:
      typeof row.storyPackVersionId === "string" ? row.storyPackVersionId : null,
    versionNumber: Number(row.versionNumber ?? 0),
    title: String(row.title ?? ""),
    status: (row.status as PublishedStoryPresentationStatus) ?? "active",
    publishedAt: String(row.publishedAt ?? ""),
    sourceProjectCount: Number(row.sourceProjectCount ?? 0),
    sourceMode: (row.sourceMode as PublishedStorySourceMode) ?? "deterministic",
    scopeSource:
      (row.scopeSource as PublishStoryPresentationResult["scopeSource"]) ?? "none",
    warnings: Array.isArray(row.warnings)
      ? (row.warnings as unknown[]).filter((v): v is string => typeof v === "string")
      : [],
    futurePath: String(row.futurePath ?? ""),
  };
}

