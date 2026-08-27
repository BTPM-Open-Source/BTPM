// Phase 4D.14A.7B — Shared SharePoint project-binding runtime.
//
// Centralizes the (previously duplicated) logic for browsing a project's
// bound SharePoint folder and validating evidence-file containment inside
// that folder, without touching Vault, credentials, or user data.
//
// This module NEVER:
//   - queries Supabase or Vault
//   - resolves Microsoft Graph or SharePoint credentials
//   - acquires Graph tokens
//   - reads `M365_*` / `BTPM_SP_*` env vars
//   - trusts client-supplied `siteId` / `driveId` / `itemId` values as
//     authoritative
//   - logs site, drive, item, folder, library, path, URL, or file-name
//     values
//   - falls back to Global configuration

// deno-lint-ignore-file no-explicit-any

import type { SharePointRuntimeConfig } from "./tenantSharePoint.ts";
import {
  getSharePointDriveItemByPath,
  getSharePointDriveItemMetadata,
  getSharePointDriveRoot,
  listSharePointSiteDrivesDetailed,
  resolveSharePointSiteById,
  resolveSharePointSiteByPath,
  type SharePointDriveItem,
  type SharePointTransportCategory,
} from "./sharePointClient.ts";

// ---------- Public safe error contract ----------

/**
 * Fixed public error codes surfaced by the browse / select functions.
 * Preserves browser-facing codes the UI already depends on
 * (`project_sharepoint_folder_not_configured`, `outside_project_scope`,
 * `item_not_found`).
 */
export type SharePointProjectBindingPublicError =
  | "sharepoint_not_configured"
  | "sharepoint_access_blocked"
  | "sharepoint_configuration_invalid"
  | "sharepoint_configuration_unavailable"
  | "microsoft_graph_not_configured"
  | "microsoft_graph_access_blocked"
  | "microsoft_graph_configuration_invalid"
  | "microsoft_graph_configuration_unavailable"
  | "sharepoint_permission_denied"
  | "sharepoint_site_unavailable"
  | "sharepoint_temporarily_unavailable"
  | "project_sharepoint_folder_not_configured"
  | "project_sharepoint_binding_invalid"
  | "bound_library_not_found"
  | "project_folder_not_found"
  | "item_not_found"
  | "outside_project_scope";

export interface SafePublicError {
  status: number;
  body: { ok: false; error: SharePointProjectBindingPublicError; note: string };
}

const PUBLIC_NOTES: Record<SharePointProjectBindingPublicError, string> = {
  sharepoint_not_configured:
    "The SharePoint Tenant integration is not configured or is incomplete.",
  sharepoint_access_blocked:
    "SharePoint access is not allowed for this Organization or environment.",
  sharepoint_configuration_invalid:
    "The SharePoint Tenant integration configuration is invalid.",
  sharepoint_configuration_unavailable:
    "SharePoint configuration is temporarily unavailable.",
  microsoft_graph_not_configured:
    "The Microsoft Graph Tenant integration is not configured or is incomplete.",
  microsoft_graph_access_blocked:
    "Microsoft Graph access is not allowed for this Organization or environment.",
  microsoft_graph_configuration_invalid:
    "The Microsoft Graph Tenant integration configuration is invalid.",
  microsoft_graph_configuration_unavailable:
    "Microsoft Graph configuration is temporarily unavailable.",
  sharepoint_permission_denied:
    "SharePoint denied access to the requested resource.",
  sharepoint_site_unavailable:
    "The configured SharePoint site is not currently available.",
  sharepoint_temporarily_unavailable:
    "SharePoint is temporarily unavailable. Please try again shortly.",
  project_sharepoint_folder_not_configured:
    "This project does not have a connected SharePoint folder yet.",
  project_sharepoint_binding_invalid:
    "This project's SharePoint folder binding is not valid.",
  bound_library_not_found:
    "The library bound to this project could not be found on the configured SharePoint site.",
  project_folder_not_found:
    "The project's SharePoint folder could not be found.",
  item_not_found: "The requested SharePoint item could not be found.",
  outside_project_scope: "Item is outside this project's SharePoint folder.",
};

function safeError(
  code: SharePointProjectBindingPublicError,
  status: number,
): SafePublicError {
  return { status, body: { ok: false, error: code, note: PUBLIC_NOTES[code] } };
}

// Public export so callers can extend/reference the note map safely.
export const SHAREPOINT_PROJECT_BINDING_PUBLIC_NOTES = PUBLIC_NOTES;

// ---------- Site + drive matching helpers (pure) ----------

/**
 * Normalize a SharePoint URL for case-insensitive comparison. Strips
 * query strings, fragments, form/site-page suffixes and trailing slashes.
 */
