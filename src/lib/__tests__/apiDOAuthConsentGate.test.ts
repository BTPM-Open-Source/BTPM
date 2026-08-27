/**
 * UX-GAP.2B2 — Frontend OAuth → BTPM business-consent gate reader tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

import {
  getApiDOAuthConsentGate,
  sanitizeOAuthClientId,
  API_D_OAUTH_GATE_UNAVAILABLE,
} from "@/lib/apiDOAuthConsentGate";

beforeEach(() => rpc.mockReset());

describe("sanitizeOAuthClientId", () => {
  it("accepts exact canonical identifiers of any length without a max or UUID rule", () => {
    for (
      const ok of [
        "oauth-client-abc",
        "a",
        "9f0c2b7e-1111-4444-8888-aaaaaaaaaaaa",
        "x".repeat(600),
      ]
    ) {
      expect(sanitizeOAuthClientId(ok), ok.slice(0, 12)).toBe(ok);
    }
  });

  it("rejects missing, empty, untrimmed, uppercase and control-char values", () => {
    for (
      const bad of [
        undefined,
        null,
        123,
        {},
        "",
        " abc",
        "abc ",
        "Abc",
        "OAUTH-CLIENT",
        "abc\u0001",
        "abc\ndef",
      ]
    ) {
      expect(sanitizeOAuthClientId(bad as unknown), String(bad)).toBeNull();
    }
  });
});

describe("getApiDOAuthConsentGate", () => {
  it("calls exactly get_api_d_oauth_consent_gate with the exact client id", async () => {
    rpc.mockResolvedValueOnce({
      data: { eligible: true, client_key: "microsoft_copilot", acknowledged: true },
      error: null,
    });
    const gate = await getApiDOAuthConsentGate("oauth-client-abc");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_api_d_oauth_consent_gate", {
      _oauth_client_id: "oauth-client-abc",
    });
    expect(gate).toEqual({
      eligible: true,
      clientKey: "microsoft_copilot",
      acknowledged: true,
    });
  });

  it("returns only { eligible:false } for an ineligible gate", async () => {
    rpc.mockResolvedValueOnce({ data: { eligible: false }, error: null });
    expect(await getApiDOAuthConsentGate("oauth-client-abc")).toEqual({ eligible: false });
  });

  it("throws one bounded unavailable condition on RPC error or malformed payload", async () => {
    const cases: unknown[] = [
      { data: null, error: { message: "SECRET-db-error" } },
      { data: null, error: null },
      { data: "nope", error: null },
      { data: [], error: null },
      { data: { eligible: "true" }, error: null },
      { data: { eligible: true, acknowledged: true }, error: null },
      { data: { eligible: true, client_key: "BAD KEY", acknowledged: true }, error: null },
      { data: { eligible: true, client_key: "btpm.web", acknowledged: "yes" }, error: null },
    ];
    for (const c of cases) {
      rpc.mockResolvedValueOnce(c as never);
      await expect(getApiDOAuthConsentGate("oauth-client-abc")).rejects.toThrow(
        API_D_OAUTH_GATE_UNAVAILABLE,
      );
    }
  });

  it("does not call the RPC for an invalid client id", async () => {
    await expect(getApiDOAuthConsentGate(" Abc ")).rejects.toThrow(
      API_D_OAUTH_GATE_UNAVAILABLE,
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
