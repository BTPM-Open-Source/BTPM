import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { parsePmgCommandResult } from "@/lib/pmg/pmgContract";

// --- Phases (reads via decrypted RPC) ---

export function useProjectPhases(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-phases", projectId],
    queryFn: async () => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await supabase.rpc("list_decrypted_project_phases", {
        _project_id: projectId,
      });
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: !!projectId,
  });
}

export function useCreatePhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: TablesInsert<"phases">) => {
      if (!values.project_id) {
        throw new Error("project_id is required to create a Phase.");
      }
      const { data, error } = await supabase.rpc("apply_phase_create", {
        _project_id: values.project_id,
        _name: values.name,
        _description: values.description ?? undefined,
        _status: (values.status ?? undefined) as never,
        _phase_type: (values.phase_type ?? undefined) as never,
        _start_date: values.start_date ?? undefined,
        _target_end_date: values.target_end_date ?? undefined,
        _sort_order: values.sort_order ?? undefined,
      });
      if (error) throw error;

      const result = parsePmgCommandResult(data);
      if (result.status === "applied") {
        const payload = (result.data ?? {}) as {
          id?: string;
          project_id?: string;
          sort_order?: number;
          updated_at?: string;
        };
        return {
          id: payload.id,
          project_id: payload.project_id ?? values.project_id,
          sort_order: payload.sort_order,
          updated_at: payload.updated_at,
        };
      }
      if (result.status === "confirmation_required") {
        throw new Error(
          "The Phase dates fall outside the Project's planned window. Extend the Project window first, then retry.",
        );
      }
      if (result.status === "not_authorized") {
        throw new Error("You are not authorized to create Phases in this Project.");
      }
      // invalid or any other non-success status
      throw new Error("Phase create rejected by validation. Please review the inputs and try again.");
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["project-phases", data.project_id] });
      qc.invalidateQueries({ queryKey: ["project", data.project_id] });
    },
  });
}

type CachedPhaseRow = {
  id: string;
  project_id: string;
  updated_at: string;
};

function findCachedPhase(
  qc: QueryClient,
  phaseId: string,
  projectId: string,
): CachedPhaseRow | null {
  const entries = qc.getQueriesData<CachedPhaseRow[]>({ queryKey: ["project-phases", projectId] });
  for (const [, data] of entries) {
    if (!Array.isArray(data)) continue;
    const hit = data.find((p) => p && p.id === phaseId && p.project_id === projectId);
    if (hit && hit.updated_at) return hit;
  }
  // Fallback: scan any cached project-phases lists
  const all = qc.getQueriesData<CachedPhaseRow[]>({ queryKey: ["project-phases"] });
  for (const [, data] of all) {
    if (!Array.isArray(data)) continue;
    const hit = data.find((p) => p && p.id === phaseId && p.project_id === projectId);
    if (hit && hit.updated_at) return hit;
  }
  return null;
}

export function useUpdatePhase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      project_id,
      ...values
    }: TablesUpdate<"phases"> & { id: string; project_id: string }) => {
      const cached = findCachedPhase(qc, id, project_id);
      if (!cached) {
        throw new Error("Phase is out of date. Please refresh and try again.");
      }

      const { data, error } = await supabase.rpc("apply_phase_update", {
        _phase_id: id,
        _expected_updated_at: cached.updated_at,
        _name: (values.name ?? "") as string,
        _description: (values.description ?? undefined) as never,
        _status: (values.status ?? undefined) as never,
        _phase_type: (values.phase_type ?? undefined) as never,
      });
      if (error) throw error;

      const result = parsePmgCommandResult(data);
      if (result.status === "applied" || result.status === "no_change") {
        const payload = (result.data ?? {}) as {
          id?: string;
          project_id?: string;
          updated_at?: string;
        };
        return {
          id: payload.id ?? id,
          project_id: payload.project_id ?? project_id,
          updated_at: payload.updated_at,
        };
      }
      if (result.status === "conflict") {
        throw new Error("Phase is out of date. Please refresh and try again.");
      }
      if (result.status === "not_authorized") {
        throw new Error("You are not authorized to update this Phase.");
      }
      throw new Error("Phase update rejected by validation. Please review the inputs and try again.");
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["project-phases", data.project_id] });
      qc.invalidateQueries({ queryKey: ["project", data.project_id] });
      qc.invalidateQueries({ queryKey: ["phase-detail", data.id] });
    },
  });
}

type PhaseSnapshotRow = {
  id: string;
  project_id: string;
  sort_order: number;
  updated_at: string;
};

