// Phase 4D.14A.7A — Transport-only SharePoint client for the Test
// Connection Edge Function.
//
// This module NEVER:
//   - queries Supabase / Vault
//   - resolves Organization / Tenant context
//   - acquires Graph credentials itself
//   - reads `M365_*` or `BTPM_SP_*` env vars
//   - caches tokens
//   - logs Authorization headers, response bodies, drive/library IDs,
//     library names, hostnames beyond `graph.microsoft.com`, or full
//     Graph paths.

// deno-lint-ignore-file no-explicit-any

import {
  parseAndNormalizeSharePointSiteUrl,
  type NormalizedSharePointSiteUrl,
} from "./tenantSharePoint.ts";

export type SharePointTransportCategory =
  | "success"
  | "permission_denied"
  | "token_rejected"
  | "site_not_found"
  | "site_mismatch"
  | "libraries_not_found"
  | "item_not_found"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "graph_unavailable"
  | "response_invalid";

export type SharePointOperation =
  | "resolve_site_by_id"
  | "resolve_site_by_path"
  | "list_site_libraries"
  | "resolve_project_root"
  | "resolve_project_folder"
  | "read_project_folder_item"
  | "list_project_folder_children"
  | "read_project_folder_parent"
  | "read_selected_evidence_item"
  // Phase 4D.14A.7D — SharePoint file-manager operations.
  | "browse_workspace_library"
  | "resolve_workspace_folder"
  | "list_project_files"
  | "resolve_project_subpath"
  | "create_project_folder"
  | "ensure_project_subpath"
  | "create_project_upload_session"
  | "delete_project_item"
  // Phase 4D.14A.7E — Generated-document publish operations.
  | "resolve_site_default_drive"
  | "publish_project_charter"
  | "publish_project_closure_report"
  | "publish_decision_case_word_brief"
  | "publish_decision_case_ppt_onepager"
  | "publish_project_status_deck"
  | "publish_roadmap_status_deck";

export const SHAREPOINT_TEST_TIMEOUT_MS = 20_000;
const COMPONENT = "sharepoint-connection-test";
const GRAPH_HOST = "graph.microsoft.com";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function log(
  operation: SharePointOperation,
  requestId: string,
  fields: Record<string, unknown>,
) {
  const safe: Record<string, unknown> = {
    component: COMPONENT,
    operation,
    host: GRAPH_HOST,
    request_id: requestId,
  };
  for (const [k, v] of Object.entries(fields)) {
    const lk = k.toLowerCase();
    if (
      lk.includes("authorization") ||
      lk.includes("token") ||
      lk.includes("secret") ||
      lk.includes("site_id") ||
      lk.includes("site_url") ||
      lk.includes("hostname") ||
      lk.includes("path") ||
      lk.includes("drive") ||
      lk.includes("library") ||
      lk.includes("name") ||
      lk === "body" ||
      lk === "data" ||
      lk === "message"
    ) continue;
    safe[k] = v;
  }
  console.log(`[${COMPONENT}] ${operation}`, JSON.stringify(safe));
}

function classifyTransportFailure(
  err: unknown,
): "timeout" | "network_error" {
  if (err && typeof err === "object" && "name" in err) {
    const name = String((err as { name?: unknown }).name ?? "");
    if (name === "AbortError" || name === "TimeoutError") return "timeout";
  }
  return "network_error";
}

/**
 * HTTP-status → transport category during site resolution.
 * - 401 → `token_rejected` (unexpected resource-token rejection)
 * - 403 → `permission_denied` (Microsoft Graph app permission denial;
 *   NOT a BTPM environment block)
 * - 404 → `site_not_found`
 */
export function classifySiteHttpStatus(
  status: number,
): SharePointTransportCategory {
  if (status >= 200 && status < 300) return "success";
  if (status === 401) return "token_rejected";
  if (status === 403) return "permission_denied";
  if (status === 404) return "site_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "graph_unavailable";
  return "graph_unavailable";
}

/** HTTP status → transport category for drive listing. */
export function classifyDrivesHttpStatus(
  status: number,
): SharePointTransportCategory {
  if (status >= 200 && status < 300) return "success";
  if (status === 401) return "token_rejected";
  if (status === 403) return "permission_denied";
  if (status === 404) return "libraries_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "graph_unavailable";
  return "graph_unavailable";
}


export interface ResolvedSiteInfo {
  /** Graph-returned canonical site ID (opaque to browser code). */
  siteId: string;
  /** Graph-returned webUrl (never returned to browser). */
  webUrl: string;
}

export interface ResolveSiteResult {
  category: SharePointTransportCategory;
  httpStatus: number | null;
  site: ResolvedSiteInfo | null;
}

