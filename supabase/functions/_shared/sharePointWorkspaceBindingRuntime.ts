// Phase 4D.14A.7D — Shared SharePoint workspace-binding runtime.
//
// Anchors the workspace-library folder picker and project-folder linking
// strictly inside the validated workspace SharePoint library. This module
// NEVER queries Supabase or Vault, acquires credentials or Graph tokens,
// reads `M365_*` / `BTPM_SP_*` env vars, trusts client-supplied site /
// drive / item IDs as authoritative, or logs URLs / IDs / names.

// deno-lint-ignore-file no-explicit-any

import {
  parseAndNormalizeSharePointSiteUrl,
  type SharePointRuntimeConfig,
} from "./tenantSharePoint.ts";
import {
  getSharePointDriveRoot,
  listSharePointSiteDrivesDetailed,
  resolveSharePointSiteById,
  resolveSharePointSiteByPath,
  type SharePointDriveItem,
  type SharePointTransportCategory,
} from "./sharePointClient.ts";
import {
  matchProjectBindingLibrary,
  normalizeSharePointUrlForComparison,
} from "./sharePointProjectBindingRuntime.ts";

// ---------- Public safe error contract ----------

export type SharePointWorkspaceRuntimePublicError =
  | "workspace_binding_not_validated"
  | "workspace_binding_site_mismatch"
  | "workspace_binding_organization_mismatch"
  | "sharepoint_permission_denied"
  | "sharepoint_site_unavailable"
  | "sharepoint_temporarily_unavailable"
  | "library_not_found"
  | "workspace_folder_not_found";

export interface WorkspaceSafePublicError {
  status: number;
  body: { ok: false; error: SharePointWorkspaceRuntimePublicError; note: string };
}

export const SHAREPOINT_WORKSPACE_RUNTIME_PUBLIC_NOTES: Record<
  SharePointWorkspaceRuntimePublicError,
  string
> = {
  workspace_binding_not_validated:
    "The workspace SharePoint library must be validated first.",
  workspace_binding_site_mismatch:
    "The workspace SharePoint library is not on the currently configured SharePoint site.",
  workspace_binding_organization_mismatch:
    "The workspace and its SharePoint binding do not belong to the same Organization.",
  sharepoint_permission_denied:
    "SharePoint denied access to the requested resource.",
  sharepoint_site_unavailable:
    "The configured SharePoint site is not currently available.",
  sharepoint_temporarily_unavailable:
    "SharePoint is temporarily unavailable. Please try again shortly.",
  library_not_found:
    "The workspace library could not be found on the configured SharePoint site.",
  workspace_folder_not_found:
    "The workspace SharePoint library root could not be resolved.",
};

function safeError(
  code: SharePointWorkspaceRuntimePublicError,
  status: number,
): WorkspaceSafePublicError {
  return {
    status,
    body: { ok: false, error: code, note: SHAREPOINT_WORKSPACE_RUNTIME_PUBLIC_NOTES[code] },
  };
}

// ---------- Inputs ----------

export interface WorkspaceBindingInput {
  organization_id: string | null;
  workspace_id: string | null;
  binding_status: string | null;
  site_web_url: string | null;
  library_web_url: string | null;
}

export interface WorkspaceLibraryRoot {
  siteId: string;
  driveId: string;
  driveWebUrl: string;
  rootItem: SharePointDriveItem;
}

export interface ResolveWorkspaceLibraryRootArgs {
  accessToken: string;
  sharePointRuntime: SharePointRuntimeConfig;
  workspaceBinding: WorkspaceBindingInput;
  requestId: string;
  fetchImpl?: typeof fetch;
}

export type ResolveWorkspaceLibraryRootResult =
  | { ok: true; root: WorkspaceLibraryRoot }
  | { ok: false; publicError: WorkspaceSafePublicError };

