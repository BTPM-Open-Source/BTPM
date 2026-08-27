import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { useActivityEvents } from "@/hooks/useExecutionData";

interface Props {
  targetType: string;
  targetId: string;
  membersMap: Record<string, string>;
}

export function ActivitySection({ targetType, targetId, membersMap }: Props) {
  const { data: events = [], isLoading } = useActivityEvents(targetType, targetId);

  const formatDate = (d: string) => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  const formatStatus = (s: string) =>
    s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const parseMetadata = (m: any): Record<string, any> | null => {
    if (!m) return null;
    if (typeof m === "object") return m;
    try { return JSON.parse(m); } catch { return null; }
  };

  const describeEvent = (e: any): string => {
    const meta = parseMetadata(e.metadata);
    if (e.event_type === "status_changed" && meta?.new_status) {
      return `status changed to ${formatStatus(String(meta.new_status))}`;
    }
    if (e.event_type === "blocker_updated" || e.event_type === "risk_updated") {
      const noun = e.event_type === "blocker_updated" ? "blocker" : "risk";
      const parts: string[] = [];
      const changed = (meta?.changed_fields ?? {}) as Record<string, unknown>;
      const fields = Object.keys(changed);
      if (fields.length > 0) parts.push(fields.map((f) => f.replace(/_/g, " ")).join(", "));
      const peopleAdded = Array.isArray(meta?.people_added) ? meta!.people_added.length : 0;
      const peopleRemoved = Array.isArray(meta?.people_removed) ? meta!.people_removed.length : 0;
      if (peopleAdded || peopleRemoved) parts.push(`people ${peopleAdded ? `+${peopleAdded}` : ""}${peopleAdded && peopleRemoved ? "/" : ""}${peopleRemoved ? `-${peopleRemoved}` : ""}`);
      const objsAdded = Array.isArray(meta?.objects_added) ? meta!.objects_added.length : 0;
      const objsRemoved = Array.isArray(meta?.objects_removed) ? meta!.objects_removed.length : 0;
      if (objsAdded || objsRemoved) parts.push(`related items ${objsAdded ? `+${objsAdded}` : ""}${objsAdded && objsRemoved ? "/" : ""}${objsRemoved ? `-${objsRemoved}` : ""}`);
      return `updated ${noun}${parts.length ? ` — ${parts.join("; ")}` : ""}`;
    }
    if (e.event_type === "blocker_opened") return "opened blocker";
    if (e.event_type === "blocker_resolved") return "resolved blocker";
    if (e.event_type === "blocker_state_changed" && meta?.new_status) return `changed blocker state to ${formatStatus(String(meta.new_status))}`;
    if (e.event_type === "risk_opened") return "opened risk";
    if (e.event_type === "risk_state_changed" && meta?.new_status) return `changed risk state to ${formatStatus(String(meta.new_status))}`;
    return e.event_type?.replace(/_/g, " ") ?? "";
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" /> Activity Trail
        </CardTitle>
        <CardDescription className="text-xs">
          System-generated log of changes and actions.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && events.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No activity recorded yet.</p>
        )}
        {events.length > 0 && (
          <div className="space-y-2">
            {events.map((e: any) => (
              <div key={e.id} className="flex items-start gap-2 text-xs">
                <span className="text-muted-foreground whitespace-nowrap">{formatDate(e.created_at)}</span>
                <span className="text-foreground">
                  <span className="font-medium">{membersMap[e.actor_id || ""] || e.actor_id?.slice(0, 8) || "System"}</span>
                  {" "}{describeEvent(e)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
