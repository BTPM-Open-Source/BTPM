import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parsePmgCommandResult } from "@/lib/pmg/pmgContract";

function throwPmg(result: ReturnType<typeof parsePmgCommandResult>): never {
  const reason =
    (result.data as any)?.reason ||
    (result.conflict as any)?.code ||
    result.status;
  throw new Error(String(reason));
}

// --- Backlog Item Mutations (PMG.6G) ---

export function useCreateBacklogItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      title: string;
      description?: string | null;
      priority?: string;
      project_id: string;
      phase_id?: string | null;
      sprint_id?: string | null;
      workflow_state_id?: string | null;
    }) => {
      const { data, error } = await (supabase.rpc as any)(
        "apply_backlog_item_create",
        {
          _project_id: values.project_id,
          _title: values.title,
          _description: values.description ?? null,
          _priority: values.priority ?? "medium",
          _phase_id: values.phase_id ?? null,
          _sprint_id: values.sprint_id ?? null,
          _workflow_state_id: values.workflow_state_id ?? null,
        },
      );
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status !== "applied") throwPmg(result);
      return result.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["backlog-items", vars.project_id] });
    },
  });
}

// Wave 5 Step 5.5 — `is_archived` removed from this mutation payload.
// Lifecycle (archive/unarchive/hard-delete) goes through useLifecycleActions
// (archive_backlog_item / unarchive_backlog_item / lifecycle-hard-delete).
export function useUpdateBacklogItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      project_id,
      expected_updated_at,
      ...values
    }: {
      id: string;
      project_id: string;
      expected_updated_at: string;
      title?: string;
      description?: string | null;
      priority?: string;
      phase_id?: string | null;
      sprint_id?: string | null;
      workflow_state_id?: string | null;
    }) => {
      const args: Record<string, unknown> = {
        _backlog_item_id: id,
        _expected_updated_at: expected_updated_at,
      };
      if ("title" in values) {
        args._set_title = true;
        args._title = values.title ?? null;
      }
      if ("description" in values) {
        args._set_description = true;
        args._description = values.description ?? null;
      }
      if ("priority" in values) {
        args._set_priority = true;
        args._priority = values.priority ?? null;
      }
      if ("phase_id" in values) {
        args._set_phase_id = true;
        args._phase_id = values.phase_id ?? null;
      }
      if ("sprint_id" in values) {
        args._set_sprint_id = true;
        args._sprint_id = values.sprint_id ?? null;
      }
      if ("workflow_state_id" in values) {
        args._set_workflow_state_id = true;
        args._workflow_state_id = values.workflow_state_id ?? null;
      }

      const { data, error } = await (supabase.rpc as any)(
        "apply_backlog_item_update",
        args,
      );
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status !== "applied" && result.status !== "no_change") {
        throwPmg(result);
      }
      return result.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["backlog-items", vars.project_id] });
    },
  });
}

export function useReorderBacklogItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      items,
      projectId,
    }: {
      items: { id: string; expected_updated_at: string; new_sort_order: number }[];
      projectId: string;
    }) => {
      const { data, error } = await (supabase.rpc as any)(
        "reorder_backlog_items",
        { _project_id: projectId, _rows: items },
      );
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status !== "applied" && result.status !== "no_change") {
        throwPmg(result);
      }
      return result.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["backlog-items", vars.projectId] });
    },
  });
}


// --- Sprint Mutations (PMG.6H) ---

export function useCreateSprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      name: string;
      goal?: string | null;
      status?: string;
      start_date?: string | null;
      end_date?: string | null;
      project_id: string;
    }) => {
      const { data, error } = await (supabase.rpc as any)(
        "apply_sprint_create",
        {
          _project_id: values.project_id,
          _name: values.name,
          _goal: values.goal ?? null,
          _status: values.status ?? "planning",
          _start_date: values.start_date ?? null,
          _end_date: values.end_date ?? null,
        },
      );
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status !== "applied") throwPmg(result);
      return result.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["sprints", vars.project_id] });
    },
  });
}

// Wave 5 Step 5.5 — `is_archived` removed. Lifecycle goes through
// useLifecycleActions (archive_sprint / unarchive_sprint).
export function useUpdateSprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      project_id,
      expected_updated_at,
      ...values
    }: {
      id: string;
      project_id: string;
      expected_updated_at: string;
      name?: string;
      goal?: string | null;
      status?: string;
      start_date?: string | null;
      end_date?: string | null;
    }) => {
      const args: Record<string, unknown> = {
        _sprint_id: id,
        _expected_updated_at: expected_updated_at,
      };
      if ("name" in values) {
        args._set_name = true;
        args._name = values.name ?? null;
      }
      if ("goal" in values) {
        args._set_goal = true;
        args._goal = values.goal ?? null;
      }
      if ("status" in values) {
        args._set_status = true;
        args._status = values.status ?? null;
      }
      if ("start_date" in values) {
        args._set_start_date = true;
        args._start_date = values.start_date ?? null;
      }
      if ("end_date" in values) {
        args._set_end_date = true;
        args._end_date = values.end_date ?? null;
      }

      const { data, error } = await (supabase.rpc as any)(
        "apply_sprint_update",
        args,
      );
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status !== "applied" && result.status !== "no_change") {
        throwPmg(result);
      }
      return result.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["sprints", vars.project_id] });
    },
  });
}


export function useMoveTaskWorkflowState() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, projectId, workflowStateId }: { taskId: string; projectId: string; workflowStateId: string }) => {
      const { error } = await (supabase.rpc as any)("move_task_workflow_state", {
        _task_id: taskId,
        _workflow_state_id: workflowStateId,
      });
      if (error) throw error;
      return { taskId, projectId };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["project-tasks", vars.projectId] });
      qc.invalidateQueries({ queryKey: ["task-detail", vars.taskId] });
      qc.invalidateQueries({ queryKey: ["activity-events", "task", vars.taskId] });
    },
  });
}
