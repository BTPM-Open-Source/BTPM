/**
 * Phase 4F.4 — Gantt edit routing.
 *
 * Replaces direct date writes with the canonical execution-aware path:
 *   - Tasks: not-started → 4F.3 task preview/apply; in-progress/completed → block.
 *   - Phases: 4F.4 phase timeline preview/apply (move_phase_plan vs shift_remaining_work vs resize_phase).
 *
 * Raw BTPM_CONTAINMENT_* / BTPM_GANTT_* / BTPM_DEP_* texts are mapped to
 * friendly product copy. The Gantt never writes phases/tasks directly.
 */
import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { parseDate, addDays, formatDateISO } from "./ganttUtils";
import type { GanttRow, Dep } from "./ganttUtils";
import { mapDependencyError } from "@/lib/dependencyConflictEngine";
import {
  previewTaskPlanningChange,
  applyTaskPlanningChange,
  previewPhaseTimelineAction,
  applyPhaseTimelineAction,
  describeBlockedReason,
  type PhaseTimelinePreview,
  type PhaseTimelineAction,
} from "@/lib/planningService";
import { DATE_RANGE_ERROR_MESSAGE, isInvalidDateRange } from "@/lib/dateRangeValidation";

interface DragState {
  rowId: string;
  rowType: "phase" | "task";
  mode: "move" | "resize-start" | "resize-end";
  startX: number;
  origStart: Date;
  origEnd: Date;
}

export interface PendingPhaseConfirm {
  phaseId: string;
  preview: PhaseTimelinePreview;
  action: PhaseTimelineAction;
  newStart: string;
  newEnd: string;
}

export interface PendingTaskExtensionConfirm {
  taskId: string;
  newStart: string;
  newDue: string;
  parentPhaseName: string;
  parentCurrentStart: string | null;
  parentCurrentEnd: string | null;
  parentProposedStart: string | null;
  parentProposedEnd: string | null;
}

/** Map any error from the canonical Gantt/planning RPCs to friendly text. */
function mapGanttError(err: any): string {
  const raw = (err?.message ? String(err.message) : String(err ?? "")).trim();
  // BTPM_GANTT_BLOCKED: <reason_code>
  let m = raw.match(/BTPM_GANTT_BLOCKED:\s*(.*)$/);
  if (m) return describeBlockedReason(m[1].trim());
  if (/BTPM_GANTT_NEEDS_PROJECT_EXT/i.test(raw)) {
    return "Project extension confirmation is required to apply this move.";
  }
  // 4F.3 / 4F.2 hard guards.
  m = raw.match(/BTPM_CONTAINMENT[A-Z_]*:\s*(.*)$/);
  if (m) return describeBlockedReason(m[1].trim()) || "This change would break parent–child planned containment.";
  if (/check_violation/i.test(raw) && /allow_planned_extension|containment/i.test(raw)) {
    return "This change requires extending the parent. Please confirm extension.";
  }
  // Fall back to dependency engine mapper (handles BTPM_DEP_*).
  return mapDependencyError(err);
}

