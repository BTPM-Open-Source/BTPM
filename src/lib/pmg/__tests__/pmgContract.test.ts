import { describe, expect, it } from "vitest";
import { PMG_SOURCE_CHANNELS, parsePmgCommandResult } from "../pmgContract";

const baseEnvelope = {
  status: "applied",
  command: "apply_example",
  target_type: "task",
  target_id: "11111111-1111-1111-1111-111111111111",
  project_id: "22222222-2222-2222-2222-222222222222",
  data: {},
  changes: [],
  warnings: [],
  confirmations: [],
  conflict: null,
};

describe("parsePmgCommandResult", () => {
  it("accepts a valid applied result", () => {
    const result = parsePmgCommandResult(baseEnvelope);
    expect(result.status).toBe("applied");
    expect(result.command).toBe("apply_example");
    expect(result.data).toEqual({});
    expect(result.conflict).toBeNull();
  });

  it("accepts a valid confirmation_required result", () => {
    const result = parsePmgCommandResult({
      ...baseEnvelope,
      status: "confirmation_required",
      confirmations: [{ code: "confirm_delete" }],
    });
    expect(result.status).toBe("confirmation_required");
    expect(result.confirmations).toHaveLength(1);
  });

  it("rejects an unknown status", () => {
    expect(() =>
      parsePmgCommandResult({ ...baseEnvelope, status: "succeeded" }),
    ).toThrow(/status must be one of/);
  });

  it("rejects a blank command", () => {
    expect(() =>
      parsePmgCommandResult({ ...baseEnvelope, command: "   " }),
    ).toThrow(/command must be a non-empty string/);
  });

  it("rejects when data is not an object", () => {
    expect(() =>
      parsePmgCommandResult({ ...baseEnvelope, data: [] }),
    ).toThrow(/data must be a JSON object/);
  });

  it("rejects when an array property is malformed", () => {
    expect(() =>
      parsePmgCommandResult({ ...baseEnvelope, changes: "nope" }),
    ).toThrow(/changes must be an array/);
  });

  it("accepts null identifiers and null conflict", () => {
    const result = parsePmgCommandResult({
      ...baseEnvelope,
      target_type: null,
      target_id: null,
      project_id: null,
      conflict: null,
    });
    expect(result.target_type).toBeNull();
    expect(result.target_id).toBeNull();
    expect(result.project_id).toBeNull();
    expect(result.conflict).toBeNull();
  });

  it("accepts an object conflict payload", () => {
    const result = parsePmgCommandResult({
      ...baseEnvelope,
      status: "conflict",
      conflict: { expected_updated_at: "2026-01-01T00:00:00Z" },
    });
    expect(result.status).toBe("conflict");
    expect(result.conflict).toEqual({
      expected_updated_at: "2026-01-01T00:00:00Z",
    });
  });
});

describe("PMG_SOURCE_CHANNELS", () => {
  it("matches the SQL pmg_source_channel enum exactly", () => {
    expect([...PMG_SOURCE_CHANNELS]).toEqual([
      "btpm_ui",
      "admin_import",
      "external_api",
      "mcp",
      "background_job",
      "btpm_internal",
    ]);
  });
});
