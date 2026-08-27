/**
 * SP.2 — SharePoint binding contracts (integration-ready, no live Graph).
 *
 * These types mirror the protected RPCs introduced in the SP.2 migration:
 * - sharepoint_workspace_bindings (one active per workspace)
 * - sharepoint_project_bindings   (one active per project)
 *
 * No SharePoint ACL data and no document binaries are represented here.
 * Status enums explicitly distinguish unvalidated pre-tenant state from
 * validated/invalid/disabled. Live validation is out of scope for SP.2.
 */

export type SharepointWorkspaceBindingStatus =
  | "configured_unvalidated"
  | "validated"
  | "invalid"
  | "disabled";

export type SharepointProjectBindingStatus =
  | "linked_unvalidated"
  | "validated"
  | "invalid"
  | "disabled";

export type SharepointProjectBindingMode =
  | "workspace_library_default"
  | "restricted_library_override"
  | "restricted_site_override";

export interface SharepointWorkspaceBinding {
  id: string;
  organization_id: string;
  workspace_id: string;
  binding_status: SharepointWorkspaceBindingStatus;
  site_web_url: string;
  site_id: string | null;
  library_web_url: string;
  library_id_or_drive_id: string | null;
  site_label_or_name: string | null;
  library_label_or_name: string | null;
  managed_outside_btpm: boolean;
  last_validated_at: string | null;
  last_validation_code: string | null;
  last_validation_note: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  disabled_at: string | null;
  disabled_by: string | null;
}

export interface SharepointProjectBinding {
  id: string;
  organization_id: string;
  workspace_id: string;
  project_id: string;
  workspace_sharepoint_binding_id: string | null;
  binding_mode: SharepointProjectBindingMode;
  binding_status: SharepointProjectBindingStatus;
  folder_web_url: string;
  folder_relative_path: string | null;
  folder_item_id: string | null;
  resolved_site_web_url: string | null;
  resolved_site_id: string | null;
  resolved_library_web_url: string | null;
  resolved_library_id_or_drive_id: string | null;
  is_restricted: boolean;
  last_validated_at: string | null;
  last_validation_code: string | null;
  last_validation_note: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  disabled_at: string | null;
  disabled_by: string | null;
}

/**
 * Effective-binding contract used by later Shared Files / generated-doc steps.
 * Combines a project binding with its resolved workspace context.
 */
export interface SharepointEffectiveProjectBinding {
  project_binding_id: string;
  project_id: string;
  workspace_id: string;
  organization_id: string;
  binding_mode: SharepointProjectBindingMode;
  binding_status: SharepointProjectBindingStatus;
  is_restricted: boolean;
  folder_web_url: string;
  folder_relative_path: string | null;
  folder_item_id: string | null;
  effective_site_web_url: string | null;
  effective_site_id: string | null;
  effective_library_web_url: string | null;
  effective_library_id_or_drive_id: string | null;
  workspace_binding_id: string | null;
  workspace_binding_status: SharepointWorkspaceBindingStatus | null;
  last_validated_at: string | null;
  last_validation_code: string | null;
  last_validation_note: string | null;
}

export interface UpsertWorkspaceBindingInput {
  workspaceId: string;
  siteWebUrl: string;
  libraryWebUrl: string;
  siteLabelOrName?: string | null;
  libraryLabelOrName?: string | null;
  siteId?: string | null;
  libraryIdOrDriveId?: string | null;
  managedOutsideBtpm?: boolean;
}

export interface UpsertProjectBindingInput {
  projectId: string;
  bindingMode: SharepointProjectBindingMode;
  folderWebUrl: string;
  folderRelativePath?: string | null;
  folderItemId?: string | null;
  resolvedSiteWebUrl?: string | null;
  resolvedSiteId?: string | null;
  resolvedLibraryWebUrl?: string | null;
  resolvedLibraryIdOrDriveId?: string | null;
}

/** Human-readable status helpers (display-only). */
export function isWorkspaceBindingActive(s: SharepointWorkspaceBindingStatus): boolean {
  return s !== "disabled";
}

export function isProjectBindingActive(s: SharepointProjectBindingStatus): boolean {
  return s !== "disabled";
}

export function isWorkspaceBindingValidated(s: SharepointWorkspaceBindingStatus): boolean {
  return s === "validated";
}

export function isProjectBindingValidated(s: SharepointProjectBindingStatus): boolean {
  return s === "validated";
}