export function normalizeSharePointUrlForComparison(raw: string): string {
  if (!raw) return "";
  let u = raw.trim();
  try { u = decodeURI(u); } catch { /* ignore */ }
  u = u.replace(/\/Forms\/[^/]*\.aspx.*$/i, "");
  u = u.replace(/\/SitePages\/[^/]*\.aspx.*$/i, "");
  u = u.replace(/[?#].*$/, "");
  u = u.replace(/\/+$/, "");
  return u.toLowerCase();
}

export interface DriveMatchInput {
  id: string;
  webUrl: string;
}

/**
 * Match a bound library URL to exactly one drive on the resolved site.
 * Exact match wins; falls back to a `libraryUrl` that lives underneath a
 * drive's webUrl. Returns null when no unambiguous match exists.
 */
export function matchProjectBindingLibrary(
  drives: DriveMatchInput[],
  libraryWebUrl: string | null | undefined,
): DriveMatchInput | null {
  if (!libraryWebUrl) return null;
  const target = normalizeSharePointUrlForComparison(libraryWebUrl);
  if (target.length === 0) return null;
  const exact = drives.find(
    (d) => normalizeSharePointUrlForComparison(d.webUrl) === target,
  );
  if (exact) return exact;
  const container = drives.find(
    (d) => target.startsWith(normalizeSharePointUrlForComparison(d.webUrl) + "/"),
  );
  return container ?? null;
}

/**
 * Compute the folder path relative to the drive root for a folder URL that
 * lives inside a given drive's webUrl. Returns null if the folder URL is
 * outside the drive.
 */
export function computeFolderRelativePathWithinDrive(
  driveWebUrl: string,
  folderWebUrl: string,
): string | null {
  const driveBase = driveWebUrl.replace(/\/+$/, "");
  const cleaned = folderWebUrl.replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (
    !normalizeSharePointUrlForComparison(cleaned)
      .startsWith(normalizeSharePointUrlForComparison(driveBase))
  ) {
    return null;
  }
  const tail = cleaned.slice(driveBase.length);
  if (tail.length === 0) return "";
  let rel = tail;
  try { rel = decodeURIComponent(tail); } catch { /* keep raw */ }
  if (!rel.startsWith("/")) rel = `/${rel}`;
  return rel;
}

// ---------- Root-containment (pure) ----------

/**
 * Whether a Graph drive item lies inside the project-root drive item.
 * Uses the same containment rules the previous inline implementations
 * used, but explicitly guards against cross-drive escapes.
 */
export function isSharePointItemUnderProjectRoot(
  item: SharePointDriveItem,
  rootItem: SharePointDriveItem,
): boolean {
  if (item.id === rootItem.id) return true;
  const itemDriveId = item.parentReference?.driveId ?? null;
  const rootDriveId = rootItem.parentReference?.driveId ?? null;
  // Cross-drive escape check — must be same drive when both are known.
  if (rootDriveId && itemDriveId && rootDriveId !== itemDriveId) return false;
  const rootHasPath = !!rootItem.parentReference?.path;
  if (!rootHasPath) {
    if (rootDriveId && itemDriveId) return itemDriveId === rootDriveId;
    const p = item.parentReference?.path ?? "";
    return p.startsWith("/drive/root") || p.startsWith("/drives/");
  }
  const itemParentPath = item.parentReference?.path ?? "";
  const rootParentPath = rootItem.parentReference?.path ?? "";
  const rootName = rootItem.name ?? "";
  const itemFullPath = `${itemParentPath}/${item.name ?? ""}`.replace(/\/+/g, "/");
  const rootFullPath = `${rootParentPath}/${rootName}`.replace(/\/+/g, "/");
  return itemFullPath === rootFullPath ||
    itemFullPath.startsWith(rootFullPath + "/");
}

// ---------- Runtime interfaces ----------

export interface ProjectBindingInput {
  binding_status: string | null;
  folder_web_url: string | null;
  resolved_library_web_url: string | null;
}

export interface ProjectRoot {
  siteId: string;
  driveId: string;
  rootItem: SharePointDriveItem;
}

export interface ResolveProjectRootArgs {
  accessToken: string;
  runtime: SharePointRuntimeConfig;
  binding: ProjectBindingInput;
  requestId: string;
  fetchImpl?: typeof fetch;
}

export type ResolveProjectRootResult =
  | { ok: true; root: ProjectRoot }
  | { ok: false; publicError: SafePublicError };

function transportToPublic(
  category: SharePointTransportCategory,
  ctx: "site" | "libraries" | "folder",
): SafePublicError {
  switch (category) {
    case "success":
      return safeError("sharepoint_temporarily_unavailable", 502);
    case "token_rejected":
      return safeError("microsoft_graph_configuration_unavailable", 502);
    case "permission_denied":
      return safeError("sharepoint_permission_denied", 403);
    case "site_not_found":
      return safeError("sharepoint_site_unavailable", 502);
    case "site_mismatch":
      return safeError("sharepoint_configuration_invalid", 502);
    case "libraries_not_found":
      return safeError(
        ctx === "folder" ? "project_folder_not_found" : "bound_library_not_found",
        404,
      );
    case "item_not_found":
      return safeError(
        ctx === "folder" ? "project_folder_not_found" : "item_not_found",
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
 * Resolve the project-root drive item using ONLY the effective Tenant
 * SharePoint site configuration and the validated project binding. No
 * client input is accepted or trusted.
 */
export async function resolveSharePointProjectRoot(
  args: ResolveProjectRootArgs,
): Promise<ResolveProjectRootResult> {
  const { accessToken, runtime, binding, requestId, fetchImpl } = args;

  if (!binding || binding.binding_status !== "validated") {
    return {
      ok: false,
      publicError: safeError("project_sharepoint_folder_not_configured", 400),
    };
  }

  // 1. Resolve configured site (by id if present, otherwise by path). The
  //    resolver already verifies the returned webUrl matches config.
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

  // 2. List libraries on that site.
  const drivesRes = await listSharePointSiteDrivesDetailed({
    accessToken,
    requestId,
    siteId,
    operation: "resolve_project_root",
    fetchImpl,
  });
  if (drivesRes.category !== "success" || drivesRes.drives.length === 0) {
    return {
      ok: false,
      publicError: transportToPublic(drivesRes.category, "libraries"),
    };
  }

  // 3. Match binding library.
  const libraryWebUrl =
    binding.resolved_library_web_url ?? binding.folder_web_url ?? null;
  if (!libraryWebUrl) {
    return {
      ok: false,
      publicError: safeError("project_sharepoint_binding_invalid", 400),
    };
  }
  const drive = matchProjectBindingLibrary(drivesRes.drives, libraryWebUrl);
  if (!drive) {
    return { ok: false, publicError: safeError("bound_library_not_found", 404) };
  }

  // 4. Resolve the folder within the matched library.
  const folderUrl = binding.folder_web_url;
  if (!folderUrl) {
    return {
      ok: false,
      publicError: safeError("project_sharepoint_binding_invalid", 400),
    };
  }
  const relative = computeFolderRelativePathWithinDrive(drive.webUrl, folderUrl);
  if (relative === null) {
    return {
      ok: false,
      publicError: safeError("project_sharepoint_binding_invalid", 400),
    };
  }

  const rootRes = relative === "" || relative === "/"
    ? await getSharePointDriveRoot({
      accessToken,
      requestId,
      driveId: drive.id,
      operation: "resolve_project_root",
      fetchImpl,
    })
    : await getSharePointDriveItemByPath({
      accessToken,
      requestId,
      driveId: drive.id,
      relativePath: relative,
      operation: "resolve_project_folder",
      fetchImpl,
    });
  if (rootRes.category !== "success" || !rootRes.item) {
    return { ok: false, publicError: transportToPublic(rootRes.category, "folder") };
  }

  return {
    ok: true,
    root: { siteId, driveId: drive.id, rootItem: rootRes.item },
  };
}

// ---------- Breadcrumb traversal ----------

export interface BuildBreadcrumbsArgs {
  accessToken: string;
  requestId: string;
  root: ProjectRoot;
  currentItem: SharePointDriveItem;
  fetchImpl?: typeof fetch;
  maxDepth?: number;
}

/**
 * Walk parents from `currentItem` up to the project root and return the
 * ordered `[root ... current]` breadcrumb list. Traversal STOPS at the
 * project root and cannot escape it: parents beyond the root are never
 * fetched or emitted.
 */
export async function buildSharePointProjectBreadcrumbs(
  args: BuildBreadcrumbsArgs,
): Promise<Array<{ id: string; name: string }>> {
  const { accessToken, requestId, root, currentItem, fetchImpl } = args;
  const maxDepth = Math.max(1, Math.min(50, args.maxDepth ?? 20));
  const chain: Array<{ id: string; name: string }> = [];
  let cursor: SharePointDriveItem = currentItem;
  for (let i = 0; i < maxDepth; i++) {
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
      fetchImpl,
    });
    if (res.category !== "success" || !res.item) break;
    // Escape guard — must remain inside the project root.
    if (!isSharePointItemUnderProjectRoot(res.item, root.rootItem)) {
      chain.unshift({ id: root.rootItem.id, name: root.rootItem.name });
      break;
    }
    cursor = res.item;
  }
  // Deduplicate consecutive.
  const out: Array<{ id: string; name: string }> = [];
  for (const c of chain) {
    if (!out.length || out[out.length - 1].id !== c.id) out.push(c);
  }
  return out;
}
