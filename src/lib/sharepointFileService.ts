/**
 * SP.4 — Client wrapper for the sharepoint-files edge function.
 *
 * No Graph calls in the browser. Uploads PUT bytes directly to a short-lived
 * Microsoft Graph upload-session URL returned by the server (scoped to the
 * single target item path).
 */

import { supabase } from "@/integrations/supabase/client";

export type SpFileType = "file" | "folder";

export interface SpItem {
  id: string;
  /** SharePoint drive/library ID for this item (Phase 6B.4c). */
  drive_id: string;
  name: string;
  type: SpFileType;
  size: number | null;
  /** MIME type for file items where Microsoft Graph provides it (Phase 6B.4c). */
  mime_type: string | null;
  web_url: string;
  last_modified_at: string | null;
  last_modified_by: string | null;
  child_count: number | null;
}

export interface SpBreadcrumb {
  id: string;
  name: string;
}

export interface SpListing {
  /** SharePoint drive/library ID for the listing (Phase 6B.4c). */
  drive_id: string;
  root: { id: string; name: string; web_url: string };
  current: { id: string; name: string; web_url: string };
  breadcrumbs: SpBreadcrumb[];
  items: SpItem[];
}

interface InvokeError extends Error {
  code?: string;
  note?: string;
}

async function invoke<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("sharepoint-files", {
    body: { action, ...body },
  });
  if (error) {
    // Edge function returned non-2xx — try to parse the JSON body for code/note.
    let payload: any = null;
    try {
      const ctx = (error as any).context;
      if (ctx?.json) payload = await ctx.json();
      else if (ctx?.body) payload = JSON.parse(ctx.body);
    } catch { /* ignore */ }

    // Transient Supabase Edge Runtime errors (503 SUPABASE_EDGE_RUNTIME_ERROR,
    // FunctionsFetchError on cold-start) are infrastructure blips, not our
    // function failing. Surface a typed error so React Query can retry.
    const status = (error as any)?.context?.status as number | undefined;
    const msg = String((error as any)?.message || "");
    const isTransient =
      payload?.code === "SUPABASE_EDGE_RUNTIME_ERROR" ||
      status === 503 || status === 504 ||
      /temporarily unavailable|Failed to send a request|FunctionsFetchError/i.test(msg);

    const e: InvokeError = new Error(
      isTransient
        ? "SharePoint service is momentarily unavailable. Please try again."
        : (payload?.note || payload?.error || error.message),
    );
    e.code = isTransient ? "transient_unavailable" : payload?.error;
    e.note = payload?.note;
    (e as any).transient = isTransient;
    throw e;
  }
  return data as T;
}

export function listChildren(
  bindingId: string,
  itemId?: string,
): Promise<SpListing> {
  return invoke<SpListing>("list_children", {
    binding_id: bindingId,
    item_id: itemId ?? null,
  });
}

/**
 * Walk/create a deterministic subfolder chain under the project root and
 * return the resulting folder item. Server-side enforces scope to the
 * project root and project PM authority.
 */
export function ensureSubpath(
  bindingId: string,
  segments: string[],
): Promise<{ item: SpItem }> {
  return invoke("ensure_subpath", {
    binding_id: bindingId,
    segments,
  });
}

/**
 * Read-only walk: resolves a deterministic subfolder chain under the project
 * root WITHOUT creating missing folders. Authorized via project access (not
 * project PM authority), so contributors/viewers can list existing files.
 * If any segment doesn't yet exist, returns { item: null, missing: true }.
 */
export function resolveSubpath(
  bindingId: string,
  segments: string[],
): Promise<{ item: SpItem | null; missing?: boolean }> {
  return invoke("resolve_subpath", {
    binding_id: bindingId,
    segments,
  });
}

export function deleteItem(
  bindingId: string,
  itemId: string,
): Promise<{ success: true }> {
  return invoke("delete_item", {
    binding_id: bindingId,
    item_id: itemId,
  });
}

export function createSubfolder(
  bindingId: string,
  parentItemId: string,
  name: string,
): Promise<{ item: SpItem }> {
  return invoke("create_subfolder", {
    binding_id: bindingId,
    parent_item_id: parentItemId,
    name,
  });
}

interface UploadInit {
  upload_url: string;
  expires_at: string | null;
}

/**
 * Upload a file to the linked SharePoint folder. Two steps:
 *  1) ask the server for an upload session URL (server validates scope/auth)
 *  2) PUT the bytes directly to that URL with the correct Content-Range header
 */
export async function uploadFile(
  bindingId: string,
  parentItemId: string,
  file: File,
): Promise<void> {
  const { upload_url } = await invoke<UploadInit>("upload_file_init", {
    binding_id: bindingId,
    parent_item_id: parentItemId,
    file_name: file.name,
    size: file.size,
  });

  // For files <= 60 MB we can do a single PUT. Larger files would need
  // chunking, which SP.4 explicitly does not require — but we still chunk
  // anything over 4 MB to stay safely within edge limits.
  const CHUNK = 4 * 1024 * 1024;
  if (file.size <= CHUNK) {
    const res = await fetch(upload_url, {
      method: "PUT",
      headers: {
        "Content-Length": String(file.size),
        "Content-Range": `bytes 0-${Math.max(file.size - 1, 0)}/${file.size}`,
      },
      body: file,
    });
    if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status}).`);
    return;
  }
  let start = 0;
  while (start < file.size) {
    const end = Math.min(start + CHUNK, file.size) - 1;
    const slice = file.slice(start, end + 1);
    const res = await fetch(upload_url, {
      method: "PUT",
      headers: {
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${file.size}`,
      },
      body: slice,
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`Upload failed at ${start}-${end} (HTTP ${res.status}).`);
    }
    start = end + 1;
  }
}
