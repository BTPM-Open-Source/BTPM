// AI-GUIDE.V2-FB.ADMIN.1
// Step 0.9A — Admin → AI Guide → Feedback & History tab.
// Org-admin only; uses SECURITY DEFINER RPC ai_help_admin_list_history_feedback.
// Supports filters (date range, user, rating, reason, context/page, search)
// and client-side CSV/JSON export of the current filtered result set.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Row {
  conversation_id: string;
  conversation_title: string | null;
  conversation_created_at: string;
  conversation_updated_at: string;
  user_id: string;
  user_email: string | null;
  user_message_id: string | null;
  user_question: string | null;
  assistant_message_id: string;
  assistant_answer: string;
  source_article_ids: string[];
  context_route: string | null;
  context_label: string | null;
  assistant_created_at: string;
  feedback_id: string | null;
  feedback_rating: string | null;
  feedback_reason_code: string | null;
  feedback_comment: string | null;
  feedback_created_at: string | null;
  feedback_updated_at: string | null;
}

const REASONS = [
  "wrong_answer",
  "wrong_workflow",
  "too_generic",
  "not_enough_detail",
  "missing_feature_or_no_answer",
  "confusing",
  "other",
];

const ANY = "__any__";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = Array.isArray(v) ? v.join(";") : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadBlob(name: string, mime: string, data: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AdminAiGuideFeedbackHistory() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [userId, setUserId] = useState("");
  const [rating, setRating] = useState<string>(ANY);
  const [reason, setReason] = useState<string>(ANY);
  const [contextRoute, setContextRoute] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState("500");

  const args = useMemo(
    () => ({
      _date_from: dateFrom ? new Date(dateFrom).toISOString() : null,
      _date_to: dateTo ? new Date(dateTo).toISOString() : null,
      _user_id: userId.trim() || null,
      _rating: rating === ANY ? null : rating,
      _reason_code: reason === ANY ? null : reason,
      _context_route: contextRoute.trim() || null,
      _search: search.trim() || null,
      _limit: Math.max(1, Math.min(1000, parseInt(limit, 10) || 500)),
    }),
    [dateFrom, dateTo, userId, rating, reason, contextRoute, search, limit],
  );

  const query = useQuery({
    queryKey: ["admin-ai-guide-history-feedback", args],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc(
        "ai_help_admin_list_history_feedback",
        args,
      );
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const rows = query.data ?? [];

  function exportCsv() {
    if (!rows.length) {
      toast.info("No rows to export.");
      return;
    }
    const headers = [
      "assistant_created_at",
      "conversation_id",
      "conversation_title",
      "user_id",
      "user_email",
      "context_route",
      "context_label",
      "user_question",
      "assistant_answer",
      "source_article_ids",
      "feedback_rating",
      "feedback_reason_code",
      "feedback_comment",
      "feedback_created_at",
      "feedback_updated_at",
      "assistant_message_id",
      "user_message_id",
    ] as const;
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push(headers.map((h) => csvEscape((r as any)[h])).join(","));
    }
    downloadBlob(
      `btpm-guide-history-${new Date().toISOString().slice(0, 10)}.csv`,
      "text/csv;charset=utf-8",
      lines.join("\n"),
    );
  }

  function exportJson() {
    if (!rows.length) {
      toast.info("No rows to export.");
      return;
    }
    downloadBlob(
      `btpm-guide-history-${new Date().toISOString().slice(0, 10)}.json`,
      "application/json",
      JSON.stringify(rows, null, 2),
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="datetime-local" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="datetime-local" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">User ID</Label>
            <Input placeholder="uuid" value={userId} onChange={(e) => setUserId(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Rating</Label>
            <Select value={rating} onValueChange={setRating}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any</SelectItem>
                <SelectItem value="helpful">Helpful</SelectItem>
                <SelectItem value="not_helpful">Not helpful</SelectItem>
                <SelectItem value="none">No feedback</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any</SelectItem>
                {REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Context route</Label>
            <Input placeholder="/roadmap" value={contextRoute} onChange={(e) => setContextRoute(e.target.value)} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">Search (question/answer)</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Limit (max 1000)</Label>
            <Input type="number" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Refresh
          </Button>
          <Button size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-3 w-3 mr-1" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={exportJson} disabled={!rows.length}>
            <Download className="h-3 w-3 mr-1" /> JSON
          </Button>
          <Badge variant="outline">{rows.length} rows</Badge>
          {query.error && (
            <span className="text-xs text-destructive">
              {query.error instanceof Error ? query.error.message : "Failed to load"}
            </span>
          )}
        </div>
      </Card>

      <Card className="p-0">
        <ScrollArea className="h-[60vh]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr className="text-left">
                <th className="p-2">When</th>
                <th className="p-2">User</th>
                <th className="p-2">Context</th>
                <th className="p-2">Question</th>
                <th className="p-2">Answer</th>
                <th className="p-2">Feedback</th>
                <th className="p-2">Sources</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.assistant_message_id} className="border-t align-top">
                  <td className="p-2 whitespace-nowrap">
                    {new Date(r.assistant_created_at).toLocaleString()}
                  </td>
                  <td className="p-2">
                    <div className="font-mono text-[10px]">{r.user_email || r.user_id}</div>
                  </td>
                  <td className="p-2">
                    <div>{r.context_label || ""}</div>
                    <div className="text-[10px] text-muted-foreground">{r.context_route || ""}</div>
                  </td>
                  <td className="p-2 max-w-[260px]">
                    <div className="line-clamp-4 whitespace-pre-wrap">{r.user_question || ""}</div>
                  </td>
                  <td className="p-2 max-w-[360px]">
                    <div className="line-clamp-5 whitespace-pre-wrap">{r.assistant_answer}</div>
                  </td>
                  <td className="p-2">
                    {r.feedback_rating ? (
                      <div className="space-y-1">
                        <Badge variant={r.feedback_rating === "helpful" ? "default" : "destructive"}>
                          {r.feedback_rating}
                        </Badge>
                        {r.feedback_reason_code && (
                          <div className="text-[10px]">{r.feedback_reason_code}</div>
                        )}
                        {r.feedback_comment && (
                          <div className="text-[10px] text-muted-foreground whitespace-pre-wrap">
                            {r.feedback_comment}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-2 text-[10px]">{r.source_article_ids?.length ?? 0}</td>
                </tr>
              ))}
              {!rows.length && !query.isFetching && (
                <tr><td className="p-4 text-center text-muted-foreground" colSpan={7}>No rows.</td></tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </Card>
    </div>
  );
}
