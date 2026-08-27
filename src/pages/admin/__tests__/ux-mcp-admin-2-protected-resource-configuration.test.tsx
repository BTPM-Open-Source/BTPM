/**
 * UX-MCP-ADMIN.2 — Platform OAuth Protected Resource Configuration UX.
 *
 * Frontend-only guards: persisted read contract, bounded mutation contract,
 * lifecycle behavior, OAuth-binding requirement, canonical-audience mismatch
 * and configuration/verification separation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { McpConnectionCard } from "../McpConnectionCard";

const CLIENT = "33333333-3333-4333-8333-333333333333";
const CANONICAL = "https://abc.supabase.co/functions/v1/btpm-mcp";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

const fetchMetadata = vi.fn();
vi.mock("@/lib/mcpProtectedResourceMetadata", () => ({
  MCP_PROTECTED_RESOURCE_METADATA_PATH:
    "/functions/v1/btpm-mcp/.well-known/oauth-protected-resource",
  fetchMcpProtectedResourceMetadata: (...args: unknown[]) => fetchMetadata(...args),
}));

const CARD_SOURCE = readFileSync(
  resolve(process.cwd(), "src/pages/admin/McpConnectionCard.tsx"),
  "utf8",
);
const SERVICE_SOURCE = readFileSync(
  resolve(process.cwd(), "src/lib/admin/apiClientProtectedResourceService.ts"),
  "utf8",
);
const DETAIL_SOURCE = readFileSync(
  resolve(process.cwd(), "src/pages/admin/AdminPlatformApiClientDetail.tsx"),
  "utf8",
);

let queryClient: QueryClient;

function renderCard(props: Partial<Parameters<typeof McpConnectionCard>[0]> = {}) {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <McpConnectionCard
        apiClientId={CLIENT}
        oauthClientId="oauth-astra"
        lifecycleStatus="draft"
        protectedResourceType="none"
        oauthResourceAudience={null}
        {...props}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { result: {} }, error: null });
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: [{ verified: false, last_successful_authentication_at: null }],
    error: null,
  });
  fetchMetadata.mockReset();
  fetchMetadata.mockResolvedValue({
    resource: CANONICAL,
    authorizationServer: "https://abc.supabase.co/auth/v1",
    bearerMethodsSupported: ["header"],
  });
});

afterEach(() => cleanup());

describe("UX-MCP-ADMIN.2 — read contract", () => {
  it("consumes protected_resource_type and oauth_resource_audience in the detail model", () => {
    expect(DETAIL_SOURCE).toContain('protected_resource_type: "none" | "btpm_mcp"');
    expect(DETAIL_SOURCE).toContain("oauth_resource_audience: string | null");
    expect(DETAIL_SOURCE).toContain("protectedResourceType={client.protected_resource_type}");
    expect(DETAIL_SOURCE).toContain("oauthResourceAudience={client.oauth_resource_audience}");
  });

  it("does not derive protected-resource state from metadata or capabilities", () => {
    expect(CARD_SOURCE).toContain("normalizeProtectedResourceType(protectedResourceType)");
    expect(CARD_SOURCE).not.toContain("supported_capabilities");
  });

  it("renders MCP not configured for none", async () => {
    renderCard();
    expect(await screen.findByText("MCP not configured")).toBeTruthy();
    expect(screen.getByText("Not configured")).toBeTruthy();
  });

  it("renders Configured for BTPM MCP with a read-only persisted audience", async () => {
    renderCard({ protectedResourceType: "btpm_mcp", oauthResourceAudience: CANONICAL });
    expect(await screen.findByText("Configured for BTPM MCP")).toBeTruthy();
    const audiences = screen.getAllByText(CANONICAL);
    expect(audiences.length).toBeGreaterThan(0);
    expect(document.querySelectorAll("input[type=text], textarea").length).toBe(0);
  });

  it("shows no Save action when there is no state change", async () => {
    renderCard();
    await screen.findByText("MCP not configured");
    expect(screen.queryByRole("button", { name: "Save protected resource" })).toBeNull();
  });
});

describe("UX-MCP-ADMIN.2 — mutation contract", () => {
  it("sends exactly api_client_id and resource_type to the protected Edge Function", () => {
    expect(SERVICE_SOURCE).toContain('"platform-api-client-protected-resource"');
    expect(SERVICE_SOURCE).toContain("api_client_id: apiClientId");
    expect(SERVICE_SOURCE).toContain("resource_type: resourceType");
    expect(SERVICE_SOURCE).not.toContain("audience:");
    expect(SERVICE_SOURCE).not.toContain("resource_uri");
    expect(SERVICE_SOURCE).not.toContain("api_ux_mcp_admin_1_platform_set_client_protected_resource");
    expect(SERVICE_SOURCE).not.toContain('.from("api_clients")');
  });

  it("saves a draft client and invalidates the platform client detail query", async () => {
    const user = userEvent.setup();
    renderCard();
    await screen.findByText("MCP not configured");
    await user.click(screen.getByLabelText("BTPM MCP"));
    const save = await screen.findByRole("button", { name: "Save protected resource" });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await user.click(save);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][0]).toBe("platform-api-client-protected-resource");
    expect(invoke.mock.calls[0][1]).toEqual({
      body: { api_client_id: CLIENT, resource_type: "btpm_mcp" },
    });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ["platform-admin-api-client", CLIENT] }),
    );
  });

  it("saves a suspended client", async () => {
    const user = userEvent.setup();
    renderCard({ lifecycleStatus: "suspended" });
    await screen.findByText("MCP not configured");
    await user.click(screen.getByLabelText("BTPM MCP"));
    await user.click(await screen.findByRole("button", { name: "Save protected resource" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  });

  it("does not present the requested value as persisted when the mutation fails", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("boom") });
    const user = userEvent.setup();
    renderCard();
    await screen.findByText("MCP not configured");
    await user.click(screen.getByLabelText("BTPM MCP"));
    await user.click(await screen.findByRole("button", { name: "Save protected resource" }));
    await waitFor(() =>
      expect(screen.getByText("Protected resource could not be saved.")).toBeTruthy(),
    );
    expect(screen.getByText("MCP not configured")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save protected resource" })).toBeNull();
  });

  it("does not issue duplicate mutations while pending", async () => {
    let release: (() => void) | null = null;
    invoke.mockImplementation(
      () =>
        new Promise((resolvePromise) => {
          release = () => resolvePromise({ data: { result: {} }, error: null });
        }),
    );
    const user = userEvent.setup();
    renderCard();
    await screen.findByText("MCP not configured");
    await user.click(screen.getByLabelText("BTPM MCP"));
    const save = await screen.findByRole("button", { name: "Save protected resource" });
    await user.click(save);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Saving…" })).catch(() => undefined);
    expect(invoke).toHaveBeenCalledTimes(1);
    release?.();
  });
});

describe("UX-MCP-ADMIN.2 — OAuth binding", () => {
  it("prevents newly selecting BTPM MCP and shows the required warning", async () => {
    renderCard({ oauthClientId: null });
    await screen.findByText("MCP not configured");
    expect(
      screen.getByText("Bind an OAuth client ID before configuring this application for BTPM MCP."),
    ).toBeTruthy();
    expect(screen.getByLabelText("BTPM MCP")).toBeDisabled();
    expect(screen.getByLabelText("None")).not.toBeDisabled();
    expect(screen.getByText("Not bound")).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("surfaces an attention warning for an MCP-configured client with no binding", async () => {
    renderCard({ oauthClientId: null, protectedResourceType: "btpm_mcp" });
    expect(await screen.findByText("Attention required")).toBeTruthy();
    expect(screen.getByLabelText("None")).not.toBeDisabled();
  });
});

describe("UX-MCP-ADMIN.2 — lifecycle", () => {
  it("requires confirmation for an active client and cancelling mutates nothing", async () => {
    const user = userEvent.setup();
    renderCard({ lifecycleStatus: "active" });
    await screen.findByText("MCP not configured");
    await user.click(screen.getByLabelText("BTPM MCP"));
    await user.click(await screen.findByRole("button", { name: "Save protected resource" }));
    expect(await screen.findByText("Change protected resource?")).toBeTruthy();
    expect(
      screen.getByText(
        "This changes the audience added to newly issued OAuth access tokens. Existing access tokens are not revoked and remain valid until they expire.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Current: None")).toBeTruthy();
    expect(screen.getByText("New: BTPM MCP")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("mutates only after confirming for an active client", async () => {
    const user = userEvent.setup();
    renderCard({ lifecycleStatus: "active" });
    await screen.findByText("MCP not configured");
    await user.click(screen.getByLabelText("BTPM MCP"));
    await user.click(await screen.findByRole("button", { name: "Save protected resource" }));
    await user.click(await screen.findByRole("button", { name: "Change protected resource" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  });

  it("exposes no enabled mutation action for a retired client", async () => {
    renderCard({ lifecycleStatus: "retired", protectedResourceType: "btpm_mcp" });
    await screen.findByText("Configured for BTPM MCP");
    expect(screen.getByText("Retired API clients cannot be reconfigured.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save protected resource" })).toBeNull();
    expect(screen.getByLabelText("BTPM MCP")).toBeDisabled();
    expect(screen.getByText("Connection verification")).toBeTruthy();
  });
});

describe("UX-MCP-ADMIN.2-C1 — canonical audience mismatch reconciliation", () => {
  const OLD_AUDIENCE = "https://old.supabase.co/functions/v1/btpm-mcp";

  it("exposes an actionable reconciliation control for a mismatched draft client", async () => {
    renderCard({ protectedResourceType: "btpm_mcp", oauthResourceAudience: OLD_AUDIENCE });
    expect(await screen.findByText("Attention required")).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "Reconcile BTPM MCP audience" }),
    ).toBeTruthy();
  });

  it("reconciles a draft client with exactly api_client_id and resource_type=btpm_mcp, no audience URI", async () => {
    const user = userEvent.setup();
    renderCard({ protectedResourceType: "btpm_mcp", oauthResourceAudience: OLD_AUDIENCE });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await user.click(
      await screen.findByRole("button", { name: "Reconcile BTPM MCP audience" }),
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][0]).toBe("platform-api-client-protected-resource");
    expect(invoke.mock.calls[0][1]).toEqual({
      body: { api_client_id: CLIENT, resource_type: "btpm_mcp" },
    });
    expect(JSON.stringify(invoke.mock.calls[0][1])).not.toContain(OLD_AUDIENCE);
    expect(JSON.stringify(invoke.mock.calls[0][1])).not.toContain(CANONICAL);
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ["platform-admin-api-client", CLIENT] }),
    );
  });

  it("reconciles a suspended client directly without confirmation", async () => {
    const user = userEvent.setup();
    renderCard({
      lifecycleStatus: "suspended",
      protectedResourceType: "btpm_mcp",
      oauthResourceAudience: OLD_AUDIENCE,
    });
    await user.click(
      await screen.findByRole("button", { name: "Reconcile BTPM MCP audience" }),
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Reconcile BTPM MCP audience?")).toBeNull();
  });

  it("requires the reconciliation-specific confirmation for an active client and cancelling mutates nothing", async () => {
    const user = userEvent.setup();
    renderCard({
      lifecycleStatus: "active",
      protectedResourceType: "btpm_mcp",
      oauthResourceAudience: OLD_AUDIENCE,
    });
    await user.click(
      await screen.findByRole("button", { name: "Reconcile BTPM MCP audience" }),
    );
    expect(await screen.findByText("Reconcile BTPM MCP audience?")).toBeTruthy();
    expect(
      screen.getByText(
        "This updates the audience applied to newly issued OAuth access tokens to the current canonical BTPM MCP protected resource. Existing access tokens are not revoked and remain valid until they expire.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("The protected resource remains BTPM MCP.")).toBeTruthy();
    expect(screen.getByText(`Stored audience: ${OLD_AUDIENCE}`)).toBeTruthy();
    expect(screen.getByText(`Canonical audience: ${CANONICAL}`)).toBeTruthy();
    expect(screen.queryByText("New: BTPM MCP")).toBeNull();
    expect(screen.queryByText("Change protected resource?")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("mutates exactly once after confirming active-client reconciliation", async () => {
    const user = userEvent.setup();
    renderCard({
      lifecycleStatus: "active",
      protectedResourceType: "btpm_mcp",
      oauthResourceAudience: OLD_AUDIENCE,
    });
    await user.click(
      await screen.findByRole("button", { name: "Reconcile BTPM MCP audience" }),
    );
    const actions = await screen.findAllByRole("button", { name: "Reconcile BTPM MCP audience" });
    await user.click(actions[actions.length - 1]);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][1]).toEqual({
      body: { api_client_id: CLIENT, resource_type: "btpm_mcp" },
    });
  });

  it("shows the warning but no enabled reconciliation action for a retired client", async () => {
    renderCard({
      lifecycleStatus: "retired",
      protectedResourceType: "btpm_mcp",
      oauthResourceAudience: OLD_AUDIENCE,
    });
    expect(await screen.findByText("Attention required")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Reconcile BTPM MCP audience" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Save protected resource" })).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("cannot reconcile BTPM MCP when the OAuth client binding is missing", async () => {
    renderCard({
      oauthClientId: null,
      protectedResourceType: "btpm_mcp",
      oauthResourceAudience: OLD_AUDIENCE,
    });
    expect(await screen.findByText("Attention required")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Reconcile BTPM MCP audience" }),
    ).toBeNull();
    expect(screen.getByLabelText("None")).not.toBeDisabled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("exposes no reconciliation action when persisted and canonical audiences match", async () => {
    renderCard({ protectedResourceType: "btpm_mcp", oauthResourceAudience: CANONICAL });
    await screen.findByText("Configured for BTPM MCP");
    await waitFor(() => expect(fetchMetadata).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "Reconcile BTPM MCP audience" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Save protected resource" })).toBeNull();
  });

  it("keeps the mismatch warning after a failed reconciliation", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("boom") });
    const user = userEvent.setup();
    renderCard({ protectedResourceType: "btpm_mcp", oauthResourceAudience: OLD_AUDIENCE });
    await user.click(
      await screen.findByRole("button", { name: "Reconcile BTPM MCP audience" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Protected resource could not be saved.")).toBeTruthy(),
    );
    expect(screen.getByText("Attention required")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reconcile BTPM MCP audience" }),
    ).toBeTruthy();
  });
});

describe("UX-MCP-ADMIN.2 — canonical audience mismatch", () => {
  it("warns when the persisted audience differs from canonical metadata", async () => {
    renderCard({
      protectedResourceType: "btpm_mcp",
      oauthResourceAudience: "https://old.supabase.co/functions/v1/btpm-mcp",
    });
    expect(await screen.findByText("Attention required")).toBeTruthy();
    expect(
      screen.getByText(
        "The stored OAuth audience does not match the current BTPM MCP protected resource. Save BTPM MCP again to reconcile it with the canonical server configuration.",
      ),
    ).toBeTruthy();
  });

  it("shows no mismatch warning when values match", async () => {
    renderCard({ protectedResourceType: "btpm_mcp", oauthResourceAudience: CANONICAL });
    await screen.findByText("Configured for BTPM MCP");
    await waitFor(() => expect(fetchMetadata).toHaveBeenCalled());
    expect(screen.queryByText("Attention required")).toBeNull();
  });

  it("keeps the persisted configuration state when metadata is unavailable", async () => {
    fetchMetadata.mockResolvedValue(null);
    renderCard({ protectedResourceType: "btpm_mcp", oauthResourceAudience: CANONICAL });
    expect(await screen.findByText("Configured for BTPM MCP")).toBeTruthy();
    expect(
      screen.getByText("BTPM MCP connection details are temporarily unavailable."),
    ).toBeTruthy();
    expect(screen.queryByText("Attention required")).toBeNull();
  });

  it("does not warn a valid non-MCP client", async () => {
    renderCard();
    await screen.findByText("MCP not configured");
    expect(screen.queryByText("Attention required")).toBeNull();
  });
});

describe("UX-MCP-ADMIN.2 — verification separation", () => {
  it("keeps Not yet verified valid while configured for BTPM MCP", async () => {
    renderCard({ protectedResourceType: "btpm_mcp", oauthResourceAudience: CANONICAL });
    expect(await screen.findByText("Configured for BTPM MCP")).toBeTruthy();
    expect(await screen.findByText("Not yet verified")).toBeTruthy();
  });

  it("distinguishes unavailable verification from Not yet verified", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    renderCard();
    expect(await screen.findByText("Verification status unavailable")).toBeTruthy();
    expect(screen.queryByText("Not yet verified")).toBeNull();
  });

  it("does not remove the obsolete-free verification wording or manufacture evidence", () => {
    expect(CARD_SOURCE).toContain("not a live health check");
    expect(CARD_SOURCE).not.toContain("identical for every Tenant");
  });
});
