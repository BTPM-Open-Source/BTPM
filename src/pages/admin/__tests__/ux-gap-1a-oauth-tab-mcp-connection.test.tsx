/**
 * UX-GAP.1A — OAuth tab visibility of the BTPM MCP protected-resource values.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminPlatformApiClientDetail from "../AdminPlatformApiClientDetail";

const CLIENT = "33333333-3333-4333-8333-333333333333";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const fetchMetadata = vi.fn();
vi.mock("@/lib/mcpProtectedResourceMetadata", () => ({
  MCP_PROTECTED_RESOURCE_METADATA_PATH:
    "/functions/v1/btpm-mcp/.well-known/oauth-protected-resource",
  fetchMcpProtectedResourceMetadata: (...args: unknown[]) => fetchMetadata(...args),
}));

const detail = {
  client: {
    id: CLIENT,
    client_key: "astra",
    display_name: "Astra",
    description: "External integration",
    oauth_client_id: "oauth-astra",
    lifecycle_status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-02-01T00:00:00.000Z",
  },
  redirects: [
    {
      id: "r-1",
      redirect_uri: "https://astra.example.com/callback",
      lifecycle_status: "active",
      verified_at: "2026-01-05T00:00:00.000Z",
      retired_at: null,
    },
  ],
  policy_versions: [],
  supported_capabilities: [],
};

function renderOauthTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/platform/api-clients/${CLIENT}?tab=oauth`]}>
        <Routes>
          <Route
            path="/admin/platform/api-clients/:clientId"
            element={<AdminPlatformApiClientDetail />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: detail, error: null });
  fetchMetadata.mockReset();
  fetchMetadata.mockResolvedValue({
    resource: "https://abc.supabase.co/functions/v1/btpm-mcp",
    authorizationServer: "https://abc.supabase.co/auth/v1",
    bearerMethodsSupported: ["header"],
  });
});

afterEach(() => cleanup());

describe("UX-GAP.1A OAuth tab", () => {
  it("renders the BTPM MCP connection card with audience and authorization server", async () => {
    renderOauthTab();
    await waitFor(() => expect(screen.getByText("BTPM MCP connection")).toBeTruthy());
    expect(screen.getByText("Required audience / protected resource")).toBeTruthy();
    expect(screen.getByText("https://abc.supabase.co/functions/v1/btpm-mcp")).toBeTruthy();
    expect(screen.getByText("Authorization server")).toBeTruthy();
    expect(screen.getByText("https://abc.supabase.co/auth/v1")).toBeTruthy();
    expect(screen.getByText("Bearer token in Authorization header")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy Required audience / protected resource" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy Authorization server" })).toBeTruthy();
  });

  it("keeps the existing OAuth client ID and redirect URI controls working", async () => {
    renderOauthTab();
    await waitFor(() => expect(screen.getByText("OAuth redirect URIs")).toBeTruthy());
    expect(screen.getByText("https://astra.example.com/callback")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add redirect URI" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy();
  });

  it("shows only the bounded unavailable message when metadata fails, without breaking detail", async () => {
    fetchMetadata.mockResolvedValue(null);
    renderOauthTab();
    await waitFor(() =>
      expect(
        screen.getByText("BTPM MCP connection details are temporarily unavailable."),
      ).toBeTruthy(),
    );
    expect(screen.getByText("OAuth redirect URIs")).toBeTruthy();
    expect(screen.getByText("https://astra.example.com/callback")).toBeTruthy();
    expect(screen.queryByText(/VITE_SUPABASE_URL/)).toBeNull();
  });
});
