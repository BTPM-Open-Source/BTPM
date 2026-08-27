// Phase 4D.14A.7E — Roadmap Status Deck. Publishes via the effective
// Organization-aware Tenant SharePoint + Microsoft Graph integrations.
//
// Authority model (unchanged): reporting/export action — caller must be
// an active BTPM user and pass `has_project_access` for every requested
// project. All authority is proven BEFORE any Tenant secret / Graph
// resolution or upload.
//
// Organization scope (NEW in 7E): all requested projects MUST belong to
// exactly one Organization. Multiple Organizations are rejected with
// `cross_organization_scope_not_supported` BEFORE Tenant runtime,
// Graph token, generation, upload, and history insertion.
//
// Publishing target (unchanged): a single validated workspace-binding
// wins; otherwise fall back to the Tenant SharePoint site's default
// document library root. Fallback uses the effective Tenant integration,
// never a Global site.

import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { mapRoadmapDeckData } from "./roadmapDeckDataMapper.ts";
import { buildRoadmapDeckBuffer, roadmapDeckFilenameFor } from "./roadmapDeckBuilder.ts";
import { buildRoadmapDeckBufferV2, roadmapDeckFilenameForV2 } from "./roadmapDeckBuilderV2.ts";
import { mapRoadmapAnnexData } from "./roadmapDeckAnnexMapper.ts";
import {
  createTenantSharePointPublishSession,
  publishGeneratedDocumentBytes,
  resolveDefaultSiteDocumentPublishTarget,
  resolveWorkspaceDocumentPublishTarget,
} from "../_shared/sharePointGeneratedDocumentPublisher.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const FUNCTION_NAME = "generate-roadmap-status-deck";

