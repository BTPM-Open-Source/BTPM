/**
 * Step API-ADM.6B — pure Connected App Organization-permission contracts and
 * helpers, extracted unchanged from the retired Organization capability dialog.
 *
 * Pure module: it contains no framework, backend, query, dialog, sheet,
 * active-scope or admin-role dependency of any kind.
 */

/**
 * API-ADM-UX1 — the complete bounded capability catalogue is requested in one
 * call (backend bound is 200), so the administration view never splits business
 * domains across frontend pages.
 */
export const ORGANIZATION_CAPABILITY_PAGE_SIZE = 200;

export type CapabilityTargetLifecycle = "enabled" | "disabled";

export interface OrganizationClientCapabilityRow {
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
  grant_id: string | null;
  grant_status: string | null;
  grant_enabled_at: string | null;
  grant_disabled_at: string | null;
  total_count: number;
}

export const CAPABILITY_APPLICATION_BLOCK_REASON =
  "Only active applications can receive new capability grants.";
export const CAPABILITY_ORGANIZATION_BLOCK_REASON =
  "Connect this application to the Organization before enabling capabilities.";
export const CAPABILITY_UNAVAILABLE_REASON =
  "This capability is not currently available for assignment.";

/**
 * API-N.10A — presentation-only scope distinction. Capabilities that are not
 * Organization-scoped stay visible but are administered by their own existing
 * surface; this helper adds NO grant semantics.
 */
export const CAPABILITY_WORKSPACE_SCOPE_NOTICE =
  "Managed in Workspace permissions.";
export const CAPABILITY_PROJECT_SCOPE_NOTICE =
  "Managed in Workspace permissions.";
export const CAPABILITY_UNKNOWN_SCOPE_NOTICE =
  "Not manageable at Organization level.";

export interface OrganizationScopePresentation {
  /** Human scope label: Organization / Workspace / Project / Unknown scope. */
  readonly label: string;
  /** True only for Organization-scoped rows, which keep the existing action. */
  readonly managedAtOrganization: boolean;
  /** Where the capability is actually administered, when not Organization. */
  readonly notice: string | null;
}

export function organizationScopePresentation(
  scopeLevel: string | null | undefined,
): OrganizationScopePresentation {
  if (scopeLevel === "organization") {
    return { label: "Organization", managedAtOrganization: true, notice: null };
  }
  if (scopeLevel === "workspace") {
    return {
      label: "Workspace",
      managedAtOrganization: false,
      notice: CAPABILITY_WORKSPACE_SCOPE_NOTICE,
    };
  }
  if (scopeLevel === "project") {
    return {
      label: "Project",
      managedAtOrganization: false,
      notice: CAPABILITY_PROJECT_SCOPE_NOTICE,
    };
  }
  return {
    label: "Unknown scope",
    managedAtOrganization: false,
    notice: CAPABILITY_UNKNOWN_SCOPE_NOTICE,
  };
}

export const CAPABILITY_ENABLE_ERROR =
  "Could not enable this capability. The application and Organization connection must be enabled, and the capability must remain available for assignment.";
export const CAPABILITY_DISABLE_ERROR =
  "Could not disable this capability. Refresh the capability list and try again.";

/* ------------------------------------------------------------------ API-ADM-UX1
 * Scope-clarity partitioning. Presentation only: the authoritative
 * backend-provided `scope_level` decides where a capability is administered.
 */

export const ORGANIZATION_LOWER_SCOPE_SECTION_TITLE = "Managed in Workspace permissions";
export const ORGANIZATION_LOWER_SCOPE_SECTION_DESCRIPTION =
  "These capabilities are managed in Workspace permissions. Project-scoped capabilities remain limited to Projects where the application has Project access.";

/** Explicit scope wording for capabilities controlled outside Organization scope. */
export function lowerScopeBadgeLabel(scopeLevel: string | null | undefined): string {
  if (scopeLevel === "workspace") return "Workspace";
  if (scopeLevel === "project") return "Project";
  return "Other scope";
}

export function lowerScopeManagedAtLabel(scopeLevel: string | null | undefined): string {
  if (scopeLevel === "workspace") return "Managed at Workspace";
  // API-ADM-UX2.3 — Project-scoped capabilities are administered at Workspace
  // level; the scope badge stays "Project" because runtime scope is unchanged.
  if (scopeLevel === "project") return "Managed at Workspace";
  return "Managed at another scope";
}