function findPhaseSnapshot(
  qc: QueryClient,
  targetIds: Set<string>,
): { projectId: string; phases: PhaseSnapshotRow[] } | null {
  const entries = qc.getQueriesData<PhaseSnapshotRow[]>({ queryKey: ["project-phases"] });
  for (const [, data] of entries) {
    if (!Array.isArray(data) || data.length === 0) continue;
    const ids = new Set(data.map((p) => p.id));
    let matched = 0;
    targetIds.forEach((id) => { if (ids.has(id)) matched += 1; });
    if (matched === targetIds.size) {
      return { projectId: data[0].project_id, phases: data };
    }
  }
  return null;
}

export function useReorderPhases() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: { id: string; sort_order: number }[]) => {
      if (items.length === 0) return;
      const targetIds = new Set(items.map((i) => i.id));
      const snapshot = findPhaseSnapshot(qc, targetIds);
      if (!snapshot) {
        throw new Error("Reorder failed: no cached Phase snapshot available. Please refresh and try again.");
      }
      const overrides = new Map(items.map((i) => [i.id, i.sort_order] as const));

      // Build the full sibling set with proposed sort orders, then normalize
      // to contiguous 0..N-1 positions preserving the resulting order.
      const projected = snapshot.phases
        .map((ph) => ({
          id: ph.id,
          updated_at: ph.updated_at,
          proposed: overrides.has(ph.id) ? (overrides.get(ph.id) as number) : ph.sort_order,
          original: ph.sort_order,
        }))
        .sort((a, b) => a.proposed - b.proposed || a.original - b.original);

      const rowsPayload = projected.map((row, index) => ({
        id: row.id,
        expected_updated_at: row.updated_at,
        new_sort_order: index,
      }));

      const { data, error } = await supabase.rpc("reorder_phases", {
        _project_id: snapshot.projectId,
        _rows: rowsPayload as unknown as never,
      });
      if (error) throw error;

      const result = parsePmgCommandResult(data);
      if (result.status === "applied" || result.status === "no_change") {
        return result;
      }
      if (result.status === "conflict") {
        throw new Error("Phase order is out of date. Please refresh and try again.");
      }
      if (result.status === "not_authorized") {
        throw new Error("You are not authorized to reorder Phases in this Project.");
      }
      // invalid or any other non-success status
      throw new Error("Reorder rejected by validation. Please refresh and try again.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-phases"] });
    },
  });
}

// --- Tasks (reads via decrypted RPC) ---

