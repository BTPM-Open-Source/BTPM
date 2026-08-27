import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, daysBetween, parseDate } from "./ganttUtils";

/* ─────────────────────────────────────────────────────────────
   Shared timeline zoom model used by Project Gantt and
   Roadmap — Timeline. View-state only — never writes to data.
   ───────────────────────────────────────────────────────────── */

export type ZoomLevel = "day" | "week" | "month" | "quarter" | "year";

export const ZOOM_LEVELS: ZoomLevel[] = ["day", "week", "month", "quarter", "year"];

export const ZOOM_LABELS: Record<ZoomLevel, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

/** pixels per calendar day at each zoom level. Higher = finer detail. */
export const ZOOM_DAY_WIDTH: Record<ZoomLevel, number> = {
  day: 36,
  week: 14,
  month: 5,
  quarter: 2,
  year: 0.8,
};

/** Padding (in days) added before earliest / after latest date when computing range. */
const RANGE_PAD_DAYS = 7;

export interface AxisTick {
  x: number;
  width: number;
  label: string;
  /** "major" rows are large bands (month / quarter / year); "minor" rows are sub-ticks. */
  level: "major" | "minor";
}

export interface AxisLayout {
  major: AxisTick[];
  minor: AxisTick[];
}

export interface DateInput {
  start: string | null;
  end: string | null;
}

/**
 * The shared zoom hook. Returns current zoom level, the resolved dayWidth,
 * controls (in/out/fit/set), the computed timeline window, and adaptive axis ticks.
 */