export interface OrganizationCapabilityPartition {
  /** Genuinely grantable at Organization scope. */
  readonly managed: OrganizationClientCapabilityRow[];
  /** Read-only reference rows controlled at Workspace / Project scope. */
  readonly lowerScope: OrganizationClientCapabilityRow[];
}

export function partitionOrganizationCapabilityRows(
  rows: readonly OrganizationClientCapabilityRow[],
): OrganizationCapabilityPartition {
  return {
    managed: rows.filter((r) => r.scope_level === "organization"),
    lowerScope: rows.filter((r) => r.scope_level !== "organization"),
  };
}

/** Grant status presentation maps only the accepted values; anything else fails closed. */
export function capabilityGrantLabel(status: string | null | undefined): string {
  if (status === null || status === undefined) return "Not granted";
  if (status === "enabled") return "Enabled";
  if (status === "disabled") return "Disabled";
  return "Unavailable";
}

export function capabilityGrantVariant(
  status: string | null | undefined,
): "default" | "secondary" | "outline" {
  if (status === "enabled") return "default";
  if (status === "disabled") return "secondary";
  return "outline";
}

export type CapabilityActionKind = "enable" | "reenable" | "disable" | "unavailable";

export interface CapabilityRowAction {
  kind: CapabilityActionKind;
  label: string;
  target: CapabilityTargetLifecycle | null;
  reason: string | null;
}

/**
 * Fail-closed capability action resolution.
 *
 * An existing enabled grant stays disableable even when the application is
 * suspended or retired, the Organization connection is disabled, or the
 * capability is no longer assignable — the backend remains authoritative for
 * malformed retained data. Any unexpected non-null grant status is unavailable.
 */
export function resolveCapabilityRowAction(
  row: Pick<
    OrganizationClientCapabilityRow,
    | "grant_status"
    | "supported_capability_status"
    | "catalogue_lifecycle_status"
    | "administrator_assignable"
    | "scope_level"
    | "capability_kind"
  >,
  clientLifecycleStatus: string | null | undefined,
  organizationEnablementStatus: string | null | undefined,
): CapabilityRowAction {
  if (row.grant_status === "enabled") {
    return { kind: "disable", label: "Disable", target: "disabled", reason: null };
  }
  const notGranted = row.grant_status === null || row.grant_status === undefined;
  if (!notGranted && row.grant_status !== "disabled") {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: CAPABILITY_UNAVAILABLE_REASON,
    };
  }
  if (clientLifecycleStatus !== "active") {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: CAPABILITY_APPLICATION_BLOCK_REASON,
    };
  }
  if (organizationEnablementStatus !== "enabled") {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: CAPABILITY_ORGANIZATION_BLOCK_REASON,
    };
  }
  // Capability identity is decided by the authoritative supported-capability and
  // catalogue metadata only. No capability-kind allowlist exists at this layer.
  const capabilityEligible =
    row.supported_capability_status === "enabled" &&
    row.catalogue_lifecycle_status === "active" &&
    row.administrator_assignable === true &&
    row.scope_level === "organization";
  if (!capabilityEligible) {
    return {
      kind: "unavailable",
      label: "Unavailable",
      target: null,
      reason: CAPABILITY_UNAVAILABLE_REASON,
    };
  }
  if (row.grant_status === "disabled") {
    return { kind: "reenable", label: "Re-enable", target: "enabled", reason: null };
  }
  return { kind: "enable", label: "Enable", target: "enabled", reason: null };
}

/**
 * Placeholder isolation: previous rows may only be reused when both the
 * Organization ID and the API client ID of the previous query match.
 */
export function resolveCapabilityPlaceholder(
  previousData: OrganizationClientCapabilityRow[] | undefined,
  previousQueryKey: unknown[] | undefined,
  currentOrganizationId: string | null | undefined,
  currentApiClientId: string | null | undefined,
): OrganizationClientCapabilityRow[] | undefined {
  if (!currentOrganizationId || !currentApiClientId) return undefined;
  if (previousQueryKey?.[1] !== currentOrganizationId) return undefined;
  if (previousQueryKey?.[2] !== currentApiClientId) return undefined;
  return previousData;
}