export function usePhaseTasks(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-tasks", projectId],
    queryFn: async () => {
      if (!projectId) throw new Error("No project ID");
      const { data, error } = await supabase.rpc("list_decrypted_project_tasks", {
        _project_id: projectId,
      });
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: !!projectId,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: TablesInsert<"tasks">) => {
      if (!values.phase_id) {
        throw new Error("phase_id is required to create a Task.");
      }
      const { data, error } = await supabase.rpc("apply_task_create", {
        _phase_id: values.phase_id,
        _name: values.name,
        _description: values.description ?? undefined,
        _status: (values.status ?? undefined) as never,
        _priority: (values.priority ?? undefined) as never,
        _task_type: (values.task_type ?? undefined) as never,
        _start_date: values.start_date ?? undefined,
        _due_date: values.due_date ?? undefined,
        _estimated_hours: values.estimated_hours ?? undefined,
        _sort_order: values.sort_order ?? undefined,
      });
      if (error) throw error;

      const result = parsePmgCommandResult(data);
      if (result.status === "applied") {
        const payload = (result.data ?? {}) as {
          id?: string;
          project_id?: string;
          phase_id?: string;
          sort_order?: number;
          updated_at?: string;
        };
        return {
          id: payload.id,
          project_id: payload.project_id,
          phase_id: payload.phase_id ?? values.phase_id,
          sort_order: payload.sort_order,
          updated_at: payload.updated_at,
        };
      }
      if (result.status === "confirmation_required") {
        throw new Error(
          "The Task dates fall outside the parent Phase's planned window. Extend the Phase window first, then retry.",
        );
      }
      if (result.status === "not_authorized") {
        throw new Error("You are not authorized to create Tasks in this Project.");
      }
      throw new Error("Task create rejected by validation. Please review the inputs and try again.");
    },
    onSuccess: (data) => {
      if (data?.project_id) {
        qc.invalidateQueries({ queryKey: ["project-tasks", data.project_id] });
        qc.invalidateQueries({ queryKey: ["project", data.project_id] });
      } else {
        qc.invalidateQueries({ queryKey: ["project-tasks"] });
      }
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      project_id,
      ...values
    }: TablesUpdate<"tasks"> & { id: string; project_id: string }) => {
      // Read the canonical fresh updated_at for optimistic concurrency. Cached
      // list snapshots can be stale (e.g. on the Task detail surface), which
      // produced spurious "updated elsewhere" conflicts.
      let expectedUpdatedAt: string | undefined;
      const { data: fresh } = await supabase.rpc("get_decrypted_task", { _task_id: id } as any);
      const freshRow: any = Array.isArray(fresh) ? fresh[0] : fresh;
      if (typeof freshRow?.updated_at === "string") {
        expectedUpdatedAt = freshRow.updated_at;
      }
      if (!expectedUpdatedAt) {
        const entries = qc.getQueriesData<TaskSnapshotRow[]>({ queryKey: ["project-tasks"] });
        for (const [, data] of entries) {
          if (!Array.isArray(data)) continue;
          const row = data.find((t) => t.id === id);
          if (row?.updated_at) {
            expectedUpdatedAt = row.updated_at;
            break;
          }
        }
      }
      if (!expectedUpdatedAt) {
        throw new Error("Task update failed: no current snapshot available. Please refresh and try again.");
      }


      // Forward only allowed non-date fields. Silently ignore dates/order/system fields;
      // date updates are handled by the planning preview/apply RPCs.
      const v = values as Record<string, unknown>;
      const { data, error } = await supabase.rpc("apply_task_update", {
        _task_id: id,
        _expected_updated_at: expectedUpdatedAt,
        _name: (v.name as string) ?? "",
        _description: (v.description as string | null | undefined) ?? undefined,
        _status: (v.status ?? undefined) as never,
        _priority: (v.priority ?? undefined) as never,
        _task_type: (v.task_type ?? undefined) as never,
        _estimated_hours: (v.estimated_hours as number | null | undefined) ?? undefined,
      });
      if (error) throw error;

      const result = parsePmgCommandResult(data);
      if (result.status === "applied" || result.status === "no_change") {
        const payload = (result.data ?? {}) as {
          id?: string;
          project_id?: string;
          updated_at?: string;
        };
        return {
          id: payload.id ?? id,
          project_id: payload.project_id ?? project_id,
          updated_at: payload.updated_at,
        };
      }
      if (result.status === "conflict") {
        throw new Error("This Task was updated elsewhere. Please refresh and try again.");
      }
      if (result.status === "not_authorized") {
        throw new Error("You are not authorized to update this Task.");
      }
      throw new Error("Task update rejected by validation. Please review the inputs and try again.");
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["project-tasks", data.project_id] });
      qc.invalidateQueries({ queryKey: ["project", data.project_id] });
      qc.invalidateQueries({ queryKey: ["task-detail", data.id] });
    },
  });
}


type TaskSnapshotRow = {
  id: string;
  phase_id: string;
  project_id: string;
  sort_order: number;
  updated_at: string;
};

function findTaskSnapshotForIds(
  qc: QueryClient,
  targetIds: Set<string>,
): { phaseId: string; tasks: TaskSnapshotRow[] } | null {
  const entries = qc.getQueriesData<TaskSnapshotRow[]>({ queryKey: ["project-tasks"] });
  for (const [, data] of entries) {
    if (!Array.isArray(data) || data.length === 0) continue;
    const byId = new Map(data.map((t) => [t.id, t] as const));
    let matched = 0;
    const phaseIds = new Set<string>();
    targetIds.forEach((id) => {
      const row = byId.get(id);
      if (row) {
        matched += 1;
        phaseIds.add(row.phase_id);
      }
    });
    if (matched === targetIds.size && phaseIds.size === 1) {
      const phaseId = Array.from(phaseIds)[0];
      const siblings = data.filter((t) => t.phase_id === phaseId);
      return { phaseId, tasks: siblings };
    }
  }
  return null;
}

