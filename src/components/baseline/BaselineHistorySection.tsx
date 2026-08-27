import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, ShieldCheck, RotateCcw, CalendarClock, Sparkles } from "lucide-react";
import { useActivityEvents } from "@/hooks/useExecutionData";

interface Props {
  targetType: "project" | "phase" | "task";
  targetId: string;
  membersMap: Record<string, string>;
}

const BASELINE_EVENT_TYPES = new Set([
  "baseline_approved",
  "baseline_rebaselined",
  "baseline_post_add",
  "rebaselined",
  "schedule_changed",
  "added_after_baseline",
  "child_added_after_baseline",
]);

function eventIcon(type: string) {
  if (type === "baseline_approved") return <ShieldCheck className="h-3.5 w-3.5 text-primary" />;
  if (type === "rebaselined" || type === "baseline_rebaselined") return <RotateCcw className="h-3.5 w-3.5 text-primary" />;
  if (type === "schedule_changed") return <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />;
  if (
    type === "added_after_baseline" ||
    type === "child_added_after_baseline" ||
    type === "baseline_post_add"
  )
    return <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />;
  return <History className="h-3.5 w-3.5 text-muted-foreground" />;
}

function eventLabel(type: string): string {
  switch (type) {
    case "baseline_approved": return "Baseline approved";
    case "baseline_rebaselined":
    case "rebaselined": return "Rebaselined";
    case "schedule_changed": return "Schedule changed";
    case "baseline_post_add":
    case "added_after_baseline":
    case "child_added_after_baseline": return "Added after baseline";
    default: return type.replace(/_/g, " ");
  }
}


function parseMeta(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function formatScheduleMeta(meta: Record<string, any>): string | null {
  const oldS = meta.old_start, oldE = meta.old_end, newS = meta.new_start, newE = meta.new_end;
  if (!oldS && !oldE && !newS && !newE) return null;
  const after = meta.after_baseline ? " (after baseline)" : "";
  return `${oldS || "—"} → ${oldE || "—"}  ⇒  ${newS || "—"} → ${newE || "—"}${after}`;
}

/**
 * Filtered baseline-history view sourced from the existing activity_events stream.
 * Read-only. Shows only baseline-related events to make schedule traceability clear.
 */
export function BaselineHistorySection({ targetType, targetId, membersMap }: Props) {
  const { data: events = [], isLoading } = useActivityEvents(targetType, targetId);

  const baselineEvents = events.filter((e) => BASELINE_EVENT_TYPES.has(e.event_type));

  const formatDate = (d: string) =>
    new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4" /> Baseline & Schedule History
        </CardTitle>
        <CardDescription className="text-xs">
          Approvals, rebaselines, post-baseline date changes and additions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && baselineEvents.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No baseline events recorded yet.</p>
        )}
        {baselineEvents.length > 0 && (
          <ol className="space-y-2.5">
            {baselineEvents.map((e: any) => {
              const meta = parseMeta(e.metadata);
              const isSchedule = e.event_type === "schedule_changed";
              const detail = isSchedule ? formatScheduleMeta(meta) : null;
              const actor = membersMap[e.actor_id || ""] || (e.actor_id ? e.actor_id.slice(0, 8) : "System");
              return (
                <li key={e.id} className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5">{eventIcon(e.event_type)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium text-foreground">{eventLabel(e.event_type)}</span>
                      <span className="text-muted-foreground">{actor}</span>
                      <span className="text-muted-foreground">· {formatDate(e.created_at)}</span>
                      {meta.after_baseline && !isSchedule && (
                        <Badge variant="outline" className="text-[9px] uppercase tracking-wide">after baseline</Badge>
                      )}
                    </div>
                    {detail && (
                      <div className="text-muted-foreground font-mono text-[11px] mt-0.5 truncate" title={detail}>{detail}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
