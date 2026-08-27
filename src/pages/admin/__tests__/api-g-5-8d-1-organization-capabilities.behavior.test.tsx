import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ConnectedAppOrganizationPermissions from "../ConnectedAppOrganizationPermissions";
import type { OrganizationClientCapabilityRow } from "../connectedAppOrganizationPermissionsModel";

/**
 * Step API-G.5.8D-1 — Organization capability administration behavior.
 *
 * Step API-ADM.6B repointed this historical coverage from the retired
 * Organization capability dialog to the current production Organization
 * permission administration surface. Only interaction-driven behavior that
 * repository inspection cannot prove is asserted here.
 */

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";

const LIST_RPC = "api_g_5_7_admin_list_organization_client_capabilities";
const TRANSITION_RPC = "api_g_5_7_admin_transition_organization_client_capability";

function row(
  overrides: Partial<OrganizationClientCapabilityRow> = {},
): OrganizationClientCapabilityRow {
  return {
    api_version: "v1",
    capability_kind: "read",
    capability_key: "organizations.read",
    display_name: "Read Organizations",
    description: "Read Organization metadata.",
    scope_level: "organization",
    catalogue_lifecycle_status: "active",
    administrator_assignable: true,
    supported_capability_id: "sc-1",
    supported_capability_status: "enabled",
    grant_id: null,
    grant_status: null,
    grant_enabled_at: null,
    grant_disabled_at: null,
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
      <ConnectedAppOrganizationPermissions
        organizationId={props.organizationId}
        apiClientId={CLIENT}
        clientLifecycleStatus="active"
        organizationEnablementStatus="enabled"
      />
    </QueryClientProvider>,
  );
  return { view, queryClient, invalidateSpy };
}

beforeEach(() => {
  rpc.mockReset();
  cleanup();
});

describe("API-G.5.8D-1 — Organization capability administration behavior", () => {
  it("renders rows with actionable and unavailable states", async () => {
    rpc.mockResolvedValue({
      data: [
        row(),
        row({
          capability_key: "workspaces.read",
          display_name: "Read Workspaces",
          administrator_assignable: false,
        }),
      ],
      error: null,
    });

    renderPermissions({ organizationId: ORG });

    await waitFor(() => expect(screen.getByText("Read Organizations")).toBeInTheDocument());
    expect(rpc).toHaveBeenCalledWith(LIST_RPC, {
      _organization_id: ORG,
      _api_client_id: CLIENT,
      _limit: 200,
      _offset: 0,
    });
    expect(screen.getByRole("button", { name: "Enable" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Unavailable" })).toBeDisabled();
    expect(
      screen.getByText("This capability is not currently available for assignment."),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Not granted")).toHaveLength(2);
  });

  it("confirming an eligible Enable calls the transition RPC and refreshes both query scopes", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === LIST_RPC) return Promise.resolve({ data: [row()], error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const { invalidateSpy } = renderPermissions({ organizationId: ORG });

    await waitFor(() => expect(screen.getByRole("button", { name: "Enable" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() =>
      expect(screen.getByText("Enable Read Organizations?")).toBeInTheDocument(),
    );

    const confirm = screen
      .getAllByRole("button", { name: "Enable" })
      .find((b) => b.closest("[role='alertdialog']"))!;
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(TRANSITION_RPC, {
        _organization_id: ORG,
        _api_client_id: CLIENT,
        _api_version: "v1",
        _capability_key: "organizations.read",
        _target_lifecycle_status: "enabled",
      }),
    );
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["connected-app-organization-permissions", ORG, CLIENT],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["connected-apps", ORG] });
    });
    await waitFor(() =>
      expect(screen.queryByText("Enable Read Organizations?")).not.toBeInTheDocument(),
    );
  });

  it("does not execute a pending mutation after the Organization context changes", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === LIST_RPC) return Promise.resolve({ data: [row()], error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const { view } = renderPermissions({ organizationId: ORG });

    await waitFor(() => expect(screen.getByRole("button", { name: "Enable" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() =>
      expect(screen.getByText("Enable Read Organizations?")).toBeInTheDocument(),
    );

    // The Organization context changes while the confirmation is pending.
    view.rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ConnectedAppOrganizationPermissions
          organizationId={OTHER_ORG}
          apiClientId={CLIENT}
          clientLifecycleStatus="active"
          organizationEnablementStatus="enabled"
        />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.queryByText("Enable Read Organizations?")).not.toBeInTheDocument(),
    );
    expect(rpc).not.toHaveBeenCalledWith(TRANSITION_RPC, expect.anything());
  });

  it("shows only the accepted safe error when the backend fails", async () => {
    rpc.mockImplementation((name: string) => {
      if (name === LIST_RPC) {
        return Promise.resolve({ data: [row({ grant_status: "enabled" })], error: null });
      }
      return Promise.resolve({
        data: null,
        error: { message: "permission denied for relation api_capability_grants" },
      });
    });

    renderPermissions({ organizationId: ORG });

    await waitFor(() => expect(screen.getByRole("button", { name: "Disable" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() =>
      expect(screen.getByText("Disable Read Organizations?")).toBeInTheDocument(),
    );

    const confirm = screen
      .getAllByRole("button", { name: "Disable" })
      .find((b) => b.closest("[role='alertdialog']"))!;
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(
        screen.getByText(
          "Could not disable this capability. Refresh the capability list and try again.",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/permission denied/i)).not.toBeInTheDocument();
    expect(screen.getByText("Disable Read Organizations?")).toBeInTheDocument();
  });
});
