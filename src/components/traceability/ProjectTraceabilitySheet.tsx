/**
 * Wave B.5+ — Project Traceability surface.
 *
 * Right-side Sheet that lists material canonical changes for a project,
 * sourced ONLY from `activity_events` (via `useProjectActivityEvents`).
 *
 * Two presentation modes, both derived in-memory from the same event set:
 *   - Event log     : chronological list (default, unchanged behaviour)
 *   - Period summary: grouped cards over a selected period + underlying events
 *
 * No backend changes, no new storage, no duplicate reporting state.
 * Comments and execution updates remain in their own surfaces.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Info, Activity } from "lucide-react";
import {
  useProjectActivityEvents,
  type ProjectActivityEvent,
} from "@/hooks/useProjectActivityEvents";
import { useProjectObjectIndex } from "@/hooks/useProjectObjectIndex";
import {
  classifyEvent,
  classifySummaryGroup,
  summarizeEvent,
  dedupeMirroredEvents,
  EVENT_CLASS_ORDER,
  SUMMARY_GROUP_ORDER,
  type EventClass,
  type SummaryGroup,
} from "@/lib/traceabilityVocabulary";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  projectCreatedAt: string;
  /** Optional actor id → display-name map for richer "by …" rendering. */
  actorNames?: Record<string, string>;
}

const HONESTY_THRESHOLD_DAYS = 7;

type ViewMode = "log" | "summary";
type PeriodKey =
  | "all"
  | "last_7"
  | "current_week"
  | "previous_week"
  | "last_30"
  | "custom";

const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "last_7", label: "Last 7 days" },
  { value: "current_week", label: "Current week" },
  { value: "previous_week", label: "Previous week" },
  { value: "last_30", label: "Last 30 days" },
  { value: "custom", label: "Custom" },
];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}
function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24);
}

/** Inclusive [start, end] range in local time, or null for "all time". */
function computeRange(
  period: PeriodKey,
  customStart: string,
  customEnd: string,
): { start: Date; end: Date } | null {
  const now = new Date();
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };
  if (period === "all") return null;
  if (period === "last_7") {
    const start = startOfDay(new Date(now.getTime() - 6 * 86400000));
    return { start, end: endOfDay(now) };
  }
  if (period === "last_30") {
    const start = startOfDay(new Date(now.getTime() - 29 * 86400000));
    return { start, end: endOfDay(now) };
  }
  if (period === "current_week" || period === "previous_week") {
    // ISO-ish week: Monday start.
    const d = new Date(now);
    const day = (d.getDay() + 6) % 7; // 0 = Monday
    const monday = startOfDay(new Date(d.getTime() - day * 86400000));
    if (period === "current_week") {
      return { start: monday, end: endOfDay(new Date(monday.getTime() + 6 * 86400000)) };
    }
    const prevMonday = new Date(monday.getTime() - 7 * 86400000);
    return { start: prevMonday, end: endOfDay(new Date(prevMonday.getTime() + 6 * 86400000)) };
  }
  if (period === "custom") {
    if (!customStart || !customEnd) return null;
    const s = new Date(`${customStart}T00:00:00`);
    const e = new Date(`${customEnd}T23:59:59.999`);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
    return { start: s, end: e };
  }
  return null;
}

