import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { History } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

interface Props {
  events: Tables<"activity_events">[];
  isLoading: boolean;
  /** Map of user_id -> display name for rendering actor names */
  actorNames?: Record<string, string>;
  title?: string;
}

const EVENT_LABELS: Record<string, string> = {
  org_admin_granted: "granted Organization Admin",
  org_admin_revoked: "revoked Organization Admin",
  workspace_access_added: "added workspace access",
  workspace_access_removed: "removed workspace access",
  workspace_role_changed: "changed workspace role",
  workspace_member_added: "added as workspace member",
  workspace_member_removed: "removed from workspace",
  user_deactivated: "deactivated user",
  user_reactivated: "reactivated user",
  user_deleted: "deleted user",
  invitation_created: "created invitation",
  invitation_revoked: "revoked invitation",
  invitation_resent: "resent invitation",
  invitation_deleted: "deleted invitation",
  invitation_accepted: "accepted invitation",
};

function formatDate(d: string) {
  return new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatMetadata(eventType: string, metadata: Record<string, unknown> | null): string {
  if (!metadata) return "";
  const parts: string[] = [];

  if (metadata.workspace_name) parts.push(`in "${metadata.workspace_name}"`);
  if (metadata.role) parts.push(`as ${String(metadata.role).replace(/_/g, " ")}`);
  if (metadata.old_role && metadata.new_role) {
    parts.length = 0; // Reset
    if (metadata.workspace_name) parts.push(`in "${metadata.workspace_name}"`);
    parts.push(`from ${String(metadata.old_role).replace(/_/g, " ")} → ${String(metadata.new_role).replace(/_/g, " ")}`);
  }
  if (metadata.email && eventType.startsWith("invitation_")) {
    parts.push(`for ${metadata.email}`);
  }

  return parts.join(" ");
}

export function AccessHistorySection({ events, isLoading, actorNames = {}, title = "Recent Access Changes" }: Props) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && events.length === 0 && (
          <p className="text-sm text-muted-foreground">No access changes recorded yet.</p>
        )}
        {events.length > 0 && (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {events.map((e) => {
              const actorName = e.actor_id ? (actorNames[e.actor_id] || e.actor_id.slice(0, 8)) : "System";
              const label = EVENT_LABELS[e.event_type] || e.event_type.replace(/_/g, " ");
              const parsedMeta = typeof e.metadata === 'string' ? (() => { try { return JSON.parse(e.metadata); } catch { return null; } })() : e.metadata;
              const meta = formatMetadata(e.event_type, parsedMeta as Record<string, unknown> | null);

              return (
                <div key={e.id} className="flex items-start gap-2 text-xs border-b border-border/50 pb-2 last:border-0">
                  <span className="text-muted-foreground whitespace-nowrap shrink-0">{formatDate(e.created_at)}</span>
                  <span className="text-foreground">
                    <span className="font-medium">{actorName}</span>{" "}
                    {label}
                    {meta && <span className="text-muted-foreground"> {meta}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
