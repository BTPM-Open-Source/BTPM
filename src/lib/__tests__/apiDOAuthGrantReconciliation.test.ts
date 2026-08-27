/**
 * UX-GAP.2B3A — Focused tests for the pre-authorization stale OAuth grant
 * reconciliation helper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const listGrants = vi.fn();
const revokeGrant = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      oauth: {
        listGrants: (...a: unknown[]) => listGrants(...a),
        revokeGrant: (...a: unknown[]) => revokeGrant(...a),
      },
    },
    rpc: vi.fn(),
  },
}));

const getGate = vi.fn();
vi.mock("@/lib/apiDOAuthConsentGate", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/apiDOAuthConsentGate")
  >("@/lib/apiDOAuthConsentGate");
  return {
    ...actual,
    getApiDOAuthConsentGate: (...a: unknown[]) => getGate(...a),
  };
});

import {
  reconcileBtpmOAuthGrantsBeforeAuthorization,
  BTPM_OAUTH_GRANT_RECONCILIATION_UNAVAILABLE as UNAVAILABLE,
} from "@/lib/apiDOAuthGrantReconciliation";

const SOURCE = readFileSync(
  resolve(__dirname, "../apiDOAuthGrantReconciliation.ts"),
  "utf8",
);

const grant = (id: string, extra: Record<string, unknown> = {}) => ({
  id: `grant-${id}`,
  client: { id, name: "Some App", redirect_uri: "https://evil.example" },
  scopes: ["openid"],
  ...extra,
});

beforeEach(() => {
  listGrants.mockReset();
  revokeGrant.mockReset();
  getGate.mockReset();
  revokeGrant.mockResolvedValue({ error: null });
});

describe("A. empty grant list", () => {
  it("returns 0/0 and never calls the gate or revoke", async () => {
    listGrants.mockResolvedValueOnce({ data: [], error: null });
    expect(await reconcileBtpmOAuthGrantsBeforeAuthorization()).toEqual({
      revokedGrantCount: 0,
      unresolvedGrantCount: 0,
    });
    expect(getGate).not.toHaveBeenCalled();
    expect(revokeGrant).not.toHaveBeenCalled();
  });
});

describe("B. acknowledged BTPM grant", () => {
  it("leaves the grant untouched", async () => {
    listGrants.mockResolvedValueOnce({ data: [grant("oauth-client-a")], error: null });
    getGate.mockResolvedValueOnce({ eligible: true, clientKey: "app_a", acknowledged: true });
    expect(await reconcileBtpmOAuthGrantsBeforeAuthorization()).toEqual({
      revokedGrantCount: 0,
      unresolvedGrantCount: 0,
    });
    expect(revokeGrant).not.toHaveBeenCalled();
  });
});

describe("C. stale BTPM grant", () => {
  it("revokes exactly the one exact client id", async () => {
    listGrants.mockResolvedValueOnce({ data: [grant("oauth-client-b")], error: null });
    getGate.mockResolvedValueOnce({ eligible: true, clientKey: "app_b", acknowledged: false });
    expect(await reconcileBtpmOAuthGrantsBeforeAuthorization()).toEqual({
      revokedGrantCount: 1,
      unresolvedGrantCount: 0,
    });
    expect(revokeGrant).toHaveBeenCalledTimes(1);
    expect(revokeGrant).toHaveBeenCalledWith({ clientId: "oauth-client-b" });
  });
});

describe("D. unresolved grant", () => {
  it("counts eligible=false without revoking", async () => {
    listGrants.mockResolvedValueOnce({ data: [grant("oauth-client-c")], error: null });
    getGate.mockResolvedValueOnce({ eligible: false });
    expect(await reconcileBtpmOAuthGrantsBeforeAuthorization()).toEqual({
      revokedGrantCount: 0,
      unresolvedGrantCount: 1,
    });
    expect(revokeGrant).not.toHaveBeenCalled();
  });
});

describe("E. mixed list", () => {
  it("revokes only the stale exact client", async () => {
    listGrants.mockResolvedValueOnce({
      data: [grant("client-ack"), grant("client-stale"), grant("client-unresolved")],
      error: null,
    });
    getGate
      .mockResolvedValueOnce({ eligible: true, clientKey: "ack", acknowledged: true })
      .mockResolvedValueOnce({ eligible: true, clientKey: "stale", acknowledged: false })
      .mockResolvedValueOnce({ eligible: false });
    expect(await reconcileBtpmOAuthGrantsBeforeAuthorization()).toEqual({
      revokedGrantCount: 1,
      unresolvedGrantCount: 1,
    });
    expect(revokeGrant).toHaveBeenCalledTimes(1);
    expect(revokeGrant).toHaveBeenCalledWith({ clientId: "client-stale" });
  });
});

describe("F. exact identity", () => {
  it("correlates only by grant.client.id", async () => {
    listGrants.mockResolvedValueOnce({ data: [grant("client-stale")], error: null });
    getGate.mockResolvedValueOnce({ eligible: true, clientKey: "k", acknowledged: false });
    await reconcileBtpmOAuthGrantsBeforeAuthorization();
    expect(getGate).toHaveBeenCalledWith("client-stale");
    for (const forbidden of ["name", "redirect", "scope", "tenant", "workspace", "organization"]) {
      expect(SOURCE.toLowerCase()).not.toContain(`.${forbidden}`);
    }
  });
});

describe("G. sequential behavior", () => {
  it("does not evaluate the second gate before the first settles", async () => {
    listGrants.mockResolvedValueOnce({ data: [grant("c1"), grant("c2")], error: null });
    let release: (v: unknown) => void = () => {};
    getGate
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            release = () => res({ eligible: false });
          }),
      )
      .mockResolvedValueOnce({ eligible: false });
    const promise = reconcileBtpmOAuthGrantsBeforeAuthorization();
    await Promise.resolve();
    await Promise.resolve();
    expect(getGate).toHaveBeenCalledTimes(1);
    release(null);
    expect(await promise).toEqual({ revokedGrantCount: 0, unresolvedGrantCount: 2 });
    expect(getGate).toHaveBeenCalledTimes(2);
    expect(SOURCE).not.toContain("Promise.all");
  });
});

describe("H. duplicate client ids", () => {
  it("fails closed without deduplicating", async () => {
    listGrants.mockResolvedValueOnce({
      data: [grant("dup-client"), grant("dup-client")],
      error: null,
    });
    await expect(reconcileBtpmOAuthGrantsBeforeAuthorization()).rejects.toThrow(UNAVAILABLE);
    expect(getGate).not.toHaveBeenCalled();
    expect(revokeGrant).not.toHaveBeenCalled();
  });
});

describe("I. malformed and error cases", () => {
  it("throws only the bounded marker", async () => {
    const secret = "SECRET-db-error";

    const cases: Array<() => void> = [
      () => listGrants.mockResolvedValueOnce({ data: null, error: { message: secret } }),
      () => listGrants.mockRejectedValueOnce(new Error(secret)),
      () => listGrants.mockResolvedValueOnce({ data: { nope: true }, error: null }),
      () => listGrants.mockResolvedValueOnce({ data: [{ id: "g" }], error: null }),
      () => listGrants.mockResolvedValueOnce({ data: [{ client: { id: " Bad " } }], error: null }),
      () => listGrants.mockResolvedValueOnce({ data: [{ client: { id: "" } }], error: null }),
      () => {
        listGrants.mockResolvedValueOnce({ data: [grant("c-gate")], error: null });
        getGate.mockRejectedValueOnce(new Error(secret));
      },
      () => {
        listGrants.mockResolvedValueOnce({ data: [grant("c-rev")], error: null });
        getGate.mockResolvedValueOnce({ eligible: true, clientKey: "k", acknowledged: false });
        revokeGrant.mockResolvedValueOnce({ error: { message: secret } });
      },
      () => {
        listGrants.mockResolvedValueOnce({ data: [grant("c-rev2")], error: null });
        getGate.mockResolvedValueOnce({ eligible: true, clientKey: "k", acknowledged: false });
        revokeGrant.mockRejectedValueOnce(new Error(secret));
      },
      () => {
        listGrants.mockResolvedValueOnce({ data: [grant("c-rev3")], error: null });
        getGate.mockResolvedValueOnce({ eligible: true, clientKey: "k", acknowledged: false });
        revokeGrant.mockResolvedValueOnce("nope" as never);
      },
    ];

    for (const [i, setup] of cases.entries()) {
      setup();
      let message = "";
      try {
        await reconcileBtpmOAuthGrantsBeforeAuthorization();
        throw new Error(`case ${i} did not throw`);
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message, `case ${i}`).toBe(UNAVAILABLE);
      expect(message).not.toContain(secret);
    }
  });
});

describe("J. no over-revocation", () => {
  it("only revokes from the eligible && !acknowledged branch", async () => {
    expect(SOURCE.match(/revokeGrant\(/g) ?? []).toHaveLength(1);
    expect(SOURCE).toContain("if (gate.acknowledged) continue;");
    expect(SOURCE).not.toMatch(/revoke\s*(everything|all)/i);
  });
});

describe("K. no persistence", () => {
  it("uses no browser storage", async () => {
    for (const api of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
      expect(SOURCE).not.toContain(api);
    }
  });
});
