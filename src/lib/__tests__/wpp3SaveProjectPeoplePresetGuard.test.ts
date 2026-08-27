/**
 * WPP.3 — current-state static contract guard for
 * public.save_project_people_preset_from_project and its client surfaces.
 *
 * The publication baseline is a consolidated schema. Assertions therefore
 * inspect the exact installed function and ACL instead of relying on the
 * historical migration that originally introduced the feature.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { currentFunction, functionAcl } from "../../test/ossSqlContract";

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SRC_ROOT = join(REPO_ROOT, "src");
const RPC_NAME = "save_project_people_preset_from_project";
const RPC = currentFunction(RPC_NAME);
const ACL = functionAcl(RPC_NAME);

describe("WPP.3 — current save RPC contract", () => {
  it("keeps the approved signature and protected execution posture", () => {
    expect(RPC).toMatch(
      /FUNCTION\s+public\.save_project_people_preset_from_project\s*\(\s*_project_id\s+uuid\s*,\s*_name\s+text\s*,\s*_description\s+text\s+DEFAULT\s+NULL(?:::text)?\s*,\s*_correlation_id\s+text\s+DEFAULT\s+NULL(?:::text)?\s*,\s*_idempotency_key\s+text\s+DEFAULT\s+NULL(?:::text)?\s*\)/i,
    );
    expect(RPC).toMatch(/RETURNS\s+jsonb/i);
    expect(RPC).toMatch(/LANGUAGE\s+plpgsql/i);
    expect(RPC).toMatch(/SECURITY\s+DEFINER/i);
    expect(RPC).toMatch(/SET\s+search_path\s+(?:=|TO)\s*'public'/i);
  });

  it("derives Project scope server-side and does not accept caller workspace/organization scope", () => {
    expect(RPC).toMatch(
      /SELECT\s+id,\s*workspace_id,\s*organization_id[\s\S]+?FROM\s+public\.projects[\s\S]+?WHERE\s+id\s*=\s*_project_id/i,
    );
    const header = RPC.slice(0, RPC.indexOf("RETURNS"));
    expect(header).not.toMatch(/_workspace_id\s+uuid/i);
    expect(header).not.toMatch(/_organization_id\s+uuid/i);
  });

  it("requires active-user Project PM authority and the demo-workspace write gate", () => {
    expect(RPC).toMatch(/is_active_user\s*\(\s*v_actor\s*\)/i);
    expect(RPC).toMatch(/has_project_pm_authority\s*\(\s*v_actor\s*,\s*_project_id\s*\)/i);
    expect(RPC).toMatch(/can_write_demo\s*\(\s*v_actor\s*,\s*v_project\.workspace_id\s*\)/i);
  });

  it("requires a name and rejects active duplicate names case-insensitively", () => {
    expect(RPC).toMatch(/NULLIF\(btrim\(COALESCE\(_name,\s*''\)\),\s*''\)/i);
    expect(RPC).toMatch(/reason\s*',\s*'name_required'/i);
    expect(RPC).toMatch(/lower\(btrim\(public\.btpm_decrypt\(r\.name/i);
    expect(RPC).toMatch(/archived_at\s+IS\s+NULL/i);
    expect(RPC).toMatch(/reason\s*',\s*'duplicate_name'/i);
  });

  it("rejects an empty source and copies only active approved people fields", () => {
    expect(RPC).toMatch(/v_team_count\s*=\s*0[\s\S]+?v_int_count\s*=\s*0[\s\S]+?v_ext_count\s*=\s*0/i);
    expect(RPC).toMatch(/reason\s*',\s*'empty_source'/i);
    expect(RPC).toMatch(/FROM\s+public\.project_team_members\s+ptm/i);
    expect(RPC).toMatch(/public\.btpm_decrypt\(ptm\.role_label,\s*ptm\.organization_id\)/i);
    expect(RPC).toMatch(/FROM\s+public\.project_stakeholders\s+s[\s\S]+?s\.removed_at\s+IS\s+NULL/i);
    expect(RPC).toMatch(/s\.stakeholder_type\s*=\s*'workspace_member'/i);
    expect(RPC).toMatch(/s\.stakeholder_type\s*=\s*'external'/i);
  });

  it("does not copy RACI, task accountability, notes, dates, or Project structure", () => {
    expect(RPC).not.toMatch(/raci_assignments/i);
    expect(RPC).not.toMatch(/task_assignments/i);
    expect(RPC).not.toMatch(/task_stakeholder_roles/i);
    expect(RPC).not.toMatch(/\bnotes\b/i);
    expect(RPC).not.toMatch(/\bstart_date\b/i);
    expect(RPC).not.toMatch(/\bphases\b|\btasks\b|\bdependencies\b|\bblockers\b|\brisks\b|\bkpi_definitions\b/i);
  });

  it("writes only preset tables so their validation/encryption triggers remain authoritative", () => {
    expect(RPC).toMatch(/INSERT\s+INTO\s+public\.project_people_presets/i);
    expect(RPC).toMatch(/INSERT\s+INTO\s+public\.project_people_preset_members/i);
    expect(RPC).not.toMatch(/INSERT\s+INTO\s+public\.project_team_members/i);
    expect(RPC).not.toMatch(/UPDATE\s+public\.project_team_members/i);
    expect(RPC).not.toMatch(/INSERT\s+INTO\s+public\.project_stakeholders/i);
    expect(RPC).not.toMatch(/UPDATE\s+public\.project_stakeholders/i);
  });

  it("retains transactional failure handling, idempotency and PMG audit", () => {
    expect(RPC).toMatch(/EXCEPTION[\s\S]+?WHEN\s+OTHERS\s+THEN/i);
    expect(RPC).toMatch(/FROM\s+public\.pmg_command_audit/i);
    expect(RPC).toMatch(/idempotency_key\s*=\s*_idempotency_key/i);
    expect(RPC).toMatch(/status\s*=\s*'applied'/i);
    expect(RPC).toMatch(/'no_change'[\s\S]+?idempotent_replay/i);
    expect(RPC).toMatch(/_ppp_record_audit\s*\(/i);
    expect(RPC).toMatch(/'source_project_id'\s*,\s*_project_id/i);
    expect(RPC).not.toMatch(/log_activity_event/i);
  });

  it("keeps function execution unavailable to PUBLIC/anon and available to authenticated/service_role", () => {
    expect(ACL).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.save_project_people_preset_from_project[^;]*FROM\s+PUBLIC/i);
    expect(ACL).toMatch(/GRANT\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\s+public\.save_project_people_preset_from_project[^;]*TO\s+authenticated/i);
    expect(ACL).toMatch(/GRANT\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\s+public\.save_project_people_preset_from_project[^;]*TO\s+service_role/i);
    expect(ACL).not.toMatch(/GRANT\s+(?:ALL|EXECUTE)[^;]*TO\s+anon/i);
  });
});

describe("WPP.3 — client substrate", () => {
  const service = readFileSync(join(SRC_ROOT, "lib", "projectPeoplePresets.ts"), "utf8");
  const hook = readFileSync(join(SRC_ROOT, "hooks", "useProjectPeoplePresets.ts"), "utf8");
  const dialog = readFileSync(join(SRC_ROOT, "components", "project", "SaveProjectPeoplePresetDialog.tsx"), "utf8");
  const page = readFileSync(join(SRC_ROOT, "pages", "ProjectTeam.tsx"), "utf8");
  const menu = readFileSync(join(SRC_ROOT, "components", "project", "ProjectPeoplePresetsMenu.tsx"), "utf8");

  it("service calls the exact protected RPC with approved parameters", () => {
    expect(service).toMatch(/saveProjectPeoplePresetFromProject/);
    expect(service).toMatch(/"save_project_people_preset_from_project"/);
    for (const arg of ["_project_id", "_name", "_description", "_correlation_id", "_idempotency_key"]) {
      expect(service).toContain(arg);
    }
  });

  it("hook invalidates Workspace preset lists on success", () => {
    expect(hook).toMatch(/useSaveProjectPeoplePresetFromProject/);
    expect(hook).toMatch(/mutationFn:\s*saveProjectPeoplePresetFromProject/);
    expect(hook).toMatch(/invalidateQueries\(\{\s*queryKey:\s*\["project-people-presets"/);
  });

  it("dialog exposes only approved save inputs/counts and stable idempotency", () => {
    expect(dialog).toMatch(/Save people as workspace preset/);
    expect(dialog).toMatch(/Preset name/);
    expect(dialog).toMatch(/Description/);
    expect(dialog).toMatch(/Active team members/);
    expect(dialog).toMatch(/Active stakeholders/);
    expect(dialog).toMatch(/RACI,\s*task assignments,\s*notes,\s*dates,\s*history and permissions/);
    expect(dialog).toMatch(/idempotency_key:\s*idemKeyRef\.current/);
    expect(dialog).toMatch(/crypto\.randomUUID/);
    expect(dialog).not.toMatch(/useNavigate|navigate\(/);
  });

  it("Project Team mounts the People presets menu which wraps the Save dialog", () => {
    expect(page).toMatch(/<ProjectPeoplePresetsMenu\b/);
    expect(menu).toMatch(/SaveProjectPeoplePresetDialog/);
  });
});
