/**
 * Roadmap Story Pack — controlled write/read service (Phase 6B.3).
 *
 * Wraps the SECURITY DEFINER RPCs so the frontend never writes to `_encrypted`
 * columns directly. All protected fields are encrypted server-side on write
 * and decrypted server-side on read via these RPCs.
 *
 * NOTE: AI generation, Story rendering, sharing, and SharePoint content
 * ingestion are intentionally NOT implemented in this layer.
 */

import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Source category vocabulary (mirrors DB CHECK constraint and
// public.roadmap_story_allowed_source_categories()).
// ---------------------------------------------------------------------------
export const ROADMAP_STORY_SOURCE_CATEGORIES = [
  "program_project_overview",
  "planning_phases_tasks",
  "progress_updates",
  "activity_history",
  "discussions_comments",
  "risks",
  "blockers",
  "dependencies",
  "kpis_snapshots",
  "governance_decisions",
  "team_work",
  "documents_metadata",
  "external_context",
] as const;

export type RoadmapStorySourceCategory = (typeof ROADMAP_STORY_SOURCE_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// DTOs returned by get_roadmap_story_pack_config (decrypted).
// ---------------------------------------------------------------------------
export interface RoadmapStoryPackDTO {
  id: string;
  organization_id: string;
  primary_workspace_id: string | null;
  program_id: string | null;
  created_by: string;
  status: "draft" | "archived";
  scope_config: Record<string, unknown>;
  source_config: Record<string, unknown>;
  title: string | null;
  guidance: string | null;
  audience: string | null;
  focus: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoadmapStoryPackSourceDTO {
  id: string;
  source_category: RoadmapStorySourceCategory;
  is_enabled: boolean;
  config: Record<string, unknown>;
  sort_order: number | null;
  updated_at: string;
}

export interface RoadmapStoryPackNoteDTO {
  id: string;
  label: string | null;
  body: string;
  include_in_story: boolean;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
}

export interface RoadmapStoryPackExternalFileDTO {
  id: string;
  provider: "sharepoint";
  drive_id: string | null;
  item_id: string | null;
  display_name: string | null;
  web_url: string | null;
  user_note: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  include_in_story: boolean;
  created_at: string;
  updated_at: string;
}

export interface RoadmapStoryPackVersionDTO {
  id: string;
  version_number: number;
  status: "draft" | "final" | "archived";
  source_manifest: Record<string, unknown>;
  model_metadata: Record<string, unknown>;
  created_at: string;
}

export interface RoadmapStoryAiRunDTO {
  id: string;
  story_pack_version_id: string | null;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  provider: string | null;
  model: string | null;
  reasoning_effort: "low" | "medium" | "high" | null;
  feature_key: string;
  input_manifest: Record<string, unknown>;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface RoadmapStoryPackConfig {
  pack: RoadmapStoryPackDTO;
  sources: RoadmapStoryPackSourceDTO[];
  notes: RoadmapStoryPackNoteDTO[];
  external_files: RoadmapStoryPackExternalFileDTO[];
  versions: RoadmapStoryPackVersionDTO[];
  ai_runs: RoadmapStoryAiRunDTO[];
}

// ---------------------------------------------------------------------------
// Summary listing
// ---------------------------------------------------------------------------
export interface RoadmapStoryPackSummary {
  id: string;
  organization_id: string;
  primary_workspace_id: string | null;
  program_id: string | null;
  status: "draft" | "archived";
  audience: string | null;
  focus: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export async function listRoadmapStoryPacks(
  includeArchived = true,
): Promise<RoadmapStoryPackSummary[]> {
  const { data, error } = await supabase.rpc("list_roadmap_story_packs" as never, {
    _include_archived: includeArchived,
  } as never);
  if (error) throw error;
  return (data ?? []) as unknown as RoadmapStoryPackSummary[];
}

// ---------------------------------------------------------------------------
// Create / read / update / archive
// ---------------------------------------------------------------------------
export interface CreateRoadmapStoryPackInput {
  title?: string | null;
  guidance?: string | null;
  audience?: string | null;
  focus?: string | null;
  primaryWorkspaceId?: string | null;
  programId?: string | null;
  scopeConfig?: Record<string, unknown>;
  sourceConfig?: Record<string, unknown>;
}

export async function createRoadmapStoryPack(input: CreateRoadmapStoryPackInput): Promise<string> {
  const { data, error } = await supabase.rpc("create_roadmap_story_pack" as never, {
    _title: input.title ?? null,
    _guidance: input.guidance ?? null,
    _audience: input.audience ?? null,
    _focus: input.focus ?? null,
    _primary_workspace_id: input.primaryWorkspaceId ?? null,
    _program_id: input.programId ?? null,
    _scope_config: input.scopeConfig ?? {},
    _source_config: input.sourceConfig ?? {},
  } as never);
  if (error) throw error;
  return data as unknown as string;
}

export async function getRoadmapStoryPackConfig(storyPackId: string): Promise<RoadmapStoryPackConfig> {
  const { data, error } = await supabase.rpc("get_roadmap_story_pack_config" as never, {
    _story_pack_id: storyPackId,
  } as never);
  if (error) throw error;
  return data as unknown as RoadmapStoryPackConfig;
}

export interface UpdateRoadmapStoryPackConfigInput {
  title?: string | null;
  guidance?: string | null;
  audience?: string | null;
  focus?: string | null;
  primaryWorkspaceId?: string | null;
  programId?: string | null;
  scopeConfig?: Record<string, unknown>;
  sourceConfig?: Record<string, unknown>;
}

export async function updateRoadmapStoryPackConfig(
  storyPackId: string,
  patch: UpdateRoadmapStoryPackConfigInput,
): Promise<void> {
  const has = (k: keyof UpdateRoadmapStoryPackConfigInput) => Object.prototype.hasOwnProperty.call(patch, k);
  const { error } = await supabase.rpc("update_roadmap_story_pack_config" as never, {
    _story_pack_id: storyPackId,
    _title: patch.title ?? null,
    _guidance: patch.guidance ?? null,
    _audience: patch.audience ?? null,
    _focus: patch.focus ?? null,
    _primary_workspace_id: patch.primaryWorkspaceId ?? null,
    _program_id: patch.programId ?? null,
    _scope_config: has("scopeConfig") ? (patch.scopeConfig ?? {}) : null,
    _source_config: has("sourceConfig") ? (patch.sourceConfig ?? {}) : null,
    _patch_title: has("title"),
    _patch_guidance: has("guidance"),
    _patch_audience: has("audience"),
    _patch_focus: has("focus"),
    _patch_primary_workspace: has("primaryWorkspaceId"),
    _patch_program: has("programId"),
  } as never);
  if (error) throw error;
}

export async function archiveRoadmapStoryPack(storyPackId: string): Promise<void> {
  const { error } = await supabase.rpc("archive_roadmap_story_pack" as never, {
    _story_pack_id: storyPackId,
  } as never);
  if (error) throw error;
}

export async function unarchiveRoadmapStoryPack(storyPackId: string): Promise<void> {
  const { error } = await supabase.rpc("unarchive_roadmap_story_pack" as never, {
    _story_pack_id: storyPackId,
  } as never);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Source categories
// ---------------------------------------------------------------------------
export interface SetSourceInput {
  source_category: RoadmapStorySourceCategory;
  is_enabled?: boolean;
  config?: Record<string, unknown>;
  sort_order?: number | null;
}

export async function setRoadmapStoryPackSources(
  storyPackId: string,
  sources: SetSourceInput[],
): Promise<void> {
  const { error } = await supabase.rpc("set_roadmap_story_pack_sources" as never, {
    _story_pack_id: storyPackId,
    _sources: sources as unknown as object,
  } as never);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
export interface AddNoteInput {
  body: string;
  label?: string | null;
  include_in_story?: boolean;
  sort_order?: number | null;
}

export async function addRoadmapStoryPackNote(storyPackId: string, input: AddNoteInput): Promise<string> {
  const { data, error } = await supabase.rpc("add_roadmap_story_pack_note" as never, {
    _story_pack_id: storyPackId,
    _body: input.body,
    _label: input.label ?? null,
    _include_in_story: input.include_in_story ?? true,
    _sort_order: input.sort_order ?? null,
  } as never);
  if (error) throw error;
  return data as unknown as string;
}

export interface UpdateNoteInput {
  body?: string;
  label?: string | null;
  include_in_story?: boolean;
  sort_order?: number | null;
}

export async function updateRoadmapStoryPackNote(noteId: string, patch: UpdateNoteInput): Promise<void> {
  const has = (k: keyof UpdateNoteInput) => Object.prototype.hasOwnProperty.call(patch, k);
  const { error } = await supabase.rpc("update_roadmap_story_pack_note" as never, {
    _note_id: noteId,
    _body: patch.body ?? null,
    _label: patch.label ?? null,
    _include_in_story: patch.include_in_story ?? null,
    _sort_order: patch.sort_order ?? null,
    _patch_body: has("body"),
    _patch_label: has("label"),
    _patch_include: has("include_in_story"),
    _patch_sort: has("sort_order"),
  } as never);
  if (error) throw error;
}

export async function deleteRoadmapStoryPackNote(noteId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_roadmap_story_pack_note" as never, {
    _note_id: noteId,
  } as never);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// External SharePoint file references (metadata only — no Graph fetch, no bytes).
// ---------------------------------------------------------------------------
export interface AddExternalFileInput {
  driveId: string;
  itemId: string;
  displayName?: string | null;
  webUrl?: string | null;
  userNote?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  includeInStory?: boolean;
  provider?: "sharepoint";
}

export async function addRoadmapStoryPackExternalFile(
  storyPackId: string,
  input: AddExternalFileInput,
): Promise<string> {
  const { data, error } = await supabase.rpc("add_roadmap_story_pack_external_file" as never, {
    _story_pack_id: storyPackId,
    _drive_id: input.driveId,
    _item_id: input.itemId,
    _display_name: input.displayName ?? null,
    _web_url: input.webUrl ?? null,
    _user_note: input.userNote ?? null,
    _mime_type: input.mimeType ?? null,
    _size_bytes: input.sizeBytes ?? null,
    _include_in_story: input.includeInStory ?? true,
    _provider: input.provider ?? "sharepoint",
  } as never);
  if (error) throw error;
  return data as unknown as string;
}

export interface UpdateExternalFileInput {
  displayName?: string | null;
  webUrl?: string | null;
  userNote?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  includeInStory?: boolean;
}

export async function updateRoadmapStoryPackExternalFile(
  fileId: string,
  patch: UpdateExternalFileInput,
): Promise<void> {
  const has = (k: keyof UpdateExternalFileInput) => Object.prototype.hasOwnProperty.call(patch, k);
  const { error } = await supabase.rpc("update_roadmap_story_pack_external_file" as never, {
    _file_id: fileId,
    _display_name: patch.displayName ?? null,
    _web_url: patch.webUrl ?? null,
    _user_note: patch.userNote ?? null,
    _mime_type: patch.mimeType ?? null,
    _size_bytes: patch.sizeBytes ?? null,
    _include_in_story: patch.includeInStory ?? null,
    _patch_display_name: has("displayName"),
    _patch_web_url: has("webUrl"),
    _patch_user_note: has("userNote"),
    _patch_mime_type: has("mimeType"),
    _patch_size_bytes: has("sizeBytes"),
    _patch_include_in_story: has("includeInStory"),
  } as never);
  if (error) throw error;
}

export async function removeRoadmapStoryPackExternalFile(fileId: string): Promise<void> {
  const { error } = await supabase.rpc("remove_roadmap_story_pack_external_file" as never, {
    _file_id: fileId,
  } as never);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Phase 6B.6 — Controlled AI draft generation (server-side only).
// The browser never calls OpenAI. It only invokes the
// `generate-roadmap-story` Edge Function, which authenticates, verifies
// Story Pack ownership/archived state, calls the configured model, and
// persists the generated draft + AI run audit via SECURITY DEFINER RPCs.
// ---------------------------------------------------------------------------
export interface GenerateRoadmapStoryDraftInput {
  storyPackId: string;
  sourceSnapshot: unknown;
  sourceManifest: Record<string, unknown>;
}

// 6B.6d — File context manifest surfaced by the generation Edge Function.
export interface RoadmapStoryFileAudit {
  attachment_alias: string;
  display_name: string | null;
  status:
    | "sent" | "unsupported_file_type" | "file_too_large"
    | "total_size_limit_exceeded" | "missing_identifiers"
    | "graph_token_unavailable" | "download_failed"
    | "not_included" | "skipped" | "over_file_count_limit";
  input_kind: "input_file" | "input_image" | "input_text" | "unsupported" | "none";
  mime_type: string | null;
  size_bytes: number | null;
  file_extension: string | null;
  skip_reason: string | null;
}

export interface RoadmapStoryFileManifest {
  included_count: number;
  sent_count: number;
  skipped_count: number;
  excluded_count: number;
  total_bytes_sent: number;
  limits: { maxFiles: number; maxBytesPerFile: number; maxTotalBytes: number };
  files: RoadmapStoryFileAudit[];
}

export interface GenerateRoadmapStoryDraftQueued {
  ok: true;
  status: "queued";
  ai_run_id: string;
  openai_response_id: string;
  model: string;
  provider: string;
  file_manifest?: RoadmapStoryFileManifest;
}

export interface GenerateRoadmapStoryDraftFailure {
  ok: false;
  error: string;
  note?: string;
  ai_run_id?: string | null;
}

export type GenerateRoadmapStoryDraftResult =
  | GenerateRoadmapStoryDraftQueued
  | GenerateRoadmapStoryDraftFailure;

export async function generateRoadmapStoryDraft(
  input: GenerateRoadmapStoryDraftInput,
): Promise<GenerateRoadmapStoryDraftResult> {
  const { data, error } = await supabase.functions.invoke("generate-roadmap-story", {
    body: {
      storyPackId: input.storyPackId,
      sourceSnapshot: input.sourceSnapshot,
      sourceManifest: input.sourceManifest,
    },
  });
  if (error) {
    return { ok: false, error: "edge_invoke_failed", note: error.message };
  }
  return (data ?? { ok: false, error: "empty_response" }) as GenerateRoadmapStoryDraftResult;
}

// 6B.6d — Long-running polling for the background generation.
export interface PollRoadmapStoryRunResponse {
  ok: boolean;
  status: "in_progress" | "completed" | "failed" | "cancelled";
  ai_run_id?: string;
  story_pack_version_id?: string | null;
  error?: string;
  note?: string | null;
  openai_state?: string;
}

export async function pollRoadmapStoryRun(aiRunId: string): Promise<PollRoadmapStoryRunResponse> {
  const { data, error } = await supabase.functions.invoke("poll-roadmap-story", {
    body: { aiRunId },
  });
  if (error) {
    return { ok: false, status: "failed", error: "edge_invoke_failed", note: error.message };
  }
  return (data ?? { ok: false, status: "failed", error: "empty_response" }) as PollRoadmapStoryRunResponse;
}

export interface RunRoadmapStoryWithPollingOpts {
  pollIntervalMs?: number;
  maxWaitMs?: number;
  onQueued?: (q: GenerateRoadmapStoryDraftQueued) => void;
  onProgress?: (p: PollRoadmapStoryRunResponse) => void;
}

export type RunRoadmapStoryResult =
  | { ok: true; ai_run_id: string; story_pack_version_id: string | null }
  | { ok: false; error: string; note?: string | null; ai_run_id?: string | null };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runRoadmapStoryWithPolling(
  input: GenerateRoadmapStoryDraftInput,
  opts?: RunRoadmapStoryWithPollingOpts,
): Promise<RunRoadmapStoryResult> {
  const start = await generateRoadmapStoryDraft(input);
  if (start.ok !== true) {
    return { ok: false, error: start.error, note: start.note ?? null, ai_run_id: start.ai_run_id ?? null };
  }
  opts?.onQueued?.(start);
  const intervalMs = opts?.pollIntervalMs ?? 4000;
  const maxWaitMs = opts?.maxWaitMs ?? 15 * 60 * 1000;
  const startedAt = Date.now();
  while (true) {
    if (Date.now() - startedAt > maxWaitMs) {
      return { ok: false, error: "polling_timeout", ai_run_id: start.ai_run_id };
    }
    await sleep(intervalMs);
    const p = await pollRoadmapStoryRun(start.ai_run_id);
    opts?.onProgress?.(p);
    if (p.status === "in_progress") continue;
    if (p.status === "completed") {
      return { ok: true, ai_run_id: start.ai_run_id, story_pack_version_id: p.story_pack_version_id ?? null };
    }
    return { ok: false, error: p.error ?? "generation_failed", note: p.note ?? null, ai_run_id: start.ai_run_id };
  }
}

// Latest decrypted Story Pack version content (owner-only RPC).
export interface RoadmapStoryDraftStructured {
  title?: string | null;
  executiveSummary?: string | null;
  sections?: Array<{ heading?: string | null; body?: string | null; evidenceRefs?: string[] }>;
  attentionItems?: Array<{ title?: string | null; detail?: string | null; evidenceRefs?: string[] }>;
  sourceLimitations?: string[];
  evidenceSummary?: string[];
  _format?: string;
}

export interface RoadmapStoryPackLatestVersionContent {
  id: string;
  version_number: number;
  status: "draft" | "final" | "archived";
  created_at: string;
  created_by: string;
  source_manifest: Record<string, unknown>;
  model_metadata: Record<string, unknown>;
  story_json: string | null;
  story?: RoadmapStoryDraftStructured | null;
}

export async function getLatestRoadmapStoryPackVersionContent(
  storyPackId: string,
): Promise<RoadmapStoryPackLatestVersionContent | null> {
  const { data, error } = await supabase.rpc(
    "get_latest_roadmap_story_pack_version_content" as never,
    { _story_pack_id: storyPackId } as never,
  );
  if (error) throw error;
  if (!data) return null;
  const raw = data as RoadmapStoryPackLatestVersionContent;
  let parsed: RoadmapStoryDraftStructured | null = null;
  if (raw.story_json) {
    try { parsed = JSON.parse(raw.story_json) as RoadmapStoryDraftStructured; }
    catch { parsed = null; }
  }
  return { ...raw, story: parsed };
}

// 6B.6c — Per-version generation transparency. Returns decrypted prompt
// text, source snapshot, raw model response, parsed story JSON, and AI
// run metadata. Owner-only via SECURITY DEFINER RPC.
export interface RoadmapStoryPackVersionDebug {
  version: {
    id: string;
    story_pack_id: string;
    version_number: number;
    status: "draft" | "final" | "archived";
    created_at: string;
    created_by: string;
    source_manifest: Record<string, unknown>;
    model_metadata: Record<string, unknown>;
    story_json: string | null;
    source_snapshot: string | null;
  };
  ai_run: null | {
    id: string;
    status: string;
    provider: string | null;
    model: string | null;
    reasoning_effort: string | null;
    feature_key: string | null;
    input_manifest: Record<string, unknown>;
    started_at: string;
    completed_at: string | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
    prompt_text: string | null;
    raw_response: string | null;
    openai_response_id?: string | null;
    files_selected_count?: number;
    files_sent_count?: number;
    files_skipped_count?: number;
    total_bytes_sent?: number;
  };
  files?: Array<{
    id: string;
    ai_run_id: string;
    story_pack_id: string;
    external_file_id: string | null;
    attachment_alias: string;
    status: string;
    input_kind: string;
    file_extension: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    sha256: string | null;
    skip_reason: string | null;
    created_at: string;
  }>;
}

export async function getRoadmapStoryPackVersionDebug(
  versionId: string,
): Promise<RoadmapStoryPackVersionDebug | null> {
  const { data, error } = await supabase.rpc(
    "get_roadmap_story_pack_version_debug" as never,
    { _version_id: versionId } as never,
  );
  if (error) throw error;
  if (!data) return null;
  return data as RoadmapStoryPackVersionDebug;
}