export interface CommonRequestArgs {
  accessToken: string;
  requestId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function graphGet(
  url: string,
  args: CommonRequestArgs,
): Promise<{ response: Response | null; failure: "timeout" | "network_error" | null }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const timeoutMs = args.timeoutMs ?? SHAREPOINT_TEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      return { response, failure: null };
    } catch (e) {
      return { response: null, failure: classifyTransportFailure(e) };
    }
  } finally {
    clearTimeout(timer);
  }
}

function normalizeWebUrlForComparison(v: string): string {
  const parsed = parseAndNormalizeSharePointSiteUrl(v);
  if (!parsed.ok) return v.trim().toLowerCase().replace(/\/+$/, "");
  return parsed.value.href.toLowerCase();
}

function siteUrlsMatch(
  configured: NormalizedSharePointSiteUrl,
  returned: string,
): boolean {
  return configured.href.toLowerCase() === normalizeWebUrlForComparison(returned);
}

export interface ResolveSiteByIdArgs extends CommonRequestArgs {
  siteId: string;
  configuredSiteUrl: NormalizedSharePointSiteUrl;
}

export async function resolveSharePointSiteById(
  args: ResolveSiteByIdArgs,
): Promise<ResolveSiteResult> {
  const url = `${GRAPH_BASE}/sites/${encodeURIComponent(args.siteId)}?$select=id,webUrl`;
  const { response, failure } = await graphGet(url, args);
  if (!response) {
    const cat = failure ?? "network_error";
    log("resolve_site_by_id", args.requestId, { result: cat, http_status: null });
    return { category: cat, httpStatus: null, site: null };
  }
  const status = response.status;
  if (status < 200 || status >= 300) {
    try { await response.arrayBuffer(); } catch { /* ignore */ }
    const cat = classifySiteHttpStatus(status);
    log("resolve_site_by_id", args.requestId, { result: cat, http_status: status });
    return { category: cat, httpStatus: status, site: null };
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    log("resolve_site_by_id", args.requestId, {
      result: "response_invalid",
      http_status: status,
    });
    return { category: "response_invalid", httpStatus: status, site: null };
  }
  const id = (parsed as any)?.id;
  const webUrl = (parsed as any)?.webUrl;
  if (typeof id !== "string" || typeof webUrl !== "string") {
    log("resolve_site_by_id", args.requestId, {
      result: "response_invalid",
      http_status: status,
    });
    return { category: "response_invalid", httpStatus: status, site: null };
  }
  if (!siteUrlsMatch(args.configuredSiteUrl, webUrl)) {
    log("resolve_site_by_id", args.requestId, {
      result: "site_mismatch",
      http_status: status,
    });
    return { category: "site_mismatch", httpStatus: status, site: null };
  }
  log("resolve_site_by_id", args.requestId, {
    result: "success",
    http_status: status,
  });
  return {
    category: "success",
    httpStatus: status,
    site: { siteId: id, webUrl },
  };
}

export interface ResolveSiteByPathArgs extends CommonRequestArgs {
  configuredSiteUrl: NormalizedSharePointSiteUrl;
}

export async function resolveSharePointSiteByPath(
  args: ResolveSiteByPathArgs,
): Promise<ResolveSiteResult> {
  const { hostname, path, isRootSite } = args.configuredSiteUrl;
  const url = isRootSite
    ? `${GRAPH_BASE}/sites/${encodeURIComponent(hostname)}?$select=id,webUrl`
    // path already begins with `/`, e.g. `/sites/foo`
    : `${GRAPH_BASE}/sites/${encodeURIComponent(hostname)}:${path}?$select=id,webUrl`;
  const { response, failure } = await graphGet(url, args);
  if (!response) {
    const cat = failure ?? "network_error";
    log("resolve_site_by_path", args.requestId, { result: cat, http_status: null });
    return { category: cat, httpStatus: null, site: null };
  }
  const status = response.status;
  if (status < 200 || status >= 300) {
    try { await response.arrayBuffer(); } catch { /* ignore */ }
    const cat = classifySiteHttpStatus(status);
    log("resolve_site_by_path", args.requestId, { result: cat, http_status: status });
    return { category: cat, httpStatus: status, site: null };
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    log("resolve_site_by_path", args.requestId, {
      result: "response_invalid",
      http_status: status,
    });
    return { category: "response_invalid", httpStatus: status, site: null };
  }
  const id = (parsed as any)?.id;
  const webUrl = (parsed as any)?.webUrl;
  if (typeof id !== "string" || typeof webUrl !== "string") {
    log("resolve_site_by_path", args.requestId, {
      result: "response_invalid",
      http_status: status,
    });
    return { category: "response_invalid", httpStatus: status, site: null };
  }
  if (!siteUrlsMatch(args.configuredSiteUrl, webUrl)) {
    log("resolve_site_by_path", args.requestId, {
      result: "site_mismatch",
      http_status: status,
    });
    return { category: "site_mismatch", httpStatus: status, site: null };
  }
  log("resolve_site_by_path", args.requestId, {
    result: "success",
    http_status: status,
  });
  return {
    category: "success",
    httpStatus: status,
    site: { siteId: id, webUrl },
  };
}