export function useReorderTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: { id: string; sort_order: number }[]) => {
      if (items.length === 0) return;
      const targetIds = new Set(items.map((i) => i.id));
      const snapshot = findTaskSnapshotForIds(qc, targetIds);
      if (!snapshot) {
        throw new Error("Reorder failed: no cached Task snapshot available. Please refresh and try again.");
      }
      const overrides = new Map(items.map((i) => [i.id, i.sort_order] as const));

      const projected = snapshot.tasks
        .map((t) => ({
          id: t.id,
          updated_at: t.updated_at,
          proposed: overrides.has(t.id) ? (overrides.get(t.id) as number) : t.sort_order,
          original: t.sort_order,
        }))
        .sort((a, b) => a.proposed - b.proposed || a.original - b.original);

      const rowsPayload = projected.map((row, index) => ({
        id: row.id,
        expected_updated_at: row.updated_at,
        new_sort_order: index,
      }));

      const { data, error } = await supabase.rpc("reorder_tasks", {
        _phase_id: snapshot.phaseId,
        _rows: rowsPayload as unknown as never,
      });
      if (error) throw error;

      const result = parsePmgCommandResult(data);
      if (result.status === "applied" || result.status === "no_change") {
        return result;
      }
      if (result.status === "conflict") {
        throw new Error("Task order is out of date. Please refresh and try again.");
      }
      if (result.status === "not_authorized") {
        throw new Error("You are not authorized to reorder Tasks in this Phase.");
      }
      throw new Error("Reorder rejected by validation. Please refresh and try again.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-tasks"] });
    },
  });
}

// --- Dependencies ---

export function useProjectDependencies(projectId: string | undefined, phaseIds: string[], taskIds: string[]) {
  // Stable, set-aware key: sorted ids hashed into the query key so the cache
  // refetches when the in-project object set actually changes (new phase/task,
  // archived item, reorder that adds/removes ids), instead of being keyed only
  // by projectId and going stale.
  const sortedPhaseIds = [...phaseIds].sort();
  const sortedTaskIds = [...taskIds].sort();
  const idSetKey = `${sortedPhaseIds.join(",")}|${sortedTaskIds.join(",")}`;

  return useQuery({
    queryKey: ["project-dependencies", projectId, idSetKey],
    queryFn: async () => {
      if (!projectId) throw new Error("No project ID");
      const allIds = [...sortedPhaseIds, ...sortedTaskIds];
      if (allIds.length === 0) return [];
      const { data, error } = await supabase
        .from("dependencies")
        .select("*")
        .or(`source_id.in.(${allIds.join(",")}),target_id.in.(${allIds.join(",")})`);
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId && (phaseIds.length > 0 || taskIds.length > 0),
  });
}

export function useCreateDependency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: TablesInsert<"dependencies">) => {
      // v1: same-level + Finish-to-Start; server also enforces these.
      if (values.source_type !== values.target_type) {
        throw new Error("Dependencies must be same-level: source and target must be the same type.");
      }
      if (values.source_id === values.target_id) {
        throw new Error("A dependency cannot reference itself.");
      }
      const { data, error } = await supabase.rpc("create_dependency", {
        _source_type: values.source_type,
        _source_id: values.source_id,
        _target_type: values.target_type,
        _target_id: values.target_id,
      });
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status === "applied") return result.data ?? {};
      if (result.status === "not_authorized") {
        throw new Error("You do not have permission to manage dependencies here.");
      }
      const reason =
        (result.data as { reason?: string } | null | undefined)?.reason ?? "";
      if (reason === "not_same_level") {
        throw new Error("Dependencies must be same-level: source and target must be the same type.");
      }
      if (reason === "self_reference") {
        throw new Error("A dependency cannot reference itself.");
      }
      if (reason === "duplicate") {
        throw new Error("This dependency already exists.");
      }
      if (reason === "cross_project" || reason === "cross_org") {
        throw new Error("Dependencies must stay within the same project.");
      }
      if (reason === "invalid_target") {
        throw new Error("Invalid dependency target.");
      }
      throw new Error("Could not add dependency. Please review and try again.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-dependencies"] });
      qc.invalidateQueries({ queryKey: ["entity-deps"] });
      qc.invalidateQueries({ queryKey: ["activity-events"] });
    },
  });
}

export function useDeleteDependency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; expected_updated_at: string }) => {
      const { data, error } = await supabase.rpc("remove_dependency", {
        _dependency_id: args.id,
        _expected_updated_at: args.expected_updated_at,
      });
      if (error) throw error;
      const result = parsePmgCommandResult(data);
      if (result.status === "applied") return { id: args.id };
      if (result.status === "not_authorized") {
        throw new Error("You do not have permission to remove this dependency.");
      }
      if (result.status === "conflict") {
        throw new Error("This dependency changed since you loaded it. Please refresh and try again.");
      }
      throw new Error("Could not remove dependency. Please try again.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-dependencies"] });
      qc.invalidateQueries({ queryKey: ["entity-deps"] });
      qc.invalidateQueries({ queryKey: ["activity-events"] });
    },
  });
}

