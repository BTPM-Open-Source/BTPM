// Phase 6B.6d — Roadmap Story Pack background generation.
//
// Server-side only. Authenticated owner of the Story Pack. Archived
// packs are rejected. Uses the OpenAI Responses API in BACKGROUND mode
// so this Edge Function returns quickly with a `resp_…` id and a
// `roadmap_story_ai_runs.id`. The browser then polls
// `poll-roadmap-story` until completion. This avoids the ~150 s Edge
// Function timeout for long reasoning runs and for runs that include
// linked SharePoint file contents.
//
// File-content handling reuses the canonical shared helpers in
// `_shared/graph-client.ts`, `_shared/openai-responses.ts`,
// `_shared/ai-file-context.ts` and `_shared/decision-case-ai/`. Linked
// SharePoint files are read ONLY when explicitly marked
// `include_in_story = true` on the Story Pack; no folder crawling, no
// browser-side file reads, no persistence of file bytes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { resolveAndAcquireTenantMicrosoftGraph } from "../_shared/tenantMicrosoftGraphRuntime.ts";
import {
  buildAiFileContext,
  auditsForPersistence,
  DEFAULT_STORY_FILE_LIMITS,
  type AiFileRef,
} from "../_shared/ai-file-context.ts";
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

const MAX_SNAPSHOT_BYTES = 1_500_000; // ~1.5 MB serialized

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeMsg(e: unknown, max = 500): string {
  let s: string;
  if (e instanceof Error) {
    s = e.message;
  } else if (e && typeof e === "object") {
    const obj = e as Record<string, unknown>;
    // PostgrestError / Supabase error shape: { message, details, hint, code }
    const parts = [obj.message, obj.details, obj.hint, obj.code]
      .filter((v) => v !== undefined && v !== null && v !== "")
      .map((v) => String(v));
    s = parts.length > 0 ? parts.join(" | ") : JSON.stringify(e);
  } else {
    s = String(e ?? "");
  }
  return s.slice(0, max);
}

const PROMPT_VERSION = "roadmap_story_v2_files";

