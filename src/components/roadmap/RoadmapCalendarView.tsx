import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RoadmapProject, RoadmapDep } from "@/hooks/useRoadmapData";
import { useRoadmapDashboardData } from "@/hooks/useRoadmapDashboardData";
import { useRoadmapCalendarMarkers, type RoadmapMarkerEvent } from "@/hooks/useRoadmapCalendarMarkers";
import { RoadmapCalendarToolbar, type RmViewMode } from "./RoadmapCalendarToolbar";
import {
  DEFAULT_RM_CAL_FILTERS,
  countActiveRmCalFilters,
  type RoadmapCalendarFilters,
} from "./RoadmapCalendarFiltersPopover";
import { RoadmapMonthCalendar } from "./RoadmapMonthCalendar";
import { RoadmapYearCalendar } from "./RoadmapYearCalendar";
import { RoadmapCalendarEventDrawer } from "./RoadmapCalendarEventDrawer";
import {
  addMonths,
  deriveLandingEvents,
  endOfMonth,
  monthLongLabel,
  parseYmd,
  startOfMonth,
  toProjectWindows,
  type LandingEvent,
  type ProjectWindow,
} from "./roadmapCalendarUtils";
import { ArrowDownToLine, ArrowUpFromLine, Flag } from "lucide-react";

interface Props {
  /** Projects already filtered by Roadmap-level page filters. */
  filtered: RoadmapProject[];
  /** Cross-portfolio project↔project dependencies (already loaded by Roadmap page). */
  deps?: RoadmapDep[];
  /** Kept for compatibility — no longer used. */
  workspaces?: { id: string; name: string }[];
  programs?: { id: string; name: string }[];
}

