// Phase 4D.14A.7F — Refresh Lessons Learned SharePoint document metadata (Tenant runtime).
//
// Runtime ordering (fixed, no external Microsoft calls before PM authority):
//   1. Authenticate.
//   2. Validate projectId.
//   3. Prove has_project_pm_authority(user_id, projectId).
//   4. Load authoritative project (id, workspace_id, organization_id).
//   5. Read current decrypted Lessons Learned metadata as caller.
//      - No metadata row      → return status = not_created (no Graph call).
//      - No drive/item stored → return current status         (no Graph call).
//   6. Load current validated project SharePoint binding (admin) with
//      strict project/workspace/organization containment.
//   7. Create ONE Tenant SharePoint publish session (runtime + Graph token).
//   8. Resolve the current project root live.
//   9. Fetch the stored drive/item live.
//  10. Verify stored driveId == server-resolved project drive AND item is
//      inside the current project root.
//  11. Update metadata OR mark link_broken.
//  12. Preserve the existing response contract.
//
// Temporary provider failures (timeout, rate limit, permission denial,
// configuration failure) MUST NOT change status to `link_broken` and MUST
// preserve existing metadata references.

// deno-lint-ignore-file no-explicit-any

import { createClient } from "npm:@supabase/supabase-js@2";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";
import {
  createTenantSharePointPublishSession,
  resolveProjectDocumentPublishTarget,
} from "../_shared/sharePointGeneratedDocumentPublisher.ts";
import {
  getSharePointDriveItemMetadata,
} from "../_shared/sharePointClient.ts";
import { isSharePointItemUnderProjectRoot } from "../_shared/sharePointProjectBindingRuntime.ts";
import {
  lessonsLearnedPublicError,
  type LessonsLearnedPublicErrorCode,
} from "../_shared/lessonsLearnedSharePoint.ts";

const FUNCTION_NAME = "refresh-project-lessons-learned-document-metadata";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type MetadataStatus =
  | "not_created"
  | "available"
  | "missing_folder"
  | "creation_failed"
  | "link_broken";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function logSafe(event: string, fields: Record<string, unknown>) {
  const safe: Record<string, unknown> = { component: FUNCTION_NAME };
  for (const [k, v] of Object.entries(fields)) {
    const lk = k.toLowerCase();
    if (
      lk.includes("id") ||
      lk.includes("url") ||
      lk.includes("name") ||
      lk.includes("token") ||
      lk.includes("path") ||
      lk === "body" ||
      lk === "message"
    ) continue;
    safe[k] = v;
  }
  console.log(`[${FUNCTION_NAME}] ${event}`, JSON.stringify(safe));
}

