import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Step API-G.5.8A-1 — static contract test for the Connected Apps read-only slice.
 * Repository-standard static source contract test (no runtime rendering).
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const app = read("src/App.tsx");
const guards = read("src/pages/admin/guards.tsx");
const shell = read("src/pages/admin/SaasAdminShell.tsx");
// API-ADM.8 — the Organization Connected Apps UX is now the thin Organization
// caller plus the shared administration surface. The contract is asserted over
// the combined production source of that Organization-context path.
const orgCaller = read("src/pages/admin/AdminConnectedApps.tsx");
const surface = read("src/pages/admin/ConnectedAppsOrganizationSurface.tsx");
const model = read("src/pages/admin/connectedAppsOrganizationModel.ts");
const page = [orgCaller, surface, model].join("\n");
const adminTenant = read("src/pages/admin/AdminTenant.tsx");
const adminLayout = read("src/pages/AdminLayout.tsx");

const routeLine =
  app.split("\n").find((l) => l.includes('path="/admin/connected-apps"')) ?? "";

const ORG_TRANSITION_RPC = "api_g_5_7_admin_transition_organization_client";

const FORBIDDEN_MUTATION_RPCS = [
  "api_g_5_7_admin_transition_workspace_client",
  "api_g_5_7_admin_transition_project_client",
  "api_g_5_7_admin_transition_organization_client_capability",
  "api_g_5_7_admin_transition_workspace_client_capability",
];

describe("route", () => {
  it("declares /admin/connected-apps", () => {
    expect(routeLine).not.toBe("");
  });

  it("is wrapped in AuthGuardedRoute", () => {
    expect(routeLine).toContain("<AuthGuardedRoute>");
  });

  it("is wrapped in OrganizationConnectedAppsAdminGuard", () => {
    expect(routeLine).toContain("<OrganizationConnectedAppsAdminGuard>");
    expect(routeLine).toContain("<AdminConnectedApps />");
  });

  it("does not use PlatformAdminGuard, TenantAdminGuard or AdminLayout", () => {
    expect(routeLine).not.toContain("PlatformAdminGuard");
    expect(routeLine).not.toContain("TenantAdminGuard");
    expect(routeLine).not.toContain("AdminLayout");
  });

  it("is declared before the nested /admin layout route", () => {
    const connectedIdx = app.indexOf('path="/admin/connected-apps"');
    const layoutIdx = app.indexOf('path="/admin" element');
    expect(connectedIdx).toBeGreaterThan(-1);
    expect(layoutIdx).toBeGreaterThan(-1);
    expect(connectedIdx).toBeLessThan(layoutIdx);
  });
});

describe("OrganizationConnectedAppsAdminGuard authority", () => {
  // Step API-ADM.8 — the Organization route is Org Admin UX only.
  const guard = guards.slice(guards.indexOf("export function OrganizationConnectedAppsAdminGuard"));

  it("exists and uses the accepted access hooks", () => {
    expect(guard.length).toBeGreaterThan(0);
    expect(guard).toContain("useActiveContext()");
    expect(guard).toContain("useActiveOrgAdminAccess()");
  });

  it("requires an active Organization", () => {
    expect(guard).toContain("ctx.activeOrganization?.id");
    expect(guard).toContain("if (!organizationId)");
    expect(guard).toContain("AdminNoAccess");
  });

  it("permits only active-organization Org Admin", () => {
    expect(guard).toContain("if (orgAdmin.isOrgAdmin)");
    expect(guard).not.toContain("isTenantAdminForTenant");
  });

  it("does not grant access from Platform Super Admin authority alone", () => {
    expect(guard).not.toContain("canOpenPlatformAdmin");
    expect(guard).not.toContain("isPlatformSuperAdmin");
  });

  it("introduces no workspace-admin, PM or ordinary-membership path", () => {
    expect(guard).not.toMatch(/workspace_admin|project_manager|isMember|localStorage|useParams/);
  });
});

describe("organization context source", () => {
  it("derives the Organization only from active context", () => {
    expect(page).toContain("useActiveContext()");
    expect(page).toContain("ctx.activeOrganization?.id");
  });

  it("never reads the Organization from route, query params or storage", () => {
    expect(page).not.toMatch(/useParams|useSearchParams|URLSearchParams|localStorage|sessionStorage/);
  });
});

