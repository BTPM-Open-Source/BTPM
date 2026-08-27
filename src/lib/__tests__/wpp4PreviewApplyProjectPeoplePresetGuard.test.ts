/** WPP.4 — current-state preview/apply Project People Preset guard. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { currentFunction, functionAcl } from "../../test/ossSqlContract";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SRC_ROOT = join(REPO_ROOT, "src");
const PREVIEW = currentFunction("preview_project_people_preset_application");
const APPLY = currentFunction("apply_project_people_preset");

describe("WPP.4 preview current contract", () => {
  it("is a protected stable read with Project/preset read authority", () => {
    expect(PREVIEW).toMatch(/RETURNS\s+jsonb/i);
    expect(PREVIEW).toMatch(/STABLE SECURITY DEFINER/i);
    expect(PREVIEW).toMatch(/SET search_path/i);
    expect(PREVIEW).toContain("is_active_user");
    expect(PREVIEW).toContain("is_workspace_member");
    expect(PREVIEW).toContain("is_org_admin");
    expect(PREVIEW).toContain("can_read_project");
    expect(PREVIEW).not.toContain("has_project_pm_authority");
  });

  it("fails non-enumerably and enforces preset↔Project Workspace/Organization containment", () => {
    expect((PREVIEW.match(/RAISE\s+EXCEPTION\s+'Not authorized'/gi) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(PREVIEW).toMatch(/v_preset\.workspace_id\s+IS\s+DISTINCT\s+FROM\s+v_project\.workspace_id/i);
    expect(PREVIEW).toMatch(/v_preset\.organization_id\s+IS\s+DISTINCT\s+FROM\s+v_project\.organization_id/i);
    expect(PREVIEW).toContain("'workspace_mismatch'");
  });

  it("retains the frozen classification set and blocking-state rules", () => {
    for (const c of [
      "will_add", "already_exists", "inactive_user", "no_longer_workspace_member",
      "invalid_external", "otherwise_ineligible",
    ]) expect(PREVIEW).toContain(`'${c}'`);
    for (const reason of ["preset_archived", "empty_preset", "invalid_scope", "workspace_mismatch"]) {
      expect(PREVIEW).toContain(`'${reason}'`);
    }
  });

  it("returns the frozen summary/member display shape", () => {
    for (const k of [
      "preset_id", "preset_name", "project_id", "total_members", "will_add_team_members",
      "will_add_stakeholders", "already_exists", "skipped_ineligible", "has_blocking_errors",
      "member_id", "member_kind", "stakeholder_type", "user_id", "display_name",
      "canonical_role_key", "role_label", "classification", "reason",
    ]) expect(PREVIEW).toContain(`'${k}'`);
  });
});

describe("WPP.4 apply current contract", () => {
  it("requires Project PM authority and demo write permission under server-derived scope", () => {
    expect(APPLY).toMatch(/SECURITY DEFINER/i);
    expect(APPLY).toContain("has_project_pm_authority");
    expect(APPLY).toContain("can_write_demo");
    expect(APPLY).not.toMatch(/\bhas_pm_authority\b/);
    expect(APPLY).toMatch(/FROM\s+public\.project_people_presets[\s\S]*FOR\s+SHARE/i);
    expect(APPLY).toMatch(/FROM\s+public\.projects[\s\S]*FOR\s+SHARE/i);
  });

  it("rejects cross-Workspace, archived, invalid-scope and empty presets", () => {
    for (const reason of ["workspace_mismatch", "invalid_scope", "preset_archived", "empty_preset"]) {
      expect(APPLY).toContain(`'${reason}'`);
    }
  });

  it("writes canonical people rows directly but never Task/RACI accountability", () => {
    expect(APPLY).toMatch(/INSERT\s+INTO\s+public\.project_team_members/i);
    expect(APPLY).toMatch(/INSERT\s+INTO\s+public\.project_stakeholders/i);
    expect(APPLY).not.toMatch(/apply_project_team_member_add\s*\(/i);
    expect(APPLY).not.toMatch(/add_project_stakeholder\s*\(/i);
    expect(APPLY).not.toMatch(/UPDATE\s+public\.project_team_members/i);
    expect(APPLY).not.toMatch(/UPDATE\s+public\.project_stakeholders/i);
    expect(APPLY).not.toMatch(/raci_assignments|task_assignments|task_stakeholder_roles/i);
  });

  it("preserves idempotent/atomic application and aggregate PMG audit", () => {
    expect(APPLY).toContain("pg_advisory_xact_lock");
    expect(APPLY).toContain("pmg_command_audit");
    expect(APPLY).toContain("idempotent_replay");
    expect(APPLY).toContain("_ppp_record_audit");
    expect(APPLY).toMatch(/EXCEPTION[\s\S]*WHEN\s+OTHERS/i);
  });

  it("keeps protected ACLs for preview and apply", () => {
    for (const name of ["preview_project_people_preset_application", "apply_project_people_preset"]) {
      const acl = functionAcl(name);
      expect(acl).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC/i);
      expect(acl).toMatch(/GRANT\s+(?:ALL|EXECUTE)[\s\S]*TO\s+authenticated/i);
      expect(acl).toMatch(/GRANT\s+(?:ALL|EXECUTE)[\s\S]*TO\s+service_role/i);
      expect(acl).not.toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+anon/i);
    }
  });
});

describe("WPP.4 client boundary", () => {
  const service = readFileSync(join(SRC_ROOT, "lib", "projectPeoplePresets.ts"), "utf8");
  const hooks = readFileSync(join(SRC_ROOT, "hooks", "useProjectPeoplePresets.ts"), "utf8");
  it("uses only the protected preview/apply RPC wrappers", () => {
    expect(service).toContain("preview_project_people_preset_application");
    expect(service).toContain("apply_project_people_preset");
    expect(hooks).toContain("useProjectPeoplePresetApplicationPreview");
    expect(hooks).toContain("useApplyProjectPeoplePreset");
  });
});