const SYSTEM_INSTRUCTIONS = [
  "You are the BTPM Roadmap Story Pack drafter.",
  "Goal: produce a concise executive narrative for a portfolio/roadmap update — not a status dump.",
  "",
  "Strict rules:",
  "- Use ONLY the provided source package and the attached evidence files (if any). Do not invent facts.",
  "- Distinguish structured BTPM source facts from file-derived evidence. Tag claims sourced from files with [file:<displayName>].",
  "- Cite key claims to source categories using short tags like [risks], [governance], [planning], [kpis], [team_work], [progress], [overview], [files], [notes].",
  "- Mention coverage limitations whenever the relevant source is missing, partial, or unavailable.",
  "- Do NOT claim that discussions/comments were analyzed. This source is currently unavailable.",
  "- Do NOT claim that a file was read if the file context manifest marks it as skipped or unsupported. Use only files actually attached as input.",
  "- Keep the output focused and useful. Prefer specificity over generic phrasing.",
  "- Each source item carries semantic detail fields (e.g. `detail`, `mitigation`, `decisionQuestion`). Prefer these over titles when summarising why a risk matters, what a blocker is blocking, what a decision requires, or what a delay implies.",
  "- When `detail.available` is false, the object has no description — describe it by title and known status only and do NOT infer hidden business context.",
  "- When `detail.truncated` is true, the description was cut to fit the bounded package — do NOT assume content beyond the visible text.",
  "- For risks: surface impact, likelihood, and mitigation when present. For blockers: surface what is blocked and any resolution context. For governance: surface the decision question / ask when present. For KPIs: respect `latestValueSource` precedence and do not invent trends.",
  "",
  "Output format: return ONLY a single JSON object, with no prose outside it and no markdown code fences. Shape:",
  "{",
  '  "title": string,',
  '  "executiveSummary": string,',
  '  "sections": [ { "heading": string, "body": string, "evidenceRefs": string[] } ],',
  '  "attentionItems": [ { "title": string, "detail": string, "evidenceRefs": string[] } ],',
  '  "sourceLimitations": string[],',
  '  "evidenceSummary": string[]',
  "}",
  "",
  "Suggested section headings (omit a section if no evidence supports it):",
  "  - Executive summary; What changed since the last update; Delivery / planning position;",
  "    Risks, blockers, and dependencies; KPI / governance signals; Team execution signals;",
  "    Decisions or attention needed; Source limitations; Evidence / source notes.",
  "",
  "If the evidence does not support a field, leave it empty rather than fabricating content.",
].join("\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  let aiRunId: string | null = null;
  let admin: ReturnType<typeof createClient> | null = null;
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

    admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json(401, { ok: false, error: "unauthorized" });

    const body = await req.json().catch(() => null) as
      | { storyPackId?: string; sourceSnapshot?: unknown; sourceManifest?: unknown }
      | null;
    if (!body || typeof body.storyPackId !== "string") {
      return json(400, { ok: false, error: "invalid_request", note: "storyPackId required" });
    }
    if (!body.sourceSnapshot || typeof body.sourceSnapshot !== "object") {
      return json(400, { ok: false, error: "invalid_request", note: "sourceSnapshot required" });
    }
    const snapshotJson = JSON.stringify(body.sourceSnapshot);
    if (snapshotJson.length > MAX_SNAPSHOT_BYTES) {
      return json(413, {
        ok: false,
        error: "source_package_too_large",
        note: `Source package exceeds ${Math.round(MAX_SNAPSHOT_BYTES / 1024)} KB.`,
      });
    }
    const sourceManifest = (body.sourceManifest && typeof body.sourceManifest === "object")
      ? body.sourceManifest as Record<string, unknown>
      : {};

    // Resolve owning org + status via owner-only RPC.
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

    // Resolve roadmap_story AI feature setting + model registry.
    const { data: settingRow, error: settingErr } = await admin
      .from("ai_feature_settings")
      .select(
        "enabled, reasoning_effort, ai_model_registry:model_registry_id(model_id, active)",
      )
      .eq("organization_id", orgId)
      .eq("feature_key", "roadmap_story")
      .maybeSingle();
    if (settingErr) {
      return json(500, { ok: false, error: "roadmap_story_ai_not_configured", note: safeMsg(settingErr) });
    }
    if (!settingRow) return json(200, { ok: false, error: "roadmap_story_ai_not_configured" });
    if (!(settingRow as { enabled?: boolean }).enabled) return json(200, { ok: false, error: "roadmap_story_ai_disabled" });
    const reg = (settingRow as { ai_model_registry?: { model_id?: string; active?: boolean } }).ai_model_registry;
    if (!reg?.model_id || !reg.active) {
      return json(200, { ok: false, error: "roadmap_story_ai_not_configured", note: "model inactive or invalid" });
    }
    const modelId = reg.model_id;
    const reasoningEffort = (settingRow as { reasoning_effort?: string | null }).reasoning_effort ?? null;

    // Resolve Tenant AI text runtime (active provider — OpenAI or Azure)
    // BEFORE any file download, AI-run creation, or provider call.
    let runtime: Awaited<ReturnType<typeof resolveTenantAiTextRuntime>>;
    try {
      runtime = await resolveTenantAiTextRuntime({
        organizationId: orgId,
        canonicalModel: modelId,
        action: "external_api_write",
        functionName: "generate-roadmap-story",
        reason: "roadmap-story-generate",
        requestId: crypto.randomUUID(),
      });
    } catch (e) {
      const safe = toSafeTenantAiTextRuntimePublicError(e);
      return json(200, { ok: false, error: safe.error, note: safe.note });
    }


    // Load included linked SharePoint files (owner-only RPC; decrypted).
    const { data: includedRaw, error: filesErr } = await userClient.rpc(
      "list_roadmap_story_pack_included_files",
      { _story_pack_id: body.storyPackId },
    );
    if (filesErr) {
      const m = String(filesErr.message ?? "").toLowerCase();
      if (m.includes("forbidden") || m.includes("42501")) return json(403, { ok: false, error: "forbidden" });
      return json(500, { ok: false, error: "files_lookup_failed", note: safeMsg(filesErr) });
    }
    type IncludedRow = {
      id: string;
      drive_id: string | null;
      item_id: string | null;
      display_name: string | null;
      web_url: string | null;
      mime_type: string | null;
      size_bytes: number | null;
      include_in_story: boolean;
    };
    const includedRows = (includedRaw ?? []) as IncludedRow[];
    const includedFiles = includedRows.filter((r) => r.include_in_story === true);

    // Resolve Tenant Microsoft Graph runtime + acquire token BEFORE
    // any file download, source-snapshot persistence, AI-run creation
    // or OpenAI call. Only resolve if Graph-backed files are included.
    let graphToken: string | null = null;
    if (includedFiles.length > 0) {
      const gr = await resolveAndAcquireTenantMicrosoftGraph({
        organizationId: orgId,
        functionName: "generate-roadmap-story",
        reason: "roadmap-story-source-read",
      });
      if (!gr.ok) {
        return json(200, { ok: false, ...gr.publicError });
      }
      graphToken = gr.accessToken;
    }
    // Build the file context. The shared helper does the Graph download
    // and enforces all bounds; it never persists bytes.

    const refs: AiFileRef[] = includedFiles.map((r) => ({
      id: r.id,
      driveId: r.drive_id,
      itemId: r.item_id,
      displayName: r.display_name,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
    }));
    const fileCtx = await buildAiFileContext({
      graphToken,
      files: refs,
      limits: DEFAULT_STORY_FILE_LIMITS,
      modelSupportsImages: true,
    });

    // Also record the not-included files as audits so the manifest is complete.
    const notIncludedAudits = includedRows
      .filter((r) => r.include_in_story === false)
      .map((r, i) => ({
        external_file_id: r.id,
        attachment_alias: `excluded_${String(i + 1).padStart(3, "0")}`,
        status: "not_included" as const,
        input_kind: "none" as const,
        file_extension: null,
        mime_type: r.mime_type,
        size_bytes: r.size_bytes,
        sha256: null,
        skip_reason: "User unchecked 'include in story' for this file.",
      }));

    const fileManifest = {
      included_count: includedFiles.length,
      sent_count: fileCtx.sentCount,
      skipped_count: fileCtx.skippedCount,
      excluded_count: notIncludedAudits.length,
      total_bytes_sent: fileCtx.totalBytesSent,
      limits: DEFAULT_STORY_FILE_LIMITS,
      files: fileCtx.audits.map((a) => ({
        attachment_alias: a.attachment_alias,
        display_name: a.display_name,
        status: a.status,
        input_kind: a.input_kind,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        file_extension: a.file_extension,
        skip_reason: a.skip_reason,
      })),
    };

    // Persist input manifest (which also includes the file manifest).
    const inputManifest = {
      ...(sourceManifest ?? {}),
      snapshot_bytes: snapshotJson.length,
      schema_version: "roadmap_story_v1",
      prompt_version: PROMPT_VERSION,
      model: runtime.canonicalModel,
      provider: runtime.provider,
      reasoning_effort: reasoningEffort,
      file_context: fileManifest,
      file_content_mode: fileCtx.sentCount > 0 ? "included" : "metadata_only",
    };

    const { data: runIdData, error: startErr } = await userClient.rpc(
      "start_roadmap_story_generation_run",
      {
        _story_pack_id: body.storyPackId,
        _provider: runtime.provider,
        _model: runtime.canonicalModel,
        _reasoning_effort: reasoningEffort,
        _input_manifest: inputManifest as unknown as Record<string, unknown>,
        _prompt_summary: SYSTEM_INSTRUCTIONS,
      },
    );
    if (startErr) {
      const m = String(startErr.message ?? "").toLowerCase();
      if (m.includes("archived")) return json(409, { ok: false, error: "story_pack_archived" });
      if (m.includes("forbidden") || m.includes("42501")) return json(403, { ok: false, error: "forbidden" });
      return json(500, { ok: false, error: "ai_run_start_failed", note: safeMsg(startErr) });
    }
    aiRunId = runIdData as unknown as string;

    // Attach the encrypted source snapshot to the run so polling can
    // persist it on completion (we won't have it in the poll request).
    const { error: attachErr } = await userClient.rpc("attach_roadmap_story_run_source_snapshot", {
      _run_id: aiRunId,
      _source_snapshot_json: snapshotJson,
    });
    if (attachErr) console.log("attach_roadmap_story_run_source_snapshot_failed", safeMsg(attachErr));

    // Persist file audits (including excluded + skipped) immediately so
    // the UI can show file readiness even while generation is running.
    const allAudits = [
      ...auditsForPersistence(fileCtx.audits),
      ...notIncludedAudits,
    ];
    if (allAudits.length > 0) {
      const { error: auditErr } = await userClient.rpc("record_roadmap_story_run_files", {
        _run_id: aiRunId,
        _files: allAudits as unknown as Record<string, unknown>[],
      });
      if (auditErr) console.log("record_roadmap_story_run_files_failed", safeMsg(auditErr));
    }

    // Build the user input content. The snapshot JSON first, then the
    // attached files (already audited above).
    const content: Array<Record<string, unknown>> = [
      {
        type: "input_text",
        text:
          "BTPM Roadmap Story Pack source snapshot (JSON). Treat this as the structured evidence.\n\n" +
          snapshotJson,
      },
      ...fileCtx.items,
    ];

    // Enqueue Responses API background call through the Tenant AI
    // transport. `model`, `background` and `store` are forced by the
    // transport from `runtime.providerModel`.
    const enqueuePayload: Record<string, unknown> = {
      instructions: SYSTEM_INSTRUCTIONS,
      input: [{ role: "user", content }],
    };
    if (reasoningEffort) enqueuePayload.reasoning = { effort: reasoningEffort };

    let enqueue = await enqueueTenantAiResponse({ runtime, payload: enqueuePayload });
    if (!enqueue.ok && enqueue.category === "request_rejected" && enqueuePayload.reasoning) {
      delete enqueuePayload.reasoning;
      enqueue = await enqueueTenantAiResponse({ runtime, payload: enqueuePayload });
    }
    if (!enqueue.ok) {
      const errCategory = enqueue.category;
      await userClient.rpc("fail_roadmap_story_generation_run", {
        _run_id: aiRunId,
        _error_text: errCategory,
      });
      return json(502, {
        ok: false,
        error: "openai_request_failed",
        note: errCategory,
        ai_run_id: aiRunId,
      });
    }

    // Bind the response id; flips the run row to status='running'.
    const { error: setErr } = await userClient.rpc("set_roadmap_story_run_response_id", {
      _run_id: aiRunId,
      _openai_response_id: enqueue.responseId,
      _files_selected_count: includedFiles.length,
      _files_sent_count: fileCtx.sentCount,
      _files_skipped_count: fileCtx.skippedCount,
      _total_bytes_sent: fileCtx.totalBytesSent,
    });
    if (setErr) console.log("set_roadmap_story_run_response_id_failed", safeMsg(setErr));

    return json(202, {
      ok: true,
      status: "queued",
      ai_run_id: aiRunId,
      openai_response_id: enqueue.responseId,
      model: runtime.canonicalModel,
      provider: runtime.provider,
      file_manifest: fileManifest,
    });
  } catch (e) {
    console.log("generate_roadmap_story_unhandled", { message: safeMsg(e) });
    try {
      if (aiRunId && userClient) {
        await userClient.rpc("fail_roadmap_story_generation_run", {
          _run_id: aiRunId,
          _error_text: safeMsg(e, 1500),
        });
      }
    } catch { /* swallow */ }
    return json(500, { ok: false, error: "internal_error", note: safeMsg(e) });
  }
});
