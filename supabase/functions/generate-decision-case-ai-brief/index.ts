// AI.5 — Production Decision Case AI Brief Generation.
//
// Authorized Decision Case users trigger this function to generate a
// structured draft brief from:
//   - the Admin-selected Decision Cases AI model (ai_feature_settings
//     feature_key='decision_cases');
//   - the active BTPM-owned Decision Brief Assistant template
//     (ai_instruction_templates feature_key='decision_case_brief'),
//     retrieved via server-only helper get_active_ai_instruction_template_for_org;
//   - selected SharePoint evidence files for the record, sent directly
//     to the OpenAI Responses API as base64 `input_file` items;
//   - a structured JSON Decision Case AI input package assembled from
//     canonical BTPM data.
//
// Does NOT use /v1/files, vector stores, File Search, Assistants,
// threads, or a persistent OpenAI agent. Does NOT auto-save the
// generated draft. Does NOT change lifecycle stage. Does NOT persist
// raw file bytes or base64.
//
// Authority: caller must be authenticated and have project PM authority
// on the Decision Case's project (same authority required to save a
// brief version via create_governance_record_brief_version).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import {
  classifyEvidenceInputKind,
  isSupportedEvidenceType,
  isSupportedImageEvidenceType,
  mimeFromExtension,
  buildDataUrl,
  type EvidenceInputKind,
} from "../_shared/decision-case-ai/evidence-input-types.ts";
import { extractEmlAsText } from "../_shared/decision-case-ai/eml-text.ts";
import { buildDecisionCaseBtpmContextSnapshots } from "../_shared/decision-case-ai/btpm-context-snapshots.ts";
import {
  resolveTenantAiTextRuntime,
  toSafeTenantAiTextRuntimePublicError,
  type TenantAiTextRuntime,
} from "../_shared/tenantAiTextRuntime.ts";
import { enqueueTenantAiResponse } from "../_shared/tenantAiResponsesClient.ts";
import { resolveAndAcquireTenantMicrosoftGraph } from "../_shared/tenantMicrosoftGraphRuntime.ts";
import {
  downloadMicrosoftGraphDriveItemBytes,
  toSafeGraphRuntimeFilePublicError,
} from "../_shared/microsoftGraphClient.ts";
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
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[],
    );
  }
  return btoa(bin);
}

// Graph token is resolved via the canonical Tenant runtime resolver
// (see resolveAndAcquireTenantMicrosoftGraph). No Global M365_* reads.


type FileResult = {
  evidence_file_id: string;
  file_name: string | null;
  attachment_alias?: string;
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
  size_bytes?: number | null;
  sha256?: string | null;
  input_kind?: EvidenceInputKind | "unsupported" | null;
};