function transportToPublic(
  category: SharePointTransportCategory,
  ctx: "site" | "libraries" | "root",
): WorkspaceSafePublicError {
  switch (category) {
    case "success":
      return safeError("sharepoint_temporarily_unavailable", 502);
    case "permission_denied":
      return safeError("sharepoint_permission_denied", 403);
    case "token_rejected":
      return safeError("sharepoint_temporarily_unavailable", 502);
    case "site_not_found":
    case "site_mismatch":
      return safeError("sharepoint_site_unavailable", 502);
    case "libraries_not_found":
      return safeError(
        ctx === "root" ? "workspace_folder_not_found" : "library_not_found",
        404,
      );
    case "item_not_found":
      return safeError(
        ctx === "root" ? "workspace_folder_not_found" : "library_not_found",
        404,
      );
    case "rate_limited":
    case "timeout":
    case "network_error":
    case "graph_unavailable":
    case "response_invalid":
    default:
      return safeError("sharepoint_temporarily_unavailable", 502);
  }
}

/**
 * Resolve the workspace-library root using ONLY the effective Tenant
 * SharePoint site and the validated workspace binding. No client input
 * is trusted for site/drive resolution.
 */
export async function resolveSharePointWorkspaceLibraryRoot(
  args: ResolveWorkspaceLibraryRootArgs,
): Promise<ResolveWorkspaceLibraryRootResult> {
  const {
    accessToken,
    sharePointRuntime: runtime,
    workspaceBinding: binding,
    requestId,
    fetchImpl,
  } = args;

  if (!binding || binding.binding_status !== "validated") {
    return { ok: false, publicError: safeError("workspace_binding_not_validated", 400) };
  }
  if (!binding.site_web_url || !binding.library_web_url) {
    return { ok: false, publicError: safeError("workspace_binding_not_validated", 400) };
  }

  // Binding site must match effective Tenant SharePoint site.
  const parsedBindingSite = parseAndNormalizeSharePointSiteUrl(binding.site_web_url);
  if (!parsedBindingSite.ok) {
    return { ok: false, publicError: safeError("workspace_binding_site_mismatch", 400) };
  }
  if (parsedBindingSite.value.href.toLowerCase() !== runtime.siteUrl.href.toLowerCase()) {
    return { ok: false, publicError: safeError("workspace_binding_site_mismatch", 400) };
  }

  // 1. Resolve site (id → path).
  const siteRes = runtime.siteId
    ? await resolveSharePointSiteById({
      accessToken,
      requestId,
      siteId: runtime.siteId,
      configuredSiteUrl: runtime.siteUrl,
      fetchImpl,
    })
    : await resolveSharePointSiteByPath({
      accessToken,
      requestId,
      configuredSiteUrl: runtime.siteUrl,
      fetchImpl,
    });
  if (siteRes.category !== "success" || !siteRes.site) {
    return { ok: false, publicError: transportToPublic(siteRes.category, "site") };
  }
  const siteId = siteRes.site.siteId;

  // 2. List drives.
  const drivesRes = await listSharePointSiteDrivesDetailed({
    accessToken,
    requestId,
    siteId,
    operation: "browse_workspace_library",
    fetchImpl,
  });
  if (drivesRes.category !== "success" || drivesRes.drives.length === 0) {
    return { ok: false, publicError: transportToPublic(drivesRes.category, "libraries") };
  }

  // 3. Match library exactly (or container) via bound library URL.
  const drive = matchProjectBindingLibrary(drivesRes.drives, binding.library_web_url);
  if (!drive) {
    return { ok: false, publicError: safeError("library_not_found", 404) };
  }
  // Sanity-check: library URL should share the site host.
  if (
    normalizeSharePointUrlForComparison(drive.webUrl).indexOf(
      normalizeSharePointUrlForComparison(runtime.siteUrl.href),
    ) !== 0
  ) {
    return { ok: false, publicError: safeError("library_not_found", 404) };
  }

  // 4. Resolve live drive root.
  const rootRes = await getSharePointDriveRoot({
    accessToken,
    requestId,
    driveId: drive.id,
    operation: "resolve_workspace_folder",
    fetchImpl,
  });
  if (rootRes.category !== "success" || !rootRes.item) {
    return { ok: false, publicError: transportToPublic(rootRes.category, "root") };
  }

  return {
    ok: true,
    root: {
      siteId,
      driveId: drive.id,
      driveWebUrl: drive.webUrl,
      rootItem: rootRes.item,
    },
  };
}
