/** WPP.7 — current-state People Preset hardening guard. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { currentFunction, functionAcl } from "../../test/ossSqlContract";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SRC_ROOT = join(REPO_ROOT, "src");
const SAVE = currentFunction("save_project_people_preset_from_project");

describe("WPP.7 save idempotency hardening", () => {
  it("takes a transaction advisory lock derived from command/actor/idempotency key before replay lookup", () => {
    expect(SAVE).toMatch(/pg_advisory_xact_lock/i);
    expect(SAVE).toMatch(/save_project_people_preset_from_project\|/i);
    const lockIdx = SAVE.search(/pg_advisory_xact_lock/i);
    const auditIdx = SAVE.search(/FROM\s+public\.pmg_command_audit/i);
    expect(lockIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(auditIdx);
    expect(SAVE).toMatch(/'no_change'[\s\S]+?idempotent_replay/i);
  });

  it("keeps the protected function ACL", () => {
    const acl = functionAcl("save_project_people_preset_from_project");
    expect(acl).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC/i);
    expect(acl).not.toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+anon/i);
    expect(acl).toMatch(/GRANT\s+(?:ALL|EXECUTE)[\s\S]*TO\s+authenticated/i);
    expect(acl).toMatch(/GRANT\s+(?:ALL|EXECUTE)[\s\S]*TO\s+service_role/i);
  });
});

describe("WPP.7 verified encryption behaviour", () => {
  it("decrypts protected project_team_members.role_label before copy", () => {
    expect(SAVE).toMatch(/public\.btpm_decrypt\(\s*ptm\.role_label\s*,\s*ptm\.organization_id\s*\)/i);
  });

  it("does not invent decryption for plaintext stakeholder role/name fields", () => {
    expect(SAVE).not.toMatch(/btpm_decrypt\(\s*s\.role_label/i);
    expect(SAVE).not.toMatch(/btpm_decrypt\(\s*s\.external_name/i);
  });
});

describe("WPP.7 client reason-map alignment", () => {
  const dialog = readFileSync(
    join(SRC_ROOT, "components", "project", "ApplyProjectPeoplePresetDialog.tsx"),
    "utf8",
  );

  it("uses workspace_mismatch and no stale cross_workspace key", () => {
    expect(dialog).toMatch(/workspace_mismatch:\s*"/);
    expect(dialog).not.toMatch(/\bcross_workspace\b/);
    expect(dialog).toMatch(/This preset belongs to a different workspace\./);
  });
});
