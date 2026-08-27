import type { RoadmapProject } from "@/hooks/useRoadmapData";
import type {
  RoadmapMarkerEvent,
  MarkerSemanticType,
} from "@/hooks/useRoadmapCalendarMarkers";

export type { MarkerSemanticType } from "@/hooks/useRoadmapCalendarMarkers";

/** v2.2 marker-type set — non-standard typed phases/tasks only. */
export const MARKER_TYPES: MarkerSemanticType[] = [
  "milestone",
  "deliverable",
  "decision",
  "review",
];

export const MARKER_TYPE_LABELS: Record<MarkerSemanticType, string> = {
  milestone:   "Milestone",
  deliverable: "Deliverable",
  decision:    "Decision",
  review:      "Review",
};

/** A project window on the roadmap calendar (canonical-derived only). */
export interface ProjectWindow {
  id: string;
  name: string;
  status: string;
  priority: string;
  workspace_id: string;
  workspace_name: string;
  program_id: string | null;
  program_name: string | null;
  start: string | null;
  end: string | null;
  raw: RoadmapProject;
}

/** ── Status visual palette (kept for status dots only — bars are gone in v2.1) ── */
export interface StatusTone {
  dot: string;
  text: string;
  label: string;
}

import {
  getPmWorkflowStatusDotClass,
  getPmWorkflowStatusLabel,
} from "@/lib/btpmVisualSemantics";

/**
 * Status tone helper — derived entirely from the canonical PM workflow
 * status semantics. Kept for existing calendar components that call
 * `getStatusTone(status)`.
 */
export function getStatusTone(status: string): StatusTone {
  return {
    dot: getPmWorkflowStatusDotClass(status),
    text: status === "cancelled" ? "text-muted-foreground" : "text-foreground",
    label: getPmWorkflowStatusLabel(status),
  };
}

/** @deprecated — retained for legacy imports; derives from canonical helpers. */
export const STATUS_TONES: Record<string, StatusTone> = {
  planned: getStatusTone("planned"),
  active: getStatusTone("active"),
  completed: getStatusTone("completed"),
  on_hold: getStatusTone("on_hold"),
  cancelled: getStatusTone("cancelled"),
};

/** ── Date helpers (local-noon, ISO yyyy-mm-dd) ── */
export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseYmd(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function sameYmd(a: Date, b: Date): boolean {
  return ymd(a) === ymd(b);
}

export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0, 0);
}

export function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 12, 0, 0, 0);
}

export function monthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function monthLongLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function dayLongLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** Build Sun..Sat 6-week grid for a single month. */
export function buildMonthGrid(monthStart: Date): Date[] {
  const first = startOfMonth(monthStart);
  const last = endOfMonth(monthStart);
  const startWeekday = first.getDay();
  const cells: Date[] = [];
  for (let i = startWeekday; i > 0; i--) {
    cells.push(new Date(first.getFullYear(), first.getMonth(), 1 - i, 12, 0, 0, 0));
  }
  for (let d = 1; d <= last.getDate(); d++) {
    cells.push(new Date(first.getFullYear(), first.getMonth(), d, 12, 0, 0, 0));
  }
  while (cells.length % 7 !== 0) {
    const tail = cells[cells.length - 1];
    cells.push(new Date(tail.getFullYear(), tail.getMonth(), tail.getDate() + 1, 12, 0, 0, 0));
  }
  return cells;
}

export function rolling12MonthsStarting(anchor: Date): Date[] {
  const months: Date[] = [];
  for (let i = 0; i < 12; i++) months.push(startOfMonth(addMonths(anchor, i)));
  return months;
}

/** Convert RoadmapProject[] → ProjectWindow[]. Pure derivation. */
export function toProjectWindows(projects: RoadmapProject[]): ProjectWindow[] {
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    priority: p.priority,
    workspace_id: p.workspace_id,
    workspace_name: p.workspace_name,
    program_id: p.program_id,
    program_name: p.program_name,
    start: p.start_date,
    end: p.target_end_date,
    raw: p,
  }));
}

