import type { DepEdge } from "@/lib/dependencyConflictEngine";
import { fsPairConflict } from "@/lib/dependencyConflictEngine";

export type ItemKind = "phase" | "task";

export interface CalendarItem {
  id: string;
  kind: ItemKind;
  name: string;
  semanticType: string; // work_item | milestone | deliverable | decision | review
  status: string;
  start: string | null;
  end: string | null;
  /** Date used to position a "key date" marker (phase end / task due). */
  keyDate: string | null;
  raw: any;
}

/** ISO yyyy-mm-dd helpers (treat as local date — we never carry a time). */
export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseYmd(s: string | null | undefined): Date | null {
  if (!s) return null;
  // Force local-noon to avoid TZ rollovers.
  const [y, m, d] = s.split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0, 0);
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

/** Inclusive overlap test for date ranges. */
export function rangeOverlapsMonth(start: string | null, end: string | null, monthStart: Date, monthEnd: Date): boolean {
  const s = parseYmd(start) ?? parseYmd(end);
  const e = parseYmd(end) ?? parseYmd(start);
  if (!s || !e) return false;
  return s <= monthEnd && e >= monthStart;
}

/** Same as above for a key-date (single day). */
export function dateInMonth(date: string | null, monthStart: Date, monthEnd: Date): boolean {
  const d = parseYmd(date);
  if (!d) return false;
  return d >= monthStart && d <= monthEnd;
}

/** 12 months ending on (and including) anchor month. */
export function rolling12MonthsEnding(anchor: Date): Date[] {
  const months: Date[] = [];
  for (let i = 11; i >= 0; i--) months.push(startOfMonth(addMonths(anchor, -i)));
  return months;
}

/** 12 months starting at anchor (inclusive). */
export function rolling12MonthsStarting(anchor: Date): Date[] {
  const months: Date[] = [];
  for (let i = 0; i < 12; i++) months.push(startOfMonth(addMonths(anchor, i)));
  return months;
}

/**
 * Continuous-span layout for a Month grid.
 * Each item produces 1..N "segments", one per week-row it occupies, so a
 * multi-day phase/task renders as a single continuous bar (split only at
 * Sunday week boundaries) instead of repeated daily chips.
 */
export interface MonthSpanSegment {
  item: CalendarItem;
  weekIndex: number;       // 0-based row in the 6-week grid
  startCol: number;        // 0..6 (Sun..Sat) inclusive
  endCol: number;          // 0..6 inclusive
  laneIndex: number;       // packed lane within the week-row
  isStart: boolean;        // true if this segment contains the item's true start day
  isEnd: boolean;          // true if this segment contains the item's true end day
}

export interface MonthSpanLayout {
  segments: MonthSpanSegment[];
  laneCountByWeek: number[]; // how many lanes were needed in each week-row
}

/** Pack continuous spans into lanes per week-row (greedy first-fit). */
export function buildMonthSpanLayout(
  monthStart: Date,
  cells: Date[],
  items: CalendarItem[],
): MonthSpanLayout {
  const totalWeeks = Math.ceil(cells.length / 7);
  const monthGridStart = cells[0];
  const monthGridEnd = cells[cells.length - 1];

  // Per-week lane occupancy (lane -> last endCol used)
  const lanesPerWeek: number[][] = Array.from({ length: totalWeeks }, () => []);
  const segments: MonthSpanSegment[] = [];

  // Sort: longest first, then by start, for nicer packing.
  const sorted = [...items].sort((a, b) => {
    const sa = parseYmd(a.start) ?? parseYmd(a.end);
    const sb = parseYmd(b.start) ?? parseYmd(b.end);
    const ea = parseYmd(a.end) ?? parseYmd(a.start);
    const eb = parseYmd(b.end) ?? parseYmd(b.start);
    const da = sa && ea ? ea.getTime() - sa.getTime() : 0;
    const db = sb && eb ? eb.getTime() - sb.getTime() : 0;
    if (db !== da) return db - da;
    return (sa?.getTime() ?? 0) - (sb?.getTime() ?? 0);
  });

  for (const it of sorted) {
    const rawStart = parseYmd(it.start) ?? parseYmd(it.end);
    const rawEnd = parseYmd(it.end) ?? parseYmd(it.start);
    if (!rawStart || !rawEnd) continue;

    // Clip to grid bounds.
    const itStart = rawStart < monthGridStart ? monthGridStart : rawStart;
    const itEnd = rawEnd > monthGridEnd ? monthGridEnd : rawEnd;
    if (itEnd < monthGridStart || itStart > monthGridEnd) continue;

    // Walk week-rows the item touches.
    for (let w = 0; w < totalWeeks; w++) {
      const weekStart = cells[w * 7];
      const weekEnd = cells[w * 7 + 6];
      if (itEnd < weekStart || itStart > weekEnd) continue;

      const segStart = itStart < weekStart ? weekStart : itStart;
      const segEnd = itEnd > weekEnd ? weekEnd : itEnd;
      const startCol = segStart.getDay();
      const endCol = segEnd.getDay();

      // Find lane: first lane where last endCol < startCol
      const lanes = lanesPerWeek[w];
      let laneIndex = lanes.findIndex((lastEnd) => lastEnd < startCol);
      if (laneIndex === -1) {
        laneIndex = lanes.length;
        lanes.push(endCol);
      } else {
        lanes[laneIndex] = endCol;
      }

      segments.push({
        item: it,
        weekIndex: w,
        startCol,
        endCol,
        laneIndex,
        isStart: ymd(segStart) === ymd(rawStart),
        isEnd: ymd(segEnd) === ymd(rawEnd),
      });
    }
  }

  return { segments, laneCountByWeek: lanesPerWeek.map((l) => l.length) };
}