export interface ListLibrariesArgs extends CommonRequestArgs {
  siteId: string;
}

export interface ListLibrariesResult {
  category: SharePointTransportCategory;
  httpStatus: number | null;
  /** Number of accessible libraries; 0 when none. */
  libraryCount: number;
}

export async function listSharePointSiteDrives(
  args: ListLibrariesArgs,
): Promise<ListLibrariesResult> {
  const url =
    `${GRAPH_BASE}/sites/${encodeURIComponent(args.siteId)}/drives?$select=id,name,webUrl`;
  const { response, failure } = await graphGet(url, args);
  if (!response) {
    const cat = failure ?? "network_error";
    log("list_site_libraries", args.requestId, { result: cat, http_status: null });
    return { category: cat, httpStatus: null, libraryCount: 0 };
  }
  const status = response.status;
  if (status < 200 || status >= 300) {
    try { await response.arrayBuffer(); } catch { /* ignore */ }
    const cat = classifyDrivesHttpStatus(status);
    log("list_site_libraries", args.requestId, { result: cat, http_status: status });
    return { category: cat, httpStatus: status, libraryCount: 0 };
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    log("list_site_libraries", args.requestId, {
      result: "response_invalid",
      http_status: status,
    });
    return { category: "response_invalid", httpStatus: status, libraryCount: 0 };
  }
  const value = (parsed as any)?.value;
  if (!Array.isArray(value)) {
    log("list_site_libraries", args.requestId, {
      result: "response_invalid",
      http_status: status,
    });
    return { category: "response_invalid", httpStatus: status, libraryCount: 0 };
  }
  const count = value.filter(
    (d: unknown) =>
      d && typeof d === "object" &&
      typeof (d as any).id === "string" &&
      ((d as any).id as string).length > 0,
  ).length;
  if (count === 0) {
    log("list_site_libraries", args.requestId, {
      result: "libraries_not_found",
      http_status: status,
      library_count: 0,
    });
    return {
      category: "libraries_not_found",
      httpStatus: status,
      libraryCount: 0,
    };
  }
  log("list_site_libraries", args.requestId, {
    result: "success",
    http_status: status,
    library_count: count,
  });
  return { category: "success", httpStatus: status, libraryCount: count };
}

// ============================================================
// Phase 4D.14A.7B — Transport helpers for Decision Case SharePoint
// browsing and evidence selection. GET-only, bounded timeout, safe
// logging, no Supabase/Vault access, no raw path/id/name leakage.
// ============================================================

/** HTTP status → transport category for drive-item operations. */
export function classifyDriveItemHttpStatus(
  status: number,
): SharePointTransportCategory {
  if (status >= 200 && status < 300) return "success";
  if (status === 401) return "token_rejected";
  if (status === 403) return "permission_denied";
  if (status === 404) return "item_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "graph_unavailable";
  return "graph_unavailable";
}

export interface SharePointDriveInfo {
  id: string;
  webUrl: string;
}

export interface ListSiteDrivesDetailedResult {
  category: SharePointTransportCategory;
  httpStatus: number | null;
  drives: SharePointDriveInfo[];
}

/** List a site's drives with id+webUrl for library matching. */
export async function listSharePointSiteDrivesDetailed(
  args: ListLibrariesArgs & { operation?: SharePointOperation },
): Promise<ListSiteDrivesDetailedResult> {
  const op = args.operation ?? "resolve_project_root";
  const url =
    `${GRAPH_BASE}/sites/${encodeURIComponent(args.siteId)}/drives?$select=id,webUrl`;
  const { response, failure } = await graphGet(url, args);
  if (!response) {
    const cat = failure ?? "network_error";
    log(op, args.requestId, { result: cat, http_status: null });
    return { category: cat, httpStatus: null, drives: [] };
  }
  const status = response.status;
  if (status < 200 || status >= 300) {
    try { await response.arrayBuffer(); } catch { /* ignore */ }
    const cat = classifyDrivesHttpStatus(status);
    log(op, args.requestId, { result: cat, http_status: status });
    return { category: cat, httpStatus: status, drives: [] };
  }
  let parsed: unknown;
  try { parsed = await response.json(); } catch {
    log(op, args.requestId, { result: "response_invalid", http_status: status });
    return { category: "response_invalid", httpStatus: status, drives: [] };
  }
  const value = (parsed as any)?.value;
  if (!Array.isArray(value)) {
    log(op, args.requestId, { result: "response_invalid", http_status: status });
    return { category: "response_invalid", httpStatus: status, drives: [] };
  }
  const drives: SharePointDriveInfo[] = [];
  for (const d of value) {
    if (
      d && typeof d === "object" &&
      typeof (d as any).id === "string" && ((d as any).id as string).length > 0 &&
      typeof (d as any).webUrl === "string" && ((d as any).webUrl as string).length > 0
    ) {
      drives.push({ id: (d as any).id, webUrl: (d as any).webUrl });
    }
  }
  log(op, args.requestId, {
    result: "success",
    http_status: status,
    library_count: drives.length,
  });
  return { category: "success", httpStatus: status, drives };
}

