/**
 * API-H.3B — OAuthConsent page tests.
 *
 * Verifies:
 *  - Invalid/missing authorization_id does not call any OAuth method.
 *  - The documented nested `client.name` + singular space-separated `scope`
 *    response renders safe application, Tenant, account, redirect and
 *    permission information only.
 *  - Approve / Deny each execute once and navigate only to a validated
 *    returned redirect_url.
 *  - Already-consented short-circuit (no authorization_id) uses only a
 *    validated returned redirect_url.
 *  - Unsafe redirect URLs are rejected.
 *  - Raw Supabase errors and the authorization_id are never rendered.
 *  - App.tsx registers /oauth/consent as AuthGuardedRoute → TenantAdminGuard
 *    → OAuthConsent, and AuthGuardedRoute preserves pathname + search as the
 *    signed-out returnTo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const getAuthorizationDetails = vi.fn();
const rpc = vi.fn();
const approveAuthorization = vi.fn();
const denyAuthorization = vi.fn();
/** UX-GAP.2B3B — ordering trace shared by the reconciliation wiring tests. */
const events: string[] = [];
const reconcile = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      oauth: {
        getAuthorizationDetails: (...a: unknown[]) => {
          events.push("authorization-details");
          return getAuthorizationDetails(...a);
        },
        approveAuthorization: (...a: unknown[]) => approveAuthorization(...a),
        denyAuthorization: (...a: unknown[]) => denyAuthorization(...a),
      },
    },
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));

vi.mock("@/lib/apiDOAuthGrantReconciliation", () => ({
  BTPM_OAUTH_GRANT_RECONCILIATION_UNAVAILABLE:
    "btpm_oauth_grant_reconciliation_unavailable",
  reconcileBtpmOAuthGrantsBeforeAuthorization: (...a: unknown[]) => reconcile(...a),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1", email: "pm@example.com" } }),
}));

vi.mock("@/context/ActiveContextProvider", () => ({
  useActiveContext: () => ({ activeTenant: { id: "t1", name: "Example Tenant" } }),
}));


import OAuthConsent from "@/pages/OAuthConsent";
import { useLocation } from "react-router-dom";

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location-probe">{location.pathname + location.search}</div>
  );
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/oauth/consent" element={<OAuthConsent />} />
        <Route path="/consent/api-d" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** UX-GAP.2B2 — default gate: eligible + already acknowledged. */
function gateAcknowledged(acknowledged: boolean) {
  rpc.mockResolvedValue({
    data: { eligible: true, client_key: "microsoft_copilot", acknowledged },
    error: null,
  });
}

const originalLocation = window.location;
let assignSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getAuthorizationDetails.mockReset();
  rpc.mockReset();
  gateAcknowledged(true);
  approveAuthorization.mockReset();
  denyAuthorization.mockReset();
  events.length = 0;
  reconcile.mockReset();
  reconcile.mockImplementation(async () => {
    events.push("reconcile:start");
    await Promise.resolve();
    events.push("reconcile:end");
    return { revokedGrantCount: 0, unresolvedGrantCount: 0 };
  });

  assignSpy = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, assign: assignSpy },
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

/** Documented Supabase authorization-details shape. */
const validDetails = {
  data: {
    authorization_id: "auth-abc-123",
    client: { id: "oauth-client-abc", name: "External Reporting App" },
    redirect_uri: "https://app.example.com/oauth/callback",
    scope: "openid profile email",
  },
};

