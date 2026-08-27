/**
 * API-G.5.9D — Connected Apps card behavior tests (exactly four).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { buildApiDConsentReturnPath } from "@/lib/apiDConsent";

const rpcMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import { ConnectedAppsCard } from "@/components/account/ConnectedAppsCard";

const activeRow = {
  client_key: "astra.reporting",
  display_name: "Astra Reporting",
  description: "Reads delivery reporting data.",
  latest_acknowledged_at: "2026-07-20T10:00:00.000Z",
  connection_status: "active",
  total_count: 2,
  policy: {
    version: "1.4.0",
    policy_uri: "https://policy.example.com/astra",
    effective_at: "2026-06-01T00:00:00.000Z",
  },
  organizations: { count: 1, display_names: ["Example Group"] },
  workspaces: { count: 2, display_names: ["Delivery", "Commercial"] },
  capabilities: [
    {
      api_version: "v1",
      display_name: "Read organizations",
      description: "View organizations you can access.",
      scope_level: "organization",
      capability_key: "org.read",
      route_id: "route-123",
      http_method: "GET",
    },
  ],
};

const unavailableRow = {
  client_key: "legacy.tool",
  display_name: "Legacy Tool",
  description: null,
  latest_acknowledged_at: "2026-05-02T09:00:00.000Z",
  connection_status: "unavailable",
  total_count: 2,
  policy: null,
  organizations: { count: 0, display_names: [] },
  workspaces: { count: 0, display_names: [] },
  capabilities: [],
};

function renderCard(userId: string | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  const utils = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ConnectedAppsCard userId={userId} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return {
    client,
    rerender: (nextUserId: string | null) =>
      utils.rerender(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <ConnectedAppsCard userId={nextUserId} />
          </QueryClientProvider>
        </MemoryRouter>,
      ),
  };
}

beforeEach(() => {
  rpcMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("API-G.5.9D — ConnectedAppsCard", () => {
  it("renders safe list details for active and unavailable applications", async () => {
    rpcMock.mockResolvedValue({ data: [activeRow, unavailableRow], error: null });

    renderCard("user-a");

    expect(await screen.findByText("Astra Reporting")).toBeTruthy();
    expect(rpcMock).toHaveBeenCalledWith("api_g_5_9_list_my_connected_apps", {
      _limit: 25,
      _offset: 0,
    });

    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Legacy Tool")).toBeTruthy();
    expect(screen.getByText("Access unavailable")).toBeTruthy();

    expect(screen.getByText("Policy 1.4.0")).toBeTruthy();
    expect(screen.getByText("Organizations: 1")).toBeTruthy();
    expect(screen.getByText("Workspaces: 2")).toBeTruthy();
    expect(screen.getByText("Example Group")).toBeTruthy();
    expect(screen.getByText("Read organizations")).toBeTruthy();
    expect(screen.getByText("View organizations you can access.")).toBeTruthy();
    expect(screen.getByText(/API v1 · Organization level/)).toBeTruthy();
    expect(
      screen.getByText(
        /Current policy and access details are unavailable\. You can still disconnect this application\./,
      ),
    ).toBeTruthy();

    const body = document.body.textContent ?? "";
    expect(body).not.toContain("astra.reporting");
    expect(body).not.toContain("legacy.tool");
    expect(body).not.toContain("org.read");
    expect(body).not.toContain("route-123");
    expect(body).not.toContain("GET");
  });

  it("disconnects the selected application and invalidates both query prefixes", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "api_g_5_9_list_my_connected_apps") {
        return Promise.resolve({ data: [activeRow, unavailableRow], error: null });
      }
      return Promise.resolve({ data: { ok: true, changed: true, connected: false }, error: null });
    });

    const { client } = renderCard("user-a");
    await screen.findByText("Astra Reporting");

    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" })[0]);
    expect(await screen.findByText("Disconnect Astra Reporting?")).toBeTruthy();

    const confirm = screen
      .getAllByRole("button", { name: "Disconnect" })
      .slice(-1)[0];
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(
        rpcMock.mock.calls.some(
          (c) => c[0] === "api_g_5_9_disconnect_my_connected_app",
        ),
      ).toBe(true);
    });

    const call = rpcMock.mock.calls.find(
      (c) => c[0] === "api_g_5_9_disconnect_my_connected_app",
    )!;
    const args = call[1] as { _client_key: string; _correlation_id: string };
    expect(args._client_key).toBe("astra.reporting");
    expect(args._correlation_id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) =>
        JSON.stringify((c[0] as { queryKey: unknown }).queryKey),
      );
      expect(keys).toContain(JSON.stringify(["my-connected-apps", "user-a"]));
      expect(keys).toContain(
        JSON.stringify(["api-d", "consent-context", "astra.reporting"]),
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("Disconnect Astra Reporting?")).toBeNull();
    });
  });

  it("keeps the confirmation open and shows only a safe error when disconnect fails", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "api_g_5_9_list_my_connected_apps") {
        return Promise.resolve({ data: [activeRow, unavailableRow], error: null });
      }
      return Promise.resolve({
        data: null,
        error: { message: "sensitive backend failure detail" },
      });
    });

    renderCard("user-a");
    await screen.findByText("Astra Reporting");

    fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" })[0]);
    await screen.findByText("Disconnect Astra Reporting?");

    fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" }).slice(-1)[0]);

    expect(
      await screen.findByText("Could not disconnect this application. Please try again."),
    ).toBeTruthy();
    expect(screen.getByText("Disconnect Astra Reporting?")).toBeTruthy();
    expect(screen.getByText("Astra Reporting")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toContain("sensitive backend failure detail");
  });

  it("contains cached rows and pending confirmations when the user changes", async () => {
    rpcMock.mockImplementation((fn: string) => {
      if (fn === "api_g_5_9_list_my_connected_apps") {
        return Promise.resolve({ data: [activeRow, unavailableRow], error: null });
      }
      return Promise.resolve({ data: { ok: true, changed: true, connected: false }, error: null });
    });

    const { rerender } = renderCard("user-a");
    await screen.findByText("Astra Reporting");

    fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" })[0]);
    await screen.findByText("Disconnect Astra Reporting?");

    const callsBefore = rpcMock.mock.calls.length;

    rpcMock.mockImplementation((fn: string) => {
      if (fn === "api_g_5_9_list_my_connected_apps") {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({ data: { ok: true, changed: true, connected: false }, error: null });
    });

    rerender("user-b");

    await waitFor(() => {
      expect(screen.queryByText("Disconnect Astra Reporting?")).toBeNull();
    });
    expect(screen.queryByText("Astra Reporting")).toBeNull();

    await waitFor(() => {
      expect(rpcMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    expect(
      rpcMock.mock.calls.slice(callsBefore).some(
        (c) =>
          c[0] === "api_g_5_9_list_my_connected_apps" &&
          (c[1] as { _offset: number })._offset === 0,
      ),
    ).toBe(true);

    expect(await screen.findByText("No connected applications")).toBeTruthy();
    expect(
      rpcMock.mock.calls.some((c) => c[0] === "api_g_5_9_disconnect_my_connected_app"),
    ).toBe(false);
  });

  it("renders a Policy & consent link for active apps with a current policy", async () => {
    rpcMock.mockResolvedValue({ data: [activeRow, unavailableRow], error: null });

    renderCard("user-a");
    await screen.findByText("Astra Reporting");

    const link = screen.getByRole("link", { name: "Policy & consent" });
    expect(link).toBeTruthy();

    const expected = buildApiDConsentReturnPath({
      clientKey: activeRow.client_key,
      returnTo: "/account",
    });
    expect(link.getAttribute("href")).toBe(expected);
    expect(expected).toContain("return_to=%2Faccount");

    const body = document.body.textContent ?? "";
    expect(body).not.toContain(activeRow.client_key);
  });

  it("does not render a Policy & consent link for unavailable apps", async () => {
    rpcMock.mockResolvedValue({ data: [activeRow, unavailableRow], error: null });

    renderCard("user-a");
    await screen.findByText("Astra Reporting");

    expect(screen.getByRole("link", { name: "Policy & consent" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Policy & consent" })).toBeTruthy();
    // Only one link should exist: the active app's Policy & consent link.
    expect(screen.queryAllByRole("link", { name: "Policy & consent" })).toHaveLength(1);
  });

  it("performs no new RPC when the Policy & consent link is rendered and preserves Disconnect", async () => {
    rpcMock.mockResolvedValue({ data: [activeRow, unavailableRow], error: null });

    renderCard("user-a");
    await screen.findByText("Astra Reporting");

    const callsBefore = rpcMock.mock.calls.length;
    const link = screen.getByRole("link", { name: "Policy & consent" });

    fireEvent.click(link);

    await waitFor(() => {
      expect(rpcMock.mock.calls.length).toBe(callsBefore);
    });

    // Disconnect button remains available and unchanged in behavior.
    const disconnectButtons = screen.getAllByRole("button", { name: "Disconnect" });
    expect(disconnectButtons.length).toBeGreaterThan(0);
  });
});
