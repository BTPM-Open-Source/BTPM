/**
 * WPP.6 — Workspace People Presets library UX: static contract guard.
 *
 * Verifies:
 *   - Route/navigation integration under the canonical /projects shell.
 *   - Active/archived filtering surfaced through the WPP.2 list hook.
 *   - Supported actions only (rename/description, add member,
 *     edit role, remove, archive/restore). No create-empty, duplicate,
 *     reorder, import/export, comparison, cross-workspace, apply.
 *   - Authority gating via useCanManageWorkspace.
 *   - Honest PMG status handling incl. final-member removal message.
 *   - Uses only the existing WPP service/hooks (no new RPCs, no direct
 *     `.from(...)` writes to preset tables).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readFile = (p: string) => readFileSync(resolve(process.cwd(), p), "utf-8");

const PAGE = "src/pages/WorkspacePeoplePresets.tsx";
const ADD_DIALOG = "src/components/workspace/AddPeoplePresetMemberDialog.tsx";
const TABS = "src/pages/ProjectsTabs.tsx";
const LAYOUT = "src/pages/ProjectsLayout.tsx";
const APP = "src/App.tsx";

describe("WPP.6 — Workspace People Presets library UX guard", () => {
  const page = readFile(PAGE);
  const addDialog = readFile(ADD_DIALOG);
  const tabs = readFile(TABS);
  const layout = readFile(LAYOUT);
  const app = readFile(APP);

  it("registers a 'People presets' tab under the canonical /projects shell", () => {
    expect(layout).toContain('"People presets"');
    expect(layout).toContain('"people-presets"');
    expect(app).toContain('path="people-presets"');
    expect(app).toContain("ProjectsTabPeoplePresets");
    expect(tabs).toContain("ProjectsTabPeoplePresets");
    expect(tabs).toContain("WorkspacePeoplePresets");
  });

  it("uses the existing WPP.2 service/hooks — no new RPCs, no direct writes", () => {
    expect(page).not.toMatch(/from\(["']project_people_presets["']\)/);
    expect(page).not.toMatch(/from\(["']project_people_preset_members["']\)/);
    expect(addDialog).not.toMatch(/from\(["']project_people_presets["']\)/);
    expect(addDialog).not.toMatch(/from\(["']project_people_preset_members["']\)/);
    expect(page).toContain('from "@/hooks/useProjectPeoplePresets"');
    expect(addDialog).toContain('from "@/hooks/useProjectPeoplePresets"');
    expect(page).toMatch(/useProjectPeoplePresets\b/);
    expect(page).toMatch(/useProjectPeoplePreset\b/);
    expect(page).toMatch(/useRenameProjectPeoplePreset\b/);
    expect(page).toMatch(/useArchiveProjectPeoplePreset\b/);
    expect(page).toMatch(/useRestoreProjectPeoplePreset\b/);
    expect(page).toMatch(/useUpdateProjectPeoplePresetMember\b/);
    expect(page).toMatch(/useRemoveProjectPeoplePresetMember\b/);
    expect(addDialog).toMatch(/useAddProjectPeoplePresetMember\b/);
  });

  it("WPP.6A — mirrors server detail into the header form via useEffect, not useMemo", () => {
    expect(page).toMatch(/import\s*\{[^}]*\buseEffect\b[^}]*\}\s*from\s*["']react["']/);
    expect(page).toMatch(
      /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(data\s*&&\s*!nameDirty\)\s*\{[\s\S]*?setName\(data\.preset\.name[\s\S]*?setDescription\(data\.preset\.description[\s\S]*?\}\s*,\s*\[data,\s*nameDirty\]\)/,
    );
    expect(page).not.toMatch(/useMemo\([^)]*\{\s*if\s*\(data\s*&&\s*!nameDirty\)/);
  });

  it("WPP.6A — mutation hooks invalidate both the workspace list and the exact preset detail", () => {
    const hooks = readFile("src/hooks/useProjectPeoplePresets.ts");
    expect(hooks).toMatch(
      /function\s+invalidatePresetCaches[\s\S]*project-people-presets[\s\S]*projectPeoplePresetKeys\.detail\(presetId\)/,
    );
    for (const fn of [
      "useRenameProjectPeoplePreset",
      "useArchiveProjectPeoplePreset",
      "useRestoreProjectPeoplePreset",
      "useAddProjectPeoplePresetMember",
    ]) {
      const re = new RegExp(
        `export function ${fn}\\([\\s\\S]*?onSuccess:\\s*\\(_r,\\s*vars\\)\\s*=>\\s*invalidatePresetCaches\\(qc,\\s*workspaceId,\\s*vars\\.preset_id\\)`,
      );
      expect(hooks).toMatch(re);
    }
    for (const fn of [
      "useUpdateProjectPeoplePresetMember",
      "useRemoveProjectPeoplePresetMember",
    ]) {
      const re = new RegExp(
        `export function ${fn}\\(\\s*workspaceId:[^,]+,\\s*presetId\\?:\\s*string,?\\s*\\)[\\s\\S]*?invalidatePresetCaches\\(qc,\\s*workspaceId,\\s*presetId\\)`,
      );
      expect(hooks).toMatch(re);
    }
    expect(page).toContain("useRemoveProjectPeoplePresetMember(workspaceId, presetId)");
    expect(page).toContain("useUpdateProjectPeoplePresetMember(workspaceId, presetId)");
    expect(page).toContain("presetId={preset.id}");
    expect(hooks).not.toMatch(/refetchQueries\(/);
  });

  it("surfaces active-only default with an archived-inclusion toggle", () => {
    expect(page).toMatch(/includeArchived,\s*setIncludeArchived\]\s*=\s*useState\(false\)/);
    expect(page).toMatch(/useProjectPeoplePresets\([^)]+\{\s*includeArchived\s*\}/s);
    expect(page).toContain("Show archived");
  });

  it("gates editing on Workspace admin authority", () => {
    expect(page).toContain('from "@/hooks/useWorkspaceMembersAdmin"');
    expect(page).toMatch(/useCanManageWorkspace\(workspaceId\)/);
    expect(page).toMatch(/canEdit\s*=\s*canManage\s*===\s*true/);
    expect(page).toContain("canEdit && !archived");
  });

  it("supports only the approved actions and no out-of-scope features", () => {
    expect(page).toContain("Back to presets");
    expect(page).toContain("Team member (workspace");
    expect(page).toMatch(/Stakeholder\s*\(\s*workspace user\s*\)/);
    expect(page).toMatch(/External\s+stakeholder/);
    expect(page).toContain("Save changes");
    expect(page).toContain("Archive");
    expect(page).toContain("Restore");
    expect(page).toContain("Edit role");
    expect(page).toContain("Remove");

    const forbidden = [
      "Create empty preset",
      "Create preset",
      "New preset",
      "Duplicate preset",
      "Reorder",
      "Import preset",
      "Export preset",
      "Compare preset",
      "Apply preset",
      "Apply to project",
      "Sync",
      "History",
    ];
    for (const term of forbidden) expect(page).not.toContain(term);
    expect(page).not.toMatch(/organizationId|_organization_id/);
  });

  it("handles PMG statuses honestly incl. conflict/authorization/final-member removal", () => {
    expect(page).toContain('"conflict"');
    expect(page).toContain("refresh and try again");
    expect(page).toContain('"not_authorized"');
    expect(page).toMatch(/last_member|final_member/);
    expect(page).toMatch(/at least one member/);
    expect(page).toContain('"applied"');
    expect(page).toContain('"no_change"');
  });

  it("add-member dialog restricts sources to the current workspace only", () => {
    expect(addDialog).toContain('from "@/hooks/useWorkspaceMembers"');
    expect(addDialog).toContain("useWorkspaceMembers(workspaceId)");
    expect(addDialog).not.toMatch(/ws_add_member|ws_invite/);
    expect(addDialog).not.toMatch(/from\(["']workspace_members["']\)/);
    expect(addDialog).toContain('"team_member"');
    expect(addDialog).toContain('"stakeholder_workspace"');
    expect(addDialog).toContain('"stakeholder_external"');
  });
});
