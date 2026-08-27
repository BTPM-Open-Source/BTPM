// Wave 5 Step 5.5 — Canonical lifecycle service.
//
// This is the single approved runtime path for business/config object
// lifecycle (archive / unarchive / hard delete). It routes every action
// through the Step 5.3 SECURITY DEFINER RPCs (and through the
// lifecycle-hard-delete edge function for attachment-safe hard delete).
//
// Raw `is_archived` UPDATEs from client code are no longer permitted as
// the runtime lifecycle path.

import { supabase } from "@/integrations/supabase/client";

export type LifecycleTargetType =
  | "program"
  | "project"
  | "phase"
  | "task"
  | "project_template"
  | "backlog_item"
  | "sprint"
  | "board_workflow_state"
  | "kpi_definition";

const ARCHIVE_RPC: Record<LifecycleTargetType, string> = {
  program: "archive_program",
  project: "archive_project",
  phase: "archive_phase",
  task: "archive_task",
  project_template: "archive_project_template",
  backlog_item: "archive_backlog_item",
  sprint: "archive_sprint",
  board_workflow_state: "archive_board_workflow_state",
  kpi_definition: "archive_kpi_definition",
};

const UNARCHIVE_RPC: Record<LifecycleTargetType, string> = {
  program: "unarchive_program",
  project: "unarchive_project",
  phase: "unarchive_phase",
  task: "unarchive_task",
  project_template: "unarchive_project_template",
  backlog_item: "unarchive_backlog_item",
  sprint: "unarchive_sprint",
  board_workflow_state: "unarchive_board_workflow_state",
  kpi_definition: "unarchive_kpi_definition",
};

export async function archiveTarget(target: LifecycleTargetType, id: string) {
  const { error } = await (supabase.rpc as any)(ARCHIVE_RPC[target], { _id: id });
  if (error) throw error;
}

export async function unarchiveTarget(target: LifecycleTargetType, id: string) {
  const { error } = await (supabase.rpc as any)(UNARCHIVE_RPC[target], { _id: id });
  if (error) throw error;
}

export interface HardDeleteResult {
  success: boolean;
  target_type: LifecycleTargetType;
  target_id: string;
  storage_deleted: number;
  metadata_deleted: number;
  hard_delete_ok: boolean;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export async function hardDeleteTarget(
  target: LifecycleTargetType,
  id: string,
): Promise<HardDeleteResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/lifecycle-hard-delete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ target_type: target, target_id: id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Errors may be a plain string ({ error: "..." }) or the structured
    // middleware contract ({ error: { code, message } }). Never surface
    // "[object Object]" to the user.
    const raw = (data as { error?: unknown })?.error;
    const message =
      typeof raw === "string"
        ? raw
        : raw && typeof raw === "object"
          ? [
              (raw as { message?: string }).message,
              (raw as { code?: string }).code,
            ]
              .filter(Boolean)
              .join(" — ")
          : "";
    throw new Error(message || `Hard delete failed (HTTP ${res.status})`);
  }
  return data as HardDeleteResult;
}
