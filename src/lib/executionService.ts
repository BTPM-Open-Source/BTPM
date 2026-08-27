/**
 * Phase 4F.5 — Execution-layer client wrappers.
 *
 * Owns the operational (actual + lifecycle) calls for task/phase detail UX:
 *   - reopen_task / reopen_phase (existing 4F.2 RPCs)
 *   - PMG.6A: protected task execution change via apply_task_execution_change
 *
 * Server triggers remain the authoritative validators for actual-date ranges,
 * completed-task lock, phase/project actual rollups, encryption, and activity.
 */
import { supabase } from "@/integrations/supabase/client";
import { parsePmgCommandResult } from "@/lib/pmg/pmgContract";

export async function reopenTask(taskId: string): Promise<void> {
  const { error } = await supabase.rpc("reopen_task", { _task_id: taskId });
  if (error) throw error;
}

export async function reopenPhase(phaseId: string): Promise<void> {
  const { error } = await supabase.rpc("reopen_phase", { _phase_id: phaseId });
  if (error) throw error;
}

/**
 * PMG.6A — Protected task execution change.
 *
 * Routes actual-date and non-completion status changes through the
 * `apply_task_execution_change` SECURITY DEFINER command.
 *
 * Optimistic-concurrency: callers MUST pass `expectedUpdatedAt`, obtained
 * from the canonical decrypted-task read (get_decrypted_task). If it is
 * missing, this function fails closed without touching the server.
 *
 * `undefined` on an actual date means "leave unchanged"; explicit `null`
 * means "clear it".
 */
export type TaskExecutionStatus = "active" | "completed";

export interface UpdateTaskExecutionInput {
  actual_start_date?: string | null;
  actual_end_date?: string | null;
  status?: TaskExecutionStatus;
}

export async function updateTaskExecution(
  taskId: string,
  patch: UpdateTaskExecutionInput,
  expectedUpdatedAt: string | null | undefined,
): Promise<void> {
  if (!expectedUpdatedAt) {
    // Fail closed: without the canonical timestamp we cannot make a safe
    // optimistic-concurrency call.
    throw new Error(
      "Could not save changes. Please reload the task and try again.",
    );
  }

  const setActualStart = Object.prototype.hasOwnProperty.call(patch, "actual_start_date");
  const setActualEnd = Object.prototype.hasOwnProperty.call(patch, "actual_end_date");

  const { data, error } = await supabase.rpc("apply_task_execution_change", {
    _task_id: taskId,
    _expected_updated_at: expectedUpdatedAt,
    _set_actual_start: setActualStart,
    _actual_start_date: setActualStart ? (patch.actual_start_date ?? null) : null,
    _set_actual_end: setActualEnd,
    _actual_end_date: setActualEnd ? (patch.actual_end_date ?? null) : null,
    _status: (patch.status ?? undefined) as never,
  });
  if (error) throw error;

  const result = parsePmgCommandResult(data);
  if (result.status === "applied" || result.status === "no_change") {
    return;
  }
  if (result.status === "conflict") {
    throw new Error(
      "This task was updated by someone else. Reload the task and try again.",
    );
  }
  if (result.status === "not_authorized") {
    throw new Error("You do not have permission to perform this action.");
  }
  // invalid or any other non-success status — surface reason so
  // describeExecutionError can map trigger messages to product copy.
  const reason =
    (result.data as { reason?: string } | null | undefined)?.reason ??
    (result.conflict as { reason?: string } | null | undefined)?.reason ??
    "";
  throw new Error(reason || "Could not save changes.");
}

/**
 * Map raw backend errors raised on the execution surface to product copy.
 * Triggers raise SQLSTATE codes / messages we can detect by substring.
 */
export function describeExecutionError(err: unknown): string {
  const msg = (err as any)?.message || String(err);
  const lower = msg.toLowerCase();

  if (lower.includes("completed task is locked") || lower.includes("task_completed_locked")) {
    return "This task is completed. Reopen it before changing actual dates.";
  }
  if (lower.includes("completed phase is locked") || lower.includes("phase_completed_locked")) {
    return "This phase is completed. Reopen it before changing it.";
  }
  if (
    lower.includes("actual_end_date") &&
    (lower.includes("before") || lower.includes(">=") || lower.includes("on or after"))
  ) {
    return "Actual end date must be on or after the actual start date.";
  }
  if (lower.includes("phase actual") && lower.includes("derived")) {
    return "Phase actual dates are derived from child tasks and cannot be edited directly.";
  }
  if (lower.includes("project actual") && lower.includes("derived")) {
    return "Project actual dates are derived from child phases and cannot be edited directly.";
  }
  if (lower.includes("not authorized") || lower.includes("permission")) {
    return "You do not have permission to perform this action.";
  }
  if (lower.includes("only completed") && lower.includes("reopen")) {
    return "Only completed items can be reopened.";
  }
  if (lower.includes("updated by someone else")) {
    return "This task was updated by someone else. Reload the task and try again.";
  }
  // Fall back to a clean message — never expose raw SQL/trigger text verbatim.
  return "Could not save changes. Please review the values and try again.";
}

export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
