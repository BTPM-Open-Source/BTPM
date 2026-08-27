/**
 * Step API-ADM.6B — pure Connected App Project-access contracts and helpers.
 *
 * Extracted unchanged from the retired Project scope dialog so the production
 * Project access administration component owns a dependency-free model.
 *
 * Pure module: it contains no framework, backend, query, dialog, sheet,
 * active-scope or admin-role dependency of any kind.
 */

export const PROJECT_SCOPE_PAGE_SIZE = 25;

export type ProjectTargetLifecycle = "enabled" | "disabled";

export interface WorkspaceClientProjectRow {
  project_id: string;
  project_name: string;
  project_is_archived: boolean;
  project_enablement_id: string | null;
  project_enablement_status: string | null;
  project_enabled_at: string | null;
  project_disabled_at: string | null;
  total_count: number;
}

/** Project archive status derives only from the authoritative archive flag. */
export function projectArchiveStatusLabel(
  isArchived: boolean | null | undefined,
): string {
  return isArchived ? "Archived" : "Not archived";
}

/** Application access is exactly the returned Project enablement status. */
export function projectAccessLabel(status: string | null | undefined): string {
  if (status === "enabled") return "Enabled";
  if (status === "disabled") return "Disabled";
  return "Not enabled";
}

export function projectAccessVariant(
  status: string | null | undefined,
): "default" | "secondary" | "outline" {
  if (status === "enabled") return "default";
  if (status === "disabled") return "secondary";
  return "outline";
}

export const ORGANIZATION_PARENT_NOTICE =
  "Project access cannot be effective while the Organization connection is not enabled.";
export const WORKSPACE_PARENT_NOTICE =
  "Project access cannot be effective while Workspace access is not enabled.";

export const PROJECT_ARCHIVED_BLOCK_REASON = "Archived Projects cannot be enabled.";
export const PROJECT_ORGANIZATION_BLOCK_REASON =
  "Connect this application to the Organization before enabling Project access.";
export const PROJECT_WORKSPACE_BLOCK_REASON =
  "Enable this application for the Workspace before enabling Project access.";
export const PROJECT_UNKNOWN_STATE_REASON =
  "This Project connection state is not recognized. Refresh the scope.";

export const PROJECT_ENABLE_ERROR =
  "Could not enable this Project. The application, Organization connection and Workspace access must be enabled, and the Project must be available and not archived.";
export const PROJECT_DISABLE_ERROR =
  "Could not disable this Project. Refresh the scope and try again.";

/** Informational parent-state notice, most restrictive parent first. */
export function resolveProjectParentNotice(
  organizationEnablementStatus: string | null | undefined,
  workspaceEnablementStatus: string | null | undefined,
): string | null {
  if (organizationEnablementStatus !== "enabled") return ORGANIZATION_PARENT_NOTICE;
  if (workspaceEnablementStatus !== "enabled") return WORKSPACE_PARENT_NOTICE;
  return null;
}

export type ProjectActionKind = "enable" | "reenable" | "disable" | "unavailable";

export interface ProjectRowAction {
  kind: ProjectActionKind;
  label: string;
  target: ProjectTargetLifecycle | null;
  reason: string | null;
}

/**
 * Fail-closed Project action resolution.
 *
 * An existing enabled Project stays disableable regardless of archive state or
 * parent state, because the accepted backend permits removing retained scope.
 * Any unexpected non-null status is treated as unavailable. Project activity is
 * never inferred — the list RPC returns no activity field.
 */
export function resolveProjectRowAction(
  projectEnablementStatus: string | null | undefined,
  organizationEnablementStatus: string | null | undefined,
  workspaceEnablementStatus: string | null | undefined,
  projectIsArchived: boolean | null | undefined,
): ProjectRowAction {
  if (projectEnablementStatus === "enabled") {
    return { kind: "disable", label: "Disable", target: "disabled", reason: null };
  }
  const notEnabledYet =
    projectEnablementStatus === null || projectEnablementStatus === undefined;
  if (!notEnabledYet && projectEnablementStatus !== "disabled") {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: PROJECT_UNKNOWN_STATE_REASON,
    };
  }
  if (projectIsArchived === true) {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: PROJECT_ARCHIVED_BLOCK_REASON,
    };
  }
  if (organizationEnablementStatus !== "enabled") {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: PROJECT_ORGANIZATION_BLOCK_REASON,
    };
  }
  if (workspaceEnablementStatus !== "enabled") {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: PROJECT_WORKSPACE_BLOCK_REASON,
    };
  }
  if (projectEnablementStatus === "disabled") {
    return { kind: "reenable", label: "Re-enable", target: "enabled", reason: null };
  }
  return { kind: "enable", label: "Enable", target: "enabled", reason: null };
}

/**
 * Placeholder isolation: previous Project rows may only be reused when the
 * Organization ID, API client ID and Workspace ID of the previous query all
 * match the current selection.
 */
export function resolveProjectPlaceholder(
  previousData: WorkspaceClientProjectRow[] | undefined,
  previousQueryKey: unknown[] | undefined,
  currentOrganizationId: string | null | undefined,
  currentApiClientId: string | null | undefined,
  currentWorkspaceId: string | null | undefined,
): WorkspaceClientProjectRow[] | undefined {
  if (!currentOrganizationId || !currentApiClientId || !currentWorkspaceId) return undefined;
  const previousOrganizationId = previousQueryKey?.[1];
  const previousApiClientId = previousQueryKey?.[2];
  const previousWorkspaceId = previousQueryKey?.[3];
  if (previousOrganizationId !== currentOrganizationId) return undefined;
  if (previousApiClientId !== currentApiClientId) return undefined;
  if (previousWorkspaceId !== currentWorkspaceId) return undefined;
  return previousData;
}
