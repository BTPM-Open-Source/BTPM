/**
 * Phase 4D.14A.7D — SharePoint file manager (server-side, Tenant-runtime).
 *
 * All actions authenticate the caller, prove authority BEFORE any Tenant
 * secret resolution or Microsoft Graph request, then resolve one
 * SharePoint runtime and (when needed) acquire ONE Microsoft Graph token
 * per invocation via canonical shared helpers:
 *
 *   - resolveTenantSharePointRuntimeConfig   (SharePoint site config)
 *   - resolveAndAcquireTenantMicrosoftGraph  (Graph token, app-only)
 *   - resolveTenantMicrosoftGraphClientIdentity (picker: public IDs only)
 *   - resolveSharePointProjectRoot           (project-binding root scope)
 *   - resolveSharePointWorkspaceLibraryRoot  (workspace-library scope)
 *   - sharePointClient.ts                    (transport-only Graph calls)
 *
 * This module NEVER reads M365_* / BTPM_SP_* env vars, acquires its own
 * Graph tokens, calls Graph directly with fetch, echoes raw Microsoft or
 * RPC error bodies, or logs URLs, IDs, item names, tokens, or bodies.
 */

// deno-lint-ignore-file no-explicit-any

import { createClient } from "npm:@supabase/supabase-js@2.50.0";
import { assertBrowserSessionOnly } from "../_shared/btpm-api/assertBrowserSessionOnly.ts";
import { createSupabaseTokenVerifier } from "../_shared/btpm-api/resolveTokenContext.ts";
import { toSafeErrorResponse } from "../_shared/btpm-api/apiErrors.ts";
import {
  resolveTenantSharePointRuntimeConfig,
  toSafeSharePointPublicError,
} from "../_shared/tenantSharePoint.ts";
import {
  resolveAndAcquireTenantMicrosoftGraph,
} from "../_shared/tenantMicrosoftGraphRuntime.ts";
import {
  resolveTenantMicrosoftGraphClientIdentity,
  toSafeMicrosoftGraphPublicError,
} from "../_shared/tenantMicrosoftGraph.ts";
import {
  buildSharePointProjectBreadcrumbs,
  computeFolderRelativePathWithinDrive,
  isSharePointItemUnderProjectRoot,
  normalizeSharePointUrlForComparison,
  resolveSharePointProjectRoot,
  type ProjectRoot,
} from "../_shared/sharePointProjectBindingRuntime.ts";
import {
  resolveSharePointWorkspaceLibraryRoot,
  type WorkspaceLibraryRoot,
} from "../_shared/sharePointWorkspaceBindingRuntime.ts";
import {
  createSharePointFolder,
  createSharePointUploadSession,
  deleteSharePointDriveItem,
  getSharePointChildItem,
  getSharePointDriveItemByPath,
  getSharePointDriveItemMetadata,
  listSharePointDriveItemChildren,
  type SharePointDriveItem,
} from "../_shared/sharePointClient.ts";

const FUNCTION_NAME = "sharepoint-files";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// ------------------------------------------------------------------
// Safe response contract
// ------------------------------------------------------------------

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeErr(status: number, error: string, note?: string) {
  return json(status, note ? { error, note } : { error });
}

function logSafe(event: string, fields: Record<string, unknown>) {
  console.log(
    `[${FUNCTION_NAME}] ${event}`,
    JSON.stringify({ component: FUNCTION_NAME, ...fields }),
  );
}

// ------------------------------------------------------------------
// Fixed input validators
// ------------------------------------------------------------------

