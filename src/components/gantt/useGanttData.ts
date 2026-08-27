import { useMemo } from "react";
import type { Tables } from "@/integrations/supabase/types";
import { parseDate, daysBetween, addDays, formatMonthLabel, DAY_WIDTH, ROW_HEIGHT } from "./ganttUtils";
import type { GanttRow, Phase, Task, Dep } from "./ganttUtils";

// NOTE: useGanttTimeline is preserved for backward compat but no longer used by GanttChart;
// timeline window is now provided by useTimelineZoom.

export interface GanttFindOptions {
  matchedPhaseIds: Set<string>;
  matchedTaskIds: Set<string>;
  contextPhaseIds: Set<string>;
  matchesOnly: boolean;
  active: boolean;
}

export function useGanttRows(
  phases: Phase[],
  tasks: Task[],
  collapsed: Record<string, boolean>,
  statusFilter: string,
  hideCompleted: boolean,
  membersMap: Record<string, string>,
  findOptions?: GanttFindOptions,
): GanttRow[] {
  return useMemo(() => {
    const find = findOptions;
    const useFilter = !!find && find.active && find.matchesOnly;
    const result: GanttRow[] = [];
    const sortedPhases = [...phases].sort((a, b) => a.sort_order - b.sort_order);
    for (const phase of sortedPhases) {
      if (statusFilter !== "all" && phase.status !== statusFilter) continue;
      if (hideCompleted && phase.status === "completed") continue;
      if (useFilter && !find!.contextPhaseIds.has(phase.id)) continue;
      const phaseIsMatch = !!find?.active && find.matchedPhaseIds.has(phase.id);
      result.push({
        type: "phase", id: phase.id, name: phase.name, status: phase.status,
        start: phase.start_date, end: phase.target_end_date,
        baselineStart: (phase as any).baseline_start_date ?? null,
        baselineEnd: (phase as any).baseline_end_date ?? null,
        addedAfterBaseline: (phase as any).added_after_baseline ?? false,
        actualStart: (phase as any).actual_start_date ?? null,
        actualEnd: (phase as any).actual_end_date ?? null,
        isFindMatch: phaseIsMatch,
      });
      // Only force-expand while matches-only is active, to reveal matching tasks under context phases.
      const effectivelyCollapsed = useFilter ? false : collapsed[phase.id];
      if (!effectivelyCollapsed) {
        const phaseTasks = tasks.filter(t => t.phase_id === phase.id).sort((a, b) => a.sort_order - b.sort_order);
        for (const task of phaseTasks) {
          if (statusFilter !== "all" && task.status !== statusFilter) continue;
          if (hideCompleted && task.status === "completed") continue;
          if (useFilter && !find!.matchedTaskIds.has(task.id)) continue;
          const assigneeId = task.task_assignments?.[0]?.assignee_id || null;
          result.push({
            type: "task", id: task.id, name: task.name, status: task.status,
            start: task.start_date, end: task.due_date, phaseId: task.phase_id,
            baselineStart: (task as any).baseline_start_date ?? null,
            baselineEnd: (task as any).baseline_end_date ?? null,
            addedAfterBaseline: (task as any).added_after_baseline ?? false,
            assignee: assigneeId ? (membersMap[assigneeId] || assigneeId.slice(0, 8)) : null,
            taskType: task.task_type,
            actualStart: (task as any).actual_start_date ?? null,
            actualEnd: (task as any).actual_end_date ?? null,
            isFindMatch: !!find?.active && find.matchedTaskIds.has(task.id),
          });
        }
      }
    }
    return result;
  }, [phases, tasks, collapsed, statusFilter, hideCompleted, membersMap, findOptions]);
}

export function useGanttTimeline(rows: GanttRow[], project: Tables<"projects">) {
  return useMemo(() => {
    const allDates: Date[] = [];
    for (const r of rows) {
      const s = parseDate(r.start);
      const e = parseDate(r.end);
      if (s) allDates.push(s);
      if (e) allDates.push(e);
    }
    const ps = parseDate(project.start_date);
    const pe = parseDate(project.target_end_date);
    if (ps) allDates.push(ps);
    if (pe) allDates.push(pe);

    if (allDates.length === 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      allDates.push(today, addDays(today, 30));
    }

    const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));
    const start = addDays(minDate, -7);
    const end = addDays(maxDate, 14);
    const total = daysBetween(start, end);

    const markers: { label: string; x: number; width: number }[] = [];
    let cursor = new Date(start);
    cursor.setDate(1);
    if (cursor < start) cursor.setMonth(cursor.getMonth() + 1);
    while (cursor <= end) {
      const nextMonth = new Date(cursor);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      const mStart = Math.max(0, daysBetween(start, cursor));
      const mEnd = Math.min(total, daysBetween(start, nextMonth));
      markers.push({ label: formatMonthLabel(cursor), x: mStart * DAY_WIDTH, width: (mEnd - mStart) * DAY_WIDTH });
      cursor = nextMonth;
    }

    return { timelineStart: start, totalDays: total, monthMarkers: markers };
  }, [rows, project]);
}

export function useGanttDependencyLines(
  rows: GanttRow[],
  dependencies: Dep[],
  timelineStart: Date,
  dayWidth: number = DAY_WIDTH,
) {
  const visibleIds = useMemo(() => new Set(rows.map(r => r.id)), [rows]);

  return useMemo(() => {
    const rowIndex: Record<string, number> = {};
    rows.forEach((r, i) => { rowIndex[r.id] = i; });

    const lines: { x1: number; y1: number; x2: number; y2: number; key: string }[] = [];
    for (const dep of dependencies) {
      if (dep.source_type !== dep.target_type) continue;
      if (!visibleIds.has(dep.source_id) || !visibleIds.has(dep.target_id)) continue;

      const srcRow = rows[rowIndex[dep.source_id]];
      const tgtRow = rows[rowIndex[dep.target_id]];
      if (!srcRow || !tgtRow) continue;

      const srcEnd = parseDate(srcRow.end || srcRow.start);
      const tgtStart = parseDate(tgtRow.start || tgtRow.end);
      if (!srcEnd || !tgtStart) continue;

      const x1 = daysBetween(timelineStart, srcEnd) * dayWidth + dayWidth / 2;
      const y1 = rowIndex[dep.source_id] * ROW_HEIGHT + ROW_HEIGHT / 2;
      const x2 = daysBetween(timelineStart, tgtStart) * dayWidth;
      const y2 = rowIndex[dep.target_id] * ROW_HEIGHT + ROW_HEIGHT / 2;
      lines.push({ x1, y1, x2, y2, key: dep.id });
    }
    return lines;
  }, [dependencies, rows, visibleIds, timelineStart, dayWidth]);
}
