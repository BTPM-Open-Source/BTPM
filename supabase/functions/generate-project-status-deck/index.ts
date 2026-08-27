// Phase 4D.14A.7E — Generate the Weekly Project Status Deck (.pptx) and
// publish via the effective Organization-aware Tenant SharePoint +
// Microsoft Graph integrations. Runtime ordering matches the other
// project-bound direct report publishers.

import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { mapProjectToStatusDeckData } from "./statusDeckDataMapper.ts";
import { buildStatusDeckBuffer, deckFilenameFor } from "./statusDeckBuilder.ts";
import {
  createTenantSharePointPublishSession,
  publishGeneratedDocumentBytes,
  resolveProjectDocumentPublishTarget,
} from "../_shared/sharePointGeneratedDocumentPublisher.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const FUNCTION_NAME = "generate-project-status-deck";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Stages {
  auth_ok: boolean;
  authority_ok: boolean;
  workspace_binding_ok: boolean;
  project_binding_ok: boolean;
  data_collected_ok: boolean;
  graph_token_ok: boolean;
  folder_resolved_ok: boolean;
  pptx_generated_ok: boolean;
  upload_ok: boolean;
  history_recorded_ok: boolean;
}
const newStages = (): Stages => ({
  auth_ok: false, authority_ok: false, workspace_binding_ok: false,
  project_binding_ok: false, data_collected_ok: false, graph_token_ok: false,
  folder_resolved_ok: false, pptx_generated_ok: false, upload_ok: false,
  history_recorded_ok: false,
});

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

function previousFullWeek(): { startIso: string; endDateIso: string; endExclusiveIso: string } {
  const now = new Date();
  const dow = now.getUTCDay();
  const daysSinceMonday = (dow + 6) % 7;
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86_400_000);
  const lastSunday = new Date(thisMonday.getTime() - 1);
  const endExclusive = new Date(thisMonday.getTime());
  return {
    startIso: lastMonday.toISOString(),
    endDateIso: lastSunday.toISOString().slice(0, 10),
    endExclusiveIso: endExclusive.toISOString(),
  };
}

