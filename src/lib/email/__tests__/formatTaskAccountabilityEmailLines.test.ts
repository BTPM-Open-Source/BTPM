import { describe, it, expect } from "vitest";
import { formatTaskAccountabilityEmailLines } from "../formatTaskAccountabilityEmailLines";

describe("formatTaskAccountabilityEmailLines — TAE.7C", () => {
  it("returns no lines when Requester and Executors are unset", () => {
    expect(formatTaskAccountabilityEmailLines({})).toEqual([]);
    expect(
      formatTaskAccountabilityEmailLines({ requester: null, executors: [] }),
    ).toEqual([]);
    expect(
      formatTaskAccountabilityEmailLines({ requester: null, executors: null }),
    ).toEqual([]);
  });

  it("emits Requested by only when no executors", () => {
    expect(
      formatTaskAccountabilityEmailLines({
        requester: { display_name: "Rita Requester", stakeholder_type: "workspace_member" },
      }),
    ).toEqual([{ label: "Requested by", value: "Rita Requester" }]);
  });

  it("emits Executed by only when no requester, joined deterministically", () => {
    const lines = formatTaskAccountabilityEmailLines({
      executors: [
        { display_name: "Alpha" },
        { display_name: "Bravo" },
        { display_name: "Charlie" },
      ],
    });
    expect(lines).toEqual([
      { label: "Executed by", value: "Alpha; Bravo; Charlie" },
    ]);
  });

  it("annotates External and Former markers without PII", () => {
    const lines = formatTaskAccountabilityEmailLines({
      requester: {
        display_name: "Ext Rita",
        stakeholder_type: "external",
      },
      executors: [
        { display_name: "Old Eli", is_removed: true },
        { display_name: "Ext Former", stakeholder_type: "external", is_removed: true },
      ],
    });
    expect(lines[0]).toEqual({
      label: "Requested by",
      value: "Ext Rita (External)",
    });
    expect(lines[1]).toEqual({
      label: "Executed by",
      value: "Old Eli (Former); Ext Former (External, Former)",
    });
    // No emails or UUIDs leak
    const joined = JSON.stringify(lines);
    expect(joined).not.toMatch(/@/);
    expect(joined).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it("appends role_label when present", () => {
    const lines = formatTaskAccountabilityEmailLines({
      requester: { display_name: "Rita", role_label: "Sponsor" },
      executors: [{ display_name: "Eli", role_label: "Lead Engineer" }],
    });
    expect(lines).toEqual([
      { label: "Requested by", value: "Rita — Sponsor" },
      { label: "Executed by", value: "Eli — Lead Engineer" },
    ]);
  });

  it("falls back to 'Unknown stakeholder' when display_name is missing", () => {
    const lines = formatTaskAccountabilityEmailLines({
      requester: { display_name: null },
      executors: [{ display_name: "" }],
    });
    expect(lines).toEqual([
      { label: "Requested by", value: "Unknown stakeholder" },
      { label: "Executed by", value: "Unknown stakeholder" },
    ]);
  });

  it("preserves payload order for executors (deterministic text)", () => {
    const lines = formatTaskAccountabilityEmailLines({
      executors: [
        { display_name: "Zeta" },
        { display_name: "Alpha" },
        { display_name: "Mika" },
      ],
    });
    expect(lines[0].value).toBe("Zeta; Alpha; Mika");
  });
});
