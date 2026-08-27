/**
 * Step API-ADM.6B — pure Connected App Workspace-permission contracts and
 * helpers, extracted unchanged from the retired Workspace capability dialog.
 *
 * Effective Workspace access stays backend-provided: these helpers only present
 * `effective_grant_status` / `effective_grant_source` and never recompute them.
 *
 * Pure module: it contains no framework, backend, query, dialog, sheet,
 * active-scope or admin-role dependency of any kind.
 */

/**
 * API-ADM-UX1 — the complete bounded capability catalogue is requested in one
 * call (backend bound is 200), so business domains are never split across
 * frontend pages.
 */
export const WORKSPACE_CAPABILITY_PAGE_SIZE = 200;

export type WorkspaceCapabilityTargetLifecycle = "enabled" | "disabled";

export interface WorkspaceClientCapabilityRow {
  api_version: string;
  capability_kind: string;
  capability_key: string;
  display_name: string;
  description: string | null;
  scope_level: string;
  catalogue_lifecycle_status: string;
  administrator_assignable: boolean;
  supported_capability_id: string | null;
  supported_capability_status: string | null;
  organization_grant_id: string | null;
  organization_grant_status: string | null;
  organization_grant_enabled_at: string | null;
  organization_grant_disabled_at: string | null;
  workspace_grant_id: string | null;
  workspace_grant_status: string | null;
  workspace_grant_enabled_at: string | null;
  workspace_grant_disabled_at: string | null;
  effective_grant_status: string | null;
  effective_grant_source: string | null;
  total_count: number;
}

/**
 * API-ADM-UX2.3 — architecture-accurate neutral notice. The former blanket
 * additive-inheritance statement is retired: it is not valid for Project-scoped
 * capabilities, for which an Organization grant never substitutes for the exact
 * Workspace grant at runtime.
 */
export const WS_CAP_SCOPE_NOTICE =
  "Manage Workspace-scoped and Project-scoped capabilities here. Project-scoped capabilities apply only to Projects where this application has Project access.";

/**
 * API-ADM-UX2.3 — runtime-scope badge. It describes the capability runtime
 * scope, never the administration location.
 */
export function workspaceRuntimeScopeBadgeLabel(
  scopeLevel: string | null | undefined,
): string {
  if (scopeLevel === "workspace") return "Workspace scope";
  if (scopeLevel === "project") return "Project scope";
  return "Other scope";
}

/** API-ADM-UX2.3 — Project-scoped runtime constraint, shown on direct rows. */
export const WS_PROJECT_SCOPE_EXPLANATION =
  "Enabled for this Workspace. Applies only to Projects for which the application has Project access.";

/** API-ADM-UX2.3 — scope-aware confirmation copy. */
export const WS_PROJECT_SCOPE_ENABLE_CONFIRMATION =
  "This enables this capability for the application in this Workspace. It applies only to Projects for which the application has Project access, and runtime still requires user Project access.";
export const WS_PROJECT_SCOPE_DISABLE_CONFIRMATION =
  "This disables this capability for the application in this Workspace. Project application access alone will not permit this capability. Existing Project access rows are not removed.";
export const WS_WORKSPACE_SCOPE_ENABLE_CONFIRMATION =
  "This grants the permission to the application for this Workspace. Runtime access still requires every other applicable authorization check.";
export const WS_WORKSPACE_SCOPE_DISABLE_CONFIRMATION =
  "This disables only the direct Workspace permission. An enabled Organization permission remains effective for this Workspace-scoped capability.";

export const WS_CAP_APPLICATION_BLOCK_REASON =
  "Only active applications can receive new capability grants.";
export const WS_CAP_ORGANIZATION_BLOCK_REASON =
  "Connect this application to the Organization before enabling Workspace capabilities.";
export const WS_CAP_WORKSPACE_BLOCK_REASON =
  "Enable this application for the Workspace before enabling Workspace capabilities.";
