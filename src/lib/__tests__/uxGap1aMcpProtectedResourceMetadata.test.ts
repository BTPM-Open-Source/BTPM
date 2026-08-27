/**
 * UX-GAP.1A — Focused guards for the MCP protected-resource metadata reader.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MCP_PROTECTED_RESOURCE_METADATA_PATH,
  buildMcpProtectedResourceMetadataUrl,
  parseMcpProtectedResourceMetadata,
  fetchMcpProtectedResourceMetadata,
} from "../mcpProtectedResourceMetadata";

const VALID = {
  resource: "https://example.supabase.co/functions/v1/btpm-mcp",
  authorization_servers: ["https://example.supabase.co/auth/v1"],
  bearer_methods_supported: ["header"],
};

describe("UX-GAP.1A URL construction", () => {
  it("appends the btpm-mcp protected-resource metadata path to the Supabase base URL", () => {
    expect(buildMcpProtectedResourceMetadataUrl("https://abc.supabase.co")).toBe(
      "https://abc.supabase.co" + MCP_PROTECTED_RESOURCE_METADATA_PATH,
    );
    expect(MCP_PROTECTED_RESOURCE_METADATA_PATH).toBe(
      "/functions/v1/btpm-mcp/.well-known/oauth-protected-resource",
    );
  });

  it("normalizes trailing slashes only", () => {
    expect(buildMcpProtectedResourceMetadataUrl("https://abc.supabase.co///")).toBe(
      "https://abc.supabase.co" + MCP_PROTECTED_RESOURCE_METADATA_PATH,
    );
    expect(buildMcpProtectedResourceMetadataUrl("  https://abc.supabase.co/ ")).toBe(
      "https://abc.supabase.co" + MCP_PROTECTED_RESOURCE_METADATA_PATH,
    );
  });

  it("returns null for empty or malformed base URLs", () => {
    expect(buildMcpProtectedResourceMetadataUrl("")).toBeNull();
    expect(buildMcpProtectedResourceMetadataUrl("   ")).toBeNull();
    expect(buildMcpProtectedResourceMetadataUrl("not-a-url")).toBeNull();
    expect(buildMcpProtectedResourceMetadataUrl(undefined as unknown as string)).toBeNull();
  });
});

describe("UX-GAP.1A validation contract", () => {
  it("accepts a valid metadata document", () => {
    const parsed = parseMcpProtectedResourceMetadata(VALID);
    expect(parsed).not.toBeNull();
    expect(parsed?.resource).toBe(VALID.resource);
    expect(parsed?.authorizationServer).toBe(VALID.authorization_servers[0]);
    expect(parsed?.bearerMethodsSupported).toContain("header");
  });

  it("fails closed on malformed documents", () => {
    const cases: unknown[] = [
      null,
      "string",
      {},
      { ...VALID, resource: "" },
      { ...VALID, resource: "http://example.supabase.co/mcp" },
      { ...VALID, resource: "https://user:pass@example.supabase.co/mcp" },
      { ...VALID, resource: "https://example.supabase.co/mcp#frag" },
      { ...VALID, authorization_servers: [] },
      { ...VALID, authorization_servers: "https://example.supabase.co/auth/v1" },
      { ...VALID, authorization_servers: [""] },
      { ...VALID, bearer_methods_supported: [] },
      { ...VALID, bearer_methods_supported: ["body"] },
      { ...VALID, bearer_methods_supported: "header" },
    ];
    for (const candidate of cases) {
      expect(parseMcpProtectedResourceMetadata(candidate)).toBeNull();
    }
  });
});

describe("UX-GAP.1A fetch behaviour", () => {
  it("issues a GET without an Authorization header and returns validated metadata", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => VALID })) as unknown as typeof fetch;
    const result = await fetchMcpProtectedResourceMetadata("https://abc.supabase.co/", fetchImpl);
    expect(result?.resource).toBe(VALID.resource);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://abc.supabase.co" + MCP_PROTECTED_RESOURCE_METADATA_PATH);
    expect((init as RequestInit).method).toBe("GET");
    expect(JSON.stringify(init)).not.toContain("Authorization");
  });

  it("returns null (no fabricated fallback audience) on failure", async () => {
    const failures: Array<typeof fetch> = [
      (async () => ({ ok: false, json: async () => VALID })) as unknown as typeof fetch,
      (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
      (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch,
    ];
    for (const impl of failures) {
      await expect(
        fetchMcpProtectedResourceMetadata("https://abc.supabase.co", impl),
      ).resolves.toBeNull();
    }
  });
});

describe("UX-GAP.1A containment", () => {
  const SOURCE = readFileSync(
    resolve(process.cwd(), "src/lib/mcpProtectedResourceMetadata.ts"),
    "utf8",
  );
  const CARD = readFileSync(
    resolve(process.cwd(), "src/pages/admin/McpConnectionCard.tsx"),
    "utf8",
  );

  it("performs no Supabase client, RPC or write access", () => {
    for (const src of [SOURCE, CARD]) {
      expect(src).not.toContain("integrations/supabase");
      expect(src).not.toContain(".rpc(");
      expect(src).not.toContain(".insert(");
      expect(src).not.toContain(".update(");
    }
    expect(SOURCE).not.toContain("useMutation");
    expect(CARD).toContain("useMutation");
    expect(CARD).toContain("setApiClientProtectedResource");
  });

  it("does not hardcode a production hostname or fabricate an audience", () => {
    expect(SOURCE).not.toMatch(/https:\/\/[a-z0-9]{20}\.supabase\.co/);
    expect(CARD).not.toMatch(/https:\/\/[a-z0-9]{20}\.supabase\.co/);
    expect(CARD).not.toContain("BTPM_MCP_RESOURCE_URI");
  });

  it("renders no editable control for the audience or authorization server", () => {
    for (const banned of ["<Input", "<Textarea", "<Select", ">Save<", ">Update<", ">Enable<", ">Disable<"]) {
      expect(CARD).not.toContain(banned);
    }
  });

  // UX-GAP.1B2 superseded the original 1B-absence guard: durable verification
  // evidence is now shown by the card, sourced solely from the accepted RPC.
  // The metadata reader itself must still make no verification claim.
  it("keeps the metadata reader free of verification claims", () => {
    expect(SOURCE).not.toMatch(/Verified|Not yet verified|Last successful authentication/);
  });

});
