/**
 * TAE.9D — Team Work saved-view compatibility helpers for Requester/Executor
 * filter fields. Focused pure-helper tests; the page itself is not mounted.
 */
import { describe, it, expect } from "vitest";
import {
  validateAccountabilitySavedViewFields,
  readAccountabilityFromSnapshot,
  writeAccountabilityToSnapshot,
  accountabilitySnapshotEqual,
  EMPTY_ACCOUNTABILITY_RUNTIME,
} from "@/lib/teamWork/teamWorkSavedViewAccountability";

describe("TAE.9D — accountability saved-view validation", () => {
  it("accepts an older saved view where all four fields are absent", () => {
    expect(validateAccountabilitySavedViewFields({})).toBe(true);
  });

  it("accepts a new saved view with well-typed fields", () => {
    expect(
      validateAccountabilitySavedViewFields({
        requester_stakeholder_ids: ["a", "b"],
        executor_stakeholder_ids: [],
        include_no_requester: true,
        include_no_executors: false,
      }),
    ).toBe(true);
  });

  it("rejects malformed arrays", () => {
    expect(
      validateAccountabilitySavedViewFields({
        requester_stakeholder_ids: [1 as unknown as string],
      }),
    ).toBe(false);
    expect(
      validateAccountabilitySavedViewFields({
        executor_stakeholder_ids: "nope" as unknown as string[],
      }),
    ).toBe(false);
  });

  it("rejects malformed booleans", () => {
    expect(
      validateAccountabilitySavedViewFields({
        include_no_requester: "true" as unknown as boolean,
      }),
    ).toBe(false);
    expect(
      validateAccountabilitySavedViewFields({
        include_no_executors: 1 as unknown as boolean,
      }),
    ).toBe(false);
  });
});

describe("TAE.9D — read/write with defaults", () => {
  it("writes IDs/booleans only (no display names, roles, emails, projects)", () => {
    const out = writeAccountabilityToSnapshot({
      requesterIds: ["r1"],
      executorIds: ["e1"],
      includeNoRequester: true,
      includeNoExecutors: false,
    });
    expect(Object.keys(out).sort()).toEqual([
      "executor_stakeholder_ids",
      "include_no_executors",
      "include_no_requester",
      "requester_stakeholder_ids",
    ]);
    expect(out.requester_stakeholder_ids).toEqual(["r1"]);
    expect(out.executor_stakeholder_ids).toEqual(["e1"]);
    expect(out.include_no_requester).toBe(true);
    expect(out.include_no_executors).toBe(false);
  });

  it("reads an older saved view (fields absent) as empty/false defaults", () => {
    expect(readAccountabilityFromSnapshot({})).toEqual(EMPTY_ACCOUNTABILITY_RUNTIME);
  });

  it("restores all four values from a new saved view", () => {
    const runtime = readAccountabilityFromSnapshot({
      requester_stakeholder_ids: ["r1", "r2"],
      executor_stakeholder_ids: ["e1"],
      include_no_requester: true,
      include_no_executors: true,
    });
    expect(runtime).toEqual({
      requesterIds: ["r1", "r2"],
      executorIds: ["e1"],
      includeNoRequester: true,
      includeNoExecutors: true,
    });
  });
});

describe("TAE.9D — snapshot equality", () => {
  it("treats absent fields as empty/false so old and new equivalent states compare equal", () => {
    expect(
      accountabilitySnapshotEqual(
        {},
        {
          requester_stakeholder_ids: [],
          executor_stakeholder_ids: [],
          include_no_requester: false,
          include_no_executors: false,
        },
      ),
    ).toBe(true);
  });

  it("detects each of the four changed values", () => {
    const base = writeAccountabilityToSnapshot(EMPTY_ACCOUNTABILITY_RUNTIME);
    expect(
      accountabilitySnapshotEqual(base, {
        ...base,
        requester_stakeholder_ids: ["r1"],
      }),
    ).toBe(false);
    expect(
      accountabilitySnapshotEqual(base, {
        ...base,
        executor_stakeholder_ids: ["e1"],
      }),
    ).toBe(false);
    expect(
      accountabilitySnapshotEqual(base, {
        ...base,
        include_no_requester: true,
      }),
    ).toBe(false);
    expect(
      accountabilitySnapshotEqual(base, {
        ...base,
        include_no_executors: true,
      }),
    ).toBe(false);
  });

  it("ID equality is order-insensitive", () => {
    expect(
      accountabilitySnapshotEqual(
        { requester_stakeholder_ids: ["a", "b"] },
        { requester_stakeholder_ids: ["b", "a"] },
      ),
    ).toBe(true);
  });
});

describe("TAE.9D — applying older view clears current accountability state (contract)", () => {
  it("readAccountabilityFromSnapshot on an older view returns explicit empties, so applying it clears any current values", () => {
    const current = {
      requesterIds: ["r1"],
      executorIds: ["e1"],
      includeNoRequester: true,
      includeNoExecutors: true,
    };
    // Older view has all four fields absent.
    const restored = readAccountabilityFromSnapshot({});
    expect(restored).toEqual(EMPTY_ACCOUNTABILITY_RUNTIME);
    // Applying replaces (does not merge with) current state.
    expect(restored).not.toEqual(current);
  });
});
