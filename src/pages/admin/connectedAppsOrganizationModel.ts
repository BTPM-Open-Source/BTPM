/**
 * Step API-ADM.8 — pure Organization Connected Apps administration model.
 *
 * Shared by the Organization Admin caller, the Tenant Admin caller and the
 * reusable `ConnectedAppsOrganizationSurface`.
 *
 * Pure module: no React, no Supabase, no React Query, no ActiveContext, no UI
 * component and no persistence of any kind.
 */

export const CONNECTED_APPS_PAGE_SIZE = 25;

export interface OrganizationClientRow {
  api_client_id: string;
  client_key: string;
  display_name: string;
  description: string | null;
  client_lifecycle_status: string;
  organization_enablement_status: string | null;
  active_policy_version: string | null;
  enabled_workspace_count: number;
  enabled_project_count: number;
  enabled_capability_grant_count: number;
  total_count: number;
}

export type TargetLifecycle = "enabled" | "disabled";

export interface PendingConnectionAction {
  organizationId: string;
  apiClientId: string;
  displayName: string;
  previousStatus: string | null;
  targetLifecycleStatus: TargetLifecycle;
}

/**
 * Structural mirror of the accepted `ConnectedAppManagementApp` shell contract.
 * Declared here so the pure model keeps no dependency on the React shell; the
 * assignment is checked structurally by TypeScript at the call site.
 */
export interface OrganizationManagementApp {
  readonly apiClientId: string;
  readonly clientKey: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly clientLifecycleStatus: string;
  readonly organizationEnablementStatus: string | null;
  readonly activePolicyVersion: string | null;
  readonly enabledWorkspaceCount: number;
  readonly enabledProjectCount: number;
  readonly enabledCapabilityGrantCount: number;
}

export function lifecycleVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "active") return "default";
  if (status === "retired") return "outline";
  return "secondary";
}

export function connectionLabel(status: string | null | undefined): string {
  if (status === "enabled") return "Connected";
  if (status === "disabled") return "Disabled";
  return "Not connected";
}

export function connectionVariant(
  status: string | null | undefined,
): "default" | "secondary" | "outline" {
  if (status === "enabled") return "default";
  if (status === "disabled") return "secondary";
  return "outline";
}

export type RowAction =
  | { kind: "connect"; label: "Connect"; target: "enabled" }
  | { kind: "reconnect"; label: "Reconnect"; target: "enabled" }
  | { kind: "manage"; label: "Manage" }
  | { kind: "unavailable" };

/**
 * Accepted lifecycle behavior (unchanged since API-ADM.6A):
 *   enabled retained connection            -> Manage
 *   active + disabled retained connection  -> Reconnect
 *   active + never connected               -> Connect
 *   non-active without enabled connection  -> Unavailable
 */
export function resolveRowAction(row: {
  client_lifecycle_status: string;
  organization_enablement_status: string | null;
}): RowAction {
  if (row.organization_enablement_status === "enabled") {
    // Connected applications are administered through Manage; Disconnect lives
    // inside the management Overview.
    return { kind: "manage", label: "Manage" };
  }
  if (row.client_lifecycle_status !== "active") {
    return { kind: "unavailable" };
  }
  if (row.organization_enablement_status === "disabled") {
    return { kind: "reconnect", label: "Reconnect", target: "enabled" };
  }
  return { kind: "connect", label: "Connect", target: "enabled" };
}

export function actionKindOf(pending: {
  targetLifecycleStatus: TargetLifecycle;
  previousStatus: string | null;
}): "connect" | "reconnect" | "disconnect" {
  if (pending.targetLifecycleStatus === "disabled") return "disconnect";
  return pending.previousStatus === "disabled" ? "reconnect" : "connect";
}

/** Maps an already-authorized list row into the management shell contract. */
export function mapRowToManagementApp(row: {
  api_client_id: string;
  client_key: string;
  display_name: string;
  description: string | null;
  client_lifecycle_status: string;
  organization_enablement_status: string | null;
  active_policy_version: string | null;
  enabled_workspace_count: number;
  enabled_project_count: number;
  enabled_capability_grant_count: number;
}): OrganizationManagementApp {
  return {
    apiClientId: row.api_client_id,
    clientKey: row.client_key,
    displayName: row.display_name,
    description: row.description,
    clientLifecycleStatus: row.client_lifecycle_status,
    organizationEnablementStatus: row.organization_enablement_status,
    activePolicyVersion: row.active_policy_version,
    enabledWorkspaceCount: Number(row.enabled_workspace_count ?? 0),
    enabledProjectCount: Number(row.enabled_project_count ?? 0),
    enabledCapabilityGrantCount: Number(row.enabled_capability_grant_count ?? 0),
  };
}

/**
 * List query identity is derived from the caller-owned parent summary key plus
 * the current filter and page. Callers keep cache isolation; the surface never
 * invents its own key namespace.
 */
export function buildConnectedAppsListQueryKey(
  parentSummaryQueryKey: readonly unknown[],
  includeRetired: boolean,
  page: number,
): readonly unknown[] {
  return [...parentSummaryQueryKey, includeRetired, page];
}

/**
 * Organization-aware placeholder isolation: previous rows may only be reused
 * when the previous query belonged to the same Organization. The Organization ID
 * is always the last element of the caller's parent summary key.
 */
export function resolveConnectedAppsPlaceholder(
  previousData: OrganizationClientRow[] | undefined,
  previousQueryKey: readonly unknown[] | undefined,
  parentSummaryQueryKey: readonly unknown[],
  organizationId: string | null | undefined,
): OrganizationClientRow[] | undefined {
  if (!organizationId) return undefined;
  const organizationIndex = parentSummaryQueryKey.length - 1;
  if (organizationIndex < 0) return undefined;
  if (previousQueryKey?.[organizationIndex] !== organizationId) return undefined;
  return previousData;
}
