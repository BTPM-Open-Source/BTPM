// Phase 4D.14A.7E — Generate Project Charter (.docx) and publish to the
// linked SharePoint project folder using the effective Organization-aware
// Tenant SharePoint + Microsoft Graph integrations.
//
// Runtime ordering (fixed):
//   1. authenticate caller
//   2. load authoritative project row (id, workspace_id, organization_id)
//   3. prove has_project_pm_authority BEFORE any Tenant secret or Graph call
//   4. overwrite guard (unless caller confirms)
//   5. map canonical BTPM data (RLS-safe RPCs)
//   6. load validated workspace + project SharePoint bindings and verify
//      strict workspace/organization containment
//   7. build .docx via the reusable template
//   8. createTenantSharePointPublishSession (one runtime, one Graph token)
//   9. resolveProjectDocumentPublishTarget (live folder resolution)
//   10. publishGeneratedDocumentBytes (PUT, conflictBehavior=replace)
//   11. record generated-document history
//   12. return existing response contract

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import { mapProjectToCharterData } from "./dataMapper.ts";
import { buildCharterDocxBuffer, charterFilenameFor } from "./charterTemplate.ts";
import {
  createTenantSharePointPublishSession,
  publishGeneratedDocumentBytes,
  resolveProjectDocumentPublishTarget,
} from "../_shared/sharePointGeneratedDocumentPublisher.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const FUNCTION_NAME = "generate-project-charter";

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
    const overwriteExisting: boolean = body?.overwriteExisting === true;
    if (!projectId || typeof projectId !== "string") {
      return json(400, { error: "projectId required" });
    }

    // ---- Load authoritative project row (organization + workspace) ----
    const { data: project } = await adminClient
      .from("projects")
      .select("id, workspace_id, organization_id")
      .eq("id", projectId)
      .maybeSingle();
    if (!project) return json(403, { error: "not_authorized" });
    if (!project.organization_id || !project.workspace_id) {
      logSafe("project_scope_missing", { request_id: requestId });
      return json(403, { error: "not_authorized" });
    }

    // ---- Authority gate (BEFORE any Tenant/Graph resolution) ----
    {
      const { data: authorized, error: authErr } = await adminClient.rpc(
        "has_project_pm_authority",
        { _user_id: userData.user.id, _project_id: projectId },
      );
      if (authErr) return json(500, { error: "authority_check_failed" });
      if (authorized !== true) {
        return json(403, {
          error: "not_authorized",
          note: "You do not have authority to generate the Project Charter for this project.",
        });
      }
    }

    // ---- Overwrite guard ----
    if (!overwriteExisting) {
      const { data: existing } = await adminClient
        .from("generated_operational_documents")
        .select("id, output_filename, generated_at, sharepoint_web_url, sharepoint_publish_status, generation_status")
        .eq("project_id", projectId)
        .eq("document_type", "project_overview_charter")
        .eq("generation_status", "generated_local")
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing && (existing as any).sharepoint_publish_status === "published") {
        return json(409, {
          error: "existing_charter_conflict",
          note: "A Project Charter has already been generated for this project. Confirm overwrite to regenerate.",
          existing: {
            generated_at: (existing as any).generated_at,
            output_filename: (existing as any).output_filename,
            sharepoint_web_url: (existing as any).sharepoint_web_url,
          },
        });
      }
    }

    // ---- Map canonical BTPM data (RLS-safe, user-scoped client) ----
    let mapping;
    try {
      mapping = await mapProjectToCharterData(supabase, projectId, userData.user.id);
    } catch (e) {
      return json(200, { ok: false, error: "project_not_accessible", note: (e as Error).message });
    }
    const { data: charterData, snapshotAt, workspaceId } = mapping;
    // Mapper workspace must match authoritative project workspace.
    if (workspaceId !== project.workspace_id) {
      logSafe("workspace_scope_mismatch", { request_id: requestId });
      return json(403, { error: "not_authorized" });
    }

    // ---- SharePoint bindings + containment ----
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
        note: "This project is not linked to a SharePoint folder yet.",
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
        note: "The SharePoint folder link for this project is not validated.",
      });
    }
    if (
      projectBinding.project_id !== project.id ||
      projectBinding.workspace_id !== project.workspace_id ||
      projectBinding.organization_id !== project.organization_id
    ) {
      return json(403, { error: "not_authorized" });
    }

    // ---- Build .docx ----
    const filename = charterFilenameFor(charterData.project.name);
    let bytes: Uint8Array;
    try {
      bytes = await buildCharterDocxBuffer(charterData);
    } catch (e) {
      const note = (e as Error).message || "Document generation failed.";
      await supabase.rpc("record_generated_operational_document", {
        _project_id: projectId,
        _document_type: "project_overview_charter",
        _generation_status: "generation_failed",
        _output_filename: filename,
        _source_snapshot_at: snapshotAt,
        _publish_status: "not_published",
        _sharepoint_item_id: null,
        _sharepoint_web_url: null,
        _error_note: note.slice(0, 500),
      });
      return json(500, { error: "generation_failed", note });
    }

    // ---- Tenant SharePoint publish session (one runtime + one Graph token) ----
    const sessionRes = await createTenantSharePointPublishSession({
      organizationId: project.organization_id,
      functionName: FUNCTION_NAME,
      reason: "project-charter-sharepoint-publish",
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
          operation: "publish_project_charter",
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

    // ---- Audit history (never converts a failed publish into success) ----
    const { error: auditErr } = await supabase.rpc(
      "record_generated_operational_document",
      {
        _project_id: projectId,
        _document_type: "project_overview_charter",
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
      return json(403, { error: auditErr.message || "Authorization failed" });
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
      // Phase 6D.7D — additive Portfolio provenance.
      project_portfolio: {
        portfolio_item_id: charterData.project.portfolioItemId,
        portfolio_name: charterData.project.portfolioName,
        portfolio_code: charterData.project.portfolioCode,
        portfolio_lifecycle_state: charterData.project.portfolioLifecycleState,
        portfolio_is_archived: charterData.project.portfolioIsArchived,
        portfolio_label: charterData.project.portfolioLabel,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    logSafe("unhandled_error", { request_id: requestId });
    return json(500, { error: msg });
  }
});
