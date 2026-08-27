// Phase 6B.7b — Polls the presentation Responses run created by
// `generate-roadmap-story-presentation`, then validates the parsed
// blueprint and persists everything encrypted via owner-only RPCs.
//
// 4D.14A.8D.2C — cut over to the Tenant AI Responses transport, with
// provider pinning: the runtime is resolved for the provider/model
// recorded on the run at creation time so a Tenant provider switch
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
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function safeMsg(e: unknown, max = 500): string {
  const s = e instanceof Error ? e.message : (typeof e === "string" ? e : JSON.stringify(e ?? ""));
  return String(s).slice(0, max);
}

// Duplicate a minimal validation surface here: the Edge Function must
// not import from src/. We only need to know that the payload parses to
// a plausible object; the full sanitisation runs client-side before
// render. This server-side is_valid is a coarse gate for storage.
function coarseValidate(parsed: unknown): { isValid: boolean; note: string } {
  if (!parsed || typeof parsed !== "object") return { isValid: false, note: "not_object" };
  const p = parsed as Record<string, unknown>;
  if (p.schemaVersion !== "roadmap_story_presentation_v1") return { isValid: false, note: "bad_schema_version" };
  if (p.templateId !== "steerco_briefing_v1") return { isValid: false, note: "bad_template_id" };
  if (!Array.isArray(p.blocks) || p.blocks.length === 0) return { isValid: false, note: "no_blocks" };
  return { isValid: true, note: "ok" };
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

    const { data: statusData, error: statusErr } = await userClient.rpc(
      "get_roadmap_story_presentation_run_status",
      { _run_id: body.aiRunId },
    );
    if (statusErr) {
      const m = String(statusErr.message ?? "").toLowerCase();
      if (m.includes("forbidden") || m.includes("42501")) return json(403, { ok: false, error: "forbidden" });
      return json(500, { ok: false, error: "status_lookup_failed", note: safeMsg(statusErr) });
    }
    const run = statusData as {
      id: string; story_pack_id: string; status: string;
      openai_response_id: string | null; is_valid: boolean | null;
      provider: string | null; model: string | null;
      error_text: string | null;
    } | null;
    if (!run) return json(404, { ok: false, error: "ai_run_not_found" });

    if (run.status === "succeeded") {
      return json(200, { ok: true, status: "completed", ai_run_id: run.id, is_valid: run.is_valid ?? false });
    }
    if (run.status === "failed" || run.status === "cancelled") {
      return json(200, {
        ok: false, status: run.status, ai_run_id: run.id,
        error: run.status === "failed" ? "openai_request_failed" : "cancelled",
        note: run.error_text ?? null,
      });
    }
    if (!run.openai_response_id) {
      return json(200, { ok: true, status: "in_progress", ai_run_id: run.id });
    }

    // Non-terminal: resolve the runtime pinned to the provider/model
    // recorded when the run was created. Failure MUST NOT mutate the run.
    if (run.provider !== "openai" && run.provider !== "azure_openai") {
      return json(200, {
        ok: false, error: "ai_provider_configuration_unavailable",
        note: "AI provider configuration is temporarily unavailable.",
        ai_run_id: run.id,
      });
    }
    if (!run.model || typeof run.model !== "string") {
      return json(200, {
        ok: false, error: "ai_model_mapping_missing",
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
          ok: false, error: "ai_provider_configuration_unavailable",
          note: "AI provider configuration is temporarily unavailable.",
          ai_run_id: run.id,
        });
      }
      const cfg = cfgData as { pack?: { organization_id?: string } } | null;
      if (!cfg?.pack?.organization_id) {
        return json(200, {
          ok: false, error: "ai_provider_configuration_unavailable",
          note: "AI provider configuration is temporarily unavailable.",
          ai_run_id: run.id,
        });
      }
      runtime = await resolveTenantAiTextRuntimeForProvider({
        organizationId: cfg.pack.organization_id,
        canonicalModel: run.model,
        provider: pinnedProvider,
        action: "real_integration",
        functionName: "poll-roadmap-story-presentation",
        reason: "roadmap-story-presentation-poll",
        requestId: crypto.randomUUID(),
      });
    } catch (e) {
      const safe = toSafeTenantAiTextRuntimePublicError(e);
      return json(200, { ok: false, error: safe.error, note: safe.note, ai_run_id: run.id });
    }

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
      await userClient.rpc("fail_roadmap_story_presentation_run", {
        _run_id: run.id, _error_text: errCategory,
      });
      return json(502, { ok: false, status: "failed", ai_run_id: run.id,
        error: "openai_request_failed", note: errCategory });
    }

    // completed: parse + coarse-validate, then persist.
    const rawText = extractResponseText(poll.body) ?? "";
    const parsed = tryParseStructuredJson(rawText);
    const { isValid, note } = coarseValidate(parsed);
    const parsedJson = parsed ? JSON.stringify(parsed) : "";
    const validationJson = JSON.stringify({ isValid, note, at: new Date().toISOString() });

    const usage = (poll.body as { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } }).usage ?? {};
    const modelMetadata = {
      provider: runtime.provider,
      model: runtime.canonicalModel,
      response_id: run.openai_response_id,
      generated_at: new Date().toISOString(),
      prompt_version: "roadmap_story_presentation_v1",
      long_running: true,
    };

    const { error: completeErr } = await userClient.rpc(
      "complete_roadmap_story_presentation_run",
      {
        _run_id: run.id,
        _raw_output_text: rawText,
        _parsed_blueprint_json: parsedJson,
        _validation_json: validationJson,
        _is_valid: isValid,
        _model_metadata: modelMetadata as unknown as Record<string, unknown>,
        _prompt_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
        _completion_tokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
        _total_tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
      },
    );
    if (completeErr) {
      await userClient.rpc("fail_roadmap_story_presentation_run", {
        _run_id: run.id, _error_text: `persistence failed: ${safeMsg(completeErr)}`,
      });
      return json(500, { ok: false, status: "failed", error: "run_persist_failed",
        note: safeMsg(completeErr), ai_run_id: run.id });
    }
    return json(200, { ok: true, status: "completed", ai_run_id: run.id, is_valid: isValid });
  } catch (e) {
    console.log("poll_roadmap_story_presentation_unhandled", { message: safeMsg(e) });
    return json(500, { ok: false, status: "failed", error: "internal_error", note: safeMsg(e) });
  }
});
