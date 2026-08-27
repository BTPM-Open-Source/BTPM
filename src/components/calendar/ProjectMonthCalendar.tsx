import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  type CalendarItem,
  buildMonthGrid,
  buildMonthSpanLayout,
  ymd,
} from "./calendarUtils";
import { isNonStandardType, semanticTypeLabel } from "@/lib/phaseTypes";
import type { DisplayMode } from "./CalendarToolbar";
import {
  type GovernanceMarker,
  groupMarkersByDate,
  markerToneClass,
  markerPrefix,
} from "./governanceMarkers";
import { CalendarClock, FileText, ShieldAlert } from "lucide-react";

interface Props {
  anchor: Date;
  items: CalendarItem[];          // already filtered upstream
  displayMode: DisplayMode;
  onItemClick: (item: CalendarItem) => void;
  /** GT.6a — read-only governance markers per day. Optional. */
  governanceMarkers?: GovernanceMarker[];
  onGovernanceMarkerClick?: (marker: GovernanceMarker) => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ROW_PX = 22;       // height per lane
const HEADER_PX = 22;    // day-number area
const ROW_GAP = 2;
const MAX_GOV_PER_CELL = 2;

export function ProjectMonthCalendar({
  anchor,
  items,
  displayMode,
  onItemClick,
  governanceMarkers = [],
  onGovernanceMarkerClick,
}: Props) {
  const cells = useMemo(() => buildMonthGrid(anchor), [anchor]);
  const monthIdx = anchor.getMonth();
  const totalWeeks = cells.length / 7;

  // Schedule mode → continuous-span layout. Milestones mode → markers on key date.
  const layout = useMemo(() => {
    if (displayMode !== "schedule") return null;
    return buildMonthSpanLayout(anchor, cells, items);
  }, [displayMode, anchor, cells, items]);

  const milestonesByDay = useMemo(() => {
    if (displayMode !== "milestones") return {};
    const map: Record<string, CalendarItem[]> = {};
    for (const it of items) {
      if (!isNonStandardType(it.semanticType)) continue;
      if (!it.keyDate) continue;
      (map[it.keyDate] ||= []).push(it);
    }
    return map;
  }, [items, displayMode]);

  const governanceByDay = useMemo(
    () => groupMarkersByDate(governanceMarkers),
    [governanceMarkers],
  );

  // Hidden undated count (transparency).
  const undatedCount = useMemo(() => {
    if (displayMode === "milestones") {
      return items.filter((i) => isNonStandardType(i.semanticType) && !i.keyDate).length;
    }
    return items.filter((i) => !i.start && !i.end).length;
  }, [items, displayMode]);

  const weekRowHeight = (weekIdx: number): number => {
    const lanes = layout?.laneCountByWeek[weekIdx] ?? 0;
    const base = HEADER_PX + 8;
    if (displayMode === "schedule") {
      return Math.max(96, base + lanes * (ROW_PX + ROW_GAP));
    }
    return 104;
  };

  return (
    <Card className="p-3">
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground mb-1">
        {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
      </div>

      <div className="space-y-1">
        {Array.from({ length: totalWeeks }).map((_, w) => {
          const weekCells = cells.slice(w * 7, w * 7 + 7);
          const weekSegs = layout?.segments.filter((s) => s.weekIndex === w) ?? [];
          const rowH = weekRowHeight(w);

          return (
            <div key={w} className="relative" style={{ height: rowH }}>
              {/* Day cell backgrounds */}
              <div className="grid grid-cols-7 gap-1 h-full">
                {weekCells.map((d) => {
                  const isOutside = d.getMonth() !== monthIdx;
                  const dayKey = ymd(d);
                  const ms = displayMode === "milestones" ? (milestonesByDay[dayKey] ?? []) : [];
                  const govs = governanceByDay[dayKey] ?? [];
                  return (
                    <div
                      key={dayKey}
                      className={cn(
                        "rounded border border-border bg-card p-1.5 overflow-hidden",
                        isOutside && "opacity-50 bg-muted/30",
                      )}
                    >
                      <div className="text-[10px] text-muted-foreground">{d.getDate()}</div>
                      {displayMode === "milestones" && ms.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {ms.slice(0, 3).map((it) => (
                            <button
                              key={it.id}
                              onClick={() => onItemClick(it)}
                              className="block w-full text-left text-[10px] truncate px-1.5 py-0.5 rounded border border-primary/40 bg-primary/10 text-foreground ring-1 ring-primary/20"
                              title={`${semanticTypeLabel(it.semanticType)} • ${it.name}`}
                            >
                              <span className="font-semibold">{semanticTypeLabel(it.semanticType)}: </span>
                              {it.name}
                            </button>
                          ))}
                          {ms.length > 3 && (
                            <p className="text-[9px] text-muted-foreground">+{ms.length - 3}</p>
                          )}
                        </div>
                      )}

                      {/* GT.6a — Governance markers in day cell (read-only) */}
                      {govs.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {govs.slice(0, MAX_GOV_PER_CELL).map((m, i) => {
                            const Icon =
                              m.kind === "completed"
                                ? FileText
                                : m.kind === "overdue"
                                  ? ShieldAlert
                                  : CalendarClock;
                            return (
                              <button
                                key={`gov-${dayKey}-${i}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onGovernanceMarkerClick?.(m);
                                }}
                                className={cn(
                                  "flex items-center gap-1 w-full text-left text-[10px] truncate px-1.5 py-0.5 rounded border",
                                  markerToneClass(m.kind),
                                )}
                                title={`${markerPrefix(m.kind)} governance: ${m.label} (read-only)`}
                              >
                                <Icon className="h-2.5 w-2.5 shrink-0" />
                                <span className="font-semibold">{markerPrefix(m.kind)}:</span>
                                <span className="truncate">{m.label}</span>
                              </button>
                            );
                          })}
                          {govs.length > MAX_GOV_PER_CELL && (
                            <p className="text-[9px] text-muted-foreground">
                              +{govs.length - MAX_GOV_PER_CELL} more governance
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Continuous span overlay (Schedule mode only) */}
              {displayMode === "schedule" && weekSegs.map((seg, idx) => {
                const span = seg.endCol - seg.startCol + 1;
                const leftPct = (seg.startCol / 7) * 100;
                const widthPct = (span / 7) * 100;
                const top = HEADER_PX + 4 + seg.laneIndex * (ROW_PX + ROW_GAP);
                const tone = seg.item.kind === "phase"
                  ? "border-primary/40 bg-primary/15 text-foreground"
                  : "border-border bg-secondary text-secondary-foreground";
                const typed = isNonStandardType(seg.item.semanticType);
                return (
                  <button
                    key={`${w}-${seg.item.id}-${idx}`}
                    onClick={() => onItemClick(seg.item)}
                    className={cn(
                      "absolute text-[11px] truncate text-left border px-1.5 rounded-sm hover:brightness-110 transition",
                      tone,
                      typed && "ring-1 ring-primary/30",
                      !seg.isStart && "rounded-l-none border-l-0",
                      !seg.isEnd && "rounded-r-none border-r-0",
                    )}
                    style={{
                      left: `calc(${leftPct}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      top,
                      height: ROW_PX,
                      lineHeight: `${ROW_PX}px`,
                    }}
                    title={`${typed ? semanticTypeLabel(seg.item.semanticType) + " • " : ""}${seg.item.name}`}
                  >
                    {seg.isStart ? (
                      <>
                        {typed && <span className="font-semibold">{semanticTypeLabel(seg.item.semanticType)}: </span>}
                        {seg.item.name}
                      </>
                    ) : (
                      <span className="opacity-60">↳ {seg.item.name}</span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {undatedCount > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          {undatedCount} item{undatedCount > 1 ? "s" : ""} not shown — missing dates.
        </p>
      )}
    </Card>
  );
}
