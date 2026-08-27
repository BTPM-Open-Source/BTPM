/**
 * Step API-ADM.6B — pure Connected App Workspace-access contracts and helpers.
 *
 * Extracted unchanged from the retired Workspace scope dialog so the production
 * Workspace access administration component owns a dependency-free model.
 *
 * Pure module: it contains no framework, backend, query, dialog, sheet,
 * active-scope or admin-role dependency of any kind. Reads and writes remain exclusively in
 * the production component via the accepted API-G.5.8B RPC contract.
 */

export const WORKSPACE_SCOPE_PAGE_SIZE = 25;

export type WorkspaceTargetLifecycle = "enabled" | "disabled";

export interface OrganizationClientWorkspaceRow {
  workspace_id: string;
  workspace_name: string;
  workspace_is_archived: boolean;
  workspace_enablement_id: string | null;
  workspace_enablement_status: string | null;
  workspace_enabled_at: string | null;
  workspace_disabled_at: string | null;
  enabled_project_count: number;
  enabled_capability_grant_count: number;
  total_count: number;
}

/** Workspace archive status is independent of application enablement. */
export function archiveStatusLabel(isArchived: boolean | null | undefined): string {
  return isArchived ? "Archived" : "Not archived";
}

/** Application access is exactly the returned Workspace enablement status. */
export function accessLabel(status: string | null | undefined): string {
  if (status === "enabled") return "Enabled";
  if (status === "disabled") return "Disabled";
  return "Not enabled";
}

export function accessVariant(
  status: string | null | undefined,
): "default" | "secondary" | "outline" {
  if (status === "enabled") return "default";
  if (status === "disabled") return "secondary";
  return "outline";
}

export const ARCHIVED_BLOCK_REASON = "Archived Workspaces cannot be enabled.";
export const ORGANIZATION_BLOCK_REASON =
  "Connect this application to the Organization before enabling Workspace access.";
export const UNKNOWN_STATE_REASON =
  "This Workspace connection state is not recognized. Refresh the scope.";

export type WorkspaceActionKind = "enable" | "reenable" | "disable" | "unavailable";

export interface WorkspaceRowAction {
  kind: WorkspaceActionKind;
  label: string;
  target: WorkspaceTargetLifecycle | null;
  reason: string | null;
}

/**
 * Fail-closed Workspace action resolution.
 *
 * Enabled connections stay disableable regardless of parent state because the
 * accepted backend permits disabling retained configuration. Any unexpected
 * non-null status is treated as unavailable.
 */
export function resolveWorkspaceRowAction(
  workspaceEnablementStatus: string | null | undefined,
  organizationEnablementStatus: string | null | undefined,
  workspaceIsArchived: boolean | null | undefined,
): WorkspaceRowAction {
  if (workspaceEnablementStatus === "enabled") {
    return { kind: "disable", label: "Disable", target: "disabled", reason: null };
  }
  const notEnabledYet =
    workspaceEnablementStatus === null || workspaceEnablementStatus === undefined;
  if (!notEnabledYet && workspaceEnablementStatus !== "disabled") {
    return { kind: "unavailable", label: "Unavailable", target: null, reason: UNKNOWN_STATE_REASON };
  }
  if (workspaceIsArchived === true) {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: ARCHIVED_BLOCK_REASON,
    };
  }
  if (organizationEnablementStatus !== "enabled") {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: ORGANIZATION_BLOCK_REASON,
    };
  }
  if (workspaceEnablementStatus === "disabled") {
    return { kind: "reenable", label: "Re-enable", target: "enabled", reason: null };
  }
  return { kind: "enable", label: "Enable", target: "enabled", reason: null };
}

/**
 * Placeholder isolation: previous rows may only be reused when both the
 * Organization ID and the API client ID of the previous query match the
 * current selection. Cross-Organization and cross-application reuse is
 * structurally impossible.
 */
export function resolveWorkspacePlaceholder(
  previousData: OrganizationClientWorkspaceRow[] | undefined,
  previousQueryKey: unknown[] | undefined,
  currentOrganizationId: string | null | undefined,
  currentApiClientId: string | null | undefined,
): OrganizationClientWorkspaceRow[] | undefined {
  if (!currentOrganizationId || !currentApiClientId) return undefined;
  const previousOrganizationId = previousQueryKey?.[1];
  const previousApiClientId = previousQueryKey?.[2];
  if (previousOrganizationId !== currentOrganizationId) return undefined;
  if (previousApiClientId !== currentApiClientId) return undefined;
  return previousData;
}
