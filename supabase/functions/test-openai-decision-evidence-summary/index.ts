// AI.3 — Decision Case evidence reading diagnostic (admin-only).
//
// Downloads selected SharePoint evidence files for a decision case via
// Microsoft Graph and sends them to the OpenAI Responses API as direct
// base64 `input_file` items. Does NOT use /v1/files, vector stores,
// assistants or threads. Does NOT persist file bytes or the summary.
//
// AI.3 changes:
//   - Admin-only gate via is_org_admin (no longer PM authority).
//   - Model is resolved from Admin AI Settings (feature_key='decision_cases')
//     joined to ai_model_registry. OPENAI_MODEL is no longer the primary source.
//   - File limits sourced from the Admin Decision Cases setting, with
//     conservative diagnostic defaults when null.
//   - Response includes model_source='admin_setting'.

import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";
import {
  classifyEvidenceInputKind,
  isSupportedEvidenceType,
  mimeFromExtension,
  buildDataUrl,
  type EvidenceInputKind,
} from "../_shared/decision-case-ai/evidence-input-types.ts";
import { extractEmlAsText } from "../_shared/decision-case-ai/eml-text.ts";
import {
  resolveTenantAiTextRuntime,
  toSafeTenantAiTextRuntimePublicError,
  type TenantAiTextRuntime,
} from "../_shared/tenantAiTextRuntime.ts";
import { executeTenantAiResponse } from "../_shared/tenantAiResponsesClient.ts";
import { extractResponseText } from "../_shared/openai-responses.ts";
import { resolveAndAcquireTenantMicrosoftGraph } from "../_shared/tenantMicrosoftGraphRuntime.ts";
import {
  downloadMicrosoftGraphDriveItemBytes,
  toSafeGraphRuntimeFilePublicError,
} from "../_shared/microsoftGraphClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Conservative diagnostic defaults when the Admin Decision Cases setting
// leaves the limit fields null.
const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_INDIVIDUAL_MB = 10;
const DEFAULT_MAX_TOTAL_MB = 25;


function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function extOf(name: string | null | undefined): string {
  if (!name) return "";
  const ix = name.lastIndexOf(".");
  if (ix <= 0 || ix === name.length - 1) return "";
  return name.slice(ix + 1).toLowerCase();
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}

// Graph token is resolved via the canonical Tenant runtime resolver
// (see resolveAndAcquireTenantMicrosoftGraph). No Global M365_* reads.


