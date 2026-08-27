/**
 * UX-GAP.1B2 — Focused guards for the MCP connection verification reader.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import {
  MCP_CONNECTION_VERIFICATION_RPC,
  getMcpConnectionVerification,
  parseMcpConnectionVerification,
} from "../mcpConnectionVerificationService";

const TS = "2026-08-17T10:00:00.000Z";
const CLIENT = "33333333-3333-4333-8333-333333333333";

beforeEach(() => rpc.mockReset());

describe("UX-GAP.1B2 RPC contract", () => {
  it("calls exactly the accepted RPC with exactly one argument key", async () => {
    rpc.mockResolvedValue({
      data: [{ verified: true, last_successful_authentication_at: TS }],
      error: null,
    });
    const result = await getMcpConnectionVerification(CLIENT);
    expect(result.verified).toBe(true);
    expect(result.lastSuccessfulAuthenticationAt).toBe(TS);
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("api_g_5_10_get_mcp_connection_verification");
    expect(MCP_CONNECTION_VERIFICATION_RPC).toBe(name);
    expect(Object.keys(args as object)).toEqual(["_api_client_id"]);
    expect((args as Record<string, unknown>)._api_client_id).toBe(CLIENT);
  });

  it("accepts verified=false with a null timestamp", async () => {
    rpc.mockResolvedValue({
      data: [{ verified: false, last_successful_authentication_at: null }],
      error: null,
    });
    const result = await getMcpConnectionVerification(CLIENT);
    expect(result).toEqual({ verified: false, lastSuccessfulAuthenticationAt: null });
  });

  it("requires a non-empty API client ID and performs no RPC", async () => {
    await expect(getMcpConnectionVerification("  ")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not surface raw RPC error text", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'permission denied for function api_g_5_10... SQLSTATE 42501' },
    });
    await expect(getMcpConnectionVerification(CLIENT)).rejects.toThrow(
      "MCP connection verification is unavailable.",
    );
    await getMcpConnectionVerification(CLIENT).catch((e: Error) => {
      expect(e.message).not.toMatch(/permission denied|SQLSTATE|42501/);
    });
  });

  it("fails as unavailable on malformed payloads", async () => {
    for (const data of [null, {}, [], [{}, {}]]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(getMcpConnectionVerification(CLIENT)).rejects.toThrow(
        "MCP connection verification is unavailable.",
      );
    }
  });
});

describe("UX-GAP.1B2 strict validation", () => {
  it("accepts only consistent rows", () => {
    expect(parseMcpConnectionVerification([{ verified: true, last_successful_authentication_at: TS }]))
      .toEqual({ verified: true, lastSuccessfulAuthenticationAt: TS });
    expect(
      parseMcpConnectionVerification([{ verified: false, last_successful_authentication_at: null }]),
    ).toEqual({ verified: false, lastSuccessfulAuthenticationAt: null });
  });

  it("rejects malformed and inconsistent rows", () => {
    const cases: unknown[] = [
      null,
      {},
      [],
      "string",
      [null],
      [{ verified: "true", last_successful_authentication_at: TS }],
      [{ last_successful_authentication_at: TS }],
      [{ verified: true }],
      [{ verified: true, last_successful_authentication_at: null }],
      [{ verified: true, last_successful_authentication_at: "not-a-date" }],
      [{ verified: false, last_successful_authentication_at: TS }],
      [{ verified: true, last_successful_authentication_at: 12345 }],
      [
        { verified: true, last_successful_authentication_at: TS },
        { verified: false, last_successful_authentication_at: null },
      ],
    ];
    for (const candidate of cases) {
      expect(parseMcpConnectionVerification(candidate)).toBeNull();
    }
  });
});

describe("UX-GAP.1B2 containment", () => {
  const SOURCE = readFileSync(
    resolve(process.cwd(), "src/lib/admin/mcpConnectionVerificationService.ts"),
    "utf8",
  );

  it("reads no table and writes nothing", () => {
    for (const banned of [".from(", ".insert(", ".update(", ".delete(", "useMutation"]) {
      expect(SOURCE).not.toContain(banned);
    }
    expect(SOURCE.split(".rpc(").length - 1).toBe(1);
  });
});
