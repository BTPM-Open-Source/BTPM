/**
 * Step API-ADM.7 — Tenant-native Connected Apps page focused tests.
 *
 * Static source contract checks (route, guard, navigation, RPC reuse,
 * containment, security) plus pure lifecycle-helper reuse checks.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveRowAction,
  mapRowToManagementApp,
} from "../connectedAppsOrganizationModel";
import { tenantOrganizationOptionLabel } from "../AdminTenantConnectedApps";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const PAGE = read("src/pages/admin/AdminTenantConnectedApps.tsx");
// API-ADM.8 — shared administration surface used by both callers.
const SURFACE = read("src/pages/admin/ConnectedAppsOrganizationSurface.tsx");
const APP = read("src/App.tsx");
const TENANT_DASH = read("src/pages/admin/AdminTenant.tsx");
const ORG_PAGE = read("src/pages/admin/AdminConnectedApps.tsx");
const SHELL = read("src/pages/admin/ConnectedAppManagementView.tsx");
const CHILDREN = {
  workspaceAccess: read("src/pages/admin/ConnectedAppWorkspaceAccess.tsx"),
  projectAccess: read("src/pages/admin/ConnectedAppProjectAccess.tsx"),
  organizationPermissions: read("src/pages/admin/ConnectedAppOrganizationPermissions.tsx"),
  workspacePermissions: read("src/pages/admin/ConnectedAppWorkspacePermissions.tsx"),
};

describe("ADM.7 A — route / navigation", () => {
  it("1. /admin/tenant/connected-apps route exists", () => {
    expect(APP).toContain('path="/admin/tenant/connected-apps"');
    expect(APP).toContain("AdminTenantConnectedApps");
  });

  it("2. the route is guarded by TenantAdminGuard", () => {
    const line = APP.split("\n").find((l) => l.includes('path="/admin/tenant/connected-apps"'))!;
    expect(line).toContain("<TenantAdminGuard>");
    expect(line).not.toContain("ConnectedAppsAdminGuard");
  });

  it("3. AdminTenant Connected Apps card points to the Tenant route", () => {
    expect(TENANT_DASH).toContain('to="/admin/tenant/connected-apps"');
    expect(TENANT_DASH).toContain("Manage Connected Apps across Organizations in this Tenant.");
  });

  it("4. Tenant dashboard no longer links to /admin/connected-apps", () => {
    expect(TENANT_DASH).not.toContain('"/admin/connected-apps"');
  });
});

describe("ADM.7 B — Tenant context", () => {
  it("5. the page derives the active Tenant", () => {
    expect(PAGE).toContain("ctx.activeTenant?.id");
    expect(PAGE).toContain("ctx.activeTenant?.name");
  });

  it("6. activeOrganization is never the administration target", () => {
    expect(PAGE).not.toContain("activeOrganization");
  });

  it("7. Organization choices come only from the Tenant Organization RPC", () => {
    expect(PAGE).toContain('"tenant_admin_list_organizations"');
    expect(PAGE).toContain('queryKey: ["tenant-connected-app-organizations", tenantId]');
    expect(PAGE).not.toContain('.from("organizations")');
  });

  it("8. zero Organizations produces the bounded empty state", () => {
    expect(PAGE).toContain("No Organizations are available in this Tenant.");
    expect(SURFACE).toContain("enabled: !!organizationId,");
  });

  it("9 + 10. exactly one Organization auto-selects; multiple require explicit selection", () => {
    expect(PAGE).toContain("if (organizationOptions.length === 1)");
    expect(PAGE).toContain("setOrganizationId(organizationOptions[0].organization_id)");
    expect(PAGE).toContain("Select an Organization");
    // no silent multi-Organization default
    expect(PAGE).not.toMatch(/organizationOptions\[0\][\s\S]{0,40}length > 1/);
  });

  it("no localStorage / sessionStorage persistence", () => {
    expect(PAGE).not.toContain("localStorage");
    expect(PAGE).not.toContain("sessionStorage");
  });
});

describe("ADM.7 C — Organization containment", () => {
  it("11. selected Organization drives the Connected Apps list RPC", () => {
    expect(SURFACE).toContain('"api_g_5_7_admin_list_organization_clients"');
    expect(SURFACE).toContain("_organization_id: organizationId,");
    expect(PAGE).toContain('["tenant-connected-apps", tenantId, organizationId] as const');
    expect(SURFACE).toContain("queryKey: listQueryKey,");
  });

  it("12. Organization switch resets app / manage state", () => {
    for (const reset of [
      "setPage(0)",
      "setIncludeRetired(false)",
      "setPendingAction(null)",
      "setActionError(null)",
      "setManagedApiClientId(null)",
      "setManagementTab(DEFAULT_CONNECTED_APP_MANAGEMENT_TAB)",
    ]) {
      expect(SURFACE).toContain(reset);
    }
    expect(SURFACE).toContain("}, [organizationId]);");
  });

  it("13 + 14. mutation re-verifies the selected Organization and fails closed", () => {
    expect(SURFACE).toContain("action.organizationId !== organizationId");
    expect(PAGE).toContain(
      "organizationOptions.some((o) => o.organization_id === organizationId)",
    );
    expect(SURFACE).toContain('throw new Error("context_mismatch")');
  });

  it("stale Organization selection is cleared after refetch", () => {
    expect(PAGE).toContain("if (!organizationOptions.some((o) => o.organization_id === organizationId))");
    expect(PAGE).toContain("setOrganizationId(null)");
  });

  it("an unavailable managed app returns to the list", () => {
    expect(SURFACE).toContain("if (managedRow) return;");
    expect(SURFACE).toContain("exitManageMode();");
  });
});

describe("ADM.7 D — app administration", () => {
  it("15. lifecycle action behavior reuses the accepted Organization Admin helper", () => {
    expect(PAGE).not.toContain('from "./AdminConnectedApps"');
    expect(SURFACE).toContain('from "./connectedAppsOrganizationModel"');
    expect(
      resolveRowAction({ client_lifecycle_status: "active", organization_enablement_status: "enabled" }),
    ).toEqual({ kind: "manage", label: "Manage" });
    expect(
      resolveRowAction({ client_lifecycle_status: "active", organization_enablement_status: "disabled" }),
    ).toEqual({ kind: "reconnect", label: "Reconnect", target: "enabled" });
    expect(
      resolveRowAction({ client_lifecycle_status: "active", organization_enablement_status: null }),
    ).toEqual({ kind: "connect", label: "Connect", target: "enabled" });
    expect(
      resolveRowAction({ client_lifecycle_status: "retired", organization_enablement_status: null }),
    ).toEqual({ kind: "unavailable" });
  });

  it("16 + 17 + 18. Manage reuses the shell with tenant context and explicit Organization", () => {
    expect(SURFACE).toContain("<ConnectedAppManagementView");
    expect(PAGE).toContain('context="tenant"');
    expect(PAGE).toContain("organizationId={organizationId}");
    expect(PAGE).toContain("organizationName={selectedOrganization.name}");
    expect(SURFACE).toContain("app={mapRowToManagementApp(managedRow)}");
    expect(SHELL).toContain('context === "tenant" ? "Tenant administration"');
  });

  it("maps a list row into the accepted management contract", () => {
    const app = mapRowToManagementApp({
      api_client_id: "c1",
      client_key: "k",
      display_name: "App",
      description: null,
      client_lifecycle_status: "active",
      organization_enablement_status: "enabled",
      active_policy_version: "1.0",
      enabled_workspace_count: 2,
      enabled_project_count: 3,
      enabled_capability_grant_count: 4,
    });
    expect(app.apiClientId).toBe("c1");
    expect(app.enabledCapabilityGrantCount).toBe(4);
  });

  it("19 + 20. Disconnect reuses the Organization transition RPC only", () => {
    expect(SURFACE).toContain('"api_g_5_7_admin_transition_organization_client"');
    expect(SURFACE).toContain("_target_lifecycle_status: action.targetLifecycleStatus");
    expect(PAGE).not.toMatch(/tenant_admin_transition|tenant_api_client|tenant_capability_grant/);
  });

  it("shell surfaces Disconnect inside Overview; Connect/Reconnect stay list level", () => {
    expect(SURFACE).toContain("onRequestDisconnect");
    expect(SHELL).toContain("Disconnect");
  });

  it("page shell uses tenant scope with the Tenant name and shows the Organization", () => {
    expect(PAGE).toContain('scope="tenant"');
    expect(PAGE).toContain("contextLabel={tenantName}");
    expect(SURFACE).toContain("Organization: {organizationName}");
  });

  it("selector label exposes only safe metadata", () => {
    expect(tenantOrganizationOptionLabel({ name: "Prod", environment_role: "production" })).toBe("Prod");
    expect(
      tenantOrganizationOptionLabel({ name: "QAS", environment_role: "non_production" }),
    ).toBe("QAS · Non-production");
  });
});

describe("ADM.7 E — summary refresh", () => {
  it("21. the page passes its own parent summary key to the shell", () => {
    expect(PAGE).toContain("parentSummaryQueryKey={parentSummaryQueryKey}");
    expect(SURFACE).toContain("parentSummaryQueryKey={parentSummaryQueryKey}");
    expect(PAGE).toContain('["tenant-connected-apps", tenantId, organizationId] as const');
  });

  it("shell forwards the optional key without role inference", () => {
    expect(SHELL).toContain("readonly parentSummaryQueryKey?: readonly unknown[];");
    expect(SHELL.match(/parentSummaryQueryKey=\{parentSummaryQueryKey\}/g)?.length).toBe(2);
    expect(SHELL).not.toContain("useActiveContext");
    expect(SHELL).not.toContain("isTenantAdmin");
  });

  it("22 + 23. children keep the accepted Organization Admin invalidation and add the optional key", () => {
    for (const [name, source] of Object.entries(CHILDREN)) {
      expect(source, name).toContain('queryKey: ["connected-apps", action.organizationId],');
      expect(source, name).toContain(
        "await queryClient.invalidateQueries({ queryKey: parentSummaryQueryKey });",
      );
      expect(source, name).toContain("readonly parentSummaryQueryKey?: readonly unknown[];");
    }
    // Workspace access forwards the key into its nested child surfaces.
    expect(
      CHILDREN.workspaceAccess.match(/parentSummaryQueryKey=\{parentSummaryQueryKey\}/g)?.length,
    ).toBe(2);
  });

  it("Organization Admin page still owns its own summary key and passes no tenant key", () => {
    expect(ORG_PAGE).toContain('parentSummaryQueryKey={["connected-apps", organizationId]}');
    expect(ORG_PAGE).toContain('context="organization"');
    expect(ORG_PAGE).not.toContain("tenant-connected-apps");
  });

  it("no duplicate downstream count state is introduced", () => {
    expect(PAGE).not.toMatch(/setEnabled(Workspace|Project|Capability)Count/);
  });
});

describe("ADM.7 F — security", () => {
  it("24. no direct table access", () => {
    expect(PAGE).not.toContain("supabase.from(");
  });

  it("25 + 26. no ActiveContext switching and no impersonation", () => {
    expect(PAGE).not.toContain("setActiveContext");
    expect(PAGE).not.toContain("set_my_active_context");
    expect(PAGE).not.toContain("impersonat");
  });

  it("27. no new backend surface referenced", () => {
    const rpcs = Array.from(
      (PAGE + SURFACE).matchAll(/supabase\.rpc as any\)\(\s*"([a-z0-9_]+)"/g),
    ).map((m) => m[1]);
    expect(new Set(rpcs)).toEqual(
      new Set([
        "tenant_admin_list_organizations",
        "api_g_5_7_admin_list_organization_clients",
        "api_g_5_7_admin_transition_organization_client",
      ]),
    );
  });

  it("28. no credentials, secrets, grant or enablement IDs rendered", () => {
    expect(PAGE).not.toMatch(/client_secret|access_token|refresh_token|service_role/);
    expect(PAGE).not.toMatch(/grant_id|enablement_id/);
  });
});
