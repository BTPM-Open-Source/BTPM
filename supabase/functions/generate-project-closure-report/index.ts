// Phase 4D.14A.7E — Generate Project Closure Report (.docx) and publish
// via the effective Organization-aware Tenant SharePoint + Microsoft
// Graph integrations. Runtime ordering matches Project Charter.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { mapProjectToClosureReportData } from "./dataMapper.ts";
import {
  buildClosureReportDocxBuffer,
  closureReportFilenameFor,
} from "./closureReportTemplate.ts";
import {
  createTenantSharePointPublishSession,
  publishGeneratedDocumentBytes,
  resolveProjectDocumentPublishTarget,
} from "../_shared/sharePointGeneratedDocumentPublisher.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const FUNCTION_NAME = "generate-project-closure-report";

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
    if (!authHeader) return json(401, { error: "Missing authorization" });

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
    if (userErr || !userData?.user) return json(401, { error: "Not authenticated" });

    const body = await req.json().catch(() => ({}));
    const projectId: string | undefined = body?.projectId;
    if (!projectId || typeof projectId !== "string") {
      return json(400, { error: "projectId required" });
    }

    const { data: project } = await adminClient
      .from("projects")
      .select("id, workspace_id, organization_id")
      .eq("id", projectId)
      .maybeSingle();
    if (!project) return json(403, { error: "not_authorized" });
    if (!project.organization_id || !project.workspace_id) {
      return json(403, { error: "not_authorized" });
    }

    // Authority BEFORE runtime.
    {
      const { data: authorized, error: authErr } = await adminClient.rpc(
        "has_project_pm_authority",
        { _user_id: userData.user.id, _project_id: projectId },
      );
      if (authErr) return json(500, { error: "authority_check_failed" });
      if (authorized !== true) {
        return json(403, {
          error: "not_authorized",
          note:
            "You do not have authority to generate the Project Closure Report for this project.",
        });
      }
    }

    // Map canonical data (service role — authority already enforced).
    let mapping;
    try {
      mapping = await mapProjectToClosureReportData(
        adminClient,
        projectId,
        userData.user.id,
      );
    } catch (e) {
      return json(404, {
        error: "project_not_accessible",
        note: (e as Error).message,
      });
    }
    const { data: reportData, snapshotAt, workspaceId } = mapping;
    if (workspaceId !== project.workspace_id) {
      logSafe("workspace_scope_mismatch", { request_id: requestId });
      return json(403, { error: "not_authorized" });
    }

    // Bindings + containment.
    const { data: wsBinding } = await adminClient
      .from("sharepoint_workspace_bindings")
      .select("id, workspace_id, organization_id, binding_status, site_web_url, library_web_url")
      .eq("workspace_id", project.workspace_id)
      .maybeSingle();
    if (!wsBinding) {
      return json(412, {
        error: "workspace_library_missing",
        note: "This workspace is not linked to a SharePoint document library yet.",
      });
    }
    if (wsBinding.binding_status !== "validated") {
      return json(412, {
        error: "workspace_library_not_validated",
        note: "The workspace SharePoint library is not validated.",
      });
    }
    if (
      wsBinding.workspace_id !== project.workspace_id ||
      wsBinding.organization_id !== project.organization_id
    ) {
      return json(403, { error: "not_authorized" });
    }

    const { data: projectBinding } = await adminClient
      .from("sharepoint_project_bindings")
      .select(
        "id, project_id, workspace_id, organization_id, binding_status, folder_web_url, folder_item_id, resolved_library_web_url",
      )
      .eq("project_id", projectId)
      .neq("binding_status", "disabled")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!projectBinding) {
      return json(412, {
        error: "project_folder_missing",
        note:
          "Project SharePoint folder is not linked. Link the project folder before generating the Closure Report.",
      });
    }
    if (projectBinding.binding_status === "disabled") {
      return json(412, {
        error: "project_folder_disabled",
        note: "The SharePoint folder link for this project is disabled.",
      });
    }
    if (projectBinding.binding_status !== "validated") {
      return json(412, {
        error: "project_folder_not_validated",
        note:
          "Project SharePoint folder is not validated. Validate the project folder before generating the Closure Report.",
      });
    }
    if (
      projectBinding.project_id !== project.id ||
      projectBinding.workspace_id !== project.workspace_id ||
      projectBinding.organization_id !== project.organization_id
    ) {
      return json(403, { error: "not_authorized" });
    }

    // Build .docx.
    const filename = closureReportFilenameFor(reportData.project.name);
    let bytes: Uint8Array;
    try {
      bytes = await buildClosureReportDocxBuffer(reportData);
    } catch (e) {
      const note = (e as Error).message || "Document generation failed.";
      await supabase.rpc("record_generated_operational_document", {
        _project_id: projectId,
        _document_type: "project_closure_report",
        _generation_status: "generation_failed",
        _output_filename: filename,
        _source_snapshot_at: snapshotAt,
        _publish_status: "not_published",
        _sharepoint_item_id: null as unknown as string,
        _sharepoint_web_url: null as unknown as string,
        _error_note: note.slice(0, 500),
      });
      return json(500, { error: "generation_failed", note });
    }

    // Publish session + upload.
    const sessionRes = await createTenantSharePointPublishSession({
      organizationId: project.organization_id,
      functionName: FUNCTION_NAME,
      reason: "project-closure-report-sharepoint-publish",
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
      logSafe("publish_session_failed", { request_id: requestId, result: publicErrorCode });
    } else {
      const targetRes = await resolveProjectDocumentPublishTarget({
        session: sessionRes.session,
        projectBinding,
      });
      if (!targetRes.ok) {
        publicErrorCode = targetRes.publicError.error;
        publicErrorNote = targetRes.publicError.note;
        errorNote = targetRes.publicError.auditNote.slice(0, 500);
        logSafe("publish_target_failed", { request_id: requestId, result: publicErrorCode });
      } else {
        const upl = await publishGeneratedDocumentBytes({
          session: sessionRes.session,
          target: targetRes.target,
          fileName: filename,
          bytes,
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          operation: "publish_project_closure_report",
        });
        if (upl.ok) {
          publishStatus = "published";
          itemId = upl.item.itemId;
          webUrl = upl.item.webUrl;
          logSafe("publish_ok", { request_id: requestId });
        } else {
          publicErrorCode = upl.publicError.error;
          publicErrorNote = upl.publicError.note;
          errorNote = upl.publicError.auditNote.slice(0, 500);
          logSafe("publish_upload_failed", { request_id: requestId, result: publicErrorCode });
        }
      }
    }

    const { error: auditErr } = await supabase.rpc(
      "record_generated_operational_document",
      {
        _project_id: projectId,
        _document_type: "project_closure_report",
        _generation_status: "generated_local",
        _output_filename: filename,
        _source_snapshot_at: snapshotAt,
        _publish_status: publishStatus,
        _sharepoint_item_id: itemId as unknown as string,
        _sharepoint_web_url: webUrl as unknown as string,
        _error_note: errorNote,
      },
    );
    if (auditErr) {
      return json(403, {
        error: auditErr.message || "Failed to record generated document history",
      });
    }

    if (publishStatus !== "published") {
      return json(502, {
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
      project_portfolio: {
        portfolio_item_id: reportData.project.portfolioItemId,
        portfolio_name: reportData.project.portfolioName,
        portfolio_code: reportData.project.portfolioCode,
        portfolio_lifecycle_state: reportData.project.portfolioLifecycleState,
        portfolio_is_archived: reportData.project.portfolioIsArchived,
        portfolio_label: reportData.project.portfolioLabel,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    logSafe("unhandled_error", { request_id: requestId });
    return json(500, { error: msg });
  }
});
