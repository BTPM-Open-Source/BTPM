/**
 * Step API-ADM.5B — focused behavior + containment tests for unified Workspace
 * access and Workspace permission administration.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ConnectedAppWorkspaceAccess from "../ConnectedAppWorkspaceAccess";
import ConnectedAppWorkspacePermissions from "../ConnectedAppWorkspacePermissions";
import { resolveWorkspaceRowAction } from "../connectedAppWorkspaceAccessModel";
import { resolveWorkspaceCapabilityRowAction } from "../connectedAppWorkspacePermissionsModel";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const WORKSPACE = "44444444-4444-4444-8444-444444444444";

const WS_LIST_RPC = "api_g_5_7_admin_list_organization_client_workspaces";
const WS_TRANSITION_RPC = "api_g_5_7_admin_transition_workspace_client";
const CAP_LIST_RPC = "api_g_5_7_admin_list_workspace_client_capabilities";
const CAP_TRANSITION_RPC = "api_g_5_7_admin_transition_workspace_client_capability";

const ACCESS_SOURCE = readFileSync(
  resolve(__dirname, "../ConnectedAppWorkspaceAccess.tsx"),
  "utf8",
);
const PERMISSIONS_SOURCE = readFileSync(
  resolve(__dirname, "../ConnectedAppWorkspacePermissions.tsx"),
  "utf8",
);
const SHELL_SOURCE = readFileSync(
  resolve(__dirname, "../ConnectedAppManagementView.tsx"),
  "utf8",
);

function wsRow(overrides: Record<string, unknown> = {}) {
  return {
    workspace_id: WORKSPACE,
    workspace_name: "Test",
    workspace_is_archived: false,
    workspace_enablement_id: null,
    workspace_enablement_status: "enabled",
    workspace_enabled_at: null,
    workspace_disabled_at: null,
    enabled_project_count: 1,
    enabled_capability_grant_count: 6,
    total_count: 1,
    ...overrides,
  };
}

function capRow(overrides: Record<string, unknown> = {}) {
  return {
    api_version: "v1",
    capability_kind: "read",
    capability_key: "workspaces.read",
    display_name: "Read Workspaces",
    description: "Read Workspace metadata.",
    scope_level: "workspace",
    catalogue_lifecycle_status: "active",
    administrator_assignable: true,
    supported_capability_id: "sc-1",
    supported_capability_status: "enabled",
    organization_grant_id: null,
    organization_grant_status: "enabled",
    organization_grant_enabled_at: null,
    organization_grant_disabled_at: null,
    workspace_grant_id: null,
    workspace_grant_status: null,
    workspace_grant_enabled_at: null,
    workspace_grant_disabled_at: null,
    effective_grant_status: "enabled",
    effective_grant_source: "organization",
    total_count: 1,
    ...overrides,
  };
}

function renderAccess(overrides: Record<string, unknown> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <ConnectedAppWorkspaceAccess
        organizationId={ORG}
        apiClientId={CLIENT}
        clientLifecycleStatus="active"
        organizationEnablementStatus="enabled"
        {...(overrides as any)}
      />
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

function renderPermissions(overrides: Record<string, unknown> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <ConnectedAppWorkspacePermissions
        organizationId={ORG}
        apiClientId={CLIENT}
        workspaceId={WORKSPACE}
        workspaceName="Test"
        clientLifecycleStatus="active"
        organizationEnablementStatus="enabled"
        workspaceEnablementStatus="enabled"
        workspaceIsArchived={false}
        {...(overrides as any)}
      />
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

beforeEach(() => {
  rpc.mockReset();
  cleanup();
});

describe("API-ADM.5B Workspace access", () => {
  it("reads exactly the accepted Workspace list RPC with explicit context", async () => {
    rpc.mockResolvedValue({ data: [wsRow()], error: null });
    renderAccess();
    await waitFor(() => expect(screen.getByText("Test")).toBeInTheDocument());
    expect(rpc).toHaveBeenCalledWith(WS_LIST_RPC, {
      _organization_id: ORG,
      _api_client_id: CLIENT,
      _include_archived: false,
      _limit: 25,
      _offset: 0,
    });
  });

  it("shows access, Project count and permission count", async () => {
    rpc.mockResolvedValue({ data: [wsRow()], error: null });
    renderAccess();
    await waitFor(() => expect(screen.getByText("Enabled")).toBeInTheDocument());
    expect(screen.getByText("1 Project")).toBeInTheDocument();
    expect(screen.getByText("6 permissions")).toBeInTheDocument();
    expect(screen.queryByText(WORKSPACE)).not.toBeInTheDocument();
  });

  it("transitions with exactly the accepted Workspace transition RPC and invalidates the scoped list", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === WS_LIST_RPC) return Promise.resolve({ data: [wsRow()], error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const { invalidateSpy } = renderAccess();
    await waitFor(() => expect(screen.getByRole("button", { name: "Disable" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(screen.getByText("Disable Test?")).toBeInTheDocument());
    const confirm = screen
      .getAllByRole("button", { name: "Disable" })
      .find((b) => b.closest("[role='alertdialog']"))!;
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(WS_TRANSITION_RPC, {
        _organization_id: ORG,
        _workspace_id: WORKSPACE,
        _api_client_id: CLIENT,
        _target_lifecycle_status: "disabled",
      }),
    );
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["connected-app-workspace-access", ORG, CLIENT],
      }),
    );
  });

  it("fails closed for archived and Organization-disabled states", async () => {
    rpc.mockResolvedValue({
      data: [wsRow({ workspace_enablement_status: null, workspace_is_archived: true })],
      error: null,
    });
    renderAccess();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Unavailable" })).toBeDisabled(),
    );
    expect(screen.getByText("Archived Workspaces cannot be enabled.")).toBeInTheDocument();
  });

  it("preserves the accepted resolveWorkspaceRowAction semantics", () => {
    expect(resolveWorkspaceRowAction("enabled", null, false).kind).toBe("disable");
    expect(resolveWorkspaceRowAction("disabled", "enabled", false).kind).toBe("reenable");
    expect(resolveWorkspaceRowAction(null, "enabled", false).kind).toBe("enable");
    expect(resolveWorkspaceRowAction(null, null, false).kind).toBe("unavailable");
    expect(resolveWorkspaceRowAction("weird", "enabled", false).kind).toBe("unavailable");
    expect(ACCESS_SOURCE).toContain("resolveWorkspaceRowAction(");
  });

  it("captures Workspace identity only from authorized rows", () => {
    expect(ACCESS_SOURCE).toContain("workspaceId: row.workspace_id");
    expect(ACCESS_SOURCE).not.toMatch(/<Input/);
    expect(ACCESS_SOURCE).not.toContain("placeholderData");
  });

  it("Manage opens the selected Workspace context in a Sheet", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === WS_LIST_RPC) return Promise.resolve({ data: [wsRow()], error: null });
      return Promise.resolve({ data: [capRow()], error: null });
    });
    renderAccess();
    await waitFor(() => expect(screen.getByRole("button", { name: "Manage" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    await waitFor(() =>
      expect(screen.getByText("Workspace access & permissions")).toBeInTheDocument(),
    );
    expect(screen.getByText("Project access")).toBeInTheDocument();
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(CAP_LIST_RPC, {
        _organization_id: ORG,
        _workspace_id: WORKSPACE,
        _api_client_id: CLIENT,
        _limit: 200,
        _offset: 0,
      }),
    );
    expect(ACCESS_SOURCE).toContain("<Sheet");
  });
});

describe("API-ADM.5B Workspace permissions", () => {
  it("uses exactly the accepted capability list RPC with contained identity", async () => {
    rpc.mockResolvedValue({ data: [capRow()], error: null });
    renderPermissions();
    await waitFor(() => expect(screen.getByText("Read Workspaces")).toBeInTheDocument());
    expect(rpc).toHaveBeenCalledWith(CAP_LIST_RPC, {
      _organization_id: ORG,
      _workspace_id: WORKSPACE,
      _api_client_id: CLIENT,
      _limit: 200,
      _offset: 0,
    });
    expect(PERMISSIONS_SOURCE).toContain('"connected-app-workspace-permissions"');
  });

  it("shows additive semantics with backend-provided effective status and source", async () => {
    rpc.mockResolvedValue({ data: [capRow()], error: null });
    renderPermissions();
    await waitFor(() => expect(screen.getByText("Read Workspaces")).toBeInTheDocument());
    expect(screen.getByText("Direct Workspace permission")).toBeInTheDocument();
    expect(screen.getByText("Not granted")).toBeInTheDocument();
    expect(screen.getByText("Effective permission")).toBeInTheDocument();
    expect(screen.getByText("Enabled · Organization")).toBeInTheDocument();
    expect(PERMISSIONS_SOURCE).toContain("row.effective_grant_status");
    expect(PERMISSIONS_SOURCE).toContain("row.effective_grant_source");
    // API-ADM-UX2.3 — the blanket additive notice is replaced by neutral,
    // architecture-accurate scope wording.
    expect(PERMISSIONS_SOURCE).toContain("WS_CAP_SCOPE_NOTICE");
  });

  it("does not recalculate effective permission locally", () => {
    expect(PERMISSIONS_SOURCE).not.toMatch(/organization_grant_status\s*===\s*"enabled"/);
    expect(PERMISSIONS_SOURCE).toContain("effectiveAccessLabel(");
    expect(PERMISSIONS_SOURCE).toContain("effectiveSourceLabel(");
  });

  it("reuses the accepted gating helper unchanged", () => {
    expect(PERMISSIONS_SOURCE).toContain("resolveWorkspaceCapabilityRowAction(");
    expect(
      resolveWorkspaceCapabilityRowAction(
        capRow({ workspace_grant_status: null }) as any,
        "active",
        "enabled",
        "enabled",
        true,
      ).kind,
    ).toBe("unavailable");
    expect(
      resolveWorkspaceCapabilityRowAction(
        capRow({ administrator_assignable: false }) as any,
        "active",
        "enabled",
        "enabled",
        false,
      ).kind,
    ).toBe("unavailable");
    // API-ADM-UX2.3 — Project-scoped capabilities are now administered as exact
    // Workspace grants, so an otherwise eligible Project row is actionable.
    expect(
      resolveWorkspaceCapabilityRowAction(
        capRow({ scope_level: "project" }) as any,
        "active",
        "enabled",
        "enabled",
        false,
      ).kind,
    ).toBe("enable");
  });

  it("transitions with the accepted RPC and invalidates its own query plus the scoped Workspace list", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === CAP_LIST_RPC) return Promise.resolve({ data: [capRow()], error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const { invalidateSpy } = renderPermissions();
    await waitFor(() => expect(screen.getByRole("button", { name: "Enable" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() =>
      expect(screen.getByText("Enable Read Workspaces for Test?")).toBeInTheDocument(),
    );
    const confirm = screen
      .getAllByRole("button", { name: "Enable" })
      .find((b) => b.closest("[role='alertdialog']"))!;
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(CAP_TRANSITION_RPC, {
        _organization_id: ORG,
        _workspace_id: WORKSPACE,
        _api_client_id: CLIENT,
        _api_version: "v1",
        _capability_key: "workspaces.read",
        _target_lifecycle_status: "enabled",
      }),
    );
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["connected-app-workspace-permissions", ORG, CLIENT, WORKSPACE],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["connected-app-workspace-access", ORG, CLIENT],
      });
    });
  });
});

describe("API-ADM.5B boundary", () => {
  it("performs no Project administration", () => {
    for (const src of [ACCESS_SOURCE, PERMISSIONS_SOURCE]) {
      expect(src).not.toContain("api_g_5_7_admin_list_workspace_client_projects");
      expect(src).not.toContain("api_g_5_7_admin_transition_project_client");
      expect(src).not.toContain("ConnectedAppProjectScopeDialog");
      expect(src).not.toContain("ScopeDialog");
    }
  });

  it("uses no global context, role helpers or browser persistence", () => {
    for (const src of [ACCESS_SOURCE, PERMISSIONS_SOURCE]) {
      for (const banned of [
        "ActiveContext",
        "useIsOrgAdmin",
        "useIsTenantAdmin",
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "useSearchParams",
      ]) {
        expect(src).not.toContain(banned);
      }
    }
  });

  it("keeps the shell free of Supabase/RPC access", () => {
    expect(SHELL_SOURCE).not.toContain("supabase");
    expect(SHELL_SOURCE).not.toContain(".rpc(");
    expect(SHELL_SOURCE).toContain("<ConnectedAppWorkspaceAccess");
    expect(SHELL_SOURCE).toContain("<ConnectedAppOrganizationPermissions");
  });

  it("API-ADM.6B — sources Workspace access and permission contracts from pure models", () => {
    expect(ACCESS_SOURCE).toContain('from "./connectedAppWorkspaceAccessModel"');
    expect(PERMISSIONS_SOURCE).toContain('from "./connectedAppWorkspacePermissionsModel"');
    for (const file of [
      "../connectedAppWorkspaceAccessModel.ts",
      "../connectedAppWorkspacePermissionsModel.ts",
    ]) {
      const model = readFileSync(resolve(__dirname, file), "utf8");
      expect(model.length).toBeGreaterThan(0);
      for (const banned of ["react", "supabase", "@tanstack/react-query"]) {
        expect(model).not.toContain(banned);
      }
    }
  });
});