/** ── v2.2 Unified landing events: starts, target ends, and key markers ── */
export type LandingEventKind = "start" | "end" | "marker";

export interface LandingEvent {
  date: string;          // yyyy-mm-dd
  kind: LandingEventKind;
  /** Set for start/end events. */
  project?: ProjectWindow;
  /** Set for marker events. */
  marker?: RoadmapMarkerEvent;
}

export interface LandingEventOptions {
  showStarts: boolean;
  showEnds: boolean;
  showMarkers: boolean;
  markerTypes: MarkerSemanticType[];
}

/**
 * Derive day-level landing events from canonical project dates and typed
 * phase/task markers. v2.2 unified event model.
 */
export function deriveLandingEvents(
  windows: ProjectWindow[],
  markers: RoadmapMarkerEvent[],
  opts: LandingEventOptions,
): LandingEvent[] {
  const events: LandingEvent[] = [];

  for (const w of windows) {
    if (opts.showStarts && w.start) {
      events.push({ date: w.start, kind: "start", project: w });
    }
    if (opts.showEnds && w.end) {
      events.push({ date: w.end, kind: "end", project: w });
    }
  }

  if (opts.showMarkers && markers.length > 0) {
    const allowedProjectIds = new Set(windows.map((w) => w.id));
    const allowedTypes = new Set(opts.markerTypes);
    for (const m of markers) {
      if (!allowedProjectIds.has(m.project_id)) continue;
      if (!allowedTypes.has(m.semantic_type)) continue;
      if (!m.event_date) continue;
      events.push({ date: m.event_date, kind: "marker", marker: m });
    }
  }

  return events;
}

const KIND_ORDER: Record<LandingEventKind, number> = { start: 0, marker: 1, end: 2 };

function eventLabel(e: LandingEvent): string {
  if (e.kind === "marker" && e.marker) return e.marker.object_name;
  return e.project?.name ?? "";
}

/** Group events by ISO yyyy-mm-dd date. Deterministic in-day order: starts → markers → ends → name. */
export function groupEventsByDate(events: LandingEvent[]): Map<string, LandingEvent[]> {
  const m = new Map<string, LandingEvent[]>();
  for (const e of events) {
    const arr = m.get(e.date);
    if (arr) arr.push(e);
    else m.set(e.date, [e]);
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => {
      if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      return eventLabel(a).localeCompare(eventLabel(b));
    });
  }
  return m;
}

/** Aggregate event counts by month (yyyy-mm) for Year view. */
export interface MonthLandingSummary {
  monthStart: Date;
  startCount: number;
  endCount: number;
  markerCount: number;
  preview: LandingEvent[]; // small mixed preview list (max 3)
}

export function summarizeLandingByMonth(
  months: Date[],
  events: LandingEvent[],
): MonthLandingSummary[] {
  const byKey = new Map<string, { startCount: number; endCount: number; markerCount: number; items: LandingEvent[] }>();
  for (const e of events) {
    const d = parseYmd(e.date);
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const slot = byKey.get(key) ?? { startCount: 0, endCount: 0, markerCount: 0, items: [] };
    if (e.kind === "start") slot.startCount++;
    else if (e.kind === "end") slot.endCount++;
    else slot.markerCount++;
    slot.items.push(e);
    byKey.set(key, slot);
  }
  return months.map((m) => {
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
    const slot = byKey.get(key) ?? { startCount: 0, endCount: 0, markerCount: 0, items: [] };
    const preview = [...slot.items]
      .sort((a, b) => {
        const c = a.date.localeCompare(b.date);
        if (c !== 0) return c;
        if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
        return eventLabel(a).localeCompare(eventLabel(b));
      })
      .slice(0, 3);
    return {
      monthStart: m,
      startCount: slot.startCount,
      endCount: slot.endCount,
      markerCount: slot.markerCount,
      preview,
    };
  });
}