export const WS_CAP_ARCHIVED_BLOCK_REASON =
  "Archived Workspaces cannot receive new capability grants.";
export const WS_CAP_UNAVAILABLE_REASON =
  "This capability is not currently available for Workspace assignment.";
export const WS_CAP_UNKNOWN_STATE_REASON =
  "This Workspace capability grant state is not recognized. Refresh the list.";

export const WS_CAP_ENABLE_ERROR =
  "Could not enable this Workspace capability. The application, Organization connection and Workspace access must be enabled, the Workspace must be active and not archived, and the capability must remain available for assignment.";
export const WS_CAP_DISABLE_ERROR =
  "Could not disable this Workspace capability. Refresh the capability list and try again.";

/** Grant presentation maps only the accepted values; anything else fails closed. */
export function workspaceGrantLabel(status: string | null | undefined): string {
  if (status === null || status === undefined) return "Not granted";
  if (status === "enabled") return "Enabled";
  if (status === "disabled") return "Disabled";
  return "Unavailable";
}

export function workspaceGrantVariant(
  status: string | null | undefined,
): "default" | "secondary" | "outline" {
  if (status === "enabled") return "default";
  if (status === "disabled") return "secondary";
  return "outline";
}

/** Effective access is backend-provided and never recalculated here. */
export function effectiveAccessLabel(status: string | null | undefined): string {
  if (status === "enabled") return "Enabled";
  if (status === "disabled") return "Disabled";
  if (status === null || status === undefined) return "Not granted";
  return "Unavailable";
}

export function effectiveSourceLabel(source: string | null | undefined): string {
  if (source === "workspace") return "Workspace";
  if (source === "organization") return "Organization";
  if (source === "none") return "None";
  return "None";
}

export type WorkspaceCapabilityActionKind =
  | "enable"
  | "reenable"
  | "disable"
  | "unavailable";

export interface WorkspaceCapabilityRowAction {
  kind: WorkspaceCapabilityActionKind;
  label: string;
  target: WorkspaceCapabilityTargetLifecycle | null;
  reason: string | null;
}

/**
 * Fail-closed direct Workspace grant action resolution. Actions manage only the
 * exact direct Workspace grant; an enabled Organization grant never blocks
 * creation or re-enablement of the Workspace grant.
 */
export function resolveWorkspaceCapabilityRowAction(
  row: Pick<
    WorkspaceClientCapabilityRow,
    | "workspace_grant_status"
    | "supported_capability_status"
    | "catalogue_lifecycle_status"
    | "administrator_assignable"
    | "scope_level"
    | "capability_kind"
  >,
  clientLifecycleStatus: string | null | undefined,
  organizationEnablementStatus: string | null | undefined,
  workspaceEnablementStatus: string | null | undefined,
  workspaceIsArchived: boolean | null | undefined,
): WorkspaceCapabilityRowAction {
  if (row.workspace_grant_status === "enabled") {
    return { kind: "disable", label: "Disable", target: "disabled", reason: null };
  }
  const notGranted =
    row.workspace_grant_status === null || row.workspace_grant_status === undefined;
  if (!notGranted && row.workspace_grant_status !== "disabled") {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: WS_CAP_UNKNOWN_STATE_REASON,
    };
  }
  if (clientLifecycleStatus !== "active") {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: WS_CAP_APPLICATION_BLOCK_REASON,
    };
  }
  if (organizationEnablementStatus !== "enabled") {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: WS_CAP_ORGANIZATION_BLOCK_REASON,
    };
  }
  if (workspaceEnablementStatus !== "enabled") {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: WS_CAP_WORKSPACE_BLOCK_REASON,
    };
  }
  if (workspaceIsArchived === true) {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: WS_CAP_ARCHIVED_BLOCK_REASON,
    };
  }
  const capabilityEligible =
    row.supported_capability_status === "enabled" &&
    row.catalogue_lifecycle_status === "active" &&
    row.administrator_assignable === true &&
    (row.scope_level === "workspace" || row.scope_level === "project");
  if (!capabilityEligible) {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: WS_CAP_UNAVAILABLE_REASON,
    };
  }
  if (row.workspace_grant_status === "disabled") {
    return { kind: "reenable", label: "Re-enable", target: "enabled", reason: null };
  }
  return { kind: "enable", label: "Enable", target: "enabled", reason: null };
}

