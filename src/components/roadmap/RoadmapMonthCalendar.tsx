import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type ProjectWindow,
  type LandingEvent,
  buildMonthGrid,
  groupEventsByDate,
  getStatusTone,
  ymd,
  sameYmd,
  dayLongLabel,
  MARKER_TYPE_LABELS,
} from "./roadmapCalendarUtils";
import type { RoadmapMarkerEvent } from "@/hooks/useRoadmapCalendarMarkers";
import { ArrowDownToLine, ArrowUpFromLine, ChevronRight, ExternalLink, Flag } from "lucide-react";

interface Props {
  anchor: Date;
  events: LandingEvent[];
  selectedDay: Date;
  onSelectDay: (d: Date) => void;
  undatedCount: number;
  /** Primary click on an agenda row — opens the v2.3 detail drawer. */
  onEventSelect: (event: LandingEvent) => void;
  /** Secondary explicit "open project" action. */
  onProjectOpen: (p: ProjectWindow) => void;
  /** Secondary explicit "open phase/task" action. */
  onMarkerOpen: (m: RoadmapMarkerEvent) => void;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function RoadmapMonthCalendar({
  anchor,
  events,
  selectedDay,
  onSelectDay,
  undatedCount,
  onEventSelect,
  onProjectOpen,
  onMarkerOpen,
}: Props) {
  const cells = useMemo(() => buildMonthGrid(anchor), [anchor]);
  const monthIdx = anchor.getMonth();
  const today = useMemo(() => new Date(), []);

  const eventsByDate = useMemo(() => groupEventsByDate(events), [events]);

  const selectedKey = ymd(selectedDay);
  const selectedEvents = eventsByDate.get(selectedKey) ?? [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-3">
      {/* ── Month grid ── */}
      <Card className="p-3">
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground mb-1">
          {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((d) => {
            const key = ymd(d);
            const isOutside = d.getMonth() !== monthIdx;
            const isToday = sameYmd(d, today);
            const isSelected = key === selectedKey;
            const dayEvents = eventsByDate.get(key) ?? [];
            const startCount = dayEvents.filter((e) => e.kind === "start").length;
            const endCount = dayEvents.filter((e) => e.kind === "end").length;
            const markerCount = dayEvents.filter((e) => e.kind === "marker").length;
            const hasEvents = dayEvents.length > 0;

            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectDay(d)}
                className={cn(
                  "min-h-[88px] text-left rounded border p-1.5 transition focus:outline-none focus:ring-2 focus:ring-ring",
                  "bg-card hover:bg-accent/40",
                  isOutside && "opacity-50 bg-muted/30",
                  isSelected && "ring-2 ring-primary border-primary",
                  !isSelected && "border-border",
                )}
                aria-pressed={isSelected}
                aria-label={`${dayLongLabel(d)}${hasEvents ? ` — ${startCount} starts, ${markerCount} markers, ${endCount} ends` : " — no events"}`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "text-[11px] tabular-nums",
                      isToday
                        ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold"
                        : "text-muted-foreground",
                    )}
                  >
                    {d.getDate()}
                  </span>
                </div>

                {hasEvents && (
                  <div className="mt-1.5 space-y-1">
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
                )}
              </button>
            );
          })}
        </div>

        {undatedCount > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            {undatedCount} project{undatedCount > 1 ? "s" : ""} not shown — missing dates.
          </p>
        )}
      </Card>

      {/* ── Selected-day agenda ── */}
      <Card className="p-3 lg:sticky lg:top-3 self-start">
        <div className="mb-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Agenda</p>
          <p className="text-sm font-semibold text-foreground">{dayLongLabel(selectedDay)}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {selectedEvents.length === 0
              ? "No events on this day."
              : `${selectedEvents.length} event${selectedEvents.length === 1 ? "" : "s"}`}
          </p>
        </div>

        {selectedEvents.length === 0 ? (
          <div className="rounded border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            Pick another day, or change Calendar options.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {selectedEvents.map((e, i) => {
              if (e.kind === "marker" && e.marker) {
                const m = e.marker;
                const tone = getStatusTone(m.project_status);
                return (
                  <li key={`marker-${m.object_id}-${i}`}>
                    <div className="flex items-stretch rounded border border-border bg-card hover:bg-accent/50 transition">
                      <button
                        type="button"
                        onClick={() => onEventSelect(e)}
                        className="flex-1 text-left p-2 flex items-start gap-2 focus:outline-none focus:ring-2 focus:ring-ring rounded-l"
                        aria-label={`Open details for ${m.object_name}`}
                      >
                        <span
                          className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]"
                          aria-hidden="true"
                        >
                          <Flag className="h-3 w-3" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge
                              variant="outline"
                              className="h-4 px-1.5 text-[9px] uppercase tracking-wide border-[hsl(var(--warning))]/40 text-[hsl(var(--warning))]"
                            >
                              {MARKER_TYPE_LABELS[m.semantic_type]}
                            </Badge>
                            <Badge variant="secondary" className="h-4 px-1.5 text-[9px] uppercase tracking-wide">
                              {m.object_kind}
                            </Badge>
                            <span className={cn("inline-block h-2 w-2 rounded-sm", tone.dot)} title={tone.label} />
                          </div>
                          <p className="mt-0.5 text-sm font-medium text-foreground truncate">{m.object_name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">
                            {m.project_name}
                            {m.phase_name ? ` · ${m.phase_name}` : ""}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                      </button>
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onMarkerOpen(m);
                        }}
                        className="px-2 border-l border-border text-muted-foreground hover:text-foreground hover:bg-accent transition rounded-r focus:outline-none focus:ring-2 focus:ring-ring"
                        title={`Open ${m.object_kind} page`}
                        aria-label={`Open ${m.object_kind} page`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              }

              const project = e.project!;
              const tone = getStatusTone(project.status);
              const isStart = e.kind === "start";
              return (
                <li key={`${project.id}-${e.kind}-${i}`}>
                  <div className="flex items-stretch rounded border border-border bg-card hover:bg-accent/50 transition">
                    <button
                      type="button"
                      onClick={() => onEventSelect(e)}
                      className="flex-1 text-left p-2 flex items-start gap-2 focus:outline-none focus:ring-2 focus:ring-ring rounded-l"
                      aria-label={`Open details for ${project.name}`}
                    >
                      <span
                        className={cn(
                          "mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded",
                          isStart
                            ? "bg-primary/15 text-primary"
                            : "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]",
                        )}
                        aria-hidden="true"
                      >
                        {isStart ? <ArrowUpFromLine className="h-3 w-3" /> : <ArrowDownToLine className="h-3 w-3" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              "h-4 px-1.5 text-[9px] uppercase tracking-wide",
                              isStart
                                ? "border-primary/40 text-primary"
                                : "border-[hsl(var(--success))]/40 text-[hsl(var(--success))]",
                            )}
                          >
                            {isStart ? "Start" : "Target end"}
                          </Badge>
                          <span className={cn("inline-block h-2 w-2 rounded-sm", tone.dot)} title={tone.label} />
                          <span className="text-[10px] text-muted-foreground truncate">{tone.label}</span>
                        </div>
                        <p className="mt-0.5 text-sm font-medium text-foreground truncate">{project.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {project.workspace_name}
                          {project.program_name ? ` · ${project.program_name}` : ""}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                    </button>
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onProjectOpen(project);
                      }}
                      className="px-2 border-l border-border text-muted-foreground hover:text-foreground hover:bg-accent transition rounded-r focus:outline-none focus:ring-2 focus:ring-ring"
                      title="Open project page"
                      aria-label="Open project page"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
