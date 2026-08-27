/**
 * Client wrapper for Power BI outbound data scope governance.
 *
 * Reads / writes Power BI outbound scope rules through SECURITY DEFINER
 * RPCs. The browser never receives Microsoft tokens or upstream payloads
 * here — these RPCs only manipulate BTPM-side scope metadata.
 *
 * PBI 4.1B: outbound scope is Workspace-only. Project-level configuration
 * has been retired; all Projects in an included Workspace are reportable.
 * The `projects` collection returned by `get_powerbi_data_scope` remains
 * for compatibility but is always empty; effective Project counts are
 * derived server-side from included Workspaces.
 */

import { supabase } from "@/integrations/supabase/client";

export type WorkspaceScopeMode = "included" | "excluded" | "unconfigured";
/** Retained for compatibility with legacy payload shape. Never populated. */
export type ProjectScopeMode = "inherit" | "included" | "excluded" | "unconfigured";

export interface PbiDataScopeWorkspace {
  workspace_id: string;
  workspace_name: string;
  workspace_scope_mode: WorkspaceScopeMode;
  effective_included: boolean;
  project_count_total: number;
  project_count_effectively_included: number;
  is_demo: boolean;
}

/** Retained for compatibility. The server no longer populates this. */
export interface PbiDataScopeProject {
  project_id: string;
  project_name: string;
  workspace_id: string;
  project_status: string | null;
  project_scope_mode: ProjectScopeMode;
  effective_included: boolean;
}

export interface PbiDataScopeSummary {
  scope_configured: boolean;
  included_workspace_count: number | null;
  included_project_count: number | null;
  workspace_rule_included_count: number;
  workspace_rule_excluded_count: number;
  /** Retired — always 0. */
  project_rule_included_count: number;
  /** Retired — always 0. */
  project_rule_excluded_count: number;
  excluded_workspace_count: number;
  /** Retired — always 0. */
  excluded_project_count: number;
  warning_no_inclusion: boolean;
}

export interface PbiDataScopeResult {
  organization_id: string;
  workspaces: PbiDataScopeWorkspace[];
  /** Retired — always empty. */
  projects: PbiDataScopeProject[];
  summary: PbiDataScopeSummary;
}

export async function getPowerBiDataScope(
  organizationId: string,
): Promise<PbiDataScopeResult> {
  const { data, error } = await supabase.rpc("get_powerbi_data_scope", {
    _organization_id: organizationId,
  });
  if (error) throw new Error(error.message);
  return data as unknown as PbiDataScopeResult;
}

export async function setPowerBiWorkspaceScope(
  organizationId: string,
  workspaceId: string,
  mode: "included" | "excluded",
  reason?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("set_powerbi_workspace_scope", {
    _organization_id: organizationId,
    _workspace_id: workspaceId,
    _scope_mode: mode,
    _reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
}