export function useTimelineZoom(opts: {
  /** All currently visible items (after filters + collapse/expansion). */
  visibleItems: DateInput[];
  /** Optional fallback range when no items have dates. */
  fallbackStart?: string | null;
  /** Optional fallback range when no items have dates. */
  fallbackEnd?: string | null;
  /** Initial zoom level. */
  initialZoom?: ZoomLevel;
  /** Approx visible viewport width in px — used by Fit-to-screen to pick the best zoom. */
  viewportWidth?: number;
  /**
   * Optional controlled zoom value. When provided the hook becomes controlled
   * and the parent owns persistence. Pair with `onZoomChange`.
   */
  controlledZoom?: ZoomLevel;
  /** Notified whenever zoom changes (controlled or uncontrolled). */
  onZoomChange?: (next: ZoomLevel) => void;
}) {
  const { visibleItems, fallbackStart, fallbackEnd, initialZoom = "month", viewportWidth, controlledZoom, onZoomChange } = opts;

  const [internalZoom, setInternalZoom] = useState<ZoomLevel>(controlledZoom ?? initialZoom);
  const isControlled = controlledZoom !== undefined;
  const zoom = isControlled ? controlledZoom! : internalZoom;

  // Keep internal in sync if controlled value changes (prevents stale fit-to-screen base).
  useEffect(() => {
    if (isControlled && controlledZoom && controlledZoom !== internalZoom) {
      setInternalZoom(controlledZoom);
    }
  }, [isControlled, controlledZoom, internalZoom]);

  const setZoom = useCallback((next: ZoomLevel | ((prev: ZoomLevel) => ZoomLevel)) => {
    setInternalZoom((prev) => {
      const resolved = typeof next === "function" ? (next as (p: ZoomLevel) => ZoomLevel)(prev) : next;
      if (resolved !== prev) onZoomChange?.(resolved);
      return resolved;
    });
  }, [onZoomChange]);

  /* ── 1. Derive [min, max] from currently visible items ── */
  const range = useMemo(() => {
    const dates: Date[] = [];
    for (const it of visibleItems) {
      const s = parseDate(it.start);
      const e = parseDate(it.end);
      if (s) dates.push(s);
      if (e) dates.push(e);
    }
    if (dates.length === 0) {
      const s = parseDate(fallbackStart || null);
      const e = parseDate(fallbackEnd || null);
      if (s) dates.push(s);
      if (e) dates.push(e);
    }
    if (dates.length === 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      dates.push(today, addDays(today, 30));
    }
    const min = new Date(Math.min(...dates.map(d => d.getTime())));
    const max = new Date(Math.max(...dates.map(d => d.getTime())));
    min.setHours(0, 0, 0, 0);
    max.setHours(0, 0, 0, 0);
    return { min, max };
  }, [visibleItems, fallbackStart, fallbackEnd]);

  /* ── 2. Compute timeline window with padding ── */
  const { timelineStart, timelineEnd, totalDays } = useMemo(() => {
    const start = addDays(range.min, -RANGE_PAD_DAYS);
    const end = addDays(range.max, RANGE_PAD_DAYS * 2);
    return {
      timelineStart: start,
      timelineEnd: end,
      totalDays: Math.max(1, daysBetween(start, end)),
    };
  }, [range]);

  /* ── 3. dayWidth derived from zoom level ── */
  const dayWidth = ZOOM_DAY_WIDTH[zoom];
  const timelineWidth = totalDays * dayWidth;

  /* ── 4. Adaptive axis ticks ── */
  const axis: AxisLayout = useMemo(() => {
    return buildAxisTicks(timelineStart, totalDays, dayWidth, zoom);
  }, [timelineStart, totalDays, dayWidth, zoom]);

  /* ── 5. Controls ── */
  const zoomIndex = ZOOM_LEVELS.indexOf(zoom);
  const canZoomIn = zoomIndex > 0;
  const canZoomOut = zoomIndex < ZOOM_LEVELS.length - 1;

  const zoomIn = useCallback(() => {
    setZoom((prev) => {
      const i = ZOOM_LEVELS.indexOf(prev);
      return i > 0 ? ZOOM_LEVELS[i - 1] : prev;
    });
  }, [setZoom]);

  const zoomOut = useCallback(() => {
    setZoom((prev) => {
      const i = ZOOM_LEVELS.indexOf(prev);
      return i < ZOOM_LEVELS.length - 1 ? ZOOM_LEVELS[i + 1] : prev;
    });
  }, [setZoom]);

  /**
   * Fit-to-screen: pick the broadest zoom level whose total content width
   * still fits inside the viewport (no horizontal scroll). If even the broadest
   * level overflows, return that one (closest best fit).
   */
  const fitToScreen = useCallback(() => {
    if (!viewportWidth || viewportWidth <= 0) {
      setZoom("month");
      return;
    }
    let chosen: ZoomLevel = "year";
    for (const level of ZOOM_LEVELS) {
      const width = totalDays * ZOOM_DAY_WIDTH[level];
      if (width <= viewportWidth) {
        chosen = level;
        break;
      }
      chosen = level;
    }
    setZoom(chosen);
  }, [viewportWidth, totalDays, setZoom]);

  return {
    zoom,
    setZoom,
    dayWidth,
    timelineStart,
    timelineEnd,
    totalDays,
    timelineWidth,
    axis,
    canZoomIn,
    canZoomOut,
    zoomIn,
    zoomOut,
    fitToScreen,
  };
}

/* ─────────────────────────────────────────────────────────────
   Axis tick generation
   ───────────────────────────────────────────────────────────── */

