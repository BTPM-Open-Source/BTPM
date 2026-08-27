// AI.5/AI.6 — Polls a previously-enqueued background Responses run for a
// Decision Case AI brief, updates the audit row when finished, and
// returns the generated draft text to the client.
//
// 4D.14A.8D.3 — Polling resolves the Tenant AI runtime pinned to the
// provider recorded at run creation (`model_provider`), so a Tenant
// provider switch mid-flight does not misroute a background poll.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import {
  resolveTenantAiTextRuntimeForProvider,
  toSafeTenantAiTextRuntimePublicError,
  type TenantAiTextProvider,
} from "../_shared/tenantAiTextRuntime.ts";
import { getTenantAiResponseStatus } from "../_shared/tenantAiResponsesClient.ts";
import { extractResponseText } from "../_shared/openai-responses.ts";
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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// AI.7.2 — Structured brief parser (unchanged behavior).
export type StructuredBriefFields = {
  executive_intro_text: string | null;
  options_summary: string | null;
  recommendation_text: string | null;
  requested_decision_text: string | null;
  guardrails_text: string | null;
  residual_risks_text: string | null;
  open_questions_text: string | null;
  confidence_level: "high" | "medium" | "low" | null;
  decision_readiness:
    | "ready_for_decision"
    | "needs_clarification"
    | "not_ready"
    | null;
};

const EMPTY_STRUCTURED: StructuredBriefFields = {
  executive_intro_text: null,
  options_summary: null,
  recommendation_text: null,
  requested_decision_text: null,
  guardrails_text: null,
  residual_risks_text: null,
  open_questions_text: null,
  confidence_level: null,
  decision_readiness: null,
};

function coerceStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function coerceConfidence(v: unknown): StructuredBriefFields["confidence_level"] {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return t === "high" || t === "medium" || t === "low" ? t : null;
}

function coerceReadiness(v: unknown): StructuredBriefFields["decision_readiness"] {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return t === "ready_for_decision" || t === "needs_clarification" || t === "not_ready"
    ? t
    : null;
}

function stripJsonFences(raw: string): string {
  const t = raw.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  return t;
}