describe("API-H.3B OAuthConsent — input validation", () => {
  it("does not call getAuthorizationDetails when authorization_id is missing", () => {
    renderAt("/oauth/consent");
    expect(getAuthorizationDetails).not.toHaveBeenCalled();
    expect(screen.getByTestId("oauth-consent-unavailable")).toBeTruthy();
  });

  it("does not call getAuthorizationDetails for an empty/whitespace authorization_id", () => {
    renderAt("/oauth/consent?authorization_id=%20%20");
    expect(getAuthorizationDetails).not.toHaveBeenCalled();
    expect(screen.getByTestId("oauth-consent-unavailable")).toBeTruthy();
  });

  it("does not call getAuthorizationDetails for authorization_id longer than 512 chars", () => {
    const long = "a".repeat(513);
    renderAt(`/oauth/consent?authorization_id=${long}`);
    expect(getAuthorizationDetails).not.toHaveBeenCalled();
    expect(screen.getByTestId("oauth-consent-unavailable")).toBeTruthy();
  });

  it("does not call getAuthorizationDetails when authorization_id contains control characters", () => {
    renderAt(`/oauth/consent?authorization_id=${encodeURIComponent("bad\u0001id")}`);
    expect(getAuthorizationDetails).not.toHaveBeenCalled();
    expect(screen.getByTestId("oauth-consent-unavailable")).toBeTruthy();
  });
});

describe("API-H.3B OAuthConsent — safe render", () => {
  it("renders application, tenant, account, redirect and readable permissions only", async () => {
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    renderAt("/oauth/consent?authorization_id=auth-abc-123");

    await waitFor(() => expect(screen.getByTestId("oauth-consent-page")).toBeTruthy());

    expect(screen.getByText("Authorize application access")).toBeTruthy();
    expect(screen.getByTestId("oauth-client-name").textContent).toBe(
      "External Reporting App",
    );
    expect(screen.getByTestId("oauth-tenant-name").textContent).toBe("Example Tenant");
    expect(screen.getByTestId("oauth-account-email").textContent).toBe("pm@example.com");
    expect(screen.getByTestId("oauth-redirect-uri").textContent).toBe(
      "https://app.example.com/oauth/callback",
    );

    const scopeItems = screen.getByTestId("oauth-scopes").querySelectorAll("li");
    expect(Array.from(scopeItems).map((li) => li.textContent)).toEqual([
      "Verify your BTPM sign-in identity",
      "Read your basic BTPM profile",
      "Read your BTPM account email address",
    ]);

    // authorization_id must not appear in the rendered DOM.
    expect(document.body.textContent ?? "").not.toContain("auth-abc-123");

    // Single fetch even under re-renders.
    expect(getAuthorizationDetails).toHaveBeenCalledTimes(1);
    expect(getAuthorizationDetails).toHaveBeenCalledWith("auth-abc-123");
  });

  it("does not render raw Supabase error content when the call fails", async () => {
    getAuthorizationDetails.mockResolvedValueOnce({
      data: null,
      error: { message: "SECRET-error-marker-xyz" },
    });
    renderAt("/oauth/consent?authorization_id=auth-err-1");

    await waitFor(() =>
      expect(screen.getByTestId("oauth-consent-unavailable")).toBeTruthy(),
    );
    expect(document.body.textContent ?? "").not.toContain("SECRET-error-marker-xyz");
    expect(document.body.textContent ?? "").not.toContain("auth-err-1");
  });
});

describe("API-H.3B OAuthConsent — approve", () => {
  it("calls approveAuthorization once and navigates to a validated redirect_url", async () => {
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    approveAuthorization.mockResolvedValueOnce({
      data: { redirect_url: "https://app.example.com/oauth/callback?code=xyz" },
    });

    renderAt("/oauth/consent?authorization_id=auth-approve-1");
    await waitFor(() => screen.getByTestId("oauth-approve-btn"));

    fireEvent.click(screen.getByTestId("oauth-approve-btn"));
    // Duplicate click must be suppressed.
    fireEvent.click(screen.getByTestId("oauth-approve-btn"));

    await waitFor(() => expect(approveAuthorization).toHaveBeenCalledTimes(1));
    expect(approveAuthorization).toHaveBeenCalledWith("auth-approve-1");
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith(
        "https://app.example.com/oauth/callback?code=xyz",
      ),
    );
    expect(assignSpy).toHaveBeenCalledTimes(1);
    expect(denyAuthorization).not.toHaveBeenCalled();
  });

  it("rejects unsafe redirect URLs from approve", async () => {
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    approveAuthorization.mockResolvedValueOnce({
      data: { redirect_url: "javascript:alert(1)" },
    });

    renderAt("/oauth/consent?authorization_id=auth-approve-bad");
    await waitFor(() => screen.getByTestId("oauth-approve-btn"));
    fireEvent.click(screen.getByTestId("oauth-approve-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("oauth-consent-unavailable")).toBeTruthy(),
    );
    expect(assignSpy).not.toHaveBeenCalled();
  });
});

