/**
 * Step API-ADM.6A — Organization Connected Apps single Manage flow.
 *
 * Source-contract focused tests. No live RPC, no browser smoke test.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveRowAction, mapRowToManagementApp } from "../connectedAppsOrganizationModel";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const LIST = read("src/pages/admin/ConnectedAppsOrganizationSurface.tsx");
const ORG_CALLER = read("src/pages/admin/AdminConnectedApps.tsx");
const SHELL = read("src/pages/admin/ConnectedAppManagementView.tsx");
const ORG_PERMS = read("src/pages/admin/ConnectedAppOrganizationPermissions.tsx");
const WS_ACCESS = read("src/pages/admin/ConnectedAppWorkspaceAccess.tsx");
const WS_PERMS = read("src/pages/admin/ConnectedAppWorkspacePermissions.tsx");
const PROJ_ACCESS = read("src/pages/admin/ConnectedAppProjectAccess.tsx");

const ORG_TRANSITION_RPC = "api_g_5_7_admin_transition_organization_client";
const LIST_RPC = "api_g_5_7_admin_list_organization_clients";

describe("API-ADM.6A list simplification", () => {
  it("1. connected rows resolve to Manage", () => {
    expect(resolveRowAction({ client_lifecycle_status: "active", organization_enablement_status: "enabled" }))
      .toEqual({ kind: "manage", label: "Manage" });
    expect(LIST).toContain("onClick={() => openManage(row)}");
  });

  it("2. the list exposes no row-level Disconnect", () => {
    expect(LIST).not.toContain('label: "Disconnect"');
    expect(LIST).not.toContain('kind: "disconnect"; label');
  });

  it("3-5. legacy View scope / Capabilities / Activity row actions are gone", () => {
    for (const legacy of ["View scope", "Capabilities", "Activity"]) {
      expect(LIST).not.toContain(`>\n                            ${legacy}`);
    }
    expect(LIST).not.toContain("openWorkspaceScope");
    expect(LIST).not.toContain("openCapabilities");
    expect(LIST).not.toContain("openActivity");
  });

  it("6. disabled retained connection on an active application resolves to Reconnect", () => {
    expect(resolveRowAction({ client_lifecycle_status: "active", organization_enablement_status: "disabled" }))
      .toEqual({ kind: "reconnect", label: "Reconnect", target: "enabled" });
  });

  it("7. never-connected active application resolves to Connect", () => {
    expect(resolveRowAction({ client_lifecycle_status: "active", organization_enablement_status: null }))
      .toEqual({ kind: "connect", label: "Connect", target: "enabled" });
  });

  it("8. unavailable lifecycle remains fail-closed", () => {
    for (const lifecycle of ["suspended", "retired", "draft"]) {
      expect(resolveRowAction({ client_lifecycle_status: lifecycle, organization_enablement_status: null }).kind)
        .toBe("unavailable");
      expect(resolveRowAction({ client_lifecycle_status: lifecycle, organization_enablement_status: "disabled" }).kind)
        .toBe("unavailable");
      expect(resolveRowAction({ client_lifecycle_status: lifecycle, organization_enablement_status: "enabled" }).kind)
        .toBe("manage");
    }
    expect(LIST).toContain("Unavailable");
  });

  it("9. summary headings use Access and Permissions", () => {
    expect(LIST).toContain("<TableHead>Access</TableHead>");
    expect(LIST).toContain("<TableHead>Permissions</TableHead>");
    expect(LIST).not.toContain("Enabled scope");
    expect(LIST).not.toContain("Enabled capabilities");
    expect(LIST).toContain("row.enabled_workspace_count");
    expect(LIST).toContain("row.enabled_project_count");
    expect(LIST).toContain("row.enabled_capability_grant_count");
  });
});

describe("API-ADM.6A Manage mode", () => {
  it("10. selection identity is only the api_client_id", () => {
    const opener = LIST.slice(LIST.indexOf("const openManage"), LIST.indexOf("const closeDialog"));
    expect(opener).toContain("setManagedApiClientId(row.api_client_id);");
    expect(opener).not.toContain("client_key");
    expect(LIST).toContain("const [managedApiClientId, setManagedApiClientId] = useState<string | null>(null);");
  });

  it("11. the managed row is derived from current authorized query data", () => {
    expect(LIST).toContain("rows.find((row) => row.api_client_id === managedApiClientId)");
    expect(LIST).toContain("app={mapRowToManagementApp(managedRow)}");
    const mapped = mapRowToManagementApp({
      api_client_id: "c1", client_key: "k1", display_name: "App One", description: null,
      client_lifecycle_status: "active", organization_enablement_status: "enabled",
      active_policy_version: "v2", enabled_workspace_count: 3, enabled_project_count: 4,
      enabled_capability_grant_count: 5,
    });
    expect(mapped).toEqual({
      apiClientId: "c1", clientKey: "k1", displayName: "App One", description: null,
      clientLifecycleStatus: "active", organizationEnablementStatus: "enabled",
      activePolicyVersion: "v2", enabledWorkspaceCount: 3, enabledProjectCount: 4,
      enabledCapabilityGrantCount: 5,
    });
  });

  it("12-13. context and explicit Organization identity are passed", () => {
    expect(ORG_CALLER).toContain('context="organization"');
    expect(LIST).toContain("organizationId={organizationId}");
    expect(LIST).toContain("organizationName={organizationName}");
  });

  it("14-15. default tab is Overview and tab changes are caller controlled", () => {
    expect(LIST).toContain("DEFAULT_CONNECTED_APP_MANAGEMENT_TAB");
    expect(LIST).toContain("activeTab={managementTab}");
    expect(LIST).toContain("onTabChange={setManagementTab}");
  });

  it("16. Back to Connected Apps clears the selection and resets the tab", () => {
    expect(LIST).toContain("Back to Connected Apps");
    const exit = LIST.slice(LIST.indexOf("const exitManageMode"), LIST.indexOf("// Fail safely"));
    expect(exit).toContain("setManagedApiClientId(null);");
    expect(exit).toContain("setManagementTab(DEFAULT_CONNECTED_APP_MANAGEMENT_TAB);");
  });

  it("17. an Organization switch clears the managed selection", () => {
    const effect = LIST.slice(LIST.indexOf("useEffect(() => {"), LIST.indexOf("}, [organizationId]);"));
    expect(effect).toContain("setPage(0);");
    expect(effect).toContain("setPendingAction(null);");
    expect(effect).toContain("setActionError(null);");
    expect(effect).toContain("setManagedApiClientId(null);");
    expect(effect).toContain("setManagementTab(DEFAULT_CONNECTED_APP_MANAGEMENT_TAB);");
  });

  it("18. no new route, detail RPC, direct table read or persistence exists", () => {
    expect(LIST).toContain(LIST_RPC);
    expect((LIST.match(/supabase\.rpc as any\)\(/g) ?? []).length).toBe(2);
    expect(LIST).toContain("queryKey: listQueryKey,");
    expect(LIST).toContain("buildConnectedAppsListQueryKey(parentSummaryQueryKey, includeRetired, page)");
    expect(ORG_CALLER).toContain('parentSummaryQueryKey={["connected-apps", organizationId]}');
    expect(LIST).not.toContain(".from(");
    for (const banned of ["localStorage", "sessionStorage", "useSearchParams", "useParams", "useNavigate", "Route"]) {
      expect(LIST).not.toContain(banned);
    }
  });

  it("12b. management chrome stays inside SaasAdminShell with no duplicate hero", () => {
    expect(ORG_CALLER).toContain('title="Connected Apps"');
    expect(ORG_CALLER).toContain("contextLabel={organizationName}");
  });

  it("stale managed rows fail safely back to the list", () => {
    const guard = LIST.slice(LIST.indexOf("// Fail safely"), LIST.indexOf("const openAction"));
    expect(guard).toContain("if (isLoading || isFetching) return;");
    expect(guard).toContain("if (managedRow) return;");
    expect(guard).toContain("exitManageMode();");
  });
});

describe("API-ADM.6A Disconnect in Overview", () => {
  it("19. the shell renders Disconnect only for an enabled connection with a callback", () => {
    expect(SHELL).toContain('app.organizationEnablementStatus === "enabled" && onRequestDisconnect');
    const overview = SHELL.slice(
      SHELL.indexOf('<TabsContent value="overview"'),
      SHELL.indexOf('<TabsContent value="access"'),
    );
    expect(overview).toMatch(/>\s*Disconnect\s*</);
    const rest = SHELL.slice(SHELL.indexOf('<TabsContent value="access"'));
    expect(rest).not.toContain("Disconnect");
  });

  it("20. the shell only delegates to the caller callback", () => {
    expect(SHELL).toContain("onClick={onRequestDisconnect}");
    expect(SHELL).toContain("readonly onRequestDisconnect?: () => void;");
    expect(SHELL).toContain("readonly connectionActionPending?: boolean;");
  });

  it("21-22. the existing Organization transition RPC and confirmation are reused", () => {
    expect(LIST).toContain(ORG_TRANSITION_RPC);
    expect(LIST).toContain("_target_lifecycle_status: action.targetLifecycleStatus,");
    expect(LIST).toContain('targetLifecycleStatus: "disabled",');
    expect(LIST).toContain("{confirmationDialog}");
    expect(LIST).toContain("transition.mutate(pendingAction);");
    expect((LIST.match(/useMutation\(/g) ?? []).length).toBe(1);
  });

  it("23. successful disconnect invalidates the list and exits Manage mode", () => {
    const onSuccess = LIST.slice(LIST.indexOf("onSuccess: async (action) => {"), LIST.indexOf("onError: (err: any, action)"));
    expect(onSuccess).toContain("queryKey: parentSummaryQueryKey });");
    expect(onSuccess).toContain('if (action.targetLifecycleStatus === "disabled") {');
    expect(onSuccess).toContain("setManagedApiClientId(null);");
    expect(onSuccess).toContain("setManagementTab(DEFAULT_CONNECTED_APP_MANAGEMENT_TAB);");
  });
});

describe("API-ADM.6A parent summary invalidation", () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ["24. Organization permissions", ORG_PERMS, "connected-app-organization-permissions"],
    ["25. Workspace access", WS_ACCESS, "connected-app-workspace-access"],
    ["26. Workspace permissions", WS_PERMS, "connected-app-workspace-permissions"],
    ["27. Project access", PROJ_ACCESS, "connected-app-project-access"],
  ];
  for (const [name, source, narrowKey] of cases) {
    it(`${name} invalidates ["connected-apps", organizationId]`, () => {
      expect(source).toContain('queryKey: ["connected-apps", action.organizationId],');
    });
    it(`${name} preserves its existing narrower invalidation (28)`, () => {
      expect(source).toContain(narrowKey);
    });
  }
  it("28b. Workspace/Project children still refresh Workspace access counts", () => {
    for (const source of [WS_PERMS, PROJ_ACCESS]) {
      expect(source).toContain('queryKey: ["connected-app-workspace-access", action.organizationId, action.apiClientId],');
    }
  });
});

describe("API-ADM.6A legacy production path retirement", () => {
  it("29. the list no longer imports or renders the legacy dialogs", () => {
    for (const legacy of [
      "ConnectedAppWorkspaceScopeDialog", "ConnectedAppOrganizationCapabilityDialog", "ConnectedAppActivityDialog",
    ]) expect(LIST).not.toContain(legacy);
  });
  it("30. legacy selection and open-handler state is absent", () => {
    for (const legacy of ["scopeSelection", "capabilitySelection", "activitySelection", "openWorkspaceScope", "openCapabilities", "openActivity"]) {
      expect(LIST).not.toContain(legacy);
    }
  });
  it("31. API-ADM.6B — the legacy dialog files are deleted", () => {
    for (const file of [
      "src/pages/admin/ConnectedAppWorkspaceScopeDialog.tsx",
      "src/pages/admin/ConnectedAppProjectScopeDialog.tsx",
      "src/pages/admin/ConnectedAppWorkspaceCapabilityDialog.tsx",
      "src/pages/admin/ConnectedAppOrganizationCapabilityDialog.tsx",
      "src/pages/admin/ConnectedAppActivityDialog.tsx",
    ]) expect(existsSync(resolve(process.cwd(), file))).toBe(false);
  });
  it("32. the management shell remains Supabase/RPC free", () => {
    expect(SHELL).not.toContain("supabase");
    expect(SHELL).not.toContain(".rpc(");
    expect(SHELL).not.toContain("useMutation");
    const imports = SHELL.split("\n").filter((l) => l.trimStart().startsWith("import "));
    expect(imports.join("\n")).not.toContain("ActiveContext");
  });
});
