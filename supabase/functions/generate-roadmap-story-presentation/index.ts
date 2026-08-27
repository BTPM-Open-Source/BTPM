// Phase 6B.7b — Roadmap Story Pack Presentation Blueprint AI run.
//
// Second AI step. Reads the latest Story Draft version for the pack,
// builds a bounded blueprint input package, and enqueues a background
// Responses call via the Tenant AI transport. Encrypted prompt +
// input package persisted via SECURITY DEFINER RPCs. Owner-only.
//
// 4D.14A.8D.2C — cut over from the OpenAI-only runtime/helpers to the
// canonical Tenant AI text runtime (OpenAI or Azure OpenAI) and the
// Tenant Responses transport.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import {
  resolveTenantAiTextRuntime,
  toSafeTenantAiTextRuntimePublicError,
} from "../_shared/tenantAiTextRuntime.ts";
import { enqueueTenantAiResponse } from "../_shared/tenantAiResponsesClient.ts";
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
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_INPUT_BYTES = 900_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function safeMsg(e: unknown, max = 500): string {
  const s = e instanceof Error ? e.message : (typeof e === "string" ? e : JSON.stringify(e ?? ""));
  return String(s).slice(0, max);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  let aiRunId: string | null = null;
  let userClient: ReturnType<typeof createClient> | null = null;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { ok: false, error: "unauthorized" });

    userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    try {
      const verifier = createSupabaseTokenVerifier(userClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json(401, { ok: false, error: "unauthorized" });

    const body = await req.json().catch(() => null) as
      | { storyPackId?: string; storyPackVersionId?: string; systemPrompt?: string; inputPackage?: unknown }
      | null;
    if (!body || typeof body.storyPackId !== "string" || typeof body.storyPackVersionId !== "string") {
      return json(400, { ok: false, error: "invalid_request", note: "storyPackId + storyPackVersionId required" });
    }
    if (!body.systemPrompt || typeof body.systemPrompt !== "string") {
      return json(400, { ok: false, error: "invalid_request", note: "systemPrompt required" });
    }
    if (!body.inputPackage || typeof body.inputPackage !== "object") {
      return json(400, { ok: false, error: "invalid_request", note: "inputPackage required" });
    }

    const inputJson = JSON.stringify(body.inputPackage);
    if (inputJson.length > MAX_INPUT_BYTES) {
      return json(413, { ok: false, error: "input_package_too_large",
        note: `Input package exceeds ${Math.round(MAX_INPUT_BYTES / 1024)} KB.` });
    }

    // Owner check + pack lookup.
    const { data: cfgData, error: cfgErr } = await userClient.rpc(
      "get_roadmap_story_pack_config",
      { _story_pack_id: body.storyPackId },
    );
    if (cfgErr) {
      const m = String(cfgErr.message ?? "").toLowerCase();
      if (m.includes("forbidden") || m.includes("42501")) return json(403, { ok: false, error: "forbidden" });
      return json(500, { ok: false, error: "pack_lookup_failed", note: safeMsg(cfgErr) });
    }
    const cfg = cfgData as { pack?: { organization_id?: string; status?: string } } | null;
    if (!cfg?.pack?.organization_id) return json(404, { ok: false, error: "story_pack_not_found" });
    if (cfg.pack.status === "archived") return json(409, { ok: false, error: "story_pack_archived" });
    const orgId = cfg.pack.organization_id;

    // Resolve AI settings (reuse `roadmap_story` feature key). Only require
    // enabled + an active canonical registry model. Provider comes from the
    // Tenant AI runtime (OpenAI or Azure OpenAI), not the feature setting.
    const { data: settingRow, error: settingErr } = await admin
      .from("ai_feature_settings")
      .select("enabled, reasoning_effort, ai_model_registry:model_registry_id(model_id, active)")
      .eq("organization_id", orgId)
      .eq("feature_key", "roadmap_story")
      .maybeSingle();
    if (settingErr) return json(500, { ok: false, error: "roadmap_story_ai_not_configured", note: safeMsg(settingErr) });
    if (!settingRow) return json(200, { ok: false, error: "roadmap_story_ai_not_configured" });
    if (!(settingRow as { enabled?: boolean }).enabled) return json(200, { ok: false, error: "roadmap_story_ai_disabled" });
    const reg = (settingRow as { ai_model_registry?: { model_id?: string; active?: boolean } }).ai_model_registry;
    if (!reg?.model_id || !reg.active) {
      return json(200, { ok: false, error: "roadmap_story_ai_not_configured", note: "model inactive or invalid" });
    }
    const modelId = reg.model_id;
    const reasoningEffort = (settingRow as { reasoning_effort?: string | null }).reasoning_effort ?? null;

    // Resolve Tenant AI text runtime BEFORE creating the presentation
    // run, persisting encrypted prompt/input package, or making any
    // provider call.
    let runtime: Awaited<ReturnType<typeof resolveTenantAiTextRuntime>>;
    try {
      runtime = await resolveTenantAiTextRuntime({
        organizationId: orgId,
        canonicalModel: modelId,
        action: "external_api_write",
        functionName: "generate-roadmap-story-presentation",
        reason: "roadmap-story-presentation-generate",
        requestId: crypto.randomUUID(),
      });
    } catch (e) {
      const safe = toSafeTenantAiTextRuntimePublicError(e);
      return json(200, { ok: false, error: safe.error, note: safe.note });
    }

    const inputManifest = {
      schema_version: "roadmap_story_presentation_v1",
      prompt_version: "roadmap_story_presentation_v1",
      model: runtime.canonicalModel,
      provider: runtime.provider,
      reasoning_effort: reasoningEffort,
      input_bytes: inputJson.length,
      source_version_id: body.storyPackVersionId,
    };

    const { data: runIdData, error: startErr } = await userClient.rpc(
      "start_roadmap_story_presentation_run",
      {
        _story_pack_id: body.storyPackId,
        _story_pack_version_id: body.storyPackVersionId,
        _provider: runtime.provider,
        _model: runtime.canonicalModel,
        _reasoning_effort: reasoningEffort,
        _input_manifest: inputManifest as unknown as Record<string, unknown>,
        _prompt: body.systemPrompt,
        _input_package_json: inputJson,
      },
    );
    if (startErr) {
      const m = String(startErr.message ?? "").toLowerCase();
      if (m.includes("archived")) return json(409, { ok: false, error: "story_pack_archived" });
      if (m.includes("forbidden") || m.includes("42501")) return json(403, { ok: false, error: "forbidden" });
      return json(500, { ok: false, error: "run_start_failed", note: safeMsg(startErr) });
    }
    aiRunId = runIdData as unknown as string;

    // Enqueue via the Tenant AI Responses transport. `model`,
    // `background` and `store` are forced by the transport from
    // `runtime.providerModel` — never include `model` in the payload.
    const enqueuePayload: Record<string, unknown> = {
      instructions: body.systemPrompt,
      input: [{
        role: "user",
        content: [{
          type: "input_text",
          text: "BTPM Roadmap Story Pack presentation blueprint input package (JSON):\n\n" + inputJson,
        }],
      }],
    };
    if (reasoningEffort) enqueuePayload.reasoning = { effort: reasoningEffort };

    let enqueue = await enqueueTenantAiResponse({ runtime, payload: enqueuePayload });
    if (!enqueue.ok && enqueue.category === "request_rejected" && enqueuePayload.reasoning) {
      delete enqueuePayload.reasoning;
      enqueue = await enqueueTenantAiResponse({ runtime, payload: enqueuePayload });
    }
    if (!enqueue.ok) {
      const errCategory = enqueue.category;
      await userClient.rpc("fail_roadmap_story_presentation_run", {
        _run_id: aiRunId, _error_text: errCategory,
      });
      return json(502, { ok: false, error: "openai_request_failed",
        note: errCategory, ai_run_id: aiRunId });
    }

    await userClient.rpc("set_roadmap_story_presentation_run_response_id", {
      _run_id: aiRunId, _openai_response_id: enqueue.responseId,
    });

    return json(202, {
      ok: true, status: "queued",
      ai_run_id: aiRunId,
      openai_response_id: enqueue.responseId,
      model: runtime.canonicalModel,
      provider: runtime.provider,
    });
  } catch (e) {
    console.log("generate_roadmap_story_presentation_unhandled", { message: safeMsg(e) });
    try {
      if (aiRunId && userClient) {
        await userClient.rpc("fail_roadmap_story_presentation_run", {
          _run_id: aiRunId, _error_text: safeMsg(e, 1500),
        });
      }
    } catch { /* swallow */ }
    return json(500, { ok: false, error: "internal_error", note: safeMsg(e) });
  }
});
