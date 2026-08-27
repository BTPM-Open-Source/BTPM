// TAE.11A — Import v2 contract + preview-only guardrails.
// Extended by TAE.11A.1 with:
//   * v1 contract-lock guard (v1 task schema MUST NOT accept accountability
//     fields, and the server continues to block v2 commits).
//   * strict server-side validation of malformed v2 Task fields.
//   * project_stakeholders issue-family family + valid-only count semantics.
//   * safe dry-run batch persistence guard.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  IMPORT_SCHEMA_VERSION,
  IMPORT_SCHEMA_VERSION_V2,
  taskSchema,
  taskSchemaV2,
  validateImportPayload,
} from "@/lib/imports/btpmImportV1";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const DRY_RUN_SRC = readFileSync(
  resolve(REPO_ROOT, "supabase/functions/btpm-import-dry-run/index.ts"),
  "utf8",
);
const COMMIT_SRC = readFileSync(
  resolve(REPO_ROOT, "supabase/functions/btpm-import-commit/index.ts"),
  "utf8",
);

const baseProject = {
  external_key: "P1",
  name: "Project One",
  program_external_key: "PRG1",
  status: "planned",
  priority: "medium",
};
const basePhase = {
  external_key: "PH1",
  project_external_key: "P1",
  name: "Phase 1",
  order_index: 0,
};
const baseTask = {
  external_key: "T1",
  phase_external_key: "PH1",
  project_external_key: "P1",
  name: "Task 1",
  status: "planned",
  priority: "medium",
};

function makeV2(overrides: Record<string, any> = {}) {
  return {
    schema_version: IMPORT_SCHEMA_VERSION_V2,
    import_type: "pm_workspace_import",
    source: { source_name: "unit-test" },
    programs: [{ external_key: "PRG1", name: "Prog" }],
    projects: [baseProject],
    project_team_members: [],
    phases: [basePhase],
    tasks: [baseTask],
    task_assignments: [],
    risks: [],
    blockers: [],
    execution_updates: [],
    project_stakeholders: [
      {
        external_key: "S1",
        project_external_key: "P1",
        stakeholder_type: "workspace_member",
        user_email: "alice@example.com",
        role_label: "Sponsor",
      },
      {
        external_key: "S2",
        project_external_key: "P1",
        stakeholder_type: "external",
        external_name: "Vendor Ltd.",
      },
    ],
    ...overrides,
  };
}

describe("TAE.11A.1 — v1 contract lock", () => {
  it("v1 taskSchema does NOT accept Requester/Executor fields", () => {
    // Zod strips unknown keys by default; parsed v1 task must not contain them.
    const parsed = taskSchema.parse({
      ...baseTask,
      requested_by_stakeholder_external_key: "X",
      executed_by_stakeholder_external_keys: ["Y"],
    });
    expect(Object.prototype.hasOwnProperty.call(parsed, "requested_by_stakeholder_external_key")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(parsed, "executed_by_stakeholder_external_keys")).toBe(false);
  });

  it("v2 taskSchema accepts Requester/Executor fields", () => {
    const parsed = taskSchemaV2.parse({
      ...baseTask,
      requested_by_stakeholder_external_key: "S1",
      executed_by_stakeholder_external_keys: ["S2"],
    });
    expect(parsed.requested_by_stakeholder_external_key).toBe("S1");
    expect(parsed.executed_by_stakeholder_external_keys).toEqual(["S2"]);
  });

  it("v1 payloads with sneaked-in v2-only task fields validate cleanly with no warning about it", () => {
    const payload = {
      schema_version: IMPORT_SCHEMA_VERSION,
      import_type: "pm_workspace_import",
      source: { source_name: "unit-test" },
      programs: [{ external_key: "PRG1", name: "Prog" }],
      projects: [baseProject],
      project_team_members: [],
      phases: [basePhase],
      tasks: [{ ...baseTask, requested_by_stakeholder_external_key: "X" }],
      task_assignments: [],
      risks: [],
      blockers: [],
      execution_updates: [],
    };
    const r = validateImportPayload(payload);
    expect(r.ok).toBe(true);
    // The removed v1 warning path MUST NOT resurface.
    expect(
      r.warnings.some((w) => /requested_by\/executed_by/.test(w.message)),
    ).toBe(false);
    expect(r.counts?.task_requester_links).toBe(0);
    expect(r.counts?.task_executor_links).toBe(0);
  });
});

