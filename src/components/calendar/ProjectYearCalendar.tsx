import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type CalendarItem,
  rangeOverlapsMonth,
  dateInMonth,
  endOfMonth,
  monthLabel,
  rolling12MonthsStarting,
} from "./calendarUtils";
import { isNonStandardType, semanticTypeLabel } from "@/lib/phaseTypes";
import type { DisplayMode } from "./CalendarToolbar";
import {
  type GovernanceMarker,
  markerDotClass,
  markerPrefix,
} from "./governanceMarkers";
import { parseYmd } from "./calendarUtils";

interface Props {
  anchor: Date;
  items: CalendarItem[];          // already filtered upstream
  displayMode: DisplayMode;
  onMonthClick: (monthStart: Date) => void;
  onItemClick: (item: CalendarItem) => void;
  /** GT.6a — read-only governance markers (whole 12-month window). */
  governanceMarkers?: GovernanceMarker[];
}

export function ProjectYearCalendar({
  anchor,
  items,
  displayMode,
  onMonthClick,
  onItemClick,
  governanceMarkers = [],
}: Props) {
  const months = useMemo(() => rolling12MonthsStarting(anchor), [anchor]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {months.map((m) => {
        const mEnd = endOfMonth(m);

        const inMonth = displayMode === "milestones"
          ? items.filter((i) => isNonStandardType(i.semanticType) && dateInMonth(i.keyDate, m, mEnd))
          : items.filter((i) => rangeOverlapsMonth(i.start, i.end, m, mEnd));

        const phaseCount = inMonth.filter((i) => i.kind === "phase").length;
        const taskCount = inMonth.filter((i) => i.kind === "task").length;

        // GT.6a — governance markers falling inside this month
        const govInMonth = governanceMarkers.filter((gm) => {
          const d = parseYmd(gm.date);
          return !!d && d >= m && d <= mEnd;
        });
        const govCounts = {
          overdue: govInMonth.filter((g) => g.kind === "overdue").length,
          expected: govInMonth.filter((g) => g.kind === "expected").length,
          completed: govInMonth.filter((g) => g.kind === "completed").length,
        };

        return (
          <Card
            key={m.toISOString()}
            className="p-3 cursor-pointer hover:bg-accent/30 transition-colors"
            onClick={() => onMonthClick(m)}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-foreground">{monthLabel(m)}</div>
              <div className="flex items-center gap-1">
                {phaseCount > 0 && <Badge variant="secondary" className="text-[10px]">P {phaseCount}</Badge>}
                {taskCount > 0 && <Badge variant="outline" className="text-[10px]">T {taskCount}</Badge>}
                {(["overdue", "expected", "completed"] as const).map((k) =>
                  govCounts[k] > 0 ? (
                    <span
                      key={k}
                      title={`${markerPrefix(k)} governance: ${govCounts[k]}`}
                      className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"
                    >
                      <span className={cn("inline-block h-2 w-2 rounded-full", markerDotClass(k))} />
                      {govCounts[k]}
                    </span>
                  ) : null,
                )}
              </div>
            </div>

            {displayMode === "milestones" ? (
              inMonth.length === 0 ? (
                <p className="text-xs text-muted-foreground">—</p>
              ) : (
                <div className="space-y-1">
                  {inMonth.slice(0, 4).map((it) => (
                    <button
                      key={it.id}
                      className={cn(
                        "block w-full text-left text-xs truncate px-2 py-1 rounded border",
                        "border-primary/30 bg-primary/5 hover:bg-primary/10 text-foreground",
                      )}
                      onClick={(e) => { e.stopPropagation(); onItemClick(it); }}
                      title={`${semanticTypeLabel(it.semanticType)} • ${it.name}`}
                    >
                      <span className="font-medium">{semanticTypeLabel(it.semanticType)}:</span> {it.name}
                    </button>
                  ))}
                  {inMonth.length > 4 && (
                    <p className="text-[10px] text-muted-foreground">+{inMonth.length - 4} more</p>
                  )}
                </div>
              )
            ) : (
              // Schedule mode → aggregated only. No repeated label clutter.
              inMonth.length === 0 ? (
                <p className="text-xs text-muted-foreground">—</p>
              ) : (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary/40"
                      style={{ width: `${Math.min(100, (inMonth.length / 12) * 100)}%` }}
                    />
                  </div>
                  <span className="tabular-nums">{inMonth.length}</span>
                </div>
              )
            )}
          </Card>
        );
      })}
    </div>
  );
}