async function sha256Hex(input: Uint8Array | string): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
    const recordId: string | undefined = body?.recordId;
    if (!recordId || typeof recordId !== "string") {
      return json(200, { ok: false, error: "invalid_request", note: "recordId required" });
    }

    // ---- Resolve record + project + org (decrypted, user-auth scoped) -
    // get_governance_record_detail enforces project read authority via
    // _gov_assert_project_read(auth.uid()) and returns plaintext fields.
    const { data: detailData, error: detailErr } = await userClient.rpc(
      "get_governance_record_detail",
      { _record_id: recordId },
    );
    if (detailErr) {
      const msg = String(detailErr.message ?? "");
      if (/forbidden|not authorized|42501/i.test(msg)) {
        return json(403, { ok: false, error: "unauthorized" });
      }
      if (/not found|P0002/i.test(msg)) {
        return json(404, { ok: false, error: "record_not_found" });
      }
      return json(500, { ok: false, error: "record_lookup_failed", note: msg });
    }
    if (!detailData) return json(404, { ok: false, error: "record_not_found" });
    const detail: any = detailData;
    if (detail.record_kind !== "decision_case") {
      return json(200, { ok: false, error: "not_decision_case" });
    }
    const orgId: string | null = detail.organization_id ?? null;
    const projectId: string | null = detail.project_id ?? null;
    const workspaceId: string | null = detail.workspace_id ?? null;
    if (!orgId || !projectId) {
      return json(500, { ok: false, error: "record_lookup_failed", note: "organization or project unresolved" });
    }

    // ---- Authority: project PM authority (same as brief save) ---------
    // has_project_pm_authority takes _user_id explicitly; admin client OK.
    const { data: authorityVal, error: authorityErr } = await admin.rpc(
      "has_project_pm_authority",
      { _user_id: userId, _project_id: projectId },
    );
    if (authorityErr) {
      return json(500, { ok: false, error: "authority_check_failed", note: authorityErr.message });
    }
    if (authorityVal !== true) return json(403, { ok: false, error: "unauthorized" });

    // ---- Resolve Decision Cases AI setting (org-scoped table) ---------
    // Provider gating is handled by the Tenant AI text-runtime resolver
    // below; no per-feature `provider = openai` gate.
    const { data: settingRow, error: settingErr } = await admin
      .from("ai_feature_settings")
      .select(
        "enabled, reasoning_effort, max_files_per_request, max_individual_file_mb, max_total_file_mb, require_user_confirmation, ai_model_registry:model_registry_id(model_id, active, supports_file_input, supports_vision)",
      )
      .eq("organization_id", orgId)
      .eq("feature_key", "decision_cases")
      .maybeSingle();
    if (settingErr) {
      return json(500, { ok: false, error: "decision_case_ai_not_configured", note: settingErr.message });
    }
    if (!settingRow) return json(200, { ok: false, error: "decision_case_ai_not_configured" });
    if (!(settingRow as any).enabled) return json(200, { ok: false, error: "decision_case_ai_disabled" });
    const reg = (settingRow as any).ai_model_registry as
      | { model_id: string; active: boolean; supports_file_input?: boolean; supports_vision?: boolean }
      | null;
    if (!reg || !reg.active || !reg.model_id) {
      return json(200, { ok: false, error: "decision_case_ai_not_configured", note: "model inactive or invalid" });
    }
    if (reg.supports_file_input === false) {
      return json(200, {
        ok: false,
        error: "decision_case_ai_model_does_not_support_file_input",
        note: "Configured Decision Cases model does not support file input.",
      });
    }
    const modelSupportsVision: boolean = reg.supports_vision === true;
    const modelId: string = reg.model_id;
    const reasoningEffort: string | null = (settingRow as any).reasoning_effort ?? null;


    const MAX_FILES = (settingRow as any).max_files_per_request ?? DEFAULT_MAX_FILES;
    const MAX_INDIVIDUAL_MB = (settingRow as any).max_individual_file_mb ?? DEFAULT_MAX_INDIVIDUAL_MB;
    const MAX_TOTAL_MB = (settingRow as any).max_total_file_mb ?? DEFAULT_MAX_TOTAL_MB;
    const MAX_FILE_BYTES = MAX_INDIVIDUAL_MB * 1024 * 1024;
    const MAX_TOTAL_BYTES = MAX_TOTAL_MB * 1024 * 1024;

    // ---- Resolve active Decision Brief Assistant template (server-only)
    const { data: tplRow, error: tplErr } = await admin.rpc(
      "get_active_ai_instruction_template_for_org",
      { _organization_id: orgId, _feature_key: "decision_case_brief" },
    );
    if (tplErr || !tplRow || !(tplRow as any).id) {
      return json(200, {
        ok: false,
        error: "decision_brief_template_not_configured",
        note: tplErr?.message ?? "no active template",
      });
    }
    const templateId: string = (tplRow as any).id;
    const templateVersion: number = (tplRow as any).version;
    const instructionText: string = (tplRow as any).instruction_text ?? "";
    if (!instructionText) {
      return json(200, { ok: false, error: "decision_brief_template_not_configured" });
    }

    // ---- Resolve Tenant AI text runtime (OpenAI or Azure OpenAI) -----
    // Fail-closed BEFORE evidence download, AI-run creation, or any
    // provider call.
    let runtime: TenantAiTextRuntime;
    {
      const requestId = crypto.randomUUID();
      try {
        runtime = await resolveTenantAiTextRuntime({
          organizationId: orgId,
          canonicalModel: modelId,
          action: "external_api_write",
          functionName: "generate-decision-case-ai-brief",
          reason: "decision-case-ai-generate",
          requestId,
        });
      } catch (e) {
        const safe = toSafeTenantAiTextRuntimePublicError(e);
        return json(200, { ok: false, error: safe.error, note: safe.note });
      }
    }


    // ---- Load selected SharePoint evidence files (user-auth scoped) --
    // RPC returns jsonb (a single JSON array value); decrypts fields.
    const { data: filesData, error: filesErr } = await userClient.rpc(
      "list_governance_record_evidence_files",
      { _record_id: recordId, _include_archived: false },
    );
    if (filesErr) {
      return json(500, { ok: false, error: "evidence_load_failed", note: filesErr.message });
    }
    const allFiles: any[] = Array.isArray(filesData) ? (filesData as any[]) : ((filesData as any[]) ?? []);
    const included = allFiles.filter(
      (f) => f?.included_in_package === true && !f?.archived_at,
    );
    if (included.length === 0) {
      return json(200, {
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
    // Fail-closed BEFORE AI-run creation, file-audit insertion, and any
    // OpenAI call. Only resolve if at least one selected candidate is a
    // downloadable Graph-backed evidence file.
    const needsGraph = candidates.some((c: any) => !!c?.drive_id && !!c?.item_id);
    let graphAccessToken: string | null = null;
    let graphRequestId: string | null = null;
    if (needsGraph) {
      const gr = await resolveAndAcquireTenantMicrosoftGraph({
        organizationId: orgId,
        functionName: "generate-decision-case-ai-brief",
        reason: "decision-case-evidence-read",
      });
      if (!gr.ok) {
        return json(200, { ok: false, ...gr.publicError });
      }
      graphAccessToken = gr.accessToken;
      graphRequestId = gr.requestId;
    }

    // ---- AI.6 — create audit run row (status='started') -------------

    const filesSelectedCount = candidates.length;
    let aiRunId: string | null = null;
    {
      const { data: runIns, error: runErr } = await admin
        .from("decision_case_ai_runs")
        .insert({
          organization_id: orgId,
          workspace_id: workspaceId,
          project_id: projectId,
          governance_record_id: recordId,
          run_type: "decision_case_brief_generation",
          status: "started",
          model_provider: runtime.provider,
          model_id: runtime.canonicalModel,
          model_source: "admin_setting",
          reasoning_effort: reasoningEffort,
          template_id: templateId,
          template_feature_key: "decision_case_brief",
          template_version: templateVersion,
          files_selected_count: filesSelectedCount,
          started_by: userId,
        })
        .select("id")
        .single();
      if (runErr || !runIns?.id) {
        console.log("decision_case_ai_run_insert_failed", { message: runErr?.message });
      } else {
        aiRunId = runIns.id as string;
      }
    }

    async function persistFileAudits(): Promise<void> {
      if (!aiRunId) return;
      const rows = fileResults.map((r) => ({
        ai_run_id: aiRunId!,
        organization_id: orgId!,
        workspace_id: workspaceId!,
        project_id: projectId!,
        governance_record_id: recordId,
        evidence_file_id: r.evidence_file_id,
        attachment_alias: r.attachment_alias ?? null,
        status: r.status,
        file_extension: r.file_extension ?? null,
        mime_type: r.mime_type ?? null,
        size_bytes: r.size_bytes ?? null,
        sha256: r.sha256 ?? null,
        skip_reason: r.status === "sent" ? null : (r.detail ?? null),
        error_code: r.status === "sent" ? null : r.status,
        input_kind: r.input_kind ?? null,
      }));
      if (rows.length === 0) return;
      const { error } = await admin.from("decision_case_ai_run_files").insert(rows);
      if (error) {
        console.log("decision_case_ai_run_files_insert_failed", { message: error.message });
      }
    }

    async function failRun(errorCode: string, errorMessage: string | null) {
      if (!aiRunId) return;
      const sent = fileResults.filter((r) => r.status === "sent").length;
      const skipped = fileResults.length - sent;
      const totalSent = fileResults.reduce((s, r) => s + (r.bytes_sent ?? 0), 0);
      await admin
        .from("decision_case_ai_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error_code: errorCode,
          error_message: errorMessage,
          files_sent_count: sent,
          files_skipped_count: skipped,
          total_bytes_sent: totalSent,
        })
        .eq("id", aiRunId);
      await persistFileAudits();
    }

    // ---- Load BTPM context links + stakeholders + manual references --
    // All three depend on auth.uid(); call via user-auth scoped client.
    const [ctxLinksRes, manualRefsRes, stakeholdersRes] = await Promise.all([
      userClient.rpc("list_governance_record_btpm_context_links", {
        _record_id: recordId, _include_archived: false,
      }),
      userClient.rpc("list_governance_record_evidence_references", {
        _record_id: recordId, _include_archived: false,
      }),
      userClient.rpc("list_project_stakeholders", { _project_id: projectId }),
    ]);
    const ctxLinksData: any[] = Array.isArray(ctxLinksRes.data)
      ? (ctxLinksRes.data as any[])
      : ((ctxLinksRes.data as any[]) ?? []);
    const includedCtxLinksData = ctxLinksData.filter(
      (link) => link?.included_in_package === true && !link?.archived_at,
    );
    const manualRefsData: any[] = Array.isArray(manualRefsRes.data)
      ? (manualRefsRes.data as any[])
      : ((manualRefsRes.data as any[]) ?? []);
    const stakeholdersData: any[] = (stakeholdersRes.data as any[]) ?? [];

    // ---- Decrypt project / program / workspace names (best-effort) ----
    async function decryptOne(ciphertext: string | null | undefined, ownerOrgId: string | null): Promise<string | null> {
      if (!ciphertext || !ownerOrgId) return null;
      try {
        const { data, error } = await admin.rpc("btpm_decrypt", {
          _ciphertext: ciphertext, _org_id: ownerOrgId,
        });
        if (error) return null;
        return (data as string | null) ?? null;
      } catch { return null; }
    }
    const { data: projRow } = await admin
      .from("projects")
      .select("name, organization_id, program_id, programs:program_id(name, organization_id), workspaces:workspace_id(name, organization_id)")
      .eq("id", projectId)
      .maybeSingle();
    const projectName = await decryptOne(
      (projRow as any)?.name ?? null,
      (projRow as any)?.organization_id ?? orgId,
    );
    const programName = await decryptOne(
      (projRow as any)?.programs?.name ?? null,
      (projRow as any)?.programs?.organization_id ?? orgId,
    );
    const workspaceName = await decryptOne(
      (projRow as any)?.workspaces?.name ?? null,
      (projRow as any)?.workspaces?.organization_id ?? orgId,
    );

    // ---- Download + filter SharePoint files --------------------------
    // Uses the ONE Tenant Graph access token acquired earlier. No
    // per-file token acquisition. No Global M365_* reads.
    const fileResults: FileResult[] = [];
    type OpenAiFileItem = {
      filename: string;
      data_url?: string;
      text?: string;
      alias: string;
      input_kind: EvidenceInputKind | "input_text";
    };
    const openaiFileItems: OpenAiFileItem[] = [];
    let totalBytes = 0;
    let aliasCounter = 1;

    for (const f of candidates) {
      const alias = `file_${String(aliasCounter).padStart(3, "0")}`;
      const fileName: string = f.file_name ?? `${alias}`;
      const ext = extOf(fileName) || (f.file_extension ?? "").toLowerCase().replace(/^\./, "");
      if (!isSupportedEvidenceType(ext)) {
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName, attachment_alias: alias,
          status: "unsupported_file_type",
          detail: `Extension .${ext || "?"} is not supported.`,
          file_extension: ext || null,
          input_kind: "unsupported",
        });
        aliasCounter++;
        continue;
      }
      const inputKind = classifyEvidenceInputKind(ext) as EvidenceInputKind;
      if (inputKind === "input_image" && !modelSupportsVision) {
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName, attachment_alias: alias,
          status: "model_does_not_support_image_input",
          detail: "Configured Decision Cases model does not support image input.",
          file_extension: ext || null,
          input_kind: "input_image",
        });
        aliasCounter++;
        continue;
      }
      const declared: number | null = typeof f.size_bytes === "number" ? f.size_bytes : null;
      if (declared !== null && declared > MAX_FILE_BYTES) {
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName, attachment_alias: alias,
          status: "file_too_large",
          detail: `File exceeds per-file limit of ${MAX_INDIVIDUAL_MB} MB.`,
          file_extension: ext || null,
          input_kind: inputKind,
        });
        aliasCounter++;
        continue;
      }
      if (totalBytes >= MAX_TOTAL_BYTES) {
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName, attachment_alias: alias,
          status: "total_size_limit_exceeded",
          detail: "Total size limit reached.",
          file_extension: ext || null,
          input_kind: inputKind,
        });
        aliasCounter++;
        continue;
      }
      if (!f.drive_id || !f.item_id) {
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName, attachment_alias: alias,
          status: "missing_identifiers",
          detail: "Drive id or item id missing.",
          file_extension: ext || null,
          input_kind: inputKind,
        });
        aliasCounter++;
        continue;
      }
      if (!graphAccessToken) {
        // Should not happen — needsGraph would have been true and we
        // would have failed earlier. Guard defensively.
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName, attachment_alias: alias,
          status: "graph_token_unavailable",
          detail: "SharePoint access token unavailable.",
          file_extension: ext || null,
          input_kind: inputKind,
        });
        aliasCounter++;
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
          evidence_file_id: f.id, file_name: fileName, attachment_alias: alias,
          status: "download_failed",
          detail: safe.note,
          file_extension: ext || null,
          input_kind: inputKind,
        });
        aliasCounter++;
        continue;
      }
      const bytes: Uint8Array = dl.bytes;


      if (bytes.byteLength > MAX_FILE_BYTES) {
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName, attachment_alias: alias,
          status: "file_too_large",
          detail: "Downloaded file exceeds per-file limit.",
          file_extension: ext || null,
          input_kind: inputKind,
        });
        aliasCounter++;
        continue;
      }
      if (totalBytes + bytes.byteLength > MAX_TOTAL_BYTES) {
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName, attachment_alias: alias,
          status: "total_size_limit_exceeded",
          detail: "Total size limit would be exceeded.",
          file_extension: ext || null,
          input_kind: inputKind,
        });
        aliasCounter++;
        continue;
      }

      const mime = mimeFromExtension(ext, (f.mime_type as string) ?? null);
      const filenameForOpenAi = `${alias}__${fileName}`.slice(0, 240);
      let bytesSha256: string | null = null;
      try { bytesSha256 = await sha256Hex(bytes); } catch { bytesSha256 = null; }

      if (ext === "eml") {
        // Parse .eml to plain text to avoid sending embedded base64
        // attachments through the model's context window.
        const extracted = extractEmlAsText(bytes, fileName);
        openaiFileItems.push({
          filename: filenameForOpenAi,
          text: extracted.text,
          alias,
          input_kind: "input_text",
        });
        totalBytes += extracted.bytes;
        fileResults.push({
          evidence_file_id: f.id, file_name: fileName, attachment_alias: alias,
          status: "sent",
          bytes_sent: extracted.bytes,
          file_extension: ext || null,
          mime_type: "text/plain",
          size_bytes: bytes.byteLength,
          sha256: bytesSha256,
          input_kind: "input_file",
        });
        aliasCounter++;
        continue;
      }

      const b64 = bytesToBase64(bytes);
      openaiFileItems.push({
        filename: filenameForOpenAi,
        data_url: buildDataUrl(mime, b64),
        alias,
        input_kind: inputKind,
      });
      totalBytes += bytes.byteLength;
      fileResults.push({
        evidence_file_id: f.id, file_name: fileName, attachment_alias: alias,
        status: "sent",
        bytes_sent: bytes.byteLength,
        file_extension: ext || null,
        mime_type: mime,
        size_bytes: bytes.byteLength,
        sha256: bytesSha256,
        input_kind: inputKind,
      });
      aliasCounter++;
    }


    if (openaiFileItems.length === 0) {
      await failRun("no_supported_evidence_files_to_send", "No supported evidence files to send.");
      // Return 200 for an expected validation outcome so the client doesn't
      // surface a network-level 400 / runtime-error overlay. The wrapper
      // checks `ok` and maps the `error` code to a user-facing toast.
      return json(200, {
        ok: false,
        error: "no_supported_evidence_files_to_send",
        note: "No selected evidence files could be sent (unsupported type, too large, or download failed).",
        file_results: fileResults,
        ai_run_id: aiRunId,
      });
    }
    if (totalBytes > MAX_TOTAL_BYTES) {
      await failRun("payload_too_large", `Total payload exceeds ${MAX_TOTAL_MB} MB.`);
      return json(200, {
        ok: false, error: "payload_too_large",
        note: `Total payload exceeds ${MAX_TOTAL_MB} MB.`,
        file_results: fileResults,
        ai_run_id: aiRunId,
      });
    }

    // ---- Assemble Decision Case AI input package (plaintext only) ----
    const aliasByFileId = new Map<string, string>();
    const fileResultByFileId = new Map<string, FileResult>();
    for (const r of fileResults) {
      if (r.attachment_alias) aliasByFileId.set(r.evidence_file_id, r.attachment_alias);
      fileResultByFileId.set(r.evidence_file_id, r);
    }
    const inputPackage = {
      schema_version: "1.0",
      package_type: "btpm_decision_case_ai_input",
      meta: {
        record_id: recordId,
        project_id: projectId,
        workspace_id: workspaceId,
        organization_id: orgId,
        generated_at: new Date().toISOString(),
        generated_by: "BTPM",
        template_id: templateId,
        template_version: templateVersion,
        model_id: runtime.canonicalModel,
      },
      decision_request: {
        event_name: detail.event_name ?? null,
        event_type: detail.event_type ?? null,
        decision_question: detail.decision_question ?? null,
        decision_stage: detail.decision_stage ?? null,
        decision_owner_stakeholder_id: detail.decision_owner_stakeholder_id ?? null,
        target_decision_date: detail.target_decision_date ?? null,
        summary: detail.summary ?? null,
        decisions_summary: detail.decisions_summary ?? null,
      },
      business_context: {
        project_name: projectName,
        program_name: programName,
        workspace_name: workspaceName,
      },
      constraints_and_assumptions: { constraints: [], assumptions: [] },
      stakeholders: {
        list: stakeholdersData.map((s: any) => ({
          stakeholder_id: s.id ?? null,
          name: s.display_name ?? s.external_name ?? null,
          stakeholder_type: s.stakeholder_type ?? null,
          role: s.role_label ?? null,
          notes: s.notes ?? null,
        })),
      },
      evidence_files: candidates.map((f: any) => {
        const fr = fileResultByFileId.get(f.id);
        return {
          evidence_file_id: f.id,
          attachment_alias: aliasByFileId.get(f.id) ?? null,
          file_name: f.file_name ?? null,
          evidence_title: f.evidence_title ?? null,
          evidence_summary: f.evidence_summary ?? null,
          evidence_date: f.evidence_date ?? null,
          relevance_level: f.relevance_level ?? null,
          included_in_package: f.included_in_package === true,
          file_extension: fr?.file_extension ?? null,
          mime_type: fr?.mime_type ?? null,
          input_kind: fr?.input_kind ?? null,
          processing_status: fr?.status ?? null,
          processing_note:
            fr?.input_kind === "input_image"
              ? "This evidence file is provided as an image input. Read visual content such as diagrams, process flows, screenshots, and labels where possible."
              : fr?.file_extension === "eml"
                ? "This evidence file is an exported email message. Read the email body and headers where available. Embedded attachments are not separately extracted unless selected as separate evidence files."
                : null,
        };
      }),
      manual_references: manualRefsData.map((r: any) => ({
        reference_id: r.id ?? null,
        evidence_type: r.evidence_type ?? null,
        title: r.title ?? null,
        external_url: r.external_url ?? null,
        summary: r.summary ?? null,
        evidence_date: r.evidence_date ?? null,
        relevance_level: r.relevance_level ?? null,
        included_in_package: r.included_in_package === true,
        retrieval_status: "metadata_only",
      })),
      btpm_context: await (async () => {
        const enriched = await buildDecisionCaseBtpmContextSnapshots(
          userClient,
          admin,
          userId,
          includedCtxLinksData,
        );
        const notes = [...enriched.data_quality_notes];
        if (ctxLinksData.length > 0 && includedCtxLinksData.length === 0) {
          notes.push("No BTPM context links were included in the AI package.");
        }
        return {
          sources: enriched.sources,
          data_quality_notes: notes,
          sources_count: enriched.sources_count,
          resolved_count: enriched.resolved_count,
          package_note:
            "The btpm_context.sources entries represent BTPM internal context explicitly selected by the user. " +
            "Treat resolved snapshots as internal evidence. Treat metadata_only/unresolved/permission_denied entries as weak context and do not infer missing details from them.",
        };
      })(),
      decision_focus: { tensions: [], focus_areas: [], questions_to_challenge: [] },
      pre_processed_inputs: { options: [], risks: [], open_questions: [] },
    };

    // ---- OpenAI Responses API call -----------------------------------
    const inputContent: any[] = [
      {
        type: "input_text",
        text:
          "BTPM Decision Case AI input package (JSON). Treat the attached files as the evidence files referenced via their attachment_alias.\n\n" +
          JSON.stringify(inputPackage),
      },
    ];
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
            `--- BEGIN EVIDENCE FILE [${it.alias}] (${it.filename}) ---\n` +
            it.text +
            `\n--- END EVIDENCE FILE [${it.alias}] ---`,
        });
      } else if (it.data_url) {
        inputContent.push({
          type: "input_file",
          filename: it.filename,
          file_data: it.data_url,
        });
      }
    }

    // ---- Enqueue OpenAI Responses API call in background mode -------
    // Background mode + store=true lets us return immediately with a
    // response id, then the client polls poll-decision-case-ai-brief
    // until the model finishes. This sidesteps the 150s edge gateway
    // idle timeout for long-running reasoning runs.
    // AI.7.2 — Append structured-output contract on top of the active
    // template. The template still defines tone/style; this only adds
    // the machine-readable wrapping that lets BTPM prefill the
    // Stakeholder Package from the saved Decision Brief.
    // AI.8.1a — Extend the structured contract to include executive_intro_text
    // and options_summary so the visible Decision Brief form is populated end-to-end.
    const structuredOutputInstruction =
      "\n\n---\nOUTPUT FORMAT (BTPM machine contract — required):\n" +
      "Return ONLY a single JSON object, with no prose outside it and no markdown code fences. Shape:\n" +
      "{\n" +
      '  "draft_markdown": "<the full Decision Brief draft as Markdown>",\n' +
      '  "structured_fields": {\n' +
      '    "executive_intro_text": string | null,\n' +
      '    "options_summary": string | null,\n' +
      '    "requested_decision_text": string | null,\n' +
      '    "recommendation_text": string | null,\n' +
      '    "guardrails_text": string | null,\n' +
      '    "residual_risks_text": string | null,\n' +
      '    "open_questions_text": string | null,\n' +
      '    "confidence_level": "high" | "medium" | "low" | null,\n' +
      '    "decision_readiness": "ready_for_decision" | "needs_clarification" | "not_ready" | null\n' +
      "  }\n" +
      "}\n" +
      "Rules:\n" +
      "- draft_markdown MUST contain the full Decision Brief content (executive intro, options summary, recommendation, guardrails, residual risks, requested decision, open questions). Do not abbreviate.\n" +
      "- structured_fields mirror the core business fields shown to the user. executive_intro_text is the executive summary; options_summary is a concise comparison of the options considered.\n" +
      "- If the evidence does not support a field, set it to null and state the gap inside open_questions_text. Never invent facts.\n" +
      "- confidence_level and decision_readiness MUST use one of the listed string values or null.\n" +
      "- Do not include any text before or after the JSON object.";
    const composedInstructions = instructionText + structuredOutputInstruction;

    // Enqueue Responses API call through the Tenant AI transport.
    // `model`, `background` and `store` are forced by the transport from
    // `runtime.providerModel`; the caller payload must not carry them.
    const enqueuePayload: Record<string, unknown> = {
      instructions: composedInstructions,
      input: [{ role: "user", content: inputContent }],
    };
    if (reasoningEffort) enqueuePayload.reasoning = { effort: reasoningEffort };

    let enqueue = await enqueueTenantAiResponse({ runtime, payload: enqueuePayload });
    if (!enqueue.ok && enqueue.category === "request_rejected" && enqueuePayload.reasoning) {
      delete enqueuePayload.reasoning;
      enqueue = await enqueueTenantAiResponse({ runtime, payload: enqueuePayload });
    }

    if (!enqueue.ok) {
      const errCategory = enqueue.category;
      console.log("decision_case_ai_brief_enqueue_failed", {
        record_id: recordId,
        category: errCategory,
      });
      await failRun("openai_request_failed", errCategory);
      return json(502, {
        ok: false, error: "openai_request_failed",
        note: errCategory, file_results: fileResults, ai_run_id: aiRunId,
      });
    }

    const openaiResponseId: string | null = enqueue.responseId;
    const sentCount = fileResults.filter((r) => r.status === "sent").length;
    const skippedCount = fileResults.length - sentCount;

    let inputPackageHash: string | null = null;
    try { inputPackageHash = await sha256Hex(JSON.stringify(inputPackage)); } catch { /* ignore */ }

    if (aiRunId) {
      await admin
        .from("decision_case_ai_runs")
        .update({
          openai_response_id: openaiResponseId,
          input_package_hash: inputPackageHash,
          files_sent_count: sentCount,
          files_skipped_count: skippedCount,
          total_bytes_sent: totalBytes,
        })
        .eq("id", aiRunId);
      await persistFileAudits();
    }

    console.log("decision_case_ai_brief_enqueued", {
      record_id: recordId,
      ai_run_id: aiRunId,
      openai_response_id: openaiResponseId,
      files_sent_count: sentCount,
      files_skipped_count: skippedCount,
      total_bytes_sent: totalBytes,
      model: runtime.canonicalModel,
      provider: runtime.provider,
    });

    return json(200, {
      ok: true,
      status: "queued",
      model: runtime.canonicalModel,
      provider: runtime.provider,
      model_source: "admin_setting",
      template_id: templateId,
      template_version: templateVersion,
      files_sent_count: sentCount,
      files_skipped_count: skippedCount,
      total_bytes_sent: totalBytes,
      file_results: fileResults,
      generated_at: new Date().toISOString(),
      require_user_confirmation: !!(settingRow as any).require_user_confirmation,
      ai_run_id: aiRunId,
      openai_response_id: openaiResponseId,
      btpm_context_sources_count:
        (inputPackage as any).btpm_context?.sources_count ?? 0,
      btpm_context_resolved_count:
        (inputPackage as any).btpm_context?.resolved_count ?? 0,
    });
  } catch (e: any) {
    console.log("decision_case_ai_brief_unhandled", { message: String(e?.message ?? e) });
    return json(500, { ok: false, error: "internal_error", note: String(e?.message ?? e) });
  }
});
