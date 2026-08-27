import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import type { Tables } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";
import { ChevronRight, ChevronDown, Pencil, ArrowUp, ArrowDown, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReorderPhases, useReorderTasks } from "@/hooks/useProjectPlanning";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

import { parseDate, daysBetween, ROW_HEIGHT, HEADER_HEIGHT, LABEL_WIDTH } from "./ganttUtils";
import type { Phase, Task, Dep } from "./ganttUtils";
import { useGanttRows, useGanttDependencyLines, type GanttFindOptions } from "./useGanttData";
import { FindInProjectToolbar } from "@/components/project/FindInProjectToolbar";
import { computeFindState, type FindResult } from "@/lib/projectFindInProject";
import { useGanttEdit } from "./useGanttEdit";
import { useTimelineZoom, ZOOM_LEVELS, type ZoomLevel } from "./useTimelineZoom";
import { TimelineZoomControls } from "./TimelineZoomControls";
import { TimelineAxis } from "./TimelineAxis";
import { BaselineLegend } from "@/components/baseline/BaselineLegend";
import { ClonePhaseDialog } from "@/components/planning/ClonePhaseDialog";
import { CloneTaskDialog } from "@/components/planning/CloneTaskDialog";
import { GanttActionConfirmDialog } from "./GanttActionConfirmDialog";
import { ParentExtensionConfirmDialog } from "@/components/planning/ParentExtensionConfirmDialog";
import { usePersistedViewState, codecs } from "@/hooks/usePersistedViewState";
import { useSavedViews } from "@/hooks/useSavedViews";
import { SavedViewsControl } from "@/components/views/SavedViewsControl";
import {
  getPmWorkflowStatusHex,
  getPmWorkflowStatusLabel,
} from "@/lib/btpmVisualSemantics";



const GANTT_STATUS_VALUES = ["all", "planned", "active", "completed", "on_hold", "cancelled"] as const;
type GanttStatusFilter = typeof GANTT_STATUS_VALUES[number];

/* ── Saved-view snapshot shape (durable fields only) ── */
interface GanttSavedView {
  statusFilter: GanttStatusFilter;
  hideCompleted: boolean;
  showBaseline: boolean;
  zoom: ZoomLevel;
}
const isGanttSavedView = (raw: unknown): raw is GanttSavedView => {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.statusFilter === "string" &&
    (GANTT_STATUS_VALUES as readonly string[]).includes(r.statusFilter) &&
    typeof r.hideCompleted === "boolean" &&
    typeof r.showBaseline === "boolean" &&
    typeof r.zoom === "string" &&
    (ZOOM_LEVELS as readonly string[]).includes(r.zoom)
  );
};

/* Bar colors derive from canonical PM workflow status hex — no local map. */

const BAR_HEIGHT_PHASE = 22;
const BAR_HEIGHT_TASK = 16;
const HANDLE_WIDTH = 6;



interface GanttChartProps {
  project: Tables<"projects">;
  phases: Phase[];
  tasks: Task[];
  dependencies: Dep[];
  membersMap: Record<string, string>;
  canEdit?: boolean;
}

