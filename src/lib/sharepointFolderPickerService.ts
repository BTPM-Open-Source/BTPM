/**
 * SP UX correction — Workspace-library folder picker (client wrapper).
 *
 * Strictly browses folders inside the validated workspace SharePoint library
 * and links a chosen folder as the project binding. No manual URL entry.
 * All Graph calls happen server-side in the `sharepoint-files` edge function.
 */

import { supabase } from "@/integrations/supabase/client";
import type { SharepointProjectBinding } from "./sharepointBindingTypes";

export interface PickerFolder {
  id: string;
  name: string;
  web_url: string;
  child_count: number | null;
}

export interface PickerListing {
  root: { id: string; name: string; web_url: string };
  current: { id: string; name: string; web_url: string };
  breadcrumbs: Array<{ id: string; name: string }>;
  folders: PickerFolder[];
}

export interface MsPickerConfig {
  client_id: string;
  tenant_id: string;
  site_web_url: string;
  library_web_url: string;
  sharepoint_host: string;
}

interface InvokeError extends Error {
  code?: string;
  note?: string;
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("sharepoint-files", { body });
  if (error) {
    let payload: any = null;
    try {
      const ctx = (error as any).context;
      if (ctx?.json) payload = await ctx.json();
      else if (ctx?.body) payload = JSON.parse(ctx.body);
    } catch { /* ignore */ }
    const e: InvokeError = new Error(payload?.note || payload?.error || error.message);
    e.code = payload?.error;
    e.note = payload?.note;
    throw e;
  }
  return data as T;
}

export function browseWorkspaceLibrary(
  workspaceBindingId: string,
  itemId: string | null,
): Promise<PickerListing> {
  return invoke<PickerListing>({
    action: "browse_workspace_library",
    workspace_binding_id: workspaceBindingId,
    item_id: itemId,
  });
}

export function linkProjectFolder(
  workspaceBindingId: string,
  projectId: string,
  selection: { itemId?: string; webUrl?: string },
): Promise<{ binding: SharepointProjectBinding }> {
  return invoke({
    action: "link_project_folder",
    workspace_binding_id: workspaceBindingId,
    project_id: projectId,
    item_id: selection.itemId,
    web_url: selection.webUrl,
  });
}

export function getMsPickerConfig(workspaceBindingId: string): Promise<MsPickerConfig> {
  return invoke<MsPickerConfig>({
    action: "picker_config",
    workspace_binding_id: workspaceBindingId,
  });
}