export interface SharePointDriveItem {
  id: string;
  name: string;
  webUrl: string | null;
  size: number | null;
  eTag: string | null;
  cTag: string | null;
  createdDateTime: string | null;
  lastModifiedDateTime: string | null;
  parentReference: {
    driveId: string | null;
    id: string | null;
    path: string | null;
  } | null;
  folder: { childCount: number | null } | null;
  file: { mimeType: string | null } | null;
}

export interface DriveItemResult {
  category: SharePointTransportCategory;
  httpStatus: number | null;
  item: SharePointDriveItem | null;
}

const ITEM_SELECT =
  "$select=id,name,size,webUrl,folder,file,eTag,cTag,createdDateTime,lastModifiedDateTime,parentReference";

function parseDriveItem(v: unknown): SharePointDriveItem | null {
  if (!v || typeof v !== "object") return null;
  const o = v as any;
  if (typeof o.id !== "string" || o.id.length === 0) return null;
  if (typeof o.name !== "string") return null;
  return {
    id: o.id,
    name: o.name,
    webUrl: typeof o.webUrl === "string" ? o.webUrl : null,
    size: typeof o.size === "number" ? o.size : null,
    eTag: typeof o.eTag === "string" ? o.eTag : null,
    cTag: typeof o.cTag === "string" ? o.cTag : null,
    createdDateTime: typeof o.createdDateTime === "string" ? o.createdDateTime : null,
    lastModifiedDateTime:
      typeof o.lastModifiedDateTime === "string" ? o.lastModifiedDateTime : null,
    parentReference: o.parentReference && typeof o.parentReference === "object" ? {
      driveId: typeof o.parentReference.driveId === "string" ? o.parentReference.driveId : null,
      id: typeof o.parentReference.id === "string" ? o.parentReference.id : null,
      path: typeof o.parentReference.path === "string" ? o.parentReference.path : null,
    } : null,
    folder: o.folder && typeof o.folder === "object" ? {
      childCount: typeof o.folder.childCount === "number" ? o.folder.childCount : null,
    } : null,
    file: o.file && typeof o.file === "object" ? {
      mimeType: typeof o.file.mimeType === "string" ? o.file.mimeType : null,
    } : null,
  };
}

async function fetchSingleDriveItem(
  url: string,
  operation: SharePointOperation,
  args: CommonRequestArgs,
): Promise<DriveItemResult> {
  const { response, failure } = await graphGet(url, args);
  if (!response) {
    const cat = failure ?? "network_error";
    log(operation, args.requestId, { result: cat, http_status: null });
    return { category: cat, httpStatus: null, item: null };
  }
  const status = response.status;
  if (status < 200 || status >= 300) {
    try { await response.arrayBuffer(); } catch { /* ignore */ }
    const cat = classifyDriveItemHttpStatus(status);
    log(operation, args.requestId, { result: cat, http_status: status });
    return { category: cat, httpStatus: status, item: null };
  }
  let parsed: unknown;
  try { parsed = await response.json(); } catch {
    log(operation, args.requestId, { result: "response_invalid", http_status: status });
    return { category: "response_invalid", httpStatus: status, item: null };
  }
  const item = parseDriveItem(parsed);
  if (!item) {
    log(operation, args.requestId, { result: "response_invalid", http_status: status });
    return { category: "response_invalid", httpStatus: status, item: null };
  }
  log(operation, args.requestId, { result: "success", http_status: status });
  return { category: "success", httpStatus: status, item };
}

export interface GetDriveRootArgs extends CommonRequestArgs {
  driveId: string;
  operation?: SharePointOperation;
}

export async function getSharePointDriveRoot(
  args: GetDriveRootArgs,
): Promise<DriveItemResult> {
  const url =
    `${GRAPH_BASE}/drives/${encodeURIComponent(args.driveId)}/root?${ITEM_SELECT}`;
  return await fetchSingleDriveItem(
    url,
    args.operation ?? "resolve_project_root",
    args,
  );
}

export interface GetDriveItemByPathArgs extends CommonRequestArgs {
  driveId: string;
  /** Path relative to drive root, must start with `/` (already decoded). */
  relativePath: string;
  operation?: SharePointOperation;
}