export function GanttChart({ project, phases, tasks, dependencies, membersMap, canEdit = false }: GanttChartProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();

  const { state: viewState, setField: setViewField } = usePersistedViewState({
    viewId: "gantt",
    scopeKey: project.id,
    schema: {
      statusFilter: {
        mode: "url",
        urlKey: "status",
        default: "all" as GanttStatusFilter,
        codec: codecs.stringEnum(GANTT_STATUS_VALUES),
      },
      hideCompleted: {
        mode: "url",
        urlKey: "hideDone",
        default: false,
        codec: codecs.boolean,
      },
      showBaseline: {
        mode: "url",
        urlKey: "baseline",
        default: true,
        codec: codecs.boolean,
      },
      zoom: {
        mode: "url",
        urlKey: "zoom",
        default: "month" as ZoomLevel,
        codec: codecs.stringEnum(ZOOM_LEVELS),
      },
      collapsedPhaseIds: {
        mode: "local",
        default: [] as string[],
        codec: codecs.stringArray(","),
      },
    },
  });

  const statusFilter = viewState.statusFilter;
  const hideCompleted = viewState.hideCompleted;
  const showBaseline = viewState.showBaseline;
  const setStatusFilter = useCallback((v: string) => setViewField("statusFilter", (v as GanttStatusFilter)), [setViewField]);
  const setHideCompleted = useCallback((v: boolean) => setViewField("hideCompleted", v), [setViewField]);
  const setShowBaseline = useCallback((v: boolean) => setViewField("showBaseline", v), [setViewField]);

  /* ── Saved views (Phase 4E.6) — durable fields only; collapsed phases intentionally excluded ── */
  const savedViews = useSavedViews<GanttSavedView>({
    viewId: "gantt",
    scopeKey: project.id,
    validate: isGanttSavedView,
  });
  const currentSavedSnapshot: GanttSavedView = useMemo(
    () => ({
      statusFilter,
      hideCompleted,
      showBaseline,
      zoom: viewState.zoom,
    }),
    [statusFilter, hideCompleted, showBaseline, viewState.zoom],
  );
  const applySavedView = useCallback(
    (snap: GanttSavedView) => {
      setViewField("statusFilter", snap.statusFilter);
      setViewField("hideCompleted", snap.hideCompleted);
      setViewField("showBaseline", snap.showBaseline);
      setViewField("zoom", snap.zoom);
    },
    [setViewField],
  );

  // Derive collapsed Record from persisted ids
  const collapsed = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const id of viewState.collapsedPhaseIds) map[id] = true;
    return map;
  }, [viewState.collapsedPhaseIds]);

  const [clonePhase, setClonePhase] = useState<{ id: string; name: string } | null>(null);
  const [cloneTask, setCloneTask] = useState<{ id: string; name: string } | null>(null);
  const isBaselined = !!(project as any).is_baselined;


  const scrollRef = useRef<HTMLDivElement>(null);
  const viewportElRef = useRef<HTMLElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(0);
  const didAutoScroll = useRef(false);

  // Find-in-project (frontend-only)
  const [findQuery, setFindQuery] = useState("");
  const [matchesOnly, setMatchesOnly] = useState(false);
  const findState = useMemo(
    () => computeFindState(findQuery, phases, tasks),
    [findQuery, phases, tasks]
  );
  const findOptions: GanttFindOptions = useMemo(
    () => ({
      matchedPhaseIds: findState.matchedPhaseIds,
      matchedTaskIds: findState.matchedTaskIds,
      contextPhaseIds: findState.contextPhaseIds,
      matchesOnly,
      active: findState.active,
    }),
    [findState, matchesOnly]
  );
  const editingLocked = findState.active && matchesOnly;
  const effectiveCanEdit = canEdit && !editingLocked;

  const rows = useGanttRows(phases, tasks, collapsed, statusFilter, hideCompleted, membersMap, findOptions);

  // Canonical sibling reorder (writes to phases.sort_order / tasks.sort_order — same as Planning).
  const reorderPhases = useReorderPhases();
  const reorderTasks = useReorderTasks();

  // Sibling-aware neighbor lookup keyed off canonical sort_order, NOT visible row index.
  // This guarantees Gantt and Planning stay on the same source of truth.
  const siblingInfo = useMemo(() => {
    const sortedPhases = [...phases].sort((a, b) => a.sort_order - b.sort_order);
    const phaseIndex: Record<string, number> = {};
    sortedPhases.forEach((p, i) => { phaseIndex[p.id] = i; });

    const tasksByPhase: Record<string, typeof tasks> = {};
    for (const t of tasks) {
      (tasksByPhase[t.phase_id] ||= []).push(t);
    }
    for (const pid of Object.keys(tasksByPhase)) {
      tasksByPhase[pid].sort((a, b) => a.sort_order - b.sort_order);
    }
    return { sortedPhases, phaseIndex, tasksByPhase };
  }, [phases, tasks]);

  const handleReorder = useCallback(async (
    rowId: string,
    rowType: "phase" | "task",
    direction: "up" | "down",
  ) => {
    try {
      if (rowType === "phase") {
        const { sortedPhases } = siblingInfo;
        const idx = sortedPhases.findIndex((p) => p.id === rowId);
        if (idx < 0) return;
        const swapIdx = direction === "up" ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= sortedPhases.length) return;
        await reorderPhases.mutateAsync([
          { id: sortedPhases[idx].id, sort_order: sortedPhases[swapIdx].sort_order },
          { id: sortedPhases[swapIdx].id, sort_order: sortedPhases[idx].sort_order },
        ]);
      } else {
        // Sibling reorder within the SAME phase only — never reparents.
        const task = tasks.find((t) => t.id === rowId);
        if (!task) return;
        const siblings = siblingInfo.tasksByPhase[task.phase_id] || [];
        const idx = siblings.findIndex((t) => t.id === rowId);
        if (idx < 0) return;
        const swapIdx = direction === "up" ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= siblings.length) return;
        await reorderTasks.mutateAsync([
          { id: siblings[idx].id, sort_order: siblings[swapIdx].sort_order },
          { id: siblings[swapIdx].id, sort_order: siblings[idx].sort_order },
        ]);
      }
    } catch (e: any) {
      toast.error(e?.message || "Reorder failed");
    }
  }, [siblingInfo, tasks, reorderPhases, reorderTasks]);

  // Per-row first/last sibling flags so we can hide arrows at the boundaries.
  const rowSiblingFlags = useMemo(() => {
    const flags: Record<string, { isFirst: boolean; isLast: boolean }> = {};
    for (const r of rows) {
      if (r.type === "phase") {
        const idx = siblingInfo.phaseIndex[r.id] ?? -1;
        flags[r.id] = {
          isFirst: idx <= 0,
          isLast: idx < 0 || idx >= siblingInfo.sortedPhases.length - 1,
        };
      } else {
        const phaseId = r.phaseId!;
        const siblings = siblingInfo.tasksByPhase[phaseId] || [];
        const idx = siblings.findIndex((t) => t.id === r.id);
        flags[r.id] = {
          isFirst: idx <= 0,
          isLast: idx < 0 || idx >= siblings.length - 1,
        };
      }
    }
    return flags;
  }, [rows, siblingInfo]);

  // Build the visible-item list for zoom/fit. Include the project window so the
  // timeline always covers the project's planned range too.
  const visibleItems = useMemo(() => {
    const items = rows.map(r => ({ start: r.start, end: r.end }));
    items.push({ start: project.start_date, end: project.target_end_date });
    return items;
  }, [rows, project.start_date, project.target_end_date]);

  const {
    zoom, dayWidth, timelineStart, timelineWidth, totalDays, axis,
    canZoomIn, canZoomOut, zoomIn, zoomOut, fitToScreen,
  } = useTimelineZoom({
    visibleItems,
    fallbackStart: project.start_date,
    fallbackEnd: project.target_end_date,
    initialZoom: "month",
    viewportWidth,
    controlledZoom: viewState.zoom,
    onZoomChange: (next) => setViewField("zoom", next),
  });

  const depLines = useGanttDependencyLines(rows, dependencies, timelineStart, dayWidth);

  const {
    dragState, dragPreview, handleDragStart, handleDragMove, handleDragEnd, getBarOffset, isPending,
    pendingPhaseConfirm, confirmPendingPhase, cancelPendingPhase,
    pendingTaskConfirm, confirmPendingTask, cancelPendingTask,
  } = useGanttEdit(rows, dependencies, timelineStart, project.id, project.organization_id, dayWidth);

  const todayOffset = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return daysBetween(timelineStart, today) * dayWidth;
  }, [timelineStart, dayWidth]);

  const chartHeight = rows.length * ROW_HEIGHT;

  // Track viewport width for fit-to-screen calculation
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    // Single shared scroll container (label + timeline). Exclude the label
    // column so Fit still reasons about the visible timeline width only.
    const viewport = root;
    viewportElRef.current = viewport;
    const update = () => setViewportWidth(Math.max(0, viewport.clientWidth - LABEL_WIDTH));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(viewport);
    return () => ro.disconnect();
  }, []);


  /* ── auto-scroll to Today on first render ── */
  useEffect(() => {
    if (didAutoScroll.current) return;
    if (todayOffset < 0 || todayOffset > timelineWidth) return;
    const el = viewportElRef.current || scrollRef.current;
    if (!el) return;
    const scrollTarget = Math.max(0, todayOffset - el.clientWidth / 3);
    requestAnimationFrame(() => { el.scrollLeft = scrollTarget; });
    didAutoScroll.current = true;
  }, [todayOffset, timelineWidth]);

  /* ── global mouse handlers for drag ── */
  useEffect(() => {
    if (!dragState) return;
    const onMove = (e: MouseEvent) => handleDragMove(e);
    const onUp = () => handleDragEnd();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragState, handleDragMove, handleDragEnd]);

  const toggleCollapse = useCallback((phaseId: string) => {
    const current = viewState.collapsedPhaseIds;
    const isCollapsed = current.includes(phaseId);
    const next = isCollapsed ? current.filter((id) => id !== phaseId) : [...current, phaseId];
    setViewField("collapsedPhaseIds", next);
  }, [viewState.collapsedPhaseIds, setViewField]);

  /* ── navigation helpers ── */
  const openDetail = useCallback((row: { type: string; id: string }) => {
    if (!workspaceId || !projectId) return;
    const base = `/workspace/${workspaceId}/project/${projectId}`;
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    const encodedReturnTo = encodeURIComponent(returnTo);
    const state = { from: "gantt", returnTo };
    if (row.type === "phase") navigate(`${base}/phase/${row.id}?from=gantt&returnTo=${encodedReturnTo}`, { state });
    else navigate(`${base}/task/${row.id}?from=gantt&returnTo=${encodedReturnTo}`, { state });
  }, [navigate, workspaceId, projectId, location.pathname, location.search, location.hash]);

  const handlePickFindResult = useCallback((r: FindResult) => {
    const sel = `[data-find-row-id="${r.id}"]`;
    requestAnimationFrame(() => {
      const el = document.querySelector(sel) as HTMLElement | null;
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, []);

  return (
    <div data-gantt-root className="flex h-full min-h-0 flex-col gap-3">

      {/* Mode hint */}
      {canEdit && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-md bg-muted border border-border">
          <Pencil className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {editingLocked
              ? "Clear find or turn off Show matches only to edit the timeline."
              : "Drag bar edges to resize, drag the bar to move dates. Use the arrows in the Name column to reorder siblings (changes order, not dates). Click a name to open details."}
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="shrink-0 flex flex-wrap items-center gap-4">
        <FindInProjectToolbar
          query={findQuery}
          onQueryChange={setFindQuery}
          matchesOnly={matchesOnly}
          onMatchesOnlyChange={setMatchesOnly}
          state={findState}
          onPick={handlePickFindResult}
        />
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="planned">Planned</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="on_hold">On Hold</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="hide-completed" checked={hideCompleted} onCheckedChange={setHideCompleted} />
          <Label htmlFor="hide-completed" className="text-xs text-muted-foreground">Hide completed</Label>
        </div>

        {isBaselined && (
          <div className="flex items-center gap-2">
            <Switch id="show-baseline" checked={showBaseline} onCheckedChange={setShowBaseline} />
            <Label htmlFor="show-baseline" className="text-xs text-muted-foreground">Show baseline</Label>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <SavedViewsControl<GanttSavedView>
            views={savedViews.views}
            currentState={currentSavedSnapshot}
            onSave={(name, state) => savedViews.saveView(name, state)}
            onApply={applySavedView}
            onRename={savedViews.renameView}
            onDelete={savedViews.deleteView}
          />
          <BaselineLegend isBaselined={isBaselined} />
          <TimelineZoomControls
            zoom={zoom}
            canZoomIn={canZoomIn}
            canZoomOut={canZoomOut}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onFit={fitToScreen}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">No items match the current filters.</div>
      ) : (
        <div
          data-gantt-frame
          className={cn(
            "flex-1 min-h-0 flex flex-col border border-border rounded-lg overflow-hidden",
            dragState && "select-none",
          )}
        >
          <div data-gantt-scroll ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
            <div className="flex" style={{ width: LABEL_WIDTH + timelineWidth, minWidth: "100%" }}>
            {/* Label column */}
            <div
              data-gantt-label-column
              className="flex-shrink-0 sticky left-0 z-20 border-r border-border bg-card"
              style={{ width: LABEL_WIDTH }}
            >
              <div className="sticky top-0 z-10 bg-card h-[52px] flex items-end px-3 pb-2 border-b border-border">
                <span className="text-xs font-medium text-muted-foreground">Name</span>
              </div>

              {rows.map((row) => {
                const flags = rowSiblingFlags[row.id] || { isFirst: true, isLast: true };
                const reorderBusy = reorderPhases.isPending || reorderTasks.isPending;
                return (
                <div
                  key={row.id}
                  data-find-row-id={row.id}
                  className={cn(
                    "group/row flex items-center gap-1 px-2 border-b border-border/50 text-sm truncate cursor-pointer hover:bg-accent/50 transition-colors",
                    row.type === "phase" ? "font-semibold text-foreground" : "pl-7 text-muted-foreground",
                    row.isFindMatch && "bg-accent/60 ring-1 ring-inset ring-ring/30"
                  )}
                  style={{ height: ROW_HEIGHT }}
                  onClick={() => openDetail(row)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(row); } }}
                >
                  {row.type === "phase" && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleCollapse(row.id); }}
                      className="p-0.5 hover:bg-accent rounded"
                      disabled={editingLocked}
                    >
                      {collapsed[row.id] && !editingLocked ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  )}
                  <span className="truncate" title={row.name}>{row.name}</span>
                  {row.assignee && <span className="text-xs text-muted-foreground ml-auto flex-shrink-0 max-w-[80px] truncate">{row.assignee}</span>}

                  {/* Sequence reorder controls — change sibling order ONLY (not dates).
                      Writes to the same canonical sort_order used by Planning. */}
                  {effectiveCanEdit && (
                    <div className={cn("flex gap-0.5 flex-shrink-0", row.assignee ? "" : "ml-auto", "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity")}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        disabled={flags.isFirst || reorderBusy}
                        onClick={(e) => { e.stopPropagation(); handleReorder(row.id, row.type, "up"); }}
                        title={`Move ${row.type} up (changes order, not dates)`}
                        aria-label={`Move ${row.type} up`}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        disabled={flags.isLast || reorderBusy}
                        onClick={(e) => { e.stopPropagation(); handleReorder(row.id, row.type, "down"); }}
                        title={`Move ${row.type} down (changes order, not dates)`}
                        aria-label={`Move ${row.type} down`}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (row.type === "phase") setClonePhase({ id: row.id, name: row.name });
                          else setCloneTask({ id: row.id, name: row.name });
                        }}
                        title={`Copy ${row.type}`}
                        aria-label={`Copy ${row.type}`}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
                );
              })}
            </div>

            {/* Timeline — shares the single vertical scroll context above */}
            <div
              data-gantt-timeline-column
              className="flex-shrink-0"
              style={{ width: timelineWidth, minWidth: `calc(100% - ${LABEL_WIDTH}px)` }}
            >
                {/* Adaptive timeline axis (major + minor + Today pill) */}
                <div data-gantt-timeline-header className="sticky top-0 z-10">
                  <TimelineAxis
                    axis={axis}
                    width={timelineWidth}
                    height={HEADER_HEIGHT}
                    todayOffset={todayOffset}
                  />
                </div>


                {/* Chart area */}
                <div className="relative" style={{ height: chartHeight }}>
                  {/* Background SVG: grid, today column highlight, today line, dependencies */}
                  <svg className="absolute inset-0 pointer-events-none" width={timelineWidth} height={chartHeight}>
                    {/* Alternating row stripes */}
                    {rows.map((_, i) => (
                      i % 2 === 0 ? <rect key={i} x={0} y={i * ROW_HEIGHT} width={timelineWidth} height={ROW_HEIGHT} className="fill-muted/30" /> : null
                    ))}
                    {/* Today column highlight */}
                    {todayOffset >= 0 && todayOffset <= timelineWidth && (
                      <rect
                        x={todayOffset - dayWidth / 2}
                        y={0}
                        width={dayWidth}
                        height={chartHeight}
                        className="fill-destructive/[0.06]"
                      />
                    )}
                    {/* Today line */}
                    {todayOffset >= 0 && todayOffset <= timelineWidth && (
                      <line
                        x1={todayOffset} y1={0} x2={todayOffset} y2={chartHeight}
                        stroke="hsl(var(--destructive))"
                        strokeWidth={2}
                        strokeDasharray="6 3"
                      />
                    )}
                    {/* Dependency arrows */}
                    <defs>
                      <marker id="gantt-arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                        <path d="M0,0 L6,2 L0,4 Z" fill="hsl(var(--muted-foreground))" fillOpacity={0.6} />
                      </marker>
                    </defs>
                    {depLines.map(line => {
                      const midX = (line.x1 + line.x2) / 2;
                      return (
                        <path
                          key={line.key}
                          d={`M${line.x1},${line.y1} C${midX},${line.y1} ${midX},${line.y2} ${line.x2},${line.y2}`}
                          fill="none"
                          stroke="hsl(var(--muted-foreground))"
                          strokeWidth={1}
                          strokeOpacity={0.5}
                          markerEnd="url(#gantt-arrow)"
                        />
                      );
                    })}
                  </svg>

                  {/* Baseline ghost bars (read-only, dashed outline). Rendered beneath current bars. */}
                  {isBaselined && showBaseline && rows.map((row, i) => {
                    const bs = parseDate(row.baselineStart || null);
                    const be = parseDate(row.baselineEnd || null);
                    if (!bs || !be) return null;
                    const isPhase = row.type === "phase";
                    const barH = isPhase ? BAR_HEIGHT_PHASE : BAR_HEIGHT_TASK;
                    const ghostH = Math.max(6, barH - 4);
                    const x = daysBetween(timelineStart, bs) * dayWidth;
                    const wPx = Math.max(dayWidth, (daysBetween(bs, be) + 1) * dayWidth);
                    const y = i * ROW_HEIGHT + (ROW_HEIGHT - ghostH) / 2;
                    return (
                      <div
                        key={`baseline-${row.id}`}
                        className="absolute pointer-events-none rounded-sm border border-dashed border-muted-foreground/60 bg-muted-foreground/5"
                        style={{ left: x, top: y, width: wPx, height: ghostH }}
                        title={`Baseline: ${row.baselineStart} → ${row.baselineEnd}`}
                      />
                    );
                  })}

                  {/* Bars — now rendered as layered SVG rects for crisper rendering */}
                  {rows.map((row, i) => {
                    const start = parseDate(row.start);
                    const end = parseDate(row.end);
                    if (!start && !end) return null;
                    const barStart = start || end!;
                    const barEnd = end || start!;
                    const x = daysBetween(timelineStart, barStart) * dayWidth;
                    const w = Math.max(dayWidth, (daysBetween(barStart, barEnd) + 1) * dayWidth);

                    const isPhase = row.type === "phase";
                    const barH = isPhase ? BAR_HEIGHT_PHASE : BAR_HEIGHT_TASK;
                    const y = i * ROW_HEIGHT + (ROW_HEIGHT - barH) / 2;

                    const { dx, dw } = getBarOffset(row.id);
                    const finalX = x + dx;
                    const finalW = Math.max(dayWidth, w + dw);
                    const isDragging = dragState?.rowId === row.id;

                    // Compute inline label if bar is wide enough
                    const labelFits = finalW > 70;
                    const barLabel = row.name;

                    // Variance vs baseline (in days, end-date based)
                    const baseEnd = parseDate(row.baselineEnd || null);
                    const variance = (isBaselined && showBaseline && baseEnd && end)
                      ? daysBetween(baseEnd, end) : null;
                    const varianceLabel = variance === null ? null
                      : variance === 0 ? "0d"
                      : `${variance > 0 ? "+" : ""}${variance}d`;

                    return (
                      <div
                        key={row.id}
                        className="absolute group"
                        style={{ left: finalX, top: y, width: finalW, height: barH }}
                      >
                        {/* Main bar */}
                        <div
                          className={cn(
                            "absolute inset-0 rounded-md border transition-all duration-100",
                            isPhase
                              ? "border-foreground/20 shadow-sm"
                              : "border-foreground/10 opacity-85",
                            isDragging && "ring-2 ring-primary z-20 shadow-md cursor-grabbing",
                            !isDragging && effectiveCanEdit && "cursor-grab",
                          )}
                          style={{ backgroundColor: getPmWorkflowStatusHex(row.status) }}
                          aria-label={`${isPhase ? "Phase" : "Task"}: ${row.name} (${getPmWorkflowStatusLabel(row.status)})`}
                          title={[
                            row.name,
                            `Current: ${row.start || "?"} → ${row.end || "?"}`,
                            isBaselined && (row.baselineStart || row.baselineEnd)
                              ? `Baseline: ${row.baselineStart || "?"} → ${row.baselineEnd || "?"}`
                              : null,
                            variance !== null ? `Variance: ${varianceLabel}` : null,
                            row.addedAfterBaseline ? "Added after baseline" : null,
                            `Status: ${getPmWorkflowStatusLabel(row.status)}`,
                            row.assignee ? `Assignee: ${row.assignee}` : null,
                          ].filter(Boolean).join("\n")}
                        >

                          {/* Inline label */}
                          {labelFits && (
                            <span className={cn(
                              "absolute inset-0 flex items-center px-2 text-[11px] font-medium truncate pointer-events-none",
                              isPhase ? "text-white drop-shadow-sm" : "text-white/90 dark:text-white/80"
                            )}>
                              {barLabel}
                            </span>
                          )}

                          {/* Phase summary corners (visual distinction) */}
                          {isPhase && (
                            <>
                              <div className="absolute left-0 top-0 w-1 h-full rounded-l-md bg-foreground/20" />
                              <div className="absolute right-0 top-0 w-1 h-full rounded-r-md bg-foreground/20" />
                            </>
                          )}
                        </div>

                        {/* Variance badge — pattern + sign convey direction (not color alone) */}
                        {varianceLabel && variance !== 0 && (
                          <span
                            className={cn(
                              "absolute -top-2 right-0 translate-x-1/3 px-1 rounded-sm border text-[10px] font-mono leading-tight pointer-events-none bg-background",
                              variance && variance > 0
                                ? "border-destructive/60 text-destructive"
                                : "border-primary/60 text-primary"
                            )}
                            title={`Current end vs baseline end: ${varianceLabel}`}
                          >
                            {varianceLabel}
                          </span>
                        )}
                        {row.addedAfterBaseline && isBaselined && (
                          <span
                            className="absolute -top-2 left-0 -translate-x-1/3 px-1 rounded-sm border border-muted-foreground/60 text-[9px] uppercase tracking-wide text-muted-foreground bg-background pointer-events-none"
                            title="Added after baseline approval"
                          >
                            new
                          </span>
                        )}

                        {/* Drag handles for resizing and moving */}
                        {effectiveCanEdit && start && end && (
                          <>
                            <div
                              className="absolute left-0 top-0 h-full cursor-ew-resize z-30 flex items-center justify-center hover:bg-foreground/20 rounded-l-md transition-colors"
                              style={{ width: HANDLE_WIDTH }}
                              onMouseDown={(e) => { e.stopPropagation(); handleDragStart(e, row, "resize-start"); }}
                              title="Drag to change start date"
                            >
                              <div className="w-0.5 h-3 rounded-full bg-foreground/40 group-hover:bg-foreground/60" />
                            </div>
                            <div
                              className="absolute right-0 top-0 h-full cursor-ew-resize z-30 flex items-center justify-center hover:bg-foreground/20 rounded-r-md transition-colors"
                              style={{ width: HANDLE_WIDTH }}
                              onMouseDown={(e) => { e.stopPropagation(); handleDragStart(e, row, "resize-end"); }}
                              title="Drag to change end date"
                            >
                              <div className="w-0.5 h-3 rounded-full bg-foreground/40 group-hover:bg-foreground/60" />
                            </div>
                            {/* Full-bar move handle */}
                            <div
                              className="absolute cursor-grab z-20 opacity-0"
                              style={{ left: HANDLE_WIDTH, top: 0, width: `calc(100% - ${HANDLE_WIDTH * 2}px)`, height: "100%" }}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                handleDragStart(e, row, "move");
                              }}
                            />
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* Live drag/resize date guides — visual-only, does not affect scheduling. */}
                  {dragPreview && (() => {
                    const rowIdx = rows.findIndex((r) => r.id === dragPreview.rowId);
                    if (rowIdx < 0) return null;
                    const startX = daysBetween(timelineStart, dragPreview.newStart) * dayWidth;
                    const endX = (daysBetween(timelineStart, dragPreview.newEnd) + 1) * dayWidth;
                    const fmt = (d: Date) =>
                      d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                    const helperLeft = Math.max(0, Math.min(timelineWidth - 180, (startX + endX) / 2 - 90));
                    const helperTop = rowIdx * ROW_HEIGHT - 30;
                    const sameDay = startX === endX - dayWidth;
                    return (
                      <>
                        {/* Vertical guide lines */}
                        <div
                          className="absolute pointer-events-none border-l border-dashed border-primary/70 z-30"
                          style={{ left: startX, top: 0, height: chartHeight }}
                        />
                        {!sameDay && (
                          <div
                            className="absolute pointer-events-none border-l border-dashed border-primary/70 z-30"
                            style={{ left: endX, top: 0, height: chartHeight }}
                          />
                        )}
                        {/* Date chips at the top of each guide */}
                        <div
                          className="absolute -translate-x-1/2 -top-6 px-1.5 py-0.5 rounded-sm bg-primary text-primary-foreground text-[10px] font-medium shadow z-40 pointer-events-none whitespace-nowrap"
                          style={{ left: startX }}
                        >
                          {fmt(dragPreview.newStart)}
                        </div>
                        {!sameDay && (
                          <div
                            className="absolute -translate-x-1/2 -top-6 px-1.5 py-0.5 rounded-sm bg-primary text-primary-foreground text-[10px] font-medium shadow z-40 pointer-events-none whitespace-nowrap"
                            style={{ left: endX }}
                          >
                            {fmt(dragPreview.newEnd)}
                          </div>
                        )}
                        {/* Compact duration helper near the bar */}
                        <div
                          className="absolute z-40 pointer-events-none px-2 py-1 rounded-md bg-popover text-popover-foreground border border-border shadow-md text-[11px] font-medium whitespace-nowrap"
                          style={{ left: helperLeft, top: Math.max(0, helperTop), width: 180 }}
                        >
                          <span className="text-muted-foreground">Start </span>
                          {fmt(dragPreview.newStart)}
                          <span className="mx-1 text-muted-foreground">·</span>
                          <span className="text-muted-foreground">End </span>
                          {fmt(dragPreview.newEnd)}
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            Duration: {dragPreview.durationDays} day{dragPreview.durationDays === 1 ? "" : "s"}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>

      )}

      {clonePhase && (
        <ClonePhaseDialog
          open={!!clonePhase}
          onClose={() => setClonePhase(null)}
          phaseId={clonePhase.id}
          sourcePhaseName={clonePhase.name}
          projectId={project.id}
        />
      )}
      {cloneTask && (
        <CloneTaskDialog
          open={!!cloneTask}
          onClose={() => setCloneTask(null)}
          taskId={cloneTask.id}
          sourceTaskName={cloneTask.name}
          projectId={project.id}
        />
      )}
      {pendingPhaseConfirm && pendingPhaseConfirm.preview.resolved_action && (
        <GanttActionConfirmDialog
          open={!!pendingPhaseConfirm}
          resolvedAction={pendingPhaseConfirm.preview.resolved_action}
          phaseName={pendingPhaseConfirm.preview.phase_name ?? "Phase"}
          phaseCurrentStart={pendingPhaseConfirm.preview.phase_current_start}
          phaseCurrentEnd={pendingPhaseConfirm.preview.phase_current_end}
          phaseProposedStart={pendingPhaseConfirm.preview.phase_proposed_start}
          phaseProposedEnd={pendingPhaseConfirm.preview.phase_proposed_end}
          movedChildrenCount={pendingPhaseConfirm.preview.moved_children_count ?? 0}
          anchoredChildrenCount={pendingPhaseConfirm.preview.anchored_children_count ?? 0}
          requiresProjectExtension={!!pendingPhaseConfirm.preview.requires_project_extension}
          projectName={pendingPhaseConfirm.preview.parent_project_name}
          projectCurrentStart={pendingPhaseConfirm.preview.parent_current_start}
          projectCurrentEnd={pendingPhaseConfirm.preview.parent_current_end}
          projectProposedStart={pendingPhaseConfirm.preview.parent_proposed_start}
          projectProposedEnd={pendingPhaseConfirm.preview.parent_proposed_end}
          pending={isPending}
          onConfirm={confirmPendingPhase}
          onCancel={cancelPendingPhase}
        />
      )}
      {pendingTaskConfirm && (
        <ParentExtensionConfirmDialog
          open={!!pendingTaskConfirm}
          parentKind="phase"
          parentName={pendingTaskConfirm.parentPhaseName}
          currentStart={pendingTaskConfirm.parentCurrentStart}
          currentEnd={pendingTaskConfirm.parentCurrentEnd}
          proposedStart={pendingTaskConfirm.parentProposedStart}
          proposedEnd={pendingTaskConfirm.parentProposedEnd}
          pending={isPending}
          onConfirm={confirmPendingTask}
          onCancel={cancelPendingTask}
        />
      )}
    </div>
  );
}
