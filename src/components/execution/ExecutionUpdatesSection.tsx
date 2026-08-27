import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { TrendingUp } from "lucide-react";
import { useExecutionUpdates, useCreateExecutionUpdate } from "@/hooks/useExecutionData";
import { useAuth } from "@/hooks/useAuth";
import { ConceptHelp } from "@/components/knowledge/ConceptHelp";
import { KC_CONCEPTS } from "@/components/knowledge/kc-concepts";
import {
  getPmWorkflowStatusBadgeClass,
  getPmWorkflowStatusLabel,
} from "@/lib/btpmVisualSemantics";

// Normalizes a free-text status label into a canonical PM workflow status
// key when it clearly matches one. Returns null for any other label so it
// renders neutral (we never invent data).
function normalizeExecutionStatusKey(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v === "planned" || v === "not started") return "planned";
  if (v === "active" || v === "in progress" || v === "in_progress") return "active";
  if (v === "completed" || v === "complete" || v === "done") return "completed";
  if (v === "on hold" || v === "on_hold") return "on_hold";
  if (v === "cancelled" || v === "canceled") return "cancelled";
  return null;
}

interface Props {
  targetType: string;
  targetId: string;
  organizationId: string;
  workspaceId: string;
  canEdit: boolean;
  membersMap: Record<string, string>;
}

function formatUpdateDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatCreatedAt(d: string): string {
  return new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ExecutionUpdatesSection({ targetType, targetId, organizationId, workspaceId, canEdit, membersMap }: Props) {
  const { user } = useAuth();
  const { data: updates = [], isLoading } = useExecutionUpdates(targetType, targetId);
  const create = useCreateExecutionUpdate();
  const [summary, setSummary] = useState("");
  const [statusLabel, setStatusLabel] = useState("");
  const [updateDate, setUpdateDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [showForm, setShowForm] = useState(false);

  const handleAdd = async () => {
    if (!summary.trim() || !user) return;
    await create.mutateAsync({
      summary: summary.trim(),
      status_label: statusLabel.trim() || null,
      update_date: updateDate,
      target_type: targetType,
      target_id: targetId,
      organization_id: organizationId,
      workspace_id: workspaceId,
      author_id: user.id,
    });
    setSummary("");
    setStatusLabel("");
    setShowForm(false);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" /> Progress History
          {updates.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({updates.length})</span>
          )}
          <ConceptHelp
            term={KC_CONCEPTS.commentVsExecutionUpdate.term}
            shortText={KC_CONCEPTS.commentVsExecutionUpdate.shortText}
            articleSlug={KC_CONCEPTS.commentVsExecutionUpdate.slug}
          />
        </CardTitle>
        <CardDescription className="text-xs">
          Dated progress entries — what was accomplished and when.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && updates.length === 0 && !showForm && (
          <p className="text-sm text-muted-foreground italic">No progress entries recorded yet. Add one to start tracking execution history.</p>
        )}
        {updates.map((u: any) => (
          <div key={u.id} className="border border-border rounded-md p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{formatUpdateDate(u.update_date)}</span>
                {u.status_label && (() => {
                  const key = normalizeExecutionStatusKey(String(u.status_label));
                  if (key) {
                    return (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getPmWorkflowStatusBadgeClass(key)}`}>
                        {getPmWorkflowStatusLabel(key)}
                      </span>
                    );
                  }
                  return (
                    <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium">
                      {u.status_label}
                    </span>
                  );
                })()}
              </div>
              <span className="text-xs text-muted-foreground">
                {membersMap[u.author_id] || u.author_id?.slice(0, 8)}
              </span>
            </div>
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{u.summary}</p>
            <p className="text-[11px] text-muted-foreground" title={formatCreatedAt(u.created_at)}>
              Logged {formatCreatedAt(u.created_at)}
            </p>
          </div>
        ))}

        {canEdit && !showForm && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
            <TrendingUp className="h-3 w-3 mr-1" /> Record Progress
          </Button>
        )}

        {showForm && (
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex gap-2">
              <Input type="date" value={updateDate} onChange={(e) => setUpdateDate(e.target.value)} className="w-auto" />
              <Input placeholder="Status label (optional)" value={statusLabel} onChange={(e) => setStatusLabel(e.target.value)} className="w-40" />
            </div>
            <Textarea
              placeholder="What progress was made? Describe key accomplishments, deliverables, or milestones…"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={!summary.trim() || create.isPending}>
                Save Entry
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
