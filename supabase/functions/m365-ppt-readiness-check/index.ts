// Phase 4D.14A.7G — M365 PPT Readiness Check (diagnostic-only).
//
// Migrated onto the canonical Organization-aware Tenant SharePoint +
// Microsoft Graph runtime. This function proves that the effective
// SharePoint/Graph integrations for the caller's project Organization
// can generate and publish a valid .pptx file into the linked project
// folder.
//
// This function does NOT:
//   - persist a generated-document history row
//   - modify project status, SharePoint bindings, or integration health
//   - substitute for real report publishers
//   - resolve Global `M365_*` / `BTPM_SP_*` secrets (they are unused here)
//   - acquire its own Graph token (uses canonical shared resolver)
//   - log or return raw Microsoft bodies, tokens, IDs, URLs, or PPTX bytes
//
// Runtime ordering (fixed):
//   1. authenticate caller
//   2. validate projectId shape
//   3. prove has_project_pm_authority BEFORE any Tenant secret / Graph call
//   4. load authoritative project row (id, workspace_id, organization_id)
//   5. load + verify validated workspace SharePoint binding containment
//   6. load + verify validated project SharePoint binding containment
//   7. generate diagnostic PPTX bytes
//   8. createTenantSharePointPublishSession (one runtime, one Graph token)
//   9. resolveProjectDocumentPublishTarget (live folder resolution)
//   10. publishGeneratedDocumentBytes (PUT, conflictBehavior=replace)
//   11. return compact readiness result

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
// pptxgenjs ships ESM and works in Deno via npm specifier.
import PptxGenJS from "npm:pptxgenjs@3.12.0";
import {
  createTenantSharePointPublishSession,
  publishGeneratedDocumentBytes,
  resolveProjectDocumentPublishTarget,
  type GeneratedDocumentPublishErrorCode,
} from "../_shared/sharePointGeneratedDocumentPublisher.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const FUNCTION_NAME = "m365-ppt-readiness-check";
const FILENAME = "BTPM PPT Readiness Check.pptx";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---- Stage contract (preserved) -----------------------------------------

type Stages = {
  auth_ok: boolean;
  authority_ok: boolean;
  workspace_binding_ok: boolean;
  project_binding_ok: boolean;
  graph_token_ok: boolean;
  folder_resolved_ok: boolean;
  pptx_generated_ok: boolean;
  upload_ok: boolean;
};

function newStages(): Stages {
  return {
    auth_ok: false,
    authority_ok: false,
    workspace_binding_ok: false,
    project_binding_ok: false,
    graph_token_ok: false,
    folder_resolved_ok: false,
    pptx_generated_ok: false,
    upload_ok: false,
  };
}

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

// ---- Safe error contract ------------------------------------------------

export type PptReadinessErrorCode =
  | "not_authenticated"
  | "not_authorized"
  | "invalid_request"
  | "project_not_found"
  | "workspace_library_missing"
  | "workspace_library_not_validated"
  | "project_folder_missing"
  | "project_folder_not_validated"
  | "pptx_generation_failed"
  | "internal_error"
  | GeneratedDocumentPublishErrorCode;

const SAFE_NOTES: Partial<Record<PptReadinessErrorCode, string>> = {
  not_authenticated: "You are not signed in.",
  not_authorized:
    "You do not have authority to run the PPT readiness check for this project.",
  invalid_request: "A project ID is required.",
  project_not_found: "The project could not be found.",
  workspace_library_missing:
    "This workspace is not linked to a SharePoint document library yet.",
  workspace_library_not_validated:
    "The workspace SharePoint library is not validated.",
  project_folder_missing:
    "This project is not linked to a SharePoint folder yet.",
  project_folder_not_validated:
    "The SharePoint folder link for this project is not validated.",
  pptx_generation_failed:
    "The diagnostic PowerPoint file could not be generated.",
  internal_error: "PPT readiness checking is temporarily unavailable.",
};

function safeNote(code: PptReadinessErrorCode, fallback?: string): string {
  return SAFE_NOTES[code] ?? fallback ?? "PPT readiness checking is temporarily unavailable.";
}

// ---- PPTX generation (unchanged content) --------------------------------