const NAME_MAX = 200;
function safeFolderName(raw: unknown): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return null;
  if (/[\\/:*?"<>|#%]/.test(trimmed)) return null;
  if (trimmed.length > NAME_MAX) return null;
  if (trimmed === "." || trimmed === "..") return null;
  return trimmed;
}

// ------------------------------------------------------------------
// Transport → safe public error mapping
// ------------------------------------------------------------------

function mapReadTransport(
  cat: string,
  ctx: "list" | "lookup" | "children",
): { status: number; error: string; note: string } {
  switch (cat) {
    case "permission_denied":
      return { status: 403, error: "sharepoint_permission_denied", note: "SharePoint denied access." };
    case "item_not_found":
      return { status: 404, error: "item_not_found", note: "The requested SharePoint item could not be found." };
    case "rate_limited":
      return { status: 429, error: "sharepoint_unavailable", note: "SharePoint is rate limiting requests. Please try again shortly." };
    case "timeout":
      return { status: 504, error: "sharepoint_timeout", note: "SharePoint request timed out. Please try again." };
    case "network_error":
    case "graph_unavailable":
      return { status: 502, error: "sharepoint_unavailable", note: "SharePoint is temporarily unavailable." };
    case "token_rejected":
      return { status: 502, error: "microsoft_graph_configuration_unavailable", note: "Microsoft Graph configuration is temporarily unavailable." };
    case "response_invalid":
    default:
      return { status: 502, error: "sharepoint_response_invalid", note: "SharePoint returned an unexpected response." };
  }
}

function mapWriteTransport(
  cat: string,
): { status: number; error: string; note: string } {
  switch (cat) {
    case "item_conflict":
      return { status: 409, error: "folder_exists", note: "An item with that name already exists." };
    case "permission_denied":
      return { status: 403, error: "sharepoint_permission_denied", note: "SharePoint denied access." };
    case "item_not_found":
      return { status: 404, error: "folder_not_found", note: "The parent folder could not be found." };
    case "rate_limited":
      return { status: 429, error: "sharepoint_unavailable", note: "SharePoint is rate limiting requests. Please try again shortly." };
    case "timeout":
      return { status: 504, error: "sharepoint_timeout", note: "SharePoint request timed out. Please try again." };
    case "network_error":
    case "graph_unavailable":
      return { status: 502, error: "sharepoint_unavailable", note: "SharePoint is temporarily unavailable." };
    case "token_rejected":
      return { status: 502, error: "microsoft_graph_configuration_unavailable", note: "Microsoft Graph configuration is temporarily unavailable." };
    case "response_invalid":
    default:
      return { status: 502, error: "sharepoint_response_invalid", note: "SharePoint returned an unexpected response." };
  }
}

// ------------------------------------------------------------------
// Response mappers
// ------------------------------------------------------------------

function itemForListing(it: SharePointDriveItem, fallbackDriveId: string) {
  return {
    id: it.id,
    drive_id: it.parentReference?.driveId ?? fallbackDriveId,
    name: it.name,
    type: it.folder ? "folder" : "file",
    size: it.size ?? null,
    mime_type: it.file?.mimeType ?? null,
    web_url: it.webUrl,
    last_modified_at: it.lastModifiedDateTime ?? null,
    // Graph `lastModifiedBy` isn't in our transport shape, so we omit
    // display-name resolution and return null (frontend already handles).
    last_modified_by: null,
    child_count: it.folder?.childCount ?? null,
  };
}

// ==================================================================
// Handler
// ==================================================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const requestId = crypto.randomUUID();
  try {
    // ---- Auth ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return safeErr(401, "Missing Authorization header");
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    try {
      const verifier = createSupabaseTokenVerifier(callerClient);
      await assertBrowserSessionOnly(req, verifier);
    } catch (guardError) {
      return toSafeErrorResponse(guardError, corsHeaders);
    }
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) return safeErr(401, "Not authenticated");
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === "string" ? body.action : null;
    if (!action) return safeErr(400, "action is required");

    // ------------------------------------------------------------
    // Workspace-binding actions (picker_config, browse_workspace_library,
    // link_project_folder). Each performs its OWN authority check
    // BEFORE resolving Tenant runtime or calling Microsoft Graph.
    // ------------------------------------------------------------
    if (
      action === "picker_config" ||
      action === "browse_workspace_library" ||
      action === "link_project_folder"
    ) {
      const wsBindingId = typeof body?.workspace_binding_id === "string"
        ? body.workspace_binding_id
        : null;
      if (!wsBindingId) {
        return safeErr(400, "workspace_binding_id is required");
      }
      const { data: wsBinding } = await adminClient
        .from("sharepoint_workspace_bindings")
        .select(
          "id, workspace_id, organization_id, site_web_url, library_web_url, binding_status",
        )
        .eq("id", wsBindingId)
        .maybeSingle();
      if (!wsBinding) return safeErr(404, "Not authorized");
      if (wsBinding.binding_status !== "validated") {
        return safeErr(
          400,
          "workspace_binding_not_validated",
          "The workspace SharePoint library must be validated first.",
        );
      }

      // Workspace / organization containment.
      const { data: workspace } = await adminClient
        .from("workspaces")
        .select("id, organization_id")
        .eq("id", wsBinding.workspace_id)
        .maybeSingle();
      if (
        !workspace ||
        !workspace.organization_id ||
        workspace.organization_id !== wsBinding.organization_id
      ) {
        return safeErr(403, "Not authorized");
      }

      // ---- Action-specific authority (BEFORE any Tenant secret /
      // Graph call). picker_config + browse_workspace_library: read
      // authority (workspace member OR org admin). link_project_folder:
      // workspace PM OR project PM OR org admin (after project load).
      let readAllowed = false;
      const { data: isMember } = await callerClient.rpc("is_workspace_member", {
        _user_id: userId,
        _workspace_id: wsBinding.workspace_id,
      });
      if (isMember) readAllowed = true;
      let isOrgAdmin = false;
      if (!readAllowed && wsBinding.organization_id) {
        const { data: orgAdmin } = await callerClient.rpc("is_org_admin", {
          _user_id: userId,
          _organization_id: wsBinding.organization_id,
        });
        isOrgAdmin = !!orgAdmin;
        if (isOrgAdmin) readAllowed = true;
      }

      // link_project_folder needs project containment + link authority
      // BEFORE any Tenant secret / Graph call.
      let project: { id: string; workspace_id: string; organization_id: string | null } | null = null;
      if (action === "link_project_folder") {
        const projectId = typeof body?.project_id === "string" ? body.project_id : null;
        if (!projectId) {
          return safeErr(400, "project_id is required");
        }
        const { data: proj } = await adminClient
          .from("projects")
          .select("id, workspace_id, organization_id")
          .eq("id", projectId)
          .maybeSingle();
        if (!proj) return safeErr(403, "Not authorized");
        if (proj.workspace_id !== wsBinding.workspace_id) {
          return safeErr(400, "project_workspace_mismatch", "Project does not belong to this workspace.");
        }
        if (
          proj.organization_id &&
          wsBinding.organization_id &&
          proj.organization_id !== wsBinding.organization_id
        ) {
          return safeErr(403, "Not authorized");
        }
        project = proj;

        let canLink = false;
        const { data: wsPm } = await callerClient.rpc("has_pm_authority", {
          _user_id: userId,
          _workspace_id: wsBinding.workspace_id,
        });
        if (wsPm) canLink = true;
        if (!canLink) {
          const { data: projPm } = await callerClient.rpc("has_project_pm_authority", {
            _user_id: userId,
            _project_id: projectId,
          });
          if (projPm) canLink = true;
        }
        if (!canLink && isOrgAdmin) canLink = true;
        if (!canLink) return safeErr(403, "Not authorized");
      } else {
        if (!readAllowed) return safeErr(403, "Not authorized");
      }

      // ---- picker_config: only public identifiers, no Graph call ----
      if (action === "picker_config") {
        let identity;
        try {
          identity = await resolveTenantMicrosoftGraphClientIdentity({
            organizationId: wsBinding.organization_id!,
            action: "real_integration",
            functionName: FUNCTION_NAME,
            reason: "file-picker-identity",
            requestId,
          });
        } catch (e) {
          const pub = toSafeMicrosoftGraphPublicError(e);
          logSafe("picker_identity_failed", { request_id: requestId, result: pub.error });
          return json(502, pub);
        }
        // SharePoint runtime must exist to confirm binding site matches
        // effective Tenant site.
        let sharePointRuntime;
        try {
          sharePointRuntime = await resolveTenantSharePointRuntimeConfig({
            organizationId: wsBinding.organization_id!,
            action: "real_integration",
            functionName: FUNCTION_NAME,
            reason: "file-picker-site",
            requestId,
          });
        } catch (e) {
          const pub = toSafeSharePointPublicError(e);
          logSafe("picker_sharepoint_failed", { request_id: requestId, result: pub.error });
          return json(502, pub);
        }
        // Binding site MUST match effective Tenant site.
        if (
          normalizeSharePointUrlForComparison(wsBinding.site_web_url) !==
          sharePointRuntime.siteUrl.href.toLowerCase()
        ) {
          return safeErr(
            400,
            "workspace_binding_site_mismatch",
            "The workspace SharePoint library is not on the currently configured SharePoint site.",
          );
        }
        let spHost: string | null = null;
        try { spHost = new URL(wsBinding.site_web_url).hostname; } catch { /* ignore */ }
        logSafe("picker_config_ok", { request_id: requestId });
        return json(200, {
          client_id: identity.clientId,
          tenant_id: identity.microsoftTenantId,
          site_web_url: wsBinding.site_web_url,
          library_web_url: wsBinding.library_web_url,
          sharepoint_host: spHost,
        });
      }

      // ---- browse_workspace_library / link_project_folder need Graph ----
      let sharePointRuntime;
      try {
        sharePointRuntime = await resolveTenantSharePointRuntimeConfig({
          organizationId: wsBinding.organization_id!,
          action: "real_integration",
          functionName: FUNCTION_NAME,
          reason: `workspace-${action}`,
          requestId,
        });
      } catch (e) {
        const pub = toSafeSharePointPublicError(e);
        logSafe("sharepoint_runtime_failed", { request_id: requestId, result: pub.error });
        return json(502, pub);
      }
      const graph = await resolveAndAcquireTenantMicrosoftGraph({
        organizationId: wsBinding.organization_id!,
        functionName: FUNCTION_NAME,
        reason: `workspace-${action}`,
        requestId,
      });
      if (!graph.ok) {
        logSafe("graph_runtime_failed", { request_id: requestId, result: graph.publicError.error });
        return json(502, graph.publicError);
      }
      const accessToken = graph.accessToken;

      const rootRes = await resolveSharePointWorkspaceLibraryRoot({
        accessToken,
        sharePointRuntime,
        workspaceBinding: wsBinding,
        requestId,
      });
      if (!rootRes.ok) {
        logSafe("workspace_root_failed", { request_id: requestId, result: rootRes.publicError.body.error });
        return json(rootRes.publicError.status, rootRes.publicError.body);
      }
      const libRoot = rootRes.root;

      // ---- browse_workspace_library ----
      if (action === "browse_workspace_library") {
        const clientItemId = typeof body?.item_id === "string" && body.item_id
          ? body.item_id
          : null;
        let currentItem: SharePointDriveItem = libRoot.rootItem;
        if (clientItemId && clientItemId !== libRoot.rootItem.id) {
          const meta = await getSharePointDriveItemMetadata({
            accessToken,
            requestId,
            driveId: libRoot.driveId,
            itemId: clientItemId,
            operation: "read_project_folder_item",
          });
          if (meta.category !== "success" || !meta.item) {
            const m = mapReadTransport(meta.category, "lookup");
            return json(m.status, { error: m.error, note: m.note });
          }
          if (!isWorkspaceItemUnderRoot(meta.item, libRoot)) {
            return safeErr(403, "outside_project_scope", "Item is outside the workspace library.");
          }
          if (!meta.item.folder) {
            return safeErr(400, "not_a_folder", "Selected item is not a folder.");
          }
          currentItem = meta.item;
        }
        const childrenRes = await listSharePointDriveItemChildren({
          accessToken,
          requestId,
          driveId: libRoot.driveId,
          itemId: currentItem.id,
          operation: "browse_workspace_library",
        });
        if (childrenRes.category !== "success") {
          const m = mapReadTransport(childrenRes.category, "children");
          return json(m.status, { error: m.error, note: m.note });
        }
        const folders = childrenRes.items
          .filter((it) => !!it.folder)
          .map((it) => ({
            id: it.id,
            name: it.name,
            web_url: it.webUrl,
            child_count: it.folder?.childCount ?? null,
          }));
        const crumbs = await buildBreadcrumbsUnderWorkspaceRoot(
          accessToken,
          requestId,
          libRoot,
          currentItem,
        );
        return json(200, {
          root: {
            id: libRoot.rootItem.id,
            name: libRoot.rootItem.name,
            web_url: libRoot.rootItem.webUrl,
          },
          current: {
            id: currentItem.id,
            name: currentItem.name,
            web_url: currentItem.webUrl,
          },
          breadcrumbs: crumbs,
          folders,
        });
      }

      // ---- link_project_folder ----
      // (project loaded above)
      const itemIdInput = typeof body?.item_id === "string" ? body.item_id : null;
      const webUrlInput = typeof body?.web_url === "string" ? body.web_url : null;
      if (!itemIdInput && !webUrlInput) {
        return safeErr(400, "project_id and item_id or web_url are required");
      }

      // Live-resolve the selected folder (webUrl is only a hint; item_id
      // when provided is authoritative but must be verified live).
      let resolvedByUrl: SharePointDriveItem | null = null;
      if (webUrlInput) {
        const relative = computeFolderRelativePathWithinDrive(libRoot.driveWebUrl, webUrlInput);
        if (relative === null) {
          return safeErr(400, "folder_outside_library", "Selected folder is outside the workspace library.");
        }
        const rr = relative === "" || relative === "/"
          ? await getSharePointDriveItemMetadata({
            accessToken,
            requestId,
            driveId: libRoot.driveId,
            itemId: libRoot.rootItem.id,
            operation: "resolve_workspace_folder",
          })
          : await getSharePointDriveItemByPath({
            accessToken,
            requestId,
            driveId: libRoot.driveId,
            relativePath: relative,
            operation: "resolve_workspace_folder",
          });
        if (rr.category !== "success" || !rr.item) {
          const m = mapReadTransport(rr.category, "lookup");
          return json(m.status, { error: m.error, note: m.note });
        }
        resolvedByUrl = rr.item;
      }
      let resolvedById: SharePointDriveItem | null = null;
      if (itemIdInput) {
        const meta = await getSharePointDriveItemMetadata({
          accessToken,
          requestId,
          driveId: libRoot.driveId,
          itemId: itemIdInput,
          operation: "resolve_workspace_folder",
        });
        if (meta.category !== "success" || !meta.item) {
          const m = mapReadTransport(meta.category, "lookup");
          return json(m.status, { error: m.error, note: m.note });
        }
        resolvedById = meta.item;
      }
      const folder: SharePointDriveItem =
        (resolvedById ?? resolvedByUrl) as SharePointDriveItem;
      if (!folder) return safeErr(400, "folder_not_found");
      if (resolvedById && resolvedByUrl && resolvedById.id !== resolvedByUrl.id) {
        return safeErr(400, "folder_not_found", "Selection is inconsistent.");
      }
      if (!folder.folder) return safeErr(400, "not_a_folder", "Selected item is not a folder.");
      if (!isWorkspaceItemUnderRoot(folder, libRoot)) {
        return safeErr(403, "folder_outside_library", "Selected folder is outside the workspace library.");
      }

      // Derive server-relative path from server-resolved parent + name.
      const parentPath: string = folder?.parentReference?.path ?? "";
      const inDriveParent = parentPath.replace(/^\/drive\/root:?/, "").replace(/^\/drives\/[^:]+:?/, "");
      const folderRelative = `${inDriveParent}/${folder.name}`.replace(/\/+/g, "/");

      const { data: upserted, error: uErr } = await callerClient.rpc(
        "upsert_sharepoint_project_binding",
        {
          _project_id: project!.id,
          _binding_mode: "workspace_library_default",
          _folder_web_url: folder.webUrl,
          _folder_relative_path: folderRelative,
          _folder_item_id: folder.id,
          _resolved_site_web_url: null,
          _resolved_site_id: null,
          _resolved_library_web_url: null,
          _resolved_library_id_or_drive_id: null,
        },
      );
      if (uErr) {
        logSafe("project_binding_upsert_failed", { request_id: requestId });
        return safeErr(400, "project_binding_upsert_failed", "Could not persist the project SharePoint binding.");
      }
      const row = Array.isArray(upserted) ? upserted[0] : upserted;
      logSafe("project_binding_linked", { request_id: requestId });
      return json(200, { binding: row });
    }

    // ------------------------------------------------------------
    // Project-binding actions (list_children, create_subfolder,
    // upload_file_init, resolve_subpath, ensure_subpath, delete_item).
    // Authority is proven BEFORE any Tenant secret / Graph call.
    // ------------------------------------------------------------
    const bindingId = typeof body?.binding_id === "string" ? body.binding_id : null;
    if (!bindingId) return safeErr(400, "binding_id is required");
    const { data: binding } = await adminClient
      .from("sharepoint_project_bindings")
      .select(
        "id, project_id, workspace_id, organization_id, binding_status, folder_web_url, resolved_library_web_url",
      )
      .eq("id", bindingId)
      .maybeSingle();
    if (!binding) return safeErr(404, "Not authorized");
    if (binding.binding_status === "disabled") {
      return safeErr(400, "binding_disabled", "This SharePoint link is disabled.");
    }
    if (binding.binding_status !== "validated") {
      return safeErr(400, "binding_not_validated", "Binding must be validated before browsing files.");
    }
    if (!binding.project_id) {
      return safeErr(400, "binding_missing_project", "Binding has no project.");
    }
    // Project containment.
    const { data: project } = await adminClient
      .from("projects")
      .select("id, workspace_id, organization_id")
      .eq("id", binding.project_id)
      .maybeSingle();
    if (!project) return safeErr(403, "Not authorized");
    if (
      (binding.workspace_id && project.workspace_id !== binding.workspace_id) ||
      (binding.organization_id && project.organization_id &&
        project.organization_id !== binding.organization_id)
    ) {
      return safeErr(403, "Not authorized");
    }

    const isMutation =
      action === "create_subfolder" ||
      action === "upload_file_init" ||
      action === "ensure_subpath" ||
      action === "delete_item";
    const authorityRpc = isMutation ? "has_project_pm_authority" : "has_project_access";
    if (action !== "list_children" &&
        action !== "create_subfolder" &&
        action !== "upload_file_init" &&
        action !== "resolve_subpath" &&
        action !== "ensure_subpath" &&
        action !== "delete_item") {
      return safeErr(400, "Unsupported SharePoint file action.");
    }
    const { data: allowed, error: aErr } = await callerClient.rpc(authorityRpc, {
      _user_id: userId,
      _project_id: binding.project_id,
    });
    if (aErr || !allowed) {
      logSafe("authority_denied", { request_id: requestId, action, mutation: isMutation });
      return safeErr(403, "Not authorized");
    }

    // Resolve Tenant runtime + one Graph token per invocation.
    const organizationId = binding.organization_id ?? project.organization_id;
    if (!organizationId) {
      return safeErr(403, "Not authorized");
    }
    let sharePointRuntime;
    try {
      sharePointRuntime = await resolveTenantSharePointRuntimeConfig({
        organizationId,
        action: "real_integration",
        functionName: FUNCTION_NAME,
        reason: `project-${action}`,
        requestId,
      });
    } catch (e) {
      const pub = toSafeSharePointPublicError(e);
      logSafe("sharepoint_runtime_failed", { request_id: requestId, result: pub.error });
      return json(502, pub);
    }
    const graph = await resolveAndAcquireTenantMicrosoftGraph({
      organizationId,
      functionName: FUNCTION_NAME,
      reason: `project-${action}`,
      requestId,
    });
    if (!graph.ok) {
      logSafe("graph_runtime_failed", { request_id: requestId, result: graph.publicError.error });
      return json(502, graph.publicError);
    }
    const accessToken = graph.accessToken;

    const rootRes = await resolveSharePointProjectRoot({
      accessToken,
      runtime: sharePointRuntime,
      binding,
      requestId,
    });
    if (!rootRes.ok) {
      const pe = rootRes.publicError;
      logSafe("project_root_failed", { request_id: requestId, result: pe.body.error });
      return json(pe.status, pe.body);
    }
    const root = rootRes.root;

    // ---- list_children ----
    if (action === "list_children") {
      const targetItemId = typeof body?.item_id === "string" && body.item_id
        ? body.item_id
        : root.rootItem.id;
      let currentItem: SharePointDriveItem = root.rootItem;
      if (targetItemId !== root.rootItem.id) {
        const meta = await getSharePointDriveItemMetadata({
          accessToken,
          requestId,
          driveId: root.driveId,
          itemId: targetItemId,
          operation: "read_project_folder_item",
        });
        if (meta.category !== "success" || !meta.item) {
          const m = mapReadTransport(meta.category, "lookup");
          return json(m.status, { error: m.error, note: m.note });
        }
        if (!isSharePointItemUnderProjectRoot(meta.item, root.rootItem)) {
          return safeErr(403, "outside_project_scope", "Requested item is outside the project folder.");
        }
        if (!meta.item.folder) {
          return safeErr(400, "not_a_folder", "Requested item is not a folder.");
        }
        currentItem = meta.item;
      }
      const childrenRes = await listSharePointDriveItemChildren({
        accessToken,
        requestId,
        driveId: root.driveId,
        itemId: currentItem.id,
        operation: "list_project_files",
      });
      if (childrenRes.category !== "success") {
        const m = mapReadTransport(childrenRes.category, "children");
        return json(m.status, { error: m.error, note: m.note });
      }
      const items = childrenRes.items.map((it) => itemForListing(it, root.driveId));
      const crumbs = await buildSharePointProjectBreadcrumbs({
        accessToken,
        requestId,
        root,
        currentItem,
      });
      return json(200, {
        drive_id: root.driveId,
        root: { id: root.rootItem.id, name: root.rootItem.name, web_url: root.rootItem.webUrl },
        current: { id: currentItem.id, name: currentItem.name, web_url: currentItem.webUrl },
        breadcrumbs: crumbs,
        items,
      });
    }

    // ---- create_subfolder ----
    if (action === "create_subfolder") {
      const parentItemId = typeof body?.parent_item_id === "string" && body.parent_item_id
        ? body.parent_item_id
        : root.rootItem.id;
      const name = safeFolderName(body?.name);
      if (!name) return safeErr(400, "invalid_name", "Folder name is empty or contains invalid characters.");
      const parent = await requireFolderUnderRoot(
        accessToken, requestId, root, parentItemId,
      );
      if ("publicError" in parent) return json(parent.status, parent.publicError);
      const created = await createSharePointFolder({
        accessToken,
        requestId,
        driveId: root.driveId,
        parentItemId: parent.item.id,
        name,
        operation: "create_project_folder",
      });
      if (created.category !== "success" || !created.item) {
        const m = mapWriteTransport(created.category);
        return json(m.status, { error: m.error, note: m.note });
      }
      return json(200, {
        item: { id: created.item.id, name: created.item.name, web_url: created.item.webUrl, type: "folder" },
      });
    }

    // ---- upload_file_init ----
    if (action === "upload_file_init") {
      const parentItemId = typeof body?.parent_item_id === "string" && body.parent_item_id
        ? body.parent_item_id
        : root.rootItem.id;
      const fileName = safeFolderName(body?.file_name);
      if (!fileName) return safeErr(400, "invalid_name", "File name is empty or contains invalid characters.");
      const parent = await requireFolderUnderRoot(
        accessToken, requestId, root, parentItemId,
      );
      if ("publicError" in parent) return json(parent.status, parent.publicError);
      const session = await createSharePointUploadSession({
        accessToken,
        requestId,
        driveId: root.driveId,
        parentItemId: parent.item.id,
        fileName,
        operation: "create_project_upload_session",
      });
      if (session.category !== "success" || !session.uploadUrl) {
        const m = mapWriteTransport(session.category);
        return json(m.status, { error: m.error, note: m.note });
      }
      // Upload URL is scoped-capability + short-lived; never logged.
      return json(200, {
        upload_url: session.uploadUrl,
        expires_at: session.expirationDateTime,
      });
    }

    // ---- resolve_subpath (read-only walk) ----
    if (action === "resolve_subpath") {
      const segments = Array.isArray(body?.segments) ? body.segments : [];
      if (segments.length === 0) {
        return json(200, {
          item: {
            id: root.rootItem.id,
            name: root.rootItem.name,
            web_url: root.rootItem.webUrl,
            type: "folder",
          },
        });
      }
      let parent: SharePointDriveItem = root.rootItem;
      for (const raw of segments) {
        const name = safeFolderName(raw);
        if (!name) return safeErr(400, "invalid_segment", "Subfolder name invalid.");
        const child = await getSharePointChildItem({
          accessToken,
          requestId,
          driveId: root.driveId,
          parentItemId: parent.id,
          name,
          operation: "resolve_project_subpath",
        });
        if (child.category === "item_not_found") {
          return json(200, { item: null, missing: true });
        }
        if (child.category !== "success" || !child.item) {
          const m = mapReadTransport(child.category, "lookup");
          return json(m.status, { error: m.error, note: m.note });
        }
        if (!isSharePointItemUnderProjectRoot(child.item, root.rootItem)) {
          return safeErr(403, "outside_project_scope", "Path escaped project folder.");
        }
        if (!child.item.folder) {
          return json(409, {
            error: "path_blocked_by_file",
            note: "A file exists where a folder is needed.",
          });
        }
        parent = child.item;
      }
      return json(200, {
        item: { id: parent.id, name: parent.name, web_url: parent.webUrl, type: "folder" },
      });
    }

    // ---- ensure_subpath (mutation) ----
    if (action === "ensure_subpath") {
      const segments = Array.isArray(body?.segments) ? body.segments : [];
      if (segments.length === 0) {
        return json(200, {
          item: {
            id: root.rootItem.id,
            name: root.rootItem.name,
            web_url: root.rootItem.webUrl,
            type: "folder",
          },
        });
      }
      let parent: SharePointDriveItem = root.rootItem;
      for (const raw of segments) {
        const name = safeFolderName(raw);
        if (!name) return safeErr(400, "invalid_segment", "Subfolder name invalid.");
        const lookup = await getSharePointChildItem({
          accessToken,
          requestId,
          driveId: root.driveId,
          parentItemId: parent.id,
          name,
          operation: "resolve_project_subpath",
        });
        if (lookup.category === "success" && lookup.item) {
          if (!isSharePointItemUnderProjectRoot(lookup.item, root.rootItem)) {
            return safeErr(403, "outside_project_scope", "Path escaped project folder.");
          }
          if (!lookup.item.folder) {
            return json(409, {
              error: "path_blocked_by_file",
              note: "A file exists where a folder is needed.",
            });
          }
          parent = lookup.item;
          continue;
        }
        if (lookup.category !== "item_not_found") {
          const m = mapReadTransport(lookup.category, "lookup");
          return json(m.status, { error: m.error, note: m.note });
        }
        // Create.
        const created = await createSharePointFolder({
          accessToken,
          requestId,
          driveId: root.driveId,
          parentItemId: parent.id,
          name,
          operation: "ensure_project_subpath",
        });
        if (created.category === "success" && created.item) {
          if (!isSharePointItemUnderProjectRoot(created.item, root.rootItem)) {
            return safeErr(403, "outside_project_scope", "Created folder escaped project folder.");
          }
          parent = created.item;
          continue;
        }
        if (created.category === "item_conflict") {
          // Race: re-fetch.
          const re = await getSharePointChildItem({
            accessToken,
            requestId,
            driveId: root.driveId,
            parentItemId: parent.id,
            name,
            operation: "resolve_project_subpath",
          });
          if (re.category === "success" && re.item && re.item.folder &&
              isSharePointItemUnderProjectRoot(re.item, root.rootItem)) {
            parent = re.item;
            continue;
          }
        }
        const m = mapWriteTransport(created.category);
        return json(m.status, { error: m.error, note: m.note });
      }
      return json(200, {
        item: { id: parent.id, name: parent.name, web_url: parent.webUrl, type: "folder" },
      });
    }

    // ---- delete_item ----
    if (action === "delete_item") {
      const itemId = typeof body?.item_id === "string" ? body.item_id : null;
      if (!itemId) return safeErr(400, "item_id is required");
      if (itemId === root.rootItem.id) {
        return safeErr(400, "cannot_delete_root", "The project folder itself cannot be deleted.");
      }
      const meta = await getSharePointDriveItemMetadata({
        accessToken,
        requestId,
        driveId: root.driveId,
        itemId,
        operation: "read_project_folder_item",
      });
      if (meta.category !== "success" || !meta.item) {
        const m = mapReadTransport(meta.category, "lookup");
        return json(m.status, { error: m.error, note: m.note });
      }
      // Verify same server-resolved drive.
      const itemDriveId = meta.item.parentReference?.driveId ?? null;
      if (itemDriveId && itemDriveId !== root.driveId) {
        return safeErr(403, "outside_project_scope", "Item is on a different drive.");
      }
      if (!isSharePointItemUnderProjectRoot(meta.item, root.rootItem)) {
        return safeErr(403, "outside_project_scope", "Item is outside the project folder.");
      }
      const del = await deleteSharePointDriveItem({
        accessToken,
        requestId,
        driveId: root.driveId,
        itemId: meta.item.id,
        operation: "delete_project_item",
      });
      if (del.category !== "success") {
        const m = mapWriteTransport(del.category);
        return json(m.status, { error: m.error, note: m.note });
      }
      return json(200, { success: true });
    }

    return safeErr(400, "Unsupported SharePoint file action.");
  } catch (_e) {
    logSafe("unhandled", { request_id: requestId });
    return safeErr(500, "internal_error", "The request failed. Please try again.");
  }
});

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

