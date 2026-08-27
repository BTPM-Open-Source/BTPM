/**
 * WPP.2 — Workspace Project People Presets client substrate.
 *
 * All reads and writes go through SECURITY DEFINER RPCs. This module
 * contains ONLY type definitions and a thin service wrapper; no UI, no
 * business logic. Save-from-Project, preview, and apply arrive in later
 * WPP steps.
 */
import { supabase } from "@/integrations/supabase/client";
import { parsePmgCommandResult, type PmgCommandResult } from "@/lib/pmg/pmgContract";

export type PresetMemberKind = "team_member" | "stakeholder";
export type PresetStakeholderType = "workspace_member" | "external";

export interface ProjectPeoplePresetListRow {
  id: string;
  workspace_id: string;
  organization_id: string;
  name: string | null;
  description: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_by: string | null;
  member_count: number;
  team_count: number;
  stakeholder_count: number;
}

export interface ProjectPeoplePresetHeader {
  id: string;
  workspace_id: string;
  organization_id: string;
  name: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_by: string | null;
}

export interface ProjectPeoplePresetMember {
  id: string;
  member_kind: PresetMemberKind;
  stakeholder_type: PresetStakeholderType | null;
  user_id: string | null;
  display_name: string | null;
  external_name: string | null;
  canonical_role_key: string | null;
  role_label: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectPeoplePresetDetail {
  preset: ProjectPeoplePresetHeader;
  members: ProjectPeoplePresetMember[];
}

export async function listProjectPeoplePresets(
  workspaceId: string,
  includeArchived = false,
): Promise<ProjectPeoplePresetListRow[]> {
  const { data, error } = await supabase.rpc("list_project_people_presets", {
    _workspace_id: workspaceId,
    _include_archived: includeArchived,
  });
  if (error) throw error;
  return (data as ProjectPeoplePresetListRow[] | null) ?? [];
}

export async function getProjectPeoplePreset(
  presetId: string,
): Promise<ProjectPeoplePresetDetail> {
  const { data, error } = await supabase.rpc("get_project_people_preset", {
    _preset_id: presetId,
  });
  if (error) throw error;
  return data as unknown as ProjectPeoplePresetDetail;
}

async function callPresetCommand(
  rpc:
    | "rename_project_people_preset"
    | "archive_project_people_preset"
    | "restore_project_people_preset"
    | "add_project_people_preset_member"
    | "update_project_people_preset_member"
    | "remove_project_people_preset_member"
    | "save_project_people_preset_from_project"
    | "apply_project_people_preset",
  args: Record<string, unknown>,
): Promise<PmgCommandResult> {
  const { data, error } = await supabase.rpc(rpc as never, args as never);
  if (error) throw error;
  return parsePmgCommandResult(data);
}

/**
 * WPP.3 — Save the current Project's active Team Members and active
 * Stakeholders as a new Workspace People Preset. Wraps the protected
 * SECURITY DEFINER RPC `save_project_people_preset_from_project`.
 */
export function saveProjectPeoplePresetFromProject(input: {
  project_id: string;
  name: string;
  description?: string | null;
  correlation_id?: string | null;
  idempotency_key?: string | null;
}) {
  return callPresetCommand("save_project_people_preset_from_project", {
    _project_id: input.project_id,
    _name: input.name,
    _description: input.description ?? null,
    _correlation_id: input.correlation_id ?? null,
    _idempotency_key: input.idempotency_key ?? null,
  });
}

// ==========================================================================
// WPP.4 — Preview & apply preset to project
// ==========================================================================

export type PresetApplicationClassification =
  | "will_add"
  | "already_exists"
  | "inactive_user"
  | "no_longer_workspace_member"
  | "invalid_external"
  | "otherwise_ineligible";

export interface PresetApplicationPreviewItem {
  member_id: string;
  member_kind: PresetMemberKind;
  stakeholder_type: PresetStakeholderType | null;
  user_id: string | null;
  display_name: string | null;
  canonical_role_key: string | null;
  role_label: string | null;
  classification: PresetApplicationClassification;
  reason: string | null;
}

export interface PresetApplicationPreviewSummary {
  preset_id: string;
  preset_name: string | null;
  project_id: string;
  total_members: number;
  will_add_team_members: number;
  will_add_stakeholders: number;
  already_exists: number;
  skipped_ineligible: number;
  has_blocking_errors: boolean;
}

export interface PresetApplicationPreview {
  summary: PresetApplicationPreviewSummary;
  items: PresetApplicationPreviewItem[];
  errors: Array<{ code: string; message: string }>;
}

/**
 * WPP.4 — Preview what applying a preset to a project would do. Requires
 * project read access + preset workspace read; classifies each member and
 * flags preset/project-level blocking errors. No writes.
 */
export async function previewProjectPeoplePresetApplication(input: {
  preset_id: string;
  project_id: string;
}): Promise<PresetApplicationPreview> {
  const { data, error } = await supabase.rpc(
    "preview_project_people_preset_application",
    { _preset_id: input.preset_id, _project_id: input.project_id },
  );
  if (error) throw error;
  return data as unknown as PresetApplicationPreview;
}

/**
 * WPP.4 — Apply a preset to a project. Transactional; adds only rows
 * classified `will_add`; never overwrites existing team or stakeholder
 * rows. Emits exactly one aggregate PMG audit and mirrors the source
 * `stakeholder_added` activity event per created stakeholder.
 */
export function applyProjectPeoplePreset(input: {
  preset_id: string;
  project_id: string;
  correlation_id?: string | null;
  idempotency_key?: string | null;
}) {
  return callPresetCommand("apply_project_people_preset", {
    _preset_id: input.preset_id,
    _project_id: input.project_id,
    _correlation_id: input.correlation_id ?? null,
    _idempotency_key: input.idempotency_key ?? null,
  });
}

export function renameProjectPeoplePreset(input: {
  preset_id: string;
  name: string;
  description: string | null;
  expected_updated_at: string;
  correlation_id?: string | null;
  idempotency_key?: string | null;
}) {
  return callPresetCommand("rename_project_people_preset", {
    _preset_id: input.preset_id,
    _name: input.name,
    _description: input.description,
    _expected_updated_at: input.expected_updated_at,
    _correlation_id: input.correlation_id ?? null,
    _idempotency_key: input.idempotency_key ?? null,
  });
}

export function archiveProjectPeoplePreset(input: {
  preset_id: string;
  expected_updated_at: string;
  correlation_id?: string | null;
  idempotency_key?: string | null;
}) {
  return callPresetCommand("archive_project_people_preset", {
    _preset_id: input.preset_id,
    _expected_updated_at: input.expected_updated_at,
    _correlation_id: input.correlation_id ?? null,
    _idempotency_key: input.idempotency_key ?? null,
  });
}

export function restoreProjectPeoplePreset(input: {
  preset_id: string;
  expected_updated_at: string;
  correlation_id?: string | null;
  idempotency_key?: string | null;
}) {
  return callPresetCommand("restore_project_people_preset", {
    _preset_id: input.preset_id,
    _expected_updated_at: input.expected_updated_at,
    _correlation_id: input.correlation_id ?? null,
    _idempotency_key: input.idempotency_key ?? null,
  });
}

export function addProjectPeoplePresetMember(input: {
  preset_id: string;
  expected_preset_updated_at: string;
  member_kind: PresetMemberKind;
  stakeholder_type: PresetStakeholderType | null;
  user_id: string | null;
  external_name: string | null;
  canonical_role_key: string | null;
  role_label: string | null;
  correlation_id?: string | null;
  idempotency_key?: string | null;
}) {
  return callPresetCommand("add_project_people_preset_member", {
    _preset_id: input.preset_id,
    _expected_preset_updated_at: input.expected_preset_updated_at,
    _member_kind: input.member_kind,
    _stakeholder_type: input.stakeholder_type,
    _user_id: input.user_id,
    _external_name: input.external_name,
    _canonical_role_key: input.canonical_role_key,
    _role_label: input.role_label,
    _correlation_id: input.correlation_id ?? null,
    _idempotency_key: input.idempotency_key ?? null,
  });
}

export function updateProjectPeoplePresetMember(input: {
  member_id: string;
  expected_preset_updated_at: string;
  canonical_role_key: string | null;
  role_label: string | null;
  external_name: string | null;
  correlation_id?: string | null;
  idempotency_key?: string | null;
}) {
  return callPresetCommand("update_project_people_preset_member", {
    _member_id: input.member_id,
    _expected_preset_updated_at: input.expected_preset_updated_at,
    _canonical_role_key: input.canonical_role_key,
    _role_label: input.role_label,
    _external_name: input.external_name,
    _correlation_id: input.correlation_id ?? null,
    _idempotency_key: input.idempotency_key ?? null,
  });
}

export function removeProjectPeoplePresetMember(input: {
  member_id: string;
  expected_preset_updated_at: string;
  correlation_id?: string | null;
  idempotency_key?: string | null;
}) {
  return callPresetCommand("remove_project_people_preset_member", {
    _member_id: input.member_id,
    _expected_preset_updated_at: input.expected_preset_updated_at,
    _correlation_id: input.correlation_id ?? null,
    _idempotency_key: input.idempotency_key ?? null,
  });
}