type FileResult = {
  evidence_file_id: string;
  file_name: string | null;
  status:
    | "sent"
    | "unsupported_file_type"
    | "file_too_large"
    | "total_size_limit_exceeded"
    | "missing_identifiers"
    | "graph_token_unavailable"
    | "download_failed"
    | "model_does_not_support_image_input";
  bytes_sent?: number;
  detail?: string;
  file_extension?: string | null;
  mime_type?: string | null;
  input_kind?: EvidenceInputKind | "unsupported" | null;
};

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
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const recordId: string | undefined = body?.recordId;
    if (!recordId || typeof recordId !== "string") {
      return json(400, { ok: false, error: "invalid_request", note: "recordId required" });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // ---- Resolve record + organization -----------------------------------
    const { data: recordRow, error: recErr } = await admin
      .from("governance_records")
      .select("id, project_id, record_kind, projects:project_id(organization_id)")
      .eq("id", recordId)
      .maybeSingle();
    if (recErr) return json(500, { ok: false, error: "record_lookup_failed", note: recErr.message });
    if (!recordRow) return json(404, { ok: false, error: "record_not_found" });
    if ((recordRow as any).record_kind !== "decision_case") {
      return json(400, { ok: false, error: "not_decision_case" });
    }
    const orgId: string | null =
      (recordRow as any).projects?.organization_id ?? null;
    if (!orgId) return json(500, { ok: false, error: "record_lookup_failed", note: "organization unresolved" });

    // ---- Admin gate ------------------------------------------------------
    const { data: isAdmin, error: adminErr } = await admin.rpc("is_org_admin", {
      _user_id: userId,
      _organization_id: orgId,
    });
    if (adminErr) return json(500, { ok: false, error: "authority_check_failed", note: adminErr.message });
    if (isAdmin !== true) return json(403, { ok: false, error: "not_admin" });

    // ---- Resolve Decision Cases AI setting -------------------------------
    // Provider gating is handled by the Tenant AI text-runtime resolver
    // below; no per-feature `provider = openai` gate.
    const { data: settingRow, error: settingErr } = await admin
      .from("ai_feature_settings")
      .select(
        "enabled, max_files_per_request, max_individual_file_mb, max_total_file_mb, require_user_confirmation, ai_model_registry:model_registry_id(model_id, active, supports_file_input, supports_vision)",
      )
      .eq("organization_id", orgId)
      .eq("feature_key", "decision_cases")
      .maybeSingle();
    if (settingErr) {
      return json(500, { ok: false, error: "decision_case_ai_not_configured", note: settingErr.message });
    }
    if (!settingRow) {
      return json(400, { ok: false, error: "decision_case_ai_not_configured" });
    }
    if (!(settingRow as any).enabled) {
      return json(400, { ok: false, error: "decision_case_ai_disabled" });
    }
    const reg = (settingRow as any).ai_model_registry as
      | { model_id: string; active: boolean; supports_file_input?: boolean; supports_vision?: boolean }
      | null;
    if (!reg || !reg.active || !reg.model_id) {
      return json(400, { ok: false, error: "decision_case_ai_not_configured", note: "model inactive or invalid" });
    }
    if (reg.supports_file_input === false) {
      return json(400, {
        ok: false,
        error: "decision_case_ai_model_does_not_support_file_input",
        note: "Configured Decision Cases model does not support file input.",
      });
    }
    const modelSupportsVision: boolean = reg.supports_vision === true;
    const modelId: string = reg.model_id;

    const MAX_FILES = (settingRow as any).max_files_per_request ?? DEFAULT_MAX_FILES;
    const MAX_INDIVIDUAL_MB =
      (settingRow as any).max_individual_file_mb ?? DEFAULT_MAX_INDIVIDUAL_MB;
    const MAX_TOTAL_MB = (settingRow as any).max_total_file_mb ?? DEFAULT_MAX_TOTAL_MB;
    const MAX_FILE_BYTES = MAX_INDIVIDUAL_MB * 1024 * 1024;
    const MAX_TOTAL_BYTES = MAX_TOTAL_MB * 1024 * 1024;

    // ---- Resolve Tenant AI text runtime (OpenAI or Azure OpenAI) -----
    // Fail-closed BEFORE Graph download or provider request.
    let runtime: TenantAiTextRuntime;
    try {
      runtime = await resolveTenantAiTextRuntime({
        organizationId: orgId,
        canonicalModel: modelId,
        action: "external_api_write",
        functionName: "test-openai-decision-evidence-summary",
        reason: "decision-case-ai-diagnostic",
        requestId: crypto.randomUUID(),
      });
    } catch (e) {
      const safe = toSafeTenantAiTextRuntimePublicError(e);
      return json(200, { ok: false, error: safe.error, note: safe.note });
    }



    // ---- Load selected SharePoint evidence files -------------------------
    const { data: filesData, error: filesErr } = await admin.rpc(
      "list_governance_record_evidence_files",
      { _record_id: recordId, _include_archived: false },
    );
    if (filesErr) {
      return json(500, { ok: false, error: "evidence_load_failed", note: filesErr.message });
    }
    const allFiles: any[] = (filesData as any[]) ?? [];
    const included = allFiles.filter((f) => f?.included_in_package === true && !f?.archived_at);

    if (included.length === 0) {
      return json(400, {
        ok: false,
        error: "no_selected_sharepoint_evidence_files",
        note: "No SharePoint evidence files are marked as included in the package.",
      });
    }

    const relRank = (r: string | null | undefined) =>
      r === "high" ? 0 : r === "medium" ? 1 : r === "low" ? 2 : 3;
    const ts = (s: string | null | undefined) => (s ? Date.parse(s) : 0);
    included.sort((a, b) => {
      const r = relRank(a.relevance_level) - relRank(b.relevance_level);
      if (r !== 0) return r;
      const d = ts(b.evidence_date) - ts(a.evidence_date);
      if (d !== 0) return d;
      return ts(b.selected_at) - ts(a.selected_at);
    });

    const candidates = included.slice(0, MAX_FILES);

    // ---- Resolve Tenant Microsoft Graph runtime + acquire token -----
    // Fail-closed BEFORE Graph download, base64/context construction,
    // and any OpenAI call. Only resolve if at least one candidate is a
    // downloadable Graph-backed evidence file.
    const needsGraph = candidates.some((c: any) => !!c?.drive_id && !!c?.item_id);
    let graphAccessToken: string | null = null;
    let graphRequestId: string | null = null;
    if (needsGraph) {
      const gr = await resolveAndAcquireTenantMicrosoftGraph({
        organizationId: orgId,
        functionName: "test-openai-decision-evidence-summary",
        reason: "decision-case-evidence-diagnostic-read",
      });
      if (!gr.ok) {
        return json(200, { ok: false, ...gr.publicError });
      }
      graphAccessToken = gr.accessToken;
      graphRequestId = gr.requestId;
    }

    // ---- Download + filter ----------------------------------------------
    // Uses the ONE Tenant Graph access token acquired above.
    const fileResults: FileResult[] = [];
    type OpenAiItem = {
      kind: "file";
      filename: string;
      data_url?: string;
      text?: string;
      input_kind: EvidenceInputKind | "input_text";
    };
    const openaiFileItems: OpenAiItem[] = [];
    let totalBytes = 0;

    for (const f of candidates) {
      const fileName: string = f.file_name ?? "file";
      const ext = extOf(fileName) || (f.file_extension ?? "").toLowerCase().replace(/^\./, "");
      if (!isSupportedEvidenceType(ext)) {
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName,
          status: "unsupported_file_type",
          detail: `Extension .${ext || "?"} is not supported by this test.`,
          file_extension: ext || null,
          input_kind: "unsupported",
        });
        continue;
      }
      const inputKind = classifyEvidenceInputKind(ext) as EvidenceInputKind;
      if (inputKind === "input_image" && !modelSupportsVision) {
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName,
          status: "model_does_not_support_image_input",
          detail: "Configured Decision Cases model does not support image input.",
          file_extension: ext || null,
          input_kind: "input_image",
        });
        continue;
      }
      const declared: number | null = typeof f.size_bytes === "number" ? f.size_bytes : null;
      if (declared !== null && declared > MAX_FILE_BYTES) {
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName,
          status: "file_too_large",
          detail: `File exceeds per-file limit of ${MAX_INDIVIDUAL_MB} MB.`,
          file_extension: ext || null, input_kind: inputKind,
        });
        continue;
      }
      if (totalBytes >= MAX_TOTAL_BYTES) {
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName,
          status: "total_size_limit_exceeded",
          detail: "Total size limit reached.",
          file_extension: ext || null, input_kind: inputKind,
        });
        continue;
      }
      if (!f.drive_id || !f.item_id) {
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName,
          status: "missing_identifiers",
          detail: "Drive id or item id missing.",
          file_extension: ext || null, input_kind: inputKind,
        });
        continue;
      }
      if (!graphAccessToken) {
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName,
          status: "graph_token_unavailable",
          detail: "SharePoint access token unavailable.",
          file_extension: ext || null, input_kind: inputKind,
        });
        continue;
      }

      const dl = await downloadMicrosoftGraphDriveItemBytes({
        accessToken: graphAccessToken,
        driveId: f.drive_id,
        itemId: f.item_id,
        operation: "download_decision_case_evidence",
        requestId: graphRequestId ?? crypto.randomUUID(),
      });
      if (!dl.ok || !dl.bytes) {
        const safe = toSafeGraphRuntimeFilePublicError(dl.category);
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName,
          status: "download_failed",
          detail: safe.note,
          file_extension: ext || null, input_kind: inputKind,
        });
        continue;
      }
      const bytes: Uint8Array = dl.bytes;


      if (bytes.byteLength > MAX_FILE_BYTES) {
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName,
          status: "file_too_large",
          detail: "Downloaded file exceeds per-file limit.",
          file_extension: ext || null, input_kind: inputKind,
        });
        continue;
      }
      if (totalBytes + bytes.byteLength > MAX_TOTAL_BYTES) {
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName,
          status: "total_size_limit_exceeded",
          detail: "Total size limit would be exceeded.",
          file_extension: ext || null, input_kind: inputKind,
        });
        continue;
      }

      const mime = mimeFromExtension(ext, (f.mime_type as string) ?? null);
      if (ext === "eml") {
        const extracted = extractEmlAsText(bytes, fileName);
        openaiFileItems.push({
          kind: "file",
          filename: fileName,
          text: extracted.text,
          input_kind: "input_text",
        });
        totalBytes += extracted.bytes;
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName,
          status: "sent",
          bytes_sent: extracted.bytes,
          file_extension: ext || null,
          mime_type: "text/plain",
          input_kind: "input_file",
        });
        continue;
      }
      const b64 = bytesToBase64(bytes);
      openaiFileItems.push({
        kind: "file",
        filename: fileName,
        data_url: buildDataUrl(mime, b64),
        input_kind: inputKind,
      });
      totalBytes += bytes.byteLength;
      fileResults.push({
        evidence_file_id: f.id, file_name: fileName,
        status: "sent",
        bytes_sent: bytes.byteLength,
        file_extension: ext || null,
        mime_type: mime,
        input_kind: inputKind,
      });
    }

    if (openaiFileItems.length === 0) {
      return json(400, {
        ok: false,
        error: "no_supported_files_to_send",
        note: "No selected evidence files could be sent (unsupported type, too large, or download failed).",
        file_results: fileResults,
      });
    }

    if (totalBytes > MAX_TOTAL_BYTES) {
      return json(400, {
        ok: false,
        error: "payload_too_large",
        note: `Total payload exceeds ${MAX_TOTAL_MB} MB.`,
        file_results: fileResults,
      });
    }

    // ---- OpenAI Responses API call --------------------------------------
    const instruction =
      "Read the attached evidence files and provide a concise structured summary " +
      "of what each file appears to contain. Images are provided as visual input — " +
      "describe diagrams, process flows, screenshots and labels where visible. " +
      ".eml files are exported emails — summarize headers and body. Do not make a " +
      "decision recommendation. Do not draft a decision brief. Only summarize the " +
      "contents and identify any obvious gaps or unreadable files. Structure your reply as:\n" +
      "1. Overall summary\n" +
      "2. File-by-file summary\n" +
      "3. Observed gaps / unreadable items";

    const inputContent: any[] = [{ type: "input_text", text: instruction }];
    for (const it of openaiFileItems) {
      if (it.input_kind === "input_image" && it.data_url) {
        inputContent.push({
          type: "input_image",
          image_url: it.data_url,
          detail: "auto",
        });
      } else if (it.input_kind === "input_text" && typeof it.text === "string") {
        inputContent.push({
          type: "input_text",
          text:
            `--- BEGIN EVIDENCE FILE (${it.filename}) ---\n` +
            it.text +
            `\n--- END EVIDENCE FILE (${it.filename}) ---`,
        });
      } else if (it.data_url) {
        inputContent.push({
          type: "input_file",
          filename: it.filename,
          file_data: it.data_url,
        });
      }
    }

    // Execute a single synchronous Responses API call via the shared
    // Tenant transport. Model, background, and store are forced by the
    // transport; the caller must not send them.
    const exec = await executeTenantAiResponse({
      runtime,
      payload: {
        input: [{ role: "user", content: inputContent }],
      },
      operation: "decision_case_evidence_diagnostic",
      requestId: crypto.randomUUID(),
    });

    if (!exec.ok) {
      console.log("decision_case_evidence_diagnostic_failed", {
        record_id: recordId,
        provider: runtime.provider,
        http_status: exec.httpStatus,
        category: exec.category,
      });
      return json(200, {
        ok: false,
        error: exec.category,
        note: "The configured AI provider request did not complete.",
        file_results: fileResults,
      });
    }

    const aiBody = exec.body;
    let summaryText = extractResponseText(aiBody) ?? "";
    if (!summaryText) {
      summaryText = "(Configured AI provider returned no text content.)";
    }

    const sent = fileResults.filter((r) => r.status === "sent").length;
    const skipped = fileResults.length - sent;

    console.log("decision_case_evidence_diagnostic_ok", {
      record_id: recordId,
      files_sent_count: sent,
      files_skipped_count: skipped,
      total_bytes_sent: totalBytes,
      provider: runtime.provider,
      model: runtime.canonicalModel,
      model_source: "admin_setting",
      status: "ok",
    });

    return json(200, {
      ok: true,
      provider: runtime.provider,
      model: runtime.canonicalModel,
      model_source: "admin_setting",
      files_sent_count: sent,
      files_skipped_count: skipped,
      total_bytes_sent: totalBytes,
      summary_text: summaryText,
      file_results: fileResults,
      generated_at: new Date().toISOString(),
      require_user_confirmation: !!(settingRow as any).require_user_confirmation,
    });
  } catch (e: any) {
    return json(500, {
      ok: false,
      error: "unexpected_failure",
      note: String(e?.message ?? e ?? "Unknown error").slice(0, 500),
    });
  }
});
