import { describe, it, expect } from "vitest";
import {
  mapPmgResultToTaskStakeholderRolesOutcome,
  normalizeExecutorIdsForTransport,
} from "../useTaskStakeholderRoles";
import type { PmgCommandResult } from "@/lib/pmg/pmgContract";

const baseData = {
  task_id: "11111111-1111-1111-1111-111111111111",
  project_id: "22222222-2222-2222-2222-222222222222",
  requester_stakeholder_id: null,
  executor_stakeholder_ids: [],
  requester_count: 0,
  executor_count: 0,
  updated_at: "2026-07-19T00:00:00Z",
};

function envelope(
  status: PmgCommandResult["status"],
  data: unknown,
  conflict: PmgCommandResult["conflict"] = null,
): PmgCommandResult {
  return {
    status,
    command: "apply_task_stakeholder_roles_set",
    target_type: "task",
    target_id: baseData.task_id,
    project_id: baseData.project_id,
    data: (data ?? {}) as Record<string, unknown>,
    changes: [],
    warnings: [],
    confirmations: [],
    conflict,
  };
}

describe("mapPmgResultToTaskStakeholderRolesOutcome", () => {
  it("passes through an applied envelope with full success payload", () => {
    const out = mapPmgResultToTaskStakeholderRolesOutcome(
      envelope("applied", {
        ...baseData,
        requester_stakeholder_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        executor_stakeholder_ids: [
          "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        ],
        requester_count: 1,
        executor_count: 1,
      }),
    );
    expect(out.status).toBe("applied");
    expect(out.data.requester_stakeholder_id).toBe(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );
    expect(out.data.executor_stakeholder_ids).toEqual([
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ]);
  });

  it("passes through a no_change envelope", () => {
    const out = mapPmgResultToTaskStakeholderRolesOutcome(
      envelope("no_change", baseData),
    );
    expect(out.status).toBe("no_change");
  });

  it("maps conflict to a stable refresh message", () => {
    expect(() =>
      mapPmgResultToTaskStakeholderRolesOutcome(
        envelope("conflict", {}, { current_updated_at: "x" }),
      ),
    ).toThrow(/changed since|refresh/i);
  });

  it("maps not_authorized to a stable authorization message", () => {
    expect(() =>
      mapPmgResultToTaskStakeholderRolesOutcome(envelope("not_authorized", {})),
    ).toThrow(/not allowed/i);
  });

  it("maps known invalid reasons to stable messages", () => {
    expect(() =>
      mapPmgResultToTaskStakeholderRolesOutcome(
        envelope("invalid", { reason: "task_read_only_lifecycle" }),
      ),
    ).toThrow(/cancelled or archived/i);
    expect(() =>
      mapPmgResultToTaskStakeholderRolesOutcome(
        envelope("invalid", { reason: "stakeholder_not_in_project" }),
      ),
    ).toThrow(/not stakeholders/i);
    expect(() =>
      mapPmgResultToTaskStakeholderRolesOutcome(
        envelope("invalid", { reason: "former_stakeholder_cannot_be_added" }),
      ),
    ).toThrow(/former/i);
    expect(() =>
      mapPmgResultToTaskStakeholderRolesOutcome(
        envelope("invalid", {
          reason: "task_id_and_expected_updated_at_required",
        }),
      ),
    ).toThrow(/missing task identifier/i);
  });

  it("fails closed on malformed success payload (missing updated_at)", () => {
    const bad = { ...baseData } as Record<string, unknown>;
    delete bad.updated_at;
    expect(() =>
      mapPmgResultToTaskStakeholderRolesOutcome(envelope("applied", bad)),
    ).toThrow();
  });

  it("fails closed on malformed success payload (missing requester_stakeholder_id)", () => {
    const bad = { ...baseData } as Record<string, unknown>;
    delete bad.requester_stakeholder_id;
    expect(() =>
      mapPmgResultToTaskStakeholderRolesOutcome(envelope("applied", bad)),
    ).toThrow();
  });

  it("fails closed on malformed executor id array", () => {
    expect(() =>
      mapPmgResultToTaskStakeholderRolesOutcome(
        envelope("applied", { ...baseData, executor_stakeholder_ids: [1] }),
      ),
    ).toThrow();
  });
});


describe("normalizeExecutorIdsForTransport", () => {
  it("drops falsy, dedupes, and sorts", () => {
    expect(
      normalizeExecutorIdsForTransport([
        "b",
        "a",
        "b",
        "",
        null,
        undefined,
        "c",
      ]),
    ).toEqual(["a", "b", "c"]);
  });
});
