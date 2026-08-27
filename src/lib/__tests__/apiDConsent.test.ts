import { describe, it, expect } from "vitest";
import {
  buildApiDConsentReturnPath,
  generateApiDCorrelationId,
  sanitizeApiDClientKey,
  sanitizeApiDReturnTo,
  sanitizePolicyUri,
  __API_D_TESTING,
} from "@/lib/apiDConsent";

describe("sanitizeApiDClientKey", () => {
  it("accepts safe non-secret client keys", () => {
    for (const key of ["btpm.web", "abc", "a01", "acme_client-01", "x.y.z", "a".repeat(64)]) {
      expect(sanitizeApiDClientKey(key), key).toBe(key);
    }
  });

  it("rejects malformed, too short/long, uppercase, or edge-punctuated keys", () => {
    for (
      const bad of [
        undefined,
        null,
        "",
        "  ",
        "AB",
        "_leading",
        "trailing_",
        "-lead",
        "lead-",
        ".dot",
        "dot.",
        "has space",
        "has/slash",
        "has\\backslash",
        "UPPER",
        "MixedCase",
        "emoji😀",
        "a".repeat(65),
        123 as unknown,
        {} as unknown,
        [] as unknown,
        "with\u0000null",
        "with\ttab",
        "with\nnewline",
      ]
    ) {
      expect(sanitizeApiDClientKey(bad as unknown), String(bad)).toBeNull();
    }
  });
});

describe("sanitizeApiDReturnTo", () => {
  it("preserves safe internal paths", () => {
    expect(sanitizeApiDReturnTo("/")).toBe("/");
    expect(sanitizeApiDReturnTo("/projects?foo=bar")).toBe("/projects?foo=bar");
    expect(sanitizeApiDReturnTo("/workspace/abc/programs")).toBe("/workspace/abc/programs");
  });

  it("rejects absolute, protocol-relative, backslash, and non-slash paths", () => {
    for (
      const bad of [
        "https://evil.example.com",
        "http://evil.example.com/x",
        "//evil.example.com/x",
        "/\\evil.example.com",
        "javascript:alert(1)",
        "data:text/html,<script>",
        "relative/path",
        "",
        null,
        undefined,
      ]
    ) {
      expect(sanitizeApiDReturnTo(bad as unknown), String(bad)).toBe("/");
    }
  });

  it("rejects encoded absolute or protocol-relative payloads and control chars", () => {
    for (
      const bad of [
        "/%2F%2Fevil.example.com/x",
        "/%2f%2fevil.example.com",
        "/redirect?u=http%3A//evil.example.com",
        "/%5C%5Cevil",
        "/x\u0000y",
        "/x\ny",
        "/x\ty",
      ]
    ) {
      expect(sanitizeApiDReturnTo(bad), bad).toBe("/");
    }
  });

  it("rejects loops into the auth and consent surfaces", () => {
    for (
      const loop of [
        "/auth",
        "/auth/",
        "/auth?returnTo=/x",
        "/auth/callback?code=abc",
        "/auth/ms-callback",
        "/consent/api-d",
        "/consent/api-d?client_key=x",
        "/reset-password",
        "/accept-invite",
        "/accept-invite/",
      ]
    ) {
      expect(sanitizeApiDReturnTo(loop), loop).toBe("/");
    }
  });
});

describe("buildApiDConsentReturnPath", () => {
  it("emits a validated internal consent path with the sanitized key and nested return", () => {
    expect(
      buildApiDConsentReturnPath({ clientKey: "btpm.web", returnTo: "/projects" }),
    ).toBe("/consent/api-d?client_key=btpm.web&return_to=%2Fprojects");
  });

  it("omits nested return_to when it falls back to /", () => {
    expect(buildApiDConsentReturnPath({ clientKey: "btpm.web", returnTo: "//evil" }))
      .toBe("/consent/api-d?client_key=btpm.web");
    expect(buildApiDConsentReturnPath({ clientKey: "btpm.web" }))
      .toBe("/consent/api-d?client_key=btpm.web");
  });

  it("returns null for any invalid client key", () => {
    expect(buildApiDConsentReturnPath({ clientKey: "UPPER" })).toBeNull();
    expect(buildApiDConsentReturnPath({ clientKey: null })).toBeNull();
    expect(buildApiDConsentReturnPath({ clientKey: "" })).toBeNull();
  });
});

describe("sanitizePolicyUri", () => {
  it("accepts only absolute HTTPS URLs", () => {
    expect(sanitizePolicyUri("https://policies.example.com/v1"))
      .toBe("https://policies.example.com/v1");
  });

  it("rejects non-HTTPS or malformed inputs", () => {
    for (
      const bad of [
        undefined,
        null,
        "",
        "   ",
        "http://policies.example.com/v1",
        "javascript:alert(1)",
        "data:text/html,<script>",
        "/relative/policy",
        "policies.example.com",
        "https://exa mple.com",
        "https://x.example.com\nsecond",
      ]
    ) {
      expect(sanitizePolicyUri(bad as unknown), String(bad)).toBeNull();
    }
  });
});

describe("generateApiDCorrelationId", () => {
  it("produces a value matching the exact API-D.3 correlation-ID contract", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateApiDCorrelationId();
      expect(__API_D_TESTING.CORRELATION_ID_RE.test(id), id).toBe(true);
      expect(id.length).toBeGreaterThanOrEqual(1);
      expect(id.length).toBeLessThanOrEqual(64);
    }
  });

  it("is not persisted across calls (each call yields a fresh opaque value)", () => {
    const a = generateApiDCorrelationId();
    const b = generateApiDCorrelationId();
    // High-entropy source — collision within two calls is astronomically unlikely.
    expect(a).not.toBe(b);
  });
});
