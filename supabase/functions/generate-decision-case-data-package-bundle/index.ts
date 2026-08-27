// DC.16 — Generate Decision Case Data Package ZIP Bundle.
//
// Assembles a ZIP bundle containing:
//   - decision-data-package.json (v2.0 manifest)
//   - evidence-index.json
//   - README.txt
//   - evidence/      (SharePoint files downloaded via Graph at bundle time)
//   - btpm-context/  (JSON + Markdown snapshots of linked BTPM objects)
//   - manual-references/manual-references.md (metadata-only)
//
// File bytes are downloaded at generation time only and stored as a single
// immutable artifact in the private `btpm-exports` bucket. Individual
// file bytes are never persisted outside the ZIP.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { zipSync, strToU8 } from "https://esm.sh/fflate@0.8.2";
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

const BUNDLE_BUCKET = "btpm-exports";
const MAX_FILES = 50;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_TOTAL_BYTES = 75 * 1024 * 1024; // 75 MB


function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(buf: ArrayBuffer | Uint8Array | string): Promise<string> {
  const data =
    typeof buf === "string" ? new TextEncoder().encode(buf)
    : buf instanceof Uint8Array ? buf
    : new Uint8Array(buf);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet();
  const norm = (v: any): any => {
    if (v && typeof v === "object") {
      if (seen.has(v)) return null;
      seen.add(v);
      if (Array.isArray(v)) return v.map(norm);
      return Object.keys(v).sort().reduce((acc: any, k) => { acc[k] = norm(v[k]); return acc; }, {});
    }
    return v;
  };
  return JSON.stringify(norm(value), null, 2);
}

function safeBaseName(s: string): string {
  return (s || "")
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "untitled";
}

function splitExt(name: string): { base: string; ext: string } {
  const safe = safeBaseName(name);
  const ix = safe.lastIndexOf(".");
  if (ix <= 0 || ix === safe.length - 1) return { base: safe, ext: "" };
  return { base: safe.slice(0, ix), ext: safe.slice(ix + 1).toLowerCase() };
}

function pad3(n: number) { return String(n).padStart(3, "0"); }

