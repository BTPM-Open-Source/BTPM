/**
 * DC.15 — Browse the project's connected SharePoint folder for Decision
 * Case evidence selection. Strictly scoped to the project's project
 * folder (binding) and its subfolders. No file contents returned.
 *
 * Phase 4D.14A.7B — Tenant runtime cutover:
 *  - SharePoint site config comes from the effective Tenant SharePoint
 *    integration (Organization-aware).
 *  - Graph credentials come from the effective Tenant Microsoft Graph
 *    integration; one token is acquired and reused for every Graph read
 *    in this invocation.
 *  - No `M365_*` or `BTPM_SP_*` env reads and no Global fallback.
 *  - Client-supplied `folderDriveId` is a consistency assertion only;
 *    all authoritative drive/site/root values come from the server-
 *    resolved binding.
 *
 * Request body:
 *   { recordId: string, folderDriveId?: string, folderItemId?: string }
 *
 * Auth: required. Caller must pass `_gov_assert_project_read(project_id)`.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";
import {
  resolveTenantSharePointRuntimeConfig,
  toSafeSharePointPublicError,
  TenantSharePointError,
} from "../_shared/tenantSharePoint.ts";
import { resolveAndAcquireTenantMicrosoftGraph } from "../_shared/tenantMicrosoftGraphRuntime.ts";
import {
  buildSharePointProjectBreadcrumbs,
  isSharePointItemUnderProjectRoot,
  resolveSharePointProjectRoot,
  SHAREPOINT_PROJECT_BINDING_PUBLIC_NOTES,
} from "../_shared/sharePointProjectBindingRuntime.ts";
import {
  getSharePointDriveItemMetadata,
  listSharePointDriveItemChildren,
  type SharePointDriveItem,
} from "../_shared/sharePointClient.ts";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";

const FUNCTION_NAME = "browse-governance-decision-sharepoint-files";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function logSafe(event: string, fields: Record<string, unknown>) {
  console.log(`[${FUNCTION_NAME}] ${event}`, JSON.stringify({
    component: FUNCTION_NAME,
    ...fields,
  }));
}

function safePublic(
  code: keyof typeof SHAREPOINT_PROJECT_BINDING_PUBLIC_NOTES,
  status: number,
) {
  return json(status, {
    ok: false,
    error: code,
    note: SHAREPOINT_PROJECT_BINDING_PUBLIC_NOTES[code],
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const requestId = crypto.randomUUID();
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { ok: false, error: "missing_auth" });
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    try {
      const verifier = createSupabaseTokenVerifier(caller);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }
    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData?.user) {
      return json(401, { ok: false, error: "not_authenticated" });
    }

    const body = await req.json().catch(() => ({}));
    const recordId = body?.recordId as string | undefined;
    if (!recordId) return json(400, { ok: false, error: "recordId is required" });

    // 1. Caller-scoped protected Decision Case resolution.
    //    C20C7: this MUST precede any service-role business-table read.
    //    The protected RPC owns: governance_records lookup, Project read
    //    authority (`_gov_assert_project_read`) and Decision Case kind
    //    validation, and returns the authoritative scope IDs.
    const { data: projectSummary, error: summaryError } = await caller.rpc(
      "get_governance_decision_case_project_summary",
      { _record_id: recordId },
    );
    if (summaryError) {
      const code = (summaryError as { code?: string } | null)?.code ?? "";
      if (code === "P0002") return json(404, { ok: false, error: "record_not_found" });
      if (code === "22023") return json(400, { ok: false, error: "not_a_decision_case" });
      logSafe("record_resolution_denied", { request_id: requestId });
      return json(403, { ok: false, error: "forbidden" });
    }
    const summary = projectSummary as {
      project_id?: string;
      workspace_id?: string;
      organization_id?: string;
    } | null;
    const projectId = summary?.project_id;
    const organizationId = summary?.organization_id;
    if (!projectId || !organizationId) {
      logSafe("record_resolution_incomplete", { request_id: requestId });
      return json(403, { ok: false, error: "forbidden" });
    }

    // 2. Explicit caller-scoped Project read authority (defense in depth).
    const { error: aErr } = await caller.rpc("_gov_assert_project_read", {
      _project_id: projectId,
    });
    if (aErr) {
      logSafe("authority_denied", { request_id: requestId, operation: "read" });
      return json(403, {
        ok: false,
        error: "forbidden",
        note: "You do not have permission to browse SharePoint files on this project.",
      });
    }

    // Service-role client is only constructed AFTER caller authority.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 3. Active project SharePoint binding.

    const { data: binding } = await admin
      .from("sharepoint_project_bindings")
      .select("binding_status, folder_web_url, resolved_library_web_url")
      .eq("project_id", projectId)
      .maybeSingle();
    if (!binding || binding.binding_status !== "validated") {
      return safePublic("project_sharepoint_folder_not_configured", 400);
    }

    // 4. SharePoint runtime (Organization-scoped, fail-closed).
    let runtime;
    try {
      runtime = await resolveTenantSharePointRuntimeConfig({
        organizationId: organizationId,
        action: "real_integration",
        functionName: FUNCTION_NAME,
        reason: "decision-case-sharepoint-browse",
        requestId,
      });
    } catch (e) {
      const pub = toSafeSharePointPublicError(e);
      const code = e instanceof TenantSharePointError ? e.code : "configuration_unavailable";
      logSafe("sharepoint_runtime_failed", { request_id: requestId, result: code });
      return json(502, { ok: false, error: pub.error, note: pub.note });
    }

    // 5. Graph runtime + ONE token per invocation.
    const graph = await resolveAndAcquireTenantMicrosoftGraph({
      organizationId: organizationId,
      functionName: FUNCTION_NAME,
      reason: "decision-case-sharepoint-browse",
      requestId,
    });
    if (!graph.ok) {
      logSafe("graph_runtime_failed", {
        request_id: requestId,
        result: graph.publicError.error,
      });
      return json(502, {
        ok: false,
        error: graph.publicError.error,
        note: graph.publicError.note,
      });
    }
    const accessToken = graph.accessToken;

    // 6. Resolve project root (site → drive → root item).
    const rootRes = await resolveSharePointProjectRoot({
      accessToken,
      runtime,
      binding,
      requestId,
    });
    if (!rootRes.ok) {
      const pe = rootRes.publicError;
      logSafe("project_root_failed", {
        request_id: requestId,
        result: pe.body.error,
      });
      return json(pe.status, pe.body);
    }
    const root = rootRes.root;

    // 7. Server-authoritative folder-scope check for client-supplied id.
    const clientDriveId = typeof body?.folderDriveId === "string"
      ? body.folderDriveId
      : null;
    const folderItemId = typeof body?.folderItemId === "string"
      ? body.folderItemId
      : null;
    if (clientDriveId && clientDriveId !== root.driveId) {
      return safePublic("outside_project_scope", 403);
    }
    const targetItemId = folderItemId ?? root.rootItem.id;

    let currentItem: SharePointDriveItem = root.rootItem;
    if (targetItemId !== root.rootItem.id) {
      const meta = await getSharePointDriveItemMetadata({
        accessToken,
        requestId,
        driveId: root.driveId,
        itemId: targetItemId,
        operation: "read_project_folder_item",
      });
      if (meta.category === "item_not_found" || !meta.item) {
        return safePublic("item_not_found", 404);
      }
      if (meta.category !== "success") {
        logSafe("folder_lookup_failed", {
          request_id: requestId,
          result: meta.category,
        });
        return safePublic("sharepoint_temporarily_unavailable", 502);
      }
      if (!isSharePointItemUnderProjectRoot(meta.item, root.rootItem)) {
        return safePublic("outside_project_scope", 403);
      }
      currentItem = meta.item;
    }

    // 8. Children.
    const childrenRes = await listSharePointDriveItemChildren({
      accessToken,
      requestId,
      driveId: root.driveId,
      itemId: targetItemId,
      operation: "list_project_folder_children",
    });
    if (childrenRes.category !== "success") {
      logSafe("children_failed", {
        request_id: requestId,
        result: childrenRes.category,
      });
      if (childrenRes.category === "item_not_found") {
        return safePublic("item_not_found", 404);
      }
      if (childrenRes.category === "permission_denied") {
        return safePublic("sharepoint_permission_denied", 403);
      }
      return safePublic("sharepoint_temporarily_unavailable", 502);
    }

    // 9. Breadcrumbs — cannot escape the project root.
    const breadcrumbs = await buildSharePointProjectBreadcrumbs({
      accessToken,
      requestId,
      root,
      currentItem,
    });

    const items = childrenRes.items.map((it) => ({
      id: it.id,
      drive_id: root.driveId,
      site_id: root.siteId,
      name: it.name,
      is_folder: !!it.folder,
      mime_type: it.file?.mimeType ?? null,
      size: it.size,
      etag: it.eTag,
      ctag: it.cTag,
      created_at: it.createdDateTime,
      last_modified_at: it.lastModifiedDateTime,
      parent_path: it.parentReference?.path ?? null,
      web_url: it.webUrl,
      child_count: it.folder?.childCount ?? null,
    }));

    return json(200, {
      ok: true,
      site_id: root.siteId,
      drive_id: root.driveId,
      root: {
        id: root.rootItem.id,
        name: root.rootItem.name,
        web_url: root.rootItem.webUrl,
      },
      current: {
        id: currentItem.id,
        name: currentItem.name,
        web_url: currentItem.webUrl,
      },
      breadcrumbs,
      items,
    });
  } catch (_e) {
    logSafe("unhandled", { request_id: requestId });
    return json(500, { ok: false, error: "unhandled" });
  }
});