/** Build the Mon-Sun (or Sun-Sat) grid for a single month — uses Sun-Sat to match shadcn calendar. */
export function buildMonthGrid(monthStart: Date): Date[] {
  const first = startOfMonth(monthStart);
  const last = endOfMonth(monthStart);
  const startWeekday = first.getDay(); // 0=Sun
  const cells: Date[] = [];
  // Leading days from previous month
  for (let i = startWeekday; i > 0; i--) {
    cells.push(new Date(first.getFullYear(), first.getMonth(), 1 - i, 12, 0, 0, 0));
  }
  // Days in month
  for (let d = 1; d <= last.getDate(); d++) {
    cells.push(new Date(first.getFullYear(), first.getMonth(), d, 12, 0, 0, 0));
  }
  // Trailing to fill final week
  while (cells.length % 7 !== 0) {
    const tail = cells[cells.length - 1];
    cells.push(new Date(tail.getFullYear(), tail.getMonth(), tail.getDate() + 1, 12, 0, 0, 0));
  }
  return cells;
}

/**
 * Upstream dependency tree for a typed key-date item.
 *
 * Resolves the FULL same-level finish-to-start predecessor graph (not just the
 * first match), supports branching, is cycle-safe via a visited set on
 * (id|type), and returns deterministic ordering at every level.
 *
 * Sort key per sibling group:
 *   1) earliest planned start (nulls last)
 *   2) earliest planned end   (nulls last)
 *   3) name (locale, case-insensitive)
 *   4) id (final tiebreaker)
 *
 * `validToNext` is computed for the dependency edge that connects this node
 * to its specific downstream parent in the tree (not "previous in flat list").
 */
export interface UpstreamNode {
  item: CalendarItem;
  /** Direct downstream item this predecessor feeds into. null = root. */
  downstream: CalendarItem | null;
  /** Hand-off validity for THIS edge: pred.end vs downstream.start. */
  validToNext: boolean | null;
  /** Indented children — predecessors of `item`. */
  children: UpstreamNode[];
  /** Tree depth (root = 0; direct predecessors = 1). */
  depth: number;
}

function nodeSortKey(a: CalendarItem, b: CalendarItem): number {
  const sa = a.start ?? "9999-12-31";
  const sb = b.start ?? "9999-12-31";
  if (sa !== sb) return sa < sb ? -1 : 1;
  const ea = a.end ?? "9999-12-31";
  const eb = b.end ?? "9999-12-31";
  if (ea !== eb) return ea < eb ? -1 : 1;
  const na = a.name.toLocaleLowerCase();
  const nb = b.name.toLocaleLowerCase();
  if (na !== nb) return na < nb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildUpstreamTree(args: {
  rootId: string;
  rootType: ItemKind;
  dependencies: DepEdge[];
  itemsById: Record<string, CalendarItem>;
}): UpstreamNode | null {
  const { rootId, rootType, dependencies, itemsById } = args;
  const root = itemsById[rootId];
  if (!root) return null;

  // Index incoming FS edges by (target_id|target_type) for O(1) lookup.
  const incomingByTarget = new Map<string, DepEdge[]>();
  for (const d of dependencies) {
    if (d.dependency_type !== "finish_to_start") continue;
    const k = `${d.target_id}|${d.target_type}`;
    const arr = incomingByTarget.get(k) ?? [];
    arr.push(d);
    incomingByTarget.set(k, arr);
  }

  const visit = (
    item: CalendarItem,
    downstream: CalendarItem | null,
    depth: number,
    pathSet: Set<string>,
  ): UpstreamNode => {
    const validToNext: boolean | null = (() => {
      if (!downstream) return null;
      const predEnd = item.end;
      const succStart = downstream.start;
      if (!predEnd || !succStart) return null;
      return !fsPairConflict(predEnd, succStart);
    })();

    const k = `${item.id}|${item.kind}`;
    const incoming = incomingByTarget.get(k) ?? [];

    // Resolve all unique predecessor items, skipping cycles.
    const predItems: CalendarItem[] = [];
    const seenLocal = new Set<string>();
    for (const edge of incoming) {
      const predKey = `${edge.source_id}|${edge.source_type}`;
      if (pathSet.has(predKey)) continue; // cycle guard
      if (seenLocal.has(predKey)) continue; // dedupe parallel edges
      const pred = itemsById[edge.source_id];
      if (!pred) continue;
      seenLocal.add(predKey);
      predItems.push(pred);
    }
    predItems.sort(nodeSortKey);

    const nextPath = new Set(pathSet);
    nextPath.add(k);

    const children = predItems.map((p) => visit(p, item, depth + 1, nextPath));

    return { item, downstream, validToNext, children, depth };
  };

  const rootPath = new Set<string>([`${root.id}|${root.kind}`]);
  return visit(root, null, 0, rootPath);
}

/** Count all predecessors in tree (excluding the root). */
export function countUpstreamPredecessors(node: UpstreamNode): number {
  let n = 0;
  const walk = (x: UpstreamNode) => {
    for (const c of x.children) {
      n++;
      walk(c);
    }
  };
  walk(node);
  return n;
}

