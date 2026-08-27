// AI-GUIDE.V2-FB.UI.1
// Step 0.9A — compact helpful/not-helpful controls under an assistant
// Guide answer. Persists to ai_help_message_feedback via RPC. Optional
// reason code + comment when 👎 is selected.
import { useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  useUpsertAiHelpMessageFeedback,
  type GuideFeedbackRow,
} from "@/hooks/useAiHelpFeedback";

const REASON_CODES: { value: string; label: string }[] = [
  { value: "wrong_answer", label: "Wrong answer" },
  { value: "wrong_workflow", label: "Wrong workflow" },
  { value: "too_generic", label: "Too generic" },
  { value: "not_enough_detail", label: "Not enough detail" },
  { value: "missing_feature_or_no_answer", label: "Missing feature / no answer" },
  { value: "confusing", label: "Confusing" },
  { value: "other", label: "Other" },
];

interface Props {
  assistantMessageId: string;
  conversationId: string | null;
  current?: GuideFeedbackRow;
}

export default function GuideMessageFeedback({
  assistantMessageId,
  conversationId,
  current,
}: Props) {
  const upsert = useUpsertAiHelpMessageFeedback(conversationId);
  const [showDislike, setShowDislike] = useState(false);
  const [reason, setReason] = useState<string>(current?.reason_code ?? "");
  const [comment, setComment] = useState<string>(current?.comment ?? "");

  useEffect(() => {
    setReason(current?.reason_code ?? "");
    setComment(current?.comment ?? "");
  }, [current?.id]);

  const rating = current?.rating;

  function submit(next: "helpful" | "not_helpful", extra?: {
    reason_code?: string | null; comment?: string | null;
  }) {
    upsert.mutate(
      {
        assistant_message_id: assistantMessageId,
        rating: next,
        reason_code: extra?.reason_code ?? (next === "not_helpful" ? reason || null : null),
        comment: extra?.comment ?? (next === "not_helpful" ? (comment.trim() || null) : null),
      },
      {
        onSuccess: () => toast.success("Feedback saved"),
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Could not save feedback"),
      },
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          className={cn("h-7 w-7", rating === "helpful" && "text-primary bg-primary/10")}
          title="Helpful"
          aria-label="Mark answer helpful"
          disabled={upsert.isPending}
          onClick={() => {
            setShowDislike(false);
            submit("helpful", { reason_code: null, comment: null });
          }}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={cn("h-7 w-7", rating === "not_helpful" && "text-destructive bg-destructive/10")}
          title="Not helpful"
          aria-label="Mark answer not helpful"
          disabled={upsert.isPending}
          onClick={() => {
            setShowDislike((v) => !v);
            if (rating !== "not_helpful") {
              submit("not_helpful");
            }
          }}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </Button>
        {upsert.isPending && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
        <span className="text-[10px] text-muted-foreground ml-1">
          Feedback helps improve BTPM Guide. Org admins may review Guide history and feedback.
        </span>
      </div>

      {(showDislike || rating === "not_helpful") && (
        <div className="space-y-2 rounded-md border bg-card/50 p-2">
          <Select value={reason} onValueChange={(v) => setReason(v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Reason (optional)" />
            </SelectTrigger>
            <SelectContent>
              {REASON_CODES.map((r) => (
                <SelectItem key={r.value} value={r.value} className="text-xs">
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 1000))}
            placeholder="Optional: tell us what was wrong"
            className="min-h-[60px] text-xs"
            maxLength={1000}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              disabled={upsert.isPending}
              onClick={() =>
                submit("not_helpful", {
                  reason_code: reason || null,
                  comment: comment.trim() || null,
                })
              }
            >
              Save feedback
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