async function upsertMetadata(
  authHeader: string,
  args: {
    projectId: string;
    status: MetadataStatus;
    documentName?: string | null;
    webUrl?: string | null;
    driveId?: string | null;
    itemId?: string | null;
    createdAt?: string | null;
    lastModifiedAt?: string | null;
    eventType?: string;
  },
): Promise<{ ok: boolean }> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { error } = await userClient.rpc(
    "upsert_project_lessons_learned_document_metadata",
    {
      _project_id: args.projectId,
      _status: args.status,
      _document_name: args.documentName ?? null,
      _sharepoint_web_url: args.webUrl ?? null,
      _sharepoint_drive_id: args.driveId ?? null,
      _sharepoint_item_id: args.itemId ?? null,
      _created_in_sharepoint_at: args.createdAt ?? null,
      _last_modified_at: args.lastModifiedAt ?? null,
      _event_type:
        args.eventType ?? "project_lessons_learned_document_status_changed",
    },
  );
  if (error) {
    logSafe("metadata_upsert_failed", { result: "metadata_upsert_failed" });
    return { ok: false };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { error: "missing_authorization" });

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
    if (userErr || !userData?.user) return json(401, { error: "not_authenticated" });

    const body = await req.json().catch(() => ({}));
    const projectId: string | undefined = body?.projectId;
    if (!projectId || typeof projectId !== "string") {
      return json(400, { error: "projectId_required" });
    }

    // ---- Authority gate BEFORE any Tenant/Graph resolution ----
    const { data: authorized, error: authErr } = await adminClient.rpc(
      "has_project_pm_authority",
      { _user_id: userData.user.id, _project_id: projectId },
    );
    if (authErr) return json(500, { error: "authority_check_failed" });
    if (authorized !== true) {
      return json(403, {
        error: "not_authorized",
        note:
          "You do not have authority to refresh Lessons Learned metadata for this project.",
      });
    }

    // ---- Authoritative project row ----
    const { data: project } = await adminClient
      .from("projects")
      .select("id, workspace_id, organization_id")
      .eq("id", projectId)
      .maybeSingle();
    if (!project || !project.organization_id || !project.workspace_id) {
      return json(403, { error: "not_authorized" });
    }

    // ---- Current decrypted metadata (as caller) ----
    const { data: rpcRows, error: rpcErr } = await supabase.rpc(
      "get_decrypted_project_lessons_learned_document",
      { _project_id: projectId },
    );
    if (rpcErr) {
      const pub = lessonsLearnedPublicError("document_metadata_unavailable");
      return json(500, { error: pub.code, note: pub.note });
    }
    const meta: any = Array.isArray(rpcRows) && rpcRows.length > 0
      ? rpcRows[0]
      : null;
    if (!meta) {
      return json(200, { status: "not_created" });
    }
    if (!meta.sharepoint_drive_id || !meta.sharepoint_item_id) {
      return json(200, { status: meta.status });
    }
    const storedDriveId: string = meta.sharepoint_drive_id;
    const storedItemId: string = meta.sharepoint_item_id;

    // ---- Current validated project binding + containment ----
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
    if (!projectBinding || projectBinding.binding_status !== "validated") {
      // Binding no longer validated → mark link_broken (project no longer
      // has a validated scope; the previous stored document is out of
      // reach of BTPM).
      await upsertMetadata(authHeader, {
        projectId,
        status: "link_broken",
        documentName: null,
        webUrl: null,
        driveId: null,
        itemId: null,
        createdAt: null,
        lastModifiedAt: null,
        eventType: "project_lessons_learned_document_status_changed",
      });
      logSafe("binding_not_validated", { request_id: requestId });
      return json(200, { status: "link_broken" });
    }
    if (
      projectBinding.project_id !== project.id ||
      projectBinding.workspace_id !== project.workspace_id ||
      projectBinding.organization_id !== project.organization_id
    ) {
      return json(403, { error: "not_authorized" });
    }

    // ---- Session ----
    const sessionRes = await createTenantSharePointPublishSession({
      organizationId: project.organization_id,
      functionName: FUNCTION_NAME,
      reason: "lessons-learned-refresh",
      requestId,
    });
    if (!sessionRes.ok) {
      // Temporary/configuration failure — preserve existing metadata.
      const pub = lessonsLearnedPublicError(
        sessionRes.publicError.error as LessonsLearnedPublicErrorCode,
      );
      logSafe("session_failed", { request_id: requestId, result: pub.code });
      return json(502, { status: meta.status, error: pub.code, note: pub.note });
    }
    const session = sessionRes.session;

    // ---- Resolve current project root live ----
    const targetRes = await resolveProjectDocumentPublishTarget({
      session,
      projectBinding: {
        binding_status: projectBinding.binding_status,
        folder_web_url: projectBinding.folder_web_url,
        resolved_library_web_url: projectBinding.resolved_library_web_url,
      },
    });
    if (!targetRes.ok) {
      const code = targetRes.publicError.error;
      // publish_target_missing → the current project root no longer
      // exists on SharePoint. Existing stored document is unreachable.
      if (code === "publish_target_missing") {
        await upsertMetadata(authHeader, {
          projectId,
          status: "link_broken",
          documentName: null,
          webUrl: null,
          driveId: null,
          itemId: null,
          createdAt: null,
          lastModifiedAt: null,
          eventType: "project_lessons_learned_document_status_changed",
        });
        return json(200, { status: "link_broken" });
      }
      const pub = lessonsLearnedPublicError("sharepoint_unavailable");
      logSafe("target_failed", { request_id: requestId, result: code });
      return json(502, { status: meta.status, error: pub.code, note: pub.note });
    }
    const projectDriveId = targetRes.target.driveId;
    const rootItemId = targetRes.target.parentItemId;

    // ---- Drive mismatch → link_broken ----
    if (storedDriveId !== projectDriveId) {
      await upsertMetadata(authHeader, {
        projectId,
        status: "link_broken",
        documentName: null,
        webUrl: null,
        driveId: null,
        itemId: null,
        createdAt: null,
        lastModifiedAt: null,
        eventType: "project_lessons_learned_document_status_changed",
      });
      logSafe("drive_mismatch", { request_id: requestId });
      return json(200, { status: "link_broken" });
    }

    // ---- Fetch stored item live ----
    const itemRes = await getSharePointDriveItemMetadata({
      accessToken: session.accessToken,
      requestId: session.requestId,
      driveId: projectDriveId,
      itemId: storedItemId,
      operation: "read_project_folder_item",
    });
    if (itemRes.category === "item_not_found") {
      await upsertMetadata(authHeader, {
        projectId,
        status: "link_broken",
        documentName: null,
        webUrl: null,
        driveId: null,
        itemId: null,
        createdAt: null,
        lastModifiedAt: null,
        eventType: "project_lessons_learned_document_status_changed",
      });
      logSafe("item_gone", { request_id: requestId });
      return json(200, { status: "link_broken" });
    }
    if (itemRes.category !== "success" || !itemRes.item) {
      // Temporary/permission/config failure → preserve status.
      const code: LessonsLearnedPublicErrorCode = (() => {
        switch (itemRes.category) {
          case "permission_denied": return "sharepoint_permission_denied";
          case "timeout": return "sharepoint_timeout";
          case "rate_limited":
          case "graph_unavailable": return "sharepoint_unavailable";
          case "response_invalid": return "sharepoint_response_invalid";
          case "token_rejected":
            return "microsoft_graph_configuration_unavailable";
          default: return "sharepoint_unavailable";
        }
      })();
      const pub = lessonsLearnedPublicError(code);
      logSafe("item_fetch_failed", {
        request_id: requestId,
        result: itemRes.category,
      });
      return json(502, { status: meta.status, error: pub.code, note: pub.note });
    }

    // ---- Containment: item must remain under current project root ----
    const rootSynthetic = {
      id: rootItemId,
      name: "",
      webUrl: null,
      size: null,
      eTag: null,
      cTag: null,
      createdDateTime: null,
      lastModifiedDateTime: null,
      parentReference: { driveId: projectDriveId, id: null, path: null },
      folder: { childCount: null },
      file: null,
    };
    const insideRoot = itemRes.item.id === rootItemId ||
      isSharePointItemUnderProjectRoot(itemRes.item, rootSynthetic as any) ||
      (itemRes.item.parentReference?.driveId === projectDriveId);
    if (!insideRoot) {
      await upsertMetadata(authHeader, {
        projectId,
        status: "link_broken",
        documentName: null,
        webUrl: null,
        driveId: null,
        itemId: null,
        createdAt: null,
        lastModifiedAt: null,
        eventType: "project_lessons_learned_document_status_changed",
      });
      logSafe("outside_root", { request_id: requestId });
      return json(200, { status: "link_broken" });
    }

    // ---- Successful refresh ----
    const ok = await upsertMetadata(authHeader, {
      projectId,
      status: "available",
      documentName: itemRes.item.name,
      webUrl: itemRes.item.webUrl ?? null,
      driveId: projectDriveId,
      itemId: itemRes.item.id,
      createdAt: itemRes.item.createdDateTime ?? null,
      lastModifiedAt: itemRes.item.lastModifiedDateTime ?? null,
      eventType: "project_lessons_learned_document_metadata_refreshed",
    });
    if (!ok.ok) {
      const pub = lessonsLearnedPublicError("metadata_upsert_failed");
      return json(500, { error: pub.code, note: pub.note });
    }
    logSafe("refreshed", { request_id: requestId });
    return json(200, {
      status: "available",
      document: {
        name: itemRes.item.name,
        web_url: itemRes.item.webUrl,
        item_id: itemRes.item.id,
        drive_id: projectDriveId,
        last_modified_at: itemRes.item.lastModifiedDateTime ?? null,
      },
    });
  } catch (_e) {
    logSafe("unexpected_error", { request_id: requestId });
    return json(500, {
      error: "document_metadata_unavailable",
      note: "The Lessons Learned metadata could not be read from SharePoint.",
    });
  }
});
