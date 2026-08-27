/**
 * API-D.4 — Login-return preservation contract tests.
 *
 * The existing password and Microsoft flows already funnel `returnTo`
 * through `sanitizeReturnTo` (see `src/pages/AuthPage.tsx` and
 * `src/pages/AuthCallback.tsx`). These tests prove that a caller who
 * arrives unauthenticated at the API-D consent route can round-trip
 * back to the sanitized internal consent path through both flows, and
 * that ordinary non-consent return behavior is unaffected.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { sanitizeReturnTo } from "@/lib/authReturnTo";
import { buildApiDConsentReturnPath } from "@/lib/apiDConsent";

const consentPath = buildApiDConsentReturnPath({
  clientKey: "btpm.web",
  returnTo: "/projects",
})!;

describe("API-D.4 login-return preservation — password flow", () => {
  it("accepts the sanitized consent return path unchanged", () => {
    expect(sanitizeReturnTo(consentPath)).toBe(consentPath);
  });

  it("rejects external hijacks in the same slot", () => {
    expect(sanitizeReturnTo("https://evil.example.com/consent/api-d?client_key=btpm.web"))
      .toBe("/");
    expect(sanitizeReturnTo("//evil.example.com/consent/api-d")).toBe("/");
  });

  it("preserves ordinary non-consent internal returns unchanged", () => {
    for (const path of ["/", "/projects", "/admin/users", "/roadmap?tab=x"]) {
      expect(sanitizeReturnTo(path)).toBe(path);
    }
  });
});

describe("API-D.4 login-return preservation — Microsoft OAuth flow", () => {
  const authPageSrc = readFileSync("src/pages/AuthPage.tsx", "utf8");
  const authCallbackSrc = readFileSync("src/pages/AuthCallback.tsx", "utf8");

  it("Microsoft sign-in embeds the sanitized returnTo in redirectTo (no raw params)", () => {
    // Sanitizer is applied before encoding.
    expect(authPageSrc).toMatch(
      /const\s+returnTo\s*=\s*sanitizeReturnTo\(searchParams\.get\(["']returnTo["']\)\)/,
    );
    expect(authPageSrc).toMatch(
      /redirectTo\s*=\s*`\$\{window\.location\.origin\}\/auth\/callback\?returnTo=\$\{encodeURIComponent\(returnTo\)\}`/,
    );
  });

  it("Microsoft callback re-sanitizes returnTo before redirect", () => {
    expect(authCallbackSrc).toMatch(
      /const\s+returnTo\s*=\s*sanitizeReturnTo\(url\.searchParams\.get\(["']returnTo["']\)\)/,
    );
    expect(authCallbackSrc).toMatch(/window\.location\.replace\(returnTo\)/);
  });

  it("callback code path does not blindly redirect to any query parameter other than the sanitized returnTo", () => {
    // Guard against a future regression that trusts raw params.
    expect(authCallbackSrc).not.toMatch(/window\.location\.replace\(url\.searchParams\.get/);
    expect(authCallbackSrc).not.toMatch(/window\.location\.href\s*=\s*url\.searchParams\.get/);
  });
});

describe("API-D.4 login-return preservation — build helper", () => {
  it("produces an internal consent path that passes the existing sanitizer", () => {
    const path = buildApiDConsentReturnPath({
      clientKey: "btpm.web",
      returnTo: "/projects",
    });
    expect(path).toBe("/consent/api-d?client_key=btpm.web&return_to=%2Fprojects");
    expect(sanitizeReturnTo(path!)).toBe(path);
  });

  it("refuses to build a consent return path for an invalid client key", () => {
    expect(buildApiDConsentReturnPath({ clientKey: "UPPER" })).toBeNull();
    expect(buildApiDConsentReturnPath({ clientKey: "https://evil" })).toBeNull();
    expect(buildApiDConsentReturnPath({ clientKey: null })).toBeNull();
  });
});