/**
 * Resolve a drive item by its relative path underneath the drive root.
 * The caller must have already stripped any driveWebUrl prefix; this
 * helper URL-encodes each path segment safely.
 */
export async function getSharePointDriveItemByPath(
  args: GetDriveItemByPathArgs,
): Promise<DriveItemResult> {
  const rel = args.relativePath ?? "";
  // Encode segments but preserve `/` separators.
  const encoded = rel
    .split("/")
    .map((seg) => (seg.length === 0 ? "" : encodeURIComponent(seg)))
    .join("/");
  const url = !rel || rel === "/"
    ? `${GRAPH_BASE}/drives/${encodeURIComponent(args.driveId)}/root?${ITEM_SELECT}`
    : `${GRAPH_BASE}/drives/${encodeURIComponent(args.driveId)}/root:${encoded}?${ITEM_SELECT}`;
  return await fetchSingleDriveItem(
    url,
    args.operation ?? "resolve_project_folder",
    args,
  );
}

export interface GetDriveItemMetadataArgs extends CommonRequestArgs {
  driveId: string;
  itemId: string;
  operation: SharePointOperation;
}

export async function getSharePointDriveItemMetadata(
  args: GetDriveItemMetadataArgs,
): Promise<DriveItemResult> {
  const url =
    `${GRAPH_BASE}/drives/${encodeURIComponent(args.driveId)}/items/${encodeURIComponent(args.itemId)}?${ITEM_SELECT}`;
  return await fetchSingleDriveItem(url, args.operation, args);
}

export interface ListChildrenResult {
  category: SharePointTransportCategory;
  httpStatus: number | null;
  items: SharePointDriveItem[];
}

export interface ListChildrenArgs extends CommonRequestArgs {
  driveId: string;
  itemId: string;
  top?: number;
  operation?: SharePointOperation;
}

export async function listSharePointDriveItemChildren(
  args: ListChildrenArgs,
): Promise<ListChildrenResult> {
  const op = args.operation ?? "list_project_folder_children";
  const top = Math.max(1, Math.min(500, args.top ?? 200));
  const url =
    `${GRAPH_BASE}/drives/${encodeURIComponent(args.driveId)}/items/${encodeURIComponent(args.itemId)}/children?$top=${top}&${ITEM_SELECT}`;
  const { response, failure } = await graphGet(url, args);
  if (!response) {
    const cat = failure ?? "network_error";
    log(op, args.requestId, { result: cat, http_status: null });
    return { category: cat, httpStatus: null, items: [] };
  }
  const status = response.status;
  if (status < 200 || status >= 300) {
    try { await response.arrayBuffer(); } catch { /* ignore */ }
    const cat = classifyDriveItemHttpStatus(status);
    log(op, args.requestId, { result: cat, http_status: status });
    return { category: cat, httpStatus: status, items: [] };
  }
  let parsed: unknown;
  try { parsed = await response.json(); } catch {
    log(op, args.requestId, { result: "response_invalid", http_status: status });
    return { category: "response_invalid", httpStatus: status, items: [] };
  }
  const value = (parsed as any)?.value;
  if (!Array.isArray(value)) {
    log(op, args.requestId, { result: "response_invalid", http_status: status });
    return { category: "response_invalid", httpStatus: status, items: [] };
  }
  const items: SharePointDriveItem[] = [];
  for (const v of value) {
    const p = parseDriveItem(v);
    if (p) items.push(p);
  }
  log(op, args.requestId, {
    result: "success",
    http_status: status,
    child_count: items.length,
  });
  return { category: "success", httpStatus: status, items };
}

// ============================================================
// Phase 4D.14A.7D — Write / mutation transport helpers for the
// SharePoint file manager. Same rules as the read helpers: no
// Supabase / Vault, no token acquisition, no path/id/name/body
// logging, bounded timeouts, fixed classifications.
// ============================================================

/** HTTP status → transport category for write operations. Adds `item_conflict` for 409. */
export function classifyDriveItemWriteHttpStatus(
  status: number,
): SharePointTransportCategory | "item_conflict" {
  if (status >= 200 && status < 300) return "success";
  if (status === 401) return "token_rejected";
  if (status === 403) return "permission_denied";
  if (status === 404) return "item_not_found";
  if (status === 409) return "item_conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500 && status <= 599) return "graph_unavailable";
  return "graph_unavailable";
}

