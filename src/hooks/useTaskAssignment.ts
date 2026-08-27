import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parsePmgCommandResult } from "@/lib/pmg/pmgContract";

/**
 * Set the active assignee for a task via the PMG protected command
 * `apply_task_assignee_set`. The command:
 *   - validates auth, PM authority on the task's project, and (when the
 *     assignee is non-null) that the assignee is a member of the task's
 *     workspace;
 *   - delegates the DELETE + optional INSERT + activity emission to the
 *     canonical `set_task_assignee` operation exactly once;
 *   - returns a PMG envelope with status `applied`, `no_change`,
 *     `not_authorized`, or `invalid`.
 *
 * Both `applied` and `no_change` are treated as success; anything else
 * throws so the UI fails closed.
 */
export function useSetTaskAssignee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      taskId,
      assigneeId,
    }: {
      taskId: string;
      assigneeId: string | null;
      // Kept for backward compatibility with existing callers; the RPC
      // derives workspace/org/project from the task row itself.
      workspaceId?: string;
      organizationId?: string;
      projectId: string;
    }) => {
      const { data, error } = await supabase.rpc("apply_task_assignee_set", {
        _task_id: taskId,
        _assignee_id: assigneeId,
      });
      if (error) throw error;
      const parsed = parsePmgCommandResult(data);
      if (parsed.status !== "applied" && parsed.status !== "no_change") {
        const reason =
          (parsed.data && typeof parsed.data === "object" && (parsed.data as any).reason) ||
          parsed.status;
        throw new Error(`Assignee change rejected: ${reason}`);
      }
      return parsed;
    },
    onSuccess: async (_, vars) => {
      // Await refetches so the UI is guaranteed to render the new assignee
      // before the caller's follow-up code (toast, dialog close) fires.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["task-detail", vars.taskId] }),
        qc.invalidateQueries({ queryKey: ["project-tasks", vars.projectId] }),
        qc.invalidateQueries({ queryKey: ["phase-tasks", vars.projectId] }),
        qc.invalidateQueries({ queryKey: ["project-activity-events", vars.projectId] }),
      ]);
    },
  });
}