describe("TAE.11A — Import v2 client contract", () => {
  it("accepts a well-formed v2 payload with valid Requester/Executors", () => {
    const payload = makeV2({
      tasks: [{
        ...baseTask,
        requested_by_stakeholder_external_key: "S1",
        executed_by_stakeholder_external_keys: ["S2"],
      }],
    });
    const r = validateImportPayload(payload);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.counts?.task_requester_links).toBe(1);
    expect(r.counts?.task_executor_links).toBe(1);
  });

  it("accepts the same stakeholder as both Requester and Executor", () => {
    const payload = makeV2({
      tasks: [{
        ...baseTask,
        requested_by_stakeholder_external_key: "S1",
        executed_by_stakeholder_external_keys: ["S1"],
      }],
    });
    const r = validateImportPayload(payload);
    expect(r.ok).toBe(true);
  });

  it("rejects internal stakeholders missing user_email", () => {
    const payload = makeV2();
    payload.project_stakeholders[0] = { ...payload.project_stakeholders[0], user_email: undefined };
    const r = validateImportPayload(payload);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /requires user_email/.test(e.message))).toBe(true);
  });

  it("rejects external stakeholders missing external_name", () => {
    const payload = makeV2();
    payload.project_stakeholders[1] = { ...payload.project_stakeholders[1], external_name: undefined };
    const r = validateImportPayload(payload);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /requires external_name/.test(e.message))).toBe(true);
  });

  it("rejects duplicate stakeholder external_keys", () => {
    const payload = makeV2({
      project_stakeholders: [
        { external_key: "S1", project_external_key: "P1", stakeholder_type: "external", external_name: "A" },
        { external_key: "S1", project_external_key: "P1", stakeholder_type: "external", external_name: "B" },
      ],
    });
    const r = validateImportPayload(payload);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /Duplicate stakeholder external_key/.test(e.message))).toBe(true);
  });

  it("rejects Task Requester referencing an undeclared stakeholder", () => {
    const payload = makeV2({
      tasks: [{ ...baseTask, requested_by_stakeholder_external_key: "GHOST" }],
    });
    const r = validateImportPayload(payload);
    expect(r.ok).toBe(false);
    expect(
      r.errors.some((e) => /requester stakeholder "GHOST" is not declared/.test(e.message)),
    ).toBe(true);
  });

  it("rejects Executor whose stakeholder belongs to a different project", () => {
    const payload = makeV2({
      projects: [baseProject, { ...baseProject, external_key: "P2", name: "P Two" }],
      project_stakeholders: [
        { external_key: "SX", project_external_key: "P2", stakeholder_type: "external", external_name: "Other" },
      ],
      tasks: [{ ...baseTask, executed_by_stakeholder_external_keys: ["SX"] }],
    });
    const r = validateImportPayload(payload);
    expect(r.ok).toBe(false);
    expect(
      r.errors.some((e) =>
        /executor "SX" belongs to project "P2", not the task's project "P1"/.test(e.message),
      ),
    ).toBe(true);
  });

  it("warns on duplicated Executor keys and dedupes to one planned link", () => {
    const payload = makeV2({
      tasks: [{
        ...baseTask,
        executed_by_stakeholder_external_keys: ["S2", "S2"],
      }],
    });
    const r = validateImportPayload(payload);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => /listed executor\(s\) more than once/.test(w.message))).toBe(true);
    expect(r.counts?.task_executor_links).toBe(1);
  });

  it("stays backward compatible: v1 payloads without project_stakeholders remain valid", () => {
    const payload = {
      schema_version: IMPORT_SCHEMA_VERSION,
      import_type: "pm_workspace_import",
      source: { source_name: "unit-test" },
      programs: [{ external_key: "PRG1", name: "Prog" }],
      projects: [baseProject],
      project_team_members: [],
      phases: [basePhase],
      tasks: [baseTask],
      task_assignments: [],
      risks: [],
      blockers: [],
      execution_updates: [],
    };
    const r = validateImportPayload(payload);
    expect(r.ok).toBe(true);
  });
});

