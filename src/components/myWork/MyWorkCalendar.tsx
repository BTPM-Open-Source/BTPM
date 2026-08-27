import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { MyWorkItem } from "@/hooks/useMyWork";

type CalView = "week" | "month";

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

// Monday-start week
const startOfWeek = (d: Date) => {
  const x = startOfDay(d);
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  return x;
};
const startOfMonth = (d: Date) => {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ItemPill({
  item,
  showWorkspace,
}: {
  item: MyWorkItem;
  showWorkspace: boolean;
}) {
  const href = `/workspace/${item.workspaceId}/project/${item.projectId}/task/${item.taskId}?from=my-work`;
  const today = startOfDay(new Date());
  const due = item.dueDate ? startOfDay(new Date(item.dueDate)) : null;
  const overdue = due && due < today;
  return (
    <Link
      to={href}
      className="block text-[11px] leading-tight rounded px-1.5 py-1 bg-accent/40 hover:bg-accent transition-colors border border-border/50 truncate"
      title={`${item.title} · ${item.projectName}`}
    >
      <div className="flex items-center gap-1">
        {item.hasOpenBlocker && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-destructive shrink-0"
            aria-label="Blocked"
          />
        )}
        {overdue && !item.hasOpenBlocker && (
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0"
            aria-label="Overdue"
          />
        )}
        <span className="truncate font-medium text-foreground">
          {item.title}
        </span>
      </div>
      <div className="truncate text-muted-foreground">
        {item.projectName}
        {showWorkspace && item.workspaceName ? ` · ${item.workspaceName}` : ""}
      </div>
    </Link>
  );
}

function groupByDay(items: MyWorkItem[]) {
  const map = new Map<string, MyWorkItem[]>();
  for (const it of items) {
    if (!it.dueDate) continue;
    const key = startOfDay(new Date(it.dueDate)).toISOString();
    const arr = map.get(key) ?? [];
    arr.push(it);
    map.set(key, arr);
  }
  return map;
}

export function MyWorkCalendar({
  items,
  showWorkspace,
}: {
  items: MyWorkItem[];
  showWorkspace: boolean;
}) {
  const [view, setView] = useState<CalView>("week");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));

  const byDay = useMemo(() => groupByDay(items), [items]);
  const today = startOfDay(new Date());
  const undated = useMemo(() => items.filter((i) => !i.dueDate), [items]);

  const periodLabel = useMemo(() => {
    if (view === "week") {
      const s = startOfWeek(anchor);
      const e = addDays(s, 6);
      const fmt = (d: Date) =>
        d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return `${fmt(s)} – ${fmt(e)}, ${e.getFullYear()}`;
    }
    return anchor.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }, [view, anchor]);

  const goPrev = () =>
    setAnchor((a) => (view === "week" ? addDays(a, -7) : new Date(a.getFullYear(), a.getMonth() - 1, 1)));
  const goNext = () =>
    setAnchor((a) => (view === "week" ? addDays(a, 7) : new Date(a.getFullYear(), a.getMonth() + 1, 1)));
  const goToday = () => setAnchor(startOfDay(new Date()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 p-3 border border-border rounded-md bg-card">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={goPrev} aria-label="Previous">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={goToday}>
            Today
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={goNext} aria-label="Next">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="text-sm font-semibold text-foreground min-w-[180px]">
          {periodLabel}
        </div>
        <div className="ml-auto">
          <ToggleGroup
            type="single"
            size="sm"
            value={view}
            onValueChange={(v) => v && setView(v as CalView)}
          >
            <ToggleGroupItem value="week">Week</ToggleGroupItem>
            <ToggleGroupItem value="month">Month</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {view === "week" ? (
        <WeekGrid
          anchor={anchor}
          today={today}
          byDay={byDay}
          showWorkspace={showWorkspace}
        />
      ) : (
        <MonthGrid
          anchor={anchor}
          today={today}
          byDay={byDay}
          showWorkspace={showWorkspace}
        />
      )}

      {undated.length > 0 && (
        <div className="border border-border rounded-md bg-card p-3">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-semibold text-foreground">No due date</h3>
            <Badge variant="secondary" className="text-[10px]">
              {undated.length}
            </Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {undated.map((it) => (
              <ItemPill key={it.taskId} item={it} showWorkspace={showWorkspace} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WeekGrid({
  anchor,
  today,
  byDay,
  showWorkspace,
}: {
  anchor: Date;
  today: Date;
  byDay: Map<string, MyWorkItem[]>;
  showWorkspace: boolean;
}) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
      {days.map((d, i) => {
        const items = byDay.get(d.toISOString()) ?? [];
        const isToday = sameDay(d, today);
        return (
          <div
            key={d.toISOString()}
            className={`border rounded-md bg-card p-2 min-h-[140px] ${
              isToday ? "border-primary" : "border-border"
            }`}
          >
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {WEEKDAYS[i]}
              </div>
              <div
                className={`text-sm font-semibold ${
                  isToday ? "text-primary" : "text-foreground"
                }`}
              >
                {d.getDate()}
              </div>
            </div>
            <div className="space-y-1">
              {items.map((it) => (
                <ItemPill key={it.taskId} item={it} showWorkspace={showWorkspace} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MonthGrid({
  anchor,
  today,
  byDay,
  showWorkspace,
}: {
  anchor: Date;
  today: Date;
  byDay: Map<string, MyWorkItem[]>;
  showWorkspace: boolean;
}) {
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const month = anchor.getMonth();

  return (
    <div className="border border-border rounded-md bg-card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border bg-muted/30">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="text-[11px] uppercase tracking-wide text-muted-foreground px-2 py-1.5"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d) => {
          const items = byDay.get(d.toISOString()) ?? [];
          const isToday = sameDay(d, today);
          const inMonth = d.getMonth() === month;
          const visible = items.slice(0, 3);
          const extra = items.length - visible.length;
          return (
            <div
              key={d.toISOString()}
              className={`border-b border-r border-border p-1.5 min-h-[96px] ${
                inMonth ? "bg-card" : "bg-muted/20"
              }`}
            >
              <div
                className={`text-xs font-medium mb-1 ${
                  !inMonth
                    ? "text-muted-foreground/60"
                    : isToday
                      ? "text-primary"
                      : "text-foreground"
                }`}
              >
                {d.getDate()}
              </div>
              <div className="space-y-1">
                {visible.map((it) => (
                  <ItemPill key={it.taskId} item={it} showWorkspace={showWorkspace} />
                ))}
                {extra > 0 && (
                  <div className="text-[10px] text-muted-foreground px-1">
                    +{extra} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
