/**
 * SP.2 — SharePoint binding service (client-side wrapper around protected RPCs).
 *
 * All authority is enforced server-side via SECURITY DEFINER functions.
 * This module only narrows the typing surface for callers.
 *
 * No Microsoft Graph calls are made here. No live validation is performed.
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  SharepointEffectiveProjectBinding,
  SharepointProjectBinding,
  SharepointWorkspaceBinding,
  UpsertProjectBindingInput,
  UpsertWorkspaceBindingInput,
} from "./sharepointBindingTypes";

// supabase.rpc names are not in generated types yet — cast at the boundary.
// The schema/contract is defined by the SP.2 migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc: any = supabase.rpc.bind(supabase);

export async function listWorkspaceBindings(
  organizationId: string,
): Promise<SharepointWorkspaceBinding[]> {
  const { data, error } = await rpc("list_sharepoint_workspace_bindings", {
    _organization_id: organizationId,
  });
  if (error) throw error;
  return (data ?? []) as SharepointWorkspaceBinding[];
}

export async function getWorkspaceBinding(
  workspaceId: string,
): Promise<SharepointWorkspaceBinding | null> {
  const { data, error } = await rpc("get_sharepoint_workspace_binding", {
    _workspace_id: workspaceId,
  });
  if (error) throw error;
  if (!data) return null;
  // RPC returns a row record; some clients return as object, normalize
  const row = Array.isArray(data) ? data[0] : data;
  return (row as SharepointWorkspaceBinding) ?? null;
}

export async function upsertWorkspaceBinding(
  input: UpsertWorkspaceBindingInput,
): Promise<SharepointWorkspaceBinding> {
  const { data, error } = await rpc("upsert_sharepoint_workspace_binding", {
    _workspace_id: input.workspaceId,
    _site_web_url: input.siteWebUrl,
    _library_web_url: input.libraryWebUrl,
    _site_label_or_name: input.siteLabelOrName ?? null,
    _library_label_or_name: input.libraryLabelOrName ?? null,
    _site_id: input.siteId ?? null,
    _library_id_or_drive_id: input.libraryIdOrDriveId ?? null,
    _managed_outside_btpm: input.managedOutsideBtpm ?? true,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as SharepointWorkspaceBinding;
}

export async function disableWorkspaceBinding(
  bindingId: string,
): Promise<SharepointWorkspaceBinding> {
  const { data, error } = await rpc("disable_sharepoint_workspace_binding", {
    _binding_id: bindingId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as SharepointWorkspaceBinding;
}

export async function getProjectBinding(
  projectId: string,
): Promise<SharepointProjectBinding | null> {
  const { data, error } = await rpc("get_sharepoint_project_binding", {
    _project_id: projectId,
  });
  if (error) throw error;
  if (!data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as SharepointProjectBinding) ?? null;
}

export async function resolveProjectBinding(
  projectId: string,
): Promise<SharepointEffectiveProjectBinding | null> {
  const { data, error } = await rpc("resolve_sharepoint_project_binding", {
    _project_id: projectId,
  });
  if (error) throw error;
  if (!data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as SharepointEffectiveProjectBinding) ?? null;
}

export async function upsertProjectBinding(
  input: UpsertProjectBindingInput,
): Promise<SharepointProjectBinding> {
  const { data, error } = await rpc("upsert_sharepoint_project_binding", {
    _project_id: input.projectId,
    _binding_mode: input.bindingMode,
    _folder_web_url: input.folderWebUrl,
    _folder_relative_path: input.folderRelativePath ?? null,
    _folder_item_id: input.folderItemId ?? null,
    _resolved_site_web_url: input.resolvedSiteWebUrl ?? null,
    _resolved_site_id: input.resolvedSiteId ?? null,
    _resolved_library_web_url: input.resolvedLibraryWebUrl ?? null,
    _resolved_library_id_or_drive_id: input.resolvedLibraryIdOrDriveId ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as SharepointProjectBinding;
}

export async function disableProjectBinding(
  bindingId: string,
): Promise<SharepointProjectBinding> {
  const { data, error } = await rpc("disable_sharepoint_project_binding", {
    _binding_id: bindingId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row as SharepointProjectBinding;
}