function parsePeriod(periodStart?: string, periodEnd?: string) {
  if (periodStart && periodEnd) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() < start.getTime()) {
      return null;
    }
    const startIso = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())).toISOString();
    const endDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    const endExclusive = new Date(endDate.getTime() + 86_400_000);
    return {
      startIso,
      endDateIso: endDate.toISOString().slice(0, 10),
      endExclusiveIso: endExclusive.toISOString(),
    };
  }
  return previousFullWeek();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const stages = newStages();
  const requestId = crypto.randomUUID();
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { ok: false, error: "missing_authorization", stages });

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
    if (userErr || !userData?.user) {
      return json(401, { ok: false, error: "not_authenticated", stages });
    }
    stages.auth_ok = true;

    const body = await req.json().catch(() => ({}));
    const projectId: string | undefined = body?.projectId;
    if (!projectId || typeof projectId !== "string") {
      return json(400, { ok: false, error: "projectId required", stages });
    }

    const period = parsePeriod(body?.periodStart, body?.periodEnd);
    if (!period) {
      return json(400, { ok: false, error: "invalid_period", stages });
    }

    // Load authoritative project row (id, workspace, organization).
    const { data: project } = await adminClient
      .from("projects")
      .select("id, workspace_id, organization_id")
      .eq("id", projectId)
      .maybeSingle();
    if (!project) {
      return json(404, { ok: false, error: "project_not_found", stages });
    }
    if (!project.organization_id || !project.workspace_id) {
      return json(403, { ok: false, error: "not_authorized", stages });
    }

    // Authority BEFORE runtime.
    {
      const { data: authorized, error: authErr } = await adminClient.rpc(
        "has_project_pm_authority",
        { _user_id: userData.user.id, _project_id: projectId },
      );
      if (authErr) {
        return json(500, { ok: false, error: "authority_check_failed", stages });
      }
      if (authorized !== true) {
        return json(403, {
          ok: false,
          error: "not_authorized",
          note: "You do not have authority to generate the status deck for this project.",
          stages,
        });
      }
    }
    stages.authority_ok = true;

    // Bindings + containment.
    const { data: wsBinding } = await adminClient
      .from("sharepoint_workspace_bindings")
      .select("id, workspace_id, organization_id, binding_status, site_web_url, library_web_url")
      .eq("workspace_id", project.workspace_id)
      .maybeSingle();
    if (!wsBinding) return json(200, { ok: false, error: "workspace_library_missing", stages });
    if (wsBinding.binding_status !== "validated") {
      return json(200, { ok: false, error: "workspace_library_not_validated", stages });
    }
    if (
      wsBinding.workspace_id !== project.workspace_id ||
      wsBinding.organization_id !== project.organization_id
    ) {
      return json(403, { ok: false, error: "not_authorized", stages });
    }
    stages.workspace_binding_ok = true;

    const { data: projectBinding } = await adminClient
      .from("sharepoint_project_bindings")
      .select("id, project_id, workspace_id, organization_id, binding_status, folder_web_url, folder_item_id, resolved_library_web_url")
      .eq("project_id", projectId)
      .neq("binding_status", "disabled")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!projectBinding) return json(200, { ok: false, error: "project_folder_missing", stages });
    if (projectBinding.binding_status === "disabled") {
      return json(200, { ok: false, error: "project_folder_disabled", stages });
    }
    if (projectBinding.binding_status !== "validated") {
      return json(200, { ok: false, error: "project_folder_not_validated", stages });
    }
    if (
      projectBinding.project_id !== project.id ||
      projectBinding.workspace_id !== project.workspace_id ||
      projectBinding.organization_id !== project.organization_id
    ) {
      return json(403, { ok: false, error: "not_authorized", stages });
    }
    stages.project_binding_ok = true;

    // Canonical BTPM data.
    let mapping;
    try {
      mapping = await mapProjectToStatusDeckData(
        supabase,
        projectId,
        userData.user.id,
        period.startIso,
        period.endExclusiveIso,
        period.endDateIso,
      );
    } catch (e) {
      return json(200, {
        ok: false, error: "project_not_accessible",
        note: (e as Error).message, stages,
      });
    }
    stages.data_collected_ok = true;
    const deckData = mapping.data;

    // Publish session (one runtime + one Graph token).
    const sessionRes = await createTenantSharePointPublishSession({
      organizationId: project.organization_id,
      functionName: FUNCTION_NAME,
      reason: "project-status-deck-sharepoint-publish",
      requestId,
    });
    if (!sessionRes.ok) {
      logSafe("publish_session_failed", { request_id: requestId, result: sessionRes.publicError.error });
      return json(502, { ok: false, error: sessionRes.publicError.error, note: sessionRes.publicError.note, stages });
    }
    stages.graph_token_ok = true;

    const targetRes = await resolveProjectDocumentPublishTarget({
      session: sessionRes.session,
      projectBinding,
    });
    if (!targetRes.ok) {
      logSafe("publish_target_failed", { request_id: requestId, result: targetRes.publicError.error });
      return json(502, { ok: false, error: targetRes.publicError.error, note: targetRes.publicError.note, stages });
    }
    stages.folder_resolved_ok = true;

    // Build .pptx.
    const filename = deckFilenameFor(deckData.project.name, deckData.period.start, deckData.period.end);
    let bytes: Uint8Array;
    let slideCount: number;
    try {
      const out = await buildStatusDeckBuffer(deckData);
      bytes = out.bytes;
      slideCount = out.slideCount;
    } catch (e) {
      await supabase.rpc("record_generated_operational_document", {
        _project_id: projectId,
        _document_type: "weekly_project_status_deck",
        _generation_status: "generation_failed",
        _output_filename: filename,
        _source_snapshot_at: deckData.generatedAt,
        _publish_status: "not_published",
        _sharepoint_item_id: null,
        _sharepoint_web_url: null,
        _error_note: ((e as Error).message || "PPTX generation failed").slice(0, 500),
      });
      return json(500, {
        ok: false, error: "pptx_generation_failed",
        note: (e as Error).message || "PPTX generation failed.",
        stages,
      });
    }
    stages.pptx_generated_ok = true;

    // Upload.
    const safe = filename.replace(/[\\/:*?"<>|#%]/g, "").trim();
    const upl = await publishGeneratedDocumentBytes({
      session: sessionRes.session,
      target: targetRes.target,
      fileName: safe,
      bytes,
      contentType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      operation: "publish_project_status_deck",
    });

    if (!upl.ok) {
      await supabase.rpc("record_generated_operational_document", {
        _project_id: projectId,
        _document_type: "weekly_project_status_deck",
        _generation_status: "generated_local",
        _output_filename: safe,
        _source_snapshot_at: deckData.generatedAt,
        _publish_status: "publish_failed",
        _sharepoint_item_id: null,
        _sharepoint_web_url: null,
        _error_note: upl.publicError.auditNote.slice(0, 500),
      });
      return json(502, {
        ok: false,
        error: upl.publicError.error,
        note: upl.publicError.note,
        filename: safe,
        stages,
      });
    }
    stages.upload_ok = true;

    const warnings = [...deckData.warnings];
    const { error: auditErr } = await supabase.rpc(
      "record_generated_operational_document",
      {
        _project_id: projectId,
        _document_type: "weekly_project_status_deck",
        _generation_status: "generated_local",
        _output_filename: safe,
        _source_snapshot_at: deckData.generatedAt,
        _publish_status: "published",
        _sharepoint_item_id: upl.item.itemId,
        _sharepoint_web_url: upl.item.webUrl,
        _error_note: null,
      },
    );
    if (auditErr) {
      warnings.push(`history_insert_failed:${auditErr.message?.slice(0, 120) ?? "unknown"}`);
    } else {
      stages.history_recorded_ok = true;
    }

    return json(200, {
      ok: true,
      filename: safe,
      sharepoint_item_id: upl.item.itemId,
      sharepoint_web_url: upl.item.webUrl,
      generated_at: deckData.generatedAt,
      period_start: deckData.period.start,
      period_end: deckData.period.end,
      slide_count: slideCount,
      warnings,
      stages,
      project_portfolio: {
        portfolio_item_id: deckData.project.portfolioItemId,
        portfolio_name: deckData.project.portfolioName,
        portfolio_code: deckData.project.portfolioCode,
        portfolio_lifecycle_state: deckData.project.portfolioLifecycleState,
        portfolio_is_archived: deckData.project.portfolioIsArchived,
        portfolio_label: deckData.project.portfolioLabel,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    logSafe("unhandled_error", { request_id: requestId });
    return json(500, { ok: false, error: msg, stages });
  }
});
