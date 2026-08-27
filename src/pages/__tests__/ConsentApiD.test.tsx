/**
 * API-D.4 — Consent page behavior tests.
 *
 * UX-GAP.2A: production capability, no build-time feature flag.
 *
 * Verify the safe-render contract, RPC wiring
 * (acknowledge/revoke only, never OAuth or capability writes), duplicate
 * submission prevention, safe-URI policy link handling, and the absence
 * of any browser storage of consent state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Import after mocks are in place.
import ConsentApiD from "@/pages/ConsentApiD";

function withProviders(initialEntries: string[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/consent/api-d" element={<ConsentApiD />} />
          <Route path="/" element={<div data-testid="home">home</div>} />
          <Route path="/projects" element={<div data-testid="projects">projects</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const eligibleContext = {
  eligible: true,
  client: { display_name: "BTPM Web", client_key: "btpm.web" },
  policy: {
    version: "v1.0.0",
    effective_at: "2026-01-01T00:00:00Z",
    policy_digest: "sha256:abc",
    policy_uri: "https://policies.example.com/v1",
  },
  acknowledged: false,
  organizations: { count: 2, display_names: ["Org A", "Org B"] },
  workspaces: { count: 1, display_names: ["WS 1"] },
  capabilities: [
    {
      api_version: "v1",
      display_name: "List organizations",
      description:
        "Read the list of organizations the authorizing user may access.",
      scope_level: "organization",
    },
    {
      api_version: "v1",
      display_name: "Read Workspace delivery data",
      description:
        "Read approved delivery information in enabled Workspaces.",
      scope_level: "workspace",
    },
  ],
};

let storageSnapshot: {
  localKeys: string[];
  sessionKeys: string[];
  cookie: string;
};

function snapshotStorage() {
  storageSnapshot = {
    localKeys: Object.keys(window.localStorage),
    sessionKeys: Object.keys(window.sessionStorage),
    cookie: document.cookie,
  };
}

function assertNoConsentStateInStorage() {
  const forbidden = [
    "consent",
    "api-d",
    "api_d",
    "apid",
    "policy",
    "acknowledg",
    "btpm.web",
    "correlation",
    "client_key",
  ];
  const scan = (label: string, keys: string[]) => {
    for (const key of keys) {
      for (const needle of forbidden) {
        expect(key.toLowerCase(), `${label} key must not mention API-D consent state`)
          .not.toContain(needle);
      }
    }
  };
  scan("localStorage", Object.keys(window.localStorage));
  scan("sessionStorage", Object.keys(window.sessionStorage));
  for (const needle of forbidden) {
    expect(document.cookie.toLowerCase()).not.toContain(needle);
  }
  // Storage-key surface must not have grown for consent state.
  expect(
    Object.keys(window.localStorage).sort(),
    "localStorage keys must not grow for API-D consent state",
  ).toEqual(storageSnapshot.localKeys.sort());
  expect(
    Object.keys(window.sessionStorage).sort(),
    "sessionStorage keys must not grow for API-D consent state",
  ).toEqual(storageSnapshot.sessionKeys.sort());
  expect(document.cookie, "cookies must not grow for API-D consent state")
    .toBe(storageSnapshot.cookie);
}

beforeEach(() => {
  rpcMock.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
  snapshotStorage();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Client-key and eligibility handling
// ---------------------------------------------------------------------------

describe("API-D.4 consent page — invalid inputs", () => {

  it("shows the generic unavailable state for an invalid client_key, without any RPC call", async () => {
    render(withProviders(["/consent/api-d?client_key=UPPER"]));
    expect(await screen.findByTestId("api-d-consent-unavailable")).toBeInTheDocument();
    expect(rpcMock).not.toHaveBeenCalled();
    assertNoConsentStateInStorage();
  });

  it("shows the generic unavailable state when the RPC returns eligible=false", async () => {
    rpcMock.mockResolvedValueOnce({ data: { eligible: false }, error: null });
    render(withProviders(["/consent/api-d?client_key=btpm.web"]));
    expect(await screen.findByTestId("api-d-consent-unavailable")).toBeInTheDocument();
    // Only the read RPC was invoked; no writes.
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][0]).toBe("get_api_d_consent_context");
    assertNoConsentStateInStorage();
  });

  it("shows the generic unavailable state when the RPC returns an error", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    render(withProviders(["/consent/api-d?client_key=btpm.web"]));
    expect(await screen.findByTestId("api-d-consent-unavailable")).toBeInTheDocument();
    // The raw RPC error must NOT be rendered.
    expect(screen.queryByText(/boom/i)).toBeNull();
  });

  it("shows the generic unavailable state when the RPC returns malformed data", async () => {
    rpcMock.mockResolvedValueOnce({ data: "not-an-object", error: null });
    const first = render(withProviders(["/consent/api-d?client_key=btpm.web"]));
    expect(await screen.findByTestId("api-d-consent-unavailable")).toBeInTheDocument();
    first.unmount();

    // A malformed capabilities array must fail the whole context closed.
    rpcMock.mockReset();
    rpcMock.mockResolvedValueOnce({
      data: { ...eligibleContext, capabilities: "not-an-array" },
      error: null,
    });
    render(withProviders(["/consent/api-d?client_key=btpm.web"]));
    expect(await screen.findByTestId("api-d-consent-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("api-d-consent-page")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Eligible render
// ---------------------------------------------------------------------------

describe("API-D.4 consent page — eligible", () => {

  it("renders only safe fields (policy version/digest/effective + org and workspace display_names) and never leaks raw internal identifiers", async () => {
    rpcMock.mockResolvedValueOnce({ data: eligibleContext, error: null });
    render(withProviders(["/consent/api-d?client_key=btpm.web"]));
    await screen.findByTestId("api-d-consent-page");
    expect(screen.getByTestId("api-d-client-name")).toHaveTextContent("BTPM Web");
    // Effective API-D.2 keys must actually surface in the DOM.
    expect(screen.getByText(/v1\.0\.0/)).toBeInTheDocument();
    expect(screen.getByText(/sha256:abc/)).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01T00:00:00Z/)).toBeInTheDocument();
    expect(screen.getByText(/Organizations: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Org A, Org B/)).toBeInTheDocument();
    expect(screen.getByText(/Workspaces: 1/)).toBeInTheDocument();
    expect(screen.getByText(/WS 1/)).toBeInTheDocument();
    expect(screen.getByText(/business consent only/i)).toBeInTheDocument();
    // Capabilities render in business language only.
    expect(screen.getByText("Application capabilities")).toBeInTheDocument();
    expect(screen.getByText("List organizations")).toBeInTheDocument();
    expect(
      screen.getByText(/Read the list of organizations the authorizing user may access\./),
    ).toBeInTheDocument();
    expect(screen.getByText("Read Workspace delivery data")).toBeInTheDocument();
    expect(
      screen.getByText(/Read approved delivery information in enabled Workspaces\./),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/API v1/).length).toBe(2);
    expect(screen.getByText(/Organization level/)).toBeInTheDocument();
    expect(screen.getByText(/Workspace level/)).toBeInTheDocument();
    expect(
      screen.getByText(/These capabilities are limited to the Organizations and Workspaces shown above/),
    ).toBeInTheDocument();
    for (
      const technical of [
        "capability_key",
        "capability_kind",
        "route_id",
        "route_path",
        "http_method",
      ]
    ) {
      expect(document.body.innerHTML.toLowerCase()).not.toContain(technical);
    }
    // No UUIDs, tokens, or secrets rendered anywhere.
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    for (const bad of ["access_token", "refresh_token", "client_secret", "user_id"]) {
      expect(html.toLowerCase()).not.toContain(bad);
    }
  });

  it("renders the policy URI as a clickable HTTPS link", async () => {
    rpcMock.mockResolvedValueOnce({ data: eligibleContext, error: null });
    render(withProviders(["/consent/api-d?client_key=btpm.web"]));
    const link = await screen.findByTestId("api-d-policy-link");
    expect(link).toHaveAttribute("href", "https://policies.example.com/v1");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("does not render a link for a non-HTTPS or malformed policy URI", async () => {
    for (
      const bad of [
        "http://policies.example.com/v1",
        "javascript:alert(1)",
        "/relative/policy",
      ]
    ) {
      rpcMock.mockReset();
      rpcMock.mockResolvedValueOnce({
        data: {
          ...eligibleContext,
          policy: { ...eligibleContext.policy, policy_uri: bad },
        },
        error: null,
      });
      const { unmount } = render(withProviders(["/consent/api-d?client_key=btpm.web"]));
      await screen.findByTestId("api-d-consent-page");
      expect(screen.queryByTestId("api-d-policy-link")).toBeNull();
      expect(screen.getByTestId("api-d-policy-text")).toBeInTheDocument();
      unmount();
    }
  });

  it("Approve calls only acknowledge_api_d_policy with the sanitized client key and a bounded correlation ID", async () => {
    rpcMock.mockResolvedValueOnce({ data: eligibleContext, error: null });
    rpcMock.mockResolvedValueOnce({
      data: { ok: true, changed: true, acknowledged: true },
      error: null,
    });
    rpcMock.mockResolvedValueOnce({
      data: { ...eligibleContext, acknowledged: true },
      error: null,
    });
    render(withProviders(["/consent/api-d?client_key=btpm.web"]));
    fireEvent.click(await screen.findByTestId("api-d-approve-btn"));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(3));
    const writeCall = rpcMock.mock.calls[1];
    expect(writeCall[0]).toBe("acknowledge_api_d_policy");
    expect(writeCall[1]._client_key).toBe("btpm.web");
    expect(writeCall[1]._correlation_id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    // No unexpected mutation surfaces were called.
    const called = rpcMock.mock.calls.map((c) => c[0]);
    expect(called).not.toContain("revoke_api_d_policy");
    for (const forbidden of ["oauth", "custom_access_token_hook", "grant_capability"]) {
      expect(called.join(",").toLowerCase()).not.toContain(forbidden);
    }
    assertNoConsentStateInStorage();
  });

  it("Deny performs no write RPC and navigates to the validated return_to", async () => {
    rpcMock.mockResolvedValueOnce({ data: eligibleContext, error: null });
    render(
      withProviders(["/consent/api-d?client_key=btpm.web&return_to=%2Fprojects"]),
    );
    fireEvent.click(await screen.findByTestId("api-d-deny-btn"));
    await screen.findByTestId("projects");
    // Only the initial read RPC was called; no writes.
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][0]).toBe("get_api_d_consent_context");
  });

  it("Deny navigates to the safe fallback / when return_to is unsafe", async () => {
    rpcMock.mockResolvedValueOnce({ data: eligibleContext, error: null });
    render(
      withProviders(["/consent/api-d?client_key=btpm.web&return_to=https%3A%2F%2Fevil.example.com"]),
    );
    fireEvent.click(await screen.findByTestId("api-d-deny-btn"));
    await screen.findByTestId("home");
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("Revoke is a separate action, only visible when acknowledged, and calls only revoke_api_d_policy", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { ...eligibleContext, acknowledged: true },
      error: null,
    });
    rpcMock.mockResolvedValueOnce({
      data: { ok: true, changed: true, acknowledged: false },
      error: null,
    });
    rpcMock.mockResolvedValueOnce({
      data: { ...eligibleContext, acknowledged: false },
      error: null,
    });
    render(withProviders(["/consent/api-d?client_key=btpm.web"]));
    const revokeBtn = await screen.findByTestId("api-d-revoke-btn");
    // Approve and Deny are hidden when already acknowledged.
    expect(screen.queryByTestId("api-d-approve-btn")).toBeNull();
    expect(screen.queryByTestId("api-d-deny-btn")).toBeNull();
    fireEvent.click(revokeBtn);
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(3));
    const writeCall = rpcMock.mock.calls[1];
    expect(writeCall[0]).toBe("revoke_api_d_policy");
    expect(writeCall[1]._client_key).toBe("btpm.web");
    expect(writeCall[1]._correlation_id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    const called = rpcMock.mock.calls.map((c) => c[0]);
    expect(called).not.toContain("acknowledge_api_d_policy");
  });

  it("disables duplicate submissions while a command is pending", async () => {
    rpcMock.mockResolvedValueOnce({ data: eligibleContext, error: null });
    // Pending write — never resolves within the test.
    let releaseWrite: (v: unknown) => void = () => {};
    rpcMock.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseWrite = resolve;
      }),
    );
    render(withProviders(["/consent/api-d?client_key=btpm.web"]));
    const approve = await screen.findByTestId("api-d-approve-btn");
    fireEvent.click(approve);
    await waitFor(() => expect(approve).toBeDisabled());
    fireEvent.click(approve);
    fireEvent.click(approve);
    fireEvent.click(screen.getByTestId("api-d-deny-btn"));
    // Only one write RPC was ever dispatched despite multiple clicks.
    const writeCalls = rpcMock.mock.calls.filter(
      (c) => c[0] === "acknowledge_api_d_policy" || c[0] === "revoke_api_d_policy",
    );
    expect(writeCalls.length).toBe(1);
    releaseWrite({ data: { ok: true, changed: true, acknowledged: true }, error: null });
  });
});

// ---------------------------------------------------------------------------
// Strict safe parser on the API-D.2 response
// ---------------------------------------------------------------------------

describe("API-D.4 consent page — strict safe parser (API-D.2 response)", () => {

  const withPatch = (patch: Record<string, unknown>) => ({
    ...eligibleContext,
    ...patch,
  });
  const withPolicy = (patch: Record<string, unknown>) => ({
    ...eligibleContext,
    policy: { ...eligibleContext.policy, ...patch },
  });
  const withClient = (patch: Record<string, unknown>) => ({
    ...eligibleContext,
    client: { ...eligibleContext.client, ...patch },
  });
  const withOrgs = (v: unknown) => ({ ...eligibleContext, organizations: v });
  const withWs = (v: unknown) => ({ ...eligibleContext, workspaces: v });

  const cases: Array<{ name: string; data: unknown }> = [
    { name: "server client_key mismatches requested key", data: withClient({ client_key: "other.app" }) },
    { name: "policy.policy_uri missing", data: withPolicy({ policy_uri: undefined }) },
    { name: "policy.policy_uri wrong type", data: withPolicy({ policy_uri: 123 }) },
    { name: "policy.policy_digest missing", data: withPolicy({ policy_digest: "" }) },
    { name: "policy.version missing", data: withPolicy({ version: null }) },
    { name: "policy.effective_at missing", data: withPolicy({ effective_at: undefined }) },
    { name: "client.display_name missing", data: withClient({ display_name: "" }) },
    { name: "acknowledged is not boolean", data: withPatch({ acknowledged: "false" }) },
    { name: "organizations.count is negative", data: withOrgs({ count: -1, display_names: [] }) },
    { name: "organizations.count is float", data: withOrgs({ count: 1.5, display_names: [] }) },
    { name: "organizations.display_names not array", data: withOrgs({ count: 0, display_names: "Org A" }) },
    { name: "organizations.display_names contains non-string", data: withOrgs({ count: 1, display_names: [42] }) },
    { name: "workspaces missing entirely", data: withWs(undefined) },
    { name: "workspaces.display_names missing", data: withWs({ count: 0 }) },
  ];

  for (const c of cases) {
    it(`renders the generic unavailable state when ${c.name}`, async () => {
      rpcMock.mockResolvedValueOnce({ data: c.data, error: null });
      render(withProviders(["/consent/api-d?client_key=btpm.web"]));
      expect(await screen.findByTestId("api-d-consent-unavailable")).toBeInTheDocument();
      expect(screen.queryByTestId("api-d-consent-page")).toBeNull();
      // Only the read RPC was ever invoked; no writes triggered by malformed data.
      const called = rpcMock.mock.calls.map((call) => call[0]);
      expect(called).toEqual(["get_api_d_consent_context"]);
    });
  }

  it("does not copy unknown fields from the server response into the DOM", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        ...eligibleContext,
        secret_backdoor_token: "SHOULD_NEVER_RENDER",
        client: { ...eligibleContext.client, internal_uuid: "SHOULD_NEVER_RENDER" },
      },
      error: null,
    });
    render(withProviders(["/consent/api-d?client_key=btpm.web"]));
    await screen.findByTestId("api-d-consent-page");
    expect(document.body.innerHTML).not.toContain("SHOULD_NEVER_RENDER");
  });
});

// ---------------------------------------------------------------------------
// Strict command result validation ({ok, acknowledged})
// ---------------------------------------------------------------------------

describe("API-D.4 consent page — command result validation", () => {

  const toastMock = vi.fn();
  beforeEach(() => {
    toastMock.mockReset();
  });

  // Re-mock use-toast so we can observe title calls.
  vi.doMock("@/hooks/use-toast", () => ({
    useToast: () => ({ toast: toastMock }),
  }));

  const failingApproveResponses: Array<{ name: string; data: unknown; error?: unknown }> = [
    { name: "ok:false", data: { ok: false, acknowledged: true } },
    { name: "malformed (not an object)", data: "yes" },
    { name: "missing ok field", data: { acknowledged: true } },
    { name: "acknowledged:false on approve", data: { ok: true, acknowledged: false } },
    { name: "acknowledged missing on approve", data: { ok: true } },
    { name: "server error", data: null, error: { message: "boom" } },
  ];

  for (const c of failingApproveResponses) {
    it(`Approve treats "${c.name}" as failure — no success toast, no ineligible mutation of state`, async () => {
      rpcMock.mockResolvedValueOnce({ data: eligibleContext, error: null });
      rpcMock.mockResolvedValueOnce({ data: c.data ?? null, error: c.error ?? null });
      render(withProviders(["/consent/api-d?client_key=btpm.web"]));
      fireEvent.click(await screen.findByTestId("api-d-approve-btn"));
      await waitFor(() => {
        const called = rpcMock.mock.calls.map((call) => call[0]);
        expect(called).toContain("acknowledge_api_d_policy");
      });
      // Success text must NEVER appear for a failing response.
      await waitFor(() => {
        expect(screen.queryByText(/Acknowledgement recorded/i)).toBeNull();
      });
      // Approve button remains available (page still on the not-acknowledged branch).
      expect(screen.getByTestId("api-d-approve-btn")).toBeInTheDocument();
      expect(screen.queryByTestId("api-d-acknowledged-status")).toBeNull();
    });
  }

  const failingRevokeResponses: Array<{ name: string; data: unknown; error?: unknown }> = [
    { name: "ok:false", data: { ok: false, acknowledged: false } },
    { name: "malformed (array)", data: [] },
    { name: "acknowledged:true on revoke", data: { ok: true, acknowledged: true } },
    { name: "server error", data: null, error: { message: "boom" } },
  ];

  for (const c of failingRevokeResponses) {
    it(`Revoke treats "${c.name}" as failure — no success toast, still shows acknowledged status`, async () => {
      rpcMock.mockResolvedValueOnce({
        data: { ...eligibleContext, acknowledged: true },
        error: null,
      });
      rpcMock.mockResolvedValueOnce({ data: c.data ?? null, error: c.error ?? null });
      render(withProviders(["/consent/api-d?client_key=btpm.web"]));
      fireEvent.click(await screen.findByTestId("api-d-revoke-btn"));
      await waitFor(() => {
        const called = rpcMock.mock.calls.map((call) => call[0]);
        expect(called).toContain("revoke_api_d_policy");
      });
      await waitFor(() => {
        expect(screen.queryByText(/Acknowledgement revoked/i)).toBeNull();
      });
      // Still on the acknowledged branch.
      expect(screen.getByTestId("api-d-revoke-btn")).toBeInTheDocument();
    });
  }
});
