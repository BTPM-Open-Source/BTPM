/** WPP.2 — current-state Workspace Project People Preset substrate guard. */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  currentFunction,
  functionAcl,
  policyDefinition,
  sqlCorpus,
  tableDefinition,
} from "../../test/ossSqlContract";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SRC_ROOT = join(REPO_ROOT, "src");
const SQL = sqlCorpus();
const PRESETS = tableDefinition("project_people_presets");
const MEMBERS = tableDefinition("project_people_preset_members");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("WPP.2 current database substrate", () => {
  it("keeps Workspace-only preset scope and a normalized member table", () => {
    expect(PRESETS).toMatch(/scope_type\s+text\s+DEFAULT\s+'workspace'/i);
    expect(PRESETS).toMatch(/scope_type[\s\S]*CHECK[\s\S]*'workspace'/i);
    expect(PRESETS).not.toMatch(/source_project_id/i);
    expect(MEMBERS).not.toMatch(/\borganization_id\b/i);
    expect(MEMBERS).not.toMatch(/\bworkspace_id\b/i);
    expect(MEMBERS).not.toMatch(/\bsort_order\b/i);
  });

  it("retains payload-shape and canonical-role constraints plus partial uniqueness", () => {
    expect(MEMBERS).toContain("ppp_members_payload_check");
    expect(MEMBERS).toContain("ppp_members_canonical_role_only_team");
    expect(MEMBERS).toContain("ppp_members_stakeholder_type_check");
    expect(SQL).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+uq_ppp_members_team_user[\s\S]*?member_kind\s*=\s*'team_member'/i);
    expect(SQL).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+uq_ppp_members_internal_stakeholder_user[\s\S]*?stakeholder_type\s*=\s*'workspace_member'/i);
  });

  it("keeps RLS enabled with active scoped SELECT policies and no browser write policy", () => {
    expect(SQL).toMatch(/ALTER TABLE public\.project_people_presets ENABLE ROW LEVEL SECURITY/i);
    expect(SQL).toMatch(/ALTER TABLE public\.project_people_preset_members ENABLE ROW LEVEL SECURITY/i);
    const presetPolicy = policyDefinition("ppp_select_scoped", "project_people_presets");
    const memberPolicy = policyDefinition("ppp_members_select_scoped", "project_people_preset_members");
    for (const policy of [presetPolicy, memberPolicy]) {
      expect(policy).toMatch(/FOR SELECT TO authenticated/i);
      expect(policy).toContain("is_active_user");
    }
    expect(SQL).not.toMatch(/CREATE POLICY\s+\w+\s+ON\s+public\.project_people_presets\s+FOR\s+(?:INSERT|UPDATE|DELETE)\s+TO\s+authenticated/i);
    expect(SQL).not.toMatch(/CREATE POLICY\s+\w+\s+ON\s+public\.project_people_preset_members\s+FOR\s+(?:INSERT|UPDATE|DELETE)\s+TO\s+authenticated/i);
  });

  it("retains tenant-aware encryption and member-scope validation triggers", () => {
    const presetEncrypt = currentFunction("trg_encrypt_project_people_preset");
    const memberEncrypt = currentFunction("trg_encrypt_project_people_preset_member");
    for (const field of ["name", "description"]) expect(presetEncrypt).toContain(`NEW.${field}`);
    for (const field of ["role_label", "external_name"]) expect(memberEncrypt).toContain(`NEW.${field}`);
    expect(presetEncrypt).toContain("btpm_encrypt_if_legacy");
    expect(memberEncrypt).toContain("btpm_encrypt_if_legacy");
    expect(SQL).toContain("CREATE TRIGGER trg_ppp_encrypt");
    expect(SQL).toContain("CREATE TRIGGER trg_ppp_members_encrypt");
    expect(SQL).toContain("CREATE TRIGGER trg_ppp_members_validate_scope");
    expect(currentFunction("trg_validate_project_people_preset_member_scope")).toContain("preset_id");
  });

  it("retains protected RPC surface, audit envelope and locked function ACLs", () => {
    const rpcs = [
      "list_project_people_presets", "get_project_people_preset", "rename_project_people_preset",
      "archive_project_people_preset", "restore_project_people_preset",
      "add_project_people_preset_member", "update_project_people_preset_member",
      "remove_project_people_preset_member",
    ];
    for (const rpc of rpcs) {
      const fn = currentFunction(rpc);
      expect(fn).toMatch(/SECURITY DEFINER/i);
      expect(fn).toMatch(/SET search_path/i);
      const acl = functionAcl(rpc);
      expect(acl).toMatch(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC/i);
      expect(acl).toMatch(/GRANT\s+(?:ALL|EXECUTE)[\s\S]*TO\s+authenticated/i);
      expect(acl).toMatch(/GRANT\s+(?:ALL|EXECUTE)[\s\S]*TO\s+service_role/i);
    }
    for (const rpc of rpcs.slice(2)) {
      const fn = currentFunction(rpc);
      expect(fn).toContain("_ppp_record_audit(");
      expect(fn).toContain("pmg_build_result(");
      expect(fn).toContain("_ppp_authorize_write(");
    }
    expect(currentFunction("remove_project_people_preset_member")).toContain("cannot_remove_final_member");
  });
});

describe("WPP.2 client boundary", () => {
  it("no src file directly writes preset tables", () => {
    const forbidden = /\.\s*from\s*\(\s*["'](project_people_presets|project_people_preset_members)["']\s*\)\s*\.\s*(insert|update|delete|upsert)\s*\(/;
    const offenders = walk(SRC_ROOT).filter((f) => forbidden.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("service exports the approved RPC-backed functions", () => {
    const svc = readFileSync(join(SRC_ROOT, "lib", "projectPeoplePresets.ts"), "utf8");
    for (const fn of [
      "listProjectPeoplePresets", "getProjectPeoplePreset", "renameProjectPeoplePreset",
      "archiveProjectPeoplePreset", "restoreProjectPeoplePreset", "addProjectPeoplePresetMember",
      "updateProjectPeoplePresetMember", "removeProjectPeoplePresetMember",
    ]) expect(svc).toMatch(new RegExp(`export\\s+(?:async\\s+)?function\\s+${fn}\\b`));
  });
});
