import { describe, it, expect } from "vitest";
import {
  generatedFileUserMessage,
  isFileLockedCode,
  looksLikeJsonNote,
} from "./generatedFileErrorMessages";

describe("generatedFileUserMessage", () => {
  it("returns clean locked-file guidance for sharepoint_file_locked", () => {
    const msg = generatedFileUserMessage({ code: "sharepoint_file_locked" });
    expect(msg).toMatch(/open or locked/i);
    expect(msg).toMatch(/close it/i);
    expect(msg).toMatch(/BTPM did not replace/i);
  });

  it("treats legacy publish_target_locked the same as sharepoint_file_locked", () => {
    expect(generatedFileUserMessage({ code: "publish_target_locked" }))
      .toEqual(generatedFileUserMessage({ code: "sharepoint_file_locked" }));
    expect(isFileLockedCode("publish_target_locked")).toBe(true);
    expect(isFileLockedCode("sharepoint_file_locked")).toBe(true);
    expect(isFileLockedCode("publish_failed")).toBe(false);
  });

  it("ignores raw JSON-looking notes", () => {
    const rawNote =
      '{"error":{"code":"notAllowed","message":"The resource you are attempting to access is locked","innerError":{"code":"resourceLocked","request-id":"abc"}}}';
    expect(looksLikeJsonNote(rawNote)).toBe(true);
    const msg = generatedFileUserMessage({ code: "mystery_unknown_code", note: rawNote });
    expect(msg).not.toContain("{");
    expect(msg).not.toMatch(/innerError|request-id/i);
  });

  it("returns generic clean message for publish_failed", () => {
    const msg = generatedFileUserMessage({ code: "publish_failed" });
    expect(msg).toMatch(/Publishing to SharePoint failed/i);
    expect(msg).not.toContain("{");
  });

  it("returns permission-specific message for publish_access_denied", () => {
    const msg = generatedFileUserMessage({ code: "publish_access_denied" });
    expect(msg).toMatch(/permission/i);
  });

  it("falls back to plain notes when not JSON-looking", () => {
    const msg = generatedFileUserMessage({ code: "x_unknown", note: "Plain text note." });
    expect(msg).toBe("Plain text note.");
  });
});