// Graph token is resolved via the canonical Tenant runtime resolver
// (see resolveAndAcquireTenantMicrosoftGraph). No Global M365_* reads.


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { ok: false, error: "missing_authorization" });

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
    if (userErr || !userData?.user) return json(401, { ok: false, error: "not_authenticated" });
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const recordId: string | undefined = body?.recordId;
    if (!recordId || typeof recordId !== "string") {
      return json(400, { ok: false, error: "invalid_request", note: "recordId required" });
    }

    // ---- Caller-scoped protected Decision Case resolution (C20C16) ---------
    const { data: projectSummary, error: summaryError } = await userClient.rpc(
      "get_governance_decision_case_project_summary",
      { _record_id: recordId },
    );
    if (summaryError) {
      const code = (summaryError as { code?: string } | null)?.code ?? "";
      if (code === "P0002") return json(404, { ok: false, error: "record_not_found" });
      if (code === "22023") return json(400, { ok: false, error: "not_decision_case" });
      return json(403, { ok: false, error: "not_authorized" });
    }
    const summary: any = (projectSummary as any) ?? {};
    const projectId: string | undefined = summary?.project_id;
    const organizationId: string | undefined = summary?.organization_id;
    const workspaceId: string | undefined = summary?.workspace_id;
    if (!projectId || !organizationId || !workspaceId) {
      return json(403, { ok: false, error: "not_authorized" });
    }

    // ---- Caller-scoped Project write / PM authority ------------------------
    const { error: authErr } = await userClient.rpc("_gov_assert_project_write", {
      _project_id: projectId,
    });
    if (authErr) return json(403, { ok: false, error: "not_authorized" });

    // Service-role client is constructed ONLY after caller authority.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // ---- Assemble canonical data ------------------------------------------
    const [detailRes, evidenceRefsRes, btpmRes, packagesRes, outcomeRes,
           stakeholdersRes, evidenceFilesRes] =
      await Promise.all([
        userClient.rpc("get_governance_record_detail", { _record_id: recordId }),
        userClient.rpc("list_governance_record_evidence_references", {
          _record_id: recordId, _include_archived: false,
        }),
        userClient.rpc("list_governance_record_btpm_context_links", {
          _record_id: recordId, _include_archived: false,
        }),
        userClient.rpc("list_governance_record_stakeholder_packages", { _record_id: recordId }),
        userClient.rpc("get_governance_record_decision_outcome", { _record_id: recordId }),
        // AI.7.5b — use protected stakeholder RPC instead of invalid direct admin read
        userClient.rpc("list_project_stakeholders", { _project_id: projectId }),
        userClient.rpc("list_governance_record_evidence_files", {
          _record_id: recordId, _include_archived: false,
        }),
      ]);

    for (const r of [detailRes, evidenceRefsRes, btpmRes, packagesRes, outcomeRes, evidenceFilesRes]) {
      if (r.error) return json(500, { ok: false, error: "data_assembly_failed", note: r.error.message });
    }

    const detail: any = detailRes.data ?? {};
    const manualRefs: any[] = (evidenceRefsRes.data as any[]) ?? [];
    const btpmList: any[] = (btpmRes.data as any[]) ?? [];
    const stakeholderPackages: any[] = (packagesRes.data as any[]) ?? [];
    const outcome: any = outcomeRes.data ?? null;

    // AI.7.5b — degrade gracefully if stakeholder RPC fails; filter out removed entries
    const stakeholdersRpcFailed = !!stakeholdersRes.error;
    const stakeholdersRaw: any[] = stakeholdersRpcFailed ? [] : ((stakeholdersRes.data as any[]) ?? []);
    const stakeholders: any[] = stakeholdersRaw.filter((s) => !s?.removed_at);
    const evidenceFiles: any[] = (evidenceFilesRes.data as any[]) ?? [];

    const includedEvidenceFiles = evidenceFiles.filter(
      (f) => f?.included_in_package === true && !f?.archived_at,
    );
    const includedBtpmLinks = btpmList.filter((l) => l?.included_in_package === true && !l?.archived_at);
    const includedManualRefs = manualRefs.filter((m) => m?.included_in_package === true && !m?.archived_at);

    const sourceProjectIdSet = new Set<string>([projectId]);
    for (const l of btpmList) if (l?.source_project_id) sourceProjectIdSet.add(l.source_project_id);
    const sourceProjectIds = Array.from(sourceProjectIdSet);

    // ---- Decision case section --------------------------------------------
    const ownerStakeholder = detail.decision_owner_stakeholder_id
      ? (stakeholders.find((s) => s.id === detail.decision_owner_stakeholder_id) ?? null)
      : null;
    if (detail.decision_owner_stakeholder_id && !ownerStakeholder && !stakeholdersRpcFailed) {
      dataQualityNotes.push("Decision owner stakeholder could not be resolved from the project stakeholder list.");
    }
    const decisionCase = {
      id: detail.id ?? recordId,
      title: detail.event_name ?? null,
      decision_question: detail.decision_question ?? null,
      background_summary: detail.summary ?? null,
      forum_event_type: detail.event_type ?? null,
      target_decision_date: detail.target_decision_date ?? null,
      decision_owner: {
        stakeholder_id: detail.decision_owner_stakeholder_id ?? null,
        name: ownerStakeholder?.display_name ?? ownerStakeholder?.external_name ?? null,
        role_label: ownerStakeholder?.role_label ?? null,
        type: ownerStakeholder?.stakeholder_type ?? null,
      },
      lifecycle_stage: detail.decision_stage ?? null,
      project: {
        id: summary.project_id ?? projectId,
        name: summary.project_name ?? null,
        workspace_id: summary.workspace_id ?? workspaceId,
        workspace_name: summary.workspace_name ?? null,
        program_id: summary.program_id ?? null,
        program_name: summary.program_name ?? null,
      },
    };

    // ---- Resolve Tenant Microsoft Graph runtime + acquire token -----
    // Fail-closed BEFORE downloading the first external file and before
    // persisting a bundle that claims those files are included. Only
    // resolve when the bundle includes external evidence requiring
    // download. If resolution fails we return a safe error and do NOT
    // silently write a partial bundle.
    let graphAccessToken: string | null = null;
    let graphRequestId: string | null = null;
    if (includedEvidenceFiles.length > 0) {
      const gr = await resolveAndAcquireTenantMicrosoftGraph({
        organizationId: organizationId,
        functionName: "generate-decision-case-data-package-bundle",
        reason: "decision-case-data-package-evidence-read",
      });
      if (!gr.ok) {
        return json(200, {
          ok: false,
          bundle_status: "failed",
          error: gr.publicError.error,
          note: gr.publicError.note,
        });
      }
      graphAccessToken = gr.accessToken;
      graphRequestId = gr.requestId;
    }


    const zipEntries: Record<string, Uint8Array> = {};
    const evidenceManifestEntries: any[] = [];
    const indexPackaged: any[] = [];
    const indexFailed: any[] = [];
    const dataQualityNotes: string[] = [];

    let totalBytesUsed = 0;
    let packagedCount = 0;
    let failedCount = 0;
    let metadataOnlyCount = includedManualRefs.length;

    const filesToProcess = includedEvidenceFiles.slice(0, MAX_FILES);
    if (includedEvidenceFiles.length > MAX_FILES) {
      dataQualityNotes.push(
        `Only the first ${MAX_FILES} selected SharePoint evidence files were considered (limit reached).`,
      );
      for (const f of includedEvidenceFiles.slice(MAX_FILES)) {
        failedCount++;
        indexFailed.push({
          evidence_file_id: f.id,
          title: f.evidence_title ?? null,
          original_file_name: f.file_name ?? null,
          failure_code: "max_files_exceeded",
          failure_message: "Skipped — bundle file count limit reached.",
        });
        evidenceManifestEntries.push(makeFailedManifestEntry(f, "max_files_exceeded",
          "Skipped — bundle file count limit reached."));
      }
    }

    const usedZipNames = new Set<string>();
    let evidenceSeq = 0;

    for (const f of filesToProcess) {
      evidenceSeq++;
      const driveId: string | null = f.drive_id ?? null;
      const itemId: string | null = f.item_id ?? null;
      const origName: string = String(f.file_name ?? "file");
      const declaredSize: number | null = typeof f.size_bytes === "number" ? f.size_bytes : null;

      if (!driveId || !itemId) {
        failedCount++;
        const reason = "missing_graph_identifiers";
        indexFailed.push({
          evidence_file_id: f.id, title: f.evidence_title ?? null,
          original_file_name: origName, failure_code: reason,
          failure_message: "Drive id or item id missing for evidence file.",
        });
        evidenceManifestEntries.push(makeFailedManifestEntry(f, reason,
          "Drive id or item id missing for evidence file."));
        continue;
      }
      if (!graphAccessToken) {
        // Defensive: unreachable when includedEvidenceFiles.length > 0
        // because Graph resolution failure already returned early.
        failedCount++;
        const reason = "graph_token_unavailable";
        indexFailed.push({
          evidence_file_id: f.id, title: f.evidence_title ?? null,
          original_file_name: origName, failure_code: reason,
          failure_message: "SharePoint access token unavailable.",
        });
        evidenceManifestEntries.push(makeFailedManifestEntry(f, reason,
          "SharePoint access token unavailable."));
        continue;
      }

      if (declaredSize !== null && declaredSize > MAX_FILE_BYTES) {
        failedCount++;
        const reason = "file_too_large";
        indexFailed.push({
          evidence_file_id: f.id, title: f.evidence_title ?? null,
          original_file_name: origName, failure_code: reason,
          failure_message: `File exceeds per-file limit of ${MAX_FILE_BYTES} bytes.`,
        });
        evidenceManifestEntries.push(makeFailedManifestEntry(f, reason,
          `File exceeds per-file limit of ${MAX_FILE_BYTES} bytes.`));
        continue;
      }
      if (totalBytesUsed >= MAX_TOTAL_BYTES) {
        failedCount++;
        const reason = "bundle_size_limit_exceeded";
        indexFailed.push({
          evidence_file_id: f.id, title: f.evidence_title ?? null,
          original_file_name: origName, failure_code: reason,
          failure_message: "Total bundle size limit reached.",
        });
        evidenceManifestEntries.push(makeFailedManifestEntry(f, reason,
          "Total bundle size limit reached."));
        continue;
      }

      // Download bytes using the ONE Tenant Graph token acquired above.
      let bytes: Uint8Array | null = null;
      {
        const dl = await downloadMicrosoftGraphDriveItemBytes({
          accessToken: graphAccessToken,
          driveId,
          itemId,
          operation: "download_decision_case_bundle_file",
          requestId: graphRequestId ?? crypto.randomUUID(),
        });
        if (!dl.ok || !dl.bytes) {
          failedCount++;
          const reason = `graph_download_${dl.category}`;
          const safe = toSafeGraphRuntimeFilePublicError(dl.category);
          indexFailed.push({
            evidence_file_id: f.id, title: f.evidence_title ?? null,
            original_file_name: origName, failure_code: reason,
            failure_message: safe.note,
          });
          evidenceManifestEntries.push(makeFailedManifestEntry(f, reason, safe.note));
          continue;
        }
        bytes = dl.bytes;
      }


      if (bytes.byteLength > MAX_FILE_BYTES) {
        failedCount++;
        const reason = "file_too_large";
        indexFailed.push({
          evidence_file_id: f.id, title: f.evidence_title ?? null,
          original_file_name: origName, failure_code: reason,
          failure_message: `Downloaded file exceeds per-file limit.`,
        });
        evidenceManifestEntries.push(makeFailedManifestEntry(f, reason,
          "Downloaded file exceeds per-file limit."));
        continue;
      }
      if (totalBytesUsed + bytes.byteLength > MAX_TOTAL_BYTES) {
        failedCount++;
        const reason = "bundle_size_limit_exceeded";
        indexFailed.push({
          evidence_file_id: f.id, title: f.evidence_title ?? null,
          original_file_name: origName, failure_code: reason,
          failure_message: "Total bundle size limit would be exceeded.",
        });
        evidenceManifestEntries.push(makeFailedManifestEntry(f, reason,
          "Total bundle size limit would be exceeded."));
        continue;
      }

      // Build deterministic safe ZIP path
      const { base, ext } = splitExt(origName);
      let candidate = `evidence/${pad3(evidenceSeq)}-${base}${ext ? "." + ext : ""}`;
      let dedup = 1;
      while (usedZipNames.has(candidate)) {
        dedup++;
        candidate = `evidence/${pad3(evidenceSeq)}-${base}-${dedup}${ext ? "." + ext : ""}`;
      }
      usedZipNames.add(candidate);

      zipEntries[candidate] = bytes;
      totalBytesUsed += bytes.byteLength;
      packagedCount++;

      const sha = await sha256Hex(bytes);
      const packagedName = candidate.split("/").pop()!;

      evidenceManifestEntries.push({
        evidence_file_id: f.id,
        title: f.evidence_title ?? null,
        summary: f.evidence_summary ?? null,
        evidence_date: f.evidence_date ?? null,
        relevance_level: f.relevance_level ?? null,
        source_system: f.source_system ?? "sharepoint",
        retrieval_status: "packaged_file",
        bundle_file_path: candidate,
        file: {
          original_file_name: origName,
          packaged_file_name: packagedName,
          mime_type: f.mime_type ?? null,
          size_bytes: bytes.byteLength,
          sharepoint_last_modified_at: f.sharepoint_last_modified_at ?? null,
        },
        source_trace: {
          site_id_present: !!f.site_id,
          drive_id_present: !!f.drive_id,
          item_id_present: !!f.item_id,
          sharepoint_web_url: f.sharepoint_web_url ?? null,
        },
        failure: { code: null, message: null },
      });

      indexPackaged.push({
        evidence_file_id: f.id,
        title: f.evidence_title ?? null,
        bundle_file_path: candidate,
        original_file_name: origName,
        mime_type: f.mime_type ?? null,
        size_bytes: bytes.byteLength,
        sha256: sha,
      });
    }

    function makeFailedManifestEntry(f: any, code: string, message: string) {
      return {
        evidence_file_id: f.id,
        title: f.evidence_title ?? null,
        summary: f.evidence_summary ?? null,
        evidence_date: f.evidence_date ?? null,
        relevance_level: f.relevance_level ?? null,
        source_system: f.source_system ?? "sharepoint",
        retrieval_status: "retrieval_failed",
        bundle_file_path: null,
        file: {
          original_file_name: f.file_name ?? null,
          packaged_file_name: null,
          mime_type: f.mime_type ?? null,
          size_bytes: typeof f.size_bytes === "number" ? f.size_bytes : null,
          sharepoint_last_modified_at: f.sharepoint_last_modified_at ?? null,
        },
        source_trace: {
          site_id_present: !!f.site_id,
          drive_id_present: !!f.drive_id,
          item_id_present: !!f.item_id,
          sharepoint_web_url: f.sharepoint_web_url ?? null,
        },
        failure: { code, message },
      };
    }

    // ---- Manual references (metadata only) --------------------------------
    const manualManifestEntries = includedManualRefs.map((m) => ({
      reference_id: m.id,
      title: m.title ?? null,
      summary: m.summary ?? null,
      reference_type: m.evidence_type ?? "other_link",
      evidence_date: m.evidence_date ?? null,
      relevance_level: m.relevance_level ?? null,
      retrieval_status: "metadata_only",
      source_trace: { source_url: m.external_url ?? null },
    }));

    const indexMetadataOnly = manualManifestEntries.map((m) => ({
      reference_id: m.reference_id,
      title: m.title,
      reference_type: m.reference_type,
      source_url: m.source_trace.source_url,
    }));

    if (manualManifestEntries.length > 0) {
      const md = [
        "# Manual references",
        "",
        "These are metadata-only references. Original content was not packaged unless separately selected as a SharePoint evidence file.",
        "",
        ...manualManifestEntries.map((m, i) => {
          const lines = [
            `## ${i + 1}. ${m.title ?? "(untitled)"}`,
            `- Reference type: ${m.reference_type}`,
            `- Relevance: ${m.relevance_level ?? "—"}`,
            `- Evidence date: ${m.evidence_date ?? "—"}`,
            `- Source URL: ${m.source_trace.source_url ?? "—"}`,
          ];
          if (m.summary) { lines.push(""); lines.push(m.summary); }
          return lines.join("\n");
        }),
      ].join("\n");
      zipEntries["manual-references/manual-references.md"] = strToU8(md);
    }

    // ---- BTPM context snapshots -------------------------------------------
    const btpmContextSources: any[] = [];
    const btpmGroups = new Map<string, any>();
    for (const l of includedBtpmLinks) {
      const key = l.source_project_id;
      if (!btpmGroups.has(key)) {
        btpmGroups.set(key, {
          source_project: {
            id: l.source_project_id,
            name: l.source_project_name ?? null,
            workspace_id: l.source_workspace_id,
            workspace_name: l.source_workspace_name ?? null,
            program_id: l.source_program_id ?? null,
            program_name: l.source_program_name ?? null,
          },
          selected_objects: [] as any[],
        });
      }
    }

    let ctxSeq = 0;
    for (const l of includedBtpmLinks) {
      ctxSeq++;
      const group = btpmGroups.get(l.source_project_id);
      const ctxObj: any = {
        context_link_id: l.id,
        object_type: l.object_type,
        object_id: l.object_id,
        object_name: l.object_name ?? null,
        object_status: l.object_status ?? null,
        relationship_type: l.relationship_type,
        relevance_level: l.relevance_level,
        context_reason: l.context_reason ?? null,
        included_in_package: true,
        source_project: group.source_project,
      };
      group.selected_objects.push(ctxObj);

      const { base } = splitExt(`${l.object_type}-${l.object_name ?? l.object_id}`);
      const fname = `btpm-context/${pad3(ctxSeq)}-${base}`;
      zipEntries[`${fname}.json`] = strToU8(JSON.stringify(ctxObj, null, 2));
      const md = [
        `# ${l.object_type}: ${l.object_name ?? l.object_id}`,
        ``,
        `- Source project: ${l.source_project_name ?? l.source_project_id}`,
        `- Workspace: ${l.source_workspace_name ?? l.source_workspace_id}`,
        `- Program: ${l.source_program_name ?? "—"}`,
        `- Status: ${l.object_status ?? "—"}`,
        `- Relationship: ${l.relationship_type ?? "—"}`,
        `- Relevance: ${l.relevance_level ?? "—"}`,
        ``,
        l.context_reason ? `## Context reason\n\n${l.context_reason}` : "",
      ].join("\n");
      zipEntries[`${fname}.md`] = strToU8(md);
    }
    for (const g of btpmGroups.values()) btpmContextSources.push(g);

    // ---- Stakeholder package + outcome ------------------------------------
    const currentSP = stakeholderPackages.find((p) => p?.is_current) ?? null;
    const currentStakeholderPackage = currentSP ? {
      version_number: currentSP.version_number,
      status: currentSP.package_status,
      package_title: currentSP.package_title ?? null,
      audience: currentSP.audience_text ?? null,
      executive_summary: currentSP.executive_summary ?? null,
      decision_question: currentSP.decision_question_text ?? null,
      background_context: currentSP.background_context ?? null,
      options_summary: currentSP.options_summary ?? null,
      recommendation: currentSP.recommendation_text ?? null,
      decision_ask: currentSP.decision_ask_text ?? null,
      evidence_summary: currentSP.evidence_summary ?? null,
      guardrails: currentSP.guardrails_text ?? null,
      residual_risks: currentSP.residual_risks_text ?? null,
      next_steps: currentSP.next_steps_text ?? null,
    } : null;

    const formalDecisionOutcome = outcome ? {
      decision_result: outcome.decision_result,
      final_decision_text: outcome.final_decision_text,
      decision_date: outcome.decision_date,
      decided_by: outcome.decided_by_text ?? null,
      approval_forum: outcome.approval_forum ?? null,
      decision_rationale: outcome.decision_rationale ?? null,
      conditions_guardrails: outcome.conditions_guardrails ?? null,
      residual_risks: outcome.residual_risks ?? null,
      follow_up_actions: outcome.follow_up_actions ?? null,
      signoff_status: outcome.signoff_status ?? null,
    } : null;

    // ---- Quality notes ----------------------------------------------------
    if (includedEvidenceFiles.length === 0) {
      dataQualityNotes.push("No SharePoint evidence files were selected for packaging.");
    }
    if (packagedCount === 0 && includedEvidenceFiles.length > 0) {
      dataQualityNotes.push("No SharePoint evidence files were successfully packaged.");
    }
    if (failedCount > 0) {
      dataQualityNotes.push(`${failedCount} SharePoint evidence file(s) could not be packaged. See evidence-index.json.`);
    }
    if (includedBtpmLinks.length === 0) dataQualityNotes.push("No BTPM context objects included.");
    if (!currentStakeholderPackage) dataQualityNotes.push("No current stakeholder package exists.");
    if (!formalDecisionOutcome) dataQualityNotes.push("No formal decision outcome recorded yet.");

    // ---- AI.7.5a — Enrichment: brief versions, AI runs, generated docs ----
    const [briefVersionsRes, aiRunsRes, aiRunFilesRes, generatedDocsRes] =
      await Promise.all([
        userClient.rpc("list_governance_record_brief_versions", { _record_id: recordId }),
        userClient.rpc("list_decision_case_ai_runs", { _record_id: recordId }),
        admin.from("decision_case_ai_run_files")
          .select("id, ai_run_id, evidence_file_id, attachment_alias, status, input_kind, file_extension, mime_type, size_bytes, skip_reason, error_code, created_at")
          .eq("governance_record_id", recordId)
          .order("created_at", { ascending: false }),
        admin.from("generated_operational_documents")
          .select("id, document_type, generation_status, output_filename, generated_at, sharepoint_publish_status, sharepoint_web_url, source_snapshot_at, error_note")
          .eq("governance_record_id", recordId)
          .order("generated_at", { ascending: false }),
      ]);

    const briefVersions: any[] = (briefVersionsRes.data as any[]) ?? [];
    const aiRuns: any[] = (aiRunsRes.data as any[]) ?? [];
    const aiRunFiles: any[] = (aiRunFilesRes.data as any[]) ?? [];
    const generatedDocs: any[] = (generatedDocsRes.data as any[]) ?? [];

    // Current brief version (full structured fields)
    const currentBrief = briefVersions.find((v) => v?.is_current) ?? null;
    const currentDecisionBrief = currentBrief ? {
      brief_version_id: currentBrief.id,
      version_number: currentBrief.version_number,
      source_type: currentBrief.source_type,
      is_current: true,
      created_at: currentBrief.created_at,
      created_by: currentBrief.created_by ?? null,
      edited_brief_text: currentBrief.edited_brief_text ?? null,
      executive_intro_text: currentBrief.executive_intro_text ?? null,
      options_summary: currentBrief.options_summary ?? null,
      recommendation_text: currentBrief.recommendation_text ?? null,
      guardrails_text: currentBrief.guardrails_text ?? null,
      residual_risks_text: currentBrief.residual_risks_text ?? null,
      requested_decision_text: currentBrief.requested_decision_text ?? null,
      open_questions_text: currentBrief.open_questions_text ?? null,
      confidence_level: currentBrief.confidence_level ?? null,
      decision_readiness: currentBrief.decision_readiness ?? null,
    } : null;

    const briefVersionsSummary = briefVersions.map((v) => ({
      brief_version_id: v.id,
      version_number: v.version_number,
      source_type: v.source_type,
      is_current: !!v.is_current,
      created_at: v.created_at,
      confidence_level: v.confidence_level ?? null,
      decision_readiness: v.decision_readiness ?? null,
      edited_brief_text: v.edited_brief_text ?? null,
      recommendation_text: v.recommendation_text ?? null,
      requested_decision_text: v.requested_decision_text ?? null,
      guardrails_text: v.guardrails_text ?? null,
      residual_risks_text: v.residual_risks_text ?? null,
      open_questions_text: v.open_questions_text ?? null,
    }));

    // AI runs — latest run full metadata + history summary
    const latestRun = aiRuns[0] ?? null;
    function countByKind(runId: string | null, predicate: (f: any) => boolean): number {
      return aiRunFiles.filter((f) => (!runId || f.ai_run_id === runId) && predicate(f)).length;
    }
    function isEmailEvidence(f: any): boolean {
      const ext = String(f?.file_extension ?? "").toLowerCase().replace(/^\./, "");
      const mime = String(f?.mime_type ?? "").toLowerCase();
      return ext === "eml" || mime === "message/rfc822";
    }
    function buildRunMetadata(r: any) {
      if (!r) return null;
      const runId = r.id;
      // AI.7.5b — count using actual stored input_kind values (input_file/input_image);
      // treat .eml/message/rfc822 as email text even when stored as input_file.
      const fileInput = countByKind(runId, (f) =>
        f.status === "sent" && f.input_kind === "input_file" && !isEmailEvidence(f));
      const imageInput = countByKind(runId, (f) =>
        f.status === "sent" && f.input_kind === "input_image");
      const emailText = countByKind(runId, (f) =>
        f.status === "sent" && isEmailEvidence(f));
      const skipped = countByKind(runId, (f) => f.status !== "sent");
      return {
        ai_run_id: runId,
        status: r.status,
        run_type: r.run_type,
        model_id: r.model_id ?? null,
        model_provider: r.model_provider ?? null,
        model_source: r.model_source ?? null,
        template_id: r.template_id ?? null,
        template_version: r.template_version ?? null,
        reasoning_effort: r.reasoning_effort ?? null,
        started_at: r.started_at ?? null,
        completed_at: r.completed_at ?? null,
        saved_at: r.saved_at ?? null,
        discarded_at: r.discarded_at ?? null,
        files_selected_count: r.files_selected_count ?? 0,
        files_sent_count: r.files_sent_count ?? 0,
        files_skipped_count: r.files_skipped_count ?? 0,
        evidence_handling: {
          file_input_count: fileInput,
          image_input_count: imageInput,
          email_text_count: emailText,
          skipped_count: skipped,
        },
        input_package_hash: r.input_package_hash ?? null,
        output_hash: r.output_hash ?? null,
        brief_version_id: r.brief_version_id ?? null,
        error_code: r.error_code ?? null,
      };
    }
    const latestAiRun = buildRunMetadata(latestRun);
    const aiRunHistorySummary = {
      run_count: aiRuns.length,
      runs: aiRuns.slice(0, 25).map((r) => ({
        ai_run_id: r.id,
        status: r.status,
        started_at: r.started_at,
        completed_at: r.completed_at ?? null,
        saved_at: r.saved_at ?? null,
        discarded_at: r.discarded_at ?? null,
        model_id: r.model_id ?? null,
        brief_version_id: r.brief_version_id ?? null,
      })),
    };

    // Evidence handling summary (latest run, derived from run files)
    const evidenceProcessingSummary = latestRun ? {
      ai_run_id: latestRun.id,
      sent_count: aiRunFiles.filter((f) => f.ai_run_id === latestRun.id && f.status === "sent").length,
      skipped_count: aiRunFiles.filter((f) => f.ai_run_id === latestRun.id && f.status !== "sent").length,
      files: aiRunFiles.filter((f) => f.ai_run_id === latestRun.id).map((f) => ({
        evidence_file_id: f.evidence_file_id ?? null,
        attachment_alias: f.attachment_alias ?? null,
        status: f.status,
        input_kind: f.input_kind ?? null,
        file_extension: f.file_extension ?? null,
        mime_type: f.mime_type ?? null,
        size_bytes: f.size_bytes ?? null,
        skip_reason: f.skip_reason ?? null,
      })),
    } : null;

    // Generated documents (metadata only)
    const generatedDocumentsSection = generatedDocs.map((d) => ({
      id: d.id,
      document_type: d.document_type,
      generation_status: d.generation_status,
      output_filename: d.output_filename,
      generated_at: d.generated_at,
      source_snapshot_at: d.source_snapshot_at,
      sharepoint_publish_status: d.sharepoint_publish_status ?? null,
      sharepoint_web_url: d.sharepoint_web_url ?? null,
      error_note: d.error_note ?? null,
    }));

    // Lifecycle
    const lifecycle = {
      decision_stage: detail.decision_stage ?? null,
      has_current_decision_brief: !!currentDecisionBrief,
      has_stakeholder_package: stakeholderPackages.length > 0,
      stakeholder_package_provided:
        !!stakeholderPackages.find((p) => p?.package_status === "provided"),
      has_decision_outcome: !!formalDecisionOutcome,
      is_closed: !!(outcome?.decision_date) ||
        (detail?.decision_stage && String(detail.decision_stage).toLowerCase().includes("closed")),
      target_decision_date: detail.target_decision_date ?? null,
      decision_date: outcome?.decision_date ?? null,
    };

    // Audit summary counts
    const auditSummary = {
      evidence_file_count: evidenceFiles.length,
      included_evidence_file_count: includedEvidenceFiles.length,
      manual_reference_count: manualRefs.length,
      included_manual_reference_count: includedManualRefs.length,
      btpm_context_count: btpmList.length,
      included_btpm_context_count: includedBtpmLinks.length,
      stakeholder_count: stakeholders.length,
      brief_version_count: briefVersions.length,
      ai_run_count: aiRuns.length,
      stakeholder_package_count: stakeholderPackages.length,
      generated_document_count: generatedDocs.length,
      decision_outcome_present: !!formalDecisionOutcome,
      closed: lifecycle.is_closed,
    };

    // Additional data quality notes
    if (!currentDecisionBrief) dataQualityNotes.push("No current Decision Brief exists yet.");
    if (stakeholdersRpcFailed) dataQualityNotes.push("Project stakeholders could not be loaded for the Case Package.");
    if (aiRuns.length === 0) dataQualityNotes.push("No AI generation run has been completed yet.");
    if (!lifecycle.has_stakeholder_package) dataQualityNotes.push("No Stakeholder Package exists yet.");
    if (!lifecycle.has_decision_outcome) dataQualityNotes.push("No formal decision outcome recorded yet.");
    if (!lifecycle.is_closed) dataQualityNotes.push("Case is not closed yet.");
    dataQualityNotes.push("Evidence source files remain in SharePoint; package contains metadata and references, not raw file bytes outside the packaged evidence/ folder.");
    dataQualityNotes.push("OneNote content is not extracted unless exported as a supported file and selected as evidence.");
    if (btpmList.length > includedBtpmLinks.length) {
      dataQualityNotes.push("Some BTPM context was excluded from the package by user selection.");
    }

    const snapshotAt = new Date().toISOString();
    const bundleStatus: "generated" | "partial" =
      failedCount > 0 ? "partial" : "generated";

    // ---- Build manifest (v2.0; AI.7.5a package_version 2) -----------------
    const bundleFilename = `decision-case-package-${(decisionCase.title ? safeBaseName(decisionCase.title) : recordId).slice(0, 60)}-bundle.zip`;

    const manifest = {
      // Legacy identity (preserved for compatibility)
      schema_version: "2.0",
      package_type: "decision_case_bundle",
      // AI.7.5a — user-facing identity
      display_package_type: "decision_case_package",
      package_version: 2,
      generated_by: "BTPM",
      generated_at: new Date().toISOString(),
      source_snapshot_at: snapshotAt,
      bundle: {
        bundle_filename: bundleFilename,
        bundle_hash: "",            // filled after ZIP build
        bundle_status: bundleStatus,
        evidence_file_count: includedEvidenceFiles.length,
        packaged_file_count: packagedCount,
        failed_file_count: failedCount,
        metadata_only_count: metadataOnlyCount,
      },
      // Legacy top-level fields (kept for backward compatibility)
      decision_case: decisionCase,
      evidence_files: evidenceManifestEntries,
      manual_references: manualManifestEntries,
      btpm_context: { sources: btpmContextSources },
      current_stakeholder_package: currentStakeholderPackage,
      formal_decision_outcome: formalDecisionOutcome,

      // AI.7.5a — new structured sections
      project_context: {
        organization_id: organizationId,
        workspace_id: summary.workspace_id ?? workspaceId,
        workspace_name: summary.workspace_name ?? null,
        program_id: summary.program_id ?? null,
        program_name: summary.program_name ?? null,
        project_id: summary.project_id ?? projectId,
        project_name: summary.project_name ?? null,
      },
      inputs: {
        evidence_files: evidenceManifestEntries,
        manual_references: manualManifestEntries,
        btpm_context: { sources: btpmContextSources },
        stakeholders: stakeholders.map((s) => ({
          id: s.id,
          display_name: s.display_name ?? null,
          external_name: s.external_name ?? null,
          stakeholder_type: s.stakeholder_type ?? null,
          role_label: s.role_label ?? null,
          notes: s.notes ?? null,
          start_date: s.start_date ?? null,
          user_id: s.user_id ?? null,
          is_decision_owner: s.id === detail.decision_owner_stakeholder_id,
        })),
      },
      ai_processing: {
        latest_run: latestAiRun,
        run_history_summary: aiRunHistorySummary,
        evidence_processing_summary: evidenceProcessingSummary,
      },
      outputs: {
        current_decision_brief: currentDecisionBrief,
        brief_versions: briefVersionsSummary,
        stakeholder_package: currentStakeholderPackage,
        decision_outcome: formalDecisionOutcome,
        closure: outcome ? {
          decision_date: outcome.decision_date ?? null,
          signoff_status: outcome.signoff_status ?? null,
          follow_up_actions: outcome.follow_up_actions ?? null,
        } : null,
      },
      lifecycle,
      audit_summary: auditSummary,
      generated_documents: generatedDocumentsSection,
      data_quality_notes: dataQualityNotes,
    };

    const evidenceIndex = {
      schema_version: "1.0",
      generated_by: "BTPM",
      source_snapshot_at: snapshotAt,
      packaged_files: indexPackaged,
      metadata_only_references: indexMetadataOnly,
      failed_files: indexFailed,
    };

    // README — descriptive only, no Copilot prompt instructions
    const readme = [
      `BTPM Decision Case Package`,
      ``,
      `Decision case: ${decisionCase.title ?? "(untitled)"}`,
      `Generated: ${snapshotAt}`,
      ``,
      `Contents:`,
      `  decision-data-package.json   Structured manifest (schema 2.0)`,
      `  evidence-index.json          File-to-source map`,
      `  evidence/                    Packaged SharePoint evidence files`,
      `  btpm-context/                JSON + Markdown snapshots of linked BTPM objects`,
      `  manual-references/           Metadata-only references (when present)`,
      ``,
      `SharePoint links inside the manifest are traceability only.`,
      `Packaged file bytes live inside this ZIP under /evidence/.`,
      ``,
    ].join("\n");

    // Hash manifest deterministically BEFORE the ZIP is finalized
    const manifestCanonical = stableStringify(manifest);
    const packageHash = await sha256Hex(manifestCanonical);

    zipEntries["decision-data-package.json"] = strToU8(manifestCanonical);
    zipEntries["evidence-index.json"] = strToU8(stableStringify(evidenceIndex));
    zipEntries["README.txt"] = strToU8(readme);

    // Build ZIP
    let zipBytes: Uint8Array;
    try {
      zipBytes = zipSync(zipEntries, { level: 6 });
    } catch (e) {
      return json(500, { ok: false, error: "zip_build_failed", note: String((e as any)?.message ?? e) });
    }
    const bundleHash = await sha256Hex(zipBytes);

    // Patch bundle_hash inside manifest entry inside the ZIP would change
    // the ZIP hash; instead we record bundle_hash only in the DB row.
    // The manifest within the ZIP keeps bundle_hash empty by design.

    // ---- Storage upload ---------------------------------------------------
    const packageId = crypto.randomUUID();
    const storagePath = `${userId}/decision-case-bundles/${packageId}/bundle.zip`;

    const upload = await admin.storage.from(BUNDLE_BUCKET).upload(
      storagePath,
      new Blob([new Uint8Array(zipBytes)], { type: "application/zip" }),
      { contentType: "application/zip", upsert: false },
    );
    if (upload.error) {
      return json(500, { ok: false, error: "bundle_upload_failed", note: upload.error.message });
    }

    // ---- Determine next version + demote previous current -----------------
    const { data: maxRow } = await admin
      .from("governance_record_copilot_data_packages")
      .select("version_number")
      .eq("governance_record_id", recordId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = ((maxRow as any)?.version_number ?? 0) + 1;

    await admin
      .from("governance_record_copilot_data_packages")
      .update({ is_current: false, package_status: "superseded" })
      .eq("governance_record_id", recordId)
      .eq("is_current", true);

    const packageFilename = `${(decisionCase.title ? safeBaseName(decisionCase.title) : recordId).slice(0, 60)}-v${nextVersion}.json`;

    const { error: insErr } = await admin
      .from("governance_record_copilot_data_packages")
      .insert({
        id: packageId,
        organization_id: organizationId,
        workspace_id: workspaceId,
        project_id: projectId,
        governance_record_id: recordId,
        version_number: nextVersion,
        is_current: true,
        package_status: "prepared",
        package_filename: packageFilename,
        package_json: manifestCanonical,
        package_hash: packageHash,
        source_project_ids: sourceProjectIds,
        source_snapshot_at: snapshotAt,
        created_by: userId,
        // DC.16 bundle fields
        package_format: "zip_bundle",
        bundle_status: bundleStatus,
        bundle_storage_bucket: BUNDLE_BUCKET,
        bundle_storage_path: storagePath,
        bundle_filename: bundleFilename,
        bundle_mime_type: "application/zip",
        bundle_size_bytes: zipBytes.byteLength,
        bundle_hash: bundleHash,
        bundle_generated_at: snapshotAt,
        bundle_file_count: includedEvidenceFiles.length,
        bundle_packaged_file_count: packagedCount,
        bundle_failed_file_count: failedCount,
        bundle_metadata_only_count: metadataOnlyCount,
      } as any);

    if (insErr) {
      // Clean up uploaded object since DB insert failed
      await admin.storage.from(BUNDLE_BUCKET).remove([storagePath]).catch(() => {});
      return json(500, { ok: false, error: "insert_failed", note: insErr.message });
    }

    try {
      await admin.rpc("log_activity_event", {
        _organization_id: organizationId,
        _user_id: userId,
        _event_type: "governance_record_copilot_data_package_bundle_generated",
        _target_type: "governance_record",
        _target_id: recordId,
        _metadata: {
          project_id: projectId,
          data_package_id: packageId,
          version_number: nextVersion,
          package_hash: packageHash,
          bundle_hash: bundleHash,
          bundle_status: bundleStatus,
          bundle_size_bytes: zipBytes.byteLength,
          packaged_file_count: packagedCount,
          failed_file_count: failedCount,
        },
        _workspace_id: workspaceId,
      } as any);
    } catch (_) { /* non-fatal */ }

    return json(200, {
      ok: true,
      package_id: packageId,
      version_number: nextVersion,
      package_filename: packageFilename,
      package_hash: packageHash,
      bundle_filename: bundleFilename,
      bundle_hash: bundleHash,
      bundle_size_bytes: zipBytes.byteLength,
      bundle_status: bundleStatus,
      bundle_file_count: includedEvidenceFiles.length,
      bundle_packaged_file_count: packagedCount,
      bundle_failed_file_count: failedCount,
      bundle_metadata_only_count: metadataOnlyCount,
      source_snapshot_at: snapshotAt,
    });
  } catch (e) {
    return json(500, { ok: false, error: "unhandled", note: String((e as any)?.message ?? e) });
  }
});