async function graphRequest(
  url: string,
  init: RequestInit,
  args: CommonRequestArgs,
): Promise<{ response: Response | null; failure: "timeout" | "network_error" | null }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const timeoutMs = args.timeoutMs ?? SHAREPOINT_TEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    try {
      const response = await fetchImpl(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      return { response, failure: null };
    } catch (e) {
      return { response: null, failure: classifyTransportFailure(e) };
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a direct child of `parentItemId` by name, without listing.
 * Uses `/drives/{d}/items/{parent}:/{name}`. Returns `item_not_found`
 * on 404 so callers can distinguish "missing" from other failures.
 */
export interface GetChildItemByNameArgs extends CommonRequestArgs {
  driveId: string;
  parentItemId: string;
  name: string;
  operation: SharePointOperation;
}

export async function getSharePointChildItem(
  args: GetChildItemByNameArgs,
): Promise<DriveItemResult> {
  const url =
    `${GRAPH_BASE}/drives/${encodeURIComponent(args.driveId)}/items/${encodeURIComponent(args.parentItemId)}:/${encodeURIComponent(args.name)}?${ITEM_SELECT}`;
  return await fetchSingleDriveItem(url, args.operation, args);
}

/** Create a folder under a parent. `conflictBehavior: fail` returns 409 on collision. */
export interface CreateFolderArgs extends CommonRequestArgs {
  driveId: string;
  parentItemId: string;
  name: string;
  operation?: SharePointOperation;
}

export interface CreateFolderResult {
  category: SharePointTransportCategory | "item_conflict";
  httpStatus: number | null;
  item: SharePointDriveItem | null;
}

export async function createSharePointFolder(
  args: CreateFolderArgs,
): Promise<CreateFolderResult> {
  const op = args.operation ?? "create_project_folder";
  const url =
    `${GRAPH_BASE}/drives/${encodeURIComponent(args.driveId)}/items/${encodeURIComponent(args.parentItemId)}/children?${ITEM_SELECT}`;
  const { response, failure } = await graphRequest(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: args.name,
        folder: {},
        "@microsoft.graph.conflictBehavior": "fail",
      }),
    },
    args,
  );
  if (!response) {
    const cat = failure ?? "network_error";
    log(op, args.requestId, { result: cat, http_status: null });
    return { category: cat, httpStatus: null, item: null };
  }
  const status = response.status;
  if (status < 200 || status >= 300) {
    try { await response.arrayBuffer(); } catch { /* ignore */ }
    const cat = classifyDriveItemWriteHttpStatus(status);
    log(op, args.requestId, { result: cat, http_status: status });
    return { category: cat, httpStatus: status, item: null };
  }
  let parsed: unknown;
  try { parsed = await response.json(); } catch {
    log(op, args.requestId, { result: "response_invalid", http_status: status });
    return { category: "response_invalid", httpStatus: status, item: null };
  }
  const item = parseDriveItem(parsed);
  if (!item) {
    log(op, args.requestId, { result: "response_invalid", http_status: status });
    return { category: "response_invalid", httpStatus: status, item: null };
  }
  log(op, args.requestId, { result: "success", http_status: status });
  return { category: "success", httpStatus: status, item };
}

/** Create a Graph upload session for a file under a parent folder. */
export interface CreateUploadSessionArgs extends CommonRequestArgs {
  driveId: string;
  parentItemId: string;
  fileName: string;
  operation?: SharePointOperation;
}

export interface CreateUploadSessionResult {
  category: SharePointTransportCategory;
  httpStatus: number | null;
  uploadUrl: string | null;
  expirationDateTime: string | null;
}

export async function createSharePointUploadSession(
  args: CreateUploadSessionArgs,
): Promise<CreateUploadSessionResult> {
  const op = args.operation ?? "create_project_upload_session";
  const url =
    `${GRAPH_BASE}/drives/${encodeURIComponent(args.driveId)}/items/${encodeURIComponent(args.parentItemId)}:/${encodeURIComponent(args.fileName)}:/createUploadSession`;
  const { response, failure } = await graphRequest(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item: {
          "@microsoft.graph.conflictBehavior": "rename",
          name: args.fileName,
        },
      }),
    },
    args,
  );
  if (!response) {
    const cat = failure ?? "network_error";
    log(op, args.requestId, { result: cat, http_status: null });
    return { category: cat, httpStatus: null, uploadUrl: null, expirationDateTime: null };
  }
  const status = response.status;
  if (status < 200 || status >= 300) {
    try { await response.arrayBuffer(); } catch { /* ignore */ }
    const cat = classifyDriveItemHttpStatus(status);
    log(op, args.requestId, { result: cat, http_status: status });
    return { category: cat, httpStatus: status, uploadUrl: null, expirationDateTime: null };
  }
  let parsed: any = null;
  try { parsed = await response.json(); } catch {
    log(op, args.requestId, { result: "response_invalid", http_status: status });
    return { category: "response_invalid", httpStatus: status, uploadUrl: null, expirationDateTime: null };
  }
  const uploadUrl = typeof parsed?.uploadUrl === "string" ? parsed.uploadUrl : null;
  if (!uploadUrl || !/^https:\/\//i.test(uploadUrl)) {
    log(op, args.requestId, { result: "response_invalid", http_status: status });
    return { category: "response_invalid", httpStatus: status, uploadUrl: null, expirationDateTime: null };
  }
  const expirationDateTime =
    typeof parsed?.expirationDateTime === "string" ? parsed.expirationDateTime : null;
  log(op, args.requestId, { result: "success", http_status: status });
  return { category: "success", httpStatus: status, uploadUrl, expirationDateTime };
}