async function requireFolderUnderRoot(
  accessToken: string,
  requestId: string,
  root: ProjectRoot,
  itemId: string,
): Promise<
  | { item: SharePointDriveItem }
  | { status: number; publicError: { error: string; note: string } }
> {
  if (itemId === root.rootItem.id) return { item: root.rootItem };
  const meta = await getSharePointDriveItemMetadata({
    accessToken,
    requestId,
    driveId: root.driveId,
    itemId,
    operation: "read_project_folder_item",
  });
  if (meta.category !== "success" || !meta.item) {
    const m = mapReadTransport(meta.category, "lookup");
    return { status: m.status, publicError: { error: m.error, note: m.note } };
  }
  if (!isSharePointItemUnderProjectRoot(meta.item, root.rootItem)) {
    return {
      status: 403,
      publicError: { error: "outside_project_scope", note: "Requested item is outside the project folder." },
    };
  }
  if (!meta.item.folder) {
    return {
      status: 400,
      publicError: { error: "not_a_folder", note: "Parent item is not a folder." },
    };
  }
  return { item: meta.item };
}

/** Simple containment check for workspace root: same drive; item id is root or has parent chain leading back to root. */
function isWorkspaceItemUnderRoot(
  item: SharePointDriveItem,
  root: WorkspaceLibraryRoot,
): boolean {
  if (item.id === root.rootItem.id) return true;
  const itemDriveId = item.parentReference?.driveId ?? null;
  if (itemDriveId && itemDriveId !== root.driveId) return false;
  // For workspace root (drive root), any item on the same drive is
  // under it. `resolveSharePointWorkspaceLibraryRoot` always returns
  // the drive root, so a same-drive item is in scope.
  return true;
}