export function RoadmapCalendarView({ filtered, deps = [] }: Props) {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<RmViewMode>("year");
  const [filters, setFilters] = useState<RoadmapCalendarFilters>(DEFAULT_RM_CAL_FILTERS);
  const [anchor, setAnchor] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  });

  // ── v2.3 drawer state ──
  const [drawerEvent, setDrawerEvent] = useState<LandingEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── Project windows ──
  const calendarItems = useMemo<ProjectWindow[]>(() => {
    const all = toProjectWindows(filtered);
    return all.filter((w) => {
      if (filters.hideUndated && !w.start && !w.end) return false;
      return true;
    });
  }, [filtered, filters.hideUndated]);

  const filteredProjectIds = useMemo(() => calendarItems.map((w) => w.id), [calendarItems]);
  const { data: markers = [] } = useRoadmapCalendarMarkers(filteredProjectIds);

  // ── Derived completion (canonical, reused from Dashboard substrate) ──
  const { data: dashboardData, isLoading: dashboardLoading } = useRoadmapDashboardData(filtered);

  const events = useMemo<LandingEvent[]>(
    () =>
      deriveLandingEvents(calendarItems, markers as RoadmapMarkerEvent[], {
        showStarts: filters.showStarts,
        showEnds: filters.showEnds,
        showMarkers: filters.showMarkers,
        markerTypes: filters.markerTypes,
      }),
    [calendarItems, markers, filters.showStarts, filters.showEnds, filters.showMarkers, filters.markerTypes],
  );

  const undatedCount = useMemo(
    () => calendarItems.filter((w) => !w.start && !w.end).length,
    [calendarItems],
  );

  useEffect(() => {
    if (viewMode !== "month") return;
    const monthStart = startOfMonth(anchor);
    const monthEnd = endOfMonth(anchor);
    const inThisMonth = (d: Date) => d >= monthStart && d <= monthEnd;
    if (inThisMonth(selectedDay) && selectedDay.getMonth() === anchor.getMonth()) return;

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    if (inThisMonth(today)) {
      setSelectedDay(today);
      return;
    }

    const firstEventDate = events
      .map((e) => parseYmd(e.date))
      .filter((d): d is Date => !!d && inThisMonth(d))
      .sort((a, b) => a.getTime() - b.getTime())[0];

    setSelectedDay(firstEventDate ?? monthStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, anchor]);

  // ── Reconcile stale drawer selection when filters/view drop the event ──
  useEffect(() => {
    if (!drawerEvent) return;
    const stillVisible = events.some((e) => {
      if (e.kind !== drawerEvent.kind) return false;
      if (e.date !== drawerEvent.date) return false;
      if (e.kind === "marker") return e.marker?.object_id === drawerEvent.marker?.object_id;
      return e.project?.id === drawerEvent.project?.id;
    });
    if (!stillVisible) {
      setDrawerOpen(false);
      setDrawerEvent(null);
    }
  }, [events, drawerEvent]);

  const activeFilterCount = countActiveRmCalFilters(filters, DEFAULT_RM_CAL_FILTERS);

  const periodLabel =
    viewMode === "month"
      ? monthLongLabel(anchor)
      : `${monthLongLabel(anchor)} → ${monthLongLabel(addMonths(anchor, 11))}`;

  const handlePrev = () => setAnchor((a) => addMonths(a, viewMode === "month" ? -1 : -12));
  const handleNext = () => setAnchor((a) => addMonths(a, viewMode === "month" ? 1 : 12));
  const handleToday = () => setAnchor(startOfMonth(new Date()));

  const handleMonthClick = (m: Date) => {
    setAnchor(startOfMonth(m));
    setViewMode("month");
  };

  const buildReturn = () => {
    const returnTo = `/roadmap?tab=calendar`;
    const qs = `?from=roadmap&returnTo=${encodeURIComponent(returnTo)}`;
    return { returnTo, qs };
  };

  // ── v2.3: primary click now opens drawer ──
  const handleEventSelect = useCallback((e: LandingEvent) => {
    setDrawerEvent(e);
    setDrawerOpen(true);
  }, []);

  // ── Secondary explicit navigation (bypasses drawer) ──
  const handleProjectClick = useCallback(
    (p: ProjectWindow | RoadmapProject) => {
      const { returnTo, qs } = buildReturn();
      const wsId = "workspace_id" in p ? p.workspace_id : (p as RoadmapProject).workspace_id;
      navigate(`/workspace/${wsId}/project/${p.id}${qs}`, {
        state: { from: "roadmap", returnTo },
      });
    },
    [navigate],
  );

  const handleMarkerClick = useCallback(
    (m: RoadmapMarkerEvent) => {
      const { returnTo, qs } = buildReturn();
      const path =
        m.object_kind === "phase"
          ? `/workspace/${m.workspace_id}/project/${m.project_id}/phase/${m.object_id}`
          : `/workspace/${m.workspace_id}/project/${m.project_id}/task/${m.object_id}`;
      navigate(`${path}${qs}`, { state: { from: "roadmap", returnTo } });
    },
    [navigate],
  );

  const handleOpenMarkerObjectFromDrawer = useCallback(
    (e: LandingEvent) => {
      if (e.marker) handleMarkerClick(e.marker);
    },
    [handleMarkerClick],
  );

  return (
    <div className="space-y-3">
      <RoadmapCalendarToolbar
        viewMode={viewMode}
        periodLabel={periodLabel}
        filters={filters}
        activeFilterCount={activeFilterCount}
        onViewMode={setViewMode}
        onFiltersChange={setFilters}
        onClearFilters={() => setFilters(DEFAULT_RM_CAL_FILTERS)}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
      />

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Portfolio landing calendar — shows project <span className="font-medium text-foreground">starts</span>,{" "}
          <span className="font-medium text-foreground">target ends</span>, and{" "}
          <span className="font-medium text-foreground">key markers</span> (milestones, deliverables, decisions, reviews)
          across the filtered roadmap. Read-only; edits remain in project Planning and Gantt.
        </p>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-primary/15 text-primary">
              <ArrowUpFromLine className="h-2.5 w-2.5" />
            </span>
            Project start
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]">
              <ArrowDownToLine className="h-2.5 w-2.5" />
            </span>
            Target end
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]">
              <Flag className="h-2.5 w-2.5" />
            </span>
            Key marker
          </span>
        </div>
      </div>

      {viewMode === "month" ? (
        <RoadmapMonthCalendar
          anchor={anchor}
          events={events}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          undatedCount={undatedCount}
          onEventSelect={handleEventSelect}
          onProjectOpen={handleProjectClick}
          onMarkerOpen={handleMarkerClick}
        />
      ) : (
        <RoadmapYearCalendar
          anchor={anchor}
          events={events}
          onMonthClick={handleMonthClick}
          onEventSelect={handleEventSelect}
        />
      )}

      <RoadmapCalendarEventDrawer
        open={drawerOpen}
        onOpenChange={(o) => {
          setDrawerOpen(o);
          if (!o) setDrawerEvent(null);
        }}
        event={drawerEvent}
        projects={filtered}
        dashboardData={dashboardData}
        dashboardLoading={dashboardLoading}
        deps={deps}
        onOpenProject={handleProjectClick}
        onOpenMarkerObject={handleOpenMarkerObjectFromDrawer}
      />
    </div>
  );
}
