import { describe, it, expect } from "vitest";
import { sanitizeReturnTo } from "@/lib/authReturnTo";

describe("sanitizeReturnTo", () => {
  it("preserves safe internal deep links", () => {
    expect(sanitizeReturnTo("/")).toBe("/");
    expect(sanitizeReturnTo("/projects?foo=bar")).toBe("/projects?foo=bar");
    expect(sanitizeReturnTo("/workspace/abc/programs")).toBe("/workspace/abc/programs");
    expect(sanitizeReturnTo("/admin/users#tab=1")).toBe("/admin/users#tab=1");
  });

  it("falls back to / for missing or empty values", () => {
    expect(sanitizeReturnTo(null)).toBe("/");
    expect(sanitizeReturnTo(undefined)).toBe("/");
    expect(sanitizeReturnTo("")).toBe("/");
  });

  it("rejects absolute, protocol-relative, and backslash-style values", () => {
    expect(sanitizeReturnTo("https://evil.example.com/steal")).toBe("/");
    expect(sanitizeReturnTo("http://evil.example.com")).toBe("/");
    expect(sanitizeReturnTo("javascript:alert(1)")).toBe("/");
    expect(sanitizeReturnTo("//evil.example.com/path")).toBe("/");
    expect(sanitizeReturnTo("/\\evil.example.com")).toBe("/");
    expect(sanitizeReturnTo("relative/path")).toBe("/");
  });
});