function buildAxisTicks(
  start: Date,
  totalDays: number,
  dayWidth: number,
  zoom: ZoomLevel
): AxisLayout {
  const major: AxisTick[] = [];
  const minor: AxisTick[] = [];
  const end = addDays(start, totalDays);

  if (zoom === "day") {
    // Major = month bands; Minor = day numbers
    addMonthMajor(start, end, dayWidth, major);
    const cursor = new Date(start);
    while (cursor < end) {
      const next = addDays(cursor, 1);
      const x = daysBetween(start, cursor) * dayWidth;
      const w = dayWidth;
      const dow = cursor.getDay();
      const isWeekendStart = dow === 1; // mark week starts subtly
      minor.push({
        x,
        width: w,
        label: dayWidth >= 28 ? String(cursor.getDate()) : (isWeekendStart ? String(cursor.getDate()) : ""),
        level: "minor",
      });
      cursor.setTime(next.getTime());
    }
  } else if (zoom === "week") {
    // Major = month; Minor = week-starting Mondays
    addMonthMajor(start, end, dayWidth, major);
    const cursor = new Date(start);
    // align to Monday
    const dow = cursor.getDay();
    const offsetToMon = (1 - dow + 7) % 7;
    cursor.setDate(cursor.getDate() + offsetToMon);
    while (cursor < end) {
      const next = addDays(cursor, 7);
      const x = daysBetween(start, cursor) * dayWidth;
      const w = 7 * dayWidth;
      minor.push({
        x,
        width: w,
        label: w > 36 ? `${cursor.getMonth() + 1}/${cursor.getDate()}` : "",
        level: "minor",
      });
      cursor.setTime(next.getTime());
    }
  } else if (zoom === "month") {
    // Major = year; Minor = months
    addYearMajor(start, end, dayWidth, major);
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    if (cursor < start) cursor.setMonth(cursor.getMonth() + 1);
    while (cursor < end) {
      const next = new Date(cursor);
      next.setMonth(next.getMonth() + 1);
      const xRaw = daysBetween(start, cursor) * dayWidth;
      const w = daysBetween(cursor, next) * dayWidth;
      minor.push({
        x: xRaw,
        width: w,
        label: w > 28 ? cursor.toLocaleDateString("en-US", { month: "short" }) : "",
        level: "minor",
      });
      cursor.setTime(next.getTime());
    }
  } else if (zoom === "quarter") {
    // Major = year; Minor = quarters
    addYearMajor(start, end, dayWidth, major);
    const cursor = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1);
    if (cursor < start) cursor.setMonth(cursor.getMonth() + 3);
    while (cursor < end) {
      const next = new Date(cursor);
      next.setMonth(next.getMonth() + 3);
      const xRaw = daysBetween(start, cursor) * dayWidth;
      const w = daysBetween(cursor, next) * dayWidth;
      const q = Math.floor(cursor.getMonth() / 3) + 1;
      minor.push({
        x: xRaw,
        width: w,
        label: w > 30 ? `Q${q}` : "",
        level: "minor",
      });
      cursor.setTime(next.getTime());
    }
  } else {
    // year
    // Major = year only; minor = quarters tick marks
    addYearMajor(start, end, dayWidth, major);
    const cursor = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1);
    if (cursor < start) cursor.setMonth(cursor.getMonth() + 3);
    while (cursor < end) {
      const next = new Date(cursor);
      next.setMonth(next.getMonth() + 3);
      const xRaw = daysBetween(start, cursor) * dayWidth;
      const w = daysBetween(cursor, next) * dayWidth;
      const q = Math.floor(cursor.getMonth() / 3) + 1;
      minor.push({
        x: xRaw,
        width: w,
        label: w > 24 ? `Q${q}` : "",
        level: "minor",
      });
      cursor.setTime(next.getTime());
    }
  }

  return { major, minor };
}

function addMonthMajor(start: Date, end: Date, dayWidth: number, out: AxisTick[]) {
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  if (cursor < start) cursor.setMonth(cursor.getMonth() + 1);
  while (cursor < end) {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1);
    const x = daysBetween(start, cursor) * dayWidth;
    const w = daysBetween(cursor, next) * dayWidth;
    out.push({
      x,
      width: w,
      label: cursor.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      level: "major",
    });
    cursor.setTime(next.getTime());
  }
}

function addYearMajor(start: Date, end: Date, dayWidth: number, out: AxisTick[]) {
  const cursor = new Date(start.getFullYear(), 0, 1);
  if (cursor < start) cursor.setFullYear(cursor.getFullYear() + 1);
  while (cursor < end) {
    const next = new Date(cursor);
    next.setFullYear(next.getFullYear() + 1);
    const x = daysBetween(start, cursor) * dayWidth;
    const w = daysBetween(cursor, next) * dayWidth;
    out.push({
      x,
      width: w,
      label: String(cursor.getFullYear()),
      level: "major",
    });
    cursor.setTime(next.getTime());
  }
}
