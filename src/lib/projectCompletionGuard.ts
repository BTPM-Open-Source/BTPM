/**
 * Step PSG.1 — Project Completion Guard / Completed-Project Edit Lock client helpers.
 *
 * Wraps the `validate_project_completion` SECURITY DEFINER RPC and provides
 * friendly translation for the backend trigger error codes:
 *   - BTPM_PROJECT_COMPLETE_BLOCKED_OPEN_BLOCKERS
 *   - BTPM_PROJECT_COMPLETED_READONLY
 */

import { supabase } from "@/integrations/supabase/client";

export interface ProjectCompletionCheckItem {
  code: string;
  message: string;
  count: number;
}

export interface ProjectCompletionValidationResult {
  hard_blocks: ProjectCompletionCheckItem[];
  warnings: ProjectCompletionCheckItem[];
  counts: {
    open_blockers: number;
    incomplete_phases: number;
    incomplete_tasks: number;
    open_risks: number;
    target_in_future: number;
  };
  can_complete: boolean;
  can_complete_with_confirmation: boolean;
}

const WARNING_LABEL: Record<string, string> = {
  incomplete_phases: "Incomplete phases",
  incomplete_tasks: "Incomplete tasks",
  open_risks: "Open risks",
  target_end_in_future: "Target end date is in the future",
};

const HARD_LABEL: Record<string, string> = {
  open_blockers: "Unresolved blockers in project scope",
};

export function describeCompletionCheck(item: ProjectCompletionCheckItem): string {
  const label = HARD_LABEL[item.code] ?? WARNING_LABEL[item.code] ?? item.message;
  return item.count > 1 ? `${label} (${item.count})` : label;
}

export async function validateProjectCompletion(
  projectId: string,
): Promise<ProjectCompletionValidationResult> {
  const { data, error } = await supabase.rpc("validate_project_completion" as any, {
    _project_id: projectId,
  });
  if (error) throw error;
  return data as unknown as ProjectCompletionValidationResult;
}

export function mapProjectGuardError(message: string): string | null {
  if (message.includes("BTPM_PROJECT_COMPLETE_BLOCKED_OPEN_BLOCKERS")) {
    return "This project cannot be marked Completed because it has unresolved blockers. Resolve or close all blockers before completing the project.";
  }
  if (message.includes("BTPM_PROJECT_REOPEN_MUST_BE_STATUS_ONLY")) {
    return "Completed projects must be reopened before other changes can be made. Reopen the project first, then save your edits in a separate step.";
  }
  if (message.includes("BTPM_PROJECT_COMPLETED_READONLY")) {
    return "This project is Completed and read-only. Reopen the project before making changes.";
  }
  if (message.includes("BTPM_PROJECT_COMPLETION_VALIDATION_FORBIDDEN")) {
    return "You do not have access to validate completion for this project.";
  }
  return null;
}
