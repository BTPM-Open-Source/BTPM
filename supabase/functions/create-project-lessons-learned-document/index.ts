// Phase 4D.14A.7F — Create Lessons Learned SharePoint document (Tenant runtime).
//
// Runtime ordering (fixed, no external Microsoft calls before PM authority):
//   1. Authenticate.
//   2. Validate projectId.
//   3. Prove has_project_pm_authority(user_id, projectId).
//   4. Load authoritative project row (id, workspace_id, organization_id, program_id).
//   5. Load decrypted project via protected RPC and verify id/workspace/organization match.
//   6. Load the active project SharePoint binding via admin client; verify
//      strict project/workspace/organization containment and binding_status = validated.
//   7. Build optional document metadata (workspace / program / team / portfolio).
//   8. Create ONE Tenant SharePoint publish session (resolves SharePoint
//      runtime AND acquires ONE Graph app-only token).
//   9. Resolve the project publish target live inside the effective site.
//  10. Look for the deterministic Lessons Learned filename.
//       - existing file  → reuse (never overwrite)
//       - existing folder with same name → safe name-conflict
//  11. Absent → build starter .docx and PUT with conflictBehavior=fail.
//  12. On 409 → re-read deterministic filename once and reuse or fail safely.
//  13. Persist metadata via the caller-authorized SECURITY DEFINER RPC.
//  14. Preserve the existing response contract (status, reused, document, project_portfolio).

// deno-lint-ignore-file no-explicit-any

import { createClient } from "npm:@supabase/supabase-js@2";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";
import {
  createTenantSharePointPublishSession,
  publishGeneratedDocumentBytes,
  resolveProjectDocumentPublishTarget,
} from "../_shared/sharePointGeneratedDocumentPublisher.ts";
import {
  getSharePointChildItem,
} from "../_shared/sharePointClient.ts";
import {
  buildLessonsLearnedFileName,
  lessonsLearnedPublicError,
  type LessonsLearnedPublicErrorCode,
} from "../_shared/lessonsLearnedSharePoint.ts";
import { buildLessonsLearnedDocx } from "./lessonsLearnedTemplate.ts";

