import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Mail, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { TeamWorkItem } from "@/hooks/useTeamWorkOverview";

export interface TeamWorkReminderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Task rows selected in the Attention list (used only for preview). */
  selectedItems: TeamWorkItem[];
  onSent?: () => void;
}

interface GroupPreview {
  key: string;
  name: string;
  email: string;
  tasks: TeamWorkItem[];
}

function reasonFor(item: TeamWorkItem): string | null {
  if (item.is_overdue) return "Overdue";
  if (item.is_due_today) return "Due today";
  if (item.is_blocked) return "Blocked";
  if (item.is_upcoming) return "Upcoming";
  if (item.is_high_priority) return "High priority";
  return null;
}

export function TeamWorkReminderDialog({
  open,
  onOpenChange,
  selectedItems,
  onSent,
}: TeamWorkReminderDialogProps) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const { groups, skipped } = useMemo(() => {
    const g = new Map<string, GroupPreview>();
    const s: { item: TeamWorkItem; reason: string }[] = [];
    for (const it of selectedItems) {
      if (!it.assignee_id) {
        s.push({ item: it, reason: "Unassigned" });
        continue;
      }
      if (!it.assignee_email) {
        s.push({ item: it, reason: "No email on file" });
        continue;
      }
      const key = it.assignee_email.toLowerCase();
      let row = g.get(key);
      if (!row) {
        row = {
          key,
          name: it.assignee_name ?? it.assignee_email,
          email: it.assignee_email,
          tasks: [],
        };
        g.set(key, row);
      }
      row.tasks.push(it);
    }
    return { groups: Array.from(g.values()), skipped: s };
  }, [selectedItems]);

  const eligibleTaskIds = useMemo(
    () => groups.flatMap((g) => g.tasks.map((t) => t.task_id)),
    [groups],
  );

  const handleOpenChange = (next: boolean) => {
    if (next) setMessage("");
    onOpenChange(next);
  };

  const handleSend = async () => {
    // Send ALL selected task IDs; the backend re-authorizes and re-groups.
    // This lets the backend report accurate skipped/eligible counts even
    // when the client is out of date.
    const allIds = Array.from(new Set(selectedItems.map((i) => i.task_id)));
    if (allIds.length === 0) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-team-work-reminders",
        { body: { task_ids: allIds, message: message.trim() || undefined } },
      );
      if (error) throw error;
      const d = (data ?? {}) as {
        ok?: boolean;
        eligible_task_count?: number;
        skipped_count?: number;
        sent_email_count?: number;
        failed_email_count?: number;
        errors?: string[];
      };
      const sent = d.sent_email_count ?? 0;
      const failed = d.failed_email_count ?? 0;
      const eligibleTasks = d.eligible_task_count ?? 0;
      const skippedCount = d.skipped_count ?? 0;

      if (sent === 0 && failed === 0 && eligibleTasks === 0) {
        toast({
          title: "No reminders sent",
          description: skippedCount
            ? `${skippedCount} task(s) skipped — no eligible assignees.`
            : "No eligible tasks in your selection.",
          variant: "destructive",
        });
      } else if (failed > 0) {
        toast({
          title: "Reminders partially sent",
          description: `Sent ${sent} email(s) for ${eligibleTasks} task(s). ${failed} failed. ${skippedCount} skipped.${
            d.errors?.length ? " " + d.errors.slice(0, 2).join("; ") : ""
          }`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Reminders sent",
          description: `Sent ${sent} email(s) covering ${eligibleTasks} task(s)${
            skippedCount ? `. ${skippedCount} skipped.` : "."
          }`,
        });
      }
      onSent?.();
      onOpenChange(false);
    } catch (e: any) {
      toast({
        title: "Failed to send reminders",
        description: e?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Send task reminders
          </DialogTitle>
          <DialogDescription>
            Sends one branded BTPM email per assignee, grouping their selected
            open tasks. Recipients still need a BTPM account to open the tasks.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Recipients ({groups.length}) · Eligible tasks ({eligibleTaskIds.length})
            </p>
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No eligible assignees in the selection.
              </p>
            ) : (
              <ul className="space-y-3">
                {groups.map((g) => (
                  <li key={g.key} className="text-sm">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-medium text-foreground">{g.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {g.email}
                      </span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {g.tasks.length} task{g.tasks.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    <ul className="mt-1 pl-4 space-y-0.5">
                      {g.tasks.map((t) => {
                        const r = reasonFor(t);
                        return (
                          <li
                            key={t.task_id}
                            className="text-xs text-muted-foreground flex gap-2 items-baseline"
                          >
                            <span className="text-foreground">
                              {t.task_name ?? "(Untitled task)"}
                            </span>
                            <span>· {t.project_name ?? "—"}</span>
                            {t.due_date && <span>· Due {t.due_date}</span>}
                            {r && (
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0"
                              >
                                {r}
                              </Badge>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {skipped.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300 mb-2 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" />
                Skipped ({skipped.length})
              </p>
              <ul className="space-y-1">
                {skipped.map(({ item, reason }) => (
                  <li
                    key={item.task_id}
                    className="text-xs text-amber-900 dark:text-amber-200"
                  >
                    <span className="font-medium">
                      {item.task_name ?? "(Untitled task)"}
                    </span>
                    <span className="text-amber-700 dark:text-amber-300">
                      {" "}
                      · {reason}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-2">
                Additional skips (e.g. completed, no PM authority, inactive
                assignee) may be reported after send.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reminder-message">Optional message</Label>
            <Textarea
              id="reminder-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a short note for the recipients…"
              rows={3}
              maxLength={2000}
            />
            <p className="text-[11px] text-muted-foreground">
              {message.length}/2000
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || selectedItems.length === 0}
          >
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…
              </>
            ) : (
              <>
                <Mail className="h-4 w-4 mr-2" /> Send reminders
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
