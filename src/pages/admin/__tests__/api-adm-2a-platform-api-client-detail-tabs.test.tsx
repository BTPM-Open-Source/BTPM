/**
 * Step API-ADM.2A — Platform API Client detail information architecture.
 *
 * Frontend-only guards: URL-addressable tab model, content placement, and
 * preservation of existing RPC names / consent-surface isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminPlatformApiClientDetail, {
  API_CLIENT_DETAIL_TABS,
  resolveApiClientDetailTab,
} from "../AdminPlatformApiClientDetail";

const CLIENT = "33333333-3333-4333-8333-333333333333";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/pages/admin/AdminPlatformApiClientDetail.tsx"),
  "utf8",
);

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
  policy_versions: [
    {
      id: "p-1",
      version: "1.0.0",
      policy_uri: "https://astra.example.com/policy",
      lifecycle_status: "active",
      effective_at: "2026-01-06T00:00:00.000Z",
      retired_at: null,
    },
  ],
  supported_capabilities: [
    {
      supported_capability_id: "sc-1",
      api_version: "v1",
      capability_kind: "read",
      capability_key: "projects:list",
      display_name: "List Projects",
      http_method: "GET",
      route_path: "/v1/projects",
      catalogue_lifecycle_status: "active",
      administrator_assignable: true,
      support_lifecycle_status: "enabled",
    },
  ],
};

function renderPage(search: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/platform/api-clients/${CLIENT}${search}`]}>
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
});

afterEach(() => {
  cleanup();
});

describe("API-ADM.2A — tab model", () => {
  it("declares exactly the five approved tabs in order", () => {
    expect(API_CLIENT_DETAIL_TABS.map((t) => t.value)).toEqual([
      "overview",
      "oauth",
      "capabilities",
      "policy",
      "activity",
    ]);
    expect(API_CLIENT_DETAIL_TABS.map((t) => t.label)).toEqual([
      "Overview",
      "OAuth",
      "Supported capabilities",
      "Policy & consent",
      "API activity",
    ]);
  });

  it("falls back to overview for missing or invalid tab values", () => {
    expect(resolveApiClientDetailTab(null)).toBe("overview");
    expect(resolveApiClientDetailTab("")).toBe("overview");
    expect(resolveApiClientDetailTab("nope")).toBe("overview");
    expect(resolveApiClientDetailTab("policy")).toBe("policy");
  });

  it("renders all five tab labels and defaults to Overview with lifecycle controls", async () => {
    renderPage("");
    await waitFor(() => expect(screen.getByText("Client overview")).toBeTruthy());
    for (const tab of API_CLIENT_DETAIL_TABS) {
      expect(screen.getByRole("tab", { name: tab.label })).toBeTruthy();
    }
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Suspend" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retire" })).toBeTruthy();
  });

  it("renders Overview when the tab query value is invalid", async () => {
    renderPage("?tab=not-a-tab");
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    expect(screen.getByText("Client overview")).toBeTruthy();
  });

  it("renders OAuth redirect administration for ?tab=oauth", async () => {
    renderPage("?tab=oauth");
    await waitFor(() => expect(screen.getByText("OAuth redirect URIs")).toBeTruthy());
    expect(screen.getByText("https://astra.example.com/callback")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add redirect URI" })).toBeTruthy();
  });

  it("renders Supported capabilities for ?tab=capabilities", async () => {
    renderPage("?tab=capabilities");
    await waitFor(() => expect(screen.getByText("projects:list")).toBeTruthy());
    expect(screen.getByText("List Projects")).toBeTruthy();
  });

  it("renders Policy versions administration for ?tab=policy", async () => {
    renderPage("?tab=policy");
    await waitFor(() => expect(screen.getByText("Policy versions")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Add policy version" })).toBeTruthy();
  });

  it("renders the API activity panel for ?tab=activity", async () => {
    renderPage("?tab=activity");
    await waitFor(() => expect(screen.getByText("Recent activity")).toBeTruthy());
  });
});

describe("API-ADM.2A — preserved contracts", () => {
  it("keeps the existing RPC names for client, redirects, policies and capabilities", () => {
    for (const name of [
      "api_g_5_6_platform_get_client",
      "api_g_5_5_platform_update_draft_client",
      "api_g_5_5_platform_transition_client",
      "api_g_5_5_platform_create_oauth_redirect",
      "api_g_5_5_platform_update_draft_oauth_redirect",
      "api_g_5_5_platform_transition_oauth_redirect",
      "api_g_5_5_platform_create_policy_version",
      "api_g_5_5_platform_update_draft_policy_version",
      "api_g_5_5_platform_transition_policy_version",
      "api_g_5_6_platform_transition_supported_capability",
    ]) {
      expect(SOURCE).toContain(`"${name}"`);
    }
  });

  it("does not import or link end-user consent surfaces", () => {
    expect(SOURCE).not.toContain("ConsentApiD");
    expect(SOURCE).not.toContain("OAuthConsent");
    expect(SOURCE).not.toContain("/consent/api-d");
    expect(SOURCE).not.toContain("/oauth/consent");
  });
});