async function buildReadinessPptx(projectId: string): Promise<Uint8Array> {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  const slide = pres.addSlide();
  slide.background = { color: "0F1B3D" };
  slide.addText("BTPM PPT Readiness Check", {
    x: 0.6, y: 1.0, w: 12, h: 1.2,
    fontSize: 40, bold: true, color: "FFFFFF", fontFace: "Calibri",
  });
  slide.addText(
    "Diagnostic file generated by the m365-ppt-readiness-check Edge Function.\n" +
    "If you can open this file from SharePoint, the BTPM server-side Microsoft Graph + PowerPoint pipeline is operational.",
    {
      x: 0.6, y: 2.4, w: 12, h: 2.0,
      fontSize: 18, color: "CADCFC", fontFace: "Calibri",
    },
  );
  slide.addText(
    [
      { text: "Project ID: ", options: { bold: true } },
      { text: projectId },
      { text: "\nGenerated at: ", options: { bold: true } },
      { text: new Date().toISOString() },
    ],
    { x: 0.6, y: 5.0, w: 12, h: 1.2, fontSize: 14, color: "FFFFFF", fontFace: "Calibri" },
  );

  const out = (await pres.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return new Uint8Array(out);
}

// ---- Handler ------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  const stages = newStages();
  const generated_at = new Date().toISOString();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return json(401, {
        ok: false,
        error: "not_authenticated" satisfies PptReadinessErrorCode,
        note: safeNote("not_authenticated"),
        stages,
        generated_at,
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    try {
      const verifier = createSupabaseTokenVerifier(supabase);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      logSafe("auth_failed", { request_id: requestId });
      return json(401, {
        ok: false,
        error: "not_authenticated" satisfies PptReadinessErrorCode,
        note: safeNote("not_authenticated"),
        stages,
        generated_at,
      });
    }
    stages.auth_ok = true;

    // ---- Validate request body ----
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const projectId = typeof (body as { projectId?: unknown }).projectId === "string"
      ? (body as { projectId: string }).projectId
      : "";
    if (!projectId) {
      return json(400, {
        ok: false,
        error: "invalid_request" satisfies PptReadinessErrorCode,
        note: safeNote("invalid_request"),
        stages,
        generated_at,
      });
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE);

    // ---- Authority gate BEFORE any Tenant / Graph resolution ----
    const { data: authorized, error: authErr } = await adminClient.rpc(
      "has_project_pm_authority",
      { _user_id: userData.user.id, _project_id: projectId },
    );
    if (authErr) {
      logSafe("authority_check_failed", { request_id: requestId });
      return json(403, {
        ok: false,
        error: "not_authorized" satisfies PptReadinessErrorCode,
        note: safeNote("not_authorized"),
        stages,
        generated_at,
      });
    }
    if (authorized !== true) {
      return json(403, {
        ok: false,
        error: "not_authorized" satisfies PptReadinessErrorCode,
        note: safeNote("not_authorized"),
        stages,
        generated_at,
      });
    }
    stages.authority_ok = true;

    // ---- Load authoritative project row ----
    const { data: project } = await adminClient
      .from("projects")
      .select("id, workspace_id, organization_id")
      .eq("id", projectId)
      .maybeSingle();
    if (!project || !project.organization_id || !project.workspace_id) {
      return json(404, {
        ok: false,
        error: "project_not_found" satisfies PptReadinessErrorCode,
        note: safeNote("project_not_found"),
        stages,
        generated_at,
      });
    }

    // ---- Workspace binding + strict containment ----
    const { data: wsBinding } = await adminClient
      .from("sharepoint_workspace_bindings")
      .select("id, workspace_id, organization_id, binding_status, site_web_url, library_web_url")
      .eq("workspace_id", project.workspace_id)
      .maybeSingle();
    if (!wsBinding) {
      return json(412, {
        ok: false,
        error: "workspace_library_missing" satisfies PptReadinessErrorCode,
        note: safeNote("workspace_library_missing"),
        stages,
        generated_at,
      });
    }
    if (
      wsBinding.workspace_id !== project.workspace_id ||
      wsBinding.organization_id !== project.organization_id
    ) {
      // Do not disclose cross-org existence.
      return json(403, {
        ok: false,
        error: "not_authorized" satisfies PptReadinessErrorCode,
        note: safeNote("not_authorized"),
        stages,
        generated_at,
      });
    }
    if (wsBinding.binding_status !== "validated") {
      return json(412, {
        ok: false,
        error: "workspace_library_not_validated" satisfies PptReadinessErrorCode,
        note: safeNote("workspace_library_not_validated"),
        stages,
        generated_at,
      });
    }
    stages.workspace_binding_ok = true;

    // ---- Project binding + strict containment ----
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
        ok: false,
        error: "project_folder_missing" satisfies PptReadinessErrorCode,
        note: safeNote("project_folder_missing"),
        stages,
        generated_at,
      });
    }
    if (
      projectBinding.project_id !== project.id ||
      projectBinding.workspace_id !== project.workspace_id ||
      projectBinding.organization_id !== project.organization_id
    ) {
      return json(403, {
        ok: false,
        error: "not_authorized" satisfies PptReadinessErrorCode,
        note: safeNote("not_authorized"),
        stages,
        generated_at,
      });
    }
    if (projectBinding.binding_status !== "validated") {
      return json(412, {
        ok: false,
        error: "project_folder_not_validated" satisfies PptReadinessErrorCode,
        note: safeNote("project_folder_not_validated"),
        stages,
        generated_at,
      });
    }
    stages.project_binding_ok = true;

    // ---- Generate PPTX ----
    let bytes: Uint8Array;
    try {
      bytes = await buildReadinessPptx(projectId);
    } catch {
      logSafe("pptx_generation_failed", { request_id: requestId });
      return json(500, {
        ok: false,
        error: "pptx_generation_failed" satisfies PptReadinessErrorCode,
        note: safeNote("pptx_generation_failed"),
        stages,
        generated_at,
      });
    }
    stages.pptx_generated_ok = true;

    // ---- Tenant SharePoint publish session (one runtime + one Graph token) ----
    const sessionRes = await createTenantSharePointPublishSession({
      organizationId: project.organization_id,
      functionName: FUNCTION_NAME,
      reason: "ppt-readiness-diagnostic-publish",
      requestId,
    });
    if (!sessionRes.ok) {
      logSafe("publish_session_failed", {
        request_id: requestId,
        result: sessionRes.publicError.error,
      });
      return json(502, {
        ok: false,
        error: sessionRes.publicError.error as PptReadinessErrorCode,
        note: sessionRes.publicError.note,
        stages,
        generated_at,
      });
    }
    stages.graph_token_ok = true;

    // ---- Resolve live project publish target ----
    const targetRes = await resolveProjectDocumentPublishTarget({
      session: sessionRes.session,
      projectBinding,
    });
    if (!targetRes.ok) {
      logSafe("publish_target_failed", {
        request_id: requestId,
        result: targetRes.publicError.error,
      });
      return json(502, {
        ok: false,
        error: targetRes.publicError.error as PptReadinessErrorCode,
        note: targetRes.publicError.note,
        stages,
        generated_at,
      });
    }
    stages.folder_resolved_ok = true;

    // ---- Upload PPTX (conflictBehavior=replace) ----
    const safe = FILENAME.replace(/[\\/:*?"<>|#%]/g, "").trim();
    const upl = await publishGeneratedDocumentBytes({
      session: sessionRes.session,
      target: targetRes.target,
      fileName: safe,
      bytes,
      contentType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      operation: "publish_ppt_readiness_diagnostic",
      conflictBehavior: "replace",
    });
    if (!upl.ok) {
      logSafe("publish_upload_failed", {
        request_id: requestId,
        result: upl.publicError.error,
      });
      return json(502, {
        ok: false,
        error: upl.publicError.error as PptReadinessErrorCode,
        note: upl.publicError.note,
        filename: safe,
        stages,
        generated_at,
      });
    }
    if (!upl.item.itemId || !upl.item.webUrl) {
      logSafe("publish_response_incomplete", { request_id: requestId });
      return json(502, {
        ok: false,
        error: "publish_failed" satisfies PptReadinessErrorCode,
        note: "Publishing to SharePoint failed. Please try again in a moment.",
        filename: safe,
        stages,
        generated_at,
      });
    }
    stages.upload_ok = true;
    logSafe("publish_ok", { request_id: requestId, byte_count: bytes.byteLength });

    return json(200, {
      ok: true,
      filename: safe,
      sharepoint_item_id: upl.item.itemId,
      sharepoint_web_url: upl.item.webUrl,
      generated_at,
      stages,
    });
  } catch {
    logSafe("unhandled_error", { request_id: requestId });
    return json(500, {
      ok: false,
      error: "internal_error" satisfies PptReadinessErrorCode,
      note: safeNote("internal_error"),
      stages,
      generated_at,
    });
  }
});