async function buildBreadcrumbsUnderWorkspaceRoot(
  accessToken: string,
  requestId: string,
  root: WorkspaceLibraryRoot,
  current: SharePointDriveItem,
): Promise<Array<{ id: string; name: string }>> {
  const chain: Array<{ id: string; name: string }> = [];
  let cursor = current;
  for (let i = 0; i < 20; i++) {
    chain.unshift({ id: cursor.id, name: cursor.name });
    if (cursor.id === root.rootItem.id) break;
    const parentId = cursor.parentReference?.id ?? null;
    if (!parentId || parentId === root.rootItem.id) {
      chain.unshift({ id: root.rootItem.id, name: root.rootItem.name });
      break;
    }
    const res = await getSharePointDriveItemMetadata({
      accessToken,
      requestId,
      driveId: root.driveId,
      itemId: parentId,
      operation: "read_project_folder_parent",
    });
    if (res.category !== "success" || !res.item) break;
    if (!isWorkspaceItemUnderRoot(res.item, root)) {
      chain.unshift({ id: root.rootItem.id, name: root.rootItem.name });
      break;
    }
    cursor = res.item;
  }
  const out: Array<{ id: string; name: string }> = [];
  for (const c of chain) {
    if (!out.length || out[out.length - 1].id !== c.id) out.push(c);
  }
  return out;
}