/** Delete a drive item. Accepts 204 as success. */
export interface DeleteDriveItemArgs extends CommonRequestArgs {
  driveId: string;
  itemId: string;
  operation?: SharePointOperation;
}

export interface DeleteDriveItemResult {
  category: SharePointTransportCategory;
  httpStatus: number | null;
}

export async function deleteSharePointDriveItem(
  args: DeleteDriveItemArgs,
): Promise<DeleteDriveItemResult> {
  const op = args.operation ?? "delete_project_item";
  const url =
    `${GRAPH_BASE}/drives/${encodeURIComponent(args.driveId)}/items/${encodeURIComponent(args.itemId)}`;
  const { response, failure } = await graphRequest(url, { method: "DELETE" }, args);
  if (!response) {
    const cat = failure ?? "network_error";
    log(op, args.requestId, { result: cat, http_status: null });
    return { category: cat, httpStatus: null };
  }
  const status = response.status;
  try { await response.arrayBuffer(); } catch { /* ignore */ }
  if (status === 204 || (status >= 200 && status < 300)) {
    log(op, args.requestId, { result: "success", http_status: status });
    return { category: "success", httpStatus: status };
  }
  const cat = classifyDriveItemHttpStatus(status);
  log(op, args.requestId, { result: cat, http_status: status });
  return { category: cat, httpStatus: status };
}

// ============================================================
// Phase 4D.14A.7E — Generated-document publish transport helpers.
//
// These helpers are pure transport: they never resolve credentials,
// query Supabase or Vault, log filenames / paths / IDs / bodies /
// tokens, or fall back to Global configuration. They mirror the same
// bounded-timeout + safe-classification rules the file-manager writes
// use.
// ============================================================

/**
 * Resolve the default document library (drive) for a Graph site.
 * Used only by the Roadmap Status Deck fallback publish target — the
 * Tenant SharePoint site's `/drive` endpoint returns the site's
 * default document library, never an arbitrary first drive.
 */
export interface GetSiteDefaultDriveArgs extends CommonRequestArgs {
  siteId: string;
  operation?: SharePointOperation;
}

export interface GetSiteDefaultDriveResult {
  category: SharePointTransportCategory;
  httpStatus: number | null;
  drive: SharePointDriveInfo | null;
}

export async function getSharePointSiteDefaultDrive(
  args: GetSiteDefaultDriveArgs,
): Promise<GetSiteDefaultDriveResult> {
  const op = args.operation ?? "resolve_site_default_drive";
  const url =
    `${GRAPH_BASE}/sites/${encodeURIComponent(args.siteId)}/drive?$select=id,webUrl`;
  const { response, failure } = await graphGet(url, args);
  if (!response) {
    const cat = failure ?? "network_error";
    log(op, args.requestId, { result: cat, http_status: null });
    return { category: cat, httpStatus: null, drive: null };
  }
  const status = response.status;
  if (status < 200 || status >= 300) {
    try { await response.arrayBuffer(); } catch { /* ignore */ }
    const cat = classifyDrivesHttpStatus(status);
    log(op, args.requestId, { result: cat, http_status: status });
    return { category: cat, httpStatus: status, drive: null };
  }
  let parsed: any = null;
  try { parsed = await response.json(); } catch {
    log(op, args.requestId, { result: "response_invalid", http_status: status });
    return { category: "response_invalid", httpStatus: status, drive: null };
  }
  const id = typeof parsed?.id === "string" ? parsed.id : "";
  const webUrl = typeof parsed?.webUrl === "string" ? parsed.webUrl : "";
  if (!id || !webUrl) {
    log(op, args.requestId, { result: "response_invalid", http_status: status });
    return { category: "response_invalid", httpStatus: status, drive: null };
  }
  log(op, args.requestId, { result: "success", http_status: status });
  return { category: "success", httpStatus: status, drive: { id, webUrl } };
}

/** Supported MIME types for Phase 4D.14A.7E generated-document uploads. */
export type SharePointUploadContentType =
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Publish-only operation labels accepted by `uploadSharePointFileBytes`. */
export type SharePointPublishOperation =
  | "publish_project_charter"
  | "publish_project_closure_report"
  | "publish_decision_case_word_brief"
  | "publish_decision_case_ppt_onepager"
  | "publish_project_status_deck"
  | "publish_roadmap_status_deck"
  // Phase 4D.14A.7F — Lessons Learned no-overwrite creation.
  | "publish_lessons_learned_document"
  // Phase 4D.14A.7G — Diagnostic-only PPT readiness upload.
  | "publish_ppt_readiness_diagnostic";

