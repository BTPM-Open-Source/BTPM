/**
 * API-ADM-UX1 — Connected Apps administration scope-clarity UX correction.
 *
 * Frontend-only contract checks: Tenant surfaces expose Organization connection
 * work only, Organization/Workspace permission screens separate what they can
 * actually grant from read-only reference scopes, and the bounded capability
 * catalogue is fetched in a single request.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ORGANIZATION_CAPABILITY_PAGE_SIZE,
  lowerScopeBadgeLabel,
  lowerScopeManagedAtLabel,
  partitionOrganizationCapabilityRows,
} from "../connectedAppOrganizationPermissionsModel";
import {
  WORKSPACE_CAPABILITY_PAGE_SIZE,
  inheritedOrganizationStateLabel,
  partitionWorkspaceCapabilityRows,
  workspaceLowerScopeManagedAtLabel,
} from "../connectedAppWorkspacePermissionsModel";
import {
  CONNECTED_APP_MANAGEMENT_TABS,
  connectedAppManagementTabsForContext,
  resolveConnectedAppManagementTab,
} from "../ConnectedAppManagementView";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const SURFACE = read("src/pages/admin/ConnectedAppsOrganizationSurface.tsx");
const SHELL = read("src/pages/admin/ConnectedAppManagementView.tsx");
const ORG_PERMS = read("src/pages/admin/ConnectedAppOrganizationPermissions.tsx");
const WS_PERMS = read("src/pages/admin/ConnectedAppWorkspacePermissions.tsx");

describe("UX1 A — Tenant list shows connection work only", () => {
  it("hides Access and Permissions columns in Tenant context", () => {
    expect(SURFACE).toContain("{!isTenantContext && <TableHead>Access</TableHead>}");
    expect(SURFACE).toContain("{!isTenantContext && <TableHead>Permissions</TableHead>}");
  });

  it("offers Disconnect directly in the Tenant list", () => {
    expect(SURFACE).toContain('openAction(row, "disabled")');
    expect(SURFACE).toContain("View details");
  });
});

describe("UX1 B — Tenant detail", () => {
  it("removes the Access & permissions tab for Tenant administration", () => {
    expect(connectedAppManagementTabsForContext("organization")).toEqual(
      CONNECTED_APP_MANAGEMENT_TABS,
    );
    expect(connectedAppManagementTabsForContext("tenant").map((t) => t.value)).toEqual([
      "overview",
      "activity",
    ]);
    expect(resolveConnectedAppManagementTab("access", "tenant")).toBe("overview");
    expect(resolveConnectedAppManagementTab("access", "organization")).toBe("access");
    expect(resolveConnectedAppManagementTab("nope")).toBe("overview");
  });

  it("hides Workspace / Project / permission counts in Tenant Overview", () => {
    expect(SHELL).toContain('{!isTenantContext && <SummaryRow label="Workspaces enabled"');
    expect(SHELL).toContain('{!isTenantContext && <SummaryRow label="Projects enabled"');
    expect(SHELL).toContain('<SummaryRow label="Enabled permissions" value={permissions} />');
    expect(SHELL).toContain("{!isTenantContext && (");
    expect(SHELL).toContain("administered by the Organization");
  });
});

describe("UX1 C — Organization permissions scope clarity", () => {
  it("partitions by the backend-provided scope_level", () => {
    const rows = [
      { scope_level: "organization" },
      { scope_level: "workspace" },
      { scope_level: "project" },
      { scope_level: "weird" },
    ] as any;
    const { managed, lowerScope } = partitionOrganizationCapabilityRows(rows);
    expect(managed).toHaveLength(1);
    expect(lowerScope).toHaveLength(3);
  });

  it("labels lower-scope rows explicitly and never as a grant state", () => {
    expect(lowerScopeBadgeLabel("workspace")).toBe("Workspace");
    expect(lowerScopeBadgeLabel("project")).toBe("Project");
    expect(lowerScopeBadgeLabel("weird")).toBe("Other scope");
    expect(lowerScopeManagedAtLabel("workspace")).toBe("Managed at Workspace");
    // API-ADM-UX2.3 supersedes the former "Managed at Project" wording.
    expect(lowerScopeManagedAtLabel("project")).toBe("Managed at Workspace");
    expect(lowerScopeManagedAtLabel(null)).toBe("Managed at another scope");
  });

  it("only actionable rows are grouped by business domain", () => {
    expect(ORG_PERMS).toContain("groupCapabilitiesByDomain(managedRows)");
    expect(ORG_PERMS).toContain('data-testid="org-cap-lower-scope-section"');
  });
});

describe("UX1 D — Workspace permissions inheritance clarity", () => {
  it("separates direct (Workspace + Project), inherited and unknown scopes", () => {
    // API-ADM-UX2.3 — Project-scoped capabilities are administered here.
    const rows = [
      { scope_level: "workspace" },
      { scope_level: "organization" },
      { scope_level: "project" },
      { scope_level: "weird" },
    ] as any;
    const { direct, inherited, lowerScope } = partitionWorkspaceCapabilityRows(rows);
    expect(direct).toHaveLength(2);
    expect(inherited).toHaveLength(1);
    expect(lowerScope).toHaveLength(1);
  });

  it("inherited rows read as Organization state, not Workspace grant state", () => {
    expect(inheritedOrganizationStateLabel("enabled")).toBe("Enabled by Organization");
    expect(inheritedOrganizationStateLabel("disabled")).toBe("Disabled by Organization");
    expect(inheritedOrganizationStateLabel(null)).toBe("Not enabled by Organization");
    expect(workspaceLowerScopeManagedAtLabel("weird")).toBe("Managed at another scope");
    expect(WS_PERMS).toContain('data-testid="ws-cap-inherited-section"');
    expect(WS_PERMS).toContain("groupCapabilitiesByDomain(directRows)");
  });

  it("effective permission stays backend-provided", () => {
    expect(WS_PERMS).toContain("effectiveAccessLabel(");
    expect(WS_PERMS).toContain("effectiveSourceLabel(");
    expect(WS_PERMS).not.toMatch(/organization_grant_status\s*===\s*"enabled"/);
  });
});

describe("UX1 E — bounded single-request capability catalogue", () => {
  it("requests the full bounded set once, without frontend paging", () => {
    expect(ORGANIZATION_CAPABILITY_PAGE_SIZE).toBe(200);
    expect(WORKSPACE_CAPABILITY_PAGE_SIZE).toBe(200);
    for (const src of [ORG_PERMS, WS_PERMS]) {
      expect(src).toContain("_offset: 0,");
      expect(src).not.toContain("setPage");
      expect(src).not.toContain("Previous");
      expect(src).not.toContain("Next");
    }
  });

  it("no new backend surface is referenced", () => {
    expect(ORG_PERMS).toContain('"api_g_5_7_admin_list_organization_client_capabilities"');
    expect(ORG_PERMS).toContain('"api_g_5_7_admin_transition_organization_client_capability"');
    expect(WS_PERMS).toContain('"api_g_5_7_admin_list_workspace_client_capabilities"');
    expect(WS_PERMS).toContain('"api_g_5_7_admin_transition_workspace_client_capability"');
    expect(ORG_PERMS).not.toContain("supabase.from(");
    expect(WS_PERMS).not.toContain("supabase.from(");
  });
});
