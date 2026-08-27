// TAE.11B.1 — Static contract guards for the Admin Imports v2 commit unlock.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "..", "AdminImports.tsx"),
  "utf8",
);

describe("TAE.11B.1 — AdminImports v2 commit gate removed", () => {
  it("canCommit is no longer blocked by an isV2Payload term", () => {
    // The final gate expression must not carry a v2-only exclusion.
    expect(SRC).not.toMatch(/!\s*isV2Payload/);
    expect(SRC).not.toMatch(/const\s+isV2Payload\b/);
  });

  it("removes the preview-only / commit-disabled UI copy", () => {
    expect(SRC).not.toMatch(/preview only/i);
    expect(SRC).not.toMatch(/preview-only/i);
    expect(SRC).not.toMatch(/Commit is disabled/i);
    expect(SRC).not.toMatch(/Convert to[\s\S]{0,80}btpm_import_v1/i);
  });

  it("retains the successful dry-run gate", () => {
    expect(SRC).toMatch(/!!serverResult\?\.ok/);
  });

  it("retains the dry-run snapshot presence gate", () => {
    expect(SRC).toMatch(/!!dryRunSnapshot/);
  });

  it("retains the batch-id equality gate", () => {
    expect(SRC).toMatch(/dryRunSnapshot\.batchId === serverResult\?\.batch_id/);
  });

  it("retains the Workspace equality gate", () => {
    expect(SRC).toMatch(/dryRunSnapshot\.workspaceId === workspaceId/);
  });

  it("retains the payload equality gate (unchanged payload since dry-run)", () => {
    expect(SRC).toMatch(/dryRunSnapshot\.payloadJson === currentPayloadJson/);
  });

  it("retains the not-busy gate", () => {
    expect(SRC).toMatch(/!commitBusy/);
  });

  it("retains the one-time-commit (not-already-committed) gate", () => {
    expect(SRC).toMatch(/!commitResult\?\.ok/);
  });
});