export function ProjectTraceabilitySheet({
  open,
  onOpenChange,
  projectId,
  projectName,
  projectCreatedAt,
  actorNames = {},
}: Props) {
  const [filter, setFilter] = useState<EventClass | "all">("all");
  const [mode, setMode] = useState<ViewMode>("log");
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [summaryDefaultApplied, setSummaryDefaultApplied] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const { data: rawEvents = [], isLoading, isError, error } = useProjectActivityEvents(
    projectId,
    open,
  );
  const { data: objectIndex } = useProjectObjectIndex(projectId, projectName, open);

  // UI-only mirror collapse — preserves underlying event store.
  const events = useMemo(() => dedupeMirroredEvents(rawEvents), [rawEvents]);

  // First time the user switches to summary, default the period to Last 7 days
  // unless they had already chosen a non-default period.
  useEffect(() => {
    if (mode === "summary" && !summaryDefaultApplied && period === "all") {
      setPeriod("last_7");
      setSummaryDefaultApplied(true);
    }
  }, [mode, summaryDefaultApplied, period]);

  const range = useMemo(
    () => computeRange(period, customStart, customEnd),
    [period, customStart, customEnd],
  );

  const customInvalid =
    period === "custom" &&
    customStart !== "" &&
    customEnd !== "" &&
    new Date(`${customStart}T00:00:00`) > new Date(`${customEnd}T00:00:00`);

  const periodFiltered = useMemo(() => {
    if (!range) return events;
    const s = range.start.getTime();
    const e = range.end.getTime();
    return events.filter((ev) => {
      const t = new Date(ev.created_at).getTime();
      return t >= s && t <= e;
    });
  }, [events, range]);

  const classFiltered = useMemo(() => {
    if (filter === "all") return periodFiltered;
    return periodFiltered.filter((e) => classifyEvent(e.event_type) === filter);
  }, [periodFiltered, filter]);

  const summaryBuckets = useMemo(() => {
    const map = new Map<SummaryGroup, ProjectActivityEvent[]>();
    for (const g of SUMMARY_GROUP_ORDER) map.set(g.value, []);
    for (const ev of periodFiltered) {
      const g = classifySummaryGroup(ev.event_type, ev.metadata);
      if (!g) continue;
      map.get(g)!.push(ev);
    }
    return map;
  }, [periodFiltered]);

  const honestyNotice = useMemo(() => {
    if (events.length === 0) return null;
    const earliest = events[events.length - 1].created_at;
    const gap = daysBetween(earliest, projectCreatedAt);
    if (gap < HONESTY_THRESHOLD_DAYS) return null;
    return `Traceability history begins on ${formatDate(earliest)}. Older material changes may not be present.`;
  }, [events, projectCreatedAt]);

  const periodLabel =
    PERIOD_OPTIONS.find((p) => p.value === period)?.label ?? "All time";
  const resultCount = classFiltered.length;
  const resultCountLabel =
    period === "all"
      ? `${resultCount} event${resultCount === 1 ? "" : "s"}`
      : resultCount === 0
        ? `No events in ${periodLabel.toLowerCase()}`
        : `${resultCount} event${resultCount === 1 ? "" : "s"} in ${periodLabel.toLowerCase()}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col gap-4 overflow-hidden p-0"
      >
        <SheetHeader className="px-6 pt-6 pb-2 shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" /> Project Traceability
          </SheetTitle>
          <SheetDescription className="text-xs">
            Read-only log of material canonical changes for{" "}
            <span className="font-medium text-foreground">{projectName}</span>. Sourced from
            activity events only — comments and execution updates remain in their own surfaces.
          </SheetDescription>
        </SheetHeader>

        {/* Row 1: view mode toggle + period selector */}
        <div className="px-6 shrink-0 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setMode("log")}
              className={
                "text-xs px-3 py-1.5 transition-colors " +
                (mode === "log"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted")
              }
            >
              Event log
            </button>
            <button
              type="button"
              onClick={() => setMode("summary")}
              className={
                "text-xs px-3 py-1.5 transition-colors border-l border-border " +
                (mode === "summary"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted")
              }
            >
              Period summary
            </button>
          </div>

          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((p) => (
                <SelectItem key={p.value} value={p.value} className="text-xs">
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-xs text-muted-foreground ml-auto">{resultCountLabel}</span>
        </div>

        {period === "custom" && (
          <div className="px-6 shrink-0 flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              From
              <Input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-8 w-[150px] text-xs"
              />
            </label>
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              To
              <Input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-8 w-[150px] text-xs"
              />
            </label>
            {customInvalid && (
              <span className="text-xs text-destructive">
                Start date must be on or before end date.
              </span>
            )}
          </div>
        )}

        {/* Row 2: existing class chips */}
        <div className="px-6 shrink-0 flex flex-wrap gap-1.5">
          {EVENT_CLASS_ORDER.map((c) => {
            const isActive = filter === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => setFilter(c.value)}
                className={
                  "text-xs px-2.5 py-1 rounded-md border transition-colors " +
                  (isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:bg-muted")
                }
              >
                {c.label}
              </button>
            );
          })}
        </div>

        {honestyNotice && (
          <div className="px-6 shrink-0">
            <Alert variant="default" className="text-xs">
              <Info className="h-3.5 w-3.5" />
              <AlertDescription>{honestyNotice}</AlertDescription>
            </Alert>
          </div>
        )}

        {/* Body */}
        <ScrollArea className="flex-1 px-6 pb-6">
          {isLoading && <p className="text-sm text-muted-foreground">Loading traceability…</p>}
          {isError && (
            <p className="text-sm text-destructive">
              Could not load traceability: {(error as Error)?.message ?? "unknown error"}
            </p>
          )}

          {!isLoading && !isError && mode === "summary" && (
            <SummaryView
              buckets={summaryBuckets}
              objectIndex={objectIndex}
              hasAnyInPeriod={periodFiltered.length > 0}
            />
          )}

          {!isLoading && !isError && (
            <>
              {mode === "summary" && periodFiltered.length > 0 && (
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mt-6 mb-2">
                  Underlying events
                </h4>
              )}
              <EventList
                events={classFiltered}
                allEventsInScope={events.length}
                objectIndex={objectIndex}
                actorNames={actorNames}
                emptyMessage={
                  events.length === 0
                    ? "No material changes have been recorded yet."
                    : period === "all"
                      ? "No events match this filter."
                      : `No events match this filter in ${periodLabel.toLowerCase()}.`
                }
              />
            </>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ---------- Sub-components ----------

function EventList({
  events,
  allEventsInScope,
  objectIndex,
  actorNames,
  emptyMessage,
}: {
  events: ProjectActivityEvent[];
  allEventsInScope: number;
  objectIndex: ReturnType<typeof useProjectObjectIndex>["data"];
  actorNames: Record<string, string>;
  emptyMessage: string;
}) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground italic">{emptyMessage}</p>;
  }
  void allEventsInScope;
  return (
    <ol className="space-y-4">
      {events.map((e) => {
        const cls = classifyEvent(e.event_type);
        const summary = summarizeEvent({
          eventType: e.event_type,
          targetType: e.target_type,
          targetId: e.target_id,
          metadata: e.metadata,
          index: objectIndex,
        });
        const actor =
          (e.actor_id && actorNames[e.actor_id]) ||
          (e.actor_id ? `${e.actor_id.slice(0, 8)}…` : "System");

        return (
          <li key={e.id} className="border-l-2 border-border pl-3 py-1">
            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
              <span className="whitespace-nowrap">{formatDateTime(e.created_at)}</span>
              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                {cls}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                {summary.objectTypeLabel}
              </Badge>
              {summary.contextLine && (
                <span className="text-[11px]">{summary.contextLine}</span>
              )}
            </div>
            <p className="text-sm text-foreground mt-1 leading-snug">{summary.summary}</p>
            {summary.deltaLines.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {summary.deltaLines.map((d, i) => (
                  <li key={i} className="text-xs text-muted-foreground">
                    {d}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">by {actor}</p>
          </li>
        );
      })}
    </ol>
  );
}

function SummaryView({
  buckets,
  objectIndex,
  hasAnyInPeriod,
}: {
  buckets: Map<SummaryGroup, ProjectActivityEvent[]>;
  objectIndex: ReturnType<typeof useProjectObjectIndex>["data"];
  hasAnyInPeriod: boolean;
}) {
  if (!hasAnyInPeriod) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-foreground">
          No material traceability events recorded for this period.
        </p>
        <p className="text-xs text-muted-foreground">
          Comments and execution updates remain in their own surfaces and are not included in
          Traceability.
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {SUMMARY_GROUP_ORDER.map((g) => {
        const items = buckets.get(g.value) ?? [];
        return (
          <Card key={g.value} className="min-w-0">
            <CardHeader className="p-3 pb-1 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-xs font-semibold">{g.label}</CardTitle>
              <Badge variant="secondary" className="text-[10px]">
                {items.length}
              </Badge>
            </CardHeader>
            <CardContent className="p-3 pt-1">
              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No events</p>
              ) : (
                <ul className="space-y-1.5">
                  {items.slice(0, 5).map((ev) => {
                    const s = summarizeEvent({
                      eventType: ev.event_type,
                      targetType: ev.target_type,
                      targetId: ev.target_id,
                      metadata: ev.metadata,
                      index: objectIndex,
                    });
                    return (
                      <li key={ev.id} className="text-xs">
                        <div className="flex items-center gap-1.5 flex-wrap text-muted-foreground">
                          <span className="whitespace-nowrap text-[10px]">
                            {formatDate(ev.created_at)}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {s.objectTypeLabel}
                          </Badge>
                        </div>
                        <p className="text-foreground leading-snug">{s.summary}</p>
                      </li>
                    );
                  })}
                  {items.length > 5 && (
                    <li className="text-[11px] text-muted-foreground">
                      +{items.length - 5} more
                    </li>
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