describe("TAE.11A.1 — server dry-run static guards", () => {
  it("uses the project_stakeholders issue family for stakeholder-row errors", () => {
    // Must NOT emit stakeholder-row issues under the envelope family anymore.
    expect(DRY_RUN_SRC).not.toMatch(
      /project_stakeholders\[\$\{i\}\]\.stakeholder_type[^]{0,200}family: "envelope"/,
    );
    // Must include project_stakeholders in the Issue.family union.
    expect(DRY_RUN_SRC).toMatch(
      /family\?: Family \| "envelope" \| "project_stakeholders"/,
    );
    // Presence of the family literal in the stakeholder validation block.
    expect(DRY_RUN_SRC).toMatch(/family: "project_stakeholders"/);
  });

  it("strengthens v2 Task field validation (invalid values emit precise errors)", () => {
    expect(DRY_RUN_SRC).toMatch(/must be a non-empty string of at most \$\{STAKE_MAX_KEY\} characters/);
    expect(DRY_RUN_SRC).toMatch(/must be an array of stakeholder external keys/);
    expect(DRY_RUN_SRC).toMatch(/code: "invalid_field_value"/);
  });

  it("counts project_stakeholders_to_create from valid stakeholder rows only", () => {
    expect(DRY_RUN_SRC).toMatch(/validStakeholderIndexes\.size/);
    expect(DRY_RUN_SRC).not.toMatch(
      /project_stakeholders_to_create: isV2 \? stakeholders\.length : 0/,
    );
  });

  it("persists only a safe summary — no raw payload rows in the batch write", () => {
    // Safe-summary must NOT include payload arrays.
    expect(DRY_RUN_SRC).toMatch(/payload_hash: hash/);
    expect(DRY_RUN_SRC).not.toMatch(/payload_json:\s*args\.payload/);
    expect(DRY_RUN_SRC).toMatch(/issues: issues\.slice\(0, 500\)\.map/);
  });
});

describe("TAE.11B — server commit no longer blocks v2", () => {
  it("removes the v2_commit_not_implemented preview-only block", () => {
    expect(COMMIT_SRC).not.toMatch(/v2_commit_not_implemented/);
  });

  it("still routes commit through commit_btpm_import_v1_core (single transactional RPC)", () => {
    expect(COMMIT_SRC).toMatch(/rpc\("commit_btpm_import_v1_core"/);
  });

  it("preserves dry-run/hash/one-time-commit protections in the edge function", () => {
    expect(COMMIT_SRC).toMatch(/dry_run_batch_not_found/);
    expect(COMMIT_SRC).toMatch(/dry_run_already_committed/);
    expect(COMMIT_SRC).toMatch(/dry_run_payload_mismatch/);
    expect(COMMIT_SRC).toMatch(/payloadHash/);
  });
});

describe("TAE.11A.2 — valid-stakeholder gating for Task accountability counts", () => {
  it("builds a validStakeholderByKey map from validStakeholderIndexes only", () => {
    expect(DRY_RUN_SRC).toMatch(/const validStakeholderByKey = new Map<string, any>\(\)/);
    expect(DRY_RUN_SRC).toMatch(/if \(!validStakeholderIndexes\.has\(i\)\) return;/);
  });

  it("Task Requester lookup uses validStakeholderByKey (not the raw stakeholderByKey)", () => {
    // The Requester resolver must consult the valid-only map first.
    expect(DRY_RUN_SRC).toMatch(
      /const st = validStakeholderByKey\.get\(req\);/,
    );
    // And silent-skip when the row is declared but invalid.
    expect(DRY_RUN_SRC).toMatch(
      /if \(!stakeholderByKey\.has\(req\)\) \{[\s\S]{0,400}requester stakeholder/,
    );
  });

  it("Task Executor lookup uses validStakeholderByKey (not the raw stakeholderByKey)", () => {
    expect(DRY_RUN_SRC).toMatch(
      /const st = validStakeholderByKey\.get\(key\);/,
    );
    expect(DRY_RUN_SRC).toMatch(
      /if \(!stakeholderByKey\.has\(key\)\) \{[\s\S]{0,400}executor "\$\{key\}" is not declared/,
    );
  });

  it("counter increments are gated behind the validStakeholderByKey resolution", () => {
    // taskRequesterLinks increments only after the valid-map lookup succeeds
    // and project matches.
    expect(DRY_RUN_SRC).toMatch(
      /const st = validStakeholderByKey\.get\(req\);[\s\S]{0,1500}taskRequesterLinks \+= 1;/,
    );
    expect(DRY_RUN_SRC).toMatch(
      /const st = validStakeholderByKey\.get\(key\);[\s\S]{0,1500}taskExecutorLinksAfterDedup \+= 1;/,
    );
  });

  it("does NOT increment planned-link counters from the raw stakeholderByKey", () => {
    // Regression guard: previous defect resolved Task refs against the raw
    // (possibly invalid) stakeholderByKey map.
    expect(DRY_RUN_SRC).not.toMatch(
      /const st = stakeholderByKey\.get\(req\);[\s\S]{0,600}taskRequesterLinks \+= 1;/,
    );
    expect(DRY_RUN_SRC).not.toMatch(
      /const st = stakeholderByKey\.get\(key\);[\s\S]{0,600}taskExecutorLinksAfterDedup \+= 1;/,
    );
  });
});
