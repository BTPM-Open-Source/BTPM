import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  type LandingEvent,
  monthLabel,
  rolling12MonthsStarting,
  summarizeLandingByMonth,
  getStatusTone,
  MARKER_TYPE_LABELS,
} from "./roadmapCalendarUtils";
import { ArrowDownToLine, ArrowUpFromLine, Flag } from "lucide-react";

interface Props {
  anchor: Date;
  events: LandingEvent[];
  onMonthClick: (monthStart: Date) => void;
  /** v2.3: clicking a preview row opens the detail drawer (does not drill into Month). */
  onEventSelect: (event: LandingEvent) => void;
}

export function RoadmapYearCalendar({ anchor, events, onMonthClick, onEventSelect }: Props) {
  const months = useMemo(() => rolling12MonthsStarting(anchor), [anchor]);
  const perMonth = useMemo(() => summarizeLandingByMonth(months, events), [months, events]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {perMonth.map(({ monthStart, startCount, endCount, markerCount, preview }) => {
        const total = startCount + endCount + markerCount;
        const isEmpty = total === 0;

        return (
          <Card
            key={monthStart.toISOString()}
            className={cn(
              "p-3 cursor-pointer transition-colors",
              isEmpty ? "hover:bg-muted/40" : "hover:bg-accent/40",
            )}
            onClick={() => onMonthClick(monthStart)}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-foreground">{monthLabel(monthStart)}</div>
              {!isEmpty && (
                <span className="text-[10px] tabular-nums text-muted-foreground">{total}</span>
              )}
            </div>

            {isEmpty ? (
              <p className="text-xs text-muted-foreground">No events</p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {startCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      <ArrowUpFromLine className="h-2.5 w-2.5" />
                      {startCount} {startCount === 1 ? "start" : "starts"}
                    </span>
                  )}
                  {markerCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-[hsl(var(--warning))]/15 px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--warning))]">
                      <Flag className="h-2.5 w-2.5" />
                      {markerCount} {markerCount === 1 ? "marker" : "markers"}
                    </span>
                  )}
                  {endCount > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-[hsl(var(--success))]/10 px-1.5 py-0.5 text-[10px] font-medium text-[hsl(var(--success))]">
                      <ArrowDownToLine className="h-2.5 w-2.5" />
                      {endCount} {endCount === 1 ? "end" : "ends"}
                    </span>
                  )}
                </div>

                <ul className="space-y-0.5">
                  {preview.map((e, i) => {
                    if (e.kind === "marker" && e.marker) {
                      const m = e.marker;
                      const tone = getStatusTone(m.project_status);
                      return (
                        <li key={`mk-${m.object_id}-${i}`}>
                          <button
                            type="button"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              onEventSelect(e);
                            }}
                            className="w-full text-[11px] text-foreground truncate flex items-center gap-1.5 hover:bg-accent/50 rounded px-1 py-0.5 transition focus:outline-none focus:ring-1 focus:ring-ring text-left"
                            title={`${MARKER_TYPE_LABELS[m.semantic_type]} (${m.object_kind}): ${m.object_name} — ${m.project_name}`}
                          >
                            <Flag className="h-2.5 w-2.5 flex-shrink-0 text-[hsl(var(--warning))]" />
                            <span className={cn("inline-block h-2 w-2 rounded-sm flex-shrink-0", tone.dot)} />
                            <span className="truncate">{m.object_name}</span>
                          </button>
                        </li>
                      );
                    }
                    const project = e.project!;
                    const tone = getStatusTone(project.status);
                    const isStart = e.kind === "start";
                    return (
                      <li key={`${project.id}-${e.kind}-${i}`}>
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            onEventSelect(e);
                          }}
                          className="w-full text-[11px] text-foreground truncate flex items-center gap-1.5 hover:bg-accent/50 rounded px-1 py-0.5 transition focus:outline-none focus:ring-1 focus:ring-ring text-left"
                          title={`${isStart ? "Start" : "Target end"}: ${project.name}`}
                        >
                          {isStart ? (
                            <ArrowUpFromLine className="h-2.5 w-2.5 flex-shrink-0 text-primary" />
                          ) : (
                            <ArrowDownToLine className="h-2.5 w-2.5 flex-shrink-0 text-[hsl(var(--success))]" />
                          )}
                          <span className={cn("inline-block h-2 w-2 rounded-sm flex-shrink-0", tone.dot)} />
                          <span className="truncate">{project.name}</span>
                        </button>
                      </li>
                    );
                  })}
                  {total > preview.length && (
                    <li className="text-[10px] text-muted-foreground">+{total - preview.length} more</li>
                  )}
                </ul>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
