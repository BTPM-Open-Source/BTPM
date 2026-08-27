/**
 * Step API-ADM.5A — Organization permissions in the unified Access & permissions tab.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ConnectedAppOrganizationPermissions from "../ConnectedAppOrganizationPermissions";
import type { OrganizationClientCapabilityRow } from "../connectedAppOrganizationPermissionsModel";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const PERMISSIONS_SOURCE = readFileSync(
  resolve(__dirname, "../ConnectedAppOrganizationPermissions.tsx"),
  "utf8",
);
const SHELL_SOURCE = readFileSync(
  resolve(__dirname, "../ConnectedAppManagementView.tsx"),
  "utf8",
);
const MODEL_SOURCE = readFileSync(
  resolve(__dirname, "../connectedAppOrganizationPermissionsModel.ts"),
  "utf8",
);

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
    total_count: 1,
    ...overrides,
  };
}

function renderPermissions(organizationId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ConnectedAppOrganizationPermissions
        organizationId={organizationId}
        apiClientId={CLIENT}
        clientLifecycleStatus="active"
        organizationEnablementStatus="enabled"
      />
    </QueryClientProvider>,
  );
  return { view, invalidateSpy };
}

beforeEach(() => {
  rpc.mockReset();
  cleanup();
});

describe("API-ADM.5A containment", () => {
  it("takes explicit context props and no ActiveContext or role helpers", () => {
    expect(PERMISSIONS_SOURCE).toContain("organizationId: string");
    expect(PERMISSIONS_SOURCE).toContain("apiClientId: string");
    for (const forbidden of [
      "ActiveContext",
      "useIsOrgAdmin",
      "useIsTenantAdmin",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      'context === "tenant"',
    ]) {
      expect(PERMISSIONS_SOURCE).not.toContain(forbidden);
    }
  });

  it("uses exactly the existing Organization capability RPCs and no Workspace/Project RPCs", () => {
    expect(PERMISSIONS_SOURCE).toContain(LIST_RPC);
    expect(PERMISSIONS_SOURCE).toContain(TRANSITION_RPC);
    for (const forbidden of [
      "workspace_client_capability",
      "project_client_enablement",
      "workspace_client_enablement",
      ".from(",
    ]) {
      expect(PERMISSIONS_SOURCE).not.toContain(forbidden);
    }
  });

  it("scopes query identity to organizationId and apiClientId", () => {
    expect(PERMISSIONS_SOURCE).toContain('"connected-app-organization-permissions"');
    expect(PERMISSIONS_SOURCE).not.toContain("placeholderData");
  });
});

describe("API-ADM.5A shell integration", () => {
  it("renders the permissions component only in the Access & permissions tab", () => {
    const access = SHELL_SOURCE.split('<TabsContent value="access"')[1].split(
      '<TabsContent value="activity"',
    )[0];
    expect(access).toContain("<ConnectedAppOrganizationPermissions");
    expect(SHELL_SOURCE.match(/<ConnectedAppOrganizationPermissions/g)).toHaveLength(1);
    expect(access).toContain("organizationId={organizationId}");
    expect(access).toContain("apiClientId={app.apiClientId}");
  });

  it("keeps the shell free of Supabase/RPC access", () => {
    expect(SHELL_SOURCE).not.toContain("supabase");
    expect(SHELL_SOURCE).not.toContain(".rpc(");
    expect(SHELL_SOURCE).not.toContain("useMutation");
  });

  it("API-ADM.6B — owns its contracts through the pure Organization permission model", () => {
    expect(PERMISSIONS_SOURCE).toContain('from "./connectedAppOrganizationPermissionsModel"');
    expect(PERMISSIONS_SOURCE).not.toContain("ConnectedAppOrganizationCapabilityDialog");
    expect(MODEL_SOURCE).toContain("export function resolveCapabilityRowAction");
    expect(MODEL_SOURCE).not.toContain(LIST_RPC);
    expect(MODEL_SOURCE).not.toContain(TRANSITION_RPC);
    expect(PERMISSIONS_SOURCE).toContain(LIST_RPC);
    expect(PERMISSIONS_SOURCE).toContain(TRANSITION_RPC);
  });
});

describe("API-ADM.5A behavior", () => {
  it("renders friendly name, state and action from the Organization capability reader", async () => {
    rpc.mockResolvedValue({ data: [row()], error: null });
    renderPermissions(ORG);

    await waitFor(() => expect(screen.getByText("Read Organizations")).toBeInTheDocument());
    expect(rpc).toHaveBeenCalledWith(LIST_RPC, {
      _organization_id: ORG,
      _api_client_id: CLIENT,
      _limit: 200,
      _offset: 0,
    });
    expect(screen.getByText("Organization permissions")).toBeInTheDocument();
    expect(screen.getByText("Permissions granted at the Organization level.")).toBeInTheDocument();
    expect(screen.getByText("Not granted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable" })).toBeEnabled();
  });

  it("preserves the existing gating for non-assignable capabilities", async () => {
    rpc.mockResolvedValue({
      data: [row({ administrator_assignable: false })],
      error: null,
    });
    renderPermissions(ORG);

    await waitFor(() => expect(screen.getByRole("button", { name: "Unavailable" })).toBeDisabled());
    expect(
      screen.getByText("This capability is not currently available for assignment."),
    ).toBeInTheDocument();
  });

  it("enables via the existing transition RPC and invalidates the scoped query", async () => {
    rpc.mockImplementation((name: string) =>
      name === LIST_RPC
        ? Promise.resolve({ data: [row()], error: null })
        : Promise.resolve({ data: null, error: null }),
    );
    const { invalidateSpy } = renderPermissions(ORG);

    await waitFor(() => expect(screen.getByRole("button", { name: "Enable" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => expect(screen.getByText("Enable Read Organizations?")).toBeInTheDocument());

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
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["connected-app-organization-permissions", ORG, CLIENT],
      }),
    );
  });

  it("shows a bounded generic error instead of raw backend messages", async () => {
    rpc.mockImplementation((name: string) =>
      name === LIST_RPC
        ? Promise.resolve({ data: [row({ grant_status: "enabled" })], error: null })
        : Promise.resolve({
            data: null,
            error: { message: "permission denied for relation api_capability_grants" },
          }),
    );
    renderPermissions(ORG);

    await waitFor(() => expect(screen.getByRole("button", { name: "Disable" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    const confirm = await waitFor(() =>
      screen.getAllByRole("button", { name: "Disable" }).find((b) =>
        b.closest("[role='alertdialog']"),
      )!,
    );
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(
        screen.getByText(
          "Could not disable this capability. Refresh the capability list and try again.",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/permission denied/i)).not.toBeInTheDocument();
  });

  it("does not retain another Organization's rows after context change", async () => {
    rpc.mockImplementation((_name: string, args: any) =>
      Promise.resolve({
        data:
          args._organization_id === ORG
            ? [row({ display_name: "Read Organizations" })]
            : [],
        error: null,
      }),
    );

    renderPermissions(ORG);
    await waitFor(() => expect(screen.getByText("Read Organizations")).toBeInTheDocument());

    cleanup();
    renderPermissions(OTHER_ORG);

    await waitFor(() =>
      expect(
        screen.getByText("No Organization-level permissions are available for this application."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Read Organizations")).not.toBeInTheDocument();
  });

  it("renders an empty state without hiding the surface", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    renderPermissions(ORG);
    await waitFor(() =>
      expect(
        screen.getByText("No Organization-level permissions are available for this application."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Organization permissions")).toBeInTheDocument();
  });
});
