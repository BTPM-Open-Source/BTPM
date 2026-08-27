/**
 * Step API-ADM.3 — Platform Supported Capabilities domain grouping.
 *
 * Presentation-only guards: grouping helper contract, canonical group order,
 * unknown-domain visibility, empty-group suppression, preserved metadata and
 * preserved Enable/Disable RPC.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminPlatformApiClientDetail from "../AdminPlatformApiClientDetail";
import {
  API_CAPABILITY_DOMAINS,
  getCapabilityDomain,
  groupCapabilitiesByDomain,
} from "../apiCapabilityDomains";

const CLIENT = "33333333-3333-4333-8333-333333333333";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const HELPER_SOURCE = readFileSync(
  resolve(process.cwd(), "src/pages/admin/apiCapabilityDomains.ts"),
  "utf8",
);

function cap(key: string, extra: Record<string, unknown> = {}) {
  return {
    supported_capability_id: `sc-${key}`,
    api_version: "v1",
    capability_kind: "read",
    capability_key: key,
    display_name: `Display ${key}`,
    http_method: "GET",
    route_path: `/v1/${key.split(":")[0]}`,
    catalogue_lifecycle_status: "active",
    administrator_assignable: true,
    support_lifecycle_status: "enabled",
    ...extra,
  };
}

function detail(capabilities: unknown[]) {
  return {
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
    redirects: [],
    policy_versions: [],
    supported_capabilities: capabilities,
  };
}

function renderCapabilitiesTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/admin/platform/api-clients/${CLIENT}?tab=capabilities`]}>
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
});

afterEach(() => {
  cleanup();
});

describe("API-ADM.3 — grouping helper", () => {
  it("declares the canonical group order", () => {
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

  it("maps organizations:* and workspaces:* to Directory & access", () => {
    expect(getCapabilityDomain("organizations:list")).toBe("directory");
    expect(getCapabilityDomain("organizations:read")).toBe("directory");
    expect(getCapabilityDomain("workspaces:list")).toBe("directory");
  });

  it("maps programs:* to Programs", () => {
    expect(getCapabilityDomain("programs:create")).toBe("programs");
    expect(getCapabilityDomain("programs:update")).toBe("programs");
  });

  it("maps projects/planning/phases/tasks to Projects & planning", () => {
    expect(getCapabilityDomain("projects:list")).toBe("projects_planning");
    expect(getCapabilityDomain("projects:read")).toBe("projects_planning");
    expect(getCapabilityDomain("planning:read")).toBe("projects_planning");
    expect(getCapabilityDomain("phases:update")).toBe("projects_planning");
    expect(getCapabilityDomain("tasks:create")).toBe("projects_planning");
  });

  it("maps execution_updates:* to Execution updates", () => {
    expect(getCapabilityDomain("execution_updates:append")).toBe("execution_updates");
    expect(getCapabilityDomain("execution_updates:list")).toBe("execution_updates");
  });

  it("maps kpis:* to KPIs by prefix", () => {
    expect(getCapabilityDomain("kpis:read")).toBe("kpis");
    expect(getCapabilityDomain("kpis:create")).toBe("kpis");
    expect(getCapabilityDomain("kpis:update")).toBe("kpis");
    expect(getCapabilityDomain("kpis:append_update")).toBe("kpis");
  });

  it("maps risks:* to Risks including future actions", () => {
    expect(getCapabilityDomain("risks:create")).toBe("risks");
    expect(getCapabilityDomain("risks:update")).toBe("risks");
    expect(getCapabilityDomain("risks:close")).toBe("risks");
  });

  it("maps blockers:* to Blockers including future actions", () => {
    expect(getCapabilityDomain("blockers:create")).toBe("blockers");
    expect(getCapabilityDomain("blockers:update")).toBe("blockers");
    expect(getCapabilityDomain("blockers:resolve")).toBe("blockers");
  });

  it("maps unknown domains to other", () => {
    expect(getCapabilityDomain("future_thing:do")).toBe("other");
    expect(getCapabilityDomain("weird")).toBe("other");
    expect(getCapabilityDomain("")).toBe("other");
  });

  it("omits empty groups and preserves backend order within a group", () => {
    const groups = groupCapabilitiesByDomain([
      cap("risks:update"),
      cap("risks:create"),
      cap("future_thing:do"),
    ]);
    expect(groups.map((g) => g.domain.id)).toEqual(["risks", "other"]);
    expect(groups[0].capabilities.map((c) => c.capability_key)).toEqual([
      "risks:update",
      "risks:create",
    ]);
  });


  it("contains no backend, scope or grant logic", () => {
    const code = HELPER_SOURCE.split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && l.trim() !== "/**")
      .join("\n")
      .toLowerCase();
    for (const forbidden of [
      "supabase",
      "rpc(",
      "scope_level",
      "grant",
      "organization_id",
      "workspace_id",
      "project_id",
      "auth",
      "usequery",
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe("API-ADM.3 — Supported capabilities tab rendering", () => {
  it("renders only non-empty groups in canonical order", async () => {
    rpc.mockResolvedValue({
      data: detail([
        cap("workspaces:list"),
        cap("risks:create"),
        cap("kpis:read"),
        cap("organizations:list"),
        cap("future_thing:do"),
      ]),
      error: null,
    });
    renderCapabilitiesTab();
    await waitFor(() => expect(screen.getByText("Directory & access")).toBeTruthy());

    const headings = screen
      .getAllByTestId("cap-domain-heading")
      .map((h) => h.textContent);
    expect(headings).toEqual(["Directory & access", "KPIs", "Risks", "Other"]);
    expect(screen.queryByText("Projects")).toBeNull();
    expect(screen.queryByText("Execution updates")).toBeNull();
    expect(screen.queryByText("Blockers")).toBeNull();
    expect(
      screen.getByText("Capabilities not yet assigned to a presentation group."),
    ).toBeTruthy();
    // KPI capability renders beneath its own group heading.
    expect(screen.getByText("kpis:read")).toBeTruthy();
    // Genuinely unknown capability remains visible under Other.
    expect(screen.getByText("future_thing:do")).toBeTruthy();
  });

  it("preserves display name, key, version, kind, route and status", async () => {
    rpc.mockResolvedValue({
      data: detail([cap("risks:create", { support_lifecycle_status: null })]),
      error: null,
    });
    renderCapabilitiesTab();
    await waitFor(() => expect(screen.getByText("Display risks:create")).toBeTruthy());
    expect(screen.getByText("risks:create")).toBeTruthy();
    expect(screen.getByText("v1")).toBeTruthy();
    expect(screen.getByText("read")).toBeTruthy();
    expect(screen.getByText(/\/v1\/risks/)).toBeTruthy();
    expect(screen.getByText("Not enabled")).toBeTruthy();
  });

  it("preserves the Disable transition RPC name", async () => {
    rpc.mockResolvedValue({ data: detail([cap("risks:create")]), error: null });
    renderCapabilitiesTab();
    await waitFor(() => expect(screen.getByRole("button", { name: "Disable" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    const confirm = await screen.findByRole("button", { name: "Disable capability" });
    rpc.mockResolvedValue({ data: null, error: null });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(
        rpc.mock.calls.some(
          (c) => c[0] === "api_g_5_6_platform_transition_supported_capability",
        ),
      ).toBe(true),
    );
  });

  it("hides actions when the capability is not administrator assignable or retired in the catalogue", async () => {
    rpc.mockResolvedValue({
      data: detail([
        cap("risks:create", { administrator_assignable: false }),
        cap("blockers:create", { catalogue_lifecycle_status: "retired" }),
      ]),
      error: null,
    });
    renderCapabilitiesTab();
    await waitFor(() => expect(screen.getByText("risks:create")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
  });

  it("keeps the existing empty state when there are no capabilities", async () => {
    rpc.mockResolvedValue({ data: detail([]), error: null });
    renderCapabilitiesTab();
    await waitFor(() => expect(screen.getByText("No capabilities")).toBeTruthy());
    expect(screen.queryAllByTestId("cap-domain-heading")).toHaveLength(0);
  });
});
