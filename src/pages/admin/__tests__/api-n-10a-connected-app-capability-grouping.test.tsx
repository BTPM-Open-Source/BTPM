/**
 * Step API-N.10A — shared capability grouping + Connected App capability
 * visibility (presentation only).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  API_CAPABILITY_DOMAINS,
  getCapabilityDomain,
  groupCapabilitiesByDomain,
} from "../apiCapabilityDomains";
import ConnectedAppOrganizationPermissions from "../ConnectedAppOrganizationPermissions";
import ConnectedAppWorkspacePermissions from "../ConnectedAppWorkspacePermissions";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const WS = "44444444-4444-4444-8444-444444444444";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

function src(file: string) {
  return readFileSync(resolve(process.cwd(), `src/pages/admin/${file}`), "utf8");
}

function orgRow(key: string, extra: Record<string, unknown> = {}) {
  return {
    api_version: "v1",
    capability_kind: "read",
    capability_key: key,
    display_name: `Display ${key}`,
    description: null,
    scope_level: "organization",
    catalogue_lifecycle_status: "active",
    administrator_assignable: true,
    supported_capability_id: `sc-${key}`,
    supported_capability_status: "enabled",
    grant_id: null,
    grant_status: null,
    grant_enabled_at: null,
    grant_disabled_at: null,
    total_count: 1,
    ...extra,
  };
}

function wsRow(key: string, extra: Record<string, unknown> = {}) {
  return {
    ...orgRow(key),
    scope_level: "workspace",
    organization_grant_id: null,
    organization_grant_status: null,
    organization_grant_enabled_at: null,
    organization_grant_disabled_at: null,
    workspace_grant_id: null,
    workspace_grant_status: null,
    workspace_grant_enabled_at: null,
    workspace_grant_disabled_at: null,
    effective_grant_status: null,
    effective_grant_source: null,
    ...extra,
  };
}

function renderWithQuery(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

beforeEach(() => rpc.mockReset());
afterEach(() => cleanup());

describe("API-N.10A — shared grouping contract", () => {
  it("declares exactly nine canonical groups in order", () => {
    expect(API_CAPABILITY_DOMAINS.map((d) => d.id)).toEqual([
      "directory",
      "portfolios",
      "programs",
      "projects_planning",
      "execution_updates",
      "kpis",
      "risks",
      "blockers",
      "other",
    ]);
    expect(API_CAPABILITY_DOMAINS.map((d) => d.label)).toEqual([
      "Directory & access",
      "Portfolios",
      "Programs",
      "Projects & planning",
      "Execution updates",
      "KPIs",
      "Risks",
      "Blockers",
      "Other",
    ]);
  });

  it("maps every canonical prefix", () => {
    expect(getCapabilityDomain("organizations:list")).toBe("directory");
    expect(getCapabilityDomain("workspaces:list")).toBe("directory");
    expect(getCapabilityDomain("programs:create")).toBe("programs");
    expect(getCapabilityDomain("programs:update")).toBe("programs");
    expect(getCapabilityDomain("projects:list")).toBe("projects_planning");
    expect(getCapabilityDomain("planning:read")).toBe("projects_planning");
    expect(getCapabilityDomain("phases:update")).toBe("projects_planning");
    expect(getCapabilityDomain("tasks:create")).toBe("projects_planning");
    expect(getCapabilityDomain("execution_updates:append")).toBe("execution_updates");
    expect(getCapabilityDomain("kpis:read")).toBe("kpis");
    expect(getCapabilityDomain("kpis:append_update")).toBe("kpis");
    expect(getCapabilityDomain("risks:create")).toBe("risks");
    expect(getCapabilityDomain("blockers:resolve")).toBe("blockers");
  });

  it("routes unknown prefixes to Other without dropping them", () => {
    expect(getCapabilityDomain("future_thing:do")).toBe("other");
    expect(getCapabilityDomain("unmapped_whatever:read")).toBe("other");
    const groups = groupCapabilitiesByDomain([{ capability_key: "future_thing:do" }]);
    expect(groups.map((g) => g.domain.id)).toEqual(["other"]);
  });

  it("is consumed by Platform, Organization and Workspace surfaces", () => {
    for (const file of [
      "AdminPlatformApiClientDetail.tsx",
      "ConnectedAppOrganizationPermissions.tsx",
      "ConnectedAppWorkspacePermissions.tsx",
    ]) {
      const code = src(file);
      expect(code).toContain('from "./apiCapabilityDomains"');
      expect(code).toContain("groupCapabilitiesByDomain(");
    }
  });
});

describe("API-N.10A — Organization permissions visibility", () => {
  it("groups rows and shows Workspace/Project scoped rows without an Organization grant action", async () => {
    rpc.mockResolvedValue({
      data: [
        orgRow("organizations:read", { total_count: 5 }),
        orgRow("workspaces:list", { scope_level: "workspace", total_count: 5 }),
        orgRow("tasks:create", {
          scope_level: "project",
          capability_kind: "command",
          total_count: 5,
        }),
        orgRow("kpis:read", { scope_level: "project", total_count: 5 }),
        orgRow("future_thing:do", { scope_level: "weird", total_count: 5 }),
      ],
      error: null,
    });
    renderWithQuery(
      <ConnectedAppOrganizationPermissions
        organizationId={ORG}
        apiClientId={CLIENT}
        clientLifecycleStatus="active"
        organizationEnablementStatus="enabled"
      />,
    );
    await waitFor(() => expect(screen.getByText("Display organizations:read")).toBeTruthy());

    // API-ADM-UX1 — only Organization-scoped capabilities are grouped as actionable.
    expect(
      screen.getAllByTestId("org-cap-domain-heading").map((h) => h.textContent),
    ).toEqual(["Directory & access"]);

    // Only the Organization-scoped row exposes a grant action.
    expect(screen.getAllByRole("button", { name: "Enable" })).toHaveLength(1);

    // Everything else moves into the read-only lower-scope reference section.
    expect(screen.getByTestId("org-cap-lower-scope-section")).toBeTruthy();
    expect(
      screen.getByText(
        "These capabilities are managed in Workspace permissions. Project-scoped capabilities remain limited to Projects where the application has Project access.",
      ),
    ).toBeTruthy();
    // API-ADM-UX2.3 — Workspace- and Project-scoped rows are both managed in
    // Workspace permissions; "Managed at Project" no longer exists.
    expect(screen.getAllByText("Managed at Workspace")).toHaveLength(3);
    expect(screen.queryByText("Managed at Project")).toBeNull();
    expect(screen.getByText("Managed at another scope")).toBeTruthy();
    expect(
      screen.getAllByTestId("org-cap-scope-badge").map((b) => b.textContent),
    ).toEqual(["Workspace", "Project", "Project", "Other scope"]);
  });

  it("keeps the Organization transition RPC as the only mutation", async () => {
    rpc.mockResolvedValue({ data: [orgRow("organizations:read")], error: null });
    renderWithQuery(
      <ConnectedAppOrganizationPermissions
        organizationId={ORG}
        apiClientId={CLIENT}
        clientLifecycleStatus="active"
        organizationEnablementStatus="enabled"
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
    rpc.mockResolvedValue({ data: null, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() =>
      expect(
        rpc.mock.calls.some(
          (c) => c[0] === "api_g_5_7_admin_transition_organization_client_capability",
        ),
      ).toBe(true),
    );
    const names = new Set(rpc.mock.calls.map((c) => c[0]));
    expect([...names].sort()).toEqual([
      "api_g_5_7_admin_list_organization_client_capabilities",
      "api_g_5_7_admin_transition_organization_client_capability",
    ]);
  });
});

describe("API-N.10A — Workspace permissions grouping", () => {
  it("groups rows and preserves the Workspace grant action", async () => {
    rpc.mockResolvedValue({
      data: [wsRow("risks:create", { total_count: 2 }), wsRow("kpis:read", { total_count: 2 })],
      error: null,
    });
    renderWithQuery(
      <ConnectedAppWorkspacePermissions
        organizationId={ORG}
        apiClientId={CLIENT}
        workspaceId={WS}
        workspaceName="Delivery"
        clientLifecycleStatus="active"
        organizationEnablementStatus="enabled"
        workspaceEnablementStatus="enabled"
        workspaceIsArchived={false}
      />,
    );
    await waitFor(() => expect(screen.getByText("Display risks:create")).toBeTruthy());
    expect(
      screen.getAllByTestId("ws-cap-domain-heading").map((h) => h.textContent),
    ).toEqual(["KPIs", "Risks"]);
    expect(screen.getAllByRole("button", { name: "Enable" }).length).toBeGreaterThan(0);
  });
});