describe("API-H.3B OAuthConsent — deny", () => {
  it("calls denyAuthorization once and navigates to a validated redirect_url", async () => {
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    denyAuthorization.mockResolvedValueOnce({
      data: { redirect_url: "https://app.example.com/oauth/callback?error=access_denied" },
    });

    renderAt("/oauth/consent?authorization_id=auth-deny-1");
    await waitFor(() => screen.getByTestId("oauth-deny-btn"));
    fireEvent.click(screen.getByTestId("oauth-deny-btn"));
    fireEvent.click(screen.getByTestId("oauth-deny-btn"));

    await waitFor(() => expect(denyAuthorization).toHaveBeenCalledTimes(1));
    expect(denyAuthorization).toHaveBeenCalledWith("auth-deny-1");
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith(
        "https://app.example.com/oauth/callback?error=access_denied",
      ),
    );
    expect(approveAuthorization).not.toHaveBeenCalled();
  });

  it("rejects unsafe redirect URLs from deny (fragment/userinfo/http-nonlocal)", async () => {
    for (const badUrl of [
      "https://app.example.com/cb#fragment",
      "https://user:pass@app.example.com/cb",
      "http://evil.example.com/cb",
      "ftp://app.example.com/cb",
      "not a url",
    ]) {
      getAuthorizationDetails.mockResolvedValueOnce(validDetails);
      denyAuthorization.mockResolvedValueOnce({ data: { redirect_url: badUrl } });
      renderAt("/oauth/consent?authorization_id=auth-deny-bad");
      await waitFor(() => screen.getByTestId("oauth-deny-btn"));
      fireEvent.click(screen.getByTestId("oauth-deny-btn"));
      await waitFor(() =>
        expect(screen.getByTestId("oauth-consent-unavailable")).toBeTruthy(),
      );
      cleanup();
    }
    expect(assignSpy).not.toHaveBeenCalled();
  });
});

describe("API-H.3B OAuthConsent — already-consented short-circuit", () => {
  it("navigates when details omit authorization_id and return a validated redirect_url", async () => {
    getAuthorizationDetails.mockResolvedValueOnce({
      data: { redirect_url: "https://app.example.com/oauth/callback?code=preapproved" },
    });
    renderAt("/oauth/consent?authorization_id=auth-preapproved");
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith(
        "https://app.example.com/oauth/callback?code=preapproved",
      ),
    );
    expect(approveAuthorization).not.toHaveBeenCalled();
    expect(denyAuthorization).not.toHaveBeenCalled();
    // UX-GAP.2B2: the BTPM gate is deliberately NOT evaluated on this branch.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects an unsafe short-circuit redirect_url", async () => {
    getAuthorizationDetails.mockResolvedValueOnce({
      data: { redirect_url: "http://evil.example.com/cb" },
    });
    renderAt("/oauth/consent?authorization_id=auth-preapproved-bad");
    await waitFor(() =>
      expect(screen.getByTestId("oauth-consent-unavailable")).toBeTruthy(),
    );
    expect(assignSpy).not.toHaveBeenCalled();
  });
});