const FUNCTION_NAME = "create-project-lessons-learned-document";

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

    // ---- Authority gate: BEFORE any Tenant/Graph resolution ----
    const { data: authorized, error: authErr } = await adminClient.rpc(
      "has_project_pm_authority",
      { _user_id: userData.user.id, _project_id: projectId },
    );
    if (authErr) return json(500, { error: "authority_check_failed" });
    if (authorized !== true) {
      return json(403, {
        error: "not_authorized",
        note:
          "You do not have authority to create the Lessons Learned document for this project.",
      });
    }

    // ---- Authoritative project (organization_id source of truth) ----
    const { data: project } = await adminClient
      .from("projects")
      .select("id, workspace_id, organization_id, program_id")
      .eq("id", projectId)
      .maybeSingle();
    if (!project || !project.organization_id || !project.workspace_id) {
      return json(403, { error: "not_authorized" });
    }

    // ---- Decrypted project (caller RPC) — verify containment ----
    const { data: projRows, error: projErr } = await supabase.rpc(
      "get_decrypted_project",
      { _project_id: projectId },
    );
    if (
      projErr ||
      !projRows ||
      (Array.isArray(projRows) && projRows.length === 0)
    ) {
      return json(404, { error: "project_not_accessible" });
    }
    const decrypted: any = Array.isArray(projRows) ? projRows[0] : projRows;
    if (
      decrypted?.id !== project.id ||
      decrypted?.workspace_id !== project.workspace_id ||
      (decrypted?.organization_id != null &&
        decrypted?.organization_id !== project.organization_id)
    ) {
      logSafe("project_scope_mismatch", { request_id: requestId });
      return json(403, { error: "not_authorized" });
    }
    const projectName: string = decrypted?.name ?? "Project";

    // ---- Project binding (admin) with strict containment ----
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
      await upsertMetadata(authHeader, {
        projectId,
        status: "missing_folder",
        eventType: "project_lessons_learned_document_status_changed",
      });
      return json(200, {
        status: "missing_folder",
        note:
          "This project is not linked to a validated SharePoint folder yet.",
      });
    }
    if (
      projectBinding.project_id !== project.id ||
      projectBinding.workspace_id !== project.workspace_id ||
      projectBinding.organization_id !== project.organization_id
    ) {
      logSafe("binding_scope_mismatch", { request_id: requestId });
      return json(403, { error: "not_authorized" });
    }

    // ---- Portfolio label + optional metadata ----
    const portfolioLabel: string | null = (() => {
      const id = decrypted?.portfolio_item_id ?? null;
      if (!id) return null;
      const name = decrypted?.portfolio_name || "Unnamed Portfolio";
      const code = decrypted?.portfolio_code || null;
      const base = code ? `${code} — ${name}` : name;
      return decrypted?.portfolio_is_archived ? `${base} (archived)` : base;
    })();
    const projectPortfolio = {
      portfolio_item_id: decrypted?.portfolio_item_id ?? null,
      portfolio_name: decrypted?.portfolio_name ?? null,
      portfolio_code: decrypted?.portfolio_code ?? null,
      portfolio_lifecycle_state: decrypted?.portfolio_lifecycle_state ?? null,
      portfolio_is_archived: decrypted?.portfolio_is_archived ?? null,
      portfolio_label: portfolioLabel,
    };

    let workspaceName: string | null = null;
    let programName: string | null = null;
    try {
      const { data: ws } = await adminClient
        .from("workspaces")
        .select("name")
        .eq("id", project.workspace_id)
        .maybeSingle();
      workspaceName = (ws as any)?.name ?? null;
      if (project.program_id) {
        const { data: prog } = await adminClient
          .from("programs")
          .select("name")
          .eq("id", project.program_id)
          .maybeSingle();
        programName = (prog as any)?.name ?? null;
      }
    } catch { /* optional — ignore */ }

    let projectManagerNames: string[] = [];
    let projectSponsorNames: string[] = [];
    try {
      const { data: teamJson } = await supabase.rpc(
        "list_decrypted_project_team",
        { _project_id: projectId },
      );
      const team: Array<{
        canonical_role_key: string | null;
        role_label: string | null;
        display_name: string | null;
        email: string | null;
      }> = (teamJson as any) ?? [];
      const pickName = (t: { display_name: string | null; email: string | null }) =>
        (t.display_name || "").trim() || (t.email || "").trim();
      const dedupe = (list: string[]) => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const n of list) {
          const k = n.toLowerCase();
          if (!n || seen.has(k)) continue;
          seen.add(k);
          out.push(n);
        }
        return out;
      };
      projectManagerNames = dedupe(
        team
          .filter((t) => (t.canonical_role_key || "").trim() === "project_manager")
          .map(pickName)
          .filter(Boolean),
      );
      projectSponsorNames = dedupe(
        team
          .filter((t) => (t.canonical_role_key || "").trim() === "project_sponsor")
          .map(pickName)
          .filter(Boolean),
      );
    } catch { /* optional */ }

    // ---- Tenant SharePoint publish session (one runtime + one Graph token) ----
    const sessionRes = await createTenantSharePointPublishSession({
      organizationId: project.organization_id,
      functionName: FUNCTION_NAME,
      reason: "lessons-learned-create",
      requestId,
    });
    if (!sessionRes.ok) {
      const code = sessionRes.publicError.error as LessonsLearnedPublicErrorCode;
      await upsertMetadata(authHeader, {
        projectId,
        status: "creation_failed",
        eventType: "project_lessons_learned_document_status_changed",
      });
      logSafe("session_failed", { request_id: requestId, result: code });
      return json(502, {
        status: "creation_failed",
        error: code,
        note: sessionRes.publicError.note,
      });
    }
    const session = sessionRes.session;

    // ---- Resolve project publish target live ----
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
      const status: MetadataStatus = (
        code === "project_folder_not_validated" ||
          code === "publish_target_missing"
      ) ? "missing_folder" : "creation_failed";
      await upsertMetadata(authHeader, {
        projectId,
        status,
        eventType: "project_lessons_learned_document_status_changed",
      });
      logSafe("target_failed", { request_id: requestId, result: code });
      return json(200, {
        status,
        error: code,
        note: targetRes.publicError.note,
      });
    }
    const target = targetRes.target;
    const fileName = buildLessonsLearnedFileName(projectName);

    // ---- 1) Reuse if already present — deterministic filename lookup ----
    const existing = await getSharePointChildItem({
      accessToken: session.accessToken,
      requestId: session.requestId,
      driveId: target.driveId,
      parentItemId: target.parentItemId,
      name: fileName,
      operation: "publish_lessons_learned_document",
    });
    if (existing.category === "success" && existing.item) {
      if (existing.item.folder) {
        // Folder with the deterministic name — do NOT treat as available.
        await upsertMetadata(authHeader, {
          projectId,
          status: "creation_failed",
          eventType: "project_lessons_learned_document_status_changed",
        });
        const pub = lessonsLearnedPublicError("document_name_conflict");
        logSafe("existing_is_folder", { request_id: requestId });
        return json(409, { status: "creation_failed", error: pub.code, note: pub.note });
      }
      const ok = await upsertMetadata(authHeader, {
        projectId,
        status: "available",
        documentName: existing.item.name,
        webUrl: existing.item.webUrl ?? null,
        driveId: target.driveId,
        itemId: existing.item.id,
        createdAt: existing.item.createdDateTime ?? null,
        lastModifiedAt: existing.item.lastModifiedDateTime ?? null,
        eventType: "project_lessons_learned_document_reused",
      });
      if (!ok.ok) {
        const pub = lessonsLearnedPublicError("metadata_upsert_failed");
        return json(500, { error: pub.code, note: pub.note });
      }
      logSafe("reused_existing", { request_id: requestId, reused: true });
      return json(200, {
        status: "available",
        reused: true,
        document: {
          name: existing.item.name,
          web_url: existing.item.webUrl,
          item_id: existing.item.id,
          drive_id: target.driveId,
          last_modified_at: existing.item.lastModifiedDateTime ?? null,
        },
        project_portfolio: projectPortfolio,
      });
    }
    // `item_not_found` → proceed to upload; other categories → keep going,
    // upload will surface a specific error.

    // ---- 2) Build starter .docx ----
    let bytes: Uint8Array;
    try {
      bytes = await buildLessonsLearnedDocx({
        generatedAt: new Date().toISOString().slice(0, 10),
        project: {
          name: projectName,
          workspaceName,
          programName,
          statusLabel: decrypted?.status ?? null,
          startDate: decrypted?.start_date ?? null,
          targetEndDate: decrypted?.target_end_date ?? null,
          portfolioItemId: decrypted?.portfolio_item_id ?? null,
          portfolioName: decrypted?.portfolio_name ?? null,
          portfolioCode: decrypted?.portfolio_code ?? null,
          portfolioLifecycleState: decrypted?.portfolio_lifecycle_state ?? null,
          portfolioIsArchived: decrypted?.portfolio_is_archived ?? null,
          portfolioLabel,
        },
        projectManagerNames,
        projectSponsorNames,
      });
    } catch (_e) {
      await upsertMetadata(authHeader, {
        projectId,
        status: "creation_failed",
        eventType: "project_lessons_learned_document_status_changed",
      });
      const pub = lessonsLearnedPublicError("template_build_failed");
      logSafe("template_build_failed", { request_id: requestId });
      return json(500, { status: "creation_failed", error: pub.code, note: pub.note });
    }

    // ---- 3) Upload with conflictBehavior=fail (no overwrite) ----
    const upl = await publishGeneratedDocumentBytes({
      session,
      target,
      fileName,
      bytes,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      operation: "publish_lessons_learned_document",
      conflictBehavior: "fail",
    });

    if (upl.ok) {
      const ok = await upsertMetadata(authHeader, {
        projectId,
        status: "available",
        documentName: fileName,
        webUrl: upl.item.webUrl,
        driveId: target.driveId,
        itemId: upl.item.itemId,
        createdAt: null,
        lastModifiedAt: null,
        eventType: "project_lessons_learned_document_created",
      });
      if (!ok.ok) {
        const pub = lessonsLearnedPublicError("metadata_upsert_failed");
        return json(500, { error: pub.code, note: pub.note });
      }
      logSafe("created", { request_id: requestId, reused: false });
      return json(200, {
        status: "available",
        reused: false,
        document: {
          name: fileName,
          web_url: upl.item.webUrl,
          item_id: upl.item.itemId,
          drive_id: target.driveId,
          last_modified_at: null,
        },
        project_portfolio: projectPortfolio,
      });
    }

    // ---- 4) Upload failed — handle 409 name-conflict via deterministic re-read ----
    if (upl.publicError.error === "sharepoint_name_conflict") {
      const again = await getSharePointChildItem({
        accessToken: session.accessToken,
        requestId: session.requestId,
        driveId: target.driveId,
        parentItemId: target.parentItemId,
        name: fileName,
        operation: "publish_lessons_learned_document",
      });
      if (again.category === "success" && again.item && !again.item.folder) {
        const ok = await upsertMetadata(authHeader, {
          projectId,
          status: "available",
          documentName: again.item.name,
          webUrl: again.item.webUrl ?? null,
          driveId: target.driveId,
          itemId: again.item.id,
          createdAt: again.item.createdDateTime ?? null,
          lastModifiedAt: again.item.lastModifiedDateTime ?? null,
          eventType: "project_lessons_learned_document_reused",
        });
        if (!ok.ok) {
          const pub = lessonsLearnedPublicError("metadata_upsert_failed");
          return json(500, { error: pub.code, note: pub.note });
        }
        logSafe("reused_after_conflict", { request_id: requestId, reused: true });
        return json(200, {
          status: "available",
          reused: true,
          document: {
            name: again.item.name,
            web_url: again.item.webUrl,
            item_id: again.item.id,
            drive_id: target.driveId,
            last_modified_at: again.item.lastModifiedDateTime ?? null,
          },
          project_portfolio: projectPortfolio,
        });
      }
      await upsertMetadata(authHeader, {
        projectId,
        status: "creation_failed",
        eventType: "project_lessons_learned_document_status_changed",
      });
      const pub = lessonsLearnedPublicError("document_name_conflict");
      logSafe("conflict_unresolved", { request_id: requestId });
      return json(409, { status: "creation_failed", error: pub.code, note: pub.note });
    }

    // Non-409 failure path.
    await upsertMetadata(authHeader, {
      projectId,
      status: "creation_failed",
      eventType: "project_lessons_learned_document_status_changed",
    });
    const mappedCode: LessonsLearnedPublicErrorCode = (() => {
      switch (upl.publicError.error) {
        case "publish_access_denied":
          return "sharepoint_permission_denied";
        case "sharepoint_throttled":
        case "publish_failed":
          return "sharepoint_unavailable";
        case "publish_target_missing":
          return "project_folder_not_found";
        case "microsoft_graph_not_configured":
        case "microsoft_graph_access_blocked":
        case "microsoft_graph_configuration_invalid":
        case "microsoft_graph_configuration_unavailable":
        case "sharepoint_not_configured":
        case "sharepoint_access_blocked":
        case "sharepoint_configuration_invalid":
        case "sharepoint_configuration_unavailable":
          return upl.publicError.error as LessonsLearnedPublicErrorCode;
        default:
          return "document_upload_failed";
      }
    })();
    const pub = lessonsLearnedPublicError(mappedCode);
    logSafe("upload_failed", { request_id: requestId, result: mappedCode });
    return json(502, { status: "creation_failed", error: pub.code, note: pub.note });
  } catch (_e) {
    logSafe("unexpected_error", { request_id: requestId });
    return json(500, {
      status: "creation_failed",
      error: "document_upload_failed",
      note: "Publishing to SharePoint failed. Please try again in a moment.",
    });
  }
});

