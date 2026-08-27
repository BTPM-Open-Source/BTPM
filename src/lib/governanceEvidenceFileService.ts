/**
 * DC.15 — Client wrappers for SharePoint evidence file selection.
 * Uses Edge Functions for Graph-bound browse/select.
 */
import { supabase } from "@/integrations/supabase/client";

export interface BrowseFolderItem {
  id: string;
  drive_id: string;
  site_id: string;
  name: string;
  is_folder: boolean;
  mime_type: string | null;
  size: number | null;
  etag: string | null;
  ctag: string | null;
  created_at: string | null;
  last_modified_at: string | null;
  parent_path: string | null;
  web_url: string | null;
  child_count: number | null;
}

export interface BrowseListing {
  ok: true;
  site_id: string;
  drive_id: string;
  root: { id: string; name: string; web_url: string | null };
  current: { id: string; name: string; web_url: string | null };
  breadcrumbs: Array<{ id: string; name: string }>;
  items: BrowseFolderItem[];
}

export interface BrowseError {
  ok: false;
  error: string;
  note?: string;
}

export type BrowseResult = BrowseListing | BrowseError;

export async function browseGovernanceDecisionSharePointFiles(
  recordId: string,
  folderDriveId?: string,
  folderItemId?: string,
): Promise<BrowseResult> {
  const { data, error } = await supabase.functions.invoke(
    "browse-governance-decision-sharepoint-files",
    { body: { recordId, folderDriveId, folderItemId } },
  );
  if (error) {
    let payload: any = null;
    try {
      const ctx = (error as any).context;
      if (ctx?.json) payload = await ctx.json();
      else if (ctx?.body) payload = JSON.parse(ctx.body);
    } catch { /* ignore */ }
    return {
      ok: false,
      error: payload?.error ?? "browse_failed",
      note: payload?.note ?? error.message,
    };
  }
  return data as BrowseResult;
}

export interface SelectFileInput {
  siteId: string;
  driveId: string;
  itemId: string;
  evidenceTitle?: string;
  evidenceSummary?: string | null;
  evidenceDate?: string | null;
  relevanceLevel?: "high" | "medium" | "low";
  includedInPackage?: boolean;
}

export interface SelectResult {
  ok: boolean;
  inserted?: number;
  duplicates?: number;
  failed?: number;
  items?: Array<{ itemId: string; status: string; reason?: string }>;
  error?: string;
  note?: string;
}

export async function selectGovernanceDecisionSharePointEvidenceFiles(
  recordId: string,
  items: SelectFileInput[],
): Promise<SelectResult> {
  const { data, error } = await supabase.functions.invoke(
    "select-governance-decision-sharepoint-evidence-files",
    { body: { recordId, items } },
  );
  if (error) {
    let payload: any = null;
    try {
      const ctx = (error as any).context;
      if (ctx?.json) payload = await ctx.json();
      else if (ctx?.body) payload = JSON.parse(ctx.body);
    } catch { /* ignore */ }
    return { ok: false, error: payload?.error ?? "select_failed", note: payload?.note ?? error.message };
  }
  return data as SelectResult;
}
