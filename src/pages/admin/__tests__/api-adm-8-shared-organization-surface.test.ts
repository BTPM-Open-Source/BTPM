/**
 * Step API-ADM.8 — shared Organization Connected Apps administration surface and
 * final route role separation.
 *
 * Static source-contract tests plus pure model behavior. No live RPC, no
 * browser smoke test, no mutation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildConnectedAppsListQueryKey,
  connectionLabel,
  mapRowToManagementApp,
  resolveConnectedAppsPlaceholder,
  resolveRowAction,
} from "../connectedAppsOrganizationModel";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const SURFACE = read("src/pages/admin/ConnectedAppsOrganizationSurface.tsx");
const MODEL = read("src/pages/admin/connectedAppsOrganizationModel.ts");
const ORG = read("src/pages/admin/AdminConnectedApps.tsx");
const TENANT = read("src/pages/admin/AdminTenantConnectedApps.tsx");
const GUARDS = read("src/pages/admin/guards.tsx");
const APP = read("src/App.tsx");
const SHELL = read("src/pages/admin/ConnectedAppManagementView.tsx");

const LIST_RPC = "api_g_5_7_admin_list_organization_clients";
const TRANSITION_RPC = "api_g_5_7_admin_transition_organization_client";

// ------------------------------------------------------------ A. shared surface
describe("ADM.8 A — shared administration surface", () => {
  it("1. ConnectedAppsOrganizationSurface exists and is the default export", () => {
    expect(SURFACE).toContain("export default function ConnectedAppsOrganizationSurface");
  });

  it("2. it receives explicit organizationId / organizationName / context / key", () => {
    expect(SURFACE).toContain("readonly organizationId: string;");
    expect(SURFACE).toContain("readonly organizationName: string;");
    expect(SURFACE).toContain("readonly context: ConnectedAppAdminContext;");
    expect(SURFACE).toContain("readonly parentSummaryQueryKey: readonly unknown[];");
  });

  it("3. it never reads ActiveContext", () => {
    expect(SURFACE).not.toContain("useActiveContext");
    expect(SURFACE).not.toContain("ActiveContextProvider");
    expect(SURFACE).not.toContain("activeOrganization");
    expect(SURFACE).not.toContain("activeTenant");
  });

  it("4 + 5. it owns the canonical list and transition RPCs only", () => {
    expect(SURFACE).toContain(`"${LIST_RPC}"`);
    expect(SURFACE).toContain(`"${TRANSITION_RPC}"`);
    const calls = SURFACE.match(/supabase\.rpc as any\)\(/g) ?? [];
    expect(calls.length).toBe(2);
    expect(SURFACE).not.toMatch(/\.from\(/);
  });

  it("6. it owns list, pagination, Manage and Disconnect orchestration", () => {
    for (const marker of [
      "Show retired",
      "Previous",
      "Next",
      "Back to Connected Apps",
      "onRequestDisconnect",
      "<ConnectedAppManagementView",
      "transition.mutate(pendingAction);",
      "<Dialog open={!!pendingAction}",
    ]) {
      expect(SURFACE).toContain(marker);
    }
    expect((SURFACE.match(/useMutation\(/g) ?? []).length).toBe(1);
  });

  it("7. list query identity derives from parentSummaryQueryKey + filter + page", () => {
    expect(SURFACE).toContain(
      "buildConnectedAppsListQueryKey(parentSummaryQueryKey, includeRetired, page)",
    );
    expect(SURFACE).toContain("queryKey: listQueryKey,");
    expect(buildConnectedAppsListQueryKey(["connected-apps", "org-1"], true, 2)).toEqual([
      "connected-apps",
      "org-1",
      true,
      2,
    ]);
    expect(
      buildConnectedAppsListQueryKey(["tenant-connected-apps", "t-1", "org-1"], false, 0),
    ).toEqual(["tenant-connected-apps", "t-1", "org-1", false, 0]);
  });

  it("8. an Organization change resets every scoped piece of state", () => {
    const effect = SURFACE.slice(
      SURFACE.indexOf("  useEffect(() => {"),
      SURFACE.indexOf("}, [organizationId]);"),
    );
    for (const reset of [
      "setPage(0);",
      "setIncludeRetired(false);",
      "setPendingAction(null);",
      "setActionError(null);",
      "setManagedApiClientId(null);",
      "setManagementTab(DEFAULT_CONNECTED_APP_MANAGEMENT_TAB);",
    ]) {
      expect(effect).toContain(reset);
    }
  });

  it("8b. mutations re-verify the current Organization and fail closed", () => {
    expect(SURFACE).toContain("action.organizationId !== organizationId");
    expect(SURFACE).toContain('throw new Error("context_mismatch")');
  });

  it("8c. placeholder rows never cross Organizations", () => {
    const rows = [{ api_client_id: "c1" }] as any;
    expect(
      resolveConnectedAppsPlaceholder(rows, ["connected-apps", "org-1", false, 0], ["connected-apps", "org-1"], "org-1"),
    ).toBe(rows);
    expect(
      resolveConnectedAppsPlaceholder(rows, ["connected-apps", "org-2", false, 0], ["connected-apps", "org-1"], "org-1"),
    ).toBeUndefined();
    expect(
      resolveConnectedAppsPlaceholder(
        rows,
        ["tenant-connected-apps", "t-1", "org-2", false, 0],
        ["tenant-connected-apps", "t-1", "org-1"],
        "org-1",
      ),
    ).toBeUndefined();
    expect(
      resolveConnectedAppsPlaceholder(rows, ["connected-apps", "org-1", false, 0], ["connected-apps", "org-1"], null),
    ).toBeUndefined();
  });
});

// --------------------------------------------------------- B. pure shared model
describe("ADM.8 B — pure shared model", () => {
  it("9. the model owns resolveRowAction and mapRowToManagementApp", () => {
    expect(MODEL).toContain("export function resolveRowAction");
    expect(MODEL).toContain("export function mapRowToManagementApp");
    expect(MODEL).toContain("export interface OrganizationClientRow");
    expect(MODEL).toContain("export function lifecycleVariant");
    expect(MODEL).toContain("export function connectionLabel");
    expect(MODEL).toContain("export function connectionVariant");
    expect(MODEL).toContain("export function actionKindOf");
  });

  it("10. the model has no React / Supabase / React Query / context dependency", () => {
    // No imports at all, therefore no framework, backend, query or context coupling.
    expect(MODEL).not.toMatch(/^\s*import\s/m);
    expect(MODEL).not.toMatch(/require\(/);
    const code = MODEL.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const banned of [
      "react",
      "supabase",
      "@tanstack",
      "ActiveContext",
      "@/components",
      "useState",
      "useQuery",
      "jsx",
    ]) {
      expect(code.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("11. lifecycle behavior is unchanged", () => {
    expect(resolveRowAction({ client_lifecycle_status: "active", organization_enablement_status: "enabled" }))
      .toEqual({ kind: "manage", label: "Manage" });
    expect(resolveRowAction({ client_lifecycle_status: "active", organization_enablement_status: "disabled" }))
      .toEqual({ kind: "reconnect", label: "Reconnect", target: "enabled" });
    expect(resolveRowAction({ client_lifecycle_status: "active", organization_enablement_status: null }))
      .toEqual({ kind: "connect", label: "Connect", target: "enabled" });
    for (const lifecycle of ["suspended", "retired", "draft"]) {
      expect(resolveRowAction({ client_lifecycle_status: lifecycle, organization_enablement_status: null }).kind)
        .toBe("unavailable");
      expect(resolveRowAction({ client_lifecycle_status: lifecycle, organization_enablement_status: "disabled" }).kind)
        .toBe("unavailable");
      // Retained enabled connections stay manageable so they can be inspected/disconnected.
      expect(resolveRowAction({ client_lifecycle_status: lifecycle, organization_enablement_status: "enabled" }).kind)
        .toBe("manage");
    }
    expect(connectionLabel("enabled")).toBe("Connected");
    expect(connectionLabel("disabled")).toBe("Disabled");
    expect(connectionLabel(null)).toBe("Not connected");
    expect(
      mapRowToManagementApp({
        api_client_id: "c1",
        client_key: "k1",
        display_name: "App",
        description: null,
        client_lifecycle_status: "active",
        organization_enablement_status: "enabled",
        active_policy_version: "v1",
        enabled_workspace_count: 1,
        enabled_project_count: 2,
        enabled_capability_grant_count: 3,
      }),
    ).toEqual({
      apiClientId: "c1",
      clientKey: "k1",
      displayName: "App",
      description: null,
      clientLifecycleStatus: "active",
      organizationEnablementStatus: "enabled",
      activePolicyVersion: "v1",
      enabledWorkspaceCount: 1,
      enabledProjectCount: 2,
      enabledCapabilityGrantCount: 3,
    });
  });
});

// ------------------------------------------------------- C. Organization caller
describe("ADM.8 C — Organization caller", () => {
  it("12 + 13 + 14. it is a thin Organization-context caller", () => {
    expect(ORG).toContain("useActiveContext()");
    expect(ORG).toContain("ctx.activeOrganization?.id");
    expect(ORG).toContain("<ConnectedAppsOrganizationSurface");
    expect(ORG).toContain('context="organization"');
    expect(ORG).toContain('parentSummaryQueryKey={["connected-apps", organizationId]}');
    expect(ORG).toContain('title="Connected Apps"');
  });

  it("15. the Organization UX remains Manage-based via the shared surface", () => {
    expect(SURFACE).toContain("Manage");
    expect(ORG).not.toContain("Disconnect");
  });

  it("16. it no longer owns list, RPC or mutation implementation", () => {
    expect(ORG).not.toContain("supabase");
    expect(ORG).not.toContain("useQuery");
    expect(ORG).not.toContain("useMutation");
    expect(ORG).not.toContain(LIST_RPC);
    expect(ORG).not.toContain(TRANSITION_RPC);
    expect(ORG).not.toContain("<Table");
    expect(ORG).not.toContain("<Dialog");
    expect(ORG).not.toContain("resolveRowAction");
    expect(ORG).not.toContain("mapRowToManagementApp");
  });
});

// ------------------------------------------------------------- D. Tenant caller
describe("ADM.8 D — Tenant caller", () => {
  it("17. Tenant Organization selection logic is retained", () => {
    expect(TENANT).toContain('"tenant_admin_list_organizations"');
    expect(TENANT).toContain("if (organizationOptions.length === 1)");
    expect(TENANT).toContain("Select an Organization");
    expect(TENANT).toContain("No Organizations are available in this Tenant.");
    expect(TENANT).toContain(
      "if (!organizationOptions.some((o) => o.organization_id === organizationId))",
    );
    expect(TENANT).toContain("ctx.activeTenant?.id");
  });

  it("18 + 19. it passes tenant context and its own summary key", () => {
    expect(TENANT).toContain('context="tenant"');
    expect(TENANT).toContain('["tenant-connected-apps", tenantId, organizationId] as const');
    expect(TENANT).toContain("parentSummaryQueryKey={parentSummaryQueryKey}");
  });

  it("20. it no longer duplicates list / mutation / manage logic", () => {
    expect(TENANT).not.toContain("useMutation");
    expect(TENANT).not.toContain(LIST_RPC);
    expect(TENANT).not.toContain(TRANSITION_RPC);
    expect(TENANT).not.toContain("<Table");
    expect(TENANT).not.toContain("<Dialog");
    expect(TENANT).not.toContain("ConnectedAppManagementView");
    expect(TENANT).not.toContain("managedApiClientId");
    expect(TENANT).not.toContain("resolveRowAction");
    expect(TENANT).not.toContain('from "./AdminConnectedApps"');
  });

  it("21. it never uses the application-wide active Organization", () => {
    expect(TENANT).not.toContain("activeOrganization");
  });
});

// --------------------------------------------------------- E. route separation
describe("ADM.8 E — route role separation", () => {
  const orgRoute = APP.split("\n").find((l) => l.includes('path="/admin/connected-apps"')) ?? "";
  const tenantRoute =
    APP.split("\n").find((l) => l.includes('path="/admin/tenant/connected-apps"')) ?? "";

  it("22. /admin/connected-apps uses OrganizationConnectedAppsAdminGuard", () => {
    expect(orgRoute).toContain("<OrganizationConnectedAppsAdminGuard>");
    expect(GUARDS).toContain("export function OrganizationConnectedAppsAdminGuard");
    expect(GUARDS).not.toContain("export function ConnectedAppsAdminGuard");
    expect(APP).not.toContain("<ConnectedAppsAdminGuard>");
  });

  it("23. Tenant Admin or Platform Super Admin alone is not sufficient there", () => {
    const guard = GUARDS.slice(
      GUARDS.indexOf("export function OrganizationConnectedAppsAdminGuard"),
    );
    expect(guard).toContain("useActiveOrgAdminAccess()");
    expect(guard).toContain("if (orgAdmin.isOrgAdmin)");
    expect(guard).not.toContain("isTenantAdminForTenant");
    expect(guard).not.toContain("canOpenPlatformAdmin");
    expect(guard).toContain("ctx.activeOrganization?.id");
    expect(guard).toContain("if (!organizationId)");
  });

  it("24. /admin/tenant/connected-apps remains under TenantAdminGuard", () => {
    expect(tenantRoute).toContain("<TenantAdminGuard>");
    expect(tenantRoute).not.toContain("OrganizationConnectedAppsAdminGuard");
    expect(GUARDS).toContain("export function TenantAdminGuard");
    expect(GUARDS).toContain("access.isTenantAdminForTenant(tenantId)");
  });

  it("25. no redirect between the two Connected Apps routes", () => {
    expect(ORG).not.toContain("Navigate");
    expect(TENANT).not.toContain("Navigate");
    expect(SURFACE).not.toContain("useNavigate");
  });
});

// ------------------------------------------------------- F. regression/security
describe("ADM.8 F — regression and security", () => {
  it("26. both callers reuse the same administration surface", () => {
    expect(ORG).toContain('from "./ConnectedAppsOrganizationSurface"');
    expect(TENANT).toContain('from "./ConnectedAppsOrganizationSurface"');
  });

  it("27. no duplicate Tenant enablement / grant model exists", () => {
    for (const source of [SURFACE, TENANT, ORG, MODEL]) {
      expect(source).not.toMatch(/tenant_admin_transition|tenant_api_client|tenant_capability_grant/);
      expect(source).not.toMatch(/grant_id|enablement_id/);
    }
  });

  it("28. API activity stays Organization-scoped with an explicit organizationId", () => {
    expect(SHELL).toContain('mode="organization"');
    expect(SHELL).toContain("organizationId={organizationId}");
    expect(SHELL).not.toContain("tenantId");
  });

  it("29 + 30. no backend, migration, direct table or service-role access", () => {
    for (const source of [SURFACE, TENANT, ORG, MODEL, GUARDS]) {
      expect(source).not.toMatch(/CREATE FUNCTION|CREATE POLICY|ALTER TABLE|GRANT EXECUTE/i);
      expect(source).not.toMatch(/\.from\(/);
      expect(source).not.toMatch(/service_role|client_secret|access_token/);
    }
  });
});
