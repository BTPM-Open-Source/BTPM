// Phase 6B.6d — Roadmap Story Pack background generation polling.
//
// Frontend calls this repeatedly with `ai_run_id` until status is no
// longer `in_progress`. Owner-only via SECURITY DEFINER RPCs; never
// exposes encrypted columns. On `completed`, persists the new Story
// Pack version via `complete_roadmap_story_generation_run`.
//
// 4D.14A.8D.2B — polling resolves the Tenant AI runtime pinned to the
// provider recorded at run creation, so a Tenant provider switch
// mid-flight does not misroute a background poll.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import {
  extractResponseText,
  tryParseStructuredJson,
} from "../_shared/openai-responses.ts";
import {
  resolveTenantAiTextRuntimeForProvider,
  toSafeTenantAiTextRuntimePublicError,
  type TenantAiTextProvider,
} from "../_shared/tenantAiTextRuntime.ts";
import { getTenantAiResponseStatus } from "../_shared/tenantAiResponsesClient.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeMsg(e: unknown, max = 500): string {
  const s = e instanceof Error ? e.message : String(e ?? "");
  return s.slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { ok: false, error: "unauthorized" });

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    try {
      const verifier = createSupabaseTokenVerifier(userClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json(401, { ok: false, error: "unauthorized" });

    const body = await req.json().catch(() => null) as { aiRunId?: string } | null;
    if (!body?.aiRunId) return json(400, { ok: false, error: "invalid_request", note: "aiRunId required" });

    // Read current run status (owner-only).
    const { data: statusData, error: statusErr } = await userClient.rpc(
      "get_roadmap_story_pack_ai_run_status",
      { _run_id: body.aiRunId },
    );
    if (statusErr) {
      const m = String(statusErr.message ?? "").toLowerCase();
      if (m.includes("forbidden") || m.includes("42501")) return json(403, { ok: false, error: "forbidden" });
      return json(500, { ok: false, error: "status_lookup_failed", note: safeMsg(statusErr) });
    }
    const run = statusData as {
      id: string;
      story_pack_id: string;
      story_pack_version_id: string | null;
      status: string;
      openai_response_id: string | null;
      provider: string | null;
      model: string | null;
      error_text: string | null;
    } | null;
    if (!run) return json(404, { ok: false, error: "ai_run_not_found" });

    // Terminal states short-circuit.
    if (run.status === "succeeded") {
      return json(200, {
        ok: true,
        status: "completed",
        ai_run_id: run.id,
        story_pack_version_id: run.story_pack_version_id,
      });
    }
    if (run.status === "failed" || run.status === "cancelled") {
      return json(200, {
        ok: false,
        status: run.status,
        ai_run_id: run.id,
        error: run.status === "failed" ? "openai_request_failed" : "cancelled",
        note: run.error_text ?? null,
      });
    }
    if (!run.openai_response_id) {
      // Not yet enqueued (rare race). Tell client to keep polling.
      return json(200, { ok: true, status: "in_progress", ai_run_id: run.id });
    }

    // Non-terminal: resolve the runtime pinned to the provider recorded
    // when the run was created. Failure MUST NOT mutate the run.
    if (run.provider !== "openai" && run.provider !== "azure_openai") {
      return json(200, {
        ok: false,
        error: "ai_provider_configuration_unavailable",
        note: "AI provider configuration is temporarily unavailable.",
        ai_run_id: run.id,
      });
    }
    if (!run.model || typeof run.model !== "string") {
      return json(200, {
        ok: false,
        error: "ai_model_mapping_missing",
        note: "The selected AI model is not mapped for the active provider.",
        ai_run_id: run.id,
      });
    }
    const pinnedProvider = run.provider as TenantAiTextProvider;

    let runtime: Awaited<ReturnType<typeof resolveTenantAiTextRuntimeForProvider>>;
    try {
      const { data: cfgData, error: cfgErr } = await userClient.rpc(
        "get_roadmap_story_pack_config",
        { _story_pack_id: run.story_pack_id },
      );
      if (cfgErr) {
        const m = String(cfgErr.message ?? "").toLowerCase();
        if (m.includes("forbidden") || m.includes("42501")) return json(403, { ok: false, error: "forbidden" });
        return json(200, {
          ok: false,
          error: "ai_provider_configuration_unavailable",
          note: "AI provider configuration is temporarily unavailable.",
          ai_run_id: run.id,
        });
      }
      const cfg = cfgData as { pack?: { organization_id?: string } } | null;
      if (!cfg?.pack?.organization_id) {
        return json(200, {
          ok: false,
          error: "ai_provider_configuration_unavailable",
          note: "AI provider configuration is temporarily unavailable.",
          ai_run_id: run.id,
        });
      }
      runtime = await resolveTenantAiTextRuntimeForProvider({
        organizationId: cfg.pack.organization_id,
        canonicalModel: run.model,
        provider: pinnedProvider,
        action: "real_integration",
        functionName: "poll-roadmap-story",
        reason: "roadmap-story-poll",
        requestId: crypto.randomUUID(),
      });
    } catch (e) {
      const safe = toSafeTenantAiTextRuntimePublicError(e);
      return json(200, { ok: false, error: safe.error, note: safe.note, ai_run_id: run.id });
    }

    // Poll provider through the Tenant AI Responses transport.
    const poll = await getTenantAiResponseStatus({
      runtime,
      responseId: run.openai_response_id,
    });
    if (!poll.ok) {
      // Transport failure: keep polling; do not mutate the run.
      return json(200, { ok: true, status: "in_progress", ai_run_id: run.id, note: poll.category });
    }
    if (poll.state === "queued" || poll.state === "in_progress" || poll.state === "unknown") {
      return json(200, { ok: true, status: "in_progress", ai_run_id: run.id, openai_state: poll.state });
    }
    if (poll.state === "failed" || poll.state === "cancelled" || poll.state === "incomplete") {
      const errCategory = poll.state;
      await userClient.rpc("fail_roadmap_story_generation_run", {
        _run_id: run.id,
        _error_text: errCategory,
      });
      return json(502, {
        ok: false,
        status: "failed",
        ai_run_id: run.id,
        error: "openai_request_failed",
        note: errCategory,
      });
    }

    // state === "completed": parse, persist version. `poll.body` is
    // guaranteed non-null only on completed state, but a completed
    // response with an empty body is treated as an empty output.
    if (!poll.body) {
      await userClient.rpc("fail_roadmap_story_generation_run", {
        _run_id: run.id,
        _error_text: "response_empty",
      });
      return json(502, { ok: false, status: "failed", error: "openai_response_empty", ai_run_id: run.id });
    }
    const storyText = extractResponseText(poll.body);
    if (!storyText) {
      await userClient.rpc("fail_roadmap_story_generation_run", {
        _run_id: run.id,
        _error_text: "response_empty",
      });
      return json(502, { ok: false, status: "failed", error: "openai_response_empty", ai_run_id: run.id });
    }

    const parsed = tryParseStructuredJson(storyText);
    let storyJsonText: string;
    if (parsed && typeof parsed === "object") {
      storyJsonText = JSON.stringify(parsed);
    } else {
      storyJsonText = JSON.stringify({
        title: null,
        executiveSummary: storyText.slice(0, 2000),
        sections: [{ heading: "Draft", body: storyText, evidenceRefs: [] }],
        attentionItems: [],
        sourceLimitations: [],
        evidenceSummary: [],
        _format: "fallback_markdown",
      });
    }

    const usage = (poll.body as { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } }).usage ?? {};
    const modelMetadata = {
      provider: runtime.provider,
      model: runtime.canonicalModel,
      response_id: run.openai_response_id,
      generated_at: new Date().toISOString(),
      prompt_version: "roadmap_story_v2_files",
      raw_response_format: storyJsonText.includes('"_format":"fallback_markdown"') ? "fallback_markdown" : "json",
      long_running: true,
    };

    const { data: versionIdData, error: completeErr } = await userClient.rpc(
      "complete_roadmap_story_generation_run",
      {
        _run_id: run.id,
        _story_json: storyJsonText,
        _source_snapshot_json: "",
        _source_manifest: {} as unknown as Record<string, unknown>,
        _model_metadata: modelMetadata as unknown as Record<string, unknown>,
        _prompt_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
        _completion_tokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
        _total_tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
        _raw_output_text: storyText,
      },
    );
    if (completeErr) {
      await userClient.rpc("fail_roadmap_story_generation_run", {
        _run_id: run.id,
        _error_text: `persistence failed: ${safeMsg(completeErr)}`,
      });
      return json(500, {
        ok: false,
        status: "failed",
        error: "version_persist_failed",
        note: safeMsg(completeErr),
        ai_run_id: run.id,
      });
    }

    return json(200, {
      ok: true,
      status: "completed",
      ai_run_id: run.id,
      story_pack_version_id: versionIdData as unknown as string,
    });
  } catch (e) {
    console.log("poll_roadmap_story_unhandled", { message: safeMsg(e) });
    return json(500, { ok: false, status: "failed", error: "internal_error", note: safeMsg(e) });
  }
});
