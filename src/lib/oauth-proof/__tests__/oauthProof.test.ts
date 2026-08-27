import { describe, expect, it } from "vitest";
import {
  buildAuthorizationUrl,
  deriveCodeChallenge,
  generateCodeVerifier,
  generateState,
  OAuthProofError,
} from "../index";

describe("OAuth 2.1 PKCE proof harness", () => {
  it("derives the correct RFC 7636 Appendix B S256 challenge from a known verifier", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await deriveCodeChallenge(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(challenge).not.toContain("+");
    expect(challenge).not.toContain("/");
    expect(challenge).not.toContain("=");
  });

  it("accepts verifiers that use the full RFC 7636 unreserved alphabet", async () => {
    const valid = "A~B.C_D-123456789012345678901234567890123456789012345";
    expect(valid).toHaveLength(53);
    const challenge = await deriveCodeChallenge(valid);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects non-compliant verifiers", async () => {
    const bad = [
      "", // empty
      "short", // too short
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk+", // illegal char
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk ", // illegal char
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk%", // illegal char
      "a".repeat(129), // too long
    ];

    for (const verifier of bad) {
      await expect(deriveCodeChallenge(verifier)).rejects.toThrow(OAuthProofError);
    }
  });

  it("generates code verifiers with base64url-safe characters and adequate entropy", () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();

    expect(v1).toHaveLength(43);
    expect(v2).toHaveLength(43);
    expect(v1).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(v2).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(v1).not.toBe(v2);
  });

  it("generates state values with base64url-safe characters and adequate entropy", () => {
    const s1 = generateState();
    const s2 = generateState();

    expect(s1).toHaveLength(43);
    expect(s2).toHaveLength(43);
    expect(s1).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s2).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s1).not.toBe(s2);
  });

  it("builds an authorization URL with exactly the required parameters", () => {
    const url = buildAuthorizationUrl({
      authorizationEndpoint: "https://auth.example.com/authorize",
      clientId: "test-client",
      redirectUri: "http://localhost:3000/callback",
      codeChallenge: "abc123",
      state: "xyz789",
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://auth.example.com");
    expect(parsed.pathname).toBe("/authorize");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("test-client");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:3000/callback");
    expect(parsed.searchParams.get("code_challenge")).toBe("abc123");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("state")).toBe("xyz789");
    expect(parsed.searchParams.has("scope")).toBe(false);
  });

  it("includes optional space-separated scopes when provided", () => {
    const url = buildAuthorizationUrl({
      authorizationEndpoint: "https://auth.example.com/authorize",
      clientId: "test-client",
      redirectUri: "https://app.example.com/callback",
      codeChallenge: "abc123",
      state: "xyz789",
      scopes: ["openid", "profile", "btpm:read"],
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get("scope")).toBe("openid profile btpm:read");
  });

  it("rejects authorization endpoints that already carry query parameters", () => {
    const valid = {
      clientId: "test-client",
      redirectUri: "http://localhost:3000/callback",
      codeChallenge: "abc123",
      state: "xyz789",
    };

    const badEndpoints = [
      "https://auth.example.com/authorize?client_secret=supersecret",
      "https://auth.example.com/authorize?access_token=abc&refresh_token=def",
      "https://auth.example.com/authorize?response_type=code",
      "https://auth.example.com/authorize?arbitrary=value",
      "https://auth.example.com/authorize?",
    ];

    for (const authorizationEndpoint of badEndpoints) {
      expect(() =>
        buildAuthorizationUrl({
          ...valid,
          authorizationEndpoint,
        })
      ).toThrow(OAuthProofError);
    }
  });

  it("rejects malformed or hostile endpoint and redirect inputs", () => {
    const valid = {
      authorizationEndpoint: "https://auth.example.com/authorize",
      clientId: "test-client",
      redirectUri: "http://localhost:3000/callback",
      codeChallenge: "abc123",
      state: "xyz789",
    };

    const badInputs = [
      { ...valid, authorizationEndpoint: "not a url" },
      { ...valid, authorizationEndpoint: "//auth.example.com/authorize" },
      { ...valid, authorizationEndpoint: "http://auth.example.com/authorize" },
      { ...valid, authorizationEndpoint: "https://auth.example.com/authorize#frag" },
      { ...valid, redirectUri: "https://app.example.com/callback#frag" },
      { ...valid, redirectUri: "https://user:pass@app.example.com/callback" },
      { ...valid, redirectUri: "//app.example.com/callback" },
      { ...valid, redirectUri: "http://evil.example.com/callback" },
      { ...valid, redirectUri: "ftp://localhost/callback" },
    ];

    for (const bad of badInputs) {
      expect(() => buildAuthorizationUrl(bad)).toThrow(OAuthProofError);
    }
  });

  it("permits HTTPS and loopback HTTP redirect URIs", () => {
    const base = {
      authorizationEndpoint: "https://auth.example.com/authorize",
      clientId: "test-client",
      codeChallenge: "abc123",
      state: "xyz789",
    };

    expect(() =>
      buildAuthorizationUrl({
        ...base,
        redirectUri: "https://app.example.com/callback",
      })
    ).not.toThrow();

    expect(() =>
      buildAuthorizationUrl({
        ...base,
        redirectUri: "http://localhost:3000/callback",
      })
    ).not.toThrow();

    expect(() =>
      buildAuthorizationUrl({
        ...base,
        redirectUri: "http://127.0.0.1:3000/callback",
      })
    ).not.toThrow();

    expect(() =>
      buildAuthorizationUrl({
        ...base,
        redirectUri: "http://[::1]:3000/callback",
      })
    ).not.toThrow();
  });

  it("rejects non-base64url state values", () => {
    const base = {
      authorizationEndpoint: "https://auth.example.com/authorize",
      clientId: "test-client",
      redirectUri: "https://app.example.com/callback",
      codeChallenge: "abc123",
    };

    const badStates = ["", "has a space", "plus+slash/equals=", "weird~chars.dot"];

    for (const state of badStates) {
      expect(() => buildAuthorizationUrl({ ...base, state })).toThrow(OAuthProofError);
    }
  });

  it("does not allow secret or token parameters through the typed builder", () => {
    const url = buildAuthorizationUrl({
      authorizationEndpoint: "https://auth.example.com/authorize",
      clientId: "test-client",
      redirectUri: "https://app.example.com/callback",
      codeChallenge: "abc123",
      state: "xyz789",
      scopes: ["btpm:read"],
    });

    const lower = url.toLowerCase();
    expect(lower).not.toContain("client_secret");
    expect(lower).not.toContain("access_token");
    expect(lower).not.toContain("refresh_token");
    expect(lower).not.toContain("token=");
    expect(lower).not.toContain("code=");
  });

  it("throws when challenge contains non-base64url characters", () => {
    expect(() =>
      buildAuthorizationUrl({
        authorizationEndpoint: "https://auth.example.com/authorize",
        clientId: "test-client",
        redirectUri: "https://app.example.com/callback",
        codeChallenge: "abc+123/=",
        state: "xyz789",
      })
    ).toThrow(OAuthProofError);
  });
});
