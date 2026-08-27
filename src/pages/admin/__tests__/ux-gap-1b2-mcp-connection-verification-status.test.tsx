/**
 * UX-GAP.1B2 — Platform Admin MCP connection verification status UX guards.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AdminPlatformApiClientDetail from "../AdminPlatformApiClientDetail";

const CLIENT = "33333333-3333-4333-8333-333333333333";
const TS = "2026-08-17T10:00:00.000Z";

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

const getVerification = vi.fn();
vi.mock("@/lib/admin/mcpConnectionVerificationService", () => ({
  MCP_CONNECTION_VERIFICATION_RPC: "api_g_5_10_get_mcp_connection_verification",
  getMcpConnectionVerification: (...args: unknown[]) => getVerification(...args),
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
  getVerification.mockReset();
  getVerification.mockResolvedValue({ verified: false, lastSuccessfulAuthenticationAt: null });
});

afterEach(() => cleanup());

describe("UX-GAP.1B2 verification status", () => {
  it("passes the canonical loaded client.id to the card reader", async () => {
    renderOauthTab();
    await waitFor(() => expect(getVerification).toHaveBeenCalled());
    expect(getVerification.mock.calls[0][0]).toBe(CLIENT);
  });

  it("renders Verified plus the last successful authentication timestamp", async () => {
    getVerification.mockResolvedValue({ verified: true, lastSuccessfulAuthenticationAt: TS });
    renderOauthTab();
    const section = await waitFor(() =>
      screen.getByRole("group", { name: "Connection verification" }),
    );
    await waitFor(() => expect(within(section).getByText("Verified")).toBeTruthy());
    expect(screen.getByText("Connection verification")).toBeTruthy();
    expect(screen.getByText("Last successful MCP authentication")).toBeTruthy();
    expect(screen.getByText(new Date(TS).toLocaleString())).toBeTruthy();
    expect(screen.getByText(/historical connection evidence, not a live health check/)).toBeTruthy();
    expect(screen.queryByText("Not yet verified")).toBeNull();
    expect(screen.queryByText("Verification status unavailable")).toBeNull();
  });

  it("renders Not yet verified for negative evidence", async () => {
    renderOauthTab();
    await waitFor(() => expect(screen.getByText("Not yet verified")).toBeTruthy());
    const section = screen.getByRole("group", { name: "Connection verification" });
    expect(
      within(section).getByText(
        "No successful MCP authentication has been recorded for this API client yet.",
      ),
    ).toBeTruthy();
    expect(within(section).queryByText("Verified")).toBeNull();
  });

  it("renders Verification status unavailable on read failure, never negative evidence", async () => {
    getVerification.mockRejectedValue(new Error("MCP connection verification is unavailable."));
    renderOauthTab();
    await waitFor(() => expect(screen.getByText("Verification status unavailable")).toBeTruthy());
    expect(screen.queryByText("Not yet verified")).toBeNull();
    expect(screen.queryByText(/permission denied|SQLSTATE|rpc/i)).toBeNull();
  });

  it("does not infer verification from metadata success", async () => {
    getVerification.mockRejectedValue(new Error("unavailable"));
    renderOauthTab();
    await waitFor(() => expect(screen.getByText("Verification status unavailable")).toBeTruthy());
    expect(screen.getByText("https://abc.supabase.co/functions/v1/btpm-mcp")).toBeTruthy();
    expect(screen.getByText("Authorization server")).toBeTruthy();
  });

  it("keeps metadata failure and verification success independent", async () => {
    fetchMetadata.mockResolvedValue(null);
    getVerification.mockResolvedValue({ verified: true, lastSuccessfulAuthenticationAt: TS });
    renderOauthTab();
    await waitFor(() =>
      expect(
        screen.getByText("BTPM MCP connection details are temporarily unavailable."),
      ).toBeTruthy(),
    );
    const section = screen.getByRole("group", { name: "Connection verification" });
    expect(within(section).getByText("Verified")).toBeTruthy();
    expect(screen.getByText("OAuth redirect URIs")).toBeTruthy();
  });

  it("survives both reads failing without breaking the detail page", async () => {
    fetchMetadata.mockResolvedValue(null);
    getVerification.mockRejectedValue(new Error("unavailable"));
    renderOauthTab();
    await waitFor(() => expect(screen.getByText("Verification status unavailable")).toBeTruthy());
    expect(screen.getByText("OAuth redirect URIs")).toBeTruthy();
    expect(screen.getByText("https://astra.example.com/callback")).toBeTruthy();
  });
});

describe("UX-GAP.1B2 containment", () => {
  const CARD = readFileSync(resolve(process.cwd(), "src/pages/admin/McpConnectionCard.tsx"), "utf8");
  const DETAIL = readFileSync(
    resolve(process.cwd(), "src/pages/admin/AdminPlatformApiClientDetail.tsx"),
    "utf8",
  );

  // UX-MCP-ADMIN.2 amended this containment: the card now owns the governed
  // protected-resource configuration mutation, but must still add no
  // verification-manufacturing control.
  it("adds no verify/test/reset verification control", () => {
    for (const banned of [
      ">Verify<",
      ">Test connection<",
      ">Test audience<",
      ">Mark verified<",
      ">Reset verification<",
    ]) {
      expect(CARD).not.toContain(banned);
    }
  });

  it("keeps audience and authorization server read-only and server-authoritative", () => {
    for (const banned of ["<Input", "<Textarea", "<Select"]) {
      expect(CARD).not.toContain(banned);
    }
    expect(CARD).not.toContain("BTPM_MCP_RESOURCE_URI");
    expect(CARD).not.toMatch(/https:\/\/[a-z0-9]{20}\.supabase\.co/);
  });

  it("derives the client ID from the loaded client, not the query string", () => {
    expect(DETAIL).toContain("apiClientId={client.id}");
    expect(DETAIL).not.toContain("apiClientId={clientId}");
    expect(DETAIL).not.toContain("apiClientId={client.oauth_client_id");
  });
});
