import { useMemo } from "react";
import { useProjectPhases, usePhaseTasks, useProjectDependencies } from "@/hooks/useProjectPlanning";
import type { CalendarItem } from "./calendarUtils";

/**
 * Single source for the project Calendar surface.
 * Reads canonical phases / tasks / dependencies through the same protected
 * RPCs used by Planning and Gantt — no separate persistence.
 */
export function useProjectCalendarData(projectId: string | undefined) {
  const phasesQ = useProjectPhases(projectId);
  const tasksQ = usePhaseTasks(projectId);

  const phases = phasesQ.data ?? [];
  const tasks = tasksQ.data ?? [];

  const phaseIds = useMemo(() => phases.map((p: any) => p.id), [phases]);
  const taskIds = useMemo(() => tasks.map((t: any) => t.id), [tasks]);
  const depsQ = useProjectDependencies(projectId, phaseIds, taskIds);

  const items: CalendarItem[] = useMemo(() => {
    const list: CalendarItem[] = [];
    for (const p of phases as any[]) {
      list.push({
        id: p.id,
        kind: "phase",
        name: p.name,
        semanticType: p.phase_type ?? "work_item",
        status: p.status,
        start: p.start_date ?? null,
        end: p.target_end_date ?? null,
        keyDate: p.target_end_date ?? null,
        raw: p,
      });
    }
    for (const t of tasks as any[]) {
      list.push({
        id: t.id,
        kind: "task",
        name: t.name,
        semanticType: t.task_type ?? "work_item",
        status: t.status,
        start: t.start_date ?? null,
        end: t.due_date ?? null,
        keyDate: t.due_date ?? null,
        raw: t,
      });
    }
    return list;
  }, [phases, tasks]);

  const itemsById = useMemo(() => {
    const m: Record<string, CalendarItem> = {};
    for (const it of items) m[it.id] = it;
    return m;
  }, [items]);

  return {
    phases,
    tasks,
    dependencies: (depsQ.data ?? []) as any[],
    items,
    itemsById,
    isLoading: phasesQ.isLoading || tasksQ.isLoading,
    /** Separate dependency-loading signal — drawer must wait for this before
     *  rendering an empty/standalone state. */
    dependenciesLoading: depsQ.isLoading || depsQ.isFetching,
  };
}
