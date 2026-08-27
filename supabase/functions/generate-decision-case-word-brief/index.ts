// Phase 4D.14A.7E — Generate Decision Case Word Brief (.docx) and publish
// via the effective Organization-aware Tenant SharePoint + Microsoft
// Graph integrations.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import {
  mapDecisionCaseToBriefData,
  decisionBriefFilenameFor,
  MapError,
} from "./dataMapper.ts";
import { buildDecisionBriefDocxBuffer } from "./decisionBriefTemplate.ts";
import {
  createTenantSharePointPublishSession,
  publishGeneratedDocumentBytes,
  resolveProjectDocumentPublishTarget,
} from "../_shared/sharePointGeneratedDocumentPublisher.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const FUNCTION_NAME = "generate-decision-case-word-brief";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function logSafe(event: string, fields: Record<string, unknown>) {
  console.log(
    `[${FUNCTION_NAME}] ${event}`,
    JSON.stringify({ component: FUNCTION_NAME, ...fields }),
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const requestId = crypto.randomUUID();
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { ok: false, error: "missing_authorization" });

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    try {
      const verifier = createSupabaseTokenVerifier(supabase);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return json(401, { ok: false, error: "not_authenticated" });

    const body = await req.json().catch(() => ({}));
    const recordId: string | undefined = body?.recordId;
    const overwriteExisting: boolean = body?.overwriteExisting === true;
    if (!recordId || typeof recordId !== "string") {
      return json(400, { ok: false, error: "invalid_request", note: "recordId required" });
    }

    // Load governance record.
    const { data: recordRow, error: recErr } = await adminClient
      .from("governance_records")
      .select("id, project_id, organization_id, workspace_id, record_kind")
      .eq("id", recordId)
      .maybeSingle();
    if (recErr) return json(500, { ok: false, error: "record_lookup_failed", note: recErr.message });
    if (!recordRow) return json(404, { ok: false, error: "record_not_found" });
    if ((recordRow as any).record_kind !== "decision_case") {
      return json(400, { ok: false, error: "not_decision_case", note: "Record is not a decision case." });
    }
    const projectId: string = (recordRow as any).project_id;
    const recordOrgId: string | null = (recordRow as any).organization_id ?? null;
    const recordWsId: string | null = (recordRow as any).workspace_id ?? null;

    // Authoritative project row (Organization comes from the governance record).
    const { data: project } = await adminClient
      .from("projects")
      .select("id, workspace_id, organization_id")
      .eq("id", projectId)
      .maybeSingle();
    if (!project) return json(403, { ok: false, error: "not_authorized" });
    if (!project.organization_id || !project.workspace_id) {
      return json(403, { ok: false, error: "not_authorized" });
    }
    if (
      (recordOrgId && recordOrgId !== project.organization_id) ||
      (recordWsId && recordWsId !== project.workspace_id)
    ) {
      logSafe("record_project_scope_mismatch", { request_id: requestId });
      return json(403, { ok: false, error: "not_authorized" });
    }

    // Authority BEFORE runtime.
    const { data: authorized, error: authErr } = await adminClient.rpc(
      "has_project_pm_authority",
      { _user_id: userData.user.id, _project_id: projectId },
    );
    if (authErr) return json(500, { ok: false, error: "authority_check_failed" });
    if (authorized !== true) {
      return json(403, {
        ok: false,
        error: "not_authorized",
        note: "You do not have authority to generate the Decision Brief for this decision case.",
      });
    }

    // Overwrite guard.
    if (!overwriteExisting) {
      const { data: existing } = await adminClient
        .from("generated_operational_documents")
        .select(
          "id, output_filename, generated_at, sharepoint_web_url, sharepoint_publish_status, generation_status",
        )
        .eq("governance_record_id", recordId)
        .eq("document_type", "decision_case_word_brief")
        .eq("generation_status", "generated_local")
        .eq("sharepoint_publish_status", "published")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        return json(409, {
          ok: false,
          error: "existing_brief_conflict",
          note:
            "A Decision Brief has already been generated for this decision case. Confirm overwrite to regenerate.",
          existing: {
            generated_at: (existing as any).generated_at,
            output_filename: (existing as any).output_filename,
            sharepoint_web_url: (existing as any).sharepoint_web_url,
          },
        });
      }
    }

    // Map canonical data (C20B1-C1: caller-scoped browser client for protected
    // Governance/Project RPCs; admin client only for authorized direct reads).
    let mapping;
    try {
      mapping = await mapDecisionCaseToBriefData(supabase, adminClient, recordId, userData.user.id);
    } catch (e) {
      if (e instanceof MapError) {
        return json(e.status, { ok: false, error: e.code, note: e.message });
      }
      return json(500, { ok: false, error: "mapping_failed", note: (e as Error).message });
    }
    const { data: briefData, snapshotAt, workspaceId, packageVersionNumber } = mapping;
    if (workspaceId !== project.workspace_id) {
      return json(403, { ok: false, error: "not_authorized" });
    }

    // Bindings + containment.
    const { data: wsBinding } = await adminClient
      .from("sharepoint_workspace_bindings")
      .select("id, workspace_id, organization_id, binding_status, site_web_url, library_web_url")
      .eq("workspace_id", project.workspace_id)
      .maybeSingle();
    if (!wsBinding) {
      return json(412, { ok: false, error: "workspace_library_missing",
        note: "This workspace is not linked to a SharePoint document library yet." });
    }
    if ((wsBinding as any).binding_status !== "validated") {
      return json(412, { ok: false, error: "workspace_library_not_validated",
        note: "The workspace SharePoint library is not validated." });
    }
    if (
      wsBinding.workspace_id !== project.workspace_id ||
      wsBinding.organization_id !== project.organization_id
    ) {
      return json(403, { ok: false, error: "not_authorized" });
    }

    const { data: projectBinding } = await adminClient
      .from("sharepoint_project_bindings")
      .select("id, project_id, workspace_id, organization_id, binding_status, folder_web_url, folder_item_id, resolved_library_web_url")
      .eq("project_id", projectId)
      .neq("binding_status", "disabled")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!projectBinding) {
      return json(412, { ok: false, error: "project_folder_missing",
        note: "This project is not linked to a SharePoint folder yet." });
    }
    if ((projectBinding as any).binding_status === "disabled") {
      return json(412, { ok: false, error: "project_folder_disabled",
        note: "The SharePoint folder link for this project is disabled." });
    }
    if ((projectBinding as any).binding_status !== "validated") {
      return json(412, { ok: false, error: "project_folder_not_validated",
        note: "The SharePoint folder link for this project is not validated." });
    }
    if (
      projectBinding.project_id !== project.id ||
      projectBinding.workspace_id !== project.workspace_id ||
      projectBinding.organization_id !== project.organization_id
    ) {
      return json(403, { ok: false, error: "not_authorized" });
    }

    // Build .docx.
    const filename = decisionBriefFilenameFor(briefData.projectName, briefData.decisionCase.title);
    let bytes: Uint8Array;
    try {
      bytes = await buildDecisionBriefDocxBuffer(briefData);
    } catch (e) {
      const note = (e as Error).message || "Document generation failed.";
      await supabase.rpc("record_generated_decision_case_document", {
        _record_id: recordId,
        _document_type: "decision_case_word_brief",
        _generation_status: "generation_failed",
        _output_filename: filename,
        _source_snapshot_at: snapshotAt,
        _publish_status: "not_published",
        _sharepoint_item_id: null,
        _sharepoint_web_url: null,
        _error_note: note.slice(0, 500),
      });
      return json(500, { ok: false, error: "generation_failed", note });
    }

    // Publish session + upload.
    const sessionRes = await createTenantSharePointPublishSession({
      organizationId: project.organization_id,
      functionName: FUNCTION_NAME,
      reason: "decision-case-word-brief-sharepoint-publish",
      requestId,
    });

    let publishStatus: "published" | "publish_failed" = "publish_failed";
    let itemId: string | null = null;
    let webUrl: string | null = null;
    let errorNote: string | null = null;
    let publicErrorCode: string | null = null;
    let publicErrorNote: string | null = null;

    if (!sessionRes.ok) {
      publicErrorCode = sessionRes.publicError.error;
      publicErrorNote = sessionRes.publicError.note;
      errorNote = sessionRes.publicError.auditNote.slice(0, 500);
    } else {
      const targetRes = await resolveProjectDocumentPublishTarget({
        session: sessionRes.session,
        projectBinding,
      });
      if (!targetRes.ok) {
        publicErrorCode = targetRes.publicError.error;
        publicErrorNote = targetRes.publicError.note;
        errorNote = targetRes.publicError.auditNote.slice(0, 500);
      } else {
        const upl = await publishGeneratedDocumentBytes({
          session: sessionRes.session,
          target: targetRes.target,
          fileName: filename,
          bytes,
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          operation: "publish_decision_case_word_brief",
        });
        if (upl.ok) {
          publishStatus = "published";
          itemId = upl.item.itemId;
          webUrl = upl.item.webUrl;
        } else {
          publicErrorCode = upl.publicError.error;
          publicErrorNote = upl.publicError.note;
          errorNote = upl.publicError.auditNote.slice(0, 500);
        }
      }
    }

    const { error: auditErr } = await supabase.rpc(
      "record_generated_decision_case_document",
      {
        _record_id: recordId,
        _document_type: "decision_case_word_brief",
        _generation_status: "generated_local",
        _output_filename: filename,
        _source_snapshot_at: snapshotAt,
        _publish_status: publishStatus,
        _sharepoint_item_id: itemId,
        _sharepoint_web_url: webUrl,
        _error_note: errorNote,
      },
    );
    if (auditErr) {
      return json(403, { ok: false, error: "audit_failed", note: auditErr.message });
    }

    if (publishStatus !== "published") {
      return json(502, {
        ok: false,
        error: publicErrorCode ?? "publish_failed",
        note: publicErrorNote ?? "Publishing to SharePoint failed. Please try again in a moment.",
        filename,
      });
    }

    return json(200, {
      ok: true,
      filename,
      sharepoint_item_id: itemId,
      sharepoint_web_url: webUrl,
      generated_at: snapshotAt,
      source_snapshot_at: snapshotAt,
      package_version_number: packageVersionNumber,
      outcome_included: briefData.hasOutcome,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    logSafe("unhandled_error", { request_id: requestId });
    return json(500, { ok: false, error: "unhandled", note: msg });
  }
});