function extractFirstJsonObject(raw: string): string | null {
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

export function parseStructuredBrief(rawText: string): {
  draft_markdown: string;
  structured_fields: StructuredBriefFields;
  structured_parse_failed: boolean;
} {
  const fallback = (reason: string) => {
    console.log("decision_case_ai_brief_structured_parse_failed", { reason });
    return {
      draft_markdown: rawText,
      structured_fields: { ...EMPTY_STRUCTURED },
      structured_parse_failed: true,
    };
  };
  if (!rawText || typeof rawText !== "string") {
    return fallback("empty");
  }
  const stripped = stripJsonFences(rawText);
  const candidate = extractFirstJsonObject(stripped) ?? stripped;
  let parsed: any;
  try {
    parsed = JSON.parse(candidate);
  } catch (e) {
    return fallback(`json_parse_error:${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") return fallback("not_object");

  const draft =
    typeof parsed.draft_markdown === "string" && parsed.draft_markdown.trim().length > 0
      ? parsed.draft_markdown
      : null;
  if (!draft) return fallback("missing_draft_markdown");

  const sf = (parsed.structured_fields && typeof parsed.structured_fields === "object")
    ? parsed.structured_fields
    : {};
  return {
    draft_markdown: draft,
    structured_fields: {
      executive_intro_text: coerceStr(sf.executive_intro_text),
      options_summary: coerceStr(sf.options_summary),
      recommendation_text: coerceStr(sf.recommendation_text),
      requested_decision_text: coerceStr(sf.requested_decision_text),
      guardrails_text: coerceStr(sf.guardrails_text),
      residual_risks_text: coerceStr(sf.residual_risks_text),
      open_questions_text: coerceStr(sf.open_questions_text),
      confidence_level: coerceConfidence(sf.confidence_level),
      decision_readiness: coerceReadiness(sf.decision_readiness),
    },
    structured_parse_failed: false,
  };
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

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json(401, { ok: false, error: "unauthorized" });
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const aiRunId: string | undefined = body?.aiRunId ?? body?.ai_run_id;
    if (!aiRunId || typeof aiRunId !== "string") {
      return json(200, { ok: false, error: "invalid_request", note: "aiRunId required" });
    }

    const { data: runRow, error: runErr } = await admin
      .from("decision_case_ai_runs")
      .select("id, project_id, organization_id, governance_record_id, model_provider, model_id, template_id, template_version, status, openai_response_id, files_sent_count, files_skipped_count, total_bytes_sent, started_at")
      .eq("id", aiRunId)
      .maybeSingle();
    if (runErr || !runRow) return json(404, { ok: false, error: "ai_run_not_found" });

    // Authority check — same as generate function.
    const { data: authorityVal, error: authorityErr } = await admin.rpc(
      "has_project_pm_authority",
      { _user_id: userId, _project_id: runRow.project_id },
    );
    if (authorityErr) {
      return json(500, { ok: false, error: "authority_check_failed", note: authorityErr.message });
    }
    if (authorityVal !== true) return json(403, { ok: false, error: "unauthorized" });

    if (runRow.status === "failed") {
      return json(200, { ok: false, status: "failed", error: "openai_request_failed", ai_run_id: aiRunId });
    }

    if (!runRow.openai_response_id) {
      return json(200, { ok: false, status: "failed", error: "openai_request_failed", note: "No response id stored on this run." });
    }

    // Resolve the runtime pinned to the provider recorded when the run
    // was created. Failure here MUST NOT mutate the run — allow retry
    // after config is restored.
    const pinnedProviderRaw = runRow.model_provider as string | null;
    if (pinnedProviderRaw !== "openai" && pinnedProviderRaw !== "azure_openai") {
      return json(200, {
        ok: false,
        error: "ai_provider_configuration_unavailable",
        note: "AI provider configuration is temporarily unavailable.",
        ai_run_id: aiRunId,
      });
    }
    const pinnedProvider = pinnedProviderRaw as TenantAiTextProvider;
    const pinnedModel = runRow.model_id as string | null;
    if (!pinnedModel) {
      return json(200, {
        ok: false,
        error: "ai_model_mapping_missing",
        note: "The selected AI model is not mapped for the active provider.",
        ai_run_id: aiRunId,
      });
    }

    let runtime: Awaited<ReturnType<typeof resolveTenantAiTextRuntimeForProvider>>;
    try {
      runtime = await resolveTenantAiTextRuntimeForProvider({
        organizationId: runRow.organization_id as string,
        canonicalModel: pinnedModel,
        provider: pinnedProvider,
        action: "real_integration",
        functionName: "poll-decision-case-ai-brief",
        reason: "decision-case-ai-poll",
        requestId: crypto.randomUUID(),
      });
    } catch (e) {
      const safe = toSafeTenantAiTextRuntimePublicError(e);
      return json(200, { ok: false, error: safe.error, note: safe.note, ai_run_id: aiRunId });
    }

    // Poll through the Tenant AI Responses transport.
    const poll = await getTenantAiResponseStatus({
      runtime,
      responseId: runRow.openai_response_id as string,
    });

    if (!poll.ok) {
      // Transport failure: do not mutate the run; ask client to keep polling.
      return json(200, {
        ok: true,
        status: "in_progress",
        ai_run_id: aiRunId,
        openai_state: "unknown",
        note: poll.category,
      });
    }

    if (poll.state === "queued" || poll.state === "in_progress" || poll.state === "unknown") {
      return json(200, {
        ok: true,
        status: "in_progress",
        ai_run_id: aiRunId,
        openai_status: poll.state,
      });
    }

    if (poll.state === "failed" || poll.state === "cancelled" || poll.state === "incomplete") {
      const errCategory = poll.state;
      await admin
        .from("decision_case_ai_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_code: "openai_request_failed",
          error_message: errCategory,
        })
        .eq("id", aiRunId);
      return json(502, {
        ok: false, status: "failed",
        error: "openai_request_failed", note: errCategory, ai_run_id: aiRunId,
      });
    }

    // Completed. Parse the structured JSON contract.
    const rawText = extractResponseText(poll.body) || "";
    const { draft_markdown, structured_fields, structured_parse_failed } =
      parseStructuredBrief(rawText);
    const draftText = draft_markdown || "(Configured AI provider returned no text content.)";
    let outputHash: string | null = null;
    try { outputHash = await sha256Hex(draftText); } catch { /* ignore */ }

    if (runRow.status !== "completed" && runRow.status !== "saved") {
      await admin
        .from("decision_case_ai_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          output_hash: outputHash,
        })
        .eq("id", aiRunId);
    }

    const { data: fileRows } = await admin
      .from("decision_case_ai_run_files")
      .select("evidence_file_id, attachment_alias, status, file_extension, mime_type, size_bytes, sha256, skip_reason, input_kind")
      .eq("ai_run_id", aiRunId);

    const fileResults = (fileRows ?? []).map((r: any) => ({
      evidence_file_id: r.evidence_file_id,
      file_name: null,
      attachment_alias: r.attachment_alias ?? undefined,
      status: r.status,
      bytes_sent: r.status === "sent" ? (r.size_bytes ?? 0) : 0,
      file_extension: r.file_extension,
      mime_type: r.mime_type,
      size_bytes: r.size_bytes,
      sha256: r.sha256,
      input_kind: r.input_kind,
      detail: r.skip_reason ?? undefined,
    }));

    console.log("decision_case_ai_brief_completed", {
      ai_run_id: aiRunId,
      openai_response_id: runRow.openai_response_id,
      provider: runtime.provider,
      model: runtime.canonicalModel,
      structured_parse_failed,
    });

    return json(200, {
      ok: true,
      status: "completed",
      ai_run_id: aiRunId,
      draft_markdown: draftText,
      structured_fields,
      structured_parse_failed,
      model: runtime.canonicalModel,
      provider: runtime.provider,
      model_source: "admin_setting",
      template_id: runRow.template_id,
      template_version: runRow.template_version,
      files_sent_count: runRow.files_sent_count ?? 0,
      files_skipped_count: runRow.files_skipped_count ?? 0,
      total_bytes_sent: runRow.total_bytes_sent ?? 0,
      file_results: fileResults,
      generated_at: new Date().toISOString(),
    });
  } catch (e: any) {
    console.log("poll_decision_case_ai_brief_unhandled", { message: String(e?.message ?? e) });
    return json(500, { ok: false, error: "internal_error", note: String(e?.message ?? e) });
  }
});
