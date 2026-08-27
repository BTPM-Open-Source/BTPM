/**
 * Phase 6B.7b — React hook for the second AI pass (Presentation Blueprint).
 *
 * - `useLatestAiPresentationBlueprint`: fetch the latest validated
 *   blueprint (owner-only RPC).
 * - `useGeneratePresentationBlueprint`: orchestrate the background
 *   Responses API flow with polling.
 * - `useAiPresentationBlueprintDebug`: fetch full transparency payload.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  buildBlueprintInputPackage,
  buildBlueprintSystemPrompt,
  type BlueprintInputDraft,
} from "@/lib/roadmap-story/roadmapStoryPresentationBlueprintInput";
import {
  tryParseAiBlueprintJson,
  validateAiRoadmapStoryPresentationBlueprint,
} from "@/lib/roadmap-story/roadmapStoryPresentationBlueprintValidation";
import type {
  AiBlueprintValidationResult,
  AiRoadmapStoryPresentationBlueprint,
} from "@/lib/roadmap-story/roadmapStoryPresentationBlueprintSchema";

const LATEST_KEY = (id: string | null | undefined) =>
  ["roadmap-story-presentation-blueprint-latest", id ?? "none"] as const;

const DEBUG_KEY = (id: string | null | undefined) =>
  ["roadmap-story-presentation-blueprint-debug", id ?? "none"] as const;

export interface LatestAiBlueprintResponse {
  run_id: string;
  story_pack_version_id: string | null;
  model: string | null;
  provider: string | null;
  model_metadata: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
  blueprint_json: string | null;
  validation_json: string | null;
}

export interface LatestAiBlueprintValidated {
  runId: string;
  storyPackVersionId: string | null;
  model: string | null;
  provider: string | null;
  createdAt: string;
  completedAt: string | null;
  modelMetadata: Record<string, unknown>;
  validation: AiBlueprintValidationResult;
  blueprint: AiRoadmapStoryPresentationBlueprint | null;
}

export function useLatestAiPresentationBlueprint(storyPackId: string | null | undefined) {
  return useQuery<LatestAiBlueprintValidated | null>({
    queryKey: LATEST_KEY(storyPackId),
    enabled: !!storyPackId,
    staleTime: 5_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_latest_roadmap_story_presentation_blueprint" as never,
        { _story_pack_id: storyPackId as string } as never,
      );
      if (error) throw error;
      if (!data) return null;
      const row = data as unknown as LatestAiBlueprintResponse;
      const parsed = tryParseAiBlueprintJson(row.blueprint_json);
      const validation = validateAiRoadmapStoryPresentationBlueprint(parsed);
      return {
        runId: row.run_id,
        storyPackVersionId: row.story_pack_version_id,
        model: row.model,
        provider: row.provider,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        modelMetadata: row.model_metadata ?? {},
        validation,
        blueprint: validation.blueprint,
      };
    },
  });
}

export interface AiBlueprintDebugPayload {
  id: string;
  status: string;
  is_valid: boolean | null;
  provider: string | null;
  model: string | null;
  reasoning_effort: string | null;
  openai_response_id: string | null;
  input_manifest: Record<string, unknown>;
  model_metadata: Record<string, unknown>;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  prompt_text: string | null;
  input_package: string | null;
  raw_response: string | null;
  parsed_blueprint: string | null;
  validation_json: string | null;
  error_text: string | null;
}

export function useAiPresentationBlueprintDebug(runId: string | null | undefined, enabled = true) {
  return useQuery<AiBlueprintDebugPayload | null>({
    queryKey: DEBUG_KEY(runId),
    enabled: !!runId && enabled,
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_roadmap_story_presentation_debug" as never,
        { _run_id: runId as string } as never,
      );
      if (error) throw error;
      return (data as unknown as AiBlueprintDebugPayload) ?? null;
    },
  });
}

export interface GenerateAiBlueprintInput {
  storyPackId: string;
  storyPackVersionId: string;
  draft: BlueprintInputDraft;
  sourceSnapshot: unknown | null;
  fileManifestSummary: {
    included_count?: number; sent_count?: number; skipped_count?: number;
    total_bytes_sent?: number; files?: Array<Record<string, unknown>>;
  } | null;
  deterministicBlockTypes?: string[];
  visualSettings?: import(
    "@/lib/roadmap-story/roadmapStoryVisualSettings"
  ).RoadmapStoryVisualSettings | null;
}

interface StartResponse {
  ok: boolean; status?: string;
  ai_run_id?: string; openai_response_id?: string;
  model?: string; provider?: string;
  error?: string; note?: string;
}

interface PollResponse {
  ok: boolean;
  status: "in_progress" | "completed" | "failed" | "cancelled";
  ai_run_id?: string;
  is_valid?: boolean;
  error?: string; note?: string | null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type GenerateAiBlueprintResult =
  | { ok: true; ai_run_id: string; is_valid: boolean }
  | { ok: false; error: string; note?: string | null; ai_run_id?: string | null };

export function useGeneratePresentationBlueprint(storyPackId: string) {
  const qc = useQueryClient();
  return useMutation<GenerateAiBlueprintResult, Error, GenerateAiBlueprintInput>({
    mutationFn: async (input) => {
      const inputPackage = buildBlueprintInputPackage({
        draft: input.draft,
        sourceSnapshot: input.sourceSnapshot,
        fileManifestSummary: input.fileManifestSummary,
        deterministicBlockTypes: input.deterministicBlockTypes,
        visualSettings: input.visualSettings ?? null,
      });
      const systemPrompt = buildBlueprintSystemPrompt();
      const { data, error } = await supabase.functions.invoke(
        "generate-roadmap-story-presentation",
        {
          body: {
            storyPackId: input.storyPackId,
            storyPackVersionId: input.storyPackVersionId,
            systemPrompt,
            inputPackage,
          },
        },
      );
      if (error) return { ok: false, error: "edge_invoke_failed", note: error.message };
      const start = (data ?? {}) as StartResponse;
      if (!start.ok || !start.ai_run_id) {
        return { ok: false, error: start.error ?? "start_failed", note: start.note ?? null };
      }
      const runId = start.ai_run_id;
      const intervalMs = 4000;
      const maxWaitMs = 10 * 60 * 1000;
      const startedAt = Date.now();
      while (true) {
        if (Date.now() - startedAt > maxWaitMs) {
          return { ok: false, error: "polling_timeout", ai_run_id: runId };
        }
        await sleep(intervalMs);
        const { data: pdata, error: perr } = await supabase.functions.invoke(
          "poll-roadmap-story-presentation",
          { body: { aiRunId: runId } },
        );
        if (perr) return { ok: false, error: "poll_invoke_failed", note: perr.message, ai_run_id: runId };
        const p = (pdata ?? {}) as PollResponse;
        if (p.status === "in_progress") continue;
        if (p.status === "completed") return { ok: true, ai_run_id: runId, is_valid: p.is_valid ?? false };
        return { ok: false, error: p.error ?? "generation_failed", note: p.note ?? null, ai_run_id: runId };
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: LATEST_KEY(storyPackId) });
    },
  });
}