export function useGanttEdit(
  rows: GanttRow[],
  _dependencies: Dep[],
  _timelineStart: Date,
  projectId: string | undefined,
  _organizationId: string | undefined,
  dayWidth: number,
) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragDelta, setDragDelta] = useState(0);
  const [pendingPhaseConfirm, setPendingPhaseConfirm] = useState<PendingPhaseConfirm | null>(null);
  const [pendingTaskConfirm, setPendingTaskConfirm] = useState<PendingTaskExtensionConfirm | null>(null);
  const qc = useQueryClient();

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["project-phases", projectId] });
    qc.invalidateQueries({ queryKey: ["project-tasks", projectId] });
    qc.invalidateQueries({ queryKey: ["project", projectId] });
    qc.invalidateQueries({ queryKey: ["activity-events"] });
  }, [qc, projectId]);

  // ── Task save (4F.3 path) ────────────────────────────────────────────
  // confirmExtension: when true, applies with phase-extension consent (used
  // after the explicit ParentExtensionConfirmDialog is accepted).
  const taskMutation = useMutation({
    mutationFn: async (params: { taskId: string; newStart: string; newDue: string; confirmExtension: boolean }) => {
      await applyTaskPlanningChange(params.taskId, params.newStart, params.newDue, params.confirmExtension);
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Task schedule updated");
    },
    onError: (err: any) => {
      toast.error(mapGanttError(err));
    },
  });

  // ── Phase apply (4F.4 path) ──────────────────────────────────────────
  const phaseApplyMutation = useMutation({
    mutationFn: async (params: {
      phaseId: string;
      action: PhaseTimelineAction;
      newStart: string;
      newEnd: string;
      confirmProjectExt: boolean;
    }) => {
      await applyPhaseTimelineAction(
        params.phaseId, params.action, params.newStart, params.newEnd, params.confirmProjectExt,
      );
    },
    onSuccess: () => {
      invalidateAll();
      toast.success("Phase schedule updated");
    },
    onError: (err: any) => {
      toast.error(mapGanttError(err));
    },
  });

  // ── Drag wiring ──────────────────────────────────────────────────────
  const handleDragStart = useCallback((
    e: React.MouseEvent,
    row: GanttRow,
    mode: "move" | "resize-start" | "resize-end",
  ) => {
    e.preventDefault();
    e.stopPropagation();

    // Pre-flight task lifecycle gates so the UI never even starts a drag on
    // anchored work — clearer than failing at apply time.
    if (row.type === "task") {
      if (row.actualEnd || row.status === "completed") {
        toast.error("This task is completed. Reopen it before changing its schedule.");
        return;
      }
      if (row.actualStart) {
        toast.error("This task has already started. It can no longer be rescheduled from Gantt.");
        return;
      }
    }

    const start = parseDate(row.start) || parseDate(row.end);
    const end = parseDate(row.end) || parseDate(row.start);
    if (!start || !end) return;
    setDragState({
      rowId: row.id,
      rowType: row.type,
      mode,
      startX: e.clientX,
      origStart: start,
      origEnd: end,
    });
    setDragDelta(0);
  }, []);

  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!dragState) return;
    setDragDelta(e.clientX - dragState.startX);
  }, [dragState]);

  const handleDragEnd = useCallback(async () => {
    if (!dragState) return;
    const daysDelta = Math.round(dragDelta / dayWidth);

    let newStart: Date;
    let newEnd: Date;
    if (dragState.mode === "move") {
      newStart = addDays(dragState.origStart, daysDelta);
      newEnd = addDays(dragState.origEnd, daysDelta);
    } else if (dragState.mode === "resize-start") {
      newStart = addDays(dragState.origStart, daysDelta);
      newEnd = dragState.origEnd;
    } else {
      newStart = dragState.origStart;
      newEnd = addDays(dragState.origEnd, daysDelta);
    }

    const rowId = dragState.rowId;
    const rowType = dragState.rowType;
    setDragState(null);
    setDragDelta(0);

    if (daysDelta === 0) return;
    if (isInvalidDateRange(formatDateISO(newStart), formatDateISO(newEnd))) {
      toast.error(DATE_RANGE_ERROR_MESSAGE);
      return;
    }

    const isoStart = formatDateISO(newStart);
    const isoEnd = formatDateISO(newEnd);

    if (rowType === "task") {
      try {
        const preview = await previewTaskPlanningChange(rowId, null, isoStart, isoEnd);
        if (preview.blocked) {
          toast.error(describeBlockedReason(preview.blocked_reason));
          return;
        }
        if (preview.requires_extension) {
          setPendingTaskConfirm({
            taskId: rowId,
            newStart: isoStart,
            newDue: isoEnd,
            parentPhaseName: preview.parent_phase_name ?? "Phase",
            parentCurrentStart: preview.parent_current_start,
            parentCurrentEnd: preview.parent_current_end,
            parentProposedStart: preview.parent_proposed_start,
            parentProposedEnd: preview.parent_proposed_end,
          });
          return;
        }
        taskMutation.mutate({ taskId: rowId, newStart: isoStart, newDue: isoEnd, confirmExtension: false });
      } catch (err: any) {
        toast.error(mapGanttError(err));
      }
      return;
    }

    // Phase: preview first to decide between confirm flow and direct apply.
    const action: PhaseTimelineAction = dragState.mode === "move" ? "drag" : "resize";
    try {
      const preview = await previewPhaseTimelineAction(rowId, action, isoStart, isoEnd);
      if (preview.blocked) {
        toast.error(describeBlockedReason(preview.blocked_reason));
        return;
      }
      const needsConfirm =
        preview.resolved_action === "shift_remaining_work" ||
        !!preview.requires_project_extension;

      if (needsConfirm) {
        setPendingPhaseConfirm({ phaseId: rowId, preview, action, newStart: isoStart, newEnd: isoEnd });
        return;
      }
      // move_phase_plan with no project extension → apply silently.
      phaseApplyMutation.mutate({
        phaseId: rowId,
        action,
        newStart: isoStart,
        newEnd: isoEnd,
        confirmProjectExt: false,
      });
    } catch (err: any) {
      toast.error(mapGanttError(err));
    }
  }, [dragState, dragDelta, dayWidth, taskMutation, phaseApplyMutation]);

  const confirmPendingPhase = useCallback(() => {
    if (!pendingPhaseConfirm) return;
    const { phaseId, preview, action, newStart, newEnd } = pendingPhaseConfirm;
    phaseApplyMutation.mutate({
      phaseId,
      action,
      newStart,
      newEnd,
      confirmProjectExt: !!preview.requires_project_extension,
    }, {
      onSettled: () => setPendingPhaseConfirm(null),
    });
  }, [pendingPhaseConfirm, phaseApplyMutation]);

  const cancelPendingPhase = useCallback(() => setPendingPhaseConfirm(null), []);

  const confirmPendingTask = useCallback(() => {
    if (!pendingTaskConfirm) return;
    const { taskId, newStart, newDue } = pendingTaskConfirm;
    taskMutation.mutate(
      { taskId, newStart, newDue, confirmExtension: true },
      { onSettled: () => setPendingTaskConfirm(null) },
    );
  }, [pendingTaskConfirm, taskMutation]);

  const cancelPendingTask = useCallback(() => setPendingTaskConfirm(null), []);

  // Compute preview offset for a bar during drag.
  const getBarOffset = useCallback((rowId: string): { dx: number; dw: number } => {
    if (!dragState || dragState.rowId !== rowId) return { dx: 0, dw: 0 };
    const daysDelta = Math.round(dragDelta / dayWidth);
    const px = daysDelta * dayWidth;
    if (dragState.mode === "move") return { dx: px, dw: 0 };
    if (dragState.mode === "resize-start") return { dx: px, dw: -px };
    return { dx: 0, dw: px };
  }, [dragState, dragDelta, dayWidth]);

  // Live proposed dates for the bar currently being dragged/resized.
  // Visual-only — does not influence apply logic.
  const dragPreview = (() => {
    if (!dragState) return null;
    const daysDelta = Math.round(dragDelta / dayWidth);
    let newStart: Date;
    let newEnd: Date;
    if (dragState.mode === "move") {
      newStart = addDays(dragState.origStart, daysDelta);
      newEnd = addDays(dragState.origEnd, daysDelta);
    } else if (dragState.mode === "resize-start") {
      newStart = addDays(dragState.origStart, daysDelta);
      newEnd = dragState.origEnd;
    } else {
      newStart = dragState.origStart;
      newEnd = addDays(dragState.origEnd, daysDelta);
    }
    const durationDays = Math.max(1, Math.round((newEnd.getTime() - newStart.getTime()) / 86400000) + 1);
    return {
      rowId: dragState.rowId,
      rowType: dragState.rowType,
      mode: dragState.mode,
      newStart,
      newEnd,
      newStartISO: formatDateISO(newStart),
      newEndISO: formatDateISO(newEnd),
      durationDays,
    };
  })();

  return {
    dragState,
    dragPreview,
    handleDragStart,
    handleDragMove,
    handleDragEnd,
    getBarOffset,
    isPending: taskMutation.isPending || phaseApplyMutation.isPending,
    pendingPhaseConfirm,
    confirmPendingPhase,
    cancelPendingPhase,
    pendingTaskConfirm,
    confirmPendingTask,
    cancelPendingTask,
  };
}