describe("API-H.3B OAuthConsent — routing registration", () => {
  const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

  it("registers /oauth/consent as AuthGuardedRoute → OAuthConsent (API-Q.5)", () => {
    const re =
      /<Route\s+path="\/oauth\/consent"\s+element=\{<AuthGuardedRoute><OAuthConsent\s*\/><\/AuthGuardedRoute>\}\s*\/>/;
    expect(re.test(appSource)).toBe(true);
  });

  it("preserves pathname + search (including authorization_id) as the signed-out returnTo", () => {
    expect(appSource).toContain("const returnTo = location.pathname + location.search;");
    expect(appSource).toContain(
      "<Navigate to={`/auth?returnTo=${encodeURIComponent(returnTo)}`} replace />",
    );
  });
});

describe("UX-GAP.2B2 OAuthConsent — BTPM business-consent orchestration", () => {
  it("A. correlates the gate only by exact data.client.id", async () => {
    getAuthorizationDetails.mockResolvedValueOnce({
      data: {
        authorization_id: "auth-abc-123",
        client: { id: "oauth-client-abc", name: "External App" },
        redirect_uri: "https://app.example.com/oauth/callback",
        scope: "openid",
      },
    });
    renderAt("/oauth/consent?authorization_id=auth-abc-123");
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith("get_api_d_oauth_consent_gate", {
      _oauth_client_id: "oauth-client-abc",
    });
  });

  it("B. renders the existing OAuth consent page when already acknowledged", async () => {
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    renderAt("/oauth/consent?authorization_id=auth-abc-123");
    await waitFor(() => expect(screen.getByTestId("oauth-consent-page")).toBeTruthy());
    expect(screen.getByTestId("oauth-approve-btn")).toBeTruthy();
    expect(screen.queryByTestId("location-probe")).toBeNull();
  });

  it("C. first-time missing acknowledgement navigates to the API-D consent path", async () => {
    gateAcknowledged(false);
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    renderAt("/oauth/consent?authorization_id=auth-abc-123");

    await waitFor(() => expect(screen.getByTestId("location-probe")).toBeTruthy());
    const path = screen.getByTestId("location-probe").textContent ?? "";
    expect(path.startsWith("/consent/api-d?")).toBe(true);
    expect(path).toContain("client_key=microsoft_copilot");
    const returnTo = decodeURIComponent(
      new URLSearchParams(path.split("?")[1]).get("return_to") ?? "",
    );
    expect(returnTo).toBe(
      "/oauth/consent?authorization_id=auth-abc-123&btpm_policy_return=1",
    );
    expect(approveAuthorization).toHaveBeenCalledTimes(0);
    expect(denyAuthorization).toHaveBeenCalledTimes(0);
  });

  it("D. marker + acknowledged renders the OAuth consent screen without redirect", async () => {
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    renderAt("/oauth/consent?authorization_id=auth-abc-123&btpm_policy_return=1");
    await waitFor(() => expect(screen.getByTestId("oauth-consent-page")).toBeTruthy());
    expect(screen.queryByTestId("location-probe")).toBeNull();
  });

  it("E. marker + not acknowledged renders the blocked state without OAuth Approve", async () => {
    gateAcknowledged(false);
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    renderAt("/oauth/consent?authorization_id=auth-abc-123&btpm_policy_return=1");

    await waitFor(() =>
      expect(screen.getByTestId("oauth-consent-policy-required")).toBeTruthy(),
    );
    expect(screen.getByText("BTPM policy consent required")).toBeTruthy();
    expect(screen.queryByTestId("oauth-approve-btn")).toBeNull();
    expect(screen.queryByTestId("location-probe")).toBeNull();

    fireEvent.click(screen.getByTestId("oauth-review-policy-btn"));
    await waitFor(() => expect(screen.getByTestId("location-probe")).toBeTruthy());
    expect(screen.getByTestId("location-probe").textContent ?? "").toContain(
      "/consent/api-d?client_key=microsoft_copilot",
    );
  });

  it("E. blocked-state Deny calls denyAuthorization once with a validated redirect_url", async () => {
    gateAcknowledged(false);
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    denyAuthorization.mockResolvedValueOnce({
      data: { redirect_url: "https://app.example.com/oauth/callback?error=access_denied" },
    });
    renderAt("/oauth/consent?authorization_id=auth-deny-policy&btpm_policy_return=1");

    await waitFor(() => screen.getByTestId("oauth-policy-deny-btn"));
    const denyBtn = screen.getByTestId("oauth-policy-deny-btn");
    fireEvent.click(denyBtn);
    fireEvent.click(denyBtn);

    await waitFor(() => expect(denyAuthorization).toHaveBeenCalledTimes(1));
    expect(denyAuthorization).toHaveBeenCalledWith("auth-deny-policy");
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith(
        "https://app.example.com/oauth/callback?error=access_denied",
      ),
    );
    expect(approveAuthorization).not.toHaveBeenCalled();
  });

  it("F. ineligible / RPC error / malformed gate fails closed to the generic state", async () => {
    for (
      const gate of [
        { data: { eligible: false }, error: null },
        { data: null, error: { message: "SECRET-gate-error" } },
        { data: { eligible: true, client_key: "BAD KEY", acknowledged: true }, error: null },
      ]
    ) {
      rpc.mockReset();
      rpc.mockResolvedValue(gate as never);
      getAuthorizationDetails.mockResolvedValueOnce(validDetails);
      renderAt("/oauth/consent?authorization_id=auth-gate-bad");
      await waitFor(() =>
        expect(screen.getByTestId("oauth-consent-unavailable")).toBeTruthy(),
      );
      const body = document.body.textContent ?? "";
      expect(screen.queryByTestId("oauth-approve-btn")).toBeNull();
      expect(body).not.toContain("SECRET-gate-error");
      expect(body).not.toContain("microsoft_copilot");
      expect(body).not.toContain("oauth-client-abc");
      expect(body).not.toContain("auth-gate-bad");
      cleanup();
    }
  });

  it("G. rejects missing/empty/untrimmed/uppercase/control-char client ids without any gate call", async () => {
    for (
      const badId of [undefined, "", " oauth-client-abc", "oauth-client-abc ", "OAuth-Client", "bad\u0001id"]
    ) {
      rpc.mockClear();
      getAuthorizationDetails.mockResolvedValueOnce({
        data: {
          authorization_id: "auth-badid",
          client: { id: badId, name: "External App" },
          redirect_uri: "https://app.example.com/oauth/callback",
          scope: "openid",
        },
      });
      renderAt("/oauth/consent?authorization_id=auth-badid");
      await waitFor(() =>
        expect(screen.getByTestId("oauth-consent-unavailable")).toBeTruthy(),
      );
      expect(rpc).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("I. introduces no browser-storage orchestration state", async () => {
    gateAcknowledged(false);
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    renderAt("/oauth/consent?authorization_id=auth-abc-123");
    await waitFor(() => expect(screen.getByTestId("location-probe")).toBeTruthy());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });
});

describe("UX-GAP.2B3B OAuthConsent — pre-authorization grant reconciliation wiring", () => {
  it("A. reconciliation settles before getAuthorizationDetails", async () => {
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    renderAt("/oauth/consent?authorization_id=auth-abc-123");
    await waitFor(() => expect(screen.getByTestId("oauth-consent-page")).toBeTruthy());
    expect(events).toEqual(["reconcile:start", "reconcile:end", "authorization-details"]);
  });

  it("B. reconciliation failure fails closed without evaluating the request", async () => {
    reconcile.mockReset();
    reconcile.mockRejectedValue(
      new Error("btpm_oauth_grant_reconciliation_unavailable"),
    );
    renderAt("/oauth/consent?authorization_id=auth-recon-fail");
    await waitFor(() =>
      expect(screen.getByTestId("oauth-consent-unavailable")).toBeTruthy(),
    );
    expect(getAuthorizationDetails).toHaveBeenCalledTimes(0);
    expect(approveAuthorization).toHaveBeenCalledTimes(0);
    expect(denyAuthorization).toHaveBeenCalledTimes(0);
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("btpm_oauth_grant_reconciliation_unavailable");
    expect(body).not.toContain("auth-recon-fail");
  });

  it("C. no stale grants (0/0) proceeds with normal OAuth behavior", async () => {
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    renderAt("/oauth/consent?authorization_id=auth-abc-123");
    await waitFor(() => expect(screen.getByTestId("oauth-consent-page")).toBeTruthy());
    expect(screen.getByTestId("oauth-approve-btn")).toBeTruthy();
  });

  it("D. unresolved grants are non-blocking", async () => {
    reconcile.mockReset();
    reconcile.mockResolvedValue({ revokedGrantCount: 0, unresolvedGrantCount: 3 });
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    renderAt("/oauth/consent?authorization_id=auth-abc-123");
    await waitFor(() => expect(screen.getByTestId("oauth-consent-page")).toBeTruthy());
    expect(getAuthorizationDetails).toHaveBeenCalledTimes(1);
    expect(document.body.textContent ?? "").not.toContain("3");
  });

  it("E. revoked stale grant then unacknowledged gate routes to /consent/api-d", async () => {
    reconcile.mockReset();
    reconcile.mockImplementation(async () => {
      events.push("reconcile:start");
      await Promise.resolve();
      events.push("reconcile:end");
      return { revokedGrantCount: 1, unresolvedGrantCount: 0 };
    });
    gateAcknowledged(false);
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    renderAt("/oauth/consent?authorization_id=auth-abc-123");
    await waitFor(() => expect(screen.getByTestId("location-probe")).toBeTruthy());
    expect(events).toEqual(["reconcile:start", "reconcile:end", "authorization-details"]);
    expect(screen.getByTestId("location-probe").textContent ?? "").toContain(
      "/consent/api-d?client_key=microsoft_copilot",
    );
    expect(approveAuthorization).toHaveBeenCalledTimes(0);
    expect(denyAuthorization).toHaveBeenCalledTimes(0);
  });

  it("F. return after acknowledgement reaches the normal OAuth consent screen", async () => {
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    renderAt("/oauth/consent?authorization_id=auth-abc-123&btpm_policy_return=1");
    await waitFor(() => expect(screen.getByTestId("oauth-consent-page")).toBeTruthy());
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("oauth-approve-btn")).toBeTruthy();
  });

  it("G. already-consented short-circuit still redirects after reconciliation", async () => {
    getAuthorizationDetails.mockResolvedValueOnce({
      data: { redirect_url: "https://app.example.com/oauth/callback?code=preapproved" },
    });
    renderAt("/oauth/consent?authorization_id=auth-preapproved");
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith(
        "https://app.example.com/oauth/callback?code=preapproved",
      ),
    );
    expect(events).toEqual(["reconcile:start", "reconcile:end", "authorization-details"]);
    // No client-identity inference from the redirect URL.
    expect(rpc).not.toHaveBeenCalled();
    expect(approveAuthorization).not.toHaveBeenCalled();
    expect(denyAuthorization).not.toHaveBeenCalled();
  });

  it("H. reconciliation runs exactly once per mounted authorization page", async () => {
    getAuthorizationDetails.mockResolvedValueOnce(validDetails);
    const view = renderAt("/oauth/consent?authorization_id=auth-abc-123");
    await waitFor(() => expect(screen.getByTestId("oauth-consent-page")).toBeTruthy());
    view.rerender(
      <MemoryRouter initialEntries={["/oauth/consent?authorization_id=auth-abc-123"]}>
        <Routes>
          <Route path="/oauth/consent" element={<OAuthConsent />} />
          <Route path="/consent/api-d" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("oauth-consent-page")).toBeTruthy());
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(getAuthorizationDetails).toHaveBeenCalledTimes(1);
  });

  it("I. invalid authorization_id never triggers reconciliation", () => {
    renderAt("/oauth/consent");
    expect(reconcile).not.toHaveBeenCalled();
    expect(getAuthorizationDetails).not.toHaveBeenCalled();
  });
});
