/**
 * WPP.5 — Static contract guard for the Project-level People Presets UX.
 *
 * File-based, no runtime rendering. Verifies:
 *  - the compact "People presets" menu wiring (Apply + Save actions),
 *  - archived exclusion inside the Apply dialog,
 *  - preview loading / error / summary / blocking / nothing-to-add gating,
 *  - confirmation gating (canApply computation surface + button disabled),
 *  - success + no_change toast messaging,
 *  - authority gating via ProjectTeam's existing `canEdit`,
 *  - the standalone Save-as-preset button is fully replaced by the menu.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

const MENU_FILE = "src/components/project/ProjectPeoplePresetsMenu.tsx";
const APPLY_FILE = "src/components/project/ApplyProjectPeoplePresetDialog.tsx";
const TEAM_PAGE = "src/pages/ProjectTeam.tsx";

describe("WPP.5 — ProjectPeoplePresetsMenu wiring", () => {
  const src = read(MENU_FILE);

  it("renders exactly the two approved actions and no others", () => {
    expect(src).toMatch(/Apply preset/);
    expect(src).toMatch(/Save current people as preset/);
    // No unapproved actions (rename / archive / manage / duplicate / delete)
    expect(src).not.toMatch(/Rename preset/i);
    expect(src).not.toMatch(/Archive preset/i);
    expect(src).not.toMatch(/Delete preset/i);
    expect(src).not.toMatch(/Manage presets/i);
    expect(src).not.toMatch(/Duplicate preset/i);
  });

  it("gates the entire menu on the caller's canEdit authority", () => {
    expect(src).toMatch(/if\s*\(\s*!canEdit\s*\)\s*return\s+null/);
  });

  it("disables the Save action when there are no active people", () => {
    expect(src).toMatch(/activeTeamCount\s*\+\s*activeStakeholderCount\s*>\s*0/);
    expect(src).toMatch(/disabled=\{\s*!canSave\s*\}/);
  });

  it("mounts both dialogs and only these dialogs", () => {
    expect(src).toMatch(/<ApplyProjectPeoplePresetDialog\b/);
    expect(src).toMatch(/<SaveProjectPeoplePresetDialog\b/);
  });
});

describe("WPP.5 — ApplyProjectPeoplePresetDialog", () => {
  const src = read(APPLY_FILE);

  it("uses the WPP.4 preview + apply hooks", () => {
    expect(src).toMatch(/useProjectPeoplePresetApplicationPreview/);
    expect(src).toMatch(/useApplyProjectPeoplePreset/);
  });

  it("requests active-only presets and additionally filters archived from cache", () => {
    expect(src).toMatch(/includeArchived:\s*false/);
    expect(src).toMatch(/archived_at\s*===\s*null/);
  });

  it("renders all four canonical preview counts", () => {
    expect(src).toMatch(/Team to add/);
    expect(src).toMatch(/Stakeholders to add/);
    expect(src).toMatch(/Already on project/);
    expect(src).toMatch(/Skipped/);
  });

  it("groups items into will_add, already_exists, and ineligible sections", () => {
    expect(src).toMatch(/grouped\.willAdd/);
    expect(src).toMatch(/grouped\.alreadyExists/);
    expect(src).toMatch(/grouped\.ineligible/);
    expect(src).toMatch(/INELIGIBLE_CLASSIFICATIONS/);
  });

  it("shows dedicated loading and error states for the preview", () => {
    expect(src).toMatch(/Previewing…/);
    expect(src).toMatch(/Could not preview this preset/);
  });

  it("disables Apply while pending, errored, blocking, or when nothing can be added", () => {
    expect(src).toMatch(/const\s+canApply\s*=/);
    expect(src).toMatch(/previewQuery\.isSuccess/);
    expect(src).toMatch(/!previewQuery\.isFetching/);
    expect(src).toMatch(/!hasBlockingErrors/);
    expect(src).toMatch(/!nothingToAdd/);
    expect(src).toMatch(/disabled=\{\s*!canApply\s*\}/);
  });

  it("sends a fresh idempotency key per open cycle", () => {
    expect(src).toMatch(/idemKeyRef/);
    expect(src).toMatch(/crypto\.randomUUID/);
    expect(src).toMatch(/idempotency_key:\s*idemKeyRef\.current/);
  });

  it("emits honest success and no-change toasts", () => {
    expect(src).toMatch(/Preset applied — no changes/);
    expect(src).toMatch(/toast\.success\(\s*"Preset applied"/);
    expect(src).toMatch(/added_team_members/);
    expect(src).toMatch(/added_stakeholders/);
  });

  it("maps invalid/not_authorized apply outcomes to user-facing errors", () => {
    expect(src).toMatch(/not_authorized/);
    expect(src).toMatch(/preset_archived/);
    // WPP.7: aligned with backend reason key `workspace_mismatch`
    expect(src).toMatch(/workspace_mismatch/);
    expect(src).toMatch(/empty_preset/);
  });

  it("does not introduce out-of-scope features", () => {
    expect(src).not.toMatch(/overwrite/i);
    expect(src).not.toMatch(/sync/i);
    expect(src).not.toMatch(/invite/i);
    expect(src).not.toMatch(/cross[- ]?workspace scope/i);
  });
});

describe("WPP.5 — ProjectTeam integration", () => {
  const src = read(TEAM_PAGE);

  it("mounts the new People presets menu inside the canEdit header block", () => {
    expect(src).toMatch(/<ProjectPeoplePresetsMenu\b/);
    expect(src).toMatch(/activeTeamCount=\{activeTeamCount\}/);
    expect(src).toMatch(/activeStakeholderCount=\{activeStakeholderCount\}/);
  });

  it("removes the standalone Save-as-preset button and inline dialog mount", () => {
    expect(src).not.toMatch(/Save as preset/);
    expect(src).not.toMatch(/setSavePresetOpen/);
    expect(src).not.toMatch(/BookmarkPlus/);
    expect(src).not.toMatch(/<SaveProjectPeoplePresetDialog\b/);
  });

  it("keeps Stakeholders and RACI sections intact", () => {
    expect(src).toMatch(/<StakeholdersSection\b/);
    expect(src).toMatch(/Project RACI/);
    expect(src).toMatch(/Add RACI Assignment/);
  });
});