const ROADMAP_DECK_VERSION =
  (Deno.env.get("ROADMAP_DECK_VERSION") || "v2").toLowerCase() === "v1" ? "v1" : "v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Stages {
  auth_ok: boolean;
  authority_ok: boolean;
  workspace_bindings_ok: boolean;
  data_collected_ok: boolean;
  graph_token_ok: boolean;
  library_resolved_ok: boolean;
  pptx_generated_ok: boolean;
  upload_ok: boolean;
  history_recorded_ok: boolean;
}
const newStages = (): Stages => ({
  auth_ok: false, authority_ok: false, workspace_bindings_ok: false,
  data_collected_ok: false, graph_token_ok: false, library_resolved_ok: false,
  pptx_generated_ok: false, upload_ok: false, history_recorded_ok: false,
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    if (userErr || !userData?.user) return json(401, { ok: false, error: "not_authenticated", stages });
    stages.auth_ok = true;

    // Active user gate BEFORE any data resolution.
    {
      const { data: active, error: activeErr } = await adminClient.rpc(
        "is_active_user",
        { _user_id: userData.user.id },
      );
      if (activeErr) {
        return json(500, { ok: false, error: "active_user_check_failed", stages });
      }
      if (active !== true) {
        return json(403, { ok: false, error: "inactive_user", stages });
      }
    }

    const body = await req.json().catch(() => ({}));
    const projectIds: string[] = Array.isArray(body?.projectIds)
      ? Array.from(new Set(
          body.projectIds.filter((x: any) => typeof x === "string" && x.length > 0),
        ))
      : [];
    const calendarMode: "year" | "month" = body?.calendarMode === "month" ? "month" : "year";
    const calendarStart: string | null = typeof body?.calendarStart === "string" ? body.calendarStart : null;
    const calendarEnd: string | null = typeof body?.calendarEnd === "string" ? body.calendarEnd : null;

    const rawRoadmapFilters = body?.roadmapFilters && typeof body.roadmapFilters === "object"
      ? body.roadmapFilters
      : {};
    const portfolioItemIds: string[] = Array.isArray(rawRoadmapFilters.portfolio_item_ids)
      ? Array.from(new Set(
          rawRoadmapFilters.portfolio_item_ids.filter(
            (x: any) => typeof x === "string" && x.length > 0 && x !== "__none__",
          ),
        ))
      : [];
    const includeNoPortfolio = rawRoadmapFilters.include_no_portfolio === true;

    if (projectIds.length === 0) {
      return json(400, { ok: false, error: "no_projects_in_scope", stages });
    }

    // Load requested projects (admin) so we can enforce authority and
    // Organization scope before ANY Tenant runtime resolution.
    const { data: projectRows, error: projErr } = await adminClient
      .from("projects")
      .select("id, workspace_id, organization_id")
      .in("id", projectIds);
    if (projErr) {
      return json(500, { ok: false, error: "project_load_failed", stages });
    }
    const foundIds = new Set((projectRows ?? []).map((r: any) => r.id as string));
    const missing = projectIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return json(403, {
        ok: false, error: "not_authorized_for_project_scope",
        note: "One or more requested projects are unknown or inaccessible.",
        stages,
      });
    }

    // Per-project Roadmap-visibility validation.
    for (const pid of projectIds) {
      const { data: ok, error } = await adminClient.rpc("has_project_access", {
        _user_id: userData.user.id, _project_id: pid,
      });
      if (error) {
        return json(500, { ok: false, error: "authority_check_failed", stages });
      }
      if (ok !== true) {
        return json(403, {
          ok: false, error: "not_authorized_for_project_scope",
          note: "Caller cannot read one or more requested projects.",
          stages,
        });
      }
    }
    stages.authority_ok = true;

    // ---- Single-Organization enforcement (BEFORE any Tenant/Graph work) ----
    const orgIds = new Set<string>();
    for (const r of projectRows ?? []) {
      const oid = (r as any).organization_id as string | null;
      if (!oid) {
        return json(403, {
          ok: false, error: "not_authorized_for_project_scope",
          note: "One or more requested projects are unknown or inaccessible.",
          stages,
        });
      }
      orgIds.add(oid);
    }
    if (orgIds.size > 1) {
      logSafe("cross_organization_scope_rejected", {
        request_id: requestId,
        project_count: projectIds.length,
      });
      return json(400, {
        ok: false,
        error: "cross_organization_scope_not_supported",
        note: "A Roadmap Status Deck can include projects from only one Organization.",
        stages,
      });
    }
    const authoritativeOrganizationId: string = orgIds.values().next().value as string;

    // Derive workspace ids ONLY after project + org validation.
    const workspaceIds: string[] = Array.from(
      new Set((projectRows ?? []).map((r: any) => r.workspace_id as string)),
    );

    const workspaceMeta: Array<{ id: string; name: string; organizationId: string }> = [];
    for (const wsId of workspaceIds) {
      const { data: wsJson } = await supabase.rpc("get_decrypted_workspace", { _workspace_id: wsId });
      const w = wsJson as any;
      if (!w) {
        return json(404, { ok: false, error: "workspace_not_found", stages });
      }
      workspaceMeta.push({
        id: wsId, name: String(w.name || "Workspace"),
        organizationId: w.organization_id,
      });
    }

    // Publishing-target choice: single validated workspace binding wins;
    // otherwise use the effective Tenant site's default library root.
    const pubWsId = workspaceIds[0];
    const warningsEarly: string[] = [];
    let workspaceBindingForPublish:
      | { id: string; workspace_id: string; organization_id: string;
          binding_status: string; site_web_url: string | null; library_web_url: string | null }
      | null = null;
    let useFallback = false;
    let fallbackReason = "";

    if (workspaceIds.length === 1) {
      const { data: wsBinding } = await adminClient
        .from("sharepoint_workspace_bindings")
        .select("id, workspace_id, organization_id, binding_status, site_web_url, library_web_url")
        .eq("workspace_id", pubWsId)
        .maybeSingle();
      const b = wsBinding as any;
      if (!b) { useFallback = true; fallbackReason = "workspace_library_missing"; }
      else if (b.binding_status !== "validated") { useFallback = true; fallbackReason = "workspace_library_not_validated"; }
      else if (!b.library_web_url || !b.site_web_url) { useFallback = true; fallbackReason = "workspace_library_url_missing"; }
      else if (b.organization_id !== authoritativeOrganizationId) {
        useFallback = true; fallbackReason = "workspace_library_organization_mismatch";
      } else {
        workspaceBindingForPublish = b;
      }
    } else {
      useFallback = true;
      fallbackReason = "multi_workspace_selected";
    }
    if (useFallback) {
      warningsEarly.push(`publish_fallback:btpm_site_root (${fallbackReason})`);
    }
    stages.workspace_bindings_ok = true;

    // Collect roadmap data (RLS-safe, user-scoped client).
    let deckData;
    try {
      deckData = await mapRoadmapDeckData(
        supabase, userData.user.id,
        { workspaceIds, programIds: null, projectIds, calendarMode, calendarStart, calendarEnd, portfolioItemIds, includeNoPortfolio },
        workspaceMeta,
      );
    } catch (e) {
      return json(500, { ok: false, error: "data_collection_failed", stages });
    }
    stages.data_collected_ok = true;

    // Publish session (one SharePoint runtime + one Graph token).
    const sessionRes = await createTenantSharePointPublishSession({
      organizationId: authoritativeOrganizationId,
      functionName: FUNCTION_NAME,
      reason: "roadmap-status-deck-sharepoint-publish",
      requestId,
    });
    if (!sessionRes.ok) {
      logSafe("publish_session_failed", { request_id: requestId, result: sessionRes.publicError.error });
      return json(502, { ok: false, error: sessionRes.publicError.error, note: sessionRes.publicError.note, stages });
    }
    stages.graph_token_ok = true;

    // Publish target.
    const targetRes = useFallback || !workspaceBindingForPublish
      ? await resolveDefaultSiteDocumentPublishTarget({ session: sessionRes.session })
      : await resolveWorkspaceDocumentPublishTarget({
          session: sessionRes.session,
          workspaceBinding: workspaceBindingForPublish,
        });
    if (!targetRes.ok) {
      logSafe("publish_target_failed", { request_id: requestId, result: targetRes.publicError.error });
      return json(502, { ok: false, error: targetRes.publicError.error, note: targetRes.publicError.note, stages });
    }
    stages.library_resolved_ok = true;

    // Build .pptx.
    const filename = ROADMAP_DECK_VERSION === "v2"
      ? roadmapDeckFilenameForV2(deckData.scope.scopeLabel, deckData.generatedAt)
      : roadmapDeckFilenameFor(deckData.scope.scopeLabel, deckData.generatedAt);
    let bytes: Uint8Array; let slideCount: number;
    try {
      if (ROADMAP_DECK_VERSION === "v2") {
        const annex = await mapRoadmapAnnexData(supabase, deckData.projects);
        const out = await buildRoadmapDeckBufferV2(deckData, annex);
        bytes = out.bytes; slideCount = out.slideCount;
      } else {
        const out = await buildRoadmapDeckBuffer(deckData);
        bytes = out.bytes; slideCount = out.slideCount;
      }
    } catch (e) {
      await adminClient.rpc("record_generated_roadmap_document", {
        _uid: userData.user.id,
        _project_ids: projectIds,
        _workspace_id: pubWsId,
        _document_type: "roadmap_status_deck",
        _generation_status: "generation_failed",
        _output_filename: filename,
        _source_snapshot_at: deckData.generatedAt,
        _publish_status: "not_published",
        _sharepoint_item_id: null,
        _sharepoint_web_url: null,
        _error_note: ((e as Error).message || "PPTX generation failed").slice(0, 500),
      });
      return json(500, { ok: false, error: "pptx_generation_failed", stages });
    }
    stages.pptx_generated_ok = true;

    // Upload.
    const uploadName = filename.replace(/[\\/:*?"<>|#%]/g, "").trim();
    const upl = await publishGeneratedDocumentBytes({
      session: sessionRes.session,
      target: targetRes.target,
      fileName: uploadName,
      bytes,
      contentType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      operation: "publish_roadmap_status_deck",
    });

    if (!upl.ok) {
      await adminClient.rpc("record_generated_roadmap_document", {
        _uid: userData.user.id,
        _project_ids: projectIds,
        _workspace_id: pubWsId,
        _document_type: "roadmap_status_deck",
        _generation_status: "generated_local",
        _output_filename: uploadName,
        _source_snapshot_at: deckData.generatedAt,
        _publish_status: "publish_failed",
        _sharepoint_item_id: null,
        _sharepoint_web_url: null,
        _error_note: upl.publicError.auditNote.slice(0, 500),
      });
      // Lock conflicts are user-actionable; keep 200 to avoid noisy
      // supabase-js error banner on top of the locked-file dialog.
      const isLocked = upl.publicError.error === "sharepoint_file_locked";
      return json(isLocked ? 200 : 502, {
        ok: false,
        error: upl.publicError.error,
        note: upl.publicError.note,
        filename: uploadName,
        stages,
      });
    }
    stages.upload_ok = true;

    const warnings = [...warningsEarly, ...deckData.warnings];
    const { error: auditErr } = await adminClient.rpc("record_generated_roadmap_document", {
      _uid: userData.user.id,
      _project_ids: projectIds,
      _workspace_id: pubWsId,
      _document_type: "roadmap_status_deck",
      _generation_status: "generated_local",
      _output_filename: uploadName,
      _source_snapshot_at: deckData.generatedAt,
      _publish_status: "published",
      _sharepoint_item_id: upl.item.itemId,
      _sharepoint_web_url: upl.item.webUrl,
      _error_note: null,
    });
    if (auditErr) warnings.push(`history_insert_failed:${auditErr.message?.slice(0, 120) ?? "unknown"}`);
    else stages.history_recorded_ok = true;

    return json(200, {
      ok: true,
      filename: uploadName,
      sharepoint_item_id: upl.item.itemId,
      sharepoint_web_url: upl.item.webUrl,
      generated_at: deckData.generatedAt,
      scope_label: deckData.scope.scopeLabel,
      project_count: deckData.scope.projectCount,
      calendar_mode: deckData.scope.calendarMode,
      slide_count: slideCount,
      template_version: ROADMAP_DECK_VERSION,
      warnings,
      stages,
      portfolio_scope: {
        portfolio_item_ids: deckData.scope.portfolioItemIds,
        include_no_portfolio: deckData.scope.includeNoPortfolio,
        portfolio_count: deckData.scope.portfolioCount,
        portfolio_labels: deckData.scope.portfolioLabels,
        no_portfolio_project_count: deckData.scope.noPortfolioProjectCount,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    logSafe("unhandled_error", { request_id: requestId });
    return json(500, { ok: false, error: msg, stages });
  }
});