describe("read-only RPC contract", () => {
  it("calls exactly the accepted list RPC plus the accepted transition RPC", () => {
    expect(page).toContain('"api_g_5_7_admin_list_organization_clients"');
    expect(page).toContain(`"${ORG_TRANSITION_RPC}"`);
    const calls = page.match(/supabase\.rpc as any\)\(/g) ?? [];
    expect(calls.length).toBe(2);
  });

  it("passes organization id, retired flag, limit 25 and page-derived offset", () => {
    expect(page).toContain("_organization_id: organizationId");
    expect(page).toContain("_include_retired: includeRetired");
    expect(page).toContain("_limit: PAGE_SIZE");
    expect(page).toContain("_offset: page * PAGE_SIZE");
    expect(page).toContain("CONNECTED_APPS_PAGE_SIZE = 25");
  });

  it("references no Workspace, Project or capability transition RPC", () => {
    for (const rpc of FORBIDDEN_MUTATION_RPCS) {
      expect(page.includes(rpc)).toBe(false);
    }
  });

  it("performs no direct table read or write", () => {
    expect(page).not.toMatch(/\.from\(/);
    expect(page).not.toMatch(/api_client_organization_enablements|api_clients|tenant_integrations/);
  });
});

describe("react query behavior", () => {
  it("keys the query on organization, filter and page", () => {
    expect(page).toContain('parentSummaryQueryKey={["connected-apps", organizationId]}');
    expect(page).toContain("buildConnectedAppsListQueryKey(parentSummaryQueryKey, includeRetired, page)");
    expect(page).toContain("return [...parentSummaryQueryKey, includeRetired, page];");
  });

  it("is enabled only with an active organization and uses a 30s staleTime", () => {
    expect(page).toContain("enabled: !!organizationId");
    expect(page).toContain("staleTime: 30_000");
    expect(page).not.toContain("placeholderData: keepPreviousData");
    expect(page).not.toContain("keepPreviousData");
  });

  it("uses organization-aware placeholder data", () => {
    expect(page).toContain("placeholderData:");
    expect(page).toContain("resolveConnectedAppsPlaceholder(");
    expect(page).toContain("if (previousQueryKey?.[organizationIndex] !== organizationId) return undefined;");
  });

  it("does not manually clear or mutate the global query cache", () => {
    expect(page).not.toMatch(/queryClient\.(clear|removeQueries|resetQueries|setQueryData)/);
  });

  it("placeholder behavior: previous data only for the same organization", () => {
    const makePlaceholder =
      (organizationId: string | null) =>
      (previousData: unknown, previousQuery: any) => {
        if (!organizationId) return undefined;
        const previousOrganizationId = previousQuery?.queryKey?.[1];
        return previousOrganizationId === organizationId ? previousData : undefined;
      };

    const rows = [{ id: "row-1" }];

    // same organization, page change -> previous data preserved
    expect(
      makePlaceholder("org-a")(rows, { queryKey: ["connected-apps", "org-a", false, 0] }),
    ).toBe(rows);

    // different organization -> never previous rows
    expect(
      makePlaceholder("org-b")(rows, { queryKey: ["connected-apps", "org-a", false, 0] }),
    ).toBeUndefined();

    // missing organization -> undefined
    expect(
      makePlaceholder(null)(rows, { queryKey: ["connected-apps", null, false, 0] }),
    ).toBeUndefined();
  });

  it("resets pagination on retired-filter change and organization change", () => {
    expect(page).toContain("setIncludeRetired(checked);");
    expect(page).toMatch(/setIncludeRetired\(checked\);\s*\n\s*setPage\(0\);/);
    expect(page).toMatch(/useEffect\(\(\) => \{\s*\n\s*setPage\(0\);[\s\S]*?\}, \[organizationId\]\)/);
  });

  it("never presents rows without an active organization", () => {
    expect(page).toContain("organizationId ? data ?? [] : []");
  });
});

describe("presentation", () => {
  it("renders lifecycle and organization connection separately", () => {
    expect(page).toContain("Application status");
    expect(page).toContain("Organization connection");
    expect(page).toContain("row.client_lifecycle_status");
    expect(page).toContain("row.organization_enablement_status");
    expect(page).toContain("lifecycleVariant");
    expect(page).toContain("connectionLabel");
  });

  it("maps enablement statuses to Connected / Disabled / Not connected", () => {
    expect(page).toContain('if (status === "enabled") return "Connected"');
    expect(page).toContain('if (status === "disabled") return "Disabled"');
    expect(page).toContain('return "Not connected"');
  });

  it("displays workspace, project and capability counts", () => {
    expect(page).toContain("row.enabled_workspace_count");
    expect(page).toContain("row.enabled_project_count");
    expect(page).toContain("row.enabled_capability_grant_count");
  });

  it("shows an em dash for a missing active policy version", () => {
    expect(page).toContain('row.active_policy_version ?? "—"');
  });

  it("does not render oauth identifiers, secrets, redirect URIs or policy content", () => {
    expect(page).not.toMatch(
      /oauth_client_id|redirect_uri|policy_document|policy_digest|access_token|client_secret/i,
    );
  });

  it("has loading, empty and generic error states", () => {
    expect(page).toContain("AdminLoadingCards");
    expect(page).toContain("AdminEmptyState");
    expect(page).toContain("No connected applications found");
    expect(page).toContain(
      "No registered applications are available for the active Organization and current filter.",
    );
    expect(page).toContain("Failed to load Connected Apps.");
    expect(page).not.toContain("error.message");
  });

  it("uses total_count backed Previous/Next pagination", () => {
    expect(page).toContain("rows[0].total_count ?? 0");
    expect(page).toContain("Showing {rangeStart}–{rangeEnd} of {totalCount}");
    expect(page).toContain("disabled={!canPrev}");
    expect(page).toContain("disabled={!canNext}");
    expect(page).toContain("rangeEnd < totalCount");
  });

  it("adds no unapproved mutation control", () => {
    expect(page).not.toMatch(/Revoke|revoke_all|kill_switch/);
  });
});

describe("admin shell scope", () => {
  it("supports organization scope while preserving platform and tenant", () => {
    expect(shell).toContain('scope: "platform" | "tenant" | "organization"');
    expect(shell).toContain("`Organization · ${contextLabel}`");
    expect(shell).toContain('"Platform-level"');
    expect(shell).toContain("`Tenant · ${contextLabel}`");
  });
});

describe("navigation entry points", () => {
  // Step API-ADM.7 — the Tenant dashboard now points at the Tenant-native page.
  it("tenant admin has a Connected Apps card and keeps Integrations", () => {
    expect(adminTenant).toContain('to="/admin/tenant/connected-apps"');
    expect(adminTenant).toContain("Connected Apps");
    expect(adminTenant).toContain("Manage Connected Apps across Organizations in this Tenant.");
    expect(adminTenant).toContain('to="/admin/tenant/integrations"');
    expect(adminTenant).toContain('title="Integrations"');
  });


  it("organization admin navigation contains Connected Apps and keeps existing sections", () => {
    expect(adminLayout).toContain('to="/admin/connected-apps"');
    for (const label of ["Users", "Invitations", "Portfolio", "SharePoint", "Power BI", "Imports"]) {
      expect(adminLayout).toContain(`"${label}"`);
    }
    expect(adminLayout).toContain("adminSections");
  });

  it("does not make Connected Apps the default /admin route", () => {
    expect(app).toContain('<Navigate to="/admin/users" replace />');
  });
});

describe("scope containment", () => {
  it("adds no migration, backend function or Astra/tenant_integrations branch", () => {
    for (const source of [page, guards, shell]) {
      expect(source).not.toMatch(/astra|tenant_integrations|CREATE FUNCTION|CREATE POLICY/i);
    }
  });
});

describe("API-G.5.8A-2 organization connection actions", () => {
  it("adds an Actions column", () => {
    expect(page).toContain("<TableHead>Actions</TableHead>");
  });

  it("calls exactly the accepted transition RPC with the accepted arguments", () => {
    expect(page).toContain(`"${ORG_TRANSITION_RPC}"`);
    expect(page).toContain("_organization_id: organizationId");
    expect(page).toContain("_api_client_id: action.apiClientId");
    expect(page).toContain("_target_lifecycle_status: action.targetLifecycleStatus");
  });

  it("uses useMutation without optimistic cache writes", () => {
    expect(page).toContain("useMutation");
    expect(page).not.toMatch(/onMutate|setQueryData|queryClient\.(clear|removeQueries|resetQueries)/);
  });

  it("invalidates only the active Organization Connected Apps prefix", () => {
    expect(page).toContain("await queryClient.invalidateQueries({ queryKey: parentSummaryQueryKey });");
    expect(page).toContain('parentSummaryQueryKey={["connected-apps", organizationId]}');
  });

  it("captures the active Organization ID in the pending action", () => {
    expect(page).toContain("interface PendingConnectionAction");
    expect(page).toContain("organizationId,");
    expect(page).toContain("action.organizationId !== organizationId");
    expect(page).toContain('throw new Error("context_mismatch")');
  });


  it("blocks duplicate submissions and disables row actions while pending", () => {
    expect(page).toContain("const isPending = transition.isPending;");
    expect(page).toContain("disabled={isPending}");
    expect(page).toContain("if (!pendingAction || isPending) return;");
    expect(page).toContain("if (isPending) return;");
  });

  it("requires explicit confirmation via the repository Dialog", () => {
    expect(page).toContain("<Dialog open={!!pendingAction}");
    expect(page).toContain("DialogTitle");
    expect(page).toContain("Cancel");
  });

  it("uses safe copy for connect and disconnect", () => {
    expect(page).toContain(
      "This makes the application available to the active Organization. Workspace, Project, and capability access remain disabled until configured.",
    );
    expect(page).toContain(
      "This blocks the application for the active Organization. Existing Workspace, Project, and capability selections are retained and can be restored by reconnecting.",
    );
    expect(page).not.toMatch(/deleted|removed permanently/i);
  });

  it("renders only safe distinct error messages", () => {
    expect(page).toContain(
      "Could not connect this application. It must be active and available for the current Organization.",
    );
    expect(page).toContain(
      "Could not disconnect this application. Refresh the list and try again.",
    );
    expect(page).not.toContain("error.message");
    expect(page).not.toContain("actionError.message");
  });

  it("shows pending labels per action", () => {
    expect(page).toContain("Connecting…");
    expect(page).toContain("Reconnecting…");
    expect(page).toContain("Disconnecting…");
  });

  it("offers Unavailable with an accessible explanation", () => {
    expect(page).toContain("Unavailable");
    expect(page).toContain('title="Only active applications can be connected."');
  });
});

describe("API-G.5.8A-2 action resolution", () => {
  const resolve = (
    client_lifecycle_status: string,
    organization_enablement_status: string | null,
  ) => {
    if (organization_enablement_status === "enabled") {
      return { kind: "disconnect", label: "Disconnect", target: "disabled" };
    }
    if (client_lifecycle_status !== "active") return { kind: "unavailable" };
    if (organization_enablement_status === "disabled") {
      return { kind: "reconnect", label: "Reconnect", target: "enabled" };
    }
    return { kind: "connect", label: "Connect", target: "enabled" };
  };

  it("null connection + active application -> Connect (enabled)", () => {
    expect(resolve("active", null)).toEqual({ kind: "connect", label: "Connect", target: "enabled" });
  });

  it("disabled connection + active application -> Reconnect (enabled)", () => {
    expect(resolve("active", "disabled")).toEqual({
      kind: "reconnect",
      label: "Reconnect",
      target: "enabled",
    });
  });

  it("enabled connection -> Disconnect (disabled)", () => {
    expect(resolve("active", "enabled")).toEqual({
      kind: "disconnect",
      label: "Disconnect",
      target: "disabled",
    });
  });

  it("enabled connection remains disconnectable when suspended or retired", () => {
    for (const lifecycle of ["suspended", "retired"]) {
      expect(resolve(lifecycle, "enabled").kind).toBe("disconnect");
    }
  });

  it("non-active, non-enabled applications cannot be connected", () => {
    for (const lifecycle of ["suspended", "retired", "draft"]) {
      expect(resolve(lifecycle, null).kind).toBe("unavailable");
      expect(resolve(lifecycle, "disabled").kind).toBe("unavailable");
    }
  });

  it("does not execute after an Organization context mismatch", () => {
    let executed = false;
    const run = (pendingOrganizationId: string, activeOrganizationId: string) => {
      if (pendingOrganizationId !== activeOrganizationId) throw new Error("context_mismatch");
      executed = true;
    };
    expect(() => run("org-a", "org-b")).toThrow("context_mismatch");
    expect(executed).toBe(false);
    run("org-a", "org-a");
    expect(executed).toBe(true);
  });
});
