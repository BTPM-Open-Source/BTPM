import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ConnectedAppWorkspacePermissions from "../ConnectedAppWorkspacePermissions";
import type { WorkspaceClientCapabilityRow } from "../connectedAppWorkspacePermissionsModel";

/**
 * Step API-G.5.8D-2 — direct Workspace capability administration behavior.
 *
 * Step API-ADM.6B repointed this historical coverage from the retired Workspace
 * capability dialog to the current production Workspace permission surface.
 * Interaction-driven behavior only.
 */

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const WORKSPACE = "44444444-4444-4444-8444-444444444444";

const LIST_RPC = "api_g_5_7_admin_list_workspace_client_capabilities";
const TRANSITION_RPC = "api_g_5_7_admin_transition_workspace_client_capability";

function row(
  overrides: Partial<WorkspaceClientCapabilityRow> = {},
): WorkspaceClientCapabilityRow {
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
    organization_grant_status: null,
    organization_grant_enabled_at: null,
    organization_grant_disabled_at: null,
    workspace_grant_id: null,
    workspace_grant_status: null,
    workspace_grant_enabled_at: null,
    workspace_grant_disabled_at: null,
    effective_grant_status: null,
    effective_grant_source: "none",
    total_count: 2,
    ...overrides,
  };
}

function renderPermissions(props: { organizationId: string }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ConnectedAppWorkspacePermissions
        organizationId={props.organizationId}
        apiClientId={CLIENT}
        workspaceId={WORKSPACE}
        workspaceName="Delivery"
        clientLifecycleStatus="active"
        organizationEnablementStatus="enabled"
        workspaceEnablementStatus="enabled"
        workspaceIsArchived={false}
      />
    </QueryClientProvider>,
  );
  return { view, queryClient, invalidateSpy };
}

beforeEach(() => {
  rpc.mockReset();
  cleanup();
});

describe("API-G.5.8D-2 — Workspace capability administration behavior", () => {
  it("lists rows with direct Workspace and backend effective presentation", async () => {
    rpc.mockResolvedValue({
      data: [
        row({
          organization_grant_status: "enabled",
          workspace_grant_status: null,
          effective_grant_status: "enabled",
          effective_grant_source: "organization",
        }),
        row({
          capability_key: "projects.read",
          display_name: "Read Projects",
          workspace_grant_status: "enabled",
          effective_grant_status: "enabled",
          effective_grant_source: "workspace",
        }),
      ],
      error: null,
    });

    renderPermissions({ organizationId: ORG });

    await waitFor(() => expect(screen.getByText("Read Workspaces")).toBeInTheDocument());
    expect(rpc).toHaveBeenCalledWith(LIST_RPC, {
      _organization_id: ORG,
      _workspace_id: WORKSPACE,
      _api_client_id: CLIENT,
      _limit: 200,
      _offset: 0,
    });
    expect(screen.getByText(/Enabled · Organization/)).toBeInTheDocument();
    expect(screen.getByText(/Enabled · Workspace/)).toBeInTheDocument();
    expect(screen.getAllByText("Not granted").length).toBeGreaterThan(0);

    expect(screen.getByRole("button", { name: "Enable" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Disable" })).toBeEnabled();
  });

  it("confirming an eligible Enable calls the transition RPC and invalidates all three scopes", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === LIST_RPC) {
        return Promise.resolve({
          data: [row({ organization_grant_status: "enabled" })],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { invalidateSpy } = renderPermissions({ organizationId: ORG });

    await waitFor(() => expect(screen.getByRole("button", { name: "Enable" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() =>
      expect(screen.getByText("Enable Read Workspaces for Delivery?")).toBeInTheDocument(),
    );

    const confirm = screen
      .getAllByRole("button", { name: "Enable" })
      .find((b) => b.closest("[role='alertdialog']"))!;
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(TRANSITION_RPC, {
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
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["connected-apps", ORG] });
    });
    await waitFor(() =>
      expect(
        screen.queryByText("Enable Read Workspaces for Delivery?"),
      ).not.toBeInTheDocument(),
    );
  });

  it("does not execute a pending mutation after the context changes", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === LIST_RPC) return Promise.resolve({ data: [row()], error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const { view } = renderPermissions({ organizationId: ORG });

    await waitFor(() => expect(screen.getByRole("button", { name: "Enable" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() =>
      expect(screen.getByText("Enable Read Workspaces for Delivery?")).toBeInTheDocument(),
    );

    // Organization context changes while the confirmation is pending.
    view.rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ConnectedAppWorkspacePermissions
          organizationId={OTHER_ORG}
          apiClientId={CLIENT}
          workspaceId={WORKSPACE}
          workspaceName="Delivery"
          clientLifecycleStatus="active"
          organizationEnablementStatus="enabled"
          workspaceEnablementStatus="enabled"
          workspaceIsArchived={false}
        />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(
        screen.queryByText("Enable Read Workspaces for Delivery?"),
      ).not.toBeInTheDocument(),
    );
    expect(rpc).not.toHaveBeenCalledWith(TRANSITION_RPC, expect.anything());
  });

  it("keeps the confirmation open and shows only the safe error on backend failure", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === LIST_RPC) {
        return Promise.resolve({
          data: [row({ workspace_grant_status: "enabled", effective_grant_status: "enabled" })],
          error: null,
        });
      }
      return Promise.resolve({
        data: null,
        error: { message: "permission denied for a protected relation" },
      });
    });

    renderPermissions({ organizationId: ORG });

    await waitFor(() => expect(screen.getByRole("button", { name: "Disable" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() =>
      expect(screen.getByText("Disable Read Workspaces for Delivery?")).toBeInTheDocument(),
    );

    const confirm = screen
      .getAllByRole("button", { name: "Disable" })
      .find((b) => b.closest("[role='alertdialog']"))!;
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(
        screen.getByText(
          "Could not disable this Workspace capability. Refresh the capability list and try again.",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/permission denied/i)).not.toBeInTheDocument();
    expect(screen.getByText("Disable Read Workspaces for Delivery?")).toBeInTheDocument();
  });
});