/**
 * Placeholder isolation: previous rows may only be reused when the
 * Organization ID, API client ID and Workspace ID all match.
 */
export function resolveWorkspaceCapabilityPlaceholder(
  previousData: WorkspaceClientCapabilityRow[] | undefined,
  previousQueryKey: unknown[] | undefined,
  currentOrganizationId: string | null | undefined,
  currentApiClientId: string | null | undefined,
  currentWorkspaceId: string | null | undefined,
): WorkspaceClientCapabilityRow[] | undefined {
  if (!currentOrganizationId || !currentApiClientId || !currentWorkspaceId) return undefined;
  if (previousQueryKey?.[1] !== currentOrganizationId) return undefined;
  if (previousQueryKey?.[2] !== currentApiClientId) return undefined;
  if (previousQueryKey?.[3] !== currentWorkspaceId) return undefined;
  return previousData;
}

/* ------------------------------------------------------------------ API-ADM-UX1
 * Scope-clarity partitioning. Presentation only: the authoritative
 * backend-provided `scope_level` decides which capabilities are managed directly
 * at Workspace scope, and backend grant/effective fields describe the rest.
 * Nothing here recomputes effective permission.
 */

export const WS_DIRECT_SECTION_TITLE = "Workspace permissions";
export const WS_INHERITED_SECTION_TITLE = "Inherited from Organization";
export const WS_INHERITED_SECTION_DESCRIPTION =
  "These capabilities are managed by the Organization administrator and are read-only here.";
export const WS_LOWER_SCOPE_SECTION_TITLE = "Configured at another scope";
export const WS_LOWER_SCOPE_SECTION_DESCRIPTION =
  "These capabilities use a scope this administration surface does not recognize and are not actionable here.";

export interface WorkspaceCapabilityPartition {
  /**
   * API-ADM-UX2.3 — administered directly here: Workspace-scoped AND
   * Project-scoped capabilities (Project-scoped remain Project-scoped at
   * runtime, but are administered as exact Workspace grants).
   */
  readonly direct: WorkspaceClientCapabilityRow[];
  /** Organization-scoped capabilities, shown read-only. */
  readonly inherited: WorkspaceClientCapabilityRow[];
  /** Only unknown / unsupported future scope values, shown read-only. */
  readonly lowerScope: WorkspaceClientCapabilityRow[];
}

export function partitionWorkspaceCapabilityRows(
  rows: readonly WorkspaceClientCapabilityRow[],
): WorkspaceCapabilityPartition {
  return {
    direct: rows.filter(
      (r) => r.scope_level === "workspace" || r.scope_level === "project",
    ),
    inherited: rows.filter((r) => r.scope_level === "organization"),
    lowerScope: rows.filter(
      (r) =>
        r.scope_level !== "workspace" &&
        r.scope_level !== "project" &&
        r.scope_level !== "organization",
    ),
  };
}

/** Read-only Organization state wording; never a Workspace grant state. */
export function inheritedOrganizationStateLabel(
  organizationGrantStatus: string | null | undefined,
): string {
  if (organizationGrantStatus === "enabled") return "Enabled by Organization";
  if (organizationGrantStatus === "disabled") return "Disabled by Organization";
  return "Not enabled by Organization";
}

export function workspaceLowerScopeBadgeLabel(_scopeLevel: string | null | undefined): string {
  return "Other scope";
}

export function workspaceLowerScopeManagedAtLabel(
  _scopeLevel: string | null | undefined,
): string {
  return "Managed at another scope";
}