export interface UploadSharePointFileBytesArgs extends CommonRequestArgs {
  driveId: string;
  parentItemId: string;
  fileName: string;
  bytes: Uint8Array;
  contentType: SharePointUploadContentType;
  operation: SharePointPublishOperation;
  /**
   * "replace" is used by the six 7E generated-report publishers.
   * "fail" is used by Lessons Learned creation (7F) so a 409 remains a
   * distinguishable safe name conflict — Graph returns HTTP 409 without
   * mutating the existing item; the caller re-reads the deterministic
   * filename and reuses the existing item.
   */
  conflictBehavior?: "replace" | "fail";
}

export interface UploadSharePointFileBytesOk {
  ok: true;
  httpStatus: number;
  itemId: string;
  webUrl: string;
}

export interface UploadSharePointFileBytesErr {
  ok: false;
  /** null when the request never got an HTTP response (timeout/network). */
  httpStatus: number | null;
  /** Raw provider response body — parsed by the caller via
   *  `normalizeGraphPublishError` for classification. Never logged or
   *  returned to browser code. */
  body: string;
  retryAfter: string | null;
  /** Fixed transport category when no response was received. */
  transport: "timeout" | "network_error" | null;
}

const UPLOAD_TIMEOUT_MS = 30_000;

function sanitizeUploadFileName(raw: string): string {
  const trimmed = (raw ?? "").replace(/[\\/:*?"<>|#%]/g, "").trim();
  return trimmed;
}

/**
 * Direct generated-file upload transport. PUT bytes to
 * `/drives/{driveId}/items/{parentItemId}:/{fileName}:/content` with
 * `@microsoft.graph.conflictBehavior=replace`. Bounded timeout, fixed
 * MIME, and no filename/path/id logging.
 */
export async function uploadSharePointFileBytes(
  args: UploadSharePointFileBytesArgs,
): Promise<UploadSharePointFileBytesOk | UploadSharePointFileBytesErr> {
  const safeName = sanitizeUploadFileName(args.fileName);
  if (safeName.length === 0) {
    log(args.operation, args.requestId, {
      result: "response_invalid",
      http_status: null,
    });
    return { ok: false, httpStatus: null, body: "", retryAfter: null, transport: null };
  }
  const conflictBehavior = args.conflictBehavior ?? "replace";
  const url =
    `${GRAPH_BASE}/drives/${encodeURIComponent(args.driveId)}/items/${encodeURIComponent(args.parentItemId)}:/${encodeURIComponent(safeName)}:/content` +
    `?@microsoft.graph.conflictBehavior=${encodeURIComponent(conflictBehavior)}`;
  const fetchImpl = args.fetchImpl ?? fetch;
  const timeoutMs = args.timeoutMs ?? UPLOAD_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response | null = null;
  let transportFailure: "timeout" | "network_error" | null = null;
  try {
    try {
      response = await fetchImpl(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
          "Content-Type": args.contentType,
        },
        body: args.bytes,
        signal: controller.signal,
      });
    } catch (e) {
      transportFailure = classifyTransportFailure(e);
    }
  } finally {
    clearTimeout(timer);
  }
  if (!response) {
    log(args.operation, args.requestId, {
      result: transportFailure ?? "network_error",
      http_status: null,
    });
    return {
      ok: false,
      httpStatus: null,
      body: "",
      retryAfter: null,
      transport: transportFailure ?? "network_error",
    };
  }
  const status = response.status;
  if (status < 200 || status >= 300) {
    let body = "";
    try { body = await response.text(); } catch { /* ignore */ }
    const retryAfter = response.headers.get("Retry-After");
    log(args.operation, args.requestId, {
      result: "graph_unavailable",
      http_status: status,
    });
    return { ok: false, httpStatus: status, body, retryAfter, transport: null };
  }
  let parsed: any = null;
  try { parsed = await response.json(); } catch {
    log(args.operation, args.requestId, {
      result: "response_invalid",
      http_status: status,
    });
    return { ok: false, httpStatus: status, body: "", retryAfter: null, transport: null };
  }
  const itemId = typeof parsed?.id === "string" ? parsed.id : "";
  const webUrl = typeof parsed?.webUrl === "string" ? parsed.webUrl : "";
  if (!itemId || !webUrl) {
    log(args.operation, args.requestId, {
      result: "response_invalid",
      http_status: status,
    });
    return { ok: false, httpStatus: status, body: "", retryAfter: null, transport: null };
  }
  log(args.operation, args.requestId, { result: "success", http_status: status });
  return { ok: true, httpStatus: status, itemId, webUrl };
}
